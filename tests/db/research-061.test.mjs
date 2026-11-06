// Migration 061: transaction research closure. The 060 database is built (001-060), 061 is applied for real, and the tests prove that exactly the
// reviewed transaction facts are written: six existing CASH amounts, a $1,500,000 Lantigua pool-space asset, a Cingrani pool-space component whose
// amount stays NULL (no $250,000 is inferred), Margot's guaranteed $6,000,000 and his separate triggered $2,000,000, and the two ends of Jon Garland's
// 2011 Dodgers control interval; that Frias and Jeral Perez stay unresolved and Martinez, Vizcaino and Blake are not written; that no zero is inferred;
// that no signing, ledger row, outcome, WAR row, metric, resolution, observation or prediction output moves; and that 061 is idempotent, guarded,
// reproducible and exactly reversible (the source rows stay as provenance).
//   UNKNOWN != ZERO   KNOWN COMPONENT != KNOWN AMOUNT   CONDITIONAL != GUARANTEED   A SALARY IS NOT TRADE CONSIDERATION

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'
import { measure } from '../../database/research/061/measure.mjs'
import { assemble, payloadFor } from '../../database/research/061/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '061_transaction_research_closure.sql'
const sql061 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback061 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-061.sql'), 'utf8')
const rollback049 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-049.sql'), 'utf8')
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'database/research/061/research-evidence.json'), 'utf8'))
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'database/research/061/baseline-build.json'), 'utf8'))
const SNAP_DROP = ['generation_id', 'refreshed_at', 'created_at', 'generated_at', 'snapshot_at']
const WRITTEN_TABLES = ['evidence', 'sources', 'transaction_event_assets', 'transaction_events']

