# Audit report: Dodgers international signing census

Accessed 2026-11-07. This audit is read-only: it contains no SQL and made no database writes. DISI data comes from the canonical post-061 replay, snapshot generation 15, which is logically equal to production generation 16. External data comes from the official MLB Stats API, pinned by SHA-256 in `inputs/raw-pins.json`, plus four class lists transcribed from secondary pages that were actually read. All numbers below come from `build-summary.json` and `year-scorecard.csv`.

## 1. WHAT_DOES_220_COVER?

DISI holds **220 Dodgers international signing rows**: 220 players, 220 distinct MLBAM ids, no duplicate player rows. They span signing years 1951-2026, with the earliest dated signing on 1951-02-06 (Chico Fernandez). The latest dated signing is 2025-01-30. All five 2026 rows are undated. 197 rows are dated and 23 are undated.

The 220 are three different things stacked together:

| Layer | Rows | What it is |
|---|---|---|
| 1951-2008 historical set | 32 | Famous, individually verified Dodgers originals (Valenzuela, Pedro Martinez, Beltre, Nomo, Jansen and others). A sample, not a census (`HISTORICAL_VERIFIED_SET`). |
| 2011-12 to 2019-20 scattered rows | 46 | Notable players (Puig, Urias, Ryu, Cruz, Pages, Vargas, Cartaya and others), the five-player 2013 subset, the 10-player 2018 opening list, and four 2019-20 players. Never a period census. |
| 2020-21 to 2026 class rows | 142 | 22 (2020-21 opening), 56 (2022, the full period), 13 (2023 opening), 19 (2024 opening), 29 (2025 opening), 5 (2026 opening subset). |

Breakdowns:

- **By pathway:** LATAM_AMATEUR 159, OTHER 47, CUBAN_AMATEUR 4, CUBAN_PRO 3, MEXICAN_LEAGUE_TRANSFER 2, POSTED_PLAYER 2, JAPAN_PRO 1, JAPAN_AMATEUR 1, KOREA_AMATEUR 1. That is 165 amateur, 8 foreign-professional and 47 `OTHER`. `OTHER` is mostly 2024-25 class rows and non-Latin-American markets, not professionals.
- **By country:** Venezuela 66, Dominican Republic 65, Mexico 19, Cuba 9, and 29 rows with no `country_market`, all 2018-19, 2022 later-period or 2024 rows.
- **Cost state:** KNOWN 81, UNKNOWN 139.
- **Years with zero rows inside the 1951-2026 range:** 43 years, including 2008, 2009, 2010, 2011 and 2020.
- **Low-count periods:** 2011-12 (1 row), 2014-15 (1), 2016-17 (0), 2017-18 (4), 2019-20 (4).

Answer: the 220 form a census only for 2022. DISI also holds four complete opening classes: 2020-21, 2023, 2024 and 2025. Everything else is a sample.

## 2. Signing period

`signing_period` is derived from the real date, which is kept unchanged. The rules are in `inputs/manual.json`:

- **Before 2019-20:** periods ran July 2 to June 15.
- **2019-20:** extended to 2020-10-15 (COVID-19).
- **2020-21:** delayed to open 2021-01-15 and close 2021-12-15.
- **2022 on:** periods run January 15 to December 15. A December 16 to January 14 date belongs to the next period, flagged `PRE_OPEN`. The 2025 class proves this rule: seven of its announced 29 carry 2024-12-16 MLB dates.
- **Pool-exempt professionals signed in December** stay in that calendar year's period. Example: Yoshinobu Yamamoto, 2023-12-27, counts in 2023.
- **One override:** Yordan Alvarez's agreement was reported 2016-06-15, but MLB registered it 2016-07-15. He counts in 2015-16, which agrees with DISI's date.
- **Undated DISI rows** take the period of their matched MLB transaction (`UNDATED_PERIOD_FROM_MLB_TRANSACTION`).

## 3. External census and method

The external census is built from every Dodgers (teamId 119) `SFA` transaction from 2008 to 2026. Each one is joined to the MLB person record (birth country, birth date, draft year) and to the player's full transaction history.

A signing is in scope when all of these hold:
- the player has no draft year;
- he was born outside the USA, Puerto Rico and Canada, or he is US-born and a class list names him (Josue De Paula, Rafy Peguero);
- he had no earlier transaction with another MLB organization, its DSL/VSL/complex teams, or an MLB debut;
- no other MLB club signed him within a year with no Dodgers assignment in between. That last case is `LAD_AGREEMENT_SUPERSEDED`, and only Kristian Cardozo meets it: Dodgers 2019-07-02, Mariners 2019-08-01. DISI already records him correctly as a Mariners signing.

