# DISI research commands (046, 047, 048, 049, 051)

Read-only commands that tell a researcher what to work on next. They connect as the public `anon` role in a read-only session, so they can
only see what the website can see (the persisted `product_*` snapshots and the public views). They never write. Their output has no
timestamps and a fixed order, so the same data always prints the same bytes.

```
DISI_RESEARCH_DB_URL=... npm run research:queue
npm run research:outcomes     -- --mature --status not_audited [--year 2021] [--market Venezuela] [--limit 20] [--format text|json|csv]
npm run research:outcomes     -- --evaluate research-output/046/player-outcomes.json    # audit conclusions for a scripts/mlb artifact
npm run research:costs        -- --missing [--mature] [--mlb yes|no] [--year 2018] [--market Venezuela] [--limit 25]
npm run research:transactions -- --missing | --traded | --unresolved-attribution
npm run research:transactions -- --chains [--value-blocked]            # 049: chains whose TRANSACTION history is open (or, with --value-blocked, recorded chains whose value is unavailable)
npm run research:transactions -- --packages [--membership | --terms]    # 049: trade packages with an open issue, and the evidence that would close each
npm run research:transactions -- --ptbnl | --future-consideration | --cash-unknown | --value-blocked    # 049: one issue family, item by item
npm run research:transactions -- --bucket CHAIN_OR_MEMBERSHIP | TERMS | VALUE | OTHER                  # 049: by what kind of evidence is missing
npm run research:development  -- --missing [--mature] [--mlb yes|no] [--year 2018] [--market Venezuela] [--player slug] [--limit 25]
npm run research:development  -- --coverage        # per-dimension coverage with denominators
npm run research:development  -- --timing          # descriptive signing-to-MLB and highest-level facts (no rates, no scores)
npm run research:development  -- --mlb-coverage    # 048: the verified MLB cohort's documented path, player by player, with denominators
npm run research:development  -- --needs           # 048: the queue de-duplicated by the evidence gap each item names
npm run research:development  -- --review [--player kenley-jansen]   # 048: the reviewer's packet for pending progression decisions (decides nothing)
npm run research:development  -- --no-mlb-coverage  # 051: the audited no-MLB cohort's documented path, Dodgers-affiliate part and later career apart
npm run research:readiness
npm run research:progress     -- --baseline database/research/046/baseline.json
```

| Option | Meaning |
|---|---|
| `DISI_RESEARCH_DB_URL` (or `DISI_VERIFY_DB_URL`) | the database; never printed. A read-only transaction that switches to `anon` |
| `--input dataset.json` | read a saved dataset instead of connecting |
| `--save dataset.json` | with a database connection, save the raw query results (aggregates and public rows only) |
| `--format` | `text` (default), `json`, `csv` |

`NOT_AUDITED` is shown as itself and never as a no-MLB result; an unknown cost is shown as `UNKNOWN`, never `0`.
The logic lives in `lib/research/` (pure functions, unit-tested in `tests/unit/research-046.test.mjs` and `tests/unit/research-047.test.mjs`).
The MLB Stats API research scripts that gather evidence for an audit are in `scripts/mlb/`.

## research:development (047)

Lists every signing with at least one `UNKNOWN` development dimension, in the documented tier order (see `docs/RESEARCH-METHODOLOGY.md`), with
the missing fields as stable codes (`SIGNING_DATE_MISSING`, `FIRST_PRO_SEASON_UNKNOWN`, `HIGHEST_LEVEL_UNKNOWN`, `MLB_DEBUT_UNKNOWN`,
`EXIT_TRANSACTION_MISSING`, `CHRONOLOGY_INCOMPLETE`), the current highest level, MLB debut, exit status and source count. `UNKNOWN DEVELOPMENT
HISTORY` is never shown as "no development". Read-only; `--input` reads a saved dataset. `research:readiness` additionally lists the
development / transaction evidence gaps, labelled as supporting evidence and not gates.

## research:readiness, 050

The player-probability layer is supported only by the Dodgers tracked / opening-class population, the only population probabilities are made
for. A baseline supported only in the rank-selected benchmark sample is printed as a fact (`BENCHMARK_REFERENCE_BASELINE_SUPPORTED`) and never
makes the layer supported; the layer's blockers are the Dodgers population's. `BENCHMARK SUPPORT != DODGERS SUPPORT`.

## research:development, 048 modes

