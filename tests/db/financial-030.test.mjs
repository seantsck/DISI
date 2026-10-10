// Migration 030 - financial acquisition intelligence.
//
// One 001-029 database is built; the migration's guards are tested on that pre-030 state in
// rolled-back transactions, then 030 is applied for real (committed) and the remaining tests run on
// the resulting database, again in rolled-back transactions. Test order matters.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough, buildCanonicalChain } from './canonical-chain.mjs'
import { lit, withoutTransaction } from './drift-027.mjs'
import { financialQueries } from '../../scripts/db/lib/financial-invariants.mjs'
const FINANCIAL_QUERIES = financialQueries(false)
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '030_financial_acquisition_intelligence.sql'
const sql030 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const inner = withoutTransaction(sql030)
const seed = JSON.parse(fs.readFileSync(path.join(root, 'database/research/030/seed-evidence.json'), 'utf8'))
const src = Object.fromEntries(seed.sources.map((s) => [s.key, s.url]))

const LEGACY_WAR_VIEWS = ['v_signing_efficiency', 'v_dodgers_signing_cohort', 'v_dodgers_signing_leaderboard', 'v_dodgers_asset_realization', 'v_signing_asset_outcomes',
  'v_dodgers_executive_kpis', 'v_dodgers_executive_case_studies', 'v_dodgers_executive_dashboard_feed', 'v_dodgers_mature_bonus_tiers',
  'v_dodgers_mature_premium_comparison', 'v_dodgers_mature_year_analysis', 'v_dodgers_mature_player_analysis']
const NEW_TABLES = ['acquisition_cost_component_rules', 'signing_environment_financial_reports', 'signing_financial_reports']
const NEW_VIEWS = ['v_dodgers_financial_commitment_by_class', 'v_dodgers_financial_commitment_by_market', 'v_financial_research_queue', 'v_signing_acquisition_financials']

let chain
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
before(async () => { chain = await buildChainThrough('029_signing_network_intelligence.sql') }, { timeout: 180000 })
after(async () => { await chain.close() })

const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
let depth = 0
/** Runs `body` in a transaction that is always rolled back. */
async function inTxn(body) {
  await chain.db.exec('begin;')
  depth++
  try { return await body() } finally { depth--; await chain.db.exec('rollback;') }
}
/** Resolves to the error message of `sql` (or 'accepted'); always undone (a savepoint inside inTxn, a transaction outside it). */
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
const viewDefs = async (views) => Object.fromEntries((await q(`select c.relname, pg_get_viewdef(c.oid) as d, obj_description(c.oid, 'pg_class') as c
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any($1)`, [views])).map((r) => [r.relname, [r.d, r.c]]))
const financial = async () => {
  const out = {}
  for (const [name, sql] of Object.entries(FINANCIAL_QUERIES)) out[name] = (await one(sql)).n
  return out
}
const failing = async () => Object.entries(await financial()).filter(([, n]) => n !== 0).map(([k]) => k).sort()
const SIGNING = (slug, year) => `(select sg.id from signings sg join players p on p.id = sg.player_id where p.slug = ${lit(slug)} and sg.signing_year = ${year})`
const ENV = (year) => `(select se.id from signing_environments se join organizations o on o.id = se.organization_id where o.franchise_key = 'DODGERS' and se.signing_year = ${year})`
const SOURCE = (key) => `(select id from sources where url = ${lit(src[key])})`
/** An INSERT into signing_financial_reports with sensible defaults (an external EXACT USD bonus from CBS 2025 for Sasaki); override any column. */
const report = (o = {}) => {
  const c = {
    signing_id: SIGNING('roki-sasaki', 2025), component_type: "'SIGNING_BONUS'", amount: '6500000', currency_code: "'USD'", amount_basis: "'EXACT'",
    amount_precision: 'null', derivation_rate: 'null', derivation_base_amount: 'null', derivation_rule: 'null', report_origin: "'EXTERNAL_SOURCE'",
    source_id: SOURCE('cbs2025'), evidence_basis: "'NEWS_REPORT'", confidence: "'HIGH'", retrieved_at: "timestamptz '2026-10-09 00:00:00+00'", note: "'test'",
    supersedes_report_id: 'null',
  }
  for (const [k, v] of Object.entries(o)) c[k] = v
  return `insert into signing_financial_reports (${Object.keys(c).join(', ')}) values (${Object.values(c).join(', ')})`
}

// legacy WAR-per-dollar definitions and the pre-030 state, captured before 030 runs
let warBefore
let pre

// ---------------------------------------------------------------------------------------------
// 030 on the pre-030 database
// ---------------------------------------------------------------------------------------------

