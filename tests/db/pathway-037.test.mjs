// Migration 037: development pathway intelligence. The 036 database is replayed (001-036), 037 is applied for real, and the season
// path, the pathway features and classes, the summary gates, the research queue and the verifier are checked against the 021-024
// facts and the 036 outcome spine.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { pathwayQueries, PATHWAY_CHECK_NAMES } from '../../scripts/db/lib/pathway-invariants.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '037_development_pathway_intelligence.sql'
const sql037 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const VIEWS = ['v_player_development_season_path', 'v_player_development_pathway', 'v_development_pathway_summary', 'v_development_pathway_research_queue']
const EXPECT037 = { ...CANONICAL_EXPECTATIONS, public_views_total: 121, public_tables_total: 60 }

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
let before037
before(async () => {
  chain = await buildChainThrough('036_scouting_expectation_outcomes.sql')
  before037 = {
    hashes: await tableHashes(),
    spine: md5(await q(`select * from v_player_realized_outcome order by signing_id`)),
    expectation: md5(await q(`select * from v_player_expectation_vs_outcome order by player_id, band_family nulls first`)),
    summary: md5(await q(`select * from v_dodgers_player_development_summary order by player_id`)),
  }
  await chain.db.exec(sql037)
}, { timeout: 300000 })
after(async () => { await chain?.close() })

