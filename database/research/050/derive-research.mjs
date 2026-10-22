#!/usr/bin/env node
// Derives the 050 research artifacts from directly read public sources:
//   source-cohorts.json     the official MLB Pipeline international Top-30 lists for the 2015 and 2016 classes, exactly as the archived official
//                           data feed published them (rank, name, position, list team), with the capture URLs, timestamps and SHA-256 of each capture
//   identity-research.json  one decision per list member and per legacy unresolved benchmark player: RESOLVED / CONFLICT / INSUFFICIENT_EVIDENCE,
//                           with every signal used (official signing transaction, person record, register birth-date cross-check, route evidence)
//   outcome-research.json   the MLB outcome facts of every resolved player at the unchanged 2026-10-05 audit boundary
//
//   node database/research/050/derive-research.mjs --raw <captures-dir> --register <chadwick-register-dir> --cache <api-cache-dir>
//
// Network: the official MLB Stats API (team transactions over each signing window, person records, career statistics) and, for Cuban signees only,
// the Wikipedia article text as a corroborating account of prior Cuban National Series play (route, never identity or outcome). Every response is
// cached under --cache, so a rerun with the same cache is byte-identical. The archived captures and the register are read from disk and their
// SHA-256 recorded; they are not committed (only the facts used are).
//
// RANKING APPEARANCE != NEW SIGNING; RANKING CLASS YEAR != SIGNING YEAR; SOURCE LIST MEMBERSHIP != VERIFIED SIGNING. Nothing is resolved by name
// alone: a member is RESOLVED only when exactly one person the official transaction log shows signing in the class window matches the published
// name, the club agrees with the club the list names (when it names one), the birth year is plausible for the class, the position family agrees,
// and (when the register holds the person) the register birth date equals the MLB person record's.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { norm, nameMatch, recordedNames, screenName, isSigning, describedName, decideIdentity, classifyCubanRoute } from './identity-rules.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
const RAW = arg('raw'), REGISTER = arg('register'), CACHE = arg('cache')
if (!RAW || !REGISTER || !CACHE) throw new Error('usage: --raw <dir> --register <dir> --cache <dir>')
fs.mkdirSync(CACHE, { recursive: true })
const AUDIT_THROUGH = '2026-10-05'
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 1. The official lists (archived official MLB Pipeline data feed, read directly)
// ---------------------------------------------------------------------------------------------------------------------------------------------
const CAPTURES = {
  'pipe2015/pp-20150511.json': 'https://web.archive.org/web/20150511221143id_/http://m.mlb.com/gen/players/prospects/2015/playerProspects.json',
  'pipe2015/pp-20190430.json': 'https://web.archive.org/web/20190430161634id_/http://m.mlb.com/gen/players/prospects/2015/playerProspects.json',
  'pipe2016/pp-20170916.json': 'https://web.archive.org/web/20170916032009id_/http://www.mlb.com:80/gen/players/prospects/2016/playerProspects.json',
  'pipe2016/pp-20190430.json': 'https://web.archive.org/web/20190430161634id_/http://m.mlb.com/gen/players/prospects/2016/playerProspects.json',
}
const captures = {}
for (const [file, url] of Object.entries(CAPTURES)) {
  const buf = fs.readFileSync(path.join(RAW, file))
  const doc = JSON.parse(buf.toString('utf8'))
  captures[file] = { url, file, sha256: sha256(buf), bytes: buf.length, year: Number(doc.year), last_updated: doc.last_updated, int: doc.prospect_players.int }
}
// The cohort list of each class: the earliest machine-readable official capture of the international list. 2015: the list as published before the
// 2015-16 signing period opened (no club yet). 2016: no pre-signing capture of the data feed exists; the earliest is the signing-period list
// (updated 2017-05-27, inside the 2016-17 period), which names the signing club. The later revisions are recorded beside them, never as the cohort.
const COHORTS = [
  { class_year: 2015, list: 'pipe2015/pp-20150511.json', teams: 'pipe2015/pp-20190430.json', window: ['2015-06-01', '2016-06-30'],
    basis: 'PRE_SIGNING_LIST', note: 'Published before the 2015-16 international signing period opened (feed last_updated 2015-05-11); no club is named. Clubs are read from the later revision of the same list (last_updated 2018-12-06), which names the club each listed player signed with.' },
  { class_year: 2016, list: 'pipe2016/pp-20170916.json', teams: 'pipe2016/pp-20170916.json', window: ['2016-06-01', '2017-06-30'],
    basis: 'SIGNING_PERIOD_LIST', note: 'No capture of the data feed exists from before the 2016-17 signing period opened; the earliest is the list as updated on 2017-05-27, inside the period, naming each signing club. It is a signing-period observation, not a pre-signing one.' },
]
const PIPE_TEAM = { LA: 'LAD', WAS: 'WSH', ANA: 'LAA' }
const pipeTeam = (code) => (code ? PIPE_TEAM[code] ?? code : null)
const fullName = (r) => `${r.player_first_name} ${r.player_last_name}`.replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 2. Cached official MLB Stats API reads
// ---------------------------------------------------------------------------------------------------------------------------------------------
async function cached(key, url) {
  const file = path.join(CACHE, key.replace(/[^A-Za-z0-9_.-]/g, '_') + '.json')
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  const wiki = url.startsWith('https://en.wikipedia.org/')
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { headers: { 'user-agent': 'DISI-research/050 (https://github.com/seantsck/DISI; public data, low volume)' } })
    if (r.ok || r.status === 404) {
      // a 404 is a withdrawn record: cached as such, so the person simply cannot match
      const body = r.ok ? await r.json() : { not_found: true }
      fs.writeFileSync(file, JSON.stringify(body))
      await sleep(wiki ? 2500 : 120)
      return body
    }
    await sleep((wiki ? 20000 : 1500) * (i + 1))
  }
  throw new Error(`GET failed: ${url}`)
}
const API = 'https://statsapi.mlb.com/api/v1'
const teams = (await cached('teams-2016', `${API}/teams?sportId=1&season=2016`)).teams
const DISI_ABBR = { AZ: 'ARI', ATH: 'OAK' }
const teamAbbr = new Map(teams.map((t) => [t.id, DISI_ABBR[t.abbreviation] ?? t.abbreviation]))