test('baseline: a 001-029 replay is 50 tables / 93 views with 8 signing environments and no 030 object', async () => {
  assert.deepEqual(await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views,
    (select count(*) from signing_environments)::int as environments`), { tables: 50, views: 93, environments: 8 })
  assert.deepEqual(await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [[...NEW_TABLES, ...NEW_VIEWS]]), [])
  warBefore = await viewDefs(LEGACY_WAR_VIEWS)
  assert.equal(Object.keys(warBefore).length, 12)
  pre = {
    hashes: await tableHashes(),
    // data-derived legacy expectation: every non-null money column without DISI field-level evidence
    legacy: (await one(`select count(*)::int as n from signings sg
      cross join lateral (values (sg.signing_bonus_usd, 'signing_bonus_usd'), (sg.posting_fee_usd, 'posting_fee_usd'), (sg.transfer_fee_usd, 'transfer_fee_usd')) v(amount, field_name)
      where v.amount is not null and not exists (select 1 from evidence ev where ev.entity_type = 'signing' and ev.entity_id = sg.id and ev.field_name = v.field_name)`)).n,
    envLegacy: (await one(`select (count(club_bonus_pool_usd) + count(pool_after_trades_usd) + count(max_individual_bonus_usd) + count(overage_tax_rate))::int as n from signing_environments`)).n,
    signings: await q(`select p.slug, sg.signing_year, sg.signing_bonus_usd::text as b, sg.posting_fee_usd::text as pf, sg.transfer_fee_usd::text as t,
      sg.bonus_publicly_reported, sg.signing_environment_id from signings sg join players p on p.id = sg.player_id order by 1, 2`),
    summaries: (await one(`select count(*)::int as n from international_org_period_summary`)).n,
  }
})

test('preconditions: an unexpected canonical state aborts 030 with nothing changed', async () => {
  const cases = [
    ['Ryu posting fee drifted', `update signings set posting_fee_usd = 25000000 where id = ${SIGNING('hyun-jin-ryu', 2012)};`, /hyun-jin-ryu 2012 has unexpected money values/],
    ['Sasaki bonus drifted', `update signings set signing_bonus_usd = 6000000 where id = ${SIGNING('roki-sasaki', 2025)};`, /roki-sasaki 2025 has unexpected money values/],
    ['Sasaki posting fee already set', `update signings set posting_fee_usd = 1625000 where id = ${SIGNING('roki-sasaki', 2025)};`, /roki-sasaki 2025 has unexpected money values/],
    ['unreviewed field-level money evidence', `insert into evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
      select 'signing', ${SIGNING('julio-urias', 2012)}, 'transfer_fee_usd', id, 'HIGH', 'x' from sources limit 1;`, /field-level money evidence rows; the reviewed set has 2/],
    ['2019-20 period summary drifted', `update international_org_period_summary set pool_spent_usd = 1 where organization_id = (select id from organizations where name = 'Los Angeles Dodgers');`,
      /2019-20 period summary does not carry the reviewed/],
    ['a 2019-20 member linked elsewhere', `update signings set signing_environment_id = ${ENV(2018)} where id = ${SIGNING('lesther-medrano', 2019)};`, /linked to another environment/],
  ]
  for (const [label, drift, expected] of /** @type {Array<[string, string, RegExp]>} */ (cases)) assert.match(await attempt(`${drift}\n${inner}`), expected, label)
  assert.deepEqual(await tableHashes(), pre.hashes, 'aborted runs changed nothing')
})

test('030 applied for real: 50 -> 53 tables and 93 -> 97 views; 3 tables, 4 views, 2 functions, 2 triggers, 3 signings columns', async () => {
  await chain.db.exec(sql030)
  assert.deepEqual(await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`), { tables: 53, views: 97 })
  assert.deepEqual((await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`, [[...NEW_TABLES, ...NEW_VIEWS]])).map((r) => r.relname),
    [...NEW_TABLES, ...NEW_VIEWS])
  assert.deepEqual((await q(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'disi\\_%financial%' order by 1`)).map((r) => r.proname),
    ['disi_environment_financial_report_guard', 'disi_signing_financial_report_guard'])
  assert.deepEqual((await q(`select tgname from pg_trigger where not tgisinternal and tgrelid in ('public.signing_financial_reports'::regclass, 'public.signing_environment_financial_reports'::regclass) order by 1`)).map((r) => r.tgname),
    ['signing_environment_financial_reports_guard', 'signing_financial_reports_guard'])
  assert.deepEqual((await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'signings' and column_name like 'international_pool%' order by 1`)).map((r) => r.column_name),
    ['international_pool_treatment', 'international_pool_treatment_basis', 'international_pool_treatment_source_id'])
  // the existing compatibility columns are unchanged in shape
  const cols = await q(`select column_name, data_type, numeric_precision, numeric_scale, is_generated from information_schema.columns
    where table_schema = 'public' and table_name = 'signings' and column_name in ('signing_bonus_usd', 'posting_fee_usd', 'transfer_fee_usd', 'total_known_acquisition_cost_usd', 'bonus_publicly_reported') order by 1`)
  assert.deepEqual(cols.map((c) => [c.column_name, c.data_type, c.numeric_scale, c.is_generated]), [['bonus_publicly_reported', 'boolean', null, 'NEVER'],
    ['posting_fee_usd', 'numeric', 2, 'NEVER'], ['signing_bonus_usd', 'numeric', 2, 'NEVER'], ['total_known_acquisition_cost_usd', 'numeric', 2, 'ALWAYS'], ['transfer_fee_usd', 'numeric', 2, 'NEVER']])
})

test('only the expected tables changed; 026 scouting, development, 027 / 028 pinned data and 029 network are untouched', async () => {
  const now = await tableHashes()
  const changed = Object.keys(now).filter((t) => pre.hashes[t] !== now[t]).sort()
  assert.deepEqual(changed.filter((t) => !NEW_TABLES.includes(t)), ['signing_environments', 'signings', 'sources'])
  for (const t of ['player_evaluations', 'player_evaluation_grades', 'player_evaluation_rankings', 'player_evaluation_notes', 'scouting_publications', 'evaluation_scales',
    'player_season_stints', 'development_milestones', 'development_progression_decisions', 'player_development_status', 'transactions', 'evidence', 'player_aliases',
    'signing_population_members', 'signing_population_member_sources', 'international_org_period_summary', 'outcome_audits',
    'network_entities', 'network_entity_aliases', 'network_entity_relationships', 'player_network_relationships', 'network_entity_identity_reviews']) {
    assert.equal(now[t], pre.hashes[t], `${t} is unchanged`)
  }
  // signings: only Ryu's three money / flag values and the three 2019-20 links change among the pre-030 columns
  const after = await q(`select p.slug, sg.signing_year, sg.signing_bonus_usd::text as b, sg.posting_fee_usd::text as pf, sg.transfer_fee_usd::text as t,
    sg.bonus_publicly_reported, sg.signing_environment_id from signings sg join players p on p.id = sg.player_id order by 1, 2`)
  const diffs = after.map((r, i) => [r, pre.signings[i]]).filter(([a, b]) => JSON.stringify(a) !== JSON.stringify(b))
  assert.deepEqual(diffs.map(([a]) => a.slug).sort(), ['hyun-jin-ryu', 'lesther-medrano', 'roque-gutierrez', 'yeiner-fernandez'])
  const ryu = diffs.find(([a]) => a.slug === 'hyun-jin-ryu')
  assert.deepEqual([ryu[1].b, ryu[1].pf, ryu[1].bonus_publicly_reported], [null, '25700000.00', false])
  assert.deepEqual([ryu[0].b, ryu[0].pf, ryu[0].bonus_publicly_reported, ryu[0].t], ['5000000.00', '25737737.33', true, null])
  // the 027 / 028 reconciled environments keep every attribute (the verifier's reconciliation checks pass below)
  assert.equal((await one(`select count(*)::int as n from international_org_period_summary`)).n, pre.summaries, 'the league summary is not duplicated')
})

test('legacy WAR-per-dollar views: definitions byte-identical, no comment added, nothing renamed', async () => {
  assert.deepEqual(await viewDefs(LEGACY_WAR_VIEWS), warBefore)
  const audit = JSON.parse(fs.readFileSync(path.join(root, 'database/research/030/audit-report.json'), 'utf8')).legacy_war_per_dollar_views
  for (const [v, [d, c]] of Object.entries(await viewDefs(LEGACY_WAR_VIEWS))) {
    assert.equal(crypto.createHash('md5').update(d).digest('hex'), audit[v].definition_md5, v)
    assert.equal(c != null, audit[v].has_comment, v)
  }
})

test('rerun is a no-op: no row, grant, policy or definition changes', async () => {
  const snap = async () => ({ hashes: await tableHashes(), acl: await q(`select c.relname, coalesce(array_to_string(c.relacl, ','), '') as acl from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') order by 1`),
    policies: await q(`select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 2`),
    defs: await q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`) })
  const first = await snap()
  await chain.db.exec(sql030)
  assert.deepEqual(await snap(), first)
})

// ---------------------------------------------------------------------------------------------
// the ledger
// ---------------------------------------------------------------------------------------------

test('legacy carry-forward is derived from data: every pre-030 non-null column without field evidence, no source, no basis, UNVERIFIED', async () => {
  const legacy = await one(`select count(*)::int as n, count(*) filter (where source_id is null and amount_basis is null and confidence = 'UNVERIFIED' and evidence_basis = 'LEGACY_CANONICAL_VALUE')::int as clean,
    count(*) filter (where component_type = 'SIGNING_BONUS')::int as bonus, count(*) filter (where component_type = 'TRANSFER_FEE')::int as transfer
    from signing_financial_reports where report_origin = 'LEGACY_CARRYFORWARD'`)
  assert.equal(legacy.n, pre.legacy)
  assert.deepEqual(legacy, { n: 89, clean: 89, bonus: 88, transfer: 1 })
  assert.equal((await one(`select count(*)::int as n from signing_environment_financial_reports where report_origin = 'LEGACY_CARRYFORWARD'`)).n, pre.envLegacy)
  assert.equal(pre.envLegacy, 10)
  // every legacy row equals its column; no legacy row exists for a column that was NULL before 030 (Ryu's bonus)
  assert.equal((await one(`select count(*)::int as n from signing_financial_reports r join signings s on s.id = r.signing_id where r.report_origin = 'LEGACY_CARRYFORWARD'
    and r.amount is distinct from case r.component_type when 'SIGNING_BONUS' then s.signing_bonus_usd when 'POSTING_FEE' then s.posting_fee_usd when 'TRANSFER_FEE' then s.transfer_fee_usd end`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from signing_financial_reports r where r.report_origin = 'LEGACY_CARRYFORWARD' and r.signing_id = ${SIGNING('hyun-jin-ryu', 2012)}`)).n, 0)
  // a field-evidenced column was carried as EXTERNAL_SOURCE, never as legacy
  assert.deepEqual(await q(`select p.slug, r.component_type, r.evidence_basis from signing_financial_reports r join signings s on s.id = r.signing_id join players p on p.id = s.player_id
    where r.evidence_basis = 'CANONICAL_FIELD_EVIDENCE' order by 1`), [{ slug: 'fernando-valenzuela', component_type: 'TRANSFER_FEE', evidence_basis: 'CANONICAL_FIELD_EVIDENCE' },
    { slug: 'hyun-jin-ryu', component_type: 'POSTING_FEE', evidence_basis: 'CANONICAL_FIELD_EVIDENCE' }])
})

