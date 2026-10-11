#!/usr/bin/env node
// Local 032-only harness: builds 001-031 in PGlite, runs 032 (surfacing the exact error with its character position),
// reruns it, and writes value-coverage.json from the resulting state. Not part of npm test.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..', '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8'))
const target = '032_player_value_organizational_realization.sql'
const db = new PGlite({ extensions: { pgcrypto } })
await db.exec('create role anon nologin; create role authenticated nologin;')
for (const file of manifest.canonical_sql) {
  if (file === target) break
  try { await db.exec(fs.readFileSync(path.join(root, 'database/sql', file), 'utf8')) } catch (e) { console.error(`${file}: ${e.message}`); process.exit(1) }
}
const sqlText = fs.readFileSync(path.join(root, 'database/sql', target), 'utf8')
const q = async (sql) => (await db.query(sql)).rows
const tally = (rows) => Object.fromEntries(rows.map((r) => [r.k, r.n]))
try {
  await db.exec(sqlText)
  console.log('032 OK')
  await db.exec(sqlText)
  console.log('032 rerun OK')
} catch (e) {
  console.error('032 FAIL:', e.message)
  if (e.position) {
    const pos = Number(e.position)
    console.error(`...${sqlText.slice(Math.max(0, pos - 300), pos)} >>>HERE>>> ${sqlText.slice(pos, pos + 160)}`)
  }
  if (e.where) console.error('WHERE:', e.where)
  await db.close()
  process.exit(1)
}

const coverage = {
  generated_from: 'canonical replay 001-032 (in memory), database/research/032/test-032.mjs',
  totals: (await q(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`))[0],
  team_season_rows: (await q(`select count(*)::int as rows, count(*) filter (where component = 'BAT')::int as bat, count(*) filter (where component = 'PITCH')::int as pitch,
    count(distinct bref_id)::int as players, count(*) filter (where player_id is null)::int as return_asset_rows, count(*) filter (where war is null)::int as null_war_rows,
    count(*) filter (where organization_id is null)::int as unresolved_rows from player_mlb_team_season_war`))[0],
  team_code_map_rows: (await q(`select count(*)::int as n from bref_team_code_map`))[0].n,
  status_distribution: tally(await q(`select organizational_realization_status as k, count(*)::int as n from v_player_organizational_realization group by 1 order by 1`)),
  team_history: tally(await q(`select team_history_status as k, count(*)::int as n from v_player_organizational_realization group by 1 order by 1`)),
  maturity: tally(await q(`select maturity_status as k, count(*)::int as n from v_player_organizational_realization group by 1 order by 1`)),
  acquisition_completeness: tally(await q(`select acquisition_cost_completeness as k, count(*)::int as n from v_player_organizational_realization group by 1 order by 1`)),
  cost_metric_eligible: (await q(`select count(*) filter (where cost_metric_eligible)::int as n from v_player_organizational_realization`))[0].n,
  research_queue: tally(await q(`select issue as k, count(*)::int as n from v_value_research_queue group by 1 order by 1`)),
  portfolio_all: (await q(`select * from v_dodgers_international_value_portfolio where grain = 'ALL'`))[0],
  portfolio_eras: await q(`select grain_value, tracked_signings, mature_signings, direct_ratio_eligible_signings, eligible_known_acquisition_cost_usd::text as cost,
    eligible_direct_dodgers_bwar::text as direct_bwar, aggregate_direct_dodgers_bwar_per_million::text as direct_per_million,
    aggregate_attributable_organizational_bwar_per_million::text as attributable_per_million, direct_ratio_small_sample from v_dodgers_international_value_portfolio where grain = 'SIGNING_ERA' order by grain_value`),
  proof_cohort: await q(`select player_slug, signing_year, pathway, acquisition_cost_completeness as completeness, known_acquisition_cost_usd::text as cost, career_bwar::text as career_bwar,
    direct_dodgers_mlb_bwar::text as direct, non_dodgers_mlb_bwar::text as non_dodgers, trade_package_return_dodgers_bwar::text as package_return,
    individually_attributable_trade_return_bwar::text as attributable_return, package_attribution_state, attributable_organizational_bwar::text as attributable,
    organizational_realization_status as status, maturity_status, outcome_state, direct_dodgers_bwar_per_million::text as direct_per_million,
    attributable_organizational_bwar_per_million::text as attributable_per_million, ratio_suppression_reason
    from v_player_organizational_realization where player_slug in ('oneil-cruz', 'yordan-alvarez', 'hyun-jin-ryu', 'yusniel-diaz', 'josue-de-paula', 'roki-sasaki', 'julio-urias',
      'kenley-jansen', 'andy-pages', 'starling-heredia', 'yadier-alvarez', 'omar-estevez', 'ronny-brito', 'keibert-ruiz', 'roberto-clemente', 'carlos-frias') order by 1`),
  trade_edges: await q(`select event_key, transaction_date::text as transaction_date, acquisition_season, counterparty_franchise_key, acquisition_timing_status, same_season_timing_resolved,
    pre_acquisition_dodgers_stint_rows, pre_acquisition_dodgers_bwar_excluded::text as pre_excluded, dodgers_bwar_complete_seasons_after_acquisition::text as later_seasons,
    unresolved_same_season_dodgers_bwar::text as unresolved_same_season, incoming_war_status, incoming_asset_name, incoming_bref_id, incoming_dodgers_bwar::text as derived, legacy_return_dodgers_war::text as legacy, derived_minus_legacy_war::text as difference,
    outgoing_asset_count, individual_attribution_permitted from v_trade_realization_edges order by 1`),
}
fs.writeFileSync(path.join(here, 'value-coverage.json'), JSON.stringify(coverage, null, 2) + '\n')
console.log(JSON.stringify({ totals: coverage.totals, team_season_rows: coverage.team_season_rows, status: coverage.status_distribution, queue: coverage.research_queue }, null, 1))
await db.close()
