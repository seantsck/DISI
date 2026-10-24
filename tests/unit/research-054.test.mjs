// 054 (full-career transaction history): the chronology rule reading career history beside the Dodgers ledger, the mechanisms kept apart, the
// hotfix and 053 cases unchanged, and the research artifacts (the workset, the transitions, the evidence, the migration values, before/after).
//   DODGERS ASSET TRANSACTION != GENERAL CAREER TRANSACTION   THIRD-PARTY TRADE != DODGERS TRADE   THIRD-PARTY RELEASE != DODGERS RELEASE
//   THIRD-PARTY SIGNING != DODGERS ACQUISITION   KNOWN CAREER MOVE != COMPLETE CAREER TRANSACTION HISTORY   TEAM CHANGE != CANONICAL TRANSACTION

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRACKETED_STATES, TRANSACTION_LAYERS, multiOrganizationClass, multiOrganizationSeasons, needCauses } from '../../lib/research/development-chronology.js'
import { chronologyTransactions } from '../../lib/research/dataset.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'database/research/054', f), 'utf8'))

const stint = (season, org, abbr, first, last, extra = {}) => ({ season, level: 'MLB', affiliated: true, stint_kind: 'TEAM_STINT', organization_name: org, organization_abbreviation: abbr,
  first_game_date: first, last_game_date: last, ...extra })
const career = (date, type, from, to, extra = {}) => ({ transaction_date: date, transaction_type: type, from_organization: from, to_organization: to, layer: 'CAREER_HISTORY',
  event_key: `CAREER_${date}_${type}`, ...extra })
const ledger = (date, type, from, to, extra = {}) => ({ transaction_date: date, transaction_type: type, from_organization: from, to_organization: to, layer: 'DODGERS_LEDGER', event_key: `L_${date}`, ...extra })
const kcSea = [stint(2022, 'Kansas City Royals', 'KC', '2022-04-07', '2022-06-26'), stint(2022, 'Seattle Mariners', 'SEA', '2022-06-28', '2022-10-05')]
const minSf = [stint(2025, 'Minnesota Twins', 'MIN', '2025-04-01', '2025-06-29'), stint(2025, 'San Francisco Giants', 'SFG', '2025-09-01', '2025-09-06')]

test('a direct third-party trade between the two clubs, inside the dated bracket, closes the chronology as career history', () => {
  const [m] = multiOrganizationSeasons(kcSea, [career('2022-06-27', 'TRADE', 'KC', 'SEA')])
  assert.equal(m.state, 'BRACKETED_BY_CAREER_HISTORY')
  assert.equal(m.transaction.layer, TRANSACTION_LAYERS.CAREER_HISTORY)
  assert.equal(multiOrganizationClass(m.state), 'NOT_A_GAP')
  assert.ok(BRACKETED_STATES.includes(m.state))
  // outside the bracket it does not close; in the wrong direction it does not either
  assert.equal(multiOrganizationSeasons(kcSea, [career('2022-07-02', 'TRADE', 'KC', 'SEA')])[0].state, 'DATES_DO_NOT_BRACKET_TRANSACTION')
  assert.equal(multiOrganizationSeasons(kcSea, [career('2022-06-27', 'TRADE', 'SEA', 'KC')])[0].state, 'DATES_DO_NOT_BRACKET_TRANSACTION')
})

test('a release and a later signing are two facts: both inside the bracket and in order, never one synthetic trade', () => {
  const rel = career('2025-07-23', 'RELEASE', 'MIN', null)
  const sign = career('2025-07-29', 'FREE_AGENT_SIGNING', null, 'SFG')
  const [m] = multiOrganizationSeasons(minSf, [rel, sign])
  assert.equal(m.state, 'BRACKETED_BY_CAREER_HISTORY')
  assert.deepEqual(m.career_events.map((e) => [e.type, e.from, e.to]), [['RELEASE', 'Minnesota Twins', null], ['FREE_AGENT_SIGNING', null, 'San Francisco Giants']])
  assert.ok(!m.career_events.some((e) => e.type === 'TRADE'))
  // either fact alone does not close a move between two other clubs
  assert.equal(multiOrganizationSeasons(minSf, [rel])[0].state, 'DATES_DO_NOT_BRACKET_TRANSACTION')
  assert.equal(multiOrganizationSeasons(minSf, [sign])[0].state, 'DATES_DO_NOT_BRACKET_TRANSACTION')
  // a signing before the release is not the move
  assert.equal(multiOrganizationSeasons(minSf, [career('2025-07-29', 'RELEASE', 'MIN', null), career('2025-07-23', 'FREE_AGENT_SIGNING', null, 'SFG')])[0].state, 'DATES_DO_NOT_BRACKET_TRANSACTION')
})

