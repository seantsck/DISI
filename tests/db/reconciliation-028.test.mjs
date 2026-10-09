// Migration 028 - residual canonical drift reconciliation.
//
// Exactly four data corrections: one transaction wording and three class-membership
// source-link confidence values. Both allowed starting states are exercised on a 001-027
// database: the canonical replay (state A) and the known live residual drift (state B).
// Scenarios run in rolled-back transactions; the final rerun test commits.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { lit, withoutTransaction } from './drift-027.mjs'
import { RECONCILIATION_QUERIES } from '../../scripts/db/lib/seed-reconciliation.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '028_residual_canonical_drift_reconciliation.sql'
const sql028 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const inner = withoutTransaction(sql028)
const cats = JSON.parse(fs.readFileSync(path.join(root, 'database/research/028/reconciliation-manifest.json'), 'utf8')).categories
const tx = cats.transaction_descriptions.entries[0]
const links = cats.class_membership_confidence.entries

let chain
const q = (sql, params) => chain.query(sql, params)
const one = async (sql) => (await q(sql))[0]
before(async () => { chain = await buildChainThrough('027_canonical_seed_drift_reconciliation.sql') }, { timeout: 180000 })
after(async () => { await chain.close() })

const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
async function inTxn(body) {
  await chain.db.exec('begin;')
  try { return await body() } finally { await chain.db.exec('rollback;') }
}
async function attempt(sql) {
  await chain.db.exec('begin;')
  try { await chain.db.exec(sql); return 'accepted' } catch (e) { return String(e.message) } finally { await chain.db.exec('rollback;') }
}

const TX_WHERE = `player_id = (select id from players where slug = ${lit(tx.selector.player_slug)}) and transaction_date = ${lit(tx.selector.transaction_date)}::date and transaction_type = ${lit(tx.selector.transaction_type)}`
const linkIds = (l) => `(select ms.id from signing_population_member_sources ms join signing_population_members m on m.id = ms.member_id join signing_populations sp on sp.id = m.population_id
  join signings sg on sg.id = m.signing_id join players p on p.id = sg.player_id join organizations o on o.id = sg.organization_id join sources so on so.id = ms.source_id
  where sp.population_key = ${lit(l.selector.population_key)} and p.slug = ${lit(l.selector.player_slug)} and o.name = ${lit(l.selector.organization_name)}
    and sg.signing_year = ${l.selector.signing_year} and so.url = ${lit(l.selector.source_url)})`
/** The known residual live drift: the other wording and VERIFIED confidences. */
const residualDrift = () => [
  `update transactions set return_description = ${lit(tx.live.return_description)} where ${TX_WHERE};`,
  ...links.map((l) => `update signing_population_member_sources set confidence = ${lit(l.live.confidence)}::confidence_level where id = ${linkIds(l)};`),
].join('\n')

/** One hash per public table (whole-row text, order-independent) plus the full rows of the two tables 028 may touch. */
async function snapshot() {
  const tables = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const hashes = {}
  for (const t of tables) hashes[t] = md5((await q(`select t::text as r from public.${t} t`)).map((r) => r.r).sort())
  return {
    hashes,
    transactions: (await q(`select t::text as r from transactions t`)).map((r) => r.r).sort(),
    links: (await q(`select ms::text as r from signing_population_member_sources ms`)).map((r) => r.r).sort(),
  }
}
const changedTables = (a, b) => Object.keys(a.hashes).filter((t) => a.hashes[t] !== b.hashes[t])
const changedRows = (a, b) => a.filter((r) => !b.includes(r)).length

const AFFECTED_VIEWS = cats.transaction_descriptions.affected_views.concat(cats.class_membership_confidence.affected_views)
async function viewContent() {
  const names = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const v of names) {
    const cols = (await q(`select a.attname, format_type(a.atttypid, a.atttypmod) as t from pg_attribute a where a.attrelid = 'public.${v}'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`))
      .filter((c) => c.t !== 'uuid' && !/^(accessed|retrieved)/.test(c.attname))
    out[v] = md5((await q(`select ${cols.map((c) => `"${c.attname}"::text as "${c.attname}"`).join(', ')} from public.${v}`)).map((r) => JSON.stringify(r)).sort())
  }
  return out
}
const diffKeys = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k])

