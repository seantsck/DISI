#!/usr/bin/env node
// Assembles database/sql/026_scouting_evaluation_history.sql from:
//   026_template.sql     hand-written schema, guards, triggers, backfill and views
//   seed-evidence.json   reviewed scales, publications, citations and evaluations
//   audit-report.json    facts measured by audit.mjs (legacy shape, 48 / 11 rank split)
//
//   node database/research/026/audit.mjs && node database/research/026/build.mjs
//
// Deterministic: the same reviewed inputs always produce the same file. The build
// refuses to run if the audit recorded any failure.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const seed = JSON.parse(fs.readFileSync(path.join(here, 'seed-evidence.json'), 'utf8'))
const audit = JSON.parse(fs.readFileSync(path.join(here, 'audit-report.json'), 'utf8'))
if (audit.failures.length) throw new Error(`audit has failures: ${audit.failures.join('; ')}`)

// -- typed SQL cells (every cell carries a cast so NULL rows type correctly) -------------
const esc = (v) => String(v).replace(/'/g, "''")
const T = (v) => (v == null ? 'null::text' : `'${esc(v)}'`)
const I = (v) => (v == null ? 'null::int' : String(Number(v)))
const N = (v) => (v == null ? 'null::numeric' : String(Number(v)))
const B = (v) => (v ? 'true' : 'false')
const D = (v) => (v == null ? 'null::date' : `date '${esc(v)}'`)
const TS = (v) => (v == null ? 'null::timestamptz' : `timestamptz '${esc(v)}'`)
const TA = (v) => (v == null ? 'null::text[]' : `array[${v.map((x) => `'${esc(x)}'`).join(', ')}]::text[]`)
const row = (cells) => `  (${cells.join(', ')})`
const rows = (list) => list.join(',\n')

// -- validation of the reviewed input (fail loudly, never guess) ----------------------------
const refs = new Set()
for (const e of seed.evaluations) {
  if (refs.has(e.ref)) throw new Error(`duplicate evaluation ref ${e.ref}`)
  refs.add(e.ref)
  if (e.date_precision === 'DAY' && !e.evaluation_date) throw new Error(`${e.ref}: DAY precision needs a date`)
  if (e.date_precision !== 'DAY' && e.evaluation_date) throw new Error(`${e.ref}: only DAY precision carries a date`)
  if (!e.source_url && !e.source_reference) throw new Error(`${e.ref}: provenance required`)
  for (const n of e.notes) if (n.note_text.length > 500) throw new Error(`${e.ref}: note over 500 characters`)
  if (e.summary_note && e.summary_note.length > 500) throw new Error(`${e.ref}: summary over 500 characters`)
}
if (seed.publications.some((p) => p.origin === 'DISI_RESEARCH')) throw new Error('026 seeds no DISI_RESEARCH publication')

const year = (e) => (e.evaluation_date ? Number(e.evaluation_date.slice(0, 4)) : (e.evaluation_year ?? null))
const month = (e) => (e.evaluation_date ? Number(e.evaluation_date.slice(5, 7)) : (e.evaluation_month ?? null))

const blocks = {
  scales: rows(seed.scales.map((s) => row([T(s.scale_code), T(s.label), T(s.scale_kind), N(s.scale_min), N(s.scale_max),
    N(s.scale_step), TA(s.ordered_labels ?? null), B(s.allows_qualifier), T(s.notes)]))),
  publications: rows(seed.publications.map((p) => row([T(p.publication_slug), T(p.publication_name), T(p.publisher), T(p.origin),
    T(p.publication_kind), T(p.default_scale_code), T(p.access_class), B(p.bulk_ingest_allowed), T(p.source_tier),
    T(p.reference_url), T(p.scope_notes), T(p.methodology_notes)]))),
  sources: rows(seed.sources.map((s) => row([T(s.source_name), T(s.source_type), T(s.title), T(s.url), T(s.author),
    D(s.publication_date), TS(s.accessed_at), T(s.notes)]))),
  evaluations: rows(seed.evaluations.map((e) => row([T(e.ref), T(e.player_slug), T(e.publication_slug), T(e.evaluation_context),
    T(e.date_precision), D(e.evaluation_date), I(year(e)), I(month(e)), T(e.organization_name), T(e.stated_level),
    I(e.eta_season), T(e.role_label), T(e.evaluator_name), T(e.evaluator_role), T(e.evidence_basis), T(e.confidence),
    T(e.source_url), T(e.source_reference), T(e.archive_url), TS(e.retrieved_at), T(e.summary_note), T(e.preservation_concern)]))),
  rankings: rows(seed.evaluations.flatMap((e) => e.rankings.map((r) => row([T(e.ref), I(r.rank), T(r.ranking_scope),
    T(r.scope_label), T(r.organization_name), I(r.list_size), T(r.eligibility_definition)])))),
  grades: rows(seed.evaluations.flatMap((e) => e.grades.map((g) => row([T(e.ref), T(g.dimension_code), T(g.temporal_basis),
    N(g.raw_value), T(g.raw_label), T(g.qualifier), T(g.scale_code), T(g.source_label)])))),
  notes: rows(seed.evaluations.flatMap((e) => e.notes.map((n, i) => row([T(e.ref), T(n.note_kind), I(n.note_seq ?? i + 1), T(n.note_text)])))),
}
// An empty VALUES block would not parse; emit a typed all-NULL row that the joins drop.
if (!blocks.notes) blocks.notes = row([T(null), T(null), I(null), T(null)])
if (!blocks.rankings) blocks.rankings = row([T(null), I(null), T(null), T(null), T(null), I(null), T(null)])
if (!blocks.grades) blocks.grades = row([T(null), T(null), T(null), N(null), T(null), T(null), T(null), T(null)])

let sql = fs.readFileSync(path.join(here, '026_template.sql'), 'utf8')
const fill = (name, value) => {
  const token = `{{${name}}}`
  if (!sql.includes(token)) throw new Error(`template has no ${token}`)
  sql = sql.split(token).join(value)
}
for (const [name, value] of Object.entries(blocks)) fill(name, value)
fill('legacy_shape', audit.legacy_evaluations.columns.map((c) => `    '${esc(c)}'`).join(',\n'))
fill('expected_sourced', String(audit.legacy_international_ranks.sourced.count))
fill('expected_unsourced', String(audit.legacy_international_ranks.unsourced.count))
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/026_scouting_evaluation_history.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
