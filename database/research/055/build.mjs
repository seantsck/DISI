#!/usr/bin/env node
// Assembles database/sql/055_international_benchmark_2017_2018.sql and database/release/sql/rollback-055.sql from:
//   055_template.sql / rollback_template.sql   hand-written guards, steps, proofs and postconditions
//   source-cohorts.json, identity-research.json, outcome-research.json   the directly read research (derive-research.mjs)
//   evaluation.json                            the deterministic re-run of the 041 out-of-time evaluation on the 055 data (evaluate.mjs)
//   baseline.json                              the pre-055 state the migration proves before it writes (measure.mjs --baseline)
//
//   node database/research/055/evaluate.mjs && node database/research/055/build.mjs
//
// The 050 method, unchanged, for two more mature classes: the same decisions, sources, rows and conventions (database/research/050/build.mjs).
// What 050 did once is not repeated: the legacy 035 identities and the two function fixes (BENCHMARK SUPPORT != DODGERS SUPPORT is already the
// live rule). Deterministic: the same inputs always produce the same files. The build refuses anything the research rules do not allow.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8').replace(/\r\n/g, '\n')
const json = (f) => JSON.parse(read(f))
const need = (cond, msg) => { if (!cond) throw new Error(msg) }

const cohorts = json('source-cohorts.json')
const identity = json('identity-research.json')
const outcomes = json('outcome-research.json')
const baseline = json('baseline.json')
const AUDIT = outcomes.audit_through_date
need(AUDIT === '2026-10-05', 'the audit boundary is the unchanged DISI analysis date (2026-10-05); it is never moved to the wall clock')
const outcomeById = new Map(outcomes.players.map((o) => [o.mlb_id, o]))

// ---- the Dodgers signings a ranked prospect maps to (never duplicated, never written) ---------------------------------------------------
// RANKING APPEARANCE != NEW SIGNING. Each keeps its one Dodgers signing byte for byte, including the MLB Pipeline rank it already carries (Cartaya
// 1) or does not carry (Rosario NULL). The rank observed in this edition is kept in cohort-decisions.json only: it is not written to the Dodgers
// signing and no evaluation row is created for a Dodgers player. BENCHMARK SUPPORT != DODGERS SUPPORT.
export const DODGERS_MAPPED = {
  '682616': { slug: 'diego-cartaya', stored_international_rank: 1 },
  '682645': { slug: 'jerming-rosario', stored_international_rank: null },
}
const LATIN_MARKETS = new Set(['Dominican Republic', 'Venezuela', 'Panama', 'Colombia', 'Mexico', 'Nicaragua', 'Curacao', 'Aruba', 'Puerto Rico', 'Cuba'])
const COUNTRY = { USA: 'United States' }
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const ascii = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

const PUBLICATION = 'mlb-pipeline-top-30-international-signings'
const listUrl = Object.fromEntries(cohorts.cohorts.map((c) => [c.population_key, c.list_capture.url]))
const listDate = Object.fromEntries(cohorts.cohorts.map((c) => [c.population_key, c.list_capture.last_updated.slice(0, 10)]))
const clubUrl = Object.fromEntries(cohorts.cohorts.map((c) => [c.population_key, c.club_capture.url]))
const personUrl = (id) => `https://statsapi.mlb.com/api/v1/people/${id}`
const txUrl = (id) => `https://statsapi.mlb.com/api/v1/transactions?playerId=${id}`
const REGISTER_URL = 'https://github.com/chadwickbureau/register'

