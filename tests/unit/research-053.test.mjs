// 053 (transaction and chronology resolution): the pure chronology rule read in the player's direction, the Dodgers end of a move, the
// mechanisms kept apart, the dossier hotfix cases, and the research artifacts (classification before any write, the workset, the evidence, the
// migration values and the before/after measures).
//   TEAM CHANGE != CANONICAL TRANSACTION   ORGANIZATION CHANGE != TRANSACTION TYPE   KNOWN EXIT DATE != KNOWN RETURN   RELEASE != TRADE
//   WAIVER CLAIM != TRADE   FREE-AGENT SIGNING != TRADE RETURN   SOURCE SILENCE != RELEASE   PTBNL COMPLETION DATE != ORIGINAL TRADE DATE

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRACKETED_STATES, DODGERS_ORGANIZATION_KEYS, isBracketedSeason, multiOrganizationClass, multiOrganizationSeasons, needCauses, playerMove } from '../../lib/research/development-chronology.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'database/research/053', f), 'utf8'))

const stint = (season, org, abbr, first, last, extra = {}) => ({ season, level: 'MLB', affiliated: true, stint_kind: 'TEAM_STINT', organization_name: org, organization_abbreviation: abbr,
  first_game_date: first, last_game_date: last, ...extra })
const lad = (season, first, last, extra) => stint(season, 'Los Angeles Dodgers', 'LAD', first, last, extra)
const tx = (date, type, side, to = null, extra = {}) => ({ transaction_date: date, transaction_type: type, player_side: side, from_organization: 'LAD', to_organization: to, event_key: `${type}_${date}`, ...extra })

test('a transaction moves the player in his own direction: the ledger is the Dodgers side, the asset side is the player\'s', () => {
  assert.deepEqual(DODGERS_ORGANIZATION_KEYS, ['BRO', 'LAD'])
  assert.deepEqual(playerMove(tx('2021-07-21', 'TRADE', 'OUTGOING', 'NYM')), { from: 'LAD', to: 'NYM' })
  assert.deepEqual(playerMove(tx('2000-07-26', 'TRADE', 'INCOMING', 'CHC')), { from: 'CHC', to: 'LAD' })
  // a release or a free agency has no counterparty; a free-agent signing has none either: the other end is another club's transaction
  assert.deepEqual(playerMove(tx('2026-05-21', 'RELEASE', 'OUTGOING')), { from: 'LAD', to: null })
  assert.deepEqual(playerMove(tx('2022-05-19', 'FREE_AGENT_SIGNING', 'INCOMING')), { from: null, to: 'LAD' })
  // a row without the Dodgers side is not a ledger row
  assert.equal(playerMove({ to_organization: 'CLE' }), null)
})

test('an acquisition by trade brackets the season from the counterparty to the Dodgers (the 052 rule read it backwards)', () => {
  const st = [stint(2023, 'Chicago Cubs', 'CHC', '2023-04-01', '2023-07-20'), lad(2023, '2023-07-29', '2023-09-30')]
  const [m] = multiOrganizationSeasons(st, [tx('2023-07-26', 'TRADE', 'INCOMING', 'CHC')])
  assert.equal(m.state, 'BRACKETED')
  assert.deepEqual([m.transaction.from, m.transaction.to], ['Chicago Cubs', 'Los Angeles Dodgers'])
  // the same trade read as the ledger columns say (Dodgers -> Cubs) would not bracket; the direction is the player's
  const [w] = multiOrganizationSeasons(st, [tx('2023-07-26', 'TRADE', 'OUTGOING', 'CHC')])
  assert.equal(w.state, 'DATES_DO_NOT_BRACKET_TRANSACTION')
})

test('the Dodgers end of a move: a release, a free agency or a free-agent signing inside the bracket; never a trade, never the other club\'s signing', () => {
  // Edgar Leon 2026: last Dodgers game 2026-05-18, released 2026-05-21, first Tigers game 2026-07-28
  const leon = [lad(2026, '2026-05-02', '2026-05-18'), stint(2026, 'Detroit Tigers', 'DET', '2026-07-28', '2026-08-17')]
  const [l] = multiOrganizationSeasons(leon, [tx('2026-05-21', 'RELEASE', 'OUTGOING')])
  assert.deepEqual([l.state, l.transaction.type, l.dodgers_involved], ['BRACKETED_AT_DODGERS_BOUNDARY', 'RELEASE', true])
  assert.notEqual(l.state, 'BRACKETED', 'RELEASE != TRADE')
  // Pedro Baez 2022: last Astros game 2022-04-19, Dodgers signing 2022-05-19, first Dodgers game 2022-07-05; the later Dodgers release is not this move
  const baez = [stint(2022, 'Houston Astros', 'HOU', '2022-04-08', '2022-04-19'), lad(2022, '2022-07-05', '2022-08-19')]
  const release = tx('2022-08-20', 'RELEASE', 'OUTGOING')
  assert.equal(multiOrganizationSeasons(baez, [release])[0].state, 'NO_CANONICAL_TRANSACTION', 'a Dodgers exit after a season that ended with the Dodgers is a later exit')
  const [b] = multiOrganizationSeasons(baez, [release, tx('2022-05-19', 'FREE_AGENT_SIGNING', 'INCOMING')])
  assert.deepEqual([b.state, b.transaction.type, b.transaction.date], ['BRACKETED_AT_DODGERS_BOUNDARY', 'FREE_AGENT_SIGNING', '2022-05-19'])
  // a signing outside the bracket does not close it
  assert.equal(multiOrganizationSeasons(baez, [tx('2022-07-10', 'FREE_AGENT_SIGNING', 'INCOMING')])[0].state, 'DATES_DO_NOT_BRACKET_TRANSACTION')
  for (const s of BRACKETED_STATES) assert.equal(multiOrganizationClass(s), 'NOT_A_GAP')
  assert.ok(isBracketedSeason(l) && isBracketedSeason(b))
})

