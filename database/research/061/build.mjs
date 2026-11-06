#!/usr/bin/env node
// Assembles database/sql/061_transaction_research_closure.sql and database/release/sql/rollback-061.sql from:
//   061_template.sql / rollback_template.sql   hand-written guards, steps and postconditions
//   research-evidence.json                     the reviewed transaction facts, sources and evidence (the only copy of the values)
//   baseline-build.json                        the measured pre-061 state (node database/research/061/measure.mjs --chain 060_... --baseline)
//
//   node database/research/061/build.mjs            write both files
//   node database/research/061/build.mjs --check    exit 1 unless both files equal the build output
//
// Deterministic: the same inputs always produce the same bytes. The build refuses anything the reviewed input or the baseline does not allow.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
export const MIGRATION = path.join(here, '../../sql/061_transaction_research_closure.sql')
export const ROLLBACK = path.join(here, '../../release/sql/rollback-061.sql')

const money = /^\d{1,12}\.\d{2}$/
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const CONFIDENCE = ['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED']
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)

/** Validates the reviewed input against the measured baseline and returns the migration payload. */
export function payloadFor(evidence, baseline) {
  const org = evidence.organization_name
  const srcs = new Map()
  for (const s of evidence.sources) {
    if (!/^https?:\/\/[^\s]+$/.test(s.url) || /^disi:/i.test(s.url)) throw new Error(`${s.key}: a source needs a real URL`)
    if (srcs.has(s.key) || [...srcs.values()].some((x) => x.url === s.url)) throw new Error(`${s.key}: duplicate source`)
    for (const f of ['source_name', 'source_type', 'source_tier', 'title', 'notes']) if (!s[f] || !String(s[f]).trim()) throw new Error(`${s.key}: ${f} is required`)
    if (!iso.test(s.accessed_at)) throw new Error(`${s.key}: accessed_at must be the retrieval time`)
    if (s.publication_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(s.publication_date)) throw new Error(`${s.key}: bad publication_date`)
    srcs.set(s.key, s)
  }
  const needSource = (k, where) => { if (!srcs.has(k)) throw new Error(`${where}: unknown source ${k}`); return k }
  const rows = baseline.transaction_rows
  const tgt = (event_key, side, type, name) => rows.targets.filter((r) => r.event_key === event_key && r.asset_side === side && r.asset_type === type && r.asset_name === name)

  const updates = evidence.amount_updates.map((u) => {
    if (!money.test(u.amount)) throw new Error(`${u.id}: not a 2-decimal non-negative amount`)
    if (!u.evidence?.length) throw new Error(`${u.id}: evidence is required`)
    const b = tgt(u.event_key, u.side, 'CASH', u.asset_name)
    if (b.length !== 1) throw new Error(`${u.id}: the baseline has ${b.length} matching CASH assets`)
    if (b[0].cash_amount_usd !== null) throw new Error(`${u.id}: the baseline amount is not NULL`)
    if (b[0].counterparty !== u.counterparty) throw new Error(`${u.id}: unexpected counterparty ${b[0].counterparty}`)
    return { id: u.id, event_key: u.event_key, side: u.side, asset_name: u.asset_name, counterparty: u.counterparty, amount: u.amount, field_name: u.field_name }
  })
  const inserts = evidence.asset_inserts.map((a) => {
    if (a.amount !== null && !money.test(a.amount)) throw new Error(`${a.id}: not a 2-decimal non-negative amount`)
    if (a.asset_type === 'INTERNATIONAL_BONUS_POOL_SPACE' && a.amount === '250000.00') throw new Error(`${a.id}: the 250,000 pool-space amount is not sourced and is never inferred`)
    if (a.asset_type === 'INTERNATIONAL_BONUS_POOL_SPACE' && a.id === 'cingrani_pool' && a.amount !== null) throw new Error('the Cingrani pool-space amount stays NULL')
    if (!['INTERNATIONAL_BONUS_POOL_SPACE', 'CASH'].includes(a.asset_type)) throw new Error(`${a.id}: bad asset type`)
    if (a.asset_type === 'CASH' && a.amount === null) throw new Error(`${a.id}: a triggered cash component carries its amount`)
    if (!a.role_note || !a.evidence?.length) throw new Error(`${a.id}: a role note and evidence are required`)
    needSource(a.source, a.id)
    const same = rows.targets.filter((r) => r.event_key === a.event_key && r.asset_side === a.side && r.asset_type === a.asset_type)
    if (a.asset_type === 'INTERNATIONAL_BONUS_POOL_SPACE' && same.length !== 0) throw new Error(`${a.id}: the event already has a pool-space asset`)
    if (a.asset_type === 'CASH' && same.length !== 1) throw new Error(`${a.id}: the event must have exactly one CASH asset on this side before the second component`)
    if (rows.targets.some((r) => r.event_key === a.event_key && r.asset_side === a.side && r.asset_name === a.asset_name)) throw new Error(`${a.id}: an asset with this name exists`)
    if (rows.targets.filter((r) => r.event_key === a.event_key && r.asset_side === a.side && r.asset_name === a.keeps_asset).length !== 1) throw new Error(`${a.id}: the kept asset ${a.keeps_asset} is not present exactly once`)
    return { id: a.id, event_key: a.event_key, side: a.side, asset_type: a.asset_type, asset_name: a.asset_name, counterparty: a.counterparty, amount: a.amount, field_name: a.field_name, source: a.source, role_note: a.role_note, keeps_asset: a.keeps_asset }
  })
  const events = evidence.events.map((e) => {
    needSource(e.source, e.id)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.transaction_date) || !['FREE_AGENT_SIGNING', 'FREE_AGENCY'].includes(e.transaction_type)) throw new Error(`${e.id}: bad event`)
    if (rows.garland.some((g) => g.event_key === e.event_key || g.transaction_date === e.transaction_date)) throw new Error(`${e.id}: an equivalent event exists in the baseline`)
    if (e.asset.asset_type !== 'PLAYER' || e.asset.mlb_id !== '279782' || e.asset.bref_id !== 'garlajo01') throw new Error(`${e.id}: the asset is Jon Garland (279782 / garlajo01)`)
    return { id: e.id, event_key: e.event_key, transaction_date: e.transaction_date, transaction_type: e.transaction_type, description: e.description, historical_label: e.historical_label, source: e.source, asset: e.asset }
  })
  if (events[0].transaction_date >= events[1].transaction_date) throw new Error('the Garland signing precedes his exit')
  const rowsEvidence = []
  const addEvidence = (kind, ref, event_key, field_name, list) => {
    for (const x of list) {
      needSource(x.source, ref)
      if (!CONFIDENCE.includes(x.confidence) || !x.note || x.note.length > 600) throw new Error(`${ref}: bad evidence`)
      rowsEvidence.push({ kind, ref, event_key, field_name, source: x.source, confidence: x.confidence, note: x.note })
    }
  }
  for (const u of evidence.amount_updates) addEvidence('asset', u.id, u.event_key, u.field_name, u.evidence)
  for (const a of evidence.asset_inserts) addEvidence('asset', a.id, a.event_key, a.field_name, a.evidence)
  for (const e of evidence.events) addEvidence('event', e.id, e.event_key, 'transaction_date', e.evidence)
  if (new Set(rowsEvidence.map((x) => `${x.event_key}|${x.field_name}|${x.source}`)).size !== rowsEvidence.length) throw new Error('duplicate evidence row')

  // the measured pre-061 state
  const h = baseline.headline
  if (h.cost_counts.known !== 81 || h.cost_counts.unknown !== 139 || h.cost_counts.known_usd !== '127632237.33' || h.cost_counts.signings !== 220) throw new Error('the baseline is not 220 / 81 known / 139 unknown / 127632237.33')
  if (h.metric[0].metric_key !== 'CAREER_BWAR' || h.metric[0].observations !== 58 || h.bwar_missing !== 39) throw new Error('the baseline is not CAREER_BWAR 58 / BWAR_MISSING 39')
  if (baseline.transaction_queue_rows.length !== 57 || baseline.value_queue_rows.length !== 79) throw new Error('the baseline queues are not 57 / 79')
  if (rows.sources.length !== 0 || rows.evidence.length !== 0) throw new Error('a 061 source or evidence row exists in the baseline')
  if (rows.garland.length !== 2 || rows.garland.some((g) => g.transaction_date > '2010-01-01')) throw new Error('the baseline Garland events are not the 2009 pair')
  const c = baseline.counts
  const pools = inserts.filter((a) => a.asset_type === 'INTERNATIONAL_BONUS_POOL_SPACE')
  return sortKeys({
    organization_name: org,
    sources: evidence.sources.map((s) => ({ key: s.key, url: s.url, source_name: s.source_name, source_type: s.source_type, source_tier: s.source_tier, title: s.title,
      publication_date: s.publication_date, accessed_at: s.accessed_at, notes: s.notes })),
    updates, inserts, events, evidence: rowsEvidence,
    delta: { events: events.length, assets: inserts.length + events.length, sources: evidence.sources.length, evidence: rowsEvidence.length,
      cash_assets: inserts.filter((a) => a.asset_type === 'CASH').length, cash_unknown: -updates.length,
      pool_assets: pools.length, pool_unknown: pools.filter((a) => a.amount === null).length },
    baseline: { cash_unknown: c.cash_unknown, pool_unknown: c.pool_unknown, future_considerations: c.future_considerations, ptbn: c.ptbn, resolutions: c.resolutions, events: c.events, assets: c.assets, evidence: c.evidence, sources: c.sources },
  })
}

