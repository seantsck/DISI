// Migration 046: the reviewed acquisition-cost research batch. The 045b database is built (001-045b), 046 is applied for real, and the
// tests prove that it adds research DATA only (no object, grant or policy changes), that every bonus it records is sourced and exact, that
// a disagreement stays a conflict, that unknown stays unknown (never zero), that the product snapshots move to one coherent generation with
// zero drift, that it is idempotent, guarded, reproducible and reversible, and that the verifier still passes.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_046 as CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'
import { productSnapshotQueries } from '../../scripts/db/lib/product-snapshot-invariants.mjs'
import { ALL_SNAPSHOT_TABLES } from '../../database/research/045b/snapshots.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '046_outcome_cost_research_batch.sql'
const sql046 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback046 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-046.sql'), 'utf8')
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'database/research/046/research-evidence.json'), 'utf8'))

const NEW = evidence.signing_reports.filter((r) => r.kind === 'NEW')
const CONFLICT = evidence.signing_reports.filter((r) => r.kind === 'CONFLICT')
const UNRESOLVED = evidence.examined.filter((e) => e.outcome === 'UNRESOLVED')
const NEW_TOTAL = NEW.reduce((a, r) => a + Number(r.amount), 0)

let chain
let pre046Dump
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
const R = (x) => (Array.isArray(x) ? x : x.rows)
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const tableHashes = async (c = chain) => {
  const tables = R(await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5(R(await c.query(`select t::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const catalog = async () => ({
  views: await q(`select relname, pg_get_viewdef(oid) as d, coalesce(relacl::text, '') as acl from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`),
  tables: await q(`select relname, coalesce(relacl::text, '') as acl, relrowsecurity as rls from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`),
  functions: await q(`select p.oid::regprocedure::text as f, md5(pg_get_functiondef(p.oid)) as h, coalesce(p.proacl::text, '') as acl from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
  policies: await q(`select tablename, policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' order by 1, 2`),
  triggers: await q(`select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
})
const drift = async (c = chain) => R(await c.query(`select snapshot, missing_rows + extra_rows as n from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`))
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
const bonusOf = (c, slug, year) => c.query(`select sg.signing_bonus_usd::text as bonus, sg.bonus_publicly_reported as reported, f.bonus_status as status,
    (select count(*)::int from public.signing_financial_reports r where r.signing_id = sg.id and r.component_type = 'SIGNING_BONUS' and r.record_status = 'ACTIVE') as active_reports
  from public.signings sg join public.players p on p.id = sg.player_id join public.v_signing_acquisition_financials f on f.signing_id = sg.id
  where p.slug = $1 and sg.signing_year = $2`, [slug, year]).then(R)

let pre
let post
before(async () => {
  chain = await buildChainThrough('045b_database_status_snapshot.sql')
  pre046Dump = await chain.db.dumpDataDir('none')
  pre = {
    hashes: await tableHashes(), catalog: await catalog(),
    generation: (await one(`select max(generation_id)::int as g from product_executive_snapshot`)).g,
    status: await one(`select tracked_signings, signings_with_known_cost, known_acquisition_cost_usd::text as cost, open_research_tasks, outcome_audit_queue, outcome_audits_completed from product_database_status`),
  }
  await chain.db.exec(sql046)
  post = { hashes: await tableHashes(), catalog: await catalog() }
}, { timeout: 600000 })
after(async () => { await chain?.close() })

test('046 is registered immediately after 045b in the manifest (047 follows it)', () => {
  const at = manifest.canonical_sql.indexOf(FILE)
  assert.ok(at > 0)
  assert.equal(manifest.canonical_sql[at - 1], '045b_database_status_snapshot.sql')
  assert.equal(manifest.canonical_sql[at + 1], '047_development_transaction_research_batch.sql')
  assert.equal(manifest.notes.canonical_build_count, manifest.canonical_sql.length)
})

test('046 adds research DATA only: no table, view, function, trigger, policy or privilege changes', async () => {
  assert.deepEqual(post.catalog, pre.catalog)
  assert.equal(post.catalog.tables.length, 78)
  const changed = Object.keys(post.hashes).filter((t) => post.hashes[t] !== pre.hashes[t]).sort()
  assert.deepEqual(changed, ['signing_financial_reports', 'signings', 'sources', ...ALL_SNAPSHOT_TABLES].sort())
  assert.equal(ALL_SNAPSHOT_TABLES.length, 11)
  // the API roles still cannot read or write the ledger tables
  for (const t of ['signing_financial_reports', 'sources', 'signings']) {
    const r = await one(`select has_table_privilege('anon', 'public.${t}', 'INSERT') or has_table_privilege('anon', 'public.${t}', 'UPDATE') or has_table_privilege('anon', 'public.${t}', 'DELETE')
      or has_table_privilege('authenticated', 'public.${t}', 'INSERT') or has_table_privilege('authenticated', 'public.${t}', 'UPDATE') or has_table_privilege('authenticated', 'public.${t}', 'DELETE') as api_write`)
    assert.equal(r.api_write, false, t)
  }
})

test('eight unknown bonuses are now sourced, exact and canonical; each has exactly one ACTIVE external report', async () => {
  assert.equal(NEW.length, 8)
  for (const r of NEW) {
    const [b] = await bonusOf(chain, r.player_slug, r.signing_year)
    assert.deepEqual([b.bonus, b.reported, b.status, b.active_reports], [r.amount, true, 'KNOWN', 1], r.player_slug)
    const rep = await one(`select r.amount_basis, r.report_origin, r.currency_code, r.evidence_basis, r.confidence::text as confidence, r.retrieved_at is not null as has_retrieved, so.url, so.accessed_at is not null as has_accessed
      from public.signing_financial_reports r join public.sources so on so.id = r.source_id
      join public.signings sg on sg.id = r.signing_id join public.players p on p.id = sg.player_id
      where p.slug = $1 and sg.signing_year = $2 and r.component_type = 'SIGNING_BONUS' and r.record_status = 'ACTIVE'`, [r.player_slug, r.signing_year])
    assert.deepEqual([rep.amount_basis, rep.report_origin, rep.currency_code, rep.has_retrieved, rep.has_accessed], ['EXACT', 'EXTERNAL_SOURCE', 'USD', true, true], r.player_slug)
    assert.match(rep.url, /^https:\/\//)
  }
})

test('a disagreement stays a conflict: two ACTIVE reports, no resolution, the canonical bonus stays NULL', async () => {
  assert.equal(CONFLICT.length, 2)
  const [b] = await bonusOf(chain, 'adrian-beltre', 1994)
  assert.deepEqual([b.bonus, b.reported, b.status, b.active_reports], [null, false, 'CONFLICT', 2])
  const amounts = (await q(`select r.amount::text as a from public.signing_financial_reports r join public.signings sg on sg.id = r.signing_id join public.players p on p.id = sg.player_id
    where p.slug = 'adrian-beltre' and r.component_type = 'SIGNING_BONUS' and r.record_status = 'ACTIVE' order by 1`)).map((r) => r.a)
  assert.deepEqual(amounts, ['17000.00', '23000.00'])
  assert.equal((await one(`select count(*)::int as n from public.signing_financial_resolutions`)).n, 0, 'no last-write-wins: nothing is resolved for the reader')
  const f = await one(`select has_financial_conflict, conflicting_components from public.v_signing_acquisition_financials f join public.signings sg on sg.id = f.signing_id join public.players p on p.id = sg.player_id where p.slug = 'adrian-beltre'`)
  assert.equal(f.has_financial_conflict, true)
})

test('unknown stays unknown: signings looked for and not found carry no amount, and no zero exists anywhere', async () => {
  assert.ok(UNRESOLVED.length >= 10)
  for (const e of UNRESOLVED) {
    const [b] = await bonusOf(chain, e.player_slug, e.signing_year)
    assert.deepEqual([b.bonus, b.reported, b.status, b.active_reports], [null, false, 'UNKNOWN', 0], e.player_slug)
  }
  assert.equal((await one(`select count(*)::int as n from public.signings where signing_bonus_usd = 0`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from public.signing_financial_reports where amount <= 0`)).n, 0)
  // the product decision snapshot: a known bonus becomes a complete cost; an unknown one stays NULL, not 0
  const d = await q(`select player_slug, known_acquisition_cost_usd::text as cost, cost_coverage_state from public.product_player_decision where player_slug = any($1) order by 1`, [[...NEW.map((r) => r.player_slug), 'adrian-beltre', 'carlos-santana']])
  const by = Object.fromEntries(d.map((r) => [r.player_slug, r]))
  for (const r of NEW) assert.deepEqual([by[r.player_slug].cost, by[r.player_slug].cost_coverage_state], [r.amount, 'COMPLETE'], r.player_slug)
  assert.equal(by['adrian-beltre'].cost, null)
  assert.equal(by['carlos-santana'].cost, null)
})

test('coverage moves by exactly the sourced amounts: 48 -> 56 known costs, +$4,323,000.00, 349 open tasks; NOT_AUDITED and the audits are untouched', async () => {
  const s = await one(`select tracked_signings, signings_with_known_cost, known_acquisition_cost_usd::text as cost, open_research_tasks, outcome_audit_queue, outcome_audits_completed from product_database_status`)
  assert.equal(s.tracked_signings, pre.status.tracked_signings)
  assert.equal(s.signings_with_known_cost, pre.status.signings_with_known_cost + NEW.length)
  assert.equal(Number(s.cost), Number(pre.status.cost) + NEW_TOTAL)
  assert.equal(NEW_TOTAL, 4323000)
  assert.equal(s.open_research_tasks, pre.status.open_research_tasks - NEW.length)
  assert.equal(s.outcome_audit_queue, pre.status.outcome_audit_queue, 'NOT_AUDITED is unchanged')
  assert.equal(s.outcome_audits_completed, pre.status.outcome_audits_completed)
  assert.equal(post.hashes.outcome_audits, pre.hashes.outcome_audits)
  assert.equal(post.hashes.outcome_evidence, pre.hashes.outcome_evidence)
})

test('one coherent snapshot generation: +1, all eleven snapshots carry it, zero drift, and the status snapshot still equals its source', async () => {
  const g = (await one(`select max(generation_id)::int as g from product_executive_snapshot`)).g
  assert.equal(g, pre.generation + 1)
  for (const t of ALL_SNAPSHOT_TABLES) assert.equal((await one(`select count(*) filter (where generation_id <> $1)::int as n from public.${t}`, [g])).n, 0, t)
  assert.deepEqual(await drift(), [])
  const eq = await one(`select (select count(*) from (select to_jsonb(s) as j from public.v_database_status s except all
       select to_jsonb(t) - array['generation_id', 'generated_at', 'source_data_as_of_date', 'product_version', 'schema_version']::text[] from public.product_database_status t) a)::int as missing`)
  assert.equal(eq.missing, 0)
})

test('idempotent: a rerun adds no report and no generation and changes no table', async () => {
  const before = await tableHashes()
  await chain.db.exec(sql046)
  assert.deepEqual(await tableHashes(), before)
  assert.equal((await one(`select count(*)::int as n from public.signing_financial_reports r join public.sources so on so.id = r.source_id where so.url = any($1)`, [evidence.sources.map((s) => s.url)])).n, evidence.signing_reports.length)
})

test('the verifier passes on 001-046 (252 hard checks) and each snapshot check is clean', async () => {
  for (const [name, sql] of Object.entries(productSnapshotQueries(true, true))) assert.equal((await one(sql)).n, 0, name)
  const full = await checkInvariants(q, CANONICAL_EXPECTATIONS)
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 259)
})

