#!/usr/bin/env node
// Assembles database/sql/050_international_benchmark_support_expansion.sql and database/release/sql/rollback-050.sql from:
//   050_template.sql / rollback_template.sql   hand-written guards, steps, proofs and postconditions
//   source-cohorts.json, identity-research.json, outcome-research.json   the directly read research (derive-research.mjs)
//   evaluation.json                            the deterministic re-run of the 041 out-of-time evaluation on the 050 data (evaluate.mjs)
//   baseline.json                              the pre-050 state the migration proves before it writes (measure.mjs --baseline)
//
//   node database/research/050/evaluate.mjs && node database/research/050/build.mjs
//
// Deterministic: the same inputs always produce the same files. The build refuses anything the research rules do not allow. evaluate.mjs
// imports assemble() to build the same migration WITHOUT the evaluation update, so the evaluation is computed on exactly the 050 data.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8').replace(/\r\n/g, '\n')
const json = (f) => JSON.parse(read(f))
const need = (cond, msg) => { if (!cond) throw new Error(msg) }
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')

const cohorts = json('source-cohorts.json')
const identity = json('identity-research.json')
const outcomes = json('outcome-research.json')
const baseline = json('baseline.json')
const AUDIT = outcomes.audit_through_date
need(AUDIT === '2026-10-05', 'the audit boundary is the unchanged DISI analysis date (2026-10-05); it is never moved to the wall clock')
const outcomeById = new Map(outcomes.players.map((o) => [o.mlb_id, o]))

