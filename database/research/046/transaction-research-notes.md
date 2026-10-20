# 046 transaction and value attribution: findings (nothing recorded)

046 audited the transaction chain model and its open work. It recorded **no new transaction event**: completing a chain is a
Migration 033/034 task (exit event, its assets with stable identities, the return's team-season bWAR and the downstream hops), and doing it
from one transaction sentence would be inference. This file keeps what the audit found so the next transaction phase starts ordered.

## The model, as it stands (production, read through the `anon` role on 2026-10-20)

- 220 tracked signings: `NO_TRADE_CHAIN` 175, `COMPLETE_TERMINAL` 28, `STILL_ACTIVE` 8, **incomplete 9**.
- `v_transaction_research_queue` 64 items (11 issues) and `v_value_research_queue` 98 items (5 issues); `research:transactions` lists them in a
  fixed order, and `research:queue` classifies what each blocks.
- Trade value is attributed only at package level unless the signing was the sole outgoing asset: 8 signings have a non-zero individually
  attributable return, 28 a non-zero first-hop package participation, 3 a downstream one and 12 observable-but-not-attributable value.
  Zero is a known "no value"; NULL is "not determined".

## The nine incomplete chains

| Player | Chain status | What the MLB transaction API shows (read 2026-10-20) | What completes it |
|---|---|---|---|
| Yasiel Puig (2012) | exit unrecorded | 2018-12-21 TR: Puig, Matt Kemp, Alex Wood, Kyle Farmer and cash to the Reds for Homer Bailey, Jeter Downs and Josiah Gray | one package event; the three returned players are first-hop assets whose own exits and bWAR the 033/034 audit must load |
| Rubby De La Rosa (2007) | exit unrecorded | 2012-10-04 TR: De La Rosa and Jerry Sands to the Red Sox (the text names no return) | the return side of that package from a second source |
| Carlos Frías (2007) | pending consideration | 2017-01-30 TR to Cleveland for a player to be named later | the PTBNL's identity and date |
| Tony Abreu (2002) | return unrecorded | 2009-10-09 TR to Arizona (the text names no return) | the return side of the trade |
| José Offerman (1986) | return unrecorded | no Dodgers-era transactions in the API | an older-era source (Retrosheet / Baseball-Reference Bullpen) |
| Hideo Nomo (1995), Raúl Mondesí (1988), Sandy Amorós (1951), Chico Fernández (1951) | exit not researched | the API returns no transactions | an older-era source for the exit event |

Nothing above is recorded as a fact in DISI. Each cell is a pointer to where the next phase should read.

## Why none was completed in 046

1. Four exits predate the API's transaction history, so there is nothing structured to read.
2. Puig's package returns three players whose chains must be followed; a partial record would change the 034 downstream states without
   the audit that proves them.
3. Two returns are not named in the only structured text, and a return is never taken from search results or memory.
