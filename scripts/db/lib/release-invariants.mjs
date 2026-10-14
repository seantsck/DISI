// Read-only checks for DISI v1 final integration (Migration 045).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0): the product contract names only existing, secured relations of the
// declared kind; the release status is one row whose support counts equal the layers they summarize; the whole support chain holds
// (no layer supports more than the layer below it allows); every executive metric's denominator column exists in the overview; and
// the research roadmap is complete. `loaded` says whether the 045 objects exist.

export const RELEASE_CHECK_NAMES = [
  'product_contract_violations', 'release_status_violations', 'support_chain_violations', 'executive_metric_provenance_violations',
  'research_roadmap_violations',
]

/** name -> SQL returning one row { n } = number of violations. */
export const releaseQueries = (loaded) => {
  if (!loaded) return Object.fromEntries(RELEASE_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  return {
    // every contract relation exists, has the declared kind, is secured (view: security_invoker; table: RLS) and is readable by anon
    product_contract_violations: `select count(*)::int as n from public.disi_product_contract p
      left join pg_class c on c.relname = p.relation_name and c.relnamespace = 'public'::regnamespace
      where c.oid is null
         or (p.relation_kind = 'VIEW') <> (c.relkind = 'v')
         or (c.relkind = 'v' and coalesce(array_to_string(c.reloptions, ','), '') !~ 'security_invoker=(true|on)')
         or (c.relkind = 'r' and not c.relrowsecurity)
         or not has_table_privilege('anon', c.oid, 'SELECT')`,

    // one row; the versions are recorded; the support counts equal the layers they summarize
    release_status_violations: `with s as materialized (select * from public.v_disi_release_status)
      select (
        abs((select count(*) from s) - 1)
      + (select count(*) from s where s.product_version is null or s.probability_model_version is null or s.value_model_version is null
          or s.analysis_as_of_date is distinct from (select max(audited_through_date) from public.outcome_audits)
          or s.supported_probability_targets <> (select count(distinct target_key) from public.v_outcome_target_support where baseline_supported)
          or s.supported_expected_value_models <> (select count(*) from public.v_expected_value_support where expected_value_supported)
          or s.predictive_portfolio_recommendations <> (select count(*) from public.v_portfolio_candidate_readiness where optimization_eligible)
          or s.product_contract_relations <> (select count(*) from public.disi_product_contract))
      )::int as n`,

    // 041 -> 042 -> 043 -> 044: no layer supports anything its upstream does not
    support_chain_violations: `with s as materialized (select * from public.v_disi_release_status)
      select (
        (select count(*) from s where (s.supported_probability_targets = 0 and s.supported_expected_value_models > 0)
          or (s.supported_expected_value_models = 0 and s.predictive_portfolio_recommendations > 0)
          or (s.support_chain_state = 'NO_PREDICTIVE_LAYER_SUPPORTED') <> (s.supported_probability_targets = 0))
      + (select count(*) from public.v_player_outcome_probability p
          where p.probability is not null and not exists (select 1 from public.v_outcome_target_support t
            where t.target_key = p.target_key and t.reference_population = p.training_population and t.baseline_supported))
      + (select count(*) from public.v_player_expected_organizational_value e
          where e.expected_org_value_bwar is not null and not exists (select 1 from public.v_player_outcome_probability p
            where p.signing_id = e.signing_id and p.target_key = e.probability_target_key and p.probability is not null))
      + (select count(*) from public.v_portfolio_candidate_readiness r
          where r.optimization_eligible and not exists (select 1 from public.v_player_expected_organizational_value e
            where e.signing_id = r.signing_id and e.expected_org_value_bwar is not null))
      )::int as n`,

    // every executive metric names an overview column for itself and for its denominator
    executive_metric_provenance_violations: `select count(*)::int as n from public.v_executive_metric_provenance m
      where not exists (select 1 from pg_attribute a where a.attrelid = 'public.v_executive_overview'::regclass and a.attname = m.metric_key and a.attnum > 0)
         or not exists (select 1 from pg_attribute a where a.attrelid = 'public.v_executive_overview'::regclass and a.attname = m.denominator_column and a.attnum > 0)
         or m.metric_kind not in ('FACT', 'SUPPORT_STATE', 'COVERAGE') or btrim(m.provenance) = '' or btrim(m.eligibility_rule) = ''`,

    // the roadmap lists each gap area once, in a strict priority order, with a non-negative open-item count
    research_roadmap_violations: `select (
        (select count(*) - count(distinct gap_area) from public.v_research_roadmap)
      + (select count(*) - count(distinct priority) from public.v_research_roadmap)
      + (select count(*) from public.v_research_roadmap where open_items is null or open_items < 0 or btrim(unlocks) = '' or btrim(evidence_needed) = '')
      + (case when (select count(*) from public.v_research_roadmap) = 0 then 1 else 0 end)
      )::int as n`,
  }
}

export const RELEASE_QUERIES = releaseQueries(true)
