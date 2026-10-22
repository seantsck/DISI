// Migration 050 (international benchmark expansion and probability-support audit): the research rules as pure functions and the committed
// research artifacts. No database. The database behaviour is proven in tests/db/research-050.test.mjs.
//   SOURCE LIST MEMBERSHIP != VERIFIED SIGNING   RANKING APPEARANCE != NEW SIGNING   RANKING CLASS YEAR != SIGNING YEAR
//   RANKED PROSPECT SAMPLE != LEAGUE CENSUS   BENCHMARK SUPPORT != DODGERS SUPPORT   UNKNOWN BWAR != ZERO BWAR

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nameMatch, decideIdentity, classifyCubanRoute, describedName, isSigning, recordedNames } from '../../database/research/050/identity-rules.mjs'
import { research } from '../../database/research/050/build.mjs'
import { benchmarkClassSummary, benchmarkLabelCoverage, benchmarkClassOf } from '../../lib/research/benchmark-sample.js'
import { readinessBlockers, DODGERS_REFERENCE_POPULATION } from '../../lib/research/readiness-blockers.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'database/research/050', f), 'utf8'))
const identity = read('identity-research.json')
const cohorts = read('source-cohorts.json')
const decisions = read('cohort-decisions.json')
const evaluation = read('evaluation.json')
const evaluation041 = JSON.parse(fs.readFileSync(path.join(root, 'database/research/041/evaluation.json'), 'utf8'))
const targets041 = JSON.parse(fs.readFileSync(path.join(root, 'database/research/041/targets.json'), 'utf8')).targets

// ---- identity rules ---------------------------------------------------------------------------------------------------------------

const rec = (id, fullName, birthDate, extra = {}) => ({ id, fullName, firstName: fullName.split(' ')[0], lastName: fullName.split(' ').slice(1).join(' '), birthDate, birthCountry: 'Dominican Republic', primaryPosition: { abbreviation: 'SS', type: 'Infielder' }, ...extra })
const sign = (personId, club, date, r, match = 'EXACT', txId = personId) => ({ person_id: personId, club, date, description: `${club} signed free agent SS ${r.fullName}.`, transaction_id: txId, match, rec: r })
const entry = (over = {}) => ({ published_name: 'Juan Perez', published_position: 'SS', class_year: 2015, list_club: 'NYY', ...over })
const noRegister = () => null

test('no name-only resolution: without an official signing in the window a name never resolves', () => {
  const d = decideIdentity(entry(), [], noRegister)
  assert.equal(d.result, 'INSUFFICIENT_EVIDENCE')
  assert.match(d.reason, /No official signing transaction/)
})

test('a single official signing with the listed club, a plausible birth year and an agreeing position resolves, with every signal recorded', () => {
  const d = decideIdentity(entry(), [sign(1, 'NYY', '2015-07-02', rec(1, 'Juan Perez', '1998-11-01'))], () => ({ birth: '1998-11-01', bbref: null }))
  assert.equal(d.result, 'RESOLVED')
  assert.equal(d.mlb_id, '1')
  assert.deepEqual(d.signing, { club: 'NYY', date: '2015-07-02', description: 'NYY signed free agent SS Juan Perez.' })
  assert.equal(d.signals.length, 6)
})

test('conflicts stay unresolved: two persons with the listed club, a different club only, a register birth-date disagreement, a stored-country disagreement', () => {
  const a = rec(1, 'Juan Perez', '1998-11-01'), b = rec(2, 'Juan Perez', '1999-01-05')
  assert.equal(decideIdentity(entry(), [sign(1, 'NYY', '2015-07-02', a), sign(2, 'NYY', '2015-08-01', b)], noRegister).result, 'CONFLICT')
  const other = decideIdentity(entry(), [sign(1, 'BOS', '2015-07-02', a)], noRegister)
  assert.equal(other.result, 'CONFLICT'); assert.match(other.reason, /The list names NYY; the only matching official signing is with BOS/)
  assert.equal(decideIdentity(entry(), [sign(1, 'NYY', '2015-07-02', a)], () => ({ birth: '1998-11-02', bbref: null })).result, 'CONFLICT')
  const country = decideIdentity(entry({ stored_country: 'Venezuela' }), [sign(1, 'NYY', '2015-07-02', a)], noRegister)
  assert.equal(country.result, 'CONFLICT'); assert.match(country.reason, /stays open/)
})