Routes: 549 `INTERNATIONAL_AMATEUR`, 9 `MEXICAN_LEAGUE_TRANSFER` and 18 `FOREIGN_PROFESSIONAL`, for 576 MLB-recorded in-scope signings from 2009-10 through 2026 to date. Not every January free-agent signing counts: veterans, re-signings, drafted players and players from other MLB organizations are excluded. Young out-of-scope cases are listed as `OUT_OF_SCOPE_ROUTE`, for example Victor Diaz (ex-Phillies), Rancer Adon (ex-Rangers), Juan Herrera (ex-Twins), Guillo Zuniga (ex-Braves) and Alexander Pichardo (ex-White Sox DSL).

### Checks against official counts

| Period | Official/secondary count | MLB-record reproduction |
|---|---|---|
| 2020-21 opening | 22 | 22 transactions dated 2021-01-15. Exact. |
| 2023 opening | 13 | 13 dated 2023-01-15. Exact. |
| 2024 opening | 19 (transcribed list) | All 19 names found. Eduardo Rojas is dated 2024-05-30. Rafy Peguero is US-born. "Allan Atoji" in the list is "Allen Ajoti" in the MLB record. |
| 2025 class | 29 (transcribed list) | All 29 found: 22 dated 2025-01-17 to 01-30, 7 dated 2024-12-16, plus Sasaki on 2025-01-22. |
| 2026 opening | 22 (transcribed list) | 21 dated 2026-01-15, plus Roberto Saucedo on 2026-01-22. |
| 2017-18 opening | 26 (transcribed list) | 25 found. **Jonathan Alvarez has no Dodgers MLB record.** The only MLB person by that name is a 2019 Cubs signing born 2000, so this is `IDENTITY_AMBIGUOUS`. |

### Full-period totals: MLB record vs secondary analysts

These do not agree, so the census status below is "complete relative to the MLB record", not "complete in fact":

| Period | MLB record | Secondary |
|---|---|---|
| 2015-16 | 59 | Baseball America 42 |
| 2016-17 | 46 | Baseball America 34 |
| 2017-18 | 52 | Baseball America via Dodgers Digest 63 |
| 2018-19 | 47 | Dodgers Digest 46; Baseball America 37 for calendar 2018 |
| 2019-20 | 46 | MLB roundup 50 |

In 2009-2014 the MLB record is visibly incomplete. MLB reported 47 Dodgers international amateur signings in calendar 2013, but the record yields 30. Erisbel Arruebarrena appears on 2014 Dodgers roster moves with no signing transaction at all.

### Unreadable sources

Every mlb.com anchor returned HTTP 403, to both curl and the WebFetch tool. truebluela.com and dodgersdigest.com did too. None of these was worked around. Counts from them come from search-result summaries or DISI's own recorded values, and are marked `readable: false` in `external-periods.json`. The 2017-18, 2024, 2025 and 2026 name lists were read from dodgerblue.com transcriptions of the club releases.

## 4. Scorecard

| Period | External | DISI | Matched | Missing | Ambiguous | Coverage | Status |
|---|---|---|---|---|---|---|---|
| pre-2009 | n/a | 32 | n/a | n/a | n/a | n/a | NOT_AUDITED |
| 2009-10 | 3 | 0 | 0 | 3 | 0 | 0.0% | SPARSE |
| 2010-11 | 14 | 0 | 0 | 14 | 0 | 0.0% | SPARSE |
| 2011-12 | 22 | 1 | 1 | 21 | 0 | 4.5% | SPARSE |
| 2012-13 | 18 | 6 | 6 | 12 | 0 | 33.3% | SPARSE |
| 2013-14 | 22 | 5 | 5 | 17 | 0 | 22.7% | SPARSE |
| 2014-15 | 18 | 1 | 1 | 17 | 0 | 5.6% | SPARSE |
| 2015-16 | 59 | 13 | 13 | 46 | 0 | 22.0% | SPARSE |
| 2016-17 | 46 | 0 | 0 | 46 | 0 | 0.0% | SPARSE |
| 2017-18 | 52 | 4 | 4 | 47 | 1 | 7.7% | SPARSE |
| 2018-19 | 47 | 10 | 10 | 37 | 0 | 21.3% | SPARSE |
| 2019-20 | 46 | 4 | 4 | 42 | 0 | 8.7% | SPARSE |
| 2020-21 | 38 | 22 | 22 | 16 | 0 | 57.9% | PARTIAL |
| 2022 | 56 | 56 | 56 | 0 | 0 | 100.0% | COMPLETE |
| 2023 | 29 | 13 | 13 | 16 | 0 | 44.8% | PARTIAL |
| 2024 | 24 | 19 | 19 | 5 | 0 | 79.2% | PARTIAL |
| 2025 | 40 | 29 | 29 | 11 | 0 | 72.5% | PARTIAL |
| 2026 (provisional) | 44 | 5 | 5 | 39 | 0 | 11.4% | PROVISIONAL_SPARSE |