test('guards: 046 refuses a database where its facts no longer apply, and changes nothing when it refuses', async () => {
  const c = await clone(pre046Dump)
  try {
    await c.db.exec(`update public.signings set signing_bonus_usd = 1500 where id = (select sg.id from public.signings sg join public.players p on p.id = sg.player_id where p.slug = 'sandy-amoros')`)
    const before = await tableHashes(c)
    await failsWith(c, sql046, /046: sandy-amoros already carries a canonical bonus/)
    assert.deepEqual(await tableHashes(c), before)
  } finally { await c.close() }
  const d = await clone(pre046Dump)
  try {
    const other = (await d.query(`select id from public.sources limit 1`))[0].id
    await d.db.exec(`insert into public.signing_financial_reports (signing_id, component_type, amount, currency_code, amount_basis, report_origin, source_id, evidence_basis, confidence, retrieved_at, note)
      select sg.id, 'SIGNING_BONUS', 3000, 'USD', 'EXACT', 'EXTERNAL_SOURCE', '${other}', 'OTHER', 'MEDIUM', now(), 'earlier research' from public.signings sg join public.players p on p.id = sg.player_id where p.slug = 'raul-mondesi'`)
    await failsWith(d, sql046, /046: raul-mondesi already has a different active bonus report/)
  } finally { await d.close() }
})

