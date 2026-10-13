#!/usr/bin/env node
// Assembles database/sql/035_international_benchmark_outcomes.sql from:
//   035_template.sql         hand-written preconditions, inserts, grants and postconditions
//   views.sql                v_international_benchmark_player_outcomes, _class_coverage, _research_queue
//   benchmark-outcomes.json  MLB Stats API person/career record of the 48 non-Dodgers benchmark players (derive-outcomes.mjs)
//   war-seed.json            Baseball-Reference team-season rows of the benchmark players who reached MLB (derive-war.mjs)
//   scope-config.json        data-file checksums and the audit boundary
//   audit-report.json        written by audit.mjs; the build refuses to run if the audit failed
//
//   node database/research/035/audit.mjs && node database/research/035/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const outcomes = read('benchmark-outcomes.json')
const war = read('war-seed.json')
const config = read('scope-config.json')
const audit = read('audit-report.json')
if (audit.failures.length) throw new Error(`audit has failures: ${audit.failures.join('; ')}`)
if (war.coverage.persons_without_rows.length || war.coverage.unmapped_team_codes.length) throw new Error('the WAR seed has uncovered persons or unmapped team codes')
if (outcomes.audit_through_date !== config.audit_through_date) throw new Error('audit boundary differs between outcomes and scope-config')

// career bWAR per player: the sum of the loaded team-season rows (a NULL row contributes nothing; it is not zero evidence)
const careerByBref = new Map()
for (const r of war.rows) {
  if (r.war === null || r.war === undefined) continue
  careerByBref.set(r.bref_id, Math.round(((careerByBref.get(r.bref_id) ?? 0) + Number(r.war)) * 100) / 100)
}
const brefByMlb = new Map(Object.values(war.scope.players).map((p) => [p.mlb_id, p.bref_id]))
const NAMES = { true: 'Reached MLB', false: 'No MLB debut' }

const players = outcomes.players.map((p) => {
  const base = { slug: p.slug, org: p.org, signing_year: p.signing_year, mlb_id: p.mlb_id ?? null, bref_id: p.mlb_id ? (brefByMlb.get(p.mlb_id) ?? null) : null }
  if (!p.mlb_id) return { ...base, reached: null }
  const reached = Boolean(p.mlb_debut_date)
  if (reached && p.mlb_debut_date > outcomes.audit_through_date) throw new Error(`${p.slug}: debut after the audit boundary`)
  if (reached && !base.bref_id) throw new Error(`${p.slug}: reached MLB without a Baseball-Reference id in the WAR seed`)
  const state = reached ? 'REACHED_MLB' : p.active ? 'NO_MLB_ACTIVE_IN_MINORS' : 'NO_MLB_STATUS_UNKNOWN'
  const status = reached
    ? `${p.active ? 'Active' : 'Not active'} per the MLB person record through ${outcomes.audit_through_date}`
    : p.active
      ? 'Active in affiliated baseball with no MLB debut in the MLB person record'
      : 'Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established'
  return {
    ...base,
    reached,
    confidence: reached ? 'VERIFIED' : 'MEDIUM',
    outcome_state: state,
    person_url: p.person_url,
    supports: reached ? ['MLB_REACH', 'MLB_DEBUT_DATE', 'ACTIVE_STATUS'] : ['MLB_REACH', 'ACTIVE_STATUS'],
    audit_note: reached
      ? `${NAMES.true}: MLB debut ${p.mlb_debut_date} in the official MLB Stats API person record (retrieved ${outcomes.retrieved_at}); identity from the existing DISI MLB id.`
      : `${NAMES.false} in the official MLB Stats API person record through ${outcomes.audit_through_date} (retrieved ${outcomes.retrieved_at}); this is the absence of a recorded debut, not proof of a career end.`,
    evidence_note: `MLB Stats API person record and regular-season career statistics, retrieved ${outcomes.retrieved_at}.`,
    debut: reached ? p.mlb_debut_date : null,
    games: reached ? p.mlb_games : null,
    pa: reached ? p.mlb_pa : null,
    ip: reached && p.mlb_ip != null ? String(p.mlb_ip) : null,
    career_bwar: reached ? (careerByBref.get(base.bref_id) ?? null) : null,
    current_status: status,
  }
})
if (players.filter((p) => p.reached).some((p) => p.career_bwar === null)) throw new Error('a reaching player has no loaded bWAR')

const sources = [...new Set(players.filter((p) => p.person_url).map((p) => p.person_url))].sort().map((u) => ({
  url: u, source_name: 'MLB Stats API', source_type: 'MLB_PLAYER_RECORD', source_tier: 'MILB_MLB_PLAYER_RECORD',
  title: `MLB person record: player ${u.split('/').pop()}`, notes: 'Official MLB person record and regular-season career statistics.',
}))

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const payload = sortKeys({
  retrieved_at: `${outcomes.retrieved_at}T00:00:00Z`,
  audit_through_date: outcomes.audit_through_date,
  outcome_through_season: Number(outcomes.audit_through_date.slice(0, 4)),
  players,
  sources,
  war: {
    bat_url: config.files.bat.url,
    pitch_url: config.files.pitch.url,
    source_urls: [config.files.bat.url, config.files.pitch.url],
    retrieved_at: config.retrieved_at,
    observed_through_date: config.file_last_modified,
    observed_through_season: Number(config.file_last_modified.slice(0, 4)),
    rows: war.rows.map((r) => [r.bref_id, r.mlb_id, r.season, r.team, r.stint, r.component, r.league, r.war, r.games, r.pa, r.ip_outs]),
  },
})
const json = JSON.stringify(payload).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
if (json.includes('$m035$')) throw new Error('payload contains the dollar-quote tag')

let sql = fs.readFileSync(path.join(here, '035_template.sql'), 'utf8').replace(/\r\n/g, '\n')
const views = fs.readFileSync(path.join(here, 'views.sql'), 'utf8').replace(/\r\n/g, '\n').trimEnd()
const fill = (name, value) => {
  const token = `{{${name}}}`
  if (!sql.includes(token)) throw new Error(`template has no ${token}`)
  sql = sql.split(token).join(value)
}
fill('views', views)
fill('payload_json', json)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/035_international_benchmark_outcomes.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
