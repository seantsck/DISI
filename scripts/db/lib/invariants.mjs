// Canonical drift detection for the DISI research database (read-only).
//
// Every check in this module is a SELECT. Nothing here writes, grants or
// modifies anything, and no credentials live in this file: the caller supplies
// a query function (PGlite for the local canonical chain, or a pg client
// connected with a URL from an environment variable).
//
// Hard invariants are the byte-stable state of the canonical 001→022 chain
// (seeded populations, migration-built rows, schema security properties).
// Informational metrics are research-coverage numbers that may legitimately
// move as research progresses; they are reported but never fail the run.
//
// Expectations are pinned here, never learned from a production database: the
// verifier always fails on values it has not explicitly accepted. A future
// migration that legitimately changes a hard invariant must update
// CANONICAL_EXPECTATIONS in the same commit as that migration.

/** Canonical 001→022 (DISI v0.13) expected state. */
export const CANONICAL_EXPECTATIONS = {
  // population (seeded by 002/012/013/016/019 and surfaced by v_database_status)
  players_total: 268,
  dodgers_players: 220,
  league_benchmark_players: 48,
  verified_mlb_outcomes: 47,
  // development dataset (021 stints; 022 exact dates)
  stints: 828,
  stint_players: 167,
  dated_stints: 746,
  undated_log_era_stints: 60,
  coded_milestones: 832,
  professional_debut_milestones: 166,
  legacy_milestones: 5,
  mlb_debut_milestones: 7,
  mlb_debut_players: 7,
  organization_change_milestones: 18,
  aa_debut_milestones: 25,
  development_status: {
    ROOKIE_LEVEL: 92,
    MLB: 47,
    A_BALL: 29,
    HIGH_A: 16,
    AAA: 14,
    AA: 12,
    OUT_OF_AFFILIATED_BASEBALL: 2,
  },
  // integrity
  duplicate_stint_groups: 0,
  season_milestones_with_date: 0,
  day_milestones_without_date: 0,
  mexican_league_affiliated_violations: 0,
  // security surface
  development_base_tables: [
    'player_season_stints',
    'player_development_status',
    'development_levels',
    'development_level_era_map',
    'development_event_codes',
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
      count(*) filter (where season >= 2006 and first_game_date is null)::int as undated_log_era
    from player_season_stints`
  )
  check('development', 'stints', expectations.stints, stints.n)
  check('development', 'stint_players', expectations.stint_players, stints.players)
  check('development', 'dated_stints', expectations.dated_stints, stints.dated)
  check('development', 'undated_log_era_stints', expectations.undated_log_era_stints, stints.undated_log_era)

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
  await report('mlb_level_stints', 'select count(*)::int as v from player_season_stints where level = \'MLB\'', (r) => r[0].v)
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
