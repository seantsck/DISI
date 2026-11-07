#!/usr/bin/env node
// Dodgers international signing census audit: deterministic generator.
//
//   node database/research/census-audit/build.mjs [--raw <dir>]
//
// Inputs (read-only):
//   inputs/disi-export.json   committed; read-only export of the canonical post-061 replay
//   inputs/manual.json        committed; hand transcriptions of pages that were read
//   inputs/raw-pins.json      committed; SHA-256 of every raw MLB Stats API response
//   <raw dir>                 gitignored; default research-output/census-audit/raw
// Outputs (this directory): current-disi-population.csv, external-periods.json,
//   year-scorecard.csv, dodgers-signing-census-gaps.csv, identity-review.csv,
//   owner-research-queue.md, build-summary.json
// No network, no database, no clock: output depends only on the inputs.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const argRaw = process.argv.indexOf('--raw')
const RAW = argRaw > 0 ? path.resolve(process.argv[argRaw + 1]) : path.join(ROOT, 'research-output/census-audit/raw')
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const manual = readJson(path.join(HERE, 'inputs/manual.json'))
const disi = readJson(path.join(HERE, 'inputs/disi-export.json'))
const pins = readJson(path.join(HERE, 'inputs/raw-pins.json'))

// ---- 1. verify raw pins ------------------------------------------------------
const raw = {}
for (const [file, meta] of Object.entries(pins.files)) {
  const buf = fs.readFileSync(path.join(RAW, file))
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  if (sha !== meta.sha256) throw new Error(`pin mismatch for ${file}: ${sha} != ${meta.sha256}`)
  raw[file] = JSON.parse(buf.toString('utf8'))
}
const rawFiles = Object.keys(raw).sort()

// ---- helpers ----------------------------------------------------------------
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const csvCell = (v) => {
  if (v === null || v === undefined) return ''
  const s = Array.isArray(v) ? v.join('; ') : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
const writeCsv = (file, cols, rows) => {
  const body = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'
  fs.writeFileSync(path.join(HERE, file), body)
}
const ageAt = (birth, d) => {
  if (!birth || !d) return null
  const ms = Date.parse(d + 'T00:00:00Z') - Date.parse(birth + 'T00:00:00Z')
  return Math.round((ms / (365.25 * 864e5)) * 100) / 100
}
const md = (d) => d.slice(5)

// signing period from a real date (see manual.period_rules)
function signingPeriod(d) {
  if (!d) return { period: null, flag: 'UNDATED' }
  const y = Number(d.slice(0, 4))
  const m = md(d)
  if (d < '2019-07-02') {
    if (m >= '07-02') return { period: `${y}-${String(y + 1).slice(2)}`, flag: '' }
    if (m > '06-15') return { period: `${y - 1}-${String(y).slice(2)}`, flag: 'OUTSIDE_WINDOW' }
    return { period: `${y - 1}-${String(y).slice(2)}`, flag: '' }
  }
  if (d <= '2020-10-15') return { period: '2019-20', flag: d > '2020-06-15' ? 'COVID_EXTENSION' : '' }
  if (d < '2021-01-15') return { period: '2020-21', flag: 'PRE_OPEN' }
  if (d <= '2021-12-15') return { period: '2020-21', flag: '' }
  if (m >= '12-16') return { period: String(y + 1), flag: 'PRE_OPEN' }
  if (m < '01-15') return { period: String(y), flag: 'PRE_OPEN' }
  return { period: String(y), flag: '' }
}
// a DISI row with no date: best-effort period from calendar year
const periodFromYear = (y) => (y == null ? null : y >= 2022 ? String(y) : y === 2021 ? '2020-21' : null)

const PERIODS = ['2009-10', '2010-11', '2011-12', '2012-13', '2013-14', '2014-15', '2015-16', '2016-17', '2017-18',
  '2018-19', '2019-20', '2020-21', '2022', '2023', '2024', '2025', '2026']
const OPEN_PERIOD = '2026' // still open on the access date (period closes 2026-12-15)

// ---- 2. MLB Stats API: people, histories, Dodgers SFA transactions ------------
const MLB_TEAM_IDS = new Set([...Array.from({ length: 14 }, (_, i) => 108 + i), ...Array.from({ length: 15 }, (_, i) => 133 + i), 158])
const LAD = 119
const people = new Map()
const hist = new Map()
const firstSfa = new Map()
for (const f of rawFiles) {
  if (f.startsWith('people-')) for (const p of raw[f].people) people.set(p.id, p)
  if (f.startsWith('hist-')) for (const t of raw[f].transactions) if (t.person) {
    if (!hist.has(t.person.id)) hist.set(t.person.id, new Map())
    hist.get(t.person.id).set(t.id, t)
  }
}
for (const f of rawFiles.filter((x) => x.startsWith('tx-'))) {
  const txs = [...raw[f].transactions].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.id - b.id)
  for (const t of txs) {
    if (t.typeCode !== 'SFA' || !t.person || t.toTeam?.id !== LAD) continue
    const cur = firstSfa.get(t.person.id)
    if (!cur || t.date < cur.date || (t.date === cur.date && t.id < cur.id)) firstSfa.set(t.person.id, t)
  }
}
const isLadTeam = (team) => !!team && (team.id === LAD || /Dodgers|\bLAD\b/.test(team.name || ''))
const isAffiliatedTeam = (team) => !!team && !isLadTeam(team) &&
  (MLB_TEAM_IDS.has(team.id) || /^(DSL|VSL|FCL|GCL|AZL|ACL) /.test(team.name || '') || /Organization|Alternate Training Site/.test(team.name || ''))
const LMB = /Diablos Rojos|Algodoneros|Vaqueros de la Laguna|Rieleros|Toros de Tijuana|Aguilas de Mexicali|Guerreros de Oaxaca|Sultanes|Saraperos|Acereros|Tigres de Quintana Roo|Olmecas|Pericos|Leones de Yucatan|Bravos de Leon|Generales|Petroleros|El Aguila|Charros|Dorados|Mariachis|Piratas de Campeche/
const TRYOUT = /^(Black|Green|Red|Purple|Light Blue|Blue|Orange|Gray|White)-(East|West|North|South|Centro)$|High School Workout|Frederick Keys/
const EXEMPT_COUNTRIES = new Set(['USA', 'Puerto Rico', 'Canada'])
const dupPeople = manual.stats_api_duplicate_people || {}

