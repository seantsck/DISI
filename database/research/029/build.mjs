#!/usr/bin/env node
// Assembles database/sql/029_signing_network_intelligence.sql from:
//   029_template.sql       hand-written schema, triggers, views and guards
//   seed-evidence.json     the reviewed, directly read network facts
//   audit-report.json      written by audit.mjs; the build refuses to run if the audit failed
//
//   node database/research/029/audit.mjs && node database/research/029/build.mjs
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
const RETRIEVED_AT = '2026-10-08T23:45:00Z'
const sourceUrl = Object.fromEntries(seed.sources.map((s) => [s.key, s.url]))
const entityTypes = ['PERSON', 'ACADEMY', 'PROGRAM', 'SHOWCASE_LEAGUE', 'AGENCY', 'OTHER']
const compat = {
  TRAINED_WITH: ['PERSON'], DEVELOPED_AT: ['ACADEMY', 'PROGRAM'], SIGNED_OUT_OF: ['ACADEMY', 'PROGRAM'],
  SHOWCASED_IN: ['SHOWCASE_LEAGUE'], REPRESENTED_BY: ['PERSON', 'AGENCY'],
}
const slugs = new Set()
const entityBySlug = new Map()
for (const e of seed.entities) {
  if (slugs.has(e.slug)) throw new Error(`duplicate entity slug ${e.slug}`)
  slugs.add(e.slug)
  entityBySlug.set(e.slug, e)
  if (!entityTypes.includes(e.entity_type)) throw new Error(`${e.slug}: bad entity_type`)
  if (!sourceUrl[e.source]) throw new Error(`${e.slug}: unknown source`)
  if ((e.name_basis === 'DESCRIPTIVE') !== (e.anchor_slug != null)) throw new Error(`${e.slug}: a DESCRIPTIVE entity needs an anchor and only it may have one`)
  if (e.notes && e.notes.length > 500) throw new Error(`${e.slug}: notes over 500 characters`)
  if (e.anchor_slug && !slugs.has(e.anchor_slug)) throw new Error(`${e.slug}: the anchor must be listed before it`)
  if (e.anchor_slug && entityBySlug.get(e.anchor_slug).entity_type !== 'PERSON') throw new Error(`${e.slug}: the anchor must be a PERSON`)
}
for (const a of seed.aliases) {
  if (!slugs.has(a.entity_slug) || !sourceUrl[a.source]) throw new Error(`alias ${a.alias}: unresolved reference`)
}
const refs = new Set()
for (const r of seed.player_relationships) {
  if (refs.has(r.ref)) throw new Error(`duplicate relationship ref ${r.ref}`)
  refs.add(r.ref)
  const entity = entityBySlug.get(r.entity_slug)
  if (!entity || !sourceUrl[r.source]) throw new Error(`${r.ref}: unresolved reference`)
  if (!compat[r.relationship_type]?.includes(entity.entity_type)) throw new Error(`${r.ref}: ${r.relationship_type} does not accept ${entity.entity_type}`)
  if (!['PRE_SIGNING', 'AT_SIGNING', 'POST_SIGNING', 'UNKNOWN'].includes(r.stage)) throw new Error(`${r.ref}: bad stage`)
  if (r.note.length > 300) throw new Error(`${r.ref}: note over 300 characters`)
}
if (seed.entity_relationships.length || seed.identity_reviews.length) throw new Error('029 seeds no entity relationship and no identity review')
if (seed.player_relationships.some((r) => r.relationship_type === 'SCOUTED_BY')) throw new Error('SCOUTED_BY is out of scope for 029')

