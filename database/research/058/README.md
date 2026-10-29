# 058 — transaction-return bWAR evidence

Baseball-Reference team-season bWAR for the four returned players of existing Dodgers trades whose value was unknown only because their WAR was
not loaded: Jon Garland, Jim Leyritz, Mudcat Grant and Zoilo Versalles. The rows come from the two archived captures 057 registered; no source row
is added. This is evidence recovery. The existing interval-bounded value rules decide every value, and no attribution rule moves.

## Files

| File | What it is |
|---|---|
| `scope.json` | The four players, their trades, exits, originating signings, attribution levels and credited rows; the one excluded row (Versalles 1969 WSA) with its reason; the four other WAR-not-loaded assets left out; the reviewed effect. |
| `team-code-map.json` | `bref_team_code_map` as seeded by 032 / 033 (40 codes, no WSA), the map every loaded row must resolve under. |
| `derive-war.mjs` | Builds `war-evidence.json` from the verified 057 captures (`../057/fetch-sources.mjs` checks every recorded hash before a row is read): each player's complete mapped career, the excluded row listed, the credited sums proved. |
| `war-evidence.json` | The 91 rows (positional, as in 035 / 057), per-player summaries and the excluded row. |
| `measure.mjs` | The 057 measurement plus the four players' rows, lineage, intervals and edges, the three originating signings, value and executive totals, both queues and the prediction fingerprints. With `--baseline` it writes `baseline.json`. |
| `baseline.json` | The pre-058 state on the canonical replay (001-057), which the migration proves before it writes. |
| `baseline-production.json` | The same measurement, read-only, on production before 058. Every logical value equals `baseline.json`; only surrogate-row hashes, the function count of the catalog query and the snapshot generation (13, against 12 on a replay) differ. |
| `058_template.sql`, `rollback_template.sql`, `build.mjs` | The migration, the rollback and their deterministic assembly. The build derives every expected post-058 value from the baseline and the credited rows and refuses any other movement. |
| `report.mjs` | Applies 058 to a replay and writes `value-before-after.json`. |
| `research-notes.md` | Decisions and findings. |

## Commands

```
node database/research/057/fetch-sources.mjs                    # verify the local raw captures (research-output/057-work/raw/, gitignored)
node database/research/058/derive-war.mjs
node database/research/058/measure.mjs --chain 057_benchmark_bwar_evidence.sql --baseline > /dev/null
node database/research/058/build.mjs
node database/research/058/report.mjs
```

`report.mjs` and `measure.mjs` accept `--dump <post-057 PGlite tar>` to skip the two-minute chain build.

## Result

- **Rows:** 91 (Garland 28, Leyritz 15, Grant 36, Versalles 12), every team mapped, no TOT, no WSA, observed through 2025; `player_id` NULL.
- **Values (interval-bounded, unchanged rules):** Garland +0.17 (Abreu's sole return), Leyritz −0.61 (shared package), Grant +1.39 and Versalles
  −1.12 (Fernandez chain, observable only).
- **Totals:** realized organizational bWAR 297.60 → 299.00; resolved signings 87 → 88; realized / incomplete / unresolved 80 / 7 / 1 → 83 / 5 / 0;
  executive direct 282.77 → 284.00, attributable trade 14.83 → 15.00.
- **Queues:** transaction 58 → 57, value 93 → 90; `BWAR_MISSING` stays 50.
- **Unchanged:** the prediction layer (byte-identical), sources (3384), players (398), schema. Verifier 259; the unavailable-WAR pins move to
  `EXPECTATIONS_THROUGH_057`. One snapshot refresh.
