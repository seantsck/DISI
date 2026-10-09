-- 10a. Signing ages, one row per signing. Every age names the date it uses:
--   age_at_signing          signings.signing_date (the recorded signing date;
--                           signing_date_basis says whether it equals the
--                           formal MLB transaction date)
--   age_at_announcement     signings.announced_date (club class announcement)
--   age_at_formal_transaction signings.formal_transaction_date (MLB transaction)
-- Agreement, announcement and transaction dates are never substituted for one
-- another; a missing date gives a NULL age.
create or replace view public.v_signing_ages
with (security_invoker = true)
as
select
  s.id as signing_id,
  p.id as player_id,
  p.slug as player_slug,
  p.full_name,
  o.abbreviation as organization,
  o.franchise_key,
  s.signing_year,
  s.country_market,
  s.position_at_signing,
  p.birth_date,
  s.signing_date,
  case
    when s.signing_date is null then null
    when s.formal_transaction_date = s.signing_date then 'SIGNING_DATE_EQUALS_FORMAL_TRANSACTION'
    when s.formal_transaction_date is null then 'SIGNING_DATE_RECORDED'
    else 'SIGNING_DATE_DIFFERS_FROM_FORMAL_TRANSACTION'
  end as signing_date_basis,
  s.announced_date,
  s.formal_transaction_date,
  public.disi_age_decimal(p.birth_date, s.signing_date) as age_at_signing,
  public.disi_age_years(p.birth_date, s.signing_date) as age_years_at_signing,
  public.disi_signing_age_band(public.disi_age_years(p.birth_date, s.signing_date)) as signing_age_band,
  public.disi_age_decimal(p.birth_date, s.announced_date) as age_at_announcement,
  public.disi_age_decimal(p.birth_date, s.formal_transaction_date) as age_at_formal_transaction,
  case when p.birth_date is null then 'NO_BIRTH_DATE'
       when s.signing_date is null then 'NO_SIGNING_DATE'
       else 'COMPUTED' end as signing_age_status
from public.signings s
join public.players p on p.id = s.player_id
join public.organizations o on o.id = s.organization_id;

-- 10b. Player biography and identity. First signing = earliest signing year,
-- then earliest recorded signing date. MLB debut date from the verified outcome,
-- else the structured professional-progress record, else the MLB person record
-- (mlb_debut_date_basis names which).
create or replace view public.v_player_bio
with (security_invoker = true)
as
select
  p.id as player_id,
  p.slug as player_slug,
  p.full_name,
  p.canonical_name,
  coalesce(pa.aliases, array[]::text[]) as aliases,
  p.mlb_id,
  p.bref_id,
  p.fangraphs_id,
  p.birth_date,
  p.birth_city,
  p.birth_state_province,
  p.birth_country,
  p.nationality,
  p.bats,
  p.throws,
  p.height_in,
  p.weight_lb,
  p.primary_position,
  p.current_position,
  fs.signing_id as first_signing_id,
  fs.signing_year as first_signing_year,
  fs.organization as first_signing_organization,
  fs.country_market as first_signing_market,
  fs.position_at_signing,
  fs.signing_date as first_signing_date,
  fs.signing_date_basis,
  fs.announced_date as first_announced_date,
  fs.formal_transaction_date as first_formal_transaction_date,
  fs.age_at_signing,
  fs.age_years_at_signing,
  fs.signing_age_band,
  fs.age_at_announcement,
  fs.age_at_formal_transaction,
  coalesce(oc.mlb_debut_date, pp.mlb_debut_date, p.mlb_debut_date) as mlb_debut_date,
  case when oc.mlb_debut_date is not null then 'OUTCOME_RECORD'
       when pp.mlb_debut_date is not null then 'PROFESSIONAL_PROGRESS'
       when p.mlb_debut_date is not null then 'MLB_PERSON_RECORD' end as mlb_debut_date_basis,
  public.disi_age_decimal(p.birth_date, coalesce(oc.mlb_debut_date, pp.mlb_debut_date, p.mlb_debut_date)) as age_at_mlb_debut,
  coalesce(rm.status, case when p.mlb_id is not null then 'RESOLVED' else 'NOT_RESEARCHED' end) as mlb_id_status,
  coalesce(rb.status, case when p.bref_id is not null then 'RESOLVED' else 'NOT_RESEARCHED' end) as bref_id_status,
  coalesce(rf.status, case when p.fangraphs_id is not null then 'RESOLVED' else 'NOT_RESEARCHED' end) as fangraphs_id_status,
  (select count(*)::int from public.research_source_conflicts c
    where c.player_id = p.id and c.status = 'UNRESOLVED'
      and c.conflict_type in ('IDENTITY','BIRTH_DATE','BIRTH_COUNTRY','HANDEDNESS','NAME_SPELLING')) as open_identity_conflicts,
  array(select distinct c.field_name from public.research_source_conflicts c
        where c.player_id = p.id and c.status = 'UNRESOLVED' and c.field_name is not null
        order by c.field_name) as open_conflict_fields,
  array(select distinct e.field_name from public.evidence e
        where e.entity_type = 'player' and e.entity_id = p.id and e.field_name is not null
        order by e.field_name) as sourced_fields
