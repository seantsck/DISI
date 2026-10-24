# 053 research notes

## The 18 transaction-blocked needs, season by season

39 open seasons (the 052 rule). The classification (`transaction-blocker-classification.json`) was written before any data:

| Class | Seasons | What it is |
|---|---|---|
| MISSING_EVENT | 36 | 3 Dodgers moves an approved source states (Baez 2022, Castro 2010, Vizcaino 2000) and 33 moves between two other clubs |
| NOT_A_TRANSACTION_GAP | 1 | Leon 2026: the Dodgers release (2026-05-21) was already recorded between his last Dodgers game and his first for Detroit |
| EVENT_PRESENT_DATE_INSUFFICIENT | 2 | Valdez 2000, Astacio 1997: the Dodgers trade is recorded; the stints predate the official game log |
| everything else | 0 | no primary blocker waits on a package's membership, a PTBNL or a term |

Of the 33 moves between two other clubs, the official log states the move for the seasons it covers (from about 2009: Santana 2022, 2023, 2025,
2026; Park 2010; Leonard 2026; Cartaya 2025; Puig 2019) and Retrosheet for the earlier ones (Fernandez 1963, Valenzuela 1997, Guzman 1998, 1999,
Offerman 2002, 2005, Vizcaino 1996, 2006, Astacio 2001, 2005, Mondesi 2002-2004, Daal 1997, 2000, Valdez 2002, 2004, Castro 2006, 2008, Garcia
2000, 2002-2004, Park 2005, 2007). They are later organization history: DISI's ledger records Dodgers transactions only (`architecture.md`).
Several are not one transaction at all. Cartaya 2025 is a Twins release (2025-07-23) and a Giants signing (2025-07-29); Santana 2025 and 2026 and
Leonard 2026 are the same shape; Park 2010 is a waiver claim (2010-08-04). ORGANIZATION CHANGE != TRANSACTION TYPE.

## What was recorded

| Event | Date | Source | Closes |
|---|---|---|---|
| `LAD_FREE_AGENT_SIGNING_2022_PEDRO_BAEZ` | 2022-05-19 | official log 622856 (Houston's release 617735 named, not recorded) | Baez 2022: Houston 04-08..04-19, signing, Dodgers affiliates 07-05..08-19 |
| `LAD_FREE_AGENT_SIGNING_2010_JUAN_CASTRO` / `LAD_FREE_AGENCY_2010_JUAN_CASTRO` | 2010-08-03 / 2010-10-05 | official log 65619, 71172; Retrosheet 8708, 8709 | Castro 2010: Philadelphia 04-12..07-16, signing, Dodgers 08-06..08-15 |
| `LAD_FREE_AGENT_SIGNING_1997_JOSE_VIZCAINO` / `LAD_NYY_2000_JOSE_VIZCAINO` | 1997-12-08 / 2000-06-20 | Retrosheet 54684, 63209 | the re-acquisition item; the 2000 season becomes source-limited (pre-game-log) |
| `LAD_FREE_AGENCY_2000_JIM_LEYRITZ` | 2000-11-01 | Retrosheet 30076 | the adjacent hop: the returned player's own exit |
| `LAD_FREE_AGENT_SIGNING_2008_CHAN_HO_PARK` / `LAD_FREE_AGENCY_2008_CHAN_HO_PARK` | 2008-01-20 / 2008-11-01 | Retrosheet 39973, 39974 | the re-acquisition item |
| `PHI_LAD_2001_DAAL_REACQ` / `LAD_FREE_AGENCY_2002_OMAR_DAAL` | 2001-11-09 / 2002-10-28 | Retrosheet 63360, 11939 | the re-acquisition item |

Identities: every player asset is matched across the Chadwick Register, the official person record and (for a major leaguer) BIOFILE by an exact
birth date. Eric Junge and Jesus Cordero (sent to Philadelphia) and Jim Leyritz carry their MLB ids; Cordero, who never reached the majors, carries
his Baseball-Reference Register id, never a major-league one.

## Conflicts kept

- Castro's 2010 Dodgers signing: official log 2010-08-03, Retrosheet 2010-07-27. The official log is first in the source order; the Retrosheet date
  is in the event description. Both lie between his last Philadelphia game (07-16) and his first Dodgers game (08-06).
- Castro's December 2010 signing (not recorded): official log 2010-12-27, Retrosheet 2010-12-14.
- Castro 2008: the official game log places him with Baltimore from 2008-04-28 and with Colorado Springs (Rockies) from 05-05 to 07-14, while
  Retrosheet records a Cincinnati release on 05-02, a Colorado signing on 05-04 and a trade to Baltimore on 07-19. Three organizations in one season
  between two other clubs: open, named, not researched further.

## Stated, not recorded

- **Castro's first exit and later re-signings** (`transaction-evidence.json` `stated_not_recorded`): traded to Cincinnati for Kenny Lutz on
  2000-04-01 (Retrosheet 63195), re-signed 2009-01-07 (Retrosheet 8704; the official log's 2009-04-13 purchase of his contract from Albuquerque is a
  contract purchase within the organization, not an acquisition: CONTRACT PURCHASE != TRADE), re-signed 2010-12-27, retired 2011-07-10 (a retirement
  is not a transaction). Recording the trade needs a sealed control observation (Lutz: no major-league record), which no rollback can remove. DISI
  therefore keeps the 1991-2009 interval it had, and the transaction queue keeps naming Castro's 2011 Dodgers season.
- **The other re-acquisitions the queue flags** (Hideo Nomo, Guillermo Mota, Dioner Navarro): the same pattern and the same sources, but none is a
  player in the primary workset. A later batch can record them.
- **Every cash, pool-space and future-consideration amount.** The Vizcaino trade's cash is recorded with a NULL amount.

## Historical problem cases

Offerman, Mondesi and Fernandez are primary players; their open downstream chains concern returned assets, not the season moves that block the
development need, and are unchanged. The Amoros / Harris chain, the Frias PTBNL-or-cash structure, the Abreu / Garland and Fernandez returned-player
WAR gaps do not intersect the workset.

## Value

Recording Vizcaino's 2000 trade extends his chain with a returned player whose Dodgers bWAR is not loaded: his decision row reads
`INCOMPLETE_WAR_NOT_LOADED` and `TO_DATE_CHAIN_INCOMPLETE` instead of `COMPLETE_TERMINAL`, and the package participation figure is NULL instead of
-0.10. MISSING BWAR != ZERO BWAR. The trade sent cash with him, so it is a shared package and nothing is individually attributed. No other decision,
exit summary, readiness or expected-value row changes.
