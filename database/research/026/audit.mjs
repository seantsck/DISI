#!/usr/bin/env node
// Reproducible audit behind migration 026: facts the migration's guards and
// backfill depend on, measured on the canonical 001->025 database.
//
//   node database/research/026/audit.mjs
//
// Builds 001->025 in an in-memory PGlite database (the manifest minus 026 and
// later), so it needs no network and touches no real database. Writes the
// deterministic audit-report.json (no timestamps) that build.mjs embeds in the
// migration, and exits non-zero if any precondition fails:
//   * the legacy public.evaluations table is empty, has the known migration-001
//     shape, no dependent objects and no inbound foreign keys, and nothing in
//     the application or later migrations references it;
//   * the 59 legacy signings.international_rank values split exactly into the
//     provenance-backed ones (MLB Pipeline tracker evidence with a publication
//     date) and the unsourced ones;
//   * every player, organization and source the reviewed seed evidence names
//     resolves.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8'))
const seed = JSON.parse(fs.readFileSync(path.join(here, 'seed-evidence.json'), 'utf8'))

const db = new PGlite({ extensions: { pgcrypto } })
await db.exec('create role anon nologin; create role authenticated nologin;')
for (const file of manifest.canonical_sql) {
  if (/^02[6-9]_|^0[3-9]\d_/.test(file)) break
  await db.exec(fs.readFileSync(path.join(root, 'database/sql', file), 'utf8'))
}
const query = async (sql, params) => (await db.query(sql, params)).rows
const failures = []
const need = (ok, message) => { if (!ok) failures.push(message) }

// -- legacy public.evaluations --------------------------------------------------------
const [{ exists }] = await query(`select to_regclass('public.evaluations') is not null as exists`)
need(exists, 'public.evaluations does not exist')
const legacy = { exists, row_count: null, columns: [], dependents: [], inbound_foreign_keys: [], repository_references: [] }
if (exists) {
  legacy.row_count = (await query('select count(*)::int as n from public.evaluations'))[0].n
  legacy.columns = (await query(`select column_name || ':' || data_type as c from information_schema.columns
    where table_schema = 'public' and table_name = 'evaluations' order by ordinal_position`)).map((r) => r.c)
  // Dependents other than the table's own constraints, defaults, indexes, policy, row type and TOAST table.
  legacy.dependents = (await query(`with t as (select 'public.evaluations'::regclass as oid)
    select distinct d.classid::regclass::text || ':' || coalesce(
      (select conname from pg_constraint where oid = d.objid and d.classid = 'pg_constraint'::regclass),
      (select ev_class::regclass::text from pg_rewrite where oid = d.objid and d.classid = 'pg_rewrite'::regclass),
      (select tgname from pg_trigger where oid = d.objid and d.classid = 'pg_trigger'::regclass),
      (select relname from pg_class where oid = d.objid and d.classid = 'pg_class'::regclass),
      d.objid::text) as dep
    from pg_depend d, t
    where d.refobjid = t.oid and d.objid <> t.oid
      and not (d.classid = 'pg_attrdef'::regclass)
      and not (d.classid = 'pg_constraint'::regclass and exists (select 1 from pg_constraint c where c.oid = d.objid and c.conrelid = t.oid))
      and not (d.classid = 'pg_policy'::regclass and exists (select 1 from pg_policy p where p.oid = d.objid and p.polrelid = t.oid))
      and not (d.classid = 'pg_trigger'::regclass and exists (select 1 from pg_trigger g where g.oid = d.objid and g.tgrelid = t.oid))
      and not (d.classid = 'pg_type'::regclass)
      and not (d.classid = 'pg_class'::regclass and exists (select 1 from pg_class c where c.oid = d.objid and c.relkind in ('i', 't') ))
    order by 1`)).map((r) => r.dep)
  legacy.inbound_foreign_keys = (await query(`select conrelid::regclass::text as t from pg_constraint where confrelid = 'public.evaluations'::regclass order by 1`)).map((r) => r.t)
}
// repository scan: production code and later migrations must not reference the table
const references = []
const scan = (dir, /** @type {(rel: string) => boolean} */ filter = () => true) => {
  for (const name of fs.readdirSync(path.join(root, dir), { recursive: true })) {
    const rel = path.join(dir, String(name)).split(path.sep).join('/')
    if (!/\.(js|mjs|jsx|ts|tsx|sql)$/.test(rel) || !fs.statSync(path.join(root, rel)).isFile()) continue
    if (!filter(rel)) continue
    fs.readFileSync(path.join(root, rel), 'utf8').split('\n').forEach((line, i) => {
      if (/\bpublic\.evaluations\b|from\s+evaluations\b|join\s+evaluations\b|'evaluations'/.test(line)) references.push(`${rel}:${i + 1}`)
    })
  }
}
scan('app')
scan('lib')
scan('scripts/mlb')
scan('database/sql', (rel) => !/\/(001|026)_/.test(rel))
legacy.repository_references = references.sort()
need(legacy.row_count === 0, `legacy evaluations has ${legacy.row_count} rows`)
need(legacy.dependents.length === 0, `legacy evaluations has dependents: ${legacy.dependents.join(', ')}`)
need(legacy.inbound_foreign_keys.length === 0, 'legacy evaluations has inbound foreign keys')
need(legacy.repository_references.length === 0, `repository references: ${legacy.repository_references.join(', ')}`)

