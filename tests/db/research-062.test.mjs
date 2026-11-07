// Migration 062: bWAR backlog closure from owner-observed current Baseball-Reference career WAR. The 061 database is built (001-061), 062 is
// applied for real, and the tests prove:
//   * data only: no table, column, view, function or trigger changes; the 017 provider rule accepts the canonical player URLs as it is;
//   * the 32 written values are exactly the owner's (0.0 a known value, negatives kept), each citing its player's canonical page through a new
//     PLAYER_PAGE source whose notes say the value is owner-observed and DISI did not read the page; UNVERIFIED (the 060 owner-input convention);
//   * the 7 held players (a current value that would contradict the team-season ledger DISI holds beyond the verifier's 0.1) stay NULL, and
//     writing one would indeed fail the verifier;
//   * nothing else moves; no drift; 259 checks; 062 is idempotent and guarded; rollback-062 deletes the observations, keeps the sources, refuses
//     after later research on the players, and 062 can be reapplied.
//   UNKNOWN != ZERO   0.0 IS A VALUE   OWNER-OBSERVED != DISI-VERIFIED

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
import { measure } from '../../database/research/062/measure.mjs'
import { assemble, playerUrl } from '../../database/research/062/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '062_bwar_backlog_closure.sql'
const sql062 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback062 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-062.sql'), 'utf8')
const input = JSON.parse(fs.readFileSync(path.join(root, 'database/research/062/owner-input.json'), 'utf8'))
const SNAP_DROP = ['generation_id', 'refreshed_at', 'created_at', 'generated_at', 'snapshot_at']
const HELD = ['andres-gimenez', 'emmanuel-dejesus', 'fernando-tatis-jr', 'juan-soto', 'miguel-amaya', 'rafael-marchan', 'vladimir-guerrero-jr']
const OWNER = Object.fromEntries(input.rows.map((r) => [r.bref_id, r.career_bwar]))

