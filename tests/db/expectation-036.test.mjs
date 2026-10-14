// Migration 036: scouting expectation vs realized outcome. The 035 database is replayed (001-035), 036 is applied for real, and the
// bands, the outcome spine, the frozen anchors, the comparison states, the calibration sample gates, the research queue and the
// verifier are checked against the research.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { expectationQueries, EXPECTATION_CHECK_NAMES } from '../../scripts/db/lib/expectation-invariants.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '036_scouting_expectation_outcomes.sql'
const sql036 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const bands = JSON.parse(fs.readFileSync(path.join(root, 'database/research/036/bands.json'), 'utf8'))
const VIEWS = ['v_player_realized_outcome', 'v_scouting_expectation_observations', 'v_player_expectation_vs_outcome', 'v_scouting_calibration_summary',
  'v_scouting_expectation_research_queue']
const EXPECT036 = { ...CANONICAL_EXPECTATIONS, public_views_total: 117, public_tables_total: 60 }

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
let before036
before(async () => {
  chain = await buildChainThrough('035_international_benchmark_outcomes.sql')
  before036 = {
    hashes: await tableHashes(),
    dodgers: await q(`select * from v_player_organizational_realization order by signing_id`),
    benchmark: await q(`select * from v_international_benchmark_player_outcomes order by signing_id`),
  }
  await chain.db.exec(sql036)
}, { timeout: 300000 })
after(async () => { await chain?.close() })