let chain
let pre060Dump
let post061Dump
let pre
let post
let preTables
let postTables
let preGen
let preVerify
const q = (sql, params) => chain.query(sql, params)
const R = (x) => (Array.isArray(x) ? x : x.rows)
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const clone = async (dump) => {
  const db = new PGlite({ loadDataDir: dump, extensions: { pgcrypto } })
  return { db, query: async (s, p) => (await db.query(s, p)).rows, close: () => db.close() }
}
const failsWith = async (c, sql, pattern) => {
  try { await c.db.exec(sql) } catch (e) {
    await c.db.exec('rollback;').catch(() => {})
    assert.match(String(e.message), pattern)
    return
  }
  assert.fail(`expected the statement to fail with ${pattern}`)
}
const tableHashes = async (c = chain, drop = []) => {
  const tables = R(await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5(R(await c.query(`select (to_jsonb(t) - 'updated_at' ${drop.map((k) => `- '${k}'`).join(' ')})::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const changedTables = (a, b) => Object.keys(a).filter((t) => a[t] !== b[t]).sort()
const generation = async (c = chain) => R(await c.query(`select max(generation_id)::int as g from public.product_executive_snapshot`))[0].g
const drift = async (c = chain) => R(await c.query(`select count(*)::int as n from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`))[0].n
const singleGeneration = async (c = chain) => {
  const tables = R(await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'product\\_%' order by 1`)).map((r) => r.relname)
  const gens = new Set()
  for (const t of tables) for (const r of R(await c.query(`select distinct generation_id::int as g from public.${t}`))) gens.add(r.g)
  return [...gens]
}
const verify = async (c = chain) => { const r = await checkInvariants(async (s, p) => R(await c.query(s, p)), CANONICAL_EXPECTATIONS); return { total: r.hard.length, failed: failedChecks(r).map((x) => x.name) } }
const asset = async (c, eventKey, side, name) => R(await c.query(`select a.asset_type, a.asset_name, a.cash_amount_usd::text as cash, a.pool_space_amount_usd::text as pool, o.name as counterparty, a.role_note, so.url as source_url
  from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id left join public.organizations o on o.id = a.counterparty_organization_id left join public.sources so on so.id = a.source_id
  where e.event_key = $1 and a.asset_side = $2 and a.asset_name = $3`, [eventKey, side, name]))
// a logical image of the written tables: surrogate ids and timestamps removed, so a reapply compares equal to the first apply
const logicalRows = async (c) => ({
  events: R(await c.query(`select e.event_key, e.transaction_date::text, e.transaction_type, e.description, e.historical_label, fo.name as from_org, so.url as source_url from public.transaction_events e
    left join public.organizations fo on fo.id = e.from_organization_id left join public.sources so on so.id = e.source_id order by 1`)).map((r) => JSON.stringify(r)),
  assets: R(await c.query(`select e.event_key, a.asset_side, a.asset_type, a.asset_name, a.cash_amount_usd::text as cash, a.pool_space_amount_usd::text as pool, a.role_note, a.bref_id, a.mlb_id, o.name as cp, so.url as source_url
    from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id left join public.organizations o on o.id = a.counterparty_organization_id left join public.sources so on so.id = a.source_id order by 1, 2, 4`)).map((r) => JSON.stringify(r)),
  evidence: R(await c.query(`select e.event_key, ev.field_name, ev.confidence::text, so.url, ev.evidence_note from public.evidence ev join public.transaction_events e on e.id = ev.entity_id and ev.entity_type = 'transaction_event'
    join public.sources so on so.id = ev.source_id order by 1, 2, 4`)).map((r) => JSON.stringify(r)),
  sources: R(await c.query(`select url, source_name, source_type, source_tier, title, publication_date::text, accessed_at::text, notes from public.sources where url in (${evidence.sources.map((s) => `'${s.url}'`).join(', ')}) order by 1`)).map((r) => JSON.stringify(r)),
})
const byIssue = (rows) => Object.fromEntries(Object.entries(rows.reduce((a, r) => ({ ...a, [r.issue]: (a[r.issue] ?? 0) + 1 }), {})).sort())

before(async () => {
  chain = await buildChainThrough('060_owner_reviewed_acquisition_costs.sql')
  pre060Dump = await chain.db.dumpDataDir('none')
  pre = await measure(q)
  preTables = await tableHashes(chain, SNAP_DROP)
  preGen = await generation()
  preVerify = await verify()
  await chain.db.exec(sql061)
  post = await measure(q)
  postTables = await tableHashes(chain, SNAP_DROP)
  post061Dump = await chain.db.dumpDataDir('none')
}, { timeout: 1500000 })

after(async () => { await chain?.close() })

test('061 follows 060 in the manifest as the last file, is frozen at its released hash; the migration and rollback are the deterministic build output', () => {
  const i = manifest.canonical_sql.indexOf(FILE)
  assert.equal(manifest.canonical_sql[i - 1], '060_owner_reviewed_acquisition_costs.sql')
  assert.equal(i, manifest.canonical_sql.length - 1)
  assert.equal(manifest.notes.canonical_build_count, manifest.canonical_sql.length)
  assert.equal(manifest.canonical_sql.length, 65)
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  assert.equal(Object.keys(frozen).length, 65)
  assert.equal(frozen[FILE], crypto.createHash('sha1').update(sql061.replace(/\r\n/g, '\n')).digest('hex'))
  assert.equal(frozen[FILE], 'dd59aa1c962efbc1315925c8c7feb7cf336c94ff')
  assert.equal(crypto.createHash('sha256').update(sql061).digest('hex'), '63afb49e65188e4598aad83db6a5daf8836adf7e67e29f71f9fa0bd3a79dd01f')
  assert.equal(crypto.createHash('sha256').update(rollback061).digest('hex'), '84ca0efcc8c5fb5b4a250cc18bebe6a5d058c0ee30274608cab2ac80958b7a70')
  assert.match(sql061, /^-- DISI v0\.46\n-- 061_transaction_research_closure\.sql\n/)
  assert.match(rollback061, /^-- DISI rollback of Migration 061/)
  const built = assemble()
  assert.equal(built.migration, sql061, 'the migration is the build output of the reviewed input')
  assert.equal(built.rollback, rollback061, 'the rollback is the build output of the same input')
  assert.equal(assemble().migration, built.migration, 'the build is deterministic')
  assert.ok(!/\bcreate (table|view|function|type|or replace view)\b/i.test(sql061.replace(/--.*$/gm, '')), 'data only: no table, view, function or enum is created')
})

test('frozen history 001-061 is byte-for-byte unchanged (line endings normalised)', () => {
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  for (const [f, sha1] of Object.entries(frozen)) {
    assert.equal(crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', f), 'utf8').replace(/\r\n/g, '\n')).digest('hex'), sha1, f)
  }
  assert.equal(frozen['060_owner_reviewed_acquisition_costs.sql'], '19a63a45ce75ab17e01154259035e52a932dbd7e')
  assert.equal(frozen['061_transaction_research_closure.sql'], 'dd59aa1c962efbc1315925c8c7feb7cf336c94ff')
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'database/sql/060_owner_reviewed_acquisition_costs.sql'))).digest('hex'), '525afef8fb91cc059ca2f338faaf9e6d37c89c0bc6d0f302c7dfa01ebf10db30')
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'database/release/sql/rollback-060.sql'))).digest('hex'), '1bd46dcfcb003375a1edb2f0e3587c55614bfcdc75e368d755078a9c94b951b8')
})

