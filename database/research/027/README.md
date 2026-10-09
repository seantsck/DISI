# Research behind migration 027

Migration 027 is a **forward, guarded, data-only** correction that makes a fresh `001 → 027` replay and live represent the
same canonical facts for the committed Migration-002 supplementary seed. Migrations 001-026 are not edited.
The trainer / academy / signing-network work moved to Migration 028.

| File | Purpose |
| --- | --- |
| `drift-audit.md` | What differed between live and a fresh replay, the target per category, and what was deliberately left alone |
| `reconciliation-manifest.json` | Machine-readable drift manifest: for every affected fact the stable selector, canonical value, live value, intended value, reason, source migration and affected views |
| `audit.mjs` → `audit-report.json` | Offline check that every canonical value in the manifest equals a fresh 001 → 026 replay, plus the fact that nothing in 017-026 reads the repaired objects |
| `027_template.sql` + `build.mjs` | Hand-written guarded steps and the build that embeds the manifest payload → `database/sql/027_canonical_seed_drift_reconciliation.sql` |
| `test-027.mjs` | Local harness: applies 027 twice over a 001-026 replay |
| `research-backlog.md` | Unverified trainer / academy candidates carried to 028 (not stored) |

```
node database/research/027/audit.mjs && node database/research/027/build.mjs
```

The manifest was derived once from a read-only comparison of live and the replay (2026-10-08) and is a reviewed input,
like `026/seed-evidence.json`. Selectors are stable keys only (player slug, organization name, signing year, source URL);
sequence-generated ids are never used.

## The migration

One transaction; every step accepts exactly two states and aborts on any third:

1. **Sources:** inserts the 12 missing; for the 3 metadata variants, accepts the canonical form or the exact known live
   variant (and normalises the latter).
2. **Signing environments:** inserts the 8 missing (or confirms the committed content).
3. **Signing links:** a signing must already be linked to its expected environment, or have a NULL link with every
   guarded field (date, market, pathway, bonus, publicly reported flag, rank, rank source, record scope) equal to the manifest.
4. **Transaction:** inserts Lantigua → Cincinnati unless it already exists in canonical form; a conflicting or duplicated row aborts.
5. **Aliases:** inserts the two committed aliases; nothing else.
6. **Evidence:** claim identity is (signing, field, source URL). Absent → inserted; canonical → untouched; exact known live
   variant → updated in place; anything else (including a duplicate) → abort. No evidence row is ever deleted. Three claims
   (Morales 2024, Melburne 2026, Arias 2026) are restored with a **neutral note** instead of the committed seed wording, which
   asserted unverified trainer relationships; a replay holding the original note is corrected in place.
7. **Legacy trainers:** removes the exact 2 trainers / 4 links (replay) or nothing (live, already empty); anything else aborts.
   The legacy tables and views remain until 028.

Postconditions assert every canonical fact is present exactly once, in canonical form.

## Verifier

`scripts/db/lib/seed-reconciliation.mjs` adds eleven hard checks (presence / integrity of the manifest facts, never global
totals, so legitimate growth of sources or evidence cannot fail them): environments, signing links, no affected signing
without an environment, the trade, aliases, sources, evidence claims, variant coexistence, and `trainers` / `player_trainers`
both empty until 028 retires them, plus `reconciliation_trainer_note_violations` (the three original trainer-asserting notes never come back). The verifier is now 112 checks.

## Target rule

Migration-002 canonical values are retained **except for** (1) the unsupported 2-trainer / 4-link seed, which is removed, and (2) the three
trainer-asserting evidence-note strings, which are intentionally neutralised. Both are forward semantic corrections, not unexplained drift;
live-drift and canonical-replay states converge to this corrected target.

## Not reconciled, and why

`initcap()` capitalisation, float formatting and retrieval timestamps differ between engines but do not change canonical meaning.
Do not use `initcap()` or other locale- or engine-sensitive functions in new migration logic.

## Limitations

- Restored evidence receives a `created_at` slightly before the signing's other evidence so the public timeline shows the same
  source as a fresh replay; `created_at` carries no canonical meaning.
- Restored sources get `accessed_at = migration time`.
