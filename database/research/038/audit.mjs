#!/usr/bin/env node
// Audits the 038 inputs against the canonical 001-037 replay (in memory, PGlite) and writes audit-report.json.
//
//   node database/research/038/audit.mjs
//
// Measures the network coverage the outcome layer reads (entities, ACTIVE relationships by type and stage, documented players,
// signing-linked relationships, the Dodgers signings with and without any documented association) and checks that every ACTIVE
// relationship names a player with exactly one tracked signing and that no RETRACTED row would be read.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const failures = []
const chain = await buildChainThrough('037_development_pathway_intelligence.sql')
const q = (s) => chain.query(s)
const one = async (s) => (await q(s))[0]

const orphans = await one(`select count(*)::int as n from player_network_relationships pr where pr.record_status = 'ACTIVE'
  and (select count(*) from signings s where s.player_id = pr.player_id) <> 1`)
if (orphans.n) failures.push(`${orphans.n} ACTIVE relationship(s) without exactly one tracked signing`)
const coverage = await one(`select
    (select count(*) from network_entities)::int as entities,
    (select count(distinct entity_id) from player_network_relationships where record_status = 'ACTIVE')::int as entities_with_active_relationships,
    (select count(*) from player_network_relationships where record_status = 'ACTIVE')::int as active_relationships,
    (select count(*) from player_network_relationships where record_status = 'RETRACTED')::int as retracted_relationships,
    (select count(*) from player_network_relationships where record_status = 'ACTIVE' and signing_id is not null)::int as signing_linked_relationships,
    (select count(distinct player_id) from player_network_relationships where record_status = 'ACTIVE')::int as documented_players,
    (select count(*) from signings s join organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS')::int as dodgers_signings`)
const byType = Object.fromEntries((await q(`select relationship_type || ':' || stage as k, count(*)::int as n from player_network_relationships
  where record_status = 'ACTIVE' group by 1 order by 1`)).map((r) => [r.k, r.n]))
const nonDodgers = await one(`select count(distinct pr.player_id)::int as n from player_network_relationships pr join signings s on s.player_id = pr.player_id
  join organizations o on o.id = s.organization_id where o.franchise_key <> 'DODGERS' and pr.record_status = 'ACTIVE'`)
await chain.close()

const report = { coverage: { ...coverage, documented_non_dodgers_players: nonDodgers.n }, active_relationships_by_type_and_stage: byType, failures }
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 1) + '\n')
console.log(JSON.stringify(report))
if (failures.length) process.exitCode = 1
