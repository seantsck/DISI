#!/usr/bin/env node
// Assembles database/sql/031_financial_provenance_coverage_expansion.sql from:
//   031_template.sql                        hand-written schema, guards, steps and postconditions
//   view-signing-acquisition-financials.sql the replaced 030 view (resolution-aware)
//   seed-evidence.json                      the reviewed, directly read facts
//   audit-report.json                       written by audit.mjs; the build refuses to run if the audit failed
//
//   node database/research/031/audit.mjs && node database/research/031/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const seed = JSON.parse(fs.readFileSync(path.join(here, 'seed-evidence.json'), 'utf8'))
const audit = JSON.parse(fs.readFileSync(path.join(here, 'audit-report.json'), 'utf8'))
if (audit.failures.length) throw new Error(`audit has failures: ${audit.failures.join('; ')}`)

// ---- reviewed-input validation (fail loudly, never guess) --------------------------------------------
const BASES = ['EXACT', 'ROUNDED', 'APPROXIMATE', 'RULE_DERIVED']
const METRICS = ['BASE_POOL', 'POOL_AFTER_TRADES', 'POOL_SPACE_ACQUIRED', 'POOL_SPACE_SENT', 'PENALTY_REDUCTION', 'REPORTED_PERIOD_SPEND', 'OVERAGE_TAX_RATE', 'OVERAGE_TAX_PAID', 'INDIVIDUAL_BONUS_CAP']
const CONFIDENCE = ['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED']
const KINDS = ['UPGRADE', 'NEW', 'CORRECTION']
const money = /^\d{1,12}\.\d{2}$/
const sources = new Map()
for (const s of seed.sources) {
  if (sources.has(s.key)) throw new Error(`duplicate source key ${s.key}`)
  if ([...sources.values()].some((o) => o.url === s.url)) throw new Error(`duplicate source url ${s.url}`)
  if (!/^https:\/\//.test(s.url)) throw new Error(`${s.key}: url must be https`)
  if (!s.existing && !(s.source_name && s.source_type && s.title && s.author && s.publication_date && s.accessed_at && s.source_tier)) throw new Error(`${s.key}: a new source needs full metadata`)
  sources.set(s.key, s)
}
const url = (key, where) => {
  if (!sources.has(key)) throw new Error(`${where}: unknown source ${key}`)
  return sources.get(key).url
}
const checkBasis = (r, where) => {
  const value = r.amount ?? r.amount_usd
  if (!BASES.includes(r.amount_basis)) throw new Error(`${where}: bad amount_basis`)
  if (r.amount_basis === 'RULE_DERIVED' || r.amount_basis === 'APPROXIMATE') throw new Error(`${where}: 031 seeds only EXACT or ROUNDED facts`)
  if ((r.amount_basis === 'ROUNDED') !== (r.amount_precision != null)) throw new Error(`${where}: ROUNDED and amount_precision go together`)
  if (!money.test(value)) throw new Error(`${where}: amount must be a 2-decimal string`)
  if (r.amount_basis === 'ROUNDED' && Number(value) % Number(r.amount_precision) !== 0) throw new Error(`${where}: a ROUNDED amount must be a multiple of its precision`)
  if (!CONFIDENCE.includes(r.confidence)) throw new Error(`${where}: bad confidence`)
  if (!r.note || r.note.length > 400) throw new Error(`${where}: note required (<= 400)`)
}
const refs = new Set()
for (const r of seed.signing_reports) {
  if (refs.has(r.ref)) throw new Error(`duplicate ref ${r.ref}`)
  refs.add(r.ref)
  if (!KINDS.includes(r.kind)) throw new Error(`${r.ref}: bad kind`)
  checkBasis(r, r.ref)
  url(r.source, r.ref)
  if (r.kind === 'CORRECTION' && !money.test(r.legacy_amount ?? '')) throw new Error(`${r.ref}: a correction needs legacy_amount`)
  if (r.kind !== 'CORRECTION' && r.legacy_amount != null) throw new Error(`${r.ref}: only a correction carries legacy_amount`)
}
if (seed.signing_reports.filter((r) => r.kind === 'CORRECTION').length !== 1) throw new Error('031 corrects exactly one legacy value (Rincon)')
for (const d of seed.deferred) {
  if (seed.signing_reports.some((r) => r.player_slug === d.player_slug)) throw new Error(`${d.player_slug} is deferred and must not be seeded`)
}
for (const r of seed.environment_reports) {
  if (refs.has(r.ref)) throw new Error(`duplicate ref ${r.ref}`)
  refs.add(r.ref)
  if (!METRICS.includes(r.metric_type) || r.metric_type === 'OVERAGE_TAX_PAID') throw new Error(`${r.ref}: bad metric`)
  checkBasis({ ...r, amount: r.amount_usd }, r.ref)
  url(r.source, r.ref)
  const known = seed.environments.some((e) => e.signing_year === r.signing_year) || seed.environment_column_updates.some((e) => e.signing_year === r.signing_year) || r.signing_year === 2022
  if (!known) throw new Error(`${r.ref}: environment ${r.signing_year} is neither added nor extended`)
}
// the 2021-22 allocation is the sourced effective pool; the penalty is memo-only and never produces a derived base
const penalty = seed.environment_reports.filter((r) => r.metric_type === 'PENALTY_REDUCTION')
if (penalty.length !== 1 || !/must not be subtracted again/.test(penalty[0].note)) throw new Error('the 2021-22 penalty is a memo that must not be subtracted again')
if (seed.environment_reports.some((r) => r.metric_type === 'POOL_AFTER_TRADES')) throw new Error('no post-trade pool is printed in a read source; none is seeded')
if (!seed.environment_reports.some((r) => r.signing_year === 2022 && r.metric_type === 'BASE_POOL' && r.amount_usd === '4644000.00')) throw new Error('the 2021-22 effective pool must be seeded')

// ---- payload ------------------------------------------------------------------------------------------------------
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]))
const payload = sortKeys({
  organization_name: seed.organization_name,
  existing_sources: seed.sources.filter((s) => s.existing).map((s) => s.url),
  new_sources: seed.sources.filter((s) => !s.existing).map((s) => pick(s, ['source_name', 'source_type', 'title', 'url', 'author', 'publication_date', 'accessed_at', 'notes', 'source_tier'])),
  signing_reports: seed.signing_reports.map((r) => ({
    ...pick(r, ['ref', 'kind', 'player_slug', 'signing_year', 'amount', 'amount_basis', 'amount_precision', 'evidence_basis', 'confidence', 'note', 'legacy_amount']),
    source_url: url(r.source, r.ref),
  })),
  environments: seed.environments.map((e) => pick(e, ['signing_year', 'signing_period_label', 'regime', 'club_bonus_pool_usd', 'tradeable_pool_space', 'rules_summary', 'notes'])),
  environment_column_updates: seed.environment_column_updates.map((e) => pick(e, ['signing_year', 'column', 'from', 'to'])),
  environment_reports: seed.environment_reports.map((r) => ({
    ...pick(r, ['ref', 'signing_year', 'metric_type', 'amount_usd', 'amount_basis', 'amount_precision', 'evidence_basis', 'confidence', 'note']),
    source_url: url(r.source, r.ref),
  })),
  link_windows: seed.link_windows.map((w) => pick(w, ['signing_year', 'from', 'to'])),
})
const json = JSON.stringify(payload)
if (json.includes('$m031$')) throw new Error('payload contains the dollar-quote tag')

let sql = fs.readFileSync(path.join(here, '031_template.sql'), 'utf8').replace(/\r\n/g, '\n')
const view = fs.readFileSync(path.join(here, 'view-signing-acquisition-financials.sql'), 'utf8').replace(/\r\n/g, '\n').trimEnd()
const fill = (name, value) => {
  const token = `{{${name}}}`
  if (!sql.includes(token)) throw new Error(`template has no ${token}`)
  sql = sql.split(token).join(value)
}
fill('view_signing_financials', view)
fill('payload_json', json)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/031_financial_provenance_coverage_expansion.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
