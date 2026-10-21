#!/usr/bin/env node
// Assembles database/sql/049_transaction_package_completion.sql and database/release/sql/rollback-049.sql from:
//   049_template.sql / rollback_template.sql   hand-written guards, steps, proofs and postconditions
//   transaction-evidence.json                  the rows read directly from the sources (derive-transactions.mjs)
//
//   node database/research/049/build.mjs
//
// Deterministic: the same inputs always produce the same files. The build refuses anything the research rules do not allow.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8').replace(/\r\n/g, '\n')
const ev = JSON.parse(read('transaction-evidence.json'))

const RETROSHEET = ev.sources.retrosheet.url
const need = (cond, msg) => { if (!cond) throw new Error(msg) }
need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(ev.retrieved_at), 'retrieved_at must be a UTC timestamp')
const isoDate = (d, what) => { need(/^\d{4}-\d{2}-\d{2}$/.test(d) && !d.endsWith('-00'), `${what}: an exact date is required`); return d }

// ---- identity: every player asset carries an MLB id and a Baseball-Reference id, matched by crosswalk and an exact birth date -------------
const person = (p) => {
  need(p.mlb_id && p.bref_id && p.name && p.retrosheet_id && p.birth_date_matched, `${p.name}: identity is never guessed (MLB id, Baseball-Reference id, Retrosheet id and the matched birth date are required)`)
  return p
}

// ---- 1. the Abreu / Garland correction ----------------------------------------------------------------------------------------
const c = ev.ptbnl_correction
need(c.initiated < c.completed, 'the agreement precedes the delivery')
need(isoDate(c.initiated, 'initiated') && isoDate(c.completed, 'completed') && isoDate(c.original.date, 'original'), 'dates')
need(c.original.date === c.completed, 'the date DISI stored before is the delivery date and must be preserved as the completion date')
person(c.incoming); person(c.ptbnl)
need(c.mlb_log.trade.date === c.initiated && c.mlb_log.abreu_delivery.date === c.completed, 'the official log must agree with both dates')
need(c.retrosheet_rows.length === 2, 'both Retrosheet rows of transaction 64131 are required')
const abreuDescription = `Arizona Diamondbacks sent RHP Jon Garland to the Los Angeles Dodgers on ${c.initiated} for a player to be named later. The Dodgers named 2B Tony Abreu and delivered him to Arizona on ${c.completed} to complete the trade (MLB transaction log; Retrosheet transaction ${c.retrosheet_transaction_id}). Before Migration 049 DISI recorded only the completion date, ${c.original.date}, as "${c.original.description}" with no return.`

// ---- 2. the 1967 package and the exits --------------------------------------------------------------------------------------
const t = ev.trade_1967
need(t.players.length === 5, 'the 1967 package has five players')
const out = t.players.filter((p) => p.side === 'OUTGOING')
const inc = t.players.filter((p) => p.side === 'INCOMING')
need(out.length === 3 && inc.length === 2, 'three Dodgers sent, two received')
t.players.forEach(person)
const sabrNote = 'the same package is described in the SABR biographies of Versalles, Grant and Perranoski'
const trade = {
  key: t.event_key, date: isoDate(t.date, t.event_key), type: 'TRADE', from: 'LAD', to: 'MIN', historical_label: '', source_url: RETROSHEET,
  description: `Traded ${out.map((p) => p.name).join(', ').replace(/, ([^,]*)$/, ' and $1')} to the Minnesota Twins. Received ${inc.map((p) => p.name).join(' and ')}. Retrosheet transaction ${t.retrosheet_transaction_id} (${t.date}); ${sabrNote} (the Versalles biography dates it November 27, Retrosheet and the Perranoski biography November 28).`,
  assets: t.players.map((p) => ({ side: p.side, name: p.name, mlb_id: p.mlb_id, bref_id: p.bref_id, role_note: '', counterparty: 'MIN' })),
}

const exitEvent = (x, label) => {
  person(x.player)
  need(x.retrosheet_transaction_id && x.row.includes(String(x.retrosheet_transaction_id)) && x.row.includes('"X "'), `${x.key}: the exact expansion-draft row is required`)
  return {
    key: x.key, date: isoDate(x.date, x.key), type: 'EXPANSION_DRAFT', from: 'LAD', to: x.to, source_url: RETROSHEET,
    historical_label: `1968 expansion draft (${x.franchise_name}), pick ${x.pick}`,
    description: `${x.player.name} was selected from the Dodgers by the ${x.franchise_name} as pick ${x.pick} of the 1968 expansion draft. Retrosheet transaction ${x.retrosheet_transaction_id}; ${label}`,
    assets: [{ side: 'OUTGOING', name: x.player.name, mlb_id: x.player.mlb_id, bref_id: x.player.bref_id, role_note: '', counterparty: x.to }],
  }
}
const grantExit = exitEvent(ev.expansion_exits[0], 'the SABR biography of Mudcat Grant gives the same selection.')
const versallesExit = exitEvent(ev.expansion_exits[1], 'the SABR biography of Zoilo Versalles gives the same selection.')