const external = [] // every in-window Dodgers SFA person worth reporting
for (const [id, t] of firstSfa) {
  if (dupPeople[String(id)]) continue
  const p = people.get(id)
  if (!p) continue
  const country = p.birthCountry || null
  const birth = p.birthDate || null
  const age = ageAt(birth, t.date)
  const prior = [...(hist.get(id)?.values() || [])].filter((h) => (h.date || '9') < t.date)
  const priorTeams = [...new Set(prior.flatMap((h) => [h.toTeam, h.fromTeam]).filter(Boolean).map((x) => x.name))].sort()
  const priorAffiliated = prior.some((h) => isAffiliatedTeam(h.toTeam) || isAffiliatedTeam(h.fromTeam))
  const priorLad = prior.some((h) => isLadTeam(h.toTeam) || isLadTeam(h.fromTeam))
  const priorOther = priorTeams.filter((n) => !TRYOUT.test(n) && !/Dodgers|LAD/.test(n))
  const after = [...(hist.get(id)?.values() || [])].filter((h) => (h.date || '') >= t.date).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const ladFollowUp = after.some((h) => h.typeCode !== 'SFA' && (isLadTeam(h.toTeam) || isLadTeam(h.fromTeam)))
  const supersededBy = !ladFollowUp && after.find((h) => ['SFA', 'SGN'].includes(h.typeCode) && h.toTeam && MLB_TEAM_IDS.has(h.toTeam.id) && h.toTeam.id !== LAD && h.date <= String(Number(t.date.slice(0, 4)) + 1) + t.date.slice(4))
  const usBornIntl = manual.us_born_international[String(id)]
  const usBornReview = manual.us_born_review[String(id)]
  let route
  if (p.draftYear) route = 'DRAFTED'
  else if (EXEMPT_COUNTRIES.has(country) && !usBornIntl) route = usBornReview ? 'US_BORN_RESIDENCE_UNKNOWN' : 'DOMESTIC'
  else if (priorAffiliated || (p.mlbDebutDate && p.mlbDebutDate < t.date)) route = 'PRIOR_MLB_ORGANIZATION'
  else if (priorLad) route = 'LAD_RESIGN'
  else if (supersededBy) route = 'LAD_AGREEMENT_SUPERSEDED'
  else if (age !== null && age < 23) route = prior.some((h) => LMB.test((h.toTeam || h.fromTeam || {}).name || '')) ? 'MEXICAN_LEAGUE_TRANSFER' : 'INTERNATIONAL_AMATEUR'
  else route = 'FOREIGN_PROFESSIONAL'
  // keep: in-scope routes, plus young out-of-scope cases that a census could wrongly count
  const young = age !== null && age < 23
  const keep = ['INTERNATIONAL_AMATEUR', 'MEXICAN_LEAGUE_TRANSFER', 'FOREIGN_PROFESSIONAL'].includes(route) ||
    (route === 'PRIOR_MLB_ORGANIZATION' && young) || route === 'US_BORN_RESIDENCE_UNKNOWN' || route === 'LAD_AGREEMENT_SUPERSEDED'
  if (!keep) continue
  if (route === 'FOREIGN_PROFESSIONAL' && priorOther.length === 0 && prior.length > 0) route = 'FOREIGN_PROFESSIONAL'
  const ov = manual.date_overrides[String(id)]
  let sp = ov ? { period: ov.period, flag: 'DATE_OVERRIDE' } : signingPeriod(t.date)
  // pool-exempt professionals are not bound to a signing window: a December signing stays in that calendar year's period
  if (route === 'FOREIGN_PROFESSIONAL' && sp.flag === 'PRE_OPEN' && md(t.date) >= '12-16' && t.date >= '2022-01-01') sp = { period: t.date.slice(0, 4), flag: 'OFF_WINDOW_PROFESSIONAL' }
  external.push({
    mlbam_id: id, name: p.fullName, normalized_name: norm(p.fullName), birth_date: birth, country,
    position: p.primaryPosition?.abbreviation || null, signing_date: t.date, signing_year: Number(t.date.slice(0, 4)),
    signing_period: sp.period, period_flag: sp.flag, age_at_signing: age, route, prior_teams: priorTeams,
    tx_id: t.id, tx_desc: t.description, superseded: supersededBy ? `${supersededBy.date} ${supersededBy.description}` : null,
    no_follow_up: hist.has(id) && !ladFollowUp && !supersededBy, debut: p.mlbDebutDate || null, lists: [], override_note: ov?.note || usBornIntl || usBornReview || null,
  })
}
external.sort((a, b) => a.signing_date.localeCompare(b.signing_date) || a.mlbam_id - b.mlbam_id)
const extById = new Map(external.map((e) => [e.mlbam_id, e]))

// overlay official / secondary class lists, name by name
const aliasOf = (n) => manual.name_aliases[n] || n
const listOnly = []
for (const L of manual.official_or_secondary_lists) {
  for (const n of L.names) {
    const nn = norm(aliasOf(n))
    const hits = external.filter((e) => e.signing_period === L.period && e.normalized_name === nn)
    if (hits.length === 1) hits[0].lists.push(L.key)
    else if (hits.length > 1) throw new Error(`ambiguous list name ${n} in ${L.key}`)
    else listOnly.push({ list: L, name: n, normalized_name: nn })
  }
}