Opening classes:

| Opening class | Size | DISI matched | Status |
|---|---|---|---|
| 2020-21 | 22 | 22 | COMPLETE |
| 2023 | 13 | 13 | COMPLETE |
| 2024 | 19 | 19 | COMPLETE |
| 2025 | 29 | 29 | COMPLETE |
| 2017-18 | 26 | 2 (1 ambiguous) | SPARSE |
| 2026 | 22 | 5 | SPARSE |

`DISI_EXTRA` inside the audited window is **0**: every DISI row from 2009 on matched an MLB Dodgers signing by MLBAM id. The 32 extras are all pre-2009 historical rows. Status thresholds: COMPLETE means at least 98% matched with no ambiguity, SUBSTANTIALLY_COMPLETE at least 90%, PARTIAL at least 25%, SPARSE below that. Periods up to 2014-15 are capped at SPARSE or PARTIAL because the external source is itself incomplete.

## 5. Missing players

DISI is missing **389** players: **332 CONFIRMED_MISSING** and **57 PROBABLE_MISSING**. None of them exists anywhere in DISI's `players` table.

- **Confirmed:** the player is named in a class list, was 15.5-19.5 at signing, or is a foreign professional on a major-league contract.
- **Probable:** older amateurs (19.5-23) and minor-league foreign professionals, whose route needs a second source.

Six confirmed rows have no later Dodgers transaction in the MLB record (Adrian Perez, Engerbes Escalona, Rolando Petronia, Yorcy Ratia, and the October 2026 signings Maikol Lora and Alberto Santos). They could be voided or unreported deals, or, for the October 2026 signings, simply too recent. They carry MEDIUM confidence.

DISI's own `signing_period_candidates` agrees completely. Its five 2024 and ten 2025 `IDENTIFIED_NOT_INGESTED` candidates are exactly this audit's 2024 missing players and 10 of its 11 missing 2025 players; the 11th is Hyeseong Kim. Its one `PRIOR_PROFESSIONAL_CONTRACT` (Rancer Adon) is this audit's `OUT_OF_SCOPE_ROUTE`.

Highest-materiality misses are players who reached the major leagues:
- Kenta Maeda (2015-16)
- Hector Olivera (2014-15)
- Alex Guerrero (2013-14)
- Yoshinobu Yamamoto (2023)
- Hyeseong Kim (2025)
- Edwin Uceta (2016-17)
- Jair Camargo, Juan Morillo, Sauryn Lao and Jose E. Hernandez (2015-16)
- Carlos Duran (2017-18)
- Edgardo Henriquez and Jose Rodriguez (2018-19)
- Gerardo Carrillo (2016-17)
- Probable: Jose Miguel Fernandez, Darien Nunez, Angel Sanchez

Plus Erisbel Arruebarrena, who has no MLB signing record. The full list is in `dodgers-signing-census-gaps.csv`, and each player is in `owner-research-queue.md` with a query.

## 6. False membership check of the 220

- **Duplicates:** none. 220 players, 220 MLBAM ids, no spelling-variant pairs (same surname and birth date). The two Luis Rodriguez rows (2015 and 2019) are distinct MLBAM ids.
- **Benchmark contamination:** none. No Dodgers player also carries a non-Dodgers signing row.
- **Drafted, traded-in, or originally signed elsewhere:** none inside 2009-2026. All 187 in-window rows on an in-scope route have a Dodgers `SFA` as their first affiliated transaction and no draft year.
- **Route doubt:** Damaso Marte Jr. (2015-16) was born in Orlando. DISI carries him as LATAM_AMATEUR, but his residence at signing is unsourced. Listed in `identity-review.csv`.
- **Pre-2009 rows:** not testable against the MLB record, which is sparse before 2001. On inspection they are recognized Dodgers originals. Roberto Clemente (Puerto Rico, Brooklyn 1954, before Puerto Rico entered the draft) is a definitional boundary case, not an error.
- **Pathway labels:** Yusniel Diaz (19.1 at signing) is labelled CUBAN_PRO and Puig CUBAN_PRO. This is consistent with DISI's taxonomy, so no change is recommended.