test('external and rule-derived counts are reported separately; every external row cites a source', async () => {
  assert.deepEqual(Object.fromEntries((await q(`select report_origin, count(*)::int as n from signing_financial_reports group by 1`)).map((r) => [r.report_origin, r.n])),
    { EXTERNAL_SOURCE: 14, LEGACY_CARRYFORWARD: 89 })
  assert.deepEqual(Object.fromEntries((await q(`select report_origin, count(*)::int as n from signing_environment_financial_reports group by 1`)).map((r) => [r.report_origin, r.n])),
    { EXTERNAL_SOURCE: 8, LEGACY_CARRYFORWARD: 10 })
  assert.equal((await one(`select count(*)::int as n from signing_financial_reports where amount_basis = 'RULE_DERIVED'`)).n, 2, 'two source-stated rule derivations (Sasaki posting)')
  assert.equal((await one(`select count(*)::int as n from signing_financial_reports where report_origin = 'RULE_DERIVED'`)).n, 0, 'no DISI-derived amount')
  assert.equal((await one(`select count(*)::int as n from signing_financial_reports where report_origin = 'EXTERNAL_SOURCE' and (source_id is null or retrieved_at is null)`)).n, 0)
  // the bonus-publicly-reported flag is never provenance: legacy-only bonuses carry the flag but are not EXTERNALLY_SOURCED
  const flagged = await one(`select count(*) filter (where s.bonus_publicly_reported)::int as flagged, count(*) filter (where f.bonus_source_status = 'EXTERNALLY_SOURCED')::int as sourced,
    count(*) filter (where s.bonus_publicly_reported and f.bonus_source_status = 'LEGACY_CANONICAL_ONLY')::int as flagged_legacy
    from v_signing_acquisition_financials f join signings s on s.id = f.signing_id`)
  assert.deepEqual(flagged, { flagged: 89, sourced: 6, flagged_legacy: 83 })
})

test('Ryu: the $5M bonus is sourced and canonical; the posting fee is the exact reported bid with rounded corroboration; no contract value stored', async () => {
  const reports = await q(`select r.component_type, r.amount::text, r.amount_basis, r.amount_precision::text as precision, r.report_origin, so.url from signing_financial_reports r
    join sources so on so.id = r.source_id where r.signing_id = ${SIGNING('hyun-jin-ryu', 2012)} order by 1, 2 desc, 6`)
  assert.deepEqual(reports, [
    { component_type: 'POSTING_FEE', amount: '25737737.33', amount_basis: 'EXACT', precision: null, report_origin: 'EXTERNAL_SOURCE', url: src.ba2013 },
    { component_type: 'POSTING_FEE', amount: '25700000.00', amount_basis: 'ROUNDED', precision: '100000.00', report_origin: 'EXTERNAL_SOURCE', url: src.cbs2012 },
    { component_type: 'POSTING_FEE', amount: '25700000.00', amount_basis: 'ROUNDED', precision: '100000.00', report_origin: 'EXTERNAL_SOURCE', url: src.mlb_callis_ryu },
    { component_type: 'SIGNING_BONUS', amount: '5000000.00', amount_basis: 'ROUNDED', precision: '1000000.00', report_origin: 'EXTERNAL_SOURCE', url: src.ba2013 },
    { component_type: 'SIGNING_BONUS', amount: '5000000.00', amount_basis: 'ROUNDED', precision: '1000000.00', report_origin: 'EXTERNAL_SOURCE', url: src.cbs2012 },
  ])
  const f = await one(`select signing_bonus_usd::text, posting_fee_usd::text, known_acquisition_cost_usd::text, acquisition_cost_completeness, bonus_source_status, conflicting_components
    from v_signing_acquisition_financials where player_slug = 'hyun-jin-ryu'`)
  assert.deepEqual(f, { signing_bonus_usd: '5000000.00', posting_fee_usd: '25737737.33', known_acquisition_cost_usd: '30737737.33', acquisition_cost_completeness: 'COMPLETE',
    bonus_source_status: 'EXTERNALLY_SOURCED', conflicting_components: [] })
  assert.equal((await one(`select total_known_acquisition_cost_usd::text as t from signings where id = ${SIGNING('hyun-jin-ryu', 2012)}`)).t, '30737737.33')
  // the $36M guarantee / $42M contract never appears as an acquisition cost
  assert.equal((await one(`select count(*)::int as n from signing_financial_reports where amount in (36000000, 42000000)`)).n, 0)
})

test('Sasaki: two ACTIVE independent posting reports disagree; the column stays NULL; a conflict is exposed and queued; neither is retracted', async () => {
  const posting = await q(`select r.amount::text, r.amount_basis, r.derivation_rate::text as rate, r.derivation_base_amount::text as base, r.record_status, r.supersedes_report_id, so.url
    from signing_financial_reports r join sources so on so.id = r.source_id where r.signing_id = ${SIGNING('roki-sasaki', 2025)} and r.component_type = 'POSTING_FEE' order by 1 desc`)
  assert.deepEqual(posting, [
    { amount: '1625000.00', amount_basis: 'RULE_DERIVED', rate: '0.25000', base: '6500000.00', record_status: 'ACTIVE', supersedes_report_id: null, url: src.cbs2025 },
    { amount: '1300000.00', amount_basis: 'RULE_DERIVED', rate: '0.20000', base: '6500000.00', record_status: 'ACTIVE', supersedes_report_id: null, url: src.mlbtr2025 },
  ])
  assert.equal((await one(`select posting_fee_usd from signings where id = ${SIGNING('roki-sasaki', 2025)}`)).posting_fee_usd, null)
  const f = await one(`select signing_bonus_usd::text, posting_fee_usd, conflicting_components, has_financial_conflict, acquisition_cost_completeness, required_components_unresolved
    from v_signing_acquisition_financials where player_slug = 'roki-sasaki'`)
  assert.deepEqual(f, { signing_bonus_usd: '6500000.00', posting_fee_usd: null, conflicting_components: ['POSTING_FEE'], has_financial_conflict: true,
    acquisition_cost_completeness: 'PARTIAL', required_components_unresolved: ['POSTING_FEE'] })
  assert.deepEqual(await q(`select issue, subject from v_financial_research_queue where player_slug = 'roki-sasaki' and issue in ('FINANCIAL_REPORT_CONFLICT', 'REQUIRED_ACQUISITION_COMPONENT_UNRESOLVED')`),
    [{ issue: 'FINANCIAL_REPORT_CONFLICT', subject: 'POSTING_FEE' }], 'the conflict is queued once, not again as an unresolved component')
  assert.deepEqual(await failing(), [], 'the conflict is a valid state for the verifier')
})

