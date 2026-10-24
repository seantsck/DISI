#!/usr/bin/env node
// Derives the 053 research artifacts and the reviewed migration values from read-only inputs:
//   <pipeline-dir>   what was read, unchanged:
//                      player-transactions.json   scripts/mlb/player-transactions.mjs   the official MLB transaction log and person record of each player
//                      tran.txt, tranDB.zip       https://www.retrosheet.org/transactions/tranDB.zip (the file 049 read; same sha256)
//                      BIOFILE.TXT                https://www.retrosheet.org/BIOFILE.TXT (every major-league player)
//                      register/people-*.csv      https://github.com/chadwickbureau/register (the id crosswalk)
//                      people/career-<id>.json    https://statsapi.mlb.com/api/v1/people/<id>/stats?stats=career&group=hitting,pitching&gameType=R
//   <before.json>    the canonical state before 053, saved read-only as the public anon role:
//                      npm run research:development -- --needs --history --save <before.json>
//   [after.json]     the same read of the canonical chain with 053 applied (database/research/053/canonical-dataset.mjs); adds the after
//                    halves of the before/after artifacts
//
//   node database/research/053/derive.mjs <pipeline-dir> <before.json> [after.json]
//
// Deterministic: the same inputs give the same bytes (no clock is read). Nothing here writes to a database. A transaction enters
// migration-values.json only where the official MLB transaction log or the Retrosheet transaction database states it, the player's identity is
// matched across the Register, the official person record and (for a major leaguer) BIOFILE by an exact birth date, and the transaction is a
// Dodgers transaction (DISI's ledger records only those). Where the two sources disagree on a date, both are kept and the official log is used.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { assembleDataset } from '../../../lib/research/dataset.js'
import { developmentNeeds, developmentNeedSummary } from '../../../lib/research/development-needs.js'
import { DODGERS_ORGANIZATION_KEYS, gapClassCounts, isBracketedSeason, multiOrganizationClass, multiOrganizationSeasons, needCauses, playerMove } from '../../../lib/research/development-chronology.js'
import { openPackages, packageBlockerSplit, packageCompleteness, transactionResearchItems } from '../../../lib/research/transaction-research.js'
import { stableJson } from '../../../lib/research/format.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const [dirArg, beforeArg, afterArg] = process.argv.slice(2)
if (!dirArg || !beforeArg) throw new Error('usage: node database/research/053/derive.mjs <pipeline-dir> <before.json> [after.json]')
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

// ---- inputs ---------------------------------------------------------------------------------------------------------------------
const RETRIEVED = '2026-10-24'
const URL = {
  retrosheet: 'https://www.retrosheet.org/transactions/tranDB.zip',
  biofile: 'https://www.retrosheet.org/BIOFILE.TXT',
  register: 'https://github.com/chadwickbureau/register',
  log: (id) => `https://statsapi.mlb.com/api/v1/transactions?playerId=${id}`,
  person: (id) => `https://statsapi.mlb.com/api/v1/people/${id}`,
  career: (id) => `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=career&group=hitting,pitching&gameType=R`,
}
const tranBuf = fs.readFileSync(path.join(dir, 'tran.txt'))
const tran = tranBuf.toString('latin1').split(/\r?\n/).filter(Boolean).map((raw) => {
  const c = csvLine(raw)
  return { raw, date: c[0], approx: c[2], id: Number(c[5]), player: c[6], type: c[7].trim(), from: c[8], to: c[10], info: c[15] }
})
const bioBuf = fs.readFileSync(path.join(dir, 'BIOFILE.TXT'))
const bio = new Map(bioBuf.toString('latin1').split(/\r?\n/).slice(1).filter(Boolean).map(csvLine).map((r) => [r[0], r]))
const register = new Map()
const registerFiles = fs.readdirSync(path.join(dir, 'register')).filter((n) => /^people-[0-9a-f]\.csv$/.test(n)).sort()
const registerHash = crypto.createHash('sha256')
for (const f of registerFiles) {
  const buf = fs.readFileSync(path.join(dir, 'register', f))
  registerHash.update(buf)
  const lines = buf.toString('utf8').split(/\r?\n/).filter(Boolean)
  const head = csvLine(lines[0])
  for (const l of lines.slice(1)) {
    const c = csvLine(l)
    const r = Object.fromEntries(head.map((h, i) => [h, c[i]]))
    if (r.key_mlbam) register.set(r.key_mlbam, r)
  }
}
const log = load(path.join(dir, 'player-transactions.json'))
const logBy = new Map(log.records.map((r) => [String(r.mlbId), r]))
need(log.meta.errors === 0, 'the official log read must have no errors')
const before = assembleDataset(load(beforeArg))
const after = afterArg ? assembleDataset(load(afterArg)) : null
const beforeRaw = load(beforeArg)

// ---- identity: never guessed -------------------------------------------------------------------------------------------------
// The Register maps the MLB id to the Retrosheet and Baseball-Reference ids; the official person record and the Register (and BIOFILE for a
// major leaguer) must give the same birth date. A minor leaguer Retrosheet names only by name has no Retrosheet id; his name must match.
function identity(mlbId, { retroName = null } = {}) {
  const reg = register.get(String(mlbId))
  need(reg, `${mlbId}: not in the Chadwick Register`)
  const rec = logBy.get(String(mlbId))
  need(rec?.person?.birthDate, `${mlbId}: no official person record was read`)
  const regBirth = reg.birth_year ? `${reg.birth_year}-${reg.birth_month.padStart(2, '0')}-${reg.birth_day.padStart(2, '0')}` : null
  need(regBirth === rec.person.birthDate, `${mlbId}: birth dates disagree (Register ${regBirth}, MLB ${rec.person.birthDate})`)
  let bioBirth = null
  if (reg.key_retro) {
    const b = bio.get(reg.key_retro)
    need(b, `${mlbId}: Retrosheet id ${reg.key_retro} is not in BIOFILE`)
    const [m, d, y] = b[4].split('/')
    bioBirth = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    need(bioBirth === rec.person.birthDate, `${mlbId}: BIOFILE birth date ${bioBirth} differs`)
  } else {
    need(retroName && `${reg.name_first} ${reg.name_last}`.toLowerCase() === retroName.toLowerCase(), `${mlbId}: a minor leaguer without a Retrosheet id must match the name Retrosheet records`)
  }
  return {
    mlb_id: String(mlbId), name: rec.person.fullName, birth_date: rec.person.birthDate, mlb_debut_date: rec.person.mlbDebutDate ?? null,
    retrosheet_id: reg.key_retro || null, bref_id: reg.key_bbref || null, bref_register_id: reg.key_bbref_minors || null,
    matched: reg.key_retro ? 'Register, official person record and BIOFILE give the same birth date' : 'Register and official person record give the same birth date; Retrosheet names him by name only',
  }
}
const retroRows = (id) => tran.filter((t) => t.id === id)
const retroRow = (id, player) => {
  const r = retroRows(id).filter((t) => t.player === player)
  need(r.length === 1, `Retrosheet transaction ${id}: ${player} not found once`)
  need(!r[0].approx && !r[0].date.endsWith('00'), `Retrosheet transaction ${id}: the date is not exact`)
  return r[0]
}
const retroDate = (r) => `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`
const logRow = (mlbId, id) => {
  const r = logBy.get(String(mlbId)).transactions.filter((t) => t.id === id)
  need(r.length === 1, `official log ${mlbId}: transaction ${id} not found once`)
  return r[0]
}

