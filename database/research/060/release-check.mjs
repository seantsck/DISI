#!/usr/bin/env node
// The 060 release check: a pure comparison of two measure.mjs captures (no database). It returns PASS only when exactly the reviewed change
// happened: the 25 bonuses, the 24 unsourced reports and the one Beltre resolution, 56 -> 81 known / 164 -> 139 unknown, +$5,932,000.00, Astacio the
// only new zero, one refresh, the cost-driven research rows and nothing else (outcomes, WAR, transactions, development, benchmarks, prediction).
//   node database/research/060/release-check.mjs --pre pre.json --post post.json        (exit 0 PASS, 2 HOLD)
// Capture each side read-only with: node database/research/060/measure.mjs --out <file> (DISI_VERIFY_DB_URL in the environment).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const evidence = JSON.parse(fs.readFileSync(path.join(here, 'research-evidence.json'), 'utf8'))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const cents = (s) => Math.round(Number(s) * 100)

// sections 060 may change; every other measured section must be identical
export const ALLOWED_SECTIONS = ['counts', 'hashes', 'executive', 'value_queue', 'research_task_types', 'prediction', 'snapshots', 'tasks', 'ledger', 'isolation',
  'cost_counts', 'all_zero_bonuses', 'resolutions', 'reviewed', 'missing_cost', 'fingerprints']
const ALLOWED_ISOLATION = ['feature_matrix', 'realized_outcome', 'realized_value', 'value_queue', 'executive_overview', 'other_research_tasks']
// within the mixed sections, only these keys may move
const ALLOWED_KEYS = { counts: ['known_costs', 'known_spend_usd', 'open_research_tasks', 'snapshot_generation'], hashes: ['dodgers_signings_hash', 'financial_reports_hash'],
  executive: ['open_research_tasks'] }