test('reconciliation: corroboration, conflict, legacy match, rounding intervals and approximate-only all resolve as documented', async () => {
  await inTxn(async () => {
    // identical amounts coexist as corroboration
    // (the same source repeating the same amount for the same component is one fact, not two)
    assert.match(await attempt(report({ source_id: SOURCE('mlbtr2025'), amount_basis: "'EXACT'" })), /active_key/)
    await chain.db.exec(`savepoint s1; ${report({ source_id: SOURCE('ba2013'), evidence_basis: "'PUBLISHED_INTERNATIONAL_REVIEW'" })}; ${report({ source_id: SOURCE('ba2018'), evidence_basis: "'PUBLISHED_INTERNATIONAL_REVIEW'" })};`)
    assert.deepEqual(await failing(), [])
    assert.deepEqual((await one(`select conflicting_components, external_report_count from v_signing_acquisition_financials where player_slug = 'roki-sasaki'`)),
      { conflicting_components: ['POSTING_FEE'], external_report_count: 6 })
    await chain.db.exec('rollback to savepoint s1;')
    // a conflicting ACTIVE amount on a non-null column -> the column must be NULL
    await chain.db.exec(`savepoint s2; ${report({ amount: '7000000', source_id: SOURCE('ba2013'), evidence_basis: "'PUBLISHED_INTERNATIONAL_REVIEW'" })};`)
    assert.deepEqual(await failing(), ['financial_column_ledger_mismatches'])
    assert.deepEqual((await one(`select conflicting_components from v_signing_acquisition_financials where player_slug = 'roki-sasaki'`)).conflicting_components, ['POSTING_FEE', 'SIGNING_BONUS'])
    await chain.db.exec(`update signings set signing_bonus_usd = null where id = ${SIGNING('roki-sasaki', 2025)};`)
    assert.deepEqual(await failing(), [], 'a conflict with a NULL column is valid; both reports stay ACTIVE')
    await chain.db.exec('rollback to savepoint s2;')
    // a legacy carry-forward matches its column; changing the column without the ledger is caught
    await chain.db.exec(`savepoint s3; update signings set signing_bonus_usd = 13000000 where id = ${SIGNING('yasiel-puig', 2012)};`)
    assert.deepEqual(await failing(), ['financial_column_ledger_mismatches'])
    await chain.db.exec('rollback to savepoint s3;')
    // a ROUNDED report must contain the selected value: $25.6M (+/- $50K) does not contain $25,737,737.33
    await chain.db.exec(`savepoint s4; ${report({ signing_id: SIGNING('hyun-jin-ryu', 2012), component_type: "'POSTING_FEE'", amount: '25600000', amount_basis: "'ROUNDED'", amount_precision: '100000', source_id: SOURCE('ba2016'), evidence_basis: "'PUBLISHED_INTERNATIONAL_REVIEW'" })};`)
    assert.deepEqual(await failing(), ['financial_column_ledger_mismatches'])
    await chain.db.exec('rollback to savepoint s4;')
    // a NULL column with an agreeing external report must be set; an approximate-only report never selects a value
    const unknown = await one(`select s.id from signings s join players p on p.id = s.player_id where s.signing_bonus_usd is null and s.pathway::text = 'LATAM_AMATEUR' order by p.slug limit 1`)
    await chain.db.exec(`savepoint s5; ${report({ signing_id: lit(unknown.id) + '::uuid', amount: '100000', amount_basis: "'APPROXIMATE'" })};`)
    assert.deepEqual(await failing(), [], 'approximate-only leaves the column NULL')
    assert.equal((await one(`select bonus_status from v_signing_acquisition_financials where signing_id = $1`, [unknown.id])).bonus_status, 'UNKNOWN')
    await chain.db.exec(`${report({ signing_id: lit(unknown.id) + '::uuid', amount: '100000', amount_basis: "'EXACT'", source_id: SOURCE('ba2013'), evidence_basis: "'PUBLISHED_INTERNATIONAL_REVIEW'" })};`)
    assert.deepEqual(await failing(), ['financial_column_ledger_mismatches'], 'an agreeing external report with a NULL column is a mismatch')
    await chain.db.exec(`update signings set signing_bonus_usd = 100000 where id = ${lit(unknown.id)};`)
    assert.deepEqual(await failing(), [])
    await chain.db.exec('rollback to savepoint s5;')
  })
  assert.deepEqual(await failing(), [])
})

