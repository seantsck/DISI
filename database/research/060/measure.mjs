#!/usr/bin/env node
// Measures the 060 state of a DISI database (read-only) and prints it as JSON: the 059 measurement (database/research/059/measure.mjs, unchanged)
// plus the acquisition-cost facts 060 is about: the Dodgers known / unknown cost counts, the financial ledger and its resolutions, the state of
// each of the 25 reviewed signings, the missing-cost list, and fingerprints of every signing and ledger row 060 must not move. The fingerprints
// include surrogate ids, so they compare two states of one database (before / after), never two separate builds.
//   node database/research/060/measure.mjs --dump <pglite-data-dir.tar>     a saved PGlite replay
//   node database/research/060/measure.mjs --chain <last-migration.sql>     a fresh canonical PGlite replay through that migration
//   DISI_VERIFY_DB_URL=... node database/research/060/measure.mjs           a PostgreSQL database (read-only transaction)
// With --baseline the output is written to database/research/060/baseline.json; with --out <file> to that file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measure as measure059 } from '../059/measure.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
const evidence = JSON.parse(fs.readFileSync(path.join(here, 'research-evidence.json'), 'utf8'))
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
// the 25 reviewed signings as (slug, year) pairs, and the notes that identify the ledger rows 060 writes
const REVIEWED = evidence.bonuses.map((b) => `(${lit(b.player_slug)}, ${b.signing_year})`).join(', ')
const NOTES = [evidence.ledger_mapping.note, evidence.ledger_mapping.known_zero_note].map(lit).join(', ')
const DODGERS = `(select id from public.organizations where name = ${lit(evidence.organization_name)})`
const reviewed = (alias) => `(p.slug, ${alias}.signing_year) in (${REVIEWED})`

export const MEASURE_060_SQL = {
  cost_counts: `select count(*)::int as signings, count(total_known_acquisition_cost_usd)::int as known, (count(*) - count(total_known_acquisition_cost_usd))::int as unknown,
      coalesce(sum(total_known_acquisition_cost_usd), 0)::text as known_usd,
      count(*) filter (where signing_bonus_usd = 0)::int as zero_bonuses, count(*) filter (where total_known_acquisition_cost_usd = 0)::int as zero_costs
    from public.v_signing_records where is_dodgers_franchise`,
  all_zero_bonuses: `select p.slug, sg.signing_year from public.signings sg join public.players p on p.id = sg.player_id where sg.signing_bonus_usd = 0 order by 1, 2`,
  ledger: `select component_type, report_origin, record_status, count(*)::int as reports, sum(amount)::text as amount_usd
    from public.signing_financial_reports group by 1, 2, 3 order by 1, 2, 3`,
  resolutions: `select p.slug, sg.signing_year, d.component_type, d.basis, d.record_status, r.amount::text as selected_amount, so.url as selected_source_url,
      d.reviewed_by, d.reviewed_at::text as reviewed_at, d.rationale
    from public.signing_financial_resolutions d join public.signings sg on sg.id = d.signing_id join public.players p on p.id = sg.player_id
    join public.signing_financial_reports r on r.id = d.selected_report_id left join public.sources so on so.id = r.source_id order by 1, 2, 5`,
  reviewed: `select p.slug, sg.signing_year, sg.pathway::text as pathway, sg.signing_bonus_usd::text as signing_bonus_usd, sg.bonus_publicly_reported,
      sg.posting_fee_usd::text as posting_fee_usd, sg.transfer_fee_usd::text as transfer_fee_usd, sg.total_known_acquisition_cost_usd::text as total_known_acquisition_cost_usd,
      f.bonus_status, f.bonus_source_status, f.acquisition_cost_completeness, f.known_acquisition_cost_usd::text as known_acquisition_cost_usd,
      f.resolved_components, f.known_components,
      coalesce((select jsonb_agg(jsonb_build_object('amount', r.amount::text, 'origin', r.report_origin, 'evidence_basis', r.evidence_basis, 'confidence', r.confidence::text,
          'amount_basis', r.amount_basis, 'source_url', so.url, 'note', r.note, 'status', r.record_status) order by r.record_status, r.amount, so.url)
        from public.signing_financial_reports r left join public.sources so on so.id = r.source_id where r.signing_id = sg.id and r.component_type = 'SIGNING_BONUS'), '[]'::jsonb) as bonus_reports,
      (select count(*) from public.signing_financial_resolutions d where d.signing_id = sg.id and d.record_status = 'ACTIVE')::int as active_resolutions
    from public.signings sg join public.players p on p.id = sg.player_id join public.v_signing_acquisition_financials f on f.signing_id = sg.id
    where sg.organization_id = ${DODGERS} and ${reviewed('sg')} order by 2, 1`,
  missing_cost: `select player_slug, signing_year from public.v_signing_records where is_dodgers_franchise and total_known_acquisition_cost_usd is null order by 2 desc, 1`,
  fingerprints: `select
      (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(concat_ws('|', p.slug, sg.signing_year, sg.signing_bonus_usd, sg.posting_fee_usd, sg.transfer_fee_usd,
          sg.bonus_publicly_reported, sg.international_pool_treatment, sg.signing_date, sg.pathway, sg.organization_id)) as h
        from public.signings sg join public.players p on p.id = sg.player_id where not (sg.organization_id = ${DODGERS} and ${reviewed('sg')})) z) as other_signings,
      (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5((to_jsonb(r) - 'created_at')::text) as h
        from public.signing_financial_reports r where r.note is null or r.note not in (${NOTES})) z) as other_reports,
      (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5((to_jsonb(e) - 'created_at')::text) as h from public.signing_environment_financial_reports e) z) as environment_reports,
      (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5((to_jsonb(d) - 'created_at')::text) as h
        from public.signing_financial_resolutions d where d.rationale <> ${lit(evidence.beltre_resolution.rationale)}) z) as other_resolutions,
      (select count(*) from public.signing_financial_reports r where r.note in (${NOTES}))::int as reports_060,
      (select count(*) from public.signing_financial_resolutions d where d.rationale = ${lit(evidence.beltre_resolution.rationale)})::int as resolutions_060`,
}

export async function measure(query) {
  const base = await measure059(query)
  const out = {}
  for (const [k, sql] of Object.entries(MEASURE_060_SQL)) out[k] = await query(sql)
  return { ...base, cost_counts: out.cost_counts[0], all_zero_bonuses: out.all_zero_bonuses, ledger: out.ledger, resolutions: out.resolutions, reviewed: out.reviewed,
    missing_cost: out.missing_cost, fingerprints: out.fingerprints[0] }
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
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: 'disi-060-measure' })
    await client.connect()
    await client.query('begin read only')
    query = async (sql) => (await client.query(sql)).rows
    close = async () => { await client.query('rollback'); await client.end() }
  }
  const m = await measure(query)
  await close()
  const text = JSON.stringify(m, null, 1) + '\n'
  if (process.argv.includes('--baseline')) fs.writeFileSync(path.join(here, 'baseline.json'), text)
  if (arg('out')) fs.writeFileSync(path.resolve(arg('out')), text)
  process.stdout.write(text)
}
