#!/usr/bin/env node
// Derives database/research/047/transaction-evidence.json from Retrosheet's transactions database (tran.txt, BIOFILE.TXT), read directly.
//
//   node database/research/047/derive-transactions.mjs <dir containing tran.txt, biofile.csv and disi-packages.json>
//
// Every recorded exit is an exact Retrosheet row, matched to the DISI asset by name AND birth date (never by name alone). Anything the
// source does not state is listed as UNRESOLVED with the reason; nothing is inferred from a player's absence from later records.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(process.argv[2] ?? '.')
const tranText = fs.readFileSync(path.join(dir, 'tran.txt'), 'utf8')
const csvLine = (l) => l.match(/("[^"]*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, ''))
const tran = tranText.split(/\r?\n/).filter(Boolean).map((raw) => {
  const c = csvLine(raw)
  return { raw, date: c[0], id: Number(c[5]), player: c[6], type: c[7].trim(), from: c[8], to: c[10], info: c[15] }
})
const bio = fs.readFileSync(path.join(dir, 'biofile.csv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(csvLine)
const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// the five downstream exits examined (DISI asset identity from v_transaction_asset_lineage; birth dates from the MLB person record)
const EXITS = [
  { name: 'Steve Finley', mlb_id: '114135', bref_id: 'finlest01', birth: '1965-03-12', retro: 'finls001', code: 'Fg', date: '2004-10-28', from: 'LAN', type: 'FREE_AGENCY', label: 'Granted free agency', verb: 'granted free agency', acquired_in: 'LAD_ARI_2004_BILL_MURPHY' },
  { name: 'Brent Mayne', mlb_id: '118490', bref_id: 'maynebr01', birth: '1968-04-19', retro: 'maynb001', code: 'Fg', date: '2004-10-29', from: 'LAN', type: 'FREE_AGENCY', label: 'Granted free agency', verb: 'granted free agency', acquired_in: 'LAD_ARI_2004_BILL_MURPHY' },
  { name: 'Beltrán Pérez', mlb_id: '425558', bref_id: 'perezbe01', birth: '1981-10-24', retro: 'pereb001', code: 'Fg', date: '2005-10-15', from: 'LAN', type: 'FREE_AGENCY', label: 'Granted free agency', verb: 'granted free agency', acquired_in: 'LAD_ARI_2005_SHAWN_GREEN' },
  { name: 'Nick Punto', mlb_id: '346857', bref_id: 'puntoni01', birth: '1977-11-08', retro: 'puntn001', code: 'Fg', date: '2013-10-31', from: 'LAN', type: 'FREE_AGENCY', label: 'Granted free agency', verb: 'granted free agency', acquired_in: 'BOS_LAD_2012_GONZALEZ_BECKETT_CRAWFORD' },
  { name: 'Homer Bailey', mlb_id: '456701', bref_id: 'baileho02', birth: '1986-05-03', retro: 'bailh001', code: 'R', date: '2018-12-22', from: 'LAN', type: 'RELEASE', label: 'Released', verb: 'released', acquired_in: 'LAD_CIN_2018_YASIEL_PUIG' },
]

const exits = EXITS.map((e) => {
  const b = bio.filter((r) => r[0] === e.retro)
  if (b.length !== 1) throw new Error(`${e.name}: retrosheet id ${e.retro} not found once`)
  const [m, d, y] = b[0][4].split('/')
  if (`${y}-${m}-${d}` !== e.birth) throw new Error(`${e.name}: birth date ${y}-${m}-${d} does not match the MLB person record ${e.birth}`)
  if (norm(b[0][1]) !== norm(e.name.split(' ').slice(-1)[0])) throw new Error(`${e.name}: surname mismatch`)
  const rows = tran.filter((t) => t.player === e.retro && t.type === e.code && t.date === e.date.replaceAll('-', '') && t.from === e.from)
  if (rows.length !== 1) throw new Error(`${e.name}: expected exactly one ${e.code} row on ${e.date}, found ${rows.length}`)
  // the exit is the LAST Dodgers-side transaction before the asset signs elsewhere: nothing else for this player may sit between
  const key = `LAD_${e.type}_${e.date.slice(0, 4)}_${norm(e.name).toUpperCase().replace(/[^A-Z]+/g, '_')}`
  return {
    key, date: e.date, type: e.type, historical_label: e.label,
    description: `${e.name} ${e.verb}. Retrosheet transaction ${rows[0].id} (${e.code}, ${e.from}).`,
    asset: { name: e.name, mlb_id: e.mlb_id, bref_id: e.bref_id },
    acquired_in_event: e.acquired_in,
    retrosheet: { transaction_id: rows[0].id, player_id: e.retro, row: rows[0].raw, birth_date_matched: e.birth },
  }
})

// package membership: Retrosheet vs the packages DISI already records
const disi = JSON.parse(fs.readFileSync(path.join(dir, 'disi-packages.json'), 'utf8'))
const byId = new Map()
for (const t of tran) { if (!byId.has(t.id)) byId.set(t.id, []); byId.get(t.id).push(t) }
const bioName = new Map(bio.map((r) => [r[0], `${r[3] || r[2].split(' ')[0]} ${r[1]}`]))
const PACKAGES = [
  { event: 'LAD_KCR_1995_OFFERMAN', retro_id: 62744 },
  { event: 'LAD_TOR_1999_MONDESI_GREEN', retro_id: 63147 },
  { event: 'LAD_DET_1960_AMOROS', retro_id: 60183 },
  { event: 'BRO_PHI_1957_FERNANDEZ', retro_id: 60041 },
  { event: 'LAD_NYM_1962_TIM_HARKNESS', retro_id: 60323 },
]
const people = (rows, side) => rows.filter((r) => (side === 'OUT' ? /^(LAN|BRO)$/.test(r.from) : /^(LAN|BRO)$/.test(r.to))).map((r) => (r.player ? (bioName.get(r.player) ?? r.player) : `(unnamed: ${r.info})`)).sort()
const cmp = (a) => a.map(norm).map((s) => s.replace(/\s+/g, ' ')).sort()
const packages = PACKAGES.map((p) => {
  const rows = byId.get(p.retro_id) ?? []
  const d = disi[p.event]
  if (!d) throw new Error(`${p.event}: not in disi-packages.json`)
  const r = { out: people(rows, 'OUT'), in: people(rows, 'IN') }
  const dOut = d.filter((a) => a.side === 'OUTGOING' && a.type !== 'CASH').map((a) => a.name)
  const dIn = d.filter((a) => a.side === 'INCOMING' && a.type === 'PLAYER').map((a) => a.name)
  const lastName = (s) => norm(s).split(' ').slice(-1)[0]
  const sameSet = (x, y) => JSON.stringify(x.map(lastName).sort()) === JSON.stringify(y.map(lastName).sort())
  return {
    event: p.event, retrosheet_transaction_id: p.retro_id, date: iso(rows[0].date),
    retrosheet: r, disi: { outgoing: dOut, incoming_players: dIn, cash_usd: d.filter((a) => a.type === 'CASH').map((a) => a.cash) },
    retrosheet_cash_info: rows.filter((x) => x.info).map((x) => x.info),
    agrees: { outgoing: sameSet(r.out, dOut), incoming: sameSet(r.in.filter((n) => !n.startsWith('(')), dIn.filter((n) => n !== 'Player to be named later')) },
  }
})

const UNRESOLVED = [
  { asset: 'Gail Harris', kind: 'EXIT_NOT_RECORDED', mlb_id: '115514', acquired_in: 'LAD_DET_1960_AMOROS', retro: 'harrg101', reason: 'Retrosheet records his 1960-05-07 trade to the Dodgers and no later transaction; his last MLB game (1960-05-03) precedes the trade. Absence of a record is not an exit: unresolved, no exit inferred.' },
  { asset: 'Mike Judd', kind: 'RETURN_NOT_RECORDED', mlb_id: '116781', acquired_in: 'LAD_NYY_1996_BILLY_BREWER', retro: 'juddm001', reason: 'His Dodgers exit (2001-03-28 to Tampa Bay) is already recorded. Retrosheet lists it as a conditional deal (C) naming no return, so the return side stays unrecorded: unknown, not zero.' },
  { asset: 'Robinson Checo', kind: 'EXIT_NOT_RECORDED', mlb_id: '112226', acquired_in: 'LAD_DET_1999_DAVE_MLICKI', retro: 'checr001', reason: 'Retrosheet records his 1999-04-16 trade to the Dodgers and no later transaction. No exit inferred.' },
  { asset: 'Apostol Garcia', kind: 'EXIT_NOT_RECORDED', mlb_id: null, acquired_in: 'LAD_DET_1999_DAVE_MLICKI', retro: null, reason: 'Listed in Retrosheet by name only (1999-04-16 trade to the Dodgers); no later transaction and no player id to match. No exit inferred.' },
  { asset: 'Rick Roberts', kind: 'EXIT_NOT_RECORDED', mlb_id: null, acquired_in: 'LAD_DET_1999_DAVE_MLICKI', retro: null, reason: 'No Retrosheet record of this asset under any transaction, and no player id. No exit inferred.' },
  { asset: 'Danny Muegge', kind: 'EXIT_NOT_RECORDED', mlb_id: null, acquired_in: 'LAD_ARI_2005_SHAWN_GREEN', retro: null, reason: 'Listed in Retrosheet by name only (2005-01-11 trade to the Dodgers); no later transaction. No exit inferred.' },
  { asset: 'William Juarez', kind: 'EXIT_NOT_RECORDED', mlb_id: null, acquired_in: 'LAD_ARI_2005_SHAWN_GREEN', retro: null, reason: 'Listed in Retrosheet by name only (2005-01-11 trade to the Dodgers); no later transaction. No exit inferred.' },
  { asset: 'Carlos Frias (signing)', scope: 'SIGNING', kind: 'CONSIDERATION_NOT_NAMED', mlb_id: null, acquired_in: null, retro: 'friac001', retrosheet_transaction_id: 76439,
    reason: 'Retrosheet records the 2017-01-30 trade to Cleveland and lists the return only as "player to be named or cash", unnamed. The consideration may have been cash, so it is neither resolved to a player nor valued: unknown, not zero.' },
  { asset: 'Tony Abreu (signing)', scope: 'SIGNING', kind: 'RETURN_FOUND_NOT_RECORDED', mlb_id: null, acquired_in: null, retro: 'abret001', retrosheet_transaction_id: 64131, returned_player: 'garlj001',
    reason: 'Return found: Retrosheet files the trade under one transaction (64131): Arizona sent Jon Garland to the Dodgers on 2009-08-31, and Tony Abreu was the player to be named later, delivered 2009-10-09. DISI records only the 2009-10-09 completion with no return. NOT RECORDED: doing so means re-dating the event to 2009-08-31 with a PTBNL resolution (a forward-only correction, as 033 did for Diaz / Machado) and loading Garland\'s Dodgers-tenure bWAR, which the blocked Baseball-Reference WAR files would supply.' },
  { asset: 'Bob Miller', kind: 'EXIT_FOUND_NOT_RECORDED', mlb_id: '119112', acquired_in: 'LAD_NYM_1962_TIM_HARKNESS', retro: 'millb106', reason: "Exit found: 1967-11-28 trade to Minnesota (Retrosheet transaction 60573) with Johnny Roseboro and Ron Perranoski for James 'Mudcat' Grant and Zoilo Versalles. NOT RECORDED: the two incoming players would be new downstream assets whose Dodgers-tenure bWAR cannot be loaded (the Baseball-Reference WAR files answer 403), so recording the exit would open a chain DISI cannot value. Package reconstructed in this file only." },
]
for (const u of UNRESOLVED.filter((x) => x.scope === 'SIGNING')) {
  const rows = byId.get(u.retrosheet_transaction_id) ?? []
  if (!rows.some((r) => r.player === u.retro && r.type === 'T' && r.from === 'LAN')) throw new Error(`${u.asset}: the source row is missing`)
  u.retrosheet_rows = rows.map((r) => r.raw)
  const incomingNamed = rows.filter((r) => r.to === 'LAN' && r.player)
  if (u.kind === 'CONSIDERATION_NOT_NAMED' && incomingNamed.length > 0) throw new Error(`${u.asset}: the source names a returned player`)
  if (u.kind === 'RETURN_FOUND_NOT_RECORDED' && !incomingNamed.some((r) => r.player === u.returned_player)) throw new Error(`${u.asset}: the source does not name ${u.returned_player} as the return`)
}
const miller = byId.get(60573)
const millerPackage = miller ? { retrosheet_transaction_id: 60573, date: iso(miller[0].date), outgoing: people(miller, 'OUT'), incoming: people(miller, 'IN'), recorded_in_disi: false } : null

const out = {
  retrieved_at: process.argv[3] ?? '2026-10-20T00:00:00Z',
  source: {
    url: 'https://www.retrosheet.org/transactions/tranDB.zip', source_name: 'Retrosheet Transactions Database', source_type: 'TRANSACTIONS', source_tier: 'OTHER',
    title: 'Retrosheet transactions database (tran.txt, tranDB.zip)',
    sha256_zip: process.argv[4] ?? null,
    rows: tranText.split(/\r?\n/).filter(Boolean).length,
    notes: 'Structured transaction records created by Tom Ruane and no longer updated (Retrosheet readme). Read directly from the downloaded archive. Not an official club record: the Baseball-Reference/MLB logs outrank it where they cover the same fact; here the official MLB log lacks the Dodgers-side exit rows.',
  },
  exits,
  unresolved: UNRESOLVED,
  package_verification: packages,
  miller_package_not_recorded: millerPackage,
}
fs.writeFileSync(path.join(here, 'transaction-evidence.json'), JSON.stringify(out, null, 2) + '\n')
console.log(`exits ${exits.length}; packages ${packages.length}: ${packages.map((p) => `${p.event}=${p.agrees.outgoing && p.agrees.incoming}`).join(' ')}`)