// ---- 3. DISI current population ---------------------------------------------
const D = disi.dodgers
const byMlb = new Map()
for (const r of D) if (r.mlb_id) { if (!byMlb.has(r.mlb_id)) byMlb.set(r.mlb_id, []); byMlb.get(r.mlb_id).push(r) }
const othersByMlb = new Map()
for (const r of disi.others) if (r.mlb_id) { if (!othersByMlb.has(r.mlb_id)) othersByMlb.set(r.mlb_id, []); othersByMlb.get(r.mlb_id).push(r) }
const aliasesByPlayer = new Map()
for (const a of disi.aliases) { if (!aliasesByPlayer.has(a.player_id)) aliasesByPlayer.set(a.player_id, []); aliasesByPlayer.get(a.player_id).push(a.alias) }
const disiNames = (r) => [r.full_name, ...(aliasesByPlayer.get(r.player_id) || []), ...(Array.isArray(r.aliases) ? r.aliases : [])].map(norm)
const costState = (r) => (r.total_known_acquisition_cost_usd != null ? 'KNOWN' : r.signing_bonus_usd != null ? 'PARTIAL' : 'UNKNOWN')
const outcomeState = (r) => [r.outcome_audit_status || 'NO_AUDIT', r.reached_mlb_verified === true ? 'MLB_VERIFIED' : r.reached_mlb_verified === false ? 'NOT_MLB' : 'MLB_UNKNOWN'].join('/')
const disiPeriod = (r) => {
  if (r.signing_date) {
    if (r.mlb_id && manual.date_overrides[String(r.mlb_id)]) return { period: manual.date_overrides[String(r.mlb_id)].period, flag: 'DATE_OVERRIDE' }
    return signingPeriod(r.signing_date)
  }
  const e = r.mlb_id && extById.get(r.mlb_id)
  if (e) return { period: e.signing_period, flag: 'UNDATED_PERIOD_FROM_MLB_TRANSACTION' }
  return { period: periodFromYear(r.signing_year) ?? (r.signing_year != null && r.signing_year < 2009 ? `pre-2009 (${r.signing_year})` : null), flag: 'UNDATED' }
}
const AMATEUR_PATHWAYS = new Set(['LATAM_AMATEUR', 'CUBAN_AMATEUR', 'JAPAN_AMATEUR', 'KOREA_AMATEUR'])
const PRO_PATHWAYS = new Set(['CUBAN_PRO', 'JAPAN_PRO', 'KOREA_PRO', 'POSTED_PLAYER', 'MEXICAN_LEAGUE_TRANSFER'])
const disiRows = D.map((r) => {
  const sp = disiPeriod(r)
  return {
    full_name: r.full_name, player_slug: r.player_slug, player_id: r.player_id, signing_id: r.signing_id,
    signing_date: r.signing_date, signing_year: r.signing_year, signing_period: sp.period, period_flag: sp.flag,
    country: r.country_market, position: r.primary_position, pathway: r.pathway,
    amateur_or_pro: AMATEUR_PATHWAYS.has(r.pathway) ? 'AMATEUR' : PRO_PATHWAYS.has(r.pathway) ? 'FOREIGN_PROFESSIONAL' : 'OTHER',
    mlbam_id: r.mlb_id, bref_id: r.bref_id, source_url: r.source_url, cost_state: costState(r), outcome_state: outcomeState(r),
    record_scope: r.record_scope, coverage_type: r.coverage_type, opening_class_member: r.opening_class_member,
    full_period_member: r.full_period_member, age_at_signing: r.age_at_signing,
  }
}).sort((a, b) => (a.signing_date || '9999').localeCompare(b.signing_date || '9999') || a.full_name.localeCompare(b.full_name))

// ---- 4. reconcile -----------------------------------------------------------
const IN_SCOPE = new Set(['INTERNATIONAL_AMATEUR', 'MEXICAN_LEAGUE_TRANSFER', 'FOREIGN_PROFESSIONAL'])
const matchedDisi = new Set()
const candByMlb = new Map((disi.signing_period_candidates || []).map((c) => [c.mlb_person_id, c]))
const gaps = []
const identity = []
const findNameVariant = (nn, birth, period) => D.filter((r) => !r.mlb_id && disiNames(r).includes(nn))
  .concat(D.filter((r) => !r.mlb_id && birth && r.p_birth_date === birth && disiNames(r).some((x) => x.split(' ').pop() === nn.split(' ').pop())))
  .filter((r, i, a) => a.indexOf(r) === i && (!period || disiPeriod(r).period === period || disiPeriod(r).period === null))
