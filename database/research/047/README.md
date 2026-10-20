# Research behind migration 047

`database/sql/047_development_transaction_research_batch.sql` and `database/release/sql/rollback-047.sql` are generated from this folder.

```
node database/research/047/derive-transactions.mjs <dir>     # Retrosheet tran.txt + BIOFILE + disi-packages.json -> transaction-evidence.json
node database/research/047/derive-development.mjs <dir>      # scripts/mlb pipeline output -> development-values.sql (cohort + rules in development-cohort.json)
node database/research/047/build.mjs                         # template + evidence + values -> the migration and its rollback (deterministic)
node database/research/047/measure.mjs <dataset.json>        # the development / transaction measures (baseline.json is the pre-047 state)
```

| File | Purpose |
|---|---|
| `transaction-evidence.json` | five exits, each an exact Retrosheet row matched to the DISI asset by name and birth date; eight unresolved cases with the reason; the package-membership cross-check of five recorded trades; Bob Miller's found-but-unrecorded 1967 package |
| `development-cohort.json` | the ten-player cohort (the first ten rows of the deterministic development queue), the rule, and Jansen's two pending progression reviews |
| `development-values.sql` | the reviewed MLB Stats API pipeline VALUES (255 stints, 41 milestones, 50 request sources) |
| `047_template.sql` / `rollback_template.sql` | hand-written guards, steps, proofs and postconditions |
| `baseline.json` | the pre-047 measures from production on 2026-10-20 (generation 4) |

## The research, in order

1. **Baseline.** 220 signings; development dimensions `SIGNING_DATE` 197, `FIRST_PRO_SEASON` 161, `HIGHEST_LEVEL` 212, `MLB_DEBUT` 47 of 47, `EXIT` 138 of 156, `CHRONOLOGY` 135 (of 220 unless stated); 109 signings with a gap; nine incomplete transaction chains; 21 trade packages with an open issue; 26 signings in shared packages whose return is not credited to anyone.
2. **What "incomplete chain" meant.** `INCOMPLETE_*` describes the exits of players the Dodgers *received*. The 046 notes had read it as the signing's own exit; the exit summary shows the signing's own exit is recorded for 138 signings.
3. **Sources tried.** Baseball-Reference (403), MLB.com / Baseball America (403), SABR biographies (the raw page of at least one player carried no body text), the MLB Stats API (official; no Dodgers-side exit rows for the five), **Retrosheet's transactions database** (structured, with transaction ids; read directly; goes through 2022).
4. **Identity.** Retrosheet ids are matched to the MLB person record by surname **and** exact birth date. No name-only match is accepted.
5. **Exits recorded (5).** Steve Finley, Brent Mayne (free agency, 2004), Beltrán Pérez (free agency, 2005), Nick Punto (free agency, 2013), Homer Bailey (released, 2018).
6. **Not recorded, on purpose.** Gail Harris, Robinson Checo and four minor-league assets (the source has no exit); Mike Judd's return (a conditional deal naming none); Bob Miller (the exit is a four-player 1967 trade whose two incoming players cannot be valued without the blocked Baseball-Reference WAR files).
7. **Package verification.** The packages DISI records for Offerman, Mondesí, Amorós, the 1957 Fernández trade and the 1962 Miller trade agree with Retrosheet's membership, including the $75,000 cash and the resolved player to be named later.
8. **Development cohort.** Ten verified MLB players, whole careers from the official API.

## What the batch changed, and what it did not

- Chains incomplete 9 to 7 (Puig and De La Rosa); first professional season known 161 to 164; signing-to-MLB with exact dates 6 to 16 of 47; development queue 104 to 154 items.
- It did **not** make any cohort player's development history complete: game-log dates, season gaps and unresolved organizations remain. No audit, cost, outcome, threshold or predictive layer moved.

## Findings worth keeping

- The API starts late for older players (Valenzuela's first record is 1991 for a 1979 signing) and omits many international rookie-league seasons (Beltré's first record is 1996 for a 1994 signing). Those seasons are unknown, not absent.
- The first observed record is not the first professional season. The completeness rule treats a record that starts two or more seasons after signing as only the first observed record.
- Loading history surfaced two real integrity obligations that a naive load would have broken: team-less aggregate rows (proven, not assumed) and an unreviewed level inversion (pending, not asserted).
