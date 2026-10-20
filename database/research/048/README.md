# Research behind migration 048

`database/sql/048_verified_mlb_development_coverage.sql` and `database/release/sql/rollback-048.sql` are generated from this folder.

```
node scripts/mlb/player-seasons.mjs        --input players.json --out <dir>   # the official MLB Stats API season splits (cached, paced)
node scripts/mlb/development-milestones.mjs --input players.json --out <dir>   # first-appearance milestones
node database/research/048/derive-development.mjs <dir>    # cohort + rules + rows already on record -> development-values.sql
node database/research/048/derive-reviews.mjs <dir>        # inverted level sequences -> PENDING progression reviews in development-cohort.json
node database/research/048/build.mjs                       # template + values + cohort -> the migration and its rollback (deterministic)
```

| File | Purpose |
|---|---|
| `development-cohort.json` | the 37 cohort players (verified MLB minus the 047 cohort), their queue rank on the pre-048 state, the two already researched, and the 15 pending reviews with the evidence in each note |
| `development-values.sql` | the reviewed MLB Stats API pipeline VALUES (776 stints, 200 milestones, the request sources) |
| `development-values-decisions.json` | the generator's decisions report (no conflicts) |
| `existing-development.json` | the development rows Migration 021 already holds for Cedeño and Frías (22 and 24 stints): 048 never overwrites or duplicates them |
| `048_template.sql` / `rollback_template.sql` | hand-written guards, steps, proofs and postconditions |
| `baseline.json` | the pre-048 measures read from production on 2026-10-20 (generation 5), with the stint history |
| `results.mjs` / `results.json` | the per-player research result (from the pre- and post-048 datasets), and the totals |
| `measure.mjs` | prints the 048 measures from a saved dataset that includes the stint history |

## The research, in order

1. **Baseline (production, generation 5, 2026-10-20).** 47 verified MLB players; 10 in the 047 controlled cohort; 37 remain. Derived from the
   database, not hard-coded. Verified MLB coverage: pre-MLB history for 10 of 47, signing-to-MLB with both exact dates for 16 of 47, 154
   development detector rows.
2. **Retrieval.** The official MLB Stats API (`people`, `yearByYear` hitting and pitching, MLB and `milb_all`), cached, one request every 750 ms.
   822 stints and 227 milestone candidates came back for 37 players. Nothing was scraped around a restriction; no blocked source (Baseball-Reference,
   MLB.com) was used or guessed.
3. **Rows already on record.** Cedeño and Frías were researched by Migration 021 (22 and 24 stints, 6 and 11 milestones). Every API row for them is
   already there, so 048 adds nothing for them (they are "no new reliable evidence"). Without this rule the load would have duplicated Frías's
   level debuts at a second precision.
4. **Post-MLB rule.** A level debut dated after the MLB debut season is a rehabilitation, demotion or late reassignment and is not a development
   milestone (9 candidates not recorded). Their stints stay on record.
5. **Not recorded on purpose.** Nothing inferred for seasons the API does not return; game-log dates are not retrieved; organizations are not
   re-resolved (the 021 affiliation table is unchanged); the eighteen final-release or retirement transactions (seventeen releases, one retirement) the API carries are recorded as
   milestones that name no organization, exactly as 021 stored Frías's, and are never read as a Dodgers exit.
6. **Integrity, proven not assumed.** 50 team-less aggregate rows are classified `SEASON_TOTAL` only after the migration proves each equal to the sum of
   its component team stints; one unproven row would stop it.
7. **Ambiguous sequences.** Six players have a lower level first recorded in a later season than a higher one (Kuo, Abreu, Santana, Urías, Díaz,
   Cruz): 15 `REVIEW_REQUIRED` / `PENDING_REVIEW` decisions, confidence `LOW`, each note carrying the season-by-season path. None is decided.

## What the batch changed, and what it did not

| Measure (verified MLB players, n of 47) | Before | After |
|---|---|---|
| Any pre-MLB history | 10 | 42 |
| Usable affiliate chronology (no open chronology issue) | 0 | 0 |
| Exact signing date | 45 | 45 |
| Exact MLB debut date | 47 | 47 |
| Both dates for signing-to-MLB | 16 | 45 |
| Verified first professional season (pathway-aware) | 3 | 19 |
| Documented path with no gap visible at season precision | 1 | 3 |
| Pending progression review | 2 | 8 |

- Signing-to-MLB (45 of 47): minimum 0.15, median 4.59, maximum 9.08 years. By route: amateur signings 38 of 39; established professionals
  7 of 8 (an acquisition-to-debut interval, not development, so the two are never compared). Amorós and Díaz have no recorded signing date.
- First professional season, all 220 signings: 163 before (restated from the 164 published after 047), 179 after.
- Development detector rows 154 to 347; as distinct evidence gaps 113 to 173.
- No audit, cost, transaction, threshold, probability, expected value or recommendation moved. Snapshot generation +1; the only executive
  column that changed is the development data's as-of date.

## The result for each of the 37 players

`results.mjs` classifies every cohort player in one of four ways (`researchResult`; the precedence is fixed and documented in the code):

| Result | Players |
|---|---|
| substantially expanded (the pre-MLB path reaches back to the signing season, 3+ seasons, no gap) | 13: Báez, Aybar, De La Rosa, De Paula, Hu, Ruiz, Álvarez, Leonard, Vivas, Vargas, Domínguez, García, Castro |
| partially expanded (history added, but it starts late, has a gap, or is short) | 13: Astacio, Pages, Osuna, P. Martínez, Offerman, V. González, Daal, Troncoso, Sasaki, Herrera, Vizcaíno, Guzmán, Rosso |
| no new reliable evidence (no pre-MLB stint added) | 5: Amorós, Fernández, Clemente (the API holds no minor-league record), Cedeño and Frías (already on record from 021) |
| unresolved or conflicted (a level sequence a person must decide) | 6: Urías, Kuo, Abreu, Santana, Cruz, Díaz |

Totals: cohort 37; players with new rows 35; stints added 776; milestones added 200; first professional seasons resolved 16; signing-to-MLB with
both exact dates added 29 (16 to 45); ambiguous sequences created 6 players / 15 decisions. "Substantially" is about the *documented path*, not about
completeness: every one of the 47 verified MLB paths still has an open chronology issue (game dates, organizations, rookie leagues).

## Findings worth keeping

- **The source begins late.** Astacio signed in 1987 and the first record is 1990; Ramón Martínez, Guzmán, Offerman, Vizcaíno, Pedro Martínez,
  Mondesí, Daal and others start two to four seasons after signing. Those seasons are unknown, not absent. The three 1950s players have no
  structured minor-league record at all.
- **Eight of the 47 were established professionals** (Valenzuela, Nomo, Urías, Ryu, Puig, Díaz, Álvarez, Sasaki). Their first affiliated
  season is not their first professional season. Sasaki's NPB years are not in the affiliated API, which is a limitation, not a row.
- **Every verified MLB path still has an open chronology issue.** Game-log dates (2006+), unresolved organizations (the 021 affiliation table
  covers Dodgers affiliates only partly and no other club's) and unplaceable rookie leagues remain. Honest, and the next real work.
- **Reviewable ambiguity is common and mostly looks like rehabilitation** (a two- or three-game rookie-level stint after a player has reached
  Double-A), but looking like is not deciding: the packet shows the games and the seasons and a reviewer decides.