## 7. DISI's own coverage claims

| DISI population | DISI says | Evidence says |
|---|---|---|
| DODGERS-2016-17-FULL-PERIOD, expected 26 (also legacy `signing_census_coverage` 2017 "completed 2017 period") | PARTIAL, 0 tracked | **Wrong period.** The 26 is the 2017-18 *opening* wave (July 2-4, 2017). The transcribed release says the period "began July 2 and runs through June 15, 2018". The true 2016-17 period has 46 MLB-recorded signings (Baseball America: 34). DISI's four 2017 rows (Leonard, Vivas, Vargas, Pages) are 2017-18 members. |
| DODGERS-2018-OPENING | SIZE_UNKNOWN, 10 tracked | Count anchor is 10 (Cartaya article, unreadable). DISI's 10 are all 2018-07-02 Dodgers transactions. Plausibly complete, but not verified. |
| DODGERS-2019-20-FULL-PERIOD, 50 | PARTIAL, 3 tracked | PARTIAL is correct, but DISI holds 4 period members against 46 MLB-recorded. It is closer to SPARSE (8.7%). |
| DODGERS-2021-OPENING, 22 | COMPLETE | **Correct.** |
| DODGERS-2021-FULL-PERIOD | SIZE_UNKNOWN | Now measurable: 38 in scope, 16 missing. |
| DODGERS-2022-OPENING, 30 | UNRESOLVED_CONFLICT (31 tracked) | The conflict stands (headline 30, 31 names). |
| DODGERS-2022-FULL-PERIOD | SIZE_UNKNOWN (56) | **Understated.** 56 of 56 MLB-recorded in-scope signings matched: COMPLETE relative to the MLB record. |
| DODGERS-2023-OPENING, 13 | COMPLETE | **Correct.** Full 2023 period: 29 in scope, 16 missing (one is Yamamoto). |
| DODGERS-2024-OPENING, 19 | COMPLETE | **Correct.** Full period: 24, with 5 missing. |
| DODGERS-2025-OPENING, 29 | COMPLETE | **Correct.** Full period: 40, with 11 missing. |
| DODGERS-2013-CALENDAR-YEAR, 47 | PARTIAL, 5 provisional | PARTIAL is correct. The MLB record itself shows only 30, which confirms the source gap. |
| Legacy `signing_census_coverage` rows | 2022 tracked 29, 2024 tracked 18, 2025 tracked 18 | Stale against the population views (31, 19 and 29). |

## 8. Historical boundary

| Era / periods | Status |
|---|---|
| 1951-2008 | NOT_AUDITED. DISI holds a 32-player verified sample, and no census source exists. |
| 2009-10 through 2014-15 | SPARSE. DISI holds 0-33% per period, and the external record is itself incomplete. |
| 2015-16 through 2019-20 | SPARSE (0-22%). |
| 2020-21 | PARTIAL; opening class COMPLETE. |
| 2022 | COMPLETE relative to the MLB record. |
| 2023, 2024, 2025 | PARTIAL; opening classes COMPLETE. |
| 2026 | PROVISIONAL (period open until 2026-12-15). |

**AUTHORITATIVE_MODERN_CENSUS_START = UNKNOWN.** No run of COMPLETE or SUBSTANTIALLY_COMPLETE periods reaches the latest closed period (2025). 2022 is the only complete full period. If the 48 confirmed or probable 2020-21, 2023, 2024 and 2025 gaps were ingested, the evidence would support a start of 2020-21, the period that opened 2021-01-15. That is a conditional statement, not the current state.

## 9. 2026 (provisional, period still open: YES)

- **MLB-recorded in-scope signings to date:** 44, of which 22 are the opening class.
- **DISI matches:** 5, all from the opening class (Rubel Arias, Ezequiel Melburne, Ariel Reynoso, Jose Requena, Jose Victorino). All 5 DISI rows are undated, and DISI makes no coverage claim for 2026.
- **Missing:** 39 (32 confirmed, 7 probable), including 17 of the 22 opening names.
- **Excluded:** Alexander Pichardo (ex-White Sox DSL).
- **Later-period signings:** 22 so far, with the latest dated 2026-10-28.

