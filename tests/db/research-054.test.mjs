// 054 (full-career transaction history) over the exact database it was written for (the 053 chain): apply, rerun, the verifier at both boundaries,
// the career-history table and the player's transaction stream, the research-queue correction matching the pure rule, the hotfix and 053 cases,
// isolation of the Dodgers asset ledger, control intervals, queues, development facts, outcomes, WAR, costs and prediction, one snapshot refresh,
// security, the three 054 checks catching what they guard, and the exact rollback and reapply.
//   DODGERS ASSET TRANSACTION != GENERAL CAREER TRANSACTION   CAREER MOVE != ASSET PACKAGE   CAREER MOVE != DODGERS CONTROL CHANGE
//   THIRD-PARTY TRADE != DODGERS TRADE   CAREER TRANSACTION != RETURN VALUE   CAREER TRANSACTION != PREDICTION FEATURE   ONE KNOWN MOVE != COMPLETE CAREER

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_054A as CANONICAL_EXPECTATIONS, EXPECTATIONS_THROUGH_053 } from '../../scripts/db/lib/invariants.mjs'
import { ALL_SNAPSHOT_TABLES } from '../../database/research/045b/snapshots.mjs'
import { CAREER_QUERIES, DATASET_QUERIES, HISTORY_QUERIES, assembleDataset, chronologyTransactions } from '../../lib/research/dataset.js'
import { developmentNeedSummary } from '../../lib/research/development-needs.js'
import { isBracketedSeason, multiOrganizationSeasons } from '../../lib/research/development-chronology.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '054_full_career_transaction_history.sql'
const sql054 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback054 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-054.sql'), 'utf8')
const sql053 = fs.readFileSync(path.join(root, 'database/sql/053_transaction_chronology_resolution.sql'), 'utf8')
const values = JSON.parse(fs.readFileSync(path.join(root, 'database/research/054/migration-values.json'), 'utf8'))

