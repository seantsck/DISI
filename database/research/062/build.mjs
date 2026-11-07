#!/usr/bin/env node
// Assembles Migration 062 and its rollback from the owner-observed input (owner-input.json), the 062 identity audit (audit.json) and the pre-062
// canonical replay (baseline-build.json), and writes career-bwar-evidence.json. Deterministic: the same inputs give byte-identical files.
// Data only: the 017 provider rule already accepts the canonical Baseball-Reference player URL. Refuses an input the baseline does not allow, and
// holds back (NULL, with the reason) an owner row that would contradict a team-season ledger DISI already holds beyond the verifier's tolerance.
//   node database/research/062/build.mjs            write database/sql/062_..., database/release/sql/rollback-062.sql, career-bwar-evidence.json
//   node database/research/062/build.mjs --check    exit 1 unless the committed files equal the build output

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
export const MIGRATION = path.join(root, 'database/sql/062_bwar_backlog_closure.sql')
export const ROLLBACK = path.join(root, 'database/release/sql/rollback-062.sql')
const EVIDENCE = path.join(here, 'career-bwar-evidence.json')
const need = (ok, msg) => { if (!ok) throw new Error(`062 build: ${msg}`) }

/** The verifier's career reconciliation tolerance (scripts/db/lib/value-invariants.mjs, value_career_reconciliation_violations). */
export const RECONCILIATION_TOL = 0.1
export const ACCESSED_AT = '2026-11-06 00:00:00+00'
const EXPECTED = { career_bwar_observations: 58, bwar_missing: 39, sources: 3396, evidence: 4507, transaction_queue: 51, value_queue: 79 }

/** The canonical current Baseball-Reference player URL of a verified bref id. */
export const playerUrl = (bref) => `https://www.baseball-reference.com/players/${bref[0]}/${bref}.shtml`

const sourceNotes = (b, input) => `Owner-observed current Baseball-Reference player page for ${b.bref_id} (mlb_ID ${b.mlb_id}). The DISI owner read the career WAR shown on this page`
  + ` and supplied it to DISI on ${input.supplied_on}. DISI did not retrieve this page and holds no copy of it; no automated process read it (the live site answers HTTP 403`
  + ` to automated requests). accessed_at is the owner's observation date (${input.observed_on}; no time of day was given, stored as 00:00 UTC).`

/** The notes of one 062 observation: owner-observed, the page, the identity basis and the as-of. */
export const notesFor = (b, value, input) => `Migration 062: current career Baseball-Reference bWAR ${value} for ${b.bref_id} (mlb_ID ${b.mlb_id}), OWNER-OBSERVED:`
  + ` the DISI owner read the career WAR shown on the current Baseball-Reference player page ${playerUrl(b.bref_id)} and supplied it on ${input.supplied_on}.`
  + ' DISI did not retrieve the page; no automated process read it.'
  + (value === '0.0' ? ' 0.0 is the observed value: a known zero, not a missing value.' : '')
  + ' Identity: the bref_id / mlb_id pair verified by the 062 audit (MLB Stats API person record; the pairing in the Baseball-Reference WAR data files).'
  + ` Career-to-date through the ${input.observed_through_season} season.`

