#!/usr/bin/env node
// Derives the 055 research artifacts from directly read public sources, with the 050 method and the 050 identity rules unchanged
// (database/research/050/identity-rules.mjs is imported, not copied):
//   source-cohorts.json     the official MLB Pipeline international Top-30 lists of the 2017 and 2018 classes, exactly as the archived official
//                           data feed published them before each signing period opened (rank, name, position), the club each listed player signed
//                           with from the final revision of the same feed, the capture URLs, timestamps and SHA-256 of every capture used
//   identity-research.json  one decision per list member: RESOLVED / CONFLICT / INSUFFICIENT_EVIDENCE, with every signal used
//   outcome-research.json   the MLB outcome facts of every resolved player at the unchanged 2026-10-05 audit boundary (and a recorded death)
//
//   node database/research/055/derive-research.mjs --raw <captures-dir> --register <chadwick-register-dir> --cache <api-cache-dir>
//
// Network: the official MLB Stats API (team transactions over each signing window, person records, career statistics) and, for Cuban signees
// only, the Wikipedia article text as a corroborating account of prior Cuban National Series play (route, never identity or outcome). Every
// response is cached under --cache, so a rerun with the same cache is byte-identical. The archived captures and the register are read from disk
// and their SHA-256 recorded; they are not committed (only the facts used are).
//
// RANKING APPEARANCE != NEW SIGNING; RANKING CLASS YEAR != SIGNING YEAR; SOURCE LIST MEMBERSHIP != VERIFIED SIGNING. Nothing is resolved by name
// alone (decideIdentity, 050). The rank comes from the cohort capture; the signing club and date come from the official transaction log; the
// feed's club field only narrows the candidates and never overrides the log.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { norm, nameMatch, recordedNames, screenName, isSigning, describedName, decideIdentity, classifyCubanRoute } from '../050/identity-rules.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
const RAW = arg('raw'), REGISTER = arg('register'), CACHE = arg('cache')
if (!RAW || !REGISTER || !CACHE) throw new Error('usage: --raw <dir> --register <dir> --cache <dir>')
fs.mkdirSync(CACHE, { recursive: true })
const AUDIT_THROUGH = '2026-10-05'
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const sha1b32 = (buf) => {
  // the Internet Archive's CDX digest: base32 of the SHA-1 of the archived payload
  const h = crypto.createHash('sha1').update(buf).digest()
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = '', out = ''
  for (const b of h) bits += b.toString(2).padStart(8, '0')
  for (let i = 0; i < bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]
  return out
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 1. The official lists (archived official MLB Pipeline data feed, read directly)
// ---------------------------------------------------------------------------------------------------------------------------------------------
const CAPTURES = {
  'f2017/pp17-www-20170526.json': { url: 'https://web.archive.org/web/20170526025827id_/http://www.mlb.com:80/gen/players/prospects/2017/playerProspects.json',
    original: 'http://www.mlb.com/gen/players/prospects/2017/playerProspects.json', captured_at: '2017-05-26T02:58:27Z' },
  'f2017/pp17-m-20180831.json': { url: 'https://web.archive.org/web/20180831004436id_/http://m.mlb.com/gen/players/prospects/2017/playerProspects.json',
    original: 'http://m.mlb.com/gen/players/prospects/2017/playerProspects.json', captured_at: '2018-08-31T00:44:36Z' },
  'f2018/pp18-www-20180524.json': { url: 'https://web.archive.org/web/20180524100539id_/http://www.mlb.com/gen/players/prospects/2018/playerProspects.json',
    original: 'http://www.mlb.com/gen/players/prospects/2018/playerProspects.json', captured_at: '2018-05-24T10:05:39Z' },
  'f2018/pp18-www-20180616.json': { url: 'https://web.archive.org/web/20180616081217id_/http://www.mlb.com:80/gen/players/prospects/2018/playerProspects.json',
    original: 'http://www.mlb.com/gen/players/prospects/2018/playerProspects.json', captured_at: '2018-06-16T08:12:17Z' },
  'f2018/pp18-m-20190430.json': { url: 'https://web.archive.org/web/20190430161634id_/http://m.mlb.com/gen/players/prospects/2018/playerProspects.json',
    original: 'http://m.mlb.com/gen/players/prospects/2018/playerProspects.json', captured_at: '2019-04-30T16:16:34Z' },
}
const captures = {}
for (const [file, meta] of Object.entries(CAPTURES)) {
  const buf = fs.readFileSync(path.join(RAW, file))
  const doc = JSON.parse(buf.toString('utf8'))
  captures[file] = { ...meta, file, sha256: sha256(buf), cdx_digest: sha1b32(buf), bytes: buf.length, year: Number(doc.year), last_updated: doc.last_updated,
    int: doc.prospect_players.int }
}
// Both cohorts are the list as published BEFORE the class's signing period opened (2 July), like 2015 in 050. The club each player signed with is
// read from the final revision of the same feed; the official transaction log decides the signing club and date.
const COHORTS = [
  { class_year: 2017, list: 'f2017/pp17-www-20170526.json', teams: 'f2017/pp17-m-20180831.json', corroborating: [], window: ['2017-06-01', '2018-06-30'],
    basis: 'PRE_SIGNING_LIST', note: 'Published before the 2017-18 international signing period opened on 2 July 2017 (feed last_updated 2017-05-25); no club is named. Clubs are read from the final revision of the same list (last_updated 2018-08-29), which names the club each listed player signed with; the official MLB transaction log decides the signing club and date.' },
  { class_year: 2018, list: 'f2018/pp18-www-20180524.json', teams: 'f2018/pp18-m-20190430.json', corroborating: ['f2018/pp18-www-20180616.json'], window: ['2018-06-01', '2019-06-30'],
    basis: 'PRE_SIGNING_LIST', note: 'Published before the 2018-19 international signing period opened on 2 July 2018 (feed last_updated 2018-05-23; a second pre-signing capture, last_updated 2018-06-16, carries the identical list). No club is named. Clubs are read from the final revision of the same list (last_updated 2019-04-17); intermediate revisions named different clubs for some players, so the official MLB transaction log decides the signing club and date.' },
]
// the feed's team codes and the Stats API abbreviations, as DISI's organizations spell them (DISI writes San Francisco SFG)
const PIPE_TEAM = { LA: 'LAD', WAS: 'WSH', ANA: 'LAA', SF: 'SFG' }
const pipeTeam = (code) => (code ? PIPE_TEAM[code] ?? code : null)
const fullName = (r) => `${r.player_first_name} ${r.player_last_name}`.replace(/\s+/g, ' ').trim()
const tuples = (L) => JSON.stringify([...L].map((r) => [Number(r.rank), r.player_first_name, r.player_last_name, r.position, r.player_id]).sort((a, b) => a[0] - b[0]))

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 2. Cached official MLB Stats API reads
// ---------------------------------------------------------------------------------------------------------------------------------------------
async function cached(key, url) {
  const file = path.join(CACHE, key.replace(/[^A-Za-z0-9_.-]/g, '_') + '.json')
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  const wiki = url.startsWith('https://en.wikipedia.org/')
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { headers: { 'user-agent': 'DISI-research/055 (https://github.com/seantsck/DISI; public data, low volume)' } })
    if (r.ok || r.status === 404) {
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
const teams = (await cached('teams-2018', `${API}/teams?sportId=1&season=2018`)).teams
const DISI_ABBR = { AZ: 'ARI', ATH: 'OAK', SF: 'SFG' }
const teamAbbr = new Map(teams.map((t) => [t.id, DISI_ABBR[t.abbreviation] ?? t.abbreviation]))
if (teams.length !== 30) throw new Error(`expected 30 MLB clubs in 2018, found ${teams.length}`)

/** Every official signing transaction by each club inside a window (isSigning: SFA, or SGN for some international amateurs). */
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
// 3. Chadwick register: identifier crosswalk, an independent birth date and a recorded death (identity and censoring only, never outcome)
// ---------------------------------------------------------------------------------------------------------------------------------------------
const ymd = (y, m, d) => (y && m && d ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null)
const register = new Map()
const registerFiles = fs.readdirSync(REGISTER).filter((x) => /^people-[0-9a-f]\.csv$/.test(x)).sort()
for (const f of registerFiles) {
  const lines = fs.readFileSync(path.join(REGISTER, f), 'utf8').split('\n')
  const h = Object.fromEntries(lines[0].split(',').map((c, i) => [c, i]))
  for (const l of lines.slice(1)) {
    const c = l.split(',')
    const mlbam = c[h.key_mlbam]
    if (!mlbam) continue
    register.set(mlbam, { bbref: c[h.key_bbref] || null, bbref_minors: c[h.key_bbref_minors] || null, birth: ymd(c[h.birth_year], c[h.birth_month], c[h.birth_day]),
      death: ymd(c[h.death_year], c[h.death_month], c[h.death_day]), death_year: c[h.death_year] || null })
  }
}
const registerSha = sha256(Buffer.concat(registerFiles.map((f) => fs.readFileSync(path.join(REGISTER, f)))))

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 4. Route of Cuban signees (prior professional play), corroborated only (the 050 function)
// ---------------------------------------------------------------------------------------------------------------------------------------------
async function cubanRoute(p, signingYear) {
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
  if (list.year !== c.class_year || teamsCap.year !== c.class_year) throw new Error(`${c.class_year}: a capture is for another class year`)
  const ranks = list.int.map((r) => Number(r.rank)).sort((a, b) => a - b)
  if (JSON.stringify(ranks) !== JSON.stringify(Array.from({ length: 30 }, (_, i) => i + 1))) throw new Error(`${c.class_year}: the cohort list is not ranks 1-30`)
  if (list.int.some((r) => r.team_file_code)) throw new Error(`${c.class_year}: the pre-signing list names a club`)
  for (const f of c.corroborating) if (tuples(captures[f].int) !== tuples(list.int)) throw new Error(`${c.class_year}: the corroborating capture ${f} differs`)
  const teamBySlug = new Map(teamsCap.int.map((r) => [r.player_id, pipeTeam(r.team_file_code || null)]))
  const sign = await signingsInWindow(c.window)
  const members = [...list.int].sort((a, b) => Number(a.rank) - Number(b.rank)).map((r) => ({
    cohort: `MLB-${c.class_year}-PIPELINE-TOP30`, class_year: c.class_year, rank: Number(r.rank), pipeline_slug: String(r.player_id),
    published_first_name: r.player_first_name, published_last_name: r.player_last_name, published_name: fullName(r),
    published_position: r.position, list_club: teamBySlug.get(r.player_id) ?? null,
  }))
  const cap = (x) => ({ url: x.url, original_url: x.original, captured_at: x.captured_at, sha256: x.sha256, cdx_digest: x.cdx_digest, bytes: x.bytes, last_updated: x.last_updated, list_path: 'prospect_players.int' })
  cohorts.push({
    population_key: `MLB-${c.class_year}-PIPELINE-TOP30`, class_year: c.class_year, list_basis: c.basis, note: c.note,
    list_capture: cap(list), club_capture: cap(teamsCap), corroborating_captures: c.corroborating.map((f) => cap(captures[f])),
    signing_window: c.window, list_size: members.length,
    members: members.map(({ cohort, class_year, ...m }) => m),
  })
  for (const m of members) identity.push(await resolve(m, sign, c.window))
}
// the final revision of each list, recorded for the audit trail (never the cohort): re-rankings, additions, drops
const revisions = COHORTS.map((c) => {
  const A = captures[c.list], B = captures[c.teams]
  const as = new Set(A.int.map((r) => r.player_id)), bs = new Set(B.int.map((r) => r.player_id))
  return { class_year: A.year, cohort_capture: A.url, revision_capture: B.url, revision_last_updated: B.last_updated, revision_sha256: B.sha256,
    added_in_revision: B.int.filter((r) => !as.has(r.player_id)).map((r) => ({ rank: Number(r.rank), name: fullName(r), position: r.position, club: pipeTeam(r.team_file_code || null) })),
    dropped_in_revision: A.int.filter((r) => !bs.has(r.player_id)).map((r) => ({ rank: Number(r.rank), name: fullName(r), position: r.position })),
    members_without_revision_club: A.int.filter((r) => !bs.has(r.player_id) || !B.int.find((x) => x.player_id === r.player_id)?.team_file_code).map((r) => fullName(r)) }
})

// route evidence for Cuban signees, and outcome facts (and a recorded death) for every resolved player
const outcomes = []
for (const r of identity.filter((x) => x.result === 'RESOLVED')) {
  const rec = await person(r.mlb_id)
  if (r.birth_country === 'Cuba') r.route_evidence = await cubanRoute(rec, Number(r.signing.date.slice(0, 4)))
  const stats = await careerStats(r.mlb_id)
  const hit = (stats.stats ?? []).find((s) => s.group?.displayName === 'hitting')?.splits?.[0]?.stat
  const pit = (stats.stats ?? []).find((s) => s.group?.displayName === 'pitching')?.splits?.[0]?.stat
  const debut = rec.mlbDebutDate ?? null
  const tx = await playerTransactions(r.mlb_id)
  const reg = register.get(String(r.mlb_id)) ?? null
  outcomes.push({
    cohort: r.cohort, published_name: r.published_name, mlb_id: r.mlb_id,
    person_url: `${API}/people/${r.mlb_id}`, stats_url: `${API}/people/${r.mlb_id}/stats?stats=career&group=hitting,pitching&gameType=R`,
    transactions_url: `${API}/transactions?playerId=${r.mlb_id}`,
    mlb_debut_date: debut && debut <= AUDIT_THROUGH ? debut : null,
    mlb_debut_date_after_boundary: debut && debut > AUDIT_THROUGH ? debut : null,
    active: rec.active ?? null,
    death_date: rec.deathDate ?? null,
    register_death_date: reg?.death ?? null,
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
  generated_by: 'database/research/055/derive-research.mjs', retrieved_at: retrieved,
  source_family: 'MLB Pipeline (MLB.com) international Top 30 prospect list: the official data feed /gen/players/prospects/<year>/playerProspects.json, list "int", read through archived captures (www.mlb.com answers 403 to direct reads)',
  cohorts, later_revisions: revisions,
})
write('identity-research.json', {
  generated_by: 'database/research/055/derive-research.mjs', retrieved_at: retrieved,
  method: 'The 050 rule, unchanged (database/research/050/identity-rules.mjs): an entry is RESOLVED only when exactly one person the official MLB transaction log shows signing (typeCode SFA, or SGN for some international amateurs) inside the class window matches the published name, the club agrees with the list (when it names one), the birth year fits the class, the position family agrees, and the register birth date (when held) equals the MLB person record. A spelling variant alone is never enough without the list naming the same club. Otherwise CONFLICT or INSUFFICIENT_EVIDENCE.',
  register: { url: 'https://github.com/chadwickbureau/register', files: registerFiles, sha256: registerSha },
  entries: identity,
})
write('outcome-research.json', { generated_by: 'database/research/055/derive-research.mjs', retrieved_at: retrieved, audit_through_date: AUDIT_THROUGH, players: outcomes })
const tally = (xs) => xs.reduce((m, x) => ((m[x.result] = (m[x.result] ?? 0) + 1), m), {})
console.log(JSON.stringify({ by_cohort: Object.fromEntries(['MLB-2017-PIPELINE-TOP30', 'MLB-2018-PIPELINE-TOP30'].map((k) => [k, tally(identity.filter((x) => x.cohort === k))])),
  reached: outcomes.filter((o) => o.mlb_debut_date).length, deaths: outcomes.filter((o) => o.death_date || o.register_death_date).map((o) => [o.published_name, o.death_date, o.register_death_date]) }, null, 1))