let chain
let pre054
let post054
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const open = async (dump) => {
  const db = new PGlite({ loadDataDir: dump, extensions: { pgcrypto } })
  return { db, query: async (s, p) => (await db.query(s, p)).rows, close: () => db.close() }
}
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params, c = chain) => (await c.query(sql, params))[0]
const failsWith = async (c, sql, pattern) => {
  try { await c.db.exec(sql) } catch (e) {
    await c.db.exec('rollback;').catch(() => {})
    assert.match(String(e.message), pattern)
    return
  }
  assert.fail(`expected the statement to fail with ${pattern}`)
}
const names = async (c) => (await c.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).map((r) => r.relname)
const tables = async (c) => {
  const out = {}
  for (const t of await names(c)) out[t] = (await c.query(`select count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from public.${t} x`))[0]
  return out
}
const content = async (c) => {
  const out = {}
  for (const t of await names(c)) {
    const cols = (await c.query(`select string_agg(quote_ident(column_name), ',' order by ordinal_position) as c from information_schema.columns
      where table_schema = 'public' and table_name = $1 and data_type <> 'uuid'
        and column_name not in ('created_at', 'reviewed_at', 'accessed_at', 'generated_at', 'generation_id', 'snapshot_as_of_date')`, [t]))[0].c
    out[t] = (await c.query(`select count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from (select ${cols} from public.${t}) x`))[0]
  }
  return out
}
const surface = async (c) => ({
  relations: await c.query(`select c.relname, c.relkind::text, c.relrowsecurity, coalesce(c.relacl::text, '') as acl, coalesce(array_to_string(c.reloptions, ','), '') as opts
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'm') order by 1`),
  functions: await c.query(`select p.oid::regprocedure::text as f, p.prosecdef, coalesce(p.proacl::text, '') as acl, md5(pg_get_functiondef(p.oid)) as h
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`),
  policies: await c.query(`select tablename, policyname, cmd, roles::text from pg_policies where schemaname = 'public' order by 1, 2`),
  triggers: await c.query(`select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
  views: await c.query(`select relname, md5(pg_get_viewdef(oid)) as h from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`),
})
const isolation = async (c) => ({
  features: await one(`select md5(string_agg(f::text, '|' order by f::text)) as h, count(*)::int as n from public.v_outcome_feature_matrix f`, [], c),
  support: await c.query(`select target_key, reference_population, labelled_n, positive_n, negative_n, baseline_supported from public.v_outcome_target_support order by 1, 2`),
  evaluation: await c.query(`select model_key, training_fingerprint, evaluation_current from public.v_outcome_model_evaluation order by 1`),
  probabilities: (await one(`select count(*) filter (where probability is not null)::int as n from public.v_player_outcome_probability`, [], c)).n,
  audits: await one(`select count(*) filter (where outcome_audit_status = 'VERIFIED_MLB')::int as mlb, count(*) filter (where outcome_audit_status = 'VERIFIED_NO_MLB')::int as no_mlb,
    count(*) filter (where outcome_audit_status = 'NOT_AUDITED')::int as na from public.v_signing_records where is_dodgers_franchise`, [], c),
  costs: await one(`select count(total_known_acquisition_cost_usd)::int as n, sum(total_known_acquisition_cost_usd)::text as usd from public.v_signing_records where is_dodgers_franchise`, [], c),
  development: await one(`select (select count(*)::int from public.player_season_stints) as stints, (select count(*)::int from public.development_milestones) as milestones,
    (select count(*)::int from public.development_progression_decisions) as decisions`, [], c),
  war: await one(`select count(*)::int as n, md5(string_agg(w::text, '|' order by w.id::text)) as h from public.player_mlb_team_season_war w`, [], c),
  ledger: await one(`select (select count(*)::int from public.transaction_events) as events, (select count(*)::int from public.transaction_event_assets) as assets,
    (select count(*)::int from public.transaction_asset_resolutions) as resolutions`, [], c),
  intervals: await one(`select count(*)::int as n, md5(string_agg(i::text, '|' order by i.interval_key)) as h from public.v_player_control_intervals i`, [], c),
  edges: await one(`select md5(string_agg(e::text, '|' order by e::text)) as h from public.v_trade_realization_edges e`, [], c),
  exits: await one(`select md5(string_agg(e::text, '|' order by e::text)) as h from public.v_dodgers_international_exit_summary e`, [], c),
  transaction_queue: await c.query(`select issue, event_key, asset_name, player_slug from public.v_transaction_research_queue order by 1, 2, 3, 4`),
  value_queue: await c.query(`select issue, event_key, player_slug, detail from public.v_value_research_queue order by 1, 2, 3, 4`),
  decisions: await one(`select md5(string_agg(d::text, '|' order by d.signing_id::text)) as h from (select signing_id, chain_status, realized_value_state, attribution_note, package_first_hop_participation_bwar from public.product_player_decision) d`, [], c),
  expected: await one(`select supported_probability_targets as targets, supported_expected_values as evs, predictive_portfolio_recommendations as recs from public.product_executive_snapshot`, [], c),
})
const dataset = async (c) => {
  /** @type {Record<string, any[]>} */
  const raw = {}
  const career = (await one(`select to_regclass('public.v_player_career_transactions') is not null as ok`, [], c)).ok
  for (const [k, sql] of Object.entries({ ...DATASET_QUERIES, ...HISTORY_QUERIES, ...(career ? CAREER_QUERIES : {}) })) raw[k] = await c.query(sql)
  const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)
  for (const rows of Object.values(raw)) for (const r of rows) for (const k of Object.keys(r)) r[k] = iso(r[k])
  return assembleDataset(raw)
}
const seasons = (d, slug) => {
  const id = d.signings.find((s) => s.player_slug === slug).player_id
  return multiOrganizationSeasons(d.stints.filter((s) => s.player_id === id), chronologyTransactions(d).filter((t) => t.player_id === id))
}

let preTables, preContent, preSurface, preIsolation, preGeneration, preData
before(async () => {
  chain = await buildChainThrough('053_transaction_chronology_resolution.sql')
  pre054 = await chain.db.dumpDataDir('none')
  preTables = await tables(chain)
  preContent = await content(chain)
  preSurface = await surface(chain)
  preIsolation = await isolation(chain)
  preData = await dataset(chain)
  preGeneration = (await one(`select max(generation_id)::int as g from public.product_executive_snapshot`)).g
  await chain.db.exec(sql054)
  post054 = await chain.db.dumpDataDir('none')
}, { timeout: 900000 })
after(async () => { await chain?.close() })

test('054 follows 053 in the manifest, and its rollback exists', () => {
  const i = manifest.canonical_sql.indexOf(FILE)
  assert.equal(manifest.canonical_sql[i - 1], '053_transaction_chronology_resolution.sql')
  assert.equal(manifest.canonical_sql[i + 1], '054a_development_queue_performance.sql')
  assert.equal(manifest.notes.canonical_build_count, manifest.canonical_sql.length)
  assert.match(rollback054, /^-- DISI rollback-054\.sql/)
})

test('verifier: 259/259 at the 053 boundary before 054 and at the head after it; the 053 pins fail exactly on the one table and one view 054 adds', async () => {
  const c = await open(pre054)
  try {
    const pre = await checkInvariants(c.query, EXPECTATIONS_THROUGH_053)
    assert.deepEqual(failedChecks(pre).map((f) => f.name), [])
    assert.equal(pre.hard.length, 259)
  } finally { await c.close() }
  const full = await checkInvariants(q, CANONICAL_EXPECTATIONS)
  assert.deepEqual(failedChecks(full).map((f) => f.name), [])
  assert.equal(full.hard.length, 259)
  const old = await checkInvariants(q, EXPECTATIONS_THROUGH_053)
  assert.deepEqual(failedChecks(old).map((f) => f.name).sort(), ['public_tables_total', 'public_views_total'])
})

test('rerunnable: applying 054 again changes nothing', async () => {
  const c = await open(post054)
  try {
    const a = await tables(c)
    await c.db.exec(sql054)
    assert.deepEqual(await tables(c), a)
  } finally { await c.close() }
})

test('the career-history table holds exactly the reviewed moves, in the player\'s direction, never a Dodgers organization', async () => {
  const rows = await q(`select c.event_key, p.slug, c.transaction_date::text as d, c.transaction_type as t, coalesce(fo.abbreviation, '') as f, coalesce(too.abbreviation, '') as tt,
      c.source_reference, s.url from public.player_career_transactions c join public.players p on p.id = c.player_id
      left join public.organizations fo on fo.id = c.from_organization_id left join public.organizations too on too.id = c.to_organization_id
      join public.sources s on s.id = c.source_id order by 2, 3, 1`)
  assert.equal(rows.length, 46)
  const want = [...values.events].sort((a, b) => (a.player_slug + a.date + a.key < b.player_slug + b.date + b.key ? -1 : 1))
  assert.deepEqual(rows.map((r) => [r.event_key, r.slug, r.d, r.t, r.f, r.tt, r.source_reference, r.url]),
    want.map((e) => [e.key, e.player_slug, e.date, e.type, e.from, e.to, e.source_reference, e.source_url]))
  assert.ok(rows.every((r) => !['LAD', 'BRO'].includes(r.f) && !['LAD', 'BRO'].includes(r.tt)))
  // RELEASE + SIGNING are two facts: Cartaya left Minnesota on 2025-07-23 and signed with San Francisco on 2025-07-29; no synthetic trade
  const cartaya = rows.filter((r) => r.slug === 'diego-cartaya')
  assert.deepEqual(cartaya.map((r) => [r.d, r.t, r.f, r.tt]), [['2025-07-23', 'RELEASE', 'MIN', ''], ['2025-07-29', 'FREE_AGENT_SIGNING', '', 'SFG']])
  assert.ok(!rows.some((r) => r.slug === 'diego-cartaya' && r.t === 'TRADE'))
  // the mechanism fixes the shape: the table refuses a release with a destination and a trade without one
  await failsWith(chain, `insert into public.player_career_transactions (event_key, player_id, transaction_date, transaction_type, from_organization_id, to_organization_id, description, source_id, source_reference)
    select 'CAREER_20250101_RELEASE_MIN_SFG_TEST', p.id, date '2025-01-01', 'RELEASE', (select id from public.organizations where abbreviation = 'MIN'), (select id from public.organizations where abbreviation = 'SFG'),
      'test', (select id from public.sources limit 1), 'MLB transaction 1' from public.players p where p.slug = 'diego-cartaya'`, /player_career_transactions_shape_check/)
})

test('the player\'s transaction stream labels both layers; no career row reaches the Dodgers-ledger views', async () => {
  const layers = await q(`select layer, count(*)::int as n from public.v_player_career_transactions group by 1 order by 1`)
  const ledgerRows = (await one(`select count(*)::int as n from public.transaction_event_assets where player_id is not null and asset_type = 'PLAYER'`)).n
  assert.deepEqual(layers, [{ layer: 'CAREER_HISTORY', n: 46 }, { layer: 'DODGERS_LEDGER', n: ledgerRows }])
  // a Dodgers acquisition reads counterparty -> Dodgers in the stream (Daal 2001), a Dodgers exit Dodgers -> counterparty (Rincon 2021)
  const daal = await one(`select from_organization, to_organization from public.v_player_career_transactions where event_key = 'PHI_LAD_2001_DAAL_REACQ' and player_slug = 'omar-daal'`)
  assert.deepEqual([daal.from_organization, daal.to_organization], ['PHI', 'LAD'])
  const rincon = await one(`select from_organization, to_organization, layer from public.v_player_career_transactions where event_key = 'LAD_NYM_2021_CARLOS_RINCON'`)
  assert.deepEqual([rincon.from_organization, rincon.to_organization, rincon.layer], ['LAD', 'NYM', 'DODGERS_LEDGER'])
  // the Dodgers-ledger view is untouched and carries no career row
  assert.equal((await one(`select count(*)::int as n from public.v_player_transactions where event_key like 'CAREER_%'`)).n, 0)
  const deps = await q(`select distinct v.relname from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class
    where d.refobjid = 'public.player_career_transactions'::regclass and v.relname <> 'player_career_transactions' order by 1`)
  assert.deepEqual(deps.map((r) => r.relname), ['v_dodgers_development_research_queue', 'v_player_career_transactions'])
})

test('the corrected detector flags exactly the players the pure rule does; career history closes chronology only where it brackets the dated move', async () => {
  const d = await dataset(chain)
  const ids = new Set(d.signings.map((s) => s.player_id))
  const by = new Map()
  for (const s of d.stints) by.set(s.player_id, [...(by.get(s.player_id) ?? []), s])
  const tx = new Map()
  for (const t of chronologyTransactions(d)) tx.set(t.player_id, [...(tx.get(t.player_id) ?? []), t])
  const sql = new Set(d.developmentQueue.filter((r) => r.issue === 'MULTI_ORG_SEASON_UNVERIFIED').map((r) => r.player_id))
  const js = new Set([...by].filter(([p, st]) => ids.has(p) && multiOrganizationSeasons(st, tx.get(p) ?? []).some((m) => !isBracketedSeason(m))).map(([p]) => p))
  assert.deepEqual([...sql].sort(), [...js].sort())
  const state = (p, y) => seasons(d, p).find((m) => m.season === y)
  // direct third-party trades and a waiver claim
  for (const [p, y] of [['carlos-santana', 2022], ['carlos-santana', 2023], ['yasiel-puig', 2019], ['juan-castro', 2006], ['chan-ho-park', 2010]]) {
    const m = state(p, y)
    assert.equal(m.state, 'BRACKETED_BY_CAREER_HISTORY', `${p} ${y}`)
    assert.equal(m.transaction.layer, 'CAREER_HISTORY')
  }
  assert.equal(state('chan-ho-park', 2010).transaction.type, 'WAIVER_CLAIM')
  // release + later signing: two facts, both between the two clubs' games
  for (const [p, y] of [['carlos-santana', 2025], ['carlos-santana', 2026], ['diego-cartaya', 2025], ['eddys-leonard', 2026], ['chan-ho-park', 2007], ['jose-vizcaino', 2006]]) {
    const m = state(p, y)
    assert.equal(m.state, 'BRACKETED_BY_CAREER_HISTORY', `${p} ${y}`)
    assert.deepEqual(m.career_events.map((e) => e.type), ['RELEASE', 'FREE_AGENT_SIGNING'], `${p} ${y}`)
  }
  // Cartaya 2025: a documented career move, never a Dodgers transaction (no Dodgers organization, no Dodgers-ledger row in the season)
  const cartaya = state('diego-cartaya', 2025)
  assert.equal(cartaya.dodgers_involved, false)
  assert.ok(cartaya.career_events.every((e) => e.layer === 'CAREER_HISTORY'))
  // the hotfix and 053 cases are read from the Dodgers ledger, unchanged
  assert.equal(state('carlos-rincon', 2021).state, 'BRACKETED')
  assert.equal(state('carlos-santana', 2008).state, 'BRACKETED')
  assert.equal(state('pedro-baez', 2022).state, 'BRACKETED_AT_DODGERS_BOUNDARY')
  assert.equal(state('edgar-leon', 2026).state, 'BRACKETED_AT_DODGERS_BOUNDARY')
  assert.equal(state('jose-vizcaino', 2000).state, 'TRANSACTION_RECORDED_DATES_BEFORE_GAME_LOGS')
  // a recorded career move in a season before dated game logs stays source-limited; overlapping appearance ranges go to a person
  assert.equal(state('juan-guzman', 1998).state, 'TRANSACTION_RECORDED_DATES_BEFORE_GAME_LOGS')
  assert.equal(state('juan-castro', 2008).state, 'APPEARANCE_RANGES_OVERLAP')
  // a team change with no recorded move (Nomo 1999, outside the workset) stays open
  assert.equal(state('hideo-nomo', 1999).state, 'NO_CANONICAL_TRANSACTION')
  const s = developmentNeedSummary(d)
  assert.deepEqual([s.detector_rows, s.needs, s.players], [128, 104, 62])
  const issues = (rows) => rows.reduce((m, r) => ({ ...m, [r.issue]: (m[r.issue] ?? 0) + 1 }), {})
  const pre = issues(preData.developmentQueue)
  const now = issues(d.developmentQueue)
  assert.equal(pre.MULTI_ORG_SEASON_UNVERIFIED - now.MULTI_ORG_SEASON_UNVERIFIED, 4)
  for (const k of Object.keys(pre)) if (k !== 'MULTI_ORG_SEASON_UNVERIFIED') assert.equal(now[k], pre[k], k)
})

test('isolation: the Dodgers asset ledger, packages, control intervals, both research queues, decisions, development facts, outcomes, WAR, costs and prediction are what 053 left', async () => {
  const now = await isolation(chain)
  assert.equal(md5(now), md5(preIsolation))
  assert.deepEqual(now.ledger, { events: 223, assets: 410, resolutions: 7 })
  assert.equal(now.transaction_queue.length, 58)
  assert.equal(now.value_queue.length, 93)
  assert.deepEqual(now.development, { stints: 1859, milestones: 1084, decisions: 42 })
  assert.deepEqual(now.audits, { mlb: 47, no_mlb: 46, na: 127 })
  assert.equal(now.war.n, 1880)
  assert.deepEqual(now.costs, { n: 56, usd: '121700237.33' })
  assert.equal(now.probabilities, 0)
  assert.deepEqual([now.expected.targets, now.expected.evs, now.expected.recs], [0, 0, 0])
  assert.ok(now.evaluation.every((e) => e.training_fingerprint === 'af9ec05feb3ee1518cb7608193cd209a' && e.evaluation_current))
  const reach = now.support.find((s) => s.target_key === 'REACH_MLB_WITHIN_7_SEASONS' && s.labelled_n === 90)
  assert.deepEqual([reach.positive_n, reach.negative_n, reach.baseline_supported], [19, 71, true])
})

test('one coherent snapshot generation: +1 because the executive snapshot counts the product contract (47 -> 48); no other snapshot content moves', async () => {
  const g = (await one(`select max(generation_id)::int as g from public.product_executive_snapshot`)).g
  assert.equal(g, preGeneration + 1)
  for (const t of ALL_SNAPSHOT_TABLES) assert.equal((await one(`select count(*) filter (where generation_id <> $1)::int as n from public.${t}`, [g])).n, 0, t)
  assert.deepEqual(await q(`select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`), [])
  assert.equal((await one(`select product_contract_relations::int as n from public.product_executive_snapshot`)).n, 48)
  const now = await content(chain)
  const changed = Object.keys(now).filter((t) => now[t].h !== preContent[t]?.h).sort()
  assert.deepEqual(changed, ['disi_product_contract', 'player_career_transactions', 'product_executive_snapshot', 'sources'])
  assert.equal(now.sources.n - preContent.sources.n, 2)
})

test('security: one table (RLS, a read policy, SELECT-only grants) and one security_invoker view are added; nothing else in the catalog moves', async () => {
  const now = await surface(chain)
  const added = now.relations.filter((r) => !preSurface.relations.some((x) => x.relname === r.relname))
  assert.deepEqual(added.map((r) => [r.relname, r.relkind, r.relrowsecurity]), [['player_career_transactions', 'r', true], ['v_player_career_transactions', 'v', false]])
  for (const r of added) assert.equal(r.acl, '{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres}', r.relname)
  assert.match(added[1].opts, /security_invoker=true/)
  assert.deepEqual(now.relations.filter((r) => preSurface.relations.some((x) => x.relname === r.relname)), preSurface.relations)
  assert.deepEqual(now.functions, preSurface.functions)
  assert.deepEqual(now.triggers, preSurface.triggers)
  assert.deepEqual(now.policies.filter((p) => p.tablename !== 'player_career_transactions'), preSurface.policies)
  assert.deepEqual(now.policies.filter((p) => p.tablename === 'player_career_transactions').map((p) => [p.policyname, p.cmd]), [['public_read_player_career_transactions', 'SELECT']])
  const changed = now.views.filter((v) => preSurface.views.some((x) => x.relname === v.relname && x.h !== v.h)).map((v) => v.relname)
  assert.deepEqual(changed, ['v_dodgers_development_research_queue'])
  const w = await one(`select has_table_privilege('anon', 'public.player_career_transactions', 'INSERT') or has_table_privilege('anon', 'public.player_career_transactions', 'UPDATE')
    or has_table_privilege('anon', 'public.player_career_transactions', 'DELETE') or has_table_privilege('authenticated', 'public.player_career_transactions', 'INSERT')
    or has_table_privilege('authenticated', 'public.player_career_transactions', 'UPDATE') or has_table_privilege('authenticated', 'public.player_career_transactions', 'DELETE') as w`)
  assert.equal(w.w, false)
})

test('the view is the 053 text with only the multi-organization condition replaced, and the rollback carries the 053 text byte for byte', () => {
  const start = sql053.indexOf('create or replace view public.v_dodgers_development_research_queue')
  const end = sql053.indexOf('\n-- ===========================================================================\n-- 4. POSTCONDITIONS')
  const v053 = sql053.slice(start, end).replace(/\n+$/, '')
  assert.ok(rollback054.includes(v053))
  const old = fs.readFileSync(path.join(root, 'database/research/053/multi-org-detector.sql'), 'utf8').replace(/\n+$/, '')
  const detector = fs.readFileSync(path.join(root, 'database/research/054/multi-org-detector.sql'), 'utf8').replace(/\n+$/, '')
  assert.ok(sql054.includes(v053.replace(old, detector)))
})

test('the 054 checks catch what they guard: a Dodgers organization in career history, a mechanism with the wrong shape, an asset view reading career history', async () => {
  const fails = async (c) => failedChecks(await checkInvariants(c.query, CANONICAL_EXPECTATIONS)).map((f) => f.name)
  const a = await open(post054)
  try {
    await a.db.exec(`insert into public.player_career_transactions (event_key, player_id, transaction_date, transaction_type, from_organization_id, description, source_id, source_reference)
      select 'CAREER_20260521_RELEASE_LAD_NONE_EDGAR_LEON', p.id, date '2026-05-21', 'RELEASE', (select id from public.organizations where abbreviation = 'LAD'), 'test',
        (select id from public.sources limit 1), 'MLB transaction 1' from public.players p where p.slug = 'edgar-leon'`)
    assert.ok((await fails(a)).includes('career_transaction_dodgers_ledger_overlap_violations'))
  } finally { await a.close() }
  const b = await open(post054)
  try {
    await b.db.exec(`alter table public.player_career_transactions drop constraint player_career_transactions_shape_check;
      update public.player_career_transactions set to_organization_id = (select id from public.organizations where abbreviation = 'SFG') where event_key like 'CAREER_20250723_RELEASE_MIN_NONE_%'`)
    assert.ok((await fails(b)).includes('career_transaction_shape_violations'))
  } finally { await b.close() }
  const c = await open(post054)
  try {
    await c.db.exec(`create view public.v_test_leak with (security_invoker = true) as select player_id, transaction_date from public.player_career_transactions`)
    assert.ok((await fails(c)).includes('career_transaction_asset_leakage_violations'))
  } finally { await c.close() }
})

test('guards: 054 refuses a database holding career rows outside the reviewed set', async () => {
  const c = await open(post054)
  try {
    await c.db.exec(`insert into public.player_career_transactions (event_key, player_id, transaction_date, transaction_type, to_organization_id, description, source_id, source_reference)
      select 'CAREER_20250101_FREE_AGENT_SIGNING_NONE_SFG_TEST', p.id, date '2025-01-01', 'FREE_AGENT_SIGNING', (select id from public.organizations where abbreviation = 'SFG'), 'test',
        (select id from public.sources limit 1), 'MLB transaction 2' from public.players p where p.slug = 'diego-cartaya'`)
    await failsWith(c, sql054, /054: player_career_transactions holds 1 rows outside the reviewed set/)
    await failsWith(c, rollback054, /rollback-054: player_career_transactions holds 1 rows 054 did not write/)
  } finally { await c.close() }
})

test('rollback restores the exact pre-054 state (snapshots in a new generation with the same content); reapplying 054 reproduces the same content', async () => {
  const c = await open(post054)
  try {
    const first = await content(c)
    await c.db.exec(rollback054)
    const t = await tables(c)
    assert.deepEqual(Object.keys(t), Object.keys(preTables))
    for (const k of Object.keys(t)) if (!ALL_SNAPSHOT_TABLES.includes(k)) assert.deepEqual(t[k], preTables[k], k)
    assert.deepEqual(await content(c), preContent)
    assert.deepEqual(await surface(c), preSurface)
    assert.deepEqual(failedChecks(await checkInvariants(c.query, EXPECTATIONS_THROUGH_053)).map((f) => f.name), [])
    await failsWith(c, rollback054, /rollback-054: the 054 table or view is missing/)
    await c.db.exec(sql054)
    assert.deepEqual(await content(c), first)
    assert.deepEqual(failedChecks(await checkInvariants(c.query, CANONICAL_EXPECTATIONS)).map((f) => f.name), [])
  } finally { await c.close() }
})
