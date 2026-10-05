# DISI — Dodgers International Signings Research Database

A public-data research database of Brooklyn and Los Angeles Dodgers international signings: signing classes, acquisition costs, player development, MLB outcomes, transactions and organizational value. Built with the Next.js App Router on a Supabase (Postgres) database.

The application contains **no mock, sample or fallback baseball data**. If Supabase is not configured, a view is missing or a query fails, each page shows an explicit data-unavailable state.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Database status, recent signing records, section index, selected research findings |
| `/signings` | Sortable, filterable, paginated table of every signing record; state lives in the URL |
| `/players` | Player directory with A–Z browsing and filters |
| `/players/[slug]` | Player dossier: biography, acquisition, MLB outcome, bWAR provenance, timeline, transactions, sources |
| `/markets` | Signings, known cost and audited outcomes by country / market and acquisition pathway |
| `/development` | Signing-to-MLB timing where both dates are recorded |
| `/asset-conversion` | Trades and releases with package-level return attribution and competitive context |
| `/league` | Cross-organization signing volume, bonus pools and MLB Pipeline prospect samples |
| `/research` | Class coverage, expected-size source support, research queue and source priority |
| `/methodology` | bWAR definition, data-quality rules, source priority, lineage |
| `/api/player-search?q=` | JSON player search used by the header search box |

### Research table behaviour

- Sorting and filtering run in Postgres through PostgREST, so dates sort as dates, money and bWAR as numbers, and NULLs always sort last instead of becoming zero. Enum codes are exposed as text so they sort alphabetically.
- Default order: signing year descending, then player name ascending (accent-insensitive).
- URL parameters: `q`, `org_scope` (`dodgers` default, `all`), `year`, `year_min`, `year_max`, `market` (`__none` = unknown), `position`, `pathway`, `audit`, `mlb` (`yes` / `no` / `unknown`), `dodgers_debut`, `record_scope`, `coverage`, `org`, `sort`, `dir`, `page`.
- Table specifications live in `lib/specs.js`; URL parsing, validation and query construction live in `lib/table-state.js`. Adding a column means adding one spec entry and one cell.

## Signing populations

**An announcement total is not necessarily the full signing-period total.** A club's international-class release usually describes the players announced when the signing period opens; the club keeps signing players for the rest of the period. DISI therefore records which population a count describes:

| Population | Meaning | Can be a rate denominator? |
| --- | --- | --- |
| Signing class | The class year a signing is counted in (`signings.signing_year`). | — |
| Announced opening class (`OPENING_CLASS`) | Players named or counted in the club's opening announcement. | No. Statistics are labelled *opening-class cohort rates*. |
| Full signing period (`FULL_SIGNING_PERIOD`) | Every international signing in the period (e.g. Jan 15 – Dec 15). | Yes, once complete, fully audited and five years mature. |
| Top-prospect sample (`TOP_PROSPECT_SAMPLE`) | MLB Pipeline Top 30/50 trackers. | No. |
| Historical verified set (`HISTORICAL_VERIFIED_SET`) | Individually verified historical signings. | No. |
| Other defined population (`OTHER_DEFINED_POPULATION`) | E.g. a calendar-year count that spans two periods. | No. |

A player can be announced in a class while the formal MLB transaction is dated later (Eduardo Rojas: announced January 2024, transaction May 30, 2024), so `announced_date` and `formal_transaction_date` are separate fields and `signing_date` is never rewritten.

## Data rules

- Missing is never zero. Unaudited is never failure. Unknown acquisition cost is never `$0`.
- A historical verified sample is not a census. MLB Pipeline Top 30/50 lists are prospect samples.
- A population is **complete** only when a source states its size, every member is in the database, and no source conflict is open. A complete announced opening class is not a complete signing period.
- Signing bonus, posting fee and transfer fee are separate. Multi-player trade returns are shown at package level.
- Brooklyn and Los Angeles share franchise key `DODGERS`; historical organization names are preserved.
- An outcome audit of "no MLB debut" needs evidence (enforced in the database) and says *how*: no longer in affiliated baseball, still active in the minors, or status unknown. Developing players get a progress record, not an outcome.
- Career value is **bWAR** (Baseball-Reference WAR), stored with its source, observation date and through-season. FanGraphs fWAR, if added, is stored separately and never blended or substituted.

## Setup

1. Copy `.env.example` to `.env.local` and set the Supabase Project URL and **publishable key**.
2. Apply the SQL in `database/sql/` in manifest order in the Supabase SQL Editor (for an existing v0.9 project, run `019_mature_outcome_audit_expansion.sql`).
3. `npm install`
4. `npm run dev`

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Never put a Supabase secret key or legacy service-role key in a `NEXT_PUBLIC_` variable. The browser and server only read through the publishable key; all tables use row-level security with a select-only public policy, and all views are `security_invoker`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run lint` | ESLint (flat config, `eslint-config-next/core-web-vitals`) |
| `npm run typecheck` | `tsc` with `checkJs` over `app/`, `lib/` and `tests/` |
| `npm test` | Unit tests plus the database test, which runs every canonical migration in PGlite (in-process Postgres), reruns the latest migration, and checks class totals, population and rate-eligibility rules, provenance and the security model |
| `npm run research:test` | Offline tests for the research scripts (also included in `npm test`) |
| `npm run build` | Production build |
| `npm run check` | All of the above |

## Database lineage

- `database/sql/` — canonical build sequence 001–019 (listed in `database/manifest.json`).
- `database/research/` — reviewed research artifacts and builders behind data migrations (019 onward).
- `scripts/mlb/` — reproducible MLB Stats API / Baseball-Reference research scripts (see `scripts/mlb/README.md`). They output review artifacts and never write to a database.
- `database/repairs/` — the 004a–004c troubleshooting scripts from the first manual Supabase build.
- `database/README.md` — what each layer does.
- `docs/INGESTION.md` — source priority and the workflow for adding classes, players, outcomes and bWAR.

The SQL was applied manually in the Supabase SQL Editor and is kept as analytical provenance. Do not treat it as Supabase CLI migration history without creating a clean baseline first.

See `CHANGELOG.md` for release history.
