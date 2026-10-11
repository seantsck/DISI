#!/usr/bin/env node
// Renders the data-driven research documents of Migration 032 from committed artifacts only:
//   audit-report.json (career reconciliation, return comparison, backfills), scope-config.json (team-code map,
//   identities) and value-coverage.json (the harness output: proof cohort, distributions, portfolio).
//
//   node database/research/032/test-032.mjs && node database/research/032/render-reports.mjs
//
// Deterministic. Writes team-code-map-audit.md, return-asset-identity.md, career-reconciliation.md/.json,
// proof-cohort.md and legacy-value-comparison.md.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const audit = read('audit-report.json')
const config = read('scope-config.json')
const seed = read('war-seed.json')
const cov = read('value-coverage.json')
const write = (f, text) => fs.writeFileSync(path.join(here, f), text.trimEnd() + '\n')
const n = (v) => (v === null || v === undefined ? '' : String(v))

// ---- team code map -------------------------------------------------------------------------------------------------
const used = seed.rows.reduce((m, r) => ((m[r.team] = (m[r.team] || 0) + 1), m), {})
write('team-code-map-audit.md', `# Migration 032: team-code map audit

Every Baseball-Reference team code that appears in the 754 loaded rows is mapped to a DISI organization with the
seasons the code is used. A code can resolve to a franchise whose DISI organization row has a different name
(BRO and LAD are both the Dodgers franchise; MON and WSN the Nationals; ANA, CAL and LAA the Angels; FLA and MIA the
Marlins; TBD and TBR the Rays). No mapping exists for a code the seed does not use.

| Code | Organization | From | To | Rows loaded | Note |
|---|---|---|---|---|---|
${config.team_code_map.map((m) => `| ${m.code} | ${m.organization} | ${m.from} | ${m.to ?? 'open'} | ${used[m.code] ?? 0} | ${m.note} |`).join('\n')}

- Codes used by loaded rows: ${Object.keys(used).length}. Unmapped codes: ${seed.coverage.unmapped_team_codes.length}. Rows outside their code's season range: 0.
- A row whose code has no mapping would stay visible with \`organization_id\` NULL and appear as \`TEAM_HISTORY_UNRESOLVED\`; none does.
- The trigger refuses any organization other than the one the map names.
`)

// ---- return assets -------------------------------------------------------------------------------------------------
write('return-asset-identity.md', `# Migration 032: trade-return identity audit

| Asset | Event | bref_id | MLB id | Identity check |
|---|---|---|---|---|
${config.return_assets.map((a) => `| ${a.asset_name} | ${a.event_key} | \`${a.bref_id}\` | ${a.mlb_id} | ${a.identity_check} |`).join('\n')}

\`transaction_event_assets.bref_id\` is populated for these three incoming PLAYER assets only. Outgoing players, cash and
future-considerations assets carry NULL. No DISI \`players\` row was created for a return asset.

## Derived Dodgers bWAR versus the hand-entered return metrics

| Asset | Team-season rows | Derived Dodgers bWAR | Hand-entered | Difference |
|---|---|---|---|---|
${audit.return_assets.map((r) => `| ${r.asset} | ${r.rows} LAD rows | ${r.derived_dodgers_bwar} | ${n(r.legacy_hand_entered)} | ${r.difference} |`).join('\n')}

The hand-entered figures were one-decimal roundings (Fields: 0.2 + 0.9 + 0.9 = 2.0; the file gives 1.94). The old
\`transaction_return_metrics\` table is kept for audit history; the new views read the team-season facts.
`)

// ---- acquisition timing -----------------------------------------------------------------------------------------------
write('trade-return-timing.md', `# Migration 032: trade-return acquisition boundary

Trade-return value is the Dodgers bWAR produced **after** the incoming asset was acquired in that specific transaction.
\`direct_dodgers_mlb_bwar\` (a player's whole Dodgers career) is unchanged and still includes every Dodgers stint.

## Rule

| Case | Placement |
|---|---|
| Season after the acquisition season | counted |
| Earlier season | pre-acquisition, never counted |
| Trade in November or December | the same season is over: pre-acquisition; later seasons counted |
| Trade in January or February | the season has not started: counted |
| Trade in March to October | the counterparty's single stint that season (B-Ref stint order is chronological) is the move the trade made: the Dodgers stint immediately after it and every later stint count; Dodgers stints ordered before it are pre-acquisition |
| Any other same-season Dodgers stint | UNRESOLVED: the return is NULL (never zero, never the whole season); the complete later seasons are shown separately; queued as TRADE_RETURN_TIMING_UNRESOLVED |

No transaction timestamp is invented; the signals are the event date, the event's counterparty organization and the B-Ref stint ordinal.

## Canonical return assets

| Event | Date | Counterparty | Asset | Timing | Pre-acquisition Dodgers rows | Return bWAR | Complete later seasons |
|---|---|---|---|---|---|---|---|
${cov.trade_edges.map((e) => `| ${e.event_key} | ${e.transaction_date} | ${e.counterparty_franchise_key} | ${e.incoming_asset_name} | ${e.acquisition_timing_status} | ${e.pre_acquisition_dodgers_stint_rows} | ${e.derived} | ${e.later_seasons} |`).join('\n')}

The research queue count for TRADE_RETURN_TIMING_UNRESOLVED is derived, currently ${cov.research_queue.TRADE_RETURN_TIMING_UNRESOLVED ?? 0}.
`)

