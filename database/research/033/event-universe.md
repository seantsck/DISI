# The 033 transaction universe

Sources: the official MLB Stats API transaction log (`statsapi.mlb.com/api/v1/transactions`, 2009 onward; per-player logs for
every tracked signing and every return asset) and the Baseball-Reference team-year transaction pages for earlier seasons
(`teams/LAD/YYYY-transactions.shtml`, `teams/BRO/YYYY-transactions.shtml`). Search snippets and encyclopedia summaries were not used
as evidence.

## Events

| Normalized type | Events |
|---|---|
| TRADE | 48 |
| RELEASE | 84 |
| FREE_AGENCY | 26 |
| RULE5_SELECTION | 1 (Clemente, 1954-11-22) |
| EXPANSION_DRAFT | 1 (Karim Garcia, 1997-11-18) |
| WAIVER | 1 (Elian Herrera, 2013-11-04) |
| **Total** | **161** |

By role: **140** events send a tracked signing out of Dodgers control (144 tracked outgoing player rows: 3 events carry more
than one tracked player); **1** brings a tracked signing back (Ismael Valdez reacquired 2000-07-26); **20** are exits of
first-hop return assets (6 trades, 4 releases, 10 free agencies; two further return-asset exits - Josiah Gray and Trey Sweeney -
are already part of tracked events). Three events pre-existed in the database (Alvarez / Fields, Cruz / Watson, Diaz /
Machado); 158 are new.

Phase 1B described the first group as "141 tracked-player exit events"; one of those 141 is the Valdez reacquisition, which is an
entry, not an exit.

## The 220-player partition

| State | Players |
|---|---|
| Left Dodgers control (recorded exit event) | 138 |
| Verified still Dodgers-controlled (dated observation) | 64 |
| No exit evidence (last Dodgers record before 2026) | 16 |
| History unavailable (Julian Leon, Lenix Osuna) | 2 |
| **Total** | **220** |

First verified exit mechanism of the 138: TRADE 45, RELEASE 77, FREE_AGENCY 13, RULE5_SELECTION 1, EXPANSION_DRAFT 1, WAIVER 1.
Six players have a second exit (Valdez, De La Rosa, Diaz, Herrera, Baez, Troncoso).

Free agency is an event only where it ended Dodgers control. Not events: Ryu 2018 (accepted the qualifying offer),
Jansen 2016 (re-signed), Christian Suarez 2025-11-06 (re-signed 39 days later), Frasso 2025-11-21 (re-signed; he was later
traded). Events: Baez 2020-10-28 (he signed with Houston; his later Dodgers return is a new acquisition), Ryu 2019, Jansen 2021.

## Assets

| Type | Count | Notes |
|---|---|---|
| PLAYER | 266 | 145 with a DISI player_id (144 tracked outgoing + Valdez incoming), 257 with an MLB id, 150 with a Baseball-Reference id, 9 with a Register id; none without an identity |
| CASH | 15 | 2 with a sourced amount (Clemente $4,000, Fernandez $75,000), 13 unknown |
| PLAYER_TO_BE_NAMED | 6 | 4 resolved (Boston x2, Fernandez, Valdez 1999), 2 unresolved (Frias 2017, 2024 PTBNL-or-cash) |
| FUTURE_CONSIDERATIONS | 3 | Lantigua, Batista / Martinez, the 2019 Cardinals deal; none resolved in public sources |
| INTERNATIONAL_BONUS_POOL_SPACE | 1 | 2023-08-04, source wording "International Signing Bonus Slot Money", amount unknown |
| **Total** | **291** | |

Phase 1B estimated 290 assets, 265 PLAYER, 11 CASH. The differences are real: Brian Stephenson (the 1999 Valdez PTBNL,
resolved) adds one PLAYER; the six return-asset trades add four CASH and one FUTURE_CONSIDERATIONS.

## Multi-team: 2024-07-29

Dodgers outgoing: Vargas, Albertus, Jeral Perez and "a player to be named later or cash considerations" (to Chicago, White Sox).
Dodgers incoming: Kopech (from Chicago), Edman and Oliver Gonzalez (from St. Louis). The White Sox -> Cardinals leg (Fedde, Pham,
cash) never entered or left Dodgers control and has no asset rows.

## Return-package states (trades with a tracked outgoing asset)

LOADED 40, NO_MLB_APPEARANCE_OBSERVED 13, NO_PLAYER_RETURN 4 (Leonard, Campos, Batista / Martinez, Lantigua),
PLAYER_RETURN_PENDING 1 (Frias), RETURN_UNRECORDED 1 (Abreu), TIMING_UNRESOLVED 3 (Valo 1957, Edman 2024, McDermott 2026).

## Date correction

Diaz / Machado: the official log dates the trade 2018-07-18; DISI carried 2018-07-19, the press release's publication date.
Both `transaction_events` and the legacy `transactions` row are corrected forward-only with evidence; the press-release source
keeps its own publication date. The 2018-07-19 box-score standings snapshot cited by `transaction_competitive_context` is a
separate fact and is untouched.