test('baseline: 061 was written against exactly this 060 state (81 / 139, CAREER_BWAR 58, BWAR_MISSING 39, queues 57 / 79, no 061 source or evidence)', () => {
  assert.deepEqual(pre.counts, baseline.counts)
  assert.deepEqual(pre.transaction_rows, baseline.transaction_rows)
  // the fingerprints carry surrogate ids, so they are compared within one database (pre vs post), never across builds
  assert.deepEqual([pre.headline.cost_counts.signings, pre.headline.cost_counts.known, pre.headline.cost_counts.unknown, pre.headline.cost_counts.known_usd], [220, 81, 139, '127632237.33'])
  assert.deepEqual([pre.headline.metric[0].observations, pre.headline.bwar_missing], [58, 39])
  assert.deepEqual([pre.transaction_queue_rows.length, pre.value_queue_rows.length], [57, 79])
  assert.equal(preGen, 15)
  assert.deepEqual(preVerify, { total: 259, failed: [] })
})

test('the build refuses a malformed or no-longer-applicable input (an unsourced 250000 pool amount, a non-NULL baseline, a fake source, a missing source, a second Cingrani amount)', () => {
  const edit = (f) => { const e = JSON.parse(JSON.stringify(evidence)); f(e); return e }
  assert.throws(() => payloadFor(edit((e) => { e.asset_inserts[1].amount = '250000.00' }), baseline), /250,000 pool-space amount is not sourced/)
  assert.throws(() => payloadFor(edit((e) => { e.asset_inserts[1].amount = '1.00' }), baseline), /Cingrani pool-space amount stays NULL|not sourced/)
  assert.throws(() => payloadFor(edit((e) => { e.sources[0].url = 'disi:lantigua' }), baseline), /real URL/)
  assert.throws(() => payloadFor(edit((e) => { e.amount_updates[0].evidence[0].source = 'nope' }), baseline), /unknown source/)
  assert.throws(() => payloadFor(edit((e) => { e.amount_updates[0].amount = '4500000' }), baseline), /2-decimal/)
  assert.throws(() => payloadFor(edit((e) => { e.sources[0].accessed_at = 'yesterday' }), baseline), /retrieval time/)
  assert.throws(() => payloadFor(edit((e) => { e.events[0].asset.mlb_id = '1' }), baseline), /Jon Garland/)
  const b = JSON.parse(JSON.stringify(baseline)); b.transaction_rows.targets.find((t) => t.event_key === 'LAD_BOS_2020_JETER_DOWNS' && t.asset_type === 'CASH').cash_amount_usd = '1.00'
  assert.throws(() => payloadFor(evidence, b), /baseline amount is not NULL/)
  const b2 = JSON.parse(JSON.stringify(baseline)); b2.transaction_queue_rows.pop()
  assert.throws(() => payloadFor(evidence, b2), /57 \/ 79/)
})

