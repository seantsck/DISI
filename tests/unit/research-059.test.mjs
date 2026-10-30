// Migration 059 research artifacts, without a database: the eleven reviewed benchmark players, their ledger sums and one-decimal values, the pinned
// live data files (no source added), the excluded 057 eleven, the reviewed BWAR_MISSING movement, and the shape of the generated SQL (data only, no
// schema or trigger change, the 032 derived pattern).
//   CAREER_BWAR = CAREER-TO-DATE AS OF A DATE   OUTCOME CAREER_WAR FIELD != CAREER_BWAR METRIC   CAREER_BWAR != TRANSACTION RETURN VALUE INPUT

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { research, payload, assemble, assembleRollback, notesFor, evidence } from '../../database/research/059/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))
const scope = research.scope
const strip = (sql, tag) => sql.replace(new RegExp(`\\$${tag}\\$[\\s\\S]*?\\$${tag}\\$`, 'g'), '').replace(/'(?:[^']|'')*'/g, "''").replace(/--.*$/gm, '')
const tenths = (x) => Math.round(Number(x) * 100)

test('scope: exactly the eleven reviewed benchmark players with their MLBAM and Baseball-Reference ids', () => {
  assert.deepEqual(scope.players.map((p) => [p.slug, p.mlb_id, p.bref_id]), [
    ['rafael-devers', '646240', 'deverra01'], ['gleyber-torres', '650402', 'torregl01'], ['eloy-jimenez', '650391', 'jimenel02'], ['huascar-ynoa', '660623', 'ynoahu01'],
    ['marcos-diplan', '650959', 'diplama01'], ['dermis-garcia', '660650', 'garcide02'], ['lewin-diaz', '650331', 'diazle01'], ['anderson-espinoza', '659262', 'espinan01'],
    ['hyo-jun-park', '660829', 'parkho01'], ['jose-herrera', '645444', 'herrejo04'], ['diego-castillo', '660636', 'castidi02']])
  assert.deepEqual(scope.excluded_057.map((p) => p.slug).sort(), ['andres-gimenez', 'cristian-pache', 'emmanuel-dejesus', 'fernando-tatis-jr', 'gilberto-celestino',
    'juan-soto', 'leody-taveras', 'miguel-amaya', 'rafael-marchan', 'simon-muzziotti', 'vladimir-guerrero-jr'])
  assert.ok(!scope.players.some((p) => scope.excluded_057.some((x) => x.slug === p.slug)), 'no 057 player is in scope')
  assert.equal(scope.semantics.meaning, 'CAREER_TO_DATE_AS_OF')
})

test('values: BAT + PITCH = raw, rounded to one decimal as PostgreSQL rounds numeric (half away from zero), negatives kept', () => {
  const expected = { 'rafael-devers': '30.6', 'gleyber-torres': '20.9', 'eloy-jimenez': '5.2', 'huascar-ynoa': '1.1', 'marcos-diplan': '0.4', 'dermis-garcia': '0.5',
    'lewin-diaz': '0.1', 'anderson-espinoza': '0.0', 'hyo-jun-park': '-0.6', 'jose-herrera': '-0.7', 'diego-castillo': '-0.8' }
  for (const p of scope.players) {
    assert.equal(tenths(p.bat_bwar) + tenths(p.pitch_bwar), tenths(p.raw_bwar), `${p.slug}: BAT + PITCH`)
    const h = tenths(p.raw_bwar), r = Math.sign(h) * Math.round(Math.abs(h) / 10) / 10
    assert.equal(r + 0, Number(expected[p.slug]), `${p.slug}: rounded`)
    assert.equal(p.career_bwar, expected[p.slug])
    assert.equal(p.rows, p.bat_rows + p.pitch_rows)
  }
  // the baseline (canonical replay) reproduces every reviewed number, and outcomes.career_war equals the raw sum
  for (const e of evidence().players) {
    const p = scope.players.find((x) => x.slug === e.slug)
    assert.deepEqual([Number(e.bat_bwar), Number(e.pitch_bwar), Number(e.raw_bwar), Number(e.career_bwar), Number(e.outcome_career_war)],
      [Number(p.bat_bwar), Number(p.pitch_bwar), Number(p.raw_bwar), Number(p.career_bwar), Number(p.raw_bwar)], e.slug)
    assert.equal(e.ledger_as_of, '2026-09-28/2026')
  }
})