test('unknown never becomes zero: no zero amount was stored, unknown components stay NULL, known cost is NULL when nothing is known', async () => {
  assert.equal((await one(`select count(*)::int as n from signing_financial_reports where amount = 0`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from signings where signing_bonus_usd = 0 or posting_fee_usd = 0 or transfer_fee_usd = 0`)).n, 0)
  const unknown = await one(`select count(*)::int as n, count(*) filter (where known_acquisition_cost_usd is null and signing_bonus_usd is null)::int as null_cost
    from v_signing_acquisition_financials where cardinality(known_components) = 0`)
  assert.equal(unknown.n, unknown.null_cost)
  assert.ok(unknown.n > 0)
  assert.equal((await one(`select count(*)::int as n from v_signing_acquisition_financials where known_acquisition_cost_usd = 0`)).n, 0)
  // the class view never sums nothing into zero
  assert.equal((await one(`select known_bonus_sum_usd from v_dodgers_financial_commitment_by_class where period_label = '2017-18'`)).known_bonus_sum_usd, null)
})

test('pool treatment is independent of pathway and set only from a source statement or the pre-pool rule', async () => {
  const t = Object.fromEntries((await q(`select player_slug, pathway, international_pool_treatment as t, pool_treatment_basis as b from v_signing_acquisition_financials
    where player_slug in ('roki-sasaki', 'yusniel-diaz', 'yasiel-puig', 'yordan-alvarez', 'hyun-jin-ryu', 'yadier-alvarez', 'omar-estevez', 'fernando-valenzuela')`)).map((r) => [r.player_slug, [r.pathway, r.t, r.b]]))
  assert.deepEqual(t, {
    'roki-sasaki': ['POSTED_PLAYER', 'SUBJECT', 'SOURCE_STATEMENT'],
    'yusniel-diaz': ['CUBAN_PRO', 'SUBJECT', 'SOURCE_STATEMENT'],
    'yasiel-puig': ['CUBAN_PRO', 'NOT_APPLICABLE', 'SOURCE_STATEMENT'],
    'yordan-alvarez': ['CUBAN_PRO', 'UNKNOWN', null],
    'hyun-jin-ryu': ['POSTED_PLAYER', 'UNKNOWN', null],
    'yadier-alvarez': ['CUBAN_AMATEUR', 'SUBJECT', 'SOURCE_STATEMENT'],
    'omar-estevez': ['CUBAN_AMATEUR', 'SUBJECT', 'SOURCE_STATEMENT'],
    'fernando-valenzuela': ['MEXICAN_LEAGUE_TRANSFER', 'NOT_APPLICABLE', 'RULE'],
  })
  assert.deepEqual(Object.fromEntries((await q(`select international_pool_treatment || ':' || coalesce(international_pool_treatment_basis, '-') as k, count(*)::int as n from signings group by 1`)).map((r) => [r.k, r.n])),
    { 'NOT_APPLICABLE:RULE': 32, 'NOT_APPLICABLE:SOURCE_STATEMENT': 1, 'SUBJECT:SOURCE_STATEMENT': 4, 'UNKNOWN:-': 231 })
  // the rule only ever covers signings before the pools began
  assert.equal((await one(`select count(*)::int as n from signings where international_pool_treatment_basis = 'RULE' and not (signing_date < date '2012-07-02' or (signing_date is null and signing_year <= 2011))`)).n, 0)
  // shape: a treatment needs a basis and a source; UNKNOWN has neither
  assert.match(await attempt(`update signings set international_pool_treatment = 'EXEMPT' where id = ${SIGNING('yordan-alvarez', 2016)}`), /pool_treatment_basis_check/)
  assert.match(await attempt(`update signings set international_pool_treatment = 'MAYBE', international_pool_treatment_basis = 'RULE', international_pool_treatment_source_id = ${SOURCE('ba2013')}
    where id = ${SIGNING('yordan-alvarez', 2016)}`), /international_pool_treatment_check/)
  // a rule-based SUBJECT, or SUBJECT before the pools existed, is a verifier violation
  await inTxn(async () => {
    await chain.db.exec(`update signings set international_pool_treatment = 'SUBJECT' where id = ${SIGNING('fernando-valenzuela', 1979)}`)
    assert.deepEqual(await failing(), ['financial_pool_treatment_violations'])
  })
})

test('pool charge is a ledger fact independent of the bonus; it never moves acquisition cost or completeness', async () => {
  assert.equal((await one(`select count(*)::int as n from signing_financial_reports where component_type = 'POOL_CHARGE'`)).n, 0)
  const subject = await q(`select player_slug, signing_bonus_usd::text, known_pool_charge_usd, pool_charge_status, pool_completeness from v_signing_acquisition_financials
    where international_pool_treatment = 'SUBJECT' order by 1`)
  assert.equal(subject.length, 4)
  assert.ok(subject.every((s) => s.signing_bonus_usd != null && s.known_pool_charge_usd === null && s.pool_charge_status === 'UNKNOWN' && s.pool_completeness === 'PARTIAL'),
    'a known bonus is never taken as the pool charge')
  // a charge on a signing the pool did not apply to is refused
  assert.match(await attempt(report({ signing_id: SIGNING('yasiel-puig', 2012), component_type: "'POOL_CHARGE'", amount: '12000000', source_id: SOURCE('ba2013'), evidence_basis: "'PUBLISHED_INTERNATIONAL_REVIEW'" })),
    /POOL_CHARGE cannot be recorded for a signing whose pool treatment is NOT_APPLICABLE/)
  // a sourced charge completes the pool dimension only; cost and acquisition completeness do not move
  await inTxn(async () => {
    const before = await one(`select known_acquisition_cost_usd::text, acquisition_cost_completeness from v_signing_acquisition_financials where player_slug = 'roki-sasaki'`)
    await chain.db.exec(report({ component_type: "'POOL_CHARGE'", amount: '6500000', amount_basis: "'ROUNDED'", amount_precision: '100000' }))
    const after = await one(`select known_acquisition_cost_usd::text, acquisition_cost_completeness, known_pool_charge_usd::text, pool_completeness from v_signing_acquisition_financials where player_slug = 'roki-sasaki'`)
    assert.deepEqual(after, { ...before, known_pool_charge_usd: '6500000.00', pool_completeness: 'COMPLETE' })
    assert.deepEqual(await failing(), [])
  })
})

test('the two completeness dimensions are separate', async () => {
  const pairs = Object.fromEntries((await q(`select player_slug, acquisition_cost_completeness as a, pool_completeness as p from v_signing_acquisition_financials
    where player_slug in ('hyun-jin-ryu', 'yasiel-puig', 'roki-sasaki', 'fernando-valenzuela', 'yusniel-diaz')`)).map((r) => [r.player_slug, [r.a, r.p]]))
  assert.deepEqual(pairs, { 'hyun-jin-ryu': ['COMPLETE', 'UNKNOWN'], 'yasiel-puig': ['COMPLETE', 'NOT_APPLICABLE'], 'roki-sasaki': ['PARTIAL', 'PARTIAL'],
    'fernando-valenzuela': ['PARTIAL', 'NOT_APPLICABLE'], 'yusniel-diaz': ['COMPLETE', 'PARTIAL'] })
  const dist = async (col) => Object.fromEntries((await q(`select ${col} as k, count(*)::int as n from v_signing_acquisition_financials where is_dodgers group by 1`)).map((r) => [r.k, r.n]))
  assert.deepEqual(await dist('acquisition_cost_completeness'), { COMPLETE: 41, PARTIAL: 3, UNKNOWN: 129, NO_RULE: 47 })
  assert.deepEqual(await dist('pool_completeness'), { NOT_APPLICABLE: 33, PARTIAL: 4, UNKNOWN: 183 })
  assert.deepEqual(await dist('bonus_status'), { KNOWN: 42, UNKNOWN: 178 })
  // OTHER has no rule: NO_RULE even where a bonus is known
  assert.equal((await one(`select count(*)::int as n from v_signing_acquisition_financials where pathway = 'OTHER' and acquisition_cost_completeness <> 'NO_RULE'`)).n, 0)
  // the rule table: every pathway x component once, POOL_CHARGE never a cost component
  assert.equal((await one(`select count(*)::int as n from acquisition_cost_component_rules`)).n, 50)
  assert.match(await attempt(`insert into acquisition_cost_component_rules (pathway, component_type, applicability, explanation) values ('OTHER', 'POOL_CHARGE', 'NO_RULE', 'x')`), /component_type_check/)
})

test('2015-16: approximate reported spend, the tax as a rate, no tax amount, $700K after trades preserved', async () => {
  const env = await q(`select r.metric_type, r.amount_usd::text, r.rate_value::text, r.amount_basis, r.report_origin from signing_environment_financial_reports r
    where r.signing_environment_id = ${ENV(2015)} order by 1, 5`)
  assert.deepEqual(env, [
    { metric_type: 'BASE_POOL', amount_usd: '2020300.00', rate_value: null, amount_basis: null, report_origin: 'LEGACY_CARRYFORWARD' },
    { metric_type: 'OVERAGE_TAX_RATE', amount_usd: null, rate_value: '1.00000', amount_basis: 'EXACT', report_origin: 'EXTERNAL_SOURCE' },
    { metric_type: 'OVERAGE_TAX_RATE', amount_usd: null, rate_value: '1.00000', amount_basis: null, report_origin: 'LEGACY_CARRYFORWARD' },
    { metric_type: 'POOL_AFTER_TRADES', amount_usd: '700000.00', rate_value: null, amount_basis: 'EXACT', report_origin: 'EXTERNAL_SOURCE' },
    { metric_type: 'POOL_AFTER_TRADES', amount_usd: '700000.00', rate_value: null, amount_basis: null, report_origin: 'LEGACY_CARRYFORWARD' },
    { metric_type: 'REPORTED_PERIOD_SPEND', amount_usd: '45000000.00', rate_value: null, amount_basis: 'APPROXIMATE', report_origin: 'EXTERNAL_SOURCE' },
  ])
  assert.equal((await one(`select count(*)::int as n from signing_environment_financial_reports where metric_type = 'OVERAGE_TAX_PAID' or amount_usd = 90000000`)).n, 0)
  const cls = await one(`select pool_capacity_usd::text, pool_capacity_basis, source_reported_approximate_spend_usd::text, source_reported_utilization_pct, true_disi_row_utilization_pct
    from v_dodgers_financial_commitment_by_class where period_label = '2015-16'`)
  assert.deepEqual(cls, { pool_capacity_usd: '700000.00', pool_capacity_basis: 'POOL_AFTER_TRADES', source_reported_approximate_spend_usd: '45000000.00', source_reported_utilization_pct: null, true_disi_row_utilization_pct: null })
  // typed values: a rate goes in rate_value, money in amount_usd
  const envReport = (metric, amount, rate) => `insert into signing_environment_financial_reports (signing_environment_id, metric_type, amount_usd, rate_value, amount_basis, report_origin, source_id, evidence_basis, confidence, retrieved_at)
    values (${ENV(2015)}, '${metric}', ${amount}, ${rate}, 'EXACT', 'EXTERNAL_SOURCE', ${SOURCE('ba2016')}, 'PUBLISHED_INTERNATIONAL_REVIEW', 'HIGH', now())`
  assert.match(await attempt(envReport('OVERAGE_TAX_RATE', '1', 'null')), /value_check/)
  assert.match(await attempt(envReport('BASE_POOL', 'null', '1')), /value_check/)
  assert.match(await attempt(envReport('OVERAGE_TAX_RATE', 'null', '11')), /rate_value_check|check/)
})

test('2019-20: one Dodgers environment from the period summary, its three population members linked, nine environments in all', async () => {
  const env = await q(`select se.signing_period_label, se.regime::text, se.club_bonus_pool_usd::text, se.pool_after_trades_usd from signing_environments se
    join organizations o on o.id = se.organization_id where o.franchise_key = 'DODGERS' and se.signing_year = 2019`)
  assert.deepEqual(env, [{ signing_period_label: '2019-20', regime: 'MODERN_HARD_POOL', club_bonus_pool_usd: '5366400.00', pool_after_trades_usd: null }])
  assert.equal((await one(`select count(*)::int as n from signing_environments`)).n, 9)
  assert.deepEqual((await q(`select p.slug from signings sg join players p on p.id = sg.player_id where sg.signing_environment_id = ${ENV(2019)} order by 1`)).map((r) => r.slug),
    ['lesther-medrano', 'roque-gutierrez', 'yeiner-fernandez'])
  assert.equal((await one(`select signing_environment_id from signings where id = ${SIGNING('luis-rodriguez-2019', 2019)}`)).signing_environment_id, null)
  assert.deepEqual(await q(`select metric_type, amount_usd::text, amount_basis, report_origin, evidence_basis from signing_environment_financial_reports where signing_environment_id = ${ENV(2019)} order by 1`), [
    { metric_type: 'BASE_POOL', amount_usd: '5366400.00', amount_basis: 'EXACT', report_origin: 'EXTERNAL_SOURCE', evidence_basis: 'CANONICAL_PERIOD_SUMMARY' },
    { metric_type: 'REPORTED_PERIOD_SPEND', amount_usd: '5354000.00', amount_basis: 'EXACT', report_origin: 'EXTERNAL_SOURCE', evidence_basis: 'CANONICAL_PERIOD_SUMMARY' },
  ])
})

test('utilization labelling: source-reported only for 2019-20, true DISI-row utilization nowhere, tracked-bonus share never called utilization', async () => {
  const cls = await q(`select period_label, known_tracked_bonus_pct_of_pool::text as pct, known_tracked_bonus_pct_basis as basis, source_reported_utilization_pct::text as reported,
    true_utilization_eligible, true_disi_row_utilization_pct from v_dodgers_financial_commitment_by_class where class_basis = 'SIGNING_ENVIRONMENT' order by class_year`)
  assert.deepEqual(cls.filter((c) => c.reported != null).map((c) => [c.period_label, c.reported]), [['2019-20', '99.8']])
  assert.ok(cls.every((c) => c.true_utilization_eligible === false && c.true_disi_row_utilization_pct === null))
  assert.deepEqual(cls.filter((c) => c.pct != null).map((c) => [c.period_label, c.pct]),
    [['2015-16', '6624.9'], ['2018-19', '72.2'], ['2019-20', '22.4'], ['2021-22', '8.6'], ['2023', '71.7'], ['2024', '36.0'], ['2025', '141.1'], ['2026', '48.8']])
  for (const c of cls.filter((x) => x.pct != null)) assert.match(c.basis, /Not utilization: population .* tracked bonuses known, pool adjustments/, c.period_label)
  assert.match(cls.find((c) => c.period_label === '2015-16').basis, /pool after trades \(AGGRESSIVE_OVERAGE regime\)/)
  const utilizationCols = (await q(`select attname from pg_attribute where attrelid = 'public.v_dodgers_financial_commitment_by_class'::regclass and attnum > 0 and attname like '%utiliz%' order by 1`)).map((r) => r.attname)
  assert.deepEqual(utilizationCols, ['source_reported_utilization_basis', 'source_reported_utilization_pct', 'true_disi_row_utilization_pct', 'true_utilization_eligible'])
})

test('currency: a three-letter uppercase code; non-USD is storable but never selects a USD column; no FX', async () => {
  for (const bad of ["'usd'", "'US'", "'USDX'", "''"]) assert.match(await attempt(report({ currency_code: bad, amount: '1' })), /currency_code_check/, bad)
  await inTxn(async () => {
    const unknown = await one(`select s.id from signings s join players p on p.id = s.player_id where s.signing_bonus_usd is null and s.pathway::text = 'LATAM_AMATEUR' order by p.slug limit 1`)
    await chain.db.exec(report({ signing_id: `${lit(unknown.id)}::uuid`, currency_code: "'JPY'", amount: '100000000' }))
    assert.deepEqual(await failing(), [], 'a JPY report alone leaves the USD column NULL')
    assert.equal((await one(`select bonus_status from v_signing_acquisition_financials where signing_id = $1`, [unknown.id])).bonus_status, 'UNKNOWN')
  })
  assert.deepEqual(await q(`select distinct currency_code from signing_financial_reports`), [{ currency_code: 'USD' }])
  assert.deepEqual(await q(`select table_name, column_name from information_schema.columns where table_schema = 'public' and column_name ~* 'fx_|exchange_rate'`), [])
})

test('lifecycle: no delete, ACTIVE sealed except retraction, RETRACTED sealed, supersession retires its predecessor, no self or double supersession', async () => {
  const sasakiBonus = `(select id from signing_financial_reports where signing_id = ${SIGNING('roki-sasaki', 2025)} and component_type = 'SIGNING_BONUS' and source_id = ${SOURCE('cbs2025')})`
  assert.match(await attempt(`delete from signing_financial_reports where id = ${sasakiBonus}`), /never deleted/)
  assert.match(await attempt(`delete from signing_environment_financial_reports where signing_environment_id = ${ENV(2015)}`), /never deleted/)
  assert.match(await attempt(`update signing_financial_reports set amount = 1 where id = ${sasakiBonus}`), /sealed/)
  assert.match(await attempt(`update signing_environment_financial_reports set amount_usd = 1 where signing_environment_id = ${ENV(2019)} and metric_type = 'BASE_POOL'`), /sealed/)
  assert.match(await attempt(report({ amount: '6400000', source_id: SOURCE('ba2013'), evidence_basis: "'PUBLISHED_INTERNATIONAL_REVIEW'" }).replace(') values (', ', record_status) values (').replace(/\)$/, ", 'RETRACTED')")), /starts ACTIVE|retraction_check/)
  await inTxn(async () => {
    await chain.db.exec(`update signing_financial_reports set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'test' where id = ${sasakiBonus}`)
    assert.match(await attempt(`update signing_financial_reports set retraction_reason = 'changed' where id = ${sasakiBonus}`), /RETRACTED financial report is sealed/)
  })
  await inTxn(async () => {
    const pred = (await one(`select ${sasakiBonus} as id`)).id
    await chain.db.exec(report({ supersedes_report_id: `${lit(pred)}::uuid`, amount_basis: "'ROUNDED'", amount_precision: '100000', note: "'corrected'" }))
    assert.deepEqual(await one(`select record_status, retraction_reason from signing_financial_reports where id = $1`, [pred]), { record_status: 'RETRACTED', retraction_reason: 'Superseded by a corrected report.' })
    assert.match(await attempt(report({ supersedes_report_id: `${lit(pred)}::uuid`, amount_basis: "'ROUNDED'", amount_precision: '100000', note: "'second'" })), /supersedes_key|duplicate/)
    assert.deepEqual(await failing(), [])
  })
  assert.match(await attempt(report({ supersedes_report_id: `(select id from signing_financial_reports where signing_id = ${SIGNING('hyun-jin-ryu', 2012)} limit 1)` })), /same signing and component/)
  assert.match(await attempt(`do $x$ declare i uuid := gen_random_uuid(); begin ${report({ supersedes_report_id: 'i' }).replace('insert into signing_financial_reports (', 'insert into signing_financial_reports (id, ').replace(') values (', ') values (i, ')}; end $x$`),
    /supersedes_check|same signing and component/)
  // origin rules
  assert.match(await attempt(report({ source_id: 'null' })), /origin_check/, 'EXTERNAL_SOURCE needs a source')
  assert.match(await attempt(report({ report_origin: "'LEGACY_CARRYFORWARD'", amount_basis: 'null', evidence_basis: "'LEGACY_CANONICAL_VALUE'" })), /origin_check/, 'a legacy row has no source')
  assert.match(await attempt(report({ report_origin: "'RULE_DERIVED'", evidence_basis: "'RULE_APPLICATION'" })), /origin_check/, 'a rule derivation needs a RULE_DERIVED basis')
  assert.match(await attempt(report({ amount_basis: "'RULE_DERIVED'", derivation_rate: '0.25', derivation_base_amount: '6500000', derivation_rule: "'x'", amount: '1600000' })), /derivation_check/, 'the derivation must reproduce the amount')
  assert.match(await attempt(report({ amount_basis: "'ROUNDED'" })), /precision_check/)
  assert.match(await attempt(report({ component_type: "'SALARY'" })), /component_type_check/)
})

test('research queue: the seven issue types, scoped and filtered as documented', async () => {
  const issues = Object.fromEntries((await q(`select issue, count(*)::int as n from v_financial_research_queue group by 1`)).map((r) => [r.issue, r.n]))
  assert.deepEqual(issues, { CLASS_FINANCIAL_COVERAGE_INCOMPLETE: 9, FINANCIAL_REPORT_CONFLICT: 1, FINANCIAL_SOURCE_MISSING: 90, POOL_CAPACITY_UNKNOWN: 5,
    POOL_TREATMENT_UNKNOWN: 113, SIGNING_BONUS_UNKNOWN: 74 })
  assert.ok(!('ACQUISITION_FEE_UNKNOWN' in issues))
  // FINANCIAL_SOURCE_MISSING = legacy-only signing values + legacy-only environment values
  const legacyOnly = await one(`select (select count(*) from signing_financial_reports r where r.report_origin = 'LEGACY_CARRYFORWARD' and r.record_status = 'ACTIVE'
      and not exists (select 1 from signing_financial_reports x where x.signing_id = r.signing_id and x.component_type = r.component_type and x.report_origin = 'EXTERNAL_SOURCE' and x.record_status = 'ACTIVE'))::int as s,
    (select count(*) from signing_environment_financial_reports r where r.report_origin = 'LEGACY_CARRYFORWARD' and r.record_status = 'ACTIVE'
      and not exists (select 1 from signing_environment_financial_reports x where x.signing_environment_id = r.signing_environment_id and x.metric_type = r.metric_type and x.report_origin = 'EXTERNAL_SOURCE' and x.record_status = 'ACTIVE'))::int as e`)
  assert.deepEqual(legacyOnly, { s: 84, e: 6 })
  // the bonus and treatment gaps are Dodgers-only and need a signal
  assert.equal((await one(`select count(*)::int as n from v_financial_research_queue where issue in ('SIGNING_BONUS_UNKNOWN', 'POOL_TREATMENT_UNKNOWN') and organization_name <> 'Los Angeles Dodgers'`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from v_financial_research_queue where issue in ('SIGNING_BONUS_UNKNOWN', 'POOL_TREATMENT_UNKNOWN') and detail not like '%signals: _%'`)).n, 0)
  const oracle = await one(`select count(*)::int as n from v_signing_acquisition_financials f join signings s on s.id = f.signing_id
    where f.is_dodgers and f.bonus_status = 'UNKNOWN' and f.pathway not in ('OTHER')
      and (exists (select 1 from outcome_audits oa where oa.player_id = s.player_id and oa.reached_mlb_verified) or s.international_rank is not null or cardinality(f.known_components) > 0
        or exists (select 1 from signing_population_members m join signing_populations sp on sp.id = m.population_id join v_dodgers_signing_population_coverage c on c.population_key = sp.population_key
                   where m.signing_id = s.id and c.population_complete))`)
  assert.equal(oracle.n, 74)
  assert.deepEqual((await q(`select detail from v_financial_research_queue where issue = 'POOL_CAPACITY_UNKNOWN' order by 1`)).map((r) => r.detail.slice(0, 4)), ['2012', '2013', '2014', '2017', '2021'])
})

