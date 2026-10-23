# Research behind 052: development taxonomy and chronology resolution

051 showed the audited no-MLB cohort already matched the official record fact for fact. 052 turned to what remained open across all 220 Dodgers
signings: 173 distinct development needs (347 detector rows, 85 players). It asked, for each, whether a fact is missing, the taxonomy cannot
place it, no approved source holds it, a person must decide, or the detector reads a known condition as missing evidence. Only the needs the
evidence closes are closed. Migration 052 writes those facts and corrects two detector conditions; everything else is classified, not reduced.

```
npm run research:development -- --needs --history --save <before.json>                 # the canonical state, read-only as the anon role
node scripts/mlb/team-seasons.mjs   --input pairs.json --out <dir>                       # every (team id, season) a team stint is recorded for
node scripts/mlb/league-seasons.mjs --input league-seasons-input.json --out <dir>        # 2019-2021 schedules by level; the Pioneer League by season
node scripts/mlb/player-seasons.mjs --input players.json --out <dir>                     # the players with an undated log-era stint
node scripts/mlb/development-milestones.mjs --input players.json --out <dir>
node scripts/mlb/player-game-logs.mjs --input players.json --seasons <dir>/player-seasons.json --out <dir> --min-season 2006
node scripts/mlb/development-exact-dates.mjs --seasons ... --milestones ... --game-logs ... --out <dir>
node database/research/052/derive.mjs <dir> <before.json> [<after.json>]                # the artifacts below and migration-values.json
node database/research/052/build.mjs                                                     # the migration and its rollback, from migration-values.json
npm run research:development -- --causes                                                 # every open need with its class, cause and closing evidence
```

All endpoints are the official MLB Stats API (cached, one request every 750 ms): 775 team-season records, 44 league-season records, 195 person and
season-split requests and 539 game logs (24,708 dated appearances), 0 errors. `after.json` is the same read of the canonical chain with 052 applied.

| File | Purpose |
|---|---|
| `baseline.json` | the pre-052 state read from production: development counts, detector rows by issue, needs by group |
| `gap-classification.json` | every need before and after, with its class (FACT_MISSING, TAXONOMY_GAP, SOURCE_LIMITED, HUMAN_REVIEW, TRANSACTION_BLOCKED, IDENTITY_BLOCKED, NOT_A_GAP) |
| `unclassified-levels.json` | every stint the ladder cannot place, with the official sport per team-season and the Pioneer League's sport per season |
| `affiliate-organization-research.json` | every team stint against the official team-season record: matches, resolutions, corrections, the one with no MLB parent |
| `multi-organization-seasons.json` | every two-organization season before and after, each read against the canonical transactions |
| `game-date-research.json` | requests, responses, dated stints, upgrades, professional debuts dated and not dated (with the reason), what stays undated |
| `season-gaps-2020.json` | the official 2019-2021 schedules by level and every season-gap player, with the cause of each missing season |
| `sequence-review.json` | the reviewer's packet: every pending decision and candidate with its dated facts (052 decides none) |
| `needs-before-after.json` | detector rows, needs and players before and after, by category, with the reason for every resolved need |
| `highest-level-before-after.json` | both highest-level questions before and after, and exactly which players change and why |
| `migration-values.json` | the reviewed values the migration writes (organizations with evidence, dates, upgrades, debuts, reviews, era map, sources) |
| `source-manifest.json` | the endpoints read, how many URLs the rows cite, and what was not used |
| `architecture.md` / `research-notes.md` | the gap analysis and the findings |

## Result

| | Before | After | Why |
|---|---|---|---|
| Detector rows / distinct needs / players | 347 / 173 / 85 | 134 / 110 / 66 | every reduction below |
| Organization (needs) | 51 | 20 | 319 stints resolved and 3 corrected from the official team-season record; 12 players' every two-organization season is bracketed by a canonical transaction and game dates. Resolving revealed 10 more two-organization players; those stay open where no transaction explains the move |
| Game dates | 45 | 29 | 528 stints dated and 101 level debuts made exact from the official gameLog. What remains is before 2006 or foreign professional play (source-limited) |
| Season coverage | 46 | 30 | 16 players' only missing season was 2020, which no affiliated minor league played (the official schedule holds no game). The other 20 have seasons the official source does not return |
| Level classification | 26 | 26 | the Pioneer League: taxonomy-limited, documented, not forced |
| Sequence review | 5 | 5 | heuristic cameo candidates: a person decides |

After 052 no need is FACT_MISSING: 61 are source-limited, 26 taxonomy-limited, 18 transaction-blocked, 5 human review.

No outcome audit, MLB debut, WAR row, transaction, cost, benchmark fact, threshold, support count, evaluation fingerprint
(`af9ec05feb3ee1518cb7608193cd209a`), probability, expected value or recommendation moved, and no persisted snapshot reads a changed row (drift 0,
generation unchanged).
