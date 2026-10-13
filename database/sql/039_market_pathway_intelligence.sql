-- DISI v0.30
-- 039_market_pathway_intelligence.sql
-- Market / country / pathway intelligence: a leakage-safe signing-time feature record shared by 039-041, two small reviewed reference
-- tables (market groups, league eras for international amateur signings) and descriptive market / pathway / era context against
-- realized outcomes. Run after 038a.
--
-- Built from database/research/039/ (reference.json, views.sql, audit.mjs, build.mjs; design in architecture-report.md).
--
-- What this is. Derived, read-only intelligence: no signing, outcome, cost or value fact is added or changed. Populations are never
-- pooled (an outcome-selected historical set is never compared with a sample or a census), no market, route or era is ranked, no
-- value-per-cost ratio is computed, and nothing is causal.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED REFERENCE DATA (database/research/039/reference.json)
-- ===========================================================================

create temporary table _m039 on commit drop as
select $m039${"eras":[{"ends_on":"2012-07-01","era_key":"BEFORE_BONUS_POOLS","era_order":1,"label":"Before international bonus pools","rule_summary":"International amateur signings before the bonus-pool system: no league-wide signing budget per club.","source_reference":"2012-2016 Basic Agreement (international talent system effective with the signing period beginning 2 July 2012)","starts_on":null},{"ends_on":"2017-07-01","era_key":"SOFT_CAPPED_BONUS_POOLS","era_order":2,"label":"Bonus pools with overage penalties (2012-13 to 2016-17)","rule_summary":"Each club had an international bonus pool; exceeding it was allowed and penalised by an overage tax and, above thresholds, later maximum-bonus restrictions.","source_reference":"2012-2016 Basic Agreement, international talent acquisition rules","starts_on":"2012-07-02"},{"ends_on":null,"era_key":"HARD_CAPPED_BONUS_POOLS","era_order":3,"label":"Hard-capped bonus pools (2017-18 onward)","rule_summary":"Each club has a hard-capped international bonus pool that cannot be exceeded; the signing period has opened on 15 January since 2021.","source_reference":"2017-2021 Basic Agreement (and its successor), international bonus pool rules","starts_on":"2017-07-02"}],"market_groups":[{"country_market":"Dominican Republic","market_group":"DOMINICAN_REPUBLIC","region":"LATIN_AMERICA_CARIBBEAN"},{"country_market":"Venezuela","market_group":"VENEZUELA","region":"LATIN_AMERICA_CARIBBEAN"},{"country_market":"Mexico","market_group":"MEXICO","region":"LATIN_AMERICA_CARIBBEAN"},{"country_market":"Cuba","market_group":"CUBA","region":"LATIN_AMERICA_CARIBBEAN"},{"country_market":"Puerto Rico","market_group":"OTHER_LATIN_AMERICA_CARIBBEAN","region":"LATIN_AMERICA_CARIBBEAN"},{"country_market":"Curacao","market_group":"OTHER_LATIN_AMERICA_CARIBBEAN","region":"LATIN_AMERICA_CARIBBEAN"},{"country_market":"Aruba","market_group":"OTHER_LATIN_AMERICA_CARIBBEAN","region":"LATIN_AMERICA_CARIBBEAN"},{"country_market":"Panama","market_group":"OTHER_LATIN_AMERICA_CARIBBEAN","region":"LATIN_AMERICA_CARIBBEAN"},{"country_market":"Nicaragua","market_group":"OTHER_LATIN_AMERICA_CARIBBEAN","region":"LATIN_AMERICA_CARIBBEAN"},{"country_market":"Colombia","market_group":"OTHER_LATIN_AMERICA_CARIBBEAN","region":"LATIN_AMERICA_CARIBBEAN"},{"country_market":"Japan","market_group":"ASIA_PACIFIC","region":"ASIA_PACIFIC"},{"country_market":"South Korea","market_group":"ASIA_PACIFIC","region":"ASIA_PACIFIC"},{"country_market":"Taiwan","market_group":"ASIA_PACIFIC","region":"ASIA_PACIFIC"},{"country_market":"Australia","market_group":"ASIA_PACIFIC","region":"ASIA_PACIFIC"},{"country_market":"Netherlands","market_group":"EUROPE_AFRICA_OTHER","region":"EUROPE_AFRICA_OTHER"},{"country_market":"Italy","market_group":"EUROPE_AFRICA_OTHER","region":"EUROPE_AFRICA_OTHER"},{"country_market":"Spain","market_group":"EUROPE_AFRICA_OTHER","region":"EUROPE_AFRICA_OTHER"},{"country_market":"Russia","market_group":"EUROPE_AFRICA_OTHER","region":"EUROPE_AFRICA_OTHER"},{"country_market":"Uganda","market_group":"EUROPE_AFRICA_OTHER","region":"EUROPE_AFRICA_OTHER"},{"country_market":"South Sudan","market_group":"EUROPE_AFRICA_OTHER","region":"EUROPE_AFRICA_OTHER"}]}$m039$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
begin
  if to_regclass('public.v_network_player_outcomes') is null or to_regclass('public.v_player_development_pathway') is null
     or to_regclass('public.v_player_realized_outcome') is null then
    raise exception '039: Migrations 036-038a have not been applied';
  end if;
  if exists (select 1 from public.signings group by player_id having count(*) > 1) then
    raise exception '039: a player has more than one signing; the signing-time feature record needs an explicit signing choice first';
  end if;