test('no network cost attribution, scouting ROI, WAR, salary or ranking in any 030 view', async () => {
  const cols = await q(`select c.relname, a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relname = any($1) and a.attnum > 0`, [NEW_VIEWS])
  assert.deepEqual(cols.filter((c) => /war|salary|roi|return|network|trainer|academy|per_million|efficien|rank|best|cheap|value_score|evaluation|scout/i.test(c.attname)), [])
  const defs = await q(`select relname, pg_get_viewdef(oid) as d from pg_class where relname = any($1)`, [NEW_VIEWS])
  for (const d of defs) assert.doesNotMatch(d.d, /network_|player_evaluations|outcomes|war|_war|war_|bwar|salary|per_million/i, d.relname)
})

test('security: RLS, SELECT-only grants, no PUBLIC, no write policy, invoker views and functions', async () => {
  const t = await q(`select c.relname, c.relrowsecurity as rls from pg_class c where c.relname = any($1) order by 1`, [NEW_TABLES])
  assert.ok(t.every((r) => r.rls))
  const acl = await q(`select c.relname, coalesce(r.rolname, 'PUBLIC') as grantee, string_agg(a.privilege_type, ',' order by a.privilege_type) as privs from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee
    where c.relname = any($1) and coalesce(r.rolname, 'PUBLIC') in ('anon', 'authenticated', 'PUBLIC') group by 1, 2 order by 1, 2`, [[...NEW_TABLES, ...NEW_VIEWS]])
  assert.equal(acl.length, 14)
  assert.ok(acl.every((a) => a.grantee !== 'PUBLIC' && a.privs === 'SELECT'))
  assert.deepEqual(await q(`select tablename, cmd from pg_policies where tablename = any($1) and cmd <> 'SELECT'`, [NEW_TABLES]), [])
  const v = await q(`select relname, coalesce(array_to_string(reloptions, ','), '') as o from pg_class where relname = any($1)`, [NEW_VIEWS])
  assert.ok(v.every((x) => /security_invoker=(true|on)/.test(x.o)))
  assert.equal((await one(FINANCIAL_QUERIES.financial_function_violations)).n, 0)
})