test('a team change with no recorded move stays open; a Dodgers trade that is not this move is not read as one', () => {
  assert.equal(multiOrganizationSeasons(minSf, [])[0].state, 'NO_CANONICAL_TRANSACTION')
  // Cartaya's January trade to Minnesota is the Dodgers ledger's; it says nothing about Minnesota -> San Francisco
  assert.equal(multiOrganizationSeasons(minSf, [ledger('2025-01-09', 'TRADE', 'LAD', 'MIN')])[0].state, 'NO_CANONICAL_TRANSACTION')
  const [cause] = needCauses([{ player_id: 'p', need: 'ORGANIZATION', issues: ['MULTI_ORG_SEASON_UNVERIFIED'] }], () => minSf, () => [])
  assert.equal(cause.gap_class, 'TRANSACTION_BLOCKED')
})

test('a Dodgers-ledger row is read in the stream\'s player direction, exactly as 053 read it', () => {
  const lad = (season, first, last) => stint(season, 'Los Angeles Dodgers', 'LAD', first, last)
  const rincon = [lad(2021, '2021-05-04', '2021-07-18'), stint(2021, 'New York Mets', 'NYM', '2021-07-23', '2021-09-18')]
  assert.equal(multiOrganizationSeasons(rincon, [ledger('2021-07-21', 'TRADE', 'LAD', 'NYM')])[0].state, 'BRACKETED')
  const leon = [lad(2026, '2026-05-02', '2026-05-18'), stint(2026, 'Detroit Tigers', 'DET', '2026-07-28', '2026-08-17')]
  assert.equal(multiOrganizationSeasons(leon, [ledger('2026-05-21', 'RELEASE', 'LAD', null)])[0].state, 'BRACKETED_AT_DODGERS_BOUNDARY')
  const baez = [stint(2022, 'Houston Astros', 'HOU', '2022-04-08', '2022-04-19'), lad(2022, '2022-07-05', '2022-08-19')]
  assert.equal(multiOrganizationSeasons(baez, [ledger('2022-05-19', 'FREE_AGENT_SIGNING', null, 'LAD'), ledger('2022-08-20', 'RELEASE', 'LAD', null)])[0].state, 'BRACKETED_AT_DODGERS_BOUNDARY')
  // a Dodgers acquisition by trade reads counterparty -> Dodgers in the stream
  const chc = [stint(2023, 'Chicago Cubs', 'CHC', '2023-04-01', '2023-07-20'), lad(2023, '2023-07-29', '2023-09-30')]
  assert.equal(multiOrganizationSeasons(chc, [ledger('2023-07-26', 'TRADE', 'CHC', 'LAD')])[0].state, 'BRACKETED')
})