const auditOf = (o, resolvedNote) => {
  const reached = Boolean(o.mlb_debut_date)
  need(!o.mlb_debut_date_after_boundary || !reached, `${o.published_name}: a debut after the boundary is not a reach at the boundary`)
  return {
    reached,
    outcome_state: reached ? 'REACHED_MLB' : o.active ? 'NO_MLB_ACTIVE_IN_MINORS' : 'NO_MLB_STATUS_UNKNOWN',
    confidence: reached ? 'VERIFIED' : 'MEDIUM',
    supports: reached ? ['MLB_REACH', 'MLB_DEBUT_DATE', 'ACTIVE_STATUS'] : ['MLB_REACH', 'ACTIVE_STATUS'],
    audit_note: reached
      ? `Reached MLB: MLB debut ${o.mlb_debut_date} in the official MLB Stats API person record (retrieved ${outcomes.retrieved_at}); ${resolvedNote}`
      : `No MLB debut in the official MLB Stats API person record through ${AUDIT} (retrieved ${outcomes.retrieved_at}); this is the absence of a recorded debut, not proof of a career end. ${resolvedNote}`,
    evidence_note: `MLB Stats API person record and regular-season career statistics, retrieved ${outcomes.retrieved_at}.`,
  }
}
const outcomeRow = (o) => (o.mlb_debut_date ? {
  debut: o.mlb_debut_date, games: o.mlb_games ?? null, pa: o.mlb_pa ?? null, ip: o.mlb_ip != null ? String(o.mlb_ip) : null,
  // MISSING BWAR != ZERO BWAR: no Baseball-Reference team-season row exists for this player (the data files answer 403), so career bWAR is NULL
  current_status: `${o.active ? 'Active' : 'Not active'} per the MLB person record through ${AUDIT}`,
} : null)

