# Research behind migration 025

Everything needed to inspect and rebuild `database/sql/025_public_view_grant_hardening.sql`: a read-only audit
of every public view, the reviewed view inventory, and the assembly of the migration.

## Pipeline

| Step | Command | Output |
| --- | --- | --- |
| 1a. Audit (live, read-only) | `node --env-file=.env.local database/research/025/audit.mjs --live` | `audit-report-live.json` |
| 1b. Audit (local canonical, before 025) | `node database/research/025/audit.mjs` | `audit-report-local.json` |
| Reviewed input | `node database/research/025/inventory.mjs` (refuses to write if any view needs a manual decision) | `view-inventory.json` (all 86 views) |
| 2. Build | `node database/research/025/build.mjs` | `database/sql/025_public_view_grant_hardening.sql` |
| Harness | `node database/research/025/test-025.mjs` | builds 001→024 in PGlite, runs 025 twice |

The audit only reads catalogs (`set default_transaction_read_only = on` live). It never sends INSERT, UPDATE, DELETE
or TRUNCATE: writability is decided structurally from `information_schema.views` (`is_updatable`,
`is_insertable_into`), INSTEAD OF triggers and non-SELECT rules on each view, and the RLS policies of the base tables
underneath it. The local PGlite chain has no Supabase default privileges, so the local report shows SELECT-only grants;
the live report is the one that shows the problem.

## Findings (live, after 024)

| | Count |
| --- | --- |
| Public views | 86 |
| … security_invoker | 86 |
| … anon holds more than SELECT | **43** |
| … authenticated holds more than SELECT | **43** (the same 43) |
| … PUBLIC grants | 0 |
| … updatable or insertable (`information_schema.views`) | 0 |
| … INSTEAD OF trigger or rule | 0 |
| … base table with an anon/authenticated write policy | 0 |
| … intentionally writable | 0 |
| Public base tables | 42, all with RLS, anon/authenticated SELECT only |
| Policies granting writes to anon/authenticated | 0 |

The 43 views (`v_dodgers_*`, `v_league_*`, `v_player_signing_profile`, `v_signing_*`; full list in
`view-inventory.json`, `live_beyond_select_before_025: true`) were created by migrations 001–016. Each granted
anon and authenticated `DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`. `MAINTAIN`
(PostgreSQL 17) is not visible in `information_schema.role_table_grants`, which is why ACL-level checks are used.
service_role holds ALL on every view and is not changed.

**Why.** `pg_default_acl` on the live database grants ALL on new relations in `public` to anon and authenticated for
objects created by `postgres` (and by `supabase_admin`), plus sequence and function defaults. Migrations from 017 onward
revoke and re-grant explicitly; 001–016 did not for their views. Every table was later hardened explicitly, so only
these views kept the defaults.

**Exposure.** None of the 43 is updatable or insertable, none has a trigger or rule, and every base table is
RLS-protected with SELECT-only grants and no write policies, so no write path existed in practice. The grants still
violate least privilege (TRIGGER, REFERENCES and MAINTAIN in particular are meaningless for a read API), so 025
removes them.

All 86 views are classified `READ_ONLY_ANALYTICS`; there is no allowlist of writable views.

## What 025 does

1. Guards: every public view is in the reviewed inventory, exists as a view, and is security_invoker.
2. For each inventoried view: `REVOKE ALL … FROM anon, authenticated`, then `GRANT SELECT … TO anon, authenticated`.
3. Postcondition: from the ACLs, no public view or table grants anon, authenticated or PUBLIC anything beyond
   SELECT; otherwise it raises and rolls back.

Not changed: view definitions, data, RLS, policies, table grants, service_role privileges, default privileges.

## Default privileges (recommendation, not implemented)

The recurrence source is the `postgres` default ACL in `public` (`ALL` on tables for anon/authenticated). DISI does not
rely on automatic writes: no table grants anon/authenticated more than SELECT and no policy allows them to write. A
narrowly scoped rule would therefore be safe:

```sql
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
```

New tables and views would then start with no API access (fail closed) until a migration grants SELECT explicitly,
which every migration since 017 already does. Function defaults (EXECUTE) must stay: views call the `disi_*` helper
functions as the querying role. The `supabase_admin` defaults cannot be altered by `postgres` and only matter for
objects Supabase itself creates. Recommendation: adopt the rule above in its own small reviewed migration if
approved; until then the migration convention plus the verifier's whole-surface checks catch any recurrence.

## Verifier

Nine hard invariants cover the whole public API surface, read from the ACLs: `public_views_total` (86),
`public_views_non_security_invoker`, `public_views_anon_beyond_select`, `public_views_authenticated_beyond_select`,
`public_tables_total` (42), `public_tables_without_rls`, `public_tables_api_beyond_select`,
`public_api_write_policies` and `public_role_relation_grants` (all 0). Against live before 025 they report 75/77,
failing exactly the two view checks at 43 each.

Commands: `npm run verify:db` is always the local canonical chain (`--local` ignores every database URL);
`npm run verify:db:live` loads `.env.local` and requires a URL (`--live` never falls back to local).

## Other observations (not changed)

- `rls_auto_enable` is a Supabase-managed `SECURITY DEFINER` event-trigger function in `public` that anon can
  EXECUTE; event-trigger functions cannot be invoked directly, so it is not callable through the API.
- `set_updated_at` (a trigger function) is executable by anon; trigger functions cannot be invoked directly either.
