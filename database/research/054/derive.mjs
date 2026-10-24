#!/usr/bin/env node
// Derives the 054 research artifacts and the reviewed migration values from read-only inputs:
//   <pipeline-dir>   what was read, unchanged:
//                      player-transactions.json   scripts/mlb/player-transactions.mjs   the official MLB transaction log and person record of each player
//                      team-seasons.json          scripts/mlb/team-seasons.mjs          the parent organization of every team a log row names, per season
//                      tran.txt                   https://www.retrosheet.org/transactions/tranDB.zip (the file 049 and 053 read)
//                      register/people-*.csv      https://github.com/chadwickbureau/register (the id crosswalk)
//   <before.json>    the canonical state before 054, saved read-only as the public anon role:
//                      npm run research:development -- --needs --history --save <before.json>
//   [after.json]     the same read of the canonical chain with 054 applied (database/research/053/canonical-dataset.mjs)
//
//   node database/research/054/derive.mjs <pipeline-dir> <before.json> [after.json]
//
// Deterministic: the same inputs give the same bytes (no clock is read). Nothing here writes to a database. A career move enters
// migration-values.json only where the official MLB transaction log or the Retrosheet transaction database states it with an exact date, its
// clubs resolve to DISI organizations (a log team through its official parent that season, a Retrosheet code through the reviewed franchise map),
// and neither end is a Dodgers organization: a Dodgers transaction belongs in the Dodgers asset ledger, never here.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { assembleDataset } from '../../../lib/research/dataset.js'
import { developmentNeeds, developmentNeedSummary } from '../../../lib/research/development-needs.js'
import { DODGERS_ORGANIZATION_KEYS, gapClassCounts, isBracketedSeason, multiOrganizationClass, multiOrganizationSeasons, needCauses } from '../../../lib/research/development-chronology.js'
import { packageBlockerSplit, packageCompleteness } from '../../../lib/research/transaction-research.js'
import { stableJson } from '../../../lib/research/format.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const [dirArg, beforeArg, afterArg] = process.argv.slice(2)
if (!dirArg || !beforeArg) throw new Error('usage: node database/research/054/derive.mjs <pipeline-dir> <before.json> [after.json]')
const dir = path.resolve(dirArg)
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const write = (name, value) => fs.writeFileSync(path.join(here, name), stableJson(value) + '\n')
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const need = (cond, msg) => { if (!cond) throw new Error(msg) }
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const countBy = (rows, key) => {
  const out = {}
  for (const r of rows) { const k = key(r); out[k] = (out[k] ?? 0) + 1 }
  return Object.fromEntries(Object.entries(out).sort((a, b) => cmp(a[0], b[0])))
}
const csvLine = (l) => { const o = []; let cur = ''; let q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(cur); cur = '' } else cur += ch } o.push(cur); return o }

// ---- reviewed maps (club identity is never guessed from a name) -----------------------------------------------------------------
/** Retrosheet franchise codes -> DISI organization abbreviations (a relocated franchise is one organization: Montreal is Washington's). */
const RETRO = Object.freeze({ ANA: 'LAA', CAL: 'LAA', ARI: 'ARI', ATL: 'ATL', MLN: 'ATL', BAL: 'BAL', BOS: 'BOS', CHA: 'CWS', CHN: 'CHC', CIN: 'CIN', CLE: 'CLE',
  COL: 'COL', DET: 'DET', FLO: 'MIA', HOU: 'HOU', KCA: 'KC', LAN: 'LAD', BRO: 'BRO', MIL: 'MIL', MIN: 'MIN', MON: 'WSH', WAS: 'WSH', NYA: 'NYY', NYN: 'NYM',
  OAK: 'OAK', PHI: 'PHI', PIT: 'PIT', SDN: 'SD', SEA: 'SEA', SFN: 'SFG', SLN: 'STL', TBA: 'TB', TEX: 'TEX', TOR: 'TOR' })
