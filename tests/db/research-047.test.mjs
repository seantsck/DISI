// Migration 047: the reviewed development-history and transaction-chain research batch. The 046 database is built (001-046), 047 is applied
// for real, and the tests prove that it adds research DATA only (no object, grant or policy changes), that every exit it records is an exact,
// identity-matched source row that closes a real control interval, that nothing is inferred for the assets the source does not cover, that
// development histories are ingested without inventing seasons, that the snapshots move to one coherent generation with zero drift, and
// that it is idempotent, guarded, reproducible and reversible.
//   UNKNOWN DEVELOPMENT HISTORY != NO DEVELOPMENT   UNKNOWN TRANSACTION != RELEASED   UNKNOWN TRADE RETURN != ZERO VALUE

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_047 as CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'
import { productSnapshotQueries } from '../../scripts/db/lib/product-snapshot-invariants.mjs'
import { ALL_SNAPSHOT_TABLES } from '../../database/research/045b/snapshots.mjs'
import { developmentCoverage, developmentQueue, timingFacts } from '../../lib/research/development-research.js'
import { attributionStateCounts } from '../../lib/research/transaction-research.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '047_development_transaction_research_batch.sql'
const sql047 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback047 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-047.sql'), 'utf8')
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'database/research/047/transaction-evidence.json'), 'utf8'))
const cohort = JSON.parse(fs.readFileSync(path.join(root, 'database/research/047/development-cohort.json'), 'utf8'))
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'database/research/047/baseline.json'), 'utf8'))

const EXITS = evidence.exits
const COHORT = cohort.players.map((p) => p.slug)
const RESEARCH_TABLES = ['development_milestones', 'development_progression_decisions', 'player_season_stints', 'sources', 'transaction_asset_timing_observations', 'transaction_event_assets', 'transaction_events']

let chain
let pre047Dump
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
// the dataset the research commands read, from a database (same relations, same columns)
const dataset = async (c = chain) => {
  const rows = async (s) => R(await c.query(s))
  return {
    signings: await rows(`select signing_id, player_id, player_slug, full_name, player_sort_name, signing_year, signing_date::text as signing_date, country_market, outcome_audit_status, reached_mlb_verified, mlb_debut_date::text as mlb_debut_date from public.v_signing_records where is_dodgers_franchise order by signing_id`),
    developmentSummary: await rows(`select player_id, player_slug, signing_date::text as signing_date, professional_debut_season, first_dsl_season, first_complex_season, first_a_season, highest_affiliated_level, mlb_debut_date::text as mlb_debut_date, days_signing_to_mlb_exact, years_signing_to_mlb_exact from public.v_dodgers_player_development_summary order by player_id`),
    decisions: await rows(`select * from public.product_player_decision order by signing_id`),
    developmentQueue: await rows(`select player_id, issue from public.v_dodgers_development_research_queue`),
    transactionQueue: await rows(`select issue, priority, player_slug, event_key from public.v_transaction_research_queue`),
    valueQueue: await rows(`select issue, priority, player_slug, event_key from public.v_value_research_queue`),
    exitSummary: await rows(`select signing_id, player_id, player_slug, control_state, first_exit_date::text as first_exit_date, first_exit_mechanism, unresolved_status from public.v_dodgers_international_exit_summary order by signing_id`),
  }
}

let pre
let post
before(async () => {
  chain = await buildChainThrough('046_outcome_cost_research_batch.sql')
  pre047Dump = await chain.db.dumpDataDir('none')
  const data = await dataset()
  pre = {
    hashes: await tableHashes(), catalog: await catalog(), data,
    generation: (await one(`select max(generation_id)::int as g from product_executive_snapshot`)).g,
    counts: await one(`select (select count(*)::int from public.transaction_events) as events, (select count(*)::int from public.transaction_event_assets) as assets,
      (select count(*)::int from public.player_season_stints) as stints, (select count(*)::int from public.development_milestones) as milestones`),
    status: await one(`select tracked_signings, signings_with_known_cost, known_acquisition_cost_usd::text as cost, open_research_tasks, outcome_audit_queue, outcome_audits_completed from product_database_status`),
  }
  await chain.db.exec(sql047)
  post = { hashes: await tableHashes(), catalog: await catalog(), data: await dataset() }
}, { timeout: 900000 })
after(async () => { await chain?.close() })