let chain
let post061Dump
let post062Dump
let pre
let post
let preTables
let postTables
let preCatalog
let preGen
let preVerify
let payload
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
const catalog = async (c = chain) => ({
  procs: md5(R(await c.query(`select p.oid::regprocedure::text as f, md5(p.prosrc) as h from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`))),
  views: md5(R(await c.query(`select c.relname, md5(pg_get_viewdef(c.oid)) as h from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm') order by 1`))),
  triggers: md5(R(await c.query(`select tgrelid::regclass::text as t, tgname, tgfoid::regprocedure::text as f, tgenabled from pg_trigger where not tgisinternal order by 1, 2`))),
  columns: md5(R(await c.query(`select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' order by 1, 2`))),
})
const generation = async (c = chain) => R(await c.query(`select max(generation_id)::int as g from public.product_executive_snapshot`))[0].g
const drift = async (c = chain) => R(await c.query(`select count(*)::int as n from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`))[0].n
const singleGeneration = async (c = chain) => {
  const tables = R(await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'product\\_%' order by 1`)).map((r) => r.relname)
  const gens = new Set()
  for (const t of tables) for (const r of R(await c.query(`select distinct generation_id::int as g from public.${t}`))) gens.add(r.g)
  return [...gens]
}
const verify = async (c = chain) => { const r = await checkInvariants(async (s, p) => R(await c.query(s, p)), CANONICAL_EXPECTATIONS); return { total: r.hard.length, failed: failedChecks(r).map((x) => x.name) } }
const war = async (c = chain) => Object.fromEntries(R(await c.query(`select p.bref_id, v.career_bwar::text as v from public.players p left join public.v_player_war v on v.player_id = p.id
  where p.bref_id = any($1) order by 1`, [Object.keys(OWNER)])).map((r) => [r.bref_id, r.v]))
const queue = async (c = chain) => R(await c.query(`select player_slug from public.v_research_tasks where task_type = 'BWAR_MISSING' order by 1`)).map((r) => r.player_slug)

before(async () => {
  payload = assemble().payload
  chain = await buildChainThrough('061_transaction_research_closure.sql')
  post061Dump = await chain.db.dumpDataDir('none')
  pre = await measure(q)
  preTables = await tableHashes(chain, SNAP_DROP)
  preCatalog = await catalog()
  preGen = await generation()
  preVerify = await verify()
  await chain.db.exec(sql062)
  post = await measure(q)
  postTables = await tableHashes(chain, SNAP_DROP)
  post062Dump = await chain.db.dumpDataDir('none')
}, { timeout: 1500000 })

after(async () => { await chain?.close() })

test('062 follows 061 in the manifest as the last file and is not frozen yet; the migration and rollback are the deterministic build output', () => {
  const i = manifest.canonical_sql.indexOf(FILE)
  assert.equal(manifest.canonical_sql[i - 1], '061_transaction_research_closure.sql')
  assert.equal(i, manifest.canonical_sql.length - 1)
  assert.equal(manifest.canonical_sql.length, 66)
  assert.equal(manifest.notes.canonical_build_count, 66)
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  assert.equal(Object.keys(frozen).length, 65)
  assert.equal(frozen[FILE], undefined, '062 is not frozen')
  assert.match(sql062, /^-- DISI v0\.47\n-- 062_bwar_backlog_closure\.sql\n/)
  assert.match(rollback062, /^-- DISI rollback of Migration 062/)
  const built = assemble()
  assert.equal(built.migration, sql062, 'the migration is the build output of the reviewed input')
  assert.equal(built.rollback, rollback062, 'the rollback is the build output of the same input')
  assert.equal(assemble().migration, built.migration, 'the build is deterministic')
})

test('frozen history 001-061 is byte-for-byte unchanged (line endings normalised), 061 at its released hashes', () => {
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  for (const [f, sha1] of Object.entries(frozen)) {
    assert.equal(crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', f), 'utf8').replace(/\r\n/g, '\n')).digest('hex'), sha1, f)
  }
  assert.equal(frozen['061_transaction_research_closure.sql'], 'dd59aa1c962efbc1315925c8c7feb7cf336c94ff')
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'database/sql/061_transaction_research_closure.sql'))).digest('hex'), '63afb49e65188e4598aad83db6a5daf8836adf7e67e29f71f9fa0bd3a79dd01f')
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'database/release/sql/rollback-061.sql'))).digest('hex'), '84ca0efcc8c5fb5b4a250cc18bebe6a5d058c0ee30274608cab2ac80958b7a70')
})

test('data only: no table, column, view, function or trigger changes; the provider rule is the unchanged 017 rule', async () => {
  const code = sql062.replace(/\$m062\$[\s\S]*?\$m062\$/, '').replace(/--.*$/gm, '').replace(/create temporary (table|view)/gi, '')
  assert.ok(!/\b(create|alter|drop)\s+(table|view|materialized|function|trigger|type|policy|index|schema)\b/i.test(code), 'no DDL')
  assert.ok(!/\b(create or replace|grant|revoke)\b/i.test(code))
  assert.deepEqual(await catalog(), preCatalog)
  assert.equal(post.provider_rule.prosrc_md5, '0d64de295247da3bababfe71af444054')
  assert.deepEqual(post.provider_rule, pre.provider_rule)
})

test('baseline: 062 was written against exactly this 061 state (CAREER_BWAR 58, BWAR_MISSING 39, 3396 sources, 4507 evidence, queues 51 / 79)', () => {
  assert.deepEqual([pre.headline.career_bwar_observations, pre.headline.bwar_missing], [58, 39])
  assert.deepEqual([pre.isolation_061.counts.sources, pre.isolation_061.counts.evidence], [3396, 4507])
  assert.deepEqual([pre.isolation_061.transaction_queue, pre.isolation_061.value_queue], [51, 79])
  assert.deepEqual([pre.headline.cost_counts.known, pre.headline.cost_counts.unknown, pre.headline.cost_counts.known_usd], [81, 139, '127632237.33'])
  assert.deepEqual(pre.backlog.map((b) => b.bref_id).sort(), Object.keys(OWNER).sort(), 'the owner rows are exactly the 39 BWAR_MISSING players')
  assert.equal(preGen, 15)
  assert.deepEqual(preVerify, { total: 259, failed: [] })
})

test('the 32 written values are exactly the owner\'s; 0.0 is a value, negatives stay negative; the 7 held stay NULL', async () => {
  const w = await war()
  const heldBref = pre.backlog.filter((b) => HELD.includes(b.slug)).map((b) => b.bref_id)
  for (const [bref, v] of Object.entries(OWNER)) {
    if (heldBref.includes(bref)) { assert.equal(w[bref], null, `${bref} is held`); continue }
    assert.notEqual(w[bref], null, `${bref} is written`)
    assert.equal(Number(w[bref]).toFixed(1), v, `${bref}: the owner value exactly`)
  }
  assert.equal(Object.values(w).filter((v) => v !== null).length, 32)
  // 0.0 is a known observed value: Acosta and Martinez carry it; De Jesus is held for another reason (the ledger), not because of the zero
  for (const b of ['acostma02', 'martior01']) { assert.notEqual(w[b], null); assert.equal(Number(w[b]), 0) }
  assert.equal(OWNER.dejesen01, '0.0')
  // negatives are kept exactly, never clamped
  assert.deepEqual(['pachecr01', 'morejad01', 'marteno01', 'pereiev01', 'matoslu02'].map((b) => Number(w[b]).toFixed(1)), ['-1.4', '-1.1', '-1.0', '-0.9', '-0.9'])
  assert.equal((await q(`select count(*)::int as n from public.player_metric_observations m where m.value < 0 and m.notes like 'Migration 062:%'`))[0].n, 14)
  assert.equal((await q(`select count(*)::int as n from public.player_metric_observations m where m.value = 0 and m.notes like 'Migration 062:%'`))[0].n, 2)
})

test('provenance: each row cites its canonical player page through a new PLAYER_PAGE source that says the value is owner-observed; UNVERIFIED; through 2026-11-06 / 2026', async () => {
  const rows = await q(`select p.bref_id, p.mlb_id::text as mlb_id, m.value::text as v, m.observed_through_date::text as d, m.observed_through_season as s, m.confidence::text as c, m.notes,
      so.url, so.source_name, so.source_type, so.source_tier, so.title, so.accessed_at, so.notes as source_notes
    from public.player_metric_observations m join public.players p on p.id = m.player_id join public.sources so on so.id = m.source_id
    where m.metric_key = 'CAREER_BWAR' and m.notes like 'Migration 062:%' order by 1`)
  assert.equal(rows.length, 32)
  for (const r of rows) {
    assert.equal(r.url, playerUrl(r.bref_id))
    assert.equal(r.url, `https://www.baseball-reference.com/players/${r.bref_id[0]}/${r.bref_id}.shtml`)
    assert.ok(!/web\.archive\.org/.test(r.url))
    assert.deepEqual([r.source_name, r.source_type, r.source_tier, r.title], ['Baseball-Reference', 'PLAYER_PAGE', 'BASEBALL_REFERENCE', `Baseball-Reference player page (${r.bref_id})`])
    assert.equal(new Date(r.accessed_at).toISOString(), '2026-11-06T00:00:00.000Z')
    assert.deepEqual([r.d, r.s, r.c], ['2026-11-06', 2026, 'UNVERIFIED'])
    for (const t of [r.notes, r.source_notes]) {
      assert.match(t, /owner/i)
      assert.match(t, /DISI did not retrieve (this|the) page/)
      assert.ok(!/DISI (read|retrieved) the page|Claude/.test(t), 'never claims DISI or Claude read the page')
    }
    assert.match(r.notes, /OWNER-OBSERVED/)
    assert.ok(r.notes.includes(`mlb_ID ${r.mlb_id}`) && r.notes.includes(r.url))
  }
  for (const r of rows.filter((x) => Number(x.v) === 0)) assert.match(r.notes, /0\.0 is the observed value: a known zero, not a missing value/)
  assert.equal(post.isolation_061.counts.sources, pre.isolation_061.counts.sources + 32)
  assert.equal(post.isolation_061.counts.evidence, pre.isolation_061.counts.evidence)
})

