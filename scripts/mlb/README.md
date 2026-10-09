# MLB research scripts

Reproducible research tooling for DISI. The scripts **gather, normalize, compare and propose**; they never write to Supabase or any database. Their output is a set of review artifacts (JSON + CSV) that a person checks before anything becomes a SQL migration.

## Sources and endpoints

| Source | Default endpoint (override with env) | Used for |
| --- | --- | --- |
| MLB Stats API | `https://statsapi.mlb.com/api/v1` (`MLB_STATS_API_BASE`) | identity, transactions, MLB / MiLB season records, debut date |
| Baseball-Reference WAR data | `https://www.baseball-reference.com/data` (`BREF_DATA_BASE`) | career bWAR (`war_daily_bat.txt` + `war_daily_pitch.txt`) |

No credentials are used. `export-queue.mjs` optionally *reads* a DISI view with the public **publishable** key and refuses secret / service-role keys.

## Behaviour

- **Polite pacing**: at most one live request every `DISI_RESEARCH_INTERVAL_MS` (default 750 ms).
- **Retries**: 429, 5xx and network errors retry with exponential backoff (`DISI_RESEARCH_RETRIES`, default 3). 4xx errors fail fast.
- **Cache**: every response is cached in `DISI_RESEARCH_CACHE` (default `.cache/mlb`, git-ignored) with the exact URL and retrieval time. `--offline` reruns only from cache; `--no-cache` bypasses it.
- **Provenance**: every output record lists its `sources` (`url`, `retrievedAt`) and carries MLB person ids.
- **Determinism**: keys and records are sorted; artifact metadata has no wall-clock time. Re-running over the same cache produces byte-identical files.
- **Errors**: per-player failures are recorded in the artifact (`error` / `INSUFFICIENT_EVIDENCE`) and printed to stderr; one failure never aborts a batch.

## Commands

All commands write to `research-output/` (git-ignored) unless `--out` is given.

```bash
# Dodgers "signed free agent" transactions in a window, with international-amateur
# profile and first-professional-contract classification.
node scripts/mlb/org-signings.mjs --year 2022 --start 2022-01-15 --end 2022-12-15

# Propose MLB ids for players without one (signing-club transaction match: name + club + year; optional
# per-player teamAbbr, default Dodgers; name search is reported, never accepted).
node scripts/mlb/resolve-ids.mjs --input players.json --out research-output/019

# Outcome research: MLB debut, highest affiliated level, last affiliated season, final transaction,
# recommended audit state with its reason.
node scripts/mlb/player-outcomes.mjs --input players.json --audit-date 2026-10-05 --out research-output/019

# Career bWAR from Baseball-Reference's WAR files for players with an MLB debut.
node scripts/mlb/bref-war.mjs --input mlb-players.json --out research-output/019

# Reconcile a published class list against an org-signings artifact.
node scripts/mlb/reconcile-class.mjs --list class-2025.txt --signings research-output/org-signings-119-2025/org-signings.json

# Identity: MLB person record (birth data, bats/throws, height/weight, position, debut,
# Lahman / FanGraphs cross-reference ids) and the position named on the signing transaction.
node scripts/mlb/player-identities.mjs --input players.json --out research-output/020

# Baseball-Reference ids from B-Ref's WAR files (mlb_ID -> player_ID), checked against MLB's Lahman id
# and any B-Ref page DISI cites. Ambiguous and name-only matches are never selected.
node scripts/mlb/resolve-bref.mjs --input players.json --identities research-output/020/player-identities.json

# FanGraphs ids from MLB's cross-reference only (no fWAR).
node scripts/mlb/resolve-fangraphs.mjs --identities research-output/020/player-identities.json

# Reviewed identity artifacts -> SQL VALUES blocks and a decisions report.
node scripts/mlb/identity-sql-values.mjs --players players.json --identities player-identities.json \
  --bref resolve-bref.json --fangraphs resolve-fangraphs.json --league-ids resolve-ids.json --out values.sql

# Development history (021): season splits -> stints, optional game-log dates, first-appearance
# milestones, then reviewed values for the migration.
node scripts/mlb/player-seasons.mjs --input players.json --out research-output/021
node scripts/mlb/player-game-levels.mjs --input players.json --out research-output/021 [--game-logs]
node scripts/mlb/development-milestones.mjs --input players.json --out research-output/021
node scripts/mlb/development-sql-values.mjs --seasons research-output/021/player-seasons.json \
  --milestones research-output/021/development-milestones.json \
  --game-levels research-output/021/player-game-levels.json --as-of 2026-10-06 \
  --out database/research/021/values.sql

# Turn REVIEWED artifacts into SQL VALUES blocks plus a decisions report.
node scripts/mlb/outcome-sql-values.mjs --outcomes a.json,b.json --bwar bref-war.json \
  --identity identity-decisions.json --audit-date 2026-10-05 --out values.sql

# Optional: export a DISI queue view as input (read-only, publishable key).
node --env-file=.env.local scripts/mlb/export-queue.mjs --view v_dodgers_mature_outcome_queue --out players.json
```