// ---- the reviewed Dodgers transactions ----------------------------------------------------------------------------------------------
// Each is stated by the official log or by Retrosheet, involves the Dodgers, and closes a gap the existing queues raise: a development season
// whose move is at the Dodgers boundary, or a Dodgers re-acquisition the transaction queue flags (DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION),
// with the exit that ends the re-acquired interval and, for a trade, the return and the returned player's own Dodgers exit (the adjacent hop).
const P = {
  baez: identity(520980), park: identity(120221), vizcaino: identity(123743), daal: identity(112984), castro: identity(112128),
  leyritz: identity(117747), junge: identity(407784), cordero: identity(407782, { retroName: 'Jesus Cordero' }), lutz: identity(453845, { retroName: 'Kenny Lutz' }),
}
const slugOf = { [P.baez.mlb_id]: 'pedro-baez', [P.park.mlb_id]: 'chan-ho-park', [P.vizcaino.mlb_id]: 'jose-vizcaino', [P.daal.mlb_id]: 'omar-daal', [P.castro.mlb_id]: 'juan-castro' }
const tracked = (p) => ({ name: p.name, mlb_id: p.mlb_id, bref_id: p.bref_id, player_slug: slugOf[p.mlb_id] })
const other = (p, extra = {}) => ({ name: p.name, mlb_id: p.mlb_id, bref_id: p.mlb_debut_date ? p.bref_id : null, bref_register_id: p.mlb_debut_date ? null : p.bref_register_id, ...extra })

const retroEvidence = (id, player) => { const r = retroRow(id, player); return { retrosheet_transaction_id: id, retrosheet_row: r.raw, date: retroDate(r), type: r.type } }
const logEvidence = (mlbId, id) => { const r = logRow(mlbId, id); return { mlb_log_id: id, date: r.date, type_code: r.typeCode, description: r.description } }

const events = []
const conflicts = []
const add = (e) => { need(!events.some((x) => x.key === e.key), `duplicate ${e.key}`); events.push(e) }

