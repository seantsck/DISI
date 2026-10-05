// Offline tests for the MLB research scripts (scripts/mlb). No network access:
// fixtures in tests/fixtures/mlb are sanitized, fictional records.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseMlbPersonId, parseIsoDate, normalizeCountry, normalizePerson, normalizeTransaction,
  normalizeSeasonSplits, sortTransactions,
} from '../../scripts/mlb/lib/normalize.mjs'
import {
  firstProfessionalContract, dedupeBy, findDuplicateNames, reconcileClassList, assignPeriod,
  internationalAmateurProfile, summarizeOutcome, auditDecision,
} from '../../scripts/mlb/lib/classify.mjs'
import { aggregateWar, careerBwar, roundWar } from '../../scripts/mlb/lib/bref.mjs'
import { stableStringify, writeArtifact, toCsv } from '../../scripts/mlb/lib/output.mjs'
import { createClient } from '../../scripts/mlb/lib/http.mjs'
import { parseArgs } from '../../scripts/mlb/lib/args.mjs'

const fixtures = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/mlb/responses.json'), 'utf8'))
const tx = (name) => fixtures[name].transactions.map(normalizeTransaction).filter(Boolean)

test('MLB person ids are parsed from numbers, strings and MLB / Stats API URLs', () => {
  assert.equal(parseMlbPersonId(821672), 821672)
  assert.equal(parseMlbPersonId('821672'), 821672)
  assert.equal(parseMlbPersonId('https://statsapi.mlb.com/api/v1/people/821672'), 821672)
  assert.equal(parseMlbPersonId('https://statsapi.mlb.com/api/v1/people/821672/stats?stats=yearByYear'), 821672)
  assert.equal(parseMlbPersonId('https://statsapi.mlb.com/api/v1/transactions?playerId=800521'), 800521)
  assert.equal(parseMlbPersonId('https://www.mlb.com/player/eddys-leonard-678760'), 678760)
  assert.equal(parseMlbPersonId('https://www.mlb.com/player/682645'), 682645)
  assert.equal(parseMlbPersonId('https://www.milb.com/player/damaso-marte-jr-666006'), 666006)
  for (const bad of [0, -5, 1.5, '', 'abc', 'https://www.baseball-reference.com/players/c/clemero01.shtml', null, undefined]) {
    assert.equal(parseMlbPersonId(bad), null, String(bad))
  }
})

test('dates are parsed strictly', () => {
  assert.equal(parseIsoDate('2024-05-30'), '2024-05-30')
  assert.equal(parseIsoDate('2025-01-28T01:05:45.788Z'), '2025-01-28')
  assert.equal(parseIsoDate('2024-02-29'), '2024-02-29')
  assert.equal(parseIsoDate('2023-02-29'), null)
  assert.equal(parseIsoDate('2024-02-30'), null)
  assert.equal(parseIsoDate('05/30/2024'), null)
  assert.equal(parseIsoDate(''), null)
  assert.equal(parseIsoDate(20240530), null)
})

test('countries and positions normalize to DISI conventions; unknown codes stay null', () => {
  assert.equal(normalizeCountry('DOM'), 'Dominican Republic')
  assert.equal(normalizeCountry('Venezuela'), 'Venezuela')
  assert.equal(normalizeCountry('RU1'), null)
  assert.equal(normalizeCountry(''), null)
  const amateur = normalizePerson(fixtures.personAmateur.people[0])
  assert.equal(amateur.birthCountry, 'Dominican Republic')
  assert.equal(amateur.position, 'SS')
  assert.equal(amateur.foldedName, 'antoni urena test', 'accents fold for matching')
  assert.equal(normalizePerson(fixtures.personPitcher.people[0]).position, 'LHP')
  assert.equal(normalizePerson(fixtures.personMlb.people[0]).position, 'OF')
  assert.equal(normalizePerson(fixtures.personMlb.people[0]).mlbDebutDate, '2023-06-02')
})

test('transactions normalize; malformed rows and impossible dates are dropped', () => {
  const rows = tx('priorContract')
  assert.deepEqual(rows.map((r) => r.transactionId), [601, 602, 603])
  assert.equal(rows[1].positionInDescription, 'LHP')
  assert.equal(rows[1].toTeamId, 119)
  assert.equal(normalizeTransaction({ id: 1 }), null)
})

