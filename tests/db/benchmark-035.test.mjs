// Migration 035: international benchmark outcomes. The 034 database is replayed (001-034), 035 is applied for real, and the audited
// outcomes, team-season facts, coverage model, strict rate eligibility, research queue and verifier are checked against the research.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { benchmarkQueries, BENCHMARK_CHECK_NAMES } from '../../scripts/db/lib/benchmark-invariants.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_046 as CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '035_international_benchmark_outcomes.sql'
const sql035 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, 'database/research/035', f), 'utf8'))
const outcomes = rd('benchmark-outcomes.json')
const war = rd('war-seed.json')
const audit = rd('audit-report.json')
const VIEWS = ['v_international_benchmark_player_outcomes', 'v_international_benchmark_class_coverage', 'v_international_benchmark_research_queue']

let chain
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
let before035
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const tableHashes = async () => {
  const tables = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5((await q(`select t::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
before(async () => {
  chain = await buildChainThrough('034_downstream_organizational_value_chains.sql')
  before035 = {
    hashes: await tableHashes(),
    audits: (await one('select count(*)::int as n from outcome_audits')).n,
    asOf: (await one(`select max(audited_through_date)::text as d from outcome_audits`)).d,
    dodgersRealization: md5(await q(`select * from v_player_organizational_realization order by player_id`)),
    portfolio: md5(await q(`select * from v_dodgers_international_value_portfolio order by grain, grain_value`)),
  }
  await chain.db.exec(sql035)
}, { timeout: 300000 })
after(async () => { await chain?.close() })

const failing = async () => {
  const out = []
  for (const [name, sql] of Object.entries(benchmarkQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
  return out.sort()
}

/** Replaces a view with one that returns the real rows but with some columns overridden; rolled back by the caller. */
async function overrideView(view, overrides) {
  const cols = (await q(`select attname from pg_attribute where attrelid = 'public.${view}'::regclass and attnum > 0 and not attisdropped order by attnum`)).map((r) => r.attname)
  await chain.db.exec(`alter view public.${view} rename to ${view}_real`)
  const select = cols.map((c) => (c in overrides ? `${overrides[c]} as ${c}` : `r.${c}`)).join(', ')
  await chain.db.exec(`create view public.${view} as select ${select} from public.${view}_real r`)
}
async function drift(view, overrides) {
  await chain.db.exec('begin;')
  try {
    await overrideView(view, overrides)
    return await failing()
  } finally {
    await chain.db.exec('rollback;')
  }
}

test('035 shape: no new table, three new security-invoker views, SELECT-only grants, one transaction, idempotent statements', async () => {
  const c = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
  assert.deepEqual(c, { tables: 59, views: 112 })
  const v = await q(`select relname, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) and relkind = 'v' order by 1`, [VIEWS])
  assert.deepEqual(v.map((r) => r.relname), [...VIEWS].sort())
  for (const r of v) assert.match(r.opts, /security_invoker=true/)
  const acl = await q(`select c.relname, r.rolname as grantee, a.privilege_type as p from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)`, [VIEWS])
  assert.deepEqual([...new Set(acl.map((a) => a.p))], ['SELECT'])
  assert.equal(acl.length, VIEWS.length * 2)
  assert.match(sql035, /^begin;$/m)
  assert.match(sql035, /^commit;$/m)
})

test('035 data: 43 audits (11 reached), 11 outcomes, 59 team-season rows; only the five expected stores change; the as-of date does not move', async () => {
  const after = await tableHashes()
  const changed = Object.keys(after).filter((t) => after[t] !== before035.hashes[t]).sort()
  assert.deepEqual(changed, ['outcome_audits', 'outcome_evidence', 'outcomes', 'player_mlb_team_season_war', 'sources'])
  assert.equal((await one('select count(*)::int as n from outcome_audits')).n, before035.audits + 43)
  assert.equal(audit.identity_resolved, 43)
  assert.equal(audit.reached, 11)
  assert.equal(war.rows.length, 59)
  assert.equal((await one(`select count(*)::int as n from outcome_audits a join players p on p.id = a.player_id where p.slug = any($1)`, [outcomes.players.map((p) => p.slug)])).n, 43)
  assert.equal((await one(`select count(*)::int as n from outcome_audits a join players p on p.id = a.player_id where p.slug = any($1) and a.reached_mlb_verified`, [outcomes.players.map((p) => p.slug)])).n, 11)
  assert.equal((await one(`select count(*)::int as n from player_mlb_team_season_war where organization_id is null`)).n, 0)
  assert.equal((await one(`select max(audited_through_date)::text as d from outcome_audits`)).d, before035.asOf)
})

test('035 leaves Dodgers value untouched: the player realization view and the portfolio are byte-identical', async () => {
  assert.equal(md5(await q(`select * from v_player_organizational_realization order by player_id`)), before035.dodgersRealization)
  assert.equal(md5(await q(`select * from v_dodgers_international_value_portfolio order by grain, grain_value`)), before035.portfolio)
})

test('unknown is never false: the five identity-unresolved players are UNAUDITED with a NULL reach flag; no inferred non-reach', async () => {
  const rows = await q(`select player_slug, outcome_state, reached_mlb_verified, identity_resolved, tier1_reach_comparable, audited_through_date
    from v_international_benchmark_player_outcomes where outcome_state = 'UNAUDITED' and is_dodgers is false order by 1`)
  assert.equal(rows.length, 5)
  for (const r of rows) {
    assert.equal(r.reached_mlb_verified, null)
    assert.equal(r.identity_resolved, false)
    assert.equal(r.tier1_reach_comparable, false)
    assert.equal(r.audited_through_date, null)
  }
  const missing = outcomes.players.filter((p) => !p.mlb_id).map((p) => p.slug).sort()
  assert.deepEqual(rows.map((r) => r.player_slug), missing)
})

test('outcome states: 11 reached, one active in the minors, 31 with no recorded debut and unestablished status; reach is the audited fact', async () => {
  const d = await q(`select outcome_state, count(*)::int as n from v_international_benchmark_player_outcomes where is_dodgers is false group by 1 order by 1`)
  assert.deepEqual(Object.fromEntries(d.map((r) => [r.outcome_state, r.n])),
    { NO_MLB_ACTIVE_IN_MINORS: 1, NO_MLB_STATUS_UNKNOWN: 31, REACHED_MLB: 11, UNAUDITED: 5 })
  const reached = await q(`select player_slug, mlb_debut_date::text as debut, years_signing_to_debut_season as y from v_international_benchmark_player_outcomes where reached_mlb_verified order by 1`)
  assert.equal(reached.length, 11)
  for (const r of reached) {
    const p = outcomes.players.find((x) => x.slug === r.player_slug)
    assert.equal(r.debut, p.mlb_debut_date)
    assert.equal(r.y, Number(p.mlb_debut_date.slice(0, 4)) - p.signing_year)
  }
  // the not-reached audits carry the MLB_REACH evidence the deferred trigger requires, and say the record is not proof of a career end
  const notes = await q(`select a.audit_note from outcome_audits a join players p on p.id = a.player_id where p.slug = any($1) and not a.reached_mlb_verified`, [outcomes.players.map((p) => p.slug)])
  assert.equal(notes.length, 32)
  for (const n of notes) assert.match(n.audit_note, /not proof of a career end/)
})

test('bWAR: career is the sum of the original-organization and elsewhere parts; a player who never played for the signing organization has NULL, not zero, there', async () => {
  const torres = await one(`select career_bwar::float as c, original_org_bwar, elsewhere_bwar::float as e, tier2_original_org_bwar_comparable as t2 from v_international_benchmark_player_outcomes where player_slug = 'gleyber-torres'`)
  assert.equal(torres.original_org_bwar, null)
  assert.equal(torres.c, torres.e)
  assert.equal(torres.t2, true)
  const park = await one(`select career_bwar::float as c, original_org_bwar::float as o, elsewhere_bwar::float as e from v_international_benchmark_player_outcomes where player_slug = 'hyo-jun-park'`)
  assert.ok(Math.abs(park.c - (park.o + park.e)) < 0.0051)
  const unreached = await one(`select count(*)::int as n from v_international_benchmark_player_outcomes where is_dodgers is false and reached_mlb_verified is not true and (career_bwar is not null or team_season_rows is not null)`)
  assert.equal(unreached.n, 0)
  const sums = await q(`select player_slug, career_bwar::float as c from v_international_benchmark_player_outcomes where reached_mlb_verified and is_dodgers is false order by 1`)
  for (const r of sums) {
    const p = outcomes.players.find((x) => x.slug === r.player_slug)
    const bref = Object.values(war.scope.players).find((x) => x.mlb_id === p.mlb_id).bref_id
    const expected = war.rows.filter((w) => w.bref_id === bref && w.war !== null).reduce((s, w) => s + Number(w.war), 0)
    assert.ok(Math.abs(r.c - expected) < 0.0051, `${r.player_slug}: ${r.c} vs ${expected}`)
  }
})

test('comparison tiers: tier 3 is never claimed; tier 2 only for verified reachers with loaded facts', async () => {
  const t = await one(`select count(*) filter (where tier3_organizational_realization_comparable)::int as t3,
    count(*) filter (where tier2_original_org_bwar_comparable)::int as t2,
    count(*) filter (where tier1_reach_comparable)::int as t1 from v_international_benchmark_player_outcomes where is_dodgers is false`)
  assert.equal(t.t3, 0)
  assert.equal(t.t2, 11)
  assert.equal(t.t1, 43)
})

test('coverage model: no class is rate-eligible; the legacy suitability flag is shown but never trusted; samples are labelled samples', async () => {
  const c = await q(`select * from v_international_benchmark_class_coverage order by population_key`)
  assert.ok(c.length >= 5)
  for (const r of c) {
    assert.equal(r.rate_eligible_strict, false, r.population_key)
    assert.equal(r.comparison_label, 'SAMPLE_COMPARISON')
    assert.ok(r.rate_blockers.length > 0)
    assert.ok(['TOP_PROSPECT_SAMPLE', 'VERIFIED_SAMPLE', 'OPENING_CLASS_PARTIAL', 'CURATED_SAMPLE', 'CENSUS_PARTIAL', 'UNKNOWN_COVERAGE', 'CENSUS_COMPLETE'].includes(r.census_state))
  }
  const sample = c.filter((r) => r.census_state === 'TOP_PROSPECT_SAMPLE')
  assert.equal(sample.length, 2)
  assert.deepEqual(sample.map((r) => r.members).sort(), [20, 28])
  for (const r of sample) {
    assert.equal(r.dodgers_members, 0)
    assert.equal(r.has_dodgers_comparator, false)
    assert.ok(r.rate_blockers.includes('NOT_A_FULL_SIGNING_PERIOD'))
    assert.equal(r.expected_size, 30)
    assert.ok(r.rate_blockers.includes('MEMBERS_DO_NOT_EQUAL_EXPECTED_SIZE'))
    assert.ok(r.rate_blockers.includes('OUTCOMES_NOT_FULLY_AUDITED'))
    assert.ok(r.rate_blockers.includes('IDENTITIES_NOT_FULLY_RESOLVED'))
  }
  assert.equal(c.filter((r) => r.legacy_rate_analysis_suitable && r.rate_eligible_strict).length, 0)
  assert.equal(c.filter((r) => r.comparison_label === 'CLASS_COMPLETE_COMPARISON').length, 0)
})

test('research queue: the seven issue types are derived from the facts and scoped as documented', async () => {
  const issues = Object.fromEntries((await q(`select issue, count(*)::int as n from v_international_benchmark_research_queue group by 1 order by 1`)).map((r) => [r.issue, r.n]))
  assert.equal(issues.BENCHMARK_IDENTITY_UNRESOLVED, 5)
  assert.equal(issues.BENCHMARK_OUTCOME_UNAUDITED, undefined)
  assert.equal(issues.BENCHMARK_REACHED_WITHOUT_TEAM_SEASON_FACTS, undefined)
  assert.equal(issues.SAMPLE_HAS_NO_DODGERS_COMPARATOR, 2)
  assert.ok(issues.POPULATION_MEMBERS_NOT_TRACKED >= 1)
  const allowed = ['BENCHMARK_IDENTITY_UNRESOLVED', 'BENCHMARK_OUTCOME_UNAUDITED', 'BENCHMARK_REACHED_WITHOUT_TEAM_SEASON_FACTS', 'BENCHMARK_BONUS_UNKNOWN',
    'POPULATION_MEMBERS_NOT_TRACKED', 'POPULATION_DENOMINATOR_NOT_SOURCED', 'SAMPLE_HAS_NO_DODGERS_COMPARATOR']
  for (const k of Object.keys(issues)) assert.ok(allowed.includes(k), k)
})

test('no rate, ranking, percentile, league average, dollar-per-WAR or causal column exists in any 035 view', async () => {
  const cols = (await q(`select attname from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and a.attnum > 0 and not a.attisdropped`, [VIEWS])).map((r) => r.attname)
  const declared = new Set(['legacy_rate_analysis_suitable', 'rate_eligible_strict', 'rate_blockers'])
  for (const c of cols.filter((x) => !declared.has(x))) assert.doesNotMatch(c, /rate|rank_position|percentile|league_avg|per_million|per_war|dollar|causal|roi|hit_/i, c)
})

test('rerun: the migration is idempotent and changes no data and no definition', async () => {
  const hashes = await tableHashes()
  const defs = async () => q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)
  const d1 = await defs()
  await chain.db.exec(sql035)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await defs(), d1)
})

test('refuses a mismatched precondition: an existing audit with a different result aborts without writing', async () => {
  await chain.db.exec('begin;')
  try {
    const slug = outcomes.players.find((p) => p.mlb_debut_date).slug
    await chain.db.exec(`update outcome_audits set reached_mlb_verified = false, outcome_state = 'NO_MLB_STATUS_UNKNOWN' where player_id = (select id from players where slug = '${slug}')`)
    await chain.db.exec('savepoint s;')
    let message = 'accepted'
    try { await chain.db.exec(sql035.replace(/^begin;$/m, '').replace(/^commit;$/m, '')) } catch (e) { message = String(e.message) }
    assert.match(message, /already exist with a different result|035/)
  } finally {
    await chain.db.exec('rollback;')
  }
})

test('verifier: the eight benchmark checks pass and each catches its own drift; the full verifier passes on the 035 database', async () => {
  assert.deepEqual(await failing(), [])
  assert.equal(BENCHMARK_CHECK_NAMES.length, 8)
  const full = await checkInvariants(q, { ...CANONICAL_EXPECTATIONS, public_views_total: 112, public_tables_total: 59 })
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 252, '186 through 035 plus the eight 036, seven 037, six 038, five 039, five 040 and seven 041 checks, which pass trivially without their objects')
  const cov = 'v_international_benchmark_class_coverage'
  const out = 'v_international_benchmark_player_outcomes'
  assert.deepEqual(await drift(cov, { rate_eligible_strict: 'true', comparison_label: `'CLASS_COMPLETE_COMPARISON'` }), ['benchmark_rate_eligibility_violations'])
  assert.deepEqual(await drift(cov, { census_state: `'CENSUS_COMPLETE'` }), ['benchmark_census_state_violations'])
  assert.deepEqual(await drift(cov, { comparison_label: `'LEAGUE_RATE'` }), ['benchmark_comparison_label_violations'])
  assert.deepEqual(await drift(out, { tier3_organizational_realization_comparable: 'true' }), ['benchmark_tier_violations'])
  assert.deepEqual(await drift(out, { record_scope: `'FULL_PERIOD'` }), ['benchmark_scope_violations'])
  assert.ok((await drift(out, { reached_mlb_verified: `coalesce(r.reached_mlb_verified, false)` })).includes('benchmark_unaudited_not_false_violations'))
  assert.ok((await drift(out, { outcome_state: `case when r.outcome_state = 'REACHED_MLB' then 'NO_MLB_STATUS_UNKNOWN' else r.outcome_state end` })).includes('benchmark_outcome_state_violations'))
  assert.ok((await drift(out, { career_bwar: `r.career_bwar + 1` })).includes('benchmark_bwar_split_violations'))
})

test('convergence: a fresh 001-035 replay equals the 001-034 database with 035 applied (rows, definitions, grants)', { timeout: 600000 }, async () => {
  const fresh = await buildChainThrough('035_international_benchmark_outcomes.sql')
  try {
    const business = async (query) => ({
      audits: await query(`select p.slug, a.audited_through_date::text as d, a.reached_mlb_verified, a.outcome_state, a.confidence::text as c, a.audit_note from outcome_audits a join players p on p.id = a.player_id order by 1`),
      outcomes: await query(`select p.slug, o.reached_mlb, o.mlb_debut_date::text as d, o.mlb_games, o.mlb_pa, o.mlb_ip::text as ip, o.career_war::text as w, o.current_status from outcomes o join players p on p.id = o.player_id order by 1`),
      evidence: await query(`select p.slug, s.url, e.supports_fields::text as f, e.confidence::text as c from outcome_evidence e join players p on p.id = e.player_id join sources s on s.id = e.source_id order by 1, 2`),
      war: await query(`select bref_id, season, bref_team_code, stint_ordinal, component, war::text as war, organization_id is not null as mapped from player_mlb_team_season_war order by 1, 2, 3, 4, 5`),
      sources: await query(`select url, source_type from sources order by 1`),
      outcomesView: await query(`select * from v_international_benchmark_player_outcomes order by player_slug`),
      coverage: await query(`select population_key, census_state, members, members_audited, rate_eligible_strict, rate_blockers::text as b from v_international_benchmark_class_coverage order by 1`),
      queue: await query(`select issue, player_slug, population_key from v_international_benchmark_research_queue order by 1, 2, 3`),
    })
    const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'signing_id' || k === 'player_id' ? undefined : v)))
    assert.deepEqual(strip(await business(fresh.query)), strip(await business(q)))
    const defs = (query) => query(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)
    const acl = (query) => query(`select c.relname, coalesce(array_to_string(c.relacl, ','), '') as acl from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') order by 1`)
    assert.deepEqual(await defs(fresh.query), await defs(q))
    assert.deepEqual(await acl(fresh.query), await acl(q))
  } finally {
    await fresh.close()
  }
})

test('reproducible: building from the same inputs produces the committed bytes', () => {
  const before = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', FILE))).digest('hex')
  execFileSync(process.execPath, [path.join(root, 'database/research/035/build.mjs')], { cwd: root, stdio: 'pipe' })
  const afterHash = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', FILE))).digest('hex')
  assert.equal(afterHash, before)
})

test('frozen history: no earlier migration is modified by 035 (the migration file adds only; it never alters an earlier object by name)', () => {
  assert.doesNotMatch(sql035, /\b(drop|alter) (table|view|column)\b/i)
  assert.doesNotMatch(sql035, /\b(delete from|truncate)\b/i)
  assert.doesNotMatch(sql035, /\bupdate public\./i)
})
