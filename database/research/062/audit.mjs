#!/usr/bin/env node
// Derives database/research/062/audit.json: the final research class of each of the 39 BWAR_MISSING players, from
//   * baseline-build.json      the measured pre-062 state (001-061): identities, the queue, the WAR source rows and the provider rule;
//   * the two archived Baseball-Reference WAR data files pinned by 057 (database/research/057/source-capture.json, verified by readCapture
//     before a row is read; research-output/057-work/raw, gitignored);
//   * the official MLB Stats API person records pinned in source-capture.json (research-output/062-work/statsapi, gitignored), used ONLY for
//     identity corroboration and to establish which MLB seasons exist, i.e. whether a capture holds the complete career. No WAR, game count or
//     other statistic from the API is used as, or converted into, a bWAR value.
//
//   node database/research/062/audit.mjs [--pin]      --pin rewrites the Stats API pins in source-capture.json from the saved responses
//
// The classes, checked in this order (first match wins):
//   ALREADY_PRESENT                  a CAREER_BWAR observation exists (cannot happen for a queue member; checked anyway)
//   NO_MLB_BUT_SEMANTICS_SUPPORTED   not a verified MLB player (cannot happen: BWAR_MISSING requires reached_mlb_verified)
//   IDENTITY_BLOCKED                 the DISI ids disagree with a capture or the Stats API, or the capture holds a season the API does not know
//   NOT_CURRENTLY_ASSESSABLE         an MLB season the API lists is not complete in a reachable capture (2026: the batting capture is mid-season,
//                                    the pitching capture ends with 2025), so no reachable numeric source holds the current career total
//   SOURCE_BLOCKED                   the complete career is in the captures, but no source row the CAREER_BWAR provider rule accepts holds the
//                                    data that was read (the captures cite web.archive.org; the accepted live-file rows were not read)
//   APPLY_NUMERIC                    complete, current, identity-safe and citable by an accepted source row
// Deterministic: the same inputs always give the same output.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readCapture } from '../057/fetch-sources.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const rd = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const need = (cond, msg) => { if (!cond) throw new Error(msg) }
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase()

const baseline = rd('baseline-build.json')
const capture057 = JSON.parse(fs.readFileSync(path.join(here, '../057/source-capture.json'), 'utf8'))
const apiDir = path.join(root, 'research-output/062-work/statsapi')
const capPath = path.join(here, 'source-capture.json')
const backlog = baseline.backlog
need(backlog.length === 39, `BWAR_MISSING holds ${backlog.length} players, the audit was written for 39`)
need(baseline.provider_rule.bwar_requires_baseball_reference_url === true, 'the CAREER_BWAR provider rule is not the 017 Baseball-Reference URL rule')

// --- the Stats API pins
if (process.argv.includes('--pin')) {
  const cap = JSON.parse(fs.readFileSync(capPath, 'utf8'))
  cap.statsapi.retrieved_at = fs.readFileSync(path.join(apiDir, 'retrieved_at.txt'), 'utf8').trim()
  cap.statsapi.files = backlog.map((p) => {
    const buf = fs.readFileSync(path.join(apiDir, `${p.mlb_id}.json`))
    return { slug: p.slug, mlb_id: p.mlb_id, url: cap.statsapi.url_template.replace('{mlb_id}', p.mlb_id), file: `${p.mlb_id}.json`, bytes: buf.length, sha256: sha256(buf) }
  })
  fs.writeFileSync(capPath, JSON.stringify(cap, null, 1) + '\n')
}
const cap = JSON.parse(fs.readFileSync(capPath, 'utf8'))
need(cap.statsapi.files.length === 39, 'source-capture.json pins 39 Stats API records')
const api = new Map()
for (const f of cap.statsapi.files) {
  const buf = fs.readFileSync(path.join(apiDir, f.file))
  need(sha256(buf) === f.sha256, `${f.file}: SHA-256 differs from the pin`)
  api.set(f.mlb_id, JSON.parse(buf.toString('utf8')).people[0])
}

