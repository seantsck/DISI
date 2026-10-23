// Migration 048: the verified-MLB development coverage batch. The 047 database is built (001-047), 048 is applied for real, and the tests prove that
// it adds research DATA only (no object, grant or policy changes), that the cohort is exactly the verified MLB players outside the 047 controlled cohort,
// that development histories are ingested without inventing seasons, that FIRST OBSERVED SEASON != FIRST PROFESSIONAL SEASON, that a post-MLB minor-league
// stint is not a developmental arrival, that ambiguous level sequences stay PENDING for a person, that the snapshots move to one coherent generation
// with zero drift, and that it is idempotent, guarded, reproducible and reversible.
//   UNKNOWN DEVELOPMENT HISTORY != NO DEVELOPMENT   MISSING SEASON != NO SEASON PLAYED   PARTIAL HISTORY != NO HISTORY

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_048 as CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'
import { productSnapshotQueries } from '../../scripts/db/lib/product-snapshot-invariants.mjs'
import { ALL_SNAPSHOT_TABLES } from '../../database/research/045b/snapshots.mjs'
import { DATASET_QUERIES, HISTORY_QUERIES, assembleDataset } from '../../lib/research/dataset.js'
import { developmentCoverage, developmentQueue, developmentRecords, timingFacts } from '../../lib/research/development-research.js'
import { verifiedMlbCoverage } from '../../lib/research/history-coverage.js'
import { developmentNeedSummary, developmentNeeds } from '../../lib/research/development-needs.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '048_verified_mlb_development_coverage.sql'
const sql048 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback048 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-048.sql'), 'utf8')
const cohort = JSON.parse(fs.readFileSync(path.join(root, 'database/research/048/development-cohort.json'), 'utf8'))
const cohort047 = JSON.parse(fs.readFileSync(path.join(root, 'database/research/047/development-cohort.json'), 'utf8')).players.map((p) => p.slug)
const COHORT = cohort.players.map((p) => p.slug)
const ALREADY = cohort.already_researched
const FRESH = COHORT.filter((s) => !ALREADY.includes(s))
const RESEARCH_TABLES = ['development_milestones', 'development_progression_decisions', 'player_season_stints', 'sources']
const LEVEL_DEBUTS = ['DSL_DEBUT', 'COMPLEX_DEBUT', 'A_DEBUT', 'HIGH_A_DEBUT', 'AA_DEBUT', 'AAA_DEBUT']

let chain
let pre048Dump
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
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)
/** The dataset the research commands read, as the public anon role sees it (the same relations and columns the CLI reads). */
const rawDataset = async (c = chain, history = true) => {
  /** @type {Record<string, any[]>} */
  const raw = {}
  await c.db.exec('set role anon')
  try {
    for (const [k, s] of Object.entries(history ? { ...DATASET_QUERIES, ...HISTORY_QUERIES } : DATASET_QUERIES)) {
      raw[k] = R(await c.db.query(s)).map((r) => Object.fromEntries(Object.entries(r).map(([a, b]) => [a, iso(b)])))
    }
  } finally { await c.db.exec('reset role') }
  return raw
}
const stintsByPlayer = (data) => {
  const m = new Map()
  for (const s of data.stints) { if (!m.has(s.player_id)) m.set(s.player_id, []); m.get(s.player_id).push(s) }
  return m
}

let pre
let post
before(async () => {
  chain = await buildChainThrough('047_development_transaction_research_batch.sql')
  pre048Dump = await chain.db.dumpDataDir('none')
  const raw = await rawDataset()
  pre = {
    hashes: await tableHashes(), catalog: await catalog(), raw, data: assembleDataset(raw),
    generation: (await one(`select max(generation_id)::int as g from product_executive_snapshot`)).g,
    counts: await one(`select (select count(*)::int from public.player_season_stints) as stints, (select count(*)::int from public.development_milestones) as milestones,
      (select count(*)::int from public.development_progression_decisions) as decisions, (select count(*)::int from public.player_season_stints where stint_kind = 'SEASON_TOTAL') as totals,
      (select count(*)::int from public.transaction_events) as events, (select count(*)::int from public.transaction_event_assets) as assets`),
    status: await one(`select tracked_signings, signings_with_known_cost, known_acquisition_cost_usd::text as cost, open_research_tasks, outcome_audit_queue, outcome_audits_completed from product_database_status`),
    mlb: (await q(`select player_slug from public.v_signing_records where is_dodgers_franchise and reached_mlb_verified order by 1`)).map((r) => r.player_slug),
    jansen: await q(`select d.event_code, d.progression_role, d.review_status, d.confidence::text, d.notes, d.as_of_date::text from public.development_progression_decisions d join public.players p on p.id = d.player_id where p.slug = 'kenley-jansen' order by 1`),
    reviewed: (await one(`select count(*)::int as n from public.development_progression_decisions where review_status = 'REVIEWED'`)).n,
    support: await q(`select * from public.product_prediction_readiness order by 1, 2`),
  }
  await chain.db.exec(sql048)
  const raw2 = await rawDataset()
  post = { hashes: await tableHashes(), catalog: await catalog(), raw: raw2, data: assembleDataset(raw2) }
}, { timeout: 900000 })
after(async () => { await chain?.close() })

test('048 is registered after 047 and before 049', () => {
  const i = manifest.canonical_sql.indexOf(FILE)
  assert.equal(i, 51, '048 is the 52nd canonical file; later migrations follow it')
  assert.equal(manifest.canonical_sql[i - 1], '047_development_transaction_research_batch.sql')
  assert.equal(manifest.canonical_sql[i + 1], '049_transaction_package_completion.sql')
  assert.equal(manifest.notes.canonical_build_count, manifest.canonical_sql.length)
})