test('transactions sort by date, then transaction id', () => {
  const sorted = sortTransactions(tx('showcaseThenSigned'))
  assert.deepEqual(sorted.map((t) => t.transactionId), [501, 502, 503])
})

test('first professional contract: showcase activity does not count, an earlier club contract does', () => {
  const showcase = tx('showcaseThenSigned')
  const signing = showcase.find((t) => t.typeCode === 'SFA')
  assert.equal(firstProfessionalContract(showcase, signing).first, true)

  const prior = tx('priorContract')
  const dodgers = prior.find((t) => t.transactionId === 602)
  const result = firstProfessionalContract(prior, dodgers)
  assert.equal(result.first, false)
  assert.equal(result.priorContracts[0].toTeamName, 'Texas Rangers')
})

test('international-amateur profile flags draft-eligible, drafted, over-age and unknown birth date', () => {
  const p = normalizePerson(fixtures.personAmateur.people[0])
  assert.deepEqual(internationalAmateurProfile(p, '2024-12-16'), { fits: true, ageAtSigning: 18, reasons: [] })
  assert.deepEqual(internationalAmateurProfile({ ...p, birthCountry: 'Puerto Rico' }, '2024-12-16').reasons, ['DRAFT_ELIGIBLE_BIRTH_COUNTRY'])
  assert.deepEqual(internationalAmateurProfile({ ...p, birthDate: null }, '2024-12-16').reasons, ['BIRTH_DATE_UNKNOWN'])
  assert.ok(internationalAmateurProfile({ ...p, birthDate: '1990-01-01' }, '2024-12-16').reasons.includes('OVER_AGE'))
})

test('signing periods are assigned by date; dates between periods stay unassigned', () => {
  const periods = [{ key: '2024', start: '2024-01-15', end: '2024-12-15' }, { key: '2025', start: '2025-01-15', end: '2025-12-15' }]
  assert.equal(assignPeriod('2024-05-30', periods), '2024')
  assert.equal(assignPeriod('2024-12-16', periods), null)
  assert.equal(assignPeriod('2025-01-15', periods), '2025')
})

test('duplicates are detected across accents and case; dedupe keeps the first', () => {
  const people = [{ fullName: 'Antoni Ureña' }, { fullName: 'Antoni Urena' }, { fullName: 'ANTONI  URENA' }, { fullName: 'Shai Romero' }]
  const dups = findDuplicateNames(people)
  assert.equal(dups.length, 1)
  assert.equal(dups[0].name, 'antoni urena')
  assert.equal(dups[0].items.length, 3)
  assert.deepEqual(dedupeBy([{ id: 1, v: 'a' }, { id: 1, v: 'b' }, { id: 2, v: 'c' }], (x) => x.id).map((x) => x.v), ['a', 'c'])
})

test('class lists reconcile across accents and aliases', () => {
  const signings = [
    { fullName: 'Antoni Urena', mlbId: 1 },
    { fullName: 'Allen Ajoti', aliases: ['Allan Atoji'], mlbId: 2 },
    { fullName: 'Yhonaider Gudino', mlbId: 3 },
  ]
  const r = reconcileClassList(['Antoni Ureña', 'Allan Atoji', 'Missing Player'], signings)
  assert.deepEqual(r.matched.map((m) => m.signing.mlbId), [1, 2])
  assert.deepEqual(r.unmatchedList, ['Missing Player'])
  assert.deepEqual(r.unmatchedSignings.map((s) => s.mlbId), [3])
})

test('season splits drop the "Minors" aggregate and order by season and level', () => {
  const splits = normalizeSeasonSplits(fixtures.milbSeasonsPitcher)
  assert.deepEqual(splits.map((s) => `${s.season} ${s.level}`), ['2023 ROK', '2024 ROK', '2024 A', '2025 AAA'])
  assert.deepEqual(splits.map((s) => s.affiliated), [true, true, true, false], 'the Mexican League is not MLB-affiliated')
})

