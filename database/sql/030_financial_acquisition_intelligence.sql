-- DISI v0.21
-- 030_financial_acquisition_intelligence.sql
-- Financial acquisition intelligence: a provenance ledger for acquisition-cost components and
-- signing-environment pool facts, explicit completeness, and pool treatment. Run after 029.
--
-- Built from database/research/030/ (seed-evidence.json, audit.mjs, build.mjs).
--
-- What this is. The existing signings money columns (signing_bonus_usd, posting_fee_usd,
-- transfer_fee_usd, the generated total_known_acquisition_cost_usd and bonus_publicly_reported)
-- stay exactly as they are: the compatibility layer that carries ONE selected value per component.
-- 030 adds the evidence underneath them and the vocabulary to say how complete a known cost is.
-- An unknown amount is NULL and stays NULL: nothing here turns unknown into zero.
--
-- What it does:
--   * Adds three tables.
--       - signing_financial_reports: one row per reported amount of one acquisition-cost component
--         (SIGNING_BONUS, POSTING_FEE, TRANSFER_FEE, RELEASE_FEE, POOL_CHARGE, OTHER_ACQUISITION_FEE)
--         of one signing. No salary, contract guarantee, option, buyout, agent pay, development cost
--         or period tax. Every row carries currency (ISO-4217 shape; all current rows are USD; no FX),
--         amount basis (EXACT / ROUNDED + precision / APPROXIMATE / RULE_DERIVED + rate and base) and
--         origin:
--           EXTERNAL_SOURCE      a cited source states the amount; this is field-level provenance.
--           LEGACY_CARRYFORWARD  the value was already in DISI's canonical columns with no field-level
--                                source. It is carried, never presented as sourced, and stays queued.
--           RULE_DERIVED         DISI derived the amount from a cited rule; rate and base reproduce it.
--         Rows are ACTIVE or RETRACTED; ACTIVE content is sealed, nothing is deleted, a correction is a
--         new row that supersedes (and retires) its predecessor. Independent reports that disagree are
--         NOT a predecessor / successor pair: both stay ACTIVE and the disagreement is exposed.
--       - signing_environment_financial_reports: the same discipline for period / pool facts (base pool,
--         pool after trades, pool space acquired / sent, penalty reduction, reported period spend,
--         overage tax rate, overage tax paid, individual bonus cap). Money goes in amount_usd, rates in
--         rate_value; each metric accepts exactly one.
--       - acquisition_cost_component_rules: pathway x component applicability (REQUIRED, POSSIBLE,
--         CONDITIONAL, NOT_APPLICABLE, NO_RULE) used to decide completeness. It says nothing about pools.
--   * Adds signings.international_pool_treatment (SUBJECT, EXEMPT, NOT_SUBJECT, NOT_APPLICABLE, UNKNOWN)
--     with its basis and source. It is independent of pathway and is set only where a source or a rule
--     supports it. It is never a pool charge: a POOL_CHARGE lives in the ledger and is never assumed to
--     equal the bonus.
--   * Backfills the ledger from data: every non-null signings money column and every non-null
--     environment pool column gets a row. A column with DISI field-level evidence is carried as
--     EXTERNAL_SOURCE (seeded explicitly and checked); every other one is LEGACY_CARRYFORWARD with no
--     source. No source is invented.
--   * Seeds what directly read sources state (Baseball America 2013 / 2016 / 2018, CBS Sports 2012 /
--     2025, MLB Trade Rumors 2025, DISI's 2019-20 period summary): Ryu, Sasaki, Puig, the three 2015
--     Cuban signings, the 2015-16, 2017-18, 2019-20 and 2025 environments.
--   * Canonical changes (guarded): Hyun-Jin Ryu's signing bonus becomes 5,000,000 (reported) and his
--     posting fee 25,737,737.33 (the exact reported bid; the $25.7M forms stay as ROUNDED reports).
--     Roki Sasaki's posting fee stays NULL: two sources disagree (25% / $1.625M vs 20% / $1.3M).
--   * Adds the Dodgers 2019-20 signing environment from the 2019-20 period summary and links the three
--     members of the DODGERS-2019-20-FULL-PERIOD population to it.
--   * Adds four views: v_signing_acquisition_financials, v_dodgers_financial_commitment_by_class,
--     v_dodgers_financial_commitment_by_market and v_financial_research_queue. All security_invoker,
--     SELECT-only. They never compute WAR per dollar, ROI, rankings or network / scouting attribution.
--     The legacy WAR-per-dollar views are not touched.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA (database/research/030/seed-evidence.json)
-- ===========================================================================

create temporary table _m030 on commit drop as
select $m030${"canonical_changes":[{"column":"signing_bonus_usd","from":null,"organization_name":"Los Angeles Dodgers","player_slug":"hyun-jin-ryu","signing_year":2012,"to":"5000000.00"},{"column":"bonus_publicly_reported","from":false,"organization_name":"Los Angeles Dodgers","player_slug":"hyun-jin-ryu","signing_year":2012,"to":true},{"column":"posting_fee_usd","from":"25700000.00","organization_name":"Los Angeles Dodgers","player_slug":"hyun-jin-ryu","signing_year":2012,"to":"25737737.33"}],"component_rules":[{"applicability":"REQUIRED","component_type":"SIGNING_BONUS","explanation":"An international amateur signing is paid as a signing bonus; its amount is the acquisition cost.","pathway":"LATAM_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"POSTING_FEE","explanation":"Amateurs are not posted by a professional club.","pathway":"LATAM_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"TRANSFER_FEE","explanation":"No professional club holds the amateur's rights.","pathway":"LATAM_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"RELEASE_FEE","explanation":"No professional club holds the amateur's rights.","pathway":"LATAM_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"OTHER_ACQUISITION_FEE","explanation":"No other acquisition payment applies to an amateur signing.","pathway":"LATAM_AMATEUR","source_url":null},{"applicability":"REQUIRED","component_type":"SIGNING_BONUS","explanation":"An international amateur signing is paid as a signing bonus; its amount is the acquisition cost.","pathway":"CUBAN_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"POSTING_FEE","explanation":"Amateurs are not posted by a professional club.","pathway":"CUBAN_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"TRANSFER_FEE","explanation":"No professional club holds the amateur's rights.","pathway":"CUBAN_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"RELEASE_FEE","explanation":"No professional club holds the amateur's rights.","pathway":"CUBAN_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"OTHER_ACQUISITION_FEE","explanation":"No other acquisition payment applies to an amateur signing.","pathway":"CUBAN_AMATEUR","source_url":null},{"applicability":"REQUIRED","component_type":"SIGNING_BONUS","explanation":"An international amateur signing is paid as a signing bonus; its amount is the acquisition cost.","pathway":"JAPAN_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"POSTING_FEE","explanation":"Amateurs are not posted by a professional club.","pathway":"JAPAN_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"TRANSFER_FEE","explanation":"No professional club holds the amateur's rights.","pathway":"JAPAN_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"RELEASE_FEE","explanation":"No professional club holds the amateur's rights.","pathway":"JAPAN_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"OTHER_ACQUISITION_FEE","explanation":"No other acquisition payment applies to an amateur signing.","pathway":"JAPAN_AMATEUR","source_url":null},{"applicability":"REQUIRED","component_type":"SIGNING_BONUS","explanation":"An international amateur signing is paid as a signing bonus; its amount is the acquisition cost.","pathway":"KOREA_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"POSTING_FEE","explanation":"Amateurs are not posted by a professional club.","pathway":"KOREA_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"TRANSFER_FEE","explanation":"No professional club holds the amateur's rights.","pathway":"KOREA_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"RELEASE_FEE","explanation":"No professional club holds the amateur's rights.","pathway":"KOREA_AMATEUR","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"OTHER_ACQUISITION_FEE","explanation":"No other acquisition payment applies to an amateur signing.","pathway":"KOREA_AMATEUR","source_url":null},{"applicability":"REQUIRED","component_type":"SIGNING_BONUS","explanation":"Cuban professionals signed by the Dodgers received a signing bonus; it is the main acquisition cost.","pathway":"CUBAN_PRO","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"POSTING_FEE","explanation":"No posting system applies to Cuban players.","pathway":"CUBAN_PRO","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"TRANSFER_FEE","explanation":"No club is paid for a Cuban defector's rights.","pathway":"CUBAN_PRO","source_url":null},{"applicability":"CONDITIONAL","component_type":"RELEASE_FEE","explanation":"Applies only if a source reports a payment to release the player; it does not block completeness.","pathway":"CUBAN_PRO","source_url":null},{"applicability":"CONDITIONAL","component_type":"OTHER_ACQUISITION_FEE","explanation":"Applies only if a source reports another acquisition payment; it does not block completeness.","pathway":"CUBAN_PRO","source_url":null},{"applicability":"POSSIBLE","component_type":"SIGNING_BONUS","explanation":"A professional free agent may or may not receive a separate signing bonus; when unknown, completeness is PARTIAL.","pathway":"JAPAN_PRO","source_url":null},{"applicability":"CONDITIONAL","component_type":"POSTING_FEE","explanation":"Applies only when the player was posted; a non-posted free agent has none.","pathway":"JAPAN_PRO","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"TRANSFER_FEE","explanation":"A free agent's rights are not sold.","pathway":"JAPAN_PRO","source_url":null},{"applicability":"CONDITIONAL","component_type":"RELEASE_FEE","explanation":"Applies only if a source reports a release payment.","pathway":"JAPAN_PRO","source_url":null},{"applicability":"CONDITIONAL","component_type":"OTHER_ACQUISITION_FEE","explanation":"Applies only if a source reports another acquisition payment.","pathway":"JAPAN_PRO","source_url":null},{"applicability":"POSSIBLE","component_type":"SIGNING_BONUS","explanation":"A professional free agent may or may not receive a separate signing bonus; when unknown, completeness is PARTIAL.","pathway":"KOREA_PRO","source_url":null},{"applicability":"CONDITIONAL","component_type":"POSTING_FEE","explanation":"Applies only when the player was posted; a non-posted free agent has none.","pathway":"KOREA_PRO","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"TRANSFER_FEE","explanation":"A free agent's rights are not sold.","pathway":"KOREA_PRO","source_url":null},{"applicability":"CONDITIONAL","component_type":"RELEASE_FEE","explanation":"Applies only if a source reports a release payment.","pathway":"KOREA_PRO","source_url":null},{"applicability":"CONDITIONAL","component_type":"OTHER_ACQUISITION_FEE","explanation":"Applies only if a source reports another acquisition payment.","pathway":"KOREA_PRO","source_url":null},{"applicability":"POSSIBLE","component_type":"SIGNING_BONUS","explanation":"A posted player's contract may include a signing bonus; when unknown, completeness is PARTIAL.","pathway":"POSTED_PLAYER","source_url":null},{"applicability":"REQUIRED","component_type":"POSTING_FEE","explanation":"Signing a posted player requires a payment to the releasing club; its amount follows the posting rules in force.","pathway":"POSTED_PLAYER","source_url":"https://www.cbssports.com/mlb/news/roki-sasaki-signs-with-dodgers-japanese-ace-agrees-to-deal-with-world-series-champs/"},{"applicability":"NOT_APPLICABLE","component_type":"TRANSFER_FEE","explanation":"The posting fee is the payment to the releasing club.","pathway":"POSTED_PLAYER","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"RELEASE_FEE","explanation":"The posting fee is the payment to the releasing club.","pathway":"POSTED_PLAYER","source_url":null},{"applicability":"CONDITIONAL","component_type":"OTHER_ACQUISITION_FEE","explanation":"Applies only if a source reports another acquisition payment.","pathway":"POSTED_PLAYER","source_url":null},{"applicability":"POSSIBLE","component_type":"SIGNING_BONUS","explanation":"A player bought from a Mexican League club may also receive a bonus; when unknown, completeness is PARTIAL.","pathway":"MEXICAN_LEAGUE_TRANSFER","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"POSTING_FEE","explanation":"The payment to the Mexican League club is a transfer fee, not a posting fee.","pathway":"MEXICAN_LEAGUE_TRANSFER","source_url":null},{"applicability":"REQUIRED","component_type":"TRANSFER_FEE","explanation":"The Mexican League club is paid for the player's rights.","pathway":"MEXICAN_LEAGUE_TRANSFER","source_url":null},{"applicability":"NOT_APPLICABLE","component_type":"RELEASE_FEE","explanation":"The transfer fee is the payment to the club.","pathway":"MEXICAN_LEAGUE_TRANSFER","source_url":null},{"applicability":"CONDITIONAL","component_type":"OTHER_ACQUISITION_FEE","explanation":"Applies only if a source reports another acquisition payment.","pathway":"MEXICAN_LEAGUE_TRANSFER","source_url":null},{"applicability":"NO_RULE","component_type":"SIGNING_BONUS","explanation":"OTHER is a catch-all pathway; no component rule is defined, so completeness is NO_RULE.","pathway":"OTHER","source_url":null},{"applicability":"NO_RULE","component_type":"POSTING_FEE","explanation":"No component rule is defined for OTHER.","pathway":"OTHER","source_url":null},{"applicability":"NO_RULE","component_type":"TRANSFER_FEE","explanation":"No component rule is defined for OTHER.","pathway":"OTHER","source_url":null},{"applicability":"NO_RULE","component_type":"RELEASE_FEE","explanation":"No component rule is defined for OTHER.","pathway":"OTHER","source_url":null},{"applicability":"NO_RULE","component_type":"OTHER_ACQUISITION_FEE","explanation":"No component rule is defined for OTHER.","pathway":"OTHER","source_url":null}],"environment_reports":[{"amount_basis":"EXACT","amount_precision":null,"amount_usd":"700000.00","confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","metric_type":"POOL_AFTER_TRADES","note":"Baseball America: the Dodgers traded away all four of their international slot values, leaving a $700,000 pool.","rate_value":null,"ref":"env2015-after-trades","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-08T23:45:00Z","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"amount_basis":"EXACT","amount_precision":null,"amount_usd":null,"confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","metric_type":"OVERAGE_TAX_RATE","note":"Baseball America: the Dodgers have to pay the 100 percent pool overage tax. Stored as a rate; no tax amount is derived or stored.","rate_value":"1.00000","ref":"env2015-tax-rate","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-08T23:45:00Z","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"amount_basis":"APPROXIMATE","amount_precision":null,"amount_usd":"45000000.00","confidence":"MEDIUM","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","metric_type":"REPORTED_PERIOD_SPEND","note":"Baseball America (2016-04-01): approximately $45 million spent so far against the 2015-16 pool, before the period closed. Its $90 million total-tab projection is not stored.","rate_value":null,"ref":"env2015-spend","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-08T23:45:00Z","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"amount_basis":"EXACT","amount_precision":null,"amount_usd":"300000.00","confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","metric_type":"INDIVIDUAL_BONUS_CAP","note":"Baseball America's 2017-class review: as a penalty the Dodgers could not sign anyone for more than $300,000 for two years.","rate_value":null,"ref":"env2017-cap","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-08T23:45:00Z","signing_year":2017,"source_url":"https://www.baseballamerica.com/stories/international-reviews-los-angeles-dodgers-2018/"},{"amount_basis":"EXACT","amount_precision":null,"amount_usd":"5146200.00","confidence":"HIGH","evidence_basis":"NEWS_REPORT","metric_type":"BASE_POOL","note":"CBS Sports gives the Dodgers' original 2025 bonus pool as $5,146,200.","rate_value":null,"ref":"env2025-pool-cbs","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-09T18:40:00Z","signing_year":2025,"source_url":"https://www.cbssports.com/mlb/news/roki-sasaki-signs-with-dodgers-japanese-ace-agrees-to-deal-with-world-series-champs/"},{"amount_basis":"ROUNDED","amount_precision":"100.00","amount_usd":"5146200.00","confidence":"HIGH","evidence_basis":"NEWS_REPORT","metric_type":"BASE_POOL","note":"MLB Trade Rumors: the Dodgers had $5.1462MM to spend on international amateurs on January 15.","rate_value":null,"ref":"env2025-pool-mlbtr","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-09T18:40:00Z","signing_year":2025,"source_url":"https://mlbtraderumors.com/2025/01/roki-sasaki-to-sign-with-dodgers.html"},{"amount_basis":"EXACT","amount_precision":null,"amount_usd":"5366400.00","confidence":"HIGH","evidence_basis":"CANONICAL_PERIOD_SUMMARY","metric_type":"BASE_POOL","note":"Carried from DISI's 2019-20 all-club period summary (MLB.com 2019-20 roundup): Dodgers pool.","rate_value":null,"ref":"env2019-pool","report_origin":"EXTERNAL_SOURCE","retrieved_at":null,"signing_year":2019,"source_url":"https://www.mlb.com/news/international-signing-period-roundup-2019-2020"},{"amount_basis":"EXACT","amount_precision":null,"amount_usd":"5354000.00","confidence":"HIGH","evidence_basis":"CANONICAL_PERIOD_SUMMARY","metric_type":"REPORTED_PERIOD_SPEND","note":"Carried from DISI's 2019-20 all-club period summary (MLB.com 2019-20 roundup): Dodgers pool spent.","rate_value":null,"ref":"env2019-spend","report_origin":"EXTERNAL_SOURCE","retrieved_at":null,"signing_year":2019,"source_url":"https://www.mlb.com/news/international-signing-period-roundup-2019-2020"}],"existing_sources":["https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/","https://www.baseballamerica.com/stories/international-reviews-los-angeles-dodgers-2018/","https://www.mlb.com/news/international-signing-period-roundup-2019-2020","https://www.mlb.com/news/jim-callis-look-at-how-the-los-angeles-dodgers-playoff-roster-was-built/c-62031828","https://www.mlb.com/es/news/fallecio-fernando-valenzuela"],"expectations":{"field_level_money_evidence":[{"field_name":"posting_fee_usd","player_slug":"hyun-jin-ryu","signing_year":2012,"source_url":"https://www.mlb.com/news/jim-callis-look-at-how-the-los-angeles-dodgers-playoff-roster-was-built/c-62031828"},{"field_name":"transfer_fee_usd","player_slug":"fernando-valenzuela","signing_year":1979,"source_url":"https://www.mlb.com/es/news/fallecio-fernando-valenzuela"}],"period_summary_2019":{"pool_amount_usd":"5366400","pool_spent_usd":"5354000","source_url":"https://www.mlb.com/news/international-signing-period-roundup-2019-2020"},"signings":[{"bonus_publicly_reported_after":true,"organization_name":"Los Angeles Dodgers","player_slug":"hyun-jin-ryu","posting_fee_usd":"25700000.00","posting_fee_usd_after":"25737737.33","signing_bonus_usd":null,"signing_bonus_usd_after":"5000000.00","signing_year":2012,"transfer_fee_usd":null},{"organization_name":"Los Angeles Dodgers","player_slug":"roki-sasaki","posting_fee_usd":null,"signing_bonus_usd":"6500000.00","signing_year":2025,"transfer_fee_usd":null},{"organization_name":"Los Angeles Dodgers","player_slug":"yasiel-puig","posting_fee_usd":null,"signing_bonus_usd":"12000000.00","signing_year":2012,"transfer_fee_usd":null},{"organization_name":"Los Angeles Dodgers","player_slug":"yadier-alvarez","posting_fee_usd":null,"signing_bonus_usd":"16000000.00","signing_year":2015,"transfer_fee_usd":null},{"organization_name":"Los Angeles Dodgers","player_slug":"yusniel-diaz","posting_fee_usd":null,"signing_bonus_usd":"15500000.00","signing_year":2015,"transfer_fee_usd":null},{"organization_name":"Los Angeles Dodgers","player_slug":"omar-estevez","posting_fee_usd":null,"signing_bonus_usd":"6000000.00","signing_year":2015,"transfer_fee_usd":null},{"organization_name":"Los Angeles Dodgers","player_slug":"fernando-valenzuela","posting_fee_usd":null,"signing_bonus_usd":null,"signing_year":1979,"transfer_fee_usd":"120000.00"}]},"new_environment":{"club_bonus_pool_usd":"5366400.00","linked_population_key":"DODGERS-2019-20-FULL-PERIOD","notes":"Added by Migration 030 from international_org_period_summary (2019-20). Pool after trades was not reported.","organization_name":"Los Angeles Dodgers","regime":"MODERN_HARD_POOL","rules_summary":"Hard-cap pool under the same collective bargaining agreement as 2018-19. Pool from MLB's 2019-20 all-club roundup.","signing_period_label":"2019-20","signing_year":2019,"tradeable_pool_space":true},"new_sources":[{"accessed_at":"2026-10-09T18:15:00Z","author":"Ben Badler","notes":"Review of the Dodgers' 2012-13 international signings (Puig, Ryu, Urias and the July 2 class).","publication_date":"2013-02-21","source_name":"Baseball America","source_tier":"OTHER","source_type":"ARTICLE","title":"2012-13 International Reviews: Los Angeles Dodgers","url":"https://www.baseballamerica.com/stories/2012-13-international-reviews-los-angeles-dodgers/"},{"accessed_at":"2026-10-09T18:40:00Z","author":"Matt Snyder","notes":"Report of Hyun-Jin Ryu's Dodgers contract, signing bonus and posting fee.","publication_date":"2012-12-09","source_name":"CBS Sports","source_tier":"OTHER","source_type":"ARTICLE","title":"Dodgers sign Hyun-jin Ryu for six years, $36 million","url":"https://www.cbssports.com/mlb/news/dodgers-sign-hyun-jin-ryu-for-six-years-36-million"},{"accessed_at":"2026-10-09T18:40:00Z","author":"R.J. Anderson; Mike Axisa","notes":"Report of Roki Sasaki's Dodgers signing bonus, posting fee and the Dodgers' 2025 bonus pool.","publication_date":"2025-01-17","source_name":"CBS Sports","source_tier":"OTHER","source_type":"ARTICLE","title":"Roki Sasaki signs with Dodgers: Japanese ace agrees to deal with World Series champs","url":"https://www.cbssports.com/mlb/news/roki-sasaki-signs-with-dodgers-japanese-ace-agrees-to-deal-with-world-series-champs/"},{"accessed_at":"2026-10-09T18:40:00Z","author":"Anthony Franco","notes":"Updated post (first entry January 17, 2025) on Roki Sasaki's Dodgers signing bonus, posting fee and the Dodgers' pool.","publication_date":"2025-01-22","source_name":"MLB Trade Rumors","source_tier":"OTHER","source_type":"ARTICLE","title":"Dodgers Sign Roki Sasaki","url":"https://mlbtraderumors.com/2025/01/roki-sasaki-to-sign-with-dodgers.html"}],"pool_treatment_rule":{"basis":"RULE","source_url":"https://www.baseballamerica.com/stories/2012-13-international-reviews-los-angeles-dodgers/","treatment":"NOT_APPLICABLE"},"pool_treatments":[{"basis":"SOURCE_STATEMENT","organization_name":"Los Angeles Dodgers","player_slug":"roki-sasaki","signing_year":2025,"source_url":"https://www.cbssports.com/mlb/news/roki-sasaki-signs-with-dodgers-japanese-ace-agrees-to-deal-with-world-series-champs/","treatment":"SUBJECT"},{"basis":"SOURCE_STATEMENT","organization_name":"Los Angeles Dodgers","player_slug":"yadier-alvarez","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/","treatment":"SUBJECT"},{"basis":"SOURCE_STATEMENT","organization_name":"Los Angeles Dodgers","player_slug":"yusniel-diaz","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/","treatment":"SUBJECT"},{"basis":"SOURCE_STATEMENT","organization_name":"Los Angeles Dodgers","player_slug":"omar-estevez","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/","treatment":"SUBJECT"},{"basis":"SOURCE_STATEMENT","organization_name":"Los Angeles Dodgers","player_slug":"yasiel-puig","signing_year":2012,"source_url":"https://www.baseballamerica.com/stories/2012-13-international-reviews-los-angeles-dodgers/","treatment":"NOT_APPLICABLE"}],"review_timestamp":"2026-10-09T18:40:00Z","signing_reports":[{"amount":"5000000.00","amount_basis":"ROUNDED","amount_precision":"1000000.00","component_type":"SIGNING_BONUS","confidence":"HIGH","currency_code":"USD","derivation_base_amount":null,"derivation_rate":null,"derivation_rule":null,"evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Baseball America's 2012-13 review says Ryu signed a six-year, $36 million deal that includes a $5 million signing bonus. Only the bonus is an acquisition cost.","organization_name":"Los Angeles Dodgers","player_slug":"hyun-jin-ryu","ref":"ryu-bonus-ba","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-09T18:15:00Z","signing_year":2012,"source_url":"https://www.baseballamerica.com/stories/2012-13-international-reviews-los-angeles-dodgers/"},{"amount":"5000000.00","amount_basis":"ROUNDED","amount_precision":"1000000.00","component_type":"SIGNING_BONUS","confidence":"HIGH","currency_code":"USD","derivation_base_amount":null,"derivation_rate":null,"derivation_rule":null,"evidence_basis":"NEWS_REPORT","note":"CBS Sports reports that the $36 million, six-year figure includes a $5 million signing bonus.","organization_name":"Los Angeles Dodgers","player_slug":"hyun-jin-ryu","ref":"ryu-bonus-cbs","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-09T18:40:00Z","signing_year":2012,"source_url":"https://www.cbssports.com/mlb/news/dodgers-sign-hyun-jin-ryu-for-six-years-36-million"},{"amount":"25737737.33","amount_basis":"EXACT","amount_precision":null,"component_type":"POSTING_FEE","confidence":"HIGH","currency_code":"USD","derivation_base_amount":null,"derivation_rate":null,"derivation_rule":null,"evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Baseball America's 2012-13 review gives the Dodgers' winning posting bid for Ryu as a reported $25,737,737.33.","organization_name":"Los Angeles Dodgers","player_slug":"hyun-jin-ryu","ref":"ryu-posting-ba","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-09T18:15:00Z","signing_year":2012,"source_url":"https://www.baseballamerica.com/stories/2012-13-international-reviews-los-angeles-dodgers/"},{"amount":"25700000.00","amount_basis":"ROUNDED","amount_precision":"100000.00","component_type":"POSTING_FEE","confidence":"HIGH","currency_code":"USD","derivation_base_amount":null,"derivation_rate":null,"derivation_rule":null,"evidence_basis":"NEWS_REPORT","note":"CBS Sports reports a $25.7 million posting fee paid to Ryu's Korean club.","organization_name":"Los Angeles Dodgers","player_slug":"hyun-jin-ryu","ref":"ryu-posting-cbs","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-09T18:40:00Z","signing_year":2012,"source_url":"https://www.cbssports.com/mlb/news/dodgers-sign-hyun-jin-ryu-for-six-years-36-million"},{"amount":"25700000.00","amount_basis":"ROUNDED","amount_precision":"100000.00","component_type":"POSTING_FEE","confidence":"VERIFIED","currency_code":"USD","derivation_base_amount":null,"derivation_rate":null,"derivation_rule":null,"evidence_basis":"CANONICAL_FIELD_EVIDENCE","note":"Carried from DISI's existing field-level evidence for posting_fee_usd (MLB.com, $25.7 million). Not re-read in 030: MLB.com answered HTTP 406.","organization_name":"Los Angeles Dodgers","player_slug":"hyun-jin-ryu","ref":"ryu-posting-mlb","report_origin":"EXTERNAL_SOURCE","retrieved_at":null,"signing_year":2012,"source_url":"https://www.mlb.com/news/jim-callis-look-at-how-the-los-angeles-dodgers-playoff-roster-was-built/c-62031828"},{"amount":"12000000.00","amount_basis":"ROUNDED","amount_precision":"1000000.00","component_type":"SIGNING_BONUS","confidence":"HIGH","currency_code":"USD","derivation_base_amount":null,"derivation_rate":null,"derivation_rule":null,"evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Baseball America's 2012-13 review describes a seven-year, $42 million contract including a $12 million bonus. Only the bonus is an acquisition cost.","organization_name":"Los Angeles Dodgers","player_slug":"yasiel-puig","ref":"puig-bonus-ba","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-09T18:15:00Z","signing_year":2012,"source_url":"https://www.baseballamerica.com/stories/2012-13-international-reviews-los-angeles-dodgers/"},{"amount":"6500000.00","amount_basis":"ROUNDED","amount_precision":"100000.00","component_type":"SIGNING_BONUS","confidence":"HIGH","currency_code":"USD","derivation_base_amount":null,"derivation_rate":null,"derivation_rule":null,"evidence_basis":"NEWS_REPORT","note":"CBS Sports reports (citing the Los Angeles Times) a $6.5 million signing bonus on a minor-league contract.","organization_name":"Los Angeles Dodgers","player_slug":"roki-sasaki","ref":"sasaki-bonus-cbs","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-09T18:40:00Z","signing_year":2025,"source_url":"https://www.cbssports.com/mlb/news/roki-sasaki-signs-with-dodgers-japanese-ace-agrees-to-deal-with-world-series-champs/"},{"amount":"6500000.00","amount_basis":"ROUNDED","amount_precision":"100000.00","component_type":"SIGNING_BONUS","confidence":"HIGH","currency_code":"USD","derivation_base_amount":null,"derivation_rate":null,"derivation_rule":null,"evidence_basis":"NEWS_REPORT","note":"MLB Trade Rumors reports a $6.5MM signing bonus.","organization_name":"Los Angeles Dodgers","player_slug":"roki-sasaki","ref":"sasaki-bonus-mlbtr","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-09T18:40:00Z","signing_year":2025,"source_url":"https://mlbtraderumors.com/2025/01/roki-sasaki-to-sign-with-dodgers.html"},{"amount":"1625000.00","amount_basis":"RULE_DERIVED","amount_precision":null,"component_type":"POSTING_FEE","confidence":"MEDIUM","currency_code":"USD","derivation_base_amount":"6500000.00","derivation_rate":"0.25000","derivation_rule":"CBS Sports: on a minor-league deal the posting fee is 25% of the signing bonus.","evidence_basis":"NEWS_REPORT","note":"CBS Sports states the fee will be 25% of the bonus, $1.625 million on $6.5 million. MLB Trade Rumors states 20% / $1.3MM. Both are kept; neither is labelled false.","organization_name":"Los Angeles Dodgers","player_slug":"roki-sasaki","ref":"sasaki-posting-cbs","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-09T18:40:00Z","signing_year":2025,"source_url":"https://www.cbssports.com/mlb/news/roki-sasaki-signs-with-dodgers-japanese-ace-agrees-to-deal-with-world-series-champs/"},{"amount":"1300000.00","amount_basis":"RULE_DERIVED","amount_precision":null,"component_type":"POSTING_FEE","confidence":"MEDIUM","currency_code":"USD","derivation_base_amount":"6500000.00","derivation_rate":"0.20000","derivation_rule":"MLB Trade Rumors: the Marines were limited to 20% of the signing bonus.","evidence_basis":"NEWS_REPORT","note":"MLB Trade Rumors states the Dodgers will owe a $1.3MM posting fee, the club being limited to 20% of the bonus. CBS Sports states 25% / $1.625 million. Both are kept; neither is labelled false.","organization_name":"Los Angeles Dodgers","player_slug":"roki-sasaki","ref":"sasaki-posting-mlbtr","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-09T18:40:00Z","signing_year":2025,"source_url":"https://mlbtraderumors.com/2025/01/roki-sasaki-to-sign-with-dodgers.html"},{"amount":"16000000.00","amount_basis":"ROUNDED","amount_precision":"1000000.00","component_type":"SIGNING_BONUS","confidence":"HIGH","currency_code":"USD","derivation_base_amount":null,"derivation_rate":null,"derivation_rule":null,"evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Baseball America's 2015-class review says the Dodgers signed Alvarez for $16 million on July 2.","organization_name":"Los Angeles Dodgers","player_slug":"yadier-alvarez","ref":"alvarez-bonus-ba","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-08T23:45:00Z","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"amount":"15500000.00","amount_basis":"ROUNDED","amount_precision":"100000.00","component_type":"SIGNING_BONUS","confidence":"HIGH","currency_code":"USD","derivation_base_amount":null,"derivation_rate":null,"derivation_rule":null,"evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Baseball America's 2015-class review says the Dodgers signed Diaz for $15.5 million in November.","organization_name":"Los Angeles Dodgers","player_slug":"yusniel-diaz","ref":"diaz-bonus-ba","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-08T23:45:00Z","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"amount":"6000000.00","amount_basis":"ROUNDED","amount_precision":"1000000.00","component_type":"SIGNING_BONUS","confidence":"HIGH","currency_code":"USD","derivation_base_amount":null,"derivation_rate":null,"derivation_rule":null,"evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Baseball America's 2015-class review says the Dodgers signed Estevez for $6 million in November.","organization_name":"Los Angeles Dodgers","player_slug":"omar-estevez","ref":"estevez-bonus-ba","report_origin":"EXTERNAL_SOURCE","retrieved_at":"2026-10-08T23:45:00Z","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"amount":"120000.00","amount_basis":"EXACT","amount_precision":null,"component_type":"TRANSFER_FEE","confidence":"VERIFIED","currency_code":"USD","derivation_base_amount":null,"derivation_rate":null,"derivation_rule":null,"evidence_basis":"CANONICAL_FIELD_EVIDENCE","note":"Carried from DISI's existing field-level evidence for transfer_fee_usd (MLB.com en Espanol, $120,000). Not re-read in 030: MLB.com answered HTTP 406.","organization_name":"Los Angeles Dodgers","player_slug":"fernando-valenzuela","ref":"valenzuela-transfer-mlb","report_origin":"EXTERNAL_SOURCE","retrieved_at":null,"signing_year":1979,"source_url":"https://www.mlb.com/es/news/fallecio-fernando-valenzuela"}]}$m030$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 030 was written for
-- ===========================================================================

do $$
declare
  e jsonb;
  r record;
  n int;
  first_run boolean := to_regclass('public.signing_financial_reports') is null;
begin
  -- the seeded signings exist once, with the pre-030 values (or, on a rerun, the 030 values)
  for e in select x from _m030, jsonb_array_elements(j -> 'expectations' -> 'signings') x loop
    select count(*) into n from public.signings sg join public.players p on p.id = sg.player_id join public.organizations o on o.id = sg.organization_id
    where p.slug = e ->> 'player_slug' and o.name = e ->> 'organization_name' and sg.signing_year = (e ->> 'signing_year')::int;
    if n <> 1 then
      raise exception '030: expected exactly one signing for % %, found %', e ->> 'player_slug', e ->> 'signing_year', n;
    end if;
    select sg.signing_bonus_usd::text as b, sg.posting_fee_usd::text as p, sg.transfer_fee_usd::text as t into r
    from public.signings sg join public.players p on p.id = sg.player_id join public.organizations o on o.id = sg.organization_id
    where p.slug = e ->> 'player_slug' and o.name = e ->> 'organization_name' and sg.signing_year = (e ->> 'signing_year')::int;
    if not (r.b is not distinct from e ->> 'signing_bonus_usd' or r.b is not distinct from e ->> 'signing_bonus_usd_after')
       or not (r.p is not distinct from e ->> 'posting_fee_usd' or r.p is not distinct from e ->> 'posting_fee_usd_after')
       or r.t is distinct from e ->> 'transfer_fee_usd' then
      raise exception '030: % % has unexpected money values (bonus %, posting %, transfer %)', e ->> 'player_slug', e ->> 'signing_year', r.b, r.p, r.t;
    end if;
  end loop;

  -- the field-level money evidence is exactly the reviewed set; anything else would need its own review
  select count(*) into n from public.evidence ev
  where ev.entity_type = 'signing' and ev.field_name in ('signing_bonus_usd', 'posting_fee_usd', 'transfer_fee_usd');
  if n <> jsonb_array_length((select j -> 'expectations' -> 'field_level_money_evidence' from _m030)) then
    raise exception '030: found % field-level money evidence rows; the reviewed set has %', n,
      jsonb_array_length((select j -> 'expectations' -> 'field_level_money_evidence' from _m030));
  end if;
  for e in select x from _m030, jsonb_array_elements(j -> 'expectations' -> 'field_level_money_evidence') x loop
    if not exists (select 1 from public.evidence ev join public.signings sg on sg.id = ev.entity_id join public.players p on p.id = sg.player_id
                   join public.sources so on so.id = ev.source_id
                   where ev.entity_type = 'signing' and ev.field_name = e ->> 'field_name' and p.slug = e ->> 'player_slug'
                     and sg.signing_year = (e ->> 'signing_year')::int and so.url = e ->> 'source_url') then
      raise exception '030: the reviewed field-level evidence for % % is missing', e ->> 'player_slug', e ->> 'field_name';
    end if;
  end loop;

  -- the 2019-20 period summary carries the values the new environment is built from
  select count(*) into n from public.international_org_period_summary s join public.organizations o on o.id = s.organization_id
  join public.sources so on so.id = s.source_id
  where o.name = 'Los Angeles Dodgers' and s.period_start_year = 2019
    and s.pool_amount_usd::text = (select j -> 'expectations' -> 'period_summary_2019' ->> 'pool_amount_usd' from _m030)
    and s.pool_spent_usd::text = (select j -> 'expectations' -> 'period_summary_2019' ->> 'pool_spent_usd' from _m030)
    and so.url = (select j -> 'expectations' -> 'period_summary_2019' ->> 'source_url' from _m030);
  if n <> 1 then
    raise exception '030: the Dodgers 2019-20 period summary does not carry the reviewed pool / spend values';
  end if;

  -- every source the seed cites as already registered exists
  for e in select x from _m030, jsonb_array_elements(j -> 'existing_sources') x loop
    if not exists (select 1 from public.sources where url = e #>> '{}') then
      raise exception '030: expected source % is not registered', e #>> '{}';
    end if;
  end loop;

  -- on the first run nothing of 030 exists yet
  if first_run and (to_regclass('public.signing_environment_financial_reports') is not null or to_regclass('public.acquisition_cost_component_rules') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'signings' and column_name = 'international_pool_treatment')) then
    raise exception '030: a partial 030 state exists';
  end if;
end $$;

-- ===========================================================================
-- 2. SIGNINGS: additive pool-treatment columns
-- ===========================================================================

alter table public.signings add column if not exists international_pool_treatment text not null default 'UNKNOWN';
alter table public.signings add column if not exists international_pool_treatment_basis text;
alter table public.signings add column if not exists international_pool_treatment_source_id uuid references public.sources(id) on delete restrict;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.signings'::regclass and conname = 'signings_international_pool_treatment_check') then
    alter table public.signings add constraint signings_international_pool_treatment_check
      check (international_pool_treatment in ('SUBJECT', 'EXEMPT', 'NOT_SUBJECT', 'NOT_APPLICABLE', 'UNKNOWN'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.signings'::regclass and conname = 'signings_international_pool_treatment_basis_check') then
    alter table public.signings add constraint signings_international_pool_treatment_basis_check
      check (coalesce(case when international_pool_treatment = 'UNKNOWN'
                           then international_pool_treatment_basis is null and international_pool_treatment_source_id is null
                           else international_pool_treatment_basis in ('SOURCE_STATEMENT', 'RULE') and international_pool_treatment_source_id is not null end, false));
  end if;
end $$;

comment on column public.signings.international_pool_treatment is
  'How the international bonus pool treated this signing: SUBJECT, EXEMPT, NOT_SUBJECT, NOT_APPLICABLE (no pool existed) or UNKNOWN. Independent of pathway. Set only from a source statement or a cited rule (see the basis and source columns). It is not a pool charge: a charge lives in signing_financial_reports and is never assumed to equal the bonus.';
comment on column public.signings.international_pool_treatment_basis is
  'SOURCE_STATEMENT (a source says so for this signing) or RULE (a cited rule applies, e.g. signed before the pools began on 2012-07-02). NULL exactly when the treatment is UNKNOWN.';

-- ===========================================================================
-- 3. TABLES
-- ===========================================================================

create table if not exists public.acquisition_cost_component_rules (
  id uuid primary key default gen_random_uuid(),
  pathway public.acquisition_pathway not null,
  component_type text not null check (component_type in ('SIGNING_BONUS', 'POSTING_FEE', 'TRANSFER_FEE', 'RELEASE_FEE', 'OTHER_ACQUISITION_FEE')),
  applicability text not null check (applicability in ('REQUIRED', 'POSSIBLE', 'CONDITIONAL', 'NOT_APPLICABLE', 'NO_RULE')),
  explanation text not null check (nullif(btrim(explanation), '') is not null and char_length(explanation) <= 400),
  source_id uuid references public.sources(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (pathway, component_type)
);

create table if not exists public.signing_financial_reports (
  id uuid primary key default gen_random_uuid(),
  signing_id uuid not null references public.signings(id) on delete restrict,
  component_type text not null check (component_type in ('SIGNING_BONUS', 'POSTING_FEE', 'TRANSFER_FEE', 'RELEASE_FEE', 'POOL_CHARGE', 'OTHER_ACQUISITION_FEE')),
  amount numeric(14,2) not null check (amount >= 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  amount_basis text check (amount_basis in ('EXACT', 'ROUNDED', 'APPROXIMATE', 'RULE_DERIVED')),
  amount_precision numeric(14,2) check (amount_precision is null or amount_precision > 0),
  derivation_rate numeric(8,5) check (derivation_rate is null or derivation_rate > 0),
  derivation_base_amount numeric(14,2) check (derivation_base_amount is null or derivation_base_amount >= 0),
  derivation_rule text check (derivation_rule is null or char_length(derivation_rule) <= 300),
  report_origin text not null check (report_origin in ('EXTERNAL_SOURCE', 'LEGACY_CARRYFORWARD', 'RULE_DERIVED')),
  source_id uuid references public.sources(id) on delete restrict,
  evidence_basis text not null check (evidence_basis in ('PUBLISHED_INTERNATIONAL_REVIEW', 'NEWS_REPORT', 'TEAM_RELEASE', 'LEAGUE_ROUNDUP',
    'CANONICAL_FIELD_EVIDENCE', 'CANONICAL_PERIOD_SUMMARY', 'RULE_APPLICATION', 'LEGACY_CANONICAL_VALUE', 'OTHER')),
  confidence public.confidence_level not null,
  retrieved_at timestamptz,
  note text check (note is null or char_length(note) <= 400),
  record_status text not null default 'ACTIVE' check (record_status in ('ACTIVE', 'RETRACTED')),
  supersedes_report_id uuid references public.signing_financial_reports(id) on delete restrict,
  retracted_at timestamptz,
  retraction_reason text,
  created_at timestamptz not null default now(),
  -- a basis is required for everything except a legacy carry-forward, whose precision DISI never recorded
  constraint signing_financial_reports_basis_check check ((amount_basis is null) = (report_origin = 'LEGACY_CARRYFORWARD')),
  constraint signing_financial_reports_precision_check check (coalesce(amount_basis = 'ROUNDED', false) = (amount_precision is not null)),
  constraint signing_financial_reports_derivation_check check (coalesce(case when amount_basis = 'RULE_DERIVED'
      then derivation_rate is not null and derivation_base_amount is not null and nullif(btrim(derivation_rule), '') is not null
           and amount = round(derivation_base_amount * derivation_rate, 2)
      else derivation_rate is null and derivation_base_amount is null and derivation_rule is null end, false)),
  constraint signing_financial_reports_origin_check check (coalesce(case report_origin
      when 'EXTERNAL_SOURCE' then source_id is not null and retrieved_at is not null and evidence_basis not in ('LEGACY_CANONICAL_VALUE', 'RULE_APPLICATION')
      when 'LEGACY_CARRYFORWARD' then source_id is null and evidence_basis = 'LEGACY_CANONICAL_VALUE'
      when 'RULE_DERIVED' then source_id is not null and retrieved_at is not null and amount_basis = 'RULE_DERIVED' and evidence_basis = 'RULE_APPLICATION'
    end, false)),
  constraint signing_financial_reports_supersedes_check check (supersedes_report_id is null or supersedes_report_id <> id),
  constraint signing_financial_reports_retraction_check check ((record_status = 'RETRACTED') = (retracted_at is not null)
    and (record_status = 'ACTIVE' or nullif(btrim(retraction_reason), '') is not null)
    and (record_status = 'RETRACTED' or retraction_reason is null))
);
create unique index if not exists signing_financial_reports_supersedes_key on public.signing_financial_reports (supersedes_report_id)
  where supersedes_report_id is not null;
create unique index if not exists signing_financial_reports_active_key on public.signing_financial_reports (
  signing_id, component_type, report_origin, coalesce(source_id::text, ''), currency_code, amount) where record_status = 'ACTIVE';
create unique index if not exists signing_financial_reports_legacy_key on public.signing_financial_reports (signing_id, component_type)
  where record_status = 'ACTIVE' and report_origin = 'LEGACY_CARRYFORWARD';
create index if not exists signing_financial_reports_signing_idx on public.signing_financial_reports (signing_id);

create table if not exists public.signing_environment_financial_reports (
  id uuid primary key default gen_random_uuid(),
  signing_environment_id uuid not null references public.signing_environments(id) on delete restrict,
  metric_type text not null check (metric_type in ('BASE_POOL', 'POOL_AFTER_TRADES', 'POOL_SPACE_ACQUIRED', 'POOL_SPACE_SENT', 'PENALTY_REDUCTION',
    'REPORTED_PERIOD_SPEND', 'OVERAGE_TAX_RATE', 'OVERAGE_TAX_PAID', 'INDIVIDUAL_BONUS_CAP')),
  amount_usd numeric(14,2) check (amount_usd is null or amount_usd >= 0),
  rate_value numeric(8,5) check (rate_value is null or (rate_value >= 0 and rate_value <= 10)),
  amount_basis text check (amount_basis in ('EXACT', 'ROUNDED', 'APPROXIMATE', 'RULE_DERIVED')),
  amount_precision numeric(14,5) check (amount_precision is null or amount_precision > 0),
  derivation_note text check (derivation_note is null or char_length(derivation_note) <= 300),
  report_origin text not null check (report_origin in ('EXTERNAL_SOURCE', 'LEGACY_CARRYFORWARD', 'RULE_DERIVED')),
  source_id uuid references public.sources(id) on delete restrict,
  evidence_basis text not null check (evidence_basis in ('PUBLISHED_INTERNATIONAL_REVIEW', 'NEWS_REPORT', 'TEAM_RELEASE', 'LEAGUE_ROUNDUP',
    'CANONICAL_FIELD_EVIDENCE', 'CANONICAL_PERIOD_SUMMARY', 'RULE_APPLICATION', 'LEGACY_CANONICAL_VALUE', 'OTHER')),
  confidence public.confidence_level not null,
  retrieved_at timestamptz,
  note text check (note is null or char_length(note) <= 400),
  record_status text not null default 'ACTIVE' check (record_status in ('ACTIVE', 'RETRACTED')),
  supersedes_report_id uuid references public.signing_environment_financial_reports(id) on delete restrict,
  retracted_at timestamptz,
  retraction_reason text,
  created_at timestamptz not null default now(),
  -- typed values: a rate metric carries rate_value only, every other metric amount_usd only
  constraint signing_environment_financial_reports_value_check check (coalesce(case when metric_type = 'OVERAGE_TAX_RATE'
      then rate_value is not null and amount_usd is null else amount_usd is not null and rate_value is null end, false)),
  constraint signing_environment_financial_reports_basis_check check ((amount_basis is null) = (report_origin = 'LEGACY_CARRYFORWARD')),
  constraint signing_environment_financial_reports_precision_check check (coalesce(amount_basis = 'ROUNDED', false) = (amount_precision is not null)),
  constraint signing_environment_financial_reports_derivation_check check (coalesce(amount_basis = 'RULE_DERIVED', false) = (nullif(btrim(derivation_note), '') is not null)),
  constraint signing_environment_financial_reports_origin_check check (coalesce(case report_origin
      when 'EXTERNAL_SOURCE' then source_id is not null and retrieved_at is not null and evidence_basis not in ('LEGACY_CANONICAL_VALUE', 'RULE_APPLICATION')
      when 'LEGACY_CARRYFORWARD' then source_id is null and evidence_basis = 'LEGACY_CANONICAL_VALUE'
      when 'RULE_DERIVED' then source_id is not null and retrieved_at is not null and amount_basis = 'RULE_DERIVED' and evidence_basis = 'RULE_APPLICATION'
    end, false)),
  constraint signing_environment_financial_reports_supersedes_check check (supersedes_report_id is null or supersedes_report_id <> id),
  constraint signing_environment_financial_reports_retraction_check check ((record_status = 'RETRACTED') = (retracted_at is not null)
    and (record_status = 'ACTIVE' or nullif(btrim(retraction_reason), '') is not null)
    and (record_status = 'RETRACTED' or retraction_reason is null))
);
create unique index if not exists signing_environment_financial_reports_supersedes_key on public.signing_environment_financial_reports (supersedes_report_id)
  where supersedes_report_id is not null;
create unique index if not exists signing_environment_financial_reports_active_key on public.signing_environment_financial_reports (
  signing_environment_id, metric_type, report_origin, coalesce(source_id::text, ''), coalesce(amount_usd, -1), coalesce(rate_value, -1)) where record_status = 'ACTIVE';
create unique index if not exists signing_environment_financial_reports_legacy_key on public.signing_environment_financial_reports (signing_environment_id, metric_type)
  where record_status = 'ACTIVE' and report_origin = 'LEGACY_CARRYFORWARD';
create index if not exists signing_environment_financial_reports_env_idx on public.signing_environment_financial_reports (signing_environment_id);

comment on table public.acquisition_cost_component_rules is
  'Which acquisition-cost components a pathway requires (REQUIRED), may have (POSSIBLE: unknown keeps completeness PARTIAL), has only in specific cases (CONDITIONAL: does not block COMPLETE), never has (NOT_APPLICABLE), or has no rule for (NO_RULE). Used only for acquisition-cost completeness; it implies nothing about pool treatment, and POOL_CHARGE is deliberately not a component here.';
comment on table public.signing_financial_reports is
  'Provenance ledger of acquisition-cost components per signing. EXTERNAL_SOURCE rows are field-level provenance; LEGACY_CARRYFORWARD rows carry a pre-030 canonical value that has no field-level source and are never counted as sourced; RULE_DERIVED rows are DISI derivations from a cited rule. Independent reports that disagree stay ACTIVE side by side (a conflict), never a predecessor / successor pair. ACTIVE rows are sealed; nothing is deleted. Salary, guarantees, options, buyouts, agent pay, development cost and period tax are out of scope.';
comment on column public.signing_financial_reports.amount_basis is
  'EXACT as printed; ROUNDED with amount_precision (the unit of the last stated digit); APPROXIMATE ("about") never selects a canonical value; RULE_DERIVED with derivation_rate x derivation_base_amount = amount. NULL only for a legacy carry-forward.';
comment on column public.signing_financial_reports.currency_code is
  'Three-letter ISO-4217-shaped code. All current reports are USD. No conversion is stored or performed; only USD reports can select the USD canonical columns.';
comment on table public.signing_environment_financial_reports is
  'Provenance ledger of signing-environment (period / pool) facts. Money in amount_usd, rates in rate_value (exactly one per metric). Same origin, basis and lifecycle rules as signing_financial_reports. An overage tax rate is never multiplied into a tax amount here.';

-- ===========================================================================
-- 4. SEALING AND LIFECYCLE TRIGGERS
-- ===========================================================================

create or replace function public.disi_signing_financial_report_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pred public.signing_financial_reports%rowtype;
  treatment text;
begin
  if tg_op = 'DELETE' then
    raise exception 'financial reports are never deleted; retract them instead' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if old.record_status = 'RETRACTED' then
      raise exception 'a RETRACTED financial report is sealed (%)', old.id using errcode = '55000';
    end if;
    if new.record_status <> 'RETRACTED'
       or (to_jsonb(new) - 'record_status' - 'retracted_at' - 'retraction_reason') is distinct from (to_jsonb(old) - 'record_status' - 'retracted_at' - 'retraction_reason') then
      raise exception 'an ACTIVE financial report is sealed; the only change allowed is retraction (%)', old.id using errcode = '55000';
    end if;
    return new;
  end if;
  if new.record_status <> 'ACTIVE' then
    raise exception 'a new financial report starts ACTIVE' using errcode = '55000';
  end if;
  if new.component_type = 'POOL_CHARGE' then
    select international_pool_treatment into treatment from public.signings where id = new.signing_id;
    if treatment in ('EXEMPT', 'NOT_SUBJECT', 'NOT_APPLICABLE') then
      raise exception 'a POOL_CHARGE cannot be recorded for a signing whose pool treatment is %', treatment using errcode = '55000';
    end if;
  end if;
  if new.supersedes_report_id is not null then
    select * into pred from public.signing_financial_reports where id = new.supersedes_report_id;
    if not found or pred.id = new.id or pred.signing_id <> new.signing_id or pred.component_type <> new.component_type then
      raise exception 'a correction must supersede an existing report of the same signing and component (%)', new.supersedes_report_id using errcode = '55000';
    end if;
    if pred.record_status = 'ACTIVE' then
      update public.signing_financial_reports
        set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'Superseded by a corrected report.'
      where id = pred.id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_signing_financial_report_guard() from public, anon, authenticated;

create or replace function public.disi_environment_financial_report_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pred public.signing_environment_financial_reports%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'financial reports are never deleted; retract them instead' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if old.record_status = 'RETRACTED' then
      raise exception 'a RETRACTED financial report is sealed (%)', old.id using errcode = '55000';
    end if;
    if new.record_status <> 'RETRACTED'
       or (to_jsonb(new) - 'record_status' - 'retracted_at' - 'retraction_reason') is distinct from (to_jsonb(old) - 'record_status' - 'retracted_at' - 'retraction_reason') then
      raise exception 'an ACTIVE financial report is sealed; the only change allowed is retraction (%)', old.id using errcode = '55000';
    end if;
    return new;
  end if;
  if new.record_status <> 'ACTIVE' then
    raise exception 'a new financial report starts ACTIVE' using errcode = '55000';
  end if;
  if new.supersedes_report_id is not null then
    select * into pred from public.signing_environment_financial_reports where id = new.supersedes_report_id;
    if not found or pred.id = new.id or pred.signing_environment_id <> new.signing_environment_id or pred.metric_type <> new.metric_type then
      raise exception 'a correction must supersede an existing report of the same environment and metric (%)', new.supersedes_report_id using errcode = '55000';
    end if;
    if pred.record_status = 'ACTIVE' then
      update public.signing_environment_financial_reports
        set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'Superseded by a corrected report.'
      where id = pred.id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_environment_financial_report_guard() from public, anon, authenticated;

drop trigger if exists signing_financial_reports_guard on public.signing_financial_reports;
create trigger signing_financial_reports_guard
before insert or update or delete on public.signing_financial_reports
for each row execute function public.disi_signing_financial_report_guard();
drop trigger if exists signing_environment_financial_reports_guard on public.signing_environment_financial_reports;
create trigger signing_environment_financial_reports_guard
before insert or update or delete on public.signing_environment_financial_reports
for each row execute function public.disi_environment_financial_report_guard();

-- ===========================================================================
-- 5. SECURITY: RLS, public read, no API writes
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['acquisition_cost_component_rules', 'signing_financial_reports', 'signing_environment_financial_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists public_read_%I on public.%I', t, t);
    execute format('create policy public_read_%I on public.%I for select to anon, authenticated using (true)', t, t);
  end loop;
end $$;

-- ===========================================================================
-- 6. SOURCES AND COMPONENT RULES
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, author, publication_date, accessed_at, notes, source_tier)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'author', (x ->> 'publication_date')::date,
       (x ->> 'accessed_at')::timestamptz, x ->> 'notes', x ->> 'source_tier'
from _m030, jsonb_array_elements(j -> 'new_sources') x
on conflict (url) do nothing;

insert into public.acquisition_cost_component_rules (pathway, component_type, applicability, explanation, source_id)
select (x ->> 'pathway')::public.acquisition_pathway, x ->> 'component_type', x ->> 'applicability', x ->> 'explanation',
       (select s.id from public.sources s where s.url = x ->> 'source_url')
from _m030, jsonb_array_elements(j -> 'component_rules') x
on conflict (pathway, component_type) do nothing;

-- ===========================================================================
-- 7. LEGACY CARRY-FORWARD (derived from data, before any 030 change)
-- ===========================================================================
-- Every non-null money column that has no report yet (at any status) and no DISI field-level evidence is
-- carried as LEGACY_CARRYFORWARD: no source, no basis, confidence UNVERIFIED. Columns WITH field-level
-- evidence are carried as EXTERNAL_SOURCE in section 9 (the precondition pinned that set). On a rerun
-- every column already has a report, so nothing is added.

insert into public.signing_financial_reports (signing_id, component_type, amount, currency_code, report_origin, evidence_basis, confidence, note)
select c.signing_id, c.component_type, c.amount, 'USD', 'LEGACY_CARRYFORWARD', 'LEGACY_CANONICAL_VALUE', 'UNVERIFIED',
       'Pre-030 canonical value with no field-level source. Carried forward; not external provenance.'
from (
  select sg.id as signing_id, v.component_type, v.amount, v.field_name
  from public.signings sg
  cross join lateral (values ('SIGNING_BONUS', sg.signing_bonus_usd, 'signing_bonus_usd'), ('POSTING_FEE', sg.posting_fee_usd, 'posting_fee_usd'),
                             ('TRANSFER_FEE', sg.transfer_fee_usd, 'transfer_fee_usd')) v(component_type, amount, field_name)
  where v.amount is not null
) c
where not exists (select 1 from public.signing_financial_reports fr where fr.signing_id = c.signing_id and fr.component_type = c.component_type)
  and not exists (select 1 from public.evidence ev where ev.entity_type = 'signing' and ev.entity_id = c.signing_id and ev.field_name = c.field_name);

insert into public.signing_environment_financial_reports (signing_environment_id, metric_type, amount_usd, rate_value, report_origin, evidence_basis, confidence, note)
select c.env_id, c.metric_type, c.amount_usd, c.rate_value, 'LEGACY_CARRYFORWARD', 'LEGACY_CANONICAL_VALUE', 'UNVERIFIED',
       'Pre-030 canonical environment value with no field-level source. Carried forward; not external provenance.'
from (
  select e.id as env_id, v.metric_type, v.amount_usd, v.rate_value
  from public.signing_environments e
  cross join lateral (values ('BASE_POOL', e.club_bonus_pool_usd, null::numeric), ('POOL_AFTER_TRADES', e.pool_after_trades_usd, null::numeric),
                             ('INDIVIDUAL_BONUS_CAP', e.max_individual_bonus_usd, null::numeric), ('OVERAGE_TAX_RATE', null::numeric, e.overage_tax_rate)) v(metric_type, amount_usd, rate_value)
  where coalesce(v.amount_usd, v.rate_value) is not null
) c
where not exists (select 1 from public.signing_environment_financial_reports fr where fr.signing_environment_id = c.env_id and fr.metric_type = c.metric_type);

-- ===========================================================================
-- 8. THE DODGERS 2019-20 SIGNING ENVIRONMENT
-- ===========================================================================

do $$
declare
  ne jsonb := (select j -> 'new_environment' from _m030);
  org uuid;
  env uuid;
  r record;
  sid uuid;
begin
  select id into org from public.organizations where name = ne ->> 'organization_name';
  select * into r from public.signing_environments where organization_id = org and signing_year = (ne ->> 'signing_year')::int;
  if not found then
    insert into public.signing_environments (organization_id, signing_year, regime, club_bonus_pool_usd, pool_after_trades_usd, signing_period_label,
      max_individual_bonus_usd, overage_tax_rate, tradeable_pool_space, penalty_status, rules_summary, cba_regime, notes)
    values (org, (ne ->> 'signing_year')::int, (ne ->> 'regime')::public.signing_regime, (ne ->> 'club_bonus_pool_usd')::numeric, null, ne ->> 'signing_period_label',
      null, null, (ne ->> 'tradeable_pool_space')::boolean, null, ne ->> 'rules_summary', null, ne ->> 'notes')
    returning id into env;
  elsif r.regime::text <> ne ->> 'regime' or r.club_bonus_pool_usd::text is distinct from ne ->> 'club_bonus_pool_usd'
        or r.signing_period_label is distinct from ne ->> 'signing_period_label' or r.pool_after_trades_usd is not null then
    raise exception '030: a Dodgers 2019 signing environment exists with unexpected content';
  else
    env := r.id;
  end if;
  -- link the members of the reviewed full-period population, and nobody else
  for sid in select m.signing_id from public.signing_population_members m join public.signing_populations sp on sp.id = m.population_id
             where sp.population_key = ne ->> 'linked_population_key' loop
    if exists (select 1 from public.signings where id = sid and signing_environment_id is not null and signing_environment_id <> env) then
      raise exception '030: a 2019-20 population member is linked to another environment';
    end if;
    update public.signings set signing_environment_id = env where id = sid and signing_environment_id is null;
  end loop;
end $$;

-- ===========================================================================
-- 9. SOURCE-STATED REPORTS
-- ===========================================================================
-- Each report is skipped when an ACTIVE or RETRACTED report with the same signing / environment,
-- component / metric, source and value already exists, so reruns and later corrections never
-- recreate a row.

do $$
declare
  e jsonb;
  sid uuid;
  src uuid;
begin
  for e in select x from _m030, jsonb_array_elements(j -> 'signing_reports') x loop
    select sg.id into sid from public.signings sg join public.players p on p.id = sg.player_id join public.organizations o on o.id = sg.organization_id
    where p.slug = e ->> 'player_slug' and o.name = e ->> 'organization_name' and sg.signing_year = (e ->> 'signing_year')::int;
    select id into src from public.sources where url = e ->> 'source_url';
    if sid is null or src is null then
      raise exception '030: references for report % are unresolved', e ->> 'ref';
    end if;
    if not exists (select 1 from public.signing_financial_reports where signing_id = sid and component_type = e ->> 'component_type'
                   and source_id = src and amount = (e ->> 'amount')::numeric and currency_code = e ->> 'currency_code') then
      insert into public.signing_financial_reports (signing_id, component_type, amount, currency_code, amount_basis, amount_precision,
        derivation_rate, derivation_base_amount, derivation_rule, report_origin, source_id, evidence_basis, confidence, retrieved_at, note)
      select sid, e ->> 'component_type', (e ->> 'amount')::numeric, e ->> 'currency_code', e ->> 'amount_basis', (e ->> 'amount_precision')::numeric,
        (e ->> 'derivation_rate')::numeric, (e ->> 'derivation_base_amount')::numeric, e ->> 'derivation_rule', e ->> 'report_origin', src, e ->> 'evidence_basis',
        (e ->> 'confidence')::public.confidence_level, coalesce((e ->> 'retrieved_at')::timestamptz, so.accessed_at, (select (j ->> 'review_timestamp')::timestamptz from _m030)), e ->> 'note'
      from public.sources so where so.id = src;
    end if;
  end loop;

  for e in select x from _m030, jsonb_array_elements(j -> 'environment_reports') x loop
    select se.id into sid from public.signing_environments se join public.organizations o on o.id = se.organization_id
    where o.name = 'Los Angeles Dodgers' and se.signing_year = (e ->> 'signing_year')::int;
    select id into src from public.sources where url = e ->> 'source_url';
    if sid is null or src is null then
      raise exception '030: references for environment report % are unresolved', e ->> 'ref';
    end if;
    if not exists (select 1 from public.signing_environment_financial_reports where signing_environment_id = sid and metric_type = e ->> 'metric_type'
                   and source_id = src and amount_usd is not distinct from (e ->> 'amount_usd')::numeric and rate_value is not distinct from (e ->> 'rate_value')::numeric) then
      insert into public.signing_environment_financial_reports (signing_environment_id, metric_type, amount_usd, rate_value, amount_basis, amount_precision,
        report_origin, source_id, evidence_basis, confidence, retrieved_at, note)
      select sid, e ->> 'metric_type', (e ->> 'amount_usd')::numeric, (e ->> 'rate_value')::numeric, e ->> 'amount_basis', (e ->> 'amount_precision')::numeric,
        e ->> 'report_origin', src, e ->> 'evidence_basis', (e ->> 'confidence')::public.confidence_level,
        coalesce((e ->> 'retrieved_at')::timestamptz, so.accessed_at, (select (j ->> 'review_timestamp')::timestamptz from _m030)), e ->> 'note'
      from public.sources so where so.id = src;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 10. CANONICAL CHANGES (guarded in section 1; idempotent)
-- ===========================================================================

do $$
declare
  c jsonb;
  sid uuid;
begin
  for c in select x from _m030, jsonb_array_elements(j -> 'canonical_changes') x loop
    select sg.id into sid from public.signings sg join public.players p on p.id = sg.player_id join public.organizations o on o.id = sg.organization_id
    where p.slug = c ->> 'player_slug' and o.name = c ->> 'organization_name' and sg.signing_year = (c ->> 'signing_year')::int;
    if c ->> 'column' = 'signing_bonus_usd' then
      update public.signings set signing_bonus_usd = (c ->> 'to')::numeric where id = sid and signing_bonus_usd is not distinct from (c ->> 'from')::numeric;
    elsif c ->> 'column' = 'posting_fee_usd' then
      update public.signings set posting_fee_usd = (c ->> 'to')::numeric where id = sid and posting_fee_usd is not distinct from (c ->> 'from')::numeric;
    elsif c ->> 'column' = 'bonus_publicly_reported' then
      update public.signings set bonus_publicly_reported = (c ->> 'to')::boolean where id = sid and bonus_publicly_reported = (c ->> 'from')::boolean;
    else
      raise exception '030: unsupported canonical change %', c ->> 'column';
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 11. INTERNATIONAL POOL TREATMENT
-- ===========================================================================
-- Source statements first, then the pre-pool rule for everything still UNKNOWN. A treatment that
-- is already set is never overwritten here.

do $$
declare
  e jsonb;
  rule jsonb := (select j -> 'pool_treatment_rule' from _m030);
  sid uuid;
  src uuid;
begin
  for e in select x from _m030, jsonb_array_elements(j -> 'pool_treatments') x loop
    select sg.id into sid from public.signings sg join public.players p on p.id = sg.player_id join public.organizations o on o.id = sg.organization_id
    where p.slug = e ->> 'player_slug' and o.name = e ->> 'organization_name' and sg.signing_year = (e ->> 'signing_year')::int;
    select id into src from public.sources where url = e ->> 'source_url';
    if sid is null or src is null then
      raise exception '030: references for the pool treatment of % are unresolved', e ->> 'player_slug';
    end if;
    update public.signings set international_pool_treatment = e ->> 'treatment', international_pool_treatment_basis = e ->> 'basis', international_pool_treatment_source_id = src
    where id = sid and international_pool_treatment = 'UNKNOWN';
    if not exists (select 1 from public.signings where id = sid and international_pool_treatment = e ->> 'treatment') then
      raise exception '030: % already carries a different pool treatment', e ->> 'player_slug';
    end if;
  end loop;
  select id into src from public.sources where url = rule ->> 'source_url';
  update public.signings set international_pool_treatment = rule ->> 'treatment', international_pool_treatment_basis = rule ->> 'basis', international_pool_treatment_source_id = src
  where international_pool_treatment = 'UNKNOWN'
    and (signing_date < date '2012-07-02' or (signing_date is null and signing_year <= 2011));
end $$;

-- ===========================================================================
-- 12. VIEWS
-- ===========================================================================
-- Reconciliation rule used throughout (ACTIVE USD reports of one signing x component, or one
-- environment x metric):
--   points     = the distinct amounts of EXACT, RULE_DERIVED and legacy carry-forward reports
--   candidates = the points; if there are none, the distinct ROUNDED amounts
--   0 candidates                     -> APPROXIMATE_ONLY (approximate figures never select a value)
--   more than 1 candidate            -> CONFLICT
--   1 candidate outside some ROUNDED report's interval (amount +/- precision / 2) -> CONFLICT
--   otherwise                        -> AGREED, and the candidate is the selected value
-- The canonical column equals the selected value when AGREED and is NULL under CONFLICT.

create or replace view public.v_signing_acquisition_financials
with (security_invoker = true)
as
with r as (
  select fr.signing_id, fr.component_type, fr.amount, fr.amount_basis, fr.amount_precision, fr.report_origin
  from public.signing_financial_reports fr
  where fr.record_status = 'ACTIVE' and fr.currency_code = 'USD'
),
agg as (
  select r.signing_id, r.component_type,
    count(*) filter (where r.report_origin = 'EXTERNAL_SOURCE')::int as external_reports,
    count(*) filter (where r.report_origin = 'LEGACY_CARRYFORWARD')::int as legacy_reports,
    count(*) filter (where r.report_origin = 'RULE_DERIVED')::int as rule_derived_reports,
    count(distinct r.amount) filter (where r.amount_basis is null or r.amount_basis in ('EXACT', 'RULE_DERIVED'))::int as n_points,
    min(r.amount) filter (where r.amount_basis is null or r.amount_basis in ('EXACT', 'RULE_DERIVED')) as point_amount,
    count(distinct r.amount) filter (where r.amount_basis = 'ROUNDED')::int as n_rounded,
    min(r.amount) filter (where r.amount_basis = 'ROUNDED') as rounded_amount
  from r
  group by r.signing_id, r.component_type
),
cand as (
  select a.*, case when a.n_points > 0 then a.n_points else a.n_rounded end as n_candidates,
         case when a.n_points > 0 then a.point_amount else a.rounded_amount end as candidate
  from agg a
),
comp as (
  select c.signing_id, c.component_type, c.external_reports, c.legacy_reports, c.rule_derived_reports, c.candidate,
    case
      when c.n_candidates = 0 then 'APPROXIMATE_ONLY'
      when c.n_candidates > 1 then 'CONFLICT'
      when exists (select 1 from r where r.signing_id = c.signing_id and r.component_type = c.component_type and r.amount_basis = 'ROUNDED'
                   and abs(r.amount - c.candidate) > r.amount_precision / 2) then 'CONFLICT'
      else 'AGREED'
    end as resolution_status
  from cand c
),
per_signing as (
  select s.id as signing_id,
    coalesce(sum(comp.external_reports), 0)::int as external_report_count,
    coalesce(sum(comp.legacy_reports), 0)::int as legacy_report_count,
    coalesce(sum(comp.rule_derived_reports), 0)::int as rule_derived_report_count,
    coalesce(array_agg(comp.component_type order by comp.component_type) filter (where comp.resolution_status = 'CONFLICT'), '{}'::text[]) as conflicting_components,
    coalesce(array_agg(comp.component_type order by comp.component_type) filter (where comp.external_reports > 0), '{}'::text[]) as externally_reported_components,
    max(comp.candidate) filter (where comp.component_type = 'RELEASE_FEE' and comp.resolution_status = 'AGREED') as release_fee_usd,
    max(comp.candidate) filter (where comp.component_type = 'OTHER_ACQUISITION_FEE' and comp.resolution_status = 'AGREED') as other_acquisition_fee_usd,
    max(comp.candidate) filter (where comp.component_type = 'POOL_CHARGE' and comp.resolution_status = 'AGREED') as pool_charge_usd,
    bool_or(comp.component_type = 'POOL_CHARGE' and comp.resolution_status = 'CONFLICT') as pool_charge_conflict
  from public.signings s
  left join comp on comp.signing_id = s.id
  group by s.id
),
rules as (
  select ru.pathway,
    coalesce(array_agg(ru.component_type order by ru.component_type) filter (where ru.applicability = 'REQUIRED'), '{}'::text[]) as required_components,
    coalesce(array_agg(ru.component_type order by ru.component_type) filter (where ru.applicability = 'POSSIBLE'), '{}'::text[]) as possible_components,
    bool_and(ru.applicability = 'NO_RULE') as no_rule
  from public.acquisition_cost_component_rules ru
  group by ru.pathway
),
base as (
  select s.*, ps.external_report_count, ps.legacy_report_count, ps.rule_derived_report_count, ps.conflicting_components, ps.externally_reported_components,
    ps.release_fee_usd, ps.other_acquisition_fee_usd, ps.pool_charge_usd, ps.pool_charge_conflict,
    ru.required_components, ru.possible_components, coalesce(ru.no_rule, true) as no_rule,
    array_remove(array[
      case when s.signing_bonus_usd is not null then 'SIGNING_BONUS' end,
      case when s.posting_fee_usd is not null then 'POSTING_FEE' end,
      case when s.transfer_fee_usd is not null then 'TRANSFER_FEE' end,
      case when ps.release_fee_usd is not null then 'RELEASE_FEE' end,
      case when ps.other_acquisition_fee_usd is not null then 'OTHER_ACQUISITION_FEE' end], null) as known_components
  from public.signings s
  join per_signing ps on ps.signing_id = s.id
  left join rules ru on ru.pathway = s.pathway
)
select
  b.id as signing_id, p.id as player_id, p.slug as player_slug, p.full_name,
  o.name as organization_name, (o.franchise_key = 'DODGERS') as is_dodgers,
  b.signing_year, b.signing_date, b.pathway::text as pathway, b.country_market,
  b.signing_environment_id, env.signing_period_label as environment_period_label, env.regime::text as environment_regime,
  'USD'::text as currency_code,
  b.signing_bonus_usd, b.posting_fee_usd, b.transfer_fee_usd, b.release_fee_usd, b.other_acquisition_fee_usd,
  case when cardinality(b.known_components) = 0 then null
       else coalesce(b.signing_bonus_usd, 0) + coalesce(b.posting_fee_usd, 0) + coalesce(b.transfer_fee_usd, 0) + coalesce(b.release_fee_usd, 0) + coalesce(b.other_acquisition_fee_usd, 0)
  end as known_acquisition_cost_usd,
  case
    when b.no_rule then 'NO_RULE'
    when cardinality(b.known_components) > 0 and b.required_components <@ b.known_components and b.possible_components <@ b.known_components then 'COMPLETE'
    when cardinality(b.known_components) = 0 then 'UNKNOWN'
    else 'PARTIAL'
  end as acquisition_cost_completeness,
  b.known_components,
  case when b.no_rule then '{}'::text[] else array(select x from unnest(b.required_components) x where not x = any(b.known_components) order by x) end as required_components_unresolved,
  case when b.no_rule then '{}'::text[] else array(select x from unnest(b.possible_components) x where not x = any(b.known_components) order by x) end as possible_components_unknown,
  case when b.signing_bonus_usd is not null then 'KNOWN' when 'SIGNING_BONUS' = any(b.conflicting_components) then 'CONFLICT' else 'UNKNOWN' end as bonus_status,
  case when b.signing_bonus_usd is null then 'NONE'
       when 'SIGNING_BONUS' = any(b.externally_reported_components) then 'EXTERNALLY_SOURCED'
       else 'LEGACY_CANONICAL_ONLY' end as bonus_source_status,
  cardinality(array(select x from unnest(b.known_components) x where x = any(b.externally_reported_components)))::int as known_components_externally_sourced,
  cardinality(array(select x from unnest(b.known_components) x where not x = any(b.externally_reported_components)))::int as known_components_legacy_only,
  case when cardinality(b.known_components) = 0 then 'NO_KNOWN_COST'
       when b.known_components <@ b.externally_reported_components then 'ALL_KNOWN_COMPONENTS_EXTERNALLY_SOURCED'
       when cardinality(array(select x from unnest(b.known_components) x where x = any(b.externally_reported_components))) = 0 then 'LEGACY_CANONICAL_ONLY'
       else 'PARTLY_EXTERNALLY_SOURCED' end as cost_source_coverage,
  b.external_report_count, b.legacy_report_count, b.rule_derived_report_count,
  b.conflicting_components, (cardinality(b.conflicting_components) > 0) as has_financial_conflict,
  b.international_pool_treatment, b.international_pool_treatment_basis as pool_treatment_basis, pts.url as pool_treatment_source_url,
  b.pool_charge_usd as known_pool_charge_usd,
  case when b.international_pool_treatment in ('EXEMPT', 'NOT_SUBJECT', 'NOT_APPLICABLE') then 'NOT_APPLICABLE'
       when b.pool_charge_usd is not null then 'KNOWN' when b.pool_charge_conflict then 'CONFLICT' else 'UNKNOWN' end as pool_charge_status,
  (env.club_bonus_pool_usd is not null or env.pool_after_trades_usd is not null) as environment_pool_capacity_known,
  case
    when b.international_pool_treatment in ('EXEMPT', 'NOT_SUBJECT', 'NOT_APPLICABLE') then 'NOT_APPLICABLE'
    when b.international_pool_treatment = 'UNKNOWN' then 'UNKNOWN'
    when b.pool_charge_usd is not null and (env.club_bonus_pool_usd is not null or env.pool_after_trades_usd is not null) then 'COMPLETE'
    else 'PARTIAL'
  end as pool_completeness
from base b
join public.players p on p.id = b.player_id
join public.organizations o on o.id = b.organization_id
left join public.signing_environments env on env.id = b.signing_environment_id
left join public.sources pts on pts.id = b.international_pool_treatment_source_id;

comment on view public.v_signing_acquisition_financials is
  'One row per signing: canonical component values, known acquisition cost paired with its completeness (COMPLETE / PARTIAL / UNKNOWN / NO_RULE from acquisition_cost_component_rules), and a separate pool / regulatory completeness. bonus_source_status and cost_source_coverage come from the ledger, never from bonus_publicly_reported; a LEGACY_CANONICAL_ONLY value is known in DISI but not externally sourced. Unknown is NULL, never zero. No WAR, salary, ROI or ranking.';

create or replace view public.v_dodgers_financial_commitment_by_class
with (security_invoker = true)
as
with f as (
  select * from public.v_signing_acquisition_financials where is_dodgers
),
er as (
  select fr.signing_environment_id as env_id, fr.metric_type, coalesce(fr.amount_usd, fr.rate_value) as value, fr.amount_basis, fr.amount_precision, fr.report_origin
  from public.signing_environment_financial_reports fr
  where fr.record_status = 'ACTIVE'
),
eagg as (
  select er.env_id, er.metric_type,
    count(*) filter (where er.report_origin = 'EXTERNAL_SOURCE')::int as external_reports,
    count(distinct er.value) filter (where er.amount_basis is null or er.amount_basis in ('EXACT', 'RULE_DERIVED'))::int as n_points,
    min(er.value) filter (where er.amount_basis is null or er.amount_basis in ('EXACT', 'RULE_DERIVED')) as point_value,
    count(distinct er.value) filter (where er.amount_basis = 'ROUNDED')::int as n_rounded,
    min(er.value) filter (where er.amount_basis = 'ROUNDED') as rounded_value,
    max(er.value) filter (where er.amount_basis = 'APPROXIMATE') as approximate_value
  from er
  group by er.env_id, er.metric_type
),
ecomp as (
  select c.env_id, c.metric_type, c.external_reports, c.approximate_value,
    case
      when c.n_candidates = 0 then 'APPROXIMATE_ONLY'
      when c.n_candidates > 1 then 'CONFLICT'
      when exists (select 1 from er where er.env_id = c.env_id and er.metric_type = c.metric_type and er.amount_basis = 'ROUNDED'
                   and abs(er.value - c.candidate) > er.amount_precision / 2) then 'CONFLICT'
      else 'AGREED'
    end as resolution_status,
    c.candidate
  from (select a.*, case when a.n_points > 0 then a.n_points else a.n_rounded end as n_candidates,
               case when a.n_points > 0 then a.point_value else a.rounded_value end as candidate from eagg a) c
),
envs as (
  select e.id as env_id, e.signing_year, e.signing_period_label, e.regime::text as regime,
    max(ec.candidate) filter (where ec.metric_type = 'BASE_POOL' and ec.resolution_status = 'AGREED') as base_pool_usd,
    max(ec.candidate) filter (where ec.metric_type = 'POOL_AFTER_TRADES' and ec.resolution_status = 'AGREED') as pool_after_trades_usd,
    bool_or(ec.external_reports > 0) filter (where ec.metric_type = 'BASE_POOL') as base_pool_external,
    bool_or(ec.external_reports > 0) filter (where ec.metric_type = 'POOL_AFTER_TRADES') as after_trades_external,
    max(ec.candidate) filter (where ec.metric_type = 'REPORTED_PERIOD_SPEND' and ec.resolution_status = 'AGREED') as reported_spend_usd,
    max(ec.approximate_value) filter (where ec.metric_type = 'REPORTED_PERIOD_SPEND') as approximate_reported_spend_usd
  from public.signing_environments e
  join public.organizations o on o.id = e.organization_id and o.franchise_key = 'DODGERS'
  left join ecomp ec on ec.env_id = e.id
  group by e.id, e.signing_year, e.signing_period_label, e.regime
),
classes as (
  select 'SIGNING_ENVIRONMENT'::text as class_basis, en.env_id, en.signing_year as class_year, en.signing_period_label as period_label from envs en
  union all
  select distinct 'UNLINKED_SIGNING_YEAR', null::uuid, f.signing_year, f.signing_year::text from f where f.signing_environment_id is null
),
rolled as (
  select c.class_basis, c.env_id, c.class_year, c.period_label,
    count(f.signing_id)::int as signings,
    count(f.signing_id) filter (where f.bonus_status = 'KNOWN')::int as bonus_known,
    count(f.signing_id) filter (where f.bonus_status = 'UNKNOWN')::int as bonus_unknown,
    count(f.signing_id) filter (where f.bonus_status = 'CONFLICT')::int as bonus_conflicts,
    sum(f.signing_bonus_usd) as known_bonus_sum_usd,
    count(f.signing_id) filter (where f.known_acquisition_cost_usd is not null)::int as signings_with_known_cost,
    sum(f.known_acquisition_cost_usd) as known_cost_sum_usd,
    count(f.signing_id) filter (where f.acquisition_cost_completeness = 'COMPLETE')::int as acquisition_complete,
    count(f.signing_id) filter (where f.acquisition_cost_completeness = 'PARTIAL')::int as acquisition_partial,
    count(f.signing_id) filter (where f.acquisition_cost_completeness = 'UNKNOWN')::int as acquisition_unknown,
    count(f.signing_id) filter (where f.acquisition_cost_completeness = 'NO_RULE')::int as acquisition_no_rule,
    count(f.signing_id) filter (where f.international_pool_treatment = 'SUBJECT')::int as pool_subject,
    count(f.signing_id) filter (where f.international_pool_treatment = 'UNKNOWN')::int as pool_treatment_unknown,
    count(f.signing_id) filter (where f.international_pool_treatment = 'SUBJECT' and f.known_pool_charge_usd is not null)::int as pool_charges_known,
    sum(f.known_pool_charge_usd) as known_pool_charge_sum_usd
  from classes c
  left join f on (c.class_basis = 'SIGNING_ENVIRONMENT' and f.signing_environment_id = c.env_id)
              or (c.class_basis = 'UNLINKED_SIGNING_YEAR' and f.signing_environment_id is null and f.signing_year = c.class_year)
  group by c.class_basis, c.env_id, c.class_year, c.period_label
),
shaped as (
  select r.*, en.regime, en.base_pool_usd, en.pool_after_trades_usd, en.reported_spend_usd, en.approximate_reported_spend_usd,
    coalesce(en.pool_after_trades_usd, en.base_pool_usd) as pool_capacity_usd,
    case when en.pool_after_trades_usd is not null then 'POOL_AFTER_TRADES' when en.base_pool_usd is not null then 'BASE_POOL' end as pool_capacity_basis,
    case when en.pool_after_trades_usd is not null then coalesce(en.after_trades_external, false)
         when en.base_pool_usd is not null then coalesce(en.base_pool_external, false) end as pool_capacity_externally_sourced,
    case when r.class_basis <> 'SIGNING_ENVIRONMENT' or coalesce(en.pool_after_trades_usd, en.base_pool_usd) is null then 'NOT_APPLICABLE'
         when en.pool_after_trades_usd is not null then 'KNOWN' else 'UNKNOWN' end as pool_adjustment_completeness,
    pc.population_key, coalesce(pc.completeness_status, 'NO_DEFINED_POPULATION') as population_completeness, coalesce(pc.population_complete, false) as population_complete
  from rolled r
  left join envs en on en.env_id = r.env_id
  left join lateral (
    select c.population_key, c.completeness_status, c.population_complete
    from public.v_dodgers_signing_population_coverage c
    where c.population_scope = 'FULL_SIGNING_PERIOD' and c.signing_year = r.class_year
    order by c.population_key limit 1
  ) pc on true
)
select
  s.class_basis, s.env_id as signing_environment_id, s.class_year, s.period_label, s.regime,
  s.signings, s.population_key, s.population_completeness, s.population_complete,
  s.bonus_known, s.bonus_unknown, s.bonus_conflicts, s.known_bonus_sum_usd,
  s.signings_with_known_cost, s.known_cost_sum_usd,
  s.acquisition_complete, s.acquisition_partial, s.acquisition_unknown, s.acquisition_no_rule,
  s.pool_subject, s.pool_treatment_unknown, s.pool_charges_known,
  s.base_pool_usd, s.pool_after_trades_usd, s.pool_capacity_usd, s.pool_capacity_basis, s.pool_capacity_externally_sourced, s.pool_adjustment_completeness,
  case when s.pool_capacity_usd > 0 and s.bonus_known > 0 then round(100.0 * s.known_bonus_sum_usd / s.pool_capacity_usd, 1) end as known_tracked_bonus_pct_of_pool,
  case when s.pool_capacity_usd > 0 and s.bonus_known > 0 then format(
    'Known tracked bonuses as a share of the %s (%s regime). Not utilization: population %s, %s of %s tracked bonuses known, pool adjustments %s.',
    lower(replace(s.pool_capacity_basis, '_', ' ')), s.regime, lower(replace(s.population_completeness, '_', ' ')), s.bonus_known, s.signings, lower(s.pool_adjustment_completeness)) end
    as known_tracked_bonus_pct_basis,
  s.reported_spend_usd as source_reported_spend_usd,
  s.approximate_reported_spend_usd as source_reported_approximate_spend_usd,
  case when s.reported_spend_usd is not null and s.pool_capacity_usd > 0 then round(100.0 * s.reported_spend_usd / s.pool_capacity_usd, 1) end as source_reported_utilization_pct,
  case when s.reported_spend_usd is not null and s.pool_capacity_usd > 0 then format('Source-reported spend divided by the source-reported %s.', lower(replace(s.pool_capacity_basis, '_', ' '))) end
    as source_reported_utilization_basis,
  (s.class_basis = 'SIGNING_ENVIRONMENT' and s.population_complete and s.pool_capacity_usd > 0 and s.pool_adjustment_completeness = 'KNOWN'
    and s.pool_treatment_unknown = 0 and s.pool_charges_known = s.pool_subject) as true_utilization_eligible,
  case when s.class_basis = 'SIGNING_ENVIRONMENT' and s.population_complete and s.pool_capacity_usd > 0 and s.pool_adjustment_completeness = 'KNOWN'
    and s.pool_treatment_unknown = 0 and s.pool_charges_known = s.pool_subject
    then round(100.0 * coalesce(s.known_pool_charge_sum_usd, 0) / s.pool_capacity_usd, 1) end as true_disi_row_utilization_pct
from shaped s;

comment on view public.v_dodgers_financial_commitment_by_class is
  'Dodgers financial commitment per class: one row per signing environment (period) plus one row per signing year for signings with no environment. known_tracked_bonus_pct_of_pool is NOT utilization and always travels with its basis text (denominator, regime, population completeness, adjustment completeness). source_reported_utilization_pct uses only a spend and pool a source reported. true_disi_row_utilization_pct appears only when the class population is complete, every pool treatment and every pool charge is known, and the adjusted pool is known.';

create or replace view public.v_dodgers_financial_commitment_by_market
with (security_invoker = true)
as
select
  coalesce(f.country_market, 'Unknown') as country_market,
  count(*)::int as signings,
  array_agg(distinct f.pathway order by f.pathway) as pathways,
  min(f.signing_year) as first_signing_year, max(f.signing_year) as last_signing_year,
  count(*) filter (where f.bonus_status = 'KNOWN')::int as bonus_known,
  count(*) filter (where f.bonus_status = 'UNKNOWN')::int as bonus_unknown,
  count(*) filter (where f.bonus_status = 'CONFLICT')::int as bonus_conflicts,
  round(100.0 * count(*) filter (where f.bonus_status <> 'KNOWN') / count(*), 1) as bonus_missing_pct,
  sum(f.signing_bonus_usd) as known_bonus_sum_usd,
  count(*) filter (where f.known_acquisition_cost_usd is not null)::int as signings_with_known_cost,
  sum(f.known_acquisition_cost_usd) as known_cost_sum_usd,
  count(*) filter (where f.acquisition_cost_completeness = 'COMPLETE')::int as acquisition_complete,
  count(*) filter (where f.acquisition_cost_completeness = 'PARTIAL')::int as acquisition_partial,
  count(*) filter (where f.acquisition_cost_completeness = 'UNKNOWN')::int as acquisition_unknown,
  count(*) filter (where f.acquisition_cost_completeness = 'NO_RULE')::int as acquisition_no_rule,
  count(*) filter (where f.bonus_source_status = 'EXTERNALLY_SOURCED')::int as bonus_externally_sourced,
  count(*) filter (where f.bonus_source_status = 'LEGACY_CANONICAL_ONLY')::int as bonus_legacy_only,
  count(*) filter (where f.has_financial_conflict)::int as signings_with_conflicts,
  count(*) filter (where f.international_pool_treatment = 'SUBJECT')::int as pool_subject,
  count(*) filter (where f.international_pool_treatment in ('EXEMPT', 'NOT_SUBJECT', 'NOT_APPLICABLE'))::int as pool_not_applicable_or_exempt,
  count(*) filter (where f.international_pool_treatment = 'UNKNOWN')::int as pool_treatment_unknown
from public.v_signing_acquisition_financials f
where f.is_dodgers
group by coalesce(f.country_market, 'Unknown');

comment on view public.v_dodgers_financial_commitment_by_market is
  'Descriptive Dodgers financial commitment per country market, with its missingness (unknown bonuses, completeness, legacy-only provenance). Sums cover known values only and are not comparable across markets with different missingness. No averages, rankings, best / cheapest labels, ROI or WAR per dollar.';

create or replace view public.v_financial_research_queue
with (security_invoker = true)
as
with f as (
  select f.*,
    exists (select 1 from public.outcome_audits oa where oa.player_id = f.player_id and oa.reached_mlb_verified) as mlb_reached,
    (sg.international_rank is not null) as ranked,
    exists (select 1 from public.signing_population_members m join public.signing_populations sp on sp.id = m.population_id
            join public.v_dodgers_signing_population_coverage c on c.population_key = sp.population_key
            where m.signing_id = f.signing_id and c.population_complete) as complete_class_member
  from public.v_signing_acquisition_financials f
  join public.signings sg on sg.id = f.signing_id
),
bonus_rule as (
  select pathway::text as pathway, applicability from public.acquisition_cost_component_rules where component_type = 'SIGNING_BONUS'
),
signals as (
  select f.*, array_remove(array[case when f.mlb_reached then 'verified MLB reach' end, case when f.ranked then 'international rank' end,
    case when cardinality(f.known_components) > 0 then 'another component known' end, case when f.complete_class_member then 'member of a complete class' end], null) as signal_list
  from f
),
lr as (
  select fr.signing_id, fr.component_type, bool_or(fr.report_origin = 'EXTERNAL_SOURCE') as external
  from public.signing_financial_reports fr where fr.record_status = 'ACTIVE' and fr.currency_code = 'USD'
  group by fr.signing_id, fr.component_type
),
er as (
  select fr.signing_environment_id as env_id, fr.metric_type, coalesce(fr.amount_usd, fr.rate_value) as value, fr.amount_basis, fr.amount_precision, fr.report_origin
  from public.signing_environment_financial_reports fr where fr.record_status = 'ACTIVE'
),
eagg as (
  select er.env_id, er.metric_type, bool_or(er.report_origin = 'EXTERNAL_SOURCE') as external,
    count(distinct er.value) filter (where er.amount_basis is null or er.amount_basis in ('EXACT', 'RULE_DERIVED'))::int as n_points,
    min(er.value) filter (where er.amount_basis is null or er.amount_basis in ('EXACT', 'RULE_DERIVED')) as point_value,
    count(distinct er.value) filter (where er.amount_basis = 'ROUNDED')::int as n_rounded,
    min(er.value) filter (where er.amount_basis = 'ROUNDED') as rounded_value
  from er group by er.env_id, er.metric_type
),
ecomp as (
  select c.env_id, c.metric_type, c.external,
    case when c.n_candidates = 0 then 'APPROXIMATE_ONLY' when c.n_candidates > 1 then 'CONFLICT'
         when exists (select 1 from er where er.env_id = c.env_id and er.metric_type = c.metric_type and er.amount_basis = 'ROUNDED'
                      and abs(er.value - c.candidate) > er.amount_precision / 2) then 'CONFLICT'
         else 'AGREED' end as resolution_status
  from (select a.*, case when a.n_points > 0 then a.n_points else a.n_rounded end as n_candidates,
               case when a.n_points > 0 then a.point_value else a.rounded_value end as candidate from eagg a) c
),
issues as (
  -- a bonus the rules expect is unknown, for a signing that carries an analytical signal
  select s.signing_id, null::uuid as signing_environment_id, 'SIGNING_BONUS'::text as subject, 'SIGNING_BONUS_UNKNOWN'::text as issue,
    case when s.mlb_reached then 1 else 2 end as priority,
    format('%s %s signing (%s) with no known signing bonus; signals: %s', s.signing_year, s.pathway, coalesce(s.country_market, 'market unknown'), array_to_string(s.signal_list, ', ')) as detail
  from signals s join bonus_rule br on br.pathway = s.pathway
  where s.is_dodgers and s.bonus_status = 'UNKNOWN' and br.applicability in ('REQUIRED', 'POSSIBLE') and cardinality(s.signal_list) > 0
  union all
  -- another REQUIRED component has no report at all (conflicts are queued separately)
  select f.signing_id, null, x.component, 'REQUIRED_ACQUISITION_COMPONENT_UNRESOLVED', case when f.mlb_reached then 1 else 2 end,
    format('%s %s signing: required %s is not known', f.signing_year, f.pathway, x.component)
  from f cross join lateral unnest(f.required_components_unresolved) x(component)
  where f.is_dodgers and x.component <> 'SIGNING_BONUS' and not x.component = any(f.conflicting_components)
  union all
  -- active independent reports disagree; the canonical value stays NULL until a reviewed resolution
  select f.signing_id, null, x.component, 'FINANCIAL_REPORT_CONFLICT', 1,
    format('%s: active reports disagree; both are kept and the canonical value stays NULL', x.component)
  from f cross join lateral unnest(f.conflicting_components) x(component)
  union all
  select null, ec.env_id, ec.metric_type, 'FINANCIAL_REPORT_CONFLICT', 1,
    format('%s %s: active reports disagree', se.signing_period_label, ec.metric_type)
  from ecomp ec join public.signing_environments se on se.id = ec.env_id
  where ec.resolution_status = 'CONFLICT'
  union all
  -- a known value whose only provenance is the legacy carry-forward
  select f.signing_id, null, x.component, 'FINANCIAL_SOURCE_MISSING', case when f.is_dodgers then 2 else 3 end,
    format('%s is known in legacy canonical data but has no external source', x.component)
  from f cross join lateral unnest(f.known_components) x(component)
  where not exists (select 1 from lr where lr.signing_id = f.signing_id and lr.component_type = x.component and lr.external)
  union all
  select null, ec.env_id, ec.metric_type, 'FINANCIAL_SOURCE_MISSING', 2,
    format('%s %s is known in legacy canonical data but has no external source', se.signing_period_label, ec.metric_type)
  from ecomp ec join public.signing_environments se on se.id = ec.env_id
  where not ec.external
  union all
  -- pool-era signing with no supported treatment and an analytical signal
  select s.signing_id, null, 'INTERNATIONAL_POOL_TREATMENT', 'POOL_TREATMENT_UNKNOWN', case when s.mlb_reached then 2 else 3 end,
    format('%s %s signing: pool treatment unknown; signals: %s', s.signing_year, s.pathway, array_to_string(s.signal_list, ', '))
  from signals s
  where s.is_dodgers and s.international_pool_treatment = 'UNKNOWN' and s.signing_year >= 2012 and cardinality(s.signal_list) > 0
  union all
  -- pool-era Dodgers signings with no known pool capacity: neither their linked environment nor (when unlinked) a
  -- Dodgers environment for their signing year has one. One row per signing year.
  select null, null, 'POOL_CAPACITY', 'POOL_CAPACITY_UNKNOWN', 2,
    format('%s: %s tracked signing(s) with no known Dodgers pool capacity for the signing year', f.signing_year, count(*))
  from f
  where f.is_dodgers and f.signing_year >= 2012 and f.international_pool_treatment not in ('EXEMPT', 'NOT_SUBJECT', 'NOT_APPLICABLE')
    and not f.environment_pool_capacity_known
    and not (f.signing_environment_id is null and exists (select 1 from public.signing_environments se join public.organizations o on o.id = se.organization_id
                                                          where o.franchise_key = 'DODGERS' and se.signing_year = f.signing_year
                                                            and coalesce(se.pool_after_trades_usd, se.club_bonus_pool_usd) is not null))
  group by f.signing_year
  union all
  -- a signing period whose class population or bonuses are incomplete
  select null, c.signing_environment_id, 'CLASS', 'CLASS_FINANCIAL_COVERAGE_INCOMPLETE', 3,
    format('%s: population %s; %s of %s linked signings have a known bonus', c.period_label, lower(replace(c.population_completeness, '_', ' ')), c.bonus_known, c.signings)
  from public.v_dodgers_financial_commitment_by_class c
  where c.class_basis = 'SIGNING_ENVIRONMENT' and not (c.population_complete and c.signings > 0 and c.bonus_known = c.signings)
)
select i.issue, i.priority, i.subject, i.signing_id, p.slug as player_slug, p.full_name, o.name as organization_name, sg.signing_year,
  i.signing_environment_id, se.signing_period_label as environment_period_label, i.detail
from issues i
left join public.signings sg on sg.id = i.signing_id
left join public.players p on p.id = sg.player_id
left join public.organizations o on o.id = sg.organization_id
left join public.signing_environments se on se.id = i.signing_environment_id;

comment on view public.v_financial_research_queue is
  'Unresolved financial research. SIGNING_BONUS_UNKNOWN and POOL_TREATMENT_UNKNOWN are limited to Dodgers signings with a signal (verified MLB reach, an international rank, another known component, or membership in a complete class). FINANCIAL_SOURCE_MISSING lists known values whose only provenance is the legacy carry-forward. FINANCIAL_REPORT_CONFLICT lists disagreeing ACTIVE reports; both stay ACTIVE. No issue is queued from unverified search snippets.';

-- ===========================================================================
-- 13. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'acquisition_cost_component_rules', 'signing_financial_reports', 'signing_environment_financial_reports',
    'v_signing_acquisition_financials', 'v_dodgers_financial_commitment_by_class', 'v_dodgers_financial_commitment_by_market', 'v_financial_research_queue'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

do $$
declare
  bad text;
  e jsonb;
  n int;
begin
  select string_agg(format('%s:%s:%s', c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type), ', ' order by 1) into bad
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    and a.privilege_type <> 'SELECT';
  if bad is not null then
    raise exception '030: API roles hold privileges beyond SELECT: %', bad;
  end if;

  -- every pathway has exactly one rule per component
  select count(*) into n from (select unnest(enum_range(null::public.acquisition_pathway)) as pw) p
  cross join (values ('SIGNING_BONUS'), ('POSTING_FEE'), ('TRANSFER_FEE'), ('RELEASE_FEE'), ('OTHER_ACQUISITION_FEE')) c(component_type)
  where not exists (select 1 from public.acquisition_cost_component_rules ru where ru.pathway = p.pw and ru.component_type = c.component_type);
  if n <> 0 then raise exception '030 postcondition: % pathway x component rule(s) missing', n; end if;

  -- column / ledger reconciliation: a non-null column is the value every ACTIVE USD report agrees on (points equal it,
  -- ROUNDED intervals contain it, at least one non-approximate report exists); a NULL column has no agreeing value
  select count(*) into n
  from public.signings s
  cross join lateral (values ('SIGNING_BONUS', s.signing_bonus_usd), ('POSTING_FEE', s.posting_fee_usd), ('TRANSFER_FEE', s.transfer_fee_usd)) v(component_type, col)
  where (v.col is not null and (
          not exists (select 1 from public.signing_financial_reports fr where fr.signing_id = s.id and fr.component_type = v.component_type and fr.record_status = 'ACTIVE'
                        and fr.currency_code = 'USD' and fr.amount_basis is distinct from 'APPROXIMATE')
       or exists (select 1 from public.signing_financial_reports fr where fr.signing_id = s.id and fr.component_type = v.component_type and fr.record_status = 'ACTIVE'
                    and fr.currency_code = 'USD' and (fr.amount_basis is null or fr.amount_basis in ('EXACT', 'RULE_DERIVED')) and fr.amount <> v.col)
       or exists (select 1 from public.signing_financial_reports fr where fr.signing_id = s.id and fr.component_type = v.component_type and fr.record_status = 'ACTIVE'
                    and fr.currency_code = 'USD' and fr.amount_basis = 'ROUNDED' and abs(fr.amount - v.col) > fr.amount_precision / 2)
       or (not exists (select 1 from public.signing_financial_reports fr where fr.signing_id = s.id and fr.component_type = v.component_type and fr.record_status = 'ACTIVE'
                         and fr.currency_code = 'USD' and (fr.amount_basis is null or fr.amount_basis in ('EXACT', 'RULE_DERIVED')))
           and exists (select 1 from public.signing_financial_reports fr where fr.signing_id = s.id and fr.component_type = v.component_type and fr.record_status = 'ACTIVE'
                         and fr.currency_code = 'USD' and fr.amount_basis = 'ROUNDED' and fr.amount <> v.col))))
     or (v.col is null and exists (select 1 from public.v_signing_acquisition_financials f where f.signing_id = s.id and not v.component_type = any(f.conflicting_components))
         and exists (select 1 from public.signing_financial_reports fr where fr.signing_id = s.id and fr.component_type = v.component_type and fr.record_status = 'ACTIVE'
                       and fr.currency_code = 'USD' and fr.amount_basis is distinct from 'APPROXIMATE'));
  if n <> 0 then raise exception '030 postcondition: % canonical money value(s) disagree with the ledger', n; end if;

  -- the reviewed seed is present exactly once
  for e in select x from _m030, jsonb_array_elements(j -> 'signing_reports') x loop
    select count(*) into n from public.signing_financial_reports fr join public.signings sg on sg.id = fr.signing_id join public.players p on p.id = sg.player_id
    join public.sources so on so.id = fr.source_id
    where p.slug = e ->> 'player_slug' and sg.signing_year = (e ->> 'signing_year')::int and fr.component_type = e ->> 'component_type'
      and so.url = e ->> 'source_url' and fr.amount = (e ->> 'amount')::numeric;
    if n <> 1 then raise exception '030 postcondition: report % present % times', e ->> 'ref', n; end if;
  end loop;
  for e in select x from _m030, jsonb_array_elements(j -> 'environment_reports') x loop
    select count(*) into n from public.signing_environment_financial_reports fr join public.signing_environments se on se.id = fr.signing_environment_id
    join public.organizations o on o.id = se.organization_id join public.sources so on so.id = fr.source_id
    where o.name = 'Los Angeles Dodgers' and se.signing_year = (e ->> 'signing_year')::int and fr.metric_type = e ->> 'metric_type' and so.url = e ->> 'source_url';
    if n <> 1 then raise exception '030 postcondition: environment report % present % times', e ->> 'ref', n; end if;
  end loop;

  -- Ryu, Sasaki and the new environment
  select count(*) into n from public.signings s join public.players p on p.id = s.player_id
  where p.slug = 'hyun-jin-ryu' and s.signing_bonus_usd = 5000000 and s.posting_fee_usd = 25737737.33 and s.bonus_publicly_reported;
  if n <> 1 then raise exception '030 postcondition: Ryu''s canonical values are not the reviewed ones'; end if;
  select count(*) into n from public.v_signing_acquisition_financials where player_slug = 'roki-sasaki' and posting_fee_usd is null and conflicting_components = array['POSTING_FEE'];
  if n <> 1 then raise exception '030 postcondition: the Sasaki posting-fee conflict is not represented'; end if;
  select count(*) into n from public.signing_environments se join public.organizations o on o.id = se.organization_id
  where o.name = 'Los Angeles Dodgers' and se.signing_year = 2019;
  if n <> 1 then raise exception '030 postcondition: the Dodgers 2019-20 environment is present % times', n; end if;
  select count(*) into n from public.signings s join public.signing_environments se on se.id = s.signing_environment_id where se.signing_year = 2019
    and se.organization_id = (select id from public.organizations where name = 'Los Angeles Dodgers');
  if n <> 3 then raise exception '030 postcondition: % signings linked to the 2019-20 environment, expected 3', n; end if;
end $$;

commit;
