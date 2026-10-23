// 052 (development taxonomy and chronology resolution) over the exact database it was written for (the 050 chain; 051 added no migration):
// apply, rerun, the verifier at both boundaries, the research-queue corrections matching the pure rules, the season-bounded organization
// evidence, isolation from outcomes, transactions, WAR, costs and prediction, snapshot drift, security, and the exact rollback and reapply.
//   AFFILIATE NAME != ORGANIZATION WITHOUT SEASON CONTEXT   LEAGUE SEASON NOT PLAYED != MISSING PLAYER SEASON   TEAM CHANGE != CANONICAL TRANSACTION
//   SEASON PRECISION != DAY PRECISION   PENDING REVIEW != NEGATIVE DEVELOPMENT EVENT   DEVELOPMENT HISTORY != PREDICTION FEATURE

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS, EXPECTATIONS_THROUGH_051 } from '../../scripts/db/lib/invariants.mjs'
import { DATASET_QUERIES, HISTORY_QUERIES, assembleDataset } from '../../lib/research/dataset.js'
import { multiOrganizationSeasons, seasonGaps } from '../../lib/research/development-chronology.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '052_development_taxonomy_chronology_resolution.sql'
const sql052 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback052 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-052.sql'), 'utf8')
const values = JSON.parse(fs.readFileSync(path.join(root, 'database/research/052/migration-values.json'), 'utf8'))

let chain
let pre050
let post052
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const open = async (dump) => {
  const db = new PGlite({ loadDataDir: dump, extensions: { pgcrypto } })
  return { db, query: async (s, p) => (await db.query(s, p)).rows, close: () => db.close() }
}
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, c = chain) => (await c.query(sql))[0]

/** every public base table, by content (surrogate ids and creation timestamps kept: an exact restore must reproduce them) */
const tables = async (c) => {
  const names = (await c.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of names) out[t] = (await c.query(`select count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from public.${t} x`))[0]
  out.__queue_view = (await c.query(`select md5(pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass)) as h`))[0].h
  return out
}
/** the content of the tables 052 writes, without surrogate ids or write timestamps (what a reapply must reproduce) */
const content = async (c) => {
  const out = {}
  for (const t of ['player_season_stints', 'development_milestones', 'development_progression_decisions', 'development_level_era_map', 'sources']) {
    const cols = (await c.query(`select string_agg(quote_ident(column_name), ',' order by ordinal_position) as c from information_schema.columns
      where table_schema = 'public' and table_name = $1 and data_type <> 'uuid' and column_name not in ('created_at', 'reviewed_at', 'accessed_at')`, [t]))[0].c
    out[t] = (await c.query(`select count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from (select ${cols} from public.${t}) x`))[0]
  }
  return out
}
const isolation = async (c) => ({
  features: await one(`select md5(string_agg(f::text, '|' order by f::text)) as h, count(*)::int as n from public.v_outcome_feature_matrix f`, c),
  support: await c.query(`select target_key, reference_population, labelled_n, positive_n, negative_n, baseline_supported from public.v_outcome_target_support order by 1, 2`),
  evaluation: await c.query(`select model_key, training_fingerprint, evaluation_current from public.v_outcome_model_evaluation order by 1`),
  probabilities: (await one(`select count(*) filter (where probability is not null)::int as n from public.v_player_outcome_probability`, c)).n,
  audits: await one(`select count(*) filter (where outcome_audit_status = 'VERIFIED_MLB')::int as mlb, count(*) filter (where outcome_audit_status = 'VERIFIED_NO_MLB')::int as no_mlb,
    count(*) filter (where outcome_audit_status = 'NOT_AUDITED')::int as na from public.v_signing_records where is_dodgers_franchise`, c),
  war: (await one(`select count(*)::int as n from public.player_mlb_team_season_war`, c)).n,
  events: (await one(`select count(*)::int as n from public.transaction_events`, c)).n,
  assets: (await one(`select count(*)::int as n from public.transaction_event_assets`, c)).n,
  costs: await one(`select count(total_known_acquisition_cost_usd)::int as n, sum(total_known_acquisition_cost_usd)::text as usd from public.v_signing_records where is_dodgers_franchise`, c),
  snapshots: await c.query(`select snapshot, missing_rows, extra_rows from public.disi_product_snapshot_drift() order by 1`),
  generation: (await one(`select max(generation_id)::int as g from public.product_database_status`, c)).g,
})
const dataset = async (c) => {
  /** @type {Record<string, any[]>} */
  const raw = {}
  for (const [k, sql] of Object.entries({ ...DATASET_QUERIES, ...HISTORY_QUERIES })) raw[k] = await c.query(sql)
  const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)
  for (const rows of Object.values(raw)) for (const r of rows) for (const k of Object.keys(r)) r[k] = iso(r[k])
  return assembleDataset(raw)
}