test('outcome summary: MLB debut is VERIFIED_MLB with debut team', () => {
  const person = normalizePerson(fixtures.personMlb.people[0])
  const s = summarizeOutcome({ person, mlbSplits: normalizeSeasonSplits(fixtures.mlbSeasonsHitter), auditDate: '2026-10-05' })
  assert.equal(s.recommendation, 'VERIFIED_MLB')
  assert.equal(s.mlbDebutDate, '2023-06-02')
  assert.equal(s.mlbDebutTeam, 'Los Angeles Dodgers')
  assert.equal(s.highestLevel, 'MLB')
  assert.equal(s.disposition, null)
})

test('outcome summary: released player with no recent affiliated play is NO_MLB_CAREER_ENDED with evidence', () => {
  const person = normalizePerson(fixtures.personPitcher.people[0])
  const s = summarizeOutcome({ person, milbSplits: normalizeSeasonSplits(fixtures.milbSeasonsPitcher), transactions: tx('priorContract'), auditDate: '2026-10-05' })
  assert.equal(s.recommendation, 'NO_MLB_CAREER_ENDED')
  assert.equal(s.highestLevel, 'A', 'a later Mexican League season does not count as Triple-A')
  assert.equal(s.lastAffiliatedSeason, 2024)
  assert.equal(s.continuedOutsideAffiliated, true)
  assert.deepEqual(s.outsideAffiliatedSeasons, [{ season: 2025, team: 'Olmecas de Prueba', league: 'Mexican League' }])
  assert.equal(s.disposition, 'RELEASED')
  assert.equal(s.finalTransaction.date, '2024-12-14')
})

test('outcome summary: an active minor leaguer is not a negative outcome; no data is insufficient evidence', () => {
  const person = normalizePerson(fixtures.personPitcher.people[0])
  const active = summarizeOutcome({ person, milbSplits: normalizeSeasonSplits(fixtures.milbSeasonsPitcher), auditDate: '2024-10-05' })
  assert.equal(active.recommendation, 'NO_MLB_ACTIVE_IN_MINORS')
  assert.equal(active.disposition, 'ACTIVE')
  const nothing = summarizeOutcome({ person, auditDate: '2026-10-05' })
  assert.equal(nothing.recommendation, 'INSUFFICIENT_EVIDENCE')
  const lastYearNoExit = summarizeOutcome({ person, milbSplits: normalizeSeasonSplits(fixtures.milbSeasonsPitcher), auditDate: '2025-10-05' })
  assert.equal(lastYearNoExit.recommendation, 'INSUFFICIENT_EVIDENCE', 'one quiet season without an exit transaction is not enough')
})

test('outcome summary: a final release outranks having played earlier that season, and needs no games', () => {
  const person = normalizePerson(fixtures.personPitcher.people[0])
  const released = tx('priorContract')
  const playedThenReleased = summarizeOutcome({ person, milbSplits: normalizeSeasonSplits(fixtures.milbSeasonsPitcher), transactions: released, auditDate: '2024-12-31' })
  assert.equal(playedThenReleased.recommendation, 'NO_MLB_CAREER_ENDED')
  assert.equal(playedThenReleased.activeInAffiliatedBall, false)
  const neverPlayed = summarizeOutcome({ person, transactions: released, auditDate: '2026-10-05' })
  assert.equal(neverPlayed.recommendation, 'NO_MLB_CAREER_ENDED')
  assert.equal(neverPlayed.highestLevel, null)
  assert.match(neverPlayed.reason, /no affiliated games recorded/)
})

test('career bWAR sums batting and pitching WAR exactly and rounds half away from zero', () => {
  const ids = new Set([9000002, 9000003])
  const rows = careerBwar(aggregateWar(fixtures.warBatting, ids), aggregateWar(fixtures.warPitching, ids), ids)
  assert.deepEqual(rows.map((r) => [r.mlbId, r.brefId, r.careerBwar, r.firstYear, r.lastYear]), [
    [9000002, 'pruebl01', -0.3, 2025, 2026],
    [9000003, 'ejemplj01', 1.8, 2023, 2024],
  ])
  assert.equal(roundWar(-3.25), -3.3)
  assert.equal(roundWar(38.75), 38.8)
  assert.equal(roundWar(0.04), 0)
  assert.throws(() => aggregateWar('a,b\n1,2', ids), /mlb_ID/)
})

