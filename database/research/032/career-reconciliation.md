# Migration 032: career-WAR reconciliation

For each of the 47 verified MLB-reached players, the sum of the loaded BAT + PITCH team-season rows was compared with
the established career bWAR (`CAREER_BWAR` metric observation, else `outcomes.career_war`). Legacy stores keep one
decimal, so agreement means within 0.1. The largest difference is 0.05.

## The three disagreements the Phase 1 audit found

| Player | Team-season rows | Exact total | Rounded | `outcomes.career_war` before | `CAREER_BWAR` before | Resolution |
|---|---|---|---|---|---|---|
| carlos-frias | 6 | -0.34 | -0.3 | NULL | -0.3 | outcomes.career_war set to -0.3 (field-level evidence row added) |
| eddys-leonard | 1 | -0.21 | -0.2 | -0.2 | NULL | CAREER_BWAR observation -0.2 added (2026-09-28, 2026 season) |
| roger-cedeno | 11 | 1.69 | 1.7 | NULL | 1.7 | outcomes.career_war set to 1.7 (field-level evidence row added) |

- **Frias** and **Cedeno**: the `outcomes` row had no career WAR while the metric store did (-0.3, 1.7 from the same file). The loaded facts total -0.34 and 1.69, which round to exactly those values; the outcomes store was the stale one.
- **Leonard**: the `outcomes` row had -0.2 (MLB.com) while the metric store had no observation. The loaded fact (one 2026 San Francisco batting row, -0.21) rounds to -0.2; the metric store was the incomplete one.
- Nothing was written where the facts could not establish a value; no other player needed a backfill.

## All 47 players

| Player | Rows | BAT+PITCH total | Rounded | outcomes | metric | Diff vs legacy |
|---|---|---|---|---|---|---|
| adrian-beltre | 21 | 93.72 | 93.7 | 93.7 | 93.7 | 0.02 |
| andy-pages | 3 | 10.92 | 10.9 | 10.9 | 10.9 | 0.02 |
| antonio-osuna | 22 | 6.12 | 6.1 | 6.1 | 6.1 | 0.02 |
| carlos-frias | 6 | -0.34 | -0.3 |  | -0.3 | -0.04 |
| carlos-santana | 20 | 38.75 | 38.8 | 38.8 | 38.8 | -0.05 |
| chan-ho-park | 38 | 19.93 | 19.9 | 19.9 | 19.9 | 0.03 |
| chico-fernandez | 9 | -2.4 | -2.4 | -2.4 | -2.4 | 0 |
| chin-lung-hu | 5 | -0.34 | -0.3 | -0.3 | -0.3 | -0.04 |
| eddys-leonard | 1 | -0.21 | -0.2 | -0.2 |  | -0.01 |
| elian-herrera | 4 | 0.65 | 0.7 | 0.7 | 0.7 | -0.05 |
| fernando-valenzuela | 36 | 41.45 | 41.5 | 41.5 | 41.5 | -0.05 |
| hideo-nomo | 26 | 20.93 | 20.9 | 20.9 | 20.9 | 0.03 |
| hung-chih-kuo | 14 | 5.08 | 5.1 | 5.1 | 5.1 | -0.02 |
| hyun-jin-ryu | 20 | 20.19 | 20.2 | 20.2 | 20.2 | -0.01 |
| ismael-valdez | 30 | 24.13 | 24.1 | 24.1 | 24.1 | 0.03 |
| jorbit-vivas | 3 | 0.51 | 0.5 | 0.5 | 0.5 | 0.01 |
| jose-dominguez | 8 | -0.43 | -0.4 | -0.4 | -0.4 | -0.03 |
| jose-offerman | 17 | 17.12 | 17.1 | 17.1 | 17.1 | 0.02 |
| jose-vizcaino | 21 | 7.01 | 7 | 7 | 7 | 0.01 |
| josue-de-paula | 1 | 0.46 | 0.5 | 0.5 | 0.5 | -0.04 |
| juan-castro | 20 | -5.4 | -5.4 | -5.4 | -5.4 | 0 |
| juan-guzman | 24 | 24.28 | 24.3 | 24.3 | 24.3 | -0.02 |
| julio-urias | 16 | 13.8 | 13.8 | 13.8 | 13.8 | 0 |
| karim-garcia | 14 | -3.25 | -3.2 | -3.3 | -3.3 | 0.05 |
| keibert-ruiz | 8 | 6.94 | 6.9 | 6.9 | 6.9 | 0.04 |
| kenley-jansen | 34 | 24.87 | 24.9 | 24.9 | 24.9 | -0.03 |
| miguel-vargas | 6 | 6.18 | 6.2 | 6.2 | 6.2 | -0.02 |
| omar-daal | 26 | 8.65 | 8.7 | 8.7 | 8.7 | -0.05 |
| oneil-cruz | 6 | 8.17 | 8.2 | 8.2 | 8.2 | -0.03 |
| pedro-astacio | 36 | 25.63 | 25.6 | 25.6 | 25.6 | 0.03 |
| pedro-baez | 18 | 3.54 | 3.5 | 3.5 | 3.5 | 0.04 |
| pedro-martinez | 36 | 83.9 | 83.9 | 83.9 | 83.9 | 0 |
| ramon-martinez | 28 | 25.86 | 25.9 | 25.9 | 25.9 | -0.04 |
| ramon-rosso | 4 | -0.07 | -0.1 | -0.1 | -0.1 | 0.03 |
| ramon-troncoso | 10 | 0.76 | 0.8 | 0.8 | 0.8 | -0.04 |
| raul-mondesi | 16 | 29.51 | 29.5 | 29.5 | 29.5 | 0.01 |
| roberto-clemente | 18 | 94.96 | 95 | 95 | 95 | -0.04 |
| roger-cedeno | 11 | 1.69 | 1.7 |  | 1.7 | -0.01 |
| roki-sasaki | 3 | 1.14 | 1.1 | 1.1 | 1.1 | 0.04 |
| rubby-de-la-rosa | 14 | 1.32 | 1.3 | 1.3 | 1.3 | 0.02 |
| sandy-amoros | 8 | 7.35 | 7.4 | 7.4 | 7.4 | -0.05 |
| tony-abreu | 6 | -0.44 | -0.4 | -0.4 | -0.4 | -0.04 |
| victor-gonzalez | 8 | 1.42 | 1.4 | 1.4 | 1.4 | 0.02 |
| willy-aybar | 6 | 2.74 | 2.7 | 2.7 | 2.7 | 0.04 |
| yasiel-puig | 8 | 18.77 | 18.8 | 18.8 | 18.8 | -0.03 |
| yordan-alvarez | 8 | 30.9 | 30.9 | 30.9 | 30.9 | 0 |
| yusniel-diaz | 1 | -0.03 | 0 | 0 | 0 | -0.03 |