// ---- the deterministic lookup maps (explicit, fixed, engine-independent) ----------------------------------
const lowerMap = { a: 'áàâäãåāăą', c: 'çćč', d: 'ďđ', e: 'éèêëēėęě', i: 'íìîïīį', l: 'łľ', n: 'ñń', o: 'óòôöõøōő', r: 'ř', s: 'šś', t: 'ť', u: 'úùûüūůű', y: 'ýÿ', z: 'źżž' }
const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
let from = AZ
let to = AZ.toLowerCase()
for (const [target, chars] of Object.entries(lowerMap)) for (const ch of chars) { from += ch.toUpperCase(); to += target }
for (const [target, chars] of Object.entries(lowerMap)) for (const ch of chars) { from += ch; to += target }
if ([...from].length !== [...to].length || new Set([...from]).size !== [...from].length) throw new Error('lookup maps must be equal length with no duplicates')

// ---- period columns and shape checks (same semantics as 026: no invented day 1) -----------------------------------
const periodColumns = ['start', 'end'].map((side) => `  ${side}_precision text not null default 'UNKNOWN' check (${side}_precision in ('DAY', 'MONTH', 'YEAR', 'SEASON', 'UNKNOWN')),
  ${side}_date date,
  ${side}_year int check (${side}_year is null or ${side}_year between 1900 and 2100),
  ${side}_month int check (${side}_month is null or ${side}_month between 1 and 12),`).join('\n')
const periodChecks = (table) => [...['start', 'end'].map((side) => `  constraint ${table}_${side}_shape_check check (coalesce(case ${side}_precision
    when 'DAY' then ${side}_date is not null and ${side}_year = extract(year from ${side}_date)::int and ${side}_month = extract(month from ${side}_date)::int
    when 'MONTH' then ${side}_date is null and ${side}_year is not null and ${side}_month is not null
    when 'YEAR' then ${side}_date is null and ${side}_year is not null and ${side}_month is null
    when 'SEASON' then ${side}_date is null and ${side}_year is not null and ${side}_month is null
    else ${side}_date is null and ${side}_year is null and ${side}_month is null
  end, false))`),
`  constraint ${table}_period_order_check check ((start_date is null or end_date is null or end_date >= start_date) and (start_year is null or end_year is null or end_year >= start_year))`].join(',\n')

// ---- payload ------------------------------------------------------------------------------------------------------
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const payload = sortKeys({
  sources: seed.sources.map(({ key, ...s }) => s),
  entities: seed.entities.map((e) => ({ slug: e.slug, entity_type: e.entity_type, canonical_name: e.canonical_name, name_basis: e.name_basis, anchor_slug: e.anchor_slug,
    notes: e.notes, source_url: sourceUrl[e.source], evidence_basis: e.evidence_basis, confidence: e.confidence, retrieved_at: RETRIEVED_AT })),
  aliases: seed.aliases.map((a) => ({ entity_slug: a.entity_slug, alias: a.alias, alias_type: a.alias_type, language_code: a.language_code,
    source_url: sourceUrl[a.source], confidence: a.confidence, retrieved_at: RETRIEVED_AT })),
  player_relationships: seed.player_relationships.map((r) => ({ ref: r.ref, player_slug: r.player_slug, entity_slug: r.entity_slug, relationship_type: r.relationship_type,
    stage: r.stage, signing: r.signing, source_url: sourceUrl[r.source], evidence_basis: r.evidence_basis, confidence: r.confidence, retrieved_at: RETRIEVED_AT, note: r.note })),
})
const json = JSON.stringify(payload)
if (json.includes('$m029$')) throw new Error('payload contains the dollar-quote tag')

let sql = fs.readFileSync(path.join(here, '029_template.sql'), 'utf8').replace(/\r\n/g, '\n')
const fill = (name, value) => {
  const token = `{{${name}}}`
  if (!sql.includes(token)) throw new Error(`template has no ${token}`)
  sql = sql.split(token).join(value)
}
fill('lookup_from', from)
fill('lookup_to', to)
fill('period_columns', periodColumns)
fill('period_checks_ner', periodChecks('network_entity_relationships'))
fill('period_checks_pnr', periodChecks('player_network_relationships'))
fill('payload_json', json)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/029_signing_network_intelligence.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
