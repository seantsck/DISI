#!/usr/bin/env node
// Measures the 061 state of a DISI database (read-only) and prints it as JSON: the headline numbers every release check pins (cost counts, CAREER_BWAR,
// BWAR_MISSING, both queues, snapshots, prediction fingerprints, taken from the 060 measurement), the transaction assets 061 touches, the Garland
// events and control intervals, the 061 sources and evidence, and fingerprints of every transaction row 061 must not move. The fingerprints include
// surrogate ids, so they compare two states of one database (before / after), never two separate builds.
//   node database/research/061/measure.mjs --dump <pglite-data-dir.tar>     a saved PGlite replay
//   node database/research/061/measure.mjs --chain <last-migration.sql>     a fresh canonical PGlite replay through that migration
//   DISI_VERIFY_DB_URL=... node database/research/061/measure.mjs           a PostgreSQL database (read-only transaction)
// With --baseline the output is written to database/research/061/baseline-build.json; with --out <file> to that file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measure as measure060 } from '../060/measure.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
const evidence = JSON.parse(fs.readFileSync(path.join(here, 'research-evidence.json'), 'utf8'))
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const list = (xs) => xs.map(lit).join(', ')

export const NEW_EVENT_KEYS = evidence.events.map((e) => e.event_key)
export const TARGET_EVENT_KEYS = [...new Set([...evidence.amount_updates.map((u) => u.event_key), ...evidence.asset_inserts.map((a) => a.event_key)])].sort()
export const SOURCE_URLS = evidence.sources.map((s) => s.url)
const GARLAND_MLB = evidence.events[0].asset.mlb_id

export const MEASURE_061_SQL = {
  targets: `select e.event_key, e.transaction_date::text as transaction_date, a.asset_side, a.asset_type, a.asset_name, a.cash_amount_usd::text as cash_amount_usd,
      a.pool_space_amount_usd::text as pool_space_amount_usd, o.name as counterparty, a.role_note, so.url as source_url
    from public.transaction_events e join public.transaction_event_assets a on a.event_id = e.id
    left join public.organizations o on o.id = a.counterparty_organization_id left join public.sources so on so.id = a.source_id
    where e.event_key in (${list(TARGET_EVENT_KEYS)}) and a.asset_type <> 'PLAYER' order by 1, 3, 4, 5`,
  garland: `select e.event_key, e.transaction_date::text as transaction_date, e.transaction_type, a.asset_side, a.asset_name, a.bref_id, a.mlb_id, so.url as source_url
    from public.transaction_events e join public.transaction_event_assets a on a.event_id = e.id left join public.sources so on so.id = a.source_id
    where a.mlb_id = ${lit(GARLAND_MLB)} order by e.transaction_date, 1`,
  garland_intervals: `select interval_key, start_event_key, interval_start::text as interval_start, exit_event_key, exit_method, interval_end::text as interval_end, interval_status,
      is_lineage_interval, war_state, interval_bounded_dodgers_bwar::text as interval_bounded_dodgers_bwar, dodgers_rows_in_interval
    from public.v_player_control_intervals where mlb_id = ${lit(GARLAND_MLB)} order by interval_start, 1`,
  sources: `select url, source_name, source_type, source_tier, title, publication_date::text as publication_date, accessed_at::text as accessed_at
    from public.sources where url in (${list(SOURCE_URLS)}) order by url`,
  evidence: `select ev.entity_type, e.event_key, ev.field_name, ev.confidence::text as confidence, so.url as source_url, ev.evidence_note
    from public.evidence ev join public.sources so on so.id = ev.source_id left join public.transaction_events e on e.id = ev.entity_id and ev.entity_type = 'transaction_event'
    where so.url in (${list(SOURCE_URLS)}) order by e.event_key nulls last, ev.field_name, so.url`,
  counts: `select (select count(*) from public.transaction_events)::int as events, (select count(*) from public.transaction_event_assets)::int as assets,
      (select count(*) from public.transaction_event_assets where asset_type = 'CASH')::int as cash_assets,
      (select count(*) from public.transaction_event_assets where asset_type = 'CASH' and cash_amount_usd is null)::int as cash_unknown,
      (select count(*) from public.transaction_event_assets where asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE')::int as pool_assets,
      (select count(*) from public.transaction_event_assets where asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and pool_space_amount_usd is null)::int as pool_unknown,
      (select count(*) from public.transaction_event_assets where asset_type = 'FUTURE_CONSIDERATIONS')::int as future_considerations,
      (select count(*) from public.transaction_event_assets where asset_type = 'PLAYER_TO_BE_NAMED')::int as ptbn,
      (select count(*) from public.transaction_asset_resolutions)::int as resolutions, (select count(*) from public.transaction_asset_resolutions where record_status = 'ACTIVE')::int as active_resolutions,
      (select count(*) from public.sources)::int as sources, (select count(*) from public.evidence)::int as evidence`,
  fingerprints: `select
      (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(e)::text) as h from public.transaction_events e where e.event_key not in (${list(NEW_EVENT_KEYS)})) z) as other_events,
      (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(a)::text) as h from public.transaction_event_assets a
         where a.event_id not in (select id from public.transaction_events where event_key in (${list([...TARGET_EVENT_KEYS, ...NEW_EVENT_KEYS])}))) z) as other_assets,
      (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(a)::text) as h from public.transaction_event_assets a
         where a.event_id in (select id from public.transaction_events where event_key in (${list(TARGET_EVENT_KEYS)})) and a.asset_type = 'PLAYER') z) as target_event_players,
      (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(r)::text) as h from public.transaction_asset_resolutions r) z) as resolutions,
      (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(o)::text) as h from public.dodgers_control_observations o) z) as control_observations,
      (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(t)::text) as h from public.transaction_asset_timing_observations t) z) as timing_observations,
      (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(s)::text) as h from public.sources s where s.url not in (${list(SOURCE_URLS)})) z) as other_sources,
      (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5((to_jsonb(v) - 'created_at')::text) as h from public.evidence v
         where v.source_id not in (select id from public.sources where url in (${list(SOURCE_URLS)}))) z) as other_evidence`,
}

