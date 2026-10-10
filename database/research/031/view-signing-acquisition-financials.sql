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