// ---- every list member: one decision ------------------------------------------------------------------------------------------------
const entries = identity.entries
/** @type {any[]} */
const decisions = []
/** @type {any[]} */
const newPlayers = []
/** @type {any[]} */
const dodgersMapped = []
for (const c of cohorts.cohorts) {
  need(c.list_size === 30 && c.members.length === 30, `${c.population_key}: the list has 30 members`)
  need(JSON.stringify(c.members.map((m) => m.rank).sort((a, b) => a - b)) === JSON.stringify(Array.from({ length: 30 }, (_, i) => i + 1)), `${c.population_key}: ranks 1-30 exactly once`)
  for (const m of c.members) {
    const e = entries.find((x) => x.cohort === c.population_key && x.pipeline_slug === m.pipeline_slug)
    need(e, `${m.published_name}: no identity decision`)
    const base = { population_key: c.population_key, rank: m.rank, published_name: m.published_name, published_position: m.published_position, list_club: m.list_club }
    if (e.result !== 'RESOLVED') {
      decisions.push({ ...base, decision: e.result === 'CONFLICT' ? 'IDENTITY_CONFLICT' : 'IDENTITY_INSUFFICIENT_EVIDENCE', reason: e.reason,
        candidates_considered: e.candidates_considered, human_review: true })
      continue
    }
    need(e.name_match !== 'VARIANT' || (e.list_club && e.list_club === e.signing.club), `${m.published_name}: a spelling variant is accepted only with the list's own club`)
    if (DODGERS_MAPPED[e.mlb_id]) {
      need(e.signing.club === 'LAD', `${m.published_name}: mapped to a Dodgers signing but signed with ${e.signing.club}`)
      const d = DODGERS_MAPPED[e.mlb_id]
      dodgersMapped.push({ mlb_id: e.mlb_id, slug: d.slug, stored_international_rank: d.stored_international_rank, observed_rank: m.rank, population_key: c.population_key })
      decisions.push({ ...base, decision: 'MAPPED_TO_EXISTING_DODGERS_SIGNING', mlb_id: e.mlb_id, slug: d.slug, observed_rank_in_this_edition: m.rank,
        stored_dodgers_international_rank: d.stored_international_rank,
        reason: `The Dodgers signing is already tracked (TRACKED_DODGERS). Its MLB Pipeline international rank stays exactly as stored (${d.stored_international_rank === null ? 'NULL' : d.stored_international_rank}); this edition's rank ${m.rank} is recorded here only. No benchmark signing, player or evaluation is created and no Dodgers row changes.` })
      continue
    }
    need(e.signing.club !== 'LAD', `${m.published_name}: a Dodgers signing must map to an existing tracked row`)
    const o = outcomeById.get(e.mlb_id)
    need(o, `${m.published_name}: no outcome facts`)
    // A player who died before his outcome window could run is not a negative outcome and not a comparable observation of prospect development.
    // He is a verified signing that is not added (like a Cuban signing whose route is unknown): no audit, no label, recorded in the composition.
    if (o.death_date || o.register_death_date) {
      const died = o.death_date ?? o.register_death_date
      need(died < `${Number(e.signing.date.slice(0, 4)) + 7}-10-01`, `${m.published_name}: a death after the reach horizon would not censor the label`)
      decisions.push({ ...base, decision: 'DECEASED_BEFORE_OUTCOME_HORIZON', mlb_id: e.mlb_id, signing_club: e.signing.club, signing_date: e.signing.date, death_date: died,
        death_source: o.death_date ? personUrl(e.mlb_id) : REGISTER_URL,
        reason: `Identity and signing verified (${e.signing.club}, ${e.signing.date}), but the official MLB person record states his death on ${died}, before his 7-season reach window could run. NO MLB DEBUT != NEGATIVE OUTCOME: not reaching MLB here is not a prospect outcome, so no benchmark signing, audit or label is created (a FALSE label would be a false negative). Recorded in the population composition and queued, never counted as a non-reacher.` })
      continue
    }
    const country = COUNTRY[e.birth_country] ?? e.birth_country
    const cuban = e.birth_country === 'Cuba'
    const route = cuban ? e.route_evidence?.route ?? null : null
    if (cuban && !route) {
      decisions.push({ ...base, decision: 'ROUTE_NOT_ESTABLISHED', mlb_id: e.mlb_id, signing_club: e.signing.club, signing_date: e.signing.date,
        reason: 'A Cuban signee whose prior professional play (and so his signing route) no readable source states. The signing is verified, but it is not added: an unknown route is never guessed amateur or professional.' })
      continue
    }
    need(!cuban, `${m.published_name}: a Cuban route was established; review the route source before adding it`)
    const pathway = LATIN_MARKETS.has(country) ? 'LATAM_AMATEUR' : 'OTHER'
    const market = LATIN_MARKETS.has(country) ? country : null
    const year = Number(e.signing.date.slice(0, 4))
    need(year === c.class_year || year === c.class_year + 1, `${m.published_name}: the signing year ${year} is outside the class signing period`)
    const fullName = e.mlb_name
    const slug = slugify(fullName)
    const evaluation = { evaluation_date: listDate[c.population_key], rank: m.rank, list_size: c.list_size, list_url: listUrl[c.population_key],
      scope_label: `${c.class_year} MLB Pipeline Top 30 international prospects`, basis: c.list_basis,
      note: `Rank ${m.rank} of 30 in the ${c.class_year} MLB Pipeline international list as the official feed published it before the signing period opened (feed updated ${listDate[c.population_key]}). A point-in-time scouting observation, not an outcome or a probability.` }
    newPlayers.push({
      slug, full_name: fullName, canonical_name: ascii(fullName), mlb_id: e.mlb_id, birth_date: e.birth_date, birth_country: country,
      primary_position: e.mlb_primary_position, bref_id: o.mlb_debut_date ? e.register_bbref_id : null, mlb_debut_date: o.mlb_debut_date,
      alias: fullName !== m.published_name ? m.published_name : null,
      population_key: c.population_key, list_url: listUrl[c.population_key], club_url: clubUrl[c.population_key],
      person_url: personUrl(e.mlb_id), transactions_url: txUrl(e.mlb_id),
      signing: {
        org: e.signing.club, date: e.signing.date, year, country_market: market, pathway, position_at_signing: m.published_position, rank: m.rank,
        description: e.signing.description,
        notes: `MLB Pipeline ${c.class_year} international Top 30, rank ${m.rank} (pre-signing list). Signing from the official MLB transaction log: ${e.signing.date}, "${e.signing.description}"${(e.other_signings_in_window ?? []).length ? '; a later signing in the same period is recorded in the research file' : ''}. Identity: ${e.signals.join('; ')}.`,
        route: null,
      },
      evaluation,
      audit: auditOf(o, `identity from the official signing transaction (${e.signing.club}, ${e.signing.date}) and the person record.`),
      outcome: outcomeRow(o),
    })
    decisions.push({ ...base, decision: 'BENCHMARK_SIGNING_ADDED', mlb_id: e.mlb_id, slug, signing_club: e.signing.club, signing_date: e.signing.date, signing_year: year, pathway,
      reached_mlb: Boolean(o.mlb_debut_date), mlb_debut_date: o.mlb_debut_date })
  }
}
need(new Set(newPlayers.map((p) => p.slug)).size === newPlayers.length, 'duplicate slug among new players')
need(new Set(newPlayers.map((p) => p.mlb_id)).size === newPlayers.length, 'one player identity per person: a person ranked twice is one player')
need(dodgersMapped.length === Object.keys(DODGERS_MAPPED).length, 'every Dodgers-mapped prospect is on a list')

