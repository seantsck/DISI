#!/usr/bin/env node
// Offline audit for Migration 029. It builds the canonical chain through 028 in memory (no network,
// no real database) and measures every fact the migration's guards, seeds and coverage contract
// depend on. It exits non-zero on any failure.
//
//   node database/research/029/audit.mjs   ->  database/research/029/audit-report.json

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const seed = JSON.parse(fs.readFileSync(path.join(here, 'seed-evidence.json'), 'utf8'))
const failures = []
const check = (label, ok) => { if (!ok) failures.push(label) }

const ch = await buildChainThrough('028_residual_canonical_drift_reconciliation.sql')
const q = ch.query

// ---- baseline: the legacy trainer layer is empty and has no unexpected dependents --------------------------------------
const legacy = {
  trainers: Number((await q('select count(*)::int as n from trainers'))[0].n),
  player_trainers: Number((await q('select count(*)::int as n from player_trainers'))[0].n),
  views_present: (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname in ('v_player_trainers', 'v_dodgers_trainer_network') order by 1`)).map((r) => r.relname),
  unexpected_dependent_views: (await q(`select distinct v.relname from pg_depend d join pg_rewrite rw on rw.oid = d.objid join pg_class v on v.oid = rw.ev_class
    where d.refobjid in ('public.trainers'::regclass, 'public.player_trainers'::regclass, 'public.v_player_trainers'::regclass, 'public.v_dodgers_trainer_network'::regclass)
      and d.deptype = 'n' and v.relname not in ('v_player_trainers', 'v_dodgers_trainer_network')`)).map((r) => r.relname),
}
check('legacy trainers are empty', legacy.trainers === 0 && legacy.player_trainers === 0)
check('both legacy views exist', legacy.views_present.length === 2)
check('nothing else depends on the legacy trainer objects', legacy.unexpected_dependent_views.length === 0)

// ---- baseline totals ----------------------------------------------------------------------------------------------------
const totals = (await q(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`))[0]
check('baseline is 47 tables / 91 views', totals.tables === 47 && totals.views === 91)
const networkObjects = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and (relname like 'network\\_%' or relname like 'player\\_network\\_%') and relkind in ('r', 'v')`)).map((r) => r.relname)
check('no network object exists yet', networkObjects.length === 0)

// ---- seed references resolve -----------------------------------------------------------------------------------------------
const sourceUrls = seed.sources.map((s) => s.url)
const existingSources = (await q('select url from sources where url = any($1)', [sourceUrls])).map((r) => r.url)
check('the Baseball America review sources are not yet registered', existingSources.length === 0)
const seedSigning = []
for (const r of seed.player_relationships) {
  const player = await q('select id from players where slug = $1', [r.player_slug])
  check(`player ${r.player_slug} exists`, player.length === 1)
  if (r.signing) {
    const s = await q(`select sg.id from signings sg join players p on p.id = sg.player_id join organizations o on o.id = sg.organization_id where p.slug = $1 and o.name = $2 and sg.signing_year = $3`,
      [r.player_slug, r.signing.organization_name, r.signing.signing_year])
    check(`signing for ${r.ref} exists`, s.length === 1)
    seedSigning.push(r.ref)
  }
}
for (const n of seed.researched_without_attribution) check(`researched player ${n.player_slug} exists`, (await q('select 1 from players where slug = $1', [n.player_slug])).length === 1)

// ---- exact seed counts ---------------------------------------------------------------------------------------------------------
const counts = {
  entities: seed.entities.length,
  persons: seed.entities.filter((e) => e.entity_type === 'PERSON').length,
  programs: seed.entities.filter((e) => e.entity_type === 'PROGRAM').length,
  academies: seed.entities.filter((e) => e.entity_type === 'ACADEMY').length,
  showcase_leagues: seed.entities.filter((e) => e.entity_type === 'SHOWCASE_LEAGUE').length,
  aliases: seed.aliases.length,
  player_relationships: seed.player_relationships.length,
  entity_relationships: seed.entity_relationships.length,
  identity_reviews: seed.identity_reviews.length,
}
check('seed is 9 entities (5 persons, 1 program, 1 academy, 2 leagues)', counts.entities === 9 && counts.persons === 5 && counts.programs === 1 && counts.academies === 1 && counts.showcase_leagues === 2)
check('seed is 1 alias, 9 player relationships, 0 entity relationships, 0 identity reviews', counts.aliases === 1 && counts.player_relationships === 9 && counts.entity_relationships === 0 && counts.identity_reviews === 0)
const perPlayer = seed.player_relationships.reduce((m, r) => ((m[r.player_slug] = (m[r.player_slug] || 0) + 1), m), {})
check('per-player relationships are Cruz 1, Heredia 3, Brito 2, Arias 2, Vivas 1', JSON.stringify(perPlayer) === JSON.stringify({ 'oneil-cruz': 1, 'starling-heredia': 3, 'ronny-brito': 2, 'christopher-arias': 2, 'jorbit-vivas': 1 }))
check('possessive wording alone is never an entity-to-entity relationship', seed.entity_relationships.length === 0)

// ---- coverage population (primary denominator) ----------------------------------------------------------------------------------
const population = await q(`select p.slug, s.signing_year, s.pathway::text as pathway, s.country_market,
    exists (select 1 from outcome_audits oa where oa.player_id = p.id and oa.reached_mlb_verified) as mlb
  from signings s join players p on p.id = s.player_id join organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
  where s.pathway::text in ('LATAM_AMATEUR', 'CUBAN_AMATEUR')
    and (s.bonus_publicly_reported or s.international_rank is not null or exists (select 1 from outcome_audits oa where oa.player_id = p.id and oa.reached_mlb_verified))`)
const cubanPro = await q(`select p.slug from signings s join players p on p.id = s.player_id join organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
  where s.pathway::text = 'CUBAN_PRO' and (s.bonus_publicly_reported or s.international_rank is not null or exists (select 1 from outcome_audits oa where oa.player_id = p.id and oa.reached_mlb_verified))`)
const seededPlayers = new Set(Object.keys(perPlayer))
const inPopulation = population.filter((p) => seededPlayers.has(p.slug))
const missing = population.filter((p) => !seededPlayers.has(p.slug))
check('primary denominator is 64', population.length === 64)
check('all five seeded players are inside the primary denominator', inPopulation.length === 5)
check('59 signings remain without attribution', missing.length === 59)
const coverage = {
  primary_denominator: population.length,
  attributed_after_seed: inPopulation.length,
  missing_attribution_after_seed: missing.length,
  missing_mlb_reached: missing.filter((p) => p.mlb).length,
  mlb_reached_in_denominator: population.filter((p) => p.mlb).length,
  by_pathway: population.reduce((m, p) => ((m[p.pathway] = (m[p.pathway] || 0) + 1), m), {}),
  cuban_pro_segment_signings: cubanPro.length,
  cuban_pro_in_primary_denominator: population.filter((p) => p.pathway === 'CUBAN_PRO').length,
}
check('CUBAN_PRO is not in the primary denominator', coverage.cuban_pro_in_primary_denominator === 0)
check('the CUBAN_PRO segment has 3 signings', coverage.cuban_pro_segment_signings === 3)

// ---- the legacy names the app and tests still reference -----------------------------------------------------------------------
const references = []
for (const dir of ['app', 'lib']) {
  for (const name of fs.readdirSync(path.join(root, dir), { recursive: true })) {
    const rel = path.join(dir, String(name)).split(path.sep).join('/')
    if (!/\.(js|mjs|jsx|ts|tsx)$/.test(rel) || !fs.statSync(path.join(root, rel)).isFile()) continue
    fs.readFileSync(path.join(root, rel), 'utf8').split('\n').forEach((line, i) => {
      if (/v_player_trainers|v_dodgers_trainer_network|player_trainers|\btrainers\b/.test(line)) references.push(`${rel}:${i + 1}`)
    })
  }
}
await ch.close()

const report = {
  audited_against: 'canonical replay 001-028 (in memory)',
  baseline: { tables: totals.tables, views: totals.views },
  legacy,
  seed: counts,
  per_player: perPlayer,
  coverage,
  app_references_to_legacy_trainer_objects: references.sort(),
  failures,
}
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (failures.length) { console.error(`audit failed (${failures.length})`); process.exit(1) }