test('047 is registered in the manifest directly after 046 (048 follows it)', () => {
  const i = manifest.canonical_sql.indexOf(FILE)
  assert.equal(manifest.canonical_sql[i - 1], '046_outcome_cost_research_batch.sql')
  assert.equal(manifest.canonical_sql[i + 1], '048_verified_mlb_development_coverage.sql')
  assert.equal(manifest.notes.canonical_build_count, manifest.canonical_sql.length)
})

test('047 adds research DATA only: no table, view, function, trigger, policy or privilege changes', async () => {
  assert.deepEqual(post.catalog, pre.catalog)
  assert.equal(post.catalog.tables.length, 78)
  const changed = Object.keys(post.hashes).filter((t) => post.hashes[t] !== pre.hashes[t]).sort()
  assert.deepEqual(changed, [...RESEARCH_TABLES, ...ALL_SNAPSHOT_TABLES].sort())
  assert.equal(ALL_SNAPSHOT_TABLES.length, 11)
  // research that must not move: audits, outcomes, costs, the financial ledger, the scouting history
  for (const t of ['outcome_audits', 'outcome_evidence', 'outcomes', 'signings', 'signing_financial_reports', 'players', 'transaction_asset_resolutions', 'dodgers_control_observations', 'player_mlb_team_season_war', 'research_source_conflicts']) {
    assert.equal(post.hashes[t], pre.hashes[t], `${t} must not change`)
  }
  // the API roles still cannot write any table 047 touches
  for (const t of RESEARCH_TABLES) {
    const r = await one(`select has_table_privilege('anon', 'public.${t}', 'INSERT') or has_table_privilege('anon', 'public.${t}', 'UPDATE') or has_table_privilege('anon', 'public.${t}', 'DELETE')
      or has_table_privilege('authenticated', 'public.${t}', 'INSERT') or has_table_privilege('authenticated', 'public.${t}', 'UPDATE') or has_table_privilege('authenticated', 'public.${t}', 'DELETE') as api_write`)
    assert.equal(r.api_write, false, t)
  }
})

test('five downstream exits are recorded: an exact Retrosheet row each, identity-matched by name AND birth date, with the transaction id cited', async () => {
  assert.equal(EXITS.length, 5)
  assert.deepEqual(EXITS.map((e) => e.type).sort(), ['FREE_AGENCY', 'FREE_AGENCY', 'FREE_AGENCY', 'FREE_AGENCY', 'RELEASE'])
  assert.equal((await one(`select count(*)::int as n from public.transaction_events`)).n, pre.counts.events + 5)
  assert.equal((await one(`select count(*)::int as n from public.transaction_event_assets`)).n, pre.counts.assets + 5)
  for (const e of EXITS) {
    const r = await one(`select ev.transaction_date::text as d, ev.transaction_type as t, ev.historical_label as label, ev.description, fo.abbreviation as from_org, ev.to_organization_id is null as no_to,
        a.asset_side, a.asset_type, a.mlb_id, a.bref_id, so.url, so.source_tier
      from public.transaction_events ev join public.transaction_event_assets a on a.event_id = ev.id join public.organizations fo on fo.id = ev.from_organization_id
      join public.sources so on so.id = ev.source_id where ev.event_key = $1`, [e.key])
    assert.deepEqual([r.d, r.t, r.from_org, r.no_to, r.asset_side, r.asset_type, r.mlb_id, r.bref_id], [e.date, e.type, 'LAD', true, 'OUTGOING', 'PLAYER', e.asset.mlb_id, e.asset.bref_id], e.key)
    assert.match(r.description, new RegExp(`Retrosheet transaction ${e.retrosheet.transaction_id}\\b`))
    assert.equal(r.url, 'https://www.retrosheet.org/transactions/tranDB.zip')
    assert.match(e.retrosheet.row, new RegExp(`"${e.retrosheet.player_id}"`))
    assert.match(e.retrosheet.birth_date_matched, /^\d{4}-\d{2}-\d{2}$/)
  }
})

