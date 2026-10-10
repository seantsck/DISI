# Migration 032: legacy value ratios versus the new definitions

The legacy views are unchanged. The numbers differ because the definitions differ.

| Question | Legacy | 032 |
|---|---|---|
| Whose WAR? | whole-career WAR, whoever the player played for | WAR produced for the Dodgers (direct) plus an individually attributable trade return |
| Cost | signing bonus only | known acquisition cost, COMPLETE only |
| Aggregate | `AVG(career_war / bonus)` over players with a known bonus (executive KPI 662.273) | `SUM(value) / SUM(cost)` over the same eligible rows |
| Recent signings | included | excluded from ratios (maturity gate) |
| Trade return | not represented | one hop, package-level unless sole outgoing |

## Portfolio (all tracked Dodgers signings)

- Eligible rows (mature, COMPLETE cost, outcome observed): 26; known cost $98852237.33; direct Dodgers bWAR 96.60.
- **Aggregate direct Dodgers bWAR per $1M: 0.977**; attributable organizational: 0.997.
- The legacy average of per-player ratios is 662.273. It is dominated by tiny denominators (a $10,000 bonus with 95 career WAR alone contributes 9,500 per $1M) and credits the Dodgers with WAR produced for other clubs.
- Non-Dodgers MLB bWAR observed for these signings: 432.44 (a career-outcome fact, never credited).

By era (small eligible samples are flagged):

| Era | Signed | Mature | Eligible | Eligible cost | Direct bWAR | Direct per $1M | Small sample |
|---|---|---|---|---|---|---|---|
| 2000-2011 | 11 | 11 | 1 | 85000.00 | 18.89 | 222.235 | true |
| 2012-2017 | 30 | 30 | 19 | 89917237.33 | 43.91 | 0.488 | false |
| 2018 and later | 158 | 36 | 3 | 5640000.00 | 0 | 0.000 | true |
| Before 2000 | 21 | 21 | 3 | 3210000.00 | 33.80 | 10.530 | true |

## Legacy outputs that moved because the facts were reconciled

- `v_dodgers_executive_kpis.observed_total_career_war` rose by 1.4 (Frias -0.3 and Cedeno +1.7 backfilled into `outcomes.career_war`). The average ratio is unchanged because neither player has a known cost.

## Classification of the legacy views

| Views | Class |
|---|---|
| `v_signing_efficiency`, `v_dodgers_signing_cohort`, `v_dodgers_signing_leaderboard`, `v_signing_asset_outcomes`, `v_dodgers_asset_realization` | SUPERSEDED by `v_player_organizational_realization` (retained) |
| `v_dodgers_executive_kpis`, `_v2` | retained unchanged; the new aggregate is in `v_dodgers_international_value_portfolio` |
| `v_dodgers_mature_bonus_tiers`, `_premium_comparison`, `_year_analysis`, `_player_analysis` | retained; bonus-only, whole-career WAR |
| `v_dodgers_trade_package_conversion`, `v_dodgers_competitive_asset_conversion` | retained; hand-entered return WAR superseded by `v_trade_realization_edges` |