for (const e of external) {
  const hit = byMlb.get(e.mlbam_id) || []
  let status, likely = null, gapClass, confidence, note = []
  if (hit.length) {
    hit.forEach((r) => matchedDisi.add(r.signing_id))
    likely = hit.map((r) => r.player_slug).join('; ')
    status = hit.length > 1 ? 'DUPLICATE_DISI' : 'MATCHED'
    if (e.route === 'US_BORN_RESIDENCE_UNKNOWN') note.push('US-born; DISI carries him as an international signing, so residence at signing should be sourced')
    else if (!IN_SCOPE.has(e.route)) { status = 'OUT_OF_SCOPE_ROUTE'; note.push('DISI carries this player as a Dodgers signing but the MLB record shows ' + e.route) }
    const dp = disiPeriod(hit[0]).period
    if (dp && dp !== e.signing_period) note.push(`DISI period ${dp} vs MLB transaction period ${e.signing_period}`)
    gapClass = status === 'MATCHED' ? 'NONE' : status === 'DUPLICATE_DISI' ? 'FALSE_MEMBERSHIP_DUPLICATE' : 'FALSE_MEMBERSHIP_ROUTE'
    confidence = 'HIGH'
  } else if (!IN_SCOPE.has(e.route)) {
    status = e.route === 'US_BORN_RESIDENCE_UNKNOWN' ? 'IDENTITY_AMBIGUOUS' : 'OUT_OF_SCOPE_ROUTE'
    gapClass = status === 'IDENTITY_AMBIGUOUS' ? 'ROUTE_UNRESOLVED' : 'NOT_A_GAP'
    confidence = status === 'IDENTITY_AMBIGUOUS' ? 'LOW' : 'HIGH'
    if (e.route === 'LAD_AGREEMENT_SUPERSEDED') note.push('no Dodgers assignment followed; signed elsewhere: ' + e.superseded)
    if (e.route === 'PRIOR_MLB_ORGANIZATION') note.push('originally signed by another MLB organization' + (e.debut && e.debut < e.signing_date ? ` (MLB debut ${e.debut} before this signing)` : '') + ': ' + e.prior_teams.filter((n) => !TRYOUT.test(n)).slice(0, 4).join(', '))
  } else {
    const v = findNameVariant(e.normalized_name, e.birth_date, e.signing_period)
    if (v.length) {
      status = 'POSSIBLE_NAME_VARIANT'; likely = v.map((r) => r.player_slug).join('; '); gapClass = 'IDENTITY_LINK_MISSING'; confidence = 'MEDIUM'
      v.forEach((r) => matchedDisi.add(r.signing_id))
      note.push('DISI row has no MLBAM id; matched by name/birth date only')
    } else {
      status = 'MISSING_FROM_DISI'
      const core = e.age_at_signing !== null && e.age_at_signing >= 15.5 && e.age_at_signing < 19.5
      const majorDeal = e.route === 'FOREIGN_PROFESSIONAL' && !/minor league contract/i.test(e.tx_desc)
      gapClass = e.lists.length || core || majorDeal ? 'CONFIRMED_MISSING' : 'PROBABLE_MISSING'
      confidence = e.lists.length || core || majorDeal ? 'HIGH' : 'MEDIUM'
      if (majorDeal) note.push('major-league contract with a foreign professional: in DISI scope under its pro/posted pathways')
      else if (!e.lists.length && !core) note.push(`age ${e.age_at_signing} at signing: outside the 16-19 core band, route ${e.route}`)
      if (e.debut) note.push(`MLB debut ${e.debut}`)
    }
    const cand = candByMlb.get(e.mlbam_id)
    if (cand) note.push(`DISI already lists this player in signing_period_candidates as ${cand.classification} (${cand.period_year})`)
    const other = othersByMlb.get(e.mlbam_id)
    if (other) note.push('present in DISI under a non-Dodgers signing: ' + other.map((o) => o.full_name + ' ' + (o.signing_year ?? '')).join('; '))
  }
  if (e.lists.length) note.push('named in ' + e.lists.join(', '))
  if (!byMlb.has(e.mlbam_id) && !IN_SCOPE.has(e.route) && candByMlb.get(e.mlbam_id)) note.push(`DISI signing_period_candidates: ${candByMlb.get(e.mlbam_id).classification}`)
  if (e.period_flag) note.push('period flag ' + e.period_flag)
  if (e.no_follow_up) { note.push('no later Dodgers transaction (assignment/release) in the MLB record: possibly never reported or voided'); if (confidence === 'HIGH' && status !== 'MATCHED') confidence = 'MEDIUM' }
  if (e.override_note) note.push(e.override_note)
  e.disi_status = status
  gaps.push({
    signing_period: e.signing_period, signing_year: e.signing_year, external_name: e.name, normalized_name: e.normalized_name,
    position: e.position, country: e.country, signing_date: e.signing_date,
    source_url: `https://statsapi.mlb.com/api/v1/transactions?teamId=119&startDate=${e.signing_year}-01-01&endDate=${e.signing_year}-12-31`,
    source_type: 'MLB_STATS_API_TRANSACTION', mlbam_id: e.mlbam_id, bref_id: hit[0]?.bref_id || null, disi_status: status,
    likely_disi_player_slug: likely, gap_class: gapClass, confidence, notes: [`route ${e.route}`, `age ${e.age_at_signing}`, ...note].join(' | '),
  })
  if (['POSSIBLE_NAME_VARIANT', 'IDENTITY_AMBIGUOUS', 'DUPLICATE_DISI', 'OUT_OF_SCOPE_ROUTE'].includes(status) && (status !== 'OUT_OF_SCOPE_ROUTE' || hit.length))
    identity.push({ kind: status, signing_period: e.signing_period, name: e.name, mlbam_id: e.mlbam_id, birth_date: e.birth_date, country: e.country,
      disi_player_slug: likely, evidence: [`MLB transaction ${e.tx_id}: ${e.tx_desc}`, ...note].join(' | '), resolution_needed: status === 'IDENTITY_AMBIGUOUS' ? 'Confirm residence/eligibility route at signing' : status === 'POSSIBLE_NAME_VARIANT' ? 'Attach MLBAM id to DISI player after confirming birth date' : 'Decide membership' })
}
for (const e of external) {
  if (e.route === 'US_BORN_RESIDENCE_UNKNOWN' && byMlb.has(e.mlbam_id)) identity.push({ kind: 'US_BORN_CARRIED_BY_DISI', signing_period: e.signing_period, name: e.name, mlbam_id: e.mlbam_id, birth_date: e.birth_date, country: e.country, disi_player_slug: byMlb.get(e.mlbam_id)[0].player_slug, evidence: e.override_note, resolution_needed: 'Source residence at signing (international vs domestic undrafted route)' })
  if (e.route === 'LAD_AGREEMENT_SUPERSEDED') identity.push({ kind: 'AGREEMENT_SUPERSEDED', signing_period: e.signing_period, name: e.name, mlbam_id: e.mlbam_id, birth_date: e.birth_date, country: e.country, disi_player_slug: null, evidence: `Dodgers SFA ${e.signing_date}; ${e.superseded}`, resolution_needed: 'None for the Dodgers census (excluded); DISI already records the later club' })
}
for (const [id, d] of Object.entries(dupPeople)) identity.push({ kind: 'MLB_DUPLICATE_PERSON', signing_period: '', name: d.note.split(' (')[0], mlbam_id: id, birth_date: '', country: '', disi_player_slug: null, evidence: d.note, resolution_needed: `Counted once, as MLBAM ${d.same_as}` })
// names in a class list that have no Dodgers SFA transaction in the MLB record
for (const x of listOnly) {
  const v = D.filter((r) => disiNames(r).includes(x.normalized_name))
  const status = v.length ? 'MATCHED' : 'IDENTITY_AMBIGUOUS'
  v.forEach((r) => matchedDisi.add(r.signing_id))
  const row = {
    signing_period: x.list.period, signing_year: Number(x.list.period.slice(0, 4)), external_name: x.name, normalized_name: x.normalized_name,
    position: null, country: null, signing_date: null, source_url: x.list.transcribed_from, source_type: x.list.source_type,
    mlbam_id: null, bref_id: null, disi_status: status, likely_disi_player_slug: v.map((r) => r.player_slug).join('; ') || null,
    gap_class: v.length ? 'NONE' : 'LIST_NAME_WITHOUT_MLB_TRANSACTION', confidence: v.length ? 'MEDIUM' : 'LOW',
    notes: `named in ${x.list.key} (${x.list.stated_count}); no Dodgers SFA transaction for this name in the pinned MLB Stats API record` + (v.length ? '; DISI carries the name without an MLBAM id' : '; possibly unsigned, voided, or recorded under another name'),
  }
  gaps.push(row)
  identity.push({ kind: status === 'MATCHED' ? 'LIST_NAME_NO_MLB_RECORD' : 'IDENTITY_AMBIGUOUS', signing_period: x.list.period, name: x.name, mlbam_id: null, birth_date: null, country: null,
    disi_player_slug: row.likely_disi_player_slug, evidence: row.notes, resolution_needed: 'Find an MLBAM id or evidence that the agreement was voided' })
}
// DISI rows with no external counterpart
const AUDITED = new Set(PERIODS)
for (const r of D) {
  if (matchedDisi.has(r.signing_id)) continue
  const sp = disiPeriod(r)
  const inWindow = sp.period && AUDITED.has(sp.period)
  const ext = r.mlb_id ? null : null
  let why
  if (!inWindow) why = 'outside the audited 2009-2026 MLB transaction window (historical verified set)'
  else if (!r.mlb_id) why = 'DISI row has no MLBAM id and no name match in the MLB transaction record'
  else {
    const p = people.get(r.mlb_id)
    const t = [...(hist.get(r.mlb_id)?.values() || [])].sort((a, b) => a.date.localeCompare(b.date))
    why = p ? `MLBAM ${r.mlb_id} has no Dodgers SFA transaction in the window; first transaction: ${t[0] ? t[0].date + ' ' + t[0].description : 'none in pinned histories'}` : `MLBAM ${r.mlb_id} not in the pinned Dodgers SFA people set`
  }
  gaps.push({
    signing_period: sp.period, signing_year: r.signing_year, external_name: null, normalized_name: norm(r.full_name), position: r.primary_position,
    country: r.country_market, signing_date: r.signing_date, source_url: r.source_url, source_type: 'DISI', mlbam_id: r.mlb_id, bref_id: r.bref_id,
    disi_status: 'DISI_EXTRA', likely_disi_player_slug: r.player_slug, gap_class: inWindow ? 'DISI_ONLY_IN_WINDOW' : 'HISTORICAL_OUT_OF_WINDOW',
    confidence: inWindow ? 'MEDIUM' : 'HIGH', notes: why + ` | coverage_type ${r.coverage_type} | pathway ${r.pathway}`,
  })
}
// DISI duplicates by player or MLBAM id
const seenPlayer = new Map()
for (const r of D) { const k = r.player_id; seenPlayer.set(k, [...(seenPlayer.get(k) || []), r]) }
const dupGroups = [...seenPlayer.values()].filter((g) => g.length > 1)
for (const g of dupGroups) identity.push({ kind: 'DUPLICATE_DISI', signing_period: g.map((r) => disiPeriod(r).period).join('/'), name: g[0].full_name, mlbam_id: g[0].mlb_id, birth_date: g[0].p_birth_date, country: g[0].country_market, disi_player_slug: g[0].player_slug, evidence: `${g.length} Dodgers signing rows for one player: ${g.map((r) => r.signing_date || r.signing_year).join(', ')}`, resolution_needed: 'Confirm whether this is a re-signing or a duplicate' })
// a Dodgers player who also carries a non-Dodgers signing row (benchmark or re-signing elsewhere)
const otherByPlayer = new Map()
for (const r of disi.others) otherByPlayer.set(r.player_id, [...(otherByPlayer.get(r.player_id) || []), r])
for (const r of D) if (otherByPlayer.has(r.player_id)) identity.push({ kind: 'ALSO_NON_DODGERS_SIGNING', signing_period: disiPeriod(r).period, name: r.full_name, mlbam_id: r.mlb_id, birth_date: r.p_birth_date, country: r.country_market, disi_player_slug: r.player_slug, evidence: 'non-Dodgers signing rows: ' + otherByPlayer.get(r.player_id).map((o) => `${o.signing_year} ${o.pathway} ${o.coverage_type}`).join('; '), resolution_needed: 'Confirm the Dodgers row is the original signing' })
// spelling-variant suspects inside DISI: same last name + birth date, different player ids
const byLastDob = new Map()
for (const r of D) if (r.p_birth_date) { const k = norm(r.full_name).split(' ').pop() + '|' + r.p_birth_date; byLastDob.set(k, [...(byLastDob.get(k) || []), r]) }
for (const g of byLastDob.values()) if (new Set(g.map((r) => r.player_id)).size > 1) identity.push({ kind: 'SPELLING_VARIANT_SUSPECT', signing_period: g.map((r) => disiPeriod(r).period).join('/'), name: g.map((r) => r.full_name).join(' / '), mlbam_id: g.map((r) => r.mlb_id).join('/'), birth_date: g[0].p_birth_date, country: g[0].country_market, disi_player_slug: g.map((r) => r.player_slug).join('; '), evidence: 'same surname and birth date on distinct DISI players', resolution_needed: 'Merge or document as distinct' })
// MLBAM ids shared by two DISI players
for (const [id, g] of byMlb) if (new Set(g.map((r) => r.player_id)).size > 1) identity.push({ kind: 'DUPLICATE_DISI', signing_period: '', name: g.map((r) => r.full_name).join(' / '), mlbam_id: id, birth_date: '', country: '', disi_player_slug: g.map((r) => r.player_slug).join('; '), evidence: 'one MLBAM id on two DISI players', resolution_needed: 'Merge' })