// ---- the population DISI tracks, and the existing Dodgers signings a ranked prospect maps to (never duplicated) ----------------------------
// RANKING APPEARANCE != NEW SIGNING: a listed player the Dodgers signed keeps his one Dodgers signing and gains the point-in-time ranking.
const DODGERS_MAPPED = { '665752': 'starling-heredia', '665798': 'ronny-brito' }
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
const decisions = []
const newPlayers = []
const dodgersEvaluations = []
const routeSources = []
for (const c of cohorts.cohorts) {
  for (const m of c.members) {
    const e = entries.find((x) => x.cohort === c.population_key && x.pipeline_slug === m.pipeline_slug)
    need(e, `${m.published_name}: no identity decision`)
    const base = { population_key: c.population_key, rank: m.rank, published_name: m.published_name, published_position: m.published_position, list_club: m.list_club }
    if (e.result !== 'RESOLVED') { decisions.push({ ...base, decision: e.result === 'CONFLICT' ? 'IDENTITY_CONFLICT' : 'IDENTITY_INSUFFICIENT_EVIDENCE', reason: e.reason }); continue }
    need(e.name_match !== 'VARIANT' || (e.list_club && e.list_club === e.signing.club), `${m.published_name}: a spelling variant is accepted only with the list's own club`)
    const evaluation = { evaluation_date: listDate[c.population_key], rank: m.rank, list_size: c.list_size, list_url: listUrl[c.population_key],
      scope_label: `${c.class_year} MLB Pipeline Top 30 international prospects`,
      basis: c.list_basis,
      note: c.list_basis === 'PRE_SIGNING_LIST'
        ? `Rank ${m.rank} of 30 in the ${c.class_year} MLB Pipeline international list as the official feed published it before the signing period opened (feed updated ${listDate[c.population_key]}). A point-in-time scouting observation, not an outcome or a probability.`
        : `Rank ${m.rank} of 30 in the ${c.class_year} MLB Pipeline international list as the official feed carried it during the signing period (feed updated ${listDate[c.population_key]}, after this signing). A point-in-time scouting observation, not an outcome or a probability.` }
    if (DODGERS_MAPPED[e.mlb_id]) {
      // The Dodgers signing already carries an MLB Pipeline international rank (signings.international_rank, a different edition of the list
      // than this pre-signing feed: 5 and 21 against 3 and 18). The rank is therefore already represented; recording a second, differing
      // edition as an evaluation would put two MLB Pipeline ranks on one signing, which the 026 legacy-rank rule refuses, and the edition the
      // stored value comes from cannot be read today. The observed rank is kept here, the Dodgers rows are not touched.
      need(e.signing.club === 'LAD', `${m.published_name}: mapped to a Dodgers signing but signed with ${e.signing.club}`)
      decisions.push({ ...base, decision: 'MAPPED_TO_EXISTING_DODGERS_SIGNING', mlb_id: e.mlb_id, slug: DODGERS_MAPPED[e.mlb_id], observed_rank_in_this_edition: m.rank,
        reason: 'The Dodgers signing is already tracked (TRACKED_DODGERS) and already carries an MLB Pipeline international rank from another edition of the list. No benchmark signing, player or evaluation is created; the Dodgers population class is unchanged.' })
      continue
    }
    need(e.signing.club !== 'LAD', `${m.published_name}: a Dodgers signing must map to an existing tracked row`)
    const country = COUNTRY[e.birth_country] ?? e.birth_country
    const cuban = e.birth_country === 'Cuba'
    const route = cuban ? e.route_evidence?.route ?? null : null
    if (cuban && !route) {
      decisions.push({ ...base, decision: 'ROUTE_NOT_ESTABLISHED', mlb_id: e.mlb_id, reason: 'A Cuban signee whose prior professional play (and so his signing route) no readable source states. The signing is verified, but it is not added: an unknown route is never guessed amateur or professional.' })
      continue
    }
    const pathway = cuban ? route : LATIN_MARKETS.has(country) ? 'LATAM_AMATEUR' : 'OTHER'
    const market = LATIN_MARKETS.has(country) ? country : null
    const o = outcomeById.get(e.mlb_id)
    need(o, `${m.published_name}: no outcome facts`)
    const year = Number(e.signing.date.slice(0, 4))
    need(year === c.class_year || year === c.class_year + 1, `${m.published_name}: the signing year ${year} is outside the class signing period`)
    const fullName = e.mlb_name
    const slug = slugify(fullName)
    if (cuban) {
      const r = e.route_evidence
      if (r.wiki_url) routeSources.push({ url: r.wiki_url, title: `Wikipedia: ${r.wiki_title}` })
    }
    newPlayers.push({
      slug, full_name: fullName, canonical_name: ascii(fullName), mlb_id: e.mlb_id, birth_date: e.birth_date, birth_country: country,
      primary_position: e.mlb_primary_position, bref_id: o.mlb_debut_date ? e.register_bbref_id : null, mlb_debut_date: o.mlb_debut_date,
      alias: fullName !== m.published_name ? m.published_name : null,
      population_key: c.population_key, list_url: listUrl[c.population_key], club_url: clubUrl[c.population_key],
      person_url: personUrl(e.mlb_id), transactions_url: txUrl(e.mlb_id),
      signing: {
        org: e.signing.club, date: e.signing.date, year, country_market: market, pathway, position_at_signing: m.published_position, rank: m.rank,
        description: e.signing.description,
        notes: `MLB Pipeline ${c.class_year} international Top 30, rank ${m.rank} (${c.list_basis === 'PRE_SIGNING_LIST' ? 'pre-signing list' : 'signing-period list'}). Signing from the official MLB transaction log: ${e.signing.date}, "${e.signing.description}"${(e.other_signings_in_window ?? []).length ? `; a later signing in the same period is recorded in the research file` : ''}. Identity: ${e.signals.join('; ')}.`,
        route: cuban ? {
          pathway: route, source_url: e.route_evidence.wiki_url,
          note: `${route === 'CUBAN_PRO' ? 'Prior professional play' : 'No professional play before signing'}: ${[...e.route_evidence.wiki_sentences.map((s) => `"${s}"`), ...e.route_evidence.official_winter_or_caribbean_seasons.map((s) => `official record: ${s.season} ${s.league} (${s.team})`)].join(' ').slice(0, 900)}`,
        } : null,
      },
      evaluation,
      audit: auditOf(o, `identity from the official signing transaction (${e.signing.club}, ${e.signing.date}) and the person record.`),
      outcome: outcomeRow(o),
    })
    decisions.push({ ...base, decision: 'BENCHMARK_SIGNING_ADDED', mlb_id: e.mlb_id, slug, signing_club: e.signing.club, signing_date: e.signing.date, signing_year: year, pathway })
  }
}
need(new Set(newPlayers.map((p) => p.slug)).size === newPlayers.length, 'duplicate slug among new players')
need(new Set(newPlayers.map((p) => p.mlb_id)).size === newPlayers.length, 'one player identity per person: a person ranked twice is one player')

