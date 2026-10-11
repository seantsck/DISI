# Migration 032: trade-return identity audit

| Asset | Event | bref_id | MLB id | Identity check |
|---|---|---|---|---|
| Josh Fields | LAD_HOU_2016_ALVAREZ_FIELDS | `fieldjo03` | 451661 | MLB Stats API person 451661 is Josh Fields, RHP, born 1985-08-19; the B-Ref file rows for fieldjo03 carry mlb_ID 451661 and LAD seasons 2016-2018. |
| Tony Watson | LAD_PIT_2017_CRUZ_WATSON | `watsoto01` | 453265 | MLB Stats API person 453265 is Tony Watson, LHP, born 1985-05-30; the B-Ref file rows for watsoto01 carry mlb_ID 453265 and a 2017 LAD stint. |
| Manny Machado | LAD_BAL_2018_DIAZ_MACHADO | `machama01` | 592518 | MLB Stats API person 592518 is Manny Machado, 3B, born 1992-07-06; the B-Ref file rows for machama01 carry mlb_ID 592518 and a 2018 LAD stint. |

`transaction_event_assets.bref_id` is populated for these three incoming PLAYER assets only. Outgoing players, cash and
future-considerations assets carry NULL. No DISI `players` row was created for a return asset.

## Derived Dodgers bWAR versus the hand-entered return metrics

| Asset | Team-season rows | Derived Dodgers bWAR | Hand-entered | Difference |
|---|---|---|---|---|
| Josh Fields | 6 LAD rows | 1.94 | 2 | -0.06 |
| Tony Watson | 2 LAD rows | 0.4 | 0.4 | 0 |
| Manny Machado | 1 LAD rows | 2.58 | 2.6 | -0.02 |

The hand-entered figures were one-decimal roundings (Fields: 0.2 + 0.9 + 0.9 = 2.0; the file gives 1.94). The old
`transaction_return_metrics` table is kept for audit history; the new views read the team-season facts.