gaps.sort((a, b) => String(a.signing_period).localeCompare(String(b.signing_period)) || String(a.disi_status).localeCompare(String(b.disi_status)) || String(a.signing_date || '').localeCompare(String(b.signing_date || '')) || String(a.normalized_name).localeCompare(String(b.normalized_name)))
identity.sort((a, b) => a.kind.localeCompare(b.kind) || String(a.signing_period).localeCompare(String(b.signing_period)) || a.name.localeCompare(b.name))

// ---- 5. scorecard -----------------------------------------------------------
const anchorsFor = (p) => manual.count_anchors.filter((a) => a.period === p)
const listsFor = (p) => manual.official_or_secondary_lists.filter((l) => l.period === p)
function quality(p) {
  const yr = Number(p.slice(0, 4))
  if (yr <= 2014) return 'MLB_STATS_API_SPARSE_ERA'
  const named = listsFor(p).length ? 'NAMED_LIST' : ''
  return ['MLB_STATS_API_FULL_PERIOD', named, anchorsFor(p).some((a) => a.scope === 'FULL_PERIOD') ? 'SECONDARY_TOTAL' : ''].filter(Boolean).join('+')
}
const score = []
const statusOf = (pct, p, ambiguous) => {
  if (Number(p.slice(0, 4)) <= 2014) return pct === 0 ? 'SPARSE' : pct < 0.5 ? 'SPARSE' : 'PARTIAL'
  if (pct >= 0.98 && ambiguous === 0) return 'COMPLETE'
  if (pct >= 0.9) return 'SUBSTANTIALLY_COMPLETE'
  if (pct >= 0.25) return 'PARTIAL'
  return 'SPARSE'
}
for (const p of PERIODS) {
  const ext = external.filter((e) => e.signing_period === p && (IN_SCOPE.has(e.route) || (e.route === 'US_BORN_RESIDENCE_UNKNOWN' && byMlb.has(e.mlbam_id))))
  const extOnlyList = gaps.filter((g) => g.signing_period === p && g.source_type !== 'MLB_STATS_API_TRANSACTION' && g.source_type !== 'DISI')
  const g = gaps.filter((x) => x.signing_period === p)
  const matched = ext.filter((e) => e.disi_status === 'MATCHED' || e.disi_status === 'DUPLICATE_DISI').length + extOnlyList.filter((x) => x.disi_status === 'MATCHED').length
  const missing = ext.filter((e) => e.disi_status === 'MISSING_FROM_DISI').length
  const ambiguous = ext.filter((e) => e.disi_status === 'POSSIBLE_NAME_VARIANT').length + extOnlyList.filter((x) => x.disi_status === 'IDENTITY_AMBIGUOUS').length
  const extra = g.filter((x) => x.disi_status === 'DISI_EXTRA').length
  const externalCount = ext.length + extOnlyList.length
  const disiCount = disiRows.filter((r) => r.signing_period === p).length
  const pct = externalCount ? matched / externalCount : 0
  score.push({ period: p + (p === OPEN_PERIOD ? ' (PROVISIONAL)' : ''), external_count: externalCount, count_source_quality: quality(p), disi_count: disiCount,
    matched, missing, extra, ambiguous, coverage_pct: (pct * 100).toFixed(1), census_status: p === OPEN_PERIOD ? 'PROVISIONAL_' + statusOf(pct, p, ambiguous) : statusOf(pct, p, ambiguous) })
}
// opening-class sub-scorecards (DISI's own COMPLETE/PARTIAL claims are about these)
const openingDefs = [
  ['2020-21', (e) => e.signing_date === '2021-01-15'],
  ['2023', (e) => e.signing_date === '2023-01-15'],
  ...manual.official_or_secondary_lists.map((l) => [l.period, (e) => e.lists.includes(l.key), l]),
]
for (const [p, pred, L] of openingDefs) {
  const ext = external.filter((e) => e.signing_period === p && pred(e))
  const listOnlyHere = L ? gaps.filter((x) => x.source_url === L.transcribed_from && x.signing_period === p) : []
  const matched = ext.filter((e) => ['MATCHED', 'DUPLICATE_DISI', 'OUT_OF_SCOPE_ROUTE'].includes(e.disi_status) && byMlb.has(e.mlbam_id)).length + listOnlyHere.filter((x) => x.disi_status === 'MATCHED').length
  const missing = ext.filter((e) => e.disi_status === 'MISSING_FROM_DISI').length
  const ambiguous = ext.filter((e) => e.disi_status === 'POSSIBLE_NAME_VARIANT').length + listOnlyHere.filter((x) => x.disi_status === 'IDENTITY_AMBIGUOUS').length
  const n = ext.length + listOnlyHere.length
  const pct = n ? matched / n : 0
  score.push({ period: `${p} opening class`, external_count: n, count_source_quality: L ? `${L.source_type} (stated ${L.stated_count})` : 'MLB_STATS_API_OPENING_DATE (matches official count)',
    disi_count: disiRows.filter((r) => r.signing_period === p && r.opening_class_member).length, matched, missing, extra: '', ambiguous, coverage_pct: (pct * 100).toFixed(1),
    census_status: pct >= 0.98 && ambiguous === 0 ? 'COMPLETE' : pct >= 0.9 ? 'SUBSTANTIALLY_COMPLETE' : pct >= 0.25 ? 'PARTIAL' : 'SPARSE' })
}
const histDisi = disiRows.filter((r) => !AUDITED.has(r.signing_period) && (r.signing_year ?? 0) < 2009)
const unplaced = disiRows.filter((r) => !AUDITED.has(r.signing_period) && (r.signing_year ?? 0) >= 2009)
if (unplaced.length) throw new Error('DISI rows with no period: ' + unplaced.map((r) => r.player_slug).join(', '))
score.unshift({ period: 'pre-2009 (1951-2008)', external_count: '', count_source_quality: 'NONE (no census source audited)', disi_count: histDisi.length,
  matched: '', missing: '', extra: '', ambiguous: '', coverage_pct: '', census_status: 'NOT_AUDITED' })