export async function measure(query) {
  const base = await measure060(query)
  const out = {}
  for (const [k, sql] of Object.entries(MEASURE_061_SQL)) out[k] = await query(sql)
  return {
    headline: { cost_counts: base.cost_counts, metric: base.metric, bwar_missing: base.bwar_missing.length, transaction_queue: base.transaction_queue, value_queue: base.value_queue,
      research_task_types: base.research_task_types, snapshots: base.snapshots, prediction: base.prediction, value_totals: base.value_totals },
    isolation_060: { counts: base.counts, hashes: base.hashes, ledger: base.ledger, resolutions: base.resolutions, fingerprints: base.fingerprints, executive_overview_body_md5: base.executive_overview_body_md5 },
    transaction_rows: { targets: out.targets, garland: out.garland, garland_intervals: out.garland_intervals, sources: out.sources, evidence: out.evidence },
    counts: out.counts[0], fingerprints: out.fingerprints[0],
    transaction_queue_rows: await query(`select issue, priority, event_key, asset_name, player_slug from public.v_transaction_research_queue order by issue, event_key nulls last, player_slug nulls last, asset_name nulls last`),
    value_queue_rows: await query(`select issue, priority, event_key, player_slug from public.v_value_research_queue order by issue, event_key nulls last, player_slug nulls last`),
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let query, close
  const dump = arg('dump'), chainTo = arg('chain')
  if (dump || chainTo) {
    let db
    if (dump) {
      const { PGlite } = await import(['@electric-sql', 'pglite'].join('/'))
      const { pgcrypto } = await import(['@electric-sql', 'pglite', 'contrib', 'pgcrypto'].join('/'))
      db = new PGlite({ loadDataDir: new Blob([fs.readFileSync(dump)]), extensions: { pgcrypto } })
    } else {
      const { buildChainThrough } = await import('../../../tests/db/canonical-chain.mjs')
      db = (await buildChainThrough(chainTo)).db
    }
    query = async (sql) => (await db.query(sql)).rows
    close = () => db.close()
  } else {
    const url = process.env.DISI_VERIFY_DB_URL
    if (!url) throw new Error('pass --dump <tar>, --chain <migration> or set DISI_VERIFY_DB_URL')
    const { Client } = (await import(['p', 'g'].join(''))).default
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: 'disi-061-measure' })
    await client.connect()
    await client.query('begin read only')
    query = async (sql) => (await client.query(sql)).rows
    close = async () => { await client.query('rollback'); await client.end() }
  }
  const m = await measure(query)
  await close()
  const text = JSON.stringify(m, null, 1) + '\n'
  if (process.argv.includes('--baseline')) fs.writeFileSync(path.join(here, 'baseline-build.json'), text)
  if (arg('out')) fs.writeFileSync(path.resolve(arg('out')), text)
  process.stdout.write(text)
}