// 1. Pedro Baez, 2022: Houston released him, the Dodgers signed him (official log); the release closing this interval is already recorded
{
  const sign = logEvidence(P.baez.mlb_id, 622856)
  const hou = logEvidence(P.baez.mlb_id, 617735)
  need(sign.type_code === 'SFA' && hou.type_code === 'REL', 'Baez: a signing and the Houston release')
  add({ key: 'LAD_FREE_AGENT_SIGNING_2022_PEDRO_BAEZ', date: sign.date, type: 'FREE_AGENT_SIGNING', to: null, historical_label: 'Signed as a free agent (minor league contract)',
    source_url: URL.log(P.baez.mlb_id), evidence: { mlb_log: [sign, hou] },
    description: `${sign.description} (MLB transaction log, ${sign.date}). The Houston Astros had released him on ${hou.date}; that release is Houston's transaction and is not recorded here.`,
    assets: [{ side: 'INCOMING', type: 'PLAYER', ...tracked(P.baez), counterparty: null, role_note: 'DISI tracked international signing. Re-signed by the Dodgers after his 2020 free agency.' }],
    workset: ['A'], closes: ['pedro-baez|2022'] })
}
// 2. Chan Ho Park, 2008: signed by the Dodgers, granted free agency (Retrosheet; the official log starts in 2009 for him)
{
  const s = retroEvidence(39973, P.park.retrosheet_id), x = retroEvidence(39974, P.park.retrosheet_id)
  need(s.type === 'F' && x.type === 'Fg', 'Park: a free-agent signing and a free agency')
  add({ key: 'LAD_FREE_AGENT_SIGNING_2008_CHAN_HO_PARK', date: s.date, type: 'FREE_AGENT_SIGNING', to: null, historical_label: 'Signed as a free agent', source_url: URL.retrosheet,
    evidence: { retrosheet: [s] }, description: `Chan Ho Park signed with the Dodgers as a free agent (Retrosheet transaction ${s.retrosheet_transaction_id}, ${s.date}).`,
    assets: [{ side: 'INCOMING', type: 'PLAYER', ...tracked(P.park), counterparty: null, role_note: 'DISI tracked international signing. Re-signed by the Dodgers after his 2001 free agency.' }],
    workset: ['B'], closes: ['DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION|LAD_FA_2001_PARK'] })
  add({ key: 'LAD_FREE_AGENCY_2008_CHAN_HO_PARK', date: x.date, type: 'FREE_AGENCY', to: null, historical_label: 'Granted free agency', source_url: URL.retrosheet,
    evidence: { retrosheet: [x] }, description: `Chan Ho Park was granted free agency by the Dodgers (Retrosheet transaction ${x.retrosheet_transaction_id}, ${x.date}).`,
    assets: [{ side: 'OUTGOING', type: 'PLAYER', ...tracked(P.park), counterparty: null, role_note: 'DISI tracked international signing.' }], workset: ['B'], closes: [] })
}
// 3. Jose Vizcaino: re-signed 1997, traded to the Yankees for Jim Leyritz (and cash) in 2000; Leyritz's free agency ends the returned interval
{
  const s = retroEvidence(54684, P.vizcaino.retrosheet_id)
  const rows = retroRows(63209)
  need(rows.length === 3, 'Retrosheet 63209 has three rows: Vizcaino, Leyritz and cash')
  const tv = retroEvidence(63209, P.vizcaino.retrosheet_id), tl = retroEvidence(63209, P.leyritz.retrosheet_id)
  const cash = rows.find((r) => !r.player)
  need(cash && cash.info === '$' && cash.from === 'LAN' && cash.to === 'NYA', 'Retrosheet 63209: the Dodgers sent cash to the Yankees (amount not stated)')
  need(tv.date === tl.date && rows.find((r) => r.player === P.vizcaino.retrosheet_id).from === 'LAN' && rows.find((r) => r.player === P.leyritz.retrosheet_id).to === 'LAN', 'Retrosheet 63209: direction')
  const lx = retroEvidence(30076, P.leyritz.retrosheet_id)
  need(s.type === 'F' && lx.type === 'Fg', 'Vizcaino signing and Leyritz free agency')
  add({ key: 'LAD_FREE_AGENT_SIGNING_1997_JOSE_VIZCAINO', date: s.date, type: 'FREE_AGENT_SIGNING', to: null, historical_label: 'Signed as a free agent', source_url: URL.retrosheet,
    evidence: { retrosheet: [s] }, description: `Jose Vizcaino signed with the Dodgers as a free agent (Retrosheet transaction ${s.retrosheet_transaction_id}, ${s.date}).`,
    assets: [{ side: 'INCOMING', type: 'PLAYER', ...tracked(P.vizcaino), counterparty: null, role_note: 'DISI tracked international signing. Re-signed by the Dodgers after his 1997 free agency from San Francisco.' }],
    workset: ['B'], closes: ['DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION|LAD_CHC_1990_VIZCAINO'] })
  add({ key: 'LAD_NYY_2000_JOSE_VIZCAINO', date: tv.date, type: 'TRADE', to: 'NYY', historical_label: '', source_url: URL.retrosheet,
    evidence: { retrosheet: rows.map((r) => ({ retrosheet_transaction_id: 63209, retrosheet_row: r.raw })) },
    description: `Traded Jose Vizcaino and cash to the New York Yankees. Received Jim Leyritz. Retrosheet transaction 63209 (${tv.date}); the cash amount is not stated.`,
    assets: [
      { side: 'OUTGOING', type: 'PLAYER', ...tracked(P.vizcaino), counterparty: 'NYY', role_note: 'DISI tracked international signing.' },
      { side: 'OUTGOING', type: 'CASH', name: 'Cash', counterparty: 'NYY', role_note: 'Cash sent with Vizcaino; the amount is not stated in Retrosheet (unknown, never zero).' },
      { side: 'INCOMING', type: 'PLAYER', ...other(P.leyritz), counterparty: 'NYY', role_note: 'Acquired from the Yankees for Jose Vizcaino and cash.' },
    ],
    workset: ['B', 'D'], closes: [] })
  add({ key: 'LAD_FREE_AGENCY_2000_JIM_LEYRITZ', date: lx.date, type: 'FREE_AGENCY', to: null, historical_label: 'Granted free agency', source_url: URL.retrosheet,
    evidence: { retrosheet: [lx] }, description: `Jim Leyritz was granted free agency by the Dodgers (Retrosheet transaction ${lx.retrosheet_transaction_id}, ${lx.date}).`,
    assets: [{ side: 'OUTGOING', type: 'PLAYER', ...other(P.leyritz), counterparty: null, role_note: 'Acquired in the 2000 Jose Vizcaino trade.' }], workset: ['D'], closes: [] })
}
// 4. Omar Daal: re-acquired from the Phillies in 2001 for Eric Junge and Jesus Cordero, granted free agency in 2002
{
  const rows = retroRows(63360)
  need(rows.length === 3, 'Retrosheet 63360 has three rows')
  const d = retroEvidence(63360, P.daal.retrosheet_id)
  need(rows.find((r) => r.player === P.daal.retrosheet_id).to === 'LAN' && rows.filter((r) => r.player !== P.daal.retrosheet_id).every((r) => r.from === 'LAN' && r.to === 'PHI'), 'Retrosheet 63360: direction')
  need(rows.some((r) => r.player === P.junge.retrosheet_id) && rows.some((r) => r.player === 'Jesus Cordero'), 'Retrosheet 63360: Junge and Cordero')
  const x = retroEvidence(11939, P.daal.retrosheet_id)
  need(x.type === 'Fg', 'Daal free agency')
  add({ key: 'PHI_LAD_2001_DAAL_REACQ', date: d.date, type: 'TRADE', to: 'PHI', historical_label: '', source_url: URL.retrosheet,
    evidence: { retrosheet: rows.map((r) => ({ retrosheet_transaction_id: 63360, retrosheet_row: r.raw })) },
    description: `Traded Eric Junge and Jesus Cordero to the Philadelphia Phillies. Received Omar Daal. Retrosheet transaction 63360 (${d.date}).`,
    assets: [
      { side: 'INCOMING', type: 'PLAYER', ...tracked(P.daal), counterparty: 'PHI', role_note: 'DISI tracked international signing. Re-acquired from the Phillies.' },
      { side: 'OUTGOING', type: 'PLAYER', ...other(P.junge), counterparty: 'PHI', role_note: '' },
      { side: 'OUTGOING', type: 'PLAYER', ...other(P.cordero), counterparty: 'PHI', role_note: 'Never appeared in the major leagues (official person record: no debut).' },
    ],
    workset: ['B'], closes: ['DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION|LAD_MON_1995_DAAL'] })
  add({ key: 'LAD_FREE_AGENCY_2002_OMAR_DAAL', date: x.date, type: 'FREE_AGENCY', to: null, historical_label: 'Granted free agency', source_url: URL.retrosheet,
    evidence: { retrosheet: [x] }, description: `Omar Daal was granted free agency by the Dodgers (Retrosheet transaction ${x.retrosheet_transaction_id}, ${x.date}).`,
    assets: [{ side: 'OUTGOING', type: 'PLAYER', ...tracked(P.daal), counterparty: null, role_note: 'DISI tracked international signing.' }], workset: ['B'], closes: [] })
}
let castroUnrecorded
// 5. Juan Castro, 2010: released by Philadelphia, signed by the Dodgers, free agency in October (official log and Retrosheet). The rest of his
//    chain (the 2000 trade to Cincinnati, the 2009 and December 2010 signings, the 2011 retirement) is stated and documented, not recorded
{
  const rows = retroRows(63195)
  need(rows.length === 2 && rows.some((r) => r.player === 'Kenny Lutz' && r.to === 'LAN') && rows.some((r) => r.player === P.castro.retrosheet_id && r.from === 'LAN' && r.to === 'CIN'), 'Retrosheet 63195: Castro for Kenny Lutz')
  const t = retroEvidence(63195, P.castro.retrosheet_id)
  const s09 = retroEvidence(8704, P.castro.retrosheet_id)
  const fa09 = retroEvidence(8705, P.castro.retrosheet_id)
  const s10r = retroEvidence(8708, P.castro.retrosheet_id), x10r = retroEvidence(8709, P.castro.retrosheet_id), d10r = retroEvidence(8710, P.castro.retrosheet_id)
  const pur09 = logEvidence(P.castro.mlb_id, 1981), fa09l = logEvidence(P.castro.mlb_id, 29434)
  const s10 = logEvidence(P.castro.mlb_id, 65619), x10 = logEvidence(P.castro.mlb_id, 71172), d10 = logEvidence(P.castro.mlb_id, 76212), ret = logEvidence(P.castro.mlb_id, 96223)
  need(s09.type === 'F' && fa09.type === 'Fg' && fa09.date === fa09l.date && pur09.type_code === 'PUR', 'Castro 2009: a Retrosheet signing; the recorded free agency agrees in both sources; the April purchase is a contract purchase, not an acquisition')
  need(s10.type_code === 'SFA' && x10.type_code === 'DFA' && d10.type_code === 'SFA' && ret.type_code === 'RET', 'Castro 2010-2011: official log rows')
  need(x10.date === x10r.date, 'Castro 2010 free agency: both sources agree')
  conflicts.push(
    { subject: 'Juan Castro 2010 Dodgers signing', mlb_log: { id: s10.mlb_log_id, date: s10.date }, retrosheet: { id: s10r.retrosheet_transaction_id, date: s10r.date },
      used: s10.date, why: 'The official MLB transaction log is first in the source order; the Retrosheet date is kept here and in the event description. Both lie between his last game for Philadelphia (2010-07-16) and his first for the Dodgers (2010-08-06), so the chronology does not depend on the choice.' },
    { subject: 'Juan Castro December 2010 Dodgers signing', mlb_log: { id: d10.mlb_log_id, date: d10.date }, retrosheet: { id: d10r.retrosheet_transaction_id, date: d10r.date },
      used: d10.date, why: 'The official MLB transaction log is first in the source order; both dates fall in the 2010-11 offseason.' },
  )
  add({ key: 'LAD_FREE_AGENT_SIGNING_2010_JUAN_CASTRO', date: s10.date, type: 'FREE_AGENT_SIGNING', to: null, historical_label: 'Signed as a free agent (minor league contract)', source_url: URL.log(P.castro.mlb_id),
    evidence: { mlb_log: [s10], retrosheet: [s10r] },
    description: `${s10.description} (MLB transaction log, ${s10.date}; Retrosheet transaction ${s10r.retrosheet_transaction_id} dates the signing ${s10r.date}). The Philadelphia Phillies had released him on 2010-07-17; that release is Philadelphia's transaction and is not recorded here.`,
    assets: [{ side: 'INCOMING', type: 'PLAYER', ...tracked(P.castro), counterparty: null, role_note: 'DISI tracked international signing. Re-signed by the Dodgers.' }], workset: ['A'], closes: ['juan-castro|2010'] })
  add({ key: 'LAD_FREE_AGENCY_2010_JUAN_CASTRO', date: x10.date, type: 'FREE_AGENCY', to: null, historical_label: 'Elected free agency', source_url: URL.log(P.castro.mlb_id),
    evidence: { mlb_log: [x10], retrosheet: [x10r] }, description: `${x10.description} (MLB transaction log, ${x10.date}; Retrosheet transaction ${x10r.retrosheet_transaction_id}).`,
    assets: [{ side: 'OUTGOING', type: 'PLAYER', ...tracked(P.castro), counterparty: null, role_note: 'DISI tracked international signing.' }], workset: ['A'], closes: [] })
  // The rest of the chain is stated by the sources and NOT recorded: the 2000 trade's return (Kenny Lutz, a minor leaguer) has no WAR and no
  // bref id, so recording the trade needs a NO_MLB_APPEARANCE_OBSERVED control observation, and control observations are sealed (never deleted):
  // a migration that wrote one could not be rolled back to its exact pre-state. Without the 2000 trade, the 2009 and December 2010 signings would
  // open intervals that overlap the 1991 one. 049 avoided the sealed resolution table for the same reason.
  castroUnrecorded = {
    subject: 'Juan Castro: first Dodgers exit, 2009 re-signing, December 2010 re-signing, 2011 retirement',
    evidence: { retrosheet: [...rows.map((r) => ({ retrosheet_transaction_id: 63195, retrosheet_row: r.raw })), s09, fa09, d10r], mlb_log: [pur09, fa09l, d10, ret] },
    stated: [
      { date: t.date, what: 'Traded to the Cincinnati Reds for Kenny Lutz (Retrosheet 63195)' },
      { date: s09.date, what: 'Signed with the Dodgers as a free agent (Retrosheet 8704); the official log starts with the 2009-04-13 contract purchase from Albuquerque, which is not an acquisition' },
      { date: d10.date, what: `Signed with the Dodgers as a free agent (official log ${d10.mlb_log_id}; Retrosheet 8710 dates it ${d10r.date})` },
      { date: ret.date, what: `Retired (official log ${ret.mlb_log_id}); a retirement is not a transaction` },
    ],
    lutz_identity: { mlb_id: P.lutz.mlb_id, name: P.lutz.name, birth_date: P.lutz.birth_date, bref_register_id: P.lutz.bref_register_id, career_statistics: 'empty', biofile: 'no entry' },
    why_not_recorded: 'Recording the 2000 trade needs the observation that Kenny Lutz never reached the majors (his return has no WAR and no Baseball-Reference id), and dodgers_control_observations is sealed: a row is never deleted, so a migration that writes one cannot be rolled back to its exact pre-053 state. The 2009 and December 2010 signings cannot be recorded without the 2000 exit (their intervals would overlap the 1991 one). A reviewed batch that accepts a retraction-based rollback can record all four from this evidence.',
    remains: ['DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION|LAD_FREE_AGENCY_2009_JUAN_CASTRO'],
  }
}


