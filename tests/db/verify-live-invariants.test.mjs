// Offline tests for scripts/db/lib/invariants.mjs against the canonical
// 001→021 PGlite chain. No live Supabase access is involved.
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

test('clean canonical 001→021 state passes every hard invariant', async () => {
  const report = await runChecks()
  assert.deepEqual(failedChecks(report).map((c) => c.name), [])
  // population 4 + development 6 + status 2 + integrity 4 + privileges 13
  // + rls 5 + security_invoker 8
  assert.ok(report.hard.length >= 40, `expected a full battery, got ${report.hard.length}`)
  // informational coverage numbers are reported but never fail
  assert.ok(report.info.length >= 3)
})

test('changing one expected count fails exactly that check', async () => {
  const expectations = { ...CANONICAL_EXPECTATIONS, coded_milestones: 665 }
  const report = await checkInvariants(chain.query, expectations)
  assert.deepEqual(failedChecks(report).map((c) => c.name), ['coded_milestones'])
  assert.equal(failedChecks(report)[0].actual, 666)
})

test('a duplicate stint row fails the duplicate-group check', async () => {
  // The canonical schema forbids duplicates via player_season_stints_stint_key,
  // so the simulation relaxes that index inside the rolled-back transaction.
  const report = await withDrift(`
    drop index public.player_season_stints_stint_key;
    create temp table stints_dup as select * from public.player_season_stints limit 1;
    update stints_dup set id = gen_random_uuid();
    insert into public.player_season_stints select * from stints_dup;
  `)
  // the extra row both duplicates a stint group and moves the row count off 828
  assert.deepEqual(
    failedChecks(report).map((c) => c.name).sort(),
    ['duplicate_stint_groups', 'stints']
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
