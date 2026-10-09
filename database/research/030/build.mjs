#!/usr/bin/env node
// Assembles database/sql/030_financial_acquisition_intelligence.sql from:
//   030_template.sql       hand-written schema, triggers, views and guards
//   seed-evidence.json     the reviewed, directly read financial facts
//   audit-report.json      written by audit.mjs; the build refuses to run if the audit failed
//
//   node database/research/030/audit.mjs && node database/research/030/build.mjs
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
const REVIEW_TIMESTAMP = '2026-10-09T18:40:00Z'
const PATHWAYS = ['LATAM_AMATEUR', 'MEXICAN_LEAGUE_TRANSFER', 'CUBAN_AMATEUR', 'CUBAN_PRO', 'JAPAN_AMATEUR', 'JAPAN_PRO', 'KOREA_AMATEUR', 'KOREA_PRO', 'POSTED_PLAYER', 'OTHER']
const RULE_COMPONENTS = ['SIGNING_BONUS', 'POSTING_FEE', 'TRANSFER_FEE', 'RELEASE_FEE', 'OTHER_ACQUISITION_FEE']
const COMPONENTS = [...RULE_COMPONENTS.slice(0, 4), 'POOL_CHARGE', 'OTHER_ACQUISITION_FEE']
const METRICS = ['BASE_POOL', 'POOL_AFTER_TRADES', 'POOL_SPACE_ACQUIRED', 'POOL_SPACE_SENT', 'PENALTY_REDUCTION', 'REPORTED_PERIOD_SPEND', 'OVERAGE_TAX_RATE', 'OVERAGE_TAX_PAID', 'INDIVIDUAL_BONUS_CAP']
const BASES = ['EXACT', 'ROUNDED', 'APPROXIMATE', 'RULE_DERIVED']
const APPLICABILITY = ['REQUIRED', 'POSSIBLE', 'CONDITIONAL', 'NOT_APPLICABLE', 'NO_RULE']
const TREATMENTS = ['SUBJECT', 'EXEMPT', 'NOT_SUBJECT', 'NOT_APPLICABLE', 'UNKNOWN']
const CONFIDENCE = ['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED']
const money = /^\d{1,12}\.\d{2}$/