test('a namesake who signed with another club is set aside when the listed club has the player; a voided first contract keeps the listed club', () => {
  const a = rec(1, 'Juan Perez', '1998-11-01'), b = rec(2, 'Juan Perez', '1998-03-01')
  const d = decideIdentity(entry(), [sign(2, 'BOS', '2015-07-02', b), sign(1, 'NYY', '2015-07-03', a)], noRegister)
  assert.equal(d.result, 'RESOLVED'); assert.equal(d.mlb_id, '1')
  assert.equal(d.candidates_considered.length, 2, 'the namesake is recorded as considered')
  const twice = decideIdentity(entry(), [sign(1, 'NYY', '2015-07-02', a, 'EXACT', 1), sign(1, 'PHI', '2016-07-05', a, 'EXACT', 2)], noRegister)
  assert.equal(twice.signing.club, 'NYY'); assert.equal(twice.other_signings_in_window.length, 1)
})

test('a spelling variant resolves only together with the list naming the same club; birth year and position must fit', () => {
  const r = rec(1, 'Leody Taveras', '1998-09-08', { primaryPosition: { abbreviation: 'CF', type: 'Outfielder' } })
  assert.equal(nameMatch('Leodys Taveras', ['Leody Taveras']), 'VARIANT')
  assert.equal(decideIdentity(entry({ published_name: 'Leodys Taveras', published_position: 'OF', list_club: 'TEX' }), [sign(1, 'TEX', '2015-07-02', r, 'VARIANT')], noRegister).result, 'RESOLVED')
  assert.equal(decideIdentity(entry({ published_name: 'Leodys Taveras', published_position: 'OF', list_club: null }), [sign(1, 'TEX', '2015-07-02', r, 'VARIANT')], noRegister).result, 'INSUFFICIENT_EVIDENCE')
  assert.equal(decideIdentity(entry({ published_position: 'RHP' }), [sign(1, 'NYY', '2015-07-02', rec(1, 'Juan Perez', '1998-11-01'))], noRegister).result, 'INSUFFICIENT_EVIDENCE', 'a pitcher entry never matches a shortstop record')
  assert.equal(decideIdentity(entry(), [sign(1, 'NYY', '2015-07-02', rec(1, 'Juan Perez', '1975-01-01'))], noRegister).result, 'INSUFFICIENT_EVIDENCE', 'a birth year implausible for the class never matches')
})

test('name rules: accents and spacing are equal, the maternal surname counts, a middle name does not, and the transaction wording is read', () => {
  assert.equal(nameMatch('Andres Gimenez', ['Andrés Giménez']), 'EXACT')
  assert.equal(nameMatch('Emmanuel DeJesus', ['Enmanuel De Jesus']), 'VARIANT')
  const adolfo = { fullName: 'Micker Adolfo', firstName: 'Micker', middleName: 'Antony', lastName: 'Adolfo', nameMatrilineal: 'Zapata', useName: 'Micker' }
  assert.equal(nameMatch('Micker Zapata', recordedNames(adolfo, null)), 'EXACT')
  assert.equal(nameMatch('Micker Antony', recordedNames(adolfo, null)), null, 'a middle name is never a surname')
  assert.equal(describedName('St. Louis Cardinals signed free agent CF Jonathan Machado to a minor league contract.'), 'Jonathan Machado')
  assert.equal(isSigning({ typeCode: 'SGN', description: 'Atlanta Braves signed C Abraham Gutierrez.' }), true)
  assert.equal(isSigning({ typeCode: 'SGN', description: 'Team signed RHP X to a contract extension.' }), false)
})

test('Cuban route: prior professional play is CUBAN_PRO, a professional career begun at or after signing is CUBAN_AMATEUR, anything else is not established', () => {
  assert.equal(classifyCubanRoute({ seriesSentences: ['Robert played in the Cuban National Series for Ciego de Avila from 2013 to 2015.'], startSentences: [], proSeasonsBeforeSigning: [], signingYear: 2017 }), 'CUBAN_PRO')
  assert.equal(classifyCubanRoute({ seriesSentences: [], startSentences: [], proSeasonsBeforeSigning: [{ season: 2015, league: 'Caribbean Series' }], signingYear: 2016 }), 'CUBAN_PRO')
  assert.equal(classifyCubanRoute({ seriesSentences: [], startSentences: ['He began his professional career in 2017 with the Fort Wayne TinCaps.'], proSeasonsBeforeSigning: [], signingYear: 2016 }), 'CUBAN_AMATEUR')
  assert.equal(classifyCubanRoute({ seriesSentences: [], startSentences: [], proSeasonsBeforeSigning: [], signingYear: 2016 }), null)
  assert.equal(classifyCubanRoute({ seriesSentences: ['He never played in the Cuban National Series.'], startSentences: [], proSeasonsBeforeSigning: [], signingYear: 2016 }), null)
})