from public.players p
left join lateral (
  select array_agg(a.alias order by a.alias) as aliases
  from public.player_aliases a
  where a.player_id = p.id and a.alias <> p.full_name
) pa on true
left join lateral (
  select sa.*
  from public.v_signing_ages sa
  where sa.player_id = p.id
  order by sa.signing_year, coalesce(sa.signing_date, sa.formal_transaction_date, sa.announced_date) nulls last, sa.signing_id
  limit 1
) fs on true
left join public.outcomes oc on oc.player_id = p.id
left join public.player_professional_progress pp on pp.player_id = p.id
left join public.player_identity_resolutions rm on rm.player_id = p.id and rm.id_system = 'MLB'
left join public.player_identity_resolutions rb on rb.player_id = p.id and rb.id_system = 'BASEBALL_REFERENCE'
left join public.player_identity_resolutions rf on rf.player_id = p.id and rf.id_system = 'FANGRAPHS';

-- 10c. Player directory (replaces 017): existing columns kept, including the
-- legacy 'countries' array. Appended: birth fields, handedness, signing ages and
-- signing_markets. Birth country (where born) and signing market (where signed)
-- are separate columns and separate filters.
create or replace view public.v_player_directory
with (security_invoker = true)
as
select
  p.id as player_id,
  p.slug as player_slug,
  p.full_name,
  public.disi_ascii_fold(p.full_name) as player_sort_name,
  upper(left(public.disi_ascii_fold(p.full_name), 1)) as name_initial,
  coalesce(pa.aliases, array[]::text[]) as aliases,
  public.disi_ascii_fold(concat_ws(' ', p.full_name, p.canonical_name, array_to_string(pa.aliases, ' '))) as search_text,
  p.birth_country,
  p.nationality,
  p.primary_position,
  sg.first_signing_year,
  sg.latest_signing_year,
  (sg.first_signing_year / 10) * 10 as first_signing_decade,
  coalesce(sg.signing_count, 0) as signing_count,
  coalesce(sg.organizations, array[]::text[]) as organizations,
  coalesce(sg.has_dodgers_signing, false) as has_dodgers_signing,
  sg.first_signing_market,
  array(
    select distinct x
    from unnest(array[p.birth_country] || coalesce(sg.signing_markets, array[]::text[])) as x
    where x is not null
    order by x
  ) as countries,
  case
    when oa.player_id is null then 'NOT_AUDITED'
    when oa.reached_mlb_verified then 'VERIFIED_MLB'
    else 'VERIFIED_NO_MLB'
  end as outcome_audit_status,
  oa.reached_mlb_verified,
  oc.mlb_debut_date,
  debut.abbreviation as mlb_debut_org,
  case when debut.id is null then null else debut.franchise_key = 'DODGERS' end
    as direct_dodgers_franchise_debut,
  w.career_bwar,
  w.bwar_observed_through_season,
  oc.current_status,
  p.bats,
  p.throws,
  p.birth_city,
  p.birth_state_province,
  p.current_position,
  coalesce(sg.signing_markets, array[]::text[]) as signing_markets,
  b.first_signing_date,
  b.signing_date_basis,
  b.age_at_signing,
  b.age_years_at_signing,
  b.signing_age_band,
  b.age_at_mlb_debut,
  p.mlb_id,
  p.bref_id,
  p.canonical_name