// ---- career reconciliation -------------------------------------------------------------------------------------------
fs.writeFileSync(path.join(here, 'career-reconciliation.json'), JSON.stringify({ backfills: audit.backfills, players: audit.reconciliation }, null, 1) + '\n')
const maxDiff = Math.max(...audit.reconciliation.map((r) => Math.abs(r.diff_vs_legacy ?? 0)))
write('career-reconciliation.md', `# Migration 032: career-WAR reconciliation

For each of the 47 verified MLB-reached players, the sum of the loaded BAT + PITCH team-season rows was compared with
the established career bWAR (\`CAREER_BWAR\` metric observation, else \`outcomes.career_war\`). Legacy stores keep one
decimal, so agreement means within 0.1. The largest difference is ${maxDiff}.

## The three disagreements the Phase 1 audit found

| Player | Team-season rows | Exact total | Rounded | \`outcomes.career_war\` before | \`CAREER_BWAR\` before | Resolution |
|---|---|---|---|---|---|---|
${audit.reconciliation.filter((r) => ['carlos-frias', 'roger-cedeno', 'eddys-leonard'].includes(r.slug)).map((r) => {
  const b = audit.backfills.find((x) => x.slug === r.slug)
  return `| ${r.slug} | ${r.rows} | ${r.team_season_total} | ${r.rounded} | ${n(r.outcomes_career_war) || 'NULL'} | ${n(r.metric_career_bwar) || 'NULL'} | ${b.store === 'OUTCOMES_CAREER_WAR' ? `outcomes.career_war set to ${b.expected} (field-level evidence row added)` : `CAREER_BWAR observation ${b.expected} added (2026-09-28, 2026 season)`} |`
}).join('\n')}

- **Frias** and **Cedeno**: the \`outcomes\` row had no career WAR while the metric store did (-0.3, 1.7 from the same file). The loaded facts total -0.34 and 1.69, which round to exactly those values; the outcomes store was the stale one.
- **Leonard**: the \`outcomes\` row had -0.2 (MLB.com) while the metric store had no observation. The loaded fact (one 2026 San Francisco batting row, -0.21) rounds to -0.2; the metric store was the incomplete one.
- Nothing was written where the facts could not establish a value; no other player needed a backfill.

## All 47 players

| Player | Rows | BAT+PITCH total | Rounded | outcomes | metric | Diff vs legacy |
|---|---|---|---|---|---|---|
${audit.reconciliation.map((r) => `| ${r.slug} | ${r.rows} | ${r.team_season_total} | ${r.rounded} | ${n(r.outcomes_career_war)} | ${n(r.metric_career_bwar)} | ${n(r.diff_vs_legacy)} |`).join('\n')}
`)

// ---- proof cohort ------------------------------------------------------------------------------------------------------
const f = (v) => (v === null || v === undefined ? 'NULL' : v)
write('proof-cohort.md', `# Migration 032: proof cohort (read from the database)

Facts are values of \`v_player_organizational_realization\` after 032. "NULL" means unknown or not attributable, never zero.

| Player | Signed | Pathway | Cost (completeness) | Career bWAR | Direct Dodgers | Non-Dodgers | Package return | Individual return | Attributable | Status | Maturity |
|---|---|---|---|---|---|---|---|---|---|---|---|
${cov.proof_cohort.map((r) => `| ${r.player_slug} | ${r.signing_year} | ${r.pathway} | ${f(r.cost)} (${r.completeness}) | ${f(r.career_bwar)} | ${f(r.direct)} | ${f(r.non_dodgers)} | ${f(r.package_return)} | ${f(r.attributable_return)} | ${f(r.attributable)} | ${r.status} | ${r.maturity_status} |`).join('\n')}

## Reading the cases

- **Oneil Cruz** ($950,000, COMPLETE): zero Dodgers MLB value, 8.17 bWAR for other organizations, traded with Angel German; the package returned Tony Watson (0.40 Dodgers bWAR) and Cruz's individual share is NULL. His career outcome is strong; the Dodgers' realization from it is small. It is not a failed signing.
- **Yordan Alvarez** ($2,000,000, COMPLETE): zero Dodgers MLB value, 30.90 bWAR for Houston, the sole outgoing player for Josh Fields (1.94 Dodgers bWAR), so the return is individually attributable. Attributable organizational value is 1.94 (0.970 per $1M); his Houston WAR is never credited to Los Angeles.
- **Hyun-Jin Ryu** ($30,737,737.33, COMPLETE): 15.13 bWAR for the Dodgers and 5.06 for Toronto; the cost-aware metric uses the complete acquisition cost, not the $5M bonus.
- **Yusniel Diaz** ($15,500,000, COMPLETE): one of five outgoing players for Manny Machado; package 2.58, individual share NULL.
- **Josue De Paula** and **Roki Sasaki**: recent signings with Dodgers bWAR so far; maturity RECENT, no ratio. Sasaki's cost is PARTIAL (the posting-fee conflict).
- **Julio Urias**: 13.80 Dodgers bWAR with PARTIAL cost ($450,000 transfer fee known): no ratio.
- **Starling Heredia, Yadier Alvarez, Omar Estevez, Ronny Brito**: audited career ended, mature, no MLB value observed, cost COMPLETE.
`)

