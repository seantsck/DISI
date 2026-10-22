// DISI 049 research tooling: transaction truth, package truth, return identity and return value are four different things, and the first
// never waits for the last. The distinctions under test are core DISI principles:
//   KNOWN TRANSACTION != KNOWN RETURN VALUE      KNOWN PACKAGE != INDIVIDUALLY ATTRIBUTABLE VALUE      MISSING BWAR != ZERO BWAR
//   CASH AMOUNT UNKNOWN != CASH AMOUNT ZERO      PTBNL UNRESOLVED != NO PLAYER RETURN                  UNKNOWN TRANSACTION != RELEASED
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  BLOCKER_BUCKETS, CHAIN_WORK, ISSUE_BUCKET, ISSUE_CATEGORY, NEXT_EVIDENCE, TRANSACTION_CHAIN_STATUSES, VALUE_CHAIN_STATUSES, attributionLedger, attributionState,
  attributionStateCounts, attributionSummary, chainBlocker, incompleteChains, openPackages, packageBlockerSplit, packageCompleteness, transactionResearchItems,
} from '../../lib/research/transaction-research.js'
import { assetPath } from '../../lib/research/asset-path.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const decision = (over = {}) => ({
  signing_id: 's1', player_slug: 'p', full_name: 'P', signing_year: 2002, chain_status: 'COMPLETE_TERMINAL', realized_value_state: 'COMPLETE',
  direct_dodgers_bwar: 1, individually_attributable_trade_bwar: null, package_first_hop_participation_bwar: null, package_downstream_participation_bwar: null,
  observable_not_attributable_bwar: null, value_left_organization_bwar: null, ...over,
})

// ---- the three kinds of missing evidence ------------------------------------------------------------------------------------------