test('the full verifier passes on the 030 state, and each financial check catches its own drift', async () => {
  // the verifier now expects the 031 table total; this database is the 030 state (53 tables)
  const full = await checkInvariants(chain.query, { ...CANONICAL_EXPECTATIONS, public_tables_total: 53 })
  assert.deepEqual(failedChecks(full).map((c) => c.name), [])
  assert.equal(full.hard.length, 139, '137 from 030 plus the two 031 resolution checks, which pass trivially without the table')
  await inTxn(async () => {
    await chain.db.exec(`set local session_replication_role = replica;
      update signing_environment_financial_reports set amount_usd = 1 where signing_environment_id = ${ENV(2019)} and metric_type = 'BASE_POOL';`)
    assert.deepEqual(await failing(), ['financial_environment_column_mismatches'])
  })
  await inTxn(async () => {
    await chain.db.exec(`alter table signing_financial_reports disable trigger signing_financial_reports_guard; alter table signing_financial_reports drop constraint signing_financial_reports_origin_check;
      update signing_financial_reports set source_id = ${SOURCE('ba2013')} where report_origin = 'LEGACY_CARRYFORWARD' and signing_id = ${SIGNING('yasiel-puig', 2012)};`)
    assert.ok((await failing()).includes('financial_signing_report_provenance_violations'))
  })
  await inTxn(async () => {
    await chain.db.exec(`drop trigger signing_financial_reports_guard on signing_financial_reports;`)
    assert.deepEqual(await failing(), ['financial_guard_trigger_violations'])
  })
  await inTxn(async () => {
    await chain.db.exec(`grant execute on function disi_signing_financial_report_guard() to anon;`)
    assert.deepEqual(await failing(), ['financial_function_violations'])
  })
  await inTxn(async () => {
    await chain.db.exec(`delete from acquisition_cost_component_rules where pathway = 'POSTED_PLAYER' and component_type = 'POSTING_FEE';`)
    assert.deepEqual(await failing(), ['financial_component_rule_violations'])
  })
  await inTxn(async () => {
    await chain.db.exec(`set local session_replication_role = replica;
      insert into signing_financial_reports (signing_id, component_type, amount, currency_code, report_origin, evidence_basis, confidence)
      values (${SIGNING('yasiel-puig', 2012)}, 'POOL_CHARGE', 12000000, 'USD', 'LEGACY_CARRYFORWARD', 'LEGACY_CANONICAL_VALUE', 'UNVERIFIED');`)
    assert.deepEqual(await failing(), ['financial_pool_charge_violations'])
  })
  await inTxn(async () => {
    await chain.db.exec(`alter table signing_financial_reports disable trigger signing_financial_reports_guard;
      update signing_financial_reports set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'x' where signing_id = ${SIGNING('roki-sasaki', 2025)} and component_type = 'POSTING_FEE' and source_id = ${SOURCE('cbs2025')};
      ${report({ supersedes_report_id: `(select id from signing_financial_reports where signing_id = ${SIGNING('hyun-jin-ryu', 2012)} and component_type = 'POSTING_FEE' limit 1)`, component_type: "'POSTING_FEE'", amount: '1625000' })};`)
    assert.ok((await failing()).includes('financial_supersession_violations'))
  })
  assert.deepEqual(await failing(), [])
})

