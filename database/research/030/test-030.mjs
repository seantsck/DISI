#!/usr/bin/env node
// Local 030-only harness: builds 001-029 in PGlite, runs 030 (surfacing the exact error with its
// character position), reruns it, and writes financial-coverage.json from the resulting state.
// Not part of npm test.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..', '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8'))
const target = '030_financial_acquisition_intelligence.sql'
const db = new PGlite({ extensions: { pgcrypto } })
await db.exec('create role anon nologin; create role authenticated nologin;')
for (const file of manifest.canonical_sql) {
  if (file === target) break
  try { await db.exec(fs.readFileSync(path.join(root, 'database/sql', file), 'utf8')) }
  catch (e) { console.error(`${file}: ${e.message}`); process.exit(1) }
}
const sqlText = fs.readFileSync(path.join(root, 'database/sql', target), 'utf8')
const q = async (sql) => (await db.query(sql)).rows
const tally = (rows, key = 'k') => Object.fromEntries(rows.map((r) => [r[key], r.n]))
try {
  await db.exec(sqlText)
  console.log('030 OK')
  await db.exec(sqlText)
  console.log('030 rerun OK')
} catch (e) {
  console.error('030 FAIL:', e.message)
  if (e.position) {
    const pos = Number(e.position)
    console.error(`...${sqlText.slice(Math.max(0, pos - 300), pos)} >>>HERE>>> ${sqlText.slice(pos, pos + 160)}`)
  }
  if (e.where) console.error('WHERE:', e.where)
  await db.close()
  process.exit(1)
}

// research-progress snapshot of the migration-built state (counts only; regenerated, never hand-edited)
const coverage = {
  generated_from: 'canonical replay 001-030 (in memory), database/research/030/test-030.mjs',
  totals: (await q(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views,
    (select count(*) from signing_environments)::int as signing_environments`))[0],
  signing_reports_by_origin: tally(await q(`select report_origin as k, count(*)::int as n from signing_financial_reports group by 1 order by 1`)),
  signing_reports_by_basis: tally(await q(`select coalesce(amount_basis, 'NONE (legacy)') as k, count(*)::int as n from signing_financial_reports group by 1 order by 1`)),
  signing_reports_by_component: tally(await q(`select component_type as k, count(*)::int as n from signing_financial_reports group by 1 order by 1`)),
  environment_reports_by_origin: tally(await q(`select report_origin as k, count(*)::int as n from signing_environment_financial_reports group by 1 order by 1`)),
  component_rules: tally(await q(`select applicability as k, count(*)::int as n from acquisition_cost_component_rules group by 1 order by 1`)),
  all_signings: {
    acquisition_completeness: tally(await q(`select acquisition_cost_completeness as k, count(*)::int as n from v_signing_acquisition_financials group by 1 order by 1`)),
    pool_completeness: tally(await q(`select pool_completeness as k, count(*)::int as n from v_signing_acquisition_financials group by 1 order by 1`)),
    bonus_status: tally(await q(`select bonus_status as k, count(*)::int as n from v_signing_acquisition_financials group by 1 order by 1`)),
    bonus_source_status: tally(await q(`select bonus_source_status as k, count(*)::int as n from v_signing_acquisition_financials group by 1 order by 1`)),
  },
  dodgers: {
    signings: (await q(`select count(*)::int as n from v_signing_acquisition_financials where is_dodgers`))[0].n,
    acquisition_completeness: tally(await q(`select acquisition_cost_completeness as k, count(*)::int as n from v_signing_acquisition_financials where is_dodgers group by 1 order by 1`)),
    pool_completeness: tally(await q(`select pool_completeness as k, count(*)::int as n from v_signing_acquisition_financials where is_dodgers group by 1 order by 1`)),
    pool_treatment: tally(await q(`select international_pool_treatment || coalesce(' / ' || pool_treatment_basis, '') as k, count(*)::int as n from v_signing_acquisition_financials where is_dodgers group by 1 order by 1`)),
    bonus_status: tally(await q(`select bonus_status as k, count(*)::int as n from v_signing_acquisition_financials where is_dodgers group by 1 order by 1`)),
    bonus_source_status: tally(await q(`select bonus_source_status as k, count(*)::int as n from v_signing_acquisition_financials where is_dodgers group by 1 order by 1`)),
    cost_source_coverage: tally(await q(`select cost_source_coverage as k, count(*)::int as n from v_signing_acquisition_financials where is_dodgers group by 1 order by 1`)),
  },
  research_queue: tally(await q(`select issue as k, count(*)::int as n from v_financial_research_queue group by 1 order by 1`)),
  classes: await q(`select period_label, class_basis, signings, bonus_known, known_bonus_sum_usd::text as known_bonus_sum_usd, pool_capacity_usd::text as pool_capacity_usd, pool_capacity_basis,
    known_tracked_bonus_pct_of_pool::text as known_tracked_bonus_pct_of_pool, source_reported_utilization_pct::text as source_reported_utilization_pct,
    population_completeness, pool_adjustment_completeness, true_utilization_eligible
    from v_dodgers_financial_commitment_by_class where class_basis = 'SIGNING_ENVIRONMENT' order by class_year`),
  true_utilization_periods: (await q(`select count(*)::int as n from v_dodgers_financial_commitment_by_class where true_disi_row_utilization_pct is not null`))[0].n,
  source_reported_utilization_periods: (await q(`select coalesce(string_agg(period_label, ', ' order by class_year), '') as v from v_dodgers_financial_commitment_by_class where source_reported_utilization_pct is not null`))[0].v,
}
fs.writeFileSync(path.join(here, 'financial-coverage.json'), JSON.stringify(coverage, null, 2) + '\n')
console.log(JSON.stringify(coverage, null, 2))
await db.close()