let preTables
let preIsolation
before(async () => {
  chain = await buildChainThrough('050_international_benchmark_support_expansion.sql')
  pre050 = await chain.db.dumpDataDir('none')
  preTables = await tables(chain)
  preIsolation = await isolation(chain)
  await chain.db.exec(sql052)
  post052 = await chain.db.dumpDataDir('none')
}, { timeout: 900000 })
after(async () => { await chain?.close() })

test('052 follows 050 in the manifest (051 added no migration), and its rollback exists', () => {
  const i = manifest.canonical_sql.indexOf(FILE)
  assert.equal(manifest.canonical_sql[i - 1], '050_international_benchmark_support_expansion.sql')
  assert.ok(!fs.readdirSync(path.join(root, 'database/sql')).some((f) => f.startsWith('051')))
  assert.match(rollback052, /^-- DISI rollback-052\.sql/)
})

test('verifier: 252/252 at the 051 boundary before 052 and at the head after it; the old pins fail exactly where 052 moved them', async () => {
  const c = await open(pre050)
  try {
    const pre = await checkInvariants(c.query, EXPECTATIONS_THROUGH_051)
    assert.deepEqual(failedChecks(pre).map((f) => f.name), [])
    assert.equal(pre.hard.length, 252)
  } finally { await c.close() }
  const full = await checkInvariants(q, CANONICAL_EXPECTATIONS)
  assert.deepEqual(failedChecks(full).map((f) => f.name), [])
  assert.equal(full.hard.length, 252)
  const old = await checkInvariants(q, EXPECTATIONS_THROUGH_051)
  assert.deepEqual(failedChecks(old).map((f) => f.name).sort(), ['coded_milestones', 'dated_stints', 'professional_debut_milestones', 'progression_decisions',
    'progression_decisions_pending', 'progression_roles', 'undated_log_era_stints'])
})

test('rerunnable: applying 052 again changes nothing', async () => {
  const c = await open(post052)
  try {
    const a = await tables(c)
    await c.db.exec(sql052)
    assert.deepEqual(await tables(c), a)
  } finally { await c.close() }
})

test('organizations: every 052 assignment carries the official record for its own team id and season; one co-op club stays unresolved', async () => {
  const rows = await q(`select s.season, s.team_id, s.detail -> 'organizationEvidence' as e, o.name, o.franchise_key from public.player_season_stints s
    join public.organizations o on o.id = s.organization_id where s.detail ->> 'organizationBasis' = 'TEAM_SEASON_RECORD'`)
  assert.equal(rows.length, values.organizations.length)
  for (const r of rows) {
    assert.equal(Number(r.e.season), r.season)
    assert.equal(Number(r.e.teamId), Number(r.team_id))
    assert.equal(r.e.parentOrgId === 119, r.franchise_key === 'DODGERS')
  }
  const unresolved = await q(`select p.slug, s.season, s.affiliate_team from public.player_season_stints s join public.players p on p.id = s.player_id
    where s.stint_kind = 'TEAM_STINT' and s.organization_id is null and s.level <> 'FOREIGN_PRO'`)
  assert.deepEqual(unresolved.map((r) => [r.season, r.affiliate_team]), [[1995, 'Bakersfield Blaze']])
  const zephyrs = await q(`select s.season, o.name from public.player_season_stints s join public.organizations o on o.id = s.organization_id
    where s.affiliate_team = 'New Orleans Zephyrs' order by 1, 2`)
  for (const z of zephyrs) assert.equal(z.name, z.season <= 2004 ? 'Houston Astros' : z.season <= 2006 ? 'Washington Nationals' : z.season <= 2008 ? 'New York Mets' : 'Miami Marlins')
})