// -- legacy international ranks ---------------------------------------------------------
const ranks = await query(`select p.slug, sg.signing_year as year, sg.international_rank::int as rank, sg.rank_source, o.franchise_key,
    (select so.url from public.evidence e join public.sources so on so.id = e.source_id
      where e.entity_type = 'signing' and e.entity_id = sg.id and so.source_tier = 'MLB_PIPELINE'
        and so.source_type = 'INTERNATIONAL_TRACKER' and so.publication_date is not null limit 1) as tracker_url
  from public.signings sg join public.players p on p.id = sg.player_id join public.organizations o on o.id = sg.organization_id
  where sg.international_rank is not null order by sg.signing_year, sg.international_rank, p.slug`)
const sourced = ranks.filter((r) => r.rank_source === 'MLB Pipeline' && r.tracker_url)
const unsourced = ranks.filter((r) => !sourced.includes(r))
const byYear = (rows) => rows.reduce((t, r) => ((t[r.year] = (t[r.year] || 0) + 1), t), {})
need(ranks.length === 59, `expected 59 legacy ranks, found ${ranks.length}`)
need(sourced.length === 48, `expected 48 sourced legacy ranks, found ${sourced.length}`)
need(unsourced.length === 11, `expected 11 unsourced legacy ranks, found ${unsourced.length}`)

// -- seed evidence resolves ----------------------------------------------------------------
const slugs = [...new Set([...seed.evaluations.map((e) => e.player_slug), ...seed.no_evaluation_found.map((e) => e.player_slug)])]
const found = new Set((await query('select slug from public.players where slug = any($1)', [slugs])).map((r) => r.slug))
for (const s of slugs) need(found.has(s), `seed player ${s} does not exist`)
const orgs = new Set((await query('select name from public.organizations')).map((r) => r.name))
for (const e of seed.evaluations) {
  if (e.organization_name) need(orgs.has(e.organization_name), `organization ${e.organization_name} missing`)
  for (const r of e.rankings) if (r.organization_name) need(orgs.has(r.organization_name), `organization ${r.organization_name} missing`)
}
const sourceUrls = new Set(seed.sources.map((s) => s.url))
for (const e of seed.evaluations) need(sourceUrls.has(e.source_url), `evaluation ${e.ref} cites an unlisted source`)
const existingUrls = new Set((await query('select url from public.sources')).map((r) => r.url))
for (const s of seed.sources) need(!existingUrls.has(s.url), `seed source already exists in sources: ${s.url}`)
const tiers = new Set((await query('select tier_code from public.source_tiers')).map((r) => r.tier_code))
for (const p of seed.publications) need(!p.source_tier || tiers.has(p.source_tier), `unknown source tier ${p.source_tier}`)

const report = {
  migration: '026_scouting_evaluation_history',
  legacy_evaluations: legacy,
  legacy_international_ranks: {
    total: ranks.length,
    sourced: { count: sourced.length, by_year: byYear(sourced), tracker_urls: [...new Set(sourced.map((r) => r.tracker_url))].sort() },
    unsourced: { count: unsourced.length, by_year: byYear(unsourced), players: unsourced.map((r) => `${r.slug}:${r.year}:#${r.rank}`) },
  },
  seed: {
    publications: seed.publications.length,
    scales: seed.scales.length,
    sources: seed.sources.length,
    evaluations: seed.evaluations.length,
    rankings: seed.evaluations.reduce((n, e) => n + e.rankings.length, 0),
    grades: seed.evaluations.reduce((n, e) => n + e.grades.length, 0),
    notes: seed.evaluations.reduce((n, e) => n + e.notes.length, 0),
    no_evaluation_found: seed.no_evaluation_found.map((e) => e.player_slug),
  },
  failures,
}
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 2) + '\n')
await db.close()
console.log(`legacy evaluations: rows ${legacy.row_count}, columns ${legacy.columns.length}, dependents ${legacy.dependents.length}, inbound FKs ${legacy.inbound_foreign_keys.length}, repository references ${legacy.repository_references.length}`)
console.log(`legacy ranks: ${ranks.length} = ${sourced.length} sourced ${JSON.stringify(byYear(sourced))} + ${unsourced.length} unsourced ${JSON.stringify(byYear(unsourced))}`)
console.log(`seed: ${JSON.stringify(report.seed)}`)
if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