// No control observation is written (the table is sealed; see the Castro chain), so 053 adds no source either: every event cites the Retrosheet
// transaction database or the official log of the player, both already in DISI.
const careerEmpty = load(path.join(dir, 'people', `career-${P.lutz.mlb_id}.json`))
need(Array.isArray(careerEmpty.stats) && careerEmpty.stats.length === 0 && !P.lutz.mlb_debut_date && !P.lutz.retrosheet_id, 'Lutz: no major-league record')
need(![...bio.values()].some((b) => b[1] === 'Lutz' && /^Ken/.test(b[2])), 'Lutz: BIOFILE (every major-league player) has no Kenneth Lutz')
// ---- migration values ------------------------------------------------------------------------------------------------------------
const pins = [P.leyritz.mlb_id]
const migrationValues = {
  retrieved_at: `${RETRIEVED}T00:00:00Z`,
  existing_source_urls: [URL.retrosheet, URL.log(P.baez.mlb_id), URL.log(P.castro.mlb_id), URL.register].sort(),
  events: events.map((e) => ({
    key: e.key, date: e.date, type: e.type, from: 'LAD', to: e.to ?? '', historical_label: e.historical_label ?? '', source_url: e.source_url, description: e.description,
    assets: e.assets.map((a) => ({ side: a.side, type: a.type, name: a.name, player_slug: a.player_slug ?? '', mlb_id: a.mlb_id ?? '', bref_id: a.bref_id ?? '', bref_register_id: a.bref_register_id ?? '',
      counterparty: a.counterparty ?? '', role_note: a.role_note ?? '' })),
  })).sort((a, b) => cmp(a.date, b.date) || cmp(a.key, b.key)),
  war_unavailable_mlb_ids: pins,
  // the existing events 053 must find exactly as they are (it changes none of them)
  existing_events: ['LAD_CHC_1990_VIZCAINO', 'LAD_FA_2001_PARK', 'LAD_FREE_AGENCY_2009_JUAN_CASTRO', 'LAD_FREE_AGENCY_2020_PEDRO_BAEZ', 'LAD_MON_1995_DAAL', 'LAD_RELEASE_2022_PEDRO_BAEZ'],
}
for (const e of migrationValues.events) {
  need(/^\d{4}-\d{2}-\d{2}$/.test(e.date), `${e.key}: an exact date`)
  need(['TRADE', 'FREE_AGENCY', 'FREE_AGENT_SIGNING'].includes(e.type), `${e.key}: a type the schema allows`)
  need(e.type === 'TRADE' ? Boolean(e.to) : !e.to, `${e.key}: a trade has a counterparty; a signing or a free agency has none`)
  for (const a of e.assets) {
    need(a.type !== 'CASH' || (!a.mlb_id && !a.bref_id), `${e.key}: cash carries no identity and no amount`)
    need(a.type !== 'PLAYER' || a.mlb_id, `${e.key}: ${a.name}: every player asset carries an MLB id`)
  }
}

