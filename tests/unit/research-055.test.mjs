// Migration 055 research artifacts, without a database: the two official lists exactly as captured, one decision per member, the 050 identity
// rules unchanged (common names never resolve by name alone; a transposed spelling never passes the variant rule), the Dodgers mappings, the
// death that censors instead of negating, and the build's refusals.
//   RANKING APPEARANCE != NEW SIGNING   SOURCE LIST MEMBERSHIP != VERIFIED SIGNING   NO MLB DEBUT != NEGATIVE OUTCOME   BENCHMARK SUPPORT != DODGERS SUPPORT

import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nameMatch, decideIdentity } from '../../database/research/050/identity-rules.mjs'
import { research, DODGERS_MAPPED } from '../../database/research/055/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'database/research/055', f), 'utf8'))
const cohorts = read('source-cohorts.json')
const identity = read('identity-research.json')
const outcomes = read('outcome-research.json')
const decisions = read('cohort-decisions.json').list_members
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const entry = (name) => identity.entries.find((e) => e.published_name === name)
const decision = (name) => decisions.find((d) => d.published_name === name)

test('sources: two official pre-signing captures, pinned by SHA-256, Internet Archive digest, URL and last_updated', () => {
  assert.deepEqual(cohorts.cohorts.map((c) => [c.population_key, c.class_year, c.list_basis, c.list_capture.url, c.list_capture.original_url, c.list_capture.sha256,
    c.list_capture.cdx_digest, c.list_capture.last_updated, c.list_capture.list_path]), [
    ['MLB-2017-PIPELINE-TOP30', 2017, 'PRE_SIGNING_LIST', 'https://web.archive.org/web/20170526025827id_/http://www.mlb.com:80/gen/players/prospects/2017/playerProspects.json',
      'http://www.mlb.com/gen/players/prospects/2017/playerProspects.json', '2397266cea7586e7be24706b11a49c91af27c458627c0c222f7ce3ec6f02e9cb', 'P2LLK4QRSSZBH2HG3PHLEMNNQE35S34P',
      '2017-05-25T15:51:32.028Z', 'prospect_players.int'],
    ['MLB-2018-PIPELINE-TOP30', 2018, 'PRE_SIGNING_LIST', 'https://web.archive.org/web/20180524100539id_/http://www.mlb.com/gen/players/prospects/2018/playerProspects.json',
      'http://www.mlb.com/gen/players/prospects/2018/playerProspects.json', '029bfce6fc503637416dff5b3675adc78d32b60a978c744167dcc866fcf4ef89', 'JBLKCXBZGH7AST7AEEGD57UQREIZPKQB',
      '2018-05-23T22:57:46.165Z', 'prospect_players.int'],
  ])
  // each list was published before its signing period opened on 2 July
  for (const c of cohorts.cohorts) assert.ok(c.list_capture.last_updated < `${c.class_year}-07-02`, `${c.class_year}: a pre-signing list`)
  // the clubs come from the final revision of the same feed, recorded beside the cohort; 2018 has a second, identical pre-signing capture
  assert.deepEqual(cohorts.cohorts.map((c) => [c.club_capture.sha256, c.club_capture.last_updated]), [
    ['72653db233b420299f86db4b5a7452a3075238a767b44c429d3a2f0c829555cf', '2018-08-29T22:08:30.711Z'],
    ['971d7df012aec8b23d3d282b8d5571833eb34c55f1cdfd3805ea7c4209e355b5', '2019-04-17T22:52:13.103Z']])
  assert.deepEqual(cohorts.cohorts[1].corroborating_captures.map((x) => [x.sha256, x.last_updated]), [['2897828dff39c92214bc2e86b27d1f37715d1e37d110f292dbf9f3db72bc07ef', '2018-06-16T01:10:26.158Z']])
})