test('a waiver claim keeps its own mechanism; two possible transactions stay open for a person to decide', () => {
  const st = [lad(2013, '2013-04-01', '2013-06-10'), stint(2013, 'Boston Red Sox', 'BOS', '2013-06-20', '2013-09-28')]
  const [w] = multiOrganizationSeasons(st, [tx('2013-06-15', 'WAIVER', 'OUTGOING', 'BOS')])
  assert.deepEqual([w.state, w.transaction.type], ['BRACKETED', 'WAIVER'], 'WAIVER CLAIM != TRADE: the mechanism is kept')
  const [m] = multiOrganizationSeasons(st, [tx('2013-06-12', 'RELEASE', 'OUTGOING'), tx('2013-06-15', 'WAIVER', 'OUTGOING', 'BOS')])
  assert.equal(m.state, 'MULTIPLE_POSSIBLE_TRANSACTIONS')
  assert.equal(multiOrganizationClass(m.state), 'HUMAN_REVIEW')
  // the same transaction read twice (a package row and its legacy row) is one transaction
  const t = tx('2013-06-15', 'WAIVER', 'OUTGOING', 'BOS')
  assert.equal(multiOrganizationSeasons(st, [t, { ...t }])[0].state, 'BRACKETED')
})

test('a team change between two other clubs is later organization history: no Dodgers transaction brackets it, and none is invented', () => {
  // Diego Cartaya 2025: traded LAD -> MIN in January, then Twins (St. Paul) and Giants (San Jose); the official log's Twins release and Giants
  // signing are other clubs' transactions
  const cartaya = [stint(2025, 'Minnesota Twins', 'MIN', '2025-04-01', '2025-06-29', { level: 'AAA' }), stint(2025, 'San Francisco Giants', 'SF', '2025-09-01', '2025-09-06', { level: 'LOW_A' })]
  const [c] = multiOrganizationSeasons(cartaya, [tx('2025-01-09', 'TRADE', 'OUTGOING', 'MIN')])
  assert.deepEqual([c.state, c.transaction, c.dodgers_involved], ['NO_CANONICAL_TRANSACTION', null, false])
  const [cause] = needCauses([{ player_id: 'p', need: 'ORGANIZATION', issues: ['MULTI_ORG_SEASON_UNVERIFIED'] }], () => cartaya, () => [tx('2025-01-09', 'TRADE', 'OUTGOING', 'MIN')])
  assert.equal(cause.gap_class, 'TRANSACTION_BLOCKED')
  assert.match(cause.cause, /2025 \(NO_CANONICAL_TRANSACTION, later organization history\)/)
  assert.match(cause.closes_with, /not a Dodgers transaction/)
})

test('the dossier hotfix cases: a trade recorded only as its PACKAGE_EVENT row brackets the season (Rincon 2021, Santana 2008)', () => {
  const rincon = [lad(2021, '2021-05-04', '2021-07-18', { level: 'AA' }), stint(2021, 'New York Mets', 'NYM', '2021-07-23', '2021-09-18', { level: 'AA' })]
  const [r] = multiOrganizationSeasons(rincon, [tx('2021-07-21', 'TRADE', 'OUTGOING', 'NYM', { record_kind: 'PACKAGE_EVENT', event_key: 'LAD_NYM_2021_CARLOS_RINCON' })])
  assert.deepEqual([r.state, r.transaction.event_key], ['BRACKETED', 'LAD_NYM_2021_CARLOS_RINCON'])
  const santana = [lad(2008, '2008-04-03', '2008-07-24', { level: 'HIGH_A' }), stint(2008, 'Cleveland Guardians', 'CLE', '2008-07-28', '2008-09-01', { level: 'HIGH_A' })]
  const [s] = multiOrganizationSeasons(santana, [tx('2008-07-26', 'TRADE', 'OUTGOING', 'CLE', { record_kind: 'PACKAGE_EVENT', event_key: 'LAD_CLE_2008_SANTANA_BLAKE' })])
  assert.equal(s.state, 'BRACKETED')
})

