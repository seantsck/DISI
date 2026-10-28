// 051: the audited no-MLB development coverage. The canonical 001-050 database is built, and the tests prove that the committed 051 cohort is
// reproduced exactly from the canonical outcome audits and development rows, that the new verifier check catches a VERIFIED_NO_MLB audit the
// development record contradicts, and that development history never reaches the signing-time feature matrix, the support counts, the stored
// evaluation or a probability. 051 writes no canonical row (the official source holds no fact DISI lacks for this cohort; see
// database/research/051/README.md), so the canonical chain is exactly the 050 chain.
//   NO MLB OUTCOME != NO DEVELOPMENT   AUDITED NO MLB != CAREER FAILURE   DEVELOPMENT HISTORY != PREDICTION FEATURE
//   POST-CONTROL AFFILIATED PLAY != DODGERS DEVELOPMENT   LAST OBSERVED SEASON != CAREER END

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_051 } from '../../scripts/db/lib/invariants.mjs'
import { DATASET_QUERIES, HISTORY_QUERIES, assembleDataset } from '../../lib/research/dataset.js'
import { developmentRecords } from '../../lib/research/development-research.js'
import { developmentNeeds } from '../../lib/research/development-needs.js'
import { auditedNoMlbCoverage } from '../../lib/research/history-coverage.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'database/research/051', f), 'utf8'))
const committed = read('cohort.json')
const records = read('development-records.json')

let chain
let dump
const q = (sql, params) => chain.query(sql, params)
const R = (x) => (Array.isArray(x) ? x : x.rows)
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const clone = async () => {
  const db = new PGlite({ loadDataDir: dump, extensions: { pgcrypto } })
  return { db, query: async (s, p) => (await db.query(s, p)).rows, close: () => db.close() }
}
const dataset = async (c) => {
  /** @type {Record<string, any[]>} */
  const raw = {}
  for (const [k, sql] of Object.entries({ ...DATASET_QUERIES, ...HISTORY_QUERIES })) raw[k] = R(await c.query(sql))
  // DATE columns as ISO strings, as the research loader reads them
  const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)
  for (const rows of Object.values(raw)) for (const r of rows) for (const k of Object.keys(r)) r[k] = iso(r[k])
  return assembleDataset(raw)
}
const coverageOf = (data) => {
  const by = new Map()
  for (const s of data.stints) { if (!by.has(s.player_id)) by.set(s.player_id, []); by.get(s.player_id).push(s) }
  return auditedNoMlbCoverage(data, by, developmentRecords, developmentNeeds)
}
const leakageState = async (c) => ({
  features: (await c.query(`select md5(string_agg(f::text, '|' order by f::text)) as h, count(*)::int as n from public.v_outcome_feature_matrix f`))[0],
  support: await c.query(`select target_key, reference_population, labelled_n, positive_n, negative_n, baseline_supported from public.v_outcome_target_support order by 1, 2`),
  evaluation: await c.query(`select model_key, training_fingerprint, evaluation_current from public.v_outcome_model_evaluation order by 1`),
  probabilities: (await c.query(`select count(*) filter (where probability is not null)::int as n from public.v_player_outcome_probability`))[0].n,
})

before(async () => {
  // the 051 head is the 050 chain (051 added no migration); 052 later dates and resolves part of this cohort's record
  chain = await buildChainThrough('050_international_benchmark_support_expansion.sql')
  dump = await chain.db.dumpDataDir('none')
})
after(async () => { await chain?.close() })

test('no 051 migration: the canonical chain goes from 050 to 052 (051 found no reviewed fact to write)', () => {
  const i = manifest.canonical_sql.indexOf('050_international_benchmark_support_expansion.sql')
  assert.ok(manifest.canonical_sql[i + 1] === undefined || manifest.canonical_sql[i + 1].startsWith('052'))
  assert.ok(!fs.readdirSync(path.join(root, 'database/sql')).some((f) => f.startsWith('051')))
  assert.equal(records.totals.reviewed_facts_disi_lacks, 0)
})