test('the 7 held: their owner value would contradict the team-season ledger DISI holds; they keep BWAR_MISSING, and writing one would fail the verifier', async () => {
  assert.deepEqual(await queue(), HELD)
  assert.deepEqual(payload.rejected.map((r) => r.slug), HELD)
  const ev = JSON.parse(fs.readFileSync(path.join(root, 'database/research/062/career-bwar-evidence.json'), 'utf8'))
  assert.equal(ev.rows.length, 39)
  for (const r of ev.rows.filter((x) => x.status === 'HELD')) assert.match(r.reason, /verifier's 0\.1 career reconciliation tolerance/)
  const c = await clone(post062Dump)
  try {
    await c.db.exec(`insert into public.player_metric_observations (player_id, metric_key, value, observed_through_date, observed_through_season, source_id, confidence)
      select p.id, 'CAREER_BWAR', 45.6, date '2026-11-06', 2026, s.id, 'UNVERIFIED' from public.players p, public.sources s
      where p.slug = 'juan-soto' and s.url = 'https://www.baseball-reference.com/data/war_daily_bat.txt'`)
    assert.ok((await verify(c)).failed.includes('value_career_reconciliation_violations'), 'a held value really breaks the reconciliation check')
  } finally { await c.close() }
})

test('BWAR_MISSING 39 -> 7 and CAREER_BWAR 58 -> 90, measured; only the BWAR_MISSING task count moves', () => {
  assert.deepEqual([post.headline.career_bwar_observations, post.headline.bwar_missing], [90, 7])
  const t = (h) => Object.fromEntries(h.research_task_types.map((x) => [x.task_type, x.items]))
  const a = t(pre.headline), b = t(post.headline)
  assert.deepEqual(Object.fromEntries(Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]).map((k) => [k, [a[k], b[k]]])), { BWAR_MISSING: [39, 7] })
})