/** Official MLB club ids -> DISI organization abbreviations (an affiliate resolves through its official parent that season). */
const CLUB = Object.freeze({ 108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC', 113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU', 118: 'KC',
  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK', 134: 'PIT', 135: 'SD', 136: 'SEA', 137: 'SFG', 138: 'STL', 139: 'TB', 140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL' })
/** Source type codes -> career transaction types. A conditional deal is a trade; a waiver pick is a waiver claim; a purchase is a purchase. */
const RETRO_TYPE = Object.freeze({ T: ['TRADE', 'Traded'], C: ['TRADE', 'Conditional deal'], W: ['WAIVER_CLAIM', 'Claimed off waivers'], P: ['PURCHASE', 'Purchased'],
  R: ['RELEASE', 'Released'], F: ['FREE_AGENT_SIGNING', 'Signed as a free agent'] })
const LOG_TYPE = Object.freeze({ TR: ['TRADE', 'Traded'], CLW: ['WAIVER_CLAIM', 'Claimed off waivers'], REL: ['RELEASE', 'Released'], SFA: ['FREE_AGENT_SIGNING', 'Signed as a free agent'] })
const URL = {
  retrosheet: 'https://www.retrosheet.org/transactions/tranDB.zip',
  log: (id) => `https://statsapi.mlb.com/api/v1/transactions?playerId=${id}`,
}

// ---- inputs ---------------------------------------------------------------------------------------------------------------------
const tranBuf = fs.readFileSync(path.join(dir, 'tran.txt'))
const tran = tranBuf.toString('latin1').split(/\r?\n/).filter(Boolean).map((raw) => {
  const c = csvLine(raw)
  return { raw, date: c[0], approx: c[2], id: Number(c[5]), player: c[6], type: c[7].trim(), from: c[8], to: c[10] }
})
const register = new Map()
for (const f of fs.readdirSync(path.join(dir, 'register')).filter((n) => /^people-[0-9a-f]\.csv$/.test(n)).sort()) {
  const lines = fs.readFileSync(path.join(dir, 'register', f), 'utf8').split(/\r?\n/).filter(Boolean)
  const head = csvLine(lines[0])
  for (const l of lines.slice(1)) { const c = csvLine(l); const r = Object.fromEntries(head.map((h, i) => [h, c[i]])); if (r.key_mlbam) register.set(r.key_mlbam, r) }
}
const log = load(path.join(dir, 'player-transactions.json'))
need(log.meta.errors === 0, 'the official log read must have no errors')
const teamSeasons = load(path.join(dir, 'team-seasons.json'))
need(teamSeasons.meta.errors === 0, 'the team-season read must have no errors')
const parentOf = (teamId, season) => {
  const r = teamSeasons.records.find((t) => t.teamId === teamId && t.season === season)
  need(r && r.found, `team ${teamId} ${season}: no official team-season record`)
  const org = CLUB[r.parentOrgId]
  need(org, `team ${teamId} ${season}: parent ${r.parentOrgId} is not a mapped MLB club`)
  return { org, team: r.teamName, parentOrgId: r.parentOrgId }
}
const before = assembleDataset(load(beforeArg))
const after = afterArg ? assembleDataset(load(afterArg)) : null
const slugToMlb = new Map(log.records.map((r) => [r.slug, String(r.mlbId)]))

