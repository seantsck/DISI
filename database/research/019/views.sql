-- 7a. Conflict types gain OUTCOME and IDENTITY.
alter table public.research_source_conflicts drop constraint if exists research_source_conflicts_conflict_type_check;
alter table public.research_source_conflicts add constraint research_source_conflicts_conflict_type_check
  check (conflict_type in ('NAME_SPELLING','POSITION','BIRTH_COUNTRY','COUNTRY_MARKET','CLASS_MEMBERSHIP',
    'POPULATION_COUNT','PERIOD_ASSIGNMENT','POPULATION_DEFINITION','OUTCOME','IDENTITY'));

update public.research_source_conflicts set conflict_type = 'OUTCOME'
where conflict_key like 'OUTCOME:%' and conflict_type <> 'OUTCOME';

-- MLB spellings that differ from the DISI name (beyond accents / qualifiers).
insert into public.research_source_conflicts (
  conflict_key, conflict_type, player_id, field_name, value_a, value_b, source_b_id, status, resolution
)
select 'NAME:' || p.slug, 'NAME_SPELLING', p.id, 'full_name', p.full_name, i.mlb_full_name, src.id, 'RESOLVED',
       'DISI name kept (it matches the signing source); MLB spelling stored as an alias. Identity basis: ' || i.identity_basis || '.'
from _m019_identity i
join public.players p on p.slug = i.slug
join public.sources src on src.url = 'https://statsapi.mlb.com/api/v1/people/' || i.mlb_id
where i.mlb_full_name is not null
  and public.disi_ascii_fold(regexp_replace(p.full_name, '\s*\([^)]*\)', '', 'g')) <> public.disi_ascii_fold(i.mlb_full_name)
on conflict (conflict_key) do nothing;

-- Identities resolved by name search rather than a Dodgers transaction.
insert into public.research_source_conflicts (
  conflict_key, conflict_type, player_id, field_name, value_a, value_b, source_b_id, status, resolution, note
)
select 'IDENTITY:' || p.slug, 'IDENTITY', p.id, 'mlb_id', p.full_name, i.mlb_full_name || ' (MLB id ' || i.mlb_id || ')',
       src.id, 'RESOLVED', i.identity_note, 'Resolved by corroborating evidence rather than a Dodgers signing transaction.'
from _m019_identity i
join public.players p on p.slug = i.slug
join public.sources src on src.url = 'https://statsapi.mlb.com/api/v1/people/' || i.mlb_id
where i.identity_basis <> 'DODGERS_TRANSACTION_MATCH'
on conflict (conflict_key) do nothing;

-- 7b. Player dossier (replaces 017): existing columns kept; outcome state and
-- structured progress appended.
create or replace view public.v_player_dossier
with (security_invoker = true)
as
select
  p.id as player_id,
  p.slug as player_slug,
  p.full_name,
  p.canonical_name,
  coalesce(pa.aliases, array[]::text[]) as aliases,
  p.birth_date,
  p.birth_city,
  p.birth_country,
  p.nationality,
  p.primary_position,
  p.secondary_positions,
  p.bats,
  p.throws,
  p.height_in,
  p.weight_lb,
  p.mlb_id,
  p.bref_id,
  p.fangraphs_id,
  case
    when oa.player_id is null then 'NOT_AUDITED'
    when oa.reached_mlb_verified then 'VERIFIED_MLB'
    else 'VERIFIED_NO_MLB'
  end as outcome_audit_status,
  oa.reached_mlb_verified,
  oa.audited_through_date,
  oa.audit_note,
  oa.confidence::text as audit_confidence,
  oc.mlb_debut_date,
  debut.abbreviation as mlb_debut_org,
  debut.name as mlb_debut_org_name,
  case when debut.id is null then null else debut.franchise_key = 'DODGERS' end
    as direct_dodgers_franchise_debut,
  oc.mlb_games,
  oc.mlb_pa,
  oc.mlb_ip,
  oc.years_of_mlb_service,
  oc.current_status,
  oc.outcome_through_season,
  (oc.current_status ilike 'ACTIVE%' or oc.current_status ilike 'REACHED_MLB_%') as is_active,
  w.career_bwar,
  w.bwar_source_id,
  w.bwar_source_url,
  w.bwar_observed_through_date,
  w.bwar_observed_through_season,
  w.career_fwar,
  w.fwar_source_id,
  w.fwar_source_url,
  w.fwar_observed_through_date,
  w.fwar_observed_through_season,
  oa.outcome_state,
  pp.as_of_date as progress_as_of_date,
  pp.highest_level,
  pp.highest_level_season,
  pp.last_affiliated_season,
  pp.last_affiliated_team,
  pp.last_affiliated_level,
  pp.final_transaction_type,
  pp.final_transaction_date,
  pp.final_organization,
  pp.disposition,
  pp.active_in_affiliated_ball,
  pp.continued_outside_affiliated,
  (select count(*)::int from public.outcome_evidence e where e.player_id = p.id) as outcome_evidence_count
