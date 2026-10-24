// Migration 040: historical archetypes and comparables. The 039 database is replayed (001-039), 040 is applied for real, and the
// archetype keys, the comparable selection rules (earlier signings only, never outcome-selected, never chosen by outcome), the sample
// gates, the research queue and the verifier are checked.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { archetypeQueries, ARCHETYPE_CHECK_NAMES } from '../../scripts/db/lib/archetype-invariants.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_046 as CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '040_historical_archetypes_comparables.sql'
const sql040 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const VIEWS = ['v_player_historical_archetype', 'v_player_comparables', 'v_player_comparable_summary', 'v_archetype_outcome_summary', 'v_archetype_research_queue']
const EXPECT040 = { ...CANONICAL_EXPECTATIONS, public_views_total: 134, public_tables_total: 62 }

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
// the selection itself: who was chosen for whom, in which order, with which score and reasons (no outcome column)
const selection = async () => md5(await q(`select target_player_slug, comparable_rank, comparable_player_slug, match_score, matched_dimensions::text as m
  from v_player_comparables order by 1, 2`))
let before040
before(async () => {
  chain = await buildChainThrough('039_market_pathway_intelligence.sql')
  before040 = { hashes: await tableHashes(), defs: await viewDefs() }
  await chain.db.exec(sql040)
}, { timeout: 300000 })
after(async () => { await chain?.close() })