from public.players p
left join lateral (
  select array_agg(a.alias order by a.alias) as aliases
  from public.player_aliases a
  where a.player_id = p.id
) pa on true
left join lateral (
  select
    min(s.signing_year) as first_signing_year,
    max(s.signing_year) as latest_signing_year,
    count(*)::int as signing_count,
    array_agg(distinct o.abbreviation) filter (where o.abbreviation is not null) as organizations,
    bool_or(o.franchise_key = 'DODGERS') as has_dodgers_signing,
    array_agg(distinct s.country_market) filter (where s.country_market is not null) as signing_markets,
    (array_agg(s.country_market order by s.signing_year, s.signing_date nulls last)
      filter (where s.country_market is not null))[1] as first_signing_market
  from public.signings s
  join public.organizations o on o.id = s.organization_id
  where s.player_id = p.id
) sg on true
left join public.outcome_audits oa on oa.player_id = p.id
left join public.outcomes oc on oc.player_id = p.id
left join public.organizations debut on debut.id = oc.mlb_debut_organization_id
left join public.v_player_war w on w.player_id = p.id
left join public.v_player_bio b on b.player_id = p.id;


-- 10d. Player dossier (replaces 019): existing columns kept; identity,
-- acquisition dates, ages and identifier statuses appended.
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
  (select count(*)::int from public.outcome_evidence e where e.player_id = p.id) as outcome_evidence_count,
  p.birth_state_province,
  p.current_position,
  b.first_signing_id,
  b.first_signing_year,
  b.first_signing_organization,
  b.first_signing_market,
  b.position_at_signing,
  b.first_signing_date,
  b.signing_date_basis,
  b.first_announced_date,
  b.first_formal_transaction_date,
  b.age_at_signing,
  b.age_at_announcement,
  b.age_at_formal_transaction,
  b.signing_age_band,
  b.mlb_debut_date_basis,
  b.age_at_mlb_debut,
  b.mlb_id_status,
  b.bref_id_status,
  b.fangraphs_id_status,
  b.open_identity_conflicts
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
left join public.player_professional_progress pp on pp.player_id = p.id
left join public.v_player_bio b on b.player_id = p.id;


-- 10e. Filter facets (replaces 017). The legacy 'country' facet (birth country
-- and signing markets combined) is kept for compatibility; new code uses
-- 'birth_country' and 'signing_market', which are never mixed. Rows are split
-- by has_dodgers_signing so Dodgers-scoped pages count Dodgers signees only;
-- summing both rows gives the all-player count.
create or replace view public.v_player_filter_options
with (security_invoker = true)
as
select facet, value, count(*)::int as row_count, has_dodgers_signing
from (
  select 'country' as facet, unnest(countries) as value, has_dodgers_signing from public.v_player_directory
  union all select 'primary_position', primary_position, has_dodgers_signing from public.v_player_directory
  union all select 'first_signing_decade', first_signing_decade::text, has_dodgers_signing from public.v_player_directory
  union all select 'name_initial', name_initial, has_dodgers_signing from public.v_player_directory
  union all select 'outcome_audit_status', outcome_audit_status, has_dodgers_signing from public.v_player_directory
  union all select 'birth_country', birth_country, has_dodgers_signing from public.v_player_directory
  union all select 'signing_market', unnest(signing_markets), has_dodgers_signing from public.v_player_directory
  union all select 'bats', bats, has_dodgers_signing from public.v_player_directory
  union all select 'throws', throws, has_dodgers_signing from public.v_player_directory
  union all select 'signing_age_band', signing_age_band, has_dodgers_signing from public.v_player_directory
) f
where value is not null
group by facet, value, has_dodgers_signing;

-- 10f. Identity research scope per player. Research priority: MLB players,
-- then audited mature signings, then other mature signings (5+ years), then
-- recent Dodgers prospects, then other organizations' signees.
create or replace view public.v_player_identity_scope
with (security_invoker = true)
as
select
  b.*,
  d.player_id is not null as has_dodgers_signing,
  d.first_dodgers_signing_year,
  (oa.player_id is not null) as outcome_audited,
  coalesce(oa.reached_mlb_verified, false) or b.mlb_debut_date is not null as reached_mlb,
  case
    when d.player_id is null then 'OTHER_ORGANIZATION'
    when coalesce(oa.reached_mlb_verified, false) or b.mlb_debut_date is not null then 'DODGERS_MLB_PLAYER'
    when d.first_dodgers_signing_year <= extract(year from current_date)::int - 5 and oa.player_id is not null
      then 'DODGERS_AUDITED_MATURE'
    when d.first_dodgers_signing_year <= extract(year from current_date)::int - 5 then 'DODGERS_OTHER_MATURE'
    else 'DODGERS_RECENT_PROSPECT'
  end as identity_scope,
  case
    when d.player_id is null then 5
    when coalesce(oa.reached_mlb_verified, false) or b.mlb_debut_date is not null then 1
    when d.first_dodgers_signing_year <= extract(year from current_date)::int - 5 and oa.player_id is not null then 2
    when d.first_dodgers_signing_year <= extract(year from current_date)::int - 5 then 3
    else 4
  end as research_priority
