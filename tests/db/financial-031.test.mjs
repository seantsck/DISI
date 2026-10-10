// Migration 031 - financial provenance and coverage expansion.
//
// One 001-030 database is built; 031's guards are tested on that pre-031 state in rolled-back transactions,
// then 031 is applied for real (committed) and the remaining tests run on the result, again in rolled-back
// transactions. Test order matters.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough, buildCanonicalChain } from './canonical-chain.mjs'
import { lit, withoutTransaction } from './drift-027.mjs'
import { financialQueries } from '../../scripts/db/lib/financial-invariants.mjs'
import { checkInvariants, failedChecks } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '031_financial_provenance_coverage_expansion.sql'
const sql031 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const inner = withoutTransaction(sql031)
const seed = JSON.parse(fs.readFileSync(path.join(root, 'database/research/031/seed-evidence.json'), 'utf8'))
const audit = JSON.parse(fs.readFileSync(path.join(root, 'database/research/031/audit-report.json'), 'utf8'))
const src = Object.fromEntries(seed.sources.map((s) => [s.key, s.url]))
const NEW_FILE_TABLES = ['signing_financial_resolutions']

let chain
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
before(async () => { chain = await buildChainThrough('030_financial_acquisition_intelligence.sql') }, { timeout: 180000 })
after(async () => { await chain.close() })

const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
let depth = 0
async function inTxn(body) {
  await chain.db.exec('begin;')
  depth++
  try { return await body() } finally { depth--; await chain.db.exec('rollback;') }
}
async function attempt(sql) {
  if (depth > 0) {
    await chain.db.exec('savepoint attempt_sp;')
    try { await chain.db.exec(sql); return 'accepted' } catch (e) { return String(e.message) } finally { await chain.db.exec('rollback to savepoint attempt_sp; release savepoint attempt_sp;') }
  }
  await chain.db.exec('begin;')
  try { await chain.db.exec(sql); return 'accepted' } catch (e) { return String(e.message) } finally { await chain.db.exec('rollback;') }
}
const tableHashes = async () => {
  const tables = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5((await q(`select t::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const failing = async (resolutions = true) => {
  const out = []
  for (const [name, sql] of Object.entries(financialQueries(resolutions))) if ((await one(sql)).n !== 0) out.push(name)
  return out.sort()
}
const SIGNING = (slug, year) => `(select sg.id from signings sg join players p on p.id = sg.player_id where p.slug = ${lit(slug)} and sg.signing_year = ${year})`
const ENV = (year) => `(select se.id from signing_environments se join organizations o on o.id = se.organization_id where o.name = 'Los Angeles Dodgers' and se.signing_year = ${year})`
const SOURCE = (key) => `(select id from sources where url = ${lit(src[key])})`
const report = (o = {}) => {
  const c = {
    signing_id: SIGNING('jerming-rosario', 2018), component_type: "'SIGNING_BONUS'", amount: '650000', currency_code: "'USD'", amount_basis: "'EXACT'",
    amount_precision: 'null', report_origin: "'EXTERNAL_SOURCE'", source_id: SOURCE('ba1819'), evidence_basis: "'PUBLISHED_INTERNATIONAL_REVIEW'", confidence: "'HIGH'",
    retrieved_at: "timestamptz '2026-10-09 00:00:00+00'", note: "'test'",
  }
  for (const [k, v] of Object.entries(o)) c[k] = v
  return `insert into signing_financial_reports (${Object.keys(c).join(', ')}) values (${Object.values(c).join(', ')})`
}
const decision = (o = {}) => {
  const c = { signing_id: SIGNING('jerming-rosario', 2018), component_type: "'SIGNING_BONUS'", selected_report_id: `(select id from signing_financial_reports where signing_id = ${SIGNING('jerming-rosario', 2018)}
      and component_type = 'SIGNING_BONUS' and amount = 650000 and record_status = 'ACTIVE')`, basis: "'SOURCE_PRECEDENCE'", source_id: 'null',
    rationale: "'test decision'", reviewed_by: "'test reviewer'", reviewed_at: "timestamptz '2026-10-09 00:00:00+00'" }
  for (const [k, v] of Object.entries(o)) c[k] = v
  return `insert into signing_financial_resolutions (${Object.keys(c).join(', ')}) values (${Object.values(c).join(', ')})`
}
let pre

// ---------------------------------------------------------------------------------------------
// 031 on the pre-031 database
// ---------------------------------------------------------------------------------------------

test('baseline: a 001-030 replay is 53 tables / 97 views, 9 environments, no resolution table; the five pool gaps are queued', async () => {
  assert.deepEqual(await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views, (select count(*) from signing_environments)::int as environments`),
    { tables: 53, views: 97, environments: 9 })
  assert.equal((await one(`select to_regclass('public.signing_financial_resolutions') is null as gone`)).gone, true)
  assert.deepEqual((await q(`select left(detail, 4) as y from v_financial_research_queue where issue = 'POOL_CAPACITY_UNKNOWN' order by 1`)).map((r) => r.y), ['2012', '2013', '2014', '2017', '2021'])
  assert.deepEqual(await failing(false), [], 'the 030 checks are clean before 031')
  pre = {
    hashes: await tableHashes(),
    signings: await q(`select p.slug, sg.signing_year, sg.signing_bonus_usd::text as b, sg.bonus_publicly_reported as f, sg.signing_environment_id is not null as env from signings sg join players p on p.id = sg.player_id order by 1, 2`),
  }
})