// ---- sources -----------------------------------------------------------------------------------------------------------------------
const sources = []
const addSource = (s) => { if (!sources.some((x) => x.url === s.url)) sources.push(s) }
for (const c of cohorts.cohorts) {
  const capNote = (x) => `archived ${x.captured_at} from ${x.original_url}, list path ${x.list_path}, SHA-256 ${x.sha256}, Internet Archive digest ${x.cdx_digest}`
  addSource({ url: c.list_capture.url, source_name: 'MLB Pipeline (MLB.com)', source_type: 'INTERNATIONAL_TRACKER', source_tier: 'MLB_PIPELINE', publication_date: c.list_capture.last_updated.slice(0, 10),
    title: `${c.class_year} MLB Pipeline Top 30 international prospects (official data feed, archived; updated ${c.list_capture.last_updated.slice(0, 10)})`,
    notes: `The official MLB Pipeline prospect data feed, read directly (${capNote(c.list_capture)}); mlb.com answers 403 to direct reads. ${c.note}` })
  addSource({ url: c.club_capture.url, source_name: 'MLB Pipeline (MLB.com)', source_type: 'INTERNATIONAL_TRACKER', source_tier: 'MLB_PIPELINE', publication_date: c.club_capture.last_updated.slice(0, 10),
    title: `${c.class_year} MLB Pipeline Top 30 international prospects, club assignments (official data feed, archived; updated ${c.club_capture.last_updated.slice(0, 10)})`,
    notes: `The same official feed after the period (${capNote(c.club_capture)}), read for the club each listed player signed with; its own ranking is a later revision and is not used as the cohort. The official MLB transaction log decides the signing club.` })
  for (const x of c.corroborating_captures) addSource({ url: x.url, source_name: 'MLB Pipeline (MLB.com)', source_type: 'INTERNATIONAL_TRACKER', source_tier: 'MLB_PIPELINE',
    publication_date: x.last_updated.slice(0, 10), title: `${c.class_year} MLB Pipeline Top 30 international prospects (official data feed, archived; updated ${x.last_updated.slice(0, 10)})`,
    notes: `A second pre-signing capture of the same official feed (${capNote(x)}); its rank, name and position for every member are identical to the cohort capture.` })
}
for (const p of newPlayers) {
  addSource({ url: p.person_url, source_name: 'MLB Stats API', source_type: 'MLB_PLAYER_RECORD', source_tier: 'MILB_MLB_PLAYER_RECORD', title: `MLB person record: player ${p.mlb_id}`,
    notes: 'Official MLB person record and regular-season career statistics.' })
  addSource({ url: p.transactions_url, source_name: 'MLB Stats API', source_type: 'MLB_PLAYER_TRANSACTIONS', source_tier: 'MLB_TRANSACTION_LOG', title: `MLB Stats API: transaction log (player ${p.mlb_id})`,
    notes: 'Official MLB transaction log: the signing transaction (club and date) used for identity and the signing record.' })
}
sources.sort((a, b) => a.url.localeCompare(b.url))

