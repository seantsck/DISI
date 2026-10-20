# 047 transaction research: where each 046 blocker stands

Source: Retrosheet's transactions database (`tran.txt`, read directly; goes through 2022) cross-read with the official MLB transaction log and the
MLB person record for identity (name **and** exact birth date). Counts are recomputed from the database, not carried over from 046.

## The nine incomplete chains

`chain_status` describes the players the Dodgers *received*, so each row below is about those players' exits and returns.

| Signing | 046 | 047 | What 047 found, and what is still needed |
|---|---|---|---|
| Yasiel Puig | `INCOMPLETE_EXIT_UNRECORDED` | **`STILL_ACTIVE`** | Homer Bailey's exit recorded (released 2018-12-22, Retrosheet 81460). Every other branch is recorded or still held (the Jeter Downs line reaches players still under Dodgers control) |
| Rubby De La Rosa | `INCOMPLETE_EXIT_UNRECORDED` | **`STILL_ACTIVE`** | Nick Punto's exit recorded (free agency 2013-10-31, Retrosheet 67232) |
| Raúl Mondesí | `INCOMPLETE_EXIT_NOT_RESEARCHED` | unchanged | Steve Finley, Brent Mayne (free agency 2004) and Beltrán Pérez (2005) recorded. Still open: Danny Muegge and William Juárez (2005 minor-league assets; Retrosheet lists them by name only, with no later transaction) |
| Hideo Nomo | `INCOMPLETE_EXIT_NOT_RESEARCHED` | unchanged | Open: Robinson Checo (no exit in the source), Apostol Garcia and Rick Roberts (name only / absent). Retrosheet has no record of the 1998 Nomo trade itself; DISI's rests on the official MLB log |
| Sandy Amorós | `INCOMPLETE_EXIT_NOT_RESEARCHED` | unchanged | Open: Gail Harris. Retrosheet records only the 1960-05-07 trade to the Dodgers; his last MLB game (1960-05-03) predates it. No exit is inferred |
| Chico Fernández | `INCOMPLETE_EXIT_NOT_RESEARCHED` | unchanged | Bob Miller's exit **found** (1967-11-28 to Minnesota, with Johnny Roseboro and Ron Perranoski for Mudcat Grant and Zoilo Versalles; Retrosheet 60573) and **not recorded**: Grant and Versalles would be new assets whose Dodgers-tenure bWAR cannot be loaded while the Baseball-Reference WAR files answer 403 |
| José Offerman | `INCOMPLETE_RETURN_UNRECORDED` | unchanged | Mike Judd's exit is recorded; Retrosheet lists it as a conditional deal naming no return. The return stays unknown, not zero |
| Tony Abreu | `INCOMPLETE_RETURN_UNRECORDED` | unchanged | **Return found, not recorded.** Retrosheet files one transaction (64131): Arizona sent Jon Garland to the Dodgers on 2009-08-31, and Abreu was the player to be named later, delivered 2009-10-09. DISI's event carries only the completion date and no return. Recording it means re-dating the event to 2009-08-31 with a PTBNL resolution (a forward-only correction) and loading Garland's bWAR |
| Carlos Frías | `INCOMPLETE_PENDING_CONSIDERATION` | unchanged | Retrosheet (76439) lists the 2017-01-30 return only as "player to be named or cash". It may have been cash; it is neither resolved nor valued |

Incomplete chains: **9 -> 7**. The five recorded exits closed intervals whose bounded Dodgers bWAR did not move (Finley 1.43, Mayne -0.41,
Pérez 0, Punto 2.33, Bailey 0).

## Package verification

The packages DISI already records for the Offerman, Mondesí, Amorós, 1957 Fernández and 1962 Miller trades agree with Retrosheet's membership,
piece for piece, including the $75,000 cash and the player to be named later resolved on 1957-04-08. A disagreement would have been kept as
a conflict, not overwritten.

## Counts recomputed from the database

- Signings in shared packages whose return is credited to no one player: **26** (unchanged; 047 touched no attribution).
- Trade packages with an open issue: **21** (cash amount unknown 16, future considerations 3, player to be named 2, pool space 1, return
  unrecorded 1). Unchanged.
- Transaction queue **64 -> 59**, value queue **93 -> 91**.

## What this means for attribution

047 resolved no attribution case and changed no attributed amount. Value attribution needs a complete package and loaded team-season bWAR for
every returned player; the missing piece for four of the cases above (Miller, Abreu / Garland, Muegge, Juárez) is the blocked
Baseball-Reference WAR data, not the transaction record.