test('rollback: retracts exactly the ten reports, restores the eight canonical bonuses to unknown, refreshes once, and leaves no drift', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    const gen0 = (await c.query(`select max(generation_id)::int as g from product_executive_snapshot`))[0].g
    await c.db.exec(rollback046)
    for (const r of [...NEW, CONFLICT[0]]) {
      const [b] = await bonusOf(c, r.player_slug, r.signing_year)
      assert.deepEqual([b.bonus, b.reported, b.status, b.active_reports], [null, false, 'UNKNOWN', 0], r.player_slug)
    }
    const retracted = (await c.query(`select count(*)::int as n from public.signing_financial_reports where record_status = 'RETRACTED' and retraction_reason = 'Migration 046 rolled back.'`))[0].n
    assert.equal(retracted, evidence.signing_reports.length)
    const s = (await c.query(`select signings_with_known_cost, known_acquisition_cost_usd::text as cost, open_research_tasks from product_database_status`))[0]
    assert.deepEqual(s, { signings_with_known_cost: pre.status.signings_with_known_cost, cost: pre.status.cost, open_research_tasks: pre.status.open_research_tasks })
    assert.equal((await c.query(`select max(generation_id)::int as g from product_executive_snapshot`))[0].g, gen0 + 1)
    assert.deepEqual(await drift(c), [])
    // nothing else changed: only the ledger, signings, sources untouched (kept as provenance) and the snapshots
    const hashes = await tableHashes(c)
    const changed = Object.keys(hashes).filter((t) => hashes[t] !== pre.hashes[t]).sort()
    assert.deepEqual(changed.filter((t) => !t.startsWith('product_')), ['signing_financial_reports', 'sources'])
    assert.equal(hashes.signings, pre.hashes.signings)
    // a second rollback refuses
    await failsWith(c, rollback046, /rollback-046: report .* is not present and ACTIVE/)
  } finally { await c.close() }
})

