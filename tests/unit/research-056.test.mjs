// Migration 056 research artifacts, without a database: the official 2019 list exactly as captured before the signing period, the later editions
// compared (the 2020-02-13 re-ranking recorded and never used), one decision per member, the 050 identity rules unchanged (common names never
// resolve by name alone; a one-letter variant without the list's club, a changed position family and a signing outside the class window all stay
// for a person), the Dodgers mapping, and the build's refusals.
//   RANKING APPEARANCE != NEW SIGNING   SOURCE LIST MEMBERSHIP != VERIFIED SIGNING   BENCHMARK SUPPORT != DODGERS SUPPORT

import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nameMatch, decideIdentity } from '../../database/research/050/identity-rules.mjs'
import { research, DODGERS_MAPPED } from '../../database/research/056/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'database/research/056', f), 'utf8'))
const cohorts = read('source-cohorts.json')
const identity = read('identity-research.json')
const outcomes = read('outcome-research.json')
const decisions = read('cohort-decisions.json').list_members
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const entry = (name) => identity.entries.find((e) => e.published_name === name)
const decision = (name) => decisions.find((d) => d.published_name === name)

test('source: the official pre-signing capture, pinned by SHA-256, Internet Archive digest, URL and last_updated', () => {
  assert.equal(cohorts.cohorts.length, 1)
  const c = cohorts.cohorts[0]
  assert.deepEqual([c.population_key, c.class_year, c.list_basis, c.list_capture.url, c.list_capture.original_url, c.list_capture.captured_at, c.list_capture.sha256,
    c.list_capture.cdx_digest, c.list_capture.last_updated, c.list_capture.list_path], ['MLB-2019-PIPELINE-TOP30', 2019, 'PRE_SIGNING_LIST',
    'https://web.archive.org/web/20190701214936id_/http://m.mlb.com/gen/players/prospects/2019/playerProspects.json', 'http://m.mlb.com/gen/players/prospects/2019/playerProspects.json',
    '2019-07-01T21:49:36Z', '9162c700163c1f40df0f75daccf5c68dfbde160e11000916456c75866379625f', 'MAQMR2BLWSWRPZCIL222OY36SNO3AJBI', '2019-06-30T22:48:35.042Z', 'prospect_players.int'])
  assert.ok(c.list_capture.last_updated < '2019-07-02', 'published before the 2019-20 signing period opened')
  assert.deepEqual(c.signing_window, ['2019-06-01', '2020-06-30'])
  // the clubs come from the final revision of the same feed (archived gzip-encoded; SHA-256 and digest of the archived payload)
  assert.deepEqual([c.club_capture.url, c.club_capture.sha256, c.club_capture.cdx_digest, c.club_capture.last_updated],
    ['https://web.archive.org/web/20210906152435id_/http://m.mlb.com/gen/players/prospects/2019/playerProspects.json',
      '2a4bd11a1fd92dd2b5fd6c4c84020b5037818d1fa0cc889fb785c97db0f17430', 'Q7EXICG3QWHUE5YNOF2SF5ATNPWPXKM6', '2019-12-15T20:06:11.579Z'])
})

test('ranks: 30 records, every rank 1-30 exactly once, no club named, reproducing the archived feed byte for byte', () => {
  const m = cohorts.cohorts[0].members
  assert.equal(m.length, 30)
  assert.deepEqual(m.map((x) => x.rank).sort((a, b) => a - b), Array.from({ length: 30 }, (_, i) => i + 1))
  assert.equal(new Set(m.map((x) => x.rank)).size, 30, 'no duplicate rank')
  assert.equal(new Set(m.map((x) => x.pipeline_slug)).size, 30, 'no player listed twice')
  assert.ok(m.every((x) => x.published_first_name && x.published_last_name && x.published_position && x.pipeline_slug), 'no malformed record')
  // [rank, first, last, position, slug] exactly as the feed publishes them (the same md5 is recomputed from the raw capture in the research notes)
  assert.equal(md5(m.map((x) => [x.rank, x.published_first_name, x.published_last_name, x.published_position, x.pipeline_slug])), 'ee47e18dddabe538a628f81907a82799')
  // the source spelling is kept: rank 8 is "Enmanuel Rodriguez" in this edition
  assert.equal(m.find((x) => x.rank === 8).published_name, 'Enmanuel Rodriguez')
})