// ---- research artifacts -------------------------------------------------------------------------------------------------------------
const evidence = {
  as_of: RETRIEVED,
  sources: {
    retrosheet: { url: URL.retrosheet, sha256_tran_txt: sha256(tranBuf), note: 'The same file Migration 049 read (identical sha256).' },
    biofile: { url: URL.biofile, sha256: sha256(bioBuf) },
    register: { url: URL.register, files: registerFiles.length, sha256: registerHash.digest('hex') },
    mlb_log: { endpoint: log.meta.endpoint, person_endpoint: log.meta.personEndpoint, players: log.records.length, errors: log.meta.errors },
  },
  identities: Object.values(P).sort((a, b) => cmp(a.mlb_id, b.mlb_id)),
  events: events.map(({ assets, ...e }) => ({ ...e, assets: assets.map((a) => ({ side: a.side, type: a.type, name: a.name, mlb_id: a.mlb_id ?? null })) })),
  conflicts,
  stated_not_recorded: [castroUnrecorded],
}

const bySlug = new Map(before.signings.map((s) => [s.player_slug, s]))
const group = (rows) => { const m = new Map(); for (const r of rows ?? []) { if (!m.has(r.player_id)) m.set(r.player_id, []); m.get(r.player_id).push(r) } return m }
const state = (data) => {
  const stints = group(data.stints), tx = group(data.transactions), ms = group(data.milestones)
  const needs = developmentNeeds(data)
  const causes = needCauses(needs, (id) => stints.get(id) ?? [], (id) => tx.get(id) ?? [], (id) => ms.get(id) ?? [])
  const seasons = []
  for (const [pid, st] of stints) for (const m of multiOrganizationSeasons(st, tx.get(pid) ?? [])) seasons.push({ player_slug: st[0].player_slug, ...m })
  seasons.sort((a, b) => cmp(a.player_slug, b.player_slug) || a.season - b.season)
  return { needs, causes, seasons, tx, stints, summary: developmentNeedSummary(data) }
}
const B = state(before)
const A = after ? state(after) : null

// the official log rows that state a season's move, for the record (a move between two other clubs is not a Dodgers transaction)
const logMoves = (slug, season) => {
  const s = bySlug.get(slug)
  const rec = s && [...logBy.values()].find((r) => r.slug === slug)
  if (!rec) return []
  return rec.transactions.filter((t) => String(t.date).startsWith(String(season)) && ['TR', 'SFA', 'REL', 'CLW', 'SGN', 'DFA', 'RET', 'PUR'].includes(t.typeCode))
    .map((t) => ({ mlb_log_id: t.id, date: t.date, type_code: t.typeCode, description: t.description }))
}
const retroMoves = (slug, season) => {
  const s = bySlug.get(slug)
  if (!s) return []
  const rec = [...logBy.values()].find((r) => r.slug === slug)
  const reg = rec && register.get(String(rec.mlbId))
  if (!reg?.key_retro) return []
  return tran.filter((t) => t.player === reg.key_retro && t.date.startsWith(String(season)) && ['T', 'F', 'R', 'W', 'Fg', 'C', 'P', 'X'].includes(t.type))
    .map((t) => ({ retrosheet_transaction_id: t.id, date: retroDate(t), type: t.type, from: t.from || null, to: t.to || null }))
}

