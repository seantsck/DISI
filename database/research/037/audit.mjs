#!/usr/bin/env node
// Audits the 037 inputs against the canonical 001-036 replay (in memory, PGlite) and writes audit-report.json.
//
//   node database/research/037/audit.mjs
//
// Measures the development coverage the pathway layer reads (players with affiliated team stints, seasons, developmental arrival
// states, unresolved arrivals, professional signings, mature MLB players without a history) and checks the facts the views rely on:
// a ranked affiliated level ladder with one rank per level (LOW_A / legacy A share rank 3), no team stint on an unranked affiliated
// level, every stint player a Dodgers signing, and no 2020 minor-league team stint (2020 is never counted as an absence).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const failures = []
const chain = await buildChainThrough('036_scouting_expectation_outcomes.sql')
const q = async (s) => (await chain.query(s))
const one = async (s) => (await q(s))[0]

const ladder = await q(`select level::text as level, progression_rank as r from development_levels where affiliated and progression_rank is not null order by 2, 1`)
const expectedLadder = [['INTERNATIONAL_ROOKIE', 1], ['COMPLEX_ROOKIE', 2], ['A', 3], ['LOW_A', 3], ['HIGH_A', 4], ['AA', 5], ['AAA', 6], ['MLB', 7]]
if (JSON.stringify(ladder.map((l) => [l.level, l.r])) !== JSON.stringify(expectedLadder)) failures.push(`unexpected level ladder ${JSON.stringify(ladder)}`)
const unranked = await one(`select count(*)::int as n from player_season_stints s join development_levels dl on dl.level = s.level
  where s.stint_kind = 'TEAM_STINT' and dl.affiliated and dl.progression_rank is null`)
if (unranked.n) failures.push(`${unranked.n} team stint(s) on an unranked affiliated level`)
const nonDodgers = await one(`select count(distinct s.player_id)::int as n from player_season_stints s join signings g on g.player_id = s.player_id
  join organizations o on o.id = g.organization_id where o.franchise_key <> 'DODGERS'`)
if (nonDodgers.n) failures.push(`${nonDodgers.n} non-Dodgers player(s) have stints; the pathway layer is Dodgers-only`)
const minors2020 = await one(`select count(*)::int as n from player_season_stints s where s.season = 2020 and s.stint_kind = 'TEAM_STINT' and s.level <> 'MLB'`)
if (minors2020.n) failures.push(`${minors2020.n} minor-league team stint(s) in 2020`)

const coverage = await one(`select
    (select count(*) from signings s join organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS')::int as dodgers_signings,
    (select count(distinct s.player_id) from player_season_stints s join development_levels dl on dl.level = s.level
      where s.stint_kind = 'TEAM_STINT' and dl.affiliated and dl.progression_rank is not null)::int as players_with_affiliated_history,
    (select count(*) from (select distinct s.player_id, s.season from player_season_stints s join development_levels dl on dl.level = s.level
      where s.stint_kind = 'TEAM_STINT' and dl.affiliated and dl.progression_rank is not null) d)::int as affiliated_player_seasons,
    (select max(season) from player_season_stints where stint_kind = 'TEAM_STINT')::int as latest_observed_season,
    (select count(distinct player_id) from v_player_development_progression where development_state = 'UNRESOLVED')::int as players_with_unresolved_arrivals,
    (select count(*) from signings s join organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS'
      and s.pathway::text in ('CUBAN_PRO', 'JAPAN_PRO', 'KOREA_PRO', 'POSTED_PLAYER', 'MEXICAN_LEAGUE_TRANSFER'))::int as professional_signings,
    (select count(*) from v_player_realized_outcome r where r.is_dodgers and r.outcome_maturity = 'MATURE' and r.reached_mlb_verified
      and not exists (select 1 from player_season_stints s where s.player_id = r.player_id and s.stint_kind = 'TEAM_STINT'))::int as mature_mlb_players_without_history`)
await chain.close()

const report = { ladder: ladder.map((l) => `${l.level}:${l.r}`), coverage, failures }
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 1) + '\n')
console.log(JSON.stringify(report))
if (failures.length) process.exitCode = 1