test('editions: later revisions keep the ranking (one re-keyed name); the 2020-02-13 re-ranking is recorded and never used', () => {
  const e = cohorts.later_revisions
  assert.deepEqual(e.map((r) => [r.edition_captured_at, r.classification]), [
    ['2019-08-14T23:00:35Z', 'REVISION_SAME_RANKING'], ['2019-09-29T00:42:53Z', 'REVISION_SAME_RANKING'], ['2019-10-26T12:12:03Z', 'REVISION_SAME_RANKING'],
    ['2020-02-16T19:57:58Z', 'RE_RANKED_EDITION_NOT_USED'], ['2021-09-06T15:24:35Z', 'FINAL_REVISION_CLUB_SOURCE']])
  for (const r of e.filter((x) => x.classification !== 'RE_RANKED_EDITION_NOT_USED')) {
    assert.equal(r.reranked.length, 0)
    assert.deepEqual(r.rekeyed, [{ rank: 8, cohort_name: 'Enmanuel Rodriguez', edition_name: 'Emmanuel Rodriguez', edition_slug: 'rodriguez_emmanuel' }])
    assert.equal(r.clubs_named, 29)
  }
  const rr = e.find((x) => x.classification === 'RE_RANKED_EDITION_NOT_USED')
  assert.equal(rr.reranked.length, 24)
  assert.deepEqual(rr.added.map((x) => x.name), ['Pedro Leon', 'Norge Vera', 'Emmanuel Rodriguez', 'Dyan Jorge'])
  assert.deepEqual(rr.dropped.map((x) => x.name), ['Enmanuel Rodriguez', 'Adrian Placencia', 'Luis Gutierrez', 'Brayan Altuve'])
  // nobody the re-ranking added is a member, and every member's rank is the pre-signing one
  for (const name of ['Pedro Leon', 'Norge Vera', 'Dyan Jorge']) assert.ok(!cohorts.cohorts[0].members.some((m) => m.published_name === name))
  for (const p of research.newPlayers) assert.equal(p.signing.rank, cohorts.cohorts[0].members.find((m) => m.published_name === (p.alias ?? p.full_name) || research.decisions.find((d) => d.mlb_id === p.mlb_id)?.published_name === m.published_name).rank)
})

test('decisions: every one of the 30 members has exactly one decision; none disappears', () => {
  assert.equal(decisions.length, 30)
  const tally = decisions.reduce((m, d) => ({ ...m, [d.decision]: (m[d.decision] ?? 0) + 1 }), {})
  assert.deepEqual(tally, { BENCHMARK_SIGNING_ADDED: 26, IDENTITY_INSUFFICIENT_EVIDENCE: 3, MAPPED_TO_EXISTING_DODGERS_SIGNING: 1 })
  assert.equal(identity.entries.filter((e) => e.result === 'RESOLVED').length, 27)
  assert.equal(research.newPlayers.length, 26)
  assert.deepEqual(decisions.filter((d) => d.decision !== 'BENCHMARK_SIGNING_ADDED').map((d) => [d.rank, d.published_name, d.decision]), [
    [2, 'Robert Puason', 'IDENTITY_INSUFFICIENT_EVIDENCE'], [4, 'Luis Rodriguez', 'MAPPED_TO_EXISTING_DODGERS_SIGNING'],
    [7, 'Yiddi Cappe', 'IDENTITY_INSUFFICIENT_EVIDENCE'], [8, 'Enmanuel Rodriguez', 'IDENTITY_INSUFFICIENT_EVIDENCE']])
  for (const d of decisions.filter((x) => /IDENTITY_/.test(x.decision))) assert.equal(d.human_review, true, `${d.published_name} goes to a person`)
  assert.deepEqual(research.populations[0].stated_composition.identity_unresolved.map((x) => x.name), ['Robert Puason', 'Yiddi Cappe', 'Enmanuel Rodriguez'])
  assert.deepEqual(research.populations[0].stated_composition.route_not_established, [])
  assert.deepEqual(research.populations[0].stated_composition.deceased_before_outcome_horizon, [])
})

