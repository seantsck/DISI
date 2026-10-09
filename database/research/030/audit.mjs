#!/usr/bin/env node
// Offline audit for Migration 030. It builds the canonical chain through 029 in memory (no network,
// no real database) and measures every fact the migration's guards, seeds and derived backfill
// depend on. Counts are derived from data, never hard-coded into the migration. Exits non-zero on
// any failure.
//
//   node database/research/030/audit.mjs   ->  database/research/030/audit-report.json

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const seed = JSON.parse(fs.readFileSync(path.join(here, 'seed-evidence.json'), 'utf8'))
const failures = []
const check = (label, ok) => { if (!ok) failures.push(label) }
const sourceUrl = Object.fromEntries(seed.sources.map((s) => [s.key, s.url]))

const ch = await buildChainThrough('029_signing_network_intelligence.sql')
const q = ch.query
const one = async (sql, params) => (await q(sql, params))[0]

// ---- baseline ----------------------------------------------------------------------------------------------------------
const totals = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
check('baseline is 50 tables / 93 views', totals.tables === 50 && totals.views === 93)
const present = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname in ('signing_financial_reports', 'signing_environment_financial_reports',
  'acquisition_cost_component_rules', 'v_signing_acquisition_financials', 'v_dodgers_financial_commitment_by_class', 'v_dodgers_financial_commitment_by_market', 'v_financial_research_queue')`)).map((r) => r.relname)
check('no 030 object exists yet', present.length === 0)
const currency = await q(`select table_name, column_name from information_schema.columns where table_schema = 'public' and column_name ~* 'currency|fx_|exchange_rate'`)
check('no currency or FX column exists yet', currency.length === 0)

// ---- canonical expectations --------------------------------------------------------------------------------------------
for (const e of seed.canonical_expectations.signings) {
  const rows = await q(`select sg.signing_bonus_usd::text as b, sg.posting_fee_usd::text as p, sg.transfer_fee_usd::text as t from signings sg
    join players p on p.id = sg.player_id join organizations o on o.id = sg.organization_id where p.slug = $1 and o.name = $2 and sg.signing_year = $3`,
  [e.player_slug, e.organization_name, e.signing_year])
  check(`${e.player_slug} ${e.signing_year} exists once with the expected money values`,
    rows.length === 1 && rows[0].b === e.signing_bonus_usd && rows[0].p === e.posting_fee_usd && rows[0].t === e.transfer_fee_usd)
}
const fieldEvidence = await q(`select p.slug, sg.signing_year, ev.field_name, so.url from evidence ev join signings sg on sg.id = ev.entity_id join players p on p.id = sg.player_id
  join sources so on so.id = ev.source_id where ev.entity_type = 'signing' and ev.field_name in ('signing_bonus_usd', 'posting_fee_usd', 'transfer_fee_usd') order by 1`)
check('field-level money evidence is exactly the reviewed set', JSON.stringify(fieldEvidence.map((r) => [r.slug, r.signing_year, r.field_name, r.url])) ===
  JSON.stringify(seed.canonical_expectations.field_level_money_evidence.map((e) => [e.player_slug, e.signing_year, e.field_name, sourceUrl[e.source]]).sort()))
const ps = seed.canonical_expectations.dodgers_2019_period_summary
const summary = await q(`select s.pool_amount_usd::text as pool, s.pool_spent_usd::text as spent, so.url from international_org_period_summary s
  join organizations o on o.id = s.organization_id join sources so on so.id = s.source_id where o.franchise_key = 'DODGERS' and s.period_start_year = 2019`)
check('Dodgers 2019-20 period summary: pool 5,366,400 / spent 5,354,000 from the roundup', summary.length === 1 && summary[0].pool === ps.pool_amount_usd
  && summary[0].spent === ps.pool_spent_usd && summary[0].url === sourceUrl[ps.source])

// ---- sources ----------------------------------------------------------------------------------------------------------------
const registered = new Set((await q('select url from sources where url = any($1)', [seed.sources.map((s) => s.url)])).map((r) => r.url))
for (const s of seed.sources) check(`source ${s.key} is ${s.existing ? 'already' : 'not yet'} registered`, registered.has(s.url) === s.existing)

// ---- seeded report references ------------------------------------------------------------------------------------------------
const signingRefs = [...seed.signing_reports, ...seed.pool_treatments]
for (const r of signingRefs) {
  const n = (await one(`select count(*)::int as n from signings sg join players p on p.id = sg.player_id join organizations o on o.id = sg.organization_id
    where p.slug = $1 and o.name = $2 and sg.signing_year = $3`, [r.player_slug, r.organization_name, r.signing_year])).n
  check(`signing ${r.player_slug} ${r.signing_year} resolves once`, n === 1)
}
// every seeded value agrees with the canonical column it corroborates (except the reviewed Ryu changes and the Sasaki conflict)
const col = { SIGNING_BONUS: 'signing_bonus_usd', POSTING_FEE: 'posting_fee_usd', TRANSFER_FEE: 'transfer_fee_usd' }
for (const r of seed.signing_reports) {
  const c = await one(`select sg.${col[r.component_type]}::text as v from signings sg join players p on p.id = sg.player_id where p.slug = $1 and sg.signing_year = $2`, [r.player_slug, r.signing_year])
  const changed = seed.canonical_changes.find((x) => x.player_slug === r.player_slug && x.column === col[r.component_type])
  const target = changed ? changed.to : c.v
  if (target == null) { check(`${r.ref}: a NULL canonical value is only kept for the reviewed Sasaki conflict`, r.player_slug === 'roki-sasaki' && r.component_type === 'POSTING_FEE'); continue }
  const ok = r.amount_basis === 'ROUNDED' ? Math.abs(Number(r.amount) - Number(target)) <= Number(r.amount_precision) / 2 : Number(r.amount) === Number(target)
  check(`${r.ref}: agrees with the canonical value ${target}`, ok)
}
for (const r of seed.environment_reports) {
  const n = (await one(`select count(*)::int as n from signing_environments se join organizations o on o.id = se.organization_id where o.franchise_key = 'DODGERS' and se.signing_year = $1`, [r.signing_year])).n
  check(`environment ${r.signing_year} resolves (${r.ref})`, n === (r.signing_year === 2019 ? 0 : 1))
}
// environment reports agree with the canonical environment columns they corroborate
const envCol = { BASE_POOL: 'club_bonus_pool_usd', POOL_AFTER_TRADES: 'pool_after_trades_usd', INDIVIDUAL_BONUS_CAP: 'max_individual_bonus_usd', OVERAGE_TAX_RATE: 'overage_tax_rate' }
for (const r of seed.environment_reports.filter((x) => envCol[x.metric_type] && x.signing_year !== 2019)) {
  const c = await one(`select se.${envCol[r.metric_type]}::text as v from signing_environments se join organizations o on o.id = se.organization_id where o.franchise_key = 'DODGERS' and se.signing_year = $1`, [r.signing_year])
  const value = r.amount_usd ?? r.rate_value
  const ok = c.v != null && (r.amount_basis === 'ROUNDED' ? Math.abs(Number(value) - Number(c.v)) <= Number(r.amount_precision) / 2 : Number(value) === Number(c.v))
  check(`${r.ref}: agrees with the canonical environment value ${c.v}`, ok)
}

// ---- derived counts (the migration derives these itself; the audit records them) -------------------------------------------
const moneyColumns = await one(`select
  count(*) filter (where signing_bonus_usd is not null)::int as bonus, count(*) filter (where posting_fee_usd is not null)::int as posting,
  count(*) filter (where transfer_fee_usd is not null)::int as transfer, count(*)::int as signings,
  count(*) filter (where signing_bonus_usd = 0 or posting_fee_usd = 0 or transfer_fee_usd = 0)::int as zero_values from signings`)
check('no canonical money value is zero (unknown was never stored as zero)', moneyColumns.zero_values === 0)
const legacy = await q(`select v.component_type, count(*)::int as n from signings sg
  cross join lateral (values ('SIGNING_BONUS', sg.signing_bonus_usd, 'signing_bonus_usd'), ('POSTING_FEE', sg.posting_fee_usd, 'posting_fee_usd'), ('TRANSFER_FEE', sg.transfer_fee_usd, 'transfer_fee_usd')) v(component_type, amount, field_name)
  where v.amount is not null and not exists (select 1 from evidence ev where ev.entity_type = 'signing' and ev.entity_id = sg.id and ev.field_name = v.field_name)
  group by 1 order by 1`)
const legacyByComponent = Object.fromEntries(legacy.map((r) => [r.component_type, r.n]))
const legacyTotal = legacy.reduce((a, r) => a + r.n, 0)
check('legacy carry-forward = non-null money columns minus field-evidenced ones',
  legacyTotal === moneyColumns.bonus + moneyColumns.posting + moneyColumns.transfer - seed.canonical_expectations.field_level_money_evidence.length)
const envLegacy = await one(`select count(*) filter (where club_bonus_pool_usd is not null)::int + count(*) filter (where pool_after_trades_usd is not null)::int
  + count(*) filter (where max_individual_bonus_usd is not null)::int + count(*) filter (where overage_tax_rate is not null)::int as n, count(*)::int as environments from signing_environments`)
check('8 signing environments before 030', envLegacy.environments === 8)
const prePool = await one(`select count(*)::int as n from signings where signing_date < date '2012-07-02' or (signing_date is null and signing_year <= 2011)`)
const prePoolSourced = seed.pool_treatments.filter((t) => t.treatment === 'NOT_APPLICABLE').length
const twentyTwelveUndated = await one(`select count(*)::int as n from signings where signing_year = 2012 and signing_date is null`)
const members2019 = await q(`select p.slug from signing_population_members m join signing_populations sp on sp.id = m.population_id join signings sg on sg.id = m.signing_id
  join players p on p.id = sg.player_id where sp.population_key = $1 order by 1`, [seed.new_environment.linked_population_key])
check('the 2019-20 population has 3 members, none linked to an environment', members2019.length === 3)
const linked2019 = await one(`select count(*)::int as n from signings sg join signing_population_members m on m.signing_id = sg.id join signing_populations sp on sp.id = m.population_id
  where sp.population_key = $1 and sg.signing_environment_id is not null`, [seed.new_environment.linked_population_key])
check('no 2019-20 member is linked yet', linked2019.n === 0)
const dodgers2019 = await q(`select p.slug from signings sg join players p on p.id = sg.player_id join organizations o on o.id = sg.organization_id where o.franchise_key = 'DODGERS' and sg.signing_year = 2019 order by 1`)

// ---- the legacy WAR-per-dollar views (definitions recorded, never changed) -----------------------------------------------------
const LEGACY_WAR_VIEWS = ['v_signing_efficiency', 'v_dodgers_signing_cohort', 'v_dodgers_signing_leaderboard', 'v_dodgers_asset_realization', 'v_signing_asset_outcomes',
  'v_dodgers_executive_kpis', 'v_dodgers_executive_case_studies', 'v_dodgers_executive_dashboard_feed', 'v_dodgers_mature_bonus_tiers',
  'v_dodgers_mature_premium_comparison', 'v_dodgers_mature_year_analysis', 'v_dodgers_mature_player_analysis']
const defs = {}
for (const v of LEGACY_WAR_VIEWS) {
  const d = await one(`select pg_get_viewdef($1::regclass) as d, obj_description($1::regclass, 'pg_class') as c`, [`public.${v}`])
  defs[v] = { definition_md5: crypto.createHash('md5').update(d.d).digest('hex'), has_comment: d.c != null }
}
await ch.close()

const report = {
  audited_against: 'canonical replay 001-029 (in memory)',
  baseline: { tables: totals.tables, views: totals.views, signing_environments: envLegacy.environments },
  canonical_money_columns: moneyColumns,
  field_level_money_evidence: fieldEvidence.map((r) => `${r.slug} ${r.signing_year} ${r.field_name}`),
  derived_backfill: {
    signing_legacy_carryforward_total: legacyTotal,
    signing_legacy_carryforward_by_component: legacyByComponent,
    environment_legacy_carryforward_total: envLegacy.n,
  },
  seeded_external: {
    signing_reports: seed.signing_reports.length,
    signing_reports_rule_derived_basis: seed.signing_reports.filter((r) => r.amount_basis === 'RULE_DERIVED').length,
    environment_reports: seed.environment_reports.length,
  },
  pool_treatment: {
    pre_pool_signings: prePool.n,
    rule_based_not_applicable: prePool.n - prePoolSourced,
    source_statements: seed.pool_treatments.length,
    undated_2012_signings_left_unknown: twentyTwelveUndated.n,
  },
  dodgers_2019_signings: dodgers2019.map((r) => r.slug),
  dodgers_2019_population_members_to_link: members2019.map((r) => r.slug),
  legacy_war_per_dollar_views: defs,
  failures,
}
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (failures.length) { console.error(`audit failed (${failures.length})`); process.exit(1) }