// ---- the five legacy 035 identities -------------------------------------------------------------------------------------------------
const legacy = []
const legacyDecisions = []
for (const e of entries.filter((x) => x.cohort === 'LEGACY_035')) {
  if (e.result !== 'RESOLVED') { legacyDecisions.push({ slug: e.slug, result: e.result, reason: e.reason, candidate: e.candidate_mlb_id ?? null }); continue }
  need(e.list_club === e.signing.club, `${e.slug}: the legacy club must agree`)
  const o = outcomeById.get(e.mlb_id)
  legacy.push({
    slug: e.slug, mlb_id: e.mlb_id, birth_date: e.birth_date, bref_id: o.mlb_debut_date ? e.register_bbref_id : null, mlb_debut_date: o.mlb_debut_date,
    alias: e.mlb_name, person_url: personUrl(e.mlb_id), transactions_url: txUrl(e.mlb_id),
    identity_note: `Identity resolved by Migration 050: ${e.signals.join('; ')}.`,
    audit: auditOf(o, `identity resolved by Migration 050 (official signing transaction ${e.signing.club} ${e.signing.date}; MLB record name ${e.mlb_name}).`),
    outcome: outcomeRow(o),
  })
  legacyDecisions.push({ slug: e.slug, result: 'RESOLVED', mlb_id: e.mlb_id, mlb_name: e.mlb_name, reached: Boolean(o.mlb_debut_date) })
}

// ---- sources -----------------------------------------------------------------------------------------------------------------------
const sources = []
const addSource = (s) => { if (!sources.some((x) => x.url === s.url)) sources.push(s) }
for (const c of cohorts.cohorts) {
  addSource({ url: c.list_capture.url, source_name: 'MLB Pipeline (MLB.com)', source_type: 'INTERNATIONAL_TRACKER', source_tier: 'MLB_PIPELINE', publication_date: c.list_capture.last_updated.slice(0, 10),
    title: `${c.class_year} MLB Pipeline Top 30 international prospects (official data feed, archived; updated ${c.list_capture.last_updated.slice(0, 10)})`,
    notes: `The official MLB Pipeline prospect data feed, list "int", read directly from an archived capture (SHA-256 ${c.list_capture.sha256}); mlb.com answers 403 to direct reads. ${c.note}` })
  addSource({ url: c.club_capture.url, source_name: 'MLB Pipeline (MLB.com)', source_type: 'INTERNATIONAL_TRACKER', source_tier: 'MLB_PIPELINE', publication_date: c.club_capture.last_updated.slice(0, 10),
    title: `${c.class_year} MLB Pipeline Top 30 international prospects, club assignments (official data feed, archived; updated ${c.club_capture.last_updated.slice(0, 10)})`,
    notes: `The same official feed later in the period (SHA-256 ${c.club_capture.sha256}), read for the club each listed player signed with; its own ranking is a later revision and is not used as the cohort.` })
}
for (const p of [...newPlayers, ...legacy]) {
  addSource({ url: p.person_url, source_name: 'MLB Stats API', source_type: 'MLB_PLAYER_RECORD', source_tier: 'MILB_MLB_PLAYER_RECORD', title: `MLB person record: player ${p.mlb_id}`,
    notes: 'Official MLB person record and regular-season career statistics.' })
  addSource({ url: p.transactions_url, source_name: 'MLB Stats API', source_type: 'MLB_PLAYER_TRANSACTIONS', source_tier: 'MLB_TRANSACTION_LOG', title: `MLB Stats API: transaction log (player ${p.mlb_id})`,
    notes: 'Official MLB transaction log: the signing transaction (club and date) used for identity and the signing record.' })
}
for (const r of routeSources) addSource({ url: r.url, source_name: 'Wikipedia', source_type: 'ARTICLE', source_tier: 'OTHER', title: r.title,
  notes: 'Read directly as a corroborating account of prior Cuban National Series play (the signing route only). Never identity, outcome or WAR evidence.' })
sources.sort((a, b) => a.url.localeCompare(b.url))

