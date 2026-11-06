// Migration 061 research artifacts, without a database: the reviewed transaction facts (exact values), the source rules (real pages, actual retrieval
// times, no pseudo-source, nothing inaccessible claimed as read), the items that are deliberately NOT written, and the shape of the generated SQL
// (data only, no schema change, a refresh only on drift, a guarded rollback that deletes ordinary rows and keeps the sources).
//   UNKNOWN != ZERO   KNOWN COMPONENT != KNOWN AMOUNT   CONDITIONAL != GUARANTEED   A SALARY IS NOT TRADE CONSIDERATION

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assemble, payloadFor } from '../../database/research/061/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))
const evidence = read('database/research/061/research-evidence.json')
const baseline = read('database/research/061/baseline-build.json')
const audit = read('database/research/061/mapping.json')
// comments are stripped before string literals because the comments contain apostrophes
const strip = (sql, tag) => sql.replace(new RegExp(`\\$${tag}\\$[\\s\\S]*?\\$${tag}\\$`, 'g'), '').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")

test('the reviewed facts: six amounts, one pool amount, one known component with no amount, one conditional component now triggered, two Garland events — exactly', () => {
  assert.deepEqual(evidence.amount_updates.map((u) => [u.event_key, u.side, u.counterparty, u.amount]), [
    ['LAD_STL_2019_TONY_CINGRANI', 'INCOMING', 'St. Louis Cardinals', '2938710.00'], ['LAD_ATL_2017_ADRIAN_GONZALEZ', 'OUTGOING', 'Atlanta Braves', '4500000.00'],
    ['LAD_BOS_2020_JETER_DOWNS', 'INCOMING', 'Boston Red Sox', '48000000.00'], ['LAD_CIN_2018_YASIEL_PUIG', 'OUTGOING', 'Cincinnati Reds', '7000000.00'],
    ['LAD_MIN_2024_RAYNE_DONCON', 'OUTGOING', 'Minnesota Twins', '6000000.00'], ['LAD_TOR_2019_RONNY_BRITO', 'INCOMING', 'Toronto Blue Jays', '16400000.00']])
  assert.deepEqual(evidence.asset_inserts.map((a) => [a.event_key, a.asset_type, a.asset_name, a.amount]), [
    ['LAD_CIN_2025_ARNALDO_LANTIGUA', 'INTERNATIONAL_BONUS_POOL_SPACE', 'International bonus pool space', '1500000.00'],
    ['LAD_STL_2019_TONY_CINGRANI', 'INTERNATIONAL_BONUS_POOL_SPACE', 'International cap space (2019/2020)', null],
    ['LAD_MIN_2024_RAYNE_DONCON', 'CASH', 'Cash (additional, Margot 2025 option declined)', '2000000.00']])
  assert.deepEqual(evidence.events.map((e) => [e.event_key, e.transaction_date, e.transaction_type, e.asset.mlb_id, e.asset.bref_id]), [
    ['LAD_FREE_AGENT_SIGNING_2010_JON_GARLAND', '2010-11-26', 'FREE_AGENT_SIGNING', '279782', 'garlajo01'], ['LAD_FREE_AGENCY_2011_JON_GARLAND', '2011-10-30', 'FREE_AGENCY', '279782', 'garlajo01']])
  const exact = [...evidence.amount_updates, ...evidence.asset_inserts].filter((x) => x.amount !== null)
  assert.equal(exact.length, 8, 'eight exact financial facts')
  assert.ok(exact.every((x) => /^\d+\.\d{2}$/.test(x.amount) && Number(x.amount) > 0), 'every amount is a positive 2-decimal value; no zero')
  assert.deepEqual(evidence.expected, { exact_financial_facts: 8, undisclosed_resolutions: 0, known_component_amount_unknown: 1, events_added: 2, assets_added: 5, assets_updated: 6, sources_added: 12, evidence_rows: 17 })
})

test('what is NOT written: no 250,000 pool amount, no $8,000,000 on one asset, no Martinez / Vizcaino / Blake / Perez / Frias fact, no salary as cash', () => {
  const text = JSON.stringify([evidence.amount_updates, evidence.asset_inserts, evidence.events])
  assert.ok(!/\b250000\b/.test(text), 'the Cingrani pool amount is never inferred')
  assert.ok(!/\b8000000\b/.test(text), 'Margot is two components, never 8,000,000')
  for (const k of ['MAXIMO_MARTINEZ', 'JOSE_VIZCAINO', 'SANTANA_BLAKE', 'JERAL_PEREZ', 'CARLOS_FRIAS']) assert.ok(!text.includes(k), k)
  assert.ok(!/5000000|salary/i.test(JSON.stringify(evidence.events.map((e) => [e.description, e.asset]))), 'Garland\'s contract is not recorded')
  assert.ok(!evidence.sources.some((s) => /carlos-frias|jeral|maximo|vizcaino|casey-blake/i.test(s.url)))
  // the Cingrani pool component carries no amount, the Margot components are separate
  assert.equal(evidence.asset_inserts.find((a) => a.id === 'cingrani_pool').amount, null)
  assert.equal(evidence.amount_updates.find((u) => u.id === 'margot_cash_guaranteed').amount, '6000000.00')
  assert.equal(evidence.asset_inserts.find((a) => a.id === 'margot_cash_triggered').amount, '2000000.00')
  assert.notEqual(evidence.amount_updates.find((u) => u.id === 'margot_cash_guaranteed').asset_name, evidence.asset_inserts.find((a) => a.id === 'margot_cash_triggered').asset_name)
})