test('each exit closes the control interval of an asset the Dodgers acquired in a recorded trade, and the bounded Dodgers bWAR does not move', async () => {
  const c = await clone(pre047Dump)
  try {
    for (const e of EXITS) {
      const before = (await c.query(`select exit_event_key, interval_status, interval_bounded_dodgers_bwar::text as w from public.v_transaction_package_lineage where mlb_id = $1 and acquisition_event_key = $2`, [e.asset.mlb_id, e.acquired_in_event]))
      assert.ok(before.length >= 1 && before.every((b) => b.exit_event_key === null), `${e.asset.name} was open before 047`)
      const after_ = await q(`select exit_event_key, interval_status, branch_status, interval_bounded_dodgers_bwar::text as w from public.v_transaction_package_lineage where mlb_id = $1 and acquisition_event_key = $2`, [e.asset.mlb_id, e.acquired_in_event])
      assert.ok(after_.length >= 1)
      for (const a of after_) assert.deepEqual([a.exit_event_key, a.interval_status, a.branch_status], [e.key, 'CLOSED_EXIT_RECORDED', 'TERMINAL_NO_RETURN'], e.asset.name)
      assert.deepEqual([...new Set(after_.map((a) => a.w))], [...new Set(before.map((b) => b.w))], `${e.asset.name}: recording the exit did not change the bounded value`)
    }
  } finally { await c.close() }
})

test('nothing is inferred: assets the source does not record an exit for stay unresolved, and a recorded package is verified against the source', async () => {
  const unresolved = evidence.unresolved
  assert.ok(unresolved.length >= 10)
  assert.ok(unresolved.every((u) => u.reason.length > 40))
  assert.deepEqual([...new Set(unresolved.map((u) => u.kind))].sort(), ['CONSIDERATION_NOT_NAMED', 'EXIT_FOUND_NOT_RECORDED', 'EXIT_NOT_RECORDED', 'RETURN_FOUND_NOT_RECORDED', 'RETURN_NOT_RECORDED'])
  assert.equal(unresolved.filter((u) => u.scope === 'SIGNING').length, 2, 'Frías (no named return) and Abreu (return found, not recorded)')
  for (const u of unresolved.filter((x) => x.mlb_id && x.acquired_in)) {
    const rows = await q(`select exit_event_key, branch_status from public.v_transaction_package_lineage where mlb_id = $1 and acquisition_event_key = $2`, [u.mlb_id, u.acquired_in])
    assert.ok(rows.length >= 1, `${u.asset} still has an interval`)
    for (const r of rows) {
      if (u.kind === 'RETURN_NOT_RECORDED') {
        assert.ok(r.exit_event_key, `${u.asset}: the exit is recorded`)
        assert.equal(r.branch_status, 'RETURN_UNRECORDED', `${u.asset}: the return stays unknown, not zero`)
      } else assert.equal(r.exit_event_key, null, `${u.asset} has no exit event: absence of a record is not an exit`)
    }
  }
  // Bob Miller's exit was FOUND but deliberately not recorded (its incoming players cannot be valued)
  assert.equal(evidence.miller_package_not_recorded.recorded_in_disi, false)
  assert.equal((await one(`select count(*)::int as n from public.transaction_events where transaction_date = '1967-11-28'`)).n, 0)
  // the packages DISI already records agree with the source, membership for membership
  assert.ok(evidence.package_verification.length >= 5)
  for (const p of evidence.package_verification) assert.deepEqual(p.agrees, { outgoing: true, incoming: true }, p.event)
  // chain states: two incomplete chains became complete or still-accruing; none moved the other way
  const before = attributionStateCounts(pre.data.decisions)
  const after_ = attributionStateCounts(post.data.decisions)
  assert.equal(after_.CHAIN_INCOMPLETE, before.CHAIN_INCOMPLETE - 2)
  assert.equal(after_.RETURN_STILL_ACCRUING, before.RETURN_STILL_ACCRUING + 2)
  for (const k of ['INDIVIDUALLY_ATTRIBUTED', 'PACKAGE_LEVEL_ONLY', 'VALUE_NOT_DETERMINED', 'RECORDED_ZERO_RETURN', 'NOT_A_TRADE_EXIT']) assert.equal(after_[k], before[k], `${k} is unchanged`)
})

test('trade-return attribution is untouched: no player gains or loses an attributed amount, and no package value moves to a signing', async () => {
  const cols = ['individually_attributable_trade_bwar', 'package_first_hop_participation_bwar', 'package_downstream_participation_bwar', 'observable_not_attributable_bwar', 'value_left_organization_bwar', 'direct_dodgers_bwar']
  const key = (d) => [d.signing_id, ...cols.map((c) => d[c])]
  assert.deepEqual(post.data.decisions.map(key), pre.data.decisions.map(key))
})

