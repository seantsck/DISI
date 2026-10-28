// 053 (transaction and chronology resolution) over the exact database it was written for (the 052 chain): apply, rerun, the verifier at both
// boundaries, the ten Dodgers transactions as reviewed, the research-queue correction matching the pure rule, the dossier hotfix cases, the
// transaction and value queues, isolation from development facts, outcomes, WAR, costs and prediction, one coherent snapshot generation, security,
// the three 053 checks catching what they guard, and the exact rollback and reapply.
//   TEAM CHANGE != CANONICAL TRANSACTION   ORGANIZATION CHANGE != TRANSACTION TYPE   KNOWN EXIT DATE != KNOWN RETURN   RELEASE != TRADE
//   FREE-AGENT SIGNING != TRADE RETURN   UNKNOWN AMOUNT != ZERO   MISSING BWAR != ZERO BWAR   SOURCE SILENCE != RELEASE

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_053 as CANONICAL_EXPECTATIONS, EXPECTATIONS_THROUGH_052 } from '../../scripts/db/lib/invariants.mjs'
import { ALL_SNAPSHOT_TABLES } from '../../database/research/045b/snapshots.mjs'
import { DATASET_QUERIES, HISTORY_QUERIES, assembleDataset } from '../../lib/research/dataset.js'
import { developmentNeedSummary } from '../../lib/research/development-needs.js'
import { isBracketedSeason, multiOrganizationSeasons } from '../../lib/research/development-chronology.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '053_transaction_chronology_resolution.sql'
const sql053 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback053 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-053.sql'), 'utf8')
const sql052 = fs.readFileSync(path.join(root, 'database/sql/052_development_taxonomy_chronology_resolution.sql'), 'utf8')
const values = JSON.parse(fs.readFileSync(path.join(root, 'database/research/053/migration-values.json'), 'utf8'))
const KEYS = values.events.map((e) => e.key)

let chain
let pre053
let post053
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

/** every public base table, by content (surrogate ids kept: an exact restore must reproduce them) */
const tables = async (c) => {
  const names = (await c.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of names) out[t] = (await c.query(`select count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from public.${t} x`))[0]
  return out
}
/** the same, without surrogate ids, write timestamps or snapshot generation (what a reapply must reproduce, and what a refresh may renumber) */
const content = async (c) => {
  const names = (await c.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of names) {
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
  war: (await one(`select count(*)::int as n, md5(string_agg(w::text, '|' order by w.id::text)) as h from public.player_mlb_team_season_war w`, [], c)),
  expected: await one(`select (select supported_probability_targets from public.product_executive_snapshot) as targets,
    (select supported_expected_values from public.product_executive_snapshot) as evs, (select predictive_portfolio_recommendations from public.product_executive_snapshot) as recs`, [], c),
})
const dataset = async (c) => {
  /** @type {Record<string, any[]>} */
  const raw = {}
  for (const [k, sql] of Object.entries({ ...DATASET_QUERIES, ...HISTORY_QUERIES })) raw[k] = await c.query(sql)
  const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)
  for (const rows of Object.values(raw)) for (const r of rows) for (const k of Object.keys(r)) r[k] = iso(r[k])
  return assembleDataset(raw)
}
const queues = async (c) => ({
  transaction: await c.query(`select issue, event_key, asset_name, player_slug from public.v_transaction_research_queue order by 1, 2, 3, 4`),
  value: await c.query(`select issue, event_key, player_slug from public.v_value_research_queue order by 1, 2, 3`),
})
const seasons = (d, slug) => {
  const id = d.signings.find((s) => s.player_slug === slug).player_id
  return multiOrganizationSeasons(d.stints.filter((s) => s.player_id === id), d.transactions.filter((t) => t.player_id === id))
}

let preTables, preContent, preSurface, preIsolation, preQueues, preGeneration, preData
before(async () => {
  chain = await buildChainThrough('052_development_taxonomy_chronology_resolution.sql')
  pre053 = await chain.db.dumpDataDir('none')
  preTables = await tables(chain)
  preContent = await content(chain)
  preSurface = await surface(chain)
  preIsolation = await isolation(chain)
  preQueues = await queues(chain)
  preData = await dataset(chain)
  preGeneration = (await one(`select max(generation_id)::int as g from public.product_executive_snapshot`)).g
  await chain.db.exec(sql053)
  post053 = await chain.db.dumpDataDir('none')
}, { timeout: 900000 })
after(async () => { await chain?.close() })