## 10. Census totals

- **CONFIRMED_MINIMUM_CENSUS = 552.** This is 32 pre-2009 historical rows plus 520 in 2009-2026: 576 MLB-recorded in-scope signings minus 57 probable, plus 1 US-born player DISI carries.
- **ESTIMATED_CENSUS_IF_PROBABLE_INCLUDED = 614** (582 for 2009-2026 only). This adds 57 probable, 1 list name with no MLB record (Jonathan Alvarez) and 4 US-born players whose route is unresolved.

Both totals are floors for 2009-10 through 2014-15, and they include 2026 to date. Against them, DISI's 220 is about 36-40% of the census overall, and about 188 of 520-582 for 2009-2026.

## 11. Acquisition-cost model representation (note only, no data change)

`total_known_acquisition_cost_usd` stays a factual column. NULL means "not known". It never means zero. Models that need a number should read a derived representation and leave the stored value alone:

```
acquisition_cost_model_usd = COALESCE(total_known_acquisition_cost_usd, 0)
acquisition_cost_missing   = (total_known_acquisition_cost_usd IS NULL)
acquisition_cost_state     = KNOWN | PARTIAL | UNKNOWN | UNDISCLOSED | NO_COST_RULE
```

| State | Meaning |
|---|---|
| `KNOWN` | Every cost component is sourced: bonus, plus posting fee, tax or league purchase where applicable. |
| `PARTIAL` | The bonus is known, but a pathway component is not, such as a posting fee or Mexican League transfer share. |
| `UNKNOWN` | Nothing is sourced yet, but a public figure plausibly exists. This is the only actionable state. |
| `UNDISCLOSED` | A reasonable search found no public figure, as with most sub-$100K DSL bonuses. Not actionable. |
| `NO_COST_RULE` | The pathway has no defined cost composition yet, as with pre-1965 historical signings. |

Any model using the zero-filled value has to carry `acquisition_cost_missing` as a covariate or mask. Otherwise every missing bonus reads as a free signing, and cost-per-WAR comparisons come out biased toward clubs with sparse bonus disclosure. Of the 220 DISI rows, 81 are KNOWN and 139 UNKNOWN under the coarse derivation in `current-disi-population.csv`. Separating UNKNOWN from UNDISCLOSED needs per-row research.

## 12. Classification of unresolved research

| Class | Items | Goes in owner queue? |
|---|---|---|
| ACTIONABLE | 332 confirmed and 57 probable missing players (membership); 5 identity/route checks; the Arruebarrena lead; undated DISI rows (23), which can take their MLB transaction dates; 29 DISI rows with no `country_market` (the MLB person record has a birth country). | Yes. The first three are queued; dates and countries are noted. |
| UNDISCLOSED | Bonuses for most sub-$100K amateur signings, most of the 139 UNKNOWN costs. | No |
| STRUCTURALLY_UNKNOWN | True full-period totals for 2009-10 through 2014-15 (no complete public census; the MLB record is sparse); the gap between MLB-record and analyst totals for 2015-16 through 2019-20. | No |
| LOW_MATERIALITY | The position on minor-league pitchers who never left the DSL; exact agreement date vs MLB registration date when both fall in the same period. | No |
| NOT_APPLICABLE | Kristian Cardozo (superseded); ex-organization signings (Victor Diaz, Rancer Adon, Juan Herrera, Guillo Zuniga, Alexander Pichardo and earlier ones); Shohei Ohtani (ex-Angels). | No |
| IDENTITY_BLOCKED | Jonathan Alvarez (2017-18 list, no MLB person); 4 US-born teenage signings with unknown residence (Villicana, Tiburcio, Camacho, Oliveira); Damaso Marte Jr. (carried by DISI). | Listed in section 2 of the queue for identity work only. |

## 13. Limits

- The MLB Stats API is the only player-level source for most periods, and it lists contract registrations, not agreements.
- 2009-2014 is incomplete.
- Prior-organization checks for US-born players were not run: their histories were not fetched.
- All mlb.com, truebluela.com and dodgersdigest.com pages returned 403.
- The 2018 opening list and the 2019-20 roundup names could not be read.