test('the classification exists before any write, and covers every open season of the 18 transaction-blocked needs', () => {
  const c = read('transaction-blocker-classification.json')
  assert.deepEqual(c.classes, ['MISSING_EVENT', 'EVENT_PRESENT_DATE_INSUFFICIENT', 'EVENT_PRESENT_TYPE_INSUFFICIENT', 'EVENT_PRESENT_DESTINATION_INSUFFICIENT', 'PACKAGE_MEMBERSHIP_OPEN',
    'PTBNL_OPEN', 'TERMS_OPEN', 'SOURCE_LIMITED', 'NOT_A_TRANSACTION_GAP'])
  assert.equal(Object.values(c.counts).reduce((a, b) => a + b, 0), c.seasons.length)
  const base = read('baseline.json')
  assert.equal(base.development.transaction_blocked, 18)
  assert.equal(new Set(c.seasons.map((s) => s.player_slug)).size, 18)
  // every write concerns a Dodgers season; a move between two other clubs is never written
  for (const s of c.seasons) if (s.canonical_write.length) assert.equal(s.scope, 'DODGERS_TRANSACTION', `${s.player_slug} ${s.season}`)
  assert.ok(c.seasons.filter((s) => s.scope === 'LATER_ORGANIZATION_HISTORY').every((s) => s.canonical_write.length === 0))
  assert.equal(c.seasons.find((s) => s.player_slug === 'edgar-leon').class, 'NOT_A_TRANSACTION_GAP')
})

test('the migration values: Dodgers transactions only, each with its evidence, exact dates, no amount, no observation and no new source', () => {
  const v = read('migration-values.json')
  assert.equal(v.events.length, 10)
  assert.ok(!('observations' in v) && !('sources' in v))
  for (const e of v.events) {
    assert.equal(e.from, 'LAD')
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(v.existing_source_urls.includes(e.source_url), e.key)
    assert.match(e.description, /MLB transaction log|Retrosheet transaction/)
    if (e.type === 'FREE_AGENT_SIGNING') assert.deepEqual([e.to, e.assets.map((a) => a.side)], ['', ['INCOMING']], e.key)
    if (e.type === 'FREE_AGENCY') assert.deepEqual([e.to, e.assets.map((a) => a.side)], ['', ['OUTGOING']], e.key)
  }
  const viz = v.events.find((e) => e.key === 'LAD_NYY_2000_JOSE_VIZCAINO')
  assert.ok(viz.assets.some((a) => a.type === 'CASH' && !a.mlb_id), 'CASH AMOUNT UNKNOWN != CASH AMOUNT ZERO: the cash is recorded, its amount is not')
  assert.deepEqual(v.war_unavailable_mlb_ids, ['117747'])
})

test('the evidence keeps every source conflict and states what was read but not recorded, and why', () => {
  const ev = read('transaction-evidence.json')
  assert.equal(ev.sources.retrosheet.sha256_tran_txt, '8b117abe4505dd427893c7fbc5af94f89d83cb58d93b96c99136bab1d7d31c06', 'the same Retrosheet file 049 read')
  const castro = ev.conflicts.find((c) => c.subject === 'Juan Castro 2010 Dodgers signing')
  assert.deepEqual([castro.mlb_log.date, castro.retrosheet.date, castro.used], ['2010-08-03', '2010-07-27', '2010-08-03'])
  const [chain] = ev.stated_not_recorded
  assert.match(chain.why_not_recorded, /sealed/)
  assert.deepEqual(chain.stated.map((s) => s.date), ['2000-04-01', '2009-01-07', '2010-12-27', '2011-07-10'])
  for (const id of ev.identities) assert.match(id.matched, /birth date/)
})

test('before and after: every development reduction maps to a canonical write or the detector correction; the value queue is not advertised lower', () => {
  const d = read('development-needs-before-after.json')
  assert.deepEqual([d.before.needs, d.after.needs, d.before.gap_classes.TRANSACTION_BLOCKED, d.after.gap_classes.TRANSACTION_BLOCKED], [110, 108, 18, 16])
  assert.deepEqual(d.resolved.map((r) => r.player_slug).sort(), ['edgar-leon', 'pedro-baez'])
  assert.deepEqual(d.added, [])
  const ch = read('chronology-before-after.json')
  for (const c of ch.changed) assert.match(c.why, /Detector correction|Migration 053 records/)
  const leon = ch.changed.find((c) => c.season === 'edgar-leon|2026')
  assert.equal(leon.rule_only, 'BRACKETED_AT_DODGERS_BOUNDARY', 'the detector correction alone closes it: the release was already recorded')
  const t = read('transaction-needs-before-after.json')
  assert.deepEqual([t.before.items, t.after.items], [59, 58])
  for (const r of t.resolved) assert.ok(r.by.length, `${r.issue} ${r.event_key}: closed by a reviewed write`)
  const v = read('value-needs-before-after.json')
  assert.deepEqual([v.before.items, v.after.items, v.resolved.length], [91, 93, 0])
})