test('rollback refuses when later research exists for one of the nine signings', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    const src = (await c.query(`select id from public.sources where url = $1`, [evidence.sources[0].url]))[0].id
    await c.db.exec(`insert into public.signing_financial_reports (signing_id, component_type, amount, currency_code, amount_basis, report_origin, source_id, evidence_basis, confidence, retrieved_at, note)
      select sg.id, 'SIGNING_BONUS', 5000, 'USD', 'EXACT', 'EXTERNAL_SOURCE', '${src}', 'OTHER', 'MEDIUM', now(), 'later research' from public.signings sg join public.players p on p.id = sg.player_id where p.slug = 'juan-guzman'`)
    await failsWith(c, rollback046, /rollback-046: juan-guzman has 2 active bonus reports but 046 wrote 1/)
  } finally { await c.close() }
})

test('reproducible: the committed migration and rollback are byte-identical to the build output', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disi-046-build-'))
  const dir = path.join(tmp, 'database/research/046')
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(path.join(tmp, 'database/sql'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'database/release/sql'), { recursive: true })
  for (const f of ['build.mjs', '046_template.sql', 'rollback_template.sql', 'research-evidence.json']) fs.copyFileSync(path.join(root, 'database/research/046', f), path.join(dir, f))
  execFileSync(process.execPath, [path.join(dir, 'build.mjs')], { stdio: 'pipe' })
  assert.equal(fs.readFileSync(path.join(tmp, 'database/sql', FILE), 'utf8'), sql046)
  assert.equal(fs.readFileSync(path.join(tmp, 'database/release/sql/rollback-046.sql'), 'utf8'), rollback046)
})

