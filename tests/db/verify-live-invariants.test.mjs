// Offline tests for scripts/db/lib/invariants.mjs against the canonical
// 001→024 PGlite chain. No live Supabase access is involved.
//
// Drift conditions are simulated inside transactions that are rolled back, so
// the shared chain stays pristine for every scenario.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { buildCanonicalChain } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'
import { runVerifier } from '../../scripts/db/verify-live-invariants.mjs'

let chain
const runChecks = () => checkInvariants(chain.query)

before(async () => {
  chain = await buildCanonicalChain()
}, { timeout: 180000 })

after(async () => { await chain.close() })

/** Runs the invariant checks with drift applied inside a rolled-back transaction. */
async function withDrift(driftSql) {
  await chain.db.exec('begin;')
  try {
    await chain.db.exec(driftSql)
    return await runChecks()
  } finally {
    await chain.db.exec('rollback;')
  }
}

test('clean canonical 001→024 state passes every hard invariant', async () => {
  const report = await runChecks()
  assert.deepEqual(failedChecks(report).map((c) => c.name), [])
  // population 4 + development 17 + status 2 + progression 3 + integrity 10
  // + privileges 16 + rls 6 + security_invoker 10
  assert.ok(report.hard.length >= 68, `expected a full battery, got ${report.hard.length}`)
  // informational coverage numbers are reported but never fail
  assert.ok(report.info.length >= 3)
})

test('changing one expected count fails exactly that check', async () => {
  const expectations = { ...CANONICAL_EXPECTATIONS, coded_milestones: 831 }
  const report = await checkInvariants(chain.query, expectations)
  assert.deepEqual(failedChecks(report).map((c) => c.name), ['coded_milestones'])
  assert.equal(failedChecks(report)[0].actual, 832)
})

test('a duplicate stint row fails the duplicate-group check', async () => {
  // The canonical schema forbids duplicates via player_season_stints_stint_key,
  // so the simulation relaxes that index inside the rolled-back transaction.
  // A pre-2006 stint is duplicated so only the row count and the duplicate
  // group move (the dated-stint and log-era-coverage counts are unaffected).
  const report = await withDrift(`
    drop index public.player_season_stints_stint_key;
    create temp table stints_dup as
      select * from public.player_season_stints where season < 2006 limit 1;
    update stints_dup set id = gen_random_uuid();
    insert into public.player_season_stints select * from stints_dup;
  `)
  // the extra row duplicates a stint group and moves both the raw (828) and
  // effective team-stint (772) counts
  assert.deepEqual(
    failedChecks(report).map((c) => c.name).sort(),
    ['duplicate_stint_groups', 'stints', 'team_stints']
  )
  assert.equal(failedChecks(report).find((c) => c.name === 'duplicate_stint_groups').actual, 1)
  // the rollback restored the canonical state
  const [after] = await chain.query('select count(*)::int as n from player_season_stints')
  assert.equal(after.n, CANONICAL_EXPECTATIONS.stints)
})

test('a SEASON-precision milestone with an exact date fails the precision check', async () => {
  const report = await withDrift(`
    update public.development_milestones
    set milestone_date = date '2021-01-15'
    where event_code = 'ORGANIZATION_CHANGE' and milestone_date is null;
  `)
  assert.deepEqual(failedChecks(report).map((c) => c.name), ['season_milestones_with_date'])
})

test('an affiliated Mexican League stint fails the classification check', async () => {
  const report = await withDrift(`
    update public.player_season_stints
    set level = 'AAA', affiliated = true
    where id = (select id from public.player_season_stints where league_name = 'Mexican League' limit 1);
  `)
  assert.deepEqual(failedChecks(report).map((c) => c.name), ['mexican_league_affiliated_violations'])
  assert.equal(failedChecks(report)[0].actual, 1)
})

test('an excessive anon privilege fails the security check', async () => {
  const report = await withDrift(`
    grant insert on public.player_season_stints to anon;
  `)
  assert.deepEqual(failedChecks(report).map((c) => c.name), ['privileges:player_season_stints'])
  assert.deepEqual(
    failedChecks(report)[0].actual.anon,
    ['INSERT', 'SELECT']
  )
})

