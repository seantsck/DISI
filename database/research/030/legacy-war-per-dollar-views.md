# Legacy WAR-per-dollar views: limitations (Migration 030)

Migration 030 does **not** change, rename or comment on any of these views. Their definitions are
byte-identical before and after 030 (pinned by `definition_md5` in `audit-report.json` and by
`tests/db/financial-030.test.mjs`). This note records what they measure and why their ratios are
not acquisition-cost efficiency.

| View | Ratio column(s) | Denominator |
|---|---|---|
| `v_signing_efficiency` | `career_war_per_million_bonus` | signing bonus only |
| `v_dodgers_signing_cohort`, `v_dodgers_signing_leaderboard`, `v_dodgers_asset_realization`, `v_signing_asset_outcomes` | `career_war_per_million_bonus` (per player) | signing bonus only |
| `v_dodgers_executive_kpis` | `avg_career_war_per_million_known_bonus` | average of per-player bonus-only ratios |
| `v_dodgers_executive_case_studies`, `v_dodgers_executive_dashboard_feed` | `identification_war_per_million` | signing bonus only |
| `v_dodgers_mature_bonus_tiers`, `v_dodgers_mature_premium_comparison`, `v_dodgers_mature_year_analysis` | `career_war_per_million_spent` | summed known bonuses of the tier / year |
| `v_dodgers_mature_player_analysis` | per-player ratios | signing bonus only |

## Limitations

1. **Bonus only.** Posting fees, transfer fees, release fees and other acquisition payments are
   ignored. A posted or transferred player's ratio overstates efficiency by construction.
2. **Known bonuses only, no completeness.** A signing with an unknown bonus drops out of the ratio
   rather than counting as unknown cost. The denominators therefore depend on which bonuses happen
   to be public. 030's `v_signing_acquisition_financials.acquisition_cost_completeness` exposes the
   gap; the legacy views do not.
3. **No provenance.** 83 of 89 known bonuses are legacy carry-forwards with no field-level source
   (`bonus_source_status = 'LEGACY_CANONICAL_ONLY'`). The ratios treat them as exact.
4. **Nominal dollars, no pool context.** No inflation adjustment and no pool regime. A 2015-16 dollar
   (100% overage tax, about $45M reported spend against a $700,000 pool after trades) is treated
   the same as a 2023 dollar under a hard cap. Overage tax is never included.
5. **Averages of ratios.** `avg_career_war_per_million_known_bonus` averages per-player ratios, so
   cheap players with any WAR dominate (values in the hundreds).
6. **WAR is cumulative and censored.** Recent classes have not had time to accrue it.

## Effect of 030's data change on their outputs

030 changes one canonical input these views read: Hyun-Jin Ryu's `signing_bonus_usd` becomes the
sourced $5,000,000 (and his posting fee the exact reported $25,737,737.33). The view definitions
are unchanged, but their outputs move:

| Output | Before 030 | After 030 |
|---|---|---|
| `v_dodgers_executive_kpis.signings_with_known_bonus` | 41 | 42 |
| `v_dodgers_executive_kpis.known_bonus_spend_usd` | 85,569,500 | 90,569,500 |
| `v_dodgers_executive_kpis.avg_career_war_per_million_known_bonus` | 709.290 | 662.273 |
| Ryu `career_war_per_million_bonus` (efficiency, leaderboard, ...) | NULL | 4.040 |
| `v_dodgers_mature_bonus_tiers` "$5M+" `career_war_per_million_spent` | 0.380 | 0.716 |

Ryu's 4.04 WAR per $M of bonus ignores the $25.7M posting fee. On his known acquisition cost
($30,737,737.33) the same 20.2 WAR is about 0.66 per $M. This is limitation 1 in practice. Anyone
reading these ratios should use `v_signing_acquisition_financials` for cost and completeness, and
treat the legacy ratios as bonus-only descriptive history, not ROI.

Other knock-on effect: `v_scouting_research_queue.SIGNING_WITHOUT_SIGNING_EVALUATION` moves from 41
to 42, because Ryu now has a publicly reported bonus and no signing-time evaluation.