test('a fresh 001-030 replay equals the simulated pre-030 state plus 030', async () => {
  const fresh = await buildChainThrough('030_financial_acquisition_intelligence.sql')
  try {
    const content = async (query) => ({
      signings: (await query(`select p.slug, sg.signing_year, sg.signing_bonus_usd::text, sg.posting_fee_usd::text, sg.transfer_fee_usd::text, sg.bonus_publicly_reported,
        sg.international_pool_treatment, sg.international_pool_treatment_basis, so.url as treatment_source, se.signing_year as env_year
        from signings sg join players p on p.id = sg.player_id left join sources so on so.id = sg.international_pool_treatment_source_id
        left join signing_environments se on se.id = sg.signing_environment_id order by 1, 2`)),
      reports: (await query(`select p.slug, sg.signing_year, r.component_type, r.amount::text, r.currency_code, r.amount_basis, r.amount_precision::text, r.derivation_rate::text,
        r.report_origin, so.url, r.evidence_basis, r.confidence::text, r.note, r.record_status from signing_financial_reports r join signings sg on sg.id = r.signing_id
        join players p on p.id = sg.player_id left join sources so on so.id = r.source_id order by 1, 2, 3, 4, 10`)),
      env: (await query(`select se.signing_year, se.signing_period_label, se.regime::text, se.club_bonus_pool_usd::text, r.metric_type, r.amount_usd::text, r.rate_value::text, r.amount_basis,
        r.report_origin, so.url, r.note from signing_environment_financial_reports r join signing_environments se on se.id = r.signing_environment_id
        left join sources so on so.id = r.source_id order by 1, 5, 9, 10`)),
      rules: (await query(`select pathway::text, component_type, applicability, explanation from acquisition_cost_component_rules order by 1, 2`)),
      queue: (await query(`select issue, subject, player_slug, environment_period_label, detail from v_financial_research_queue order by 1, 2, 3, 4, 5`)),
      classes: (await query(`select * from v_dodgers_financial_commitment_by_class order by class_basis, class_year`)).map(({ signing_environment_id, ...r }) => r),
    })
    assert.deepEqual(await content(fresh.query), await content(chain.query))
  } finally {
    await fresh.close()
  }
})