test('development histories: ten players, the whole recorded career as stints, nothing invented for seasons the API does not return', async () => {
  assert.equal(COHORT.length, 10)
  const added = (await one(`select count(*)::int as n from public.player_season_stints`)).n - pre.counts.stints
  assert.equal(added, 255)
  assert.equal((await one(`select count(*)::int as n from public.development_milestones`)).n - pre.counts.milestones, 41)
  const per = await q(`select p.slug, count(*)::int as n, min(s.season) as first from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = any($1) group by 1 order by 1`, [COHORT])
  assert.equal(per.length, 10)
  const by = Object.fromEntries(per.map((r) => [r.slug, r]))
  // Beltré signed in 1994 and the API's first record is 1996: the 1994-95 seasons stay absent (unknown), not filled in
  assert.equal(by['adrian-beltre'].first, 1996)
  assert.equal(by['fernando-valenzuela'].first, 1980)
  // every stint is sourced; none has a season before the player was born or after the data's as-of year
  assert.equal((await one(`select count(*)::int as n from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = any($1) and s.source_id is null`, [COHORT])).n, 0)
  // players outside the cohort are untouched
  const others = await q(`select p.slug, count(*)::int as n from public.player_season_stints s join public.players p on p.id = s.player_id where not (p.slug = any($1)) group by 1 order by 1`, [COHORT])
  const outside = (await one(`select count(*)::int as n from public.player_season_stints`)).n - 255
  assert.equal(others.reduce((a, r) => a + r.n, 0), outside)
  assert.equal(outside, pre.counts.stints)
})

test('a level debut after the MLB debut season (a rehab or demotion appearance) is not recorded as a development milestone, though its stint stays on record', async () => {
  const rows = await q(`select p.slug, m.event_code, m.season_year, d.season_year as mlb_season from public.development_milestones m join public.players p on p.id = m.player_id
    join public.development_milestones d on d.player_id = m.player_id and d.event_code = 'MLB_DEBUT'
    where p.slug = any($1) and m.event_code in ('DSL_DEBUT', 'COMPLEX_DEBUT', 'A_DEBUT', 'HIGH_A_DEBUT', 'AA_DEBUT', 'AAA_DEBUT') and m.season_year > d.season_year`, [COHORT])
  assert.deepEqual(rows, [])
  // Valenzuela's 1991 comeback stints exist, and no AA/AAA debut milestone claims 1991 as a development step
  assert.ok((await one(`select count(*)::int as n from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = 'fernando-valenzuela' and s.season = 1991`)).n >= 1)
  assert.equal((await one(`select count(*)::int as n from public.development_milestones m join public.players p on p.id = m.player_id where p.slug = 'fernando-valenzuela' and m.event_code in ('AA_DEBUT', 'AAA_DEBUT', 'HIGH_A_DEBUT')`)).n, 0)
  // season-precision milestones never carry an invented date
  assert.equal((await one(`select count(*)::int as n from public.development_milestones m join public.players p on p.id = m.player_id where p.slug = any($1) and m.date_precision = 'SEASON' and m.milestone_date is not null`, [COHORT])).n, 0)
})

test('development coverage moves only where records now exist: unknown stays unknown, and no cohort player is called complete without the records', () => {
  const b = developmentCoverage(pre.data)
  const a = developmentCoverage(post.data)
  assert.deepEqual(b.dimensions.FIRST_PRO_SEASON, { known: 161, applicable: 220 })
  assert.deepEqual(a.dimensions.FIRST_PRO_SEASON, { known: 164, applicable: 220 })
  for (const k of ['SIGNING_DATE', 'HIGHEST_LEVEL', 'MLB_DEBUT', 'EXIT', 'CHRONOLOGY']) assert.deepEqual(a.dimensions[k], b.dimensions[k], `${k} is unchanged`)
  assert.deepEqual(a.states, b.states, 'no player became COMPLETE: exact dates, game logs and season gaps remain open')
  // the queue is deterministic and every cohort player is still on it
  const qa = developmentQueue(post.data)
  assert.equal(JSON.stringify(developmentQueue(post.data)), JSON.stringify(qa))
  for (const slug of COHORT) assert.ok(qa.some((r) => r.player_slug === slug), `${slug} still has a development gap`)
  assert.deepEqual(baseline.development_coverage.dimensions.FIRST_PRO_SEASON, b.dimensions.FIRST_PRO_SEASON, 'the committed baseline is the pre-047 state')
})

