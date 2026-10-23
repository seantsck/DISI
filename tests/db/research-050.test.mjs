// Migration 050: the mature international benchmark expansion and the probability-support audit. The 049 database is built (001-049), 050 is
// applied for real, and the tests prove that a ranked list member becomes a benchmark signing only with a verified signing and identity, that a
// listed Dodgers signing is never duplicated, that the signing year (not the list year) drives the fixed horizons, that missing bWAR is never
// zero, that a benchmark baseline that crosses support never reaches a Dodgers probability, the executive overview, an expected value or a
// recommendation, that the stored evaluation is re-run and current, and that 050 is idempotent, guarded, reproducible and reversible.
//   RANKING APPEARANCE != NEW SIGNING   RANKING CLASS YEAR != SIGNING YEAR   SOURCE LIST MEMBERSHIP != VERIFIED SIGNING
//   NOT_AUDITED != AUDITED_NO_MLB   UNKNOWN BWAR != ZERO BWAR   RANKED PROSPECT SAMPLE != LEAGUE CENSUS   BENCHMARK SUPPORT != DODGERS SUPPORT

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_051, EXPECTATIONS_THROUGH_049 } from '../../scripts/db/lib/invariants.mjs'
import { measure } from '../../database/research/050/measure.mjs'
import { assemble, assembleRollback, research } from '../../database/research/050/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sql050 = fs.readFileSync(path.join(root, 'database/sql/050_international_benchmark_support_expansion.sql'), 'utf8')
const rollback050 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-050.sql'), 'utf8')
const evaluation = JSON.parse(fs.readFileSync(path.join(root, 'database/research/050/evaluation.json'), 'utf8'))
const evaluation041 = JSON.parse(fs.readFileSync(path.join(root, 'database/research/041/evaluation.json'), 'utf8'))
const DODGERS = 'DODGERS_TRACKED_AND_OPENING_CLASS'
const BENCH = 'TOP_PROSPECT_SAMPLE'

