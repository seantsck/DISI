#!/usr/bin/env node
// 059 release evidence (v3 architecture). The migration transaction proves only that its write is valid and that the direct result exists; the
// exhaustive proof that nothing else moved is done here, read-only, OUTSIDE the write transaction: a capture before the apply, a capture after the
// commit, and a pure comparison of the two.
//
//   capture   one read-only, repeatable-read transaction: database identity, catalog fingerprint, every public base table (row count + row
//             fingerprint), the product snapshots (business columns apart from generation / ids / timestamps, and their generations), drift,
//             the fifteen prediction / outcome / value / queue view fingerprints 059 v1/v2 computed inside the transaction, every metric
//             observation row, the full 059 measurement (database/research/059/measure.mjs) and the verifier (CANONICAL_EXPECTATIONS).
//   verify    compares two captures for one transition and returns PASS or HOLD with every check:
//               apply     pre-059 -> post-059: +11 exact observations, BWAR_MISSING -11, one generation, nothing else
//               noop      a rerun of 059: nothing at all changes, generation included
//               rollback  post-059 -> rolled back: equal to the original pre-059 capture, one more generation
//
//   DISI_VERIFY_DB_URL=... node database/research/059/release-evidence.mjs capture --out <file>
//   node database/research/059/release-evidence.mjs verify --kind apply --pre <file> --post <file>
//   node database/research/059/release-evidence.mjs verify --kind rollback --pre <post-apply file> --post <file> --original <pre-apply file>
// verify exits 0 on PASS and 2 on HOLD. Nothing is ever written to the database.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { measure } from './measure.mjs'
import { payload } from './build.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../../scripts/db/lib/invariants.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const sha1n = (f) => crypto.createHash('sha1').update(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).digest('hex')
export const MIGRATION = path.join(root, 'database/sql/059_career_bwar_metric_reconciliation.sql')
export const ROLLBACK = path.join(root, 'database/release/sql/rollback-059.sql')

export const ELEVEN = payload.players.map((p) => p.slug).sort()
export const EXCLUDED = [...payload.excluded_057].sort()
export const EVALUATION_FINGERPRINTS = '102c01a35d380d36493465cef1070c07,1aa73185a9dab3071d4530ee670dd088,86b58f473301e2425751d853abd88e94'
export const VERIFIER_TOTAL = 259
/** Snapshot columns that a refresh rewrites by design; everything else in a product_* table is business content. */
export const SNAPSHOT_VOLATILE = ['id', 'generation_id', 'generated_at', 'created_at', 'refreshed_at', 'snapshot_at', 'snapshot_as_of_date', 'computed_at', 'as_of', 'updated_at']

// collation-independent fingerprint: md5 per row, rows ordered by their md5 (the 059 v1/v2 transaction used exactly this form)
const fp = (from, where = '', drop = ['updated_at']) =>
  `select count(*)::int as n, md5(coalesce(string_agg(h, '' order by h), '')) as h from (select md5((to_jsonb(t) ${drop.map((k) => `- '${k}'`).join(' ')})::text) as h from ${from} t ${where}) z`
const SCOPE_IDS = `(select pl.id from public.players pl where pl.slug in (${ELEVEN.map((s) => `'${s}'`).join(', ')}))`

/** The fifteen layers 059 v1/v2 fingerprinted inside its transaction (the _m059_untouched view), now fingerprinted outside it. */
export const VIEW_FINGERPRINTS = {
  support: fp('public.v_outcome_target_support', '', []),
  training_population: fp('public.v_outcome_training_population', '', []),
  feature_matrix: fp('public.v_outcome_feature_matrix', '', []),
  evaluation_view: fp('public.v_outcome_model_evaluation', '', []),
  probabilities: fp('public.v_player_outcome_probability', '', []),
  expected_values: fp('public.v_expected_value_support', '', []),
  realized_outcome: fp('public.v_player_realized_outcome', '', []),
  realized_value: fp('public.v_player_realized_organizational_value', '', []),
  lineage: fp('public.v_transaction_asset_lineage', '', []),
  transaction_queue: fp('public.v_transaction_research_queue', '', []),
  value_queue: fp('public.v_value_research_queue', '', []),
  executive_overview: fp('public.v_executive_overview', '', []),
  research_tasks: fp('public.v_research_tasks', '', []),
  other_research_tasks: fp('public.v_research_tasks', `where t.task_type <> 'BWAR_MISSING' or t.franchise_key = 'DODGERS'`, []),
  other_metric_observations: fp('public.player_metric_observations', `where t.player_id not in ${SCOPE_IDS}`, []),
}
/** View fingerprints 059 moves by design (the queue it reconciles); compared through the exact BWAR_MISSING list instead. */
const VIEWS_059_MOVES = ['research_tasks']