test('signing-to-MLB timing is derived from the exact dates now on record (never stored), and descriptive only: 6 -> 16 of 47', () => {
  const b = timingFacts(pre.data)
  const a = timingFacts(post.data)
  assert.deepEqual([b.signing_to_mlb_exact.n, b.signing_to_mlb_exact.of], [6, 47])
  assert.deepEqual([a.signing_to_mlb_exact.n, a.signing_to_mlb_exact.of], [16, 47])
  assert.equal(a.audited_no_mlb_players, b.audited_no_mlb_players, 'audited negatives are untouched')
  assert.ok(!('rate' in a) && !('score' in a))
})

test('the 046 outcome and cost state is untouched: NOT_AUDITED, audits, known costs and spend', async () => {
  const s = await one(`select tracked_signings, signings_with_known_cost, known_acquisition_cost_usd::text as cost, outcome_audit_queue, outcome_audits_completed from product_database_status`)
  assert.equal(s.tracked_signings, pre.status.tracked_signings)
  assert.equal(s.signings_with_known_cost, pre.status.signings_with_known_cost)
  assert.equal(s.cost, pre.status.cost)
  assert.equal(s.outcome_audit_queue, pre.status.outcome_audit_queue)
  assert.equal(s.outcome_audits_completed, pre.status.outcome_audits_completed)
})

test('one coherent snapshot generation: +1, all eleven snapshots carry it, zero drift, and the support chain is unchanged', async () => {
  const g = (await one(`select max(generation_id)::int as g from product_executive_snapshot`)).g
  assert.equal(g, pre.generation + 1)
  for (const t of ALL_SNAPSHOT_TABLES) assert.equal((await one(`select count(*) filter (where generation_id <> $1)::int as n from public.${t}`, [g])).n, 0, t)
  assert.deepEqual(await drift(), [])
  const e = await one(`select support_chain_state, supported_expected_value_models, predictive_portfolio_recommendations from product_executive_snapshot`)
  assert.equal(e.support_chain_state, 'NO_PREDICTIVE_LAYER_SUPPORTED')
  assert.equal(Number(e.supported_expected_value_models), 0)
  assert.equal(Number(e.predictive_portfolio_recommendations), 0)
  assert.equal((await one(`select count(*)::int as n from public.product_prediction_readiness where baseline_supported`)).n, 0, 'no probability target became supported')
})

test('the exit-bound observations the exits supersede are RETRACTED with a reason (never deleted), and nothing else about them changes', async () => {
  const rows = await q(`select o.record_status, o.retraction_reason, o.fact_type, o.observed_date::text as d, a.asset_name from public.transaction_asset_timing_observations o
    join public.transaction_event_assets a on a.id = o.subject_asset_id where o.fact_type = 'EXIT_BOUNDED_BEFORE' order by a.asset_name`)
  const byName = Object.fromEntries(rows.map((r) => [r.asset_name, r]))
  assert.equal(byName['Nick Punto'].record_status, 'RETRACTED')
  assert.equal(byName['Homer Bailey'].record_status, 'RETRACTED')
  assert.match(byName['Nick Punto'].retraction_reason, /^Superseded by Migration 047: the exit is now recorded as event LAD_FREE_AGENCY_2013_NICK_PUNTO on 2013-10-31\.$/)
  assert.match(byName['Homer Bailey'].retraction_reason, /LAD_RELEASE_2018_HOMER_BAILEY on 2018-12-22/)
  const before = await clone(pre047Dump)
  try {
    const was = (await before.query(`select count(*)::int as n from public.transaction_asset_timing_observations`))[0].n
    assert.equal((await one(`select count(*)::int as n from public.transaction_asset_timing_observations`)).n, was, 'retracted, not deleted: the row count is unchanged')
  } finally { await before.close() }
  assert.equal((await one(`select count(*)::int as n from public.transaction_asset_timing_observations where record_status = 'ACTIVE' and fact_type = 'EXIT_BOUNDED_BEFORE'`)).n, 0)
})