test('sources: twelve real pages, none a pseudo-source; each carries its actual retrieval time and says how it was read (an archive snapshot is named, never hidden)', async () => {
  assert.equal(post.transaction_rows.sources.length, 12)
  for (const s of evidence.sources) {
    const row = post.transaction_rows.sources.find((x) => x.url === s.url)
    assert.ok(row, s.url)
    assert.match(s.url, /^https:\/\//)
    assert.ok(!/^disi:/i.test(s.url))
    assert.equal(new Date(row.accessed_at).toISOString().replace('.000Z', 'Z'), s.accessed_at, `${s.key} accessed_at`)
    assert.ok(row.title && row.source_name && row.source_type && row.source_tier)
    if (/Internet Archive snapshot/.test(s.notes)) assert.match(s.notes, /answered HTTP (403|406|429) to a direct request at 2026-11-05T23:10:11Z/)
    else assert.ok(!/Internet Archive/.test(s.notes), `${s.key} was read directly`)
  }
  // seven pages were read through an archive snapshot, five directly; the Frias page (unreadable) is not a source here
  assert.equal(evidence.sources.filter((s) => /Internet Archive snapshot/.test(s.notes)).length, 7)
  assert.ok(!post.transaction_rows.sources.some((s) => /indians-acquire-rhp-carlos-frias/.test(s.url)))
  assert.equal(post.counts.sources, pre.counts.sources + 12)
})

test('the six existing CASH assets: NULL -> the reported amount, nothing else on the row; no CASH asset is added or removed except Margot\'s second component', async () => {
  const want = { LAD_STL_2019_TONY_CINGRANI: ['INCOMING', '2938710.00'], LAD_ATL_2017_ADRIAN_GONZALEZ: ['OUTGOING', '4500000.00'], LAD_BOS_2020_JETER_DOWNS: ['INCOMING', '48000000.00'],
    LAD_CIN_2018_YASIEL_PUIG: ['OUTGOING', '7000000.00'], LAD_MIN_2024_RAYNE_DONCON: ['OUTGOING', '6000000.00'], LAD_TOR_2019_RONNY_BRITO: ['INCOMING', '16400000.00'] }
  for (const [ev, [side, amount]] of Object.entries(want)) {
    const [b] = pre.transaction_rows.targets.filter((t) => t.event_key === ev && t.asset_type === 'CASH' && t.asset_name === 'Cash')
    const [a] = post.transaction_rows.targets.filter((t) => t.event_key === ev && t.asset_type === 'CASH' && t.asset_name === 'Cash')
    assert.equal(b.cash_amount_usd, null, `${ev} was unknown`)
    assert.equal(a.cash_amount_usd, amount, ev)
    assert.equal(a.asset_side, side)
    assert.deepEqual({ ...a, cash_amount_usd: null }, { ...b, cash_amount_usd: null }, `${ev}: only the amount changed`)
  }
  assert.equal(post.counts.cash_assets, pre.counts.cash_assets + 1)
  assert.equal(post.counts.cash_unknown, pre.counts.cash_unknown - 6)
  assert.equal(pre.counts.cash_unknown, 17)
})

test('Lantigua gains a $1,500,000 pool-space asset; its Future Considerations placeholder is kept; no duplicate pool asset', async () => {
  const rows = post.transaction_rows.targets.filter((t) => t.event_key === 'LAD_CIN_2025_ARNALDO_LANTIGUA')
  assert.deepEqual(rows.map((r) => [r.asset_type, r.asset_name, r.pool_space_amount_usd]).sort(), [['FUTURE_CONSIDERATIONS', 'Future considerations', null], ['INTERNATIONAL_BONUS_POOL_SPACE', 'International bonus pool space', '1500000.00']])
  assert.equal(rows.filter((r) => r.asset_type === 'INTERNATIONAL_BONUS_POOL_SPACE').length, 1)
  assert.equal(rows.find((r) => r.asset_type === 'FUTURE_CONSIDERATIONS').source_url, pre.transaction_rows.targets.find((t) => t.event_key === 'LAD_CIN_2025_ARNALDO_LANTIGUA').source_url)
  assert.equal(rows.find((r) => r.asset_type === 'INTERNATIONAL_BONUS_POOL_SPACE').source_url, 'https://www.truebluela.com/2025/1/17/24346370/dodgers-reds-trade-arnaldo-lantigua-international-bonus-pool-roki-sasaki')
})

test('Cingrani / Gyorko: the cash is filled; the pool-space component is KNOWN with an UNKNOWN (NULL) amount; no $250,000 is inferred; the placeholder stays', async () => {
  const rows = post.transaction_rows.targets.filter((t) => t.event_key === 'LAD_STL_2019_TONY_CINGRANI')
  const pool = rows.filter((r) => r.asset_type === 'INTERNATIONAL_BONUS_POOL_SPACE')
  assert.equal(pool.length, 1)
  assert.equal(pool[0].pool_space_amount_usd, null)
  assert.equal(pool[0].counterparty, 'St. Louis Cardinals')
  assert.match(pool[0].role_note, /states no amount/)
  assert.equal(pool[0].source_url, 'https://www.mlb.com/press-release/cardinals-announce-trade-with-dodgers')
  assert.equal(rows.find((r) => r.asset_type === 'CASH').cash_amount_usd, '2938710.00')
  assert.equal(rows.filter((r) => r.asset_type === 'FUTURE_CONSIDERATIONS').length, 1)
  assert.equal((await q(`select count(*)::int as n from public.transaction_event_assets where pool_space_amount_usd = 250000`))[0].n, 0)
  assert.equal((await q(`select count(*)::int as n from public.transaction_event_assets where pool_space_amount_usd = 0 or cash_amount_usd = 0`))[0].n, 0, 'no zero is inferred')
  assert.equal(post.counts.pool_assets, pre.counts.pool_assets + 2)
  assert.equal(post.counts.pool_unknown, pre.counts.pool_unknown + 1)
  assert.equal(post.counts.future_considerations, pre.counts.future_considerations, 'no placeholder is retyped or removed')
})

test('Margot: the guaranteed $6,000,000 and the triggered $2,000,000 are two separate CASH assets; neither is stored as $8,000,000; the second says it is owed, not paid', async () => {
  const rows = post.transaction_rows.targets.filter((t) => t.event_key === 'LAD_MIN_2024_RAYNE_DONCON' && t.asset_type === 'CASH')
  assert.deepEqual(rows.map((r) => [r.asset_side, r.asset_name, r.cash_amount_usd, r.counterparty]).sort((a, b) => a[1].localeCompare(b[1])),
    [['OUTGOING', 'Cash', '6000000.00', 'Minnesota Twins'], ['OUTGOING', 'Cash (additional, Margot 2025 option declined)', '2000000.00', 'Minnesota Twins']])
  assert.equal(rows.some((r) => r.cash_amount_usd === '8000000.00'), false)
  const add = rows.find((r) => r.asset_name.startsWith('Cash (additional'))
  assert.match(add.role_note, /payable 2026-12-01/)
  assert.match(add.role_note, /declined 2024-11-01/)
  assert.ok(!/\bpaid\b/i.test(add.role_note.replace(/not claim|payable|owe/g, '')) || /owe/.test(add.role_note))
  assert.equal(add.source_url, 'https://www.cbsnews.com/minnesota/news/kyle-farmer-manuel-margot-free-agents-twins/')
  const ev = post.transaction_rows.evidence.filter((e) => e.event_key === 'LAD_MIN_2024_RAYNE_DONCON')
  assert.deepEqual(ev.map((e) => e.field_name).sort(), ['cash_amount_usd', 'cash_amount_usd', 'cash_amount_usd_additional_option_declined'])
})

test('Frias and Jeral Perez stay unresolved; Martinez, Vizcaino and Blake keep their NULL amounts; no resolution row is written', async () => {
  assert.deepEqual([pre.counts.resolutions, post.counts.resolutions, post.counts.active_resolutions], [7, 7, 7])
  assert.equal(pre.fingerprints.resolutions, post.fingerprints.resolutions)
  for (const [ev, type, name] of [['LAD_CLE_2017_CARLOS_FRIAS', 'PLAYER_TO_BE_NAMED', 'Player to be named later'], ['LAD_CWS_2024_JERAL_PEREZ', 'PLAYER_TO_BE_NAMED', 'Player to be named later or cash considerations']]) {
    const [a] = await q(`select a.id from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id where e.event_key = $1 and a.asset_type = $2 and a.asset_name = $3`, [ev, type, name])
    assert.ok(a, ev)
    assert.equal((await q(`select count(*)::int as n from public.transaction_asset_resolutions where placeholder_asset_id = $1`, [a.id]))[0].n, 0, `${ev} has no resolution`)
  }
  for (const [ev, type] of [['LAD_CWS_2023_MAXIMO_MARTINEZ', 'INTERNATIONAL_BONUS_POOL_SPACE'], ['LAD_NYY_2000_JOSE_VIZCAINO', 'CASH'], ['LAD_CLE_2008_SANTANA_BLAKE', 'CASH']]) {
    const rows = await q(`select a.cash_amount_usd, a.pool_space_amount_usd from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id where e.event_key = $1 and a.asset_type = $2`, [ev, type])
    assert.ok(rows.length >= 1)
    for (const r of rows) assert.deepEqual([r.cash_amount_usd, r.pool_space_amount_usd], [null, null], `${ev} stays unknown`)
  }
  // every other unknown CASH amount stays NULL: the 11 that remain are exactly the baseline minus the six filled
  const stillUnknown = (await q(`select e.event_key from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id where a.asset_type = 'CASH' and a.cash_amount_usd is null order by 1`)).map((r) => r.event_key)
  assert.deepEqual(stillUnknown, ['BOS_LAD_2012_GONZALEZ_BECKETT_CRAWFORD', 'CHC_LAD_2000_VALDEZ_REACQ', 'LAD_ATL_2006_AYBAR_BETEMIT', 'LAD_ATL_2024_ELIO_CAMPOS', 'LAD_CLE_2008_SANTANA_BLAKE', 'LAD_CWS_2001_GARY_MAJEWSKI',
    'LAD_DET_2023_EDDYS_LEONARD', 'LAD_NYM_1998_GREG_MCMICHAEL', 'LAD_NYY_2000_JOSE_VIZCAINO', 'LAD_TB_2006_DIONER_NAVARRO', 'LAD_TEX_2021_BILLY_MCKINNEY'])
})

test('Garland: FREE_AGENT_SIGNING 2010-11-26 and FREE_AGENCY 2011-10-30 are added; the 2011 interval opens and closes on them; the 2009 interval is untouched; no CASH asset and no salary', async () => {
  const g = post.transaction_rows.garland
  assert.deepEqual(g.map((r) => [r.event_key, r.transaction_date, r.transaction_type, r.asset_side]), [
    ['LAD_ARI_2009_TONY_ABREU', '2009-08-31', 'TRADE', 'INCOMING'], ['LAD_FREE_AGENCY_2009_JON_GARLAND', '2009-11-05', 'FREE_AGENCY', 'OUTGOING'],
    ['LAD_FREE_AGENT_SIGNING_2010_JON_GARLAND', '2010-11-26', 'FREE_AGENT_SIGNING', 'INCOMING'], ['LAD_FREE_AGENCY_2011_JON_GARLAND', '2011-10-30', 'FREE_AGENCY', 'OUTGOING']])
  assert.deepEqual(pre.transaction_rows.garland.map((r) => r.event_key), ['LAD_ARI_2009_TONY_ABREU', 'LAD_FREE_AGENCY_2009_JON_GARLAND'])
  for (const r of g.slice(2)) { assert.equal(r.bref_id, 'garlajo01'); assert.equal(r.mlb_id, '279782'); assert.equal(r.source_url, 'https://www.mlb.com/player/jon-garland-279782') }
  assert.equal((await q(`select count(*)::int as n from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id where e.event_key in ('LAD_FREE_AGENT_SIGNING_2010_JON_GARLAND', 'LAD_FREE_AGENCY_2011_JON_GARLAND') and a.asset_type <> 'PLAYER'`))[0].n, 0)
  const [i09, i11] = post.transaction_rows.garland_intervals
  assert.deepEqual(pre.transaction_rows.garland_intervals.length, 1)
  assert.deepEqual(i09, pre.transaction_rows.garland_intervals[0], 'the 2009 interval is exactly as before')
  assert.equal(i09.interval_status, 'CLOSED_EXIT_RECORDED')
  assert.deepEqual([i11.start_event_key, i11.interval_start, i11.exit_event_key, i11.interval_end, i11.interval_status, i11.exit_method],
    ['LAD_FREE_AGENT_SIGNING_2010_JON_GARLAND', '2010-11-26', 'LAD_FREE_AGENCY_2011_JON_GARLAND', '2011-10-30', 'CLOSED_EXIT_RECORDED', 'FREE_AGENCY'])
  assert.equal(i11.is_lineage_interval, false, 'a free-agent signing is not a trade-package lineage')
})

test('queue effect: transaction queue 57 -> 51 (six CASH_AMOUNT_UNKNOWN and Garland\'s DODGERS_RETURN row leave; the Cingrani pool component enters as POOL_SPACE_AMOUNT_UNKNOWN); value queue 79 -> 79, rows identical', () => {
  assert.equal(pre.transaction_queue_rows.length, 57)
  assert.equal(post.transaction_queue_rows.length, 51)
  const a = byIssue(pre.transaction_queue_rows), b = byIssue(post.transaction_queue_rows)
  assert.deepEqual(Object.fromEntries(Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]).map((k) => [k, [a[k], b[k]]])),
    { CASH_AMOUNT_UNKNOWN: [17, 11], DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION: [6, 5], POOL_SPACE_AMOUNT_UNKNOWN: [1, 2] })
  const key = (r) => JSON.stringify([r.issue, r.event_key, r.asset_name, r.player_slug])
  const A = new Set(pre.transaction_queue_rows.map(key)), B = new Set(post.transaction_queue_rows.map(key))
  assert.deepEqual([...A].filter((k) => !B.has(k)).map((k) => JSON.parse(k)[1]).sort(), ['LAD_ATL_2017_ADRIAN_GONZALEZ', 'LAD_BOS_2020_JETER_DOWNS', 'LAD_CIN_2018_YASIEL_PUIG', 'LAD_FREE_AGENCY_2009_JON_GARLAND', 'LAD_MIN_2024_RAYNE_DONCON', 'LAD_STL_2019_TONY_CINGRANI', 'LAD_TOR_2019_RONNY_BRITO'])
  assert.deepEqual([...B].filter((k) => !A.has(k)).map((k) => JSON.parse(k)), [['POOL_SPACE_AMOUNT_UNKNOWN', 'LAD_STL_2019_TONY_CINGRANI', 'International cap space (2019/2020)', null]])
  assert.deepEqual(post.value_queue_rows, pre.value_queue_rows)
  assert.equal(post.value_queue_rows.length, 79)
})