const CATALOG_SQL = {
  rels: `select relname, relkind::text, coalesce(relacl::text, '') as acl, relrowsecurity as rls, relforcerowsecurity as frls, coalesce(array_to_string(reloptions, ','), '') as opts, relowner::regrole::text as owner
    from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v', 'm', 'i', 'S') order by 1`,
  views: `select relname, md5(pg_get_viewdef(oid)) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`,
  cols: `select table_name, column_name, data_type, ordinal_position, column_default, is_nullable from information_schema.columns where table_schema = 'public' order by 1, 4`,
  cons: `select conrelid::regclass::text as t, conname, md5(pg_get_constraintdef(oid)) as d from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`,
  fn: `select p.oid::regprocedure::text as f, coalesce(p.proacl::text, '') as acl, p.prosecdef, p.provolatile::text, coalesce(array_to_string(p.proconfig, ','), '') as cfg, md5(p.prosrc) as h, p.proowner::regrole::text as owner
    from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`,
  pol: `select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2`,
  trg: `select c.relname, t.tgname, t.tgenabled::text, md5(pg_get_triggerdef(t.oid)) as d from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`,
  nsp: `select nspname, coalesce(nspacl::text, '') as acl from pg_namespace where nspname = 'public'`,
}

const ident = (t) => `"${t.replace(/"/g, '""')}"`

/**
 * Captures the 059 release evidence through `query` (sql, params) => rows. The caller owns the transaction: run it inside one read-only,
 * repeatable-read transaction so every section reads one snapshot. Returns { evidence, timing }; the evidence is deterministic for a database state.
 */