/** The payload both files carry; throws on anything the reviewed input does not allow. */
export const payloadFor = (input, audit, baseline) => {
  // the baseline: the state the input was supplied against
  need(baseline.headline.career_bwar_observations === EXPECTED.career_bwar_observations, 'the CAREER_BWAR observation count is not 58')
  need(baseline.backlog.length === EXPECTED.bwar_missing, 'the BWAR_MISSING count is not 39')
  need(baseline.isolation_061.counts.sources === EXPECTED.sources && baseline.isolation_061.counts.evidence === EXPECTED.evidence, 'the source / evidence counts are not 3396 / 4507')
  need(baseline.isolation_061.transaction_queue === EXPECTED.transaction_queue && baseline.isolation_061.value_queue === EXPECTED.value_queue, 'the queues are not 51 / 79')
  need(baseline.provider_rule.bwar_requires_baseball_reference_url === true && baseline.provider_rule.triggers === 1, 'the 017 provider rule is not in place')
  need(input.input_kind === 'OWNER_OBSERVED_BASEBALL_REFERENCE_PLAYER_PAGE' && input.confidence === 'UNVERIFIED', 'the input is not owner-observed with UNVERIFIED confidence')
  need(/^\d{4}-\d{2}-\d{2}$/.test(input.observed_through_date) && Number.isInteger(input.observed_through_season), 'the as-of is not a date and a season')
  // the rows: every BWAR_MISSING player exactly once, by verified bref id, with an exact one-decimal value
  need(input.rows.length === 39 && new Set(input.rows.map((r) => r.bref_id)).size === 39, 'the input is not 39 distinct bref ids')
  need(JSON.stringify(input.rows.map((r) => r.bref_id).sort()) === JSON.stringify(baseline.backlog.map((b) => b.bref_id).sort()), 'the input bref ids are not exactly the BWAR_MISSING players')
  const accepted = [], rejected = []
  for (const r of input.rows) {
    need(/^-?\d+\.\d$/.test(r.career_bwar) && r.career_bwar !== '-0.0', `${r.bref_id}: ${r.career_bwar} is not an exact one-decimal value`)
    const b = baseline.backlog.find((x) => x.bref_id === r.bref_id)
    const a = audit.players.find((x) => x.slug === b.slug)
    need(a && a.bref_id === b.bref_id && a.mlb_id === b.mlb_id && a.identity.checks_failed.length === 0, `${r.bref_id}: the 062 audit does not verify this identity`)
    need(b.reached_mlb_verified === true && b.metric_observations === 0 && b.career_bwar === null, `${r.bref_id}: not a verified MLB player with a NULL career bWAR`)
    need(/^[a-z][a-z0-9]+$/.test(b.bref_id), `${r.bref_id}: not a Baseball-Reference id`)
    const v = Number(r.career_bwar)
    // a DISI-held ledger (057 rows through 2025) and outcomes.career_war must stay reconcilable with the current career value
    const ledger = b.war_rows > 0 ? Number(b.war_sum) : null, outcome = b.outcome_career_war === null ? null : Number(b.outcome_career_war)
    const off = [ledger === null ? null : Math.abs(v - ledger), outcome === null ? null : Math.abs(v - outcome)].filter((d) => d !== null && d - RECONCILIATION_TOL > 1e-9)
    const row = { slug: b.slug, name: r.name, bref_id: b.bref_id, mlb_id: b.mlb_id, career_bwar: r.career_bwar, url: playerUrl(b.bref_id) }
    if (off.length) {
      rejected.push({ ...row, ledger_rows: b.war_rows, ledger_sum: b.war_sum, ledger_last_season: b.war_last_season, outcome_career_war: b.outcome_career_war,
        reason: `DISI holds a loaded team-season ledger for this player (${b.war_rows} rows through ${b.war_last_season}, sum ${b.war_sum}; outcomes.career_war ${b.outcome_career_war}).`
          + ` The owner's current career value ${r.career_bwar} differs from it by more than the verifier's ${RECONCILIATION_TOL} career reconciliation tolerance`
          + ' (value_career_reconciliation_violations), so writing it would fail the verifier and leave two career stores disagreeing. It stays NULL until the'
          + ' missing team-season rows are loaded from a readable source, or the owner decides how the reconciliation rule should treat a ledger that ends before the career does.' })
      continue
    }
    accepted.push({ ...row, title: `Baseball-Reference player page (${b.bref_id})`, source_notes: sourceNotes(b, input), notes: notesFor(b, r.career_bwar, input) })
  }
  accepted.sort((x, y) => x.slug.localeCompare(y.slug)); rejected.sort((x, y) => x.slug.localeCompare(y.slug))
  need(accepted.length + rejected.length === 39, 'every row is accepted or held')
  // no URL may already be a source row in the baseline (the 062 sources are new; a rerun finds its own rows)
  need(accepted.every((p) => !baseline.war_sources.some((s) => s.url === p.url)), 'a 062 player URL is already a WAR data source')
  const before = baseline.backlog.map((b) => b.slug).sort()
  return {
    semantics: { observed_through_date: input.observed_through_date, observed_through_season: input.observed_through_season, confidence: input.confidence, accessed_at: ACCESSED_AT },
    players: accepted.map(({ slug, bref_id, mlb_id, career_bwar, url, title, source_notes, notes }) => ({ slug, bref_id, mlb_id, career_bwar, url, title, source_notes, notes })),
    rejected: rejected.map(({ slug, bref_id, career_bwar }) => ({ slug, bref_id, career_bwar })),
    baseline: { career_bwar_observations: EXPECTED.career_bwar_observations, sources: EXPECTED.sources, evidence: EXPECTED.evidence, bwar_missing_before: before,
      bwar_missing_after: rejected.map((r) => r.slug) },
    _rejected_detail: rejected,
  }
}