test('two explanations stay open for a person; a recorded move before dated game logs is source-limited; overlapping ranges go to a person', () => {
  const [m] = multiOrganizationSeasons(kcSea, [career('2022-06-27', 'TRADE', 'KC', 'SEA'), career('2022-06-27', 'WAIVER_CLAIM', 'KC', 'SEA', { event_key: 'X' })])
  assert.equal(m.state, 'MULTIPLE_POSSIBLE_TRANSACTIONS')
  const undated = [stint(1998, 'Toronto Blue Jays', 'TOR', null, null), stint(1998, 'Baltimore Orioles', 'BAL', null, null)]
  const [g] = multiOrganizationSeasons(undated, [career('1998-07-31', 'TRADE', 'TOR', 'BAL')])
  assert.equal(g.state, 'TRANSACTION_RECORDED_DATES_BEFORE_GAME_LOGS')
  assert.equal(multiOrganizationClass(g.state), 'SOURCE_LIMITED')
  // a move through a third club the same day (Fernandez 1963: Detroit -> Milwaukee -> New York) is two career rows, both recorded
  const fernandez = [stint(1963, 'Detroit Tigers', 'DET', null, null), stint(1963, 'New York Mets', 'NYM', null, null)]
  assert.equal(multiOrganizationSeasons(fernandez, [career('1963-05-08', 'TRADE', 'DET', 'ATL'), career('1963-05-08', 'TRADE', 'ATL', 'NYM', { event_key: 'Y' })])[0].state, 'TRANSACTION_RECORDED_DATES_BEFORE_GAME_LOGS')
  const castro = [stint(2008, 'Cincinnati Reds', 'CIN', '2008-04-04', '2008-04-17'), stint(2008, 'Baltimore Orioles', 'BAL', '2008-04-28', '2008-09-24'), stint(2008, 'Colorado Rockies', 'COL', '2008-05-05', '2008-07-14')]
  const [o] = multiOrganizationSeasons(castro, [])
  assert.equal(o.state, 'APPEARANCE_RANGES_OVERLAP')
  assert.equal(multiOrganizationClass(o.state), 'HUMAN_REVIEW')
})

test('chronology reads the 054 stream where a dataset carries it, else the Dodgers-ledger rows', () => {
  const a = [{ x: 1 }]
  const b = [{ y: 2 }]
  assert.equal(chronologyTransactions({ transactions: a, careerTransactions: b }), b)
  assert.equal(chronologyTransactions({ transactions: a, careerTransactions: [] }), a)
  assert.equal(chronologyTransactions({ transactions: a }), a)
})

test('the workset is the 16 transaction-blocked needs after 053; every open season was checked, and none involves the Dodgers', () => {
  const w = read('workset.json')
  assert.equal(w.needs.length, 16)
  assert.equal(w.all_later_organization_history, true)
  const t = read('transition-workset.json')
  assert.equal(t.count, 33)
  assert.ok(t.transitions.every((x) => x.events.length > 0 && x.safe_to_record))
})

test('the migration values: career moves only, never a Dodgers organization; the mechanism fixes the shape; two sources added, the rest reused', () => {
  const v = read('migration-values.json')
  assert.equal(v.events.length, 46)
  for (const e of v.events) {
    assert.ok(!['LAD', 'BRO'].includes(e.from) && !['LAD', 'BRO'].includes(e.to), e.key)
    if (['TRADE', 'WAIVER_CLAIM', 'PURCHASE'].includes(e.type)) assert.ok(e.from && e.to && e.from !== e.to, e.key)
    if (e.type === 'RELEASE') assert.ok(e.from && !e.to, e.key)
    if (e.type === 'FREE_AGENT_SIGNING') assert.ok(!e.from && e.to, e.key)
    assert.match(e.source_reference, /^(MLB transaction|Retrosheet transaction) \d+$/)
  }
  assert.deepEqual(v.sources.map((s) => s.url), ['https://statsapi.mlb.com/api/v1/transactions?playerId=120221', 'https://statsapi.mlb.com/api/v1/transactions?playerId=467793'])
  assert.ok(v.existing_source_urls.includes('https://www.retrosheet.org/transactions/tranDB.zip'))
})

test('before and after: every closure maps to recorded career moves; the Dodgers ledger queues do not move', () => {
  const d = read('development-before-after.json')
  assert.deepEqual([d.before.needs, d.after.needs, d.before.gap_classes.TRANSACTION_BLOCKED, d.after.gap_classes.TRANSACTION_BLOCKED], [108, 104, 16, 0])
  assert.deepEqual(d.resolved.map((r) => r.player_slug).sort(), ['carlos-santana', 'diego-cartaya', 'eddys-leonard', 'yasiel-puig'])
  for (const n of d.needs.filter((x) => x.after === 'CLOSED')) for (const s of n.seasons) {
    assert.equal(s.after, 'BRACKETED_BY_CAREER_HISTORY', `${n.player_slug} ${s.season}`)
    assert.ok(s.events.length >= 1)
  }
  assert.deepEqual(d.dodgers_ledger, { before: { transaction_queue: 58, value_queue: 93 }, after: { transaction_queue: 58, value_queue: 93 } })
  assert.equal(d.needs.find((n) => n.player_slug === 'juan-castro').after, 'HUMAN_REVIEW')
})