// --- the two 057 captures, every row of the 39 (by Baseball-Reference id) and every row carrying one of their MLB ids
const byBref = new Map(backlog.map((p) => [p.bref_id, p]))
const byMlb = new Map(backlog.map((p) => [p.mlb_id, p]))
const rows = new Map(backlog.map((p) => [p.slug, []]))
const conflicts = new Map(backlog.map((p) => [p.slug, []]))
const files = []
for (const spec of capture057.files) {
  const text = readCapture(spec, path.join(root, 'research-output/057-work/raw'))
  const lines = text.split('\n').filter((l) => l.length)
  const head = lines[0].split(',')
  const ix = Object.fromEntries(head.map((h, i) => [h, i]))
  need(!lines.some((l) => l.includes('"')), `${spec.raw_file}: a quoted field; the plain comma split would not be exact`)
  files.push({ component: spec.component, url: spec.url, captured_at: spec.captured_at, decoded_sha256: spec.decoded_sha256, data_rows: lines.length - 1,
    complete_through_season: 2025, max_season: lines.slice(1).reduce((m, l) => Math.max(m, Number(l.split(',')[ix.year_ID])), 0) })
  for (const line of lines.slice(1)) {
    const r = line.split(',')
    need(r.length === head.length, `${spec.raw_file}: a row with ${r.length} fields, header has ${head.length}`)
    const bref = r[ix.player_ID], mlb = r[ix.mlb_ID]
    const pb = byBref.get(bref), pm = byMlb.get(mlb)
    if (pb && mlb !== pb.mlb_id) conflicts.get(pb.slug).push(`${spec.component}: player_ID ${bref} carries mlb_ID ${mlb}`)
    if (pm && bref !== pm.bref_id) conflicts.get(pm.slug).push(`${spec.component}: mlb_ID ${mlb} carries player_ID ${bref}`)
    if (!pb) continue
    need(r[ix.team_ID] !== 'TOT', `${bref}: a TOT row`)
    const war = r[ix.WAR] === 'NULL' || r[ix.WAR] === '' ? null : r[ix.WAR]
    need(war === null || /^-?\d+\.\d{2}$/.test(war), `${bref}: WAR ${war} is not the file's two-decimal form`)
    rows.get(pb.slug).push({ component: spec.component, season: Number(r[ix.year_ID]), team: r[ix.team_ID], stint: Number(r[ix.stint_ID]), war, games: Number(r[ix.G]) || 0 })
  }
}
files.sort((a, b) => a.component.localeCompare(b.component))

const cents = (w) => Math.round(Number(w) * 100)
const round1 = (c) => { const s = Math.sign(c), q = Math.floor((Math.abs(c) + 5) / 10); return (s < 0 && q !== 0 ? '-' : '') + (q / 10).toFixed(1) } // half away from zero, as PostgreSQL numeric
const fmt = (c) => (c < 0 ? '-' : '') + (Math.abs(c) / 100).toFixed(2)
const accepted = baseline.war_sources.filter((s) => s.accepted_for_career_bwar).map((s) => s.url)
const captureUrls = capture057.files.map((f) => f.url)
need(captureUrls.every((u) => baseline.war_sources.some((s) => s.url === u && s.accepted_for_career_bwar === false)), 'the 057 capture sources are expected to be rejected by the provider rule')