export function assemble(evidence = read('research-evidence.json'), baseline = read('baseline-build.json')) {
  const json = JSON.stringify(payloadFor(evidence, baseline))
  const fill = (template, tag) => {
    if (json.includes(tag)) throw new Error(`payload contains the dollar-quote tag ${tag}`)
    let sql = fs.readFileSync(path.join(here, template), 'utf8').replace(/\r\n/g, '\n')
    if (!sql.includes('{{payload_json}}')) throw new Error(`${template} has no {{payload_json}}`)
    sql = sql.split('{{payload_json}}').join(json)
    if (/\{\{\w+\}\}/.test(sql)) throw new Error(`unreplaced placeholder in ${template}`)
    return sql
  }
  return { migration: fill('061_template.sql', '$m061$'), rollback: fill('rollback_template.sql', '$r061$') }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { migration, rollback } = assemble()
  if (process.argv.includes('--check')) {
    const same = (f, s) => fs.existsSync(f) && fs.readFileSync(f, 'utf8') === s
    if (!same(MIGRATION, migration) || !same(ROLLBACK, rollback)) { console.error('061 build output is stale: run node database/research/061/build.mjs'); process.exit(1) }
    console.log('061 build output is current')
  } else {
    fs.writeFileSync(MIGRATION, migration)
    fs.writeFileSync(ROLLBACK, rollback)
    process.stderr.write(`wrote ${path.relative(process.cwd(), MIGRATION)} and ${path.relative(process.cwd(), ROLLBACK)}\n`)
  }
}
