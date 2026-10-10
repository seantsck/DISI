# Migration 032: proof cohort (read from the database)

Facts are values of `v_player_organizational_realization` after 032. "NULL" means unknown or not attributable, never zero.

| Player | Signed | Pathway | Cost (completeness) | Career bWAR | Direct Dodgers | Non-Dodgers | Package return | Individual return | Attributable | Status | Maturity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| andy-pages | 2017 | CUBAN_AMATEUR | 300000.00 (COMPLETE) | 10.900 | 10.92 | 0 | NULL | NULL | 10.92 | DIRECT_DODGERS_MLB_VALUE | MATURE |
| carlos-frias | 2007 | LATAM_AMATEUR | NULL (UNKNOWN) | -0.300 | -0.34 | 0 | NULL | NULL | -0.34 | DIRECT_DODGERS_MLB_VALUE | MATURE |
| hyun-jin-ryu | 2012 | POSTED_PLAYER | 30737737.33 (COMPLETE) | 20.200 | 15.13 | 5.06 | NULL | NULL | 15.13 | DIRECT_DODGERS_MLB_VALUE | MATURE |
| josue-de-paula | 2022 | LATAM_AMATEUR | 397500.00 (COMPLETE) | 0.500 | 0.46 | 0 | NULL | NULL | 0.46 | DIRECT_DODGERS_MLB_VALUE | RECENT |
| julio-urias | 2012 | MEXICAN_LEAGUE_TRANSFER | 450000.00 (PARTIAL) | 13.800 | 13.80 | 0 | NULL | NULL | 13.80 | DIRECT_DODGERS_MLB_VALUE | MATURE |
| keibert-ruiz | 2014 | LATAM_AMATEUR | 140000.00 (COMPLETE) | 6.900 | 0.06 | 6.88 | NULL | NULL | 0.06 | DIRECT_DODGERS_MLB_VALUE | MATURE |
| kenley-jansen | 2004 | LATAM_AMATEUR | 85000.00 (COMPLETE) | 24.900 | 18.89 | 5.98 | NULL | NULL | 18.89 | DIRECT_DODGERS_MLB_VALUE | MATURE |
| omar-estevez | 2015 | CUBAN_AMATEUR | 6000000.00 (COMPLETE) | NULL | 0 | 0 | NULL | NULL | 0 | NO_MLB_VALUE_OBSERVED | MATURE |
| oneil-cruz | 2015 | LATAM_AMATEUR | 950000.00 (COMPLETE) | 8.200 | 0 | 8.17 | 0.40 | NULL | 0 | MLB_ELSEWHERE_ONLY | MATURE |
| roberto-clemente | 1954 | LATAM_AMATEUR | 10000.00 (COMPLETE) | 95.000 | 0 | 94.96 | NULL | NULL | 0 | MLB_ELSEWHERE_ONLY | MATURE |
| roki-sasaki | 2025 | POSTED_PLAYER | 6500000.00 (PARTIAL) | 1.100 | 1.14 | 0 | NULL | NULL | 1.14 | DIRECT_DODGERS_MLB_VALUE | RECENT |
| ronny-brito | 2015 | LATAM_AMATEUR | 2000000.00 (COMPLETE) | NULL | 0 | 0 | NULL | NULL | 0 | NO_MLB_VALUE_OBSERVED | MATURE |
| starling-heredia | 2015 | LATAM_AMATEUR | 2600000.00 (COMPLETE) | NULL | 0 | 0 | NULL | NULL | 0 | NO_MLB_VALUE_OBSERVED | MATURE |
| yadier-alvarez | 2015 | CUBAN_AMATEUR | 16000000.00 (COMPLETE) | NULL | 0 | 0 | NULL | NULL | 0 | NO_MLB_VALUE_OBSERVED | MATURE |
| yordan-alvarez | 2016 | CUBAN_PRO | 2000000.00 (COMPLETE) | 30.900 | 0 | 30.90 | 1.94 | 1.94 | 1.94 | MLB_ELSEWHERE_ONLY | MATURE |
| yusniel-diaz | 2015 | CUBAN_PRO | 15500000.00 (COMPLETE) | 0.000 | 0 | -0.03 | 2.58 | NULL | 0 | MLB_ELSEWHERE_ONLY | MATURE |

## Reading the cases

- **Oneil Cruz** ($950,000, COMPLETE): zero Dodgers MLB value, 8.17 bWAR for other organizations, traded with Angel German; the package returned Tony Watson (0.40 Dodgers bWAR) and Cruz's individual share is NULL. His career outcome is strong; the Dodgers' realization from it is small. It is not a failed signing.
- **Yordan Alvarez** ($2,000,000, COMPLETE): zero Dodgers MLB value, 30.90 bWAR for Houston, the sole outgoing player for Josh Fields (1.94 Dodgers bWAR), so the return is individually attributable. Attributable organizational value is 1.94 (0.970 per $1M); his Houston WAR is never credited to Los Angeles.
- **Hyun-Jin Ryu** ($30,737,737.33, COMPLETE): 15.13 bWAR for the Dodgers and 5.06 for Toronto; the cost-aware metric uses the complete acquisition cost, not the $5M bonus.
- **Yusniel Diaz** ($15,500,000, COMPLETE): one of five outgoing players for Manny Machado; package 2.58, individual share NULL.
- **Josue De Paula** and **Roki Sasaki**: recent signings with Dodgers bWAR so far; maturity RECENT, no ratio. Sasaki's cost is PARTIAL (the posting-fee conflict).
- **Julio Urias**: 13.80 Dodgers bWAR with PARTIAL cost ($450,000 transfer fee known): no ratio.
- **Starling Heredia, Yadier Alvarez, Omar Estevez, Ronny Brito**: audited career ended, mature, no MLB value observed, cost COMPLETE.
