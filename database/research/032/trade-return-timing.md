# Migration 032: trade-return acquisition boundary

Trade-return value is the Dodgers bWAR produced **after** the incoming asset was acquired in that specific transaction.
`direct_dodgers_mlb_bwar` (a player's whole Dodgers career) is unchanged and still includes every Dodgers stint.

## Rule

| Case | Placement |
|---|---|
| Season after the acquisition season | counted |
| Earlier season | pre-acquisition, never counted |
| Trade in November or December | the same season is over: pre-acquisition; later seasons counted |
| Trade in January or February | the season has not started: counted |
| Trade in March to October | the counterparty's single stint that season (B-Ref stint order is chronological) is the move the trade made: the Dodgers stint immediately after it and every later stint count; Dodgers stints ordered before it are pre-acquisition |
| Any other same-season Dodgers stint | UNRESOLVED: the return is NULL (never zero, never the whole season); the complete later seasons are shown separately; queued as TRADE_RETURN_TIMING_UNRESOLVED |

No transaction timestamp is invented; the signals are the event date, the event's counterparty organization and the B-Ref stint ordinal.

## Canonical return assets

| Event | Date | Counterparty | Asset | Timing | Pre-acquisition Dodgers rows | Return bWAR | Complete later seasons |
|---|---|---|---|---|---|---|---|
| LAD_BAL_2018_DIAZ_MACHADO | 2018-07-19 | BAL | Manny Machado | RESOLVED_BY_COUNTERPARTY_STINT_ORDER | 0 | 2.58 | 0 |
| LAD_HOU_2016_ALVAREZ_FIELDS | 2016-08-01 | HOU | Josh Fields | RESOLVED_BY_COUNTERPARTY_STINT_ORDER | 0 | 1.94 | 1.78 |
| LAD_PIT_2017_CRUZ_WATSON | 2017-07-31 | PIT | Tony Watson | RESOLVED_BY_COUNTERPARTY_STINT_ORDER | 0 | 0.40 | 0 |

The research queue count for TRADE_RETURN_TIMING_UNRESOLVED is derived, currently 0.
