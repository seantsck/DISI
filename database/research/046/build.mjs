#!/usr/bin/env node
// Assembles database/sql/046_outcome_cost_research_batch.sql from:
//   046_template.sql        hand-written guards, steps and postconditions
//   research-evidence.json  the reviewed, directly read facts
//
//   node database/research/046/build.mjs
//
// Deterministic: the same inputs always produce the same file. The build refuses anything the cost methodology does not allow.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const seed = JSON.parse(fs.readFileSync(path.join(here, 'research-evidence.json'), 'utf8'))

const BASES = ['EXACT', 'ROUNDED']
const CONFIDENCE = ['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED']
const KINDS = ['NEW', 'CONFLICT']
const EVIDENCE = ['PUBLISHED_INTERNATIONAL_REVIEW', 'NEWS_REPORT', 'TEAM_RELEASE', 'LEAGUE_ROUNDUP', 'OTHER']
const money = /^\d{1,12}\.\d{2}$/

const sources = new Map()
for (const s of seed.sources) {
  if (sources.has(s.key)) throw new Error(`duplicate source key ${s.key}`)
  if ([...sources.values()].some((o) => o.url === s.url)) throw new Error(`duplicate source url ${s.url}`)
  if (!/^https:\/\//.test(s.url)) throw new Error(`${s.key}: url must be https`)
  if (!(s.source_name && s.source_type && s.title && s.author && s.accessed_at && s.source_tier && s.notes)) throw new Error(`${s.key}: a source needs full metadata`)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s.accessed_at)) throw new Error(`${s.key}: accessed_at must be a UTC timestamp`)
  if (s.publication_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(s.publication_date)) throw new Error(`${s.key}: bad publication_date`)
  sources.set(s.key, s)
}
const used = new Set()
const refs = new Set()
for (const r of seed.signing_reports) {
  if (refs.has(r.ref)) throw new Error(`duplicate ref ${r.ref}`)
  refs.add(r.ref)
  if (!KINDS.includes(r.kind)) throw new Error(`${r.ref}: bad kind`)
  if (!BASES.includes(r.amount_basis)) throw new Error(`${r.ref}: only EXACT or ROUNDED facts are seeded`)
  if ((r.amount_basis === 'ROUNDED') !== (r.amount_precision != null)) throw new Error(`${r.ref}: ROUNDED and amount_precision go together`)
  if (!money.test(r.amount) || Number(r.amount) <= 0) throw new Error(`${r.ref}: a seeded amount is a positive 2-decimal string (an unknown amount is never seeded, and zero needs its own reviewed evidence)`)
  if (!CONFIDENCE.includes(r.confidence)) throw new Error(`${r.ref}: bad confidence`)
  if (!EVIDENCE.includes(r.evidence_basis)) throw new Error(`${r.ref}: bad evidence_basis`)
  if (!r.note || r.note.length > 400) throw new Error(`${r.ref}: note required (<= 400)`)
  if (!sources.has(r.source)) throw new Error(`${r.ref}: unknown source ${r.source}`)
  used.add(r.source)
}
for (const k of sources.keys()) if (!used.has(k)) throw new Error(`source ${k} is registered but no report cites it`)

// one NEW report per signing; a CONFLICT needs at least two reports from distinct sources with distinct amounts
const bySigning = new Map()
for (const r of seed.signing_reports) {
  const key = `${r.player_slug}|${r.signing_year}`
  bySigning.set(key, [...(bySigning.get(key) ?? []), r])
}
for (const [key, rs] of bySigning) {
  const kinds = new Set(rs.map((r) => r.kind))
  if (kinds.size > 1) throw new Error(`${key}: NEW and CONFLICT reports cannot be mixed`)
  if (kinds.has('NEW') && rs.length !== 1) throw new Error(`${key}: a NEW bonus has exactly one report`)
  if (kinds.has('CONFLICT')) {
    if (rs.length < 2) throw new Error(`${key}: a conflict needs two reports`)
    if (new Set(rs.map((r) => r.source)).size !== rs.length) throw new Error(`${key}: conflicting reports must come from distinct sources`)
    if (new Set(rs.map((r) => r.amount)).size < 2) throw new Error(`${key}: the reports do not disagree`)
  }
}

// the examined list covers every seeded signing and uses a closed vocabulary
const OUTCOMES = ['RESOLVED', 'CONFLICT', 'UNRESOLVED']
for (const e of seed.examined) {
  if (!OUTCOMES.includes(e.outcome) || !e.detail) throw new Error(`examined ${e.player_slug}: bad outcome or no detail`)
}
for (const key of bySigning.keys()) {
  const [slug, year] = key.split('|')
  const e = seed.examined.find((x) => x.player_slug === slug && String(x.signing_year) === year)
  const kind = bySigning.get(key)[0].kind
  if (!e || e.outcome !== (kind === 'NEW' ? 'RESOLVED' : 'CONFLICT')) throw new Error(`${key}: the examined list must record the same outcome`)
}
for (const e of seed.examined.filter((x) => x.outcome !== 'UNRESOLVED')) {
  if (!bySigning.has(`${e.player_slug}|${e.signing_year}`)) throw new Error(`${e.player_slug}: marked ${e.outcome} but no report is seeded`)
}

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]))
const payload = sortKeys({
  organization_name: seed.organization_name,
  new_sources: seed.sources.map((s) => pick(s, ['source_name', 'source_type', 'title', 'url', 'author', 'publication_date', 'accessed_at', 'notes', 'source_tier'])),
  signing_reports: seed.signing_reports.map((r) => ({
    ...pick(r, ['ref', 'kind', 'player_slug', 'signing_year', 'amount', 'amount_basis', 'amount_precision', 'evidence_basis', 'confidence', 'note']),
    source_url: sources.get(r.source).url,
  })),
})
const json = JSON.stringify(payload)
if (json.includes('$m046$')) throw new Error('payload contains the dollar-quote tag')

let sql = fs.readFileSync(path.join(here, '046_template.sql'), 'utf8').replace(/\r\n/g, '\n')
if (!sql.includes('{{payload_json}}')) throw new Error('template has no {{payload_json}}')
sql = sql.split('{{payload_json}}').join(json)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/046_outcome_cost_research_batch.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines, ${seed.signing_reports.length} reports)\n`)

// the guarded, data-only rollback is generated from the same evidence so the two can never disagree
let rollback = fs.readFileSync(path.join(here, 'rollback_template.sql'), 'utf8').replace(/\r\n/g, '\n')
if (json.includes('$r046$')) throw new Error('payload contains the rollback dollar-quote tag')
rollback = rollback.split('{{payload_json}}').join(json)
const rdest = path.join(here, '../../release/sql/rollback-046.sql')
fs.writeFileSync(rdest, rollback)
process.stderr.write(`wrote ${path.relative(process.cwd(), rdest)}\n`)
