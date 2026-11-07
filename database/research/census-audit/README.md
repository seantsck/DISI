# Dodgers international signing census audit

A read-only research audit of whether DISI's Dodgers international signing population is a census, period by period. It contains no migration SQL and wrote nothing to any database. The DISI side comes from a read-only export of the canonical post-061 replay: snapshot generation 15, logically equal to production generation 16. There was no production connection.

## Files

| File | What it is |
|---|---|
| `audit-report.md` | Findings, scorecard commentary, historical boundary, cost-model note, research classification. Start here. |
| `current-disi-population.csv` | All DISI Dodgers signing rows with an audit `signing_period` beside the real date. |
| `year-scorecard.csv` | One row per signing period, plus opening-class sub-rows (the population DISI's own coverage claims refer to). |
| `dodgers-signing-census-gaps.csv` | Every external player and every DISI row, reconciled: `MATCHED`, `MISSING_FROM_DISI`, `POSSIBLE_NAME_VARIANT`, `IDENTITY_AMBIGUOUS`, `OUT_OF_SCOPE_ROUTE`, `DISI_EXTRA`, `DUPLICATE_DISI`. |
| `identity-review.csv` | Rows that need a human decision before they can count. |
| `owner-research-queue.md` | ACTIONABLE items only, ranked, each with a Google query ready to paste. |
| `external-periods.json` | The derived external census by period, the method, count anchors, the unreadable sources, and the SHA-256 pin of every raw input. |
| `build-summary.json` | Machine summary (counts, census totals) used in the report. |
| `build.mjs` | Deterministic generator for every file above except this README and `audit-report.md`. |
| `inputs/disi-export.json` | Read-only export of DISI's Dodgers rows, the minimal player and alias identity fields, and DISI's coverage tables and views. |
| `inputs/manual.json` | Hand transcriptions of class lists that were actually read, count anchors, period rules, and the few documented overrides. |
| `inputs/raw-pins.json` | SHA-256, size and URL of each raw MLB Stats API response. |

## Regenerate

The raw MLB Stats API responses are gitignored (`research-output/`). To rebuild:

1. Re-fetch each URL listed in `inputs/raw-pins.json` into `research-output/census-audit/raw/<file>`.
2. Run `node database/research/census-audit/build.mjs`.

`build.mjs` stops if any raw file's SHA-256 differs from its pin. MLB revises person and transaction records over time, so a later re-fetch can fail the pins. In that case, treat the new responses as a new audit input and do not overwrite the pins silently. The build itself has no network access, no clock and no database, and two runs produce byte-identical output.

## Scope rules

- **External source of truth:** the Dodgers (teamId 119) `SFA` transactions from the official MLB Stats API, 2008-2026. Each is joined to the MLB person record (birth country, birth date, draft year) and to the player's full transaction history.
- **In scope:** the player has no draft year and was born outside the USA, Puerto Rico and Canada. A US-born player counts only when a class list names him. He also has no transaction with another MLB organization or its affiliates before the Dodgers signing. Prior appearances in MLB tryout leagues, the MLB Draft League, winter leagues, national teams and foreign leagues do not disqualify him.
- **Routes:** `INTERNATIONAL_AMATEUR` (under 23 at signing), `MEXICAN_LEAGUE_TRANSFER` (a Mexican League club held prior rights), and `FOREIGN_PROFESSIONAL` (23 or older, no prior MLB organization). Ex-NPB Roki Sasaki is kept, under `FOREIGN_PROFESSIONAL`, as DISI's pathway taxonomy requires.
- **Signing period:** derived from the real date (`manual.json` `period_rules`). The real date is never altered.
- **Matching:** by MLBAM id first. A name-only match is never counted as `MATCHED`. A DISI row without an MLBAM id that agrees on name, plus surname and birth date where present, becomes `POSSIBLE_NAME_VARIANT`.
