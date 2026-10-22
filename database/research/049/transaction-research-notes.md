# 049 transaction research: where each open chain and package stands

Sources: Retrosheet `tranDB.zip` and BIOFILE (read directly); the Chadwick Register (id crosswalk only); the official MLB Stats API (person records, transaction logs by
player and by club, season-by-season affiliations with each team's parent organization); SABR biographies of Versalles, Grant and Perranoski (raw HTML).
Baseball-Reference `war_daily_bat.txt` / `war_daily_pitch.txt` answered **403**: no WAR was loaded. Counts are recomputed from the database, not carried over from 047.

## The seven incomplete chains

| Signing | Before (048) | After (049) | What 049 found |
|---|---|---|---|
| Tony Abreu | `INCOMPLETE_RETURN_UNRECORDED` | `INCOMPLETE_WAR_NOT_LOADED` | transaction recorded (Garland; Abreu the player to be named later; Garland's free agency); value of Garland unknown |
| Chico Fernández | `INCOMPLETE_EXIT_NOT_RESEARCHED` | `INCOMPLETE_WAR_NOT_LOADED` | Miller's exit recorded (1967 trade), Grant's and Versalles's exits recorded (1968 expansion draft); their value unknown |
| Raúl Mondesí | `INCOMPLETE_EXIT_NOT_RESEARCHED` | unchanged | Muegge and Juárez identified (MLBAM ids); no exit stated anywhere readable |
| Hideo Nomo | `INCOMPLETE_EXIT_NOT_RESEARCHED` | unchanged | Checo, Garcia, Roberts: Garcia and Roberts identified; no exit stated for any of the three |
| Sandy Amorós | `INCOMPLETE_EXIT_NOT_RESEARCHED` | unchanged | Gail Harris: acquired 1960-05-07, no later transaction in any readable source; his last MLB game predates the trade |
| José Offerman | `INCOMPLETE_RETURN_UNRECORDED` | unchanged | Mike Judd's conditional deal names no return in either source: not zero, cash or no return |
| Carlos Frías | `INCOMPLETE_PENDING_CONSIDERATION` | unchanged | "player to be named or cash"; neither club's log records a delivery through 2018-03 |

Incomplete chains: **7**, now read as **5** with an open transaction history and **2** recorded to their end with the value of the returned players unknown.

## Every researched issue

| Subject | Result | Evidence / reason |
|---|---|---|
| Tony Abreu trade (2009): the consideration the Dodgers received | `RESOLVED_PACKAGE` | Jon Garland (agreement 2009-08-31); Abreu the player to be named later, delivered 2009-10-09. Official MLB log and Retrosheet 64131 agree on both dates. |
| Jon Garland: Dodgers value of the Abreu return | `TRANSACTION_KNOWN_VALUE_UNKNOWN` | Baseball-Reference WAR answers 403; the return is RETURN_WAR_UNKNOWN (NULL). Abreu was the only outgoing asset, so the trade is individually attributable once WAR is loaded. |
| Jon Garland: Dodgers exit | `RESOLVED_TRANSACTION` | Elected free agency 2009-11-05 (official MLB log; Retrosheet 18248). |
| Bob Miller: Dodgers exit (Fernandez chain) | `RESOLVED_TRANSACTION` | Traded 1967-11-28 to Minnesota (Retrosheet 60573; SABR Versalles, Grant and Perranoski biographies). |
| 1967 Dodgers-Twins package | `RESOLVED_PACKAGE` | Miller, Roseboro, Perranoski out; Grant, Versalles in. Identities matched by crosswalk and birth date. |
| Mudcat Grant: Dodgers exit | `RESOLVED_TRANSACTION` | 1968 expansion draft, Montreal, pick 36 (Retrosheet 19808; SABR Grant biography). |
| Zoilo Versalles: Dodgers exit | `RESOLVED_TRANSACTION` | 1968 expansion draft, San Diego, pick 20 (Retrosheet 54511; SABR Versalles biography). |
| Mudcat Grant and Zoilo Versalles: Dodgers value | `TRANSACTION_KNOWN_VALUE_UNKNOWN` | Baseball-Reference WAR answers 403; value NULL, not zero. |
| 1967 trade date | `CONFLICT` | Retrosheet and the SABR Perranoski biography say November 28; the SABR Versalles biography says November 27. Retrosheet's date is recorded and the disagreement is in the description. |
| Apostol Garcia, Rick Roberts, Danny Muegge, William Juarez | `RESOLVED_TRANSACTION` | MLB ids added; reconciled by affiliations whose parent organizations bracket the trade. No exit recorded. |
| Gail Harris (LAD_DET_1960_AMOROS) | `UNRESOLVED_NO_EVIDENCE` | Retrosheet (60183) records only the 1960-05-07 trade to the Dodgers; his last MLB game (1960-05-03) predates it. The MLB transaction log does not reach 1960 and the SABR page body is not in the raw response. No Dodgers disposition is stated anywhere readable: no exit is inferred. |
| Robinson Checo (LAD_DET_1999_DAVE_MLICKI) | `UNRESOLVED_NO_EVIDENCE` | Retrosheet ends at the 1999-04-16 trade to the Dodgers; the official affiliations (parent organization read from each team record) show his last Dodgers-organization season is 2000 (Albuquerque Dukes) and nothing after. Disappearance is not a release. |
| Apostol Garcia (LAD_DET_1999_DAVE_MLICKI) | `PARTIALLY_RESOLVED` | Identity reconciled (MLBAM 472796). Retrosheet lists him by name only with no later transaction; his last Dodgers-organization season is 2000 (San Antonio Missions). No exit stated. |
| Rick Roberts (LAD_DET_1999_DAVE_MLICKI) | `PARTIALLY_RESOLVED` | Identity reconciled (MLBAM 425540). His last Dodgers-organization season is 2003 (Las Vegas 51s). No exit stated. |
| Danny Muegge (LAD_ARI_2005_SHAWN_GREEN) | `PARTIALLY_RESOLVED` | Identity reconciled (MLBAM 458260). His last Dodgers-organization season is 2008 (Jacksonville Suns). The MLB transaction log has no row for him. No exit stated. |
| William Juárez (LAD_ARI_2005_SHAWN_GREEN) | `PARTIALLY_RESOLVED` | Identity reconciled (MLBAM 452705). The official log shows him activated by Las Vegas on 2006-04-04 and his last Dodgers-organization season is 2007 (Jacksonville Suns); 2008 is a Mexican League club. No transaction ends his Dodgers control in any readable source. |
| Mike Judd (LAD_TB_2001_MIKE_JUDD) | `UNRESOLVED_NO_EVIDENCE` | Both Baseball-Reference and Retrosheet describe a conditional deal that names no return. An unnamed conditional return is not zero, cash or no return. |
| Carlos Frías (LAD_CLE_2017_CARLOS_FRIAS) | `UNRESOLVED_NO_EVIDENCE` | Retrosheet (76439: "player to be named or cash") and the official MLB log ("for Player To Be Named Later", 2017-01-30) agree it was a deferred consideration. Neither club's log through 2018-03 records a delivery (6 Cleveland/Dodgers rows read). It may have been cash; DISI does not assume cash, a player or zero. |
| Jeral Perez trade (player to be named later or cash considerations) (LAD_CWS_2024_JERAL_PEREZ) | `UNRESOLVED_NO_EVIDENCE` | The official log (2024-07-29) names a player to be named later or cash considerations. The Dodgers and White Sox logs through 2026-10-21 record no completion. |
| Future considerations (LAD_STL_2019_TONY_CINGRANI) | `PARTIALLY_RESOLVED` | Retrosheet (82425) describes the Cardinals side of this package as cash and "international bonus slot money" where the MLB log says cash and future considerations. No amount or named item is given. Recorded as a description, not as a value. |
| Future considerations (LAD_CIN_2025_ARNALDO_LANTIGUA) | `UNRESOLVED_NO_EVIDENCE` | The official log names future considerations and no completion is recorded through 2026-10-21. |
| Future considerations (LAD_CWS_2023_MAXIMO_MARTINEZ) | `UNRESOLVED_NO_EVIDENCE` | The official log names future considerations and international signing bonus slot money with no amount. |
| International signing bonus slot money (LAD_CWS_2023_MAXIMO_MARTINEZ) | `UNRESOLVED_NO_EVIDENCE` | No source states the amount; DISI does not estimate pool space. |
| Cash (16 packages) | `UNRESOLVED_NO_EVIDENCE` | Retrosheet marks cash with "$" and no amount for every one of the sixteen packages; the MLB log says "cash". No amount is stated in any readable source. An unnamed cash payment is not $0. |

## Counts by layer

- **Transaction evidence:** chains researched 7; exits recorded 3 (Garland, Grant, Versalles) plus the Miller exit; packages reconstructed 2 (Abreu / Garland, 1967); player-to-be-named resolved 1 (Abreu); consideration resolved 0; still unknown: every other item above.
- **Value evidence:** Baseball-Reference rows reused 0 (none of Garland, Grant, Versalles has team-season rows); newly loaded 0 (files answer 403); `RETURN_WAR_UNKNOWN` 1 trade edge (Garland) and 2 downstream intervals (Grant, Versalles); timing unresolved 0; package value newly known 0.
- **Attribution:** individually attributable cases newly resolved 0; package-level-only cases unchanged (13); cases still NULL: Abreu (one outgoing asset, WAR unknown) and the shared-package signings (26).

## Packages with an open issue (21 to 20)

Membership open 6 to 5 (the Abreu return recorded); only terms open 15 (unchanged: sixteen cash packages and one pool-space amount, none of which any readable source states). `packages_with_open_issues_by_issue`: cash 16, future considerations 3, player to be named 2, pool space 1, return unrecorded 1 to 0. Issue counts overlap and are not added.

## The one published figure that moves

Abreu's return was unrecorded, which the realized-value views read as a `0.00` individually attributable return, so his organizational value counted as resolved (1.23 bWAR). Now that the return is recorded (Garland) and his WAR is unknown, the existing `RETURN_WAR_UNKNOWN` rule makes his organizational value `VALUE_UNRESOLVED`: `signings_with_resolved_value` 88 to 87, `realized_direct_dodgers_bwar` 284.00 to 282.77, `realized_org_value_bwar` 298.83 to 297.60. His direct Dodgers value (1.23) is unchanged and still shown separately; nothing else moves.