test('preconditions: an unexpected canonical state aborts 031 with nothing changed', async () => {
  const cases = [
    ['Soto already has a different bonus', `update signings set signing_bonus_usd = 1 where id = ${SIGNING('william-soto', 2012)};`, /william-soto already has a different bonus/],
    ['an upgrade player has a different bonus', `update signings set signing_bonus_usd = 1 where id = ${SIGNING('oneil-cruz', 2015)};`, /oneil-cruz has an unexpected bonus/],
    ['Rincon has an unexpected bonus', `update signings set signing_bonus_usd = 360000 where id = ${SIGNING('carlos-rincon', 2015)};`, /carlos-rincon has an unexpected bonus/],
    ['the 2021-22 allocation drifted', `update signing_environments set club_bonus_pool_usd = 4000000 where id = ${ENV(2022)};`, /2021-22 environment does not carry the reviewed/],
    ['the 2017 pool already holds another value', `update signing_environments set club_bonus_pool_usd = 1 where id = ${ENV(2017)};`, /already has a different pool/],
    ['an environment to add already exists with other content', `insert into signing_environments (organization_id, signing_year, regime, club_bonus_pool_usd, signing_period_label)
      values ((select id from organizations where name = 'Los Angeles Dodgers'), 2012, 'STANDARD_POOL', 1, '2012-13');`, /environment exists with unexpected content/],
  ]
  for (const [label, drift, expected] of /** @type {Array<[string, string, RegExp]>} */ (cases)) assert.match(await attempt(`${drift}\n${inner}`), expected, label)
  assert.deepEqual(await tableHashes(), pre.hashes, 'aborted runs changed nothing')
})

test('031 applied for real: 53 -> 54 tables, 97 views, 9 -> 13 environments; one table, one function, one trigger, no new view', async () => {
  await chain.db.exec(sql031)
  assert.deepEqual(await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views, (select count(*) from signing_environments)::int as environments`),
    { tables: 54, views: 97, environments: 13 })
  assert.deepEqual((await q(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'disi\\_%financial\\_resolution%'`)).map((r) => r.proname), ['disi_signing_financial_resolution_guard'])
  assert.deepEqual((await q(`select tgname from pg_trigger where not tgisinternal and tgrelid = 'public.signing_financial_resolutions'::regclass`)).map((r) => r.tgname), ['signing_financial_resolutions_guard'])
  assert.equal((await one(`select count(*)::int as n from signing_financial_resolutions`)).n, 0, 'no decision is recorded in 031')
  // v_signing_acquisition_financials kept every 030 column in order and appended one
  const cols = (await q(`select attname from pg_attribute where attrelid = 'public.v_signing_acquisition_financials'::regclass and attnum > 0 order by attnum`)).map((r) => r.attname)
  assert.equal(cols.at(-1), 'resolved_components')
  assert.equal(cols.length, 42, 'the 41 columns of 030 plus resolved_components')
})