from public.v_player_bio b
left join lateral (
  select s.player_id, min(s.signing_year) as first_dodgers_signing_year
  from public.signings s
  join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
  where s.player_id = b.player_id
  group by s.player_id
) d on true
left join public.outcome_audits oa on oa.player_id = b.player_id;

-- 10g. Identity coverage by scope. Counts what is known; nothing is imputed.
create or replace view public.v_dodgers_player_identity_coverage
with (security_invoker = true)
as
with scoped as (
  select 'ALL_TRACKED_PLAYERS' as scope, 0 as scope_order, s.* from public.v_player_identity_scope s
  union all
  select 'DODGERS_SIGNEES', 1, s.* from public.v_player_identity_scope s where s.has_dodgers_signing
  union all
  select s.identity_scope, s.research_priority + 1, s.* from public.v_player_identity_scope s
)
select
  scope,
  count(*)::int as players,
  count(*) filter (where mlb_id is not null)::int as with_mlb_id,
  count(*) filter (where reached_mlb)::int as mlb_players,
  count(*) filter (where reached_mlb and bref_id is not null)::int as mlb_players_with_bref_id,
  count(*) filter (where bref_id is not null)::int as with_bref_id,
  count(*) filter (where fangraphs_id is not null)::int as with_fangraphs_id,
  count(*) filter (where birth_date is not null)::int as with_birth_date,
  count(*) filter (where birth_city is not null and birth_country is not null)::int as with_birthplace,
  count(*) filter (where birth_state_province is not null)::int as with_birth_state_province,
  count(*) filter (where birth_country is not null)::int as with_birth_country,
  count(*) filter (where nationality is not null)::int as with_nationality,
  count(*) filter (where bats is not null)::int as with_bats,
  count(*) filter (where throws is not null)::int as with_throws,
  count(*) filter (where height_in is not null)::int as with_height,
  count(*) filter (where weight_lb is not null)::int as with_weight,
  count(*) filter (where position_at_signing is not null)::int as with_position_at_signing,
  count(*) filter (where age_at_signing is not null)::int as signing_age_computable,
  count(*) filter (where age_at_mlb_debut is not null)::int as debut_age_computable,
  count(*) filter (where cardinality(aliases) > 0)::int as with_aliases,
  count(*) filter (where open_identity_conflicts > 0)::int as with_open_identity_conflicts,
  -- Present = non-null. Resolved = present, backed by an evidence row for that
  -- field, and no open source conflict on it. Conflicted = an open conflict
  -- exists. Unsourced = present with neither evidence nor conflict (e.g. a
  -- legacy value never tied to a source).
  count(*) filter (where mlb_id is not null and 'mlb_id' = any(sourced_fields) and not 'mlb_id' = any(open_conflict_fields))::int as mlb_id_resolved,
  count(*) filter (where 'mlb_id' = any(open_conflict_fields))::int as mlb_id_conflicted,
  count(*) filter (where mlb_id is not null and not 'mlb_id' = any(sourced_fields) and not 'mlb_id' = any(open_conflict_fields))::int as mlb_id_unsourced,
  count(*) filter (where bref_id is not null and 'bref_id' = any(sourced_fields) and not 'bref_id' = any(open_conflict_fields))::int as bref_id_resolved,
  count(*) filter (where 'bref_id' = any(open_conflict_fields))::int as bref_id_conflicted,
  count(*) filter (where bref_id is not null and not 'bref_id' = any(sourced_fields) and not 'bref_id' = any(open_conflict_fields))::int as bref_id_unsourced,
  count(*) filter (where birth_date is not null and 'birth_date' = any(sourced_fields) and not 'birth_date' = any(open_conflict_fields))::int as birth_date_resolved,
  count(*) filter (where 'birth_date' = any(open_conflict_fields))::int as birth_date_conflicted,
  count(*) filter (where birth_date is not null and not 'birth_date' = any(sourced_fields) and not 'birth_date' = any(open_conflict_fields))::int as birth_date_unsourced,
  count(*) filter (where birth_country is not null and 'birth_country' = any(sourced_fields) and not 'birth_country' = any(open_conflict_fields))::int as birth_country_resolved,
  count(*) filter (where 'birth_country' = any(open_conflict_fields))::int as birth_country_conflicted,
  count(*) filter (where birth_country is not null and not 'birth_country' = any(sourced_fields) and not 'birth_country' = any(open_conflict_fields))::int as birth_country_unsourced,
  count(*) filter (where bats is not null and 'bats' = any(sourced_fields) and not 'bats' = any(open_conflict_fields))::int as bats_resolved,
  count(*) filter (where 'bats' = any(open_conflict_fields))::int as bats_conflicted,
  count(*) filter (where bats is not null and not 'bats' = any(sourced_fields) and not 'bats' = any(open_conflict_fields))::int as bats_unsourced,
  count(*) filter (where throws is not null and 'throws' = any(sourced_fields) and not 'throws' = any(open_conflict_fields))::int as throws_resolved,
  count(*) filter (where 'throws' = any(open_conflict_fields))::int as throws_conflicted,
  count(*) filter (where throws is not null and not 'throws' = any(sourced_fields) and not 'throws' = any(open_conflict_fields))::int as throws_unsourced,
  round(100.0 * count(*) filter (where mlb_id is not null) / nullif(count(*), 0), 1) as mlb_id_pct,
  round(100.0 * count(*) filter (where birth_date is not null) / nullif(count(*), 0), 1) as birth_date_pct,
  round(100.0 * count(*) filter (where reached_mlb and bref_id is not null)
        / nullif(count(*) filter (where reached_mlb), 0), 1) as mlb_player_bref_pct
