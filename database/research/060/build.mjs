#!/usr/bin/env node
// Assembles database/sql/060_owner_reviewed_acquisition_costs.sql and database/release/sql/rollback-060.sql from:
//   060_template.sql / rollback_template.sql   hand-written guards, steps and postconditions
//   research-evidence.json                    the 25 owner-reviewed signing-bonus values (the only copy of the values)
//   baseline.json                             the measured pre-060 state (node database/research/060/measure.mjs --chain 059_... --baseline)
//
//   node database/research/060/build.mjs            write both files
//   node database/research/060/build.mjs --check    exit 1 unless both files equal the build output
//
// Deterministic: the same inputs always produce the same bytes. The build refuses anything the reviewed input or the baseline does not allow.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
export const MIGRATION = path.join(here, '../../sql/060_owner_reviewed_acquisition_costs.sql')
export const ROLLBACK = path.join(here, '../../release/sql/rollback-060.sql')

const money = /^\d{1,12}\.\d{2}$/
const cents = (s) => { if (!money.test(s)) throw new Error(`not a 2-decimal non-negative amount: ${s}`); const [a, b] = s.split('.'); return BigInt(a) * 100n + BigInt(b) }
const usd = (c) => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`

/** Validates the reviewed input against the measured baseline and returns the migration payload. */
export function payloadFor(evidence, baseline) {
  const ri = evidence.reviewed_input, lm = evidence.ledger_mapping, br = evidence.beltre_resolution
  if (ri.basis !== 'OWNER_REVIEWED_INPUT' || ri.component !== 'SIGNING_BONUS' || ri.currency_code !== 'USD') throw new Error('the reviewed input must be OWNER_REVIEWED_INPUT signing bonuses in USD')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(ri.reviewed_at) || br.reviewed_at !== ri.reviewed_at || br.reviewed_by !== ri.reviewed_by) throw new Error('one reviewed-input timestamp and reviewer')
  if (lm.report_origin !== 'LEGACY_CARRYFORWARD' || lm.evidence_basis !== 'LEGACY_CANONICAL_VALUE' || lm.amount_basis !== null || lm.source !== null || lm.bonus_publicly_reported !== 'UNCHANGED') {
    throw new Error('owner-reviewed values use the unsourced-canonical ledger path only (no source, no basis, the public-report flag unchanged)')
  }
  for (const n of [lm.note, lm.known_zero_note]) if (!n || n.length > 400) throw new Error('a ledger note is required (<= 400 characters)')
  if (lm.known_zero_note === lm.note) throw new Error('the known-zero note must differ from the ordinary note')
  if (!br.rationale || br.rationale.length > 600) throw new Error('the resolution rationale is required (<= 600 characters)')

  const rows = evidence.bonuses
  if (rows.length !== 25 || ri.expected_rows !== 25) throw new Error(`exactly 25 reviewed signings are allowed, found ${rows.length}`)
  const keys = new Set()
  let total = 0n
  for (const r of rows) {
    const key = `${r.player_slug}|${r.signing_year}`
    if (keys.has(key)) throw new Error(`duplicate reviewed signing ${key}`)
    keys.add(key)
    const c = cents(r.signing_bonus_usd)
    if (c < 0n) throw new Error(`${key}: a bonus is never negative`)
    if ((c === 0n) !== (r.known_zero === true)) throw new Error(`${key}: a reviewed $0.00 must be flagged known_zero, and only a $0.00 may be`)
    if (!['OWNER_REVIEWED_LEDGER_FACT', 'RESOLVE_EXISTING_CONFLICT'].includes(r.treatment)) throw new Error(`${key}: bad treatment`)
    if ((r.treatment === 'RESOLVE_EXISTING_CONFLICT') !== (r.player_slug === br.player_slug && r.signing_year === br.signing_year)) throw new Error(`${key}: only the Beltre signing resolves an existing conflict`)
    total += c
  }
  if (usd(total) !== ri.expected_total_usd || usd(total) !== '5932000.00') throw new Error(`the reviewed total is ${usd(total)}, not 5932000.00`)
  if (rows.filter((r) => r.treatment === 'RESOLVE_EXISTING_CONFLICT').length !== 1) throw new Error('exactly one Beltre resolution')
  const beltre = rows.find((r) => r.treatment === 'RESOLVE_EXISTING_CONFLICT')
  if (beltre.signing_bonus_usd !== br.selected_report.amount || br.component_type !== 'SIGNING_BONUS' || br.basis !== 'OTHER_REVIEWED') throw new Error('the Beltre resolution selects the reviewed amount')

  // the measured pre-060 state
  if (baseline.cost_counts.known !== 56 || baseline.cost_counts.unknown !== 164 || baseline.cost_counts.signings !== 220) throw new Error('the baseline is not 220 / 56 known / 164 unknown')
  const missing = new Set(baseline.missing_cost.map((m) => `${m.player_slug}|${m.signing_year}`))
  for (const r of rows) {
    const key = `${r.player_slug}|${r.signing_year}`
    const b = baseline.reviewed.filter((x) => x.slug === r.player_slug && x.signing_year === r.signing_year)
    if (b.length !== 1) throw new Error(`${key} does not match exactly one Dodgers signing`)
    if (!missing.has(key)) throw new Error(`${key} is not an unknown-cost signing in the baseline`)
    const [s] = b
    if (s.signing_bonus_usd !== r.before.signing_bonus_usd || s.bonus_publicly_reported !== r.before.bonus_publicly_reported) throw new Error(`${key}: unexpected existing canonical value`)
    if (s.posting_fee_usd !== null || s.transfer_fee_usd !== null) throw new Error(`${key}: unexpected existing fee`)
    if (s.active_resolutions !== 0) throw new Error(`${key}: a resolution already exists`)
    if (r.treatment === 'OWNER_REVIEWED_LEDGER_FACT' && s.bonus_reports.length !== 0) throw new Error(`${key}: unexpected existing financial report`)
    if (r.treatment === 'RESOLVE_EXISTING_CONFLICT') {
      const want = [br.competing_report, br.selected_report].map((x) => `${x.amount}|${x.source_url}|ACTIVE`).sort()
      const got = s.bonus_reports.map((x) => `${x.amount}|${x.source_url}|${x.status}`).sort()
      if (JSON.stringify(got) !== JSON.stringify(want) || s.bonus_status !== 'CONFLICT') throw new Error(`${key}: Beltre must have exactly the two ACTIVE 046 reports in CONFLICT`)
    }
  }
  if (baseline.resolutions.length !== 0) throw new Error('the baseline has a resolution; a second Beltre resolution is not allowed')
  if (baseline.all_zero_bonuses.length !== 0) throw new Error('the baseline already has a zero bonus')
  const active = (origin) => baseline.ledger.filter((l) => l.report_origin === origin && l.record_status === 'ACTIVE').reduce((a, l) => a + l.reports, 0)

  const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
  return sortKeys({
    organization_name: evidence.organization_name,
    note: lm.note,
    known_zero_note: lm.known_zero_note,
    confidence: lm.confidence,
    total_usd: usd(total),
    bonuses: rows.map((r) => ({ player_slug: r.player_slug, signing_year: r.signing_year, amount: r.signing_bonus_usd, treatment: r.treatment,
      known_zero: r.known_zero === true, before_bonus: r.before.signing_bonus_usd, before_reported: r.before.bonus_publicly_reported })),
    beltre: { player_slug: br.player_slug, signing_year: br.signing_year, basis: br.basis, reviewed_by: br.reviewed_by, reviewed_at: br.reviewed_at, rationale: br.rationale,
      selected_amount: br.selected_report.amount, selected_url: br.selected_report.source_url, competing_amount: br.competing_report.amount, competing_url: br.competing_report.source_url },
    baseline: { known: baseline.cost_counts.known, unknown: baseline.cost_counts.unknown, known_usd: baseline.cost_counts.known_usd, zero_bonuses: baseline.cost_counts.zero_bonuses,
      active_external: active('EXTERNAL_SOURCE'), active_legacy: active('LEGACY_CARRYFORWARD'), active_rule: active('RULE_DERIVED'), active_resolutions: 0 },
    after: { known: baseline.cost_counts.known + rows.length, unknown: baseline.cost_counts.unknown - rows.length,
      known_usd: usd(cents(baseline.cost_counts.known_usd) + total) },
  })
}

export function assemble(evidence = read('research-evidence.json'), baseline = read('baseline.json')) {
  const json = JSON.stringify(payloadFor(evidence, baseline))
  const fill = (template, tag) => {
    if (json.includes(tag)) throw new Error(`payload contains the dollar-quote tag ${tag}`)
    let sql = fs.readFileSync(path.join(here, template), 'utf8').replace(/\r\n/g, '\n')
    if (!sql.includes('{{payload_json}}')) throw new Error(`${template} has no {{payload_json}}`)
    sql = sql.split('{{payload_json}}').join(json)
    if (/\{\{\w+\}\}/.test(sql)) throw new Error(`unreplaced placeholder in ${template}`)
    return sql
  }
  return { migration: fill('060_template.sql', '$m060$'), rollback: fill('rollback_template.sql', '$r060$') }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { migration, rollback } = assemble()
  if (process.argv.includes('--check')) {
    const same = (f, s) => fs.existsSync(f) && fs.readFileSync(f, 'utf8') === s
    if (!same(MIGRATION, migration) || !same(ROLLBACK, rollback)) { console.error('060 build output is stale: run node database/research/060/build.mjs'); process.exit(1) }
    console.log('060 build output is current')
  } else {
    fs.writeFileSync(MIGRATION, migration)
    fs.writeFileSync(ROLLBACK, rollback)
    process.stderr.write(`wrote ${path.relative(process.cwd(), MIGRATION)} and ${path.relative(process.cwd(), ROLLBACK)}\n`)
  }
}