test('053 follows 052 in the manifest, and its rollback exists', () => {
  const i = manifest.canonical_sql.indexOf(FILE)
  assert.equal(manifest.canonical_sql[i - 1], '052_development_taxonomy_chronology_resolution.sql')
  assert.equal(manifest.canonical_sql[i + 1], '054_full_career_transaction_history.sql')
  assert.equal(manifest.notes.canonical_build_count, manifest.canonical_sql.length)
  assert.match(rollback053, /^-- DISI rollback-053\.sql/)
})

test('verifier: 259/259 at the 052 boundary before 053 and at the 053 boundary after it; without the Leyritz pin the head fails exactly the identity check', async () => {
  const c = await open(pre053)
  try {
    const pre = await checkInvariants(c.query, EXPECTATIONS_THROUGH_052)
    assert.deepEqual(failedChecks(pre).map((f) => f.name), [])
    assert.equal(pre.hard.length, 259)
  } finally { await c.close() }
  const full = await checkInvariants(q, CANONICAL_EXPECTATIONS)
  assert.deepEqual(failedChecks(full).map((f) => f.name), [])
  assert.equal(full.hard.length, 259)
  // KNOWN TRANSACTION != KNOWN RETURN VALUE: Leyritz is accepted only by name on the pinned list, never by relaxing the rule
  const old = await checkInvariants(q, EXPECTATIONS_THROUGH_052)
  assert.deepEqual(failedChecks(old).map((f) => f.name), ['transaction_asset_identity_consistency_violations'])
})

test('rerunnable: applying 053 again changes nothing (no second refresh)', async () => {
  const c = await open(post053)
  try {
    const a = await tables(c)
    await c.db.exec(sql053)
    assert.deepEqual(await tables(c), a)
  } finally { await c.close() }
})

test('the ten Dodgers transactions are recorded exactly as reviewed, from the Dodgers side, with no amount and no invented return', async () => {
  const rows = await q(`select e.event_key, e.transaction_date::text as d, e.transaction_type as t, fo.abbreviation as f, coalesce(too.abbreviation, '') as tt,
      (select json_agg(json_build_object('side', a.asset_side, 'type', a.asset_type, 'name', a.asset_name, 'slug', p.slug, 'mlb', a.mlb_id, 'cash', a.cash_amount_usd,
        'cp', (select o.abbreviation from public.organizations o where o.id = a.counterparty_organization_id)) order by a.asset_side, a.asset_name)
       from public.transaction_event_assets a left join public.players p on p.id = a.player_id where a.event_id = e.id) as assets
    from public.transaction_events e join public.organizations fo on fo.id = e.from_organization_id left join public.organizations too on too.id = e.to_organization_id
    where e.event_key = any($1) order by e.transaction_date, e.event_key`, [KEYS])
  assert.equal(rows.length, 10)
  for (const r of rows) {
    const v = values.events.find((e) => e.key === r.event_key)
    assert.deepEqual([r.d, r.t, r.f, r.tt], [v.date, v.type, 'LAD', v.to], r.event_key)
    assert.equal(r.assets.length, v.assets.length, r.event_key)
    for (const a of r.assets) {
      const w = v.assets.find((x) => x.side === a.side && x.name === a.name)
      assert.ok(w, `${r.event_key}: ${a.name}`)
      assert.equal(a.slug ?? '', w.player_slug)
      assert.equal(a.cash, null, 'UNKNOWN AMOUNT != ZERO')
    }
  }
  const viz = rows.find((r) => r.event_key === 'LAD_NYY_2000_JOSE_VIZCAINO')
  assert.deepEqual(viz.assets.map((a) => [a.side, a.type, a.name, a.cp]), [['INCOMING', 'PLAYER', 'Jim Leyritz', 'NYY'], ['OUTGOING', 'CASH', 'Cash', 'NYY'], ['OUTGOING', 'PLAYER', 'Jose Vizcaino', 'NYY']])
  // the returned player's value is unknown, never zero
  const edge = await one(`select return_state, incoming_dodgers_bwar from public.v_trade_realization_edges where event_key = 'LAD_NYY_2000_JOSE_VIZCAINO' and incoming_asset_name = 'Jim Leyritz'`)
  assert.deepEqual([edge.return_state, edge.incoming_dodgers_bwar], ['RETURN_WAR_UNKNOWN', null])
  // nothing sealed, no source, no resolution
  for (const t of ['dodgers_control_observations', 'transaction_asset_resolutions', 'transaction_asset_timing_observations', 'sources', 'transactions']) {
    assert.deepEqual((await tables(chain))[t], preTables[t], `${t} must not change`)
  }
})