// ---- populations -------------------------------------------------------------------------------------------------------------------
const populations = cohorts.cohorts.map((c) => {
  const d = decisions.filter((x) => x.population_key === c.population_key)
  const by = (k) => d.filter((x) => x.decision === k).map((x) => ({ rank: x.rank, name: x.published_name, ...(x.mlb_id ? { mlb_id: x.mlb_id } : {}) }))
  return {
    population_key: c.population_key, class_year: c.class_year, period_label: `${c.class_year} MLB Pipeline Top 30`, expected_size: c.list_size, source_url: c.list_capture.url,
    notes: `League-wide prospect sample, not a census: the ${c.class_year} MLB Pipeline international Top 30 (${c.list_basis === 'PRE_SIGNING_LIST' ? 'pre-signing list' : 'signing-period list'}). Members are the listed players with a verified non-Dodgers signing; a listed Dodgers signing stays a Dodgers record; the rest are queued.`,
    stated_composition: {
      list_members: c.list_size, list_basis: c.list_basis, benchmark_signings: by('BENCHMARK_SIGNING_ADDED').length,
      dodgers_signings_mapped: by('MAPPED_TO_EXISTING_DODGERS_SIGNING'), identity_unresolved: by('IDENTITY_INSUFFICIENT_EVIDENCE'), identity_conflicts: by('IDENTITY_CONFLICT'),
      route_not_established: by('ROUTE_NOT_ESTABLISHED'),
    },
  }
})

// ---- BENCHMARK SUPPORT != DODGERS SUPPORT: two functions counted a target supported in ANY population ------------------------------------
// One statement of each now counts only the population predictions are made for. The rest of each definition is the frozen text, byte for byte.
/** The live definition of a function as its migration wrote it (checked against the live body md5 in baseline.json). */
function frozenFunction(file, name, liveMd5) {
  const src = fs.readFileSync(path.join(root, 'database/sql', file), 'utf8').replace(/\r\n/g, '\n')
  const start = src.indexOf(`create or replace function public.${name}()`)
  const end = src.indexOf('$fn$;', start) + '$fn$;'.length
  need(start > 0 && end > start, `${name} not found in ${file}`)
  const text = src.slice(start, end)
  const body = text.slice(text.indexOf('$fn$') + 4, text.lastIndexOf('$fn$'))
  need(md5(body) === liveMd5, `${name}: the ${file} body differs from the live one 050 was written against (${md5(body)})`)
  return { text, body }
}
const replaceOnce = (text, from, to, what) => { need(text.split(from).length === 2, `${what}: the statement must occur exactly once`); return text.replace(from, to) }
const bodyOf = (text) => text.slice(text.indexOf('$fn$') + 4, text.lastIndexOf('$fn$'))

const exec044 = frozenFunction('044_executive_product.sql', 'disi_executive_overview', baseline.executive_overview_body_md5)
const fn044 = exec044.text
const body044 = exec044.body
const OLD = `  -- 041 probability support
  execute $q$
    select count(distinct target_key)::int, (count(distinct target_key) filter (where baseline_supported))::int,
      coalesce(bool_or(baseline_supported), false)
    from public.v_outcome_target_support
  $q$ into v_targets, v_supported_targets, v_any_probability;`
const NEW = `  -- 041 probability support, for the population DISI makes predictions for (050). v_player_outcome_probability shows a probability only for
  -- the Dodgers tracked / opening-class reference population, so only that population's support is a supported probability target. A
  -- baseline supported only in the rank-selected Top-prospect benchmark sample is a reference result shown on Prediction readiness and is never
  -- reported as published probabilities: BENCHMARK SUPPORT != DODGERS SUPPORT.
  execute $q$
    select count(distinct target_key)::int,
      (count(distinct target_key) filter (where baseline_supported and reference_population = 'DODGERS_TRACKED_AND_OPENING_CLASS'))::int,
      coalesce(bool_or(baseline_supported and reference_population = 'DODGERS_TRACKED_AND_OPENING_CLASS'), false)
    from public.v_outcome_target_support
  $q$ into v_targets, v_supported_targets, v_any_probability;`
const fn050 = replaceOnce(fn044, OLD, NEW, 'disi_executive_overview')
const body050 = bodyOf(fn050)

// the 045b snapshot refresh validates a new generation against the same pooled count; it now checks the Dodgers population's count
const refresh045b = frozenFunction('045b_database_status_snapshot.sql', 'disi_refresh_product_snapshots', baseline.refresh_function_body_md5)
const OLD_R = `      case when exists (select 1 from e where e.supported_probability_targets <> (select count(distinct target_key) from public.product_prediction_readiness where baseline_supported)) then 'supported targets disagree with prediction readiness' end,`
const NEW_R = `      case when exists (select 1 from e where e.supported_probability_targets <> (select count(distinct target_key) from public.product_prediction_readiness where baseline_supported and reference_population = 'DODGERS_TRACKED_AND_OPENING_CLASS')) then 'supported targets disagree with prediction readiness' end,`
const refresh050 = replaceOnce(refresh045b.text, OLD_R, NEW_R, 'disi_refresh_product_snapshots')