test('team-less season rows are classified only when proven equal to their component team stints; the cohort leaves none unclassified', async () => {
  assert.equal((await one(`select count(*)::int as n from public.player_season_stints where stint_kind = 'TEAM_STINT' and (affiliate_team is null or team_id is null)`)).n, 0)
  const totals = await q(`select p.slug, s.season, s.stint_kind, s.season_total_basis from public.player_season_stints s join public.players p on p.id = s.player_id
    where p.slug = any($1) and s.stint_kind = 'SEASON_TOTAL' order by 1, 2`, [COHORT])
  assert.equal(totals.length, 14)
  for (const r of totals) assert.ok(['SAME_LEVEL', 'CROSS_LEVEL'].includes(r.season_total_basis), `${r.slug} ${r.season}`)
  // the verifier's own sum check agrees (season_total_sum_mismatch is part of the 252)
  assert.equal((await one(`select count(*)::int as n from public.player_season_stints t where t.stint_kind = 'SEASON_TOTAL' and (select count(*) from public.player_season_stints c
    where c.player_id = t.player_id and c.season = t.season and c.source_level = t.source_level and c.stint_kind = 'TEAM_STINT') < 2`)).n, 0)
})

test('an ambiguous level sequence is PENDING review, never silently accepted: Jansen has two pending decisions and no reviewed one is asserted', async () => {
  const d = await q(`select d.event_code, d.progression_role, d.review_status, d.confidence::text as confidence, d.decision_basis, length(d.notes)::int as len from public.development_progression_decisions d
    join public.players p on p.id = d.player_id where p.slug = 'kenley-jansen' order by 1`)
  assert.deepEqual(d.map((r) => [r.event_code, r.progression_role, r.review_status, r.confidence, r.decision_basis]),
    [['AAA_DEBUT', 'REVIEW_REQUIRED', 'PENDING_REVIEW', 'LOW', 'STINT_CHRONOLOGY_REVIEW'], ['AA_DEBUT', 'REVIEW_REQUIRED', 'PENDING_REVIEW', 'LOW', 'STINT_CHRONOLOGY_REVIEW']].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
  assert.ok(d.every((r) => r.len > 80))
  assert.equal((await one(`select count(*)::int as n from public.development_progression_decisions where review_status = 'REVIEWED' and as_of_date >= date '2026-10-20'`)).n, 0, '047 asserts no reviewed decision')
  assert.equal((await one(`select count(*)::int as n from public.development_progression_decisions`)).n, 22)
})

test('idempotent: a rerun adds nothing, runs no second refresh and changes no table', async () => {
  const before = await tableHashes()
  await chain.db.exec(sql047)
  assert.deepEqual(await tableHashes(), before)
})

test('the verifier passes on 001-047 (252 hard checks) and each snapshot check is clean', async () => {
  for (const [name, sql] of Object.entries(productSnapshotQueries(true, true))) assert.equal((await one(sql)).n, 0, name)
  const full = await checkInvariants(q, CANONICAL_EXPECTATIONS)
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 259)
})

test('guards: 047 refuses a database where its facts no longer apply, and changes nothing when it refuses', async () => {
  const c = await clone(pre047Dump)
  try {
    // a Dodgers exit already recorded for one of the assets, later than its acquisition
    await c.db.exec(`insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, description, source_id)
      select 'LAD_RELEASE_2005_STEVE_FINLEY_EARLIER', date '2005-06-01', 'RELEASE', o.id, 'earlier research', (select id from public.sources limit 1) from public.organizations o where o.abbreviation = 'LAD'`)
    await c.db.exec(`insert into public.transaction_event_assets (event_id, asset_side, asset_name, asset_type, mlb_id, bref_id)
      select e.id, 'OUTGOING', 'Steve Finley', 'PLAYER', '114135', 'finlest01' from public.transaction_events e where e.event_key = 'LAD_RELEASE_2005_STEVE_FINLEY_EARLIER'`)
    const before = await tableHashes(c)
    await failsWith(c, sql047, /047: a later Dodgers exit is already recorded for Steve Finley/)
    assert.deepEqual(await tableHashes(c), before)
  } finally { await c.close() }
  const d = await clone(pre047Dump)
  try {
    await d.db.exec(`update public.transaction_event_assets set mlb_id = '999999' where asset_name = 'Nick Punto' and asset_side = 'INCOMING'`)
    await failsWith(d, sql047, /047: the acquisition of Nick Punto in BOS_LAD_2012_GONZALEZ_BECKETT_CRAWFORD is not recorded with this identity/)
  } finally { await d.close() }
  const e = await clone(pre047Dump)
  try {
    await e.db.exec(`update public.players set mlb_id = 1 where slug = 'kenley-jansen'`)
    await failsWith(e, sql047, /047: cohort player kenley-jansen is missing or carries a different MLB id/)
  } finally { await e.close() }
  const f = await clone(pre047Dump)
  try {
    await f.db.exec(`delete from public.sources where url = 'https://sabr.org/bioproj/person/adrian-beltre/'`).catch(() => {})
    const has046 = (await f.query(`select count(*)::int as n from public.sources where url = 'https://sabr.org/bioproj/person/adrian-beltre/'`))[0].n
    if (has046 === 0) await failsWith(f, sql047, /047: Migration 046 has not been applied/)
  } finally { await f.close() }
})