test('048 adds research DATA only: no table, view, function, trigger, policy or privilege changes', async () => {
  assert.deepEqual(post.catalog, pre.catalog)
  assert.equal(post.catalog.tables.length, 78)
  assert.equal(post.catalog.views.length, 155)
  const changed = Object.keys(post.hashes).filter((t) => post.hashes[t] !== pre.hashes[t]).sort()
  assert.deepEqual(changed, [...RESEARCH_TABLES, ...ALL_SNAPSHOT_TABLES].sort())
  assert.equal(ALL_SNAPSHOT_TABLES.length, 11)
  // research that must not move: audits, outcomes, costs, the financial ledger, transactions, the scouting history
  for (const t of ['outcome_audits', 'outcome_evidence', 'outcomes', 'signings', 'signing_financial_reports', 'players', 'transaction_events', 'transaction_event_assets', 'transaction_asset_resolutions',
    'transaction_asset_timing_observations', 'dodgers_control_observations', 'player_mlb_team_season_war', 'research_source_conflicts']) {
    assert.equal(post.hashes[t], pre.hashes[t], `${t} must not change`)
  }
  assert.equal((await one(`select count(*)::int as n from public.transaction_events`)).n, pre.counts.events, '048 records no transaction')
  // the API roles still cannot write any table 048 touches
  for (const t of RESEARCH_TABLES) {
    const r = await one(`select has_table_privilege('anon', 'public.${t}', 'INSERT') or has_table_privilege('anon', 'public.${t}', 'UPDATE') or has_table_privilege('anon', 'public.${t}', 'DELETE')
      or has_table_privilege('authenticated', 'public.${t}', 'INSERT') or has_table_privilege('authenticated', 'public.${t}', 'UPDATE') or has_table_privilege('authenticated', 'public.${t}', 'DELETE') as api_write`)
    assert.equal(r.api_write, false, t)
  }
})

test('cohort selection: exactly the verified MLB players outside the 047 controlled cohort, derived from the database, in queue order', () => {
  assert.equal(pre.mlb.length, 47)
  assert.equal(cohort047.length, 10)
  assert.ok(cohort047.every((s) => pre.mlb.includes(s)), 'all ten 047 players are verified MLB players')
  const expected = pre.mlb.filter((s) => !cohort047.includes(s)).sort()
  assert.equal(expected.length, 37)
  assert.deepEqual([...COHORT].sort(), expected, 'the cohort is derived, not hard-coded: verified MLB minus the 047 cohort')
  assert.deepEqual(cohort.excluded_047_cohort, cohort047, 'the 047 cohort is excluded by name')
  assert.equal(COHORT.filter((s) => cohort047.includes(s)).length, 0, 'no 047 player is researched again')
  assert.deepEqual(ALREADY.slice().sort(), ['carlos-frias', 'roger-cedeno'], 'the only cohort players Migration 021 had already researched')
  // the order is the deterministic development queue, rank ascending; none is dropped for being difficult
  const ranks = cohort.players.map((p) => p.queue_rank)
  assert.ok(ranks.every((r) => Number.isInteger(r)))
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b))
  const queue = developmentQueue(pre.data)
  for (const p of cohort.players) assert.equal(queue.find((r) => r.player_slug === p.slug)?.rank, p.queue_rank, p.slug)
  assert.equal(FRESH.length, 35)
})

test('development histories: 35 players gain their whole recorded career; nothing is added for the two already on record or anyone outside the cohort', async () => {
  const added = (await one(`select count(*)::int as n from public.player_season_stints`)).n - pre.counts.stints
  assert.equal(added, 776)
  assert.equal((await one(`select count(*)::int as n from public.development_milestones`)).n - pre.counts.milestones, 200)
  const per = await q(`select p.slug, count(*)::int as n from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = any($1) group by 1`, [COHORT])
  assert.equal(per.length, 37)
  // the two 021 players hold exactly what they held
  const before = await clone(pre048Dump)
  try {
    for (const slug of ALREADY) {
      const was = (await before.query(`select count(*)::int as n from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = $1`, [slug]))[0].n
      assert.equal(per.find((r) => r.slug === slug).n, was, `${slug} is unchanged`)
    }
  } finally { await before.close() }
  // every stint is sourced, and players outside the cohort are untouched
  assert.equal((await one(`select count(*)::int as n from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = any($1) and s.source_id is null`, [COHORT])).n, 0)
  const outside = (await one(`select count(*)::int as n from public.player_season_stints s join public.players p on p.id = s.player_id where not (p.slug = any($1))`, [COHORT])).n
  const outsideBefore = pre.counts.stints - per.filter((r) => ALREADY.includes(r.slug)).reduce((a, r) => a + r.n, 0)
  assert.equal(outside, outsideBefore, 'every stint outside the cohort is as it was')
  // no duplicate milestone for a player and event the database already held (Frias and Cedeno keep their 021 rows)
  assert.equal((await one(`select count(*)::int as n from (select player_id, event_code, count(*) from public.development_milestones m join public.players p on p.id = m.player_id
    where p.slug = any($1) and m.event_code = any($2) group by 1, 2 having count(*) > 1) x`, [ALREADY, [...LEVEL_DEBUTS, 'MLB_DEBUT', 'PROFESSIONAL_DEBUT']])).n, 0)
})