test('cohort: the committed 46 are exactly the canonical VERIFIED_NO_MLB Dodgers signings; NOT_AUDITED, verified MLB and benchmark rows are excluded', async () => {
  const rows = await q(`select s.player_slug, s.outcome_audit_status, s.is_dodgers_franchise from public.v_signing_records s order by 1`)
  const cohort = rows.filter((r) => r.is_dodgers_franchise && r.outcome_audit_status === 'VERIFIED_NO_MLB').map((r) => r.player_slug)
  assert.equal(cohort.length, 46)
  assert.deepEqual(committed.players.map((p) => p.player_slug).sort(), cohort.sort())
  // benchmark-only VERIFIED_NO_MLB rows exist and are not in the cohort
  const benchmarkNoMlb = rows.filter((r) => !r.is_dodgers_franchise && r.outcome_audit_status === 'VERIFIED_NO_MLB').map((r) => r.player_slug)
  assert.ok(benchmarkNoMlb.length > 0)
  assert.ok(benchmarkNoMlb.every((s) => !cohort.includes(s)))
})

test('the committed per-player research state reproduces exactly from the canonical chain', async () => {
  const cov = coverageOf(await dataset(chain))
  const bySlug = new Map(cov.rows.map((r) => [r.player_slug, r]))
  for (const p of committed.players) {
    const r = bySlug.get(p.player_slug)
    assert.ok(r, p.player_slug)
    assert.equal(r.highest_level_recorded ?? 'UNKNOWN', p.highest_level_recorded, `${p.player_slug} highest level`)
    assert.deepEqual(r.segments.highest_level_at_dodgers_affiliate, p.highest_level_at_dodgers_affiliate, `${p.player_slug} Dodgers-affiliate highest level`)
    assert.deepEqual(r.segments.last_observed_affiliated, p.last_observed_affiliated, `${p.player_slug} last observed`)
    assert.equal(r.first_pro_status, p.first_professional_season, `${p.player_slug} first professional season`)
    assert.deepEqual(r.history.gaps.map((g) => g.code), p.gaps.map((g) => g.code), `${p.player_slug} gaps`)
    assert.deepEqual(r.exact_dates, p.exact_dates, `${p.player_slug} exact dates`)
  }
  assert.deepEqual(cov.contradictions, [])
  // HIGHEST LEVEL != COMPLETE DEVELOPMENT HISTORY: the whole career and the Dodgers-affiliate part are two figures
  assert.deepEqual(cov.highest_level_whole_career, { INTERNATIONAL_ROOKIE: 10, COMPLEX_ROOKIE: 6, LOW_A: 7, HIGH_A: 8, AA: 4, AAA: 9 })
  assert.deepEqual(cov.highest_level_at_dodgers_affiliate, { INTERNATIONAL_ROOKIE: 11, COMPLEX_ROOKIE: 8, LOW_A: 8, HIGH_A: 8, AA: 4, AAA: 5 })
})

test('a later stint with another organization is not Dodgers development (Clementina: Complex at Dodgers affiliates, AAA with Atlanta)', async () => {
  const cov = coverageOf(await dataset(chain))
  const h = cov.rows.find((r) => r.player_slug === 'hendrik-clementina')
  assert.deepEqual(h.segments.highest_level_whole_career, { level: 'AAA', season: 2022 })
  assert.equal(h.segments.highest_level_at_dodgers_affiliate.level, 'COMPLEX_ROOKIE')
  assert.ok(h.segments.other_organizations.includes('Atlanta Braves'))
  assert.equal(h.highest_level_recorded, 'AAA')
})

test('verifier: 259/259 at the 051 head (the 050 chain), including the 051 check', async () => {
  const full = await checkInvariants(q, EXPECTATIONS_THROUGH_051)
  assert.deepEqual(failedChecks(full).map((f) => f.name), [])
  assert.equal(full.hard.length, 259)
  assert.ok(full.hard.some((h) => h.name === 'no_mlb_development_contradictions' && h.pass))
})