test('the exit contract: the verifier exits non-zero when a hard invariant fails', async () => {
  await chain.db.exec('begin;')
  try {
    await chain.db.exec('grant insert on public.player_season_stints to anon;')
    const exitCode = await runVerifier(chain.query, 'drifted test state')
    assert.equal(exitCode, 1)
  } finally {
    await chain.db.exec('rollback;')
  }
  assert.equal(await runVerifier(chain.query, 'restored test state'), 0)
})

test('023 drift: an untagged team-less row, a broken season total and a reverted affiliation each fail exactly their checks', async () => {
  // a season total reverted to TEAM_STINT: it is team-less, and the counts move
  const untagged = await withDrift(`
    update public.player_season_stints set stint_kind = 'TEAM_STINT', season_total_basis = null
    where id = (select id from public.player_season_stints where stint_kind = 'SEASON_TOTAL' and season_total_basis = 'SAME_LEVEL' limit 1);
  `)
  assert.deepEqual(failedChecks(untagged).map((c) => c.name).sort(),
    ['season_total_same_level', 'season_total_stints', 'team_stints', 'undated_log_era_stints', 'untagged_aggregate_rows'])
  // a season total whose games no longer equal its components
  const broken = await withDrift(`
    update public.player_season_stints set g = g + 1
    where id = (select id from public.player_season_stints where stint_kind = 'SEASON_TOTAL' and g is not null and season_total_basis = 'SAME_LEVEL' limit 1);
  `)
  assert.deepEqual(failedChecks(broken).map((c) => c.name), ['season_total_sum_mismatch'])
  assert.equal(failedChecks(broken)[0].actual, 1)
  // the corrected affiliations reverting to the old rule
  const reverted = await withDrift(`
    update public.player_season_stints set organization_id = (select id from public.organizations where name = 'San Francisco Giants')
    where affiliate_team = 'Augusta GreenJackets';
    update public.player_season_stints set organization_id = null
    where affiliate_team = 'Vancouver Canadians' and season = 2019;
  `)
  assert.deepEqual(failedChecks(reverted).map((c) => c.name).sort(), ['augusta_2021plus_non_braves', 'vancouver_2011plus_non_bluejays'])
  assert.equal(await runVerifier(chain.query, 'restored test state'), 0)
})

test('024 drift: a missing decision, an altered role and a borrowed milestone each fail their checks', async () => {
  // a reviewed decision deleted: its counts move and the inversion it covered returns
  const missing = await withDrift(`
    delete from public.development_progression_decisions
    where player_id = (select id from public.players where slug = 'eduardo-guerrero');
  `)
  assert.deepEqual(failedChecks(missing).map((c) => c.name).sort(),
    ['developmental_inversion_players', 'progression_decisions', 'progression_roles'])
  // a pending review silently turned into a reviewed decision
  const altered = await withDrift(`
    update public.development_progression_decisions
    set progression_role = 'DEVELOPMENTAL_ARRIVAL', review_status = 'REVIEWED'
    where player_id = (select id from public.players where slug = 'carlos-frias');
  `)
  assert.deepEqual(failedChecks(altered).map((c) => c.name).sort(),
    ['developmental_inversion_players', 'progression_decisions_pending', 'progression_roles'])
  // a decision pointing at another player's milestone (the composite key relaxed inside the transaction)
  const borrowed = await withDrift(`
    alter table public.development_progression_decisions drop constraint development_progression_decisions_milestone_fkey;
    update public.development_progression_decisions
    set milestone_id = (select m.id from public.development_milestones m join public.players p on p.id = m.player_id
                        where p.slug = 'sean-linan' and m.event_code = 'AAA_DEBUT')
    where player_id = (select id from public.players where slug = 'eduardo-guerrero');
  `)
  assert.deepEqual(failedChecks(borrowed).map((c) => c.name), ['decision_milestone_mismatch'])
  assert.equal(await runVerifier(chain.query, 'restored test state'), 0)
})
