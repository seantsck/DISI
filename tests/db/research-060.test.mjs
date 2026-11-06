// Migration 060: owner-reviewed acquisition costs. The 059 database is built (001-059), 060 is applied for real, and the tests prove that exactly the
// 25 owner-reviewed Dodgers signing bonuses (2026-11-04) become canonical: 24 through the unsourced-canonical ledger path (LEGACY_CARRYFORWARD, no
// source, LEGACY_CANONICAL_ONLY), Pedro Astacio as a known $0.00, and Adrian Beltre through one reviewed resolution of his existing $23,000 / $17,000
// 046 conflict (both reports stay ACTIVE); that known-cost signings move 56 -> 81 and unknown 164 -> 139 (+$5,932,000.00); that no other signing,
// report, outcome, WAR row, transaction, development row, benchmark or prediction output moves; and that 060 is idempotent, guarded, reproducible
// and exactly reversible (rollback retracts, never deletes; reapply reproduces the post-060 state).
//   OWNER-REVIEWED INPUT != EXTERNAL SOURCE   KNOWN ZERO != UNKNOWN   A RESOLUTION IS NOT A REPORT   UNKNOWN STAYS NULL

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'
import { measure } from '../../database/research/060/measure.mjs'
import { assemble, payloadFor } from '../../database/research/060/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '060_owner_reviewed_acquisition_costs.sql'
const sql060 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback060 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-060.sql'), 'utf8')
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'database/research/060/research-evidence.json'), 'utf8'))
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'database/research/060/baseline.json'), 'utf8'))
const ROWS = evidence.bonuses
const NORMAL = ROWS.filter((r) => r.treatment === 'OWNER_REVIEWED_LEDGER_FACT')
const NOTE = evidence.ledger_mapping.note
const ZERO_NOTE = evidence.ledger_mapping.known_zero_note
const BR = evidence.beltre_resolution
const key = (slug, year) => `${slug}|${year}`
const REVIEWED_SQL = ROWS.map((r) => `('${r.player_slug}', ${r.signing_year})`).join(', ')
const SNAP_DROP = ['generation_id', 'refreshed_at', 'created_at', 'generated_at', 'snapshot_at']
const FINANCE_TABLES = ['signings', 'signing_financial_reports', 'signing_financial_resolutions']

