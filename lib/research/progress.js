// 046 progress: a baseline taken before the research batch against the current state. Differences only; no rates, no targets.

const FIELDS = [
  ['tracked_signings', 'Tracked signings'],
  ['outcome_audits_completed', 'Outcome audits completed'],
  ['verified_mlb_outcomes', 'Verified MLB outcomes'],
  ['verified_no_mlb_outcomes', 'Verified no-MLB outcomes'],
  ['outcome_audit_queue', 'NOT_AUDITED'],
  ['signings_with_known_cost', 'Signings with known acquisition cost'],
  ['known_acquisition_cost_usd', 'Known acquisition spend (USD, lower bound)'],
  ['signings_with_bwar', 'Signings with observed bWAR'],
  ['open_research_tasks', 'Open research tasks'],
]

/** @param {any} baseline product_database_status row at the start @param {any} current product_database_status row now */
export function progressReport(baseline, current) {
  const rows = FIELDS.map(([field, label]) => {
    const start = baseline?.[field] == null ? null : Number(baseline[field])
    const now = current?.[field] == null ? null : Number(current[field])
    return { field, label, baseline: start, current: now, change: start === null || now === null ? null : Math.round((now - start) * 100) / 100 }
  })
  return { rows, changed: rows.filter((r) => r.change !== null && r.change !== 0).length }
}