test('the organization check catches a stint coerced to the Dodgers and evidence carried to another season', async () => {
  const c = await open(post052)
  try {
    const n = async () => failedChecks(await checkInvariants(c.query, CANONICAL_EXPECTATIONS)).map((f) => f.name)
    await c.db.exec(`update public.player_season_stints set organization_id = (select id from public.organizations where name = 'Los Angeles Dodgers'),
      organization_name = 'Los Angeles Dodgers' where id = (select id from public.player_season_stints where detail -> 'organizationEvidence' ->> 'parentOrgId' = '145' limit 1)`)
    assert.ok((await n()).includes('organization_evidence_violations'))
  } finally { await c.close() }
  const d = await open(post052)
  try {
    await d.db.exec(`update public.player_season_stints set season = season + 1
      where id = (select id from public.player_season_stints s where s.detail ->> 'organizationBasis' = 'TEAM_SEASON_RECORD' and s.level = 'AA'
        and not exists (select 1 from public.player_season_stints t where t.player_id = s.player_id and t.season = s.season + 1) limit 1)`)
    assert.ok(failedChecks(await checkInvariants(d.query, CANONICAL_EXPECTATIONS)).some((f) => f.name === 'organization_evidence_violations'))
  } finally { await d.close() }
})

test('dates: only game-log dates, never over an existing one; the 2018 Mexican League stints stay undated; a dateless basis is caught', async () => {
  const r = await one(`select count(*) filter (where first_game_date is not null)::int as dated,
      count(*) filter (where season >= 2006 and stint_kind = 'TEAM_STINT' and first_game_date is null)::int as undated,
      count(*) filter (where (first_game_date is not null or last_game_date is not null) and game_date_basis is null)::int as without_basis
    from public.player_season_stints`)
  assert.deepEqual(r, { dated: 1274, undated: 6, without_basis: 0 })
  const left = await q(`select distinct league_name from public.player_season_stints where season >= 2006 and stint_kind = 'TEAM_STINT' and first_game_date is null`)
  assert.deepEqual(left.map((x) => x.league_name), ['Mexican League'])
  const c = await open(post052)
  try {
    await c.db.exec(`update public.player_season_stints set first_game_date = date '2018-04-01', last_game_date = date '2018-09-01'
      where id = (select id from public.player_season_stints where league_name = 'Mexican League' and season = 2018 and first_game_date is null limit 1)`)
    assert.ok(failedChecks(await checkInvariants(c.query, CANONICAL_EXPECTATIONS)).some((f) => f.name === 'stint_dates_without_game_log'))
  } finally { await c.close() }
})

