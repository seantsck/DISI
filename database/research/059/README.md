# 059 — career bWAR metric reconciliation

One dated career-to-date `CAREER_BWAR` observation for each of the eleven benchmark players whose complete mapped team-season ledger 035 loaded
from the live Baseball-Reference data files of 2026-09-28. Each value is derived from that ledger by the 032 pattern (ACTIVE BWAR batting and
pitching rows, summed, rounded to one decimal), observed through 2026-09-28 / the 2026 season, and cites the existing batting-file source with the
pitching file named in the notes. This is reconciliation of the metric layer with facts DISI already holds: no source, team-season row or outcome
is added or changed.

## Files

| File | What it is |
|---|---|
| `scope.json` | The accepted semantics (career-to-date as of a date), the two pinned data files, the eleven players with their reviewed row counts, BAT / PITCH / raw sums and one-decimal values, the excluded 057 eleven with the reason, and the reviewed effect. |
| `measure.mjs` | The 058 measurement plus every CAREER_BWAR observation, the BWAR_MISSING queue, the eleven (and the 057 eleven) ledgers, identities and dossiers, and fingerprints of everything 059 must not move. With `--baseline` it writes `baseline.json`. |
| `baseline.json` | The pre-059 state on the canonical replay (001-058), which the build reproduces before it writes. |
| `baseline-production.json` | The same measurement, read-only, on production before 059. Every logical section equals `baseline.json`; only surrogate-row hashes, the catalog function count and the snapshot generation (14, against 13 on a replay) differ. |
| `059_template.sql`, `rollback_template.sql`, `build.mjs` | The migration, the rollback and their deterministic assembly; the build refuses unless the baseline reproduces the reviewed scope. |
| `career-bwar-evidence.json` | The eleven as the baseline reads them: identity, ledger shape, seasons, teams, BAT / PITCH / raw / one-decimal values, stored `outcomes.career_war`, the exact notes; the 057 eleven; the BWAR_MISSING movement. |
| `report.mjs` | Applies 059 to a replay and writes `before-after.json`. |
| `research-notes.md` | Decisions and findings. |

## Commands

```
node database/research/059/measure.mjs --chain 058_transaction_return_bwar_evidence.sql --baseline > /dev/null
node database/research/059/build.mjs
node database/research/059/report.mjs
```

`measure.mjs` and `report.mjs` accept `--dump <post-058 PGlite tar>` to skip the three-minute chain build.

## Result

| Player | bref / MLBAM | BAT | PITCH | Raw | CAREER_BWAR |
|---|---|---:|---:|---:|---:|
| Rafael Devers | deverra01 / 646240 | 30.62 | — | 30.62 | 30.6 |
| Gleyber Torres | torregl01 / 650402 | 20.91 | — | 20.91 | 20.9 |
| Eloy Jiménez | jimenel02 / 650391 | 5.17 | — | 5.17 | 5.2 |
| Huascar Ynoa | ynoahu01 / 660623 | 0.33 | 0.73 | 1.06 | 1.1 |
| Marcos Diplán | diplama01 / 650959 | 0.00 | 0.38 | 0.38 | 0.4 |
| Dérmis García | garcide02 / 660650 | 0.50 | — | 0.50 | 0.5 |
| Lewin Díaz | diazle01 / 650331 | 0.13 | — | 0.13 | 0.1 |
| Anderson Espinoza | espinan01 / 659262 | — | −0.02 | −0.02 | 0.0 |
| Hyo-Jun Park | parkho01 / 660829 | −0.63 | — | −0.63 | −0.6 |
| José Herrera | herrejo04 / 645444 | −0.62 | −0.03 | −0.65 | −0.7 |
| Diego Castillo | castidi02 / 660636 | −0.51 | −0.26 | −0.77 | −0.8 |

- **Metric:** CAREER_BWAR observations 47 → 58; BWAR_MISSING 50 → 39 (benchmark signings only; the Dodgers research queue does not move).
- **Unchanged:** sources (3384), team-season WAR (2025 active), outcomes, labels, features, support, evaluations, every prediction output,
  organizational and transaction value, every other research task and every other observation. Verifier 259, no pin moves. One snapshot refresh;
  no persisted snapshot changes content.
