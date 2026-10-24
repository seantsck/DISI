# 054 research notes

## The workset

The 16 development needs 053 left `TRANSACTION_BLOCKED` (Santana, Park, Fernandez, Cartaya, Leonard, Valenzuela, Valdez, Offerman, Vizcaino,
Castro, Guzman, Garcia, Daal, Astacio, Mondesi, Puig) hold 33 open transitions; each was checked and none involves the Dodgers
(`workset.json`). 12 of them have game-dated stints on both sides (`transition-workset.json`).

## What the sources state

| Transition class | Seasons | Recorded |
|---|---|---|
| Direct move between the two clubs (trade, conditional deal, waiver claim, purchase) | 21 | one row each |
| Release, then a signing by the other club | 10 | two rows each (never a synthetic trade) |
| Through a third club the same day (Fernandez 1963: Detroit -> Milwaukee -> New York) | 1 | two trades |
| Three organizations in one season (Castro 2008) | 1 | three rows (Cincinnati release, Colorado signing, Colorado -> Baltimore trade) |

The official MLB transaction log covers the seasons from about 2009 (Santana 2022-2026, Park 2010, Cartaya 2025, Leonard 2026, Puig 2019); Retrosheet
the earlier ones. An affiliate in the log resolves through its official parent that season (St. Paul released Cartaya: Minnesota; Nashville released
Leonard: Milwaukee). Puig's 2019 move is a three-team trade (Cincinnati, San Diego, Cleveland); his row is Cincinnati -> Cleveland as the log states.

## What closes, and what does not

- **Closed (4 needs):** Santana (2022 trade, 2023 trade, 2025 and 2026 release then signing; 2008 was already the Dodgers trade), Cartaya (Minnesota
  release 2025-07-23, San Francisco signing 2025-07-29), Leonard (Milwaukee release 2026-07-16, San Francisco signing 2026-07-24, his first Giants
  game the same day), Puig (Cincinnati -> Cleveland 2019-07-31).
- **Source-limited (11 needs):** the recorded moves of Park 2005, Fernandez, Valenzuela, Valdez, Offerman, Vizcaino 1996, Guzman, Garcia, Daal,
  Astacio and Mondesi fall in seasons before dated game logs: the transaction is known, the appearances that would bracket it are not. Park 2007 and
  2010 and Vizcaino 2006 are bracketed, but each need has an earlier source-limited season.
- **A person decides (1 need):** Castro 2008. The game log places him with Baltimore from 2008-04-28, overlapping his Colorado Springs stint
  (05-05 to 07-14), while Retrosheet records a Cincinnati release on 05-02, a Colorado signing on 05-04 and a trade to Baltimore on 07-19. The dated
  record and the transaction record disagree; no order can be read. The 054 rule names the overlap (`APPEARANCE_RANGES_OVERLAP`) on the rows alone;
  his 2006 Minnesota -> Cincinnati trade is bracketed.

## Kept apart

- A career move never touches the Dodgers ledger: Cartaya's January 2025 trade to Minnesota stays the Dodgers ledger's; his Minnesota release and
  San Francisco signing are career history. The dossier says "career history ... not part of the Dodgers asset history".
- Only the rows that state the transition are recorded: no earlier signing (Santana's February 2026 Arizona signing) and no later free agency.
  ONE KNOWN MOVE != COMPLETE CAREER: the layer is a chronology layer for these transitions, not a career transaction history of any player.
- Hideo Nomo's 1999 and 2005 two-club seasons are outside the workset (his need is the Bakersfield co-op club, source-limited) and stay open.