from public.players p
left join lateral (
  select array_agg(a.alias order by a.alias) as aliases
  from public.player_aliases a
  where a.player_id = p.id
) pa on true
left join public.outcome_audits oa on oa.player_id = p.id
left join public.outcomes oc on oc.player_id = p.id
left join public.organizations debut on debut.id = oc.mlb_debut_organization_id
left join public.v_player_war w on w.player_id = p.id
left join public.player_professional_progress pp on pp.player_id = p.id;

-- 7c. Player provenance (replaces 018): adds outcome evidence.
create or replace view public.v_player_sources
with (security_invoker = true)
as
with facts as (
  select s.player_id,
         'Signing ' || s.signing_year || coalesce(' · ' || replace(e.field_name, '_usd', ''), '') as fact,
         e.source_id, e.confidence::text as confidence, e.evidence_note as note
  from public.evidence e
  join public.signings s on s.id = e.entity_id
  where e.entity_type = 'signing'
  union all
  select e.entity_id, 'Player record' || coalesce(' · ' || e.field_name, ''),
         e.source_id, e.confidence::text, e.evidence_note
  from public.evidence e
  where e.entity_type = 'player'
  union all
  select oc.player_id, 'MLB outcome', oc.source_id, oc.confidence::text, null
  from public.outcomes oc where oc.source_id is not null
  union all
  select oa.player_id, 'Outcome audit', oa.source_id, oa.confidence::text, oa.audit_note
  from public.outcome_audits oa where oa.source_id is not null
  union all
  select m.player_id,
         case m.metric_key when 'CAREER_BWAR' then 'Career bWAR' else 'Career fWAR' end
           || ' through ' || to_char(m.observed_through_date, 'YYYY-MM-DD'),
         m.source_id, m.confidence::text, m.notes
  from public.player_metric_observations m
  union all
  select t.player_id, 'Transaction ' || coalesce(to_char(t.transaction_date, 'YYYY-MM-DD'), ''),
         t.source_id, t.confidence::text, t.return_description
  from public.transactions t where t.source_id is not null
  union all
  select a.player_id, 'Transaction ' || to_char(e.transaction_date, 'YYYY-MM-DD'),
         coalesce(a.source_id, e.source_id), null, e.description
  from public.transaction_event_assets a
  join public.transaction_events e on e.id = a.event_id
  where a.player_id is not null and coalesce(a.source_id, e.source_id) is not null
  union all
  select a.player_id, 'Trade return metrics', r.source_id, null, r.valuation_note
  from public.transaction_event_assets a
  join public.transaction_return_metrics r on r.event_id = a.event_id
  where a.player_id is not null and r.source_id is not null
  union all
  select m.player_id, 'Development · ' || replace(initcap(m.milestone::text), '_', ' '),
         m.source_id, m.confidence::text, m.notes
  from public.development_milestones m where m.source_id is not null
  union all
  select s.player_id, 'Signing class ' || s.signing_year || ' size', c.source_id, null, c.notes
  from public.signings s
  join public.organizations o on o.id = s.organization_id
  join public.signing_census_coverage c
    on s.signing_year between c.period_start_year and c.period_end_year
  join public.organizations co on co.id = c.organization_id and co.franchise_key = o.franchise_key
  where c.source_id is not null
  union all
  select s.player_id,
         'Class membership · ' || pop.period_label || ' (' || replace(initcap(ms.membership_basis), '_', ' ') || ')',
         ms.source_id, ms.confidence::text,
         concat_ws(' ', ms.note, 'Supports: ' || array_to_string(ms.supports_fields, ', ') || '.')
  from public.signing_population_member_sources ms
  join public.signing_population_members pm on pm.id = ms.member_id
  join public.signing_populations pop on pop.id = pm.population_id
  join public.signings s on s.id = pm.signing_id
  union all
  select a.player_id, 'Alias · ' || a.alias, a.source_id, null, null
  from public.player_aliases a where a.source_id is not null
  union all
  select oe.player_id,
         'Outcome evidence · ' || array_to_string(array(select replace(initcap(f), '_', ' ') from unnest(oe.supports_fields) f), ', '),
         oe.source_id, oe.confidence::text, oe.note
  from public.outcome_evidence oe
)
select distinct
  f.player_id,
  f.fact,
  src.id as source_id,
  src.source_name,
  src.source_type,
  coalesce(src.source_tier, public.disi_infer_source_tier(src.url, src.source_type)) as source_tier,
  st.priority as tier_priority,
  src.title,
  src.url,
  src.publication_date,
  (src.accessed_at at time zone 'UTC')::date as accessed_date,
  f.confidence,
  f.note
