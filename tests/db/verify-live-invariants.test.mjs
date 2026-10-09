// Offline tests for scripts/db/lib/invariants.mjs against the canonical
// 001→027 PGlite chain. No live Supabase access is involved.
//
// Drift conditions are simulated inside transactions that are rolled back, so
// the shared chain stays pristine for every scenario.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { buildCanonicalChain } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'
import { runVerifier } from '../../scripts/db/verify-live-invariants.mjs'
import { driftParts, liveDriftSql, cats027, lit } from './drift-027.mjs'

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

test('clean canonical 001→027 state passes every hard invariant', async () => {
  const report = await runChecks()
  assert.deepEqual(failedChecks(report).map((c) => c.name), [])
  // population 4 + development 17 + status 2 + progression 3 + integrity 10
  // + scouting 22 + api 9 + privileges 16 + rls 6 + security_invoker 10
  assert.ok(report.hard.length >= 112, `expected a full battery, got ${report.hard.length}`)
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
  // caught twice: by the development-surface privilege check and (025) by the
  // whole-API-surface table check
  assert.deepEqual(failedChecks(report).map((c) => c.name).sort(), ['privileges:player_season_stints', 'public_tables_api_beyond_select'])
  assert.deepEqual(
    failedChecks(report).find((c) => c.name === 'privileges:player_season_stints').actual.anon,
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

test('025 drift: the whole public API surface is checked from the ACLs, not just the development objects', async () => {
  // a legacy (non-development) view regains Supabase's default ALL grant for anon
  const all = await withDrift(`grant all on public.v_dodgers_signing_cohort to anon;`)
  assert.deepEqual(failedChecks(all).map((c) => c.name), ['public_views_anon_beyond_select'])
  assert.equal(failedChecks(all)[0].actual, 1)
  // MAINTAIN alone: invisible to information_schema.role_table_grants, caught from the ACL
  const maintain = await withDrift(`grant maintain on public.v_league_signing_benchmark to authenticated;`)
  assert.deepEqual(failedChecks(maintain).map((c) => c.name), ['public_views_authenticated_beyond_select'])
  // a view that stops being security_invoker
  const definer = await withDrift(`alter view public.v_dodgers_signing_cohort set (security_invoker = false);`)
  assert.deepEqual(failedChecks(definer).map((c) => c.name), ['public_views_non_security_invoker'])
  // a base table outside the development surface: write grant, lost RLS, write policy, PUBLIC grant
  const tableWrite = await withDrift(`grant insert on public.players to authenticated;`)
  assert.deepEqual(failedChecks(tableWrite).map((c) => c.name), ['public_tables_api_beyond_select'])
  const noRls = await withDrift(`alter table public.players disable row level security;`)
  assert.deepEqual(failedChecks(noRls).map((c) => c.name), ['public_tables_without_rls'])
  const policy = await withDrift(`create policy drift_insert on public.players for insert to anon with check (true);`)
  assert.deepEqual(failedChecks(policy).map((c) => c.name), ['public_api_write_policies'])
  const publicRole = await withDrift(`grant select on public.v_dodgers_market_summary to public;`)
  assert.deepEqual(failedChecks(publicRole).map((c) => c.name), ['public_role_relation_grants'])
  // an extra (unreviewed) view moves the reviewed total
  const extra = await withDrift(`create view public.zz_extra with (security_invoker = true) as select 1 as x; grant select on public.zz_extra to anon, authenticated;`)
  assert.deepEqual(failedChecks(extra).map((c) => c.name), ['public_views_total'])
  assert.equal(await runVerifier(chain.query, 'restored test state'), 0)
})

test('026 drift: scouting integrity is checked from the data itself, each kind of damage failing exactly its checks', async () => {
  const eloy = `(select e.id from public.player_evaluations e join public.players p on p.id = e.player_id where p.slug = 'eloy-jimenez')`
  const names = (report) => failedChecks(report).map((c) => c.name).sort()
  // a backfilled evaluation deleted: totals move and its legacy rank is no longer represented
  assert.deepEqual(names(await withDrift(`alter table public.player_evaluations disable trigger player_evaluations_guard;
    delete from public.player_evaluations where id = ${eloy};`)),
    ['player_evaluations', 'scouting_legacy_ranks_backfilled', 'scouting_legacy_ranks_unrepresented'])
  // the legacy table comes back (without RLS)
  assert.deepEqual(names(await withDrift(`create table public.evaluations (id int);`)),
    ['legacy_evaluations_table_present', 'public_tables_total', 'public_tables_without_rls'])
  // a stored rank no longer matches the legacy value it was backfilled from (immutability trigger bypassed)
  assert.deepEqual(names(await withDrift(`
    alter table public.player_evaluation_rankings disable trigger player_evaluation_rankings_immutable;
    update public.player_evaluation_rankings set rank = rank + 1 where evaluation_id = ${eloy};`)), ['scouting_legacy_rank_mismatches'])
  // a DISI_RESEARCH publication appears
  assert.deepEqual(names(await withDrift(`insert into public.scouting_publications (publication_slug, publication_name, publisher, origin, publication_kind, access_class)
    values ('disi-notes', 'DISI notes', 'DISI', 'DISI_RESEARCH', 'OTHER', 'OPEN');`)), ['scouting_disi_research_publications', 'scouting_publications'])
  // an evaluation marked SUPERSEDED with no successor (it also stops representing its legacy rank: only ACTIVE counts)
  assert.deepEqual(names(await withDrift(`alter table public.player_evaluations disable trigger player_evaluations_guard;
    update public.player_evaluations set record_status = 'SUPERSEDED' where id = ${eloy};`)),
    ['player_evaluations_superseded', 'scouting_legacy_ranks_backfilled', 'scouting_legacy_ranks_unrepresented', 'scouting_supersession_violations'])
  // a grade outside its scale (scale trigger bypassed)
  assert.deepEqual(names(await withDrift(`
    alter table public.player_evaluation_grades disable trigger player_evaluation_grades_check_scale;
    alter table public.player_evaluation_grades disable trigger player_evaluation_grades_immutable;
    insert into public.player_evaluation_grades (evaluation_id, dimension_code, temporal_basis, raw_value, raw_label, scale_code)
    values (${eloy}, 'HIT', 'FUTURE', 85, '85', 'SCOUTING_20_80');`)), ['scouting_scale_violations'])
  // an evaluation with no provenance (constraint dropped)
  assert.deepEqual(names(await withDrift(`
    alter table public.player_evaluations drop constraint player_evaluations_provenance_check;
    insert into public.player_evaluations (player_id, publication_id, evaluation_context, date_precision, evidence_basis, retrieved_at)
    select player_id, publication_id, 'OTHER', 'UNKNOWN', 'MANUAL_TRANSCRIPTION', now() from public.player_evaluations limit 1;`)),
    ['player_evaluations', 'scouting_evaluations_without_provenance'])
  // a guard trigger removed
  assert.deepEqual(names(await withDrift(`drop trigger player_evaluations_guard on public.player_evaluations;`)), ['scouting_guard_triggers', 'scouting_sealed_trigger_events'])
  // a sealing trigger that no longer covers DELETE
  assert.deepEqual(names(await withDrift(`drop trigger player_evaluation_notes_immutable on public.player_evaluation_notes;
    create trigger player_evaluation_notes_immutable before insert or update on public.player_evaluation_notes
    for each row execute function public.disi_evaluation_child_immutable();`)), ['scouting_sealed_trigger_events'])
  // an international-class rank filed under an MLB-wide list context
  assert.deepEqual(names(await withDrift(`alter table public.player_evaluations disable trigger player_evaluations_guard;
    update public.player_evaluations set evaluation_context = 'GLOBAL_LIST' where id = ${eloy};`)), ['scouting_international_rank_context_violations'])
  // a replacement that supersedes an ACTIVE row (the predecessor was never retired), and a second replacement for one predecessor
  assert.deepEqual(names(await withDrift(`alter table public.player_evaluations disable trigger player_evaluations_guard;
    drop index public.player_evaluations_snapshot_key;
    drop index public.player_evaluations_supersedes_key;
    insert into public.player_evaluations (player_id, publication_id, evaluation_context, date_precision, evaluation_date, evaluation_year, evaluation_month,
      evidence_basis, confidence, source_id, retrieved_at, supersedes_evaluation_id, record_status)
    select player_id, publication_id, evaluation_context, date_precision, evaluation_date, evaluation_year, evaluation_month,
      evidence_basis, confidence, source_id, retrieved_at, id, 'ACTIVE' from public.player_evaluations where id = ${eloy};`)),
    ['player_evaluations', 'scouting_supersession_violations'])
  // a broad grant on a new scouting view is caught by the whole-surface check
  assert.deepEqual(names(await withDrift(`grant all on public.v_player_scouting_timeline to anon;`)), ['public_views_anon_beyond_select'])
  assert.equal(await runVerifier(chain.query, 'restored test state'), 0)
})

test('027 drift: each part of the Migration-002 seed drift fails exactly its reconciliation checks; presence checks ignore legitimate growth', async () => {
  const names = (report) => failedChecks(report).map((c) => c.name).sort()
  assert.deepEqual(names(await withDrift(driftParts.environments())),
    ['reconciliation_affected_signings_without_environment', 'reconciliation_signing_environment_violations', 'reconciliation_signing_link_violations'])
  assert.deepEqual(names(await withDrift(driftParts.transaction())), ['reconciliation_transaction_violations'])
  assert.deepEqual(names(await withDrift(driftParts.aliases())), ['reconciliation_alias_violations'])
  assert.deepEqual(names(await withDrift(driftParts.sourceMetadata())), ['reconciliation_source_violations'])
  // a missing claim that cites a missing source
  assert.deepEqual(names(await withDrift(`${driftParts.evidence()}`)), ['reconciliation_evidence_violations', 'reconciliation_evidence_variant_coexistence'].sort())
  // a trainer-asserting seed note coming back (the claim stays, the unverified wording returns)
  const neutral = cats027.evidence_note_neutralizations.entries[0]
  assert.deepEqual(names(await withDrift(`update evidence set evidence_note = ${lit(neutral.replay_original.evidence_note)}
    where entity_type = 'signing' and field_name is null and source_id = (select id from sources where url = ${lit(neutral.selector.url)})
      and entity_id = (select sg.id from signings sg join players p on p.id = sg.player_id where p.slug = ${lit(neutral.selector.player_slug)} and sg.signing_year = ${neutral.selector.signing_year});`)),
    ['reconciliation_evidence_violations', 'reconciliation_trainer_note_violations'].sort())
  // the whole known live drift (trainers are already absent in a post-027 chain)
  const all = names(await withDrift(liveDriftSql()))
  for (const expected of ['reconciliation_signing_environment_violations', 'reconciliation_signing_link_violations', 'reconciliation_affected_signings_without_environment',
    'reconciliation_transaction_violations', 'reconciliation_alias_violations', 'reconciliation_source_violations', 'reconciliation_evidence_violations',
    'reconciliation_evidence_variant_coexistence']) assert.ok(all.includes(expected), `${expected} should fail on the known live drift`)
  // the unsupported trainer seed coming back is caught
  assert.deepEqual(names(await withDrift(`insert into trainers (name, academy_name, country) values ('Jaime Ramos', null, 'Dominican Republic');`)), ['legacy_trainers_rows'])
  // a duplicate claim (the canonical row plus a second one) fails the exact-once check, but growth elsewhere does not fail anything
  const claim = cats027.evidence_variants.entries[0]
  assert.deepEqual(names(await withDrift(`insert into evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
    select entity_type, entity_id, field_name, source_id, confidence, evidence_note from evidence
    where entity_type = 'signing' and field_name is null and source_id = (select id from sources where url = ${lit(claim.selector.url)})
      and entity_id = (select sg.id from signings sg join players p on p.id = sg.player_id where p.slug = ${lit(claim.selector.player_slug)} and sg.signing_year = ${claim.selector.signing_year});`)),
    ['reconciliation_evidence_violations'])
  assert.deepEqual(names(await withDrift(`insert into sources (source_name, source_type, title, url) values ('Test', 'ARTICLE', 'Unrelated new source', 'https://example.test/new-source');
    insert into player_aliases (player_id, alias, alias_type) select id, 'Test Alias', 'SOURCE_VARIANT' from players limit 1;`)), [],
    'new sources and aliases are legitimate growth')
  assert.equal(await runVerifier(chain.query, 'restored test state'), 0)
})