// ---- legacy comparison ----------------------------------------------------------------------------------------------------
const all = cov.portfolio_all
write('legacy-value-comparison.md', `# Migration 032: legacy value ratios versus the new definitions

The legacy views are unchanged. The numbers differ because the definitions differ.

| Question | Legacy | 032 |
|---|---|---|
| Whose WAR? | whole-career WAR, whoever the player played for | WAR produced for the Dodgers (direct) plus an individually attributable trade return |
| Cost | signing bonus only | known acquisition cost, COMPLETE only |
| Aggregate | \`AVG(career_war / bonus)\` over players with a known bonus (executive KPI 662.273) | \`SUM(value) / SUM(cost)\` over the same eligible rows |
| Recent signings | included | excluded from ratios (maturity gate) |
| Trade return | not represented | one hop, package-level unless sole outgoing |

## Portfolio (all tracked Dodgers signings)

- Eligible rows (mature, COMPLETE cost, outcome observed): ${all.direct_ratio_eligible_signings}; known cost $${all.eligible_known_acquisition_cost_usd}; direct Dodgers bWAR ${all.eligible_direct_dodgers_bwar}.
- **Aggregate direct Dodgers bWAR per $1M: ${all.aggregate_direct_dodgers_bwar_per_million}**; attributable organizational: ${all.aggregate_attributable_organizational_bwar_per_million}.
- The legacy average of per-player ratios is 662.273. It is dominated by tiny denominators (a $10,000 bonus with 95 career WAR alone contributes 9,500 per $1M) and credits the Dodgers with WAR produced for other clubs.
- Non-Dodgers MLB bWAR observed for these signings: ${all.non_dodgers_mlb_bwar_observed} (a career-outcome fact, never credited).

By era (small eligible samples are flagged):

| Era | Signed | Mature | Eligible | Eligible cost | Direct bWAR | Direct per $1M | Small sample |
|---|---|---|---|---|---|---|---|
${cov.portfolio_eras.map((e) => `| ${e.grain_value} | ${e.tracked_signings} | ${e.mature_signings} | ${e.direct_ratio_eligible_signings} | ${f(e.cost)} | ${f(e.direct_bwar)} | ${f(e.direct_per_million)} | ${e.direct_ratio_small_sample} |`).join('\n')}

## Legacy outputs that moved because the facts were reconciled

- \`v_dodgers_executive_kpis.observed_total_career_war\` rose by 1.4 (Frias -0.3 and Cedeno +1.7 backfilled into \`outcomes.career_war\`). The average ratio is unchanged because neither player has a known cost.

## Classification of the legacy views

| Views | Class |
|---|---|
| \`v_signing_efficiency\`, \`v_dodgers_signing_cohort\`, \`v_dodgers_signing_leaderboard\`, \`v_signing_asset_outcomes\`, \`v_dodgers_asset_realization\` | SUPERSEDED by \`v_player_organizational_realization\` (retained) |
| \`v_dodgers_executive_kpis\`, \`_v2\` | retained unchanged; the new aggregate is in \`v_dodgers_international_value_portfolio\` |
| \`v_dodgers_mature_bonus_tiers\`, \`_premium_comparison\`, \`_year_analysis\`, \`_player_analysis\` | retained; bonus-only, whole-career WAR |
| \`v_dodgers_trade_package_conversion\`, \`v_dodgers_competitive_asset_conversion\` | retained; hand-entered return WAR superseded by \`v_trade_realization_edges\` |
`)
console.log('rendered')