export function verifyApply(pre, post) {
  const checks = []
  const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail: pass ? '' : String(detail).slice(0, 300) })
  const k = (m) => `${m.player_slug}|${m.signing_year}`
  const reviewed = evidence.bonuses.map((b) => `${b.player_slug}|${b.signing_year}`).sort()

  const unexpected = Object.keys(pre).filter((s) => !ALLOWED_SECTIONS.includes(s) && !same(pre[s], post[s]))
  check('every section outside the cost layer is identical (outcomes, WAR, transactions, development, benchmarks, support, evaluations, value totals)', unexpected.length === 0, unexpected.join(', '))
  const keys = Object.entries(ALLOWED_KEYS).flatMap(([sec, ok]) => Object.keys(pre[sec] ?? {}).filter((x) => !ok.includes(x) && !same(pre[sec][x], post[sec][x])).map((x) => `${sec}.${x}`))
  check('mixed sections: only the cost counts, open research tasks, snapshot generation and the signing / ledger hashes move', keys.length === 0, keys.join(', '))
  const iso = Object.keys(pre.isolation ?? {}).filter((x) => !ALLOWED_ISOLATION.includes(x) && pre.isolation[x] !== post.isolation[x])
  check('isolation fingerprints: outcomes, team-season WAR, sources, training population, support, evaluations, probabilities, expected values, lineage, transaction queue unchanged', iso.length === 0, iso.join(', '))
  const { feature_matrix: _a, ...p0 } = pre.prediction ?? {}
  const { feature_matrix: _b, ...p1 } = post.prediction ?? {}
  check('prediction outputs and evaluation fingerprints unchanged; outputs 0 / 0 / 0 / 0 / 0', same(p0, p1) && [p1.supported_models, p1.probabilities, p1.expected_values, p1.recommendations, p1.supported_targets].every((x) => x === 0))
  check('cost counts: 220 signings, known 56 -> 81, unknown 164 -> 139',
    same([pre.cost_counts.signings, pre.cost_counts.known, pre.cost_counts.unknown, post.cost_counts.signings, post.cost_counts.known, post.cost_counts.unknown], [220, 56, 164, 220, 81, 139]),
    JSON.stringify([pre.cost_counts, post.cost_counts]))
  check('known acquisition cost +$5,932,000.00', cents(post.cost_counts.known_usd) - cents(pre.cost_counts.known_usd) === 593200000, `${pre.cost_counts.known_usd} -> ${post.cost_counts.known_usd}`)
  const left = pre.missing_cost.map(k).filter((x) => !post.missing_cost.map(k).includes(x)).sort()
  check('exactly the 25 reviewed signings leave the missing-cost list; none enters it', same(left, reviewed) && post.missing_cost.every((m) => pre.missing_cost.map(k).includes(k(m))))
  check('KNOWN ZERO: Pedro Astacio is the only new zero bonus', same(pre.all_zero_bonuses, []) && same(post.all_zero_bonuses, [{ slug: 'pedro-astacio', signing_year: 1987 }]))
  const byKey = new Map(post.reviewed.map((r) => [`${r.slug}|${r.signing_year}`, r]))
  const wrong = evidence.bonuses.filter((b) => {
    const r = byKey.get(`${b.player_slug}|${b.signing_year}`)
    if (!r || r.signing_bonus_usd !== b.signing_bonus_usd || r.bonus_status !== 'KNOWN' || r.bonus_publicly_reported !== false) return true
    const active = r.bonus_reports.filter((x) => x.status === 'ACTIVE')
    if (b.treatment === 'OWNER_REVIEWED_LEDGER_FACT') {
      return r.bonus_source_status !== 'LEGACY_CANONICAL_ONLY' || active.length !== 1 || active[0].origin !== 'LEGACY_CARRYFORWARD' || active[0].source_url !== null
        || active[0].amount !== b.signing_bonus_usd || active[0].note !== (b.known_zero ? evidence.ledger_mapping.known_zero_note : evidence.ledger_mapping.note)
    }
    return active.length !== 2 || r.active_resolutions !== 1 || !r.resolved_components.includes('SIGNING_BONUS')
  })
  check('the 25 reviewed bonuses: canonical at the reviewed amount; 24 unsourced owner-reviewed reports; Beltre resolved with both reports ACTIVE; flag unchanged', wrong.length === 0, wrong.map((b) => b.player_slug).join(', '))
  const br = evidence.beltre_resolution
  check('exactly one resolution: Beltre, OTHER_REVIEWED, the existing $23,000 report', same(pre.resolutions, []) && post.resolutions.length === 1
    && same([post.resolutions[0].slug, post.resolutions[0].basis, post.resolutions[0].record_status, post.resolutions[0].selected_amount, post.resolutions[0].selected_source_url, post.resolutions[0].rationale],
      [br.player_slug, br.basis, 'ACTIVE', br.selected_report.amount, br.selected_report.source_url, br.rationale]))
  for (const f of ['other_signings', 'other_reports', 'environment_reports', 'other_resolutions']) check(`fingerprint unchanged: ${f}`, pre.fingerprints[f] === post.fingerprints[f])
  check('ledger rows written by 060: 24 reports, 1 resolution', post.fingerprints.reports_060 === 24 && post.fingerprints.resolutions_060 === 1 && pre.fingerprints.reports_060 === 0)
  const task = (m) => m.tasks.filter((t) => t.task_type !== 'ACQUISITION_COST_UNKNOWN')
  check('research tasks: only ACQUISITION_COST_UNKNOWN moves (Dodgers 164 -> 139)', same(task(pre), task(post))
    && post.tasks.find((t) => t.task_type === 'ACQUISITION_COST_UNKNOWN' && t.dodgers).items === 139)
  const vq = (m) => m.value_queue.filter((x) => x.issue !== 'ACQUISITION_COST_INCOMPLETE')
  check('value queue: only ACQUISITION_COST_INCOMPLETE moves', same(vq(pre), vq(post)))
  check('snapshots: one refresh (generation + 1), drift 0', Number(post.snapshots.generation) === Number(pre.snapshots.generation) + 1 && post.snapshots.drifting === 0,
    JSON.stringify([pre.snapshots.generation, post.snapshots.generation, post.snapshots.drifting]))
  return { verdict: checks.every((c) => c.pass) ? 'PASS' : 'HOLD', passed: checks.filter((c) => c.pass).length, total: checks.length, checks }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
  const r = verifyApply(JSON.parse(fs.readFileSync(arg('pre'), 'utf8')), JSON.parse(fs.readFileSync(arg('post'), 'utf8')))
  for (const c of r.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ' - ' + c.detail : ''}`)
  console.log(`\n060 apply verification: ${r.passed}/${r.total} -> ${r.verdict === 'PASS' ? 'PASS' : 'HOLD (stop: no merge, deploy or freeze; inspect the mismatch)'}`)
  process.exit(r.verdict === 'PASS' ? 0 : 2)
}
