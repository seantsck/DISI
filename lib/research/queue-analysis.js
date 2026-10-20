// Structured breakdown of the open research queues. The flags are a documented, static classification of what each queue item
// blocks; they never change a queue's own priority.

import { isMatureSigning } from './maturity.js'
import { ISSUE_CATEGORY } from './transaction-research.js'
import { orderBy } from './cmp.js'

/** blocks: E = analytical eligibility (rate / probability populations), C = class completeness, V = cost / value analysis. */
const RULES = Object.freeze({
  'tasks:OUTCOME_AUDIT': { category: 'MISSING_OUTCOME_AUDIT', E: true, C: false, V: false },
  'tasks:ACQUISITION_COST_UNKNOWN': { category: 'MISSING_ACQUISITION_COST', E: false, C: false, V: true },
  'tasks:MARKET_MISSING': { category: 'MISSING_MARKET_PATHWAY', E: true, C: false, V: false },
  'tasks:SIGNING_DATE_MISSING': { category: 'MISSING_SIGNING_DATE', E: true, C: false, V: false },
  'tasks:CLASS_MEMBERS_MISSING': { category: 'INCOMPLETE_CLASS_POPULATION', E: true, C: true, V: false },
  'tasks:CLASS_SIZE_SOURCE_NOT_OFFICIAL': { category: 'SOURCE_QUALITY_WEAKNESS', E: true, C: true, V: false },
  'tasks:BWAR_MISSING': { category: 'MISSING_OBSERVED_VALUE', E: false, C: false, V: true },
  'period:*': { category: 'INCOMPLETE_CLASS_POPULATION', E: true, C: true, V: false },
  'development:*': { category: 'DEVELOPMENT_HISTORY', E: false, C: false, V: false },
  'conflicts:UNRESOLVED_CLASS_MEMBERSHIP': { category: 'UNRESOLVED_RESEARCH_CONFLICT', E: true, C: true, V: false },
})

function ruleFor(source, type) {
  if (RULES[`${source}:${type}`]) return RULES[`${source}:${type}`]
  if (RULES[`${source}:*`]) return RULES[`${source}:*`]
  if (source === 'transaction' || source === 'value') {
    const category = ISSUE_CATEGORY[type] ?? 'UNMAPPED'
    return { category, E: false, C: false, V: category !== 'NOTED_BOUNDARY' }
  }
  return { category: 'UNMAPPED', E: false, C: false, V: false }
}

/**
 * @param {{ tasks: any[], signings: any[], populations?: any[], transactionQueue?: any[], valueQueue?: any[], developmentQueue?: any[], periodQueue?: any[], asOf: string }} d
 */
export function queueBreakdown(d) {
  const bySlug = new Map(d.signings.map((s) => [s.player_slug, s]))
  const byPlayer = new Map(d.signings.map((s) => [s.player_id, s]))
  const matureYear = (year) => isMatureSigning({ signing_year: year }, d.asOf)
  const groups = new Map()
  const add = (source, type, priority, signing, yearOnly) => {
    const key = `${source}|${type}`
    const g = groups.get(key) ?? { source, type, priorities: new Set(), count: 0, mature: 0, mature_unknown: 0 }
    g.count += 1
    if (priority !== null && priority !== undefined) g.priorities.add(Number(priority))
    const m = signing ? isMatureSigning(signing, d.asOf) : yearOnly != null ? matureYear(yearOnly) : null
    if (m === true) g.mature += 1
    else if (m === null) g.mature_unknown += 1
    groups.set(key, g)
  }
  for (const t of d.tasks) add('tasks', t.task_type, t.priority, byPlayer.get(t.player_id) ?? null, t.signing_year)
  for (const t of d.periodQueue ?? []) add('period', t.task_type, t.priority, byPlayer.get(t.player_id) ?? null, t.signing_year)
  for (const t of d.developmentQueue ?? []) add('development', t.issue, t.priority, byPlayer.get(t.player_id) ?? null, t.signing_year)
  for (const t of d.transactionQueue ?? []) add('transaction', t.issue, t.priority, bySlug.get(t.player_slug) ?? null, null)
  for (const t of d.valueQueue ?? []) add('value', t.issue, t.priority, bySlug.get(t.player_slug) ?? null, null)
  const conflicts = (d.populations ?? []).reduce((a, p) => a + (Number(p.unresolved_conflicts) || 0), 0)
  for (let i = 0; i < conflicts; i += 1) add('conflicts', 'UNRESOLVED_CLASS_MEMBERSHIP', null, null, null)

  const rows = [...groups.values()].map((g) => {
    const r = ruleFor(g.source, g.type)
    const priorities = [...g.priorities].sort((a, b) => a - b)
    return {
      source: g.source, type: g.type, category: r.category, count: g.count, priorities,
      affecting_mature: g.mature, mature_unknown: g.mature_unknown,
      blocking_analytical_eligibility: r.E ? g.count : 0,
      blocking_class_completeness: r.C ? g.count : 0,
      blocking_cost_value_analysis: r.V ? g.count : 0,
    }
  }).sort(orderBy([(r) => r.category, 'asc'], [(r) => r.source, 'asc'], [(r) => r.type, 'asc']))
  const totals = rows.reduce((a, r) => ({ items: a.items + r.count, mature: a.mature + r.affecting_mature }), { items: 0, mature: 0 })
  return { rows, totals, unmapped: rows.filter((r) => r.category === 'UNMAPPED').map((r) => `${r.source}:${r.type}`) }
}
