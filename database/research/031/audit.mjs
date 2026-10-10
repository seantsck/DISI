#!/usr/bin/env node
// Offline audit for Migration 031. Builds the canonical chain through 030 in memory (no network, no real
// database) and measures every fact the migration's guards, seeds and link windows depend on. Exits non-zero
// on any failure.
//
//   node database/research/031/audit.mjs   ->  database/research/031/audit-report.json

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const seed = JSON.parse(fs.readFileSync(path.join(here, 'seed-evidence.json'), 'utf8'))
const failures = []
const check = (label, ok) => { if (!ok) failures.push(label) }
const ch = await buildChainThrough('030_financial_acquisition_intelligence.sql')
const q = ch.query
const one = async (sql, params) => (await q(sql, params))[0]
const org = seed.organization_name

// ---- baseline ---------------------------------------------------------------------------------------------------
const totals = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views, (select count(*) from signing_environments)::int as environments`)
check('baseline is 53 tables / 97 views / 9 environments', totals.tables === 53 && totals.views === 97 && totals.environments === 9)
check('no resolution table exists yet', (await one(`select to_regclass('public.signing_financial_resolutions') is null as gone`)).gone)

// ---- sources ----------------------------------------------------------------------------------------------------
const registered = new Set((await q('select url from sources where url = any($1)', [seed.sources.map((s) => s.url)])).map((r) => r.url))
for (const s of seed.sources) check(`source ${s.key} is ${s.existing ? 'already' : 'not yet'} registered`, registered.has(s.url) === s.existing)

// ---- signing reports --------------------------------------------------------------------------------------------
const rowsByRef = {}
for (const r of seed.signing_reports) {
  const rows = await q(`select sg.id, sg.signing_bonus_usd::text as bonus, sg.bonus_publicly_reported as flag, o.franchise_key,
      (select count(*)::int from signing_financial_reports fr where fr.signing_id = sg.id and fr.component_type = 'SIGNING_BONUS' and fr.record_status = 'ACTIVE') as reports,
      (select count(*)::int from signing_financial_reports fr where fr.signing_id = sg.id and fr.component_type = 'SIGNING_BONUS' and fr.report_origin = 'LEGACY_CARRYFORWARD' and fr.record_status = 'ACTIVE') as legacy,
      (select count(*)::int from signing_financial_reports fr where fr.signing_id = sg.id and fr.component_type = 'SIGNING_BONUS' and fr.report_origin = 'EXTERNAL_SOURCE' and fr.record_status = 'ACTIVE') as external
    from signings sg join players p on p.id = sg.player_id join organizations o on o.id = sg.organization_id
    where p.slug = $1 and o.name = $2 and sg.signing_year = $3`, [r.player_slug, org, r.signing_year])
  check(`${r.ref}: exactly one Dodgers signing`, rows.length === 1)
  const row = rows[0]
  if (!row) continue
  rowsByRef[r.ref] = row
  if (r.kind === 'UPGRADE') {
    check(`${r.ref}: UPGRADE has a known canonical bonus equal to the report (${row.bonus})`, Number(row.bonus) === Number(r.amount))
    check(`${r.ref}: UPGRADE has exactly one legacy row and no external report yet`, row.legacy === 1 && row.external === 0)
    if (r.amount_basis === 'ROUNDED') check(`${r.ref}: ROUNDED interval contains the legacy value`, Math.abs(Number(row.bonus) - Number(r.amount)) <= Number(r.amount_precision) / 2)
  } else if (r.kind === 'NEW') {
    check(`${r.ref}: NEW has no canonical bonus, no report and no flag`, row.bonus === null && row.reports === 0 && row.flag === false)
  } else {
    check(`${r.ref}: CORRECTION's canonical bonus is the legacy amount ${r.legacy_amount}`, Number(row.bonus) === Number(r.legacy_amount) && row.legacy === 1 && row.external === 0)
    check(`${r.ref}: CORRECTION really differs from the legacy value`, Number(r.amount) !== Number(r.legacy_amount))
  }
}

// ---- the deferred disagreements stay untouched --------------------------------------------------------------------
const deferred = []
for (const d of seed.deferred) {
  const rows = await q(`select p.slug, sg.signing_bonus_usd::text as bonus, sg.posting_fee_usd::text as posting, f.conflicting_components from signings sg join players p on p.id = sg.player_id
    join v_signing_acquisition_financials f on f.signing_id = sg.id where p.slug = $1`, [d.player_slug])
  check(`deferred ${d.player_slug} exists`, rows.length === 1)
  deferred.push({ ...rows[0], reason: d.reason })
}
check('Sasaki posting conflict is present and the column is NULL', deferred.some((d) => d.slug === 'roki-sasaki' && d.posting === null && d.conflicting_components.join() === 'POSTING_FEE'))