// "before" is the released 052 state: its needs and classes (gap-classification.json) and its season states (multi-organization-seasons.json),
// both derived by the 052 rule from the same canonical rows
const gap052 = load(path.join(here, '../052/gap-classification.json')).after
const seasons052 = new Map(load(path.join(here, '../052/multi-organization-seasons.json')).seasons.map((m) => [`${m.player_slug}|${m.season}`, m.state]))
const blocked = gap052.needs.filter((c) => c.gap_class === 'TRANSACTION_BLOCKED').sort((a, b) => cmp(a.player_slug, b.player_slug))
need(blocked.length === gap052.counts.TRANSACTION_BLOCKED, '052: the transaction-blocked needs')
const openSeasons = (st, slug) => st.seasons.filter((m) => m.player_slug === slug && !['BRACKETED'].includes(seasons052.get(`${slug}|${m.season}`)))
// the 053 events of this player dated in this season
const writtenFor = (slug, season) => events.filter((e) => e.date.startsWith(String(season)) && e.assets.some((a) => a.player_slug === slug)).map((e) => e.key)

// Phase 2: one class per primary blocker, before anything is written
const classify = (slug, m) => {
  const was = seasons052.get(`${slug}|${m.season}`)
  if (was === 'TRANSACTION_RECORDED_DATES_BEFORE_GAME_LOGS') return 'EVENT_PRESENT_DATE_INSUFFICIENT'
  if (was === 'MORE_THAN_TWO_ORGANIZATIONS') return m.dodgers_involved ? 'SOURCE_LIMITED' : (retroMoves(slug, m.season).length ? 'MISSING_EVENT' : 'SOURCE_LIMITED')
  if (m.dodgers_involved) {
    if (writtenFor(slug, m.season).length) return 'MISSING_EVENT'
    const s = bySlug.get(slug)
    const tx = (B.tx.get(s.player_id) ?? []).filter((t) => String(t.transaction_date).startsWith(String(m.season)))
    return tx.length ? 'NOT_A_TRANSACTION_GAP' : 'SOURCE_LIMITED'
  }
  return logMoves(slug, m.season).length || retroMoves(slug, m.season).length ? 'MISSING_EVENT' : 'SOURCE_LIMITED'
}
const CLASSES = ['MISSING_EVENT', 'EVENT_PRESENT_DATE_INSUFFICIENT', 'EVENT_PRESENT_TYPE_INSUFFICIENT', 'EVENT_PRESENT_DESTINATION_INSUFFICIENT', 'PACKAGE_MEMBERSHIP_OPEN',
  'PTBNL_OPEN', 'TERMS_OPEN', 'SOURCE_LIMITED', 'NOT_A_TRANSACTION_GAP']
const scope = (m) => (m.dodgers_involved ? 'DODGERS_TRANSACTION' : 'LATER_ORGANIZATION_HISTORY')
const primary = blocked.map((c) => {
  const s = bySlug.get(c.player_slug)
  const seasons = openSeasons(B, c.player_slug).map((m) => ({
    season: m.season, organizations: m.organizations, segments: m.segments, state_052: seasons052.get(`${c.player_slug}|${m.season}`), scope: scope(m),
    known_transactions: (B.tx.get(s.player_id) ?? []).map((t) => ({ event_key: t.event_key ?? null, date: String(t.transaction_date).slice(0, 10), type: t.transaction_type, player_side: t.player_side,
      move: playerMove(t) })).filter((t) => t.date.startsWith(String(m.season))),
    class: classify(c.player_slug, m),
    official_log: logMoves(c.player_slug, m.season), retrosheet: retroMoves(c.player_slug, m.season),
    reason: m.dodgers_involved
      ? (m.state === 'MORE_THAN_TWO_ORGANIZATIONS' ? 'Three organizations in one season; the rule brackets exactly two.' : seasons052.get(`${c.player_slug}|${m.season}`) === 'TRANSACTION_RECORDED_DATES_BEFORE_GAME_LOGS' ? 'The Dodgers transaction is recorded; the stints predate the official game log, so no appearance date can bracket it (source-limited).' : 'A move at the Dodgers boundary.')
      : 'A move between two clubs other than the Dodgers. DISI\'s transaction ledger records Dodgers transactions only; recording another club\'s trade or signing there would read as a Dodgers exit in the asset views.',
    canonical_write: writtenFor(c.player_slug, m.season),
  }))
  return { player_slug: c.player_slug, full_name: s.full_name, signing_year: s.signing_year, need: c.need, issues: c.issues, gap_class_052: c.gap_class, cause_052: c.cause, seasons }
})

// workset B / C / D: the transaction-queue items, packages and chains that involve the same players
const primarySlugs = new Set(primary.map((p) => p.player_slug))
const primaryEvents = new Set(primary.flatMap((p) => (B.tx.get(bySlug.get(p.player_slug).player_id) ?? []).map((t) => t.event_key).filter(Boolean)))
const overlapTx = before.transactionQueue.filter((x) => primarySlugs.has(x.player_slug) || primaryEvents.has(x.event_key))
const overlapVal = before.valueQueue.filter((x) => primarySlugs.has(x.player_slug) || primaryEvents.has(x.event_key))
const workset = {
  as_of: RETRIEVED,
  rule: 'A: every development need classified TRANSACTION_BLOCKED after 052. B: every canonical transaction or value research item of the same player or one of his events. C: a package only where a primary blocker needs its membership or terms. D: the adjacent hop of a returned asset an A or B write records.',
  A_primary: primary.map((p) => ({ player_slug: p.player_slug, seasons: p.seasons.map((s) => s.season) })),
  B_transaction_items: overlapTx.map((x) => ({ issue: x.issue, event_key: x.event_key ?? null, player_slug: x.player_slug ?? null, asset_name: x.asset_name ?? null })),
  B_value_items: overlapVal.map((x) => ({ issue: x.issue, event_key: x.event_key ?? null, player_slug: x.player_slug ?? null })),
  C_packages: [],
  C_note: 'No primary blocker depends on a package\'s membership or terms: every open season is either at the Dodgers boundary (a signing or an exit) or a move between two other clubs. The overlapping cash-amount items stay as they are.',
  D_downstream: events.filter((e) => e.workset.includes('D')).map((e) => e.key),
  not_in_workset: before.transactionQueue.filter((x) => x.issue === 'DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION' && !overlapTx.includes(x))
    .map((x) => ({ issue: x.issue, event_key: x.event_key, asset_name: x.asset_name, why: 'Same pattern, but not a player in the primary workset; a later batch can record it from the same sources.' })),
}