test('only the expected tables changed; scouting, development, network, 027-029 data and the legacy WAR view definitions are untouched', async () => {
  const now = await tableHashes()
  const changed = Object.keys(now).filter((t) => pre.hashes[t] !== now[t]).sort()
  assert.deepEqual(changed, ['signing_environment_financial_reports', 'signing_environments', 'signing_financial_reports', 'signing_financial_resolutions', 'signings', 'sources'].sort())
  for (const t of ['player_evaluations', 'player_evaluation_grades', 'player_evaluation_rankings', 'player_evaluation_notes', 'scouting_publications', 'player_season_stints', 'development_milestones',
    'development_progression_decisions', 'transactions', 'evidence', 'player_aliases', 'signing_population_members', 'signing_population_member_sources', 'international_org_period_summary',
    'network_entities', 'network_entity_aliases', 'network_entity_relationships', 'player_network_relationships', 'network_entity_identity_reviews', 'acquisition_cost_component_rules']) {
    assert.equal(now[t], pre.hashes[t], `${t} is unchanged`)
  }
  for (const [v, md] of Object.entries(audit.legacy_war_per_dollar_view_definitions_md5)) {
    assert.equal(crypto.createHash('md5').update((await one(`select pg_get_viewdef($1::regclass) as d`, [`public.${v}`])).d).digest('hex'), md, `${v} definition is unchanged`)
  }
  // signings: only the 18 reviewed bonus facts and the period-membership links change
  const after = await q(`select p.slug, sg.signing_year, sg.signing_bonus_usd::text as b, sg.bonus_publicly_reported as f, sg.signing_environment_id is not null as env from signings sg join players p on p.id = sg.player_id order by 1, 2`)
  const diffs = after.map((r, i) => [r, pre.signings[i]]).filter(([a, b]) => JSON.stringify(a) !== JSON.stringify(b))
  const bonusChanged = diffs.filter(([a, b]) => a.b !== b.b).map(([a]) => a.slug).sort()
  assert.deepEqual(bonusChanged, ['carlos-rincon', 'elias-medina', 'luis-luna', 'samuel-sanchez', 'william-soto'])
  assert.equal(diffs.filter(([a, b]) => a.env !== b.env).length, 33, 'the 33 dated signings inside the five period windows are linked (6 + 0 + 1 + 4 + 22)')
})