// ---- the committed research --------------------------------------------------------------------------------------------------------

test('the source cohorts are the official lists exactly: 30 ranked members each, with capture URLs, timestamps and hashes', () => {
  assert.deepEqual(cohorts.cohorts.map((c) => [c.population_key, c.list_size, c.members.length, c.list_basis]),
    [['MLB-2015-PIPELINE-TOP30', 30, 30, 'PRE_SIGNING_LIST'], ['MLB-2016-PIPELINE-TOP30', 30, 30, 'SIGNING_PERIOD_LIST']])
  for (const c of cohorts.cohorts) {
    assert.deepEqual(c.members.map((m) => m.rank), Array.from({ length: 30 }, (_, i) => i + 1))
    assert.match(c.list_capture.url, /^https:\/\/web\.archive\.org\/web\/\d{14}id_\/http:\/\/(m|www)\.mlb\.com(:80)?\/gen\/players\/prospects\/\d{4}\/playerProspects\.json$/)
    assert.match(c.list_capture.sha256, /^[0-9a-f]{64}$/)
  }
  // the 2015 list predates the signing period: every 2015 signing is dated after the list
  const listDate = cohorts.cohorts[0].list_capture.last_updated.slice(0, 10)
  for (const p of research.newPlayers.filter((x) => x.population_key === 'MLB-2015-PIPELINE-TOP30')) assert.ok(p.signing.date > listDate, `${p.slug} signed after the pre-signing list`)
  // the later revisions are recorded beside the cohorts, never as them: the 2015 list was re-ranked (seven Cuban signees added, seven dropped);
  // the 2016 list kept its members and only lost the clubs of the four voided Atlanta contracts
  const [r15, r16] = cohorts.later_revisions
  assert.deepEqual([r15.added_in_revision.length, r15.dropped_in_revision.length], [7, 7])
  assert.deepEqual([r16.added_in_revision.length, r16.dropped_in_revision.length], [0, 0])
  assert.deepEqual(r16.club_changes.map((c) => [c.cohort_club, c.revision_club]), [['ATL', null], ['ATL', null], ['ATL', null], ['ATL', null]])
})

test('every resolved identity rests on an official signing transaction, and a variant only on the list naming the same club', () => {
  for (const e of identity.entries.filter((x) => x.result === 'RESOLVED')) {
    assert.ok(e.signing?.date && e.signing?.club && /signed/.test(e.signing.description), `${e.published_name}: official signing`)
    assert.ok(e.birth_date, `${e.published_name}: birth date`)
    if (e.register_birth_date) assert.equal(e.register_birth_date, e.birth_date)
    if (e.name_match === 'VARIANT') assert.equal(e.list_club, e.signing.club, `${e.published_name}: a variant needs the listed club`)
  }
})

test('the legacy five are reported one by one', () => {
  const legacy = Object.fromEntries(identity.entries.filter((e) => e.cohort === 'LEGACY_035').map((e) => [e.slug, [e.result, e.mlb_id ?? null]]))
  assert.deepEqual(legacy, {
    'emmanuel-dejesus': ['RESOLVED', '646241'], 'micker-zapata': ['RESOLVED', '650520'], 'yeyson-yrizarry': ['CONFLICT', null],
    'yeremy-rosario': ['INSUFFICIENT_EVIDENCE', null], 'jonathan-amundaray': ['INSUFFICIENT_EVIDENCE', null],
  })
  assert.deepEqual(decisions.legacy.map((l) => [l.slug, l.result]).sort(), [['emmanuel-dejesus', 'RESOLVED'], ['jonathan-amundaray', 'INSUFFICIENT_EVIDENCE'],
    ['micker-zapata', 'RESOLVED'], ['yeremy-rosario', 'INSUFFICIENT_EVIDENCE'], ['yeyson-yrizarry', 'CONFLICT']])
})

