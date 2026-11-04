// Migration 060 research artifacts, without a database: the 25 owner-reviewed signing bonuses (exact values and total), the unsourced-canonical
// ledger mapping (no source, URL or publisher; the public-report flag untouched), Pedro Astacio's known zero, the Beltre resolution of the existing
// 046 conflict, and the shape of the generated SQL (data only, no schema change, one conditional refresh, a guarded retracting rollback).
//   OWNER-REVIEWED INPUT != EXTERNAL SOURCE   KNOWN ZERO != UNKNOWN   A RESOLUTION IS NOT A REPORT   UNKNOWN STAYS NULL

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assemble, payloadFor } from '../../database/research/060/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))
const evidence = read('database/research/060/research-evidence.json')
const baseline = read('database/research/060/baseline.json')
// comments are stripped before string literals because the comments contain apostrophes
const strip = (sql, tag) => sql.replace(new RegExp(`\\$${tag}\\$[\\s\\S]*?\\$${tag}\\$`, 'g'), '').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")

test('the reviewed input: the 25 owner-supplied values of 2026-11-04, exactly', () => {
  assert.deepEqual(evidence.bonuses.map((b) => [b.player_slug, b.signing_year, b.signing_bonus_usd]), [
    ['adrian-beltre', 1994, '23000.00'], ['carlos-santana', 2004, '75000.00'], ['pedro-astacio', 1987, '0.00'], ['pedro-baez', 2007, '200000.00'],
    ['willy-aybar', 2000, '1400000.00'], ['roger-cedeno', 1991, '3000.00'], ['victor-gonzalez', 2012, '161000.00'], ['rubby-de-la-rosa', 2007, '15000.00'],
    ['elian-herrera', 2003, '15000.00'], ['jorbit-vivas', 2017, '300000.00'], ['jose-dominguez', 2007, '50000.00'], ['miguel-droz', 2018, '600000.00'],
    ['kelvin-ramirez', 2021, '10000.00'], ['thayron-liranzo', 2021, '30000.00'], ['aldrin-batista', 2022, '10000.00'], ['alexander-albertus', 2022, '75000.00'],
    ['jeral-perez', 2022, '397500.00'], ['mairoshendrick-martinus', 2022, '320000.00'], ['samuel-munoz', 2022, '757500.00'], ['sean-linan', 2022, '17500.00'],
    ['aneudy-almonte', 2025, '50000.00'], ['samuel-savinon', 2025, '225000.00'], ['shai-romero', 2025, '200000.00'], ['arnaldo-lantigua', 2023, '700000.00'],
    ['eduardo-quintero', 2023, '297500.00']])
  assert.equal(evidence.bonuses.reduce((s, b) => s + Math.round(Number(b.signing_bonus_usd) * 100), 0), 593200000)
  assert.equal(evidence.reviewed_input.basis, 'OWNER_REVIEWED_INPUT')
  assert.equal(evidence.reviewed_input.supplied_on, '2026-11-04')
})