const inputs = () => ({ input: read('owner-input.json'), audit: read('audit.json'), baseline: read('baseline-build.json') })
const fill = (template, tag, payload) => {
  const { _rejected_detail, ...p } = payload
  const json = JSON.stringify(p)
  need(!json.includes(`$${tag}$`), 'the payload contains the dollar-quote tag')
  const t = fs.readFileSync(path.join(here, template), 'utf8').replace('{{payload_json}}', () => json)
  need(!/\{\{[a-z_0-9]+\}\}/.test(t), `${template}: a placeholder is left`)
  return t
}
export const assemble = (i = inputs()) => {
  const payload = payloadFor(i.input, i.audit, i.baseline)
  return { payload, migration: fill('062_template.sql', 'm062', payload), rollback: fill('rollback_template.sql', 'r062', payload) }
}
export const evidence = (i = inputs()) => {
  const { payload } = assemble(i)
  const archived = (slug) => i.audit.players.find((p) => p.slug === slug)?.evidence_value?.one_decimal ?? null
  return {
    generated_by: 'database/research/062/build.mjs',
    note: 'The 39 owner-observed rows: what 062 writes (ACCEPTED) and what it holds back (HELD, NULL, with the reason). archived_value is the first 062 audit\'s value from the archived captures (only for the twelve whose career was complete there); it is a cross-check, superseded by the owner value.',
    input_kind: i.input.input_kind, supplied_on: i.input.supplied_on, confidence: i.input.confidence,
    rows: i.input.rows.map((r) => {
      const ok = payload.players.find((p) => p.bref_id === r.bref_id), held = payload._rejected_detail.find((p) => p.bref_id === r.bref_id)
      const x = ok ?? held
      return { slug: x.slug, name: r.name, bref_id: x.bref_id, mlb_id: x.mlb_id, career_bwar: r.career_bwar, url: x.url, status: ok ? 'ACCEPTED' : 'HELD',
        archived_value: archived(x.slug), ...(held ? { reason: held.reason } : {}) }
    }).sort((a, b) => a.slug.localeCompare(b.slug)),
    effect: { career_bwar_observations: [EXPECTED.career_bwar_observations, EXPECTED.career_bwar_observations + payload.players.length],
      bwar_missing: [EXPECTED.bwar_missing, payload.rejected.length], sources: [EXPECTED.sources, EXPECTED.sources + payload.players.length], evidence: [EXPECTED.evidence, EXPECTED.evidence] },
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = assemble()
  const outputs = [[MIGRATION, built.migration], [ROLLBACK, built.rollback], [EVIDENCE, JSON.stringify(evidence(), null, 1) + '\n']]
  if (process.argv.includes('--check')) {
    const stale = outputs.filter(([f, t]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== t).map(([f]) => path.relative(root, f))
    if (stale.length) { console.error(`stale: ${stale.join(', ')}`); process.exit(1) }
    console.log('062 build output is current')
  } else {
    for (const [f, t] of outputs) fs.writeFileSync(f, t)
    console.log(`wrote ${outputs.map(([f]) => path.relative(root, f)).join(', ')}`)
  }
}