const players = backlog.map((p) => {
  const person = api.get(p.mlb_id)
  const mine = rows.get(p.slug).sort((a, b) => a.component.localeCompare(b.component) || a.season - b.season || a.stint - b.stint)
  const seasons = { hitting: new Map(), pitching: new Map() }
  // one value per group and season: the season-total split (no team) when the player changed clubs, otherwise the single team split
  for (const s of person.stats ?? []) {
    const g = seasons[s.group.displayName]
    if (!g) continue
    const bySeason = new Map()
    for (const x of s.splits) if (x.sport?.id === 1 || (!x.team && x.numTeams > 1)) (bySeason.get(x.season) ?? bySeason.set(x.season, []).get(x.season)).push(x)
    for (const [season, xs] of bySeason) {
      const total = xs.find((x) => !x.team) ?? (xs.length === 1 ? xs[0] : null)
      need(total, `${p.slug} ${season} ${s.group.displayName}: several team splits and no season total`)
      g.set(Number(season), s.group.displayName === 'hitting' ? Number(total.stat.plateAppearances ?? 0) : Number(total.stat.gamesPlayed ?? total.stat.gamesPitched ?? 0))
    }
  }
  const capBat = new Set(mine.filter((r) => r.component === 'BAT').map((r) => r.season))
  const capPitch = new Set(mine.filter((r) => r.component === 'PITCH').map((r) => r.season))
  const apiSeasons = new Set([...seasons.hitting.keys(), ...seasons.pitching.keys()])
  // identity is decided by the hard keys (MLBAM id, birth date, MLB debut, the Baseball-Reference / MLBAM pair in both captures); a name spelling
  // variant with every hard key matching is recorded, not a block, and no name is changed
  const identity = []
  const nameNotes = []
  if (String(person.id) !== p.mlb_id) identity.push(`Stats API person ${person.id} is not MLBAM ${p.mlb_id}`)
  if (fold(person.fullName) !== fold(p.full_name) && fold(person.useName + ' ' + person.lastName) !== fold(p.full_name)) nameNotes.push(`spelling variant: API ${person.fullName} / DISI ${p.full_name}`)
  if (!p.birth_date) identity.push('DISI holds no birth date to corroborate')
  if (!p.mlb_debut_date) identity.push('DISI holds no MLB debut date to corroborate')
  if (p.birth_date && person.birthDate !== p.birth_date) identity.push(`birth date: API ${person.birthDate} / DISI ${p.birth_date}`)
  if (p.mlb_debut_date && person.mlbDebutDate !== p.mlb_debut_date) identity.push(`MLB debut: API ${person.mlbDebutDate} / DISI ${p.mlb_debut_date}`)
  identity.push(...conflicts.get(p.slug))
  if (!mine.length) identity.push(`no capture row for ${p.bref_id}`)
  for (const y of new Set([...capBat, ...capPitch])) if (!apiSeasons.has(y)) identity.push(`capture season ${y} is not an MLB season of ${p.mlb_id}`)
  const incomplete = []
  for (const [y, pa] of [...seasons.hitting].sort((a, b) => a[0] - b[0])) if (pa > 0 && (y > 2025 || !capBat.has(y))) incomplete.push(`MLB hitting ${y} (${pa} PA)${y > 2025 ? ': the batting capture (2026-09-11) is mid-season' : ': no batting capture row'}`)
  for (const [y, g] of [...seasons.pitching].sort((a, b) => a[0] - b[0])) if (y > 2025 || !capPitch.has(y)) incomplete.push(`MLB pitching ${y} (${g} G)${y > 2025 ? ': the pitching capture ends with 2025' : ': no pitching capture row'}`)
  const bat = mine.filter((r) => r.component === 'BAT' && r.war !== null).reduce((a, r) => a + cents(r.war), 0)
  const pitch = mine.filter((r) => r.component === 'PITCH' && r.war !== null).reduce((a, r) => a + cents(r.war), 0)
  let cls, reason
  if (p.metric_observations > 0) { cls = 'ALREADY_PRESENT'; reason = 'a CAREER_BWAR observation exists' }
  else if (p.reached_mlb_verified !== true) { cls = 'NO_MLB_BUT_SEMANTICS_SUPPORTED'; reason = 'not a verified MLB player' }
  else if (identity.length) { cls = 'IDENTITY_BLOCKED'; reason = identity.join('; ') }
  else if (incomplete.length) { cls = 'NOT_CURRENTLY_ASSESSABLE'; reason = `no reachable numeric source holds the current career: ${incomplete.join('; ')}` }
  else if (!accepted.some((u) => captureUrls.includes(u))) {
    cls = 'SOURCE_BLOCKED'
    reason = 'the complete career is in the archived captures, but the CAREER_BWAR provider rule (017) accepts only a baseball-reference.com source URL: the capture sources cite web.archive.org, and the accepted live-file rows (pinned 2026-09-28 bytes) were not read, so citing them would be false provenance'
  } else { cls = 'APPLY_NUMERIC'; reason = 'complete, current and citable' }
  const complete = cls === 'SOURCE_BLOCKED' || cls === 'APPLY_NUMERIC'
  return {
    slug: p.slug, full_name: p.full_name, bref_id: p.bref_id, mlb_id: p.mlb_id, franchise_key: p.franchise_key, signing_year: p.signing_year, class: cls, reason,
    identity: { api_full_name: person.fullName, api_birth_date: person.birthDate, api_mlb_debut: person.mlbDebutDate, checks_failed: identity, notes: nameNotes },
    mlb_seasons: { hitting: Object.fromEntries([...seasons.hitting].sort((a, b) => a[0] - b[0])), pitching: Object.fromEntries([...seasons.pitching].sort((a, b) => a[0] - b[0])) },
    capture_rows: mine.length, capture_null_war_rows: mine.filter((r) => r.war === null).length,
    capture_seasons: { BAT: [...capBat].sort(), PITCH: [...capPitch].sort() },
    disi_team_season_rows: p.war_rows,
    ...(complete ? {
      evidence_value: { bat: fmt(bat), pitch: capPitch.size ? fmt(pitch) : null, raw: fmt(bat + pitch), one_decimal: round1(bat + pitch),
        as_of: capPitch.size ? '2026-09-11 (BAT) / 2026-02-10 (PITCH, ends with 2025)' : '2026-09-11', rows: mine },
    } : {}),
  }
})