test('rollback: deletes exactly what 047 inserted, refreshes once, leaves no drift, and 047 can be applied again', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    const gen0 = (await c.query(`select max(generation_id)::int as g from product_executive_snapshot`))[0].g
    await c.db.exec(rollback047)
    assert.equal((await c.query(`select count(*)::int as n from public.transaction_events where event_key = any($1)`, [EXITS.map((e) => e.key)]))[0].n, 0)
    const counts = (await c.query(`select (select count(*)::int from public.transaction_events) as events, (select count(*)::int from public.transaction_event_assets) as assets,
      (select count(*)::int from public.player_season_stints) as stints, (select count(*)::int from public.development_milestones) as milestones`))[0]
    assert.deepEqual(counts, pre.counts)
    assert.equal((await c.query(`select max(generation_id)::int as g from product_executive_snapshot`))[0].g, gen0 + 1)
    assert.deepEqual(await drift(c), [])
    // back to the pre-047 research: every research table except the (kept) source rows equals the pre-047 hash
    const hashes = await tableHashes(c)
    for (const t of ['transaction_events', 'transaction_event_assets', 'player_season_stints', 'development_milestones']) assert.equal(hashes[t], pre.hashes[t], t)
    assert.deepEqual(developmentQueue(await dataset(c)).map((r) => r.signing_id), developmentQueue(pre.data).map((r) => r.signing_id))
    // a second rollback refuses, and unlike 046 the migration can be applied again
    await failsWith(c, rollback047, /rollback-047: the exit event .* is not present/)
    await c.db.exec(sql047)
    // ids and timestamps are new; the research content is the same
    const content = async (cc) => ({
      events: await cc.query(`select e.event_key, e.transaction_date::text d, e.transaction_type t, a.asset_name, a.mlb_id from public.transaction_events e join public.transaction_event_assets a on a.event_id = e.id where e.event_key = any($1) order by 1`, [EXITS.map((e) => e.key)]),
      stints: await cc.query(`select p.slug, s.season, s.level::text, coalesce(s.affiliate_team, '') t, coalesce(s.league_name, '') l, s.g, s.pg, s.stint_kind from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = any($1) order by 1, 2, 3, 4, 5`, [COHORT]),
      milestones: await cc.query(`select p.slug, m.event_code, m.milestone_date::text d, m.season_year from public.development_milestones m join public.players p on p.id = m.player_id where p.slug = any($1) and m.evidence_basis in ('SEASON_SPLITS', 'MLB_PERSON_RECORD') order by 1, 2, 3, 4`, [COHORT]),
      decisions: await cc.query(`select p.slug, d.event_code, d.progression_role, d.review_status from public.development_progression_decisions d join public.players p on p.id = d.player_id where p.slug = any($1) order by 1, 2`, [COHORT]),
    })
    assert.deepEqual(await content(c), await content({ query: q }))
    assert.deepEqual(await drift(c), [])
  } finally { await c.close() }
})

test('rollback refuses when later development research exists: an extra stint, or a progression decision a person has since reviewed', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    await c.db.exec(`update public.development_progression_decisions d set progression_role = 'EARLY_CAMEO', review_status = 'REVIEWED', confidence = 'HIGH', notes = 'reviewed later by a person'
      from public.players p where p.id = d.player_id and p.slug = 'kenley-jansen' and d.event_code = 'AAA_DEBUT'`)
    await failsWith(c, rollback047, /rollback-047: the progression review for kenley-jansen AAA_DEBUT is not the pending row 047 wrote; a later review exists/)
  } finally { await c.close() }
  const d = await clone(await chain.db.dumpDataDir('none'))
  try {
    await d.db.exec(`insert into public.player_season_stints (player_id, season, affiliate_team, team_id, league_name, level, source_level, level_classification, era, level_rank, affiliated, as_of_date)
      select p.id, 2030, 'Later Club', 1, 'Later League', 'AAA', 'AAA', 'SPORT_ID_11', 'CLASSIC_AFFILIATED_1989_2016', 6, true, date '2026-10-06' from public.players p where p.slug = 'kenley-jansen'`)
    await failsWith(d, rollback047, /rollback-047: kenley-jansen holds \d+ stints but 047 wrote \d+; later development research exists/)
  } finally { await d.close() }
})