async function untouched() {
  return {
    security: md5(await q(`select
      (select jsonb_agg(jsonb_build_array(c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type) order by c.relname, 2, 3) from pg_class c
         cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v')),
      (select jsonb_agg(jsonb_build_array(relname, relrowsecurity, reloptions::text) order by relname) from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v')),
      (select jsonb_agg(jsonb_build_array(tablename, policyname, cmd) order by tablename, policyname) from pg_policies where schemaname = 'public'),
      (select jsonb_agg(jsonb_build_array(proname, prosecdef, proconfig::text, proacl::text) order by proname, oid) from pg_proc where pronamespace = 'public'::regnamespace),
      (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'), (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')`)),
  }
}

let stateA

test('the manifest holds exactly the four reviewed corrections and the audit report agrees', () => {
  assert.deepEqual(Object.keys(cats).sort(), ['class_membership_confidence', 'transaction_descriptions'])
  assert.equal(cats.transaction_descriptions.entries.length, 1)
  assert.equal(links.length, 3)
  assert.equal(tx.canonical.return_description, 'Traded as part of a five-player package to Baltimore Orioles for SS Manny Machado')
  assert.equal(tx.live.return_description, 'Traded in five-player package to Baltimore Orioles for SS Manny Machado')
  assert.deepEqual(links.map((l) => l.selector.player_slug), ['alex-de-jesus', 'diego-cartaya', 'jerming-rosario'])
  assert.ok(links.every((l) => l.live.confidence === 'VERIFIED' && l.canonical.confidence === 'HIGH'))
  const report = JSON.parse(fs.readFileSync(path.join(root, 'database/research/028/audit-report.json'), 'utf8'))
  assert.deepEqual(report.failures, [])
  assert.equal(report.corrections.total, 4)
})

test('state A (canonical replay through 027): 028 is a no-op', async () => {
  await inTxn(async () => {
    const before = await snapshot()
    const guard = await untouched()
    await chain.db.exec(inner)
    const after = await snapshot()
    assert.deepEqual(after.hashes, before.hashes, 'a canonical replay already holds the target values')
    assert.deepEqual(await untouched(), guard)
    stateA = { snapshot: after, views: await viewContent() }
  })
})

test('state B (known live residual drift): 028 corrects exactly the four reviewed values and converges to state A', async () => {
  assert.ok(stateA, 'state A runs first')
  await inTxn(async () => {
    await chain.db.exec(residualDrift())
    const drifted = await snapshot()
    assert.deepEqual(changedTables(drifted, stateA.snapshot), ['signing_population_member_sources', 'transactions'])
    assert.equal(changedRows(drifted.transactions, stateA.snapshot.transactions), 1)
    assert.equal(changedRows(drifted.links, stateA.snapshot.links), 3)
    const driftedViews = await viewContent()
    assert.deepEqual(diffKeys(driftedViews, stateA.views).sort(), [...AFFECTED_VIEWS].sort(), 'the drift is visible in exactly the five affected views')
    const guard = await untouched()
    await chain.db.exec(inner)
    const repaired = await snapshot()
    assert.deepEqual(repaired.hashes, stateA.snapshot.hashes, 'live-drift state and canonical replay hold the same content after 028')
    assert.equal(changedRows(drifted.transactions, repaired.transactions), 1, 'exactly one transaction row changed')
    assert.equal(changedRows(drifted.links, repaired.links), 3, 'exactly three source-link rows changed')
    assert.deepEqual(changedTables(drifted, repaired), ['signing_population_member_sources', 'transactions'], 'no other table changed')
    const row = await one(`select return_description from transactions where ${TX_WHERE}`)
    assert.equal(row.return_description, tx.canonical.return_description)
    for (const l of links) assert.equal((await one(`select confidence::text as c from signing_population_member_sources where id = ${linkIds(l)}`)).c, 'HIGH')
    // only the reviewed fields moved: dates, players, organizations, type and the other transaction fields are untouched
    const full = await one(`select transaction_date::text as d, transaction_type, from_organization_id is not null as f, to_organization_id is not null as t, source_id is not null as s, confidence::text as c from transactions where ${TX_WHERE}`)
    assert.deepEqual(full, { d: tx.selector.transaction_date, transaction_type: 'TRADE', f: true, t: true, s: true, c: 'VERIFIED' })
    assert.deepEqual(diffKeys(await viewContent(), stateA.views), [], 'the five affected views converge')
    assert.deepEqual(await untouched(), guard)
  })
})