const failing = async () => {
  const out = []
  for (const [name, sql] of Object.entries(archetypeQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
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

test('040 shape: no table, five security-invoker views, SELECT-only grants, one transaction; derived only', async () => {
  const c = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
  assert.deepEqual(c, { tables: 62, views: 134 })
  const v = await q(`select relname, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) and relkind = 'v' order by 1`, [VIEWS])
  assert.deepEqual(v.map((r) => r.relname), [...VIEWS].sort())
  for (const r of v) assert.match(r.opts, /security_invoker=true/)
  const acl = await q(`select c.relname, a.privilege_type as p from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)`, [VIEWS])
  assert.deepEqual([...new Set(acl.map((a) => a.p))], ['SELECT'])
  assert.equal(acl.length, VIEWS.length * 2)
  assert.deepEqual(await tableHashes(), before040.hashes)
  const defs = await viewDefs()
  assert.deepEqual(Object.keys(before040.defs).filter((x) => defs[x] !== before040.defs[x]), [])
  assert.match(sql040, /^begin;$/m)
  assert.match(sql040, /^commit;$/m)
})

test('archetypes: one per signing from signing-time features only; 225 defined (position at signing and age known)', async () => {
  const a = await one(`select count(*)::int as n, count(*) filter (where archetype_defined)::int as defined from v_player_historical_archetype`)
  assert.deepEqual(a, { n: 268, defined: 225 })
  const k = await one(`select coarse_archetype_key, archetype_key from v_player_historical_archetype where player_slug = 'gleyber-torres'`)
  assert.equal(k.coarse_archetype_key, 'AMATEUR_OR_UNCLASSIFIED_SIGNING|MIDDLE_INFIELD|AGE_17')
  assert.match(k.archetype_key, /\|TOP_BAND\|BONUS_1M_TO_1_99M\|VENEZUELA\|SOFT_CAPPED_BONUS_POOLS$/)
})

test('comparables: earlier signings only, same route and position family, never outcome-selected, ordered and explained', async () => {
  const rows = await q(`select comparable_rank, match_score, matched_dimensions::text as m, comparable_player_slug, comparable_signing_year, comparable_population_class
    from v_player_comparables where target_player_slug = 'josue-de-paula' order by comparable_rank`)
  assert.ok(rows.length >= 5 && rows.length <= 20)
  for (const r of rows) {
    assert.ok(r.comparable_signing_year < 2022)
    assert.notEqual(r.comparable_population_class, 'OUTCOME_SELECTED_SAMPLE')
  }
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].match_score <= rows[i - 1].match_score)
  assert.deepEqual([rows[0].match_score, rows[0].m], [18, '{AGE_BAND,MARKET_GROUP}'])
  // a missing at-signing expectation is never a match
  assert.equal((await one(`select count(*)::int as n from v_player_comparables where 'EXPECTATION_TIER' = any(matched_dimensions) and comparable_expectation_tier = 'NO_AT_SIGNING_EXPECTATION'`)).n, 0)
  // an unknown position has no comparables
  assert.equal((await one(`select count(*)::int as n from v_player_comparables c join v_signing_time_features f on f.signing_id = c.target_signing_id where f.position_family = 'POSITION_UNKNOWN'`)).n, 0)
})

test('no outcome-conditioned selection and no leakage: outcome flips and future facts leave every archetype and comparable set unchanged', async () => {
  const sel = await selection()
  const arch = md5(await q(`select * from v_player_historical_archetype order by signing_id`))
  await scratch(async () => {
    // flip every comparable outcome the selection could have seen, and add later facts
    await chain.db.exec(`update outcome_audits set reached_mlb_verified = not reached_mlb_verified,
      outcome_state = case when reached_mlb_verified then 'NO_MLB_STATUS_UNKNOWN' else 'REACHED_MLB' end`)
    await chain.db.exec(`update players set primary_position = 'C'`)
    await chain.db.exec(`delete from player_season_stints where season >= 2020`)
    assert.equal(await selection(), sel)
    assert.equal(md5(await q(`select * from v_player_historical_archetype order by signing_id`)), arch)
  })
})

test('populations stay separable: summaries are per comparable class and never pool; shares need 10+ mature audited comparables', async () => {
  const pooled = await one(`select count(*)::int as n from (select target_signing_id, comparable_population_class from v_player_comparable_summary group by 1, 2 having count(*) > 1) d`)
  assert.equal(pooled.n, 0)
  const shares = await q(`select comparable_population_class, min(mature_audited_comparables)::int as min_n from v_player_comparable_summary where comparable_reach_share is not null group by 1`)
  for (const r of shares) assert.ok(r.min_n >= 10, r.comparable_population_class)
  assert.equal((await one(`select count(*)::int as n from v_archetype_outcome_summary where population_class = 'OUTCOME_SELECTED_SAMPLE' and sample_reach_share is not null`)).n, 0)
  const cols = (await q(`select attname from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and a.attnum > 0`, [VIEWS])).map((r) => r.attname)
  for (const x of cols) assert.doesNotMatch(x, /probab|predict|forecast|likeness|next_|similarity_pct|best|causal/i, x)
})

test('research queue: only new issue types', async () => {
  const issues = Object.fromEntries((await q(`select issue, count(*)::int as n from v_archetype_research_queue group by 1`)).map((r) => [r.issue, r.n]))
  assert.deepEqual(issues, { ARCHETYPE_UNDEFINED: 12, INSUFFICIENT_COMPARABLE_HISTORY: 3 })
})

test('verifier: the five archetype checks pass, each catches its own drift, and the full verifier passes on the 040 database', async () => {
  assert.deepEqual(await failing(), [])
  assert.equal(ARCHETYPE_CHECK_NAMES.length, 5)
  const full = await checkInvariants(q, EXPECT040)
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 258, '217 through 040 plus the seven 041 checks, which pass trivially without their objects')
  assert.ok((await drift('v_player_comparables', { match_score: 'r.match_score + 1' })).includes('comparable_ordering_violations'))
  assert.ok((await drift('v_player_comparables', { comparable_rank: 'r.comparable_rank + 30' })).includes('comparable_selection_violations'))
  assert.ok((await drift('v_player_historical_archetype', { archetype_defined: 'true' })).includes('archetype_row_violations'))
  assert.ok((await drift('v_player_comparable_summary', { comparable_reach_share: '0.5' })).includes('comparable_summary_sample_violations'))
  assert.ok((await drift('v_archetype_outcome_summary', { sample_reach_share: '0.5' })).includes('archetype_summary_sample_violations'))
})

test('rerun: the migration is idempotent and changes no data and no definition', async () => {
  const hashes = await tableHashes()
  const defs = await viewDefs()
  const out = md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2, 3, 4`))))
  await chain.db.exec(sql040)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await viewDefs(), defs)
  assert.equal(md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2, 3, 4`)))), out)
})

test('reproducible: building from the same inputs produces the committed bytes', () => {
  const before = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', FILE))).digest('hex')
  execFileSync(process.execPath, [path.join(root, 'database/research/040/build.mjs')], { cwd: root, stdio: 'pipe' })
  assert.equal(crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', FILE))).digest('hex'), before)
})

test('frozen history: 040 adds views only; no table, no alteration, no data change', () => {
  const code = sql040.replace(/--.*$/gm, '')
  assert.doesNotMatch(code, /\b(create|drop|alter) table\b/i)
  assert.doesNotMatch(code, /\b(drop|alter) (view|column)\b/i)
  assert.doesNotMatch(code, /^\s*(insert into|delete from|truncate|update )/im)
})