test('control intervals: each re-acquisition starts after the exit before it, and no interval overlaps another', async () => {
  const iv = await q(`select player_slug, interval_start::text as s, interval_end::text as e, start_method, exit_method from public.v_player_control_intervals
    where player_slug in ('pedro-baez', 'chan-ho-park', 'jose-vizcaino', 'omar-daal', 'juan-castro') order by 1, 2`)
  const by = (slug) => iv.filter((r) => r.player_slug === slug).map((r) => [r.s, r.e, r.start_method, r.exit_method])
  assert.deepEqual(by('pedro-baez').slice(1), [['2022-05-19', '2022-08-20', 'FREE_AGENT_SIGNING', 'RELEASE']])
  assert.deepEqual(by('chan-ho-park').slice(1), [['2008-01-20', '2008-11-01', 'FREE_AGENT_SIGNING', 'FREE_AGENCY']])
  assert.deepEqual(by('jose-vizcaino').slice(1), [['1997-12-08', '2000-06-20', 'FREE_AGENT_SIGNING', 'TRADE']])
  assert.deepEqual(by('omar-daal').slice(1), [['2001-11-09', '2002-10-28', 'TRADE_ACQUISITION', 'FREE_AGENCY']])
  assert.deepEqual(by('juan-castro').slice(1), [['2010-08-03', '2010-10-05', 'FREE_AGENT_SIGNING', 'FREE_AGENCY']])
  const leyritz = await one(`select interval_start::text as s, interval_end::text as e, exit_method from public.v_player_control_intervals where mlb_id = '117747'`)
  assert.deepEqual([leyritz.s, leyritz.e, leyritz.exit_method], ['2000-06-20', '2000-11-01', 'FREE_AGENCY'])
})

test('the corrected detector flags exactly the players the pure rule does; the Dodgers end of a move is a canonical transaction, a team change is not', async () => {
  const d = await dataset(chain)
  const ids = new Set(d.signings.map((s) => s.player_id))
  const by = new Map()
  for (const s of d.stints) by.set(s.player_id, [...(by.get(s.player_id) ?? []), s])
  const tx = new Map()
  for (const t of d.transactions) tx.set(t.player_id, [...(tx.get(t.player_id) ?? []), t])
  const sql = new Set(d.developmentQueue.filter((r) => r.issue === 'MULTI_ORG_SEASON_UNVERIFIED').map((r) => r.player_id))
  const js = new Set([...by].filter(([p, st]) => ids.has(p) && multiOrganizationSeasons(st, tx.get(p) ?? []).some((m) => !isBracketedSeason(m))).map(([p]) => p))
  assert.deepEqual([...sql].sort(), [...js].sort())
  const slug = new Map(d.signings.map((s) => [s.player_slug, s.player_id]))
  const state = (p, y) => seasons(d, p).find((m) => m.season === y)
  // the dossier hotfix cases: a trade recorded only as its PACKAGE_EVENT row brackets the season; a team change between two other clubs does not
  assert.equal(state('carlos-rincon', 2021).state, 'BRACKETED')
  assert.equal(state('carlos-santana', 2008).state, 'BRACKETED')
  assert.deepEqual([state('diego-cartaya', 2025).state, state('diego-cartaya', 2025).dodgers_involved, state('diego-cartaya', 2025).transaction], ['NO_CANONICAL_TRANSACTION', false, null])
  assert.ok(!sql.has(slug.get('carlos-rincon')))
  assert.ok(sql.has(slug.get('diego-cartaya')))
  // the Dodgers end of a move: a release (Leon, already recorded) and two signings (Baez, Castro, recorded by 053); a release is never a trade
  assert.deepEqual([state('edgar-leon', 2026).state, state('edgar-leon', 2026).transaction.type], ['BRACKETED_AT_DODGERS_BOUNDARY', 'RELEASE'])
  assert.deepEqual([state('pedro-baez', 2022).state, state('pedro-baez', 2022).transaction.type], ['BRACKETED_AT_DODGERS_BOUNDARY', 'FREE_AGENT_SIGNING'])
  assert.deepEqual([state('juan-castro', 2010).state, state('juan-castro', 2010).transaction.date], ['BRACKETED_AT_DODGERS_BOUNDARY', '2010-08-03'])
  assert.ok(!sql.has(slug.get('pedro-baez')) && !sql.has(slug.get('edgar-leon')))
  assert.ok(sql.has(slug.get('juan-castro')), 'Castro 2006 and 2008 are moves between other clubs and stay open')
  // a pre-game-log season with a recorded Dodgers trade is source-limited, not bracketed
  assert.equal(state('jose-vizcaino', 2000).state, 'TRANSACTION_RECORDED_DATES_BEFORE_GAME_LOGS')
  // the rest of the queue is untouched by the view change
  const s = developmentNeedSummary(d)
  assert.deepEqual([s.detector_rows, s.needs, s.players], [132, 108, 65])
  const issues = (rows) => rows.reduce((m, r) => ({ ...m, [r.issue]: (m[r.issue] ?? 0) + 1 }), {})
  const before = issues(preData.developmentQueue)
  const now = issues(d.developmentQueue)
  assert.equal(before.MULTI_ORG_SEASON_UNVERIFIED - now.MULTI_ORG_SEASON_UNVERIFIED, 2)
  for (const k of Object.keys(before)) if (k !== 'MULTI_ORG_SEASON_UNVERIFIED') assert.equal(now[k], before[k], k)
})

