// Canonical drift detection for the DISI research database (read-only).
//
// Every check in this module is a SELECT. Nothing here writes, grants or
// modifies anything, and no credentials live in this file: the caller supplies
// a query function (PGlite for the local canonical chain, or a pg client
// connected with a URL from an environment variable).
//
// Hard invariants are the byte-stable state of the canonical 001→029 chain
// (seeded populations, migration-built rows, schema security properties).
// Informational metrics are research-coverage numbers that may legitimately
// move as research progresses; they are reported but never fail the run.
//
// Expectations are pinned here, never learned from a production database: the
// verifier always fails on values it has not explicitly accepted. A future
// migration that legitimately changes a hard invariant must update
// CANONICAL_EXPECTATIONS in the same commit as that migration.

import { RECONCILIATION_QUERIES } from './seed-reconciliation.mjs'
import { NETWORK_QUERIES } from './network-invariants.mjs'
import { financialQueries } from './financial-invariants.mjs'

/** Canonical 001→029 (DISI v0.20) expected state. */
export const CANONICAL_EXPECTATIONS = {
  // population (seeded by 002/012/013/016/019 and surfaced by v_database_status)
  players_total: 268,
  dodgers_players: 220,
  league_benchmark_players: 48,
  verified_mlb_outcomes: 47,
  // development dataset (021 stints; 022 exact dates; 023 stint integrity)
  // `stints` is the RAW row count. 023 classifies 56 of them as team-less season
  // totals that repeat their component team stints, so analytics read the 772
  // TEAM_STINT rows and `undated_log_era_stints` counts team stints only (the
  // four left are 2018 Mexican League source gaps).
  stints: 828,
  stint_players: 167,
  dated_stints: 746,
  undated_log_era_stints: 4,
  team_stints: 772,
  season_total_stints: 56,
  unresolved_stints: 0,
  season_total_same_level: 34,
  season_total_cross_level: 21,
  season_total_sub_season: 1,
  coded_milestones: 832,
  professional_debut_milestones: 166,
  legacy_milestones: 5,
  mlb_debut_milestones: 7,
  mlb_debut_players: 7,
  organization_change_milestones: 18,
  aa_debut_milestones: 25,
  // 024: status is the highest unambiguously established developmental level;
  // pending milestones do not count as reached and do not invalidate a
  // separately verified higher level (Frias stays MLB). Five reviewed early
  // cameos move (Guerrero and Linan AAA -> AA; Herrera, Rojas and Campos AAA ->
  // A_BALL), as do Avila AAA -> ROOKIE_LEVEL, Romero AAA -> HIGH_A and Cruz
  // HIGH_A -> ROOKIE_LEVEL.
  development_status: {
    ROOKIE_LEVEL: 94,
    MLB: 47,
    A_BALL: 33,
    HIGH_A: 16,
    AAA: 7,
    AA: 14,
    OUT_OF_AFFILIATED_BASEBALL: 1,
  },
  // progression decisions (024): reviewed interpretation of first appearances
  progression_decisions: 20,
  progression_decisions_pending: 9,
  progression_roles: {
    EARLY_CAMEO: 8,
    POST_ESTABLISHMENT_APPEARANCE: 3,
    REVIEW_REQUIRED: 9,
  },
  // integrity
  duplicate_stint_groups: 0,
  season_milestones_with_date: 0,
  day_milestones_without_date: 0,
  mexican_league_affiliated_violations: 0,
  untagged_aggregate_rows: 0,
  season_total_sum_mismatch: 0,
  augusta_2021plus_non_braves: 0,
  vancouver_2011plus_non_bluejays: 0,
  developmental_inversion_players: 0,
  decision_milestone_mismatch: 0,
  // whole public API surface (025). Checked from the ACLs themselves
  // (aclexplode), so privileges information_schema omits (MAINTAIN) count too.
  // 026 adds six tables (and drops the empty legacy evaluations table: 42 - 1 + 6) and five views.
  // 030 adds three tables and four views.
  public_views_total: 97,
  public_views_non_security_invoker: 0,
  public_views_anon_beyond_select: 0,
  public_views_authenticated_beyond_select: 0,
  public_tables_total: 54,
  public_tables_without_rls: 0,
  public_tables_api_beyond_select: 0,
  public_api_write_policies: 0,
  public_role_relation_grants: 0,
  // scouting / evaluation history (026). Only the migration-built canonical state is pinned;
  // research that adds evaluations later updates these numbers in the same commit.
  scouting_publications: 3,
  scouting_disi_research_publications: 0,
  evaluation_scales: 1,
  player_evaluations: 51,
  player_evaluations_superseded: 0,
  legacy_evaluations_table_present: 0,
  scouting_guard_triggers: 5,
  scouting_legacy_ranks_total: 59,
  scouting_legacy_ranks_backfilled: 48,
  scouting_legacy_ranks_unrepresented: 11,
  scouting_legacy_rank_mismatches: 0,
  scouting_orphan_evaluations: 0,
  scouting_orphan_grades: 0,
  scouting_orphan_rankings: 0,
  scouting_orphan_notes: 0,
  scouting_evaluations_without_provenance: 0,
  scouting_rankings_without_scope: 0,
  scouting_scale_violations: 0,
  scouting_origin_violations: 0,
  scouting_model_contamination: 0,
  scouting_date_shape_violations: 0,
  scouting_supersession_violations: 0,
  scouting_sealed_trigger_events: 4,
  scouting_international_rank_context_violations: 0,
  // canonical Migration-002 supplementary seed (reconciled by 027): violation counts, never global totals
  reconciliation_signing_environment_violations: 0,
  reconciliation_signing_link_violations: 0,
  reconciliation_affected_signings_without_environment: 0,
  reconciliation_transaction_violations: 0,
  reconciliation_alias_violations: 0,
  reconciliation_source_violations: 0,
  reconciliation_evidence_violations: 0,
  reconciliation_evidence_variant_coexistence: 0,
  reconciliation_trainer_note_violations: 0,
  // Migration 028 residual reconciliation
  reconciliation_trade_wording_violations: 0,
  reconciliation_class_link_confidence_violations: 0,
  // Migration 029 signing-network layer: structural integrity only, never research coverage
  network_legacy_trainer_objects_present: 0,
  network_entity_provenance_violations: 0,
  network_entity_anchor_violations: 0,
  network_alias_violations: 0,
  network_player_relationship_violations: 0,
  network_entity_relationship_violations: 0,
  network_relationship_compatibility_violations: 0,
  network_signing_player_mismatches: 0,
  network_period_violations: 0,
  network_supersession_violations: 0,
  network_guard_trigger_violations: 0,
  network_identity_review_violations: 0,
  network_normalizer_violations: 0,
  // Migration 030 financial acquisition intelligence: structural integrity only, never research coverage
  financial_signing_report_provenance_violations: 0,
  financial_signing_report_shape_violations: 0,
  financial_environment_report_violations: 0,
  financial_supersession_violations: 0,
  financial_guard_trigger_violations: 0,
  financial_function_violations: 0,
  financial_column_ledger_mismatches: 0,
  financial_environment_column_mismatches: 0,
  financial_pool_treatment_violations: 0,
  financial_pool_charge_violations: 0,
  financial_component_rule_violations: 0,
  financial_view_semantics_violations: 0,
  // Migration 031 reviewed resolutions
  financial_resolution_shape_violations: 0,
  financial_resolution_selection_violations: 0,
  // security surface
  development_base_tables: [
    'player_season_stints',
    'player_development_status',
    'development_levels',
    'development_level_era_map',
    'development_event_codes',
    'development_progression_decisions',
  ],
  development_views: [
    'v_dodgers_player_development_summary',
    'v_player_development_stints',
    'v_player_development_milestones',
    'v_dodgers_development_by_signing_class',
    'v_dodgers_development_by_market',
    'v_dodgers_development_by_bonus_band',
    'v_dodgers_development_research_queue',
    'v_dodgers_development_coverage',
    'v_dodgers_development_date_coverage',
    'v_player_development_progression',
  ],
}

