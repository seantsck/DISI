# Research behind 054: full-career transaction history

053 proved that DISI's transaction ledger is a Dodgers asset ledger and left 16 development needs waiting on moves between two other clubs. 054
gives those moves their own canonical home, `player_career_transactions`, without touching the ledger, and lets development chronology read them.

```
npm run research:development -- --needs --history --save <before.json>             # the canonical state, read-only as the anon role
node scripts/mlb/player-transactions.mjs --input players.json --out <dir>           # the official transaction log of each player
node scripts/mlb/team-seasons.mjs --input team-pairs.json --out <dir>              # the parent organization of each team a log row names, per season
#   <dir>/tran.txt               https://www.retrosheet.org/transactions/tranDB.zip  (the file 049 and 053 read; identical sha256)
#   <dir>/register/people-*.csv  https://github.com/chadwickbureau/register (data/)
node database/research/054/derive.mjs <dir> <before.json>                           # workset, transitions, evidence, classification, migration-values.json
node database/research/054/build.mjs                                                # the migration and its rollback
node database/research/053/canonical-dataset.mjs <after.json>                       # the canonical chain with 054 applied, read the same way
node database/research/054/derive.mjs <dir> <before.json> <after.json>              # adds development-before-after.json
npm run research:development -- --chronology --open                                 # every open two-organization season and its layer
```

| File | Purpose |
|---|---|
| `baseline.json` | the pre-054 state read from production (generation 9), the 053 classes, and the one need the 054 rule alone reclassifies |
| `workset.json` | the 16 transaction-blocked needs, every open season of each, checked for Dodgers involvement |
| `transition-workset.json` | the 33 transitions: clubs, last and first appearances, mechanism, the source rows, whether both clubs are named |
| `career-transaction-evidence.json` | every row read, exactly (official log rows with their description, Retrosheet rows raw), and the reviewed club and type maps |
| `career-transaction-classification.json` | one class per transition before any write: DIRECT, RELEASE_THEN_SIGNING, CHAIN, SEVERAL |
| `migration-values.json` | the 46 career moves and the two sources they need |
| `development-before-after.json` | needs, classes and season states before and after, need by need, with the rows that close each |
| `source-manifest.json` | what was read, what was added, what was reused, what was not used |
| `multi-org-detector.sql` | the 054 MULTI_ORG_SEASON_UNVERIFIED condition, spliced into the 053 view text by `build.mjs` |
| `architecture.md` / `research-notes.md` | why a separate layer, how the two relate, and the findings |

## Result

- **46 career moves** (21 trades, 2 waiver claims, 1 purchase, 11 releases, 11 free-agent signings) for 33 transitions; official log for the
  seasons it covers, Retrosheet for the rest. Two sources added (Santana's and Park's official logs); every other row reuses a source DISI holds.
- **Transaction-blocked 16 -> 0.** Development needs **108 -> 104** (detector rows 132 -> 128; players 65 -> 62): Santana, Cartaya, Leonard and
  Puig close; 11 needs become source-limited (the moves predate dated game logs); Castro goes to a person (overlapping appearance ranges).
- **The Dodgers asset ledger is byte-identical**: 223 events, 410 assets, 7 resolutions, every package, control interval and observation; the
  transaction queue (58) and the value queue (93) do not move. No WAR, cost, outcome, development, feature or probability row changes.
- One table, one view, one product-contract row (47 -> 48 relations): one snapshot refresh, only the executive snapshot's content changes.