// ---- environments ----------------------------------------------------------------------------------------------------
for (const e of seed.environments) {
  const n = (await one(`select count(*)::int as n from signing_environments se join organizations o on o.id = se.organization_id where o.name = $1 and se.signing_year = $2`, [org, e.signing_year])).n
  check(`Dodgers ${e.signing_year} environment does not exist yet`, n === 0)
}
for (const u of seed.environment_column_updates) {
  const r = await one(`select se.club_bonus_pool_usd::text as pool, se.regime::text as regime from signing_environments se join organizations o on o.id = se.organization_id where o.name = $1 and se.signing_year = $2`, [org, u.signing_year])
  check(`Dodgers ${u.signing_year} environment exists with a NULL pool`, r && r.pool === null)
}
const env2022 = await one(`select se.club_bonus_pool_usd::text as pool, se.signing_period_label from signing_environments se join organizations o on o.id = se.organization_id where o.name = $1 and se.signing_year = 2022`, [org])
check('Dodgers 2021-22 environment holds the reviewed $4,644,000', env2022.pool === '4644000.00' && env2022.signing_period_label === '2021-22')
const poolQueue = (await q(`select left(detail, 4) as y from v_financial_research_queue where issue = 'POOL_CAPACITY_UNKNOWN' order by 1`)).map((r) => r.y)
check('the live POOL_CAPACITY_UNKNOWN years are exactly 2012, 2013, 2014, 2017 and 2021', poolQueue.join() === '2012,2013,2014,2017,2021')

// ---- link windows ----------------------------------------------------------------------------------------------------
const links = []
for (const w of seed.link_windows) {
  const rows = await q(`select p.slug, sg.signing_date::text as date, sg.pathway::text as pathway, sg.international_pool_treatment as treatment, sg.signing_environment_id is not null as linked
    from signings sg join players p on p.id = sg.player_id join organizations o on o.id = sg.organization_id
    where o.name = $1 and sg.signing_date between $2::date and $3::date order by 2, 1`, [org, w.from, w.to])
  check(`window ${w.signing_year}: no signing in it is already linked to another environment`, rows.every((r) => !r.linked))
  links.push({ signing_year: w.signing_year, from: w.from, to: w.to, signings: rows.length, by_pathway: Object.fromEntries(rows.reduce((m, r) => m.set(r.pathway, (m.get(r.pathway) || 0) + 1), new Map())), members: rows.map((r) => r.slug) })
}
const undated = (await q(`select sg.signing_year, count(*)::int as n from signings sg join organizations o on o.id = sg.organization_id where o.name = $1 and sg.signing_date is null
  and sg.signing_year in (2012, 2013, 2014, 2017, 2021) group by 1 order by 1`, [org]))

// ---- legacy WAR-per-dollar views (definitions recorded) ---------------------------------------------------------------
const LEGACY = ['v_signing_efficiency', 'v_dodgers_signing_cohort', 'v_dodgers_signing_leaderboard', 'v_dodgers_asset_realization', 'v_signing_asset_outcomes', 'v_dodgers_executive_kpis',
  'v_dodgers_executive_case_studies', 'v_dodgers_executive_dashboard_feed', 'v_dodgers_mature_bonus_tiers', 'v_dodgers_mature_premium_comparison', 'v_dodgers_mature_year_analysis', 'v_dodgers_mature_player_analysis']
const defs = {}
for (const v of LEGACY) defs[v] = crypto.createHash('md5').update((await one(`select pg_get_viewdef($1::regclass) as d`, [`public.${v}`])).d).digest('hex')
await ch.close()

const report = {
  audited_against: 'canonical replay 001-030 (in memory)',
  baseline: totals,
  signing_reports_by_kind: Object.fromEntries(['UPGRADE', 'NEW', 'CORRECTION'].map((k) => [k, seed.signing_reports.filter((r) => r.kind === k).length])),
  environment_reports: seed.environment_reports.length,
  environments_added: seed.environments.length,
  deferred,
  link_windows: links,
  undated_signings_in_covered_years: undated,
  legacy_war_per_dollar_view_definitions_md5: defs,
  failures,
}
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ baseline: totals, by_kind: report.signing_reports_by_kind, links: links.map((l) => `${l.signing_year}: ${l.signings}`), failures }, null, 2))
if (failures.length) { console.error(`audit failed (${failures.length})`); process.exit(1) }