test('isolation: only player_metric_observations and sources changed; transactions, signings, outcomes, development, team-season WAR and every prediction output are unchanged', async () => {
  assert.deepEqual(changedTables(preTables, postTables), ['player_metric_observations', 'sources'])
  // every 061 fingerprint holds; other_sources covers every non-061 source, so it moves by exactly the 32 new 062 rows: compare it on the pre-062 sources
  assert.deepEqual({ ...post.isolation_061.fingerprints, other_sources: null }, { ...pre.isolation_061.fingerprints, other_sources: null })
  const urls = payload.players.map((p) => p.url)
  const oldSources = async (c) => R(await c.query(`select md5(coalesce(string_agg(h, '' order by h), '')) as h from (select md5(to_jsonb(s)::text) as h from public.sources s where not (s.url = any($1))) z`, [urls]))[0].h
  const c0 = await clone(post061Dump)
  try { assert.equal(await oldSources(chain), await oldSources(c0), 'every pre-062 source row is byte-identical') } finally { await c0.close() }
  assert.deepEqual([post.isolation_061.transaction_queue, post.isolation_061.value_queue], [51, 79])
  assert.deepEqual(post.headline.cost_counts, pre.headline.cost_counts)
  assert.deepEqual([post.headline.cost_counts.known, post.headline.cost_counts.unknown, post.headline.cost_counts.known_usd], [81, 139, '127632237.33'])
  assert.deepEqual(post.headline.prediction, pre.headline.prediction)
  assert.deepEqual(post.headline.value_totals, pre.headline.value_totals)
  assert.deepEqual(post.team_season_war, pre.team_season_war)
  for (const k of ['team_season_war', 'outcomes', 'players', 'signings']) assert.equal(post.fingerprints_062[k], pre.fingerprints_062[k], k)
  for (const k of ['ledger', 'resolutions', 'fingerprints', 'executive_overview_body_md5']) assert.deepEqual(post.isolation_060[k], pre.isolation_060[k], k)
})

test('one coherent state: no snapshot drift, so no refresh (generation 15 -> 15); the verifier stays 259/259', async () => {
  assert.equal(await generation(), preGen)
  assert.equal(await drift(), 0)
  assert.deepEqual(await singleGeneration(), [preGen])
  assert.deepEqual(await verify(), { total: 259, failed: [] })
})

test('rerun is a no-op (twice in one session): same sources, same rows, every table identical', async () => {
  const c = await clone(post062Dump)
  try {
    await c.db.exec(sql062)
    await c.db.exec(sql062)
    assert.deepEqual(await tableHashes(c, SNAP_DROP), postTables)
    assert.equal(await generation(c), preGen)
  } finally { await c.close() }
})

test('guards: 062 refuses a non-NULL target, an observation for a held player, a foreign source row on a 062 URL, a changed identity and a partial state, and the refusal changes nothing', async () => {
  const obs = (slug, value) => `insert into public.player_metric_observations (player_id, metric_key, value, observed_through_date, observed_through_season, source_id, confidence)
    select p.id, 'CAREER_BWAR', ${value}, date '2026-10-01', 2026, s.id, 'VERIFIED' from public.players p, public.sources s where p.slug = '${slug}' and s.url = 'https://www.baseball-reference.com/data/war_daily_bat.txt'`
  /** @type {[string, ArrayBuffer | Blob, string, RegExp][]} */
  const cases = [
    ['a non-NULL career bWAR is never overwritten', post061Dump, obs('wander-franco', 11.0), /not a 062 observation/],
    ['an observation for a held player', post061Dump, obs('juan-soto', 45.0), /not a 062 observation/],
    ['a foreign source row on a 062 URL', post061Dump, `insert into public.sources (source_name, source_type, title, url, accessed_at, source_tier) values ('x', 'PLAYER_PAGE', 'x', '${playerUrl('francwa01')}', now(), 'BASEBALL_REFERENCE')`, /not the reviewed row/],
    ['a changed identity', post061Dump, `update public.players set bref_id = 'francwa02' where slug = 'wander-franco'`, /not the reviewed identity/],
    ['a partial state', post062Dump, `delete from public.player_metric_observations where id = (select m.id from public.player_metric_observations m join public.players p on p.id = m.player_id where p.slug = 'jorge-ona')`, /31 of the 32 062 observations exist/],
    ['a changed 062 row', post062Dump, `update public.player_metric_observations m set value = 0.3 from public.players p where p.id = m.player_id and p.slug = 'jorge-ona'`, /not a 062 observation/],
  ]
  for (const [name, dump, mutate, pattern] of cases) {
    const c = await clone(dump)
    try {
      await c.db.exec(mutate)
      const before = await tableHashes(c, SNAP_DROP)
      await failsWith(c, sql062, pattern)
      assert.deepEqual(await tableHashes(c, SNAP_DROP), before, `${name}: the refusal changed something`)
    } finally { await c.close() }
  }
})