const sources = new Map()
for (const s of seed.sources) {
  if (sources.has(s.key)) throw new Error(`duplicate source key ${s.key}`)
  if ([...sources.values()].some((o) => o.url === s.url)) throw new Error(`duplicate source url ${s.url}`)
  if (!/^https:\/\//.test(s.url)) throw new Error(`${s.key}: url must be https`)
  if (!s.existing && !(s.source_name && s.source_type && s.title && s.publication_date && s.accessed_at && s.source_tier)) throw new Error(`${s.key}: a new source needs full metadata`)
  sources.set(s.key, s)
}
const sourceUrl = (key, where) => {
  if (!sources.has(key)) throw new Error(`${where}: unknown source ${key}`)
  return sources.get(key).url
}
const checkNote = (note, where, max = 400) => {
  if (!note || !note.trim()) throw new Error(`${where}: note required`)
  if (note.length > max) throw new Error(`${where}: note over ${max} characters`)
}
const checkBasis = (r, value, where) => {
  if (!BASES.includes(r.amount_basis)) throw new Error(`${where}: bad amount_basis`)
  if ((r.amount_basis === 'ROUNDED') !== (r.amount_precision != null)) throw new Error(`${where}: ROUNDED and amount_precision go together`)
  if (r.amount_basis === 'RULE_DERIVED' && 'derivation_rate' in r) {
    const derived = Math.round(Number(r.derivation_base_amount) * Number(r.derivation_rate) * 100) / 100
    if (derived !== Number(value)) throw new Error(`${where}: ${r.derivation_base_amount} x ${r.derivation_rate} is ${derived}, not ${value}`)
    if (!r.derivation_rule || r.derivation_rule.length > 300) throw new Error(`${where}: derivation_rule required (<= 300)`)
  } else if (r.derivation_rate != null || r.derivation_base_amount != null || r.derivation_rule != null) {
    throw new Error(`${where}: derivation fields belong to a RULE_DERIVED amount`)
  }
  if (r.amount_basis === 'ROUNDED' && Math.abs(Number(value) / Number(r.amount_precision) - Math.round(Number(value) / Number(r.amount_precision))) > 1e-9) {
    throw new Error(`${where}: a ROUNDED amount must be a multiple of its precision`)
  }
}

const refs = new Set()
for (const r of seed.signing_reports) {
  if (refs.has(r.ref)) throw new Error(`duplicate report ref ${r.ref}`)
  refs.add(r.ref)
  if (!COMPONENTS.includes(r.component_type)) throw new Error(`${r.ref}: bad component_type`)
  if (!money.test(r.amount)) throw new Error(`${r.ref}: amount must be a 2-decimal string`)
  if (!/^[A-Z]{3}$/.test(r.currency_code) || r.currency_code !== 'USD') throw new Error(`${r.ref}: every 030 report is USD`)
  if (r.report_origin !== 'EXTERNAL_SOURCE') throw new Error(`${r.ref}: 030 seeds only externally sourced reports (legacy rows are derived from data)`)
  if (!CONFIDENCE.includes(r.confidence)) throw new Error(`${r.ref}: bad confidence`)
  sourceUrl(r.source, r.ref)
  checkBasis(r, r.amount, r.ref)
  checkNote(r.note, r.ref)
}
for (const r of seed.environment_reports) {
  if (refs.has(r.ref)) throw new Error(`duplicate report ref ${r.ref}`)
  refs.add(r.ref)
  if (!METRICS.includes(r.metric_type)) throw new Error(`${r.ref}: bad metric_type`)
  const isRate = r.metric_type === 'OVERAGE_TAX_RATE'
  if (isRate !== (r.rate_value != null) || isRate === (r.amount_usd != null)) throw new Error(`${r.ref}: a rate metric carries rate_value only, money metrics amount_usd only`)
  if (r.amount_usd != null && !money.test(r.amount_usd)) throw new Error(`${r.ref}: amount must be a 2-decimal string`)
  if (r.report_origin !== 'EXTERNAL_SOURCE') throw new Error(`${r.ref}: 030 seeds only externally sourced environment reports`)
  if (r.metric_type === 'OVERAGE_TAX_PAID') throw new Error(`${r.ref}: no tax amount is stored by 030`)
  sourceUrl(r.source, r.ref)
  checkBasis(r, r.amount_usd ?? r.rate_value, r.ref)
  checkNote(r.note, r.ref)
}
// the 2015-16 reported spend is approximate, and nothing doubles it into a "total tab"
const spend2015 = seed.environment_reports.filter((r) => r.signing_year === 2015 && r.metric_type === 'REPORTED_PERIOD_SPEND')
if (spend2015.length !== 1 || spend2015[0].amount_basis !== 'APPROXIMATE' || spend2015[0].amount_usd !== '45000000.00') throw new Error('the 2015-16 spend is one APPROXIMATE $45M report')
if (seed.environment_reports.some((r) => r.amount_usd === '90000000.00')) throw new Error('the $90M projection is never stored')

for (const t of seed.pool_treatments) {
  if (!TREATMENTS.includes(t.treatment) || t.treatment === 'UNKNOWN' || t.basis !== 'SOURCE_STATEMENT') throw new Error(`${t.player_slug}: a seeded treatment is a source statement`)
  sourceUrl(t.source, `${t.player_slug} treatment`)
  checkNote(t.note, `${t.player_slug} treatment`)
}
const rule = seed.pool_treatment_rule
if (rule.treatment !== 'NOT_APPLICABLE' || rule.basis !== 'RULE') throw new Error('the only rule-based treatment is pre-pool NOT_APPLICABLE')

// canonical changes are exactly the reviewed Ryu changes
const changes = seed.canonical_changes
if (changes.length !== 3 || changes.some((c) => c.player_slug !== 'hyun-jin-ryu')) throw new Error('030 changes only Ryu\'s canonical values')
const expectations = seed.canonical_expectations.signings.map((e) => {
  const after = Object.fromEntries(changes.filter((c) => c.player_slug === e.player_slug && c.signing_year === e.signing_year).map((c) => [`${c.column}_after`, c.to]))
  return { ...e, ...after }
})
const ryuBonus = seed.signing_reports.filter((r) => r.player_slug === 'hyun-jin-ryu' && r.component_type === 'SIGNING_BONUS')
if (ryuBonus.length < 1 || ryuBonus.some((r) => r.amount !== '5000000.00')) throw new Error('Ryu\'s bonus reports all say $5M')
const sasakiPosting = seed.signing_reports.filter((r) => r.player_slug === 'roki-sasaki' && r.component_type === 'POSTING_FEE')
if (new Set(sasakiPosting.map((r) => r.amount)).size !== 2) throw new Error('the two Sasaki posting reports disagree by design')

// component rules: every pathway x component exactly once
const groups = seed.component_rules
const ruleRows = []
for (const [name, g] of Object.entries(groups)) {
  if (name === 'rule_sources') continue
  for (const pathway of g.pathways ?? [name]) {
    if (!PATHWAYS.includes(pathway)) throw new Error(`rules: unknown pathway ${pathway}`)
    for (const component of RULE_COMPONENTS) {
      const [applicability, explanation] = g[component] ?? []
      if (!APPLICABILITY.includes(applicability)) throw new Error(`rules ${pathway}/${component}: bad applicability`)
      checkNote(explanation, `rules ${pathway}/${component}`)
      const src = groups.rule_sources[`${pathway}:${component}`]
      ruleRows.push({ pathway, component_type: component, applicability, explanation, source_url: src ? sourceUrl(src, 'rule') : null })
    }
  }
}
if (ruleRows.length !== PATHWAYS.length * RULE_COMPONENTS.length || new Set(ruleRows.map((r) => `${r.pathway}:${r.component_type}`)).size !== ruleRows.length) {
  throw new Error('rules: every pathway needs exactly one row per component')
}

// ---- payload ------------------------------------------------------------------------------------------------------
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const retrievedAt = (key) => sources.get(key).accessed_at ?? null
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]))
const ne = seed.new_environment
const ps = seed.canonical_expectations.dodgers_2019_period_summary
if (Number(ne.club_bonus_pool_usd) !== Number(ps.pool_amount_usd)) throw new Error('the 2019-20 environment pool is the period-summary pool')
for (const r of seed.environment_reports.filter((x) => x.from_period_summary)) {
  if (Number(r.amount_usd) !== Number(ps[r.from_period_summary])) throw new Error(`${r.ref}: does not match the period summary`)
}
const payload = sortKeys({
  review_timestamp: REVIEW_TIMESTAMP,
  expectations: {
    signings: expectations,
    field_level_money_evidence: seed.canonical_expectations.field_level_money_evidence.map((e) => ({ ...pick(e, ['player_slug', 'signing_year', 'field_name']), source_url: sourceUrl(e.source, 'field evidence') })),
    period_summary_2019: { pool_amount_usd: ps.pool_amount_usd, pool_spent_usd: ps.pool_spent_usd, source_url: sourceUrl(ps.source, 'period summary') },
  },
  existing_sources: seed.sources.filter((s) => s.existing).map((s) => s.url),
  new_sources: seed.sources.filter((s) => !s.existing).map((s) => pick(s, ['source_name', 'source_type', 'title', 'url', 'author', 'publication_date', 'accessed_at', 'notes', 'source_tier'])),
  component_rules: ruleRows,
  signing_reports: seed.signing_reports.map((r) => ({
    ...pick(r, ['ref', 'player_slug', 'organization_name', 'signing_year', 'component_type', 'amount', 'currency_code', 'amount_basis', 'amount_precision',
      'derivation_rate', 'derivation_base_amount', 'derivation_rule', 'report_origin', 'evidence_basis', 'confidence', 'note']),
    source_url: sourceUrl(r.source, r.ref), retrieved_at: retrievedAt(r.source),
  })),
  environment_reports: seed.environment_reports.map((r) => ({
    ...pick(r, ['ref', 'signing_year', 'metric_type', 'amount_usd', 'rate_value', 'amount_basis', 'amount_precision', 'report_origin', 'evidence_basis', 'confidence', 'note']),
    source_url: sourceUrl(r.source, r.ref), retrieved_at: retrievedAt(r.source),
  })),
  canonical_changes: changes.map((c) => pick(c, ['player_slug', 'organization_name', 'signing_year', 'column', 'from', 'to'])),
  pool_treatments: seed.pool_treatments.map((t) => ({ ...pick(t, ['player_slug', 'organization_name', 'signing_year', 'treatment', 'basis']), source_url: sourceUrl(t.source, t.player_slug) })),
  pool_treatment_rule: { treatment: rule.treatment, basis: rule.basis, source_url: sourceUrl(rule.source, 'pool rule') },
  new_environment: pick(ne, ['organization_name', 'signing_year', 'signing_period_label', 'regime', 'club_bonus_pool_usd', 'tradeable_pool_space', 'rules_summary', 'notes', 'linked_population_key']),
})
const json = JSON.stringify(payload)
if (json.includes('$m030$')) throw new Error('payload contains the dollar-quote tag')

let sql = fs.readFileSync(path.join(here, '030_template.sql'), 'utf8').replace(/\r\n/g, '\n')
const fill = (name, value) => {
  const token = `{{${name}}}`
  if (!sql.includes(token)) throw new Error(`template has no ${token}`)
  sql = sql.split(token).join(value)
}
fill('payload_json', json)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/030_financial_acquisition_intelligence.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
