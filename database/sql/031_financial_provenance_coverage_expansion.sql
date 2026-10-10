-- DISI v0.22
-- 031_financial_provenance_coverage_expansion.sql
-- Financial provenance and coverage expansion over the 030 ledger. Run after 030.
--
-- Built from database/research/031/ (seed-evidence.json, audit.mjs, build.mjs).
--
-- What this is. A research-data migration plus one small reviewed-decision object. It adds no
-- analytics. It fills facts that directly read sources state and improves their provenance.
--
-- What it does:
--   * Adds signing_financial_resolutions: a reviewed decision that says WHICH of several competing
--     ACTIVE reports DISI accepts as canonical for one signing and component. A source report records
--     what a source said; a resolution records what DISI currently accepts. Reports are never
--     rewritten, and the disagreement stays visible. A decision is allowed only where at least two
--     ACTIVE reports disagree, is sealed once recorded, is never deleted, and a later decision
--     supersedes (and retires) its predecessor. A correction of an unsourced legacy value is NOT a
--     resolution: it is an ordinary supersession of the legacy carry-forward row.
--     No decision is recorded in 031 (Sasaki stays unresolved; Rosario and Torres are deferred).
--   * Adds UNIQUE (id, signing_id, component_type) to signing_financial_reports (additive) so a
--     decision's selected report is tied to the same signing and component by a composite foreign key.
--   * Replaces v_signing_acquisition_financials (same columns plus resolved_components at the end) so a
--     component with an ACTIVE decision is RESOLVED to the selected report instead of CONFLICT.
--   * Pool capacity: environments for the Dodgers 2012-13, 2013-14, 2014-15 and 2020-21 periods, a pool
--     for the existing 2017-18 environment, and externally sourced BASE_POOL reports for all of them.
--     The existing 2021-22 pool ($4,644,000) is the sourced post-penalty allocation; the $500,000
--     Trevor Bauer penalty is recorded as a memo and is never subtracted again.
--   * Provenance: externally sourced reports for known bonuses that carried only a legacy
--     carry-forward (the legacy row stays ACTIVE as corroboration), and externally sourced bonuses for
--     four signings whose bonus was unknown.
--   * One correction: Carlos Rincon's unsourced legacy $350,000 is superseded by Baseball America's
--     directly read $325,000.
--   * Links Dodgers signings to the four added environments (and the 2017-18 environment) by supported
--     period membership: the signing date lies inside the period window. Pathway does not decide
--     membership, and international_pool_treatment is untouched.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA (database/research/031/seed-evidence.json)
-- ===========================================================================

