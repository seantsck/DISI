#!/usr/bin/env node
// Turns REVIEWED research artifacts into SQL VALUES blocks for a migration
// template, plus a decisions report. It never connects to a database: a person
// reviews the decisions and pastes / builds the values into a migration file.
//
//   node scripts/mlb/outcome-sql-values.mjs \
//     --outcomes research-output/019/player-outcomes.json,research-output/019-legacy/player-outcomes.json \
//     --bwar research-output/019/bref-war.json \
//     --identity database/research/019/identity-decisions.json \
//     --audit-date 2026-10-05 --out research-output/019/values.sql

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, requireArg } from './lib/args.mjs'
import { parseIsoDate } from './lib/normalize.mjs'
import { auditDecision, DEFAULT_AUDIT_POLICY } from './lib/classify.mjs'
import { stableStringify, sortRecords } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const auditDate = parseIsoDate(requireArg(args, 'audit-date', 'YYYY-MM-DD'))
const policy = {
  negativeThroughYear: Number(args['negative-through-year'] || DEFAULT_AUDIT_POLICY.negativeThroughYear),
  activeNegativeThroughYear: Number(args['active-negative-through-year'] || DEFAULT_AUDIT_POLICY.activeNegativeThroughYear),
}
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const outcomes = requireArg(args, 'outcomes').split(',').flatMap((f) => load(f).records)
const bwar = new Map((args.bwar ? load(args.bwar).records : []).map((r) => [r.mlbId, r]))
const identity = args.identity ? load(args.identity) : {}
const legacySlugs = new Set(args['legacy-slugs'] ? load(args['legacy-slugs']) : [])

const q = (v) => {
  if (v == null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return `array[${v.map(q).join(',')}]::text[]`
  return `'${String(v).replace(/'/g, "''")}'`
}
const row = (values) => `(${values.map(q).join(',')})`

/** Which facts each MLB Stats API endpoint supports. */
function supports(url) {
  if (/\/people\/\d+$/.test(url)) return ['MLB_REACH', 'MLB_DEBUT_DATE']
  if (/transactions\?playerId=/.test(url)) return ['FINAL_TRANSACTION', 'DISPOSITION']
  if (/leagueListId=milb_all/.test(url)) return ['HIGHEST_LEVEL', 'LAST_AFFILIATED_SEASON', 'ACTIVE_STATUS']
  if (/sportId=1$/.test(url)) return ['MLB_DEBUT_ORGANIZATION', 'HIGHEST_LEVEL']
  return []
}

const records = sortRecords(outcomes.filter((r) => r.slug && r.mlbId), ['signingYear', 'slug'])
const blocks = { identity: [], progress: [], audits: [], sources: [], bwar: [] }
const decisions = []
for (const r of records) {
  const legacy = legacySlugs.has(r.slug)
  const decision = legacy
    ? { audit: false, legacy: true, reason: 'Existing audit kept; structured progress and outcome state added.' }
    : auditDecision(r, r.signingYear, policy)
  const id = identity[r.slug] || { basis: 'DODGERS_TRANSACTION_MATCH', note: 'MLB "signed free agent" transaction with the Dodgers around the signing year.' }
  blocks.identity.push(row([r.slug, r.mlbId, r.mlbFullName ?? null, id.basis, id.note]))
  blocks.progress.push(row([r.slug, auditDate, r.mlbDebutDate, r.mlbDebutTeam, r.highestLevel, r.highestLevelSeason,
    r.lastAffiliatedSeason, r.lastAffiliatedTeam, r.lastAffiliatedLevel, r.finalTransaction?.typeCode ?? null,
    r.finalTransaction?.date ?? null, r.finalTransaction?.organization ?? null, r.finalTransaction?.description ?? null,
    r.disposition, r.activeInAffiliatedBall, r.recommendation, r.lastMlbSeason ?? null, r.continuedOutsideAffiliated ?? null]))
  const state = decision.audit ? decision.outcomeState
    : legacy ? ({ VERIFIED_MLB: 'REACHED_MLB', NO_MLB_CAREER_ENDED: 'NO_MLB_CAREER_ENDED', NO_MLB_ACTIVE_IN_MINORS: 'NO_MLB_ACTIVE_IN_MINORS' }[r.recommendation] || 'NO_MLB_STATUS_UNKNOWN')
      : null
  if (decision.audit || legacy) blocks.audits.push(row([r.slug, decision.audit ? decision.reachedMlb : null, state, decision.audit, r.reason]))
  for (const s of r.sources || []) blocks.sources.push(row([r.slug, s.url, s.retrievedAt, supports(s.url)]))
  const war = r.reachedMlb ? bwar.get(r.mlbId) : null
  if (war) {
    blocks.bwar.push(row([r.slug, r.mlbId, war.brefId, war.careerBwar, war.observedThroughSeason,
      war.sources[0].url, war.sources[1].url, war.sources[0].retrievedAt]))
  }
  decisions.push({ slug: r.slug, name: r.name, signingYear: r.signingYear, mlbId: r.mlbId, recommendation: r.recommendation,
    audited: Boolean(decision.audit), legacy, outcomeState: state, decisionReason: decision.reason, evidence: r.reason,
    careerBwar: war?.careerBwar ?? null })
}

const header = (name, cols) => `-- ${name}(${cols})`
const sql = [
  header('identity', 'slug, mlb_id, mlb_full_name, identity_basis, identity_note'), blocks.identity.join(',\n'),
  header('progress', 'slug, as_of_date, mlb_debut_date, mlb_debut_team, highest_level, highest_level_season, last_affiliated_season, last_affiliated_team, last_affiliated_level, final_transaction_type, final_transaction_date, final_organization, final_transaction_description, disposition, active_in_affiliated_ball, research_recommendation, last_mlb_season, continued_outside_affiliated'), blocks.progress.join(',\n'),
  header('audits', 'slug, reached_mlb, outcome_state, is_new_audit, evidence_summary'), blocks.audits.join(',\n'),
  header('sources', 'slug, url, retrieved_at, supports_fields'), blocks.sources.join(',\n'),
  header('bwar', 'slug, mlb_id, bref_id, career_bwar, observed_through_season, bat_url, pitch_url, retrieved_at'), blocks.bwar.join(',\n') || '',
].join('\n\n') + '\n'

const out = args.out || 'research-output/values.sql'
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, sql)
fs.writeFileSync(out.replace(/\.sql$/, '') + '-decisions.json', stableStringify({ meta: { auditDate, policy }, records: decisions }))
const count = (f) => decisions.filter(f).length
process.stderr.write(`players ${decisions.length}; new audits ${count((d) => d.audited)} (MLB ${count((d) => d.audited && d.outcomeState === 'REACHED_MLB')}, no MLB ${count((d) => d.audited && d.outcomeState !== 'REACHED_MLB')}); legacy refreshed ${count((d) => d.legacy)} → ${out}\n`)