test('membership decisions: every listed player has exactly one; Dodgers signings are mapped, never added; one player per person', () => {
  const by = (k) => decisions.list_members.filter((d) => d.decision === k)
  assert.equal(decisions.list_members.length, 60)
  assert.equal(by('BENCHMARK_SIGNING_ADDED').length, 54)
  assert.deepEqual(by('MAPPED_TO_EXISTING_DODGERS_SIGNING').map((d) => [d.slug, d.rank]), [['starling-heredia', 3], ['ronny-brito', 18]])
  assert.deepEqual(by('ROUTE_NOT_ESTABLISHED').map((d) => d.published_name).sort(), ['Jonathan Machado', 'Lazaro Armenteros', 'Yanio Perez'])
  assert.deepEqual(by('IDENTITY_INSUFFICIENT_EVIDENCE').map((d) => d.published_name), ['Christopher Martinez'])
  assert.equal(research.newPlayers.some((p) => p.signing.org === 'LAD'), false, 'no benchmark copy of a Dodgers signing')
  assert.equal(new Set(research.newPlayers.map((p) => p.mlb_id)).size, research.newPlayers.length)
  assert.equal(research.dodgersEvaluations.length, 0, 'the Dodgers signings already carry an MLB Pipeline rank; they are not touched')
})

test('signing year is the official signing date\'s year, never the list year; aliases keep the published spelling', () => {
  for (const p of research.newPlayers) assert.equal(p.signing.year, Number(p.signing.date.slice(0, 4)))
  const robert = research.newPlayers.find((p) => p.mlb_id === '673357')
  assert.deepEqual([robert.population_key, robert.signing.year], ['MLB-2016-PIPELINE-TOP30', 2017])
  const withAlias = research.newPlayers.filter((p) => p.alias)
  assert.ok(withAlias.length > 0)
  for (const p of withAlias) assert.notEqual(p.alias, p.full_name)
  assert.ok(withAlias.some((p) => p.alias === 'Leodys Taveras' && p.full_name === 'Leody Taveras'))
})

test('no WAR, no bonus and no market are invented: reachers have no career bWAR, bonuses stay unknown, a non-Latin birth country gives no market', () => {
  for (const p of research.newPlayers) {
    assert.equal(p.outcome?.career_bwar, undefined, `${p.slug}: no career bWAR field is written`)
    assert.equal(p.signing.bonus, undefined)
  }
  const guerrero = research.newPlayers.find((p) => p.mlb_id === '665489')
  assert.deepEqual([guerrero.birth_country, guerrero.signing.country_market, guerrero.signing.pathway], ['Canada', null, 'OTHER'])
  const pro = research.newPlayers.filter((p) => p.signing.pathway === 'CUBAN_PRO')
  assert.equal(pro.length, 9)
  for (const p of pro) assert.ok(p.signing.route?.source_url && p.signing.route.note, `${p.slug}: the route is evidenced`)
})

// ---- the evaluation ----------------------------------------------------------------------------------------------------------------

test('evaluation: the 041 method re-run, unchanged thresholds, a new fingerprint, and no fitted model supported', () => {
  for (const t of targets041) assert.deepEqual([t.min_reference_n, t.min_positives, t.min_negatives, t.events_per_feature], [50, 10, 10, 10])
  assert.notEqual(evaluation.fingerprint, evaluation041.fingerprint)
  assert.deepEqual(evaluation.failures, [])
  assert.deepEqual(evaluation.evaluations.map((e) => e.model_key), evaluation041.evaluations.map((e) => e.model_key))
  for (const e of evaluation.evaluations) {
    const old = evaluation041.evaluations.find((x) => x.model_key === e.model_key)
    assert.deepEqual([e.feature_list, e.validation_method, e.target_key, e.training_populations], [old.feature_list, old.validation_method, old.target_key, old.training_populations])
    assert.notEqual(e.decision, 'MODEL_SUPPORTED')
  }
  const logit = evaluation.evaluations.find((e) => e.model_key === 'LOGISTIC_L2')
  assert.match(logit.decision_reason, /^INSUFFICIENT_EVENTS: 19 positives for 6 feature\(s\); at least 60 are required/)
})

// ---- product -------------------------------------------------------------------------------------------------------------------------

const benchRow = (over = {}) => ({ signing_year: 2015, population_keys: ['MLB-2015-PIPELINE-TOP30'], outcome_audited: true, reached_mlb_verified: false, pathway: 'LATAM_AMATEUR', ...over })