test('unexpected third states abort the whole migration and change nothing', async () => {
  const base = residualDrift()
  /** @type {[string, string, RegExp][]} */
  const cases = [
    ['an unexpected Diaz wording', `update transactions set return_description = 'Traded to Baltimore' where ${TX_WHERE};`, /unexpected wording/],
    ['an unexpected wording in live-drift state', `${base}\nupdate transactions set return_description = 'Traded to Baltimore (edited)' where ${TX_WHERE};`, /unexpected wording/],
    ['an unexpected class-link confidence', `update signing_population_member_sources set confidence = 'LOW' where id = ${linkIds(links[0])};`, /unexpected confidence/],
    ['an unexpected confidence in live-drift state', `${base}\nupdate signing_population_member_sources set confidence = 'MEDIUM' where id = ${linkIds(links[1])};`, /unexpected confidence/],
    ['a link that differs in another field', `update signing_population_member_sources set note = 'edited by hand' where id = ${linkIds(links[2])};`, /other than confidence/],
    ['a missing target transaction', `delete from transactions where ${TX_WHERE};`, /transaction is missing/],
    ['a duplicated target transaction', `insert into transactions (player_id, transaction_date, transaction_type, from_organization_id, to_organization_id, return_description, source_id, confidence)
      select player_id, transaction_date, transaction_type, from_organization_id, to_organization_id, return_description, source_id, confidence from transactions where ${TX_WHERE};`, /exists 2 times/],
    ['a missing target source link', `delete from signing_population_member_sources where id = ${linkIds(links[0])};`, /source link is missing/],
  ]
  for (const [label, mutation, pattern] of cases) assert.match(await attempt(`${mutation}\n${inner}`), pattern, label)
  // the target links cannot be duplicated: (member, source) is unique, so a "duplicate semantic target" is impossible by constraint
  assert.match(await attempt(`insert into signing_population_member_sources (member_id, source_id, membership_basis, confidence)
    select member_id, source_id, membership_basis, 'HIGH' from signing_population_member_sources where id = ${linkIds(links[0])};`), /duplicate key|unique/)
  // an aborted run changed nothing
  assert.equal((await one(`select return_description from transactions where ${TX_WHERE}`)).return_description, tx.canonical.return_description)
})

test('028 is data-only and touches nothing outside the four reviewed values', async () => {
  const code = sql028.replace(/--[^\n]*/g, '')
  assert.doesNotMatch(code, /\b(create|alter|drop)\s+(table|view|function|index|policy|trigger|type|schema|extension)\b/i)
  assert.doesNotMatch(code, /\b(grant|revoke)\b/i)
  assert.doesNotMatch(code, /initcap\s*\(/i)
  assert.doesNotMatch(code, /full_name\s*=|canonical_name\s*=/i)
  assert.equal((code.match(/\bupdate public\./g) ?? []).length, 2, 'two guarded UPDATE statements only')
  assert.doesNotMatch(code, /\b(delete\s+from|insert\s+into\s+public)/i)
  // 027 reconciliation and the 026 scouting data remain intact
  await inTxn(async () => {
    await chain.db.exec(inner)
    for (const [name, sql] of Object.entries(RECONCILIATION_QUERIES)) {
      if (/^reconciliation_(trade|class_link)/.test(name)) continue
      assert.equal((await one(sql)).n, 0, name)
    }
    assert.equal((await one(`select count(*)::int as n from player_evaluations where record_status = 'ACTIVE'`)).n, 51)
  })
})

test('rerun is a no-op: the committed migration applied twice over the drifted state changes nothing the second time', async () => {
  await chain.db.exec(residualDrift())
  await chain.db.exec(sql028)
  const first = await snapshot()
  const guard = await untouched()
  await chain.db.exec(sql028)
  assert.deepEqual((await snapshot()).hashes, first.hashes)
  assert.deepEqual(await untouched(), guard)
  assert.deepEqual(first.hashes, stateA.snapshot.hashes, 'and it still equals the canonical replay result')
  for (const sql of [RECONCILIATION_QUERIES.reconciliation_trade_wording_violations, RECONCILIATION_QUERIES.reconciliation_class_link_confidence_violations]) assert.equal((await one(sql)).n, 0)
})