test('every research issue the database raises has a bucket and a next-evidence statement; nothing falls through to an unnamed bucket', () => {
  const issues = Object.keys(ISSUE_CATEGORY)
  assert.deepEqual(Object.keys(ISSUE_BUCKET).sort(), issues.slice().sort(), 'every categorised issue is bucketed')
  assert.deepEqual(Object.keys(NEXT_EVIDENCE).sort(), issues.slice().sort(), 'every issue says what would close it')
  for (const i of issues) assert.ok(BLOCKER_BUCKETS.includes(ISSUE_BUCKET[i]), i)
  // membership and chain blockers: DISI does not know what happened to the asset
  for (const i of ['TRADE_RETURN_UNRECORDED', 'PTBNL_UNRESOLVED', 'FUTURE_CONSIDERATIONS_UNRESOLVED', 'RETURN_ASSET_EXIT_MISSING', 'EXIT_NOT_RESEARCHED_DOWNSTREAM']) assert.equal(ISSUE_BUCKET[i], 'CHAIN_OR_MEMBERSHIP', i)
  // terms blockers: the players may be known; an amount is not
  for (const i of ['CASH_AMOUNT_UNKNOWN', 'POOL_SPACE_AMOUNT_UNKNOWN']) assert.equal(ISSUE_BUCKET[i], 'TERMS', i)
  // value blockers do not erase transaction truth
  for (const i of ['DOWNSTREAM_WAR_NOT_LOADED', 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED']) assert.equal(ISSUE_BUCKET[i], 'VALUE', i)
  // a missing amount is never described as zero and a withheld attribution is never described as work to do
  assert.match(NEXT_EVIDENCE.CASH_AMOUNT_UNKNOWN, /not \$0/)
  assert.match(NEXT_EVIDENCE.DOWNSTREAM_WAR_NOT_LOADED, /Baseball-Reference/)
  assert.match(NEXT_EVIDENCE.DOWNSTREAM_WAR_NOT_LOADED, /FanGraphs WAR cannot substitute/)
  assert.match(NEXT_EVIDENCE.TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED, /never split/)
})

test('chain statuses: a chain whose WAR is not loaded is value-blocked, not transaction-incomplete; the classification stores nothing', () => {
  assert.deepEqual([...TRANSACTION_CHAIN_STATUSES].sort(), ['INCOMPLETE_EXIT_NOT_RESEARCHED', 'INCOMPLETE_EXIT_UNRECORDED', 'INCOMPLETE_IDENTITY', 'INCOMPLETE_PENDING_CONSIDERATION', 'INCOMPLETE_RETURN_UNRECORDED'])
  assert.deepEqual([...VALUE_CHAIN_STATUSES].sort(), ['INCOMPLETE_TIMING', 'INCOMPLETE_WAR_NOT_LOADED'])
  for (const s of TRANSACTION_CHAIN_STATUSES) assert.equal(chainBlocker(s), 'CHAIN_OR_MEMBERSHIP', s)
  for (const s of VALUE_CHAIN_STATUSES) assert.equal(chainBlocker(s), 'VALUE', s)
  for (const s of ['COMPLETE_TERMINAL', 'STILL_ACTIVE', 'NO_TRADE_CHAIN']) assert.equal(chainBlocker(s), null, s)
  for (const s of [...TRANSACTION_CHAIN_STATUSES, ...VALUE_CHAIN_STATUSES]) assert.ok(CHAIN_WORK[s], `${s} has a work item`)
})

test('KNOWN TRANSACTION != KNOWN RETURN VALUE: a recorded chain with unloaded WAR is VALUE_NOT_DETERMINED, an open history is CHAIN_INCOMPLETE', () => {
  assert.equal(attributionState(decision({ chain_status: 'INCOMPLETE_WAR_NOT_LOADED' })), 'VALUE_NOT_DETERMINED')
  assert.equal(attributionState(decision({ chain_status: 'INCOMPLETE_TIMING' })), 'VALUE_NOT_DETERMINED')
  for (const s of TRANSACTION_CHAIN_STATUSES) assert.equal(attributionState(decision({ chain_status: s })), 'CHAIN_INCOMPLETE', s)
  // a NULL amount is never read as a recorded zero, whichever blocker applies
  for (const s of [...VALUE_CHAIN_STATUSES, ...TRANSACTION_CHAIN_STATUSES]) {
    assert.notEqual(attributionState(decision({ chain_status: s, individually_attributable_trade_bwar: null, package_first_hop_participation_bwar: null })), 'RECORDED_ZERO_RETURN', s)
  }
  // and a value blocker never turns into an attribution: nothing is individually attributed or package-level while the value is unknown
  assert.equal(attributionState(decision({ chain_status: 'INCOMPLETE_WAR_NOT_LOADED', individually_attributable_trade_bwar: 3 })), 'VALUE_NOT_DETERMINED')
})

test('the summary splits "incomplete" without changing what it meant: incomplete_chains still counts every INCOMPLETE_* chain', () => {
  const rows = [
    decision({ chain_status: 'INCOMPLETE_RETURN_UNRECORDED' }), decision({ chain_status: 'INCOMPLETE_EXIT_NOT_RESEARCHED' }),
    decision({ chain_status: 'INCOMPLETE_WAR_NOT_LOADED' }), decision({ chain_status: 'INCOMPLETE_WAR_NOT_LOADED' }), decision({ chain_status: 'COMPLETE_TERMINAL' }), decision({ chain_status: 'NO_TRADE_CHAIN' }),
  ]
  const a = attributionSummary(rows)
  assert.equal(a.incomplete_chains, 4)
  assert.equal(a.transaction_chains_incomplete, 2)
  assert.equal(a.value_blocked_chains, 2)
  assert.equal(a.transaction_chains_incomplete + a.value_blocked_chains, a.incomplete_chains)
  assert.deepEqual(attributionStateCounts(rows), { CHAIN_INCOMPLETE: 2, NOT_A_TRADE_EXIT: 1, RECORDED_ZERO_RETURN: 1, VALUE_NOT_DETERMINED: 2 })
})

test('incompleteChains: by default only chains whose transaction history is open; the value-blocked ones are asked for by name, in a stable order', () => {
  const rows = [
    decision({ player_slug: 'b', signing_year: 2002, chain_status: 'INCOMPLETE_WAR_NOT_LOADED' }), decision({ player_slug: 'a', signing_year: 1990, chain_status: 'INCOMPLETE_WAR_NOT_LOADED' }),
    decision({ player_slug: 'c', signing_year: 2007, chain_status: 'INCOMPLETE_PENDING_CONSIDERATION' }), decision({ player_slug: 'd', signing_year: 1986, chain_status: 'INCOMPLETE_RETURN_UNRECORDED' }),
    decision({ player_slug: 'e', chain_status: 'COMPLETE_TERMINAL' }),
  ]
  assert.deepEqual(incompleteChains(rows).map((r) => r.player_slug), ['c', 'd'])
  assert.deepEqual(incompleteChains(rows, { bucket: 'VALUE' }).map((r) => r.player_slug), ['a', 'b'])
  assert.deepEqual(incompleteChains(rows, { bucket: 'ALL' }).map((r) => r.player_slug), ['c', 'd', 'a', 'b'], 'ordered by chain status, then signing year')
  assert.deepEqual(incompleteChains(rows, { bucket: 'VALUE' }).map((r) => [r.work, r.attribution_state]), [['LOAD_BASEBALL_REFERENCE_WAR', 'VALUE_NOT_DETERMINED'], ['LOAD_BASEBALL_REFERENCE_WAR', 'VALUE_NOT_DETERMINED']])
  assert.deepEqual(incompleteChains([...rows].reverse(), { bucket: 'ALL' }), incompleteChains(rows, { bucket: 'ALL' }), 'input order does not matter')
})

// ---- packages -------------------------------------------------------------------------------------------------------------------------

const q = (issue, event_key, asset_name = null, priority = 2) => ({ issue, priority, player_slug: null, event_key, asset_name, detail: 'x' })
const queue = [
  q('CASH_AMOUNT_UNKNOWN', 'E_CASH_ONLY', 'Cash', 4), q('CASH_AMOUNT_UNKNOWN', 'E_BOTH', 'Cash', 4), q('FUTURE_CONSIDERATIONS_UNRESOLVED', 'E_BOTH', 'Future considerations', 3),
  q('PTBNL_UNRESOLVED', 'E_PTBNL', 'Player to be named later'), q('TRADE_RETURN_UNRECORDED', 'E_NONE'), q('POOL_SPACE_AMOUNT_UNKNOWN', 'E_POOL', 'Pool', 4),
  q('EXIT_NOT_RESEARCHED_DOWNSTREAM', 'E_CHAIN', 'Someone', 3), q('DOWNSTREAM_WAR_NOT_LOADED', 'E_VALUE', 'Someone Else', 3),
]

test('packages: membership and terms are different problems; a package is counted once and the two counts are not added', () => {
  const split = packageBlockerSplit({ transactionQueue: queue })
  assert.deepEqual(split, { packages_with_open_issues: 5, packages_with_open_membership: 3, packages_with_open_terms: 3, packages_with_only_open_terms: 2 })
  // E_BOTH is in both groups, so the groups overlap by design
  assert.ok(split.packages_with_open_membership + split.packages_with_only_open_terms === split.packages_with_open_issues)
  // package completeness is unchanged (it never counted chain or value issues as package issues)
  assert.equal(packageCompleteness({ transactionQueue: queue }).packages_with_open_issues, 5)
  assert.equal(packageBlockerSplit({}).packages_with_open_issues, 0)
})

test('openPackages: deterministic, membership first, every row says what would close it; a cash package says an unstated amount is not $0', () => {
  const a = openPackages({ transactionQueue: queue })
  const b = openPackages({ transactionQueue: [...queue].reverse() })
  assert.deepEqual(a, b, 'input order does not matter')
  assert.deepEqual(a.map((r) => r.event_key), ['E_NONE', 'E_PTBNL', 'E_BOTH', 'E_CASH_ONLY', 'E_POOL'].sort((x, y) => a.map((r) => r.event_key).indexOf(x) - a.map((r) => r.event_key).indexOf(y)))
  assert.deepEqual(a.map((r) => r.package_state), ['MEMBERSHIP_OPEN', 'MEMBERSHIP_OPEN', 'MEMBERSHIP_OPEN', 'TERMS_OPEN', 'TERMS_OPEN'])
  const cash = a.find((r) => r.event_key === 'E_CASH_ONLY')
  assert.match(cash.next_evidence, /not \$0/)
  assert.deepEqual(openPackages({ transactionQueue: queue }, { terms: true }).map((r) => r.event_key).sort(), ['E_BOTH', 'E_CASH_ONLY', 'E_POOL'])
  assert.deepEqual(openPackages({ transactionQueue: queue }, { membership: true }).map((r) => r.event_key).sort(), ['E_BOTH', 'E_NONE', 'E_PTBNL'])
  assert.deepEqual(openPackages({ transactionQueue: queue }, { issue: ['PTBNL_UNRESOLVED'] }).map((r) => r.event_key), ['E_PTBNL'])
  // chain and value issues are not package issues
  assert.ok(!a.some((r) => r.event_key === 'E_CHAIN' || r.event_key === 'E_VALUE'))
})

test('research items: bucket and issue filters are deterministic and carry the blocker and the next evidence; the default ordering is unchanged', () => {
  const data = { transactionQueue: queue, valueQueue: [{ issue: 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED', priority: 3, player_slug: 'x', event_key: null, detail: 'y' }] }
  const all = transactionResearchItems(data, {})
  assert.equal(all.length, 9)
  assert.ok(all.every((r) => BLOCKER_BUCKETS.includes(r.bucket) && r.next_evidence))
  assert.deepEqual(transactionResearchItems(data, { bucket: 'TERMS' }).map((r) => r.issue).sort(), ['CASH_AMOUNT_UNKNOWN', 'CASH_AMOUNT_UNKNOWN', 'POOL_SPACE_AMOUNT_UNKNOWN'])
  assert.deepEqual(transactionResearchItems(data, { bucket: 'VALUE' }).map((r) => r.issue).sort(), ['DOWNSTREAM_WAR_NOT_LOADED', 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED'])
  assert.deepEqual(transactionResearchItems(data, { issues: ['PTBNL_UNRESOLVED'] }).map((r) => r.event_key), ['E_PTBNL'])
  assert.deepEqual(transactionResearchItems({ ...data, transactionQueue: [...queue].reverse() }, {}), all)
  // the pre-049 priorities (priority, then return unrecorded, then player to be named, then the attribution rank) are intact
  assert.deepEqual(all.slice(0, 3).map((r) => r.issue), ['TRADE_RETURN_UNRECORDED', 'PTBNL_UNRESOLVED', 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED'])
})

test('attribution: a known package never implies attribution; a shared package stays package-level, a sole-outgoing trade whose WAR is unknown stays undetermined', () => {
  assert.equal(attributionState(decision({ chain_status: 'COMPLETE_TERMINAL', individually_attributable_trade_bwar: 0, package_first_hop_participation_bwar: 12.5 })), 'PACKAGE_LEVEL_ONLY')
  assert.equal(attributionState(decision({ chain_status: 'INCOMPLETE_WAR_NOT_LOADED', individually_attributable_trade_bwar: null, package_first_hop_participation_bwar: 12.5 })), 'VALUE_NOT_DETERMINED')
  const ledger = attributionLedger([decision({ chain_status: 'INCOMPLETE_WAR_NOT_LOADED', individually_attributable_trade_bwar: null }), decision({ signing_id: 's2', chain_status: 'NO_TRADE_CHAIN' })])
  assert.equal(ledger.length, 1)
  assert.equal(ledger[0].individually_attributable_trade_bwar, null, 'NULL stays NULL')
})

// ---- the dossier asset path -------------------------------------------------------------------------------------------------------

test('asset path: the returned players are named even when their value is unknown; naming them never values them', () => {
  const sg = { is_dodgers_franchise: true, signing_year: 2002, signing_date: '2002-10-17', reached_mlb_verified: true, mlb_debut_date: '2006-04-01', outcome_audit_status: 'VERIFIED_MLB' }
  const tx = [{ from_franchise_key: 'DODGERS', player_side: 'OUTGOING', record_kind: 'PACKAGE_EVENT', transaction_date: '2009-08-31', transaction_type: 'TRADE', to_organization: 'Arizona Diamondbacks',
    outgoing_asset_count: 1, incoming_asset_count: 1, attribution_status: 'SOLE_OUTGOING_ASSET', incoming_assets: [{ name: 'Jon Garland', slug: null }],
    description: 'Arizona sent Jon Garland on 2009-08-31 for a player to be named later; Tony Abreu was delivered 2009-10-09.' }]
  const steps = assetPath({ signings: [sg], devStints: [], devSummary: null, transactions: tx, realizedValue: [decision({ chain_status: 'INCOMPLETE_WAR_NOT_LOADED' })] })
  const by = Object.fromEntries(steps.map((s) => [s.key, s]))
  assert.equal(by.EXIT.state, 'RECORDED')
  assert.match(by.PACKAGE.detail, /1 asset out, 1 asset back/)
  assert.doesNotMatch(by.PACKAGE.detail, /shared package/, 'a sole-outgoing trade is not a shared package')
  assert.match(by.PACKAGE.detail, /2009-08-31/)
  assert.match(by.PACKAGE.detail, /2009-10-09/, 'the delivery date is part of the record')
  assert.equal(by.RETURNED.state, 'RECORDED')
  assert.equal(by.RETURNED.detail, 'Jon Garland')
  assert.equal(by.RETURN.state, 'UNKNOWN')
  assert.match(by.RETURN.detail, /transaction is recorded; the value of what came back is not determined/)
  assert.match(by.RETURN.detail, /unknown, not zero/)
  // an unnamed return is unknown, not empty
  const none = assetPath({ signings: [sg], transactions: [{ ...tx[0], incoming_assets: [], incoming_asset_count: 0 }], realizedValue: [decision({ chain_status: 'INCOMPLETE_RETURN_UNRECORDED' })] })
  assert.equal(none.find((s) => s.key === 'RETURNED').state, 'UNKNOWN')
})

// ---- the CLI ---------------------------------------------------------------------------------------------------------------------

test('research:transactions: --chains / --packages / issue families / --bucket are read-only filters over a saved dataset and agree with the library', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disi-049-'))
  const file = path.join(dir, 'dataset.json')
  const decisions = [
    decision({ signing_id: 'a', player_slug: 'abreu', full_name: 'Tony Abreu', signing_year: 2002, chain_status: 'INCOMPLETE_WAR_NOT_LOADED' }),
    decision({ signing_id: 'b', player_slug: 'frias', full_name: 'Carlos Frías', signing_year: 2007, chain_status: 'INCOMPLETE_PENDING_CONSIDERATION' }),
  ]
  fs.writeFileSync(file, JSON.stringify({
    status: [{ source_data_as_of_date: '2026-10-21' }], decisions, signings: [], transactionQueue: queue.map(({ detail, ...r }) => ({ ...r, detail })), valueQueue: [],
  }))
  const run = (...args) => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/research/transactions.mjs'), ...args, '--input', file, '--format', 'json'], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    return JSON.parse(r.stdout)
  }
  assert.deepEqual(run('--chains').rows.map((r) => r.player_slug), ['frias'])
  assert.deepEqual(run('--chains', '--value-blocked').rows.map((r) => r.player_slug), ['abreu'])
  assert.equal(run('--chains').summary.transaction_chains_incomplete, 1)
  assert.equal(run('--chains').summary.value_blocked_chains, 1)
  assert.deepEqual(run('--packages', '--membership').rows.map((r) => r.event_key).sort(), ['E_BOTH', 'E_NONE', 'E_PTBNL'])
  assert.deepEqual(run('--packages', '--terms').rows.map((r) => r.event_key).sort(), ['E_BOTH', 'E_CASH_ONLY', 'E_POOL'])
  assert.deepEqual(run('--ptbnl').rows.map((r) => r.event_key), ['E_PTBNL'])
  assert.deepEqual(run('--future-consideration').rows.map((r) => r.event_key), ['E_BOTH'])
  assert.deepEqual(run('--cash-unknown').rows.map((r) => r.issue).sort(), ['CASH_AMOUNT_UNKNOWN', 'CASH_AMOUNT_UNKNOWN', 'POOL_SPACE_AMOUNT_UNKNOWN'])
  assert.deepEqual(run('--value-blocked').rows.map((r) => r.issue), ['DOWNSTREAM_WAR_NOT_LOADED'])
  assert.deepEqual(run('--bucket', 'TERMS').rows.map((r) => r.bucket), ['TERMS', 'TERMS', 'TERMS'])
  const bad = spawnSync(process.execPath, [path.join(root, 'scripts/research/transactions.mjs'), '--bucket', 'NONSENSE', '--input', file], { encoding: 'utf8' })
  assert.notEqual(bad.status, 0)
  assert.match(bad.stderr, /--bucket is one of/)
  // read-only by construction: the script contains no write statement and loads no module that writes
  const src = fs.readFileSync(path.join(root, 'scripts/research/transactions.mjs'), 'utf8') + fs.readFileSync(path.join(root, 'scripts/research/lib/source.mjs'), 'utf8')
  assert.doesNotMatch(src, /\b(insert|update|delete)\s+(into|from)?\b.*public\./i)
  assert.match(fs.readFileSync(path.join(root, 'scripts/research/lib/source.mjs'), 'utf8'), /begin read only/)
  fs.rmSync(dir, { recursive: true, force: true })
})

// ---- the 049 evidence --------------------------------------------------------------------------------------------------------------

const evidence = JSON.parse(fs.readFileSync(path.join(root, 'database/research/049/transaction-evidence.json'), 'utf8'))

test('evidence: every player asset recorded by 049 is matched by an identifier crosswalk and an exact birth date, never by name alone', () => {
  const players = [...evidence.trade_1967.players, evidence.garland_exit.player, evidence.ptbnl_correction.incoming, evidence.ptbnl_correction.ptbnl]
  assert.ok(players.length >= 8)
  for (const p of players) {
    assert.match(p.mlb_id, /^\d+$/, p.name)
    assert.match(p.bref_id, /^[a-z]+[a-z]*\d{2}$/, `${p.name}: a Baseball-Reference id`)
    assert.match(p.retrosheet_id, /^[a-z-]+\d{3}$/, `${p.name}: a Retrosheet id`)
    assert.match(p.birth_date_matched, /^\d{4}-\d{2}-\d{2}$/, `${p.name}: the matched birth date`)
  }
  // the four named-only assets are reconciled by bracketing affiliations and an MLB person record, not by their names
  assert.equal(evidence.identities.length, 4)
  for (const i of evidence.identities) {
    assert.match(i.mlb_id, /^\d+$/)
    assert.match(i.birth_date, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(i.affiliation_before_trade.season <= Number(i.trade_date.slice(0, 4)), `${i.asset}: a season on the counterparty side before the trade`)
    assert.ok(i.affiliation_after_trade.season >= Number(i.trade_date.slice(0, 4)), `${i.asset}: a Dodgers-organization season after it`)
    assert.notEqual(i.affiliation_before_trade.team, i.affiliation_after_trade.team)
  }
})

test('evidence: the Abreu correction keeps both dates and the Garland exit is two-source; the 1967 package is read in a second source', () => {
  const c = evidence.ptbnl_correction
  assert.equal(c.initiated, '2009-08-31')
  assert.equal(c.completed, '2009-10-09')
  assert.equal(c.original.date, c.completed, 'the date DISI stored before is the delivery date')
  assert.equal(c.mlb_log.trade.date, c.initiated)
  assert.equal(c.mlb_log.abreu_delivery.date, c.completed)
  assert.equal(c.retrosheet_rows.length, 2)
  assert.equal(evidence.garland_exit.mlb_log.date, '2009-11-05')
  assert.match(evidence.garland_exit.retrosheet_row, /"Fg"/)
  assert.equal(evidence.trade_1967.players.filter((p) => p.side === 'OUTGOING').length, 3)
  assert.equal(evidence.trade_1967.players.filter((p) => p.side === 'INCOMING').length, 2)
  for (const k of ['versalles', 'grant', 'perranoski']) assert.ok(evidence.trade_1967.sabr[k].length > 40, `SABR ${k}`)
  assert.match(evidence.trade_1967.date_note, /November 27/, 'a day-of-month disagreement between sources is kept, not hidden')
})

test('evidence: what could not be resolved says why, uses the shared result vocabulary, and records no exit, cash, player or zero', () => {
  const VOCAB = ['RESOLVED_TRANSACTION', 'RESOLVED_PACKAGE', 'RESOLVED_TERMS', 'TRANSACTION_KNOWN_VALUE_UNKNOWN', 'PARTIALLY_RESOLVED', 'UNRESOLVED_NO_EVIDENCE', 'CONFLICT']
  assert.ok(evidence.unresolved.length >= 12)
  for (const u of evidence.unresolved) {
    assert.ok(VOCAB.includes(u.result), u.asset)
    assert.ok(u.reason.length > 40, `${u.asset}: a reason`)
    assert.doesNotMatch(u.reason, /was released|released him|(?<!not )assume[sd]? cash/i, `${u.asset}: no exit or consideration is inferred`)
  }
  const by = (asset) => evidence.unresolved.filter((u) => u.asset.includes(asset))
  assert.match(by('Frías')[0].reason, /DISI does not assume cash, a player or zero/)
  assert.match(by('Mike Judd')[0].reason, /not zero, cash or no return/)
  assert.match(by('Gail Harris')[0].reason, /no exit is inferred/)
  assert.match(by('Cash')[0].reason, /not \$0/)
})

test('every researched issue has exactly one result in the shared vocabulary, and the layers are counted separately: transaction, package, terms, value', () => {
  const VOCAB = ['RESOLVED_TRANSACTION', 'RESOLVED_PACKAGE', 'RESOLVED_TERMS', 'TRANSACTION_KNOWN_VALUE_UNKNOWN', 'PARTIALLY_RESOLVED', 'UNRESOLVED_NO_EVIDENCE', 'CONFLICT']
  const all = [...evidence.recorded, ...evidence.unresolved]
  for (const r of all) assert.ok(VOCAB.includes(r.result), `${r.subject ?? r.asset}: ${r.result}`)
  const count = (rows, k) => rows.reduce((m, r) => ({ ...m, [r[k]]: (m[r[k]] ?? 0) + 1 }), {})
  const c = count(all, 'result')
  // transaction evidence, package evidence and value evidence are different layers: a recorded trade is not a valued one
  assert.ok(c.RESOLVED_TRANSACTION >= 5)
  assert.ok(c.RESOLVED_PACKAGE >= 2)
  assert.ok(c.TRANSACTION_KNOWN_VALUE_UNKNOWN >= 2, 'a recorded transaction with an unknown value is its own result, not a resolved one')
  assert.equal(c.CONFLICT, 1, 'the one disagreement between sources is kept')
  assert.equal(c.RESOLVED_TERMS ?? 0, 0, 'no cash or pool-space amount was found')
  for (const r of evidence.recorded.filter((x) => x.result === 'TRANSACTION_KNOWN_VALUE_UNKNOWN')) assert.match(r.note, /NULL|not zero/i, 'a known transaction with an unknown value says the value is unknown, not zero')
})

test('the build is deterministic and generates the rollback from the same evidence', () => {
  const run = () => spawnSync(process.execPath, [path.join(root, 'database/research/049/build.mjs')], { encoding: 'utf8' })
  const before = [fs.readFileSync(path.join(root, 'database/sql/049_transaction_package_completion.sql'), 'utf8'), fs.readFileSync(path.join(root, 'database/release/sql/rollback-049.sql'), 'utf8')]
  const r = run()
  assert.equal(r.status, 0, r.stderr)
  const after = [fs.readFileSync(path.join(root, 'database/sql/049_transaction_package_completion.sql'), 'utf8'), fs.readFileSync(path.join(root, 'database/release/sql/rollback-049.sql'), 'utf8')]
  assert.deepEqual(after, before, 'the same inputs give the same files')
  // both files carry the identical payload
  const payload = (t, tag) => t.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`))[1]
  assert.equal(payload(after[0], 'm049'), payload(after[1], 'r049'))
  // the migration inserts no WAR row and loads no value
  assert.doesNotMatch(after[0], /insert into public\.player_mlb_team_season_war/i)
  assert.doesNotMatch(after[0], /cash_amount_usd\s*=\s*[0-9]/)
})