from scoped
group by scope, scope_order
order by min(scope_order), scope;

-- 10h. Identity research queue: one row per open identity issue, prioritized.
create or replace view public.v_dodgers_player_identity_research_queue
with (security_invoker = true)
as
with issues as (
  select s.player_id, 'MLB_ID_UNRESOLVED' as issue,
         coalesce(r.note, 'No MLB id resolved.') as detail
  from public.v_player_identity_scope s
  left join public.player_identity_resolutions r on r.player_id = s.player_id and r.id_system = 'MLB'
  where s.mlb_id is null
  union all
  select s.player_id, 'BREF_ID_UNRESOLVED',
         coalesce(r.status || ': ' || r.note, r.status, 'MLB player without a Baseball-Reference id.')
  from public.v_player_identity_scope s
  left join public.player_identity_resolutions r on r.player_id = s.player_id and r.id_system = 'BASEBALL_REFERENCE'
  where s.bref_id is null and (s.reached_mlb or r.status in ('AMBIGUOUS','NEEDS_REVIEW','CONFLICT'))
  union all
  select r.player_id, 'IDENTITY_' || r.status, concat_ws(' ', r.id_system, r.note)
  from public.player_identity_resolutions r
  where r.status in ('AMBIGUOUS','NEEDS_REVIEW','CONFLICT') and r.id_system <> 'BASEBALL_REFERENCE'
  union all
  select s.player_id, 'BIRTH_DATE_MISSING', 'No source-backed birth date.'
  from public.v_player_identity_scope s where s.birth_date is null
  union all
  select s.player_id, 'HANDEDNESS_MISSING', 'Bats and/or throws unknown.'
  from public.v_player_identity_scope s where s.bats is null or s.throws is null
  union all
  select s.player_id, 'BIRTHPLACE_MISSING', 'Birth city and/or birth country unknown.'
  from public.v_player_identity_scope s
  where s.mlb_id is not null and (s.birth_city is null or s.birth_country is null)
  union all
  select s.player_id, upper(f.field) || '_UNSOURCED',
         f.field || ' = ' || f.value || ' has no supporting evidence (legacy value); verify against a birth / player record.'
  from public.v_player_identity_scope s
  cross join lateral (values ('birth_date', s.birth_date::text), ('birth_country', s.birth_country),
                             ('bats', s.bats), ('throws', s.throws)) f(field, value)
  where f.value is not null and not f.field = any(s.sourced_fields) and not f.field = any(s.open_conflict_fields)
  union all
  select c.player_id, 'OPEN_CONFLICT_' || c.conflict_type,
         c.field_name || ': ' || coalesce(c.value_a, '?') || ' vs ' || coalesce(c.value_b, '?')
  from public.research_source_conflicts c
  where c.status = 'UNRESOLVED' and c.player_id is not null
    and c.conflict_type in ('IDENTITY','BIRTH_DATE','BIRTH_COUNTRY','HANDEDNESS')
)
select
  s.player_id,
  s.player_slug,
  s.full_name,
  s.identity_scope,
  s.research_priority,
  s.first_signing_year,
  s.first_signing_organization,
  s.mlb_id,
  i.issue,
  i.detail
