# Migration 031: effects on existing outputs

No existing view definition changes except `v_signing_acquisition_financials` (030's own view, resolution-aware, one column appended). The legacy WAR-per-dollar, KPI, mature-sample and bonus-efficiency definitions are byte-identical. Their outputs change because the data changed, as with Ryu in 030.

## Measured on a replay (031 applied over 030)

| Output | Before | After |
|---|---|---|
| Known bonuses (all signings) | 89 | 93 |
| Known bonuses (Dodgers) | 42 | 46 |
| `v_dodgers_executive_kpis.signings_with_known_bonus` | 42 | 46 |
| `known_bonus_spend_usd` | 90,569,500 | 91,069,500 (+$525,000 new bonuses, -$25,000 Rincon correction) |
| `avg_career_war_per_million_known_bonus` | 662.273 | 662.273 (the new bonuses carry no WAR) |
| `v_scouting_research_queue.SIGNING_WITHOUT_SIGNING_EVALUATION` | 42 | 46 |
| Externally sourced bonuses | 6 | 24 |

The 17 legacy WAR / KPI / mature / cohort / efficiency views whose rows change (data propagation, not definition changes): `v_dodgers_asset_realization`, `v_dodgers_executive_findings_v2`, `v_dodgers_executive_kpis`, `v_dodgers_executive_kpis_v2`, `v_dodgers_mature_asset_realization`, `v_dodgers_mature_bonus_tiers`, `v_dodgers_mature_executive_findings`, `v_dodgers_mature_player_analysis`, `v_dodgers_mature_premium_comparison`, `v_dodgers_mature_tracked_sample`, `v_dodgers_mature_year_analysis`, `v_dodgers_portfolio_signals`, `v_dodgers_portfolio_universe`, `v_dodgers_signing_cohort`, `v_dodgers_signing_leaderboard`, `v_signing_asset_outcomes`, `v_signing_efficiency`.

## Financial views

- `v_financial_research_queue`: POOL_CAPACITY_UNKNOWN 5 -> 0; FINANCIAL_SOURCE_MISSING 90 -> 75; SIGNING_BONUS_UNKNOWN 74 -> 72; POOL_TREATMENT_UNKNOWN 113 -> 114 (Soto gains a signal); CLASS_FINANCIAL_COVERAGE_INCOMPLETE 9 -> 13 (four added periods become visible).
- `v_dodgers_financial_commitment_by_class`: four added periods and a pool for 2017-18. Tracked-bonus percentages remain labelled "not utilization"; one known bonus against a small pool (2012-13) gives a small, uninformative share.
- Acquisition completeness (Dodgers): COMPLETE 41 -> 44, UNKNOWN 129 -> 126.
