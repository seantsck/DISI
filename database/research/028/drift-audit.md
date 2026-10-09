# Residual canonical drift audit (Migration 028)

Read-only comparison of live (after Migration 027, verifier 112/112) against a fresh 001 → 027 replay, 2026-10-09.
After 027 the public views still differed substantively in exactly two reviewed places. Every other difference
(`initcap()` capitalisation, floating-point formatting, WAR observed-through dates, retrieval / access timestamps,
environment-specific UUIDs) is non-semantic and is deliberately left alone.

I also compared `signing_populations` (17), `signing_population_members` (316), `signing_population_member_sources` (409) and `transactions` (5) row by row on stable
keys: all rows match except the four below.

| # | Fact | Live | Frozen chain (target) |
| --- | --- | --- | --- |
| 1 | Yusniel Díaz trade (Dodgers → Baltimore Orioles, 2018-07-19) `return_description` | `Traded in five-player package to Baltimore Orioles for SS Manny Machado` | `Traded as part of a five-player package to Baltimore Orioles for SS Manny Machado` |
| 2-4 | `DODGERS-2018-OPENING` class-membership source links (Alex De Jesús, Diego Cartaya, Jerming Rosario) citing the Cartaya article | `confidence = VERIFIED` | `confidence = HIGH` |

## Why HIGH

In a replay, 018 derives these three links from the 002 evidence for the Cartaya article, which is `HIGH`. On live, where 002 never ran,
018 produced `VERIFIED`. Nothing shows that live's `VERIFIED` was a separately adjudicated upgrade, so the value produced by the frozen
chain is the target. The link's source, membership basis, supported fields and note are unchanged.

## Views changed by the drift

Wording: `v_dodgers_asset_realization`, `v_dodgers_executive_case_studies`, `v_dodgers_mature_asset_realization`, `v_signing_asset_outcomes`.
Confidence: `v_player_sources`. `audit.mjs` finds these empirically by applying the live values inside a rolled-back transaction;
`v_player_timeline` also differed after 027, but only through the documented WAR observed-through date.

## After 028

Exactly five public views are substantively affected and converge: `v_dodgers_asset_realization`, `v_dodgers_executive_case_studies`,
`v_dodgers_mature_asset_realization`, `v_signing_asset_outcomes` and `v_player_sources`. `v_player_timeline` is not a 028 target; its remaining
difference is the separately documented WAR observed-through-date noise.

After 028 there are no known substantive live / replay differences. The remaining known differences are non-semantic only: engine-specific
`initcap` capitalisation, floating-point representation, observed-through dates, retrieval / access timestamps and environment-specific UUIDs.