from issues i
join public.v_player_identity_scope s on s.player_id = i.player_id
order by s.research_priority, s.first_signing_year nulls last, s.player_slug, i.issue;

-- 10i. Database status (replaces 018): existing columns kept; Dodgers signees
-- and other-club benchmark players appended so Dodgers-facing pages never
-- present the whole player table as Dodgers signings.
create or replace view public.v_database_status
with (security_invoker = true)
as
with d as (
  select * from public.v_signing_records where is_dodgers_franchise
),
c as (
  select * from public.v_class_research_coverage where franchise_key = 'DODGERS'
),
pc as (
  select * from public.v_dodgers_signing_population_coverage
)
select
  (select count(*) from d)::int as tracked_signings,
  (select min(signing_year) from d) as earliest_signing_year,
  (select max(signing_year) from d) as latest_signing_year,
  (select count(distinct signing_year) from d)::int as years_represented,
  (select count(distinct country_market) from d where country_market is not null)::int as markets_represented,
  (select count(*) from d where country_market is null)::int as signings_with_unknown_market,
  (select count(*) from c where expected_class_size is not null)::int as classes_with_known_population,
  (select count(*) from c where class_status = 'COMPLETE')::int as complete_classes,
  (select count(*) from d where outcome_audited)::int as outcome_audits_completed,
  (select count(*) from d where outcome_audit_status = 'VERIFIED_MLB')::int as verified_mlb_outcomes,
  (select count(*) from d where outcome_audit_status = 'VERIFIED_NO_MLB')::int as verified_no_mlb_outcomes,
  (select count(*) from d where not outcome_audited)::int as outcome_audit_queue,
  (select round(sum(total_known_acquisition_cost_usd)::numeric, 2) from d) as known_acquisition_cost_usd,
  (select count(*) from d where total_known_acquisition_cost_usd is not null)::int as signings_with_known_cost,
  (select count(*) from d where career_bwar is not null)::int as signings_with_bwar,
  (select coalesce(sum(missing_from_expected), 0) from c)::int as class_members_missing,
  (select count(*) from public.v_research_tasks where franchise_key = 'DODGERS')::int as open_research_tasks,
  (select count(*) from public.players)::int as total_players,
  (select count(*) from public.v_signing_records where not is_dodgers_franchise)::int as league_signing_records,
  (select count(*) from pc where population_scope = 'OPENING_CLASS' and population_complete)::int as opening_classes_complete,
  (select count(*) from pc where population_scope = 'OPENING_CLASS' and expected_population is not null)::int as opening_classes_with_known_size,
  (select count(*) from pc where population_scope = 'FULL_SIGNING_PERIOD' and expected_population is not null)::int as full_periods_with_known_size,
  (select count(*) from pc where population_scope = 'FULL_SIGNING_PERIOD' and population_complete)::int as full_periods_complete,
  (select count(*) from pc where rate_eligible)::int as rate_eligible_populations,
  (select count(*) from public.players p where exists (
     select 1 from public.signings s join public.organizations o on o.id = s.organization_id
     where s.player_id = p.id and o.franchise_key = 'DODGERS'))::int as dodgers_players,
  (select count(*) from public.players p where not exists (
     select 1 from public.signings s join public.organizations o on o.id = s.organization_id
     where s.player_id = p.id and o.franchise_key = 'DODGERS'))::int as league_benchmark_players;

do $$
declare v text;
begin
  foreach v in array array['v_signing_ages', 'v_player_bio', 'v_player_directory', 'v_player_filter_options',
    'v_player_dossier', 'v_player_identity_scope', 'v_dodgers_player_identity_coverage',
    'v_dodgers_player_identity_research_queue', 'v_database_status'] loop
    execute format('revoke all on public.%I from anon, authenticated', v);
    execute format('grant select on public.%I to anon, authenticated', v);
  end loop;
end $$;