| Flag | Reads | Prints |
|---|---|---|
| `--mlb-coverage` | the base dataset plus the per-stint history (`--history` is implied) | for the verified MLB players: any pre-MLB history, usable affiliate chronology, exact signing date, exact debut date, both dates for signing-to-MLB, verified first professional season, prior professional career, pending reviews, each with its denominator; then one row per player with the documented-path state, where the record is silent (`SOURCE_UNAVAILABLE`, `SOURCE_BEGINS_LATE`, `NO_EVIDENCE_FOUND`, `ORGANIZATION_UNCLEAR`, `LEVEL_UNCLEAR`) and the notes (`PRIOR_PROFESSIONAL_CAREER`, `LEAGUE_SEASON_NOT_PLAYED`) |
| `--needs` | the base dataset | the development queue merged by evidence gap (`SOURCE_CONFLICT`, `SEQUENCE_REVIEW`, `SEASON_COVERAGE`, `LEVEL_CLASSIFICATION`, `ORGANIZATION`, `GAME_DATES`), with the detector rows each need merges |
| `--review [--player slug]` | the base dataset plus stints, the progression view and the decisions table | for every player with a `PENDING_REVIEW` decision: the pending rows and notes, the source stints in chronological order, the first appearance at each level, the levels that run backward, the competing readings with the decision each would produce, and the evidence that would settle it |

`--review` never writes and never decides: a pending row is reported exactly as stored, and `--format json` carries `decided: false` on every packet.
A decision is a reviewed migration (Migration 024's roles: `EARLY_CAMEO`, `POST_ESTABLISHMENT_APPEARANCE`, `DEVELOPMENTAL_ARRIVAL`). `--save` with
`--mlb-coverage` or `--review` keeps the history rows, so a saved dataset can be reviewed offline (`--input`).

The 048 research is rebuilt with `node database/research/048/derive-development.mjs <dir>`, `derive-reviews.mjs <dir>` and `build.mjs` (see
`database/research/048/README.md`).

## research:transactions, 049 modes

`KNOWN TRANSACTION != KNOWN RETURN VALUE`: every item carries a blocker **bucket** and the **next evidence** that would close it.

| Bucket | Means | Issues |
|---|---|---|
| `CHAIN_OR_MEMBERSHIP` | DISI does not know what happened to the asset or who was in the package | `TRADE_RETURN_UNRECORDED`, `PTBNL_UNRESOLVED`, `FUTURE_CONSIDERATIONS_UNRESOLVED`, a returned asset's missing exit, `DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION` |
| `TERMS` | the players are known; an amount is not | `CASH_AMOUNT_UNKNOWN`, `POOL_SPACE_AMOUNT_UNKNOWN` |
| `VALUE` | the transaction is known; the value of the return, or its attribution, is not | `DOWNSTREAM_WAR_NOT_LOADED`, `OUTCOME_INCOMPLETE`, `TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED` |
| `OTHER` | acquisition cost and documented boundaries | `ACQUISITION_COST_INCOMPLETE`, `LINEAGE_BOUNDARY_NOTED` |

`--chains` splits the incomplete chains: by default the ones whose transaction history is open; with `--value-blocked` the ones recorded to their end whose
returned players' Baseball-Reference WAR is not loaded (`INCOMPLETE_WAR_NOT_LOADED`, `INCOMPLETE_TIMING`). `--packages` counts a package once and says whether
its membership or only its terms are open (the two overlap and are never added). The summary line reports `incomplete_chains` (every `INCOMPLETE_*` chain, as the
database names them), `transaction_chains_incomplete`, `value_blocked_chains`, the attribution-state counts and the package counts. All modes are read-only.
The logic is `lib/research/transaction-research.js`, tested in `tests/unit/research-049.test.mjs`.

## research:development --no-mlb-coverage (051)

For the audited no-MLB cohort (derived: `outcome_audit_status = 'VERIFIED_NO_MLB'`), one row per player: signing year, route, first observed season,
first professional season status (the 048 rule), highest recorded level for the whole career and at a Dodgers affiliate, last observed affiliated
season and organization, chronology, exact-date coverage (`dated/log-era stints`), where the record is silent, and the open evidence gaps; then
the counts, each with its denominator. Reads the stint history (`--history` is implied). No score, no ranking, no rate: `AUDITED NO MLB != CAREER
FAILURE`, `LAST OBSERVED SEASON != CAREER END`, and a later season with another organization is never Dodgers development.
