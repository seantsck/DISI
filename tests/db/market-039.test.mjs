// Migration 039: market / country / pathway intelligence. The 038a database is replayed (001-038a), 039 is applied for real, and the
// reference data, the leakage-safe signing-time features, the context and summary guardrails, the research queue and the verifier
// are checked.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { marketQueries, MARKET_CHECK_NAMES } from '../../scripts/db/lib/market-invariants.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '039_market_pathway_intelligence.sql'
const sql039 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const ref = JSON.parse(fs.readFileSync(path.join(root, 'database/research/039/reference.json'), 'utf8'))
const VIEWS = ['v_signing_time_features', 'v_market_pathway_player_context', 'v_market_pathway_summary', 'v_market_research_queue']
const TABLES = ['international_signing_eras', 'market_groups']
const EXPECT039 = { ...CANONICAL_EXPECTATIONS, public_views_total: 129, public_tables_total: 62 }

let chain
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const tableHashes = async () => {
  const tables = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5((await q(`select t::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const viewDefs = async () => Object.fromEntries((await q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v'`)).map((r) => [r.relname, r.d]))
let before039
before(async () => {
  chain = await buildChainThrough('038a_network_outcome_view_performance.sql')
  before039 = { hashes: await tableHashes(), defs: await viewDefs() }
  await chain.db.exec(sql039)
}, { timeout: 300000 })
after(async () => { await chain?.close() })

const failing = async () => {
  const out = []
  for (const [name, sql] of Object.entries(marketQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
  return out.sort()
}
async function scratch(fn) {
  await chain.db.exec('begin;')
  try { return await fn() } finally { await chain.db.exec('rollback;') }
}
async function drift(view, overrides) {
  return scratch(async () => {
    const cols = (await q(`select attname from pg_attribute where attrelid = 'public.${view}'::regclass and attnum > 0 and not attisdropped order by attnum`)).map((r) => r.attname)
    await chain.db.exec(`alter view public.${view} rename to ${view}_real`)
    await chain.db.exec(`create view public.${view} as select ${cols.map((c) => (c in overrides ? `${overrides[c]} as ${c}` : `r.${c}`)).join(', ')} from public.${view}_real r`)
    return failing()
  })
}

test('039 shape: two RLS reference tables, four security-invoker views, SELECT-only grants, one transaction', async () => {
  const c = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
  assert.deepEqual(c, { tables: 62, views: 129 })
  const v = await q(`select relname, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) and relkind = 'v' order by 1`, [VIEWS])
  assert.deepEqual(v.map((r) => r.relname), [...VIEWS].sort())
  for (const r of v) assert.match(r.opts, /security_invoker=true/)
  const t = await q(`select relname, relrowsecurity as rls from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`, [TABLES])
  assert.deepEqual(t, TABLES.map((n) => ({ relname: n, rls: true })))
  const acl = await q(`select c.relname, a.privilege_type as p from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)`, [[...VIEWS, ...TABLES]])
  assert.deepEqual([...new Set(acl.map((a) => a.p))], ['SELECT'])
  assert.equal(acl.length, (VIEWS.length + TABLES.length) * 2)
  assert.match(sql039, /^begin;$/m)
  assert.match(sql039, /^commit;$/m)
})

test('039 is derived only: no existing table or view changes', async () => {
  const after = await tableHashes()
  assert.deepEqual(Object.keys(after).filter((t) => after[t] !== before039.hashes[t]).sort(), TABLES)
  const defs = await viewDefs()
  assert.deepEqual(Object.keys(before039.defs).filter((v) => defs[v] !== before039.defs[v]), [])
})

test('reference data: every observed market mapped exactly once; three contiguous league eras', async () => {
  const groups = await q(`select country_market, market_group, region from market_groups order by 1`)
  assert.deepEqual(groups, [...ref.market_groups].sort((a, b) => (a.country_market < b.country_market ? -1 : 1)))
  const eras = await q(`select era_key, starts_on::text as s, ends_on::text as e from international_signing_eras order by era_order`)
  assert.deepEqual(eras, [
    { era_key: 'BEFORE_BONUS_POOLS', s: null, e: '2012-07-01' },
    { era_key: 'SOFT_CAPPED_BONUS_POOLS', s: '2012-07-02', e: '2017-07-01' },
    { era_key: 'HARD_CAPPED_BONUS_POOLS', s: '2017-07-02', e: null },
  ])
})

test('signing-time features: one row per signing, populations kept apart, expectation only when dated by the signing cutoff', async () => {
  const pc = Object.fromEntries((await q(`select population_class, count(*)::int as n from v_signing_time_features group by 1`)).map((r) => [r.population_class, r.n]))
  assert.deepEqual(pc, { OPENING_CLASS_CENSUS: 35, OUTCOME_SELECTED_SAMPLE: 49, TOP_PROSPECT_SAMPLE: 48, TRACKED_SAMPLE: 136 })
  const ex = await q(`select player_slug, expectation_tier from v_signing_time_features where expectation_band_code is not null and population_class <> 'TOP_PROSPECT_SAMPLE'`)
  assert.deepEqual(ex, [{ player_slug: 'roki-sasaki', expectation_tier: 'TOP_BAND' }])
  // De Paula and Morales were evaluated years after signing: never an at-signing expectation
  const later = await q(`select player_slug, expectation_tier from v_signing_time_features where player_slug in ('josue-de-paula', 'emil-morales') order by 1`)
  for (const r of later) assert.equal(r.expectation_tier, 'NO_AT_SIGNING_EXPECTATION')
  const benchmark = await one(`select count(*) filter (where expectation_band_code is not null)::int as n from v_signing_time_features where population_class = 'TOP_PROSPECT_SAMPLE'`)
  assert.equal(benchmark.n, 48)
  const pros = await one(`select count(*)::int as n from v_signing_time_features where signing_route = 'PROFESSIONAL_SIGNING' and era_key <> 'PROFESSIONAL_ROUTE'`)
  assert.equal(pros.n, 0)
})

test('leakage: future facts (post-signing evaluation, later position, outcome audit, team-season bWAR) never change a signing-time feature', async () => {
  const base = md5(await q(`select * from v_signing_time_features order by signing_id`))
  await scratch(async () => {
    // Gleyber Torres signed in 2013; a 2015 Top-100 rank, a position change, a changed audit and an extra bWAR season are all later facts
    await chain.db.exec(`do $s$ declare i uuid; begin
      insert into player_evaluations (player_id, publication_id, evaluation_context, date_precision, evaluation_date, evaluation_year, evaluation_month,
        evidence_basis, confidence, source_reference, retrieved_at)
      values ((select id from players where slug = 'gleyber-torres'), (select id from scouting_publications where publication_slug = 'baseball-america-top-100'),
        'GLOBAL_LIST', 'DAY', date '2015-02-15', 2015, 2, 'MANUAL_TRANSCRIPTION', 'MEDIUM', 'leakage test reference', now()) returning id into i;
      insert into player_evaluation_rankings (evaluation_id, rank, ranking_scope, scope_label, list_size) values (i, 5, 'MLB_GLOBAL', 'leakage test', 100);
      update player_evaluations set record_status = 'ACTIVE' where id = i;
    end $s$`)
    await chain.db.exec(`update players set primary_position = '1B' where slug in ('gleyber-torres', 'josue-de-paula')`)
    await chain.db.exec(`update outcome_audits set reached_mlb_verified = false, outcome_state = 'NO_MLB_STATUS_UNKNOWN' where player_id = (select id from players where slug = 'emil-morales')`)
    await chain.db.exec(`insert into player_mlb_team_season_war (bref_id, mlb_id, player_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games,
        plate_appearances, ip_outs, league, source_id, observed_through_date, observed_through_season, retrieved_at, confidence, note)
      select bref_id, mlb_id, player_id, 2030, bref_team_code, organization_id, stint_ordinal, component, 9.9, games, plate_appearances, ip_outs, league, source_id,
        date '2030-10-01', 2030, retrieved_at, confidence, 'leakage test'
      from player_mlb_team_season_war where bref_id = (select bref_id from players where slug = 'gleyber-torres') and record_status = 'ACTIVE' order by season limit 1`)
    assert.equal(md5(await q(`select * from v_signing_time_features order by signing_id`)), base)
  })
})

test('summary: populations never pooled; outcome-selected rows carry no share; no census rate is eligible today', async () => {
  const s = await q(`select dimension, dimension_value, population_scope, audited_count, reached_mlb_count, sample_reach_share::float as share, rate_eligible, sample_state
    from v_market_pathway_summary where dimension = 'MARKET_GROUP' and sample_reach_share is not null order by 2, 3`)
  assert.deepEqual(s.map((r) => [r.dimension_value, r.population_scope, r.audited_count, r.reached_mlb_count, r.share]), [
    ['DOMINICAN_REPUBLIC', 'TOP_PROSPECT_SAMPLE', 21, 6, 0.286],
    ['VENEZUELA', 'TOP_PROSPECT_SAMPLE', 17, 4, 0.235],
  ])
  const sel = await one(`select count(*) filter (where sample_reach_share is not null or census_reach_rate is not null)::int as shared, count(*)::int as n
    from v_market_pathway_summary where population_scope = 'OUTCOME_SELECTED_SAMPLE'`)
  assert.ok(sel.n > 0)
  assert.equal(sel.shared, 0)
  assert.equal((await one(`select count(*)::int as n from v_market_pathway_summary where rate_eligible`)).n, 0)
  const cols = (await q(`select attname from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and a.attnum > 0`, [VIEWS])).map((r) => r.attname)
  for (const x of cols) assert.doesNotMatch(x, /rank$|^rank|best|top_market|per_million|per_dollar|roi|efficien|causal|effect|predict|probab|score/i, x)
})

test('research queue: only new issue types', async () => {
  const issues = Object.fromEntries((await q(`select issue, count(*)::int as n from v_market_research_queue group by 1`)).map((r) => [r.issue, r.n]))
  assert.deepEqual(issues, { AGE_AT_SIGNING_UNKNOWN: 5, POSITION_AT_SIGNING_UNKNOWN: 12, SIGNING_MARKET_UNKNOWN: 29 })
  const old = (await q(`select distinct issue from v_financial_research_queue`)).map((r) => r.issue)
  for (const k of Object.keys(issues)) assert.ok(!old.includes(k), k)
})

test('verifier: the five market checks pass, each catches its own drift, and the full verifier passes on the 039 database', async () => {
  assert.deepEqual(await failing(), [])
  assert.equal(MARKET_CHECK_NAMES.length, 5)
  const full = await checkInvariants(q, EXPECT039)
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 241, '212 through 039 plus the five 040 and six 041 checks, which pass trivially without their objects')
  const f = 'v_signing_time_features'
  assert.ok((await drift(f, { position_family: `case when r.position_family = 'POSITION_UNKNOWN' then 'PITCHER' else r.position_family end` })).includes('market_feature_leakage_violations'))
  assert.ok((await drift(f, { market_group: `case when r.market_group = 'UNKNOWN' then 'VENEZUELA' else r.market_group end` })).includes('market_feature_row_violations'))
  assert.ok((await drift(f, { era_key: `case when r.era_key = 'PROFESSIONAL_ROUTE' then 'BEFORE_BONUS_POOLS' else r.era_key end` })).includes('market_era_violations'))
  assert.ok((await drift('v_market_pathway_player_context', { career_bwar: 'coalesce(r.career_bwar, 0)' })).includes('market_context_passthrough_violations'))
  assert.ok((await drift('v_market_pathway_summary', { sample_reach_share: '0.5' })).includes('market_summary_sample_violations'))
})

test('rerun: the migration is idempotent and changes no data and no definition', async () => {
  const hashes = await tableHashes()
  const defs = await viewDefs()
  const out = md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2, 3`))))
  await chain.db.exec(sql039)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await viewDefs(), defs)
  assert.equal(md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2, 3`)))), out)
})

test('reproducible: building from the same inputs produces the committed bytes', () => {
  const before = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', FILE))).digest('hex')
  execFileSync(process.execPath, [path.join(root, 'database/research/039/build.mjs')], { cwd: root, stdio: 'pipe' })
  assert.equal(crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', FILE))).digest('hex'), before)
})

test('frozen history: 039 adds only; it never alters, drops, deletes or updates an earlier object', () => {
  const code = sql039.replace(/--.*$/gm, '')
  assert.doesNotMatch(code, /\bdrop (table|view|column)\b/i)
  assert.doesNotMatch(code, /\balter (view|column)\b/i)
  assert.doesNotMatch(code, /^\s*(delete from|truncate|update )/im)
  assert.doesNotMatch(code, /\balter table public\.(?!%I)/i)
})
