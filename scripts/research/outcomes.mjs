#!/usr/bin/env node
// research:outcomes - the deterministic outcome-audit cohort. Read-only.
//
//   npm run research:outcomes -- --mature --status not_audited [--year 2021] [--market Venezuela] [--limit 20] [--format text|json|csv]
//   npm run research:outcomes -- --evaluate research-output/046/player-outcomes.json --audit-date 2026-10-05
//
// NOT_AUDITED is an absent audit. It is never a no-MLB result.

import fs from 'node:fs'
import { buildOutcomeCohort, cohortSummary, filterCohort } from '../../lib/research/outcome-cohort.js'
import { auditConclusion } from '../../lib/research/outcome-audit.js'
import { parseArgs, emit, run, int } from './lib/cli.mjs'
import { loadDataset } from './lib/source.mjs'

run(async () => {
  const args = parseArgs(process.argv.slice(2))
  if (args.evaluate) {
    const artifact = JSON.parse(fs.readFileSync(String(args.evaluate), 'utf8'))
    const rows = (artifact.records ?? artifact).map((r) => ({ name: r.name, signing_year: r.signingYear, recommendation: r.recommendation, ...auditConclusion(r, r.signingYear) }))
      .map((r) => ({ name: r.name, signing_year: r.signing_year, recommendation: r.recommendation, conclusion: r.conclusion, write_audit: r.writeAudit, outcome_state: r.outcomeState, reason: r.reason }))
      .sort((a, b) => (a.signing_year - b.signing_year) || (a.name < b.name ? -1 : 1))
    const by = {}
    for (const r of rows) by[r.conclusion] = (by[r.conclusion] ?? 0) + 1
    emit(args, { title: 'Audit conclusions (evaluation only; nothing is written)', rows, summary: { conclusions: by }, columns: ['signing_year', 'name', 'recommendation', 'conclusion', 'write_audit', 'outcome_state', 'reason'] })
    return
  }
  const { data } = await loadDataset(args)
  const cohort = buildOutcomeCohort({ signings: data.signings, directory: data.directory, matureQueue: data.matureQueue, sourceCounts: data.sourceCounts, asOf: data.asOf })
  const rows = filterCohort(cohort, {
    mature: args.mature === true ? true : args.developing === true ? false : undefined,
    status: args.status ? String(args.status) : undefined,
    year: int(args.year),
    market: args.market && args.market !== true ? String(args.market) : undefined,
    limit: int(args.limit),
  })
  emit(args, {
    title: `Outcome-audit cohort as of ${data.asOf} (maturity: signed at least 5 years before the as-of date)`,
    rows,
    summary: cohortSummary(cohort),
    columns: ['priority', 'signing_year', 'signing_date', 'full_name', 'age_at_signing', 'maturity', 'audit_status', 'mlb_id', 'bref_id', 'source_count', 'highest_level', 'last_affiliated_season', 'last_affiliated_team', 'disposition', 'blockers'],
  })
})
