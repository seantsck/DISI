# Migration 031: source audit

Reviewed 2026-10-09. Every page below was fetched once (HTTP 200) and parsed as raw HTML; no summarising fetch tool is the basis of any stored value. Facts are DISI paraphrases. MLB.com answered HTTP 406 and True Blue LA HTTP 403; neither is used and nothing was worked around.

| Source | Date | Supports |
|---|---|---|
| MLB Trade Rumors, "Dodgers Sign Julio Urias" | 2012-08-23 | Dodgers' 2012-13 pool, "$2.9MM" (BASE_POOL, ROUNDED, precision $100,000) |
| MLB Trade Rumors, "Dodgers, Cubs Swap Guerrier, Marmol" | 2013-07-02 | Dodgers' 2013-14 pool $2,112,900 (BASE_POOL, EXACT); a $209,700 slot value traded; no post-trade figure printed |
| Dodgers Digest, first-day 2014-15 signings | 2014-07-03 | 2014-15 pool $1,963,800 (single fan-site outlet, MEDIUM confidence) |
| Baseball America, "2017-18 International Bonus Pools" | 2016-12-06 | Dodgers in the $4.75 million tier, asterisked penalty team, $300,000 cap (ROUNDED, precision $10,000; a tier label) |
| Baseball America, "2020-21 MLB International Bonus Pools" | 2020-06-15 | $5,348,100 for 12 teams including the Dodgers; period Jan 15 - Dec 15, 2021; pool trading prohibited |
| MLB Trade Rumors, "2020-2021 International Signing Period Opens Today" | 2021-01-15 | the same $5,348,100 for the Dodgers (corroboration) |
| Baseball America, 2021-22 pools | 2022-01-11 | Dodgers $4,644,000 (the post-penalty effective allocation) |
| MLB Trade Rumors, "Bonus Pools For 2021-22 ..." | 2022-01-11 | $4,644,000 the lowest allotment; the Dodgers lost $500K for signing Trevor Bauer (PENALTY_REDUCTION, memo) |
| Baseball America, 2015-class review | 2016-04-01 | Heredia, Brito, Cruz, C. Arias, Marte Jr. exact or rounded matches; **Rincon $325,000** |
| Baseball America, 2018-19 review | 2019-03-12 | De Jesus $500,000; Rosario $650,000 (deferred) |
| Baseball America, 2023 review | 2023-05-11 | Vargas $2,077,500, Tillero $497,500, Mielcarek $397,500; Medina $177,500; Sanchez $17,500 |
| Baseball America, 2012-13 review | 2013-02-21 | Soto $190,000 |
| Dodgers Digest, 2018 / 2025 / 2026 class reports | 2018-07-02, 2025-01-28, 2026-01-15 | Cartaya $2.5M, Yordan Alvarez $2M (rounded); Luna $140,000; Rubel Arias $997,500, Melburne $747,500 |

## Conflicts kept, not resolved

- **Rosario:** Baseball America (2019-03-12) says $650,000; Dodgers Digest (2018-07-02) and DISI say $600,000. Neither report is seeded: 030 would force the column to NULL without a reviewed decision.
- **Torres:** Dodgers Digest says $365K plus a $100K scholarship; DISI has $362,500.
- **Sasaki posting fee:** $1,625,000 versus $1,300,000. A 2017-12-01 MLB Trade Rumors article quoting the league's release says a flat 25% of the signing bonus for minor-league contracts, which supports $1,625,000, but no primary text was readable. Left unresolved by decision.

## Not stored

- A post-trade pool for 2013-14 (the Marlins slot was not read, and a total would be arithmetic).
- A pre-penalty 2021-22 base ($5,179,700 - $500,000 is $4,679,700, not $4,644,000, so it cannot be inferred).
- Ariel Sandoval ($150,000) and Cristian Gomez ($250,000): neither is a DISI player (deferred).
- Julio Urias' package-deal value: described as "believed to be worth around $1.8 million" with the bonus unconfirmed.