test('benchmark sample summary: per source list, counts with denominators, signing years apart from the list year, never a rate', () => {
  const rows = [benchRow(), benchRow({ reached_mlb_verified: true }), benchRow({ outcome_audited: false, reached_mlb_verified: null }),
    benchRow({ signing_year: 2017, population_keys: ['MLB-2016-PIPELINE-TOP30'], pathway: 'CUBAN_PRO', reached_mlb_verified: true })]
  const coverage = [{ coverage_type: 'TOP_PROSPECT_SAMPLE', abbreviation: null, period_start_year: 2015, expected_signings: 30 }, { coverage_type: 'TOP_PROSPECT_SAMPLE', abbreviation: null, period_start_year: 2016, expected_signings: 30 }]
  const s = benchmarkClassSummary(rows, coverage)
  assert.deepEqual(s.map((c) => [c.class_year, c.list_size, c.benchmark_signings, c.audited, c.reached_mlb, c.audited_no_mlb, c.not_audited, c.professional_route]),
    [[2015, 30, 3, 2, 1, 1, 1, 0], [2016, 30, 1, 1, 1, 0, 0, 1]])
  assert.deepEqual(s[1].signing_years, { 2017: 1 }, 'a 2016-list player signed in 2017 is counted in its signing year')
  assert.equal(benchmarkClassOf({ population_keys: [], signing_year: 2013 }), 2013)
  for (const c of s) assert.doesNotMatch(c.statement, /%|rate/i)
})

test('label coverage: the benchmark reference rows only; a supported benchmark target is labelled as a reference result, never a Dodgers probability', () => {
  const rows = [{ target_key: 'REACH', target_label: 'Reach', reference_population: 'TOP_PROSPECT_SAMPLE', labelled_n: 90, positive_n: 19, negative_n: 71, unaudited_n: 3, censored_n: 0, baseline_supported: true },
    { target_key: 'REACH', reference_population: DODGERS_REFERENCE_POPULATION, labelled_n: 25, baseline_supported: false }]
  const l = benchmarkLabelCoverage(rows)
  assert.equal(l.length, 1)
  assert.match(l[0].statement, /never a Dodgers probability/)
})

test('readiness: a benchmark-only baseline never makes the player-probability layer supported; the Dodgers population alone does', () => {
  const status = { tracked_signings: 220, outcome_audit_queue: 127, outcome_audits_completed: 93 }
  const t = (pop, supported) => ({ target_key: 'REACH', reference_population: pop, baseline_supported: supported, labelled_n: 90, positive_n: 19, negative_n: 71, unaudited_n: 0,
    min_reference_n: 50, min_positives: 10, min_negatives: 10, additional_labels_needed: 0, additional_positives_needed: 0, additional_negatives_needed: 0 })
  const benchOnly = readinessBlockers({ status, targets: [t('TOP_PROSPECT_SAMPLE', true), { ...t(DODGERS_REFERENCE_POPULATION, false), labelled_n: 25, additional_labels_needed: 25, additional_positives_needed: 8 }] })
  const layer = benchOnly.layers.find((l) => l.key === 'OUTCOME_PROBABILITIES')
  assert.equal(layer.state, 'NOT_SUPPORTED')
  assert.ok(layer.facts.some((f) => f.code === 'BENCHMARK_REFERENCE_BASELINE_SUPPORTED' && /never used for a Dodgers player/.test(f.statement)))
  assert.match(layer.facts.find((f) => f.code === 'SUPPORTED_TARGETS').statement, /^0 of 1 Dodgers targets/)
  assert.ok(layer.blockers.every((b) => b.target.endsWith(` / ${DODGERS_REFERENCE_POPULATION}`)), 'only the Dodgers population blocks Dodgers probabilities')
  const dodgers = readinessBlockers({ status, targets: [t(DODGERS_REFERENCE_POPULATION, true)] })
  assert.equal(dodgers.layers.find((l) => l.key === 'OUTCOME_PROBABILITIES').state, 'SUPPORTED')
})

test('pages: the benchmark is a rank-selected sample, never a census or a rate; readiness separates benchmark from Dodgers support', () => {
  const league = fs.readFileSync(path.join(root, 'app/league/page.js'), 'utf8')
  assert.match(league, /Rank-selected sample, not a census/)
  assert.match(league, /Among this MLB Pipeline Top 30 benchmark sample only/)
  assert.match(league, /Benchmark support is not Dodgers support/)
  assert.doesNotMatch(league, /of international signings reach|league-wide rate|hit rate is/i)
  const readiness = fs.readFileSync(path.join(root, 'app/prediction-readiness/page.js'), 'utf8')
  assert.match(readiness, /Benchmark support is not Dodgers support/)
  assert.match(readiness, /Benchmark reference only; never a Dodgers probability/)
  assert.match(readiness, /Supported Dodgers outcome targets/)
})