test('isolation: only evidence, sources, transaction_events and transaction_event_assets changed; signings, bonuses, the ledger, outcomes, WAR, metrics, development, benchmarks and every prediction output are unchanged', async () => {
  assert.deepEqual(changedTables(preTables, postTables), WRITTEN_TABLES)
  assert.deepEqual(post.headline.cost_counts, pre.headline.cost_counts)
  assert.deepEqual([post.headline.cost_counts.known, post.headline.cost_counts.unknown, post.headline.cost_counts.known_usd], [81, 139, '127632237.33'])
  assert.deepEqual(post.headline.metric, pre.headline.metric)
  assert.equal(post.headline.metric[0].observations, 58)
  assert.equal(post.headline.bwar_missing, 39)
  assert.deepEqual(post.headline.research_task_types, pre.headline.research_task_types)
  assert.deepEqual(post.headline.value_totals, pre.headline.value_totals)
  assert.deepEqual(post.headline.prediction, pre.headline.prediction)
  assert.deepEqual([post.headline.prediction.supported_models, post.headline.prediction.probabilities], [0, 0])
  for (const k of ['ledger', 'resolutions', 'fingerprints', 'executive_overview_body_md5']) assert.deepEqual(post.isolation_060[k], pre.isolation_060[k], k)
  for (const k of Object.keys(pre.fingerprints)) assert.equal(post.fingerprints[k], pre.fingerprints[k], `fingerprint ${k}`)
  assert.equal(post.counts.events, pre.counts.events + 2)
  assert.equal(post.counts.evidence, pre.counts.evidence + 17)
  assert.equal((await q(`select count(*)::int as n from public.transaction_event_assets`))[0].n, pre.counts.assets + 5)
})