// authoritative modern census start: earliest closed period from which every closed period is COMPLETE or SUBSTANTIALLY_COMPLETE
const closed = score.filter((s) => PERIODS.includes(s.period))
let start = 'UNKNOWN'
for (let i = closed.length - 1; i >= 0; i--) {
  if (['COMPLETE', 'SUBSTANTIALLY_COMPLETE'].includes(closed[i].census_status)) start = closed[i].period
  else break
}
if (start !== 'UNKNOWN' && start === closed[closed.length - 1]?.period && closed.length > 1 && !['COMPLETE', 'SUBSTANTIALLY_COMPLETE'].includes(closed[closed.length - 2].census_status)) start = start // single trailing period
const lastClosed = closed[closed.length - 1]
const authoritativeStart = ['COMPLETE', 'SUBSTANTIALLY_COMPLETE'].includes(lastClosed?.census_status) ? start : 'UNKNOWN'

// ---- 6. current population CSV ----------------------------------------------
writeCsv('current-disi-population.csv', ['full_name', 'player_slug', 'player_id', 'signing_date', 'signing_year', 'signing_period', 'period_flag', 'country', 'position', 'pathway', 'amateur_or_pro', 'mlbam_id', 'bref_id', 'source_url', 'cost_state', 'outcome_state', 'coverage_type', 'record_scope', 'opening_class_member', 'full_period_member'], disiRows)
writeCsv('year-scorecard.csv', ['period', 'external_count', 'count_source_quality', 'disi_count', 'matched', 'missing', 'extra', 'ambiguous', 'coverage_pct', 'census_status'], score)
writeCsv('dodgers-signing-census-gaps.csv', ['signing_period', 'signing_year', 'external_name', 'normalized_name', 'position', 'country', 'signing_date', 'source_url', 'source_type', 'mlbam_id', 'bref_id', 'disi_status', 'likely_disi_player_slug', 'gap_class', 'confidence', 'notes'], gaps)
writeCsv('identity-review.csv', ['kind', 'signing_period', 'name', 'mlbam_id', 'birth_date', 'country', 'disi_player_slug', 'evidence', 'resolution_needed'], identity)

