// Migration 062 research artifacts, without a database: the 39 owner-observed values recorded exactly, the canonical player URLs, the honest
// owner-observed provenance, the 7 rows held against the team-season ledger, the build's refusals, and the shape of the generated SQL (data only).
//   UNKNOWN != ZERO   0.0 IS A VALUE   OWNER-OBSERVED != DISI-VERIFIED

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assemble, payloadFor, playerUrl } from '../../database/research/062/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))
const input = read('database/research/062/owner-input.json')
const audit = read('database/research/062/audit.json')
const baseline = read('database/research/062/baseline-build.json')
const evidence = read('database/research/062/career-bwar-evidence.json')
const clone = (x) => JSON.parse(JSON.stringify(x))
const HELD = ['andres-gimenez', 'emmanuel-dejesus', 'fernando-tatis-jr', 'juan-soto', 'miguel-amaya', 'rafael-marchan', 'vladimir-guerrero-jr']

test('the owner input: 39 rows, exactly the BWAR_MISSING bref ids, one-decimal values with signs and zeros kept, owner-observed', () => {
  assert.equal(input.rows.length, 39)
  assert.deepEqual(input.rows.map((r) => r.bref_id).sort(), baseline.backlog.map((b) => b.bref_id).sort())
  assert.ok(input.rows.every((r) => /^-?\d+\.\d$/.test(r.career_bwar)))
  assert.deepEqual(input.rows.filter((r) => r.career_bwar === '0.0').map((r) => r.bref_id).sort(), ['acostma02', 'dejesen01', 'martior01'])
  assert.equal(input.rows.filter((r) => r.career_bwar.startsWith('-')).length, 14)
  const v = Object.fromEntries(input.rows.map((r) => [r.bref_id, r.career_bwar]))
  assert.deepEqual([v.sotoju01, v.tatisfe02, v.pachecr01, v.morejad01, v.marteno01, v.francwa01], ['45.6', '31.7', '-1.4', '-1.1', '-1.0', '11.3'])
  assert.equal(input.input_kind, 'OWNER_OBSERVED_BASEBALL_REFERENCE_PLAYER_PAGE')
  assert.match(input.note, /DISI and no automated process read those pages/)
  assert.equal(input.confidence, 'UNVERIFIED')
})

test('every written row cites the canonical current player URL of its verified bref id (never a Wayback URL); provenance is honest', () => {
  const { payload } = assemble()
  assert.equal(payload.players.length, 32)
  for (const p of payload.players) {
    assert.equal(p.url, `https://www.baseball-reference.com/players/${p.bref_id[0]}/${p.bref_id}.shtml`)
    assert.equal(p.url, playerUrl(p.bref_id))
    assert.ok(!/archive\.org/.test(p.url))
    const a = audit.players.find((x) => x.slug === p.slug)
    assert.deepEqual([a.bref_id, a.mlb_id, a.identity.checks_failed], [p.bref_id, p.mlb_id, []], `${p.slug}: the audit-verified identity`)
    for (const t of [p.notes, p.source_notes]) { assert.match(t, /owner/i); assert.match(t, /DISI did not retrieve/); assert.ok(!/Claude/.test(t)) }
  }
  assert.equal(payload.semantics.confidence, 'UNVERIFIED')
  assert.equal(payload.semantics.accessed_at, '2026-11-06 00:00:00+00')
})

test('the 7 held rows: the owner value differs from the loaded ledger / outcomes.career_war by more than 0.1; every other row is accepted', () => {
  const { payload } = assemble()
  assert.deepEqual(payload.rejected.map((r) => r.slug), HELD)
  for (const s of HELD) {
    const b = baseline.backlog.find((x) => x.slug === s)
    const v = Number(input.rows.find((r) => r.bref_id === b.bref_id).career_bwar)
    assert.ok(b.war_rows > 0 && Math.abs(v - Number(b.war_sum)) > 0.1, s)
  }
  // the four 057-loaded players within tolerance are written (Pache exactly 0.10 away is within)
  for (const s of ['cristian-pache', 'gilberto-celestino', 'leody-taveras', 'simon-muzziotti']) assert.ok(payload.players.some((p) => p.slug === s), s)
  assert.deepEqual(payload.baseline.bwar_missing_after, HELD)
  assert.deepEqual(evidence.effect, { career_bwar_observations: [58, 90], bwar_missing: [39, 7], sources: [3396, 3428], evidence: [4507, 4507] })
})

test('the build refuses: a malformed value, -0.0, a missing or extra player, an unverified identity, a non-NULL baseline value', () => {
  const i1 = clone(input); i1.rows[0].career_bwar = '0'
  assert.throws(() => payloadFor(i1, audit, baseline), /exact one-decimal/)
  const i2 = clone(input); i2.rows[0].career_bwar = '-0.0'
  assert.throws(() => payloadFor(i2, audit, baseline), /exact one-decimal/)
  const i3 = clone(input); i3.rows.pop()
  assert.throws(() => payloadFor(i3, audit, baseline), /39 distinct bref ids/)
  const i4 = clone(input); i4.rows[0].bref_id = 'someone01'
  assert.throws(() => payloadFor(i4, audit, baseline), /not exactly the BWAR_MISSING players/)
  const a1 = clone(audit); a1.players[0].identity.checks_failed.push('birth date')
  assert.throws(() => payloadFor(input, a1, baseline), /does not verify this identity/)
  const b1 = clone(baseline); b1.backlog[0].metric_observations = 1
  assert.throws(() => payloadFor(input, audit, b1), /NULL career bWAR/)
  const i5 = clone(input); i5.confidence = 'VERIFIED'
  assert.throws(() => payloadFor(i5, audit, baseline), /UNVERIFIED/)
})

test('SQL shape: data only (no DDL, no function or provider change), the 017 rule checked, sources kept by the rollback', () => {
  const { migration, rollback } = assemble()
  const code = migration.replace(/\$m062\$[\s\S]*?\$m062\$/, '').replace(/--.*$/gm, '').replace(/create temporary (table|view)/g, '')
  assert.ok(!/\b(create|alter|drop) (table|view|function|trigger|type|policy|index)\b/.test(code))
  assert.ok(!/create or replace|grant |revoke /.test(code))
  assert.ok(!/web\.archive\.org/.test(migration))
  assert.match(code, /insert into public\.sources/)
  assert.match(code, /insert into public\.player_metric_observations/)
  assert.ok(!/insert into public\.(evidence|player_mlb_team_season_war|outcomes|players|signings)\b/.test(code))
  assert.ok(!/\bupdate public\./.test(code), 'nothing is updated')
  assert.ok(!/delete from public\.sources/.test(rollback), 'the rollback keeps the sources')
  assert.match(rollback, /delete from public\.player_metric_observations/)
  assert.ok(migration.includes("set local statement_timeout = '600s';") && rollback.includes("set local statement_timeout = '600s';"))
})
