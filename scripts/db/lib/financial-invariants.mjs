// Read-only structural checks for financial acquisition intelligence (Migration 030).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0) of a structural or integrity rule.
// None pins research coverage: how many reports, sourced bonuses or treatments exist may grow, so
// counts such as "14 external reports" are seed facts tested elsewhere, never hard invariants.
// Nothing here writes.

const CHARGE_FREE = `('EXEMPT', 'NOT_SUBJECT', 'NOT_APPLICABLE')`
const PRE_POOL = (s) => `(${s}.signing_date < date '2012-07-02' or (${s}.signing_date is null and ${s}.signing_year <= 2011))`

/**
 * Column / ledger reconciliation (the rule documented in Migration 030): over the ACTIVE reports of
 * one parent x component, points are the distinct EXACT / RULE_DERIVED / legacy values, candidates
 * are the points or else the distinct ROUNDED values; one candidate inside every ROUNDED interval is
 * AGREED, more than one (or one outside an interval) is a CONFLICT. A non-null column must equal the
 * AGREED value; a NULL column must not have one (it may sit under a CONFLICT or approximate-only reports).
 */
const reconciliation = ({ parent, ledger, ledgerKey, typeCol, valueExpr, filter = '', columns, resolutions = false }) => `with cols as (
    select p.id as parent_id, v.kind, v.col from ${parent} p
    cross join lateral (values ${columns.map(([kind, col]) => `('${kind}', p.${col}::numeric)`).join(', ')}) v(kind, col)
  ),
  r as (
    select l.${ledgerKey} as parent_id, l.${typeCol} as kind, ${valueExpr} as value, l.amount_basis, l.amount_precision
    from ${ledger} l where l.record_status = 'ACTIVE' ${filter}
  ),
  s as (
    select c.parent_id, c.kind, c.col,
      (select count(distinct r.value) from r where r.parent_id = c.parent_id and r.kind = c.kind and (r.amount_basis is null or r.amount_basis in ('EXACT', 'RULE_DERIVED'))) as n_points,
      (select min(r.value) from r where r.parent_id = c.parent_id and r.kind = c.kind and (r.amount_basis is null or r.amount_basis in ('EXACT', 'RULE_DERIVED'))) as point,
      (select count(distinct r.value) from r where r.parent_id = c.parent_id and r.kind = c.kind and r.amount_basis = 'ROUNDED') as n_rounded,
      (select min(r.value) from r where r.parent_id = c.parent_id and r.kind = c.kind and r.amount_basis = 'ROUNDED') as rounded
    from cols c
  ),
  t as (select s.*, case when s.n_points > 0 then s.n_points else s.n_rounded end as n_cand, case when s.n_points > 0 then s.point else s.rounded end as cand from s),
  ${resolutions ? `d as (
    select d.signing_id as parent_id, d.component_type as kind, rep.amount as selected_amount
    from public.signing_financial_resolutions d join public.signing_financial_reports rep on rep.id = d.selected_report_id
    where d.record_status = 'ACTIVE' and rep.record_status = 'ACTIVE' and rep.currency_code = 'USD'
  ),` : ''}
  u as (
    select t.*, ${resolutions ? 'd.selected_amount, ' : ''}case ${resolutions ? "when d.selected_amount is not null then 'RESOLVED' " : ''}when t.n_cand = 0 then 'NONE' when t.n_cand > 1 then 'CONFLICT'
      when exists (select 1 from r where r.parent_id = t.parent_id and r.kind = t.kind and r.amount_basis = 'ROUNDED' and abs(r.value - t.cand) > r.amount_precision / 2) then 'CONFLICT'
      else 'AGREED' end as status
    from t${resolutions ? ' left join d on d.parent_id = t.parent_id and d.kind = t.kind' : ''}
  )
  select count(*)::int as n from u
  where (u.col is not null and (u.status not in ('AGREED', 'RESOLVED') or (u.status = 'AGREED' and u.cand <> u.col)${resolutions ? " or (u.status = 'RESOLVED' and u.selected_amount <> u.col)" : ''}))
     or (u.col is null and u.status in ('AGREED', 'RESOLVED'))`

const originRule = (r) => `not coalesce(case ${r}.report_origin
      when 'EXTERNAL_SOURCE' then ${r}.source_id is not null and ${r}.retrieved_at is not null and ${r}.amount_basis is not null
        and ${r}.evidence_basis not in ('LEGACY_CANONICAL_VALUE', 'RULE_APPLICATION')
      when 'LEGACY_CARRYFORWARD' then ${r}.source_id is null and ${r}.amount_basis is null and ${r}.evidence_basis = 'LEGACY_CANONICAL_VALUE'
      when 'RULE_DERIVED' then ${r}.source_id is not null and ${r}.retrieved_at is not null and ${r}.amount_basis = 'RULE_DERIVED' and ${r}.evidence_basis = 'RULE_APPLICATION'
    end, false)`