const classification = {
  as_of: RETRIEVED,
  classes: CLASSES,
  rule: 'Classified before any write. A season at the Dodgers boundary whose Dodgers transaction an approved source states is MISSING_EVENT; one whose existing Dodgers transaction already brackets it is NOT_A_TRANSACTION_GAP (the 052 rule could not read a release or a signing); a move between two other clubs is MISSING_EVENT when the official log or Retrosheet states it and SOURCE_LIMITED otherwise. A move between two other clubs is never recorded in the Dodgers ledger.',
  counts: Object.fromEntries(CLASSES.map((k) => [k, primary.flatMap((p) => p.seasons).filter((s) => s.class === k).length])),
  counts_by_scope: countBy(primary.flatMap((p) => p.seasons), (s) => `${s.scope}|${s.class}`),
  seasons: primary.flatMap((p) => p.seasons.map((s) => ({ player_slug: p.player_slug, season: s.season, scope: s.scope, state_052: s.state_052, class: s.class, canonical_write: s.canonical_write }))),
}

write('transaction-evidence.json', evidence)
write('migration-values.json', migrationValues)
write('workset.json', workset)
write('transaction-blocker-classification.json', classification)
write('baseline.json', {
  as_of: RETRIEVED,
  read: 'Production, read-only as the public anon role, at canonical main 2f664f9 (generation 8).',
  development: { ...B.summary, gap_classes: gapClassCounts(B.causes), transaction_blocked: blocked.length },
  multi_organization_seasons: countBy(B.seasons, (m) => m.state),
  transactions: { events: new Set(beforeRaw.transactions.filter((t) => t.event_key).map((t) => t.event_key)).size, transaction_rows: beforeRaw.transactions.length },
  transaction_queue: { items: before.transactionQueue.length, by_issue: countBy(before.transactionQueue, (x) => x.issue),
    players: new Set(before.transactionQueue.map((x) => x.player_slug).filter(Boolean)).size, events: new Set(before.transactionQueue.map((x) => x.event_key).filter(Boolean)).size },
  value_queue: { items: before.valueQueue.length, by_issue: countBy(before.valueQueue, (x) => x.issue) },
  packages: { ...packageCompleteness(before), ...packageBlockerSplit(before) },
  research_items_by_bucket: countBy(transactionResearchItems(before, {}), (x) => x.bucket),
  primary,
})

// the research, case by case: what the sources state, what was recorded, and why anything stated was not
const eventOf = new Map(events.map((e) => [e.key, e]))
write('transaction-research.json', {
  as_of: RETRIEVED,
  source_order: ['official MLB transaction log (Stats API)', 'official MLB person record and career statistics', 'Retrosheet transaction database (accepted by 049 for historical transactions)',
    'Retrosheet BIOFILE and the Chadwick Register (identity crosswalks)'],
  result_vocabulary: {
    RECORDED: 'A Dodgers transaction an approved source states, recorded by Migration 053.',
    ALREADY_RECORDED: 'The Dodgers end of the move was already a canonical transaction; the 052 rule could not read it.',
    LATER_ORGANIZATION_HISTORY: 'A move between two clubs other than the Dodgers. The official log or Retrosheet may state it; DISI\'s ledger records Dodgers transactions only.',
    STATED_NOT_RECORDED: 'An approved source states it; recording it would need a sealed row no rollback can remove, so it is left for a reviewed batch.',
    SOURCE_LIMITED: 'No approved readable source states the transaction or the appearance dates.',
  },
  primary: primary.map((p) => ({
    player_slug: p.player_slug, full_name: p.full_name,
    seasons: p.seasons.map((s) => ({
      season: s.season, organizations: s.organizations, scope: s.scope, class: s.class,
      result: s.canonical_write.length ? 'RECORDED' : s.class === 'NOT_A_TRANSACTION_GAP' ? 'ALREADY_RECORDED' : s.scope === 'LATER_ORGANIZATION_HISTORY'
        ? 'LATER_ORGANIZATION_HISTORY' : s.class === 'EVENT_PRESENT_DATE_INSUFFICIENT' ? 'SOURCE_LIMITED' : p.player_slug === 'juan-castro' ? 'STATED_NOT_RECORDED' : 'SOURCE_LIMITED',
      recorded: s.canonical_write.map((k) => ({ event_key: k, date: eventOf.get(k).date, type: eventOf.get(k).type })),
      official_log: s.official_log, retrosheet: s.retrosheet, reason: s.reason,
    })),
  })),
  re_acquisitions: events.filter((e) => e.workset.includes('B')).map((e) => ({ event_key: e.key, date: e.date, type: e.type, closes: e.closes, evidence: e.evidence })),
  downstream: events.filter((e) => e.workset.includes('D')).map((e) => ({ event_key: e.key, date: e.date, type: e.type, evidence: e.evidence,
    why: 'The adjacent hop: the returned player\'s own Dodgers exit, so his control interval closes on a stated date (an open interval would claim control continues).' })),
  stated_not_recorded: [castroUnrecorded],
  outside_workset: workset.not_in_workset,
  historical_problem_cases: {
    note: 'Revisited only where they intersect the workset (Offerman, Mondesi and Fernandez are primary players; their open chains are not what blocks the development need).',
    chains: before.valueQueue.filter((x) => ['jose-offerman', 'raul-mondesi', 'chico-fernandez'].includes(x.player_slug) && x.issue === 'DOWNSTREAM_ASSET_CHAIN_INCOMPLETE')
      .map((x) => ({ player_slug: x.player_slug, detail: x.detail, result: 'UNCHANGED: the open chain concerns a returned asset, not the season move; no new readable evidence was sought for it in 053' })),
  },
})
write('source-manifest.json', {
  as_of: RETRIEVED,
  read: [
    { source: 'MLB Stats API transaction log', endpoint: log.meta.endpoint, players: log.records.length, errors: log.meta.errors, cited_by_rows: true },
    { source: 'MLB Stats API person record', endpoint: log.meta.personEndpoint, players: log.records.length, cited_by_rows: false, used_for: 'identity (birth date, debut)' },
    { source: 'MLB Stats API career statistics', url: URL.career(P.lutz.mlb_id), used_for: 'that Kenny Lutz has no major-league record (documented; not written)' },
    { source: 'Retrosheet transaction database', url: URL.retrosheet, sha256_tran_txt: sha256(tranBuf), cited_by_rows: true },
    { source: 'Retrosheet BIOFILE', url: URL.biofile, sha256: sha256(bioBuf), used_for: 'identity (birth date); no major-league record for a minor leaguer' },
    { source: 'Chadwick Bureau Register', url: URL.register, files: registerFiles.length, used_for: 'MLB, Retrosheet and Baseball-Reference id crosswalk' },
  ],
  sources_added: [],
  not_used: [
    { source: 'Search-engine results', why: 'discovery only; never evidence' },
    { source: 'Baseball-Reference WAR files', why: 'not read: 049 recorded HTTP 403 for war_daily_bat.txt and war_daily_pitch.txt; no WAR is loaded by 053' },
    { source: 'The BAI project cache of the Retrosheet file', why: 'not touched; the file was read fresh from Retrosheet (identical sha256 to 049)' },
  ],
  rows_cite: [...new Set(events.map((e) => e.source_url))].sort(),
})