test('provenance: the unsourced-canonical path, never an external source; the public-report flag is not set', () => {
  const m = evidence.ledger_mapping
  assert.deepEqual([m.report_origin, m.evidence_basis, m.confidence, m.amount_basis, m.source, m.bonus_publicly_reported],
    ['LEGACY_CARRYFORWARD', 'LEGACY_CANONICAL_VALUE', 'UNVERIFIED', null, null, 'UNCHANGED'])
  assert.equal(m.note, 'Owner-reviewed acquisition-cost input supplied 2026-11-04; no external citation retained in this research batch.')
  assert.ok(m.known_zero_note.startsWith(m.note) && /known \$0\.00/.test(m.known_zero_note))
  const { migration } = assemble()
  const body = strip(migration, 'm060')
  assert.ok(!/insert\s+into\s+public\.sources/i.test(body), 'no source row is created')
  assert.ok(!/bonus_publicly_reported\s*=\s*true/i.test(body), 'the public-report flag is never set')
  assert.ok(!/https?:\/\//.test(body.replace(/'[^']*'/g, '')), 'no URL outside the reviewed payload')
  assert.ok(!/'EXTERNAL_SOURCE',\s*src/.test(migration), 'no external report is written')
})

test('known zero and Beltre: one reviewed $0.00 (Astacio), one resolution of the existing conflict, no third Beltre report', () => {
  assert.deepEqual(evidence.bonuses.filter((b) => b.known_zero).map((b) => b.player_slug), ['pedro-astacio'])
  assert.deepEqual(evidence.bonuses.filter((b) => b.signing_bonus_usd === '0.00').map((b) => b.player_slug), ['pedro-astacio'])
  const br = evidence.beltre_resolution
  assert.deepEqual([br.basis, br.reviewed_by, br.reviewed_at, br.selected_report.amount, br.competing_report.amount], ['OTHER_REVIEWED', 'Sean Cannon', '2026-11-04T00:00:00Z', '23000.00', '17000.00'])
  assert.ok(br.rationale.length <= 600 && /\$23,000/.test(br.rationale) && /stays ACTIVE/.test(br.rationale))
  const p = payloadFor(evidence, baseline)
  assert.deepEqual(p.bonuses.filter((b) => b.treatment === 'RESOLVE_EXISTING_CONFLICT').map((b) => b.player_slug), ['adrian-beltre'])
  assert.deepEqual([p.baseline.known, p.baseline.unknown, p.after.known, p.after.unknown, p.after.known_usd], [56, 164, 81, 139, '127632237.33'])
})

test('the generated SQL: data only, SET LOCAL timeout, phase notices, one conditional refresh; the rollback retracts and never deletes', () => {
  const { migration, rollback } = assemble()
  for (const [sql, tag] of [[migration, 'm060'], [rollback, 'r060']]) {
    const body = strip(sql, tag)
    assert.ok(!/\b(create|alter|drop)\s+(table|view|function|trigger|policy|index|type|schema)\b/i.test(body.replace(/create temporary table/gi, '')), 'no schema change')
    assert.ok(!/\bdelete\s+from\b/i.test(body), 'nothing is deleted')
    assert.ok(!/\b(grant|revoke)\b/i.test(body), 'no grant change')
    assert.match(sql, /^begin;\nset local statement_timeout = '600s';$/m)
    assert.equal((body.match(/disi_refresh_product_snapshots\(\)/g) || []).length >= 1, true)
  }
  assert.equal((migration.match(/raise notice '060 phase/g) || []).length, 5)
  assert.match(strip(migration, 'm060'), /if exists \(select 1 from _m060_changed\) then\s+perform \* from public\.disi_refresh_product_snapshots\(\)/)
  assert.match(rollback, /set record_status = 'RETRACTED', retracted_at = now\(\), retraction_reason = 'Migration 060 rolled back\.'/)
  assert.equal((rollback.match(/raise notice 'rollback-060 phase/g) || []).length, 4)
})

test('release check: PASS on the replay before / after; HOLD on any move outside the reviewed cost change', async () => {
  const { verifyApply } = await import('../../database/research/060/release-check.mjs')
  const ba = read('database/research/060/before-after.json')
  const r = verifyApply(ba.before, ba.after)
  assert.equal(r.verdict, 'PASS', JSON.stringify(r.checks.filter((c) => !c.pass)))
  const holds = (mutate) => { const post = structuredClone(ba.after); mutate(post); return verifyApply(ba.before, post).verdict }
  assert.equal(holds((p) => { p.war = { ...p.war, active: p.war.active + 1 } }), 'HOLD', 'team-season WAR moved')
  assert.equal(holds((p) => { p.counts.players += 1 }), 'HOLD', 'a non-cost count moved')
  assert.equal(holds((p) => { p.all_zero_bonuses.push({ slug: 'carlos-santana', signing_year: 2004 }) }), 'HOLD', 'a second zero')
  assert.equal(holds((p) => { p.snapshots.generation = Number(p.snapshots.generation) + 1 }), 'HOLD', 'two refreshes')
  assert.equal(holds((p) => { p.fingerprints.other_reports = 'x' }), 'HOLD', 'another ledger row moved')
})
