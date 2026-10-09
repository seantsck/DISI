# Research behind migration 019

Everything needed to inspect and rebuild `database/sql/019_mature_outcome_audit_expansion.sql`.

| File | What it is |
| --- | --- |
| `artifacts/queue-players.json` | Input: the 162 unaudited Dodgers signings (as of migration 018) with resolved MLB ids |
| `artifacts/resolve-ids.*` | MLB id proposals: 57 Dodgers transaction matches, 2 name-search-only (Cedeño, Frías), 1 not found (Jerami Rodriguez, resolved manually as the MLB spelling "Jeremi") |
| `identity-decisions.json` | The three manual identity decisions (Cedeño, Frías, Jerami/Jeremi Rodriguez) and why |
| `artifacts/player-outcomes.*` | Outcome research for the 162 players, with sources and retrieval times |
| `artifacts/legacy-*` | The same research for the 13 pre-019 "no MLB" audits (structured progress only) |
| `artifacts/bref-war.*` | Career bWAR for the two new MLB players from Baseball-Reference's WAR files |
| `values.sql`, `values-decisions.json` | Output of `outcome-sql-values.mjs`: VALUES blocks and the per-player audit decision |
| `019_template.sql`, `views.sql`, `build.mjs` | Migration template, views and the builder |

All data were retrieved 2026-10-05 (see each record's `sources`).

## Rebuild

```bash
# 1. research (uses the cache in .cache/mlb when present)
node scripts/mlb/resolve-ids.mjs --input research-output/unaudited-queue.json --out research-output/019
node scripts/mlb/player-outcomes.mjs --input database/research/019/artifacts/queue-players.json --audit-date 2026-10-05 --out research-output/019
node scripts/mlb/player-outcomes.mjs --input database/research/019/artifacts/legacy-players.json --audit-date 2026-10-05 --out research-output/019-legacy
node scripts/mlb/bref-war.mjs --input database/research/019/artifacts/mlb-players.json --out research-output/019

# 2. review the artifacts, then generate the values
node scripts/mlb/outcome-sql-values.mjs \
  --outcomes research-output/019/player-outcomes.json,research-output/019-legacy/player-outcomes.json \
  --bwar research-output/019/bref-war.json \
  --identity database/research/019/identity-decisions.json \
  --legacy-slugs database/research/019/artifacts/legacy-slugs.json \
  --audit-date 2026-10-05 --out database/research/019/values.sql

# 3. assemble the migration
node database/research/019/build.mjs
```

Live MLB / Baseball-Reference data change over time (active careers, WAR updates), so a fresh run on a later date produces different artifacts; with the original cache the rebuild is byte-identical.