test('2020: the queue no longer counts the cancelled season for an affiliated minor leaguer, keeps every other gap, and the check catches a 2020 stint', async () => {
  const flagged = new Set((await q(`select player_slug from public.v_dodgers_development_research_queue where issue = 'SEASON_GAP'`)).map((r) => r.player_slug))
  for (const s of ['diego-cartaya', 'carlos-rincon', 'hendrik-clementina', 'oneil-cruz', 'yusniel-diaz']) assert.ok(!flagged.has(s), s)
  // 2019 was played: Andy Pages stays flagged; a major leaguer's missing season stays flagged
  for (const s of ['andy-pages', 'hyun-jin-ryu', 'sandy-amoros']) assert.ok(flagged.has(s), s)
  assert.equal(flagged.size, 20)
  const c = await open(post052)
  try {
    await c.db.exec(`insert into public.player_season_stints (player_id, season, organization_name, affiliate_team, team_id, league_name, source_level, level, level_classification, era, affiliated, g, as_of_date, retrieved_at)
      select id, 2020, 'Los Angeles Dodgers', 'Test Affiliate', 1, 'Test League', 'A', 'LOW_A', 'SPORT_ID_14', 'DSL_AZL_2017_2020', true, 10, date '2026-10-23', now() from public.players where slug = 'diego-cartaya'`)
    assert.ok(failedChecks(await checkInvariants(c.query, CANONICAL_EXPECTATIONS)).some((f) => f.name === 'league_season_not_played_stints'))
  } finally { await c.close() }
})

test('the corrected detectors flag exactly the players the pure rules do (SEASON_GAP and MULTI_ORG_SEASON_UNVERIFIED)', async () => {
  const d = await dataset(chain)
  const ids = new Set(d.signings.map((s) => s.player_id))
  const by = new Map()
  for (const s of d.stints) by.set(s.player_id, [...(by.get(s.player_id) ?? []), s])
  const tx = new Map()
  for (const t of d.transactions) tx.set(t.player_id, [...(tx.get(t.player_id) ?? []), t])
  const sql = (issue) => new Set(d.developmentQueue.filter((r) => r.issue === issue).map((r) => r.player_id))
  const jsGap = new Set([...by].filter(([p, st]) => ids.has(p) && seasonGaps(st).open.length > 0).map(([p]) => p))
  const jsMulti = new Set([...by].filter(([p, st]) => ids.has(p) && multiOrganizationSeasons(st, tx.get(p) ?? []).some((m) => m.state !== 'BRACKETED')).map(([p]) => p))
  assert.deepEqual([...sql('SEASON_GAP')].sort(), [...jsGap].sort())
  assert.deepEqual([...sql('MULTI_ORG_SEASON_UNVERIFIED')].sort(), [...jsMulti].sort())
  // a bracketed season (Rincon: last Dodgers game 2021-07-18, trade 2021-07-21, first Mets game 2021-07-23) is not flagged; a team change
  // with no canonical transaction is (Cartaya 2025, Twins then Giants)
  const slug = new Map(d.signings.map((s) => [s.player_slug, s.player_id]))
  assert.ok(!sql('MULTI_ORG_SEASON_UNVERIFIED').has(slug.get('carlos-rincon')))
  assert.ok(sql('MULTI_ORG_SEASON_UNVERIFIED').has(slug.get('diego-cartaya')))
  // the rest of the queue is the 024 text: every other issue is untouched by the view change
  assert.equal(d.developmentQueue.length, 134)
})

test('sequences the exact dates expose are pending reviews; no inversion is left undecided and none is decided', async () => {
  const pending = await q(`select p.slug, d.event_code, d.progression_role, d.review_status, d.developmental_arrival_season from public.development_progression_decisions d
    join public.players p on p.id = d.player_id where d.decision_basis = 'GAME_LOG_REVIEW' and d.review_status = 'PENDING_REVIEW' order by 1, 2`)
  assert.deepEqual(pending.map((r) => `${r.slug}:${r.event_code}`), values.progression_reviews.map((r) => `${r.slug}:${r.event_code}`))
  for (const r of pending) assert.deepEqual([r.progression_role, r.developmental_arrival_season], ['REVIEW_REQUIRED', null])
  assert.equal((await one(`select count(*)::int as n from public.v_dodgers_development_research_queue where issue = 'NON_MONOTONIC_PROGRESSION'`)).n, 0)
  // the status table is untouched: a pending review is not a negative development event
  const c = await open(pre050)
  try {
    const a = await c.query(`select md5(string_agg(t::text, '|' order by t::text)) as h from public.player_development_status t`)
    const b = await q(`select md5(string_agg(t::text, '|' order by t::text)) as h from public.player_development_status t`)
    assert.deepEqual(b, a)
  } finally { await c.close() }
})