// ---- the reviewed rows: for each open transition of the 16 needs, the source rows that state the move ----------------------------------
// (L = official MLB transaction log row id, R = Retrosheet transaction id). The official log is used where it covers the season; Retrosheet where
// it does not. Only the rows that state the move between the season's two clubs are recorded: no earlier signing, no later free agency.
/** @type {[string, number, [string, number][]][]} */
const REVIEWED = [
  ['carlos-santana', 2022, [['L', 633466]]],
  ['carlos-santana', 2023, [['L', 715038]]],
  ['carlos-santana', 2025, [['L', 866773], ['L', 867250]]],
  ['carlos-santana', 2026, [['L', 922945], ['L', 924086]]],
  ['chan-ho-park', 2005, [['R', 63729]]],
  ['chan-ho-park', 2007, [['R', 39970], ['R', 39971]]],
  ['chan-ho-park', 2010, [['L', 65586]]],
  ['chico-fernandez', 1963, [['R', 60348], ['R', 60349]]],
  ['diego-cartaya', 2025, [['L', 857600], ['L', 859876]]],
  ['eddys-leonard', 2026, [['L', 928037], ['L', 931087]]],
  ['fernando-valenzuela', 1997, [['R', 62878]]],
  ['ismael-valdez', 2002, [['R', 63457]]],
  ['ismael-valdez', 2004, [['R', 63647]]],
  ['jose-offerman', 2002, [['R', 38673]]],
  ['jose-offerman', 2005, [['R', 38680], ['R', 38681]]],
  ['jose-vizcaino', 1996, [['R', 62798]]],
  ['jose-vizcaino', 2006, [['R', 54695], ['R', 54696]]],
  ['juan-castro', 2006, [['R', 63818]]],
  ['juan-castro', 2008, [['R', 8701], ['R', 8702], ['R', 64012]]],
  ['juan-guzman', 1998, [['R', 63020]]],
  ['juan-guzman', 1999, [['R', 63120]]],
  ['karim-garcia', 2000, [['R', 18076]]],
  ['karim-garcia', 2002, [['R', 18081], ['R', 18082]]],
  ['karim-garcia', 2003, [['R', 18083]]],
  ['karim-garcia', 2004, [['R', 63633]]],
  ['omar-daal', 1997, [['R', 11937]]],
  ['omar-daal', 2000, [['R', 63220]]],
  ['pedro-astacio', 2001, [['R', 63347]]],
  ['pedro-astacio', 2005, [['R', 1645], ['R', 1646]]],
  ['raul-mondesi', 2002, [['R', 63429]]],
  ['raul-mondesi', 2003, [['R', 63535]]],
  ['raul-mondesi', 2004, [['R', 35993], ['R', 35994]]],
  ['yasiel-puig', 2019, [['L', 420891]]],
]