test('the dossier rule keeps every PACKAGE_EVENT row: dropping them would reopen the bracketed trades (the PR #27 regression)', async () => {
  const d = await dataset(chain)
  for (const [p, y] of [['carlos-rincon', 2021], ['carlos-santana', 2008]]) {
    const id = d.signings.find((s) => s.player_slug === p).player_id
    const st = d.stints.filter((s) => s.player_id === id)
    const all = d.transactions.filter((t) => t.player_id === id)
    const rows = await q(`select record_kind from public.v_player_transactions where player_slug = $1 and extract(year from transaction_date) = $2`, [p, y])
    assert.ok(rows.every((r) => r.record_kind === 'PACKAGE_EVENT'), `${p} ${y}: the trade exists only as its PACKAGE_EVENT row`)
    assert.equal(multiOrganizationSeasons(st, all).find((m) => m.season === y).state, 'BRACKETED')
    assert.equal(multiOrganizationSeasons(st, []).find((m) => m.season === y).state, 'NO_CANONICAL_TRANSACTION')
  }
})

test('transaction and value queues: three re-acquisitions close, every new open item is a stated unknown, and nothing reads as zero', async () => {
  const now = await queues(chain)
  const key = (r) => `${r.issue}|${r.event_key ?? ''}|${r.asset_name ?? ''}|${r.player_slug ?? ''}`
  const gone = preQueues.transaction.filter((r) => !now.transaction.some((x) => key(x) === key(r))).map(key).sort()
  const added = now.transaction.filter((r) => !preQueues.transaction.some((x) => key(x) === key(r))).map(key).sort()
  assert.deepEqual(gone, [
    'DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION|LAD_CHC_1990_VIZCAINO|José Vizcaíno|',
    'DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION|LAD_FA_2001_PARK|Chan Ho Park|',
    'DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION|LAD_MON_1995_DAAL|Omar Daal|',
  ])
  // the Vizcaino trade's cash moved with no stated amount; Castro's 2011 Dodgers season still has no recorded acquisition (his December 2010
  // signing is stated by the sources and deliberately not recorded), so the interval 053 adds reports it too
  assert.deepEqual(added, [
    'CASH_AMOUNT_UNKNOWN|LAD_NYY_2000_JOSE_VIZCAINO|Cash|',
    'DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION|LAD_FREE_AGENCY_2010_JUAN_CASTRO|Juan Castro|',
  ])
  const vgone = preQueues.value.filter((r) => !now.value.some((x) => key(x) === key(r)))
  const vadded = now.value.filter((r) => !preQueues.value.some((x) => key(x) === key(r))).map(key).sort()
  assert.deepEqual(vgone, [])
  assert.deepEqual(vadded, ['DOWNSTREAM_ASSET_CHAIN_INCOMPLETE|||jose-vizcaino', 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED|||jose-vizcaino'])
  const viz = await one(`select chain_status, realized_value_state, package_first_hop_participation_bwar from public.product_player_decision d join public.players p on p.id = d.player_id where p.slug = 'jose-vizcaino'`)
  assert.deepEqual([viz.chain_status, viz.realized_value_state, viz.package_first_hop_participation_bwar], ['INCOMPLETE_WAR_NOT_LOADED', 'TO_DATE_CHAIN_INCOMPLETE', null])
})

test('isolation: development facts, outcomes, WAR, costs, the feature matrix, support, evaluation, probabilities, expected values and recommendations are what 052 left', async () => {
  const now = await isolation(chain)
  assert.equal(md5(now), md5(preIsolation))
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

test('one coherent snapshot generation: +1, all eleven snapshots carry it, zero drift; only the decision snapshot changes content', async () => {
  const g = (await one(`select max(generation_id)::int as g from public.product_executive_snapshot`)).g
  assert.equal(g, preGeneration + 1)
  for (const t of ALL_SNAPSHOT_TABLES) assert.equal((await one(`select count(*) filter (where generation_id <> $1)::int as n from public.${t}`, [g])).n, 0, t)
  assert.deepEqual(await q(`select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`), [])
  const now = await content(chain)
  const changed = Object.keys(now).filter((t) => now[t].h !== preContent[t].h).sort()
  assert.deepEqual(changed, ['product_player_decision', 'transaction_event_assets', 'transaction_events'])
})

test('security: no relation, function, trigger, grant or policy is added; one view definition changes and keeps security_invoker and its grants', async () => {
  const now = await surface(chain)
  assert.deepEqual(now.relations, preSurface.relations)
  assert.deepEqual(now.functions, preSurface.functions)
  assert.deepEqual(now.policies, preSurface.policies)
  assert.deepEqual(now.triggers, preSurface.triggers)
  const changed = now.views.filter((v) => preSurface.views.find((x) => x.relname === v.relname).h !== v.h).map((v) => v.relname)
  assert.deepEqual(changed, ['v_dodgers_development_research_queue'])
  const opts = await one(`select array_to_string(reloptions, ',') as o from pg_class where oid = 'public.v_dodgers_development_research_queue'::regclass`)
  assert.match(opts.o, /security_invoker=true/)
  for (const t of ['transaction_events', 'transaction_event_assets']) {
    const r = await one(`select has_table_privilege('anon', 'public.${t}', 'INSERT') or has_table_privilege('anon', 'public.${t}', 'UPDATE') or has_table_privilege('anon', 'public.${t}', 'DELETE')
      or has_table_privilege('authenticated', 'public.${t}', 'INSERT') or has_table_privilege('authenticated', 'public.${t}', 'UPDATE') or has_table_privilege('authenticated', 'public.${t}', 'DELETE') as w`)
    assert.equal(r.w, false, t)
  }
})

test('the view is the 052 text with only the multi-organization condition replaced, and the rollback carries the 052 text byte for byte', () => {
  const start = sql052.indexOf('create or replace view public.v_dodgers_development_research_queue')
  const end = sql052.indexOf('\n-- ===========================================================================\n-- 8. POSTCONDITIONS')
  const v052 = sql052.slice(start, end).replace(/\n+$/, '')
  assert.ok(rollback053.includes(v052))
  const a = v052.indexOf('    -- 052: a season with two or more organizations stays a research need')
  const b = v052.indexOf(') as has_unverified_multi_org_season') + ') as has_unverified_multi_org_season'.length
  const detector = fs.readFileSync(path.join(root, 'database/research/053/multi-org-detector.sql'), 'utf8').replace(/\n+$/, '')
  assert.ok(sql053.includes(v052.slice(0, a) + detector + v052.slice(b)))
})

test('the 053 checks catch what they guard: a move between two other clubs, a signing with a trade shape, an acquisition without the exit before it', async () => {
  const fails = async (c) => failedChecks(await checkInvariants(c.query, CANONICAL_EXPECTATIONS)).map((f) => f.name)
  const a = await open(post053)
  try {
    await a.db.exec(`insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, to_organization_id, description, source_id, is_multi_team)
      select 'CIN_CLE_2019_PUIG_TEST', date '2019-07-31', 'TRADE', (select id from public.organizations where abbreviation = 'CIN'), (select id from public.organizations where abbreviation = 'CLE'),
        'test', (select id from public.sources limit 1), false`)
    assert.ok((await fails(a)).includes('transaction_ledger_side_violations'))
  } finally { await a.close() }
  const b = await open(post053)
  try {
    await b.db.exec(`update public.transaction_events set to_organization_id = (select id from public.organizations where abbreviation = 'HOU') where event_key = 'LAD_FREE_AGENT_SIGNING_2022_PEDRO_BAEZ'`)
    assert.ok((await fails(b)).includes('transaction_mechanism_shape_violations'))
  } finally { await b.close() }
  const c = await open(post053)
  try {
    // a signing with no recorded exit before it (Castro, 2005): his 1991 interval would now overlap it
    await c.db.exec(`insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, description, source_id, is_multi_team)
      select 'LAD_TEST_2005_CASTRO', date '2005-01-10', 'FREE_AGENT_SIGNING', (select id from public.organizations where abbreviation = 'LAD'), 'test', (select id from public.sources limit 1), false`)
    await c.db.exec(`insert into public.transaction_event_assets (event_id, asset_side, player_id, asset_name, asset_type, mlb_id)
      select e.id, 'INCOMING', p.id, 'Juan Castro', 'PLAYER', '112128' from public.transaction_events e, public.players p where e.event_key = 'LAD_TEST_2005_CASTRO' and p.slug = 'juan-castro'`)
    assert.ok((await fails(c)).includes('control_interval_overlap_violations'))
  } finally { await c.close() }
})

test('guards: 053 refuses an event key that already holds another transaction, and a returned player already recorded elsewhere', async () => {
  const c = await open(pre053)
  try {
    await c.db.exec(`insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, description, source_id, is_multi_team)
      select 'LAD_FREE_AGENT_SIGNING_2022_PEDRO_BAEZ', date '2022-06-01', 'FREE_AGENT_SIGNING', (select id from public.organizations where abbreviation = 'LAD'), 'other', (select id from public.sources limit 1), false`)
    await failsWith(c, sql053, /053: the event key LAD_FREE_AGENT_SIGNING_2022_PEDRO_BAEZ already holds a different transaction/)
  } finally { await c.close() }
  const d = await open(pre053)
  try {
    // a returned player already recorded in another transaction
    await d.db.exec(`insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, description, source_id, is_multi_team)
      select 'LAD_TEST_LEYRITZ', date '2000-12-01', 'FREE_AGENT_SIGNING', (select id from public.organizations where abbreviation = 'LAD'), 'other', (select id from public.sources limit 1), false`)
    await d.db.exec(`insert into public.transaction_event_assets (event_id, asset_side, asset_name, asset_type, mlb_id)
      select id, 'INCOMING', 'Jim Leyritz', 'PLAYER', '117747' from public.transaction_events where event_key = 'LAD_TEST_LEYRITZ'`)
    await failsWith(d, sql053, /053: a reviewed non-DISI player is already recorded in another transaction/)
  } finally { await d.close() }
})

test('rollback restores the exact pre-053 state (snapshots in a new generation with the same content); reapplying 053 reproduces the same content', async () => {
  const c = await open(post053)
  try {
    const first = await content(c)
    await c.db.exec(rollback053)
    const t = await tables(c)
    for (const k of Object.keys(t)) if (!ALL_SNAPSHOT_TABLES.includes(k)) assert.deepEqual(t[k], preTables[k], k)
    assert.deepEqual(await content(c), preContent)
    assert.deepEqual(await surface(c), preSurface)
    assert.deepEqual(failedChecks(await checkInvariants(c.query, EXPECTATIONS_THROUGH_052)).map((f) => f.name), [])
    // a second rollback refuses
    await failsWith(c, rollback053, /rollback-053: the research queue is not the 053 view/)
    await c.db.exec(sql053)
    assert.deepEqual(await content(c), first)
    assert.deepEqual(failedChecks(await checkInvariants(c.query, CANONICAL_EXPECTATIONS)).map((f) => f.name), [])
  } finally { await c.close() }
})

test('the rollback refuses when later research depends on a 053 asset', async () => {
  const c = await open(post053)
  try {
    await c.db.exec(`insert into public.dodgers_control_observations (subject_asset_id, observation_type, observed_through_date, source_id, confidence)
      select a.id, 'DODGERS_CONTROL_OBSERVED', date '2000-09-01', (select id from public.sources limit 1), 'HIGH' from public.transaction_event_assets a
      join public.transaction_events e on e.id = a.event_id where e.event_key = 'LAD_NYY_2000_JOSE_VIZCAINO' and a.asset_name = 'Jim Leyritz'`)
    await failsWith(c, rollback053, /rollback-053: later research depends on the event LAD_NYY_2000_JOSE_VIZCAINO/)
  } finally { await c.close() }
})
