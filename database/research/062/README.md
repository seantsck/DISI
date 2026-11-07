# 062: bWAR backlog closure

Migration 062 writes the owner-observed current career bWAR of the `BWAR_MISSING` players.

It is **built and locally validated, not released**: not committed, not applied to production, not merged, not frozen.

## What it does

- **Input.** The DISI owner read the current career WAR on each of the 39 players' Baseball-Reference pages and supplied the values on
  2026-11-06 (`owner-input.json`). DISI and no automated process read those pages.
- **Written: 32.** Each value is exactly as supplied: 0.0 is a known value, and negatives are kept.
  - Each cites a new `PLAYER_PAGE` / `BASEBALL_REFERENCE` source at `https://www.baseball-reference.com/players/<l>/<bref_id>.shtml`, whose notes
    say the value is owner-observed and that DISI did not retrieve the page.
  - Each is observed through 2026-11-06 / 2026, with confidence `UNVERIFIED` (the 060 convention for owner input).
- **Held: 7** (NULL; they keep `BWAR_MISSING`): Soto, Tatis Jr., Guerrero Jr., Giménez, Amaya, Marchán, De Jesus.
  - Their current value contradicts the team-season ledger 057 loaded through 2025 (and `outcomes.career_war`) by more than the verifier's 0.1.
  - See `amendment.md`.
- **No schema or provider change.** The 017 rule already accepts the canonical player URL, and identities are as the audit verified them.
- **Effect.**
  - `CAREER_BWAR` 58 → 90; `BWAR_MISSING` 39 → 7; sources +32; evidence 0.
  - Team-season WAR, outcomes, signings, transactions and every prediction output are unchanged.
  - No snapshot drift, so no refresh; 259 checks.
- **Rollback.** `rollback-062` deletes exactly the 32 observations and keeps the 32 sources as provenance (049 / 061). It refuses after any later
  `CAREER_BWAR` observation of the 39 players, and 062 can be reapplied.

## Files

| File | What it is |
|---|---|
| `measure.mjs`, `baseline-build.json` | The 061 measurement plus every `CAREER_BWAR` observation, the `BWAR_MISSING` queue with identity, ledger, outcome and sources, the WAR sources, the provider rule, team-season WAR and fingerprints (canonical 001-061 replay). |
| `source-capture.json`, `audit.mjs`, `audit.json`, `audit-report.md` | The original 062 audit, preserved: identity verification (MLB Stats API, the WAR files' id pairing) and what the archived captures could and could not support. |
| `amendment.md` | What changed after the audit: the owner input, the withdrawn archive rule, the seven held rows and the 057 correction. |
| `owner-input.json` | The 39 owner-observed values, as supplied, with the observation date, as-of, confidence and URL rule. |
| `062_template.sql`, `rollback_template.sql`, `build.mjs` | The migration, the rollback and their deterministic assembly. The build refuses an input the baseline does not allow, and holds a row that would contradict a loaded ledger. |
| `career-bwar-evidence.json` | Each of the 39: value, URL, ACCEPTED or HELD (with the reason), and the archived audit value as a cross-check. |
| `report.mjs`, `before-after.json` | 062 applied to a replay: headline, queue movement, the written rows, and which fingerprints held. |

## Commands

```
node database/research/062/measure.mjs --chain 061_transaction_research_closure.sql --baseline > /dev/null   # about 3.5 minutes
node database/research/062/audit.mjs            # the original audit; needs research-output/057-work/raw and research-output/062-work/statsapi (gitignored)
node database/research/062/build.mjs            # write the migration, the rollback and career-bwar-evidence.json
node database/research/062/build.mjs --check    # exit 1 unless they equal the build output
node database/research/062/report.mjs [--dump <post-061 PGlite tar>]
```