test('ranks: 30 per class, 60 in all, every rank 1-30 exactly once, reproducing the archived feed byte for byte', () => {
  const members = cohorts.cohorts.flatMap((c) => c.members.map((m) => ({ ...m, key: c.population_key })))
  assert.equal(members.length, 60)
  for (const c of cohorts.cohorts) {
    assert.equal(c.members.length, 30)
    assert.deepEqual(c.members.map((m) => m.rank).sort((a, b) => a - b), Array.from({ length: 30 }, (_, i) => i + 1))
    assert.equal(new Set(c.members.map((m) => m.rank)).size, 30, 'no duplicate rank')
    assert.equal(new Set(c.members.map((m) => m.pipeline_slug)).size, 30, 'no player listed twice in a class')
  }
  // [rank, first, last, position, slug] exactly as the feed publishes them (the hash is recomputed from the raw capture in the research notes)
  assert.deepEqual(cohorts.cohorts.map((c) => md5(c.members.map((m) => [m.rank, m.published_first_name, m.published_last_name, m.published_position, m.pipeline_slug]))),
    ['8afcbdb1e7e832cda8eaf8ef94f74581', 'ab82ba95899a87081d9f2f76ce436232'])
  // the source spelling is kept, never normalised away: Wander Franco is published as "Wander Samuel Franco", Patiño as "Wildred Patino"
  assert.equal(cohorts.cohorts[0].members.find((m) => m.rank === 1).published_name, 'Wander Samuel Franco')
  assert.equal(cohorts.cohorts[0].members.find((m) => m.rank === 25).published_name, 'Wildred Patino')
  assert.equal(research.newPlayers.find((p) => p.mlb_id === '677551').alias, 'Wander Samuel Franco', 'the published spelling becomes an alias of the MLB record name')
})

test('decisions: every one of the 60 members has exactly one decision; none disappears', () => {
  assert.equal(decisions.length, 60)
  const tally = (k) => decisions.filter((d) => d.population_key === k).reduce((m, d) => ({ ...m, [d.decision]: (m[d.decision] ?? 0) + 1 }), {})
  assert.deepEqual(tally('MLB-2017-PIPELINE-TOP30'), { BENCHMARK_SIGNING_ADDED: 28, DECEASED_BEFORE_OUTCOME_HORIZON: 1, IDENTITY_INSUFFICIENT_EVIDENCE: 1 })
  assert.deepEqual(tally('MLB-2018-PIPELINE-TOP30'), { BENCHMARK_SIGNING_ADDED: 22, MAPPED_TO_EXISTING_DODGERS_SIGNING: 2, ROUTE_NOT_ESTABLISHED: 3, IDENTITY_INSUFFICIENT_EVIDENCE: 3 })
  assert.equal(research.newPlayers.length, 50)
  assert.deepEqual(decisions.filter((d) => d.decision !== 'BENCHMARK_SIGNING_ADDED').map((d) => [d.population_key.slice(4, 8), d.rank, d.published_name, d.decision]), [
    ['2017', 2, 'Daniel Flores', 'DECEASED_BEFORE_OUTCOME_HORIZON'],
    ['2017', 25, 'Wildred Patino', 'IDENTITY_INSUFFICIENT_EVIDENCE'],
    ['2018', 1, 'Diego Cartaya', 'MAPPED_TO_EXISTING_DODGERS_SIGNING'],
    ['2018', 9, 'Osiel Rodriguez', 'ROUTE_NOT_ESTABLISHED'],
    ['2018', 11, 'Antonio Gomez', 'IDENTITY_INSUFFICIENT_EVIDENCE'],
    ['2018', 14, 'Sandy Gaston', 'ROUTE_NOT_ESTABLISHED'],
    ['2018', 16, 'Alvin Guzman', 'IDENTITY_INSUFFICIENT_EVIDENCE'],
    ['2018', 18, 'Eduarqi Fernandez', 'IDENTITY_INSUFFICIENT_EVIDENCE'],
    ['2018', 29, 'Denny Larrondo', 'ROUTE_NOT_ESTABLISHED'],
    ['2018', 30, 'Jerming Rosario', 'MAPPED_TO_EXISTING_DODGERS_SIGNING'],
  ])
  for (const d of decisions.filter((x) => /IDENTITY_/.test(x.decision))) assert.equal(d.human_review, true, `${d.published_name} goes to a person`)
})