create temporary table _m031 on commit drop as
select $m031${"environment_column_updates":[{"column":"club_bonus_pool_usd","from":null,"signing_year":2017,"to":"4750000.00"}],"environment_reports":[{"amount_basis":"ROUNDED","amount_precision":"100000.00","amount_usd":"2900000.00","confidence":"HIGH","evidence_basis":"NEWS_REPORT","metric_type":"BASE_POOL","note":"MLB Trade Rumors calls $2.9MM the Dodgers' 2012-13 spending pool.","ref":"env2012-mlbtr","signing_year":2012,"source_url":"https://www.mlbtraderumors.com/2012/08/dodgers-sign-julio-urias.html"},{"amount_basis":"EXACT","amount_precision":null,"amount_usd":"2112900.00","confidence":"HIGH","evidence_basis":"NEWS_REPORT","metric_type":"BASE_POOL","note":"MLB Trade Rumors, July 2, 2013, says the Dodgers had a pool of $2,112,900 when the Marmol slot trade was made.","ref":"env2013-mlbtr","signing_year":2013,"source_url":"https://www.mlbtraderumors.com/2013/07/dodgers-cubs-swap-guerrier-marmol.html"},{"amount_basis":"EXACT","amount_precision":null,"amount_usd":"1963800.00","confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","metric_type":"BASE_POOL","note":"Dodgers Digest, July 3, 2014, says the Dodgers have $1,963,800 to spend on international bonuses.","ref":"env2014-dd","signing_year":2014,"source_url":"https://dodgersdigest.com/2014/07/03/dodgers-felix-osorio-johan-calderon-romer-cuadrado-july-2/"},{"amount_basis":"ROUNDED","amount_precision":"10000.00","amount_usd":"4750000.00","confidence":"MEDIUM","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","metric_type":"BASE_POOL","note":"Baseball America's December 2016 listing places the Dodgers in the $4.75 million tier; a tier label, not an itemised allotment. In-period trades were not checked.","ref":"env2017-ba","signing_year":2017,"source_url":"https://www.baseballamerica.com/stories/2017-18-international-bonus-pools/"},{"amount_basis":"EXACT","amount_precision":null,"amount_usd":"5348100.00","confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","metric_type":"BASE_POOL","note":"Baseball America lists the Dodgers in the $5,348,100 pool group for 2020-21; trading was prohibited.","ref":"env2021-ba","signing_year":2021,"source_url":"https://www.baseballamerica.com/stories/2020-21-mlb-international-bonus-pools/"},{"amount_basis":"EXACT","amount_precision":null,"amount_usd":"5348100.00","confidence":"HIGH","evidence_basis":"NEWS_REPORT","metric_type":"BASE_POOL","note":"MLB Trade Rumors, January 15, 2021, lists the Dodgers among twelve teams that can spend $5,348,100.","ref":"env2021-mlbtr","signing_year":2021,"source_url":"https://www.mlbtraderumors.com/2021/01/2020-2021-international-signing-period-opens-today.html"},{"amount_basis":"EXACT","amount_precision":null,"amount_usd":"4644000.00","confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","metric_type":"BASE_POOL","note":"Baseball America lists the Dodgers' 2021-22 pool as $4,644,000. This is the effective allocation after the Bauer penalty, not a pre-penalty base.","ref":"env2022-ba","signing_year":2022,"source_url":"https://www.baseballamerica.com/stories/mlb-international-bonus-pools-for-2021-22-signing-period/"},{"amount_basis":"EXACT","amount_precision":null,"amount_usd":"4644000.00","confidence":"HIGH","evidence_basis":"NEWS_REPORT","metric_type":"BASE_POOL","note":"MLB Trade Rumors lists $4,644,000 as the Dodgers' (and Blue Jays') lowest allotment for 2021-22; effective post-penalty allocation.","ref":"env2022-mlbtr","signing_year":2022,"source_url":"https://www.mlbtraderumors.com/2022/01/bonus-pools-for-2021-22-international-signing-market.html"},{"amount_basis":"EXACT","amount_precision":null,"amount_usd":"500000.00","confidence":"HIGH","evidence_basis":"NEWS_REPORT","metric_type":"PENALTY_REDUCTION","note":"MLB Trade Rumors says the Dodgers lost $500K of their pool for signing Trevor Bauer. Memo only: the stored pool already reflects it, so it must not be subtracted again.","ref":"env2022-penalty","signing_year":2022,"source_url":"https://www.mlbtraderumors.com/2022/01/bonus-pools-for-2021-22-international-signing-market.html"}],"environments":[{"club_bonus_pool_usd":"2900000.00","notes":"Added by Migration 031. Pool from MLB Trade Rumors, rounded ($2.9MM); no adjustment stated.","regime":"STANDARD_POOL","rules_summary":"First international bonus-pool period: July 2, 2012 through June 15, 2013.","signing_period_label":"2012-13","signing_year":2012,"tradeable_pool_space":null},{"club_bonus_pool_usd":"2112900.00","notes":"Added by Migration 031. Pool is the amount stated before the period's trades; no post-trade figure is printed in a read source.","regime":"STANDARD_POOL","rules_summary":"Second pool period; teams could trade slot values.","signing_period_label":"2013-14","signing_year":2013,"tradeable_pool_space":true},{"club_bonus_pool_usd":"1963800.00","notes":"Added by Migration 031. Pool from a single fan-site report (Dodgers Digest); no trade stated.","regime":"STANDARD_POOL","rules_summary":"Third pool period; teams could acquire slot money in trades.","signing_period_label":"2014-15","signing_year":2014,"tradeable_pool_space":true},{"club_bonus_pool_usd":"5348100.00","notes":"Added by Migration 031. Two sources agree on the pool; trading was barred, so no adjustment applies.","regime":"MODERN_HARD_POOL","rules_summary":"Delayed 2020-21 period, January 15 through December 15, 2021; pool trading was prohibited.","signing_period_label":"2020-21","signing_year":2021,"tradeable_pool_space":false}],"existing_sources":["https://dodgersdigest.com/2025/01/28/dodgers-sign-29-players-in-ifa-class-trade-two-prospects-for-bonus-pool-money/","https://www.baseballamerica.com/stories/2012-13-international-reviews-los-angeles-dodgers/","https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"],"link_windows":[{"from":"2012-07-02","signing_year":2012,"to":"2013-06-15"},{"from":"2013-07-02","signing_year":2013,"to":"2014-06-15"},{"from":"2014-07-02","signing_year":2014,"to":"2015-06-15"},{"from":"2017-07-02","signing_year":2017,"to":"2018-06-15"},{"from":"2021-01-15","signing_year":2021,"to":"2021-12-15"}],"new_sources":[{"accessed_at":"2026-10-09T22:12:00Z","author":"Ben Badler","notes":"Review of the Dodgers' 2018-19 international signing class.","publication_date":"2019-03-12","source_name":"Baseball America","source_tier":"OTHER","source_type":"ARTICLE","title":"2018-19 International Reviews: Los Angeles Dodgers","url":"https://www.baseballamerica.com/stories/2018-19-international-reviews-los-angeles-dodgers/"},{"accessed_at":"2026-10-09T22:12:00Z","author":"Ben Badler","notes":"Review of the Dodgers' 2023 international signing class.","publication_date":"2023-05-11","source_name":"Baseball America","source_tier":"OTHER","source_type":"ARTICLE","title":"2023 International Reviews: Los Angeles Dodgers","url":"https://www.baseballamerica.com/stories/2023-international-reviews-los-angeles-dodgers/"},{"accessed_at":"2026-10-09T22:12:00Z","author":"Dustin Nosler","notes":"Fan-site report of the Dodgers' first-day 2018-19 signings, with a retrospective list of earlier large bonuses.","publication_date":"2018-07-02","source_name":"Dodgers Digest","source_tier":"OTHER","source_type":"ARTICLE","title":"Dodgers sign Diego Cartaya, Jerming Rosario on first day of 2018-19 international period","url":"https://dodgersdigest.com/2018/07/02/dodgers-sign-diego-cartaya-jerming-rosario-on-first-day-of-2018-19-period/"},{"accessed_at":"2026-10-09T22:12:00Z","author":"Josh Thomas","notes":"Fan-site summary of the Dodgers' 2026 international class.","publication_date":"2026-01-15","source_name":"Dodgers Digest","source_tier":"OTHER","source_type":"ARTICLE","title":"Rubel Arias & Ezequiel Melburne highlight Dodgers' 2026 IFA class of 22 players","url":"https://dodgersdigest.com/2026/01/15/rubel-arias-ezequiel-melburne-highlight-dodgers-2026-ifa-signings/"},{"accessed_at":"2026-10-09T22:30:00Z","author":"Ben Nicholson-Smith","notes":"Report of Julio Urias' signing; states the Dodgers' 2012-13 spending pool.","publication_date":"2012-08-23","source_name":"MLB Trade Rumors","source_tier":"OTHER","source_type":"ARTICLE","title":"Dodgers Sign Julio Urias","url":"https://www.mlbtraderumors.com/2012/08/dodgers-sign-julio-urias.html"},{"accessed_at":"2026-10-09T22:30:00Z","author":"Tim Dierkes","notes":"Trade report that states the Dodgers' 2013-14 pool and the pool value of a traded slot.","publication_date":"2013-07-02","source_name":"MLB Trade Rumors","source_tier":"OTHER","source_type":"ARTICLE","title":"Dodgers, Cubs Swap Guerrier, Marmol","url":"https://www.mlbtraderumors.com/2013/07/dodgers-cubs-swap-guerrier-marmol.html"},{"accessed_at":"2026-10-09T22:30:00Z","author":"Dustin Nosler","notes":"Fan-site report of the Dodgers' first-day 2014-15 signings and their pool.","publication_date":"2014-07-03","source_name":"Dodgers Digest","source_tier":"OTHER","source_type":"ARTICLE","title":"Dodgers sign 5 players on first day of July 2 signing period","url":"https://dodgersdigest.com/2014/07/03/dodgers-felix-osorio-johan-calderon-romer-cuadrado-july-2/"},{"accessed_at":"2026-10-09T22:30:00Z","author":"Ben Badler","notes":"League-wide listing of 2017-18 pool tiers by team, with penalty teams marked.","publication_date":"2016-12-06","source_name":"Baseball America","source_tier":"OTHER","source_type":"ARTICLE","title":"2017-18 International Bonus Pools","url":"https://www.baseballamerica.com/stories/2017-18-international-bonus-pools/"},{"accessed_at":"2026-10-09T22:30:00Z","author":"Ben Badler","notes":"League-wide listing of 2020-21 pools by team; pool trading prohibited that period.","publication_date":"2020-06-15","source_name":"Baseball America","source_tier":"OTHER","source_type":"ARTICLE","title":"2020-21 MLB International Bonus Pools","url":"https://www.baseballamerica.com/stories/2020-21-mlb-international-bonus-pools/"},{"accessed_at":"2026-10-09T22:30:00Z","author":"TC Zencka","notes":"Period-opening report listing team pools.","publication_date":"2021-01-15","source_name":"MLB Trade Rumors","source_tier":"OTHER","source_type":"ARTICLE","title":"2020-2021 International Signing Period Opens Today","url":"https://www.mlbtraderumors.com/2021/01/2020-2021-international-signing-period-opens-today.html"},{"accessed_at":"2026-10-09T22:30:00Z","author":"Ben Badler","notes":"League-wide listing of 2021-22 pools by team.","publication_date":"2022-01-11","source_name":"Baseball America","source_tier":"OTHER","source_type":"ARTICLE","title":"MLB International Bonus Pools For 2021-22 Signing Period","url":"https://www.baseballamerica.com/stories/mlb-international-bonus-pools-for-2021-22-signing-period/"},{"accessed_at":"2026-10-09T22:30:00Z","author":"Mark Polishuk","notes":"Lists 2021-22 pools and the pool penalties the Dodgers and Blue Jays carried.","publication_date":"2022-01-11","source_name":"MLB Trade Rumors","source_tier":"OTHER","source_type":"ARTICLE","title":"Bonus Pools For 2021-22 International Signing Market","url":"https://www.mlbtraderumors.com/2022/01/bonus-pools-for-2021-22-international-signing-market.html"}],"organization_name":"Los Angeles Dodgers","signing_reports":[{"amount":"2600000.00","amount_basis":"ROUNDED","amount_precision":"100000.00","confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","kind":"UPGRADE","legacy_amount":null,"note":"Baseball America's 2015-class review says Heredia signed for $2.6 million on July 2.","player_slug":"starling-heredia","ref":"heredia-ba2016","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"amount":"2000000.00","amount_basis":"ROUNDED","amount_precision":"1000000.00","confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","kind":"UPGRADE","legacy_amount":null,"note":"Baseball America's 2015-class review says Brito signed for $2 million on July 2.","player_slug":"ronny-brito","ref":"brito-ba2016","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"amount":"950000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","kind":"UPGRADE","legacy_amount":null,"note":"Baseball America's 2015-class review says the Dodgers signed Cruz for $950,000 on July 2.","player_slug":"oneil-cruz","ref":"cruz-ba2016","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"amount":"500000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","kind":"UPGRADE","legacy_amount":null,"note":"Baseball America's 2015-class review says Christopher Arias signed for $500,000 on July 2.","player_slug":"christopher-arias","ref":"arias-ba2016","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"amount":"300000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","kind":"UPGRADE","legacy_amount":null,"note":"Baseball America's 2015-class review says Damaso Marte Jr. signed for $300,000.","player_slug":"damaso-marte-jr","ref":"marte-ba2016","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"amount":"500000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","kind":"UPGRADE","legacy_amount":null,"note":"Baseball America's 2018-19 review says the Dodgers signed Alex De Jesus in July for $500,000.","player_slug":"alex-de-jesus","ref":"dejesus-ba1819","signing_year":2018,"source_url":"https://www.baseballamerica.com/stories/2018-19-international-reviews-los-angeles-dodgers/"},{"amount":"2500000.00","amount_basis":"ROUNDED","amount_precision":"100000.00","confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"UPGRADE","legacy_amount":null,"note":"Dodgers Digest's first-day report lists Cartaya at $2.5 million.","player_slug":"diego-cartaya","ref":"cartaya-dd2018","signing_year":2018,"source_url":"https://dodgersdigest.com/2018/07/02/dodgers-sign-diego-cartaya-jerming-rosario-on-first-day-of-2018-19-period/"},{"amount":"2077500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","kind":"UPGRADE","legacy_amount":null,"note":"Baseball America's 2023 review says the Dodgers signed Vargas for $2,077,500.","player_slug":"joendry-vargas","ref":"vargas-ba2023","signing_year":2023,"source_url":"https://www.baseballamerica.com/stories/2023-international-reviews-los-angeles-dodgers/"},{"amount":"497500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","kind":"UPGRADE","legacy_amount":null,"note":"Baseball America's 2023 review says Tillero signed for $497,500.","player_slug":"jesus-tillero","ref":"tillero-ba2023","signing_year":2023,"source_url":"https://www.baseballamerica.com/stories/2023-international-reviews-los-angeles-dodgers/"},{"amount":"397500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","kind":"UPGRADE","legacy_amount":null,"note":"Baseball America's 2023 review says Mielcarek signed for $397,500.","player_slug":"daniel-mielcarek","ref":"mielcarek-ba2023","signing_year":2023,"source_url":"https://www.baseballamerica.com/stories/2023-international-reviews-los-angeles-dodgers/"},{"amount":"997500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"UPGRADE","legacy_amount":null,"note":"Dodgers Digest's 2026 class summary gives Rubel Arias a $997,500 signing bonus.","player_slug":"rubel-arias","ref":"rubelarias-dd2026","signing_year":2026,"source_url":"https://dodgersdigest.com/2026/01/15/rubel-arias-ezequiel-melburne-highlight-dodgers-2026-ifa-signings/"},{"amount":"747500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"UPGRADE","legacy_amount":null,"note":"Dodgers Digest's 2026 class summary says Melburne signed for $747,500.","player_slug":"ezequiel-melburne","ref":"melburne-dd2026","signing_year":2026,"source_url":"https://dodgersdigest.com/2026/01/15/rubel-arias-ezequiel-melburne-highlight-dodgers-2026-ifa-signings/"},{"amount":"2000000.00","amount_basis":"ROUNDED","amount_precision":"1000000.00","confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"UPGRADE","legacy_amount":null,"note":"Dodgers Digest's 2018 retrospective lists Yordan Alvarez at $2 million, before his 2016 trade to the Astros.","player_slug":"yordan-alvarez","ref":"yordan-dd2018","signing_year":2016,"source_url":"https://dodgersdigest.com/2018/07/02/dodgers-sign-diego-cartaya-jerming-rosario-on-first-day-of-2018-19-period/"},{"amount":"190000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","kind":"NEW","legacy_amount":null,"note":"Baseball America's 2012-13 review says William Soto, the top Venezuelan signing, got $190,000 on July 2.","player_slug":"william-soto","ref":"soto-ba2013","signing_year":2012,"source_url":"https://www.baseballamerica.com/stories/2012-13-international-reviews-los-angeles-dodgers/"},{"amount":"177500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","kind":"NEW","legacy_amount":null,"note":"Baseball America's 2023 review says Elias Medina, a Dominican shortstop, signed for $177,500.","player_slug":"elias-medina","ref":"medina-ba2023","signing_year":2023,"source_url":"https://www.baseballamerica.com/stories/2023-international-reviews-los-angeles-dodgers/"},{"amount":"17500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","kind":"NEW","legacy_amount":null,"note":"Baseball America's 2023 review says Samuel Sanchez, a Venezuelan righthander, signed for $17,500.","player_slug":"samuel-sanchez","ref":"sanchez-ba2023","signing_year":2023,"source_url":"https://www.baseballamerica.com/stories/2023-international-reviews-los-angeles-dodgers/"},{"amount":"140000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"NEW","legacy_amount":null,"note":"Dodgers Digest's 2025 class summary, embedding the club's announcement, gives Colombian infielder Luis Luna a $140,000 bonus.","player_slug":"luis-luna","ref":"luna-dd2025","signing_year":2025,"source_url":"https://dodgersdigest.com/2025/01/28/dodgers-sign-29-players-in-ifa-class-trade-two-prospects-for-bonus-pool-money/"},{"amount":"325000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"HIGH","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","kind":"CORRECTION","legacy_amount":"350000.00","note":"Baseball America's 2015-class review says Carlos Rincon signed for $325,000 on July 2. It replaces the unsourced legacy $350,000 (a correction, not a competing report).","player_slug":"carlos-rincon","ref":"rincon-ba2016","signing_year":2015,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"}]}$m031$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 031 was written for
-- ===========================================================================

do $$
declare
  e jsonb;
  org uuid;
  n int;
  r record;
begin
  if to_regclass('public.signing_financial_reports') is null or to_regclass('public.signing_environment_financial_reports') is null
     or to_regclass('public.v_signing_acquisition_financials') is null then
    raise exception '031: Migration 030 has not been applied';
  end if;
  select id into org from public.organizations where name = (select j ->> 'organization_name' from _m031);
  if org is null then
    raise exception '031: the Dodgers organization is missing';
  end if;

  -- every seeded signing exists once, and its canonical bonus is the pre-031 value (or already the 031 value on a rerun)
  for e in select x from _m031, jsonb_array_elements(j -> 'signing_reports') x loop
    select count(*) into n from public.signings sg join public.players p on p.id = sg.player_id
    where p.slug = e ->> 'player_slug' and sg.organization_id = org and sg.signing_year = (e ->> 'signing_year')::int;
    if n <> 1 then
      raise exception '031: expected exactly one Dodgers signing for % %, found %', e ->> 'player_slug', e ->> 'signing_year', n;
    end if;
    select sg.signing_bonus_usd as b into r from public.signings sg join public.players p on p.id = sg.player_id
    where p.slug = e ->> 'player_slug' and sg.organization_id = org and sg.signing_year = (e ->> 'signing_year')::int;
    if e ->> 'kind' = 'NEW' and r.b is not null and r.b <> (e ->> 'amount')::numeric then
      raise exception '031: % already has a different bonus (%)', e ->> 'player_slug', r.b;
    elsif e ->> 'kind' = 'UPGRADE' and r.b is distinct from (e ->> 'amount')::numeric then
      raise exception '031: % has an unexpected bonus (%)', e ->> 'player_slug', r.b;
    elsif e ->> 'kind' = 'CORRECTION' and r.b not in ((e ->> 'legacy_amount')::numeric, (e ->> 'amount')::numeric) then
      raise exception '031: % has an unexpected bonus (%)', e ->> 'player_slug', r.b;
    end if;
  end loop;

  -- the environments the seed extends exist in the expected state
  for e in select x from _m031, jsonb_array_elements(j -> 'environment_column_updates') x loop
    select se.club_bonus_pool_usd as pool into r from public.signing_environments se
    where se.organization_id = org and se.signing_year = (e ->> 'signing_year')::int;
    if not found then
      raise exception '031: the Dodgers % environment is missing', e ->> 'signing_year';
    end if;
    if r.pool is not null and r.pool <> (e ->> 'to')::numeric then
      raise exception '031: the Dodgers % environment already has a different pool (%)', e ->> 'signing_year', r.pool;
    end if;
  end loop;
  select se.club_bonus_pool_usd as pool into r from public.signing_environments se where se.organization_id = org and se.signing_year = 2022;
  if r.pool is distinct from 4644000 then
    raise exception '031: the Dodgers 2021-22 environment does not carry the reviewed $4,644,000 allocation';
  end if;

  -- sources the seed cites as already registered
  for e in select x from _m031, jsonb_array_elements(j -> 'existing_sources') x loop
    if not exists (select 1 from public.sources where url = e #>> '{}') then
      raise exception '031: expected source % is not registered', e #>> '{}';
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 2. SCHEMA: reviewed financial-report resolutions
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.signing_financial_reports'::regclass and conname = 'signing_financial_reports_id_signing_component_key') then
    alter table public.signing_financial_reports add constraint signing_financial_reports_id_signing_component_key unique (id, signing_id, component_type);
  end if;
end $$;

create table if not exists public.signing_financial_resolutions (
  id uuid primary key default gen_random_uuid(),
  signing_id uuid not null,
  component_type text not null check (component_type in ('SIGNING_BONUS', 'POSTING_FEE', 'TRANSFER_FEE', 'RELEASE_FEE', 'POOL_CHARGE', 'OTHER_ACQUISITION_FEE')),
  selected_report_id uuid not null,
  basis text not null check (basis in ('AUTHORITATIVE_RULE', 'SOURCE_PRECEDENCE', 'OTHER_REVIEWED')),
  source_id uuid references public.sources(id) on delete restrict,
  rationale text not null check (nullif(btrim(rationale), '') is not null and char_length(rationale) <= 600),
  reviewed_by text not null check (nullif(btrim(reviewed_by), '') is not null),
  reviewed_at timestamptz not null,
  record_status text not null default 'ACTIVE' check (record_status in ('ACTIVE', 'RETRACTED')),
  supersedes_resolution_id uuid references public.signing_financial_resolutions(id) on delete restrict,
  retracted_at timestamptz,
  retraction_reason text,
  created_at timestamptz not null default now(),
  constraint signing_financial_resolutions_report_fkey foreign key (selected_report_id, signing_id, component_type)
    references public.signing_financial_reports (id, signing_id, component_type) on delete restrict,
  constraint signing_financial_resolutions_signing_fkey foreign key (signing_id) references public.signings(id) on delete restrict,
  -- an authoritative-rule decision cites the rule's source
  constraint signing_financial_resolutions_source_check check (basis <> 'AUTHORITATIVE_RULE' or source_id is not null),
  constraint signing_financial_resolutions_supersedes_check check (supersedes_resolution_id is null or supersedes_resolution_id <> id),
  constraint signing_financial_resolutions_retraction_check check ((record_status = 'RETRACTED') = (retracted_at is not null)
    and (record_status = 'ACTIVE' or nullif(btrim(retraction_reason), '') is not null)
    and (record_status = 'RETRACTED' or retraction_reason is null))
);
create unique index if not exists signing_financial_resolutions_active_key on public.signing_financial_resolutions (signing_id, component_type)
  where record_status = 'ACTIVE';
create unique index if not exists signing_financial_resolutions_supersedes_key on public.signing_financial_resolutions (supersedes_resolution_id)
  where supersedes_resolution_id is not null;
create index if not exists signing_financial_resolutions_report_idx on public.signing_financial_resolutions (selected_report_id);

comment on table public.signing_financial_resolutions is
  'Reviewed decisions: which of several competing ACTIVE source-backed reports DISI accepts as canonical for one signing and component. A report records what a source said; a resolution records what DISI accepts. Reports are never rewritten and the disagreement stays visible. Allowed only while at least two ACTIVE reports disagree. A correction of an unsourced legacy value is a supersession of the legacy row, not a resolution. Absence of a row means unresolved.';
comment on column public.signing_financial_resolutions.basis is
  'AUTHORITATIVE_RULE (source_id cites the rule), SOURCE_PRECEDENCE (one source is preferred over another, stated in the rationale) or OTHER_REVIEWED.';

create or replace function public.disi_signing_financial_resolution_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  sel public.signing_financial_reports%rowtype;
  pred public.signing_financial_resolutions%rowtype;
  distinct_amounts int;
begin
  if tg_op = 'DELETE' then
    raise exception 'financial resolutions are never deleted; retract them instead' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if old.record_status = 'RETRACTED' then
      raise exception 'a RETRACTED financial resolution is sealed (%)', old.id using errcode = '55000';
    end if;
    if new.record_status <> 'RETRACTED'
       or (to_jsonb(new) - 'record_status' - 'retracted_at' - 'retraction_reason') is distinct from (to_jsonb(old) - 'record_status' - 'retracted_at' - 'retraction_reason') then
      raise exception 'an ACTIVE financial resolution is sealed; the only change allowed is retraction (%)', old.id using errcode = '55000';
    end if;
    return new;
  end if;
  if new.record_status <> 'ACTIVE' then
    raise exception 'a new financial resolution starts ACTIVE' using errcode = '55000';
  end if;
  select * into sel from public.signing_financial_reports where id = new.selected_report_id;
  if not found or sel.signing_id <> new.signing_id or sel.component_type <> new.component_type
     or sel.record_status <> 'ACTIVE' or sel.currency_code <> 'USD' or sel.amount_basis = 'APPROXIMATE' then
    raise exception 'a resolution must select an ACTIVE, non-approximate USD report of the same signing and component' using errcode = '55000';
  end if;
  select count(distinct amount) into distinct_amounts from public.signing_financial_reports
  where signing_id = new.signing_id and component_type = new.component_type and record_status = 'ACTIVE'
    and currency_code = 'USD' and amount_basis is distinct from 'APPROXIMATE';
  if distinct_amounts < 2 then
    raise exception 'a resolution needs at least two ACTIVE reports with different amounts; a correction supersedes the old report instead' using errcode = '55000';
  end if;
  if new.supersedes_resolution_id is not null then
    select * into pred from public.signing_financial_resolutions where id = new.supersedes_resolution_id;
    if not found or pred.id = new.id or pred.signing_id <> new.signing_id or pred.component_type <> new.component_type then
      raise exception 'a new decision must supersede an existing decision of the same signing and component (%)', new.supersedes_resolution_id using errcode = '55000';
    end if;
    if pred.record_status = 'ACTIVE' then
      update public.signing_financial_resolutions
        set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'Superseded by a later decision.'
      where id = pred.id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_signing_financial_resolution_guard() from public, anon, authenticated;

drop trigger if exists signing_financial_resolutions_guard on public.signing_financial_resolutions;
create trigger signing_financial_resolutions_guard
before insert or update or delete on public.signing_financial_resolutions
for each row execute function public.disi_signing_financial_resolution_guard();

alter table public.signing_financial_resolutions enable row level security;
revoke all on table public.signing_financial_resolutions from anon, authenticated;
grant select on table public.signing_financial_resolutions to anon, authenticated;
drop policy if exists public_read_signing_financial_resolutions on public.signing_financial_resolutions;
create policy public_read_signing_financial_resolutions on public.signing_financial_resolutions for select to anon, authenticated using (true);

-- ===========================================================================
-- 3. SOURCES
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, author, publication_date, accessed_at, notes, source_tier)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'author', (x ->> 'publication_date')::date,
       (x ->> 'accessed_at')::timestamptz, x ->> 'notes', x ->> 'source_tier'
from _m031, jsonb_array_elements(j -> 'new_sources') x
on conflict (url) do nothing;

-- ===========================================================================
-- 4. ENVIRONMENTS AND POOL CAPACITY
-- ===========================================================================

do $$
declare
  e jsonb;
  org uuid := (select id from public.organizations where name = (select j ->> 'organization_name' from _m031));
  r record;
begin
  for e in select x from _m031, jsonb_array_elements(j -> 'environments') x loop
    select * into r from public.signing_environments where organization_id = org and signing_year = (e ->> 'signing_year')::int;
    if not found then
      insert into public.signing_environments (organization_id, signing_year, regime, club_bonus_pool_usd, pool_after_trades_usd, signing_period_label,
        max_individual_bonus_usd, overage_tax_rate, tradeable_pool_space, penalty_status, rules_summary, cba_regime, notes)
      values (org, (e ->> 'signing_year')::int, (e ->> 'regime')::public.signing_regime, (e ->> 'club_bonus_pool_usd')::numeric, null, e ->> 'signing_period_label',
        null, null, (e ->> 'tradeable_pool_space')::boolean, null, e ->> 'rules_summary', null, e ->> 'notes');
    elsif r.regime::text <> e ->> 'regime' or r.club_bonus_pool_usd is distinct from (e ->> 'club_bonus_pool_usd')::numeric
          or r.signing_period_label is distinct from e ->> 'signing_period_label' then
      raise exception '031: a Dodgers % environment exists with unexpected content', e ->> 'signing_year';
    end if;
  end loop;
  for e in select x from _m031, jsonb_array_elements(j -> 'environment_column_updates') x loop
    update public.signing_environments set club_bonus_pool_usd = (e ->> 'to')::numeric
    where organization_id = org and signing_year = (e ->> 'signing_year')::int and club_bonus_pool_usd is null;
  end loop;
end $$;

do $$
declare
  e jsonb;
  org uuid := (select id from public.organizations where name = (select j ->> 'organization_name' from _m031));
  eid uuid;
  src uuid;
begin
  for e in select x from _m031, jsonb_array_elements(j -> 'environment_reports') x loop
    select id into eid from public.signing_environments where organization_id = org and signing_year = (e ->> 'signing_year')::int;
    select id into src from public.sources where url = e ->> 'source_url';
    if eid is null or src is null then
      raise exception '031: references for environment report % are unresolved', e ->> 'ref';
    end if;
    if not exists (select 1 from public.signing_environment_financial_reports where signing_environment_id = eid and metric_type = e ->> 'metric_type'
                   and source_id = src and amount_usd is not distinct from (e ->> 'amount_usd')::numeric) then
      insert into public.signing_environment_financial_reports (signing_environment_id, metric_type, amount_usd, amount_basis, amount_precision,
        report_origin, source_id, evidence_basis, confidence, retrieved_at, note)
      select eid, e ->> 'metric_type', (e ->> 'amount_usd')::numeric, e ->> 'amount_basis', (e ->> 'amount_precision')::numeric,
        'EXTERNAL_SOURCE', src, e ->> 'evidence_basis', (e ->> 'confidence')::public.confidence_level, so.accessed_at, e ->> 'note'
      from public.sources so where so.id = src;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 5. SIGNING REPORTS: provenance upgrades, new bonuses, one correction
-- ===========================================================================
-- UPGRADE: an externally sourced report for a bonus that carried only a legacy carry-forward. The legacy
--   row stays ACTIVE as corroboration; it is not retracted because the amount did not change.
-- NEW: a bonus that was unknown. The canonical column and flag are set and an external report is added.
-- CORRECTION: the legacy amount was wrong; the external report supersedes (and retires) the legacy row
--   and the canonical column moves to the sourced amount.

do $$
declare
  e jsonb;
  org uuid := (select id from public.organizations where name = (select j ->> 'organization_name' from _m031));
  sid uuid;
  src uuid;
  legacy uuid;
begin
  for e in select x from _m031, jsonb_array_elements(j -> 'signing_reports') x loop
    select sg.id into sid from public.signings sg join public.players p on p.id = sg.player_id
    where p.slug = e ->> 'player_slug' and sg.organization_id = org and sg.signing_year = (e ->> 'signing_year')::int;
    select id into src from public.sources where url = e ->> 'source_url';
    if sid is null or src is null then
      raise exception '031: references for report % are unresolved', e ->> 'ref';
    end if;
    if exists (select 1 from public.signing_financial_reports where signing_id = sid and component_type = 'SIGNING_BONUS'
               and source_id = src and amount = (e ->> 'amount')::numeric) then
      continue;
    end if;
    legacy := null;
    if e ->> 'kind' = 'CORRECTION' then
      select id into legacy from public.signing_financial_reports
      where signing_id = sid and component_type = 'SIGNING_BONUS' and report_origin = 'LEGACY_CARRYFORWARD' and record_status = 'ACTIVE'
        and amount = (e ->> 'legacy_amount')::numeric;
      if legacy is null then
        raise exception '031: the legacy carry-forward to correct is missing for %', e ->> 'player_slug';
      end if;
    end if;
    insert into public.signing_financial_reports (signing_id, component_type, amount, currency_code, amount_basis, amount_precision,
      report_origin, source_id, evidence_basis, confidence, retrieved_at, note, supersedes_report_id)
    select sid, 'SIGNING_BONUS', (e ->> 'amount')::numeric, 'USD', e ->> 'amount_basis', (e ->> 'amount_precision')::numeric,
      'EXTERNAL_SOURCE', src, e ->> 'evidence_basis', (e ->> 'confidence')::public.confidence_level, so.accessed_at, e ->> 'note', legacy
    from public.sources so where so.id = src;
    if e ->> 'kind' in ('NEW', 'CORRECTION') then
      update public.signings set signing_bonus_usd = (e ->> 'amount')::numeric, bonus_publicly_reported = true where id = sid;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 6. ENVIRONMENT LINKS (supported period membership; pathway is irrelevant)
-- ===========================================================================

do $$
declare
  w jsonb;
  org uuid := (select id from public.organizations where name = (select j ->> 'organization_name' from _m031));
  eid uuid;
begin
  for w in select x from _m031, jsonb_array_elements(j -> 'link_windows') x loop
    select id into eid from public.signing_environments where organization_id = org and signing_year = (w ->> 'signing_year')::int;
    if eid is null then
      raise exception '031: the Dodgers % environment is missing', w ->> 'signing_year';
    end if;
    update public.signings
    set signing_environment_id = eid
    where organization_id = org and signing_environment_id is null and signing_date is not null
      and signing_date between (w ->> 'from')::date and (w ->> 'to')::date;
  end loop;
end $$;

-- ===========================================================================
-- 7. VIEW: a component with an ACTIVE decision is RESOLVED (columns of 030 unchanged, one appended)
-- ===========================================================================

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
res as (
  select d.signing_id, d.component_type, rep.amount as selected_amount
  from public.signing_financial_resolutions d
  join public.signing_financial_reports rep on rep.id = d.selected_report_id
  where d.record_status = 'ACTIVE' and rep.record_status = 'ACTIVE' and rep.currency_code = 'USD'
),
comp as (
  select c.signing_id, c.component_type, c.external_reports, c.legacy_reports, c.rule_derived_reports,
    coalesce(res.selected_amount, c.candidate) as candidate,
    case
      when res.selected_amount is not null then 'RESOLVED'
      when c.n_candidates = 0 then 'APPROXIMATE_ONLY'
      when c.n_candidates > 1 then 'CONFLICT'
      when exists (select 1 from r where r.signing_id = c.signing_id and r.component_type = c.component_type and r.amount_basis = 'ROUNDED'
                   and abs(r.amount - c.candidate) > r.amount_precision / 2) then 'CONFLICT'
      else 'AGREED'
    end as resolution_status
  from cand c
  left join res on res.signing_id = c.signing_id and res.component_type = c.component_type
),
per_signing as (
  select s.id as signing_id,
    coalesce(sum(comp.external_reports), 0)::int as external_report_count,
    coalesce(sum(comp.legacy_reports), 0)::int as legacy_report_count,
    coalesce(sum(comp.rule_derived_reports), 0)::int as rule_derived_report_count,
    coalesce(array_agg(comp.component_type order by comp.component_type) filter (where comp.resolution_status = 'CONFLICT'), '{}'::text[]) as conflicting_components,
    coalesce(array_agg(comp.component_type order by comp.component_type) filter (where comp.external_reports > 0), '{}'::text[]) as externally_reported_components,
    coalesce(array_agg(comp.component_type order by comp.component_type) filter (where comp.resolution_status = 'RESOLVED'), '{}'::text[]) as resolved_components,
    max(comp.candidate) filter (where comp.component_type = 'RELEASE_FEE' and comp.resolution_status in ('AGREED', 'RESOLVED')) as release_fee_usd,
    max(comp.candidate) filter (where comp.component_type = 'OTHER_ACQUISITION_FEE' and comp.resolution_status in ('AGREED', 'RESOLVED')) as other_acquisition_fee_usd,
    max(comp.candidate) filter (where comp.component_type = 'POOL_CHARGE' and comp.resolution_status in ('AGREED', 'RESOLVED')) as pool_charge_usd,
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
  select s.*, ps.external_report_count, ps.legacy_report_count, ps.rule_derived_report_count, ps.conflicting_components, ps.externally_reported_components, ps.resolved_components,
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
  end as pool_completeness,
  b.resolved_components
from base b
join public.players p on p.id = b.player_id
join public.organizations o on o.id = b.organization_id
left join public.signing_environments env on env.id = b.signing_environment_id
left join public.sources pts on pts.id = b.international_pool_treatment_source_id;

comment on view public.v_signing_acquisition_financials is
  'One row per signing: canonical component values, known acquisition cost paired with its completeness (COMPLETE / PARTIAL / UNKNOWN / NO_RULE from acquisition_cost_component_rules), and a separate pool / regulatory completeness. bonus_source_status and cost_source_coverage come from the ledger, never from bonus_publicly_reported; a LEGACY_CANONICAL_ONLY value is known in DISI but not externally sourced. A component with an ACTIVE reviewed resolution is RESOLVED to the selected report (resolved_components) and is not a conflict. Unknown is NULL, never zero. No WAR, salary, ROI or ranking.';

-- ===========================================================================
-- 8. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['signing_financial_resolutions', 'v_signing_acquisition_financials'] loop
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
    raise exception '031: API roles hold privileges beyond SELECT: %', bad;
  end if;

  -- every seeded signing report and environment report is present exactly once
  for e in select x from _m031, jsonb_array_elements(j -> 'signing_reports') x loop
    select count(*) into n from public.signing_financial_reports fr join public.signings sg on sg.id = fr.signing_id join public.players p on p.id = sg.player_id
    join public.sources so on so.id = fr.source_id
    where p.slug = e ->> 'player_slug' and sg.signing_year = (e ->> 'signing_year')::int and fr.component_type = 'SIGNING_BONUS'
      and so.url = e ->> 'source_url' and fr.amount = (e ->> 'amount')::numeric and fr.record_status = 'ACTIVE';
    if n <> 1 then raise exception '031 postcondition: report % present % times', e ->> 'ref', n; end if;
  end loop;
  for e in select x from _m031, jsonb_array_elements(j -> 'environment_reports') x loop
    select count(*) into n from public.signing_environment_financial_reports fr join public.signing_environments se on se.id = fr.signing_environment_id
    join public.organizations o on o.id = se.organization_id join public.sources so on so.id = fr.source_id
    where o.name = (select j ->> 'organization_name' from _m031) and se.signing_year = (e ->> 'signing_year')::int and fr.metric_type = e ->> 'metric_type'
      and so.url = e ->> 'source_url' and fr.record_status = 'ACTIVE';
    if n <> 1 then raise exception '031 postcondition: environment report % present % times', e ->> 'ref', n; end if;
  end loop;

  -- column / ledger reconciliation still holds for signing bonuses touched here
  select count(*) into n
  from public.signings s join public.players p on p.id = s.player_id
  where p.slug in (select x ->> 'player_slug' from _m031, jsonb_array_elements(j -> 'signing_reports') x)
    and (s.signing_bonus_usd is null
         or not exists (select 1 from public.signing_financial_reports fr where fr.signing_id = s.id and fr.component_type = 'SIGNING_BONUS'
                          and fr.record_status = 'ACTIVE' and fr.report_origin = 'EXTERNAL_SOURCE'));
  if n <> 0 then raise exception '031 postcondition: % touched signing(s) without a canonical bonus or an external report', n; end if;

  -- no pool capacity gap remains for the periods this migration covers
  select count(*) into n from public.signing_environments se join public.organizations o on o.id = se.organization_id
  where o.name = (select j ->> 'organization_name' from _m031) and se.signing_year in (2012, 2013, 2014, 2017, 2021, 2022) and se.club_bonus_pool_usd is null;
  if n <> 0 then raise exception '031 postcondition: % covered environment(s) have no pool', n; end if;

  -- Rincon's bonus is the corrected, sourced value and its legacy row is retired by supersession
  select count(*) into n from public.signings s join public.players p on p.id = s.player_id
  where p.slug = 'carlos-rincon' and s.signing_bonus_usd = 325000;
  if n <> 1 then raise exception '031 postcondition: Carlos Rincon is not at the corrected bonus'; end if;

  -- Sasaki's posting-fee conflict is untouched
  select count(*) into n from public.v_signing_acquisition_financials where player_slug = 'roki-sasaki' and posting_fee_usd is null
    and conflicting_components = array['POSTING_FEE'];
  if n <> 1 then raise exception '031 postcondition: the Sasaki posting-fee conflict changed'; end if;
end $$;

commit;