test('the Pioneer League is recorded per era; its stints stay unranked and the taxonomy is unchanged', async () => {
  const rows = await q(`select era::text, maps_to::text from public.development_level_era_map where source_label = 'Pioneer League' order by 1`)
  assert.deepEqual(rows.map((r) => [r.era, r.maps_to]), [['CLASSIC_AFFILIATED_1989_2016', 'OTHER'], ['DSL_AZL_2017_2020', 'OTHER'], ['MODERN_FOUR_LEVEL_2021_PLUS', 'INDEPENDENT'],
    ['PRE_ACADEMY_1960_1988', 'OTHER']])
  const st = await one(`select count(*)::int as n, count(*) filter (where level = 'OTHER' and level_rank is null and not affiliated and source_level = 'ROK')::int as unranked
    from public.player_season_stints where league_name = 'Pioneer League'`)
  assert.equal(st.n, st.unranked)
  const levels = await q(`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'development_level' order by e.enumsortorder`)
  assert.equal(levels.length, 11)
})

test('isolation: outcomes, WAR, transactions, costs, the feature matrix, support, evaluation and probabilities are what 050 left; no snapshot drifts', async () => {
  const now = await isolation(chain)
  assert.equal(md5(now), md5(preIsolation))
  assert.deepEqual(now.audits, { mlb: 47, no_mlb: 46, na: 127 })
  assert.deepEqual([now.war, now.events, now.assets], [1880, 213, 396])
  assert.equal(now.probabilities, 0)
  assert.ok(now.evaluation.every((e) => e.training_fingerprint === 'af9ec05feb3ee1518cb7608193cd209a' && e.evaluation_current))
  assert.ok(now.snapshots.every((s) => s.missing_rows === 0 && s.extra_rows === 0))
  const reach = now.support.find((s) => s.target_key === 'REACH_MLB_WITHIN_7_SEASONS' && s.labelled_n === 90)
  assert.deepEqual([reach.positive_n, reach.negative_n, reach.baseline_supported], [19, 71, true])
})

test('security: no relation, function, grant or policy is added; the queue view keeps security_invoker and its read-only grants', async () => {
  const c = await open(pre050)
  const surface = async (x) => ({
    relations: await x.query(`select c.relname, c.relkind::text, c.relrowsecurity, coalesce(c.relacl::text, '') as acl, coalesce(array_to_string(c.reloptions, ','), '') as opts
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'm') order by 1`),
    functions: await x.query(`select p.proname, p.prosecdef, coalesce(p.proacl::text, '') as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' order by 1, 2`),
    policies: await x.query(`select tablename, policyname, cmd, roles::text from pg_policies where schemaname = 'public' order by 1, 2`),
  })
  try {
    assert.deepEqual(await surface(chain), await surface(c))
  } finally { await c.close() }
})

test('rollback restores the exact pre-052 state; reapplying 052 reproduces the same content', async () => {
  const c = await open(post052)
  try {
    const first = await content(c)
    await c.db.exec(rollback052)
    assert.deepEqual(await tables(c), preTables)
    await c.db.exec(sql052)
    assert.deepEqual(await content(c), first)
    assert.deepEqual(failedChecks(await checkInvariants(c.query, CANONICAL_EXPECTATIONS)).map((f) => f.name), [])
  } finally { await c.close() }
})

test('the rollback refuses a database 052 has not been applied to', async () => {
  const c = await open(pre050)
  try {
    await assert.rejects(c.db.exec(rollback052), /rollback-052: only 0 of \d+ organization stints are in their 052 state/)
  } finally { await c.close() }
})