test('identity: every added player rests on one official signing transaction, a person record and a non-variant name; common names never resolve by name alone', () => {
  for (const p of research.newPlayers) {
    const e = identity.entries.find((x) => x.mlb_id === p.mlb_id)
    assert.equal(e.result, 'RESOLVED')
    assert.ok(['EXACT', 'TOKEN'].includes(e.name_match), `${p.full_name}: no added player rests on a spelling variant`)
    assert.match(e.signing.description, /signed/i)
    assert.equal(p.signing.org, e.signing.club, 'the signing club is the official transaction\'s')
    assert.ok(e.signals.some((s) => s.startsWith('official signing transaction')))
  }
  // namesakes who signed elsewhere are considered and set aside by the club the list names (and the birth year / position family)
  for (const [name, club, id, others] of [['Luis Garcia', 'PHI', '677593', 2], ['Julio Rodriguez', 'SEA', '677594', 1], ['Carlos Rodriguez', 'MIL', '677578', 2],
    ['Wander Samuel Franco', 'TB', '677551', 1], ['Jose Rodriguez', 'TEX', '682635', 4]]) {
    const e = entry(name)
    assert.equal(e.result, 'RESOLVED'); assert.equal(e.mlb_id, id); assert.equal(e.signing.club, club)
    assert.equal(e.candidates_considered.length - 1, others, `${name}: ${others} namesakes were considered and set aside`)
    // without the club, the same candidates would be a CONFLICT: the name alone never decides
    const rec = (c) => ({ id: c.person_id, fullName: c.name, birthDate: c.birth_date, primaryPosition: { abbreviation: e.published_position, type: /P$/.test(e.published_position) ? 'Pitcher' : 'Infielder' } })
    const cands = e.candidates_considered.map((c) => ({ person_id: c.person_id, date: c.date, club: c.club, description: 'signed', transaction_id: c.person_id, match: c.match, rec: rec(c) }))
    const noClub = decideIdentity({ ...e, list_club: null }, cands, () => null)
    assert.notEqual(noClub.result, 'RESOLVED', `${name} cannot resolve without the club`)
  }
  // Jose Rodriguez: a Dodgers namesake signed in the same window is set aside; the TEX catcher is the listed player
  assert.ok(entry('Jose Rodriguez').candidates_considered.some((c) => c.club === 'LAD' && c.person_id === 692064))
  // the club comes from the official log; the feed's intermediate revisions disagreed for these two and do not override it
  assert.deepEqual([entry('Jose Rodriguez').signing.club, entry('Alexander Ramirez').signing.club], ['TEX', 'LAA'])
})

test('identity: the hard cases stay unresolved for a person, never auto-matched', () => {
  // Wildred / Wilderd: a transposition, two letters, is not the one-letter variant the 050 rule accepts
  assert.equal(nameMatch('Wildred Patino', ['Wilderd Patiño']), null)
  assert.equal(entry('Wildred Patino').result, 'INSUFFICIENT_EVIDENCE')
  assert.deepEqual(entry('Wildred Patino').candidates_considered, [])
  // Eduarqi / Eduarqui: a one-letter variant is accepted only with the list's own club, and the final revision names none
  assert.equal(entry('Eduarqi Fernandez').list_club, null)
  assert.deepEqual(entry('Eduarqi Fernandez').candidates_considered.map((c) => [c.person_id, c.club, c.match]), [[682631, 'MIL', 'VARIANT']])
  // Antonio Gomez and Alvin Guzman: one exact-name signing with the listed club, but the MLB record now lists a pitcher (the position-family rule)
  for (const [name, id] of [['Antonio Gomez', 682625], ['Alvin Guzman', 682630]]) {
    const e = entry(name)
    assert.equal(e.result, 'INSUFFICIENT_EVIDENCE')
    assert.deepEqual(e.candidates_considered.map((c) => [c.person_id, c.club === e.list_club, c.match]), [[id, true, 'EXACT']])
  }
  // no unresolved member is a benchmark player
  for (const name of ['Wildred Patino', 'Eduarqi Fernandez', 'Antonio Gomez', 'Alvin Guzman']) assert.ok(!research.newPlayers.some((p) => p.alias === name || p.full_name === name))
})