test('the 051 check catches a VERIFIED_NO_MLB audit contradicted by an MLB stint or an MLB_DEBUT milestone', async () => {
  const c = await clone()
  try {
    const n = async () => (await c.query(`select count(distinct s.player_id)::int as n from public.v_signing_records s
      where s.outcome_audit_status = 'VERIFIED_NO_MLB'
        and (exists (select 1 from public.player_season_stints t where t.player_id = s.player_id and t.level = 'MLB')
          or exists (select 1 from public.development_milestones m where m.player_id = s.player_id and m.event_code = 'MLB_DEBUT'))`))[0].n
    assert.equal(await n(), 0)
    await c.db.exec(`insert into public.player_season_stints (player_id, season, source_level, level, level_classification, era, affiliated, as_of_date, retrieved_at)
      select id, 2026, 'MLB', 'MLB', 'MLB_SPORT_ID', 'MODERN_FOUR_LEVEL_2021_PLUS', true, date '2026-10-22', now() from public.players where slug = 'diego-cartaya'`)
    assert.equal(await n(), 1)
    await c.db.exec(`insert into public.development_milestones (player_id, milestone, event_code, date_precision, season_year, evidence_basis, confidence, as_of_date)
      select id, 'MLB_DEBUT', 'MLB_DEBUT', 'SEASON', 2026, 'SEASON_SPLITS', 'HIGH', date '2026-10-22' from public.players where slug = 'jerming-rosario'`)
    assert.equal(await n(), 2)
    const full = await checkInvariants(c.query, EXPECTATIONS_THROUGH_051)
    assert.ok(failedChecks(full).some((f) => f.name === 'no_mlb_development_contradictions'))
  } finally { await c.close() }
})

test('development history is not a prediction feature: new development rows leave the feature matrix, support, evaluation and probabilities unchanged', async () => {
  const c = await clone()
  try {
    const beforeState = await leakageState(c)
    assert.equal(beforeState.probabilities, 0)
    assert.ok(beforeState.evaluation.every((e) => e.training_fingerprint === 'af9ec05feb3ee1518cb7608193cd209a' && e.evaluation_current))
    // a later affiliated season for an audited no-MLB player, and a new level milestone
    await c.db.exec(`insert into public.player_season_stints (player_id, season, organization_name, affiliate_team, league_name, source_level, level, level_classification, era, affiliated, g, as_of_date, retrieved_at)
      select id, 2026, 'Los Angeles Dodgers', 'Test Affiliate', 'Test League', 'AA', 'AA', 'SPORT_ID_12', 'MODERN_FOUR_LEVEL_2021_PLUS', true, 12, date '2026-10-22', now() from public.players where slug = 'yeiner-fernandez'`)
    await c.db.exec(`insert into public.development_milestones (player_id, milestone, event_code, date_precision, season_year, evidence_basis, confidence, as_of_date)
      select id, 'AAA_DEBUT', 'AAA_DEBUT', 'SEASON', 2026, 'SEASON_SPLITS', 'HIGH', date '2026-10-22' from public.players where slug = 'yeiner-fernandez'`)
    const afterState = await leakageState(c)
    assert.equal(md5(afterState), md5(beforeState))
  } finally { await c.close() }
})

test('outcome isolation: the cohort audits, MLB debuts, WAR and transactions are what 050 left', async () => {
  const one = async (sql) => (await q(sql))[0]
  const d = await one(`select count(*) filter (where outcome_audit_status = 'VERIFIED_MLB')::int as mlb, count(*) filter (where outcome_audit_status = 'VERIFIED_NO_MLB')::int as no_mlb,
    count(*) filter (where outcome_audit_status = 'NOT_AUDITED')::int as na from public.v_signing_records where is_dodgers_franchise`)
  assert.deepEqual(d, { mlb: 47, no_mlb: 46, na: 127 })
  assert.equal((await one(`select count(*)::int as n from public.player_mlb_team_season_war`)).n, 1880)
  assert.equal((await one(`select count(*)::int as n from public.transaction_events`)).n, 213)
  assert.equal((await one(`select count(*)::int as n from public.transaction_event_assets`)).n, 396)
  assert.equal((await one(`select count(*)::int as n from public.development_milestones m join public.v_signing_records s on s.player_id = m.player_id
    where s.outcome_audit_status = 'VERIFIED_NO_MLB' and m.event_code = 'MLB_DEBUT'`)).n, 0)
})