const failing = async () => {
  const out = []
  for (const [name, sql] of Object.entries(expectationQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
  return out.sort()
}
/** Replaces a view with one that returns the real rows but with some columns overridden; rolled back by the caller. */
async function drift(view, overrides) {
  await chain.db.exec('begin;')
  try {
    const cols = (await q(`select attname from pg_attribute where attrelid = 'public.${view}'::regclass and attnum > 0 and not attisdropped order by attnum`)).map((r) => r.attname)
    await chain.db.exec(`alter view public.${view} rename to ${view}_real`)
    await chain.db.exec(`create view public.${view} as select ${cols.map((c) => (c in overrides ? `${overrides[c]} as ${c}` : `r.${c}`)).join(', ')} from public.${view}_real r`)
    return await failing()
  } finally {
    await chain.db.exec('rollback;')
  }
}
/** Runs fn inside a transaction that is always rolled back. */
async function scratch(fn) {
  await chain.db.exec('begin;')
  try { return await fn() } finally { await chain.db.exec('rollback;') }
}
const sealedEvaluation = (slug, pub, date, rank, scope = 'INTERNATIONAL_CLASS', label = '2013 Top 30 international prospect signings', size = 30) => `
  do $s$ declare i uuid; begin
    insert into player_evaluations (player_id, publication_id, evaluation_context, date_precision, evaluation_date, evaluation_year, evaluation_month,
      evidence_basis, confidence, source_reference, retrieved_at)
    values ((select id from players where slug = '${slug}'), (select id from scouting_publications where publication_slug = '${pub}'),
      'INTERNATIONAL_CLASS_LIST', 'DAY', date '${date}', ${Number(date.slice(0, 4))}, ${Number(date.slice(5, 7))}, 'MANUAL_TRANSCRIPTION', 'MEDIUM',
      'test reference ${slug} ${date}', now()) returning id into i;
    insert into player_evaluation_rankings (evaluation_id, rank, ranking_scope, scope_label, list_size) values (i, ${rank}, '${scope}', '${label} (test ${date})', ${size});
    update player_evaluations set record_status = 'ACTIVE' where id = i;
  end $s$`

test('036 shape: one new RLS reference table, five security-invoker views, SELECT-only grants, one transaction', async () => {
  const c = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
  assert.deepEqual(c, { tables: 60, views: 117 })
  const v = await q(`select relname, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) and relkind = 'v' order by 1`, [VIEWS])
  assert.deepEqual(v.map((r) => r.relname), [...VIEWS].sort())
  for (const r of v) assert.match(r.opts, /security_invoker=true/)
  const t = await one(`select relrowsecurity as rls from pg_class where oid = 'public.scouting_expectation_bands'::regclass`)
  assert.equal(t.rls, true)
  const pol = await q(`select policyname, cmd, roles::text as roles from pg_policies where tablename = 'scouting_expectation_bands'`)
  assert.deepEqual(pol, [{ policyname: 'public_read_scouting_expectation_bands', cmd: 'SELECT', roles: '{anon,authenticated}' }])
  const acl = await q(`select c.relname, r.rolname as grantee, a.privilege_type as p from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)`, [[...VIEWS, 'scouting_expectation_bands']])
  assert.deepEqual([...new Set(acl.map((a) => a.p))], ['SELECT'])
  assert.equal(acl.length, (VIEWS.length + 1) * 2)
  assert.match(sql036, /^begin;$/m)
  assert.match(sql036, /^commit;$/m)
})

test('036 is derived only: no existing table changes; the 032-035 outcome views are byte-identical', async () => {
  const after = await tableHashes()
  const changed = Object.keys(after).filter((t) => after[t] !== before036.hashes[t]).sort()
  assert.deepEqual(changed, ['scouting_expectation_bands'])
  assert.deepEqual(await q(`select * from v_player_organizational_realization order by signing_id`), before036.dodgers)
  assert.deepEqual(await q(`select * from v_international_benchmark_player_outcomes order by signing_id`), before036.benchmark)
})

test('bands: exactly the reviewed definitions; families never overlap or cross a publication; grades band on the numeric base', async () => {
  const rows = await q(`select b.band_code, b.band_family, sp.publication_slug, b.measure, b.lower_value::float as lo, b.upper_value::float as hi, b.band_order,
    b.met_career_bwar_floor::float as met, b.exceeded_career_bwar_floor::float as exc, b.outcome_rule_basis from scouting_expectation_bands b
    join scouting_publications sp on sp.id = b.publication_id order by 1`)
  const expected = bands.families.flatMap((f) => f.bands.map((b) => ({ band_code: b.band_code, band_family: f.band_family, publication_slug: f.publication_slug,
    measure: f.measure, lo: b.lower_value, hi: b.upper_value, band_order: b.band_order, met: b.met_career_bwar_floor, exc: b.exceeded_career_bwar_floor,
    outcome_rule_basis: 'DISI_CONVENTION' }))).sort((a, b) => (a.band_code < b.band_code ? -1 : 1))
  assert.deepEqual(rows, expected)
  assert.equal(rows.length, 15)
  await scratch(async () => {
    let message = 'accepted'
    try {
      await chain.db.exec(`insert into scouting_expectation_bands (band_code, band_family, family_label, publication_id, measure, ranking_scope, lower_value, upper_value,
        band_order, band_label, expectation_statement, population_label) select 'X', 'BA_TOP100_RANK', 'x', id, 'GRADE', 'MLB_GLOBAL', 1, 2, 9, 'x', 'x', 'RANKED_LIST_SAMPLE'
        from scouting_publications where publication_slug = 'baseball-america-top-100'`)
    } catch (e) { message = String(e.message) }
    assert.match(message, /measure_shape/)
  })
})

test('outcome spine: one row per signing; values pass through 032-035; MLB value is NULL (not zero) without an MLB career', async () => {
  const s = await one(`select count(*)::int as n, count(*) filter (where outcome_scope = 'DODGERS_TRACKED')::int as d, count(*) filter (where outcome_scope = 'TOP_PROSPECT_BENCHMARK')::int as b,
    count(*) filter (where reached_mlb_verified)::int as reached, count(*) filter (where outcome_state = 'UNAUDITED')::int as unaudited,
    count(*) filter (where reached_mlb_verified is not true and (career_bwar is not null or signing_org_bwar is not null or elsewhere_bwar is not null))::int as zero_filled
    from v_player_realized_outcome`)
  assert.deepEqual(s, { n: 268, d: 220, b: 48, reached: 58, unaudited: 132, zero_filled: 0 })
  const dodgers = await q(`select r.player_slug, r.career_bwar::text as c, d.team_season_career_bwar::text as dc, r.signing_org_bwar::text as o, d.direct_dodgers_mlb_bwar::text as dd,
      r.dodgers_attributable_organizational_bwar::text as a, d.attributable_organizational_bwar::text as da
    from v_player_realized_outcome r join v_player_organizational_realization d on d.signing_id = r.signing_id where r.reached_mlb_verified`)
  assert.equal(dodgers.length, 47)
  for (const r of dodgers) assert.deepEqual([r.c, r.o, r.a], [r.dc, r.dd, r.da], r.player_slug)
  const torres = await one(`select career_bwar::float as c, signing_org_bwar, elsewhere_bwar::float as e, dodgers_attributable_organizational_bwar as a from v_player_realized_outcome where player_slug = 'gleyber-torres'`)
  assert.deepEqual([torres.signing_org_bwar, torres.a], [null, null])
  assert.equal(torres.c, torres.e)
  // a traded non-reacher keeps its Dodgers attributable (trade-return) value although it has no MLB career: organizational value is not career value
  const rincon = await one(`select career_bwar, dodgers_attributable_organizational_bwar::float as a, dodgers_attributable_value_basis as b from v_player_realized_outcome where player_slug = 'carlos-rincon'`)
  assert.deepEqual(rincon, { career_bwar: null, a: -0.35, b: 'DIRECT_PLUS_SOLE_OUTGOING_RETURN' })
})

test('observations: every ACTIVE external rank and FV is observed once and banded; the debut order uses the evaluation date precision', async () => {
  const o = await q(`select publication_slug, measure, band_code, debut_order, count(*)::int as n from v_scouting_expectation_observations group by 1, 2, 3, 4 order by 1, 2, 3, 4`)
  const total = o.reduce((s, r) => s + r.n, 0)
  assert.equal(total, 53)
  assert.equal(o.filter((r) => r.band_code === null).length, 0)
  const sasaki = await one(`select debut_order, measure_value::int as v, band_code from v_scouting_expectation_observations where player_slug = 'roki-sasaki'`)
  assert.deepEqual(sasaki, { debut_order: 'PRE_DEBUT', v: 1, band_code: 'BA_TOP100_RANK_001_010' })
  const dePaula = await q(`select measure, band_code, debut_order from v_scouting_expectation_observations where player_slug = 'josue-de-paula' order by 1`)
  assert.deepEqual(dePaula, [{ measure: 'GRADE', band_code: 'FG_FV_55', debut_order: 'PRE_DEBUT' }, { measure: 'RANK', band_code: 'FG_ORG_RANK_01_05', debut_order: 'PRE_DEBUT' }])
})

test('frozen anchors: a later evaluation, before or after the debut, never moves the expectation; a post-debut one is queued, never anchored', async () => {
  const anchor = await one(`select anchor_evaluation_id, band_code from v_player_expectation_vs_outcome where player_slug = 'gleyber-torres'`)
  assert.equal(anchor.band_code, 'MLBP_INTL_RANK_01_10')
  await scratch(async () => {
    // Torres debuted in 2018: a 2020 re-ranking (post-debut, a different band) and a 2016 one (pre-debut, a different band)
    await chain.db.exec(sealedEvaluation('gleyber-torres', 'mlb-pipeline-top-30-international-signings', '2020-07-02', 25))
    await chain.db.exec(sealedEvaluation('gleyber-torres', 'mlb-pipeline-top-30-international-signings', '2016-07-02', 15))
    const a = await one(`select anchor_evaluation_id, band_code, family_observations, excluded_post_debut_observations from v_player_expectation_vs_outcome where player_slug = 'gleyber-torres'`)
    assert.deepEqual([a.anchor_evaluation_id, a.band_code, a.family_observations, a.excluded_post_debut_observations], [anchor.anchor_evaluation_id, 'MLBP_INTL_RANK_01_10', 3, 1])
    const queued = await q(`select issue from v_scouting_expectation_research_queue where player_slug = 'gleyber-torres' order by 1`)
    assert.deepEqual(queued.map((r) => r.issue), ['POST_DEBUT_EVALUATION_EXCLUDED'])
    assert.deepEqual(await failing(), [])
  })
})

test('comparison states: unknown, immature or still-active outcomes are never misses; the 48-player tracker sample splits as researched', async () => {
  const d = Object.fromEntries((await q(`select comparison_state || ':' || state_reason as k, count(*)::int as n from v_player_expectation_vs_outcome
    where band_family = 'MLBP_INTL_CLASS_TOP30_RANK' group by 1`)).map((r) => [r.k, r.n]))
  assert.deepEqual(d, {
    'EXPECTATION_EXCEEDED:CAREER_BWAR_AT_OR_ABOVE_EXCEEDED_FLOOR': 2,
    'EXPECTATION_MET:REACHED_MLB': 9,
    'EXPECTATION_UNDERPERFORMED:NO_MLB_THROUGH_AS_OF_DATE': 31,
    'OUTCOME_INCOMPLETE:OUTCOME_UNAUDITED': 5,
    'TOO_EARLY:ACTIVE_WITHOUT_DEBUT': 1,
  })
  // no-debut-recorded players with an unestablished status are not settled outcomes
  const unsettled = await one(`select count(*)::int as n from v_player_expectation_vs_outcome where comparison_state = 'EXPECTATION_UNDERPERFORMED' and outcome_settled`)
  assert.equal(unsettled.n, 0)
  const torres = await one(`select comparison_state, outcome_settled from v_player_expectation_vs_outcome where player_slug = 'gleyber-torres'`)
  assert.equal(torres.comparison_state, 'EXPECTATION_EXCEEDED')
  const dodgers = await q(`select player_slug, band_code, comparison_state, state_reason, outcome_settled from v_player_expectation_vs_outcome where is_dodgers and band_code is not null order by 1, 2`)
  assert.deepEqual(dodgers.map((r) => [r.player_slug, r.band_code, r.comparison_state, r.state_reason, r.outcome_settled]), [
    ['emil-morales', 'FG_FV_50', 'TOO_EARLY', 'NOT_MATURE', false],
    ['emil-morales', 'FG_ORG_RANK_01_05', 'TOO_EARLY', 'NOT_MATURE', false],
    ['josue-de-paula', 'FG_FV_55', 'TOO_EARLY', 'MLB_CAREER_ACCRUING', false],
    ['josue-de-paula', 'FG_ORG_RANK_01_05', 'EXPECTATION_MET', 'REACHED_MLB', false],
    ['roki-sasaki', 'BA_TOP100_RANK_001_010', 'EXPECTATION_MET', 'REACHED_MLB', false],
  ])
  const insufficient = await one(`select count(*)::int as n from v_player_expectation_vs_outcome where comparison_state = 'INSUFFICIENT_EXPECTATION_DATA'`)
  assert.equal(insufficient.n, 268 - 48 - 3)
})

test('calibration: shares only for 10+ comparable outcomes; the tracker bands are descriptive samples; every other band is insufficient', async () => {
  const c = await q(`select band_code, anchored_players, comparable_outcomes, comparable_reached_mlb, comparable_exceeded, comparable_underperformed, too_early, outcome_incomplete,
    reached_mlb_share::float as share, sample_state, population_label from v_scouting_calibration_summary order by band_family, band_order`)
  assert.equal(c.length, 15)
  const t = Object.fromEntries(c.filter((r) => r.band_code.startsWith('MLBP')).map((r) => [r.band_code, [r.anchored_players, r.comparable_outcomes, r.comparable_reached_mlb, r.comparable_exceeded, r.comparable_underperformed, r.too_early, r.outcome_incomplete, r.share, r.sample_state]]))
  assert.deepEqual(t, {
    MLBP_INTL_RANK_01_10: [18, 16, 8, 2, 8, 0, 2, 0.5, 'DESCRIPTIVE_SAMPLE'],
    MLBP_INTL_RANK_11_20: [15, 15, 3, 0, 12, 0, 0, 0.2, 'DESCRIPTIVE_SAMPLE'],
    MLBP_INTL_RANK_21_30: [15, 11, 0, 0, 11, 1, 3, 0, 'DESCRIPTIVE_SAMPLE'],
  })
  for (const r of c.filter((x) => !x.band_code.startsWith('MLBP'))) {
    assert.equal(r.sample_state, 'INSUFFICIENT_SAMPLE', r.band_code)
    assert.equal(r.share, null, r.band_code)
  }
  for (const r of c.filter((x) => x.band_code.startsWith('MLBP'))) assert.equal(r.population_label, 'TOP_PROSPECT_SAMPLE')
})

test('research queue: only new issue types, derived from the comparison', async () => {
  const issues = Object.fromEntries((await q(`select issue, count(*)::int as n from v_scouting_expectation_research_queue group by 1`)).map((r) => [r.issue, r.n]))
  assert.deepEqual(issues, { EXPECTATION_COMPARISON_OUTCOME_INCOMPLETE: 5, MLB_REACHER_WITHOUT_PRE_DEBUT_EXPECTATION: 45, TOP_BAND_EXPECTATION_UNDERPERFORMED: 8 })
  const old = (await q(`select distinct issue from v_scouting_research_queue`)).map((r) => r.issue)
  for (const k of Object.keys(issues)) assert.ok(!old.includes(k), k)
})

test('no probability, accuracy, rate, ranking, ROI or causal column exists in any 036 view', async () => {
  const cols = (await q(`select attname from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and a.attnum > 0 and not a.attisdropped`, [VIEWS])).map((r) => r.attname)
  const sourceFields = new Set(['ranking_scope'])
  for (const c of cols.filter((x) => !sourceFields.has(x))) assert.doesNotMatch(c, /probab|accura|hit_rate|_rate$|percentile|rank_position|ranking|per_million|per_war|dollar|causal|roi|predict|score/i, c)
})

test('verifier: the eight expectation checks pass, each catches its own drift, and the full verifier passes on the 036 database', async () => {
  assert.deepEqual(await failing(), [])
  assert.equal(EXPECTATION_CHECK_NAMES.length, 8)
  const full = await checkInvariants(q, EXPECT036)
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 241, '194 through 036 plus the seven 037, six 038, five 039, five 040 and six 041 checks, which pass trivially without their views')
  const x = 'v_player_expectation_vs_outcome'
  assert.ok((await drift(x, { comparison_state: `case when r.reached_mlb_verified is null and r.band_code is not null then 'EXPECTATION_UNDERPERFORMED' else r.comparison_state end` })).includes('expectation_unknown_not_miss_violations'))
  assert.ok((await drift(x, { anchor_debut_order: `case when r.band_code is not null then 'POST_DEBUT' else r.anchor_debut_order end` })).includes('expectation_anchor_violations'))
  assert.ok((await drift(x, { comparison_state: `case when r.comparison_state = 'EXPECTATION_MET' then 'EXPECTATION_EXCEEDED' else r.comparison_state end` })).includes('expectation_state_rule_violations'))
  assert.deepEqual(await drift('v_player_realized_outcome', { career_bwar: `coalesce(r.career_bwar, 0)` }), ['expectation_spine_missing_not_zero_violations'])
  assert.ok((await drift('v_player_realized_outcome', { dodgers_attributable_organizational_bwar: `coalesce(r.dodgers_attributable_organizational_bwar, 0)` })).includes('expectation_spine_violations'))
  assert.deepEqual(await drift('v_scouting_calibration_summary', { reached_mlb_share: `0.5` }), ['expectation_calibration_sample_violations'])
  assert.ok((await drift('v_scouting_expectation_observations', { band_code: `case when r.measure = 'GRADE' then null else r.band_code end` })).includes('expectation_observation_scope_violations'))
  await scratch(async () => {
    await chain.db.exec(`update scouting_expectation_bands set upper_value = 15 where band_code = 'MLBP_INTL_RANK_01_10'`)
    assert.ok((await failing()).includes('expectation_band_shape_violations'))
  })
})

test('rerun: the migration is idempotent and changes no data and no definition', async () => {
  const hashes = await tableHashes()
  const defs = async () => q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)
  const outputs = async () => md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2, 3`))))
  const d1 = await defs()
  const o1 = await outputs()
  await chain.db.exec(sql036)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await defs(), d1)
  assert.equal(await outputs(), o1)
})

test('reproducible: building from the same inputs produces the committed bytes', () => {
  const before = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', FILE))).digest('hex')
  execFileSync(process.execPath, [path.join(root, 'database/research/036/build.mjs')], { cwd: root, stdio: 'pipe' })
  const afterHash = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', FILE))).digest('hex')
  assert.equal(afterHash, before)
})

test('frozen history: 036 adds only; it never alters, drops, deletes or updates an earlier object', () => {
  assert.doesNotMatch(sql036, /\bdrop (table|view|column)\b/i)
  assert.doesNotMatch(sql036, /\balter (view|column)\b/i)
  assert.doesNotMatch(sql036, /\b(delete from|truncate)\b/i)
  assert.doesNotMatch(sql036, /\bupdate public\./i)
  assert.doesNotMatch(sql036, /\balter table public\.(?!scouting_expectation_bands\b)/i)
})