test('rerun is a no-op: no row, grant, policy or definition changes', async () => {
  const snap = async () => ({ hashes: await tableHashes(), acl: await q(`select c.relname, coalesce(array_to_string(c.relacl, ','), '') as acl from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') order by 1`),
    policies: await q(`select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 2`),
    defs: await q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`) })
  const first = await snap()
  await chain.db.exec(sql031)
  assert.deepEqual(await snap(), first)
})

// ---------------------------------------------------------------------------------------------
// facts
// ---------------------------------------------------------------------------------------------

test('pool capacity: five periods have a sourced pool, POOL_CAPACITY_UNKNOWN is 0, and nothing is invented', async () => {
  const envs = await q(`select se.signing_year, se.signing_period_label, se.regime::text, se.club_bonus_pool_usd::text as pool, se.pool_after_trades_usd::text as after, se.tradeable_pool_space
    from signing_environments se where se.organization_id = (select id from organizations where name = 'Los Angeles Dodgers') and se.signing_year in (2012, 2013, 2014, 2017, 2021, 2022) order by 1`)
  assert.deepEqual(envs, [
    { signing_year: 2012, signing_period_label: '2012-13', regime: 'STANDARD_POOL', pool: '2900000.00', after: null, tradeable_pool_space: null },
    { signing_year: 2013, signing_period_label: '2013-14', regime: 'STANDARD_POOL', pool: '2112900.00', after: null, tradeable_pool_space: true },
    { signing_year: 2014, signing_period_label: '2014-15', regime: 'STANDARD_POOL', pool: '1963800.00', after: null, tradeable_pool_space: true },
    { signing_year: 2017, signing_period_label: '2017-18', regime: 'PENALTY_RESTRICTED', pool: '4750000.00', after: null, tradeable_pool_space: null },
    { signing_year: 2021, signing_period_label: '2020-21', regime: 'MODERN_HARD_POOL', pool: '5348100.00', after: null, tradeable_pool_space: false },
    { signing_year: 2022, signing_period_label: '2021-22', regime: 'MODERN_HARD_POOL', pool: '4644000.00', after: null, tradeable_pool_space: true },
  ])
  assert.equal((await one(`select count(*)::int as n from v_financial_research_queue where issue = 'POOL_CAPACITY_UNKNOWN'`)).n, 0)
  // every new pool is an EXTERNAL report with a source; none is a derived post-trade figure
  const reps = await q(`select se.signing_year, r.metric_type, r.amount_usd::text as amount, r.amount_basis, r.amount_precision::text as prec, r.report_origin, so.url from signing_environment_financial_reports r
    join signing_environments se on se.id = r.signing_environment_id join sources so on so.id = r.source_id where r.report_origin = 'EXTERNAL_SOURCE' and se.signing_year in (2012, 2013, 2014, 2017, 2021, 2022)
    and se.organization_id = (select id from organizations where name = 'Los Angeles Dodgers') order by 1, 2, 7`)
  assert.equal(reps.length, 10, '9 new reports plus the existing 2017 individual-cap report from 030')
  assert.deepEqual(reps.filter((r) => r.signing_year === 2012), [{ signing_year: 2012, metric_type: 'BASE_POOL', amount: '2900000.00', amount_basis: 'ROUNDED', prec: '100000.00000', report_origin: 'EXTERNAL_SOURCE', url: src.mlbtr2012 }])
  assert.equal((await one(`select count(*)::int as n from signing_environment_financial_reports where metric_type = 'POOL_AFTER_TRADES' and report_origin = 'EXTERNAL_SOURCE'
    and signing_environment_id <> ${ENV(2015)}`)).n, 0)
  // 2021-22: the pool is the sourced post-penalty allocation; the penalty is a memo and is not subtracted again
  const pen = await q(`select r.metric_type, r.amount_usd::text as amount, r.note from signing_environment_financial_reports r where r.signing_environment_id = ${ENV(2022)} and r.metric_type = 'PENALTY_REDUCTION'`)
  assert.equal(pen.length, 1)
  assert.equal(pen[0].amount, '500000.00')
  assert.match(pen[0].note, /must not be subtracted again/)
  assert.equal((await one(`select count(*)::int as n from signing_environment_financial_reports where signing_environment_id = ${ENV(2022)} and metric_type = 'BASE_POOL' and amount_usd <> 4644000`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from signing_environment_financial_reports where amount_usd in (5144000, 5179700, 4679700)`)).n, 0, 'no pre-penalty base is invented')
  // denominators only: no period gained true utilization
  assert.equal((await one(`select count(*)::int as n from v_dodgers_financial_commitment_by_class where true_disi_row_utilization_pct is not null`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from v_dodgers_financial_commitment_by_class where source_reported_utilization_pct is not null`)).n, 1, '2019-20 stays the only source-reported utilization')
})

test('provenance: 13 same-amount upgrades keep the legacy row ACTIVE as corroboration; 4 new bonuses are sourced; counts are exact', async () => {
  const upgrades = seed.signing_reports.filter((r) => r.kind === 'UPGRADE')
  assert.equal(upgrades.length, 13)
  for (const u of upgrades) {
    const r = await q(`select r.report_origin, r.record_status, r.amount::text as amount from signing_financial_reports r join signings s on s.id = r.signing_id join players p on p.id = s.player_id
      where p.slug = $1 and s.signing_year = $2 and r.component_type = 'SIGNING_BONUS' order by r.report_origin`, [u.player_slug, u.signing_year])
    assert.deepEqual(r.map((x) => [x.report_origin, x.record_status]), [['EXTERNAL_SOURCE', 'ACTIVE'], ['LEGACY_CARRYFORWARD', 'ACTIVE']], u.ref)
    assert.equal(Number(r[0].amount), Number(u.amount))
  }
  const bonus = Object.fromEntries((await q(`select bonus_source_status as k, count(*)::int as n from v_signing_acquisition_financials where bonus_status = 'KNOWN' group by 1`)).map((r) => [r.k, r.n]))
  assert.deepEqual(bonus, { EXTERNALLY_SOURCED: 24, LEGACY_CANONICAL_ONLY: 69 })
  assert.equal((await one(`select count(*)::int as n from v_signing_acquisition_financials where bonus_status = 'KNOWN'`)).n, 93)
  assert.equal((await one(`select count(*)::int as n from v_financial_research_queue where issue = 'FINANCIAL_SOURCE_MISSING'`)).n, 75)
  // the four new bonuses: canonical column, flag and one external report each
  for (const [slug, year, amount] of /** @type {Array<[string, number, string]>} */ ([['william-soto', 2012, '190000.00'], ['elias-medina', 2023, '177500.00'], ['samuel-sanchez', 2023, '17500.00'], ['luis-luna', 2025, '140000.00']])) {
    const r = await one(`select s.signing_bonus_usd::text as b, s.bonus_publicly_reported as f, (select count(*)::int from signing_financial_reports x where x.signing_id = s.id and x.report_origin = 'EXTERNAL_SOURCE' and x.record_status = 'ACTIVE') as ext,
      (select count(*)::int from signing_financial_reports x where x.signing_id = s.id and x.report_origin = 'LEGACY_CARRYFORWARD') as legacy from signings s join players p on p.id = s.player_id where p.slug = $1 and s.signing_year = $2`, [slug, year])
    assert.deepEqual(r, { b: amount, f: true, ext: 1, legacy: 0 }, slug)
  }
  // Luna is on the OTHER pathway: known bonus, completeness stays NO_RULE
  assert.equal((await one(`select acquisition_cost_completeness as c from v_signing_acquisition_financials where player_slug = 'luis-luna'`)).c, 'NO_RULE')
  assert.equal((await one(`select acquisition_cost_completeness as c from v_signing_acquisition_financials where player_slug = 'william-soto'`)).c, 'COMPLETE')
})

test('Rincon: the unsourced legacy $350,000 is superseded by the directly read $325,000; no resolution row is needed', async () => {
  const reps = await q(`select r.report_origin, r.amount::text as amount, r.record_status, r.retraction_reason, r.supersedes_report_id is not null as sup from signing_financial_reports r
    join signings s on s.id = r.signing_id join players p on p.id = s.player_id where p.slug = 'carlos-rincon' and r.component_type = 'SIGNING_BONUS' order by r.report_origin`)
  assert.deepEqual(reps, [
    { report_origin: 'EXTERNAL_SOURCE', amount: '325000.00', record_status: 'ACTIVE', retraction_reason: null, sup: true },
    { report_origin: 'LEGACY_CARRYFORWARD', amount: '350000.00', record_status: 'RETRACTED', retraction_reason: 'Superseded by a corrected report.', sup: false },
  ])
  assert.deepEqual(await one(`select signing_bonus_usd::text as b, bonus_source_status as st, conflicting_components as cc from v_signing_acquisition_financials where player_slug = 'carlos-rincon'`),
    { b: '325000.00', st: 'EXTERNALLY_SOURCED', cc: [] })
  assert.equal((await one(`select count(*)::int as n from signing_financial_resolutions`)).n, 0)
})

test('deferred items are untouched: Rosario, Torres and Sasaki keep their pre-031 values and no disagreeing report was seeded', async () => {
  assert.deepEqual(await q(`select player_slug, signing_bonus_usd::text as b, posting_fee_usd::text as pf, external_report_count, legacy_report_count, conflicting_components as cc
    from v_signing_acquisition_financials where player_slug in ('jerming-rosario', 'adrian-torres', 'roki-sasaki') order by 1`), [
    { player_slug: 'adrian-torres', b: '362500.00', pf: null, external_report_count: 0, legacy_report_count: 1, cc: [] },
    { player_slug: 'jerming-rosario', b: '600000.00', pf: null, external_report_count: 0, legacy_report_count: 1, cc: [] },
    { player_slug: 'roki-sasaki', b: '6500000.00', pf: null, external_report_count: 4, legacy_report_count: 1, cc: ['POSTING_FEE'] },
  ])
  assert.deepEqual((await q(`select r.amount::text as amount, r.record_status from signing_financial_reports r join signings s on s.id = r.signing_id join players p on p.id = s.player_id
    where p.slug = 'roki-sasaki' and r.component_type = 'POSTING_FEE' order by 1 desc`)), [{ amount: '1625000.00', record_status: 'ACTIVE' }, { amount: '1300000.00', record_status: 'ACTIVE' }])
  assert.equal((await one(`select count(*)::int as n from v_financial_research_queue where issue = 'FINANCIAL_REPORT_CONFLICT'`)).n, 1)
  // Sandoval and Gomez were not added to the tracked population
  assert.equal((await one(`select count(*)::int as n from players where full_name ~* '(sandoval|cristian g[oó]mez)'`)).n, 0)
})

test('environment links: supported period membership only; pathway does not decide; international_pool_treatment is untouched', async () => {
  const linked = await q(`select se.signing_year, count(*)::int as n from signings s join signing_environments se on se.id = s.signing_environment_id
    where se.organization_id = (select id from organizations where name = 'Los Angeles Dodgers') and se.signing_year in (2012, 2013, 2014, 2017, 2021) group by 1 order by 1`)
  assert.deepEqual(linked, [{ signing_year: 2012, n: 6 }, { signing_year: 2014, n: 1 }, { signing_year: 2017, n: 4 }, { signing_year: 2021, n: 22 }])
  // posted / Cuban-pro signings dated inside a window are linked; the pre-pool Puig (2012-06-29) is not
  assert.equal((await one(`select se.signing_year from signings s join players p on p.id = s.player_id join signing_environments se on se.id = s.signing_environment_id where p.slug = 'hyun-jin-ryu'`)).signing_year, 2012)
  assert.equal((await one(`select signing_environment_id from signings s join players p on p.id = s.player_id where p.slug = 'yasiel-puig'`)).signing_environment_id, null)
  // undated signings are never linked by guesswork
  assert.equal((await one(`select count(*)::int as n from signings s join signing_environments se on se.id = s.signing_environment_id where s.signing_date is null and se.signing_year in (2012, 2013, 2014, 2017, 2021)`)).n, 0)
  // treatment facts are exactly as in 030
  assert.deepEqual(Object.fromEntries((await q(`select international_pool_treatment || ':' || coalesce(international_pool_treatment_basis, '-') as k, count(*)::int as n from signings group by 1`)).map((r) => [r.k, r.n])),
    { 'NOT_APPLICABLE:RULE': 32, 'NOT_APPLICABLE:SOURCE_STATEMENT': 1, 'SUBJECT:SOURCE_STATEMENT': 4, 'UNKNOWN:-': 231 })
  // class view: the new periods are visible, labelled, and none is utilization
  const cls = await q(`select period_label, signings, bonus_known, pool_capacity_usd::text as cap, known_tracked_bonus_pct_of_pool::text as pct, true_utilization_eligible as el from v_dodgers_financial_commitment_by_class
    where class_basis = 'SIGNING_ENVIRONMENT' and period_label in ('2012-13', '2013-14', '2014-15', '2017-18', '2020-21') order by class_year`)
  assert.deepEqual(cls.map((c) => [c.period_label, c.signings, c.cap, c.el]), [['2012-13', 6, '2900000.00', false], ['2013-14', 0, '2112900.00', false], ['2014-15', 1, '1963800.00', false],
    ['2017-18', 4, '4750000.00', false], ['2020-21', 22, '5348100.00', false]])
})

test('queue and completeness after 031', async () => {
  assert.deepEqual(Object.fromEntries((await q(`select issue as k, count(*)::int as n from v_financial_research_queue group by 1`)).map((r) => [r.k, r.n])),
    { CLASS_FINANCIAL_COVERAGE_INCOMPLETE: 13, FINANCIAL_REPORT_CONFLICT: 1, FINANCIAL_SOURCE_MISSING: 75, POOL_TREATMENT_UNKNOWN: 114, SIGNING_BONUS_UNKNOWN: 72 })
  assert.deepEqual(Object.fromEntries((await q(`select acquisition_cost_completeness as k, count(*)::int as n from v_signing_acquisition_financials where is_dodgers group by 1`)).map((r) => [r.k, r.n])),
    { COMPLETE: 44, NO_RULE: 47, PARTIAL: 3, UNKNOWN: 126 })
  assert.equal((await one(`select count(*)::int as n from v_financial_research_queue where issue = 'FINANCIAL_SOURCE_MISSING' and detail ~ 'Carlos'`)).n, 0)
  assert.deepEqual(await failing(), [])
})

// ---------------------------------------------------------------------------------------------
// the resolution mechanism (synthetic competing reports, always rolled back)
// ---------------------------------------------------------------------------------------------

test('resolution: an ACTIVE decision RESOLVES competing reports without rewriting any; the column follows the selected report', async () => {
  await inTxn(async () => {
    await chain.db.exec(report())   // BA $650,000 next to the legacy $600,000 and the column at 600,000
    assert.deepEqual(await failing(), ['financial_column_ledger_mismatches'], 'a disagreeing report forces the column to NULL under 030 rules')
    assert.deepEqual((await one(`select conflicting_components as cc from v_signing_acquisition_financials where player_slug = 'jerming-rosario'`)).cc, ['SIGNING_BONUS'])
    // record the decision, move the canonical column to the selected amount
    await chain.db.exec(decision())
    assert.deepEqual(await failing(), ['financial_column_ledger_mismatches'], 'the column must follow the decision')
    await chain.db.exec(`update signings set signing_bonus_usd = 650000 where id = ${SIGNING('jerming-rosario', 2018)}`)
    assert.deepEqual(await failing(), [])
    assert.deepEqual(await one(`select signing_bonus_usd::text as b, conflicting_components as cc, resolved_components as rc, has_financial_conflict as hc, bonus_status as bs from v_signing_acquisition_financials where player_slug = 'jerming-rosario'`),
      { b: '650000.00', cc: [], rc: ['SIGNING_BONUS'], hc: false, bs: 'KNOWN' })
    // every source report is still ACTIVE, including the legacy one; nothing was rewritten
    assert.deepEqual((await q(`select r.report_origin, r.amount::text as amount, r.record_status from signing_financial_reports r where r.signing_id = ${SIGNING('jerming-rosario', 2018)} order by 2`)),
      [{ report_origin: 'LEGACY_CARRYFORWARD', amount: '600000.00', record_status: 'ACTIVE' }, { report_origin: 'EXTERNAL_SOURCE', amount: '650000.00', record_status: 'ACTIVE' }])
    assert.equal((await one(`select count(*)::int as n from v_financial_research_queue where issue = 'FINANCIAL_REPORT_CONFLICT' and player_slug = 'jerming-rosario'`)).n, 0)
    // a column that disagrees with the decision is caught
    await chain.db.exec(`update signings set signing_bonus_usd = 600000 where id = ${SIGNING('jerming-rosario', 2018)}`)
    assert.deepEqual(await failing(), ['financial_column_ledger_mismatches'])
  })
  assert.deepEqual(await failing(), [])
})

test('resolution guards: only competing, ACTIVE, non-approximate USD reports of the same signing and component; sealed; never deleted; supersession retires the predecessor', async () => {
  await inTxn(async () => {
    // not competing: Soto has one report
    assert.match(await attempt(decision({ signing_id: SIGNING('william-soto', 2012), selected_report_id: `(select id from signing_financial_reports where signing_id = ${SIGNING('william-soto', 2012)})` })), /at least two ACTIVE reports/)
    await chain.db.exec(report())
    // a report of another signing / component / an unknown id cannot be selected
    assert.match(await attempt(decision({ selected_report_id: `(select id from signing_financial_reports where signing_id = ${SIGNING('william-soto', 2012)})` })), /same signing and component|foreign key|resolution_report_fkey/)
    assert.match(await attempt(decision({ component_type: "'POSTING_FEE'" })), /same signing and component|foreign key|resolution_report_fkey/)
    // an authoritative-rule decision cites its source
    assert.match(await attempt(decision({ basis: "'AUTHORITATIVE_RULE'" })), /source_check|check/)
    assert.equal(await attempt(decision({ basis: "'AUTHORITATIVE_RULE'", source_id: SOURCE('ba2013') })), 'accepted')
    assert.match(await attempt(decision({ basis: "'GUESS'" })), /basis_check|check/)
    assert.match(await attempt(decision({ rationale: "''" })), /rationale|check/)
    // an approximate report cannot be selected
    await chain.db.exec(report({ amount: '640000', amount_basis: "'APPROXIMATE'", source_id: SOURCE('dd2018'), evidence_basis: "'NEWS_REPORT'" }))
    assert.match(await attempt(decision({ selected_report_id: `(select id from signing_financial_reports where signing_id = ${SIGNING('jerming-rosario', 2018)} and amount = 640000)` })), /non-approximate/)
    // record the real decision, then test sealing and supersession
    await chain.db.exec(decision())
    const d = (await one(`select id from signing_financial_resolutions where signing_id = ${SIGNING('jerming-rosario', 2018)}`)).id
    assert.match(await attempt(`delete from signing_financial_resolutions where id = ${lit(d)}`), /never deleted/)
    assert.match(await attempt(`update signing_financial_resolutions set rationale = 'changed' where id = ${lit(d)}`), /sealed/)
    assert.match(await attempt(decision()), /active_key|duplicate/, 'one ACTIVE decision per signing and component')
    // a later decision supersedes and retires the first (select the legacy $600,000 report instead)
    await chain.db.exec(decision({ selected_report_id: `(select id from signing_financial_reports where signing_id = ${SIGNING('jerming-rosario', 2018)} and amount = 600000)`,
      supersedes_resolution_id: lit(d), rationale: "'later decision'" }))
    assert.deepEqual(await one(`select record_status, retraction_reason from signing_financial_resolutions where id = ${lit(d)}`), { record_status: 'RETRACTED', retraction_reason: 'Superseded by a later decision.' })
    assert.match(await attempt(`update signing_financial_resolutions set retraction_reason = 'x' where id = ${lit(d)}`), /RETRACTED financial resolution is sealed/)
    assert.deepEqual(await failing(), [], 'the column still equals the selected legacy amount')
    // self-supersession is impossible
    assert.match(await attempt(`update signing_financial_resolutions set supersedes_resolution_id = id`), /sealed/)
  })
})

test('resolution integrity: retracting the selected report, or the competition disappearing, is a verifier violation; the guard is invoker-rights with no API EXECUTE', async () => {
  await inTxn(async () => {
    await chain.db.exec(report())
    await chain.db.exec(decision())
    await chain.db.exec(`update signings set signing_bonus_usd = 650000 where id = ${SIGNING('jerming-rosario', 2018)}`)
    assert.deepEqual(await failing(), [])
    // retract the selected report: the decision now points at a retracted report
    await chain.db.exec(`update signing_financial_reports set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'test'
      where signing_id = ${SIGNING('jerming-rosario', 2018)} and amount = 650000`)
    const f = await failing()
    assert.ok(f.includes('financial_resolution_selection_violations'), f.join(','))
  })
  await inTxn(async () => {
    await chain.db.exec(`grant execute on function disi_signing_financial_resolution_guard() to anon;`)
    assert.deepEqual(await failing(), ['financial_resolution_selection_violations'])
  })
  await inTxn(async () => {
    await chain.db.exec(`drop trigger signing_financial_resolutions_guard on signing_financial_resolutions;`)
    assert.deepEqual(await failing(), ['financial_resolution_selection_violations'])
  })
  // the resolution does not exist for an unresolved real conflict: Sasaki is still a conflict, not RESOLVED
  assert.deepEqual((await one(`select conflicting_components as cc, resolved_components as rc from v_signing_acquisition_financials where player_slug = 'roki-sasaki'`)), { cc: ['POSTING_FEE'], rc: [] })
})

test('security: RLS and SELECT-only API grants on the new table; no write policy; the verifier passes with 139 checks', async () => {
  assert.equal((await one(`select relrowsecurity as rls from pg_class where relname = 'signing_financial_resolutions'`)).rls, true)
  const acl = await q(`select coalesce(r.rolname, 'PUBLIC') as g, string_agg(a.privilege_type, ',' order by a.privilege_type) as p from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    left join pg_roles r on r.oid = a.grantee where c.relname = 'signing_financial_resolutions' and coalesce(r.rolname, 'PUBLIC') in ('anon', 'authenticated', 'PUBLIC') group by 1 order by 1`)
  assert.deepEqual(acl, [{ g: 'anon', p: 'SELECT' }, { g: 'authenticated', p: 'SELECT' }])
  assert.deepEqual(await q(`select policyname, cmd from pg_policies where tablename = 'signing_financial_resolutions'`), [{ policyname: 'public_read_signing_financial_resolutions', cmd: 'SELECT' }])
  const full = await checkInvariants(chain.query)
  assert.deepEqual(failedChecks(full).map((c) => c.name), [])
  assert.equal(full.hard.length, 139)
  assert.equal(full.hard.find((c) => c.name === 'public_tables_total').actual, 54)
})

test('a fresh 001-031 replay equals the 001-030 database with 031 applied', async () => {
  const fresh = await buildCanonicalChain()
  try {
    const content = async (query) => ({
      signings: await query(`select p.slug, sg.signing_year, sg.signing_bonus_usd::text as b, sg.posting_fee_usd::text as pf, sg.bonus_publicly_reported as f, sg.international_pool_treatment as t, se.signing_year as env
        from signings sg join players p on p.id = sg.player_id left join signing_environments se on se.id = sg.signing_environment_id order by 1, 2`),
      reports: await query(`select p.slug, sg.signing_year, r.component_type, r.amount::text as a, r.amount_basis, r.amount_precision::text as prec, r.report_origin, so.url, r.record_status, r.supersedes_report_id is not null as sup, r.note
        from signing_financial_reports r join signings sg on sg.id = r.signing_id join players p on p.id = sg.player_id left join sources so on so.id = r.source_id order by 1, 2, 3, 4, 7, 8`),
      env: await query(`select se.signing_year, se.signing_period_label, se.regime::text, se.club_bonus_pool_usd::text as pool, se.tradeable_pool_space, r.metric_type, r.amount_usd::text as a, r.amount_basis, r.report_origin, so.url, r.note
        from signing_environments se left join signing_environment_financial_reports r on r.signing_environment_id = se.id left join sources so on so.id = r.source_id
        where se.organization_id = (select id from organizations where name = 'Los Angeles Dodgers') order by 1, 6, 9, 10`),
      queue: await query(`select issue, subject, player_slug, environment_period_label, detail from v_financial_research_queue order by 1, 2, 3, 4, 5`),
      financials: await query(`select player_slug, signing_year, signing_bonus_usd::text as b, acquisition_cost_completeness as c, bonus_source_status as s, conflicting_components as cc, resolved_components as rc from v_signing_acquisition_financials order by 1, 2`),
      sources: await query(`select url, source_name, title, author, publication_date::text as d from sources where url = any($1) order by 1`, [seed.sources.filter((s) => !s.existing).map((s) => s.url)]),
    })
    assert.deepEqual(await content(fresh.query), await content(chain.query))
  } finally {
    await fresh.close()
  }
})