if (A) {
  const key = (m) => `${m.player_slug}|${m.season}`
  const afterSeasons = new Map(A.seasons.map((m) => [key(m), m]))
  const ruleOnly = (() => { const out = []; for (const [pid, st] of B.stints) for (const m of multiOrganizationSeasons(st, B.tx.get(pid) ?? [])) out.push({ player_slug: st[0].player_slug, ...m }); return new Map(out.map((m) => [key(m), m])) })()
  const art052 = new Map(load(path.join(here, '../052/multi-organization-seasons.json')).seasons.map((m) => [key(m), m.state]))
  write('chronology-before-after.json', {
    as_of: RETRIEVED,
    rule: 'Before: the 052 rule over the canonical state before 053. Rule only: the 053 rule over the same data (the detector correction alone). After: the 053 rule over the canonical state after 053.',
    before: countBy([...art052.values()], (s) => s), rule_only: countBy([...ruleOnly.values()], (m) => m.state), after: countBy(A.seasons, (m) => m.state),
    changed: [...new Set([...art052.keys(), ...afterSeasons.keys()])].sort().filter((k) => art052.get(k) !== afterSeasons.get(k)?.state).map((k) => ({
      season: k, before: art052.get(k) ?? null, rule_only: ruleOnly.get(k)?.state ?? null, after: afterSeasons.get(k)?.state ?? null,
      transaction: afterSeasons.get(k)?.transaction ?? null, segments: afterSeasons.get(k)?.segments ?? null,
      why: ruleOnly.get(k)?.state !== art052.get(k) ? 'Detector correction: the Dodgers end of the move is an existing canonical transaction inside the bracket.' : 'Data: Migration 053 records the Dodgers transaction an approved source states.',
    })),
  })
  const needKey = (n) => `${n.player_slug}|${n.need}`
  const afterCauses = new Map(A.causes.map((c) => [needKey(c), c]))
  write('development-needs-before-after.json', {
    as_of: RETRIEVED,
    before: { ...B.summary, gap_classes: gapClassCounts(B.causes) },
    after: { ...A.summary, gap_classes: gapClassCounts(A.causes) },
    transaction_blocked: primary.map((p) => {
      const a = afterCauses.get(`${p.player_slug}|${p.need}`)
      return { player_slug: p.player_slug, before: { gap_class: p.gap_class_052, cause: p.cause_052 }, evidence: p.seasons.map((s) => ({ season: s.season, class: s.class, canonical_write: s.canonical_write })),
        after: a ? { gap_class: a.gap_class, cause: a.cause } : { gap_class: 'CLOSED', cause: 'Every multi-organization season is bracketed by a canonical transaction.' } }
    }),
    resolved: B.causes.filter((c) => !afterCauses.has(needKey(c))).map((c) => ({ player_slug: c.player_slug, need: c.need, before: c.gap_class })),
    added: A.causes.filter((c) => !B.causes.some((b) => needKey(b) === needKey(c))).map((c) => ({ player_slug: c.player_slug, need: c.need, gap_class: c.gap_class })),
    reclassified: A.causes.filter((c) => B.causes.some((b) => needKey(b) === needKey(c) && b.gap_class !== c.gap_class)).map((c) => ({ player_slug: c.player_slug, need: c.need,
      before: B.causes.find((b) => needKey(b) === needKey(c)).gap_class, after: c.gap_class })),
  })
  const qKey = (x) => `${x.issue}|${x.event_key ?? ''}|${x.player_slug ?? ''}|${x.asset_name ?? ''}`
  const diffQueue = (b, a) => ({
    before: { items: b.length, by_issue: countBy(b, (x) => x.issue) }, after: { items: a.length, by_issue: countBy(a, (x) => x.issue) },
    resolved: b.filter((x) => !a.some((y) => qKey(y) === qKey(x))).map((x) => ({ issue: x.issue, event_key: x.event_key ?? null, player_slug: x.player_slug ?? null, asset_name: x.asset_name ?? null,
      by: events.filter((e) => e.closes.includes(`${x.issue}|${x.event_key}`)).map((e) => e.key) })),
    added: a.filter((x) => !b.some((y) => qKey(y) === qKey(x))).map((x) => ({ issue: x.issue, event_key: x.event_key ?? null, player_slug: x.player_slug ?? null, asset_name: x.asset_name ?? null, detail: x.detail ?? null })),
  })
  write('transaction-needs-before-after.json', { as_of: RETRIEVED, ...diffQueue(before.transactionQueue, after.transactionQueue),
    buckets: { before: countBy(transactionResearchItems(before, {}), (x) => x.bucket), after: countBy(transactionResearchItems(after, {}), (x) => x.bucket) } })
  write('value-needs-before-after.json', { as_of: RETRIEVED, ...diffQueue(before.valueQueue, after.valueQueue) })
  write('package-research.json', {
    as_of: RETRIEVED,
    before: { ...packageCompleteness(before), ...packageBlockerSplit(before), open: openPackages(before).map((p) => ({ event_key: p.event_key, package_state: p.package_state, issues: p.issues })) },
    after: { ...packageCompleteness(after), ...packageBlockerSplit(after), open: openPackages(after).map((p) => ({ event_key: p.event_key, package_state: p.package_state, issues: p.issues })) },
    new_packages: events.filter((e) => e.type === 'TRADE').map((e) => ({
      event_key: e.key, agreement: e.date, membership: e.assets.map((a) => `${a.side} ${a.type} ${a.name}`), later_completion: null,
      terms: e.assets.filter((a) => a.type !== 'PLAYER').map((a) => ({ type: a.type, amount: null, why: 'Retrosheet records cash moving and no amount: unknown, never zero.' })),
      completeness: 'Every row of the Retrosheet transaction is recorded; Retrosheet records the whole exchange under one transaction id.',
    })),
  })
}

process.stderr.write(`053 derive: ${events.length} events, ${conflicts.length} conflicts, ${blocked.length} transaction-blocked needs${A ? ', after read' : ''}\n`)