// ---- 7. external-periods.json -----------------------------------------------
const extPeriods = {
  generated_by: 'database/research/census-audit/build.mjs',
  accessed: manual.accessed,
  method: 'Dodgers (teamId 119) SFA transactions from the MLB Stats API, 2008-2026, joined to MLB person records (birth country, birth date, draft year) and each player\'s full transaction history. In scope: no draft year; birth country outside USA/Puerto Rico/Canada (or a US-born player named in a class list); no transaction with another MLB organization or its affiliates before the Dodgers signing. Route INTERNATIONAL_AMATEUR if under 23 at signing, MEXICAN_LEAGUE_TRANSFER if a Mexican League club held prior rights, otherwise FOREIGN_PROFESSIONAL.',
  period_rules: manual.period_rules,
  raw_inputs: Object.fromEntries(rawFiles.map((f) => [f, { sha256: pins.files[f].sha256, url: pins.files[f].url }])),
  count_anchors: manual.count_anchors,
  named_lists: manual.official_or_secondary_lists.map(({ names, ...rest }) => ({ ...rest, name_count: names.length })),
  unreadable_sources: manual.unreadable_sources,
  periods: PERIODS.map((p) => ({
    period: p,
    open: p === OPEN_PERIOD,
    in_scope: external.filter((e) => e.signing_period === p && IN_SCOPE.has(e.route)).map((e) => ({ mlbam_id: e.mlbam_id, name: e.name, date: e.signing_date, country: e.country, birth_date: e.birth_date, age: e.age_at_signing, position: e.position, route: e.route, lists: e.lists, disi_status: e.disi_status })),
    out_of_scope: external.filter((e) => e.signing_period === p && !IN_SCOPE.has(e.route)).map((e) => ({ mlbam_id: e.mlbam_id, name: e.name, date: e.signing_date, route: e.route, age: e.age_at_signing, disi_status: e.disi_status })),
  })),
}
fs.writeFileSync(path.join(HERE, 'external-periods.json'), JSON.stringify(extPeriods, null, 1) + '\n')

// ---- 8. owner research queue ------------------------------------------------
const q = (s) => '`' + s + '`'
const queue = []
const missingRows = gaps.filter((g) => g.disi_status === 'MISSING_FROM_DISI')
const confirmed = missingRows.filter((g) => g.gap_class === 'CONFIRMED_MISSING')
const probable = missingRows.filter((g) => g.gap_class === 'PROBABLE_MISSING')
const ambiguousRows = gaps.filter((g) => g.disi_status === 'IDENTITY_AMBIGUOUS' || g.disi_status === 'POSSIBLE_NAME_VARIANT')
const extras = gaps.filter((g) => g.disi_status === 'DISI_EXTRA' && g.gap_class === 'DISI_ONLY_IN_WINDOW')
const falseMem = gaps.filter((g) => g.disi_status === 'OUT_OF_SCOPE_ROUTE' && g.likely_disi_player_slug)
let md_ = '# Owner research queue: Dodgers international signing census\n\n'
md_ += 'Generated by `build.mjs`. Only ACTIONABLE items appear here; every item has a ready-to-paste Google query. Ranked: membership first, then dates, country/position, bonuses, outcomes, milestones.\n\n'
md_ += `Counts: ${falseMem.length} false-membership checks, ${ambiguousRows.length} identity/route checks, ${extras.length} DISI-only rows in the audited window, ${confirmed.length} confirmed-missing and ${probable.length} probable-missing players.\n\n`
md_ += '## 1. Membership: DISI rows whose MLB record contradicts Dodgers original-signing membership\n\n'
if (!falseMem.length) md_ += 'None found: every DISI row inside 2009-2026 matches an MLB Dodgers signing on an in-scope route (one US-born exception is listed in section 2 of audit-report.md).\n'
for (const g of falseMem) md_ += `- [ ] ${g.likely_disi_player_slug} (${g.signing_period}, MLBAM ${g.mlbam_id}): ${g.notes}. Query: ${q(`"${g.external_name}" signed Dodgers ${g.signing_year} international`)}\n`
md_ += '\n## 2. Membership: identity and route checks\n\n'
for (const g of ambiguousRows) md_ += `- [ ] ${g.external_name} (${g.signing_period}${g.mlbam_id ? ', MLBAM ' + g.mlbam_id : ''}): ${g.disi_status}. ${g.notes.replace(/\.$/, '')}. Query: ${q(`"${g.external_name}" Dodgers ${g.signing_year} international signing`)}\n`
md_ += '\n## 3. Membership: DISI-only rows inside the audited window\n\n'
if (!extras.length) md_ += 'None: every DISI row dated 2009 or later matched an MLB Dodgers signing by MLBAM id.\n'
for (const g of extras) md_ += `- [ ] ${g.likely_disi_player_slug} (${g.signing_period}): ${g.notes}. Query: ${q(`"${g.normalized_name}" Dodgers signed ${g.signing_year}`)}\n`
const byPeriodDesc = (a, b) => String(b.signing_period).localeCompare(String(a.signing_period)) || a.normalized_name.localeCompare(b.normalized_name)
md_ += '\n## 4a. Membership: missing players who reached the major leagues (highest materiality)\n\n'
for (const g of missingRows.filter((x) => /MLB debut/.test(x.notes)).sort(byPeriodDesc)) md_ += `- [ ] ${g.external_name} | ${g.signing_period} | ${g.signing_date} | ${g.country} | MLBAM ${g.mlbam_id} | ${g.gap_class} | ${(g.notes.match(/MLB debut [0-9-]+/) || [''])[0]}. Query: ${q(`"${g.external_name}" Dodgers signed ${g.signing_year} international bonus`)}\n`
md_ += '\n## 4. Membership: confirmed missing players (MLB transaction record), newest period first\n\n'
for (const g of [...confirmed].sort(byPeriodDesc)) md_ += `- [ ] ${g.external_name} | ${g.signing_period} | ${g.signing_date} | ${g.country} | ${g.position} | MLBAM ${g.mlbam_id}. Query: ${q(`"${g.external_name}" Dodgers ${g.signing_year} ${g.country} signing bonus`)}\n`
md_ += '\n## 5. Membership: probable missing players (route or age needs a second source)\n\n'
for (const g of [...probable].sort(byPeriodDesc)) md_ += `- [ ] ${g.external_name} | ${g.signing_period} | ${g.signing_date} | ${g.country} | MLBAM ${g.mlbam_id} | ${g.notes}. Query: ${q(`"${g.external_name}" Dodgers ${g.signing_year} signed`)}\n`
md_ += '\n## 5b. Membership: leads with no MLB signing transaction\n\n'
for (const l of manual.additional_leads || []) md_ += `- [ ] ${l.name} | ${l.period} | MLBAM ${l.mlbam_id}: ${l.evidence} Query: ${q(l.query)}\n`
md_ += '\n## 6. Dates\n\n- [ ] For every DISI row dated off-period (see `period_flag` in current-disi-population.csv and "DISI period ... vs MLB transaction period" notes in the gaps CSV), confirm agreement date vs MLB registration date. Query: ' + q('"<player>" Dodgers agreed international signing date') + '\n'
md_ += '\n## 7. Country / position, 8. Bonuses, 9. Outcomes, 10. Milestones\n\nNot queued by this audit: these are row-level enrichments for players DISI already carries and are covered by earlier research packets. Bonus gaps are classified in audit-report.md (most are UNDISCLOSED, not ACTIONABLE).\n'
fs.writeFileSync(path.join(HERE, 'owner-research-queue.md'), md_)