export async function capture(query, { pins = {} } = {}) {
  const timing = {}
  const t = async (k, f) => { const t0 = Date.now(); const r = await f(); timing[k] = Date.now() - t0; return r }
  const one = async (sql) => (await query(sql))[0]
  const database = await t('database', async () => one(`select current_setting('server_version') as server_version, pg_postmaster_start_time()::text as postmaster_start,
    current_setting('statement_timeout') as statement_timeout, current_setting('work_mem') as work_mem, current_setting('transaction_isolation') as isolation,
    current_setting('transaction_read_only') as read_only`))
  const catalog = await t('catalog', async () => {
    const out = {}
    for (const [k, sql] of Object.entries(CATALOG_SQL)) out[k] = md5(await query(sql))
    return { ...out, md5: md5(out) }
  })
  const relnames = (await query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const tables = await t('tables', async () => {
    const out = {}
    for (const r of relnames.filter((x) => !x.startsWith('product_'))) out[r] = await one(fp(`public.${ident(r)}`))
    return out
  })
  const snapshots = await t('snapshots', async () => {
    const out = {}
    for (const r of relnames.filter((x) => x.startsWith('product_'))) {
      const cols = (await query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = '${r}'`)).map((c) => c.column_name)
      const b = await one(fp(`public.${ident(r)}`, '', SNAPSHOT_VOLATILE.filter((c) => cols.includes(c))))
      const g = await one(`select coalesce(array_agg(distinct generation_id order by generation_id), '{}') as g from public.${ident(r)}`)
      out[r] = { n: b.n, business: b.h, generations: g.g.map(Number) }
    }
    return out
  })
  const drift = await t('drift', async () => (await query(`select snapshot, missing_rows, extra_rows from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0 order by 1`)))
  const views = await t('views', async () => {
    const out = {}
    for (const [k, sql] of Object.entries(VIEW_FINGERPRINTS)) out[k] = await one(sql)
    return out
  })
  const metric_rows = await t('metric_rows', async () => (await query(`select (to_jsonb(m) - 'updated_at')::text as r from public.player_metric_observations m`)).map((r) => r.r).sort())
  const scope_ids = await t('scope_ids', async () => Object.fromEntries((await query(`select slug, id::text as id from public.players where slug in (${[...ELEVEN, ...EXCLUDED].map((s) => `'${s}'`).join(', ')}) order by 1`)).map((r) => [r.slug, r.id])))
  const m = await t('measure', async () => measure(query))
  const verifier = await t('verifier', async () => { const r = await checkInvariants(query, CANONICAL_EXPECTATIONS); return { total: r.hard.length, failed: failedChecks(r).map((x) => x.name) } })
  const evidence = { kind: 'disi-059-release-evidence', version: 3, pins, database, catalog, tables, snapshots, drift, views, metric_rows, scope_ids, measure: m, verifier }
  return { evidence, timing }
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const careerOf = (e) => e.measure.metric.find((x) => x.metric_key === 'CAREER_BWAR')?.observations ?? 0
const missingOf = (e) => e.measure.bwar_missing.map((x) => x.player_slug)
const generationOf = (e) => e.measure.snapshots.generation
const expectedScoped = () => payload.players.map((p) => ({ slug: p.slug, value: Number(p.career_bwar).toFixed(3), observed_through_date: payload.semantics.observed_through_date,
  observed_through_season: payload.semantics.observed_through_season, source_url: payload.sources.bat_url, confidence: 'VERIFIED', notes: p.notes })).sort((a, b) => (a.slug < b.slug ? -1 : 1))
/** The measurement sections 059 moves by design; each is checked exactly below, every other section must be identical. */
const MEASURE_059_MOVES = ['metric', 'scoped_metric', 'bwar_missing', 'tasks', 'research_tasks', 'research_task_types', 'dossier', 'snapshots']
// the measurement with the snapshot generation counter set aside (a refresh moves it by design; the generation is checked exactly on its own)
const stable = (m) => ({ ...m, counts: { ...m.counts, snapshot_generation: undefined }, snapshots: undefined })
const withoutBwarMissing = (rows) => rows.filter((x) => x.task_type !== 'BWAR_MISSING')
const bwarItems = (rows) => rows.filter((x) => x.task_type === 'BWAR_MISSING').reduce((s, x) => s + x.items, 0)

function checker() {
  const checks = []
  const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: pass ? '' : String(detail).slice(0, 400) }); return pass }
  const result = () => ({ verdict: checks.every((c) => c.pass) ? 'PASS' : 'HOLD', passed: checks.filter((c) => c.pass).length, total: checks.length, checks })
  return { check, result }
}
const diffTables = (a, b, allow = []) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !allow.includes(k) && !eq(a[k], b[k])).sort()

/** The checks every transition shares: the same release bytes, the schema / security catalog, the verifier, the prediction outputs. */
function common(check, pre, post) {
  check('release pins: the same migration and rollback bytes in both captures', eq(pre.pins.migration_sha256, post.pins.migration_sha256) && eq(pre.pins.rollback_sha256, post.pins.rollback_sha256),
    `${pre.pins.migration_sha256} / ${post.pins.migration_sha256}`)
  check('schema and security catalog identical (relations, views, columns, constraints, functions, policies, triggers, ACLs)', pre.catalog.md5 === post.catalog.md5,
    Object.keys(pre.catalog).filter((k) => pre.catalog[k] !== post.catalog[k]).join(','))
  check(`verifier ${post.verifier.total - post.verifier.failed.length}/${post.verifier.total} (expected ${VERIFIER_TOTAL}/${VERIFIER_TOTAL})`, post.verifier.total === VERIFIER_TOTAL && post.verifier.failed.length === 0, post.verifier.failed.join(','))
  const p = post.measure.prediction
  check('prediction outputs all zero (supported models, probabilities, expected values, recommendations, supported targets) and the evaluation fingerprints are the reviewed three',
    p.supported_models === 0 && p.probabilities === 0 && p.expected_values === 0 && p.recommendations === 0 && p.supported_targets === 0 && p.evaluation_fingerprints === EVALUATION_FINGERPRINTS, JSON.stringify(p))
  check('snapshot drift 0', post.drift.length === 0 && post.measure.snapshots.drifting === 0, JSON.stringify(post.drift))
}

/** pre-059 -> post-059. */
export function verifyApply(pre, post) {
  const { check, result } = checker()
  common(check, pre, post)
  // the one table 059 writes, exactly
  const changed = diffTables(pre.tables, post.tables)
  check('base tables: only player_metric_observations changed (every other public base table: same row count and row fingerprint)', eq(changed, ['player_metric_observations']), changed.join(','))
  const before = new Set(pre.metric_rows), after = new Set(post.metric_rows)
  const removed = pre.metric_rows.filter((r) => !after.has(r)), added = post.metric_rows.filter((r) => !before.has(r)).map((r) => JSON.parse(r))
  const idSlug = Object.fromEntries(Object.entries(post.scope_ids).map(([s, id]) => [id, s]))
  check('player_metric_observations: every pre-059 row present and unchanged; exactly 11 rows added, one CAREER_BWAR row for each of the eleven, none for a 057 player',
    removed.length === 0 && added.length === 11 && added.every((r) => r.metric_key === 'CAREER_BWAR') && eq(added.map((r) => idSlug[r.player_id]).sort(), ELEVEN),
    `removed ${removed.length}, added ${added.length}: ${added.map((r) => idSlug[r.player_id] ?? r.player_id).join(',')}`)
  check('the eleven observations, every column as released (value, date, season, source, confidence, notes)', eq(post.measure.scoped_metric, expectedScoped()),
    JSON.stringify(post.measure.scoped_metric.map((x) => [x.slug, x.value])))
  check(`CAREER_BWAR ${careerOf(pre)} -> ${careerOf(post)} (+11)`, careerOf(post) === careerOf(pre) + 11 && eq(withoutCareer(pre), withoutCareer(post)))
  const m0 = missingOf(pre), m1 = missingOf(post)
  check(`BWAR_MISSING ${m0.length} -> ${m1.length}: exactly the eleven leave, the 057 eleven and every other player stay`,
    eq(m1, m0.filter((s) => !ELEVEN.includes(s))) && ELEVEN.every((s) => m0.includes(s)) && EXCLUDED.every((s) => m1.includes(s)), `${m0.length} -> ${m1.length}`)
  check('research tasks: only BWAR_MISSING moves, by -11; every other task type and every Dodgers task identical',
    eq(withoutBwarMissing(pre.measure.tasks), withoutBwarMissing(post.measure.tasks)) && eq(withoutBwarMissing(pre.measure.research_task_types), withoutBwarMissing(post.measure.research_task_types))
      && bwarItems(post.measure.research_task_types) === bwarItems(pre.measure.research_task_types) - 11 && pre.views.other_research_tasks.h === post.views.other_research_tasks.h
      && eq(withoutBwarMissing(pre.measure.research_tasks), withoutBwarMissing(post.measure.research_tasks)) && bwarItems(post.measure.research_tasks) === bwarItems(pre.measure.research_tasks) - 11)
  const d0 = Object.fromEntries(pre.measure.dossier.map((d) => [d.player_slug, d])), d1 = Object.fromEntries(post.measure.dossier.map((d) => [d.player_slug, d]))
  const want = Object.fromEntries(payload.players.map((p) => [p.slug, Number(p.career_bwar)]))
  check('dossiers: the eleven read the observation through 2026-09-28 / 2026; the 057 eleven unchanged (no observation); active status unchanged',
    ELEVEN.every((s) => d1[s] && Number(d1[s].career_bwar) === want[s] && d1[s].bwar_observed_through_season === 2026 && d1[s].bwar_observed_through_date === '2026-09-28' && d1[s].is_active === d0[s].is_active)
      && EXCLUDED.every((s) => eq(d0[s], d1[s]) && d1[s].career_bwar === null))
  // everything else in the measurement, and the view fingerprints the transaction no longer computes
  const sm0 = stable(pre.measure), sm1 = stable(post.measure)
  const mDiff = Object.keys({ ...sm0, ...sm1 }).filter((k) => !MEASURE_059_MOVES.includes(k) && !eq(sm0[k], sm1[k]))
  check('measurement: every other section identical (sources, WAR, outcomes, labels, support, evaluations, prediction, value totals, executive, lineage, queues, isolation fingerprints, ...)',
    mDiff.length === 0, mDiff.join(','))
  const vDiff = Object.keys(pre.views).filter((k) => !VIEWS_059_MOVES.includes(k) && !eq(pre.views[k], post.views[k]))
  check('view fingerprints identical: support, training population, feature matrix, evaluations, probabilities, expected values, realized outcome and value, lineage, both queues, executive overview, other research tasks, other observations',
    vDiff.length === 0, vDiff.join(','))
  const mv = post.measure
  check('sources 3384, active team-season WAR 2025, realized 299.00 / 88 resolved, queues 57 / 90',
    mv.counts.sources === 3384 && mv.war.active === 2025 && mv.value_totals.realized === '299.00' && mv.value_totals.resolved === 88
      && mv.transaction_queue.reduce((s, x) => s + x.items, 0) === 57 && mv.value_queue.reduce((s, x) => s + x.items, 0) === 90)
  // snapshots: one new generation everywhere, business content unchanged
  const g0 = generationOf(pre)
  const sGen = Object.entries(post.snapshots).filter(([, s]) => !eq(s.generations, [g0 + 1])).map(([k]) => k)
  const sBiz = Object.keys(pre.snapshots).filter((k) => !post.snapshots[k] || pre.snapshots[k].business !== post.snapshots[k].business || pre.snapshots[k].n !== post.snapshots[k].n)
  check(`snapshots: generation ${g0} -> ${g0 + 1} on all ${Object.keys(post.snapshots).length} tables`, generationOf(post) === g0 + 1 && Number(post.measure.counts.snapshot_generation) === g0 + 1 && sGen.length === 0 && Object.keys(post.snapshots).length === Object.keys(pre.snapshots).length, sGen.join(','))
  check('snapshots: business content identical in every product_* table (generation, ids and timestamps aside)', sBiz.length === 0, sBiz.join(','))
  return result()
}
const withoutCareer = (e) => e.measure.metric.filter((x) => x.metric_key !== 'CAREER_BWAR')

/** A rerun that must change nothing at all. */
export function verifyNoop(pre, post) {
  const { check, result } = checker()
  common(check, pre, post)
  const changed = diffTables(pre.tables, post.tables)
  check('base tables: none changed', changed.length === 0, changed.join(','))
  check('player_metric_observations: every row identical', eq(pre.metric_rows, post.metric_rows))
  check('snapshots: same generation and business content in every product_* table', eq(pre.snapshots, post.snapshots),
    Object.keys(pre.snapshots).filter((k) => !eq(pre.snapshots[k], post.snapshots[k])).join(','))
  const vDiff = Object.keys(pre.views).filter((k) => !eq(pre.views[k], post.views[k]))
  check('view fingerprints identical (all fifteen)', vDiff.length === 0, vDiff.join(','))
  const mDiff = Object.keys({ ...pre.measure, ...post.measure }).filter((k) => !eq(pre.measure[k], post.measure[k]))
  check('measurement identical (every section, the snapshot generation included)', mDiff.length === 0, mDiff.join(','))
  return result()
}

/** post-059 -> rolled back; `original` is the pre-059 capture the release started from. */
export function verifyRollback(postApply, post, original) {
  const { check, result } = checker()
  common(check, postApply, post)
  check('catalog equal to the original pre-059 capture', post.catalog.md5 === original.catalog.md5)
  const changed = diffTables(original.tables, post.tables)
  check('base tables: every public base table equal to the original pre-059 capture (player_metric_observations included)', changed.length === 0, changed.join(','))
  check('player_metric_observations: exactly the original pre-059 rows (the eleven deleted, nothing else touched)', eq(post.metric_rows, original.metric_rows)
    && postApply.metric_rows.length - post.metric_rows.length === 11, `${postApply.metric_rows.length} -> ${post.metric_rows.length}`)
  check(`CAREER_BWAR back to ${careerOf(original)}, BWAR_MISSING back to the original ${missingOf(original).length}`, careerOf(post) === careerOf(original) && eq(missingOf(post), missingOf(original)))
  const vDiff = Object.keys(original.views).filter((k) => !eq(original.views[k], post.views[k]))
  check('view fingerprints equal to the original pre-059 capture (all fifteen)', vDiff.length === 0, vDiff.join(','))
  const so = stable(original.measure), sp = stable(post.measure)
  const mDiff = Object.keys({ ...so, ...sp }).filter((k) => !eq(so[k], sp[k]))
  check('measurement equal to the original pre-059 capture (every section; the snapshot generation aside)', mDiff.length === 0, mDiff.join(','))
  const g = generationOf(postApply)
  const sGen = Object.entries(post.snapshots).filter(([, s]) => !eq(s.generations, [g + 1])).map(([k]) => k)
  const sBiz = Object.keys(original.snapshots).filter((k) => !post.snapshots[k] || original.snapshots[k].business !== post.snapshots[k].business || original.snapshots[k].n !== post.snapshots[k].n)
  check(`snapshots: generation ${g} -> ${g + 1} on every table`, generationOf(post) === g + 1 && Number(post.measure.counts.snapshot_generation) === g + 1 && sGen.length === 0, sGen.join(','))
  check('snapshots: business content equal to the original pre-059 capture', sBiz.length === 0, sBiz.join(','))
  return result()
}

export const verify = (kind, pre, post, original) =>
  kind === 'apply' ? verifyApply(pre, post) : kind === 'noop' ? verifyNoop(pre, post) : kind === 'rollback' ? verifyRollback(pre, post, original) : (() => { throw new Error(`unknown kind ${kind}`) })()

export const releasePins = () => {
  const git = (...a) => { try { return execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim() } catch { return null } }
  return { main: git('rev-parse', 'origin/main'), head: git('rev-parse', 'HEAD'), migration_sha256: sha256(MIGRATION), migration_sha1_normalized: sha1n(MIGRATION), rollback_sha256: sha256(ROLLBACK) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
  const cmd = process.argv[2]
  if (cmd === 'capture') {
    const url = process.env.DISI_VERIFY_DB_URL
    if (!url) throw new Error('set DISI_VERIFY_DB_URL')
    const { Client } = (await import(['p', 'g'].join(''))).default
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: 'disi-059-release-evidence' })
    await client.connect()
    const t0 = Date.now()
    await client.query('begin transaction isolation level repeatable read read only')
    try {
      const { evidence, timing } = await capture(async (sql, params) => (await client.query(sql, params)).rows, { pins: releasePins() })
      const out = arg('out')
      if (out) fs.writeFileSync(path.resolve(out), JSON.stringify(evidence, null, 1) + '\n')
      process.stderr.write(`capture: ${Date.now() - t0} ms ${JSON.stringify(timing)}\n`)
      process.stdout.write(`captured: CAREER_BWAR ${careerOf(evidence)}, BWAR_MISSING ${missingOf(evidence).length}, generation ${generationOf(evidence)}, drift ${evidence.drift.length}, verifier ${evidence.verifier.total - evidence.verifier.failed.length}/${evidence.verifier.total}\n`)
    } finally { await client.query('rollback'); await client.end() }
  } else if (cmd === 'verify') {
    const load = (k) => (arg(k) ? JSON.parse(fs.readFileSync(path.resolve(arg(k)), 'utf8')) : undefined)
    const r = verify(arg('kind'), load('pre'), load('post'), load('original'))
    for (const c of r.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ' - ' + c.detail : ''}`)
    console.log(`\n059 ${arg('kind')} verification: ${r.passed}/${r.total} -> ${r.verdict === 'PASS' ? 'PASS' : 'HOLD (stop: no merge, deploy or freeze; inspect the mismatch)'}`)
    process.exit(r.verdict === 'PASS' ? 0 : 2)
  } else {
    console.error('usage: release-evidence.mjs capture --out <file> | verify --kind apply|noop|rollback --pre <file> --post <file> [--original <file>]')
    process.exit(1)
  }
}