// ---- payload -----------------------------------------------------------------------------------------------------------------------
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)

/** The migration SQL; `evaluation` null builds it without the evaluation update (evaluate.mjs computes the evaluation on that data). */
export function assemble(evaluation) {
  const payload = sortKeys({
    audit_through_date: AUDIT, outcome_through_season: Number(AUDIT.slice(0, 4)), retrieved_at: `${outcomes.retrieved_at}T00:00:00Z`,
    publication_slug: PUBLICATION, register_url: REGISTER_URL,
    sources, populations, new_players: newPlayers, legacy, dodgers_evaluations: dodgersEvaluations,
    baseline: { counts: baseline.counts, evaluation: baseline.evaluation },
    executive: { old_md5: md5(body044), new_md5: md5(body050) },
    refresh: { old_md5: refresh045b.body ? md5(refresh045b.body) : null, new_md5: md5(bodyOf(refresh050)) },
    evaluation: evaluation ? evaluation.evaluations.map((x) => ({ ...x, calibration_bins: x.calibration_bins })) : null,
  })
  const text = JSON.stringify(payload).replace(/[\u007f-￿]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
  for (const tag of ['$m050$', '$r050$', '$fn$']) need(!text.includes(tag), `payload contains the dollar-quote tag ${tag}`)
  let sql = read('050_template.sql').split('{{payload_json}}').join(text).split('{{executive_function}}').join(fn050).split('{{refresh_function}}').join(refresh050)
  need(!/\{\{\w+\}\}/.test(sql), 'unreplaced placeholder')
  return sql
}
export function assembleRollback() {
  const payload = sortKeys({ new_players: newPlayers.map((p) => ({ slug: p.slug, mlb_id: p.mlb_id })), legacy: legacy.map((l) => ({ slug: l.slug, mlb_id: l.mlb_id, alias: l.alias })),
    dodgers_evaluations: dodgersEvaluations.map((d) => ({ slug: d.slug, evaluation_date: d.evaluation.evaluation_date, scope_label: d.evaluation.scope_label })),
    populations: populations.map((p) => p.population_key), publication_slug: PUBLICATION, baseline: { counts: baseline.counts, evaluation: baseline.evaluation },
    // the rows 041 stored, exactly (its committed evaluation.json is what the 041 migration inserted)
    evaluation_041: JSON.parse(fs.readFileSync(path.join(here, '../041/evaluation.json'), 'utf8')).evaluations,
    executive: { old_md5: md5(body044), new_md5: md5(body050) },
    refresh: { old_md5: md5(refresh045b.body), new_md5: md5(bodyOf(refresh050)) } })
  const text = JSON.stringify(payload).replace(/[\u007f-￿]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
  let sql = read('rollback_template.sql').split('{{payload_json}}').join(text).split('{{executive_function_044}}').join(fn044)
    .split('{{refresh_function_045b}}').join(refresh045b.text)
  need(!/\{\{\w+\}\}/.test(sql), 'unreplaced rollback placeholder')
  return sql
}
export const research = { decisions, legacyDecisions, newPlayers, legacy, dodgersEvaluations, populations }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evaluation = json('evaluation.json')
  need(!evaluation.failures?.length, `the evaluation has failures: ${evaluation.failures?.join('; ')}`)
  const dest = path.join(root, 'database/sql/050_international_benchmark_support_expansion.sql')
  fs.writeFileSync(dest, assemble(evaluation))
  const rdest = path.join(root, 'database/release/sql/rollback-050.sql')
  fs.writeFileSync(rdest, assembleRollback())
  fs.writeFileSync(path.join(here, 'cohort-decisions.json'), JSON.stringify(sortKeys({ generated_by: 'database/research/050/build.mjs', list_members: decisions, legacy: legacyDecisions }), null, 1) + '\n')
  process.stderr.write(`wrote ${path.relative(process.cwd(), dest)}, ${path.relative(process.cwd(), rdest)}: ${newPlayers.length} benchmark signings, ${legacy.length} legacy identities, ${dodgersEvaluations.length} Dodgers evaluations\n`)
}