const g = ev.garland_exit
person(g.player)
need(g.mlb_log.date === g.date && g.mlb_log.typeCode === 'DFA' && g.retrosheet_row.includes('"Fg"'), 'the free agency must be in both the official log and Retrosheet')
const garlandExit = {
  key: g.key, date: isoDate(g.date, g.key), type: 'FREE_AGENCY', from: 'LAD', to: '', historical_label: g.historical_label,
  source_url: ev.sources.garland_log.url,
  description: `Jon Garland elected free agency (MLB transaction log, ${g.date}; Retrosheet transaction ${g.retrosheet_transaction_id}).`,
  assets: [{ side: 'OUTGOING', name: g.player.name, mlb_id: g.player.mlb_id, bref_id: g.player.bref_id, role_note: '', counterparty: '' }],
}

const events = [trade, garlandExit, grantExit, versallesExit]
const keys = new Set()
for (const e of events) { need(!keys.has(e.key), `duplicate event ${e.key}`); keys.add(e.key) }
const exits = [
  { mlb_id: '119112', acquired_in_event: 'LAD_NYM_1962_TIM_HARKNESS', exit_event_key: trade.key },
  { mlb_id: g.player.mlb_id, acquired_in_event: g.acquired_in_event, exit_event_key: garlandExit.key },
  { mlb_id: ev.expansion_exits[0].player.mlb_id, acquired_in_event: ev.expansion_exits[0].acquired_in_event, exit_event_key: grantExit.key },
  { mlb_id: ev.expansion_exits[1].player.mlb_id, acquired_in_event: ev.expansion_exits[1].acquired_in_event, exit_event_key: versallesExit.key },
]
for (const x of ev.identities) need(/^\d+$/.test(x.mlb_id) && x.affiliation_before_trade && x.affiliation_after_trade && x.birth_date, `${x.asset}: the identity needs the bracketing affiliations and a birth date`)
// an unresolved asset is never also recorded
for (const u of ev.unresolved) if (u.result === 'UNRESOLVED_NO_EVIDENCE' && /Gail Harris|Robinson Checo/.test(u.asset) && keys.has(u.event)) throw new Error(`${u.asset}: both recorded and unresolved`)

// ---- payload ----------------------------------------------------------------------------------------------------------------
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const src = (s, extra = {}) => ({ source_name: s.source_name, source_type: s.source_type, title: s.title, url: s.url, notes: s.notes, source_tier: s.source_tier, ...extra })
const payload = sortKeys({
  retrieved_at: ev.retrieved_at,
  sources: [
    src(ev.sources.garland_log), src(ev.sources.register),
    ...ev.sources.sabr.map((s) => ({ source_name: 'SABR Baseball Biography Project', source_type: 'BIOGRAPHY', title: `SABR biography: ${s.url.split('/').filter(Boolean).pop()}`, url: s.url,
      notes: 'Read as a second account of the 1967 Dodgers-Twins package and the 1968 expansion draft. Not a transaction record.', source_tier: 'OTHER' })),
  ],
  sources_urls: { retrosheet: RETROSHEET },
  abreu_event: c.event_key,
  abreu_asset_count: 1,
  abreu: {
    original_date: c.original.date, original_description: c.original.description, original_ptbnl_role_note: 'DISI tracked international signing.', initiated: c.initiated, completed: c.completed, description: abreuDescription,
    ptbnl: { mlb_id: c.ptbnl.mlb_id, name: c.ptbnl.name },
    ptbnl_role_note: `DISI tracked international signing. Named as the player to be named later and delivered ${c.completed} to complete the trade.`,
    incoming: { name: c.incoming.name, mlb_id: c.incoming.mlb_id, bref_id: c.incoming.bref_id },
    incoming_role_note: `Acquired ${c.initiated} for a player to be named later (Tony Abreu).`,
    incoming_source_url: ev.sources.garland_log.url,
  },
  trade: { event_key: trade.key, acquired_in_event: 'LAD_NYM_1962_TIM_HARKNESS' },
  events, exits,
  identities: ev.identities.map((x) => ({ event: x.event, asset: x.asset, mlb_id: x.mlb_id })),
})
const json = JSON.stringify(payload)
for (const tag of ['$m049$', '$r049$']) if (json.includes(tag)) throw new Error(`payload contains the dollar-quote tag ${tag}`)

let sql = read('049_template.sql').split('{{payload_json}}').join(json)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')
const dest = path.join(here, '../../sql/049_transaction_package_completion.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines, ${events.length} events, ${ev.identities.length} identities)\n`)

// ---- rollback: generated from the same evidence so the two can never disagree -----------------------------------------------------
let rollback = read('rollback_template.sql').split('{{payload_json}}').join(json)
if (/\{\{\w+\}\}/.test(rollback)) throw new Error('unreplaced rollback placeholder')
const rdest = path.join(here, '../../release/sql/rollback-049.sql')
fs.writeFileSync(rdest, rollback)
process.stderr.write(`wrote ${path.relative(process.cwd(), rdest)}\n`)