from facts f
join public.sources src on src.id = f.source_id
left join public.source_tiers st
  on st.tier_code = coalesce(src.source_tier, public.disi_infer_source_tier(src.url, src.source_type));

-- 7d. Outcome audit progress (Dodgers franchise).
create or replace view public.v_dodgers_outcome_audit_progress
with (security_invoker = true)
as
with r as (
  select s.signing_year, oa.player_id is not null as audited, oa.reached_mlb_verified, oa.outcome_state,
         (s.signing_year <= extract(year from current_date)::int - 5) as mature
  from public.signings s
  join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
  left join public.outcome_audits oa on oa.player_id = s.player_id
)
select
  count(*)::int as tracked_signings,
  count(*) filter (where audited)::int as audited,
  count(*) filter (where reached_mlb_verified)::int as verified_mlb,
  count(*) filter (where reached_mlb_verified = false)::int as verified_no_mlb,
  count(*) filter (where outcome_state = 'NO_MLB_CAREER_ENDED')::int as no_mlb_career_ended,
  count(*) filter (where outcome_state = 'NO_MLB_ACTIVE_IN_MINORS')::int as no_mlb_active_in_minors,
  count(*) filter (where outcome_state = 'NO_MLB_STATUS_UNKNOWN')::int as no_mlb_status_unknown,
  count(*) filter (where not audited)::int as unaudited,
  count(*) filter (where not audited and mature)::int as mature_unaudited,
  count(*) filter (where not audited and not mature)::int as developing_unaudited,
  round(100.0 * count(*) filter (where audited) / nullif(count(*), 0), 1) as audit_completion_pct,
  round(100.0 * count(*) filter (where audited and mature) / nullif(count(*) filter (where mature), 0), 1) as mature_audit_completion_pct
from r;