test('one coherent state: no snapshot drift, so no refresh (generation 15 -> 15 on every product table); the verifier stays 259/259 with no pin moved', async () => {
  assert.equal(await generation(), preGen)
  assert.equal(await drift(), 0)
  assert.deepEqual(await singleGeneration(), [preGen])
  assert.deepEqual(await verify(), { total: 259, failed: [] })
  assert.deepEqual(await verify(), preVerify)
})

test('rerun is a no-op: no row, source, evidence row or refresh, every table identical', async () => {
  const c = await clone(post061Dump)
  try {
    await c.db.exec(sql061)
    assert.deepEqual(await tableHashes(c, SNAP_DROP), postTables)
    assert.equal(await generation(c), preGen)
    assert.equal(await drift(c), 0)
  } finally { await c.close() }
})

test('guards: 061 refuses a non-NULL amount, a partial state, an equivalent Garland event, a second pool asset and a changed source row, and the refusal changes nothing', async () => {
  const cases = [
    ['a non-NULL amount is never overwritten', pre060Dump, `update public.transaction_event_assets a set cash_amount_usd = 1.00 from public.transaction_events e where e.id = a.event_id and e.event_key = 'LAD_ATL_2017_ADRIAN_GONZALEZ' and a.asset_type = 'CASH'`, /already carries the amount 1\.00/],
    ['an equivalent Garland event', pre060Dump, `insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, description, source_id)
      select 'SOME_OTHER_GARLAND_KEY', date '2010-11-26', 'FREE_AGENT_SIGNING', from_organization_id, 'x', source_id from public.transaction_events where event_key = 'LAD_FREE_AGENCY_2009_JON_GARLAND';
      insert into public.transaction_event_assets (event_id, asset_side, asset_name, asset_type, mlb_id) select id, 'INCOMING', 'Jon Garland', 'PLAYER', '279782' from public.transaction_events where event_key = 'SOME_OTHER_GARLAND_KEY'`, /equivalent event for Jon Garland/],
    ['a second pool asset', pre060Dump, `insert into public.transaction_event_assets (event_id, asset_side, asset_name, asset_type, counterparty_organization_id) select e.id, 'INCOMING', 'Pool by another name', 'INTERNATIONAL_BONUS_POOL_SPACE', o.id
      from public.transaction_events e, public.organizations o where e.event_key = 'LAD_CIN_2025_ARNALDO_LANTIGUA' and o.name = 'Cincinnati Reds'`, /already has an international bonus pool asset/],
    ['a partial state', post61(), `delete from public.evidence where id = (select ev.id from public.evidence ev join public.transaction_events e on e.id = ev.entity_id where e.event_key = 'LAD_BOS_2020_JETER_DOWNS' limit 1)`, /partial state is refused/],
    ['a changed source row', post61(), `update public.sources set title = 'Another title' where url = 'https://www.mlb.com/player/jon-garland-279782'`, /is not the reviewed row/],
  ]
  for (const [name, dump, mutate, pattern] of cases) {
    const c = await clone(dump)
    try {
      await c.db.exec(mutate)
      const before = await tableHashes(c, SNAP_DROP)
      await failsWith(c, sql061, pattern)
      assert.deepEqual(await tableHashes(c, SNAP_DROP), before, `${name}: the refusal changed something`)
    } finally { await c.close() }
  }
})
function post61() { return post061Dump }