test('rollback: deletes the 32 observations, keeps the 32 sources as provenance, restores CAREER_BWAR 58 / BWAR_MISSING 39 and the pre-062 rows; again it refuses', async () => {
  const c = await clone(post062Dump)
  try {
    await c.db.exec(rollback062)
    const t = await tableHashes(c, SNAP_DROP)
    assert.deepEqual(changedTables(preTables, t), ['sources'], 'only the kept source rows differ from pre-062')
    assert.equal(t.player_metric_observations, preTables.player_metric_observations)
    const m = await measure(c.query)
    assert.deepEqual([m.headline.career_bwar_observations, m.headline.bwar_missing], [58, 39])
    assert.deepEqual(m.career_bwar, pre.career_bwar)
    assert.equal(m.isolation_061.counts.sources, pre.isolation_061.counts.sources + 32)
    assert.deepEqual(await queue(c), pre.backlog.map((b) => b.slug))
    assert.equal(await generation(c), preGen)
    assert.equal(await drift(c), 0)
    assert.deepEqual(await verify(c), { total: 259, failed: [] })
    await failsWith(c, rollback062, /Migration 062 is not applied/)
  } finally { await c.close() }
})

test('rollback guards: a later observation of a written or a held player, or a changed 062 row, makes rollback refuse without changing anything', async () => {
  /** @type {[string, string, RegExp][]} */
  const cases = [
    ['a later observation of a written player', `insert into public.player_metric_observations (player_id, metric_key, value, observed_through_date, observed_through_season, source_id, confidence)
      select p.id, 'CAREER_BWAR', 11.4, date '2027-04-01', 2027, s.id, 'UNVERIFIED' from public.players p, public.sources s where p.slug = 'wander-franco' and s.url = '${playerUrl('francwa01')}'`, /later research on these players/],
    ['an observation of a held player', `insert into public.player_metric_observations (player_id, metric_key, value, observed_through_date, observed_through_season, source_id, confidence)
      select p.id, 'CAREER_BWAR', 42.6, date '2026-11-06', 2025, s.id, 'VERIFIED' from public.players p, public.sources s where p.slug = 'juan-soto' and s.url = 'https://www.baseball-reference.com/data/war_daily_bat.txt'`, /later research on these players/],
    ['a changed 062 row', `update public.player_metric_observations m set notes = 'changed' from public.players p where p.id = m.player_id and p.slug = 'jorge-ona'`, /later research on these players, or a changed 062 row/],
  ]
  for (const [name, mutate, pattern] of cases) {
    const c = await clone(post062Dump)
    try {
      await c.db.exec(mutate)
      const before = await tableHashes(c, SNAP_DROP)
      await failsWith(c, rollback062, pattern)
      assert.deepEqual(await tableHashes(c, SNAP_DROP), before, `${name}: the refusal changed something`)
    } finally { await c.close() }
  }
})

test('reapply after rollback reproduces the post-062 state (the kept sources are found, not duplicated); a second run changes nothing', async () => {
  const c = await clone(post062Dump)
  const logical = async () => (await c.query(`select p.slug, m.value::text, m.observed_through_date::text, m.observed_through_season, m.confidence::text, m.notes, s.url, s.notes as sn
    from public.player_metric_observations m join public.players p on p.id = m.player_id join public.sources s on s.id = m.source_id order by 1, 3`)).map((r) => JSON.stringify(r))
  try {
    const first = await logical()
    const firstSources = (await c.query(`select count(*)::int as n from public.sources`))[0].n
    await c.db.exec(rollback062)
    await c.db.exec(sql062)
    assert.deepEqual(await logical(), first)
    assert.equal((await c.query(`select count(*)::int as n from public.sources`))[0].n, firstSources, 'no duplicate source')
    assert.deepEqual(await queue(c), HELD)
    const t = await tableHashes(c, SNAP_DROP)
    await c.db.exec(sql062)
    assert.deepEqual(await tableHashes(c, SNAP_DROP), t)
    assert.equal(await drift(c), 0)
    assert.deepEqual(await verify(c), { total: 259, failed: [] })
  } finally { await c.close() }
})