// ---- 9. summary ------------------------------------------------------------
const count = (arr, k) => arr.reduce((m, r) => ((m[r[k] ?? 'NULL'] = (m[r[k] ?? 'NULL'] || 0) + 1), m), {})
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
const yrs = disiRows.map((r) => r.signing_year).filter((y) => y != null)
const minY = Math.min(...yrs), maxY = Math.max(...yrs)
const present = new Set(yrs)
const inScopeAll = external.filter((e) => IN_SCOPE.has(e.route))
const closedInScope = inScopeAll.filter((e) => e.signing_period !== OPEN_PERIOD)
const summary = {
  disi_total: disiRows.length,
  earliest: disiRows.find((r) => r.signing_date)?.signing_date, latest: [...disiRows].reverse().find((r) => r.signing_date)?.signing_date,
  by_year: sortObj(count(disiRows, 'signing_year')), by_period: Object.entries(count(disiRows, 'signing_period')).sort(([a], [b]) => a.localeCompare(b)).map(([period, n]) => ({ period, n })), by_pathway: sortObj(count(disiRows, 'pathway')),
  by_country: sortObj(count(disiRows, 'country')), by_amateur_or_pro: sortObj(count(disiRows, 'amateur_or_pro')), by_coverage_type: sortObj(count(disiRows, 'coverage_type')),
  dated: disiRows.filter((r) => r.signing_date).length, undated: disiRows.filter((r) => !r.signing_date).length,
  with_mlbam: disiRows.filter((r) => r.mlbam_id).length, cost_state: sortObj(count(disiRows, 'cost_state')),
  zero_years_in_range: Array.from({ length: maxY - minY + 1 }, (_, i) => minY + i).filter((y) => !present.has(y)),
  external_in_scope_2009_2026: inScopeAll.length, by_route: sortObj(count(inScopeAll, 'route')),
  status_counts: sortObj(count(gaps, 'disi_status')), gap_class_counts: sortObj(count(gaps, 'gap_class')),
  confirmed_missing: confirmed.length, probable_missing: probable.length,
  authoritative_modern_census_start: authoritativeStart,
  external_in_scope_closed_periods_2009_2025: closedInScope.length,
}
// census totals (see audit-report.md for the definitions)
const listMatchedOnly = gaps.filter((g) => g.source_type !== 'MLB_STATS_API_TRANSACTION' && g.source_type !== 'DISI' && g.disi_status === 'MATCHED').length
const probableIds = new Set(probable.map((g) => String(g.mlbam_id)))
const confirmedExternal = inScopeAll.filter((e) => !probableIds.has(String(e.mlbam_id))).length
const usBornCarried = external.filter((e) => e.route === 'US_BORN_RESIDENCE_UNKNOWN' && byMlb.has(e.mlbam_id)).length
const listNoRecord = gaps.filter((g) => g.gap_class === 'LIST_NAME_WITHOUT_MLB_TRANSACTION').length
const usBornOpen = gaps.filter((g) => g.disi_status === 'IDENTITY_AMBIGUOUS' && g.source_type === 'MLB_STATS_API_TRANSACTION').length
summary.census_components = { disi_pre_2009_historical_rows: histDisi.length, mlb_recorded_in_scope_2009_2026: inScopeAll.length, of_which_probable_only: probable.length,
  us_born_carried_by_disi: usBornCarried, class_list_names_carried_by_disi_without_mlb_record: listMatchedOnly, class_list_names_without_mlb_record_not_in_disi: listNoRecord, us_born_route_unresolved_not_in_disi: usBornOpen }
summary.CONFIRMED_MINIMUM_CENSUS = { value: histDisi.length + confirmedExternal + usBornCarried + listMatchedOnly,
  modern_2009_2026_only: confirmedExternal + usBornCarried + listMatchedOnly,
  definition: 'DISI pre-2009 historical rows (a verified sample, not a census) + MLB-recorded in-scope Dodgers signings 2009 through 2026-to-date excluding PROBABLE_MISSING + US-born players DISI already carries + class-list names DISI carries without an MLB record.' }
summary.ESTIMATED_CENSUS_IF_PROBABLE_INCLUDED = { value: summary.CONFIRMED_MINIMUM_CENSUS.value + probable.length + listNoRecord + usBornOpen,
  modern_2009_2026_only: summary.CONFIRMED_MINIMUM_CENSUS.modern_2009_2026_only + probable.length + listNoRecord + usBornOpen,
  definition: 'CONFIRMED_MINIMUM_CENSUS + PROBABLE_MISSING + class-list names with no MLB record + US-born route-unresolved players. Still a floor for 2009-10 through 2014-15, where the MLB transaction record is incomplete.' }
summary.disi_only_in_window = extras.length
fs.writeFileSync(path.join(HERE, 'build-summary.json'), JSON.stringify(summary, null, 1) + '\n')
console.log(JSON.stringify({ disi: summary.disi_total, external: inScopeAll.length, status: summary.status_counts, confirmed: confirmed.length, probable: probable.length, start: authoritativeStart, min: summary.CONFIRMED_MINIMUM_CENSUS.value, est: summary.ESTIMATED_CENSUS_IF_PROBABLE_INCLUDED.value }))