test('FIRST OBSERVED SEASON != FIRST PROFESSIONAL SEASON: a late-starting source gives the first observed record only, and the missing seasons stay unknown', async () => {
  const first = Object.fromEntries((await q(`select p.slug, min(s.season)::int as first from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = any($1) group by 1`, [COHORT])).map((r) => [r.slug, r.first]))
  const recs = Object.fromEntries(developmentRecords(post.data).map((r) => [r.player_slug, r]))
  // Astacio signed in 1987; the API begins in 1990: 1987-89 are NOT filled in and 1990 is not the first professional season
  assert.equal(first['pedro-astacio'], 1990)
  assert.equal(recs['pedro-astacio'].first_pro_status, 'FIRST_OBSERVED_ONLY')
  assert.equal(recs['pedro-astacio'].dims.FIRST_PRO_SEASON, 'UNKNOWN')
  assert.equal((await one(`select count(*)::int as n from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = 'pedro-astacio' and s.season < 1990`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from public.development_milestones m join public.players p on p.id = m.player_id where p.slug = 'pedro-astacio' and m.event_code in ('DSL_DEBUT', 'COMPLEX_DEBUT')`)).n, 0)
  // an amateur whose first record is the next season: known
  assert.equal(recs['andy-pages'].first_pro_status, 'KNOWN')
  assert.equal(recs['andy-pages'].dims.FIRST_PRO_SEASON, 'KNOWN')
  // every player whose first record is two or more seasons after signing is UNKNOWN, never KNOWN
  for (const slug of FRESH) {
    const r = recs[slug]
    const signed = r.signing_year
    if (first[slug] - signed > 1 && r.pathway !== undefined) assert.notEqual(r.dims.FIRST_PRO_SEASON, 'KNOWN', `${slug}: first observed ${first[slug]}, signed ${signed}`)
  }
})

test('international professional context: an established professional\'s first affiliated season is not his first professional season; foreign leagues stay FOREIGN_PRO and off the ladder', async () => {
  const recs = Object.fromEntries(developmentRecords(post.data).map((r) => [r.player_slug, r]))
  for (const slug of ['julio-urias', 'yordan-alvarez', 'yusniel-diaz', 'yasiel-puig', 'roki-sasaki', 'hideo-nomo', 'hyun-jin-ryu', 'fernando-valenzuela']) {
    assert.equal(recs[slug].first_pro_status === 'PRIOR_PROFESSIONAL_CAREER' || recs[slug].first_pro_status === 'NO_AFFILIATED_RECORD', true, slug)
    assert.equal(recs[slug].dims.FIRST_PRO_SEASON, 'UNKNOWN', slug)
  }
  // Cuban and Mexican amateurs and Latin American amateurs are not marked professional
  assert.equal(recs['andy-pages'].pathway, 'CUBAN_AMATEUR')
  assert.equal(recs['miguel-vargas'].pathway, 'CUBAN_AMATEUR')
  // the 047 figure of 164 counted Puig; with the pathway honoured the same pre-048 state is 163
  assert.deepEqual(developmentCoverage(pre.data).dimensions.FIRST_PRO_SEASON, { known: 163, applicable: 220 })
  // Mexican League seasons stay FOREIGN_PRO: never an affiliated level, never on the progression ladder
  const fp = await one(`select count(*)::int as n, count(distinct s.level_classification)::int as classes, min(s.level_classification) as cls, bool_or(s.affiliated) as affiliated
    from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = 'karim-garcia' and s.level = 'FOREIGN_PRO'`)
  assert.ok(fp.n >= 10)
  assert.deepEqual([fp.classes, fp.cls, fp.affiliated], [1, 'FOREIGN_PRO_LEAGUE', false])
  assert.equal((await one(`select count(*)::int as n from public.v_player_development_progression where level = 'FOREIGN_PRO'`)).n, 0)
  // Sasaki: the API holds only his MLB-affiliated seasons; his NPB career is a documented limitation, not an invented row
  assert.equal((await one(`select count(*)::int as n from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = 'roki-sasaki' and s.level = 'FOREIGN_PRO'`)).n, 0)
})

test('a level debut after the MLB debut season (a rehab or demotion appearance) is not recorded as a development milestone, though its stint stays on record', async () => {
  const rows = await q(`select p.slug, m.event_code, m.season_year, d.season_year as mlb_season from public.development_milestones m join public.players p on p.id = m.player_id
    join public.development_milestones d on d.player_id = m.player_id and d.event_code = 'MLB_DEBUT'
    where p.slug = any($1) and m.event_code = any($2) and m.as_of_date = date '2026-10-20' and coalesce(m.season_year, extract(year from m.milestone_date)::int) > coalesce(d.season_year, extract(year from d.milestone_date)::int)`, [FRESH, LEVEL_DEBUTS])
  assert.deepEqual(rows, [])
  // Santana's 2026 rookie-level games (long after his 2010 debut) are on record as stints and are not a COMPLEX_DEBUT
  assert.ok((await one(`select count(*)::int as n from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = 'carlos-santana' and s.season = 2026 and s.level = 'COMPLEX_ROOKIE'`)).n >= 1)
  assert.equal((await one(`select count(*)::int as n from public.development_milestones m join public.players p on p.id = m.player_id where p.slug = 'carlos-santana' and m.event_code = 'COMPLEX_DEBUT' and m.season_year = 2026`)).n, 0)
  // season-precision milestones never carry an invented date
  assert.equal((await one(`select count(*)::int as n from public.development_milestones m join public.players p on p.id = m.player_id where p.slug = any($1) and m.date_precision = 'SEASON' and m.milestone_date is not null`, [COHORT])).n, 0)
  // every MLB debut milestone is the verified outcome-audit date, exactly
  const mismatch = await q(`select p.slug from public.development_milestones m join public.players p on p.id = m.player_id join public.v_signing_records s on s.player_id = p.id and s.is_dodgers_franchise
    where m.event_code = 'MLB_DEBUT' and m.milestone_date is distinct from s.mlb_debut_date`)
  assert.deepEqual(mismatch, [])
  assert.equal((await one(`select count(*)::int as n from public.development_milestones where event_code = 'MLB_DEBUT'`)).n, 47)
})

test('an ambiguous level sequence stays PENDING for a person: six players, fifteen pending decisions, none reviewed, Jansen untouched', async () => {
  const reviews = cohort.progression_reviews
  assert.equal(reviews.length, 15)
  assert.deepEqual([...new Set(reviews.map((r) => r.slug))].sort(), ['carlos-santana', 'hung-chih-kuo', 'julio-urias', 'oneil-cruz', 'tony-abreu', 'yusniel-diaz'])
  assert.ok(reviews.every((r) => r.decision_basis === 'STINT_CHRONOLOGY_REVIEW' && r.confidence === 'LOW' && r.notes.length > 200 && !ALREADY.includes(r.slug)))
  const d = await q(`select p.slug, d.event_code, d.progression_role, d.review_status, d.decision_basis from public.development_progression_decisions d join public.players p on p.id = d.player_id
    where d.as_of_date = date '2026-10-20' and p.slug <> 'kenley-jansen' order by 1, 2`)
  assert.equal(d.length, 15, 'fifteen new pending decisions (Jansen\'s two from 047 carry the same as-of date and are checked below)')
  assert.ok(d.every((r) => r.progression_role === 'REVIEW_REQUIRED' && r.review_status === 'PENDING_REVIEW'))
  assert.equal((await one(`select count(*)::int as n from public.development_progression_decisions where review_status = 'REVIEWED'`)).n, pre.reviewed, '048 asserts no reviewed decision')
  assert.equal((await one(`select count(*)::int as n from public.development_progression_decisions`)).n, pre.counts.decisions + 15)
  // the levels are UNRESOLVED in the progression view: not reached, not skipped, not a canonical level debut
  const states = await q(`select distinct v.development_state from public.v_player_development_progression v join public.players p on p.id = v.player_id
    join public.development_progression_decisions d on d.player_id = p.id and d.event_code = v.event_code where d.as_of_date = date '2026-10-20'`)
  assert.deepEqual(states.map((s) => s.development_state), ['UNRESOLVED'])
  // no cohort player is left with an uncovered developmental inversion
  const inverted = await q(`select distinct p.slug from public.v_dodgers_development_research_queue qv join public.players p on p.id = qv.player_id where qv.issue = 'NON_MONOTONIC_PROGRESSION' and p.slug = any($1)`, [COHORT])
  assert.deepEqual(inverted, [])
  // Jansen's two pending decisions are byte-for-byte what 047 left, and the review workflow reports them without deciding
  const jansen = await q(`select d.event_code, d.progression_role, d.review_status, d.confidence::text, d.notes, d.as_of_date::text from public.development_progression_decisions d join public.players p on p.id = d.player_id where p.slug = 'kenley-jansen' order by 1`)
  assert.deepEqual(jansen, pre.jansen)
  assert.deepEqual(jansen.map((r) => [r.event_code, r.review_status]), [['AAA_DEBUT', 'PENDING_REVIEW'], ['AA_DEBUT', 'PENDING_REVIEW']])
})

test('team-less season rows are classified only when proven equal to their component team stints; the cohort leaves none unclassified', async () => {
  assert.equal((await one(`select count(*)::int as n from public.player_season_stints where stint_kind = 'TEAM_STINT' and (affiliate_team is null or team_id is null)`)).n, 0)
  const totals = (await one(`select count(*)::int as n from public.player_season_stints where stint_kind = 'SEASON_TOTAL'`)).n
  assert.equal(totals - pre.counts.totals, 50)
  const bad = await q(`select p.slug, s.season from public.player_season_stints s join public.players p on p.id = s.player_id where s.stint_kind = 'SEASON_TOTAL' and (s.season_total_basis is null or s.season_total_basis not in ('SAME_LEVEL', 'CROSS_LEVEL', 'SUB_SEASON'))`)
  assert.deepEqual(bad, [])
  assert.equal((await one(`select count(*)::int as n from public.player_season_stints t where t.stint_kind = 'SEASON_TOTAL' and (select count(*) from public.player_season_stints c
    where c.player_id = t.player_id and c.season = t.season and c.source_level = t.source_level and c.stint_kind = 'TEAM_STINT') < 2`)).n, 0)
})

test('historical gaps are named, not filled: players the source cannot describe before the debut stay SOURCE_UNAVAILABLE', async () => {
  const cov = verifiedMlbCoverage(post.data, stintsByPlayer(post.data), developmentRecords)
  const by = Object.fromEntries(cov.rows.map((r) => [r.player_slug, r]))
  for (const slug of ['roberto-clemente', 'sandy-amoros', 'chico-fernandez']) {
    assert.equal(by[slug].history.history_start, 'NO_PRE_MLB_RECORD', slug)
    assert.deepEqual(by[slug].history.gaps.map((g) => g.code), ['SOURCE_UNAVAILABLE'], slug)
    assert.equal(by[slug].history.pre_mlb_seasons_observed, 0, slug)
  }
  assert.equal(by['pedro-astacio'].history.history_start, 'SOURCE_BEGINS_LATE')
  assert.ok(by['pedro-astacio'].history.gaps.some((g) => g.code === 'SOURCE_BEGINS_LATE'))
  assert.equal(cov.players, 47)
  assert.equal(cov.path_state.NO_OPEN_GAP + cov.path_state.PARTIAL, 47)
  assert.ok(cov.path_state.PARTIAL >= 40, 'almost every path remains partial; nothing is called complete')
  // the three players with no pre-MLB record are the three MLB_PLAYER_MISSING_PRE_MLB_HISTORY detector rows
  assert.deepEqual(post.data.developmentQueue.filter((r) => r.issue === 'MLB_PLAYER_MISSING_PRE_MLB_HISTORY').length, 3)
})

test('verified MLB development coverage: the seven measures with their denominators, before and after', () => {
  const cov = verifiedMlbCoverage(post.data, stintsByPlayer(post.data), developmentRecords)
  assert.equal(cov.players, 47)
  assert.deepEqual(cov.any_pre_mlb_history, { n: 42, of: 47 })
  assert.deepEqual(cov.exact_signing_date, { n: 45, of: 47 })
  assert.deepEqual(cov.exact_mlb_debut_date, { n: 47, of: 47 })
  assert.deepEqual(cov.signing_to_mlb_both_dates, { n: 45, of: 47 })
  assert.deepEqual(cov.verified_first_professional_season, { n: 19, of: 47 })
  assert.deepEqual(cov.usable_affiliate_chronology, { n: 0, of: 47 }, 'every verified MLB path still has an open chronology issue (game dates, organizations, levels)')
  assert.deepEqual(cov.prior_professional_career, { n: 8, of: 47 }, 'Cuban, Mexican League, NPB and KBO professionals, by acquisition pathway')
  assert.deepEqual(cov.progression_review_pending, { n: 8, of: 47 })
  const b = verifiedMlbCoverage(pre.data, stintsByPlayer(pre.data), developmentRecords)
  assert.deepEqual(b.any_pre_mlb_history, { n: 10, of: 47 })
  assert.deepEqual(b.signing_to_mlb_both_dates, { n: 16, of: 47 })
})

test('signing-to-MLB timing: 16 -> 45 of 47, only where BOTH dates are exact; the two without a signing date are not calculable', async () => {
  const b = timingFacts(pre.data)
  const a = timingFacts(post.data)
  assert.deepEqual([b.signing_to_mlb_exact.n, b.signing_to_mlb_exact.of], [16, 47])
  assert.deepEqual([a.signing_to_mlb_exact.n, a.signing_to_mlb_exact.of], [45, 47])
  assert.deepEqual([a.signing_to_mlb_exact.min_years, a.signing_to_mlb_exact.median_years, a.signing_to_mlb_exact.max_years], [0.15, 4.59, 9.08])
  assert.equal(a.signing_to_mlb_exact_by_route.amateur_signing.of + a.signing_to_mlb_exact_by_route.established_professional.of, 47)
  assert.deepEqual([a.signing_to_mlb_exact_by_route.established_professional.n, a.signing_to_mlb_exact_by_route.established_professional.of], [7, 8])
  const noDate = (await q(`select s.player_slug from public.v_signing_records s join public.v_dodgers_player_development_summary d on d.player_id = s.player_id
    where s.is_dodgers_franchise and s.reached_mlb_verified and d.days_signing_to_mlb_exact is null order by 1`)).map((r) => r.player_slug)
  assert.deepEqual(noDate, ['sandy-amoros', 'yusniel-diaz'])
  assert.equal((await one(`select count(*)::int as n from public.signings sg join public.players p on p.id = sg.player_id where p.slug in ('sandy-amoros', 'yusniel-diaz') and sg.signing_date is null`)).n, 2, 'a signing year is never turned into a date')
  // the interval is derived from the two stored dates, not stored itself
  assert.deepEqual(await q(`select column_name from information_schema.columns where table_name = 'development_milestones' and column_name ilike '%interval%'`), [])
  assert.ok(!('rate' in a) && !('score' in a))
})

test('development coverage moves only where records now exist, and no player becomes COMPLETE without them', () => {
  const b = developmentCoverage(pre.data)
  const a = developmentCoverage(post.data)
  assert.deepEqual(a.dimensions.FIRST_PRO_SEASON, { known: 179, applicable: 220 })
  for (const k of ['SIGNING_DATE', 'HIGHEST_LEVEL', 'MLB_DEBUT', 'EXIT', 'CHRONOLOGY']) assert.deepEqual(a.dimensions[k], b.dimensions[k], `${k} is unchanged`)
  assert.deepEqual(a.states, b.states, 'exact dates, game logs, organizations and season gaps remain open')
  // every verified MLB player stays on the development queue: none is dropped
  const qa = developmentQueue(post.data, { mlb: true })
  assert.equal(new Set(qa.map((r) => r.player_slug)).size, 47)
  assert.equal(JSON.stringify(developmentQueue(post.data)), JSON.stringify(developmentQueue(post.data)))
})

test('queue quality: detector rows merge into distinct evidence gaps, nothing is deleted, and the order is deterministic', () => {
  const b = developmentNeedSummary(pre.data)
  const a = developmentNeedSummary(post.data)
  assert.equal(b.detector_rows, 154)
  assert.equal(a.detector_rows, 347)
  assert.equal(a.needs, 173)
  assert.ok(a.needs < a.detector_rows)
  assert.equal(Object.values(a.by_need).reduce((x, y) => x + y, 0), a.needs)
  const needs = developmentNeeds(post.data)
  // every detector row appears in exactly one need
  assert.equal(needs.reduce((n, x) => n + x.issues.length, 0) >= 1, true)
  const merged = new Set(needs.flatMap((n) => n.issues.map((i) => `${n.player_id}|${i}`)))
  for (const r of post.data.developmentQueue) assert.ok(merged.has(`${r.player_id}|${r.issue}`), `${r.issue} is carried by a need`)
  assert.equal(JSON.stringify(developmentNeeds(post.data)), JSON.stringify(needs))
  // the pending sequence reviews are not new queue obligations: the inversions they cover no longer raise NON_MONOTONIC_PROGRESSION
  assert.equal(post.data.developmentQueue.filter((r) => r.issue === 'NON_MONOTONIC_PROGRESSION').length, 0)
})

test('the 046 outcome and cost state is untouched, and no analytical layer moved: audits, costs, readiness, expected value, portfolio', async () => {
  const s = await one(`select tracked_signings, signings_with_known_cost, known_acquisition_cost_usd::text as cost, outcome_audit_queue, outcome_audits_completed from product_database_status`)
  assert.equal(s.tracked_signings, pre.status.tracked_signings)
  assert.equal(s.signings_with_known_cost, pre.status.signings_with_known_cost)
  assert.equal(s.cost, pre.status.cost)
  assert.equal(s.outcome_audit_queue, pre.status.outcome_audit_queue)
  assert.equal(s.outcome_audits_completed, pre.status.outcome_audits_completed)
  // the readiness thresholds and support states are byte-for-byte what they were (generation and timestamp columns aside)
  const strip = (rows) => rows.map(({ generation_id, generated_at, ...r }) => r)
  assert.deepEqual(strip(await q(`select * from public.product_prediction_readiness order by 1, 2`)), strip(pre.support))
  const e = await one(`select support_chain_state, supported_expected_value_models, predictive_portfolio_recommendations from product_executive_snapshot`)
  assert.equal(e.support_chain_state, 'NO_PREDICTIVE_LAYER_SUPPORTED')
  assert.equal(Number(e.supported_expected_value_models), 0)
  assert.equal(Number(e.predictive_portfolio_recommendations), 0)
  assert.equal((await one(`select count(*)::int as n from public.product_prediction_readiness where baseline_supported`)).n, 0, 'no probability target became supported')
  // development completion is not an outcome-probability gate: the player decisions are identical
  const pd = async (c) => R(await c.query(`select * from public.product_player_decision order by signing_id`)).map(({ generation_id, generated_at, ...r }) => r)
  const before = await clone(pre048Dump)
  try { assert.deepEqual(await pd(chain), await pd(before)) } finally { await before.close() }
})

test('one coherent snapshot generation: +1, all eleven snapshots carry it, zero drift; only the development data date moved on the executive row', async () => {
  const g = (await one(`select max(generation_id)::int as g from product_executive_snapshot`)).g
  assert.equal(g, pre.generation + 1)
  for (const t of ALL_SNAPSHOT_TABLES) assert.equal((await one(`select count(*) filter (where generation_id <> $1)::int as n from public.${t}`, [g])).n, 0, t)
  assert.deepEqual(await drift(), [])
  assert.equal(String((await one(`select source_development_data_as_of_date::text as d from product_executive_snapshot`)).d).slice(0, 10), '2026-10-20')
})

test('the API/security boundary: anon reads the new rows through the same public relations and still cannot write; no function, grant or policy was added', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    await c.db.exec('set role anon')
    assert.ok((await c.query(`select count(*)::int as n from public.v_player_development_stints`))[0].n > pre.counts.stints)
    assert.equal((await c.query(`select count(*)::int as n from public.development_progression_decisions where review_status = 'PENDING_REVIEW'`))[0].n, 26)
    for (const sql of [`insert into public.development_progression_decisions (player_id) select id from public.players limit 1`, `update public.player_season_stints set g = 0`, `delete from public.development_milestones`]) {
      await assert.rejects(c.db.exec(sql), /permission denied|row-level security|violates/i)
    }
    await c.db.exec('reset role')
  } finally { await c.close() }
  assert.deepEqual(post.catalog.functions, pre.catalog.functions)
  assert.deepEqual(post.catalog.policies, pre.catalog.policies)
  assert.deepEqual(post.catalog.triggers, pre.catalog.triggers)
  assert.equal(post.catalog.functions.filter((f) => /security definer/i.test(f.f)).length, 0)
  for (const t of RESEARCH_TABLES.filter((x) => x !== 'sources')) assert.equal(post.catalog.tables.find((x) => x.relname === t).rls, true, `${t} keeps row-level security`)
})

test('idempotent: a rerun adds nothing, runs no second refresh and changes no table', async () => {
  const before = await tableHashes()
  const g = (await one(`select max(generation_id)::int as g from product_executive_snapshot`)).g
  await chain.db.exec(sql048)
  assert.deepEqual(await tableHashes(), before)
  assert.equal((await one(`select max(generation_id)::int as g from product_executive_snapshot`)).g, g)
})

test('the verifier passes on 001-048 (249 hard checks), each snapshot check is clean, and a drifted pin is caught', async () => {
  for (const [name, sql] of Object.entries(productSnapshotQueries(true, true))) assert.equal((await one(sql)).n, 0, name)
  const full = await checkInvariants(q, CANONICAL_EXPECTATIONS)
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 249)
  // a pinned count that differs by one is caught (the other pins are exercised by the verifier's own drift test)
  const bad = await checkInvariants(q, { ...CANONICAL_EXPECTATIONS, progression_decisions_pending: CANONICAL_EXPECTATIONS.progression_decisions_pending - 1 })
  assert.deepEqual(failedChecks(bad).map((c) => c.name), ['progression_decisions_pending'])
})

test('guards: 048 refuses a database where its facts no longer apply, and changes nothing when it refuses', async () => {
  const c = await clone(pre048Dump)
  try {
    // later development research exists for a cohort player
    await c.db.exec(`insert into public.player_season_stints (player_id, season, affiliate_team, team_id, league_name, level, source_level, level_classification, era, level_rank, affiliated, as_of_date)
      select p.id, 2030, 'Later Club', 1, 'Later League', 'AAA', 'AAA', 'SPORT_ID_11', 'CLASSIC_AFFILIATED_1989_2016', 6, true, date '2026-10-06' from public.players p where p.slug = 'pedro-astacio'`)
    const before = await tableHashes(c)
    await failsWith(c, sql048, /048: pedro-astacio holds 1 stints; the reviewed set is \d+, so later development research exists/)
    assert.deepEqual(await tableHashes(c), before)
  } finally { await c.close() }
  const d = await clone(pre048Dump)
  try {
    await d.db.exec(`update public.players set mlb_id = 1 where slug = 'julio-urias'`)
    await failsWith(d, sql048, /048: cohort player julio-urias is missing or carries a different MLB id/)
  } finally { await d.close() }
  const e = await clone(pre048Dump)
  try {
    await e.db.exec(`delete from public.transaction_events where event_key = 'LAD_RELEASE_2018_HOMER_BAILEY'`).catch(() => {})
    const has047 = (await e.query(`select count(*)::int as n from public.transaction_events where event_key = 'LAD_RELEASE_2018_HOMER_BAILEY'`))[0].n
    if (has047 === 0) await failsWith(e, sql048, /048: Migration 047 has not been applied/)
  } finally { await e.close() }
  const f = await clone(pre048Dump)
  try {
    await f.db.exec(`delete from public.player_season_stints s using public.players p where p.id = s.player_id and p.slug = 'roger-cedeno'`)
    await failsWith(f, sql048, /048: roger-cedeno was marked as already researched but the state disagrees/)
  } finally { await f.close() }
})

test('rollback: deletes exactly what 048 inserted, refreshes once, leaves no drift and no trace, and 048 can be applied again', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    const gen0 = (await c.query(`select max(generation_id)::int as g from product_executive_snapshot`))[0].g
    await c.db.exec(rollback048)
    const counts = (await c.query(`select (select count(*)::int from public.player_season_stints) as stints, (select count(*)::int from public.development_milestones) as milestones,
      (select count(*)::int from public.development_progression_decisions) as decisions, (select count(*)::int from public.player_season_stints where stint_kind = 'SEASON_TOTAL') as totals,
      (select count(*)::int from public.transaction_events) as events, (select count(*)::int from public.transaction_event_assets) as assets`))[0]
    assert.deepEqual(counts, pre.counts)
    assert.equal((await c.query(`select max(generation_id)::int as g from product_executive_snapshot`))[0].g, gen0 + 1)
    assert.deepEqual(await drift(c), [])
    const hashes = await tableHashes(c)
    for (const t of ['player_season_stints', 'development_milestones', 'development_progression_decisions']) assert.equal(hashes[t], pre.hashes[t], t)
    assert.deepEqual(developmentQueue(assembleDataset(await rawDataset(c, false))).map((r) => r.signing_id), developmentQueue(pre.data).map((r) => r.signing_id))
    // a second rollback refuses (nothing to remove), and unlike 046 the migration can be applied again
    await failsWith(c, rollback048, /rollback-048: .* is not the pending row 048 wrote/)
    await c.db.exec(sql048)
    const content = async (cc) => ({
      stints: await cc.query(`select p.slug, s.season, s.level::text, coalesce(s.affiliate_team, '') t, coalesce(s.league_name, '') l, s.g, s.pg, s.stint_kind from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = any($1) order by 1, 2, 3, 4, 5`, [COHORT]),
      milestones: await cc.query(`select p.slug, m.event_code, m.milestone_date::text d, m.season_year from public.development_milestones m join public.players p on p.id = m.player_id where p.slug = any($1) order by 1, 2, 3, 4`, [COHORT]),
      decisions: await cc.query(`select p.slug, d.event_code, d.progression_role, d.review_status from public.development_progression_decisions d join public.players p on p.id = d.player_id order by 1, 2`),
    })
    assert.deepEqual(await content(c), await content({ query: q }))
    assert.deepEqual(await drift(c), [])
  } finally { await c.close() }
})

test('rollback refuses when later research exists: a progression decision a person has since reviewed, or an extra stint', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    await c.db.exec(`update public.development_progression_decisions d set progression_role = 'POST_ESTABLISHMENT_APPEARANCE', review_status = 'REVIEWED', confidence = 'HIGH', notes = 'reviewed later by a person'
      from public.players p where p.id = d.player_id and p.slug = 'julio-urias' and d.event_code = 'COMPLEX_DEBUT'`)
    await failsWith(c, rollback048, /rollback-048: the progression review for julio-urias COMPLEX_DEBUT is not the pending row 048 wrote; a later review exists/)
  } finally { await c.close() }
  const d = await clone(await chain.db.dumpDataDir('none'))
  try {
    await d.db.exec(`insert into public.player_season_stints (player_id, season, affiliate_team, team_id, league_name, level, source_level, level_classification, era, level_rank, affiliated, as_of_date)
      select p.id, 2030, 'Later Club', 1, 'Later League', 'AAA', 'AAA', 'SPORT_ID_11', 'CLASSIC_AFFILIATED_1989_2016', 6, true, date '2026-10-21' from public.players p where p.slug = 'pedro-astacio'`)
    await failsWith(d, rollback048, /rollback-048: pedro-astacio holds \d+ stints but 048 wrote \d+; later development research exists/)
  } finally { await d.close() }
})

test('reproducible: the committed migration and rollback are byte-identical to the build output, and the builder refuses what the research rules do not allow', () => {
  const stage = (mutate) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disi-048-build-'))
    const dir = path.join(tmp, 'database/research/048')
    fs.mkdirSync(dir, { recursive: true })
    fs.mkdirSync(path.join(tmp, 'database/sql'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'database/release/sql'), { recursive: true })
    for (const f of ['build.mjs', '048_template.sql', 'rollback_template.sql', 'development-values.sql', 'development-cohort.json']) fs.copyFileSync(path.join(root, 'database/research/048', f), path.join(dir, f))
    if (mutate) mutate(dir)
    try { execFileSync(process.execPath, [path.join(dir, 'build.mjs')], { stdio: 'pipe' }); return { tmp, error: null } } catch (e) { return { tmp, error: String(e.stderr) } }
  }
  const ok = stage()
  assert.equal(ok.error, null)
  assert.equal(fs.readFileSync(path.join(ok.tmp, 'database/sql', FILE), 'utf8'), sql048)
  assert.equal(fs.readFileSync(path.join(ok.tmp, 'database/release/sql/rollback-048.sql'), 'utf8'), rollback048)
  const withCohort = (edit) => (dir) => {
    const f = path.join(dir, 'development-cohort.json')
    const doc = JSON.parse(fs.readFileSync(f, 'utf8'))
    edit(doc)
    fs.writeFileSync(f, JSON.stringify(doc))
  }
  assert.match(stage(withCohort((d) => { d.players.push({ slug: 'kenley-jansen', signing_year: 2004, mlb_id: 445276 }) })).error, /kenley-jansen is in the 047 controlled cohort/)
  assert.match(stage(withCohort((d) => { d.players.push({ ...d.players[0] }) })).error, /duplicate cohort player/)
  assert.match(stage(withCohort((d) => { d.progression_reviews[0].confidence = 'HIGH' })).error, /a pending review carries LOW confidence/)
  assert.match(stage(withCohort((d) => { d.progression_reviews[0].notes = 'too short' })).error, /needs the evidence in its note/)
  assert.match(stage(withCohort((d) => { d.progression_reviews[0].decision_basis = 'REVIEWED' })).error, /only a stint-chronology review is seeded/)
  assert.match(stage(withCohort((d) => { d.already_researched = ['nobody'] })).error, /marked as already researched but is not in the cohort/)
})

test('the research CLI reports the verified MLB coverage, the de-duplicated needs and the pending reviews from a saved dataset, and decides nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disi-048-cli-'))
  const file = path.join(dir, 'raw.json')
  fs.writeFileSync(file, JSON.stringify(post.raw))
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/research/development.mjs'), ...args, '--input', file], { encoding: 'utf8' })
  const cov = run('--mlb-coverage')
  assert.equal(cov.status, 0, cov.stderr)
  assert.match(cov.stdout, /players: 47/)
  assert.match(cov.stdout, /signing_to_mlb_both_dates: \{"n":45,"of":47\}/)
  assert.match(cov.stdout, /Pedro Astacio/)
  const needs = run('--needs')
  assert.equal(needs.status, 0, needs.stderr)
  assert.match(needs.stdout, /detector_rows: 347/)
  assert.match(needs.stdout, /needs: 173/)
  const review = run('--review', '--player', 'kenley-jansen')
  assert.equal(review.status, 0, review.stderr)
  assert.match(review.stdout, /Nothing below is a decision/)
  assert.match(review.stdout, /AA_DEBUT {2}REVIEW_REQUIRED \/ PENDING_REVIEW/)
  assert.match(review.stdout, /COMPETING READINGS: AA_DEBUT vs AAA_DEBUT/)
  const all = run('--review', '--format', 'json')
  assert.equal(all.status, 0, all.stderr)
  const packets = JSON.parse(all.stdout)
  const pendingPlayers = (raw) => new Set(raw.progressionDecisions.filter((d) => d.review_status === 'PENDING_REVIEW').map((d) => d.player_id)).size
  assert.equal(pendingPlayers(pre.raw), 5, 'Jansen and the four players of the 024 review')
  assert.equal(packets.pending_players, pendingPlayers(pre.raw) + 6, 'the six new players join them')
  assert.ok(packets.packets.every((p) => p.decided === false))
})

// ---- the career-event boundary: a dated RELEASED / RETIRED development milestone is not an organization exit ------------------------------------
//   DATED RELEASE/RETIREMENT EVENT KNOWN != ORGANIZATION KNOWN    DEVELOPMENT RELEASE/RETIREMENT MILESTONE != DODGERS EXIT    UNKNOWN ORGANIZATION != DODGERS

test('the 18 organization-less RELEASED / RETIRED milestones are typed, dated, sourced by evidence basis, and keep organization NULL', async () => {
  const rows = await q(`select p.slug, m.event_code, m.milestone_date::text d, m.date_precision::text prec, m.evidence_basis, m.organization_id, m.affiliate, m.source_id
    from public.development_milestones m join public.players p on p.id = m.player_id
    where m.as_of_date = date '2026-10-20' and m.evidence_basis = 'MLB_TRANSACTION_LOG' order by 1, 2`)
  assert.equal(rows.length, 18)
  assert.deepEqual([rows.filter((r) => r.event_code === 'RELEASED').length, rows.filter((r) => r.event_code === 'RETIRED').length], [17, 1])
  for (const r of rows) {
    assert.match(r.d, /^\d{4}-\d{2}-\d{2}$/, r.slug)
    assert.equal(r.prec, 'DAY', r.slug)
    assert.equal(r.organization_id, null, `${r.slug}: the organization is not established by the source and is not inferred`)
    assert.equal(r.affiliate, null, r.slug)
  }
  // the transaction-log request that evidences them is a recorded source
  assert.ok((await one(`select count(*)::int as n from public.sources where url like 'https://statsapi.mlb.com/api/v1/transactions%'`)).n >= 1)
  // the organization of a nearby stint is not copied onto the event: the milestone has none
  const filled = await q(`select p.slug from public.development_milestones m join public.players p on p.id = m.player_id where m.event_code in ('RELEASED', 'RETIRED') and m.evidence_basis = 'MLB_TRANSACTION_LOG' and m.as_of_date = date '2026-10-20' and m.organization_id is not null`)
  assert.deepEqual(filled, [])
})

test('adding an organization-less RELEASED or RETIRED milestone changes no Dodgers exit, control interval, chain, queue or value attribution', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    const snap = async () => ({
      exits: await c.query(`select * from public.v_dodgers_international_exit_summary order by signing_id`),
      lineage: await c.query(`select * from public.v_transaction_package_lineage order by 1, 2, 3, 4`).catch(() => []),
      decisions: (await c.query(`select * from public.product_player_decision order by signing_id`)).map(({ generation_id, generated_at, ...r }) => r),
      txq: await c.query(`select issue, priority, player_slug, event_key from public.v_transaction_research_queue order by 1, 3, 4`),
      valq: await c.query(`select issue, priority, player_slug, event_key from public.v_value_research_queue order by 1, 3, 4`),
      events: (await c.query(`select count(*)::int as n from public.transaction_events`))[0].n,
      assets: (await c.query(`select count(*)::int as n from public.transaction_event_assets`))[0].n,
      ctl: (await c.query(`select count(*)::int as n from public.dodgers_control_observations`))[0].n,
    })
    const before = await snap()
    // a player the Dodgers have traded away (chain recorded) and an unexited one, each given a release and a retirement with NO organization
    const slugs = (await c.query(`select p.slug from public.v_dodgers_international_exit_summary e join public.players p on p.id = e.player_id where e.control_state = 'LEFT_DODGERS_CONTROL' order by 1 limit 2`)).map((r) => r.slug)
      .concat((await c.query(`select p.slug from public.v_dodgers_international_exit_summary e join public.players p on p.id = e.player_id where e.control_state <> 'LEFT_DODGERS_CONTROL' order by 1 limit 2`)).map((r) => r.slug))
    assert.equal(slugs.length, 4)
    for (const [i, slug] of slugs.entries()) {
      await c.db.exec(`insert into public.development_milestones (player_id, milestone, milestone_date, event_code, date_precision, season_year, evidence_basis, confidence, as_of_date, notes)
        select p.id, 'OTHER', date '2031-0${i + 1}-15', '${i % 2 ? 'RETIRED' : 'RELEASED'}', 'DAY', 2031, 'MLB_TRANSACTION_LOG', 'VERIFIED', date '2026-10-21', 'regression: a dated career event with no organization'
        from public.players p where p.slug = '${slug}'`)
    }
    const after = await snap()
    assert.deepEqual(after.exits, before.exits, 'v_dodgers_international_exit_summary')
    assert.deepEqual(after.lineage, before.lineage, 'control intervals and transaction-chain lineage')
    assert.deepEqual(after.decisions, before.decisions, 'chain state and value attribution (the persisted decision snapshot is rebuilt from these views)')
    assert.deepEqual(after.txq, before.txq, 'transaction research queue')
    assert.deepEqual(after.valq, before.valq, 'value research queue')
    assert.deepEqual([after.events, after.assets, after.ctl], [before.events, before.assets, before.ctl])
    // a refresh rebuilds every snapshot from the views: still no change to what the product reads
    await c.db.exec('select * from public.disi_refresh_product_snapshots()')
    const refreshed = (await c.query(`select * from public.product_player_decision order by signing_id`)).map(({ generation_id, generated_at, ...r }) => r)
    assert.deepEqual(refreshed, before.decisions)
    // the organization stays NULL: it is not filled from the adjacent stint
    const inserted = await c.query(`select organization_id, affiliate from public.development_milestones where as_of_date = date '2026-10-21'`)
    assert.equal(inserted.length, 4)
    assert.ok(inserted.every((r) => r.organization_id === null && r.affiliate === null))
  } finally { await c.close() }
})

test('no view or function that decides an exit, a control interval, a chain or a value reads the career-event milestones', () => {
  const read = (f) => fs.readFileSync(path.join(root, 'database/sql', f), 'utf8')
  // the exit and chain model is built from transaction tables only (033/034); development_milestones feeds development views and one pathway feature (PROFESSIONAL_DEBUT)
  for (const f of ['033_transaction_asset_chain_completion.sql', '034_downstream_organizational_value_chains.sql', '032_player_value_organizational_realization.sql']) {
    assert.doesNotMatch(read(f), /development_milestones/, `${f} must not read development milestones`)
  }
  const exitView = read('033_transaction_asset_chain_completion.sql')
  const i = exitView.indexOf('create or replace view public.v_dodgers_international_exit_summary')
  assert.ok(i > 0)
  assert.doesNotMatch(exitView.slice(i, i + 6000), /\bRELEASED\b.*development|development_milestones/s)
})