const quoteList = (names) => names.map((n) => `'${n}'`).join(', ')
const sorted = (arr) => [...arr].sort()

/** Key-order-insensitive JSON, so object comparisons never depend on row order. */
const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Runs every canonical invariant against a read-only query function.
 * @param {(sql: string) => Promise<Array<Record<string, unknown>>>} query
 * @param {typeof CANONICAL_EXPECTATIONS} expectations
 * @returns {Promise<{ hard: Array<{group: string, name: string, expected: unknown, actual: unknown, pass: boolean}>, info: Array<{name: string, value: unknown}> }>}
 */
export async function checkInvariants(query, expectations = CANONICAL_EXPECTATIONS) {
  const hard = []
  const info = []
  const check = (group, name, expected, actual) => {
    hard.push({ group, name, expected, actual, pass: stableStringify(expected) === stableStringify(actual) })
  }

  // -- population ------------------------------------------------------------
  const [players] = await query('select count(*)::int as n from players')
  check('population', 'players_total', expectations.players_total, players.n)

  const [status] = await query(
    'select dodgers_players::int as d, league_benchmark_players::int as b, verified_mlb_outcomes::int as v from v_database_status'
  )
  check('population', 'dodgers_players', expectations.dodgers_players, status.d)
  check('population', 'league_benchmark_players', expectations.league_benchmark_players, status.b)
  check('population', 'verified_mlb_outcomes', expectations.verified_mlb_outcomes, status.v)

  // -- development dataset ---------------------------------------------------
  const [stints] = await query(
    `select count(*)::int as n, count(distinct player_id)::int as players,
      count(*) filter (where first_game_date is not null)::int as dated,
      count(*) filter (where season >= 2006 and first_game_date is null and stint_kind = 'TEAM_STINT')::int as undated_log_era,
      count(*) filter (where stint_kind = 'TEAM_STINT')::int as team_stints,
      count(*) filter (where stint_kind = 'SEASON_TOTAL')::int as season_totals,
      count(*) filter (where stint_kind = 'UNRESOLVED')::int as unresolved,
      count(*) filter (where season_total_basis = 'SAME_LEVEL')::int as same_level,
      count(*) filter (where season_total_basis = 'CROSS_LEVEL')::int as cross_level,
      count(*) filter (where season_total_basis = 'SUB_SEASON')::int as sub_season
    from player_season_stints`
  )
  check('development', 'stints', expectations.stints, stints.n)
  check('development', 'stint_players', expectations.stint_players, stints.players)
  check('development', 'dated_stints', expectations.dated_stints, stints.dated)
  check('development', 'undated_log_era_stints', expectations.undated_log_era_stints, stints.undated_log_era)
  check('development', 'team_stints', expectations.team_stints, stints.team_stints)
  check('development', 'season_total_stints', expectations.season_total_stints, stints.season_totals)
  check('development', 'unresolved_stints', expectations.unresolved_stints, stints.unresolved)
  check('development', 'season_total_same_level', expectations.season_total_same_level, stints.same_level)
  check('development', 'season_total_cross_level', expectations.season_total_cross_level, stints.cross_level)
  check('development', 'season_total_sub_season', expectations.season_total_sub_season, stints.sub_season)

  const [milestones] = await query(`select
      count(*) filter (where event_code is not null)::int as coded,
      count(*) filter (where evidence_basis = 'LEGACY_OUTCOME_AUDIT')::int as legacy,
      count(*) filter (where event_code = 'MLB_DEBUT')::int as mlb_debut,
      count(distinct player_id) filter (where event_code = 'MLB_DEBUT')::int as mlb_debut_players,
      count(*) filter (where event_code = 'ORGANIZATION_CHANGE')::int as org_change,
      count(*) filter (where event_code = 'AA_DEBUT')::int as aa_debut,
      count(*) filter (where event_code = 'PROFESSIONAL_DEBUT')::int as pro_debut
    from development_milestones`)
  check('development', 'coded_milestones', expectations.coded_milestones, milestones.coded)
  check('development', 'legacy_milestones', expectations.legacy_milestones, milestones.legacy)
  check('development', 'mlb_debut_milestones', expectations.mlb_debut_milestones, milestones.mlb_debut)
  check('development', 'mlb_debut_players', expectations.mlb_debut_players, milestones.mlb_debut_players)
  check('development', 'organization_change_milestones', expectations.organization_change_milestones, milestones.org_change)
  check('development', 'aa_debut_milestones', expectations.aa_debut_milestones, milestones.aa_debut)
  check('development', 'professional_debut_milestones', expectations.professional_debut_milestones, milestones.pro_debut)

  // -- development status ----------------------------------------------------
  const statusRows = await query(
    'select status::text as status, count(*)::int as n from player_development_status group by 1 order by 1'
  )
  const statusActual = Object.fromEntries(statusRows.map((r) => [r.status, r.n]))
  check('status', 'development_status_distribution', expectations.development_status, statusActual)
  const statusTotal = statusRows.reduce((sum, r) => sum + Number(r.n), 0)
  const expectedTotal = Object.values(expectations.development_status).reduce((sum, n) => sum + n, 0)
  check('status', 'development_status_total', expectedTotal, statusTotal)

  // -- progression decisions (024) -------------------------------------------
  const roleRows = await query(`select progression_role as role, count(*)::int as n,
      count(*) filter (where review_status = 'PENDING_REVIEW')::int as pending
    from development_progression_decisions group by 1 order by 1`)
  check('progression', 'progression_decisions', expectations.progression_decisions,
    roleRows.reduce((sum, r) => sum + Number(r.n), 0))
  check('progression', 'progression_decisions_pending', expectations.progression_decisions_pending,
    roleRows.reduce((sum, r) => sum + Number(r.pending), 0))
  check('progression', 'progression_roles', expectations.progression_roles,
    Object.fromEntries(roleRows.map((r) => [r.role, r.n])))

  // -- integrity -------------------------------------------------------------
  const [duplicates] = await query(`select count(*)::int as n from (
      select player_id, season, level, coalesce(affiliate_team, '') as affiliate, coalesce(league_name, '') as league
      from player_season_stints
      group by 1, 2, 3, 4, 5
      having count(*) > 1
    ) d`)
  check('integrity', 'duplicate_stint_groups', expectations.duplicate_stint_groups, duplicates.n)

  const [precision] = await query(`select
      count(*) filter (where date_precision = 'SEASON' and milestone_date is not null)::int as season_with_date,
      count(*) filter (where date_precision = 'DAY' and milestone_date is null)::int as day_without_date
    from development_milestones where event_code is not null`)
  check('integrity', 'season_milestones_with_date', expectations.season_milestones_with_date, precision.season_with_date)
  check('integrity', 'day_milestones_without_date', expectations.day_milestones_without_date, precision.day_without_date)

  const [mexican] = await query(`select count(*)::int as n from player_season_stints
    where league_name = 'Mexican League' and (level <> 'FOREIGN_PRO' or affiliated)`)
  check('integrity', 'mexican_league_affiliated_violations', expectations.mexican_league_affiliated_violations, mexican.n)

  // 023: every team-less row is explicitly classified, every season total still
  // equals its component team stints, and the two corrected affiliations hold.
  const [untagged] = await query(`select count(*)::int as n from player_season_stints
    where stint_kind = 'TEAM_STINT' and (affiliate_team is null or team_id is null)`)
  check('integrity', 'untagged_aggregate_rows', expectations.untagged_aggregate_rows, untagged.n)

  const [mismatch] = await query(`select count(*)::int as n
    from player_season_stints t
    left join lateral (
      select count(*) as n, sum(c.g) as g, sum(c.pa) as pa, sum(c.ab) as ab, sum(c.h) as h,
             sum(c.pg) as pg, sum(c.bf) as bf, sum(c.pso) as pso
      from player_season_stints c
      where c.player_id = t.player_id and c.season = t.season and c.source_level = t.source_level
        and c.stint_kind = 'TEAM_STINT'
    ) comp on true
    where t.stint_kind = 'SEASON_TOTAL'
      and (comp.n < 2
        or (t.season_total_basis = 'SUB_SEASON' and coalesce(t.g, t.pg) >= coalesce(comp.g, comp.pg))
        or (t.season_total_basis <> 'SUB_SEASON' and (
              (t.g is not null and t.g <> coalesce(comp.g, 0)) or (t.pa is not null and t.pa <> coalesce(comp.pa, 0))
           or (t.ab is not null and t.ab <> coalesce(comp.ab, 0)) or (t.h is not null and t.h <> coalesce(comp.h, 0))
           or (t.pg is not null and t.pg <> coalesce(comp.pg, 0)) or (t.bf is not null and t.bf <> coalesce(comp.bf, 0))
           or (t.pso is not null and t.pso <> coalesce(comp.pso, 0)))))`)
  check('integrity', 'season_total_sum_mismatch', expectations.season_total_sum_mismatch, mismatch.n)

  const [augusta] = await query(`select count(*)::int as n from player_season_stints s
    where s.affiliate_team = 'Augusta GreenJackets' and s.season >= 2021
      and not exists (select 1 from organizations o where o.id = s.organization_id and o.name = 'Atlanta Braves')`)
  check('integrity', 'augusta_2021plus_non_braves', expectations.augusta_2021plus_non_braves, augusta.n)
  const [vancouver] = await query(`select count(*)::int as n from player_season_stints s
    where s.affiliate_team = 'Vancouver Canadians' and s.season >= 2011
      and not exists (select 1 from organizations o where o.id = s.organization_id and o.name = 'Toronto Blue Jays')`)
  check('integrity', 'vancouver_2011plus_non_bluejays', expectations.vancouver_2011plus_non_bluejays, vancouver.n)

  // 024: developmental arrivals never run backward (any player, not just the
  // Dodgers queue), and every decision points at its own player's milestone.
  const [inversions] = await query(`select count(distinct lo.player_id)::int as n
    from v_player_development_progression lo
    join v_player_development_progression hi on hi.player_id = lo.player_id and hi.progression_tier > lo.progression_tier
    where lo.development_state = 'REACHED' and hi.development_state = 'REACHED'
      and case when lo.developmental_arrival_date is not null and hi.developmental_arrival_date is not null
               then lo.developmental_arrival_date > hi.developmental_arrival_date
               else lo.developmental_arrival_season > hi.developmental_arrival_season end`)
  check('integrity', 'developmental_inversion_players', expectations.developmental_inversion_players, inversions.n)
  const [mismatch024] = await query(`select count(*)::int as n from development_progression_decisions d
    where not exists (select 1 from development_milestones m
      where m.id = d.milestone_id and m.player_id = d.player_id and m.event_code = d.event_code)`)
  check('integrity', 'decision_milestone_mismatch', expectations.decision_milestone_mismatch, mismatch024.n)

  // -- scouting / evaluation history (026) ------------------------------------
  const count = async (sql) => (await query(sql))[0].n
  check('scouting', 'scouting_publications', expectations.scouting_publications, await count('select count(*)::int as n from scouting_publications'))
  check('scouting', 'scouting_disi_research_publications', expectations.scouting_disi_research_publications,
    await count(`select count(*)::int as n from scouting_publications where origin = 'DISI_RESEARCH'`))
  check('scouting', 'evaluation_scales', expectations.evaluation_scales, await count('select count(*)::int as n from evaluation_scales'))
  check('scouting', 'player_evaluations', expectations.player_evaluations, await count('select count(*)::int as n from player_evaluations'))
  check('scouting', 'player_evaluations_superseded', expectations.player_evaluations_superseded,
    await count(`select count(*)::int as n from player_evaluations where record_status = 'SUPERSEDED'`))
  check('scouting', 'legacy_evaluations_table_present', expectations.legacy_evaluations_table_present,
    await count(`select count(*)::int as n from pg_class where relname = 'evaluations' and relnamespace = 'public'::regnamespace`))
  check('scouting', 'scouting_guard_triggers', expectations.scouting_guard_triggers, await count(`select count(*)::int as n from pg_trigger t
    join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
      and c.relname in ('player_evaluations', 'player_evaluation_grades', 'player_evaluation_rankings', 'player_evaluation_notes')`))
  // Legacy signings.international_rank: how many are represented by a provenance-backed evaluation.
  const [legacyRanks] = await query(`select count(*)::int as total,
      count(*) filter (where exists (select 1 from player_evaluations e
        join scouting_publications pub on pub.id = e.publication_id and pub.publication_slug like 'mlb-pipeline-%'
        join player_evaluation_rankings r on r.evaluation_id = e.id and r.ranking_scope = 'INTERNATIONAL_CLASS'
        where e.player_id = sg.player_id and e.record_status = 'ACTIVE'))::int as represented,
      count(*) filter (where exists (select 1 from player_evaluations e
        join scouting_publications pub on pub.id = e.publication_id and pub.publication_slug like 'mlb-pipeline-%'
        join player_evaluation_rankings r on r.evaluation_id = e.id and r.ranking_scope = 'INTERNATIONAL_CLASS'
        where e.player_id = sg.player_id and e.record_status = 'ACTIVE' and r.rank is distinct from sg.international_rank::int))::int as mismatched
    from signings sg where sg.international_rank is not null`)
  check('scouting', 'scouting_legacy_ranks_total', expectations.scouting_legacy_ranks_total, legacyRanks.total)
  check('scouting', 'scouting_legacy_ranks_backfilled', expectations.scouting_legacy_ranks_backfilled, legacyRanks.represented)
  check('scouting', 'scouting_legacy_ranks_unrepresented', expectations.scouting_legacy_ranks_unrepresented, Number(legacyRanks.total) - Number(legacyRanks.represented))
  check('scouting', 'scouting_legacy_rank_mismatches', expectations.scouting_legacy_rank_mismatches, legacyRanks.mismatched)
  check('scouting', 'scouting_orphan_evaluations', expectations.scouting_orphan_evaluations, await count(`select count(*)::int as n from player_evaluations e
    where not exists (select 1 from players p where p.id = e.player_id)
       or not exists (select 1 from scouting_publications pub where pub.id = e.publication_id)
       or (e.source_id is not null and not exists (select 1 from sources so where so.id = e.source_id))`))
  check('scouting', 'scouting_orphan_grades', expectations.scouting_orphan_grades, await count(`select count(*)::int as n from player_evaluation_grades g
    where not exists (select 1 from player_evaluations e where e.id = g.evaluation_id)
       or not exists (select 1 from evaluation_scales sc where sc.scale_code = g.scale_code)`))
  check('scouting', 'scouting_orphan_rankings', expectations.scouting_orphan_rankings, await count(`select count(*)::int as n from player_evaluation_rankings r
    where not exists (select 1 from player_evaluations e where e.id = r.evaluation_id)`))
  check('scouting', 'scouting_orphan_notes', expectations.scouting_orphan_notes, await count(`select count(*)::int as n from player_evaluation_notes nt
    where not exists (select 1 from player_evaluations e where e.id = nt.evaluation_id)`))
  check('scouting', 'scouting_evaluations_without_provenance', expectations.scouting_evaluations_without_provenance,
    await count(`select count(*)::int as n from player_evaluations
      where (source_id is null and nullif(btrim(source_reference), '') is null) or retrieved_at is null or evidence_basis is null`))
  check('scouting', 'scouting_rankings_without_scope', expectations.scouting_rankings_without_scope,
    await count(`select count(*)::int as n from player_evaluation_rankings
      where ranking_scope is null or nullif(btrim(scope_label), '') is null or rank < 1
         or (ranking_scope = 'ORGANIZATION') <> (organization_id is not null)`))
  check('scouting', 'scouting_scale_violations', expectations.scouting_scale_violations, await count(`select count(*)::int as n
    from player_evaluation_grades g join evaluation_scales sc on sc.scale_code = g.scale_code
    where (g.qualifier <> 'NONE' and not sc.allows_qualifier)
       or (sc.scale_kind = 'NUMERIC' and (g.raw_value is null or g.raw_value < sc.scale_min or g.raw_value > sc.scale_max
            or (sc.scale_step is not null and mod(g.raw_value - sc.scale_min, sc.scale_step) <> 0)))
       or (sc.scale_kind = 'ORDINAL' and (g.raw_label is null or not (g.raw_label = any (sc.ordered_labels))))`))
  check('scouting', 'scouting_origin_violations', expectations.scouting_origin_violations,
    await count(`select count(*)::int as n from scouting_publications where origin is null or origin not in ('EXTERNAL', 'TEAM_PUBLIC', 'DISI_RESEARCH')`))
  check('scouting', 'scouting_model_contamination', expectations.scouting_model_contamination, await count(`select count(*)::int as n from scouting_publications
    where publication_slug ~* 'model|prediction' or publisher ~* 'disi.*model' or publication_name ~* 'disi.*model|prediction'`))
  check('scouting', 'scouting_date_shape_violations', expectations.scouting_date_shape_violations, await count(`select count(*)::int as n from player_evaluations
    where not coalesce(case date_precision
      when 'DAY' then evaluation_date is not null and evaluation_year = extract(year from evaluation_date)::int and evaluation_month = extract(month from evaluation_date)::int
      when 'MONTH' then evaluation_date is null and evaluation_year is not null and evaluation_month is not null
      when 'YEAR' then evaluation_date is null and evaluation_year is not null and evaluation_month is null
      when 'SEASON' then evaluation_date is null and evaluation_year is not null and evaluation_month is null
      when 'UNKNOWN' then evaluation_date is null and evaluation_year is null and evaluation_month is null
    end, false)`))
  // Lifecycle DRAFT -> ACTIVE -> SUPERSEDED. A SUPERSEDED row has a replacement; a replacement
  // supersedes a sealed row of the same player and publication; an ACTIVE or SUPERSEDED row's
  // predecessor is itself SUPERSEDED; no predecessor has two replacements.
  check('scouting', 'scouting_supersession_violations', expectations.scouting_supersession_violations, await count(`select count(*)::int as n from player_evaluations e
    where (e.record_status = 'SUPERSEDED' and not exists (select 1 from player_evaluations s where s.supersedes_evaluation_id = e.id))
       or (e.supersedes_evaluation_id is not null and not exists (select 1 from player_evaluations o
            where o.id = e.supersedes_evaluation_id and o.id <> e.id and o.record_status <> 'DRAFT'
              and o.player_id = e.player_id and o.publication_id = e.publication_id
              and (e.record_status = 'DRAFT' or o.record_status = 'SUPERSEDED')))
       or (e.supersedes_evaluation_id is not null and exists (select 1 from player_evaluations x
            where x.supersedes_evaluation_id = e.supersedes_evaluation_id and x.id <> e.id))`))
  // The sealing triggers must cover INSERT, UPDATE and DELETE on the header and each child table.
  check('scouting', 'scouting_sealed_trigger_events', expectations.scouting_sealed_trigger_events, await count(`select count(*)::int as n from pg_trigger t
    join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
      and c.relname in ('player_evaluations', 'player_evaluation_grades', 'player_evaluation_rankings', 'player_evaluation_notes')
      and (t.tgtype & 28) = 28`))
  // An international-class rank is never filed under another list's context.
  check('scouting', 'scouting_international_rank_context_violations', expectations.scouting_international_rank_context_violations,
    await count(`select count(*)::int as n from player_evaluations e
      where exists (select 1 from player_evaluation_rankings r where r.evaluation_id = e.id and r.ranking_scope = 'INTERNATIONAL_CLASS')
        and e.evaluation_context in ('GLOBAL_LIST', 'ORG_LIST')`))

  // -- canonical seed reconciliation (027) ------------------------------------
  for (const [name, sql] of Object.entries(RECONCILIATION_QUERIES)) {
    check('seed', name, expectations[name], await count(sql))
  }

  // -- signing-network layer (029) -------------------------------------------
  for (const [name, sql] of Object.entries(NETWORK_QUERIES)) {
    check('network', name, expectations[name], await count(sql))
  }

  // -- financial acquisition intelligence (030) -------------------------------
  const hasResolutions = Boolean((await query(`select to_regclass('public.signing_financial_resolutions') is not null as ok`))[0].ok)
  for (const [name, sql] of Object.entries(financialQueries(hasResolutions))) {
    check('financial', name, expectations[name], await count(sql))
  }

  // -- whole public API surface (025) -----------------------------------------
  // Every public view must be security_invoker and give anon / authenticated
  // SELECT only; every public table must have RLS and give them SELECT only; no
  // policy may grant them writes; PUBLIC holds nothing. No allowlist: DISI has
  // no intentionally writable view (database/research/025/view-inventory.json).
  const acl = await query(`select c.relname, c.relkind::text as kind, c.relrowsecurity as rls,
      coalesce(array_to_string(c.reloptions, ','), '') as opts,
      coalesce(r.rolname, case when a.grantee = 0 then 'PUBLIC' end) as grantee, a.privilege_type as privilege
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a on true
    left join pg_roles r on r.oid = a.grantee
    where n.nspname = 'public' and c.relkind in ('r', 'v')`)
  const rels = new Map()
  for (const row of acl) rels.set(row.relname, row)
  const views = [...rels.values()].filter((r) => r.kind === 'v')
  const tables = [...rels.values()].filter((r) => r.kind === 'r')
  const beyondSelect = (kind, role) => new Set(acl.filter((r) => r.kind === kind && r.grantee === role && r.privilege !== 'SELECT')
    .map((r) => r.relname)).size
  check('api', 'public_views_total', expectations.public_views_total, views.length)
  check('api', 'public_views_non_security_invoker', expectations.public_views_non_security_invoker,
    views.filter((v) => !/security_invoker=(true|on)/.test(v.opts)).length)
  check('api', 'public_views_anon_beyond_select', expectations.public_views_anon_beyond_select, beyondSelect('v', 'anon'))
  check('api', 'public_views_authenticated_beyond_select', expectations.public_views_authenticated_beyond_select, beyondSelect('v', 'authenticated'))
  check('api', 'public_tables_total', expectations.public_tables_total, tables.length)
  check('api', 'public_tables_without_rls', expectations.public_tables_without_rls, tables.filter((t) => t.rls !== true).length)
  check('api', 'public_tables_api_beyond_select', expectations.public_tables_api_beyond_select,
    new Set(acl.filter((r) => r.kind === 'r' && (r.grantee === 'anon' || r.grantee === 'authenticated') && r.privilege !== 'SELECT').map((r) => r.relname)).size)
  const [writePolicies] = await query(`select count(*)::int as n from pg_policies
    where schemaname = 'public' and cmd <> 'SELECT'
      and (roles && array['anon', 'authenticated', 'public']::name[])`)
  check('api', 'public_api_write_policies', expectations.public_api_write_policies, writePolicies.n)
  check('api', 'public_role_relation_grants', expectations.public_role_relation_grants,
    new Set(acl.filter((r) => r.grantee === 'PUBLIC').map((r) => r.relname)).size)

  // -- security --------------------------------------------------------------
  const objects = [...expectations.development_base_tables, ...expectations.development_views]
  const grantRows = await query(`select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated') and table_name in (${quoteList(objects)})`)
  const grants = new Map()
  for (const row of grantRows) {
    const key = `${row.table_name}:${row.grantee}`
    grants.set(key, [...(grants.get(key) || []), row.privilege_type])
  }
  for (const object of objects) {
    const expected = { anon: ['SELECT'], authenticated: ['SELECT'] }
    const actual = {
      anon: sorted(grants.get(`${object}:anon`) || []),
      authenticated: sorted(grants.get(`${object}:authenticated`) || []),
    }
    check('security', `privileges:${object}`, expected, actual)
  }

  const rlsRows = await query(`select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in (${quoteList(expectations.development_base_tables)})`)
  for (const table of expectations.development_base_tables) {
    const row = rlsRows.find((r) => r.relname === table)
    check('security', `rls:${table}`, true, row ? row.relrowsecurity === true : false)
  }

  const viewRows = await query(`select c.relname, coalesce(array_to_string(c.reloptions, ','), '') as opts
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in (${quoteList(expectations.development_views)})`)
  for (const view of expectations.development_views) {
    const row = viewRows.find((r) => r.relname === view)
    check('security', `security_invoker:${view}`, true, Boolean(row && String(row.opts).includes('security_invoker=true')))
  }

  // -- informational coverage (reported, never asserted) ---------------------
  const report = async (name, sql, pick = (r) => r) => {
    try {
      const rows = await query(sql)
      info.push({ name, value: pick(rows) })
    } catch (error) {
      info.push({ name, value: `unavailable (${error.message})` })
    }
  }
  await report('latest_stint_as_of_date', 'select max(as_of_date)::text as v from player_season_stints', (r) => r[0].v)
  await report('latest_stint_retrieved_at', 'select max(retrieved_at)::text as v from player_season_stints', (r) => r[0].v)
  await report(
    'scouting_evaluations_by_status',
    'select record_status, count(*)::int as n from player_evaluations group by 1 order by 1',
    (r) => Object.fromEntries(r.map((x) => [x.record_status, x.n]))
  )
  await report(
    'scouting_research_queue_by_issue',
    'select issue, count(*)::int as n from v_scouting_research_queue group by 1 order by 1',
    (r) => Object.fromEntries(r.map((x) => [x.issue, x.n]))
  )
  await report('mlb_level_stints', 'select count(*)::int as v from player_season_stints where level = \'MLB\' and stint_kind = \'TEAM_STINT\'', (r) => r[0].v)
  await report(
    'research_queue_by_issue',
    'select issue, count(*)::int as n from v_dodgers_development_research_queue group by 1 order by 1',
    (r) => Object.fromEntries(r.map((x) => [x.issue, x.n]))
  )
  await report(
    'multi_org_queue_flags',
    `select count(*)::int as v from v_dodgers_development_research_queue where issue = 'MULTI_ORG_SEASON_UNVERIFIED'`,
    (r) => r[0].v
  )

  return { hard, info }
}

/** Human-readable report lines for the CLI. */
export function formatReport(report) {
  const lines = []
  for (const item of report.hard) {
    const label = item.pass ? 'PASS' : 'FAIL'
    const detail = item.pass
      ? `= ${JSON.stringify(item.actual)}`
      : `expected ${JSON.stringify(item.expected)}, got ${JSON.stringify(item.actual)}`
    lines.push(`${label}  [${item.group}] ${item.name} ${detail}`)
  }
  for (const item of report.info) {
    lines.push(`INFO  [coverage] ${item.name} = ${JSON.stringify(item.value)}`)
  }
  return lines
}

/** Hard checks that failed. */
export const failedChecks = (report) => report.hard.filter((item) => !item.pass)