-- 7e. Mature outcome queue: unaudited signings at least five years old.
create or replace view public.v_dodgers_mature_outcome_queue
with (security_invoker = true)
as
select
  p.id as player_id,
  p.slug as player_slug,
  p.full_name,
  p.mlb_id,
  s.signing_year,
  extract(year from current_date)::int - s.signing_year as years_since_signing,
  case
    when s.signing_year <= 2014 then 'TIER_1_THROUGH_2014'
    when s.signing_year <= 2020 then 'TIER_2_2015_2020'
    else 'TIER_3_RECENT_MATURE'
  end as audit_tier,
  pp.highest_level,
  pp.last_affiliated_season,
  pp.last_affiliated_team,
  pp.disposition,
  pp.research_recommendation,
  case
    when pp.player_id is null then 'NOT_YET_RESEARCHED'
    when pp.research_recommendation = 'INSUFFICIENT_EVIDENCE' then 'INSUFFICIENT_EVIDENCE'
    when pp.research_recommendation = 'NO_MLB_ACTIVE_IN_MINORS' then 'STILL_DEVELOPING'
    else 'AWAITING_REVIEW'
  end as unaudited_reason,
  case
    when s.signing_year <= 2014 then 100
    when s.signing_year <= 2020 then 80
    else 60
  end + case when pp.player_id is null then 10 else 0 end as priority
from public.signings s
join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
join public.players p on p.id = s.player_id
left join public.outcome_audits oa on oa.player_id = s.player_id
left join public.player_professional_progress pp on pp.player_id = s.player_id
where oa.player_id is null
  and s.signing_year <= extract(year from current_date)::int - 5;

-- 7f. Outcomes by signing class. A tracked-cohort share is shown only when every
-- tracked player is audited and is always labelled as a tracked-cohort outcome;
-- organization rate analysis follows the 018 population rules.
create or replace view public.v_dodgers_outcome_by_signing_class
with (security_invoker = true)
as
with r as (
  select s.signing_year, oa.player_id is not null as audited, oa.reached_mlb_verified, oa.outcome_state
  from public.signings s
  join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
  left join public.outcome_audits oa on oa.player_id = s.player_id
),
agg as (
  select signing_year,
         count(*)::int as tracked_players,
         count(*) filter (where audited)::int as audited,
         count(*) filter (where reached_mlb_verified)::int as mlb_reached,
         count(*) filter (where reached_mlb_verified = false)::int as verified_no_mlb,
         count(*) filter (where outcome_state = 'NO_MLB_ACTIVE_IN_MINORS')::int as no_mlb_still_active,
         count(*) filter (where not audited)::int as unresolved
  from r
  group by signing_year
),
pops as (
  select y.signing_year,
         array_agg(distinct pc.population_scope order by pc.population_scope) as population_scopes,
         bool_or(pc.rate_eligible) as any_rate_eligible
  from public.v_dodgers_signing_population_coverage pc
  cross join lateral generate_series(pc.signing_year, coalesce((select p.class_year_end from public.signing_populations p where p.population_key = pc.population_key), pc.signing_year)) as y(signing_year)
  group by y.signing_year
)
select
  a.signing_year,
  a.tracked_players,
  a.audited,
  a.mlb_reached,
  a.verified_no_mlb,
  a.no_mlb_still_active,
  a.unresolved,
  case
    when a.signing_year <= extract(year from current_date)::int - 10 then 'MATURE_10_PLUS_YEARS'
    when a.signing_year <= extract(year from current_date)::int - 5 then 'MATURE_5_TO_9_YEARS'
    else 'DEVELOPING'
  end as maturity_status,
  coalesce(p.population_scopes, array[]::text[]) as population_scopes,
  coalesce(p.any_rate_eligible, false) as organization_rate_allowed,
  (a.unresolved = 0) as all_tracked_audited,
  'TRACKED_COHORT_OUTCOME' as cohort_label,
  case when a.unresolved = 0 and a.tracked_players > 0
    then round(a.mlb_reached::numeric / a.tracked_players, 4) end as tracked_cohort_mlb_share,
  'Share of the players DISI tracks for this class. Not an organization-wide class rate unless organization_rate_allowed is true.' as cohort_caveat
from agg a
left join pops p on p.signing_year = a.signing_year;

do $$
declare v text;
begin
  foreach v in array array['v_player_dossier', 'v_player_sources', 'v_dodgers_outcome_audit_progress',
    'v_dodgers_mature_outcome_queue', 'v_dodgers_outcome_by_signing_class'] loop
    execute format('revoke all on public.%I from anon, authenticated', v);
    execute format('grant select on public.%I to anon, authenticated', v);
  end loop;
end $$;