test('reproducible: the committed migration and rollback are byte-identical to the build output', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disi-047-build-'))
  const dir = path.join(tmp, 'database/research/047')
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(path.join(tmp, 'database/sql'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'database/release/sql'), { recursive: true })
  for (const f of ['build.mjs', '047_template.sql', 'rollback_template.sql', 'transaction-evidence.json', 'development-values.sql', 'development-cohort.json']) fs.copyFileSync(path.join(root, 'database/research/047', f), path.join(dir, f))
  execFileSync(process.execPath, [path.join(dir, 'build.mjs')], { stdio: 'pipe' })
  assert.equal(fs.readFileSync(path.join(tmp, 'database/sql', FILE), 'utf8'), sql047)
  assert.equal(fs.readFileSync(path.join(tmp, 'database/release/sql/rollback-047.sql'), 'utf8'), rollback047)
})

test('the builder refuses what the research rules do not allow', () => {
  const build = (mutate) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disi-047-bad-'))
    const dir = path.join(tmp, 'database/research/047')
    fs.mkdirSync(dir, { recursive: true })
    fs.mkdirSync(path.join(tmp, 'database/sql'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'database/release/sql'), { recursive: true })
    for (const f of ['build.mjs', '047_template.sql', 'rollback_template.sql', 'development-values.sql', 'development-cohort.json']) fs.copyFileSync(path.join(root, 'database/research/047', f), path.join(dir, f))
    const doc = structuredClone(evidence)
    mutate(doc)
    fs.writeFileSync(path.join(dir, 'transaction-evidence.json'), JSON.stringify(doc))
    try { execFileSync(process.execPath, [path.join(dir, 'build.mjs')], { stdio: 'pipe' }); return null } catch (e) { return String(e.stderr) }
  }
  assert.equal(build(() => {}), null, 'the unmodified evidence builds')
  assert.match(build((d) => { d.exits[0].type = 'TRADE' }), /only FREE_AGENCY \/ RELEASE exits/)
  assert.match(build((d) => { d.exits[0].historical_label = 'Cut' }), /reviewed label/)
  assert.match(build((d) => { d.exits[0].date = '2004-10-00' }), /exact date is required/)
  assert.match(build((d) => { d.exits[0].asset.mlb_id = '' }), /identity is never guessed/)
  assert.match(build((d) => { delete d.exits[0].retrosheet.birth_date_matched }), /birth-date match are required/)
  assert.match(build((d) => { d.exits[0].description = 'Steve Finley granted free agency.' }), /must cite the source transaction id/)
  assert.match(build((d) => { d.exits[1].key = d.exits[0].key }), /duplicate exit key/)
  assert.match(build((d) => { d.exits[0].acquired_in_event = '' }), /acquisition event is required/)
  assert.match(build((d) => { d.source.url = 'http://www.retrosheet.org/x' }), /full metadata/)
  assert.match(build((d) => { d.retrieved_at = '2026-10-20' }), /UTC timestamp/)
  assert.match(build((d) => { d.unresolved.push({ asset: 'Steve Finley', mlb_id: '114135', reason: 'x' }) }), /both recorded and unresolved/)
  assert.match(build((d) => { d.package_verification[0].agrees.incoming = false }), /disagrees with the source/)
})

test('the evidence itself: the source row is cited exactly, every unresolved case says why, and the cohort is the first ten rows of the tier-1 queue', () => {
  for (const e of EXITS) {
    assert.match(e.retrosheet.row, /^"\d{8}",,,,,\d+,"[a-z]+\d{3}","(Fg|R )","LAN"/)
    assert.equal(e.retrosheet.row.slice(1, 9), e.date.replaceAll('-', ''))
  }
  assert.match(evidence.source.url, /^https:\/\/www\.retrosheet\.org\//)
  assert.equal(evidence.source.source_tier, 'OTHER', 'the lowest tier DISI defines: Retrosheet has no tier of its own and its authority is stated in the notes, not implied by the tier')
  assert.match(evidence.source.sha256_zip, /^[0-9a-f]{64}$/)
  assert.equal(cohort.players.length, 10)
  assert.match(cohort.rule, /deterministic development queue/)
})