let chain
let pre060Dump
let post060Dump
let pre
let post
let preTables
let postTables
let preGen
let preVerify
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
const R = (x) => (Array.isArray(x) ? x : x.rows)
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const clone = async (dump) => {
  const db = new PGlite({ loadDataDir: dump, extensions: { pgcrypto } })
  return { db, query: async (s, p) => (await db.query(s, p)).rows, close: () => db.close() }
}
const failsWith = async (c, sql, pattern) => {
  try { await c.db.exec(sql) } catch (e) {
    await c.db.exec('rollback;').catch(() => {})
    assert.match(String(e.message), pattern)
    return
  }
  assert.fail(`expected the statement to fail with ${pattern}`)
}
const tableHashes = async (c = chain, drop = []) => {
  const tables = R(await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5(R(await c.query(`select (to_jsonb(t) - 'updated_at' ${drop.map((k) => `- '${k}'`).join(' ')})::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const generation = async (c = chain) => R(await c.query(`select max(generation_id)::int as g from public.product_executive_snapshot`))[0].g
const drift = async (c = chain) => R(await c.query(`select count(*)::int as n from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`))[0].n
const singleGeneration = async (c = chain) => {
  const tables = R(await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'product\\_%' order by 1`)).map((r) => r.relname)
  const gens = new Set()
  for (const t of tables) for (const r of R(await c.query(`select distinct generation_id::int as g from public.${t}`))) gens.add(r.g)
  return [...gens]
}
const verify = async (c = chain) => { const r = await checkInvariants(async (s, p) => R(await c.query(s, p)), CANONICAL_EXPECTATIONS); return { total: r.hard.length, failed: failedChecks(r).map((x) => x.name) } }
const costCounts = async (c = chain) => R(await c.query(`select count(*)::int as signings, count(total_known_acquisition_cost_usd)::int as known,
    (count(*) - count(total_known_acquisition_cost_usd))::int as unknown, coalesce(sum(total_known_acquisition_cost_usd), 0)::text as known_usd
  from public.v_signing_records where is_dodgers_franchise`))[0]
// a logical row image: surrogate ids, timestamps and lifecycle columns removed, so a reapply compares equal to the first apply
const logical = async (c, table, where = '', drop = ['id', 'created_at', 'updated_at', 'retracted_at']) =>
  R(await c.query(`select (to_jsonb(t) ${drop.map((k) => `- '${k}'`).join(' ')})::text as r from public.${table} t ${where}`)).map((r) => r.r).sort()
const bonusOf = async (c, slug, year) => R(await c.query(`select s.id, s.signing_bonus_usd::text as bonus, s.bonus_publicly_reported as reported, f.bonus_status, f.bonus_source_status,
    f.acquisition_cost_completeness as completeness, f.known_acquisition_cost_usd::text as known_cost, f.resolved_components
  from public.signings s join public.players p on p.id = s.player_id join public.organizations o on o.id = s.organization_id
  join public.v_signing_acquisition_financials f on f.signing_id = s.id
  where p.slug = $1 and s.signing_year = $2 and o.name = 'Los Angeles Dodgers'`, [slug, year]))
const reportsOf = async (c, slug, year) => R(await c.query(`select r.amount::text as amount, r.report_origin, r.source_id, r.amount_basis, r.evidence_basis, r.confidence::text as confidence,
    r.note, r.record_status, r.retraction_reason, so.url as source_url
  from public.signing_financial_reports r join public.signings s on s.id = r.signing_id join public.players p on p.id = s.player_id left join public.sources so on so.id = r.source_id
  where p.slug = $1 and s.signing_year = $2 and r.component_type = 'SIGNING_BONUS' order by r.record_status, r.amount`, [slug, year]))
const resolutionsOf = async (c, slug, year) => R(await c.query(`select d.basis, d.reviewed_by, d.reviewed_at, d.rationale, d.record_status, d.retraction_reason, r.amount::text as selected_amount, so.url as selected_url
  from public.signing_financial_resolutions d join public.signings s on s.id = d.signing_id join public.players p on p.id = s.player_id
  join public.signing_financial_reports r on r.id = d.selected_report_id left join public.sources so on so.id = r.source_id
  where p.slug = $1 and s.signing_year = $2 order by d.record_status`, [slug, year]))
const reviewedWhere = `where id in (select s.id from public.signings s join public.players p on p.id = s.player_id where (p.slug, s.signing_year) in (${REVIEWED_SQL}))`
const notReviewedWhere = `where id not in (select s.id from public.signings s join public.players p on p.id = s.player_id join public.organizations o on o.id = s.organization_id
  where o.name = 'Los Angeles Dodgers' and (p.slug, s.signing_year) in (${REVIEWED_SQL}))`
const not060Reports = `where note is null or note not in ('${NOTE.replace(/'/g, "''")}', '${ZERO_NOTE.replace(/'/g, "''")}')`

before(async () => {
  chain = await buildChainThrough('059_career_bwar_metric_reconciliation.sql')
  pre060Dump = await chain.db.dumpDataDir('none')
  pre = await measure(q)
  preTables = await tableHashes(chain, SNAP_DROP)
  preGen = await generation()
  preVerify = await verify()
  await chain.db.exec(sql060)
  post = await measure(q)
  postTables = await tableHashes(chain, SNAP_DROP)
  post060Dump = await chain.db.dumpDataDir('none')
}, { timeout: 1200000 })

after(async () => { await chain?.close() })

test('060 follows 059 in the manifest (061 follows it), is frozen at its released hash; the migration and rollback are the deterministic build output', () => {
  const i = manifest.canonical_sql.indexOf(FILE)
  assert.equal(manifest.canonical_sql[i - 1], '059_career_bwar_metric_reconciliation.sql')
  assert.equal(manifest.canonical_sql[i + 1], '061_transaction_research_closure.sql')
  assert.equal(manifest.notes.canonical_build_count, manifest.canonical_sql.length)
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  assert.equal(frozen[FILE], crypto.createHash('sha1').update(sql060.replace(/\r\n/g, '\n')).digest('hex'))
  assert.equal(frozen[FILE], '19a63a45ce75ab17e01154259035e52a932dbd7e')
  assert.equal(crypto.createHash('sha256').update(sql060).digest('hex'), '525afef8fb91cc059ca2f338faaf9e6d37c89c0bc6d0f302c7dfa01ebf10db30')
  assert.equal(crypto.createHash('sha256').update(rollback060).digest('hex'), '1bd46dcfcb003375a1edb2f0e3587c55614bfcdc75e368d755078a9c94b951b8')
  assert.match(sql060, /^-- DISI v0\.45\n-- 060_owner_reviewed_acquisition_costs\.sql\n/)
  assert.match(rollback060, /^-- DISI rollback of Migration 060/)
  const built = assemble()
  assert.equal(built.migration, sql060, 'the migration is the build output of the reviewed input')
  assert.equal(built.rollback, rollback060, 'the rollback is the build output of the same input')
  assert.equal(assemble().migration, built.migration, 'the build is deterministic')
})

test('frozen history 001-060 is byte-for-byte unchanged (line endings normalised)', () => {
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  for (const [f, sha1] of Object.entries(frozen)) {
    assert.equal(crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', f), 'utf8').replace(/\r\n/g, '\n')).digest('hex'), sha1, f)
  }
  assert.equal(frozen['059_career_bwar_metric_reconciliation.sql'], 'e6f70db245fe407dff603f351a4b488a476d716a')
  assert.equal(frozen['060_owner_reviewed_acquisition_costs.sql'], '19a63a45ce75ab17e01154259035e52a932dbd7e')
})

test('baseline: 060 was written against exactly this 059 state (220 / 56 known / 164 unknown, the reviewed ledger, no resolution, no zero)', () => {
  for (const k of ['cost_counts', 'all_zero_bonuses', 'ledger', 'resolutions', 'reviewed', 'missing_cost']) assert.deepEqual(pre[k], baseline[k], k)
  // the fingerprints carry surrogate ids, so they are compared within one database (pre vs post), never across builds
  assert.deepEqual([pre.fingerprints.reports_060, pre.fingerprints.resolutions_060], [baseline.fingerprints.reports_060, baseline.fingerprints.resolutions_060])
  assert.deepEqual([pre.cost_counts.signings, pre.cost_counts.known, pre.cost_counts.unknown, pre.cost_counts.known_usd], [220, 56, 164, '121700237.33'])
  assert.equal(preGen, 14)
  assert.deepEqual(preVerify, { total: 259, failed: [] })
  for (const r of ROWS) {
    const b = pre.reviewed.filter((x) => x.slug === r.player_slug && x.signing_year === r.signing_year)
    assert.equal(b.length, 1, `${r.player_slug} resolves to exactly one Dodgers signing`)
    assert.equal(b[0].signing_bonus_usd, null)
    assert.equal(b[0].bonus_publicly_reported, false)
    assert.equal(b[0].bonus_reports.length, r.treatment === 'RESOLVE_EXISTING_CONFLICT' ? 2 : 0)
  }
})

test('the reviewed input: exactly 25 distinct signings totalling $5,932,000.00, 24 ledger facts, one Beltre resolution, one known zero', () => {
  assert.equal(ROWS.length, 25)
  assert.equal(new Set(ROWS.map((r) => key(r.player_slug, r.signing_year))).size, 25)
  const cents = ROWS.reduce((s, r) => s + Math.round(Number(r.signing_bonus_usd) * 100), 0)
  assert.equal(cents, 593200000)
  assert.equal(NORMAL.length, 24)
  assert.deepEqual(ROWS.filter((r) => r.treatment === 'RESOLVE_EXISTING_CONFLICT').map((r) => key(r.player_slug, r.signing_year)), ['adrian-beltre|1994'])
  assert.deepEqual(ROWS.filter((r) => r.known_zero).map((r) => key(r.player_slug, r.signing_year)), ['pedro-astacio|1987'])
  assert.equal(evidence.reviewed_input.basis, 'OWNER_REVIEWED_INPUT')
  assert.equal(evidence.ledger_mapping.report_origin, 'LEGACY_CARRYFORWARD')
  assert.equal(payloadFor(evidence, baseline).total_usd, '5932000.00')
})

test('the build refuses a malformed or no-longer-applicable input', () => {
  const ev = () => structuredClone(evidence)
  const bl = () => structuredClone(baseline)
  const refuses = (e, b, pattern) => assert.throws(() => payloadFor(e, b), pattern)
  let e = ev(); e.bonuses.push(structuredClone(e.bonuses[1])); refuses(e, bl(), /exactly 25/)
  e = ev(); e.bonuses[2] = { ...e.bonuses[1] }; refuses(e, bl(), /duplicate/)
  e = ev(); e.bonuses.pop(); refuses(e, bl(), /exactly 25/)
  e = ev(); e.bonuses[1].signing_bonus_usd = '-1.00'; refuses(e, bl(), /non-negative|never negative/)
  e = ev(); e.bonuses[1].signing_bonus_usd = '75001.00'; refuses(e, bl(), /total/)
  e = ev(); e.bonuses[1].player_slug = 'not-a-dodgers-player'; refuses(e, bl(), /exactly one Dodgers signing/)
  e = ev(); delete e.bonuses.find((r) => r.known_zero).known_zero; refuses(e, bl(), /known_zero/)
  let b = bl(); b.reviewed.find((r) => r.slug === 'carlos-santana').signing_bonus_usd = '75000.00'; refuses(ev(), b, /unexpected existing canonical value/)
  b = bl(); b.reviewed.find((r) => r.slug === 'carlos-santana').bonus_reports.push({ amount: '1.00', status: 'ACTIVE' }); refuses(ev(), b, /unexpected existing financial report/)
  b = bl(); b.reviewed.find((r) => r.slug === 'adrian-beltre').active_resolutions = 1; refuses(ev(), b, /resolution already exists/)
  b = bl(); b.resolutions.push({ slug: 'adrian-beltre' }); refuses(ev(), b, /second Beltre resolution/)
  b = bl(); b.cost_counts.known = 57; refuses(ev(), b, /56 known/)
  e = ev(); e.ledger_mapping.report_origin = 'EXTERNAL_SOURCE'; refuses(e, bl(), /unsourced-canonical/)
})

test('the 24 owner-reviewed bonuses: one unsourced LEGACY_CARRYFORWARD report each, canonical, LEGACY_CANONICAL_ONLY, public-report flag unchanged', async () => {
  for (const r of NORMAL) {
    const [b] = await bonusOf(chain, r.player_slug, r.signing_year)
    assert.deepEqual([b.bonus, b.reported, b.bonus_status, b.bonus_source_status, b.completeness, b.known_cost],
      [r.signing_bonus_usd, false, 'KNOWN', 'LEGACY_CANONICAL_ONLY', 'COMPLETE', r.signing_bonus_usd], r.player_slug)
    const reps = await reportsOf(chain, r.player_slug, r.signing_year)
    assert.deepEqual(reps, [{ amount: r.signing_bonus_usd, report_origin: 'LEGACY_CARRYFORWARD', source_id: null, amount_basis: null, evidence_basis: 'LEGACY_CANONICAL_VALUE',
      confidence: 'UNVERIFIED', note: r.known_zero ? ZERO_NOTE : NOTE, record_status: 'ACTIVE', retraction_reason: null, source_url: null }], r.player_slug)
    assert.equal((await resolutionsOf(chain, r.player_slug, r.signing_year)).length, 0)
  }
  // no source, URL or publisher was created for them
  assert.equal(postTables.sources, preTables.sources)
  assert.equal(postTables.evidence, preTables.evidence)
  assert.equal(post.fingerprints.reports_060, 24)
})

test('Beltre: no new report; both 046 reports stay ACTIVE; one reviewed resolution selects the existing $23,000 report; CONFLICT -> RESOLVED', async () => {
  const before = await clone(pre060Dump)
  try {
    assert.deepEqual(await reportsOf(chain, 'adrian-beltre', 1994), await reportsOf(before, 'adrian-beltre', 1994), 'the two 046 reports are byte-identical')
    const [was] = await bonusOf(before, 'adrian-beltre', 1994)
    assert.deepEqual([was.bonus, was.bonus_status, was.resolved_components], [null, 'CONFLICT', []])
  } finally { await before.close() }
  const reps = await reportsOf(chain, 'adrian-beltre', 1994)
  assert.deepEqual(reps.map((x) => [x.amount, x.record_status, x.report_origin, x.source_url]), [
    ['17000.00', 'ACTIVE', 'EXTERNAL_SOURCE', BR.competing_report.source_url], ['23000.00', 'ACTIVE', 'EXTERNAL_SOURCE', BR.selected_report.source_url]])
  const res = await resolutionsOf(chain, 'adrian-beltre', 1994)
  assert.equal(res.length, 1)
  assert.deepEqual([res[0].basis, res[0].reviewed_by, new Date(res[0].reviewed_at).toISOString(), res[0].rationale, res[0].record_status, res[0].selected_amount, res[0].selected_url],
    ['OTHER_REVIEWED', 'Sean Cannon', '2026-11-04T00:00:00.000Z', BR.rationale, 'ACTIVE', '23000.00', BR.selected_report.source_url])
  const [b] = await bonusOf(chain, 'adrian-beltre', 1994)
  assert.deepEqual([b.bonus, b.reported, b.bonus_status, b.bonus_source_status, b.resolved_components], ['23000.00', false, 'KNOWN', 'EXTERNALLY_SOURCED', ['SIGNING_BONUS']])
})

test('Pedro Astacio is a KNOWN $0.00, not an unknown; it is the only zero, and no ratio divides by it', async () => {
  const [b] = await bonusOf(chain, 'pedro-astacio', 1987)
  assert.deepEqual([b.bonus, b.bonus_status, b.completeness, b.known_cost], ['0.00', 'KNOWN', 'COMPLETE', '0.00'])
  assert.deepEqual(pre.all_zero_bonuses, [])
  assert.deepEqual(post.all_zero_bonuses, [{ slug: 'pedro-astacio', signing_year: 1987 }])
  assert.equal((await one(`select count(*)::int as n from public.signing_financial_reports where amount = 0`)).n, 1)
  assert.equal((await one(`select count(*)::int as n from public.v_signing_records where total_known_acquisition_cost_usd = 0`)).n, 1)
  const v = await one(`select known_acquisition_cost_usd::text as cost, realized_org_bwar_per_million_usd, ratio_suppression_reason
    from public.v_player_realized_organizational_value where player_slug = 'pedro-astacio'`)
  assert.deepEqual([v.cost, v.realized_org_bwar_per_million_usd, v.ratio_suppression_reason], ['0.00', null, 'ZERO_OR_UNKNOWN_COST'])
  assert.ok(!post.missing_cost.some((m) => m.player_slug === 'pedro-astacio'), 'a known zero is not a missing cost')
})

test('cost counts: known 56 -> 81, unknown 164 -> 139, +$5,932,000.00; exactly the 25 leave the missing-cost list and none enters it', () => {
  assert.deepEqual([post.cost_counts.signings, post.cost_counts.known, post.cost_counts.unknown], [220, 81, 139])
  assert.equal(Math.round(Number(post.cost_counts.known_usd) * 100) - Math.round(Number(pre.cost_counts.known_usd) * 100), 593200000)
  assert.equal(post.cost_counts.known_usd, '127632237.33')
  const k = (m) => key(m.player_slug, m.signing_year)
  const left = pre.missing_cost.map(k).filter((x) => !post.missing_cost.map(k).includes(x)).sort()
  assert.deepEqual(left, ROWS.map((r) => key(r.player_slug, r.signing_year)).sort())
  assert.deepEqual(post.missing_cost.map(k).filter((x) => !pre.missing_cost.map(k).includes(x)), [])
  assert.equal(post.counts.known_costs, 81)
})

test('nothing outside the 25 moved: every other signing, ledger row, resolution and environment fact; only the finance tables and the snapshots changed', async () => {
  const before = await clone(pre060Dump)
  try {
    assert.deepEqual(await logical(chain, 'signings', notReviewedWhere, []), await logical(before, 'signings', notReviewedWhere, []), 'every unreviewed signing is byte-identical')
    assert.deepEqual(await logical(chain, 'signing_financial_reports', not060Reports, []), await logical(before, 'signing_financial_reports', not060Reports, []))
    assert.deepEqual(await logical(chain, 'signing_environment_financial_reports', '', []), await logical(before, 'signing_environment_financial_reports', '', []))
    // the reviewed signings changed only in signing_bonus_usd
    const drop = ['signing_bonus_usd', 'total_known_acquisition_cost_usd', 'updated_at']
    assert.deepEqual(await logical(chain, 'signings', reviewedWhere, drop), await logical(before, 'signings', reviewedWhere, drop))
  } finally { await before.close() }
  for (const k of ['other_signings', 'other_reports', 'environment_reports', 'other_resolutions']) assert.equal(post.fingerprints[k], pre.fingerprints[k], k)
  const moved = Object.keys(preTables).filter((t) => preTables[t] !== postTables[t]).filter((t) => !t.startsWith('product_'))
  assert.deepEqual(moved.sort(), FINANCE_TABLES.slice().sort())
  // no unreviewed signing gained a bonus and no unknown became zero
  assert.equal(post.cost_counts.zero_bonuses, 1)
})

test('isolation: outcomes, WAR, transactions, development, benchmarks, support, evaluations and every prediction output are unchanged; the cost-driven views move only in cost columns', async () => {
  for (const t of ['outcomes', 'outcome_audits', 'player_mlb_team_season_war', 'player_metric_observations', 'transactions', 'transaction_events', 'transaction_event_assets',
    'transaction_asset_resolutions', 'player_season_stints', 'development_milestones', 'player_career_transactions', 'signing_populations', 'signing_population_members',
    'outcome_targets', 'outcome_model_evaluations', 'players', 'sources']) {
    assert.ok(t in preTables, `${t} exists`)
    assert.equal(postTables[t], preTables[t], t)
  }
  for (const k of ['outcomes', 'team_season_war', 'sources', 'training_population', 'support', 'evaluation_view', 'probabilities', 'expected_values', 'lineage', 'transaction_queue']) {
    assert.equal(post.isolation[k], pre.isolation[k], k)
  }
  for (const k of ['support', 'evaluation', 'probabilities', 'probability_reasons', 'expected_value', 'benchmark_classes', 'benchmark_queue', 'benchmark_labels', 'war', 'scoped_labels',
    'readiness', 'lineage', 'value_totals', 'transaction_queue', 'metric', 'bwar_missing', 'intervals', 'edges', 'war_not_loaded']) {
    assert.deepEqual(post[k], pre[k], k)
  }
  const { feature_matrix: f0, ...p0 } = pre.prediction
  const { feature_matrix: f1, ...p1 } = post.prediction
  assert.deepEqual(p1, p0, 'every prediction output (0 / 0 / 0 / 0 / 0) and the evaluation fingerprints are unchanged')
  assert.deepEqual([post.prediction.supported_models, post.prediction.probabilities, post.prediction.expected_values, post.prediction.recommendations, post.prediction.supported_targets], [0, 0, 0, 0, 0])
  // the feature matrix carries the signing bonus as a feature column: exactly the 25 rows move, in the bonus columns only
  const before = await clone(pre060Dump)
  try {
    const rows = async (c) => new Map(R(await c.query(`select player_id::text as id, to_jsonb(t) as j from public.v_outcome_feature_matrix t`)).map((r) => [r.id, r.j]))
    const a = await rows(before), b = await rows(chain)
    const cols = new Set(); let n = 0
    for (const [id, x] of a) { let d = false; for (const c of Object.keys(x)) if (JSON.stringify(x[c]) !== JSON.stringify(b.get(id)[c])) { cols.add(c); d = true } n += d ? 1 : 0 }
    assert.equal(n, 25)
    assert.deepEqual([...cols].sort(), ['cost_band', 'has_bonus', 'signing_bonus_usd'])
  } finally { await before.close() }
  // the research queues: ACQUISITION_COST_UNKNOWN (Dodgers) 164 -> 139, value-queue ACQUISITION_COST_INCOMPLETE 28 -> 17; nothing else
  const task = (m, dodgers) => m.tasks.find((t) => t.task_type === 'ACQUISITION_COST_UNKNOWN' && t.dodgers === dodgers).items
  assert.deepEqual([task(pre, true), task(post, true)], [164, 139])
  assert.deepEqual(post.tasks.filter((t) => t.task_type !== 'ACQUISITION_COST_UNKNOWN'), pre.tasks.filter((t) => t.task_type !== 'ACQUISITION_COST_UNKNOWN'))
  const vq = (m, issue) => m.value_queue.find((x) => x.issue === issue)?.items
  assert.deepEqual([vq(pre, 'ACQUISITION_COST_INCOMPLETE'), vq(post, 'ACQUISITION_COST_INCOMPLETE')], [28, 17])
  assert.deepEqual(post.value_queue.filter((x) => x.issue !== 'ACQUISITION_COST_INCOMPLETE'), pre.value_queue.filter((x) => x.issue !== 'ACQUISITION_COST_INCOMPLETE'))
  assert.deepEqual([pre.counts.open_research_tasks, post.counts.open_research_tasks], [349, 324])
})

test('one snapshot refresh: generation 14 -> 15 on every product table, drift 0; the verifier stays 259/259 with no pin moved', async () => {
  assert.equal(await generation(), preGen + 1)
  assert.deepEqual(await singleGeneration(), [preGen + 1])
  assert.equal(await drift(), 0)
  assert.deepEqual(await verify(), { total: 259, failed: [] })
})

test('rerun is a no-op: no report, resolution or refresh, every row identical', async () => {
  const c = await clone(post060Dump)
  try {
    const h0 = await tableHashes(c)
    await c.db.exec(sql060)
    assert.deepEqual(await tableHashes(c), h0)
    assert.equal(await generation(c), preGen + 1)
  } finally { await c.close() }
})

test('guards: 060 refuses a partial state, a different existing report, a different canonical value and a second Beltre resolution, and the refusal changes nothing', async () => {
  const cases = [
    ['partial', post060Dump, `update public.signing_financial_reports set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'test'
       where note = '${NOTE.replace(/'/g, "''")}' and amount = 10000.00 and signing_id = (select s.id from public.signings s join public.players p on p.id = s.player_id where p.slug = 'kelvin-ramirez');
     update public.signings set signing_bonus_usd = null where player_id = (select id from public.players where slug = 'kelvin-ramirez');`, /partial state|canonical bonus that is not the reviewed one/],
    ['different report', pre060Dump, `insert into public.signing_financial_reports (signing_id, component_type, amount, currency_code, report_origin, evidence_basis, confidence, note)
       select s.id, 'SIGNING_BONUS', 1.00, 'USD', 'LEGACY_CARRYFORWARD', 'LEGACY_CANONICAL_VALUE', 'UNVERIFIED', 'test' from public.signings s join public.players p on p.id = s.player_id
       where p.slug = 'carlos-santana';`, /different active bonus report/],
    ['different canonical value', pre060Dump, `update public.signings set signing_bonus_usd = 76000 where player_id = (select id from public.players where slug = 'carlos-santana');`,
      /canonical bonus that is not the reviewed one/],
    ['second Beltre resolution', pre060Dump, `insert into public.signing_financial_resolutions (signing_id, component_type, selected_report_id, basis, rationale, reviewed_by, reviewed_at)
       select r.signing_id, 'SIGNING_BONUS', r.id, 'OTHER_REVIEWED', 'test', 'test', now() from public.signing_financial_reports r join public.signings s on s.id = r.signing_id
       join public.players p on p.id = s.player_id where p.slug = 'adrian-beltre' and r.amount = 17000;`, /different financial resolution/],
  ].map(([name, dump, setup, pattern]) => ({ name: String(name), dump: /** @type {Blob} */ (dump), setup: String(setup), pattern: /** @type {RegExp} */ (pattern) }))
  for (const { name, dump, setup, pattern } of cases) {
    const c = await clone(dump)
    try {
      await c.db.exec(setup)
      const h0 = await tableHashes(c)
      await failsWith(c, sql060, pattern)
      assert.deepEqual(await tableHashes(c), h0, `${name}: the refusal changes nothing`)
    } finally { await c.close() }
  }
})

test('rollback: retracts the 24 reports and the resolution (never deletes), restores the 25 bonuses to NULL and Beltre to CONFLICT, refreshes once; again it refuses', async () => {
  const c = await clone(post060Dump)
  const p = await clone(pre060Dump)
  try {
    await c.db.exec(rollback060)
    assert.deepEqual(await costCounts(c), { signings: 220, known: 56, unknown: 164, known_usd: '121700237.33' })
    assert.deepEqual(await logical(c, 'signings', '', ['updated_at']), await logical(p, 'signings', '', ['updated_at']), 'every signing is back to its pre-060 row')
    assert.deepEqual(await logical(c, 'signing_financial_reports', not060Reports, []), await logical(p, 'signing_financial_reports', not060Reports, []), 'every pre-existing report is untouched')
    const r060 = R(await c.query(`select record_status, retraction_reason from public.signing_financial_reports ${not060Reports.replace('where note is null or note not in', 'where note in')}`))
    assert.equal(r060.length, 24)
    assert.ok(r060.every((x) => x.record_status === 'RETRACTED' && x.retraction_reason === 'Migration 060 rolled back.'))
    const res = await resolutionsOf(c, 'adrian-beltre', 1994)
    assert.deepEqual(res.map((x) => [x.record_status, x.retraction_reason]), [['RETRACTED', 'Migration 060 rolled back.']])
    const [b] = await bonusOf(c, 'adrian-beltre', 1994)
    assert.deepEqual([b.bonus, b.bonus_status], [null, 'CONFLICT'])
    assert.deepEqual((await reportsOf(c, 'adrian-beltre', 1994)).map((x) => [x.amount, x.record_status]), [['17000.00', 'ACTIVE'], ['23000.00', 'ACTIVE']])
    assert.equal(await generation(c), preGen + 2)
    assert.deepEqual(await singleGeneration(c), [preGen + 2])
    assert.equal(await drift(c), 0)
    const m = await measure(c.query)
    for (const k of ['cost_counts', 'all_zero_bonuses', 'missing_cost', 'tasks', 'value_queue', 'executive', 'prediction', 'isolation', 'value_totals', 'war', 'support', 'evaluation']) assert.deepEqual(m[k], pre[k], k)
    assert.deepEqual(m.reviewed.map((r) => [r.slug, r.signing_bonus_usd, r.bonus_status]), pre.reviewed.map((r) => [r.slug, r.signing_bonus_usd, r.bonus_status]))
    assert.deepEqual(await verify(c), { total: 259, failed: [] })
    const h0 = await tableHashes(c)
    await failsWith(c, rollback060, /Migration 060 is not applied/)
    assert.deepEqual(await tableHashes(c), h0)
  } finally { await c.close(); await p.close() }
})

test('rollback guards: a later bonus report or resolution for a reviewed signing makes rollback refuse, without changing anything', async () => {
  const cases = [
    ['later report', `insert into public.signing_financial_reports (signing_id, component_type, amount, currency_code, amount_basis, report_origin, source_id, evidence_basis, confidence, retrieved_at, note)
       select s.id, 'SIGNING_BONUS', 75000.00, 'USD', 'EXACT', 'EXTERNAL_SOURCE', (select id from public.sources order by id limit 1), 'NEWS_REPORT', 'MEDIUM', now(), 'test'
       from public.signings s join public.players p on p.id = s.player_id where p.slug = 'carlos-santana';`, /later bonus report or resolution/],
    ['later resolution', `insert into public.signing_financial_reports (signing_id, component_type, amount, currency_code, amount_basis, report_origin, source_id, evidence_basis, confidence, retrieved_at, note)
       select s.id, 'SIGNING_BONUS', 80000.00, 'USD', 'EXACT', 'EXTERNAL_SOURCE', (select id from public.sources order by id limit 1), 'NEWS_REPORT', 'MEDIUM', now(), 'test'
       from public.signings s join public.players p on p.id = s.player_id where p.slug = 'carlos-santana';
     insert into public.signing_financial_resolutions (signing_id, component_type, selected_report_id, basis, rationale, reviewed_by, reviewed_at)
       select r.signing_id, 'SIGNING_BONUS', r.id, 'OTHER_REVIEWED', 'test', 'test', now() from public.signing_financial_reports r where r.note = 'test' and r.amount = 80000.00;
     update public.signings set signing_bonus_usd = 80000.00 where player_id = (select id from public.players where slug = 'carlos-santana');`, /no longer carries the 060 bonus|later/],
  ].map(([name, setup, pattern]) => ({ name: String(name), setup: String(setup), pattern: /** @type {RegExp} */ (pattern) }))
  for (const { name, setup, pattern } of cases) {
    const c = await clone(post060Dump)
    try {
      await c.db.exec(setup)
      const h0 = await tableHashes(c)
      await failsWith(c, rollback060, pattern)
      assert.deepEqual(await tableHashes(c), h0, `${name}: the refusal changes nothing`)
    } finally { await c.close() }
  }
})

test('reapply after rollback reproduces the logical post-060 state (new ACTIVE rows; the retracted ones stay as history); one refresh; rerun is a no-op', async () => {
  const c = await clone(post060Dump)
  const a = await clone(post060Dump)
  try {
    await c.db.exec(rollback060)
    await c.db.exec(sql060)
    assert.equal(await generation(c), preGen + 3)
    assert.equal(await drift(c), 0)
    assert.deepEqual(await logical(c, 'signings', '', ['updated_at']), await logical(a, 'signings', '', ['updated_at']))
    const active = `where record_status = 'ACTIVE'`
    assert.deepEqual(await logical(c, 'signing_financial_reports', active), await logical(a, 'signing_financial_reports', active))
    assert.deepEqual(await logical(c, 'signing_financial_resolutions', active), await logical(a, 'signing_financial_resolutions', active))
    assert.equal(R(await c.query(`select count(*)::int as n from public.signing_financial_reports where retraction_reason = 'Migration 060 rolled back.'`))[0].n, 24)
    const m = await measure(c.query)
    for (const k of ['cost_counts', 'all_zero_bonuses', 'missing_cost', 'tasks', 'value_queue', 'executive', 'prediction', 'isolation', 'value_totals']) assert.deepEqual(m[k], post[k], k)
    assert.deepEqual(m.resolutions.filter((x) => x.record_status === 'ACTIVE'), post.resolutions, 'the ACTIVE resolution is reproduced; the retracted one stays as history')
    assert.deepEqual(m.reviewed.map((r) => ({ ...r, bonus_reports: r.bonus_reports.filter((x) => x.status === 'ACTIVE') })),
      post.reviewed.map((r) => ({ ...r, bonus_reports: r.bonus_reports.filter((x) => x.status === 'ACTIVE') })))
    assert.deepEqual(await verify(c), { total: 259, failed: [] })
    const h0 = await tableHashes(c)
    await c.db.exec(sql060)
    assert.deepEqual(await tableHashes(c), h0, 'a rerun after the reapply changes nothing')
  } finally { await c.close(); await a.close() }
})