let chain
let pre050Dump
let pre
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
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
const tableHashes = async (c = chain) => {
  const tables = R(await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5(R(await c.query(`select (to_jsonb(t) - 'updated_at')::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const label = async (slug, target, c = chain) => (await c.query(`select label, training_state, exposure_complete, horizon_end_season, signing_year, reference_population
  from public.v_outcome_training_population where player_slug = $1 and target_key = $2`, [slug, target]))[0]
const slugOf = (name) => research.newPlayers.find((p) => p.full_name === name)?.slug

before(async () => {
  chain = await buildChainThrough('049_transaction_package_completion.sql')
  pre050Dump = await chain.db.dumpDataDir('none')
  pre = await measure(q)
  await chain.db.exec(sql050)
}, { timeout: 900000 })

after(async () => { await chain?.close() })

test('baseline: the 050 research was written against exactly this pre-050 state', () => {
  const b = JSON.parse(fs.readFileSync(path.join(root, 'database/research/050/baseline.json'), 'utf8'))
  assert.deepEqual(pre.counts, b.counts)
  assert.deepEqual(pre.support, b.support)
  assert.equal(pre.executive_overview_body_md5, b.executive_overview_body_md5)
  assert.equal(pre.refresh_function_body_md5, b.refresh_function_body_md5)
  assert.equal(pre.evaluation.every((e) => e.evaluation_current && e.training_fingerprint === evaluation041.fingerprint), true, 'the 041 evaluation is the stored, current one before 050')
})

test('data only: no table, view, function, grant, policy or trigger is added; one function statement each is the only definition change', async () => {
  const c = await clone(pre050Dump)
  try {
    const cat = async (x) => ({
      rel: await x.query(`select relname, relkind, coalesce(relacl::text, '') as acl, relrowsecurity as rls from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v') order by 1`),
      fn: await x.query(`select p.oid::regprocedure::text as f, coalesce(p.proacl::text, '') as acl, p.prosecdef, p.provolatile from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
      pol: await x.query(`select tablename, policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' order by 1, 2`),
      trg: await x.query(`select c.relname, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
    })
    assert.deepEqual(await cat(chain), await cat(c), 'relations, ACLs, RLS, functions (signature, ACL, security, volatility), policies and triggers are unchanged')
    const bodies = async (x) => Object.fromEntries((await x.query(`select proname, md5(prosrc) as h from pg_proc where pronamespace = 'public'::regnamespace`)).map((r) => [r.proname, r.h]))
    const [a, b] = [await bodies(c), await bodies(chain)]
    assert.deepEqual(Object.keys(a).filter((k) => a[k] !== b[k]).sort(), ['disi_executive_overview', 'disi_refresh_product_snapshots'])
  } finally { await c.close() }
})

test('membership: a listed player becomes a benchmark signing only with a verified signing; unresolved members are queued, never added', async () => {
  const m = await measure(q)
  assert.equal(m.counts.players - pre.counts.players, 54)
  assert.equal(m.counts.benchmark_signings - pre.counts.benchmark_signings, 54)
  const pops = await q(`select population_key, population_scope, expected_size, rate_analysis_suitable, stated_composition from public.signing_populations where population_key in ('MLB-2015-PIPELINE-TOP30', 'MLB-2016-PIPELINE-TOP30') order by 1`)
  assert.deepEqual(pops.map((p) => [p.population_key, p.population_scope, p.expected_size, p.rate_analysis_suitable]),
    [['MLB-2015-PIPELINE-TOP30', 'TOP_PROSPECT_SAMPLE', 30, false], ['MLB-2016-PIPELINE-TOP30', 'TOP_PROSPECT_SAMPLE', 30, false]])
  // 2015: 30 listed = 27 benchmark signings + 2 Dodgers signings + 1 unresolved; 2016: 30 = 27 + 3 whose route is not established
  const [p15, p16] = pops.map((p) => p.stated_composition)
  assert.equal(p15.benchmark_signings, 27); assert.equal(p15.dodgers_signings_mapped.length, 2); assert.equal(p15.identity_unresolved.length, 1)
  assert.equal(p16.benchmark_signings, 27); assert.equal(p16.route_not_established.length, 3)
  for (const p of [p15, p16]) {
    assert.equal(p.benchmark_signings + p.dodgers_signings_mapped.length + p.identity_unresolved.length + p.identity_conflicts.length + p.route_not_established.length, p.list_members,
      'every listed player has exactly one decision; none is silently dropped')
  }
  const members = await q(`select sp.population_key, count(*)::int as n from public.signing_population_members m join public.signing_populations sp on sp.id = m.population_id
    where sp.population_key in ('MLB-2015-PIPELINE-TOP30', 'MLB-2016-PIPELINE-TOP30') group by 1 order by 1`)
  assert.deepEqual(members.map((r) => r.n), [27, 27])
  // the not-added members do not exist as players
  for (const name of ['Christopher Martinez', 'Lazaro Armenteros', 'Yanio Perez', 'Jonathan Machado']) {
    assert.equal((await one(`select count(*)::int as n from public.players where public.disi_ascii_fold(full_name) ilike public.disi_ascii_fold($1)`, [name])).n, 0, `${name} is queued, not added`)
  }
  const notTracked = (await q(`select population_key, detail from public.v_international_benchmark_research_queue where issue = 'POPULATION_MEMBERS_NOT_TRACKED' and population_key like 'MLB-201%-PIPELINE-TOP30' order by 1`))
  assert.deepEqual(notTracked.map((r) => r.population_key), ['MLB-2013-PIPELINE-TOP30', 'MLB-2014-PIPELINE-TOP30', 'MLB-2015-PIPELINE-TOP30', 'MLB-2016-PIPELINE-TOP30'],
    'each list names members DISI does not track as benchmark rows, and says so')
  assert.match(notTracked[2].detail, /names 30 members; 27 are tracked/)
})

test('no duplicate Dodgers players: the two listed Dodgers signings stay one Dodgers signing each, untouched, with no benchmark copy', async () => {
  for (const slug of ['starling-heredia', 'ronny-brito']) {
    const r = await one(`select count(*)::int as signings, count(*) filter (where s.record_scope = 'TRACKED_DODGERS')::int as dodgers, count(*) filter (where s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')::int as benchmark
      from public.signings s join public.players p on p.id = s.player_id where p.slug = $1`, [slug])
    assert.deepEqual(r, { signings: 1, dodgers: 1, benchmark: 0 })
    assert.equal((await one(`select count(*)::int as n from public.players where mlb_id = (select mlb_id from public.players where slug = $1)`, [slug])).n, 1)
  }
  assert.equal((await one(`select count(*)::int as n from public.players p where exists (select 1 from public.signings s join public.organizations o on o.id = s.organization_id where s.player_id = p.id and o.franchise_key = 'DODGERS')
    and exists (select 1 from public.signings s where s.player_id = p.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')`)).n, 0)
  const m = await measure(q)
  for (const k of ['dodgers_players', 'dodgers_signings', 'dodgers_audits', 'dodgers_verified_mlb', 'dodgers_verified_no_mlb', 'dodgers_not_audited', 'known_costs', 'known_spend_usd', 'open_research_tasks', 'stints', 'milestones', 'transaction_events', 'transaction_assets', 'war_rows']) {
    assert.equal(m.counts[k], pre.counts[k], `${k} does not move`)
  }
  assert.deepEqual([m.counts.dodgers_signings, m.counts.dodgers_audits, m.counts.dodgers_verified_mlb, m.counts.dodgers_verified_no_mlb, m.counts.dodgers_not_audited, m.counts.known_costs, m.counts.known_spend_usd],
    [220, 93, 47, 46, 127, 56, '121700237.33'])
  for (const k of ['dodgers_signings_hash', 'dodgers_audits_hash', 'war_hash', 'financial_reports_hash', 'transactions_hash', 'development_hash']) assert.equal(m.hashes[k], pre.hashes[k], `${k} is byte-identical`)
})

test('one identity per person: a ranked player is one player with one signing, whatever list he appears on', async () => {
  assert.equal((await one(`select count(*)::int as n from (select mlb_id from public.players where mlb_id is not null group by 1 having count(*) > 1) x`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from (select s.player_id from public.signings s where s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT' group by 1 having count(*) > 1) x`)).n, 0)
  // every benchmark row carries exactly one active MLB Pipeline international ranking equal to its signing rank
  assert.equal((await one(`select count(*)::int as n from public.signings s join public.players p on p.id = s.player_id
    where s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT' and p.slug = any($1::text[])
      and (select count(*) from public.player_evaluations e join public.player_evaluation_rankings r on r.evaluation_id = e.id
           where e.player_id = s.player_id and e.record_status = 'ACTIVE' and r.ranking_scope = 'INTERNATIONAL_CLASS' and r.rank = s.international_rank::int) <> 1`,
    [research.newPlayers.map((p) => p.slug)])).n, 0)
})

test('identity: legacy names are not rewritten; the published spelling is kept as an alias; the five legacy gaps are reported one by one', async () => {
  const legacy = Object.fromEntries((await q(`select p.slug, p.full_name, p.mlb_id::text as mlb_id, a.reached_mlb_verified as reached, a.outcome_state
    from public.players p left join public.outcome_audits a on a.player_id = p.id
    where p.slug in ('emmanuel-dejesus', 'micker-zapata', 'yeyson-yrizarry', 'yeremy-rosario', 'jonathan-amundaray')`)).map((r) => [r.slug, r]))
  assert.deepEqual(legacy['emmanuel-dejesus'], { slug: 'emmanuel-dejesus', full_name: 'Emmanuel DeJesus', mlb_id: '646241', reached: true, outcome_state: 'REACHED_MLB' })
  assert.deepEqual(legacy['micker-zapata'], { slug: 'micker-zapata', full_name: 'Micker Zapata', mlb_id: '650520', reached: false, outcome_state: 'NO_MLB_STATUS_UNKNOWN' })
  for (const s of ['yeyson-yrizarry', 'yeremy-rosario', 'jonathan-amundaray']) {
    assert.equal(legacy[s].mlb_id, null, `${s} stays identity-unresolved`)
    assert.equal(legacy[s].reached, null, `${s} is unaudited, never no-MLB`)
  }
  const aliases = (await q(`select p.slug, a.alias, a.alias_type from public.player_aliases a join public.players p on p.id = a.player_id where p.slug in ('emmanuel-dejesus', 'micker-zapata') order by 1`))
  assert.deepEqual(aliases.map((a) => [a.slug, a.alias, a.alias_type]), [['emmanuel-dejesus', 'Enmanuel De Jesus', 'MLB_RECORD_NAME'], ['micker-zapata', 'Micker Adolfo', 'MLB_RECORD_NAME']])
  // the Yrizarry disagreement keeps the stored tracker country
  assert.equal((await one(`select s.country_market from public.signings s join public.players p on p.id = s.player_id where p.slug = 'yeyson-yrizarry'`)).country_market, 'Dominican Republic')
  // a new player is named as the MLB record names him; the list's own spelling is an alias
  const published = research.newPlayers.filter((p) => p.alias)
  assert.ok(published.length >= 1)
  for (const p of published) {
    assert.ok((await one(`select count(*)::int as n from public.player_aliases a join public.players pl on pl.id = a.player_id where pl.slug = $1 and a.alias = $2 and a.alias_type = 'PUBLISHED_SPELLING'`, [p.slug, p.alias])).n === 1, `${p.slug} keeps "${p.alias}"`)
  }
  const queue = await q(`select player_slug from public.v_international_benchmark_research_queue where issue = 'BENCHMARK_IDENTITY_UNRESOLVED' order by 1`)
  assert.deepEqual(queue.map((r) => r.player_slug), ['jonathan-amundaray', 'yeremy-rosario', 'yeyson-yrizarry'])
})

test('horizons: the official signing year, not the list year, decides censoring; a late debut is FALSE for the target without rewriting the career outcome', async () => {
  // Luis Robert Jr. is on the 2016 list and signed on 2017-05-27: signing_year 2017, so his 10-season horizon (2027) has not elapsed
  const robert = await one(`select s.signing_year, s.signing_date::text as d from public.signings s join public.players p on p.id = s.player_id where p.mlb_id = 673357`)
  assert.deepEqual(robert, { signing_year: 2017, d: '2017-05-27' })
  const rb = await label(slugOf('Luis Robert Jr.'), 'POSITIVE_BWAR_WITHIN_10_SEASONS')
  assert.equal(rb.exposure_complete, false); assert.equal(rb.horizon_end_season, 2027); assert.equal(rb.label, null)
  // a 2016 signing is exposed for the 10-season target (2026 <= 2026)
  const garcia = await label(slugOf('Luis García Jr.'), 'POSITIVE_BWAR_WITHIN_10_SEASONS')
  assert.equal(garcia.signing_year, 2016); assert.equal(garcia.exposure_complete, true)
  // Miguel Amaya signed in 2015 and debuted in 2023 (eight seasons): REACH within 7 is FALSE, while his outcome audit stays REACHED_MLB
  const amaya = await label(slugOf('Miguel Amaya'), 'REACH_MLB_WITHIN_7_SEASONS')
  assert.equal(amaya.label, false)
  assert.equal((await one(`select a.outcome_state from public.outcome_audits a join public.players p on p.id = a.player_id where p.mlb_id = 665804`)).outcome_state, 'REACHED_MLB')
  // an unaudited (identity-unresolved) row never becomes false
  for (const s of ['yeyson-yrizarry', 'yeremy-rosario', 'jonathan-amundaray']) {
    const r = await label(s, 'REACH_MLB_WITHIN_7_SEASONS')
    assert.equal(r.label, null); assert.equal(r.training_state, 'OUTCOME_UNAUDITED')
  }
  // no label is written by the migration: the targets and their rules are byte-identical, so every label is the 041 view's own
  const c = await clone(pre050Dump)
  try {
    const targets = async (x) => md5(await x.query(`select * from public.outcome_targets order by target_key`))
    assert.equal(await targets(c), await targets(chain))
    assert.doesNotMatch(sql050, /(insert into|update) public\.outcome_targets/)
  } finally { await c.close() }
})

test('bWAR: a reacher without loaded rows has a NULL bWAR label; an audited non-reacher is FALSE without WAR; fWAR cannot satisfy it; WAR outside the window never leaks', async () => {
  const soto = slugOf('Juan Soto')
  assert.equal((await label(soto, 'REACH_MLB_WITHIN_7_SEASONS')).label, true)
  const s = await label(soto, 'POSITIVE_BWAR_WITHIN_10_SEASONS')
  assert.equal(s.label, null, 'missing bWAR is not zero bWAR'); assert.equal(s.training_state, 'OUTCOME_UNAUDITED')
  assert.equal((await one(`select career_war from public.outcomes o join public.players p on p.id = o.player_id where p.slug = $1`, [soto])).career_war, null)
  const ortiz = slugOf('Jhailyn Ortiz')
  assert.equal((await label(ortiz, 'POSITIVE_BWAR_WITHIN_10_SEASONS')).label, false, 'an audited no-MLB player is FALSE without any WAR')
  assert.equal((await one(`select count(*)::int as n from public.outcomes o join public.players p on p.id = o.player_id where p.slug = any($1::text[]) and o.career_war is not null`,
    [research.newPlayers.map((p) => p.slug)])).n, 0)
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    const src = (await c.query(`select id from public.sources where url ilike '%baseball-reference.com%' limit 1`))[0].id
    const org = (await c.query(`select organization_id as id from public.bref_team_code_map where bref_team_code = 'WSN' order by from_season desc limit 1`))[0]?.id
      ?? (await c.query(`select id from public.organizations where abbreviation = 'WSH'`))[0].id
    const bref = (await c.query(`select bref_id from public.players where slug = $1`, [soto]))[0].bref_id
    assert.ok(bref, 'the reacher carries his Baseball-Reference id (register crosswalk)')
    const row = (season, war, system = "'BWAR'") => `insert into public.player_mlb_team_season_war (bref_id, mlb_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games, league, war_system, source_id, observed_through_date, observed_through_season, retrieved_at, confidence)
      values ('${bref}', '665742', ${season}, 'WSN', '${org}', 1, 'BAT', ${war}, 10, 'NL', ${system}, '${src}', date '2026-10-01', 2026, now(), 'VERIFIED')`
    await failsWith(c, row(2018, 5.0, "'FWAR'"), /war_system_check/)
    // a season outside the 2015 + 10 window does not count
    await c.db.exec(row(2026, 9.9))
    assert.equal((await label(soto, 'POSITIVE_BWAR_WITHIN_10_SEASONS', c)).label, null, 'a 2026 season is outside the 2025 horizon and never makes a label')
    // a season inside the window does, by the unchanged 041 rule
    await c.db.exec(row(2018, 3.5))
    assert.equal((await label(soto, 'POSITIVE_BWAR_WITHIN_10_SEASONS', c)).label, true)
  } finally { await c.close() }
})

test('population separation: the benchmark reach target crosses support naturally; the Dodgers population does not move and nothing reaches a Dodgers player', async () => {
  const sup = Object.fromEntries((await q(`select target_key || '/' || reference_population as k, labelled_n, positive_n, negative_n, support_state from public.v_outcome_target_support`)).map((r) => [r.k, r]))
  assert.deepEqual(sup[`REACH_MLB_WITHIN_7_SEASONS/${BENCH}`], { k: `REACH_MLB_WITHIN_7_SEASONS/${BENCH}`, labelled_n: 90, positive_n: 19, negative_n: 71, support_state: 'BASELINE_SUPPORTED' })
  for (const t of ['POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS']) assert.equal(sup[`${t}/${BENCH}`].support_state, 'BASELINE_NOT_SUPPORTED')
  for (const r of pre.support.filter((x) => x.reference_population === DODGERS)) {
    const now = sup[`${r.target_key}/${DODGERS}`]
    assert.deepEqual([now.labelled_n, now.positive_n, now.negative_n, now.support_state], [r.labelled_n, r.positive_n, r.negative_n, r.support_state], `${r.target_key}: Dodgers support is unchanged by the benchmark`)
  }
  const prob = await one(`select count(probability)::int as nn, count(*) filter (where prediction_eligible)::int as eligible,
    count(*) filter (where training_population = '${DODGERS}' and prediction_exclusion_reason = 'REFERENCE_POPULATION_NOT_SUPPORTED')::int as dodgers_open
    from public.v_player_outcome_probability`)
  assert.equal(prob.nn, 0); assert.equal(prob.eligible, 0)
  assert.ok(prob.dodgers_open > 0, 'open Dodgers rows keep their reason: their own population is not supported')
  // a benchmark row never gets a probability, even for the supported target
  assert.equal((await one(`select count(*)::int as n from public.v_player_outcome_probability where training_population = '${BENCH}' and target_key = 'REACH_MLB_WITHIN_7_SEASONS' and probability is not null`)).n, 0)
  const o = await one(`select supported_probability_targets, non_null_probabilities, supported_expected_value_models, predictive_portfolio_recommendations, prediction_readiness_state from public.v_executive_overview`)
  assert.deepEqual(o, { supported_probability_targets: 0, non_null_probabilities: 0, supported_expected_value_models: 0, predictive_portfolio_recommendations: 0, prediction_readiness_state: 'NO_SUPPORTED_PROBABILITY_TARGET' })
  assert.equal((await one(`select support_chain_state from public.v_disi_release_status`)).support_chain_state, 'NO_PREDICTIVE_LAYER_SUPPORTED')
  assert.equal((await one(`select count(*) filter (where probability_supported or expected_value_supported)::int as n from public.v_expected_value_support`)).n, 0)
})

test('the pooled-count regression: with the 044 definition the overview would claim published probabilities while none exist; 050 fixes it', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    const f044 = fs.readFileSync(path.join(root, 'database/sql/044_executive_product.sql'), 'utf8')
    const start = f044.indexOf('create or replace function public.disi_executive_overview()')
    await c.db.exec(f044.slice(start, f044.indexOf('$fn$;', start) + 5))
    const bad = (await c.query(`select supported_probability_targets, non_null_probabilities, prediction_readiness_state from public.v_executive_overview`))[0]
    assert.deepEqual(bad, { supported_probability_targets: 1, non_null_probabilities: 0, prediction_readiness_state: 'PROBABILITIES_PUBLISHED_FOR_SUPPORTED_TARGETS' },
      'the old definition pools populations: a benchmark-only baseline would be reported as a published probability target')
    const report = await checkInvariants(async (s) => (await c.db.query(s)).rows)
    assert.ok(failedChecks(report).some((f) => f.name === 'executive_support_propagation_violations'), 'the verifier catches the pooled count')
  } finally { await c.close() }
})

test('thresholds: unchanged; support is >= at exactly the minimums, and recomputes deterministically', async () => {
  const t = await q(`select target_key, min_reference_n, min_positives, min_negatives, events_per_feature from public.outcome_targets order by 1`)
  for (const r of t) assert.deepEqual([r.min_reference_n, r.min_positives, r.min_negatives, r.events_per_feature], [50, 10, 10, 10], `${r.target_key}: thresholds are not lowered`)
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    // the database itself refuses a lowered minimum
    await failsWith(c, `update public.outcome_targets set min_positives = 7 where target_key = 'POSITIVE_BWAR_WITHIN_10_SEASONS'`, /outcome_targets_min_positives_check/)
    // REACH in the benchmark: 90 labelled, 19 positive, 71 negative. Raised to exactly 90 / 19 / 71 it is still supported (>=); one more needed is not.
    const s = async () => (await c.query(`select support_state from public.v_outcome_target_support where target_key = 'REACH_MLB_WITHIN_7_SEASONS' and reference_population = '${BENCH}'`))[0].support_state
    await c.db.exec(`update public.outcome_targets set min_reference_n = 90, min_positives = 19, min_negatives = 71 where target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)
    assert.equal(await s(), 'BASELINE_SUPPORTED')
    await c.db.exec(`update public.outcome_targets set min_positives = 20 where target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)
    assert.equal(await s(), 'BASELINE_NOT_SUPPORTED')
    await c.db.exec(`update public.outcome_targets set min_positives = 19, min_negatives = 72 where target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)
    assert.equal(await s(), 'BASELINE_NOT_SUPPORTED')
  } finally { await c.close() }
  assert.equal(md5(await q(`select * from public.v_outcome_target_support order by 1, 4`)), md5(await q(`select * from public.v_outcome_target_support order by 1, 4`)))
})

test('evaluation: re-run on the 050 data, current, a new fingerprint, no leakage, and the model decision is the evaluation, not the reference threshold', async () => {
  const ev = await q(`select model_key, evaluated_rows, positive_n, folds, decision, training_fingerprint, evaluation_current, brier_score::float8 as brier from public.v_outcome_model_evaluation order by model_key`)
  assert.ok(ev.every((e) => e.evaluation_current), 'the stored evaluation describes the live training set')
  assert.ok(ev.every((e) => e.training_fingerprint === evaluation.fingerprint && e.training_fingerprint !== evaluation041.fingerprint))
  assert.deepEqual(ev.map((e) => [e.model_key, e.evaluated_rows, e.positive_n, e.folds, e.decision]),
    [['BASE_RATE', 101, 19, 6, 'BASELINE_REFERENCE'], ['LOGISTIC_L2', 101, 19, 6, 'MODEL_NOT_SUPPORTED'], ['POPULATION_STRATIFIED_RATE', 101, 19, 6, 'MODEL_NOT_SUPPORTED']])
  // same targets, features, models and validation as 041
  const by = Object.fromEntries(evaluation.evaluations.map((e) => [e.model_key, e]))
  for (const e of evaluation041.evaluations) {
    assert.deepEqual([by[e.model_key].feature_list, by[e.model_key].training_populations, by[e.model_key].validation_method, by[e.model_key].target_key],
      [e.feature_list, e.training_populations, e.validation_method, e.target_key])
  }
  assert.ok(by.LOGISTIC_L2.brier_skill_vs_base_rate < 0 && by.POPULATION_STRATIFIED_RATE.brier_skill_vs_base_rate < 0, 'no fitted model beats the base rate out of time')
  // a supported reference baseline does not make a model supported
  assert.equal((await one(`select count(*) filter (where model_support_state = 'MODEL_SUPPORTED')::int as n from public.v_player_outcome_probability where target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)).n, 0)
  assert.equal((await q(`select issue from public.v_outcome_probability_research_queue where issue = 'MODEL_EVALUATION_STALE'`)).length, 0)
  // leakage: flipping every outcome and deleting every stint leaves the feature matrix byte-identical
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    const fm = async () => md5(await c.query(`select * from public.v_outcome_feature_matrix order by signing_id`))
    const before = await fm()
    await c.db.exec(`update public.outcome_audits set reached_mlb_verified = not reached_mlb_verified, outcome_state = null; delete from public.player_season_stints;`)
    assert.equal(await fm(), before)
  } finally { await c.close() }
})

test('product: snapshots move to one generation with zero drift; readiness shows the benchmark row separately from the Dodgers rows', async () => {
  const gens = await q(`select distinct generation_id::text as g from public.product_executive_snapshot union select distinct generation_id::text from public.product_prediction_readiness`)
  assert.equal(gens.length, 1)
  assert.equal(Number(gens[0].g), Number(pre.counts.snapshot_generation) + 1)
  assert.deepEqual(await q(`select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`), [])
  const r = Object.fromEntries((await q(`select target_key || '/' || reference_population as k, readiness_state from public.product_prediction_readiness`)).map((x) => [x.k, x.readiness_state]))
  assert.equal(r[`REACH_MLB_WITHIN_7_SEASONS/${BENCH}`], 'SUPPORTED')
  assert.ok(Object.entries(r).filter(([k]) => k.endsWith(DODGERS)).every(([, v]) => v === 'NOT_SUPPORTED'))
  assert.equal((await one(`select supported_probability_targets from public.product_executive_snapshot`)).supported_probability_targets, 0)
  // the League Benchmark coverage ledger lists the two new samples as samples, never censuses
  const cov = await q(`select period_start_year, coverage_type, expected_signings, tracked_signings from public.v_signing_data_coverage where coverage_type = 'TOP_PROSPECT_SAMPLE' order by 1`)
  assert.deepEqual(cov.map((x) => [x.period_start_year, x.expected_signings, x.tracked_signings]), [[2013, 30, 20], [2014, 30, 28], [2015, 30, 27], [2016, 30, 27]])
})

test('verifier: 252/252 at the 050 head (051 and 052 add read-only checks), the frozen 049 pins fail as they should, and the isolation check is part of the count', async () => {
  const full = await checkInvariants(q, EXPECTATIONS_THROUGH_051)
  assert.deepEqual(failedChecks(full).map((f) => f.name), [])
  assert.equal(full.hard.length, 252)
  assert.ok(full.hard.some((h) => h.name === 'outcome_population_isolation_violations' && h.pass))
  const old = await checkInvariants(q, EXPECTATIONS_THROUGH_049)
  assert.deepEqual(failedChecks(old).map((f) => f.name).sort(), ['league_benchmark_players', 'player_evaluations', 'players_total', 'scouting_legacy_ranks_backfilled', 'scouting_legacy_ranks_total'])
})

test('idempotent: a rerun adds nothing, runs no second refresh and changes no table', async () => {
  const before = await tableHashes()
  const gen = (await one(`select max(generation_id)::text as g from public.product_executive_snapshot`)).g
  await chain.db.exec(sql050)
  assert.deepEqual(await tableHashes(), before)
  assert.equal((await one(`select max(generation_id)::text as g from public.product_executive_snapshot`)).g, gen)
})

test('guarded: 050 refuses a database it was not written for', async () => {
  const c = await clone(pre050Dump)
  try {
    // a researched MLB id already on another (existing) player: the counts are unchanged, the identity guard refuses
    await c.db.exec(`update public.players set mlb_id = 665560 where slug = 'yeremy-rosario'`)
    await failsWith(c, sql050, /050: MLB id 665560 already belongs to another player/)
  } finally { await c.close() }
  const d = await clone(pre050Dump)
  try {
    await d.db.exec(`update public.outcome_model_evaluations set training_fingerprint = '00000000000000000000000000000000'`)
    await failsWith(d, sql050, /050: the stored model evaluation is neither the 041 one nor the 050 one/)
  } finally { await d.close() }
})

test('rollback: restores the pre-050 benchmark, outcome, evaluation and function state exactly, refreshes once, and 050 applies again', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  const base = await clone(pre050Dump)
  try {
    const want = await tableHashes(base)
    await c.db.exec(rollback050)
    const got = await tableHashes(c)
    const differs = Object.keys(want).filter((t) => want[t] !== got[t] && !t.startsWith('product_') && t !== 'sources')
    assert.deepEqual(differs, [], 'every research table equals its pre-050 content (the two legacy rows differ only in their updated_at bookkeeping)')
    const m = await measure(async (s) => (await c.db.query(s)).rows)
    assert.equal(m.executive_overview_body_md5, pre.executive_overview_body_md5)
    assert.equal(m.refresh_function_body_md5, pre.refresh_function_body_md5)
    assert.ok(m.evaluation.every((e) => e.evaluation_current && e.training_fingerprint === evaluation041.fingerprint), 'the stored 041 evaluation is back, and current')
    assert.deepEqual((await c.query(`select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`)), [])
    assert.equal((await c.query(`select count(*)::int as n from pg_trigger t join pg_class r on r.oid = t.tgrelid where r.relname in ('player_evaluations', 'player_evaluation_rankings') and not t.tgisinternal and t.tgenabled <> 'O'`))[0].n, 0, 'the evaluation guards are enabled again')
    await failsWith(c, rollback050, /rollback-050: Migration 050 is not applied/)
    await c.db.exec(sql050)
    const again = await measure(async (s) => (await c.db.query(s)).rows)
    const now = await measure(q)
    assert.deepEqual({ ...again.counts, snapshot_generation: null }, { ...now.counts, snapshot_generation: null })
    assert.deepEqual(again.support, now.support)
    assert.deepEqual(again.evaluation.map((e) => [e.model_key, e.training_fingerprint, e.evaluation_current]), now.evaluation.map((e) => [e.model_key, e.training_fingerprint, e.evaluation_current]))
  } finally { await c.close(); await base.close() }
})

test('rollback refuses when later research depends on a 050 benchmark player', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    await c.db.exec(`insert into public.player_aliases (player_id, alias) select id, 'Later alias' from public.players where mlb_id = 665560`)
    await c.db.exec(`insert into public.signings (player_id, organization_id, signing_year, pathway, bonus_publicly_reported, record_scope)
      select p.id, o.id, 2026, 'OTHER', false, 'TRACKED' from public.players p, public.organizations o where p.mlb_id = 665560 and o.abbreviation = 'NYY'`)
    await failsWith(c, rollback050, /rollback-050: later research depends on 1 of the 050 benchmark players/)
  } finally { await c.close() }
})

test('reproducible: the committed migration and rollback are byte-identical to the build output', () => {
  assert.equal(assemble(evaluation), sql050)
  assert.equal(assembleRollback(), rollback050)
})