test('provenance: the live batting and pitching data files pinned by 032 / 035 (same hashes), the batting file cited, both named in every note', () => {
  const c032 = read('database/research/032/scope-config.json'), c035 = read('database/research/035/scope-config.json')
  for (const f of scope.sources.files) {
    const k = f.component === 'BAT' ? 'bat' : 'pitch'
    assert.deepEqual([c032.files[k].url, c032.files[k].sha256, c032.files[k].rows], [f.url, f.sha256, f.rows])
    assert.deepEqual([c035.files[k].url, c035.files[k].sha256], [f.url, f.sha256])
  }
  assert.equal(c032.file_last_modified, scope.semantics.observed_through_date)
  assert.equal(scope.sources.metric_source_url, 'https://www.baseball-reference.com/data/war_daily_bat.txt')
  assert.match(scope.sources.metric_source_url, /^https?:\/\/(www\.)?baseball-reference\.com\//, 'the CAREER_BWAR provider rule accepts the cited source')
  for (const p of payload.players) {
    assert.equal(p.notes, notesFor(p))
    for (const f of scope.sources.files) { assert.ok(p.notes.includes(f.url)); assert.ok(p.notes.includes(f.sha256)) }
    assert.match(p.notes, /rounded to one decimal; career-to-date through the 2026 season \(data files of 2026-09-28\)/)
  }
  assert.deepEqual([payload.semantics.observed_through_date, payload.semantics.observed_through_season], ['2026-09-28', 2026])
})

test('effect: CAREER_BWAR 47 -> 58, BWAR_MISSING 50 -> 39 (eleven benchmark signings leave), sources 3384 unchanged', () => {
  assert.deepEqual(scope.reviewed_effect, { career_bwar_observations: [47, 58], bwar_missing: [50, 39], sources: [3384, 3384], team_season_war_active: [2025, 2025], generation_delta: 1 })
  assert.equal(payload.baseline.bwar_missing_before.length, 50)
  assert.equal(payload.baseline.bwar_missing_after.length, 39)
  assert.deepEqual(payload.baseline.bwar_missing_before.filter((s) => !payload.baseline.bwar_missing_after.includes(s)).sort(), scope.players.map((p) => p.slug).sort())
  const e = evidence().bwar_missing
  assert.deepEqual([e.remaining_with_team_season_war, e.remaining_without_team_season_war], [11, 28], 'what remains: the 057 eleven and 28 players with no team-season WAR')
})

test('SQL shape: data only (no DDL outside temporary objects, no trigger, grant, source or team-season write); one insert, one guarded delete', () => {
  const mig = strip(assemble(), 'm059'), rb = strip(assembleRollback(), 'r059')
  for (const body of [mig, rb]) {
    const ddl = body.replace(/create temporary (table|view) _[mr]059\w*/g, '')
    assert.doesNotMatch(ddl, /\b(create|alter|drop)\s+(table|view|function|trigger|policy|index|schema)\b/i)
    assert.doesNotMatch(body, /\b(grant|revoke)\s/i)
    assert.doesNotMatch(body, /(insert into|update|delete from)\s+public\.(sources|player_mlb_team_season_war|outcomes|players|signings|bref_team_code_map)\b/i)
    assert.doesNotMatch(body, /web\.archive\.org/)
  }
  assert.equal((mig.match(/insert into public\./gi) ?? []).length, 1)
  assert.match(mig, /insert into public\.player_metric_observations/)
  assert.match(mig, /round\(sum\(w\.war\), 1\)/, 'the value is derived from the ledger, never a literal')
  assert.equal((rb.match(/delete from public\./gi) ?? []).length, 1)
  assert.match(rb, /delete from public\.player_metric_observations m where m\.id in \(select e\.id from _r059_exact e\)/)
  assert.doesNotMatch(mig + rb, /\bupdate public\./i)
  assert.equal((mig.match(/disi_refresh_product_snapshots/g) ?? []).length, 1)
  assert.equal((rb.match(/disi_refresh_product_snapshots/g) ?? []).length, 1)
})

test('v3 architecture: the transaction holds no whole-database hash pass and no unrelated view fingerprint; it keeps SET LOCAL and reports its phases', () => {
  const mig = strip(assemble(), 'm059'), rb = strip(assembleRollback(), 'r059')
  for (const body of [mig, rb]) {
    assert.doesNotMatch(body, /execute format\('select md5/)
    assert.doesNotMatch(body, /_[mr]059_(tables|untouched)\b/)
    assert.doesNotMatch(body, /public\.v_(outcome_target_support|outcome_training_population|outcome_feature_matrix|outcome_model_evaluation|player_outcome_probability|expected_value_support|player_realized_outcome|player_realized_organizational_value|transaction_asset_lineage|transaction_research_queue|value_research_queue|executive_overview)\b/)
    for (const m of body.matchAll(/from pg_class c where ([\s\S]*?) loop/g)) assert.match(m[1], /like ''/, 'the only pg_class loop is the product_* generation check')
    assert.match(body, /^begin;\nset local statement_timeout = ''/m)
    assert.match(body, /raise notice ''/)
  }
  assert.equal((assemble().match(/raise notice '059 phase /g) ?? []).length, 4)
  assert.equal((assembleRollback().match(/raise notice 'rollback-059 phase /g) ?? []).length, 4)
})

test('build: the committed migration, rollback and evidence equal the build output', () => {
  assert.equal(fs.readFileSync(path.join(root, 'database/sql/059_career_bwar_metric_reconciliation.sql'), 'utf8'), assemble())
  assert.equal(fs.readFileSync(path.join(root, 'database/release/sql/rollback-059.sql'), 'utf8'), assembleRollback())
  assert.deepEqual(read('database/research/059/career-bwar-evidence.json'), evidence())
})