// ---- populations -------------------------------------------------------------------------------------------------------------------
const populations = cohorts.cohorts.map((c) => {
  const d = decisions.filter((x) => x.population_key === c.population_key)
  const by = (k) => d.filter((x) => x.decision === k).map((x) => ({ rank: x.rank, name: x.published_name, ...(x.mlb_id ? { mlb_id: x.mlb_id } : {}) }))
  return {
    population_key: c.population_key, class_year: c.class_year, period_label: `${c.class_year} MLB Pipeline Top 30`, expected_size: c.list_size, source_url: c.list_capture.url,
    notes: `League-wide prospect sample, not a census: the ${c.class_year} MLB Pipeline international Top 30 (pre-signing list). Members are the listed players with a verified non-Dodgers signing; a listed Dodgers signing stays a Dodgers record; the rest are queued.`,
    stated_composition: {
      list_members: c.list_size, list_basis: c.list_basis, benchmark_signings: by('BENCHMARK_SIGNING_ADDED').length,
      dodgers_signings_mapped: by('MAPPED_TO_EXISTING_DODGERS_SIGNING'), identity_unresolved: by('IDENTITY_INSUFFICIENT_EVIDENCE'), identity_conflicts: by('IDENTITY_CONFLICT'),
      route_not_established: by('ROUTE_NOT_ESTABLISHED'), deceased_before_outcome_horizon: by('DECEASED_BEFORE_OUTCOME_HORIZON'),
    },
  }
})
for (const p of populations) {
  const s = p.stated_composition
  need(s.benchmark_signings + s.dodgers_signings_mapped.length + s.identity_unresolved.length + s.identity_conflicts.length + s.route_not_established.length
    + s.deceased_before_outcome_horizon.length === 30, `${p.population_key}: every one of the 30 members has exactly one decision`)
}

// ---- payload -----------------------------------------------------------------------------------------------------------------------
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const enc = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))

/** The migration SQL; `evaluation` null builds it without the evaluation update (evaluate.mjs computes the evaluation on that data). */
export function assemble(evaluation) {
  const payload = sortKeys({
    audit_through_date: AUDIT, outcome_through_season: Number(AUDIT.slice(0, 4)), retrieved_at: `${outcomes.retrieved_at}T00:00:00Z`,
    publication_slug: PUBLICATION, register_url: REGISTER_URL,
    sources, populations, new_players: newPlayers, dodgers_mapped: dodgersMapped,
    baseline: { counts: baseline.counts, evaluation: baseline.evaluation, catalog: { tables: baseline.counts.tables, views: baseline.counts.views } },
    evaluation: evaluation ? evaluation.evaluations : null,
  })
  const text = enc(payload)
  for (const tag of ['$m055$', '$r055$']) need(!text.includes(tag), `payload contains the dollar-quote tag ${tag}`)
  const sql = read('055_template.sql').split('{{payload_json}}').join(text)
  need(!/\{\{\w+\}\}/.test(sql), 'unreplaced placeholder')
  return sql
}
export function assembleRollback() {
  const evaluation050 = JSON.parse(fs.readFileSync(path.join(here, '../050/evaluation.json'), 'utf8')).evaluations
  need(evaluation050.every((x) => x.training_fingerprint === baseline.evaluation[0].training_fingerprint), 'the stored evaluation before 055 is the 050 one')
  const payload = sortKeys({ new_players: newPlayers.map((p) => ({ slug: p.slug, mlb_id: p.mlb_id })), dodgers_mapped: dodgersMapped,
    populations: populations.map((p) => p.population_key), publication_slug: PUBLICATION, baseline: { counts: baseline.counts, evaluation: baseline.evaluation },
    // the rows 050 stored, exactly (its committed evaluation.json is what the 050 migration wrote, unchanged through 054a)
    evaluation_050: evaluation050 })
  const text = enc(payload)
  const sql = read('rollback_template.sql').split('{{payload_json}}').join(text)
  need(!/\{\{\w+\}\}/.test(sql), 'unreplaced rollback placeholder')
  return sql
}
export const research = { decisions, newPlayers, dodgersMapped, populations, sources }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evaluation = json('evaluation.json')
  need(!evaluation.failures?.length, `the evaluation has failures: ${evaluation.failures?.join('; ')}`)
  const dest = path.join(root, 'database/sql/055_international_benchmark_2017_2018.sql')
  fs.writeFileSync(dest, assemble(evaluation))
  const rdest = path.join(root, 'database/release/sql/rollback-055.sql')
  fs.writeFileSync(rdest, assembleRollback())
  fs.writeFileSync(path.join(here, 'cohort-decisions.json'), JSON.stringify(sortKeys({ generated_by: 'database/research/055/build.mjs', list_members: decisions }), null, 1) + '\n')
  process.stderr.write(`wrote ${path.relative(process.cwd(), dest)}, ${path.relative(process.cwd(), rdest)}: ${newPlayers.length} benchmark signings, ${dodgersMapped.length} Dodgers mapped\n`)
}