const retroDate = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
/** @type {any[]} */
const events = []
for (const [slug, season, rows] of REVIEWED) {
  const mlbId = slugToMlb.get(slug)
  need(mlbId, `${slug}: no official log read`)
  const rec = log.records.find((r) => r.slug === slug)
  for (const [kind, id] of rows) {
    /** @type {any} */
    let ev
    if (kind === 'L') {
      const r = rec.transactions.filter((t) => t.id === id)
      need(r.length === 1, `${slug}: official log row ${id} not found once`)
      const t = r[0]
      const [type, label] = LOG_TYPE[t.typeCode] ?? []
      need(type, `${slug}: log type ${t.typeCode} is not a reviewed career mechanism`)
      // the log carries the receiving club on a release or a signing; its parent that season is the organization
      const from = t.fromTeam ? parentOf(t.fromTeam.id, season) : null
      const to = t.toTeam ? parentOf(t.toTeam.id, season) : null
      const ends = type === 'RELEASE' ? { from: to?.org ?? null, to: null } : type === 'FREE_AGENT_SIGNING' ? { from: null, to: to?.org ?? null } : { from: from?.org ?? null, to: to?.org ?? null }
      ev = { slug, season, date: t.date, type, historical_label: label, from: ends.from, to: ends.to, source_url: URL.log(mlbId), source_reference: `MLB transaction ${id}`,
        evidence: { mlb_log_id: id, type_code: t.typeCode, date: t.date, description: t.description, from_team: t.fromTeam?.name ?? null, to_team: t.toTeam?.name ?? null } }
    } else {
      const retroId = register.get(mlbId)?.key_retro
      need(retroId, `${slug}: no Retrosheet id`)
      const r = tran.filter((t) => t.id === id && t.player === retroId)
      need(r.length === 1, `${slug}: Retrosheet transaction ${id} not found once`)
      const t = r[0]
      need(!t.approx && !t.date.endsWith('00'), `${slug}: Retrosheet transaction ${id} has no exact date`)
      const [type, label] = RETRO_TYPE[t.type] ?? []
      need(type, `${slug}: Retrosheet type ${t.type} is not a reviewed career mechanism`)
      const map = (c) => { if (!c) return null; need(RETRO[c], `${slug}: Retrosheet code ${c} is not mapped`); return RETRO[c] }
      ev = { slug, season, date: retroDate(t.date), type, historical_label: label, from: map(t.from), to: map(t.to), source_url: URL.retrosheet, source_reference: `Retrosheet transaction ${id}`,
        evidence: { retrosheet_transaction_id: id, retrosheet_row: t.raw } }
    }
    need(ev.date.startsWith(String(season)), `${slug} ${season}: ${ev.source_reference} is dated ${ev.date}`)
    need(![ev.from, ev.to].some((o) => DODGERS_ORGANIZATION_KEYS.includes(o)), `${slug}: ${ev.source_reference} involves the Dodgers; it belongs in the Dodgers ledger`)
    events.push(ev)
  }
}
const key = (e) => `CAREER_${e.date.replaceAll('-', '')}_${e.type}_${e.from ?? 'NONE'}_${e.to ?? 'NONE'}_${e.slug.toUpperCase().replaceAll('-', '_')}`
for (const e of events) e.key = key(e)
need(new Set(events.map((e) => e.key)).size === events.length, 'event keys are unique')
const ORG_NAME = new Map(before.organizations.map((o) => [o.abbreviation, o.name]))
const fullName = new Map(before.signings.map((s) => [s.player_slug, s.full_name]))
const describe = (e) => {
  const n = fullName.get(e.slug)
  const o = (k) => ORG_NAME.get(k) ?? k
  const src = e.evidence.description ? `${e.evidence.description} (MLB transaction log, ${e.date})` : `${e.source_reference}, ${e.date}`
  switch (e.type) {
    case 'RELEASE': return `${n} released by the ${o(e.from)}. ${src}. Who signed him next is a separate transaction.`
    case 'FREE_AGENT_SIGNING': return `${n} signed by the ${o(e.to)} as a free agent. ${src}. How he left his previous club is a separate transaction.`
    default: return `${n}: ${e.historical_label.toLowerCase()}, ${o(e.from)} to ${o(e.to)}. ${src}.`
  }
}
for (const e of events) e.description = describe(e)

// ---- sources: reuse what DISI holds; add an official log only where a row needs it and DISI does not hold it yet --------------------------
const sourceUrls = [...new Set(events.map((e) => e.source_url))].sort()
const NEW_SOURCES = new Set(['https://statsapi.mlb.com/api/v1/transactions?playerId=467793', 'https://statsapi.mlb.com/api/v1/transactions?playerId=120221'])
const sources = sourceUrls.filter((u) => NEW_SOURCES.has(u)).map((u) => {
  const rec = log.records.find((r) => URL.log(r.mlbId) === u)
  return { source_name: 'MLB Stats API', source_type: 'MLB_PLAYER_TRANSACTIONS', title: `MLB transaction log: ${rec.person.fullName} (${rec.mlbId})`, url: u, source_tier: 'MLB_TRANSACTION_LOG',
    notes: 'Official transaction log of the player, read for his career moves between clubs other than the Dodgers (054).' }
})

