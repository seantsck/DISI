#!/usr/bin/env node
// Derives database/research/049/transaction-evidence.json from sources read directly:
//   tran.txt      Retrosheet transactions database (tranDB.zip)
//   biofile.csv   Retrosheet BIOFILE (birth dates)
//   register/     Chadwick Bureau Register people-*.csv (Retrosheet / MLBAM / Baseball-Reference id crosswalk)
//   api/          official MLB Stats API: p-<mlbam>.json (person record), tx-<mlbam>.json (transaction log), yby-<mlbam>-<group>.json (season affiliations)
//   web/          SABR biography pages (raw HTML) used only as a second reading of the 1967 package
//
//   node database/research/049/derive-transactions.mjs <dir> [retrieved_at]
//
// Every fact recorded is an exact source row. A player is matched to a source row by an identifier crosswalk AND an exact birth date, never by
// name alone. Anything a source does not state stays UNRESOLVED with the reason; nothing is inferred from a player's absence from later records.
// UNKNOWN TRANSACTION != RELEASED. KNOWN TRANSACTION != KNOWN RETURN VALUE.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(process.argv[2] ?? '.')
const retrievedAt = process.argv[3] ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z')
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const csvLine = (l) => l.match(/("[^"]*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, ''))
const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const tranRaw = fs.readFileSync(path.join(dir, 'tran.txt'), 'latin1')
const tran = tranRaw.split(/\r?\n/).filter(Boolean).map((raw) => { const c = csvLine(raw); return { raw, date: c[0], id: Number(c[5]), player: c[6], type: c[7].trim(), from: c[8], to: c[10], pick: c[14], info: c[15] } })
const bio = fs.readFileSync(path.join(dir, 'biofile.csv'), 'latin1').split(/\r?\n/).slice(1).filter(Boolean).map(csvLine)
const register = new Map()
for (const f of fs.readdirSync(path.join(dir, 'register')).filter((n) => /^people-[0-9a-f]\.csv$/.test(n)).sort()) {
  const lines = fs.readFileSync(path.join(dir, 'register', f), 'utf8').split(/\r?\n/).filter(Boolean)
  const head = csvLine(lines[0])
  for (const l of lines.slice(1)) { const c = csvLine(l); const r = Object.fromEntries(head.map((h, i) => [h, c[i]])); if (r.key_retro) register.set(r.key_retro, r); if (r.key_mlbam) register.set(`mlbam:${r.key_mlbam}`, r) }
}
const api = (n) => JSON.parse(fs.readFileSync(path.join(dir, 'api', n), 'utf8'))

/** Identity: Retrosheet id -> BIOFILE birth date == Register birth date == MLB person record birth date; MLBAM and Baseball-Reference ids from the Register. */
function identity(name, retro, mlbId) {
  const b = bio.filter((r) => r[0] === retro)
  if (b.length !== 1) throw new Error(`${name}: Retrosheet id ${retro} not found once in BIOFILE`)
  const [m, d, y] = b[0][4].split('/')
  const birth = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  const reg = register.get(retro)
  if (!reg) throw new Error(`${name}: ${retro} is not in the Chadwick Register`)
  if (reg.key_mlbam !== String(mlbId)) throw new Error(`${name}: Register MLBAM ${reg.key_mlbam} differs from ${mlbId}`)
  const regBirth = `${reg.birth_year}-${reg.birth_month.padStart(2, '0')}-${reg.birth_day.padStart(2, '0')}`
  const person = api(`p-${mlbId}.json`).people[0]
  if (!(birth === regBirth && birth === person.birthDate)) throw new Error(`${name}: birth dates disagree (BIOFILE ${birth}, Register ${regBirth}, MLB ${person.birthDate})`)
  if (norm(b[0][1]) !== norm(person.lastName)) throw new Error(`${name}: surname mismatch`)
  if (!/^[a-z0-9]+$/.test(reg.key_bbref)) throw new Error(`${name}: no Baseball-Reference id in the Register`)
  return { name: person.fullName, mlb_id: String(mlbId), bref_id: reg.key_bbref, retrosheet_id: retro, birth_date_matched: birth }
}
const rows = (id) => tran.filter((t) => t.id === id)
const rowFor = (id, retro) => { const r = rows(id).filter((t) => t.player === retro); if (r.length !== 1) throw new Error(`Retrosheet transaction ${id}: ${retro} not found once`); return r[0] }