test('identity: every added player rests on one official signing transaction and a non-variant name; common names never resolve by name alone', () => {
  for (const p of research.newPlayers) {
    const e = identity.entries.find((x) => x.mlb_id === p.mlb_id)
    assert.equal(e.result, 'RESOLVED')
    assert.ok(['EXACT', 'TOKEN'].includes(e.name_match), `${p.full_name}: no added player rests on a spelling variant`)
    assert.equal(p.signing.org, e.signing.club, 'the signing club is the official transaction\'s')
    assert.ok(e.signals.some((s) => s.startsWith('official signing transaction')))
    assert.equal(p.signing.year, 2019)
  }
  for (const [name, club, id, others] of [['Luis Rodriguez', 'LAD', '691177', 3], ['Junior Sanchez', 'MIA', '691265', 1], ['Luis Gutierrez', 'SD', '692294', 1]]) {
    const e = entry(name)
    assert.equal(e.result, 'RESOLVED'); assert.equal(e.mlb_id, id); assert.equal(e.signing.club, club)
    assert.equal(e.candidates_considered.length - 1, others, `${name}: ${others} namesakes were considered and set aside`)
    const rec = (c) => ({ id: c.person_id, fullName: c.name, birthDate: c.birth_date, primaryPosition: { abbreviation: e.published_position, type: /P$/.test(e.published_position) ? 'Pitcher' : 'Infielder' } })
    const cands = e.candidates_considered.map((c) => ({ person_id: c.person_id, date: c.date, club: c.club, description: 'signed', transaction_id: c.person_id, match: c.match, rec: rec(c) }))
    assert.notEqual(decideIdentity({ ...e, list_club: null }, cands, () => null).result, 'RESOLVED', `${name} cannot resolve without the club`)
  }
  // the published spellings are kept as aliases of the MLB record names
  assert.equal(research.newPlayers.find((p) => p.mlb_id === '691267').alias, 'Alexander Ramirez')
  assert.equal(research.newPlayers.find((p) => p.mlb_id === '691264').alias, 'Rikelvin De Castro')
})

test('identity: the three hard cases stay unresolved for a person, never auto-matched', () => {
  // Robert Puason: one exact-name OAK signing, but the MLB record now lists a pitcher (the position-family rule compares the current position)
  const puason = entry('Robert Puason')
  assert.equal(puason.result, 'INSUFFICIENT_EVIDENCE')
  assert.deepEqual(puason.candidates_considered.map((c) => [c.person_id, c.club, c.match]), [[691188, 'OAK', 'EXACT']])
  assert.equal(puason.published_position, 'SS')
  // Yiddi Cappe: no official signing inside the 2019 class window (he signed with Miami on 2021-01-15); never redefined as a 2019 signing
  const cappe = entry('Yiddi Cappe')
  assert.equal(cappe.result, 'INSUFFICIENT_EVIDENCE')
  assert.deepEqual(cappe.candidates_considered, [])
  assert.match(decision('Yiddi Cappe').reason, /No official signing transaction in the class window/)
  // Enmanuel / Emmanuel: a one-letter variant, accepted only with the list's own club; the final revision re-keyed his slug, so no club carries over
  const er = entry('Enmanuel Rodriguez')
  assert.equal(er.result, 'INSUFFICIENT_EVIDENCE')
  assert.equal(er.list_club, null)
  assert.deepEqual(er.candidates_considered.map((c) => [c.person_id, c.club, c.match]), [[691181, 'MIN', 'VARIANT']])
  assert.equal(nameMatch('Enmanuel Rodriguez', ['Emmanuel Rodriguez']), 'VARIANT')
  for (const id of ['691188', '691268', '691181']) assert.ok(!research.newPlayers.some((p) => p.mlb_id === id), `${id} is not a benchmark player`)
})

test('Dodgers: Luis Rodriguez maps to his one Dodgers signing with the rank it already stores; nothing is written for him', () => {
  assert.deepEqual(DODGERS_MAPPED, { 691177: { slug: 'luis-rodriguez-2019', stored_international_rank: 4 } })
  assert.deepEqual(research.dodgersMapped.map((d) => [d.slug, d.stored_international_rank, d.observed_rank]), [['luis-rodriguez-2019', 4, 4]])
  assert.equal(entry('Luis Rodriguez').signing.club, 'LAD')
  assert.ok(!research.newPlayers.some((p) => p.mlb_id === '691177' || p.signing.org === 'LAD'), 'no benchmark copy, player or evaluation')
})

test('outcomes: the four reachers at the 2026-10-05 boundary come from the official person record; no death, no debut after the boundary', () => {
  assert.equal(outcomes.audit_through_date, '2026-10-05')
  const reached = research.newPlayers.filter((p) => p.mlb_debut_date).map((p) => [p.full_name, p.mlb_debut_date]).sort()
  assert.deepEqual(reached, [['Adael Amador', '2024-06-09'], ['Andry Lara', '2025-07-02'], ['Jasson Domínguez', '2023-09-01'], ['Maximo Acosta', '2025-08-18']])
  for (const [name] of reached) {
    const o = outcomes.players.find((x) => research.newPlayers.find((p) => p.full_name === name).mlb_id === x.mlb_id)
    assert.match(o.person_url, /^https:\/\/statsapi\.mlb\.com\/api\/v1\/people\/\d+$/)
  }
  assert.ok(outcomes.players.every((o) => !o.death_date && !o.register_death_date && !o.mlb_debut_date_after_boundary))
  assert.ok(research.newPlayers.every((p) => p.signing.date >= '2019-06-01' && p.signing.date <= '2020-06-30'))
})