const lifecycle = (table, parentCol, typeCol) => `select count(*) from public.${table} r
    where (r.record_status = 'RETRACTED' and (r.retracted_at is null or nullif(btrim(r.retraction_reason), '') is null))
       or (r.record_status = 'ACTIVE' and (r.retracted_at is not null or r.retraction_reason is not null))
       or r.record_status not in ('ACTIVE', 'RETRACTED')
       or (r.supersedes_report_id is not null and (r.supersedes_report_id = r.id or not exists (select 1 from public.${table} o
            where o.id = r.supersedes_report_id and o.${parentCol} = r.${parentCol} and o.${typeCol} = r.${typeCol} and o.record_status = 'RETRACTED')))
       or (r.supersedes_report_id is not null and exists (select 1 from public.${table} x where x.supersedes_report_id = r.supersedes_report_id and x.id <> r.id))`

/**
 * name -> SQL returning one row { n } = number of violations. `resolutions` says whether the Migration 031
 * resolution table exists (the same checks run on a canonical 030 database, where there is none).
 */
export const financialQueries = (resolutions) => ({
  // origin semantics: EXTERNAL needs a source, LEGACY never has one, RULE_DERIVED cites its rule; no orphans
  financial_signing_report_provenance_violations: `select count(*)::int as n from public.signing_financial_reports r
    where not exists (select 1 from public.signings s where s.id = r.signing_id)
       or (r.source_id is not null and not exists (select 1 from public.sources so where so.id = r.source_id))
       or ${originRule('r')}`,

  // vocabulary, currency shape, basis / precision / derivation consistency (the derivation reproduces the amount)
  financial_signing_report_shape_violations: `select count(*)::int as n from public.signing_financial_reports r
    where r.component_type not in ('SIGNING_BONUS', 'POSTING_FEE', 'TRANSFER_FEE', 'RELEASE_FEE', 'POOL_CHARGE', 'OTHER_ACQUISITION_FEE')
       or r.currency_code !~ '^[A-Z]{3}$' or r.amount < 0
       or (r.amount_basis is not null and r.amount_basis not in ('EXACT', 'ROUNDED', 'APPROXIMATE', 'RULE_DERIVED'))
       or coalesce(r.amount_basis = 'ROUNDED', false) <> (r.amount_precision is not null) or r.amount_precision <= 0
       or (r.amount_basis = 'RULE_DERIVED' and (r.derivation_rate is null or r.derivation_base_amount is null or nullif(btrim(r.derivation_rule), '') is null
            or r.amount <> round(r.derivation_base_amount * r.derivation_rate, 2)))
       or (r.amount_basis is distinct from 'RULE_DERIVED' and (r.derivation_rate is not null or r.derivation_base_amount is not null or r.derivation_rule is not null))`,

  // environment facts: typed values (a rate metric carries a rate, every other metric money), provenance, shape, no orphans
  financial_environment_report_violations: `select count(*)::int as n from public.signing_environment_financial_reports r
    where not exists (select 1 from public.signing_environments e where e.id = r.signing_environment_id)
       or (r.source_id is not null and not exists (select 1 from public.sources so where so.id = r.source_id))
       or r.metric_type not in ('BASE_POOL', 'POOL_AFTER_TRADES', 'POOL_SPACE_ACQUIRED', 'POOL_SPACE_SENT', 'PENALTY_REDUCTION', 'REPORTED_PERIOD_SPEND',
         'OVERAGE_TAX_RATE', 'OVERAGE_TAX_PAID', 'INDIVIDUAL_BONUS_CAP')
       or not coalesce(case when r.metric_type = 'OVERAGE_TAX_RATE' then r.rate_value is not null and r.amount_usd is null
                            else r.amount_usd is not null and r.rate_value is null end, false)
       or r.amount_usd < 0 or r.rate_value < 0
       or coalesce(r.amount_basis = 'ROUNDED', false) <> (r.amount_precision is not null)
       or coalesce(r.amount_basis = 'RULE_DERIVED', false) <> (nullif(btrim(r.derivation_note), '') is not null)
       or ${originRule('r')}`,

  // lifecycle and supersession on both ledgers: retraction recorded, predecessor of the same parent / type and retired, one replacement
  financial_supersession_violations: `select ((${lifecycle('signing_financial_reports', 'signing_id', 'component_type')})
    + (${lifecycle('signing_environment_financial_reports', 'signing_environment_id', 'metric_type')}))::int as n`,

  // sealing: one guard trigger per ledger covering INSERT, UPDATE and DELETE
  financial_guard_trigger_violations: `select (2 - count(*))::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgenabled <> 'D' and (t.tgtype & 28) = 28
      and c.relname in ('signing_financial_reports', 'signing_environment_financial_reports')
      and t.tgname in ('signing_financial_reports_guard', 'signing_environment_financial_reports_guard')`,

  // the guard functions are invoker-rights, have an empty search_path and no API EXECUTE
  financial_function_violations: `select ((2 - count(*)) + count(*) filter (where p.prosecdef or not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
      or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute')))::int as n
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('disi_signing_financial_report_guard', 'disi_environment_financial_report_guard')`,

  // the signings money columns are the compatibility layer over the ledger (USD reports only)
  financial_column_ledger_mismatches: reconciliation({
    parent: 'public.signings', ledger: 'public.signing_financial_reports', ledgerKey: 'signing_id', typeCol: 'component_type', valueExpr: 'l.amount',
    filter: `and l.currency_code = 'USD'`,
    columns: [['SIGNING_BONUS', 'signing_bonus_usd'], ['POSTING_FEE', 'posting_fee_usd'], ['TRANSFER_FEE', 'transfer_fee_usd']],
    resolutions,
  }),

  // the signing-environment pool columns are the compatibility layer over the environment ledger
  financial_environment_column_mismatches: reconciliation({
    parent: 'public.signing_environments', ledger: 'public.signing_environment_financial_reports', ledgerKey: 'signing_environment_id', typeCol: 'metric_type',
    valueExpr: 'coalesce(l.amount_usd, l.rate_value)',
    columns: [['BASE_POOL', 'club_bonus_pool_usd'], ['POOL_AFTER_TRADES', 'pool_after_trades_usd'], ['INDIVIDUAL_BONUS_CAP', 'max_individual_bonus_usd'], ['OVERAGE_TAX_RATE', 'overage_tax_rate']],
  }),

  // treatment vocabulary and provenance; the only rule is the pre-pool rule; nothing before the pools is SUBJECT
  financial_pool_treatment_violations: `select count(*)::int as n from public.signings s
    where s.international_pool_treatment not in ('SUBJECT', 'EXEMPT', 'NOT_SUBJECT', 'NOT_APPLICABLE', 'UNKNOWN')
       or (s.international_pool_treatment = 'UNKNOWN') <> (s.international_pool_treatment_basis is null)
       or (s.international_pool_treatment = 'UNKNOWN') <> (s.international_pool_treatment_source_id is null)
       or (s.international_pool_treatment_source_id is not null and not exists (select 1 from public.sources so where so.id = s.international_pool_treatment_source_id))
       or s.international_pool_treatment_basis not in ('SOURCE_STATEMENT', 'RULE')
       or (s.international_pool_treatment_basis = 'RULE' and not (s.international_pool_treatment = 'NOT_APPLICABLE' and ${PRE_POOL('s')}))
       or (s.international_pool_treatment = 'SUBJECT' and ${PRE_POOL('s')})`,

  // a pool charge is a sourced ledger fact: never on a signing the pool did not apply to, never a legacy carry-forward
  financial_pool_charge_violations: `select count(*)::int as n from public.signing_financial_reports r join public.signings s on s.id = r.signing_id
    where r.component_type = 'POOL_CHARGE' and r.record_status = 'ACTIVE'
      and (s.international_pool_treatment in ${CHARGE_FREE} or r.report_origin = 'LEGACY_CARRYFORWARD')`,

  // every pathway has exactly one rule per acquisition component; POOL_CHARGE is not a cost component
  financial_component_rule_violations: `select (
      (select count(*) from (select unnest(enum_range(null::public.acquisition_pathway)) as pw) p
        cross join (values ('SIGNING_BONUS'), ('POSTING_FEE'), ('TRANSFER_FEE'), ('RELEASE_FEE'), ('OTHER_ACQUISITION_FEE')) c(component_type)
        where not exists (select 1 from public.acquisition_cost_component_rules ru where ru.pathway = p.pw and ru.component_type = c.component_type))
    + (select count(*) from public.acquisition_cost_component_rules ru
        where ru.component_type not in ('SIGNING_BONUS', 'POSTING_FEE', 'TRANSFER_FEE', 'RELEASE_FEE', 'OTHER_ACQUISITION_FEE')
           or ru.applicability not in ('REQUIRED', 'POSSIBLE', 'CONDITIONAL', 'NOT_APPLICABLE', 'NO_RULE') or nullif(btrim(ru.explanation), '') is null
           or (ru.source_id is not null and not exists (select 1 from public.sources so where so.id = ru.source_id)))
    )::int as n`,

  // the analytics never turn unknown into zero, never call a legacy value sourced, never call a gap complete
  financial_view_semantics_violations: `select count(*)::int as n from public.v_signing_acquisition_financials f join public.signings s on s.id = f.signing_id
    where (f.known_acquisition_cost_usd is not null) <> (cardinality(f.known_components) > 0)
       or (f.acquisition_cost_completeness = 'COMPLETE' and (cardinality(f.required_components_unresolved) > 0 or cardinality(f.possible_components_unknown) > 0))
       or (f.acquisition_cost_completeness = 'UNKNOWN' and cardinality(f.known_components) > 0)
       or f.signing_bonus_usd is distinct from s.signing_bonus_usd or f.posting_fee_usd is distinct from s.posting_fee_usd or f.transfer_fee_usd is distinct from s.transfer_fee_usd
       or (f.bonus_status = 'KNOWN') <> (s.signing_bonus_usd is not null)
       or (f.bonus_source_status = 'EXTERNALLY_SOURCED' and not exists (select 1 from public.signing_financial_reports r
            where r.signing_id = s.id and r.component_type = 'SIGNING_BONUS' and r.record_status = 'ACTIVE' and r.report_origin = 'EXTERNAL_SOURCE'))
       or (f.bonus_source_status = 'LEGACY_CANONICAL_ONLY' and exists (select 1 from public.signing_financial_reports r
            where r.signing_id = s.id and r.component_type = 'SIGNING_BONUS' and r.record_status = 'ACTIVE' and r.report_origin = 'EXTERNAL_SOURCE'))
       or f.international_pool_treatment is distinct from s.international_pool_treatment`,

  // Migration 031 reviewed resolutions: shape and lifecycle (0 when the table does not exist)
  financial_resolution_shape_violations: resolutions ? `select count(*)::int as n from public.signing_financial_resolutions d
    where d.component_type not in ('SIGNING_BONUS', 'POSTING_FEE', 'TRANSFER_FEE', 'RELEASE_FEE', 'POOL_CHARGE', 'OTHER_ACQUISITION_FEE')
       or d.basis not in ('AUTHORITATIVE_RULE', 'SOURCE_PRECEDENCE', 'OTHER_REVIEWED') or (d.basis = 'AUTHORITATIVE_RULE' and d.source_id is null)
       or (d.source_id is not null and not exists (select 1 from public.sources so where so.id = d.source_id))
       or nullif(btrim(d.rationale), '') is null or nullif(btrim(d.reviewed_by), '') is null
       or not exists (select 1 from public.signing_financial_reports r where r.id = d.selected_report_id and r.signing_id = d.signing_id and r.component_type = d.component_type)
       or (d.record_status = 'RETRACTED' and (d.retracted_at is null or nullif(btrim(d.retraction_reason), '') is null))
       or (d.record_status = 'ACTIVE' and (d.retracted_at is not null or d.retraction_reason is not null))
       or (d.supersedes_resolution_id is not null and (d.supersedes_resolution_id = d.id or not exists (select 1 from public.signing_financial_resolutions o
            where o.id = d.supersedes_resolution_id and o.signing_id = d.signing_id and o.component_type = d.component_type and o.record_status = 'RETRACTED')))
       or exists (select 1 from public.signing_financial_resolutions x where x.supersedes_resolution_id = d.supersedes_resolution_id and x.id <> d.id and d.supersedes_resolution_id is not null)
       or (d.record_status = 'ACTIVE' and exists (select 1 from public.signing_financial_resolutions x where x.signing_id = d.signing_id and x.component_type = d.component_type
            and x.record_status = 'ACTIVE' and x.id <> d.id))` : 'select 0::int as n',

  // an ACTIVE decision selects an ACTIVE, non-approximate USD report and still has competing evidence;
  // the guard trigger exists and covers INSERT, UPDATE and DELETE; the guard function is invoker-rights with no API EXECUTE
  financial_resolution_selection_violations: resolutions ? `select (
      (select count(*) from public.signing_financial_resolutions d where d.record_status = 'ACTIVE'
        and (not exists (select 1 from public.signing_financial_reports r where r.id = d.selected_report_id and r.record_status = 'ACTIVE' and r.currency_code = 'USD' and r.amount_basis is distinct from 'APPROXIMATE')
          or (select count(distinct r.amount) from public.signing_financial_reports r where r.signing_id = d.signing_id and r.component_type = d.component_type and r.record_status = 'ACTIVE'
                and r.currency_code = 'USD' and r.amount_basis is distinct from 'APPROXIMATE') < 2))
    + (select 1 - count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relnamespace = 'public'::regnamespace and c.relname = 'signing_financial_resolutions' and not t.tgisinternal and t.tgenabled <> 'D' and (t.tgtype & 28) = 28
          and t.tgname = 'signing_financial_resolutions_guard')
    + (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'disi_signing_financial_resolution_guard'
        and (p.prosecdef or not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
             or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute')))
    )::int as n` : 'select 0::int as n',
})

export const FINANCIAL_QUERIES = financialQueries(true)
export const FINANCIAL_CHECK_NAMES = Object.keys(FINANCIAL_QUERIES)