test('the builder refuses what the cost methodology does not allow', () => {
  const build = (mutate) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disi-046-bad-'))
    const dir = path.join(tmp, 'database/research/046')
    fs.mkdirSync(dir, { recursive: true })
    fs.mkdirSync(path.join(tmp, 'database/sql'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'database/release/sql'), { recursive: true })
    for (const f of ['build.mjs', '046_template.sql', 'rollback_template.sql']) fs.copyFileSync(path.join(root, 'database/research/046', f), path.join(dir, f))
    const doc = structuredClone(evidence)
    mutate(doc)
    fs.writeFileSync(path.join(dir, 'research-evidence.json'), JSON.stringify(doc))
    try { execFileSync(process.execPath, [path.join(dir, 'build.mjs')], { stdio: 'pipe' }); return null } catch (e) { return String(e.stderr) }
  }
  assert.equal(build(() => {}), null, 'the unmodified evidence builds')
  assert.match(build((d) => { d.signing_reports[0].amount = '0.00' }), /positive 2-decimal string/)
  assert.match(build((d) => { d.signing_reports[0].amount = '-5.00' }), /positive 2-decimal string/)
  assert.match(build((d) => { d.signing_reports[0].amount = '1000' }), /positive 2-decimal string/)
  assert.match(build((d) => { d.signing_reports[0].amount_basis = 'APPROXIMATE' }), /only EXACT or ROUNDED/)
  assert.match(build((d) => { d.signing_reports[0].amount_basis = 'ROUNDED' }), /ROUNDED and amount_precision go together/)
  assert.match(build((d) => { d.signing_reports[0].confidence = 'CERTAIN' }), /bad confidence/)
  assert.match(build((d) => { d.signing_reports[0].source = 'nowhere' }), /unknown source/)
  assert.match(build((d) => { d.signing_reports[0].note = 'x'.repeat(401) }), /note required/)
  assert.match(build((d) => { d.signing_reports.find((r) => r.ref === 'beltre-espn').amount = '23000.00' }), /do not disagree/)
  assert.match(build((d) => { d.signing_reports.find((r) => r.ref === 'beltre-espn').source = 'sabr_beltre'; d.sources = d.sources.filter((x) => x.key !== 'espn_beltre1999') }), /distinct sources/)
  assert.match(build((d) => { d.signing_reports = d.signing_reports.filter((r) => r.ref !== 'beltre-espn'); d.sources = d.sources.filter((x) => x.key !== 'espn_beltre1999') }), /a conflict needs two reports/)
  assert.match(build((d) => { d.signing_reports.push({ ...d.signing_reports[0], ref: 'dup', source: 'dd_2021class' }) }), /exactly one report/)
  assert.match(build((d) => { d.sources.push({ ...d.sources[0], key: 'unused', url: 'https://example.org/unused' }) }), /no report cites it/)
  assert.match(build((d) => { d.sources[0].url = 'http://dodgersdigest.com/x' }), /must be https/)
  assert.match(build((d) => { d.examined.find((e) => e.player_slug === 'sandy-amoros').outcome = 'UNRESOLVED' }), /examined list must record the same outcome/)
})

test('the evidence itself: every source is https and was read (no blocked host), every report is sourced and short, every signing exists', async () => {
  for (const s of evidence.sources) {
    assert.match(s.url, /^https:\/\//)
    assert.doesNotMatch(s.url, /mlb\.com|baseballamerica\.com|piratesprospects\.com/, `${s.key}: those pages answered 403/404 and were not read`)
    assert.match(s.accessed_at, /^2026-10-20T/)
  }
  for (const r of evidence.signing_reports) {
    assert.ok(r.note.length <= 400)
    assert.ok(Number(r.amount) > 0)
    assert.ok(evidence.sources.some((s) => s.key === r.source))
  }
  for (const e of evidence.examined) {
    const n = (await one(`select count(*)::int as n from public.signings sg join public.players p on p.id = sg.player_id where p.slug = $1 and sg.signing_year = $2`, [e.player_slug, e.signing_year])).n
    assert.equal(n, 1, e.player_slug)
  }
  assert.equal(evidence.examined.filter((e) => e.outcome === 'RESOLVED').length + evidence.examined.filter((e) => e.outcome === 'CONFLICT').length, 9)
  assert.match(evidence.policy.never_store.join(' '), /search-snippet/)
})