const counts = Object.fromEntries(['APPLY_NUMERIC', 'NO_MLB_BUT_SEMANTICS_SUPPORTED', 'IDENTITY_BLOCKED', 'SOURCE_BLOCKED', 'NOT_CURRENTLY_ASSESSABLE', 'ALREADY_PRESENT']
  .map((c) => [c, players.filter((p) => p.class === c).length]))
need(Object.values(counts).reduce((a, b) => a + b, 0) === 39, 'every player has exactly one class')
const out = {
  note: 'The 062 audit of the 39 BWAR_MISSING players on the canonical 001-061 state. Numeric evidence is read only from the two archived Baseball-Reference WAR data files 057 pinned; the MLB Stats API is used only for identity and to list which MLB seasons exist. No value is inferred, estimated or zero-filled.',
  inputs: { baseline: 'database/research/062/baseline-build.json', captures: files, statsapi: { retrieved_at: cap.statsapi.retrieved_at, records: cap.statsapi.files.length },
    accepted_career_bwar_sources: accepted, capture_sources_accepted: false },
  counts,
  schema_change_required: { answer: counts.APPLY_NUMERIC > 0 ? 'NO' : (counts.SOURCE_BLOCKED > 0 ? 'YES' : 'NO'),
    detail: 'No numeric write is supported under the existing schema. The SOURCE_BLOCKED players could be written only if the CAREER_BWAR provider rule (017 player_metric_observations_check_provider) also accepted a web.archive.org capture of a baseball-reference.com URL, which is a schema change and an owner decision (059 left it as "a separate decision"). The NOT_CURRENTLY_ASSESSABLE players need a post-2026-season capture of both files whatever the rule.' },
  proposed_writes: players.filter((p) => p.class === 'APPLY_NUMERIC').map((p) => ({ slug: p.slug, value: p.evidence_value.one_decimal })),
  players,
}
fs.writeFileSync(path.join(here, 'audit.json'), JSON.stringify(out, null, 1) + '\n')
process.stdout.write(JSON.stringify({ counts, schema_change_required: out.schema_change_required.answer, proposed_writes: out.proposed_writes.length }) + '\n')