test('artifacts are deterministic regardless of input order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disi-mlb-'))
  const recs = [{ name: 'B', mlbId: 2, extra: { z: 1, a: 2 } }, { name: 'A', mlbId: 1 }, { name: 'C', mlbId: null }]
  writeArtifact(path.join(dir, 'one'), 'x', { meta: { b: 1, a: 2 }, records: recs, sortKeys: ['name'], columns: ['name', 'mlbId'] })
  writeArtifact(path.join(dir, 'two'), 'x', { meta: { a: 2, b: 1 }, records: [...recs].reverse(), sortKeys: ['name'], columns: ['name', 'mlbId'] })
  for (const ext of ['json', 'csv']) {
    assert.equal(fs.readFileSync(path.join(dir, 'one', `x.${ext}`), 'utf8'), fs.readFileSync(path.join(dir, 'two', `x.${ext}`), 'utf8'))
  }
  assert.equal(stableStringify({ b: [{ d: 1, c: 2 }], a: 1 }), '{\n  "a": 1,\n  "b": [\n    {\n      "c": 2,\n      "d": 1\n    }\n  ]\n}\n')
  assert.equal(toCsv([{ a: 'x, "y"', b: ['p', 'q'] }], ['a', 'b']), 'a,b\n"x, ""y""",p; q\n')
})

test('HTTP client retries transient errors, never retries 404, and serves cached responses offline', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disi-http-'))
  let calls = 0
  const flaky = async () => { calls += 1; return calls < 3 ? new Response('busy', { status: 503 }) : new Response('{"ok":true}', { status: 200 }) }
  const client = createClient({ cacheDir: dir, minIntervalMs: 0, retries: 3, backoffMs: 1, fetchImpl: flaky, log: () => {}, now: () => new Date('2026-10-05T00:00:00Z') })
  const first = await client.getJson('https://example.test/a')
  assert.deepEqual(first.data, { ok: true })
  assert.equal(first.retrievedAt, '2026-10-05T00:00:00.000Z')
  assert.equal(calls, 3)
  assert.equal(client.stats.retries, 2)

  const offline = createClient({ cacheDir: dir, offline: true, fetchImpl: async () => { throw new Error('network used') } })
  const cached = await offline.getJson('https://example.test/a')
  assert.equal(cached.fromCache, true)
  assert.equal(cached.retrievedAt, '2026-10-05T00:00:00.000Z', 'the original retrieval time is preserved')
  await assert.rejects(offline.getJson('https://example.test/uncached'), /Offline mode/)

  let notFoundCalls = 0
  const nf = createClient({ minIntervalMs: 0, backoffMs: 1, log: () => {}, fetchImpl: async () => { notFoundCalls += 1; return new Response('', { status: 404 }) } })
  await assert.rejects(nf.getText('https://example.test/missing'), /HTTP 404/)
  assert.equal(notFoundCalls, 1)
})

test('argument parser handles flags and values', () => {
  assert.deepEqual(parseArgs(['--year', '2022', '--offline', '--out=dir', 'extra']), { _: ['extra'], year: '2022', offline: true, out: 'dir' })
})

test('audit policy: positives always, negatives only for mature classes, never on insufficient evidence', () => {
  assert.deepEqual(auditDecision({ recommendation: 'VERIFIED_MLB' }, 2025), { audit: true, reachedMlb: true, outcomeState: 'REACHED_MLB', reason: 'Verified MLB debut.' })
  assert.equal(auditDecision({ recommendation: 'NO_MLB_CAREER_ENDED', reason: 'r' }, 2021).audit, true)
  assert.equal(auditDecision({ recommendation: 'NO_MLB_CAREER_ENDED', reason: 'r' }, 2022).audit, false, 'recent classes are not negative outcomes yet')
  assert.equal(auditDecision({ recommendation: 'NO_MLB_ACTIVE_IN_MINORS', reason: 'r' }, 2018).outcomeState, 'NO_MLB_ACTIVE_IN_MINORS')
  assert.equal(auditDecision({ recommendation: 'NO_MLB_ACTIVE_IN_MINORS', reason: 'r' }, 2021).audit, false, 'a developing 2021 player is not a negative outcome')
  assert.equal(auditDecision({ recommendation: 'INSUFFICIENT_EVIDENCE' }, 2012).audit, false)
})