const migrationValues = {
  retrieved_at: '2026-10-24T00:00:00Z',
  sources,
  existing_source_urls: sourceUrls.filter((u) => !NEW_SOURCES.has(u)),
  events: events.map((e) => ({ key: e.key, player_slug: e.slug, date: e.date, type: e.type, from: e.from ?? '', to: e.to ?? '', historical_label: e.historical_label,
    description: e.description, source_url: e.source_url, source_reference: e.source_reference })).sort((a, b) => cmp(a.player_slug, b.player_slug) || cmp(a.date, b.date) || cmp(a.key, b.key)),
}
for (const e of migrationValues.events) {
  need(['TRADE', 'WAIVER_CLAIM', 'PURCHASE'].includes(e.type) ? e.from && e.to && e.from !== e.to : e.type === 'RELEASE' ? e.from && !e.to : e.type === 'FREE_AGENT_SIGNING' ? !e.from && e.to : false, `${e.key}: shape`)
}

// ---- research artifacts -------------------------------------------------------------------------------------------------------------
const group = (rows) => { const m = new Map(); for (const r of rows ?? []) { if (!m.has(r.player_id)) m.set(r.player_id, []); m.get(r.player_id).push(r) } return m }
const state = (data) => {
  const stints = group(data.stints)
  // the chronology stream: v_player_career_transactions where the dataset has it (054), else the Dodgers ledger rows of v_player_transactions
  const stream = group(data.careerTransactions?.length ? data.careerTransactions : data.transactions)
  const ms = group(data.milestones)
  const needs = developmentNeeds(data)
  const causes = needCauses(needs, (id) => stints.get(id) ?? [], (id) => stream.get(id) ?? [], (id) => ms.get(id) ?? [])
  const seasons = []
  for (const [pid, st] of stints) for (const m of multiOrganizationSeasons(st, stream.get(pid) ?? [])) seasons.push({ player_slug: st[0].player_slug, ...m })
  seasons.sort((a, b) => cmp(a.player_slug, b.player_slug) || a.season - b.season)
  return { needs, causes, seasons, summary: developmentNeedSummary(data) }
}
const B = state(before)
const A = after ? state(after) : null
// "before" is the released 053 classification (the 053 rule over the same rows): its after state names the 16 transaction-blocked needs
const released053 = load(path.join(here, '../053/development-needs-before-after.json'))
const blocked053 = new Set(released053.transaction_blocked.filter((x) => x.after.gap_class === 'TRANSACTION_BLOCKED').map((x) => x.player_slug))
need(blocked053.size === released053.after.gap_classes.TRANSACTION_BLOCKED && blocked053.size === 16, '053: the 16 transaction-blocked needs')
const blocked = B.causes.filter((c) => c.need === 'ORGANIZATION' && blocked053.has(c.player_slug)).sort((a, b) => cmp(a.player_slug, b.player_slug))
need(blocked.length === 16, `16 transaction-blocked needs before 054 (got ${blocked.length})`)
// the 054 rule alone (no new row) reclassifies a need only where dated appearance ranges overlap (a person reviews them)
const ruleOnly = blocked.filter((c) => c.gap_class !== 'TRANSACTION_BLOCKED').map((c) => ({ player_slug: c.player_slug, gap_class: c.gap_class, cause: c.cause }))
const blockedSlugs = new Set(blocked.map((c) => c.player_slug))
const openBefore = B.seasons.filter((m) => blockedSlugs.has(m.player_slug) && !isBracketedSeason(m))
const evOf = (slug, season) => events.filter((e) => e.slug === slug && e.season === season)

