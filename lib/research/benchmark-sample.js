// The international benchmark, summarized per source class from the persisted rows the League Benchmark page already reads
// (v_signing_records for MLB_PIPELINE_TOP_PROSPECT signings, v_signing_data_coverage for the list sizes, product_prediction_readiness for the
// fixed-horizon label coverage). Pure functions: same rows, same output.
//
// RANKED PROSPECT SAMPLE != LEAGUE CENSUS: every figure is a count with its denominator, "among this MLB Pipeline Top-30 benchmark sample";
// nothing here is a rate of international signings, an organization's hit rate, or a Dodgers comparison. RANKING CLASS YEAR != SIGNING
// YEAR: a class is the list a player appeared on; his signing year is the year of his official signing, and both are shown.

const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

/** The MLB Pipeline class a benchmark signing belongs to: its population key (MLB-<year>-PIPELINE-TOP30), else its signing year. */
export function benchmarkClassOf(row) {
  const key = (row?.population_keys ?? []).find((k) => /^MLB-\d{4}-PIPELINE-TOP30$/.test(String(k)))
  return key ? Number(String(key).slice(4, 8)) : n(row?.signing_year)
}

const PROFESSIONAL = new Set(['CUBAN_PRO', 'JAPAN_PRO', 'KOREA_PRO', 'POSTED_PLAYER', 'MEXICAN_LEAGUE_TRANSFER'])

/**
 * @param {any[]} rows      v_signing_records rows with record_scope MLB_PIPELINE_TOP_PROSPECT
 * @param {any[]} coverage  v_signing_data_coverage rows (the TOP_PROSPECT_SAMPLE rows carry the list size)
 * @returns {Array<{ class_year: number, list_size: number|null, benchmark_signings: number, audited: number, not_audited: number,
 *   reached_mlb: number, audited_no_mlb: number, professional_route: number, signing_years: Record<string, number>, statement: string }>}
 */
export function benchmarkClassSummary(rows, coverage) {
  const listSize = new Map((coverage ?? []).filter((c) => c.coverage_type === 'TOP_PROSPECT_SAMPLE' && !c.abbreviation)
    .map((c) => [n(c.period_start_year), n(c.expected_signings)]))
  const byClass = new Map()
  for (const r of rows ?? []) {
    const cls = benchmarkClassOf(r)
    if (cls == null) continue
    if (!byClass.has(cls)) byClass.set(cls, [])
    byClass.get(cls).push(r)
  }
  return [...byClass.keys()].sort((a, b) => a - b).map((cls) => {
    const rs = byClass.get(cls)
    const audited = rs.filter((r) => r.outcome_audited === true).length
    const reached = rs.filter((r) => r.reached_mlb_verified === true).length
    const noMlb = rs.filter((r) => r.outcome_audited === true && r.reached_mlb_verified === false).length
    const years = {}
    for (const r of rs) years[String(r.signing_year)] = (years[String(r.signing_year)] ?? 0) + 1
    const size = listSize.get(cls) ?? null
    return {
      class_year: cls, list_size: size, benchmark_signings: rs.length, audited, not_audited: rs.length - audited,
      reached_mlb: reached, audited_no_mlb: noMlb, professional_route: rs.filter((r) => PROFESSIONAL.has(r.pathway)).length,
      signing_years: Object.fromEntries(Object.entries(years).sort(([a], [b]) => a.localeCompare(b))),
      statement: `Among the ${rs.length} benchmark signings of the ${cls} MLB Pipeline Top 30${size != null ? ` (a list of ${size})` : ''}, ${audited} have an outcome audit and ${reached} of those reached MLB.`,
    }
  })
}

/** The benchmark's fixed-horizon label coverage (its own reference population; never pooled, never a Dodgers figure). */
export function benchmarkLabelCoverage(readinessRows) {
  return (readinessRows ?? []).filter((t) => t.reference_population === 'TOP_PROSPECT_SAMPLE').map((t) => ({
    target_key: t.target_key, target_label: t.target_label, labelled: n(t.labelled_n), positives: n(t.positive_n), negatives: n(t.negative_n),
    unaudited: n(t.unaudited_n), open_horizon: n(t.censored_n), baseline_supported: t.baseline_supported === true,
    statement: t.baseline_supported === true
      ? `${t.labelled_n} labelled (${t.positive_n} positive, ${t.negative_n} negative): the support minimum is met for this rank-selected sample. It is a reference result for this sample only and is never a Dodgers probability.`
      : `${t.labelled_n} labelled (${t.positive_n} positive, ${t.negative_n} negative); ${t.unaudited_n} cannot be labelled yet (unaudited, or a reacher without loaded Baseball-Reference WAR), ${t.censored_n} are inside the horizon.`,
  }))
}