end $$;

-- ===========================================================================
-- 2. REFERENCE TABLES (written only by migrations)
-- ===========================================================================

create table if not exists public.market_groups (
  country_market text primary key check (btrim(country_market) <> ''),
  market_group text not null check (market_group ~ '^[A-Z_]+$'),
  region text not null check (region ~ '^[A-Z_]+$'),
  created_at timestamptz not null default now()
);

comment on table public.market_groups is
  'Reviewed market groups (Migration 039): each observed signings.country_market mapped to a group justified by the data (the four largest markets on their own, then regional groups). A NULL market is UNKNOWN in the views, never guessed.';

create table if not exists public.international_signing_eras (
  era_key text primary key check (era_key ~ '^[A-Z_]+$'),
  era_order integer not null unique check (era_order >= 1),
  label text not null check (btrim(label) <> ''),
  starts_on date,
  ends_on date,
  rule_summary text not null check (btrim(rule_summary) <> '' and char_length(rule_summary) <= 500),
  source_reference text not null check (btrim(source_reference) <> ''),
  created_at timestamptz not null default now(),
  constraint international_signing_eras_range_check check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

comment on table public.international_signing_eras is
  'League rule eras for international amateur signings (Migration 039): before bonus pools, soft-capped pools from the 2012-13 signing period, hard-capped pools from the 2017-18 period. Professional routes (posting, foreign professional transfers) are not placed on this scale.';

do $$
declare t text;
begin
  foreach t in array array['market_groups', 'international_signing_eras'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists public_read_%I on public.%I', t, t);
    execute format('create policy public_read_%I on public.%I for select to anon, authenticated using (true)', t, t);
  end loop;
end $$;

insert into public.market_groups (country_market, market_group, region)
select x ->> 'country_market', x ->> 'market_group', x ->> 'region'
from _m039, jsonb_array_elements(j -> 'market_groups') x
on conflict (country_market) do nothing;

insert into public.international_signing_eras (era_key, era_order, label, starts_on, ends_on, rule_summary, source_reference)
select x ->> 'era_key', (x ->> 'era_order')::int, x ->> 'label', (x ->> 'starts_on')::date, (x ->> 'ends_on')::date, x ->> 'rule_summary', x ->> 'source_reference'
from _m039, jsonb_array_elements(j -> 'eras') x
on conflict (era_key) do nothing;

-- ===========================================================================
-- 3. VIEWS
-- ===========================================================================

-- ===========================================================================
-- Migration 039 views: signing-time features, market / pathway context, market / pathway summary, research queue
-- ===========================================================================

-- One row per tracked signing with ONLY the facts known at signing: no outcome, no development, no later evaluation. This is the
-- leakage-safe feature record shared by 039 (context), 040 (archetypes and comparables) and 041 (feature matrix). The cutoff is the
-- signing date, else the formal transaction date, else the announcement date, else 31 December of the signing year.
create or replace view public.v_signing_time_features
with (security_invoker = true)
as
with m as materialized (
  with base as (
    select s.id as signing_id, s.player_id, pl.slug as player_slug, pl.full_name, o.abbreviation as organization, o.franchise_key,
      (o.franchise_key = 'DODGERS') as is_dodgers, s.record_scope, s.signing_year, s.signing_date, s.pathway::text as pathway,
      s.country_market, s.position_at_signing, pl.birth_date,
      coalesce(s.signing_date, s.formal_transaction_date, s.announced_date, make_date(s.signing_year, 12, 31)) as signing_cutoff_date,
      case when coalesce(s.signing_date, s.formal_transaction_date, s.announced_date) is null then 'YEAR_END' else 'DAY' end as cutoff_precision
    from public.signings s
    join public.players pl on pl.id = s.player_id
    join public.organizations o on o.id = s.organization_id
  ),
  -- the earliest banded expectation observation dated on or before the cutoff (at its own date precision)
  expect as (
    select distinct on (b.signing_id) b.signing_id, o.band_family, o.band_code, o.band_order, o.evaluation_id
    from base b
    join public.v_scouting_expectation_observations o on o.player_id = b.player_id and o.banding_state = 'BANDED'
    where case o.date_precision
        when 'DAY' then o.evaluation_date
        when 'MONTH' then (make_date(o.evaluation_year, o.evaluation_month, 1) + interval '1 month' - interval '1 day')::date
        when 'YEAR' then make_date(o.evaluation_year, 12, 31)
        when 'SEASON' then make_date(o.evaluation_year, 12, 31)
      end <= b.signing_cutoff_date
    order by b.signing_id, o.evaluation_year, coalesce(o.evaluation_month, 12), o.evaluation_date nulls last, o.band_order, o.evaluation_id
  )
  select
    b.signing_id, b.player_id, b.player_slug, b.full_name, b.organization, b.franchise_key, b.is_dodgers, b.record_scope,
    case b.record_scope
      when 'HISTORICAL_VERIFIED' then 'OUTCOME_SELECTED_SAMPLE'
      when 'MLB_PIPELINE_TOP_PROSPECT' then 'TOP_PROSPECT_SAMPLE'
      when 'TRACKED_DODGERS' then 'TRACKED_SAMPLE'
      when 'COMPLETE_CENSUS' then 'OPENING_CLASS_CENSUS'
      else 'UNCLASSIFIED_POPULATION'
    end as population_class,
    b.signing_year, b.signing_cutoff_date, b.cutoff_precision, b.signing_cutoff_date as feature_as_of_date,
    b.pathway,
    case when b.pathway in ('CUBAN_PRO', 'JAPAN_PRO', 'KOREA_PRO', 'POSTED_PLAYER', 'MEXICAN_LEAGUE_TRANSFER') then 'PROFESSIONAL_SIGNING'
      else 'AMATEUR_OR_UNCLASSIFIED_SIGNING' end as signing_route,
    b.country_market,
    coalesce(mg.market_group, case when b.country_market is null then 'UNKNOWN' else 'UNMAPPED' end) as market_group,
    coalesce(mg.region, case when b.country_market is null then 'UNKNOWN' else 'UNMAPPED' end) as market_region,
    case
      when b.pathway in ('CUBAN_PRO', 'JAPAN_PRO', 'KOREA_PRO', 'POSTED_PLAYER', 'MEXICAN_LEAGUE_TRANSFER') then 'PROFESSIONAL_ROUTE'
      when b.signing_date is null and b.signing_year in (2012, 2017) then 'ERA_BOUNDARY_AMBIGUOUS'
      else (select e.era_key from public.international_signing_eras e
            where coalesce(b.signing_date, make_date(b.signing_year, 12, 31)) between coalesce(e.starts_on, '-infinity'::date) and coalesce(e.ends_on, 'infinity'::date))
    end as era_key,
    case when b.birth_date is not null then b.signing_year - extract(year from b.birth_date)::int end as age_in_signing_year,
    case
      when b.birth_date is null then 'AGE_UNKNOWN'
      when b.signing_year - extract(year from b.birth_date)::int <= 16 then 'AGE_16_OR_YOUNGER'
      when b.signing_year - extract(year from b.birth_date)::int = 17 then 'AGE_17'
      when b.signing_year - extract(year from b.birth_date)::int = 18 then 'AGE_18'
      when b.signing_year - extract(year from b.birth_date)::int <= 20 then 'AGE_19_20'
      else 'AGE_21_PLUS'
    end as age_band,
    b.position_at_signing,
    case
      when b.position_at_signing is null then 'POSITION_UNKNOWN'
      when b.position_at_signing in ('RHP', 'LHP', 'P') then 'PITCHER'
      when b.position_at_signing = 'C' then 'CATCHER'
      when b.position_at_signing in ('SS', '2B') then 'MIDDLE_INFIELD'
      when b.position_at_signing in ('3B', '1B') then 'CORNER_INFIELD'
      when b.position_at_signing in ('INF', 'UTIL') then 'INFIELD_UNSPECIFIED'
      when b.position_at_signing in ('OF', 'CF', 'LF', 'RF') then 'OUTFIELD'
      else 'POSITION_OTHER'
    end as position_family,
    f.signing_bonus_usd,
    case
      when f.signing_bonus_usd is null then 'BONUS_UNKNOWN'
      when f.signing_bonus_usd < 100000 then 'BONUS_UNDER_100K'
      when f.signing_bonus_usd < 500000 then 'BONUS_100K_TO_499K'
      when f.signing_bonus_usd < 1000000 then 'BONUS_500K_TO_999K'
      when f.signing_bonus_usd < 2000000 then 'BONUS_1M_TO_1_99M'
      else 'BONUS_2M_PLUS'
    end as cost_band,
    f.known_acquisition_cost_usd, f.acquisition_cost_completeness,
    x.band_family as expectation_band_family, x.band_code as expectation_band_code, x.band_order as expectation_band_order,
    x.evaluation_id as expectation_evaluation_id,
    case when x.band_order = 1 then 'TOP_BAND' when x.band_order is not null then 'LOWER_BAND' else 'NO_AT_SIGNING_EXPECTATION' end as expectation_tier,
    (b.country_market is not null) as has_market, (b.birth_date is not null) as has_age, (b.position_at_signing is not null) as has_position,
    (f.signing_bonus_usd is not null) as has_bonus, (x.band_code is not null) as has_expectation,
    ((b.country_market is not null)::int + (b.birth_date is not null)::int + (b.position_at_signing is not null)::int) as core_features_known,
    3 as core_features_total
  from base b
  left join public.market_groups mg on mg.country_market = b.country_market
  left join public.v_signing_acquisition_financials f on f.signing_id = b.signing_id
  left join expect x on x.signing_id = b.signing_id
)
select * from m;

comment on view public.v_signing_time_features is
  'Leakage-safe signing-time features (Migration 039): one row per tracked signing with only facts of the signing itself - population class, route, market group (market_groups), league era for international amateur signings (international_signing_eras; professional routes are PROFESSIONAL_ROUTE, an undated 2012 / 2017 signing ERA_BOUNDARY_AMBIGUOUS), age in the signing year, position AT SIGNING (a later primary position is never used), the reported signing bonus (a fact of the signing event; when the public first learned it is not known), and the earliest banded expectation observation dated on or before signing_cutoff_date. No outcome, development, later evaluation or network fact is read. Missing features stay NULL / *_UNKNOWN and are counted in core_features_known; nothing is imputed.';

-- Signing-time features with the realized outcome (036 spine) and the 037 pathway beside them: descriptive context, not prediction.
create or replace view public.v_market_pathway_player_context
with (security_invoker = true)
as
with m as materialized (
  select f.*,
    r.outcome_state, r.reached_mlb_verified, r.outcome_maturity, r.mlb_debut_date, r.years_signing_to_debut_season,
    r.career_bwar, r.signing_org_bwar, r.elsewhere_bwar, r.dodgers_attributable_organizational_bwar,
    p.pathway_class, p.pathway_status,
    exists (select 1 from public.player_network_relationships pr where pr.player_id = f.player_id and pr.record_status = 'ACTIVE') as network_documented,
    r.analysis_as_of_date
  from public.v_signing_time_features f
  join public.v_player_realized_outcome r on r.signing_id = f.signing_id
  left join public.v_player_development_pathway p on p.signing_id = f.signing_id
)
select * from m;

comment on view public.v_market_pathway_player_context is
  'Market / pathway context (Migration 039): v_signing_time_features plus the realized outcome (v_player_realized_outcome) and the 037 development pathway, one row per tracked signing. Descriptive only: a market, route, era or pathway is context for an outcome, never its cause. population_class must be respected - an OUTCOME_SELECTED_SAMPLE row was kept because the player became notable.';

-- Descriptive summary by dimension and population class (classes are never pooled). Counts use mature signings; a sample share needs
-- a non-outcome-selected class with 10+ mature audited members; a census-grade rate needs a complete population with every member
-- mature and audited. No market, route or era is ranked.
create or replace view public.v_market_pathway_summary
with (security_invoker = true)
as
with m as materialized (
  with c as materialized (select * from public.v_market_pathway_player_context),
  d as (
    select 'MARKET_GROUP'::text as dimension, c.market_group as dimension_value, c.* from c
    union all select 'COUNTRY_MARKET', coalesce(c.country_market, 'UNKNOWN'), c.* from c
    union all select 'PATHWAY', c.pathway, c.* from c
    union all select 'ERA', c.era_key, c.* from c
    union all select 'AGE_BAND', c.age_band, c.* from c
    union all select 'POSITION_FAMILY', c.position_family, c.* from c
    union all select 'COST_BAND', c.cost_band, c.* from c
    union all select 'EXPECTATION_TIER', c.expectation_tier, c.* from c
    union all select 'PATHWAY_CLASS', coalesce(c.pathway_class, 'NO_PATHWAY_RECORD'), c.* from c
  ),
  agg as (
    select d.dimension, d.dimension_value, d.population_class,
      count(*)::int as tracked_count,
      count(*) filter (where d.outcome_maturity = 'MATURE')::int as mature_count,
      count(*) filter (where d.outcome_maturity = 'MATURE' and d.reached_mlb_verified is not null)::int as audited_count,
      count(*) filter (where d.outcome_maturity = 'MATURE' and d.reached_mlb_verified)::int as reached_mlb_count,
      sum(d.career_bwar) filter (where d.outcome_maturity = 'MATURE' and d.reached_mlb_verified) as career_bwar_total,
      sum(d.signing_org_bwar) filter (where d.outcome_maturity = 'MATURE' and d.reached_mlb_verified) as signing_org_bwar_total,
      sum(d.dodgers_attributable_organizational_bwar) filter (where d.outcome_maturity = 'MATURE' and d.is_dodgers) as dodgers_attributable_bwar_total,
      percentile_cont(0.5) within group (order by d.years_signing_to_debut_season) filter (where d.reached_mlb_verified) as median_years_to_debut_season,
      count(*) filter (where d.acquisition_cost_completeness = 'COMPLETE')::int as cost_complete_count,
      sum(d.known_acquisition_cost_usd) filter (where d.acquisition_cost_completeness = 'COMPLETE') as complete_cost_total_usd,
      count(*) filter (where d.network_documented)::int as network_documented_count,
      min(d.signing_year) as first_signing_year, max(d.signing_year) as last_signing_year
    from d group by d.dimension, d.dimension_value, d.population_class
  )
  select
    a.dimension, a.dimension_value, a.population_class as population_scope,
    a.tracked_count, a.mature_count, a.audited_count, a.reached_mlb_count,
    round(a.career_bwar_total, 2) as career_bwar_total, round(a.signing_org_bwar_total, 2) as signing_org_bwar_total,
    round(a.dodgers_attributable_bwar_total, 2) as dodgers_attributable_bwar_total,
    round(a.median_years_to_debut_season::numeric, 1) as median_years_to_debut_season,
    a.cost_complete_count,
    case when a.cost_complete_count = a.tracked_count then round(a.complete_cost_total_usd, 2) end as complete_cost_total_usd,
    round(a.cost_complete_count::numeric / a.tracked_count, 3) as cost_coverage,
    case when a.mature_count > 0 then round(a.audited_count::numeric / a.mature_count, 3) end as outcome_coverage,
    a.network_documented_count,
    a.first_signing_year, a.last_signing_year,
    (a.population_class = 'OPENING_CLASS_CENSUS' and a.mature_count = a.tracked_count and a.audited_count = a.mature_count and a.audited_count >= 10) as rate_eligible,
    case when a.population_class = 'OPENING_CLASS_CENSUS' and a.mature_count = a.tracked_count and a.audited_count = a.mature_count and a.audited_count >= 10
      then round(a.reached_mlb_count::numeric / a.audited_count, 3) end as census_reach_rate,
    case when a.population_class in ('TOP_PROSPECT_SAMPLE', 'TRACKED_SAMPLE', 'OPENING_CLASS_CENSUS') and a.audited_count >= 10
      then round(a.reached_mlb_count::numeric / a.audited_count, 3) end as sample_reach_share,
    case
      when a.population_class = 'OUTCOME_SELECTED_SAMPLE' then 'OUTCOME_SELECTED_NOT_COMPARABLE'
      when a.population_class = 'OPENING_CLASS_CENSUS' and a.mature_count = a.tracked_count and a.audited_count = a.mature_count and a.audited_count >= 10 then 'CENSUS_RATE_ELIGIBLE'
      when a.audited_count >= 10 then 'DESCRIPTIVE_SAMPLE'
      else 'INSUFFICIENT_SAMPLE'
    end as sample_state
  from agg a
)
select * from m;

comment on view public.v_market_pathway_summary is
  'Market / country / pathway summary (Migration 039): one row per dimension value and population class; classes are never pooled. Outcome counts use mature signings (signing + 5 years). sample_reach_share needs a non-outcome-selected class with 10+ mature audited members and describes that sample only; census_reach_rate needs a complete opening-class census with every member mature and audited (rate_eligible). OUTCOME_SELECTED_SAMPLE rows carry no share. complete_cost_total_usd appears only when every member''s acquisition cost is COMPLETE; no value-per-cost ratio is computed. No market, route or era is ranked, and nothing is causal.';

-- Research queue: signing-time facts that are missing, so a signing cannot be fully described or compared. Bonus gaps stay in
-- v_financial_research_queue.
create or replace view public.v_market_research_queue
with (security_invoker = true)
as
with m as materialized (
  with f as materialized (select * from public.v_signing_time_features where population_class <> 'OUTCOME_SELECTED_SAMPLE')
  select 'SIGNING_MARKET_UNKNOWN'::text as issue, 2 as priority, f.signing_id, f.player_slug, f.full_name, f.signing_year,
    'The signing market (country_market) is not recorded; the signing cannot be placed in any market group.'::text as detail
  from f where f.country_market is null
  union all
  select 'POSITION_AT_SIGNING_UNKNOWN', 2, f.signing_id, f.player_slug, f.full_name, f.signing_year,
    'The position at signing is not recorded; a later position is never substituted.'
  from f where f.position_at_signing is null
  union all
  select 'AGE_AT_SIGNING_UNKNOWN', 2, f.signing_id, f.player_slug, f.full_name, f.signing_year,
    'No birth date is recorded, so the age in the signing year is unknown.'
  from f where not f.has_age
  union all
  select 'SIGNING_ERA_AMBIGUOUS', 3, f.signing_id, f.player_slug, f.full_name, f.signing_year,
    format('Signed in %s without a recorded date: the bonus-pool era changed on 2 July of that year.', f.signing_year)
  from f where f.era_key = 'ERA_BOUNDARY_AMBIGUOUS'
  union all
  select 'SIGNING_MARKET_UNMAPPED', 1, f.signing_id, f.player_slug, f.full_name, f.signing_year,
    format('Signing market %s has no reviewed market group.', f.country_market)
  from f where f.market_group = 'UNMAPPED'
)
select * from m;

comment on view public.v_market_research_queue is
  'Signing-context research queue (Migration 039): signing-time facts that are missing or ambiguous (market, position at signing, age, era boundary, unmapped market) for non-outcome-selected signings. Bonus and cost gaps stay in v_financial_research_queue.';

-- ===========================================================================
-- 4. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['v_signing_time_features', 'v_market_pathway_player_context', 'v_market_pathway_summary', 'v_market_research_queue'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

do $$
declare
  bad text;
  n int;
  expected int;
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
    raise exception '039: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- the reviewed reference rows are present exactly as researched
  select count(*) into expected from _m039, jsonb_array_elements(j -> 'market_groups');
  select count(*) into n from public.market_groups g join _m039 on true
  where exists (select 1 from jsonb_array_elements(j -> 'market_groups') x where x ->> 'country_market' = g.country_market
    and x ->> 'market_group' = g.market_group and x ->> 'region' = g.region);
  if n <> expected then
    raise exception '039 postcondition: % of % market groups match the reviewed definitions', n, expected;
  end if;
  select count(*) into expected from _m039, jsonb_array_elements(j -> 'eras');
  select count(*) into n from public.international_signing_eras e join _m039 on true
  where exists (select 1 from jsonb_array_elements(j -> 'eras') x where x ->> 'era_key' = e.era_key
    and (x ->> 'starts_on')::date is not distinct from e.starts_on and (x ->> 'ends_on')::date is not distinct from e.ends_on);
  if n <> expected then
    raise exception '039 postcondition: % of % eras match the reviewed definitions', n, expected;
  end if;
  -- eras never overlap
  select count(*) into n from public.international_signing_eras a join public.international_signing_eras b on a.era_key < b.era_key
   and coalesce(a.starts_on, '-infinity'::date) <= coalesce(b.ends_on, 'infinity'::date) and coalesce(b.starts_on, '-infinity'::date) <= coalesce(a.ends_on, 'infinity'::date);
  if n <> 0 then
    raise exception '039 postcondition: % overlapping era pair(s)', n;
  end if;
  -- one feature row per signing; every recorded market is mapped
  select count(*) into n from public.v_signing_time_features;
  select count(*) into expected from public.signings;
  if n <> expected then
    raise exception '039 postcondition: % feature rows for % signings', n, expected;
  end if;
  select count(*) into n from public.v_signing_time_features where market_group = 'UNMAPPED';
  if n <> 0 then
    raise exception '039 postcondition: % signing(s) with an unmapped market', n;
  end if;
end $$;

commit;