test('rollback: restores the six amounts to NULL, deletes the added assets, events and evidence, keeps the twelve sources as provenance, leaves the queues at 57 / 79; again it refuses', async () => {
  const c = await clone(post061Dump)
  try {
    await c.db.exec(rollback061)
    const t = await tableHashes(c, SNAP_DROP)
    assert.deepEqual(changedTables(preTables, t), ['sources'], 'only the source rows differ from pre-061')
    assert.equal(t.transaction_events, preTables.transaction_events)
    assert.equal(t.transaction_event_assets, preTables.transaction_event_assets)
    assert.equal(t.evidence, preTables.evidence)
    assert.equal((await c.query(`select count(*)::int as n from public.sources`))[0].n, pre.counts.sources + 12)
    const m = await measure(c.query)
    assert.deepEqual(m.transaction_rows.targets, pre.transaction_rows.targets)
    assert.deepEqual(m.transaction_rows.garland, pre.transaction_rows.garland)
    assert.deepEqual(m.transaction_rows.garland_intervals, pre.transaction_rows.garland_intervals)
    assert.deepEqual(m.transaction_queue_rows, pre.transaction_queue_rows)
    assert.deepEqual(m.value_queue_rows, pre.value_queue_rows)
    assert.deepEqual(m.headline.cost_counts, pre.headline.cost_counts)
    assert.equal(await generation(c), preGen)
    assert.equal(await drift(c), 0)
    await failsWith(c, rollback061, /Migration 061 is not applied/)
  } finally { await c.close() }
})