const failing = async () => {
  const out = []
  for (const [name, sql] of Object.entries(pathwayQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
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
/** Adds a team stint for a player and season, copying the shape of one of the player's existing stints. */
const addStint = (slug, season, level, games) => chain.db.exec(`
  insert into player_season_stints (player_id, season, organization_id, organization_name, affiliate_team, league_name, source_level, level,
    level_classification, era, affiliated, g, as_of_date, stint_kind)
  select s.player_id, ${season}, s.organization_id, s.organization_name, 'Test ${level} ${season}', 'Test league', '${level}', '${level}',
    s.level_classification, s.era, true, ${games}, s.as_of_date, 'TEAM_STINT'
  from player_season_stints s join players p on p.id = s.player_id
  where p.slug = '${slug}' and s.stint_kind = 'TEAM_STINT' order by s.season desc limit 1`)

test('037 shape: no table, four security-invoker views, SELECT-only grants, one transaction', async () => {
  const c = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
  assert.deepEqual(c, { tables: 60, views: 121 })
  const v = await q(`select relname, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) and relkind = 'v' order by 1`, [VIEWS])
  assert.deepEqual(v.map((r) => r.relname), [...VIEWS].sort())
  for (const r of v) assert.match(r.opts, /security_invoker=true/)
  const acl = await q(`select c.relname, r.rolname as grantee, a.privilege_type as p from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)`, [VIEWS])
  assert.deepEqual([...new Set(acl.map((a) => a.p))], ['SELECT'])
  assert.equal(acl.length, VIEWS.length * 2)
  assert.match(sql037, /^begin;$/m)
  assert.match(sql037, /^commit;$/m)
})

test('037 is derived only: no table changes; the 036 spine and comparison and the 021-024 summary are byte-identical', async () => {
  assert.deepEqual(await tableHashes(), before037.hashes)
  assert.equal(md5(await q(`select * from v_player_realized_outcome order by signing_id`)), before037.spine)
  assert.equal(md5(await q(`select * from v_player_expectation_vs_outcome order by player_id, band_family nulls first`)), before037.expectation)
  assert.equal(md5(await q(`select * from v_dodgers_player_development_summary order by player_id`)), before037.summary)
})

test('season path: one row per affiliated player-season; transitions as observed; 2020 is never an absence', async () => {
  const t = Object.fromEntries((await q(`select transition, count(*)::int as n from v_player_development_season_path group by 1`)).map((r) => [r.transition, r.n]))
  assert.deepEqual(t, { FIRST_SEASON: 167, PROMOTED: 182, REPEATED: 194, REGRESSED: 7, RETURNED_AFTER_ABSENCE: 10 })
  const across2020 = await q(`select absent_seasons_before, transition from v_player_development_season_path where previous_season = 2019 and season = 2021`)
  assert.ok(across2020.length > 0)
  for (const r of across2020) {
    assert.equal(r.absent_seasons_before, 0)
    assert.notEqual(r.transition, 'RETURNED_AFTER_ABSENCE')
  }
})

test('a short cameo at a higher level is not a promotion: the primary level is the level with the most games', async () => {
  await scratch(async () => {
    const before = await one(`select primary_level, highest_level, transition from v_player_development_season_path where player_slug = 'adrian-torres' and season = 2025`)
    await addStint('adrian-torres', 2025, 'AAA', 2)
    const after = await one(`select primary_level, highest_level, transition from v_player_development_season_path where player_slug = 'adrian-torres' and season = 2025`)
    assert.deepEqual([after.primary_level, after.transition], [before.primary_level, before.transition])
    assert.equal(after.highest_level, 'AAA')
  })
})

test('pathway classes: one row per Dodgers signing, the documented distribution, professional signings off the amateur ladder', async () => {
  const d = Object.fromEntries((await q(`select pathway_class, count(*)::int as n from v_player_development_pathway group by 1`)).map((r) => [r.pathway_class, r.n]))
  assert.deepEqual(d, { EARLY_EXIT: 49, FAST_TRACK: 9, INSUFFICIENT_HISTORY: 49, NONLINEAR: 5, NOT_CLASSIFIED_PROFESSIONAL_SIGNING: 8,
    SLOW_PROGRESSION: 8, STALLED: 7, STANDARD_PROGRESSION: 9, STILL_DEVELOPING: 76 })
  const pros = await q(`select pathway, pathway_status from v_player_development_pathway where pathway_class = 'NOT_CLASSIFIED_PROFESSIONAL_SIGNING'`)
  assert.equal(pros.length, 8)
  for (const r of pros) assert.ok(['CUBAN_PRO', 'JAPAN_PRO', 'KOREA_PRO', 'POSTED_PLAYER', 'MEXICAN_LEAGUE_TRANSFER'].includes(r.pathway))
  const young = await one(`select count(*)::int as n from v_player_development_pathway where pathway_class = 'STILL_DEVELOPING' and (not active_affiliated or seasons_since_debut >= 6)`)
  assert.equal(young.n, 0)
})

test('a young active player is never an exit: a new affiliated season moves an EARLY_EXIT player back to an active class', async () => {
  await scratch(async () => {
    const before = await one(`select pathway_class, pathway_status from v_player_development_pathway where player_slug = 'anderson-jerez'`)
    assert.deepEqual(before, { pathway_class: 'EARLY_EXIT', pathway_status: 'NO_RECENT_AFFILIATED_RECORD' })
    await addStint('anderson-jerez', 2026, 'INTERNATIONAL_ROOKIE', 20)
    const after = await one(`select pathway_class, pathway_status from v_player_development_pathway where player_slug = 'anderson-jerez'`)
    assert.notEqual(after.pathway_class, 'EARLY_EXIT')
    assert.equal(after.pathway_status, 'ACTIVE_AFFILIATED')
    assert.deepEqual(await failing(), [])
  })
})

test('summary: shares only for 10+ mature players, never for coverage artefacts, and the Double-A share only for early velocity', async () => {
  const s = await q(`select dimension, dimension_value, pathway, mature_players, mature_reached_aa_share::float as aa, mature_reached_mlb_share::float as mlb, sample_state
    from v_development_pathway_summary where mature_reached_aa_share is not null or mature_reached_mlb_share is not null order by 1, 2, 3`)
  assert.deepEqual(s.map((r) => [r.dimension, r.dimension_value, r.pathway, r.mature_players, r.aa, r.mlb, r.sample_state]), [
    ['EARLY_VELOCITY', 'FULL_SEASON_BY_SEASON_2', 'LATAM_AMATEUR', 11, 0.636, 0.091, 'DESCRIPTIVE_SAMPLE'],
    ['EARLY_VELOCITY', 'FULL_SEASON_NOT_REACHED', 'LATAM_AMATEUR', 13, 0, 0, 'DESCRIPTIVE_SAMPLE'],
    ['PATHWAY_CLASS', 'EARLY_EXIT', 'LATAM_AMATEUR', 21, null, 0, 'DESCRIPTIVE_SAMPLE'],
  ])
  const artefacts = await q(`select sample_state from v_development_pathway_summary where dimension = 'PATHWAY_CLASS' and dimension_value in ('INSUFFICIENT_HISTORY', 'NOT_CLASSIFIED_PROFESSIONAL_SIGNING')`)
  assert.ok(artefacts.length > 0)
  for (const r of artefacts) assert.equal(r.sample_state, 'COVERAGE_ARTEFACT_NOT_COMPARABLE')
  const blended = await one(`select count(*)::int as n from v_development_pathway_summary where pathway is null`)
  assert.equal(blended.n, 0, 'pathways are never blended')
  const wording = await q(`select distinct interpretation from v_development_pathway_summary`)
  for (const r of wording) {
    assert.match(r.interpretation, /^Observed players on this pathway/)
    assert.doesNotMatch(r.interpretation, /\bcauses?\b(?! an outcome)|predict|leads to/i)
  }
})

test('research queue: only new issue types, with reasons never inferred', async () => {
  const issues = Object.fromEntries((await q(`select issue, count(*)::int as n from v_development_pathway_research_queue group by 1`)).map((r) => [r.issue, r.n]))
  assert.deepEqual(issues, { LEVEL_REGRESSION_REASON_UNSOURCED: 8, PATHWAY_ARRIVAL_UNRESOLVED: 4, PROFESSIONAL_SIGNING_PATH_NOT_MODELLED: 8, PROLONGED_SAME_LEVEL_UNSOURCED: 7 })
  const old = (await q(`select distinct issue from v_dodgers_development_research_queue`)).map((r) => r.issue)
  for (const k of Object.keys(issues)) assert.ok(!old.includes(k), k)
})

test('no probability, forecast, score, rate, ROI or causal column exists in any 037 view', async () => {
  const cols = (await q(`select attname from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and a.attnum > 0 and not a.attisdropped`, [VIEWS])).map((r) => r.attname)
  for (const c of cols) assert.doesNotMatch(c, /probab|predict|forecast|score|_rate$|hit_rate|percentile|ranking|per_million|roi|causal|injur|reason/i, c)
})

test('verifier: the seven pathway checks pass, each catches its own drift, and the full verifier passes on the 037 database', async () => {
  assert.deepEqual(await failing(), [])
  assert.equal(PATHWAY_CHECK_NAMES.length, 7)
  const full = await checkInvariants(q, EXPECT037)
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 228, '201 through 037 plus the six 038 checks, which pass trivially without their views')
  const p = 'v_player_development_pathway'
  assert.ok((await drift(p, { pathway_class: `case when r.pathway_class = 'STILL_DEVELOPING' then 'EARLY_EXIT' else r.pathway_class end` })).includes('pathway_class_rule_violations'))
  assert.ok((await drift(p, { pathway_status: `case when r.pathway_status = 'REACHED_MLB' then 'ACTIVE_AFFILIATED' else r.pathway_status end` })).includes('pathway_status_violations'))
  assert.ok((await drift(p, { career_bwar: `coalesce(r.career_bwar, 0)` })).includes('pathway_outcome_passthrough_violations'))
  assert.ok((await drift(p, { seasons_to_aa: `r.seasons_to_aa - 10` })).includes('pathway_arrival_order_violations'))
  assert.ok((await drift('v_player_development_season_path', { transition: `case when r.transition = 'REPEATED' then 'PROMOTED' else r.transition end` })).includes('pathway_season_path_violations'))
  assert.ok((await drift('v_development_pathway_summary', { mature_reached_mlb_share: `0.9` })).includes('pathway_summary_sample_violations'))
})

test('rerun: the migration is idempotent and changes no data and no definition', async () => {
  const hashes = await tableHashes()
  const defs = async () => q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)
  const outputs = async () => md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2, 3, 4`))))
  const d1 = await defs()
  const o1 = await outputs()
  await chain.db.exec(sql037)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await defs(), d1)
  assert.equal(await outputs(), o1)
})

test('reproducible: building from the same inputs produces the committed bytes', () => {
  const before = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', FILE))).digest('hex')
  execFileSync(process.execPath, [path.join(root, 'database/research/037/build.mjs')], { cwd: root, stdio: 'pipe' })
  const afterHash = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', FILE))).digest('hex')
  assert.equal(afterHash, before)
})

test('frozen history: 037 adds views only; no table, no alteration, no data change', () => {
  assert.doesNotMatch(sql037, /\b(create|drop|alter) table\b/i)
  assert.doesNotMatch(sql037, /\b(drop|alter) (view|column)\b/i)
  assert.doesNotMatch(sql037, /\b(insert into|delete from|truncate|update public\.)/i)
})
