#!/usr/bin/env node
// Offline audit for Migration 032. Builds the canonical chain through 031 in memory (no network, no real database)
// and checks every fact the migration's guards, seed and derived rules depend on. Exits non-zero on any failure.
//
//   node database/research/032/audit.mjs   ->  database/research/032/audit-report.json

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const seed = JSON.parse(fs.readFileSync(path.join(here, 'war-seed.json'), 'utf8'))
const config = JSON.parse(fs.readFileSync(path.join(here, 'scope-config.json'), 'utf8'))
const failures = []
const check = (label, ok) => { if (!ok) failures.push(label) }
const num = (v) => (v === null || v === undefined ? null : Number(v))
const r1 = (x) => Math.round(x * 10) / 10

const ch = await buildChainThrough('031_financial_provenance_coverage_expansion.sql')
const q = ch.query
const one = async (sql, params) => (await q(sql, params))[0]

// ---- baseline ----------------------------------------------------------------------------------------------------------
const totals = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
check('baseline is 54 tables / 97 views', totals.tables === 54 && totals.views === 97)
const present = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname in ('player_mlb_team_season_war', 'bref_team_code_map',
  'v_trade_realization_edges', 'v_player_organizational_realization', 'v_dodgers_international_value_portfolio', 'v_value_research_queue')`)).map((r) => r.relname)
check('no 032 object exists yet', present.length === 0)
check('transaction_event_assets has no bref_id yet', (await one(`select count(*)::int as n from information_schema.columns where table_name = 'transaction_event_assets' and column_name = 'bref_id'`)).n === 0)

// ---- sources -------------------------------------------------------------------------------------------------------------
const registered = (await q(`select url from sources where url = any($1)`, [Object.values(config.files).map((f) => f.url)])).map((r) => r.url)
check('both Baseball-Reference data file sources are registered', registered.length === 2)

// ---- scope and legacy stores ---------------------------------------------------------------------------------------------
const players = await q(`select p.id, p.slug, p.bref_id, p.mlb_id, oc.career_war::text as outcomes_war, w.career_bwar::text as metric_bwar, a.reached_mlb_verified
  from outcome_audits a join players p on p.id = a.player_id left join outcomes oc on oc.player_id = p.id left join v_player_war w on w.player_id = p.id
  where a.reached_mlb_verified order by p.slug`)
check('47 verified MLB-reached players', players.length === 47)
const byBref = new Map()
for (const r of seed.rows) {
  const t = byBref.get(r.bref_id) ?? { total: 0, rows: 0, seasons: new Set(), nulls: 0 }
  if (r.war !== null) t.total += Number(r.war)
  else t.nulls += 1
  t.rows += 1
  byBref.set(r.bref_id, t)
}
const reconciliation = []
const backfills = []
for (const p of players) {
  const t = byBref.get(p.bref_id)
  check(`${p.slug}: has loaded rows`, Boolean(t))
  if (!t) continue
  const total = Math.round(t.total * 100) / 100
  const legacy = num(p.metric_bwar ?? p.outcomes_war)
  const diff = legacy === null ? null : Math.round((total - legacy) * 100) / 100
  const entry = { slug: p.slug, bref_id: p.bref_id, rows: t.rows, team_season_total: total, rounded: r1(total), outcomes_career_war: num(p.outcomes_war), metric_career_bwar: num(p.metric_bwar), diff_vs_legacy: diff }
  reconciliation.push(entry)
  check(`${p.slug}: team-season total ${total} agrees with the legacy store ${legacy} within 0.1`, legacy !== null && Math.abs(total - legacy) <= 0.1)
  if (p.outcomes_war === null) backfills.push({ slug: p.slug, store: 'OUTCOMES_CAREER_WAR', expected: String(r1(total)) })
  if (p.metric_bwar === null) backfills.push({ slug: p.slug, store: 'METRIC_CAREER_BWAR', expected: String(r1(total)) })
  if (p.outcomes_war !== null && p.metric_bwar !== null) check(`${p.slug}: legacy stores agree`, Math.abs(Number(p.outcomes_war) - Number(p.metric_bwar)) <= 0.1)
}
const expectedBackfills = ['carlos-frias:OUTCOMES_CAREER_WAR:-0.3', 'eddys-leonard:METRIC_CAREER_BWAR:-0.2', 'roger-cedeno:OUTCOMES_CAREER_WAR:1.7']
check('exactly three reviewed backfills (Frias, Cedeno, Leonard)', JSON.stringify(backfills.map((b) => `${b.slug}:${b.store}:${b.expected}`).sort()) === JSON.stringify(expectedBackfills))

// ---- return assets ------------------------------------------------------------------------------------------------------------
const returns = []
for (const a of config.return_assets) {
  const rows = await q(`select a.asset_name, a.asset_type, a.asset_side, m.dodgers_regular_season_war::text as legacy_war from transaction_event_assets a join transaction_events e on e.id = a.event_id
    left join transaction_return_metrics m on m.event_id = e.id and m.incoming_asset_name = a.asset_name where e.event_key = $1 and a.asset_name = $2`, [a.event_key, a.asset_name])
  check(`${a.asset_name}: one incoming PLAYER asset in ${a.event_key}`, rows.length === 1 && rows[0].asset_type === 'PLAYER' && rows[0].asset_side === 'INCOMING')
  const season = Number((await one(`select extract(year from transaction_date)::int as y from transaction_events where event_key = $1`, [a.event_key])).y)
  const dodgers = seed.rows.filter((r) => r.bref_id === a.bref_id && r.team === 'LAD' && r.season >= season && r.war !== null)
  const derived = Math.round(dodgers.reduce((s, r) => s + Number(r.war), 0) * 100) / 100
  returns.push({ asset: a.asset_name, bref_id: a.bref_id, event_key: a.event_key, derived_dodgers_bwar: derived, legacy_hand_entered: num(rows[0]?.legacy_war), difference: Math.round((derived - Number(rows[0]?.legacy_war ?? 0)) * 100) / 100, rows: dodgers.length })
  check(`${a.asset_name}: derived Dodgers bWAR ${derived} is within 0.1 of the hand-entered ${rows[0]?.legacy_war}`, Math.abs(derived - Number(rows[0]?.legacy_war)) <= 0.1)
}

// ---- team code map coverage --------------------------------------------------------------------------------------------------------
const orgs = new Set((await q(`select abbreviation from organizations`)).map((r) => r.abbreviation))
for (const m of config.team_code_map) check(`team code ${m.code} -> organization ${m.organization} exists`, orgs.has(m.organization))
check('every seed team code is mapped', seed.coverage.unmapped_team_codes.length === 0)
check('every seeded player has rows', seed.coverage.players_without_rows.length === 0)

// ---- maturity as-of date -----------------------------------------------------------------------------------------------------------
const asOf = await one(`select max(audited_through_date)::text as d, min(audited_through_date)::text as lo, count(distinct audited_through_date)::int as n from outcome_audits`)
const mismatch = await one(`select count(*)::int as n from v_dodgers_outcome_coverage c where c.mature_5yr_cohort is distinct from
  (case when c.signing_date is not null then c.signing_date <= ((select max(audited_through_date) from outcome_audits) - interval '5 years')::date
        else c.signing_year <= extract(year from (select max(audited_through_date) from outcome_audits))::int - 5 end)`)
check('the maturity flag derived from max(audited_through_date) equals the legacy flag for every Dodgers signing', mismatch.n === 0)

// ---- legacy views --------------------------------------------------------------------------------------------------------------------
const LEGACY = ['v_signing_efficiency', 'v_dodgers_signing_cohort', 'v_dodgers_signing_leaderboard', 'v_dodgers_asset_realization', 'v_signing_asset_outcomes', 'v_dodgers_executive_kpis',
  'v_dodgers_executive_case_studies', 'v_dodgers_executive_dashboard_feed', 'v_dodgers_mature_bonus_tiers', 'v_dodgers_mature_premium_comparison', 'v_dodgers_mature_year_analysis',
  'v_dodgers_mature_player_analysis', 'v_dodgers_trade_package_conversion']
const defs = {}
for (const v of LEGACY) defs[v] = crypto.createHash('md5').update((await one(`select pg_get_viewdef($1::regclass) as d`, [`public.${v}`])).d).digest('hex')
const kpi = await one(`select * from v_dodgers_executive_kpis`)
await ch.close()

const report = {
  audited_against: 'canonical replay 001-031 (in memory)',
  baseline: totals,
  seed: { rows: seed.row_count, components: seed.components, null_war_rows: seed.null_war_rows, parsed_rows_sha256: seed.parsed_rows_sha256, source_files: seed.source_files },
  backfills,
  reconciliation,
  return_assets: returns,
  maturity: { analysis_as_of_date: asOf.d, distinct_audit_dates: asOf.n, earliest_audit_date: asOf.lo, legacy_flag_mismatches: mismatch.n },
  legacy_kpi_before: kpi,
  legacy_view_definitions_md5: defs,
  failures,
}
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ baseline: totals, seed_rows: seed.row_count, backfills, returns, maturity: report.maturity, failures }, null, 2))
if (failures.length) { console.error(`audit failed (${failures.length})`); process.exit(1) }
