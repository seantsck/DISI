// Offline tests for identity resolution (scripts/mlb/lib/identity.mjs).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizePerson, normalizeTransaction, parseHeight, xrefIds } from '../../scripts/mlb/lib/normalize.mjs'
import {
  indexWarFiles, resolveBref, resolveFangraphs, findIdCollisions, chooseCanonicalName, signingPosition, nameKey,
} from '../../scripts/mlb/lib/identity.mjs'

const fx = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/mlb/identity.json'), 'utf8'))
const index = indexWarFiles(fx.warBatting, fx.warPitching)

test('identity fields normalize; implausible height and weight stay NULL', () => {
  const p = normalizePerson(fx.identityPerson.people[0])
  assert.deepEqual([p.birthDate, p.birthCity, p.birthStateProvince, p.birthCountry, p.heightIn, p.weightLb, p.bats, p.throws, p.position],
    ['1974-08-16', 'Valencia', 'Carabobo', 'Venezuela', 73, 205, 'S', 'R', 'OF'])
  assert.deepEqual(p.xref, { lahman: 'cedenpr01', fangraphs: '869', retrosheet: 'cedep001' })
  const q = normalizePerson(fx.prospectPerson.people[0])
  assert.equal(q.heightIn, null, '6\' 13" is not a valid height')
  assert.equal(q.weightLb, null)
  assert.equal(q.birthStateProvince, null)
  assert.equal(q.position, 'RHP', 'pitchers are RHP / LHP from throwing hand, never inferred from anything else')
  assert.equal(parseHeight('5\'11"'), 71)
  assert.equal(parseHeight('180 cm'), null)
  assert.deepEqual(xrefIds({ xrefIds: [{ xrefType: 'bis', xrefId: 1 }, { xrefType: 'bis', xrefId: 2 }] }), { bis: '1' })
})

test('B-Ref id from the WAR file by MLB id, corroborated by the MLB Lahman cross-reference', () => {
  const r = resolveBref({ mlbId: 9000101, lahman: 'cedenpr01', name: 'Rogelio Cedeno Prueba' }, index)
  assert.equal(r.status, 'RESOLVED')
  assert.equal(r.brefId, 'cedenpr01')
  assert.equal(r.confidence, 'VERIFIED')
  assert.deepEqual(r.signals, ['MLB_ID_IN_BREF_WAR_FILE', 'MLB_LAHMAN_XREF_AGREES'])
})

test('a disagreeing cross-reference is a conflict, not an overwrite', () => {
  const r = resolveBref({ mlbId: 9000101, lahman: 'someone01', name: 'x' }, index)
  assert.equal(r.status, 'CONFLICT')
  assert.equal(r.brefId, null)
  assert.match(r.note, /someone01/)
})

test('a B-Ref page DISI already cites resolves the MLB id', () => {
  const r = resolveBref({ brefHint: 'ejempch01', name: 'Chico Ejemplo' }, index)
  assert.equal(r.status, 'RESOLVED')
  assert.equal(r.mlbId, 9000103)
  assert.equal(r.method, 'CITED_BREF_PAGE')
})

test('a name alone never resolves; name + debut year + debut franchise does', () => {
  const nameOnly = resolveBref({ name: 'Chico Ejemplo' }, index)
  assert.equal(nameOnly.status, 'NEEDS_REVIEW')
  assert.equal(nameOnly.brefId, null)
  const strong = resolveBref({ name: 'Chico Ejemplo', debutDate: '1956-07-14', debutTeam: 'BRO' }, index)
  assert.equal(strong.status, 'RESOLVED')
  assert.equal(strong.confidence, 'HIGH')
  const wrongTeam = resolveBref({ name: 'Chico Ejemplo', debutDate: '1956-07-14', debutTeam: 'NYY' }, index)
  assert.equal(wrongTeam.status, 'NEEDS_REVIEW')
})

test('two players with the same name are ambiguous and never auto-selected', () => {
  const r = resolveBref({ name: 'Juan Doble', debutDate: '2001-05-01', debutTeam: 'NYY' }, index)
  assert.equal(r.status, 'RESOLVED', 'debut year and team single out one of them')
  const amb = resolveBref({ name: 'Juan Doble' }, index)
  assert.equal(amb.status, 'AMBIGUOUS')
  assert.equal(amb.brefId, null)
  assert.equal(amb.candidates.length, 2)
})

test('players without an MLB debut are not given B-Ref major-league ids', () => {
  assert.equal(resolveBref({ name: 'Allen Prueba', reachedMlb: false }, index).status, 'NOT_APPLICABLE')
  assert.equal(resolveBref({ name: 'Nobody Here' }, index).status, 'NOT_FOUND')
})

test('FanGraphs ids come only from the MLB cross-reference', () => {
  assert.deepEqual(resolveFangraphs({ xref: { fangraphs: '869' } }).fangraphsId, '869')
  assert.equal(resolveFangraphs({ xref: { bis: '1' } }).status, 'NOT_AVAILABLE')
  assert.equal(resolveFangraphs({ xref: { fangraphs: 'not-an-id' } }).status, 'NOT_AVAILABLE')
})

test('id collisions are detected', () => {
  assert.deepEqual(findIdCollisions([{ slug: 'a', b: 'x' }, { slug: 'b', b: 'x' }, { slug: 'c', b: 'y' }, { slug: 'd', b: null }], 'b'), [{ id: 'x', players: ['a', 'b'] }])
})

test('canonical names: only accent-only differences rename; other spellings become aliases', () => {
  assert.deepEqual(chooseCanonicalName('Roger Cedeno', [['BASEBALL_REFERENCE', 'Roger Cedeño'], ['MLB', 'Roger Cedeno']]),
    { canonicalName: 'Roger Cedeño', rename: true, source: 'BASEBALL_REFERENCE' })
  assert.equal(chooseCanonicalName('William Soto', [['MLB', 'Willian Soto']]).rename, false)
  assert.equal(chooseCanonicalName('Hyun-Jin Ryu', [['MLB', 'Hyun Jin Ryu']]).rename, false, 'punctuation differences do not rename')
  assert.equal(chooseCanonicalName('Yadier Álvarez', [['MLB', 'Yadier Alvarez']]).canonicalName, 'Yadier Álvarez', 'never strips accents')
  assert.equal(nameKey('Julio Lugo (prospect)'), 'julio-lugo')
})

test('position at signing comes from the closest club signing transaction', () => {
  const history = fx.history.transactions.map(normalizeTransaction)
  assert.deepEqual(signingPosition(history, { teamId: 119, signingYear: 2024, signingDate: '2024-01-15' }),
    { position: 'C', date: '2024-01-15', transactionId: 701, description: history[0].description })
  assert.equal(signingPosition(history, { teamId: 140, signingYear: 2024 }), null, 'another club has no record')
  assert.equal(signingPosition(history, { teamId: 119, signingYear: 2018 }), null, 'outside the signing window')
})