Input files are JSON arrays: `[{ "name": "...", "signingYear": 2018, "mlbId": 682946, "slug": "gregory-pereira" }]` (`mlbId` / `slug` optional where noted).

## Rules encoded in `lib/classify.mjs`

- **First professional contract**: no earlier contract-type transaction (SFA, SGN, DR, TR, REL, DFA, …). Showcase-league status changes do not count.
- **Unaffiliated leagues**: Mexican League seasons (filed as Triple-A by the API until 2020) are excluded from affiliated levels and reported as play outside affiliated baseball.
- **Outcome recommendation**: `VERIFIED_MLB`, `NO_MLB_CAREER_ENDED` (final release / free agency / retirement, or no affiliated appearance for two seasons), `NO_MLB_ACTIVE_IN_MINORS`, `INSUFFICIENT_EVIDENCE`. Missing data is never read as "no MLB".
- **Audit policy** (`auditDecision`): positives for any class; "no longer in affiliated ball" only for classes through 2021; "active, no debut" only through 2020; insufficient evidence never.
- **bWAR**: sum of batting and pitching WAR rows per `mlb_ID`, summed in exact hundredths and rounded half away from zero (validated against all 42 page-keyed DISI values).

## Identity rules in `lib/identity.mjs`

- **B-Ref resolution** (`resolveBref`): by MLB id in the WAR file (VERIFIED, must agree with MLB's Lahman id and any cited B-Ref page, else `CONFLICT`); by a cited B-Ref page (VERIFIED); by name + debut year + debut franchise (HIGH). A name alone is `NEEDS_REVIEW`; several candidates are `AMBIGUOUS`; players without an MLB debut are `NOT_APPLICABLE`. Only `RESOLVED` is applied, and one B-Ref id can belong to one player (`findIdCollisions`).
- **Canonical name** (`chooseCanonicalName`): a source spelling replaces the DISI name only when it differs by accents alone (same slug, same letters) and adds accents; never strips them. Other spellings become aliases.
- **Position at signing** (`signingPosition`): the position named on the club's closest signing transaction in the signing window; otherwise none.
- **Normalization**: heights outside 4′–8′ and weights outside 80–400 lb are dropped; country names are mapped to DISI's names (`Republic of Korea` → `South Korea`); unknown codes become NULL. Nationality is never derived.

## Tests

`npm run research:test` (also part of `npm test`) runs offline against sanitized fixtures in `tests/fixtures/mlb/`; `tests/unit/mlb-development.test.mjs` covers the development-history library the same way.

## Development-history rules in `lib/development.mjs`

- **Foreign professional leagues** (`FOREIGN_PRO_LEAGUES`): the Mexican League, NPB, KBO, Cuban professional and similar are `FOREIGN_PRO` in every era, never affiliated minor-league levels, whatever sport id the source filed them under (the API filed the Mexican League as Triple-A until 2020).
- **Sport-id classification with source labels preserved**: ids 1/11/12/13/14 map to MLB/AAA/AA/HIGH_A/LOW_A, 15 short-season A to LOW_A with the original label kept, and 16 rookie-class splits by league name (DSL, Arizona/Florida complex, else `UNKNOWN_ROOKIE_LEAGUE` — unresolved, never invented).
- **Stints** (`distillStints`): the hitting and pitching halves of one player/season/team/league split merge into a single two-way stint; different teams, leagues or levels never merge. Hitter fields are only filled from hitting data and pitcher fields only from pitching data; IP like `37.2` becomes 37.6667 (exact thirds).
- **Organizations** (`resolveOrganization`): per season from the reviewed affiliation table; MLB club names map directly; foreign professional clubs resolve to organization NULL (`FOREIGN_PRO_CLUB`) with the club name recorded verbatim; anything unmapped is NULL and queued, never guessed.
- **Milestones** (`buildMilestoneCandidates`): a date exists only where a dated record supports it — season-only evidence yields SEASON precision with no date, never January 1. Releases/retirements use the FINAL transaction of that type. An organization change is a season-precision event, never an inferred trade date.