test('source rules: twelve distinct real https pages, retrieval times on 2026-11-05, an archive read is named and its direct failure recorded, no pseudo-source', () => {
  assert.equal(evidence.sources.length, 12)
  assert.equal(new Set(evidence.sources.map((s) => s.url)).size, 12)
  for (const s of evidence.sources) {
    assert.match(s.url, /^https:\/\/[^\s]+$/)
    assert.ok(!/^disi:/i.test(s.url))
    assert.match(s.accessed_at, /^2026-11-05T23:1[01]:\d{2}Z$/, `${s.key}: the retrieval time of this build`)
    for (const f of ['source_name', 'source_type', 'source_tier', 'title', 'notes']) assert.ok(s[f] && String(s[f]).trim(), `${s.key}.${f}`)
    if (/Internet Archive snapshot of \d{4}-\d{2}-\d{2}T/.test(s.notes)) assert.match(s.notes, /^The live page answered HTTP (403|406|429) to a direct request at 2026-11-05T23:10:11Z, so it was read through the Internet Archive snapshot/)
    else assert.ok(!/Internet Archive/.test(s.notes))
  }
  // every evidence row and asset source names a registered source
  const keys = new Set(evidence.sources.map((s) => s.key))
  for (const x of [...evidence.amount_updates, ...evidence.asset_inserts, ...evidence.events]) for (const e of x.evidence) { assert.ok(keys.has(e.source), e.source); assert.ok(e.note.length <= 600) }
  for (const a of evidence.asset_inserts) assert.ok(keys.has(a.source))
  assert.deepEqual(evidence.sources.filter((s) => /Internet Archive snapshot/.test(s.notes)).map((s) => s.key).sort(),
    ['betts_mlb', 'cardinals_release', 'garland_mlb', 'margot_cbs', 'margot_startribune', 'martin_mlb', 'puig_mlb'])
})

test('the post-audit amendment is recorded: the original 52-item audit is preserved and the changes after it are explicit', () => {
  assert.equal(audit.total_items, 52)
  assert.equal(audit.classification_counts.APPLY_EXACT, 9)
  const amendment = read('database/research/061/amendment.json')
  assert.equal(amendment.original_audit_commit, '60c6dc44125a6a9b7fc0bfd08f98510006c0ff22')
  assert.deepEqual(Object.keys(amendment.decisions).sort(), ['betts_price', 'cingrani_cash', 'cingrani_pool', 'frias', 'garland', 'jeral_perez', 'lantigua', 'margot', 'martin_brito', 'puig', 'gonzalez_kemp'].sort())
  assert.equal(amendment.decisions.cingrani_pool.change, 'REMOVED_250000_EXACT_AMOUNT_NOW_KNOWN_COMPONENT_AMOUNT_NULL')
  assert.equal(amendment.decisions.frias.outcome, 'HOLD_SOURCE_UNREADABLE')
  assert.equal(amendment.decisions.jeral_perez.outcome, 'UNRESOLVED_NO_WRITE')
  assert.equal(amendment.decisions.margot.condition_triggered, true)
})

test('the generated SQL: data only, SET LOCAL timeout, phase notices, a refresh only on drift; the rollback deletes ordinary rows, keeps sources and refuses on dependents', () => {
  const { migration, rollback } = assemble()
  for (const [sql, tag] of [[migration, 'm061'], [rollback, 'r061']]) {
    const body = strip(sql, tag)
    assert.ok(!/\b(create|alter|drop)\s+(table|view|function|trigger|policy|index|type|schema)\b/i.test(body.replace(/create temporary table/gi, '')), 'no schema change')
    assert.ok(!/\b(grant|revoke)\b/i.test(body), 'no grant change')
    assert.ok(!/transaction_asset_resolutions\s*\(/i.test(body) && !/insert\s+into\s+public\.transaction_asset_resolutions/i.test(body), 'no resolution row is written')
    assert.ok(!/\bdelete\s+from\s+public\.(sources|signings|transaction_asset_resolutions|signing_financial)/i.test(body), 'sources and sealed tables are never deleted')
    assert.match(sql, /^begin;\nset local statement_timeout = '600s';$/m)
    assert.match(body, /if exists \(select 1 from public\.disi_product_snapshot_drift\(\) where missing_rows \+ extra_rows <> 0\) then\s+perform \* from public\.disi_refresh_product_snapshots\(\)/)
  }
  assert.equal((migration.match(/raise notice '061 phase/g) || []).length, 4)
  assert.equal((rollback.match(/raise notice 'rollback-061 phase/g) || []).length, 4)
  assert.match(strip(migration, 'm061'), /insert into public\.sources/)
  assert.ok(!/update public\.signings|update public\.signing_financial/i.test(strip(migration, 'm061')))
  assert.ok(!/cash_amount_usd = 0|pool_space_amount_usd = 0/.test(migration.replace(/--.*$/gm, '')) || /raise exception/.test(migration))
})

test('the build is deterministic and refuses a baseline that is not the audited pre-061 state', () => {
  assert.equal(assemble().migration, assemble().migration)
  const b = structuredClone(baseline)
  b.headline.cost_counts.known = 80
  assert.throws(() => payloadFor(evidence, b), /81 known/)
  const b2 = structuredClone(baseline)
  b2.transaction_rows.garland.push({ event_key: 'X', transaction_date: '2010-11-26' })
  assert.throws(() => payloadFor(evidence, b2), /2009 pair|equivalent event/)
})