test('Daniel Flores: a recorded death before the horizon censors; he is never an ordinary non-reacher', () => {
  const o = outcomes.players.find((x) => x.published_name === 'Daniel Flores')
  assert.equal(o.death_date, '2017-11-08')
  assert.equal(o.mlb_debut_date, null)
  const d = decision('Daniel Flores')
  assert.equal(d.decision, 'DECEASED_BEFORE_OUTCOME_HORIZON')
  assert.deepEqual([d.mlb_id, d.signing_club, d.signing_date, d.death_date, d.death_source], ['677567', 'BOS', '2017-07-02', '2017-11-08', 'https://statsapi.mlb.com/api/v1/people/677567'])
  assert.ok(!research.newPlayers.some((p) => p.mlb_id === '677567'), 'no benchmark signing, audit or label for him')
  assert.deepEqual(research.populations.find((p) => p.population_key === 'MLB-2017-PIPELINE-TOP30').stated_composition.deceased_before_outcome_horizon, [{ rank: 2, name: 'Daniel Flores', mlb_id: '677567' }])
  // nobody else among the resolved players has a recorded death
  assert.deepEqual(outcomes.players.filter((x) => x.death_date || x.register_death_date).map((x) => x.published_name), ['Daniel Flores'])
})

test('Dodgers: Cartaya and Rosario map to their one Dodgers signing with the rank it already stores; nothing is written for them', () => {
  assert.deepEqual(DODGERS_MAPPED, { 682616: { slug: 'diego-cartaya', stored_international_rank: 1 }, 682645: { slug: 'jerming-rosario', stored_international_rank: null } })
  assert.deepEqual(research.dodgersMapped.map((d) => [d.slug, d.stored_international_rank, d.observed_rank]), [['diego-cartaya', 1, 1], ['jerming-rosario', null, 30]])
  for (const id of ['682616', '682645']) {
    assert.equal(entry(identity.entries.find((e) => e.mlb_id === id).published_name).signing.club, 'LAD')
    assert.ok(!research.newPlayers.some((p) => p.mlb_id === id), 'no benchmark copy, player or evaluation')
  }
  assert.equal(decision('Jerming Rosario').stored_dodgers_international_rank, null, 'the observed #30 is never written into the Dodgers record')
  assert.ok(!research.newPlayers.some((p) => p.signing.org === 'LAD'))
})

test('Cuban signees: an unknown route is never guessed; the signing is verified and not added', () => {
  for (const name of ['Osiel Rodriguez', 'Sandy Gaston', 'Denny Larrondo']) {
    const e = entry(name)
    assert.equal(e.result, 'RESOLVED'); assert.equal(e.birth_country, 'Cuba'); assert.equal(e.route_evidence.route, null)
    assert.equal(decision(name).decision, 'ROUTE_NOT_ESTABLISHED')
  }
  assert.ok(research.newPlayers.every((p) => p.signing.pathway !== 'CUBAN_PRO' && p.signing.pathway !== 'CUBAN_AMATEUR' && p.birth_country !== 'Cuba'))
})

test('signings: the official signing year (class year or the next) and the audit boundary; no bonus is invented', () => {
  for (const p of research.newPlayers) {
    const year = Number(p.population_key.slice(4, 8))
    assert.ok(p.signing.year === year || p.signing.year === year + 1, `${p.full_name}: ${p.signing.year}`)
    assert.ok(p.signing.date >= `${year}-06-01` && p.signing.date <= `${year + 1}-06-30`)
  }
  assert.equal(outcomes.audit_through_date, '2026-10-05')
  // the reachers at the boundary, by class (a debut after it would not count)
  const reached = (k) => research.newPlayers.filter((p) => p.population_key === k && p.mlb_debut_date).map((p) => p.full_name).sort()
  assert.deepEqual(reached('MLB-2017-PIPELINE-TOP30'), ['Everson Pereira', 'George Valera', 'Julio Rodríguez', 'Osleivis Basabe', 'Ronny Mauricio', 'Wander Franco'])
  assert.deepEqual(reached('MLB-2018-PIPELINE-TOP30'), ['Francisco Alvarez', 'Kevin Alcántara', 'Luis Matos', 'Marco Luciano', 'Noelvi Marte', 'Orelvis Martinez'])
  assert.ok(research.newPlayers.every((p) => !p.outcome || p.outcome.debut <= '2026-10-05'))
})