write('baseline.json', {
  as_of: '2026-10-24',
  read: 'Production, read-only as the public anon role, at canonical main 764f165 (generation 9).',
  development: { ...B.summary, gap_classes_053: released053.after.gap_classes, transaction_blocked: blocked.length },
  rule_only_reclassification: ruleOnly,
  multi_organization_seasons: countBy(B.seasons, (m) => m.state),
  dodgers_ledger: { transaction_queue: before.transactionQueue.length, value_queue: before.valueQueue.length, packages: { ...packageCompleteness(before), ...packageBlockerSplit(before) } },
})
write('workset.json', {
  as_of: '2026-10-24',
  rule: 'Every development need classified TRANSACTION_BLOCKED after 053, with every open season of it. Each was checked: no open season of these needs involves the Dodgers.',
  needs: blocked.map((c) => ({ player_slug: c.player_slug, full_name: fullName.get(c.player_slug) ?? null, need: c.need, transaction_scope: c.transaction_scope ?? null, cause: c.cause,
    seasons: openBefore.filter((m) => m.player_slug === c.player_slug).map((m) => ({ season: m.season, state: m.state, dodgers_involved: m.dodgers_involved, segments: m.segments })) })),
  all_later_organization_history: openBefore.every((m) => !m.dodgers_involved || multiOrganizationClass(m.state) !== 'TRANSACTION_BLOCKED'),
})
const transitions = openBefore.filter((m) => !m.dodgers_involved).map((m) => {
  const ev = evOf(m.player_slug, m.season)
  const dated = m.segments.every((g) => g.dated)
  const direct = ev.some((e) => ['TRADE', 'WAIVER_CLAIM', 'PURCHASE'].includes(e.type))
  return {
    player_slug: m.player_slug, season: m.season, organizations: m.organizations,
    last_appearance_first_club: dated ? m.segments[0].last_appearance : null, first_appearance_second_club: dated ? m.segments.at(-1).first_appearance : null,
    dated, mechanism: m.organizations.length > 2 ? 'SEVERAL' : direct ? ev.find((e) => ['TRADE', 'WAIVER_CLAIM', 'PURCHASE'].includes(e.type)).type : ev.length ? 'RELEASE_THEN_SIGNING' : 'NONE',
    events: ev.map((e) => ({ key: e.key, date: e.date, type: e.type, from: e.from, to: e.to, source: e.source_reference })),
    names_both_clubs: direct || ev.length >= 2,
    safe_to_record: ev.length > 0,
  }
})
write('transition-workset.json', { as_of: '2026-10-24', transitions, count: transitions.length, by_mechanism: countBy(transitions, (t) => t.mechanism), dated: transitions.filter((t) => t.dated).length })
write('career-transaction-evidence.json', {
  as_of: '2026-10-24',
  sources: { retrosheet: { url: URL.retrosheet, sha256_tran_txt: sha256(tranBuf), note: 'The same file 049 and 053 read (identical sha256).' },
    mlb_log: { endpoint: log.meta.endpoint, players: log.records.length, errors: log.meta.errors }, team_seasons: { endpoint: teamSeasons.meta.endpoint, requests: teamSeasons.meta.requests, errors: teamSeasons.meta.errors } },
  maps: { retrosheet_franchises: RETRO, mlb_clubs: CLUB, retrosheet_types: RETRO_TYPE, mlb_log_types: LOG_TYPE },
  events: events.map(({ slug, season, key: k, date, type, from, to, historical_label, source_reference, source_url, evidence }) => ({ key: k, player_slug: slug, season, date, type, from, to, historical_label, source_reference, source_url, evidence })),
})
write('career-transaction-classification.json', {
  as_of: '2026-10-24',
  rule: 'One class per transition, before any write. DIRECT: one source row names both clubs (a trade, a waiver claim, a purchase). RELEASE_THEN_SIGNING: the player left the first club and later signed with the second: two facts, two rows. CHAIN: he moved through a third club the same day. SEVERAL: three organizations in one season.',
  transitions: transitions.map((t) => ({ player_slug: t.player_slug, season: t.season, class: t.mechanism === 'NONE' ? 'NO_SOURCE' : t.mechanism === 'SEVERAL' ? 'SEVERAL' : t.player_slug === 'chico-fernandez' ? 'CHAIN' : ['TRADE', 'WAIVER_CLAIM', 'PURCHASE'].includes(t.mechanism) ? 'DIRECT' : 'RELEASE_THEN_SIGNING', dated: t.dated })),
  counts: countBy(transitions, (t) => (t.mechanism === 'NONE' ? 'NO_SOURCE' : t.mechanism === 'SEVERAL' ? 'SEVERAL' : t.player_slug === 'chico-fernandez' ? 'CHAIN' : ['TRADE', 'WAIVER_CLAIM', 'PURCHASE'].includes(t.mechanism) ? 'DIRECT' : 'RELEASE_THEN_SIGNING')),
  events_by_type: countBy(events, (e) => e.type),
})
write('migration-values.json', migrationValues)
write('source-manifest.json', {
  as_of: '2026-10-24',
  read: [
    { source: 'MLB Stats API transaction log', endpoint: log.meta.endpoint, players: log.records.length, errors: log.meta.errors },
    { source: 'MLB Stats API team-season records', endpoint: teamSeasons.meta.endpoint, requests: teamSeasons.meta.requests, errors: teamSeasons.meta.errors, used_for: 'the parent organization of each team a log row names, that season' },
    { source: 'Retrosheet transaction database', url: URL.retrosheet, sha256_tran_txt: sha256(tranBuf) },
    { source: 'Chadwick Bureau Register', url: 'https://github.com/chadwickbureau/register', used_for: 'MLB to Retrosheet id' },
  ],
  sources_added: sources.map((s) => s.url),
  sources_reused: migrationValues.existing_source_urls,
  not_used: [{ source: 'Search-engine results', why: 'discovery only; never evidence' }, { source: 'Appearance dates', why: 'a first game for another club is never read as a transaction' }],
})
if (A) {
  const k = (m) => `${m.player_slug}|${m.season}`
  const afterSeasons = new Map(A.seasons.map((m) => [k(m), m]))
  const needKey = (n) => `${n.player_slug}|${n.need}`
  const afterCauses = new Map(A.causes.map((c) => [needKey(c), c]))
  write('development-before-after.json', {
    as_of: '2026-10-24',
    before: { ...B.summary, gap_classes: released053.after.gap_classes },
    rule_only: { gap_classes: gapClassCounts(B.causes), reclassified: ruleOnly },
    after: { ...A.summary, gap_classes: gapClassCounts(A.causes) },
    needs: blocked.map((c) => {
      const a = afterCauses.get(needKey(c))
      return { player_slug: c.player_slug, before: 'TRANSACTION_BLOCKED', after: a ? a.gap_class : 'CLOSED', after_cause: a?.cause ?? null,
        seasons: openBefore.filter((m) => m.player_slug === c.player_slug).map((m) => ({ season: m.season, before: m.state, after: afterSeasons.get(k(m))?.state ?? null,
          events: evOf(m.player_slug, m.season).map((e) => e.key) })) }
    }),
    resolved: B.causes.filter((c) => !afterCauses.has(needKey(c))).map((c) => ({ player_slug: c.player_slug, need: c.need, before: blocked053.has(c.player_slug) && c.need === 'ORGANIZATION' ? 'TRANSACTION_BLOCKED' : c.gap_class })),
    added: A.causes.filter((c) => !B.causes.some((b) => needKey(b) === needKey(c))).map((c) => ({ player_slug: c.player_slug, need: c.need })),
    chronology: { before: countBy(B.seasons, (m) => m.state), after: countBy(A.seasons, (m) => m.state) },
    dodgers_ledger: { before: { transaction_queue: before.transactionQueue.length, value_queue: before.valueQueue.length }, after: { transaction_queue: after.transactionQueue.length, value_queue: after.valueQueue.length } },
  })
}
process.stderr.write(`054 derive: ${events.length} career events (${countBy(events, (e) => e.type) ? Object.entries(countBy(events, (e) => e.type)).map(([t, n]) => `${t} ${n}`).join(', ') : ''}), ${transitions.length} transitions, ${sources.length} new sources${A ? ', after read' : ''}\n`)