/** Every official signing transaction by each club inside a window (isSigning: SFA, or SGN for some international amateurs). */
/** @param {string[]} window [from, to] as ISO dates */
async function signingsInWindow(window) {
  const [from, to] = window
  const out = []
  for (const t of [...teams].sort((a, b) => a.id - b.id)) {
    const body = await cached(`tx-${t.id}-${from}-${to}`, `${API}/transactions?teamId=${t.id}&startDate=${from}&endDate=${to}`)
    for (const x of body.transactions ?? []) {
      if (!isSigning(x) || !x.person?.id || x.toTeam?.id !== t.id) continue
      out.push({ person_id: x.person.id, person_name: x.person.fullName, described_name: describedName(x.description), date: x.date ?? x.effectiveDate,
        club: teamAbbr.get(t.id), type_code: x.typeCode, description: x.description, transaction_id: x.id })
    }
  }
  return out
}
const person = async (id) => (await cached(`person-${id}`, `${API}/people/${id}`)).people?.[0]
const careerStats = async (id) => cached(`career-${id}`, `${API}/people/${id}/stats?stats=career&group=hitting,pitching&gameType=R`)
const playerTransactions = async (id) => (await cached(`ptx-${id}`, `${API}/transactions?playerId=${id}`)).transactions ?? []

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 3. Identity matching: never by name alone
// ---------------------------------------------------------------------------------------------------------------------------------------------
// the matcher, the screen and the decision are the pure rules of identity-rules.mjs