test('rollback guards: later research on an added asset, a later Garland transaction, or a changed amount makes rollback refuse, without changing anything', async () => {
  /** @type {[string, string, RegExp][]} */
  const cases = [
    ['a control observation on the Garland signing asset', `insert into public.dodgers_control_observations (subject_asset_id, observation_type, observed_through_date, source_id, confidence, note)
      select a.id, 'EXIT_MECHANISM_UNRECORDED', date '2026-11-05', e.source_id, 'HIGH', 'test' from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id where e.event_key = 'LAD_FREE_AGENT_SIGNING_2010_JON_GARLAND'`, /later research depends on an asset 061 added/],
    ['a later Garland transaction', `insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, description, source_id)
      select 'LATER_GARLAND', date '2012-02-01', 'FREE_AGENT_SIGNING', from_organization_id, 'x', source_id from public.transaction_events where event_key = 'LAD_FREE_AGENCY_2009_JON_GARLAND';
      insert into public.transaction_event_assets (event_id, asset_side, asset_name, asset_type, mlb_id) select id, 'INCOMING', 'Jon Garland', 'PLAYER', '279782' from public.transaction_events where event_key = 'LATER_GARLAND'`, /later transaction was recorded for Jon Garland/],
    ['a changed amount', `update public.transaction_event_assets a set cash_amount_usd = 5000000.00 from public.transaction_events e where e.id = a.event_id and e.event_key = 'LAD_ATL_2017_ADRIAN_GONZALEZ' and a.asset_type = 'CASH'`, /partial state or a later change is refused/],
  ]
  for (const [name, mutate, pattern] of cases) {
    const c = await clone(post061Dump)
    try {
      await c.db.exec(mutate)
      const before = await tableHashes(c, SNAP_DROP)
      await failsWith(c, rollback061, pattern)
      assert.deepEqual(await tableHashes(c, SNAP_DROP), before, `${name}: the refusal changed something`)
    } finally { await c.close() }
  }
})

test('reapply after rollback reproduces the logical post-061 state (no duplicate source, asset, event or evidence row); one drift-free generation; rerun is a no-op', async () => {
  const c = await clone(post061Dump)
  try {
    const first = await logicalRows(c)
    await c.db.exec(rollback061)
    await c.db.exec(sql061)
    const again = await logicalRows(c)
    assert.deepEqual(again, first)
    assert.equal((await c.query(`select count(*)::int as n from public.sources where url in (${evidence.sources.map((s) => `'${s.url}'`).join(', ')})`))[0].n, 12)
    assert.equal((await c.query(`select count(*)::int as n from public.sources`))[0].n, pre.counts.sources + 12)
    assert.equal(await generation(c), preGen)
    assert.equal(await drift(c), 0)
    const t = await tableHashes(c, SNAP_DROP)
    await c.db.exec(sql061)
    assert.deepEqual(await tableHashes(c, SNAP_DROP), t, 'a second run after reapply changes nothing')
    const m = await measure(c.query)
    assert.equal(m.transaction_queue_rows.length, 51)
    assert.equal(m.value_queue_rows.length, 79)
  } finally { await c.close() }
})

test('consequence: while 061 is applied rollback-049 refuses (a later transaction exists for Jon Garland); rolling 061 back first restores it', async () => {
  const c = await clone(post061Dump)
  try {
    await failsWith(c, rollback049, /rollback-049/)
  } finally { await c.close() }
})