// ---- 1. the 1967 package (Retrosheet 60573) ---------------------------------------------------------------------------------
const MILLER = [
  ['Bob Miller', 'millb106', 119112, 'LAN'], ['Johnny Roseboro', 'rosej101', 121456, 'LAN'], ['Ron Perranoski', 'perrr101', 120430, 'LAN'],
  ['Mudcat Grant', 'granj101', 115046, 'MIN'], ['Zoilo Versalles', 'versz101', 123713, 'MIN'],
]
const pkgRows = rows(60573)
if (pkgRows.length !== 5 || new Set(pkgRows.map((r) => r.date)).size !== 1 || pkgRows[0].date !== '19671128') throw new Error('Retrosheet 60573 is not the five-player 1967-11-28 transaction')
const pkgPlayers = MILLER.map(([n, retro, mlb, from]) => {
  const r = rowFor(60573, retro)
  if (r.type !== 'T' || r.from !== from) throw new Error(`${n}: unexpected direction in 60573`)
  return { ...identity(n, retro, mlb), side: from === 'LAN' ? 'OUTGOING' : 'INCOMING', row: r.raw }
})

// SABR reads the same package (second source). Day-of-month disagreement is kept, not hidden.
const sabr = {}
for (const slug of ['zoilo-versalles', 'mudcat-grant', 'ron-perranoski']) {
  const buf = fs.readFileSync(path.join(dir, 'web', `sabr-${slug}.html`))
  const text = buf.toString('utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#8217;|&rsquo;/g, '’').replace(/\s+/g, ' ')
  sabr[slug] = { sha256: sha(buf), text }
}
const sentence = (t, needle) => { const i = t.indexOf(needle); if (i < 0) throw new Error(`SABR text lacks "${needle}"`); return t.slice(Math.max(0, i - 120), i + 330).trim() }
const sabrEvidence = {
  versalles: sentence(sabr['zoilo-versalles'].text, 'shipped off to the Los Angeles Dodgers on November 27, 1967'),
  grant: sentence(sabr['mudcat-grant'].text, 'were shipped to Los Angeles for catcher John Roseboro and pitchers Ron Perranoski and Bob Miller'),
  perranoski: sentence(sabr['ron-perranoski'].text, 'swapped Perranoski, Miller and catcher John Roseboro to the Twins on November 28'),
  versalles_expansion: sentence(sabr['zoilo-versalles'].text, 'San Diego Padres took a chance on drafting Versalles'),
  grant_expansion: sentence(sabr['mudcat-grant'].text, 'Grant was selected by the Montreal Expos in the expansion draft'),
}

// Dodgers exits of Grant and Versalles: the 1968-10-14 expansion draft (Retrosheet type X), also described by SABR
const exitGrant = rowFor(19808, 'granj101')
const exitVersalles = rowFor(54511, 'versz101')
/** @type {[typeof exitGrant, string, string][]} */
const expansionRows = [[exitGrant, 'MON', '36'], [exitVersalles, 'SDN', '20']]
for (const [r, to, pick] of expansionRows) {
  if (!(r.date === '19681014' && r.type === 'X' && r.from === 'LAN' && r.to === to && r.pick === pick)) throw new Error(`unexpected expansion-draft row ${r.raw}`)
}

// ---- 2. Abreu / Garland (Retrosheet 64131; official MLB log) ---------------------------------------------------------------
const garland = identity('Jon Garland', 'garlj001', 279782)
const abreu = identity('Tony Abreu', 'abret001', 473234)
const r64131 = rows(64131)
const gRow = rowFor(64131, 'garlj001')
const aRow = rowFor(64131, 'abret001')
if (r64131.length !== 2 || gRow.date !== '20090831' || gRow.from !== 'ARI' || gRow.to !== 'LAN' || aRow.date !== '20091009' || aRow.from !== 'LAN' || aRow.to !== 'ARI') throw new Error('Retrosheet 64131 is not the 2009 Garland-for-Abreu transaction')
const garlandLog = api('tx-279782.json').transactions
const logRow = (date, typeCode) => { const r = garlandLog.filter((t) => t.date === date && t.typeCode === typeCode); if (!r.length) throw new Error(`MLB log lacks ${typeCode} ${date}`); return { date: r[0].date, typeCode: r[0].typeCode, description: r[0].description } }
const garlandTrade = logRow('2009-08-31', 'TR')
const garlandFa = logRow('2009-11-05', 'DFA')
const abreuLog = api('tx-473234.json').transactions.filter((t) => t.date === '2009-10-09' && t.typeCode === 'TR')
if (!abreuLog.length) throw new Error('MLB log lacks the Abreu trade row')
const garlandExitRetro = rowFor(18248, 'garlj001')
if (!(garlandExitRetro.date === '20091105' && garlandExitRetro.type === 'Fg' && garlandExitRetro.from === 'LAN')) throw new Error('unexpected Retrosheet Garland free-agency row')
// no recorded transaction between the acquisition and the free agency may send Garland elsewhere
const between = garlandLog.filter((t) => t.date > '2009-08-31' && t.date < '2009-11-05' && ['TR', 'REL', 'WA', 'OUT', 'CLW', 'DFA'].includes(t.typeCode))
if (between.length) throw new Error('a Garland transaction between the trade and the free agency would change the exit')

// ---- 3. identities for assets recorded in earlier migrations with a name and no id ---------------------------------------------
// Each is a player whose professional season-by-season affiliations (official MLB Stats API, minors included) place him with the counterparty's
// organization in a season before the trade and with the Dodgers' organization in a season after it. Each affiliate's PARENT organization for that
// season is read from the official team record (api/team-<id>-<season>.json), not assumed from the club's name.
const AFFIL = (id) => {
  const out = []
  for (const g of ['pitching', 'hitting']) {
    const f = path.join(dir, 'api', `yby-${id}-${g}.json`)
    if (!fs.existsSync(f)) continue
    for (const s of JSON.parse(fs.readFileSync(f, 'utf8')).stats ?? []) {
      for (const sp of s.splits ?? []) {
        if (!sp.team?.id) continue
        const tf = path.join(dir, 'api', `team-${sp.team.id}-${sp.season}.json`)
        if (!fs.existsSync(tf)) throw new Error(`team record ${sp.team.id}/${sp.season} is missing from the cache`)
        out.push({ season: Number(sp.season), team: sp.team.name, parent: JSON.parse(fs.readFileSync(tf, 'utf8')).teams[0].parentOrgName ?? null })
      }
    }
  }
  return out
}
const lastDodgers = (aff) => aff.filter((a) => a.parent === 'Los Angeles Dodgers').sort((a, b) => b.season - a.season || (a.team < b.team ? -1 : 1))[0] ?? null
/** @type {{ event: string, name: string, mlb_id: string, before: [number, string, string], after: [number, string, string], trade_date: string }[]} */
const IDENT = [
  { event: 'LAD_DET_1999_DAVE_MLICKI', name: 'Apostol Garcia', mlb_id: '472796', before: [1998, 'Lakeland Tigers', 'Detroit Tigers'], after: [1999, 'San Antonio Missions', 'Los Angeles Dodgers'], trade_date: '1999-04-16' },
  { event: 'LAD_DET_1999_DAVE_MLICKI', name: 'Rick Roberts', mlb_id: '425540', before: [1998, 'Jamestown Jammers', 'Detroit Tigers'], after: [1999, 'Vero Beach Dodgers', 'Los Angeles Dodgers'], trade_date: '1999-04-16' },
  { event: 'LAD_ARI_2005_SHAWN_GREEN', name: 'Danny Muegge', mlb_id: '458260', before: [2004, 'South Bend Silver Hawks', 'Arizona Diamondbacks'], after: [2005, 'Vero Beach Dodgers', 'Los Angeles Dodgers'], trade_date: '2005-01-11' },
  { event: 'LAD_ARI_2005_SHAWN_GREEN', name: 'William Juárez', mlb_id: '452705', before: [2004, 'El Paso Diablos', 'Arizona Diamondbacks'], after: [2005, 'Jacksonville Suns', 'Los Angeles Dodgers'], trade_date: '2005-01-11' },
]
const affiliations = {}
const identities = IDENT.map((i) => {
  const person = api(`p-${i.mlb_id}.json`).people[0]
  if (norm(person.fullName) !== norm(i.name)) throw new Error(`${i.name}: MLB person record is ${person.fullName}`)
  const aff = AFFIL(i.mlb_id)
  affiliations[i.mlb_id] = aff
  const tradeYear = Number(i.trade_date.slice(0, 4))
  const has = (season, team, parent) => aff.some((a) => a.season === season && a.team === team && a.parent === parent)
  if (!has(i.before[0], i.before[1], i.before[2]) || !has(i.after[0], i.after[1], i.after[2])) throw new Error(`${i.name}: the affiliations and their parent organizations do not bracket the trade`)
  if (!(i.before[0] <= tradeYear && i.after[0] >= tradeYear)) throw new Error(`${i.name}: the bracketing seasons do not surround the trade`)
  const reg = register.get(`mlbam:${i.mlb_id}`)
  if (!reg) throw new Error(`${i.name}: not in the Register`)
  if (reg.birth_year && `${reg.birth_year}-${reg.birth_month.padStart(2, '0')}-${reg.birth_day.padStart(2, '0')}` !== person.birthDate) throw new Error(`${i.name}: Register and MLB birth dates differ`)
  return { event: i.event, asset: i.name, mlb_id: i.mlb_id, birth_date: person.birthDate, register_key_bbref_minors: reg.key_bbref_minors || null,
    affiliation_before_trade: { season: i.before[0], team: i.before[1], parent_organization: i.before[2] }, affiliation_after_trade: { season: i.after[0], team: i.after[1], parent_organization: i.after[2] }, trade_date: i.trade_date }
})
const checoAff = AFFIL('112226')
const last = (id) => { const l = lastDodgers(id === '112226' ? checoAff : affiliations[id]); if (!l) throw new Error(`${id}: no Dodgers-parented season`); return l }

// ---- 4. what could not be resolved, and why ------------------------------------------------------------------------------------
const frias = rowFor(76439, 'friac001')
const friasApi = api('cle2017.json').transactions.filter((t) => /Dodgers|Frias/.test(t.description ?? ''))
const unresolved = [
  { issue: 'RETURN_ASSET_EXIT_MISSING', asset: 'Gail Harris', event: 'LAD_DET_1960_AMOROS', result: 'UNRESOLVED_NO_EVIDENCE',
    reason: 'Retrosheet (60183) records only the 1960-05-07 trade to the Dodgers; his last MLB game (1960-05-03) predates it. The MLB transaction log does not reach 1960 and the SABR page body is not in the raw response. No Dodgers disposition is stated anywhere readable: no exit is inferred.' },
  { issue: 'EXIT_NOT_RESEARCHED_DOWNSTREAM', asset: 'Robinson Checo', event: 'LAD_DET_1999_DAVE_MLICKI', result: 'UNRESOLVED_NO_EVIDENCE',
    reason: `Retrosheet ends at the 1999-04-16 trade to the Dodgers; the official affiliations (parent organization read from each team record) show his last Dodgers-organization season is ${last('112226').season} (${last('112226').team}) and nothing after. Disappearance is not a release.` },
  { issue: 'EXIT_NOT_RESEARCHED_DOWNSTREAM', asset: 'Apostol Garcia', event: 'LAD_DET_1999_DAVE_MLICKI', result: 'PARTIALLY_RESOLVED',
    reason: `Identity reconciled (MLBAM 472796). Retrosheet lists him by name only with no later transaction; his last Dodgers-organization season is ${last('472796').season} (${last('472796').team}). No exit stated.` },
  { issue: 'EXIT_NOT_RESEARCHED_DOWNSTREAM', asset: 'Rick Roberts', event: 'LAD_DET_1999_DAVE_MLICKI', result: 'PARTIALLY_RESOLVED',
    reason: `Identity reconciled (MLBAM 425540). His last Dodgers-organization season is ${last('425540').season} (${last('425540').team}). No exit stated.` },
  { issue: 'EXIT_NOT_RESEARCHED_DOWNSTREAM', asset: 'Danny Muegge', event: 'LAD_ARI_2005_SHAWN_GREEN', result: 'PARTIALLY_RESOLVED',
    reason: `Identity reconciled (MLBAM 458260). His last Dodgers-organization season is ${last('458260').season} (${last('458260').team}). The MLB transaction log has no row for him. No exit stated.` },
  { issue: 'EXIT_NOT_RESEARCHED_DOWNSTREAM', asset: 'William Juárez', event: 'LAD_ARI_2005_SHAWN_GREEN', result: 'PARTIALLY_RESOLVED',
    reason: `Identity reconciled (MLBAM 452705). The official log shows him activated by Las Vegas on 2006-04-04 and his last Dodgers-organization season is ${last('452705').season} (${last('452705').team}); 2008 is a Mexican League club. No transaction ends his Dodgers control in any readable source.` },
  { issue: 'RETURN_UNRECORDED', asset: 'Mike Judd', event: 'LAD_TB_2001_MIKE_JUDD', result: 'UNRESOLVED_NO_EVIDENCE',
    reason: 'Both Baseball-Reference and Retrosheet describe a conditional deal that names no return. An unnamed conditional return is not zero, cash or no return.' },
  { issue: 'PTBNL_UNRESOLVED', asset: 'Carlos Frías', event: 'LAD_CLE_2017_CARLOS_FRIAS', result: 'UNRESOLVED_NO_EVIDENCE',
    reason: `Retrosheet (76439: "${frias.info || 'player to be named or cash'}") and the official MLB log ("for Player To Be Named Later", 2017-01-30) agree it was a deferred consideration. Neither club's log through 2018-03 records a delivery (${friasApi.length} Cleveland/Dodgers rows read). It may have been cash; DISI does not assume cash, a player or zero.` },
  { issue: 'PTBNL_UNRESOLVED', asset: 'Jeral Perez trade (player to be named later or cash considerations)', event: 'LAD_CWS_2024_JERAL_PEREZ', result: 'UNRESOLVED_NO_EVIDENCE',
    reason: 'The official log (2024-07-29) names a player to be named later or cash considerations. The Dodgers and White Sox logs through 2026-10-21 record no completion.' },
  { issue: 'FUTURE_CONSIDERATIONS_UNRESOLVED', asset: 'Future considerations', event: 'LAD_STL_2019_TONY_CINGRANI', result: 'PARTIALLY_RESOLVED',
    reason: 'Retrosheet (82425) describes the Cardinals side of this package as cash and "international bonus slot money" where the MLB log says cash and future considerations. No amount or named item is given. Recorded as a description, not as a value.' },
  { issue: 'FUTURE_CONSIDERATIONS_UNRESOLVED', asset: 'Future considerations', event: 'LAD_CIN_2025_ARNALDO_LANTIGUA', result: 'UNRESOLVED_NO_EVIDENCE', reason: 'The official log names future considerations and no completion is recorded through 2026-10-21.' },
  { issue: 'FUTURE_CONSIDERATIONS_UNRESOLVED', asset: 'Future considerations', event: 'LAD_CWS_2023_MAXIMO_MARTINEZ', result: 'UNRESOLVED_NO_EVIDENCE', reason: 'The official log names future considerations and international signing bonus slot money with no amount.' },
  { issue: 'POOL_SPACE_AMOUNT_UNKNOWN', asset: 'International signing bonus slot money', event: 'LAD_CWS_2023_MAXIMO_MARTINEZ', result: 'UNRESOLVED_NO_EVIDENCE', reason: 'No source states the amount; DISI does not estimate pool space.' },
  { issue: 'CASH_AMOUNT_UNKNOWN', asset: 'Cash (16 packages)', event: null, result: 'UNRESOLVED_NO_EVIDENCE',
    reason: 'Retrosheet marks cash with "$" and no amount for every one of the sixteen packages; the MLB log says "cash". No amount is stated in any readable source. An unnamed cash payment is not $0.' },
]

// ---- 5. what was recorded, in the same result vocabulary -----------------------------------------------------------------------------
const recorded = [
  { issue: 'TRADE_RETURN_UNRECORDED', subject: 'Tony Abreu trade (2009): the consideration the Dodgers received', result: 'RESOLVED_PACKAGE',
    note: 'Jon Garland (agreement 2009-08-31); Abreu the player to be named later, delivered 2009-10-09. Official MLB log and Retrosheet 64131 agree on both dates.' },
  { issue: 'TRADE_RETURN_UNRECORDED', subject: 'Jon Garland: Dodgers value of the Abreu return', result: 'TRANSACTION_KNOWN_VALUE_UNKNOWN',
    note: 'Baseball-Reference WAR answers 403; the return is RETURN_WAR_UNKNOWN (NULL). Abreu was the only outgoing asset, so the trade is individually attributable once WAR is loaded.' },
  { issue: 'EXIT_NOT_RESEARCHED_DOWNSTREAM', subject: 'Jon Garland: Dodgers exit', result: 'RESOLVED_TRANSACTION', note: 'Elected free agency 2009-11-05 (official MLB log; Retrosheet 18248).' },
  { issue: 'EXIT_NOT_RESEARCHED_DOWNSTREAM', subject: 'Bob Miller: Dodgers exit (Fernandez chain)', result: 'RESOLVED_TRANSACTION', note: 'Traded 1967-11-28 to Minnesota (Retrosheet 60573; SABR Versalles, Grant and Perranoski biographies).' },
  { issue: 'EXIT_NOT_RESEARCHED_DOWNSTREAM', subject: '1967 Dodgers-Twins package', result: 'RESOLVED_PACKAGE', note: 'Miller, Roseboro, Perranoski out; Grant, Versalles in. Identities matched by crosswalk and birth date.' },
  { issue: 'EXIT_NOT_RESEARCHED_DOWNSTREAM', subject: 'Mudcat Grant: Dodgers exit', result: 'RESOLVED_TRANSACTION', note: '1968 expansion draft, Montreal, pick 36 (Retrosheet 19808; SABR Grant biography).' },
  { issue: 'EXIT_NOT_RESEARCHED_DOWNSTREAM', subject: 'Zoilo Versalles: Dodgers exit', result: 'RESOLVED_TRANSACTION', note: '1968 expansion draft, San Diego, pick 20 (Retrosheet 54511; SABR Versalles biography).' },
  { issue: 'DOWNSTREAM_WAR_NOT_LOADED', subject: 'Mudcat Grant and Zoilo Versalles: Dodgers value', result: 'TRANSACTION_KNOWN_VALUE_UNKNOWN', note: 'Baseball-Reference WAR answers 403; value NULL, not zero.' },
  { issue: 'SOURCE_DATE_DISAGREEMENT', subject: '1967 trade date', result: 'CONFLICT', note: 'Retrosheet and the SABR Perranoski biography say November 28; the SABR Versalles biography says November 27. Retrosheet\'s date is recorded and the disagreement is in the description.' },
  { issue: 'ASSET_IDENTITY_UNRESOLVED', subject: 'Apostol Garcia, Rick Roberts, Danny Muegge, William Juarez', result: 'RESOLVED_TRANSACTION', note: 'MLB ids added; reconciled by affiliations whose parent organizations bracket the trade. No exit recorded.' },
]

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const evidence = sortKeys({
  retrieved_at: retrievedAt,
  sources: {
    retrosheet: { url: 'https://www.retrosheet.org/transactions/tranDB.zip', sha256_tran_txt: sha(Buffer.from(tranRaw, 'latin1')) },
    garland_log: { url: 'https://statsapi.mlb.com/api/v1/transactions?playerId=279782', source_name: 'MLB Stats API', source_type: 'MLB_TRANSACTION_LOG', title: 'MLB Stats API: transaction log (Jon Garland)', source_tier: 'MLB_TRANSACTION_LOG',
      notes: 'Official MLB transaction log for Jon Garland (MLBAM 279782): the 2009-08-31 trade from Arizona and the 2009-11-05 election of free agency.' },
    register: { url: 'https://github.com/chadwickbureau/register', source_name: 'Chadwick Bureau Register', source_type: 'IDENTITY_CROSSWALK', title: 'Chadwick Bureau Register (people-*.csv)', source_tier: 'OTHER',
      notes: 'Open identifier crosswalk (Retrosheet, MLBAM, Baseball-Reference). Used for identity only, always together with an exact birth-date match against Retrosheet BIOFILE and the MLB person record; never as evidence of a transaction.' },
    sabr: ['zoilo-versalles', 'mudcat-grant', 'ron-perranoski'].map((s) => ({ url: `https://sabr.org/bioproj/person/${s}/`, sha256_html: sabr[s].sha256 })),
  },
  trade_1967: {
    event_key: 'LAD_MIN_1967_BOB_MILLER', date: '1967-11-28', retrosheet_transaction_id: 60573, players: pkgPlayers, sabr: sabrEvidence,
    date_note: 'Retrosheet and the SABR Perranoski biography give November 28, 1967; the SABR Versalles biography says November 27. Retrosheet\'s date is recorded and the disagreement is kept in the description.',
  },
  expansion_exits: [
    { key: 'LAD_MON_1968_GRANT_EXPANSION', date: '1968-10-14', to: 'WSH', franchise_name: 'Montreal Expos', pick: 36, retrosheet_transaction_id: 19808, row: exitGrant.raw, player: pkgPlayers.find((p) => p.mlb_id === '115046'), acquired_in_event: 'LAD_MIN_1967_BOB_MILLER' },
    { key: 'LAD_SD_1968_VERSALLES_EXPANSION', date: '1968-10-14', to: 'SD', franchise_name: 'San Diego Padres', pick: 20, retrosheet_transaction_id: 54511, row: exitVersalles.raw, player: pkgPlayers.find((p) => p.mlb_id === '123713'), acquired_in_event: 'LAD_MIN_1967_BOB_MILLER' },
  ],
  ptbnl_correction: {
    event_key: 'LAD_ARI_2009_TONY_ABREU', retrosheet_transaction_id: 64131,
    original: { date: '2009-10-09', description: 'Los Angeles Dodgers traded 2B Tony Abreu to Arizona Diamondbacks.' },
    initiated: '2009-08-31', completed: '2009-10-09',
    incoming: garland, ptbnl: abreu, retrosheet_rows: [gRow.raw, aRow.raw],
    mlb_log: { trade: garlandTrade, abreu_delivery: { date: abreuLog[0].date, typeCode: abreuLog[0].typeCode, description: abreuLog[0].description } },
  },
  garland_exit: { key: 'LAD_FREE_AGENCY_2009_JON_GARLAND', date: '2009-11-05', type: 'FREE_AGENCY', historical_label: 'Granted free agency', mlb_log: garlandFa, retrosheet_transaction_id: 18248, retrosheet_row: garlandExitRetro.raw, acquired_in_event: 'LAD_ARI_2009_TONY_ABREU', player: garland },
  identities,
  recorded,
  unresolved,
})
const dest = path.join(here, 'transaction-evidence.json')
fs.writeFileSync(dest, JSON.stringify(evidence, null, 2) + '\n')
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)}\n`)