// Chadwick register: identifier crosswalk and an independent birth date (identity only, never outcome)
const register = new Map()
for (const f of fs.readdirSync(REGISTER).filter((x) => /^people-[0-9a-f]\.csv$/.test(x)).sort()) {
  const lines = fs.readFileSync(path.join(REGISTER, f), 'utf8').split('\n')
  const h = Object.fromEntries(lines[0].split(',').map((c, i) => [c, i]))
  for (const l of lines.slice(1)) {
    const c = l.split(',')
    const mlbam = c[h.key_mlbam]
    if (!mlbam) continue
    register.set(mlbam, { bbref: c[h.key_bbref] || null, bbref_minors: c[h.key_bbref_minors] || null, birth: c[h.birth_year] && c[h.birth_month] && c[h.birth_day] ? `${c[h.birth_year]}-${c[h.birth_month].padStart(2, '0')}-${c[h.birth_day].padStart(2, '0')}` : null })
  }
}
const registerFiles = fs.readdirSync(REGISTER).filter((x) => /^people-[0-9a-f]\.csv$/.test(x)).sort()
const registerSha = sha256(Buffer.concat(registerFiles.map((f) => fs.readFileSync(path.join(REGISTER, f)))))

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 4. Route of Cuban signees (prior professional play), corroborated only
// ---------------------------------------------------------------------------------------------------------------------------------------------
async function cubanRoute(p, signingYear) {
  // the official record first: a professional winter-league or Caribbean Series season BEFORE the signing year (later seasons say nothing about
  // the route the player arrived by)
  const pro = []
  for (const g of ['hitting', 'pitching']) {
    const s = await cached(`win-${p.id}-${g}`, `${API}/people/${p.id}/stats?stats=yearByYear&group=${g}&sportId=17`)
    for (const st of s.stats ?? []) for (const sp of st.splits ?? []) if (Number(sp.season) < signingYear) pro.push({ season: Number(sp.season), league: sp.league?.name ?? null, team: sp.team?.name ?? null })
  }
  const title = p.fullName
  const search = await cached(`wiki-search-${p.id}`, `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=${encodeURIComponent(`${title} baseball`)}`)
  const hit = (search.query?.search ?? []).find((h) => norm(h.title).startsWith(norm(title).split(' ')[0]) && norm(h.title).includes(norm(title).split(' ').slice(-1)[0]))
  let sentences = [], start = [], wiki_url = null
  if (hit) {
    const page = await cached(`wiki-extract-${p.id}`, `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&pageids=${hit.pageid}`)
    const text = Object.values(page.query?.pages ?? {})[0]?.extract ?? ''
    wiki_url = `https://en.wikipedia.org/?curid=${hit.pageid}`
    const all = text.split(/(?<=\.)\s+|\n+/).map((s) => s.trim()).filter((s) => s && !/^=+/.test(s))
    sentences = all.filter((s) => /Cuban National Series|Serie Nacional/i.test(s)).slice(0, 4)
    start = all.filter((s) => /began his professional career in (\d{4})/i.test(s) && !/Cuban National Series|Serie Nacional/i.test(s)).slice(0, 2)
  }
  const route = classifyCubanRoute({ seriesSentences: sentences, startSentences: start, proSeasonsBeforeSigning: pro, signingYear })
  return { official_winter_or_caribbean_seasons: pro, wiki_url, wiki_title: hit?.title ?? null, wiki_sentences: [...sentences, ...start], route }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 5. Research every member
// ---------------------------------------------------------------------------------------------------------------------------------------------
async function resolve(entry, signings, windowLabel) {
  const name = entry.published_name
  const candidates = []
  for (const s of signings) {
    // cheap screen on the names the transaction carries; the person record (with its maternal surname) is read only for a plausible screen hit
    if (!screenName(name, s)) continue
    const rec = await person(s.person_id)
    const m = nameMatch(name, recordedNames(rec, s))
    if (m) candidates.push({ ...s, match: m, rec })
  }
  return decideIdentity(entry, candidates, (id) => register.get(id) ?? null, windowLabel)
}

const identity = []
const cohorts = []
for (const c of COHORTS) {
  const list = captures[c.list], teamsCap = captures[c.teams]
  const teamBySlug = new Map(teamsCap.int.map((r) => [r.player_id, pipeTeam(r.team_file_code || null)]))
  const sign = await signingsInWindow(c.window)
  const members = list.int.map((r) => ({
    cohort: `MLB-${c.class_year}-PIPELINE-TOP30`, class_year: c.class_year, rank: r.rank, pipeline_slug: r.player_id, published_name: fullName(r),
    published_position: r.position, list_club: teamBySlug.get(r.player_id) ?? null,
  }))
  cohorts.push({
    population_key: `MLB-${c.class_year}-PIPELINE-TOP30`, class_year: c.class_year, list_basis: c.basis, note: c.note,
    list_capture: { url: list.url, sha256: list.sha256, bytes: list.bytes, last_updated: list.last_updated },
    club_capture: { url: teamsCap.url, sha256: teamsCap.sha256, bytes: teamsCap.bytes, last_updated: teamsCap.last_updated },
    signing_window: c.window, list_size: members.length,
    members: members.map(({ cohort, class_year, ...m }) => m),
  })
  for (const m of members) identity.push(await resolve(m, sign, c.window))
}
// later revisions of the same lists, recorded for the audit trail (never the cohort)
const revisions = [['pipe2015/pp-20150511.json', 'pipe2015/pp-20190430.json'], ['pipe2016/pp-20170916.json', 'pipe2016/pp-20190430.json']].map(([a, b]) => {
  const A = captures[a], B = captures[b]
  const as = new Set(A.int.map((r) => r.player_id)), bs = new Set(B.int.map((r) => r.player_id))
  return { class_year: A.year, cohort_capture: A.url, revision_capture: B.url, revision_last_updated: B.last_updated, revision_sha256: B.sha256,
    added_in_revision: B.int.filter((r) => !as.has(r.player_id)).map((r) => ({ rank: r.rank, name: fullName(r), position: r.position, club: pipeTeam(r.team_file_code || null) })),
    dropped_in_revision: A.int.filter((r) => !bs.has(r.player_id)).map((r) => ({ rank: r.rank, name: fullName(r), position: r.position })),
    club_changes: B.int.filter((r) => as.has(r.player_id)).map((r) => ({ name: fullName(r), cohort_club: pipeTeam(A.int.find((x) => x.player_id === r.player_id)?.team_file_code || null), revision_club: pipeTeam(r.team_file_code || null) })).filter((x) => x.cohort_club !== x.revision_club) }
})

// the five legacy 035 benchmark identities (2013 / 2014 trackers; club and class as the tracker states them)
const LEGACY = [
  // stored_country: the country_market Migration 013 recorded from the tracker
  { slug: 'emmanuel-dejesus', published_name: 'Emmanuel DeJesus', list_club: 'BOS', class_year: 2013, published_position: 'LHP', rank: 24, stored_country: 'Venezuela' },
  { slug: 'micker-zapata', published_name: 'Micker Zapata', list_club: 'CWS', class_year: 2013, published_position: 'OF', rank: 2, stored_country: 'Dominican Republic' },
  { slug: 'yeyson-yrizarry', published_name: 'Yeyson Yrizarry', list_club: 'TEX', class_year: 2013, published_position: 'SS', rank: 23, stored_country: 'Dominican Republic' },
  { slug: 'yeremy-rosario', published_name: 'Yeremy Rosario', list_club: 'COL', class_year: 2014, published_position: 'SS', rank: 22, stored_country: 'Dominican Republic' },
  { slug: 'jonathan-amundaray', published_name: 'Jonathan Amundaray', list_club: 'NYY', class_year: 2014, published_position: 'OF', rank: 7, stored_country: 'Venezuela' },
]
for (const y of [2013, 2014]) {
  const sign = await signingsInWindow([`${y}-06-01`, `${y + 1}-06-30`])
  for (const l of LEGACY.filter((x) => x.class_year === y)) identity.push(await resolve({ cohort: 'LEGACY_035', ...l }, sign, [`${y}-06-01`, `${y + 1}-06-30`]))
}

// route evidence for Cuban signees, and outcome facts for every resolved player
const outcomes = []
for (const r of identity.filter((x) => x.result === 'RESOLVED')) {
  const rec = await person(r.mlb_id)
  if (r.birth_country === 'Cuba') r.route_evidence = await cubanRoute(rec, Number(r.signing.date.slice(0, 4)))
  const stats = await careerStats(r.mlb_id)
  const hit = (stats.stats ?? []).find((s) => s.group?.displayName === 'hitting')?.splits?.[0]?.stat
  const pit = (stats.stats ?? []).find((s) => s.group?.displayName === 'pitching')?.splits?.[0]?.stat
  const debut = rec.mlbDebutDate ?? null
  const tx = await playerTransactions(r.mlb_id)
  outcomes.push({
    cohort: r.cohort, slug: r.slug ?? null, published_name: r.published_name, mlb_id: r.mlb_id,
    person_url: `${API}/people/${r.mlb_id}`, stats_url: `${API}/people/${r.mlb_id}/stats?stats=career&group=hitting,pitching&gameType=R`,
    transactions_url: `${API}/transactions?playerId=${r.mlb_id}`,
    mlb_debut_date: debut && debut <= AUDIT_THROUGH ? debut : null,
    mlb_debut_date_after_boundary: debut && debut > AUDIT_THROUGH ? debut : null,
    active: rec.active ?? null,
    mlb_games: debut && debut <= AUDIT_THROUGH ? ((hit?.gamesPlayed ?? 0) + (pit?.gamesPlayed ?? 0) || null) : null,
    mlb_pa: debut && debut <= AUDIT_THROUGH ? hit?.plateAppearances ?? null : null,
    mlb_ip: debut && debut <= AUDIT_THROUGH ? pit?.inningsPitched ?? null : null,
    later_club_moves: tx.filter((x) => x.typeCode === 'SFA' && x.date > r.signing.date).map((x) => ({ date: x.date, club: teamAbbr.get(x.toTeam?.id) ?? x.toTeam?.name ?? null, description: x.description })),
  })
}

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const write = (f, doc) => fs.writeFileSync(path.join(here, f), JSON.stringify(sortKeys(doc), null, 1) + '\n')
const retrieved = fs.readdirSync(CACHE).map((f) => fs.statSync(path.join(CACHE, f)).mtime.toISOString().slice(0, 10)).sort().pop()
write('source-cohorts.json', {
  generated_by: 'database/research/050/derive-research.mjs', retrieved_at: retrieved,
  source_family: 'MLB Pipeline (MLB.com) international Top 30 prospect list: the official data feed /gen/players/prospects/<year>/playerProspects.json, list "int", read through archived captures (www.mlb.com answers 403 to direct reads)',
  cohorts, later_revisions: revisions,
})
write('identity-research.json', {
  generated_by: 'database/research/050/derive-research.mjs', retrieved_at: retrieved,
  method: 'An entry is RESOLVED only when exactly one person the official MLB transaction log shows signing (typeCode SFA) inside the class window matches the published name, the club agrees with the list (when it names one), the birth year fits the class, the position family agrees, and the register birth date (when held) equals the MLB person record. A spelling variant alone is never enough without the list naming the same club. Otherwise CONFLICT or INSUFFICIENT_EVIDENCE.',
  register: { url: 'https://github.com/chadwickbureau/register', files: registerFiles, sha256: registerSha },
  entries: identity,
})
write('outcome-research.json', { generated_by: 'database/research/050/derive-research.mjs', retrieved_at: retrieved, audit_through_date: AUDIT_THROUGH, players: outcomes })
const tally = (xs) => xs.reduce((m, x) => ((m[x.result] = (m[x.result] ?? 0) + 1), m), {})
console.log(JSON.stringify({ by_cohort: Object.fromEntries(['MLB-2015-PIPELINE-TOP30', 'MLB-2016-PIPELINE-TOP30', 'LEGACY_035'].map((k) => [k, tally(identity.filter((x) => x.cohort === k))])),
  reached: outcomes.filter((o) => o.mlb_debut_date).length }, null, 1))
