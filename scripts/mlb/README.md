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

# Propose MLB ids for players without one (Dodgers transaction match; name search is reported, never accepted).
node scripts/mlb/resolve-ids.mjs --input players.json --out research-output/019

# Outcome research: MLB debut, highest affiliated level, last affiliated season, final transaction,
# recommended audit state with its reason.
node scripts/mlb/player-outcomes.mjs --input players.json --audit-date 2026-10-05 --out research-output/019

# Career bWAR from Baseball-Reference's WAR files for players with an MLB debut.
node scripts/mlb/bref-war.mjs --input mlb-players.json --out research-output/019

# Reconcile a published class list against an org-signings artifact.
node scripts/mlb/reconcile-class.mjs --list class-2025.txt --signings research-output/org-signings-119-2025/org-signings.json

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

## Tests

`npm run research:test` (also part of `npm test`) runs offline against sanitized fixtures in `tests/fixtures/mlb/`.
