# Research behind 051: audited no-MLB development coverage

051 asked whether the 46 Dodgers international signings whose outcome audit is `VERIFIED_NO_MLB` have the same documented development record
as the verified MLB players received in 047 and 048. It checked every recorded fact against the official source. **The official sources hold no
fact for this cohort that DISI lacks, and nothing on record disagrees with them.** So 051 writes no canonical row, and there is no migration 051
and no rollback. What 051 adds is read-only: these artifacts, the audited no-MLB coverage measures, the `--no-mlb-coverage` research mode, the
`/development` section and dossier wording, and one verifier check.

```
node scripts/mlb/player-seasons.mjs        --input players.json --out <dir>          # official season splits (cached, one request every 750 ms)
node scripts/mlb/development-milestones.mjs --input players.json --out <dir>          # first-appearance milestone candidates
node scripts/mlb/player-game-logs.mjs      --input players.json --seasons <dir>/player-seasons.json --out <dir> --min-season 2006
node scripts/mlb/development-exact-dates.mjs --seasons ... --milestones ... --game-logs ... --out <dir>
npm run research:development -- --no-mlb-coverage --save <dataset.json>               # the canonical state, read-only as the anon role
node database/research/051/derive.mjs <dir> <dataset.json>                            # writes the JSON artifacts below (deterministic)
```

`players.json` is derived from the dataset: every Dodgers signing with `outcome_audit_status = 'VERIFIED_NO_MLB'`, with its MLB person id.

| File | Purpose |
|---|---|
| `baseline.json` | the pre-051 state read from production (generation 8, after 050): outcome counts, the cohort's rows, coverage and needs |
| `cohort.json` | the 46 players, derived; per player: route, history state, first observed and first professional season, highest recorded level (whole career and at a Dodgers affiliate), last observed affiliated season, chronology, exact-date coverage, gaps, open detectors and needs |
| `development-records.json` | the fact-for-fact comparison of the official source with what is on record, per player, plus the two-organization seasons checked against the recorded exit |
| `coverage-before-after.json` / `needs-before-after.json` | the measures before and after 051 (identical: no row was written) |
| `progression-review.json` | the 048 inversion rule over the cohort and the 024 decisions that already cover each inversion |
| `source-manifest.json` | the endpoints read, how many URLs the rows cite, and what was not used |
| `architecture.md` / `research-notes.md` | the gap analysis and the findings |

## Result

| Comparison (46 players) | Result |
|---|---|
| Stints in the official season splits / on record | 306 / 306, every one matched (season, team, league, level); 0 differ in games |
| Stints on record the source no longer carries | 0 |
| Game logs | 205 requests, 8,158 dated appearances, 0 errors |
| Stint first/last dates matched / fillable / conflicting | 278 / 0 / 0 (the other 3 log-era stints are Lenix Osuna's 2018 Mexican League seasons: the game log returns no games, so the dates stay unknown) |
| Game-log-dated milestones matched / new / upgradable / conflicting | 182 / 0 / 0 / 0 |
| Season-splits milestone candidates not on record | 0 |
| Organizations to resolve | 0 (every affiliated team stint has its organization) |
| New progression reviews | 0 (every inversion is covered by a 024 decision; Carlos Ávila's three stay pending for a person) |
| Outcome contradictions (an MLB stint or debut for a no-MLB player) | 0 |

## What the measures show (descriptive; not a success or failure rate)

- Any development history: **44 of 46**. Damaso Marte Jr. (2015) and Sebastián Jiménez (2021) have MLB person ids, and the official source returns
  no structured season for either; their highest level stays **unknown**.
- Highest recorded level, **whole recorded career** (the published figure): International Rookie 10, Complex 6, Low-A 7, High-A 8, AA 4, AAA 9.
- Highest level recorded **at a Dodgers affiliate**: International Rookie 11, Complex 8, Low-A 8, High-A 8, AA 4, AAA 5. Seven players first
  reached their whole-career highest level with another organization (Julian León, Hendrik Clementina, Carlos Rincón, Ronny Brito, Alex De Jesús,
  Elio Campos, Rayne Doncon). That later play is career context and is never Dodgers development.
- First professional season (the 048 rule, unchanged): known 39, first observed only 5, no affiliated record 2. Four of the five are 2019 signings
  first observed in 2021, with only the cancelled 2020 season between; the rule leaves them `FIRST_OBSERVED_ONLY` (see research-notes.md).
- Usable chronology (DISI's dimension): **27 of 46**. Documented path with no gap visible at season precision: **30 of 46** (never "complete").
- Exact dates: **278 of 281** log-era team stints dated from game logs.
- Development needs for the cohort: 28 detector rows, **27** distinct evidence gaps across 19 players: season coverage 13 (eleven of them name
  only 2020, the cancelled season; two are the players with no record), level classification 9 (Pioneer League rookie-advanced seasons the ladder
  has no place for), organization 4 (two-organization seasons; three bracket a recorded Dodgers trade exactly, the fourth is after the player
  left), game dates 1 (Osuna's Mexican League seasons).

No outcome audit, MLB debut, WAR row, transaction, cost, benchmark fact, threshold, support count, evaluation fingerprint
(`af9ec05feb3ee1518cb7608193cd209a`), probability, expected value or recommendation moved, because nothing was written.
