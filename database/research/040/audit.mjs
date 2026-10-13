#!/usr/bin/env node
// Audits the 040 inputs against the canonical 001-039 replay (in memory, PGlite) and writes audit-report.json.
//
//   node database/research/040/audit.mjs
//
// Measures how many signings can be placed in an archetype (position at signing and age known) and how many earlier, non-outcome-
// selected signings share each signing's route and position family (the comparable pool before ranking).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const failures = []
const chain = await buildChainThrough('039_market_pathway_intelligence.sql')
const q = (s) => chain.query(s)

const features = (await q(`select count(*)::int as n, count(*) filter (where has_age and has_position)::int as archetype_defined,
  count(*) filter (where position_family = 'POSITION_UNKNOWN')::int as position_unknown from v_signing_time_features`))[0]
const pools = await q(`select t.population_class, count(*)::int as targets,
    count(*) filter (where pool >= 5)::int as with_5_plus, count(*) filter (where pool >= 20)::int as with_20_plus
  from (select t.signing_id, t.population_class,
          (select count(*) from v_signing_time_features c where c.signing_route = t.signing_route and c.position_family = t.position_family
             and c.signing_year < t.signing_year and c.population_class <> 'OUTCOME_SELECTED_SAMPLE')::int as pool
        from v_signing_time_features t where t.position_family <> 'POSITION_UNKNOWN') t
  group by 1 order by 1`)
if (features.n !== (await q('select count(*)::int as n from signings'))[0].n) failures.push('feature rows do not cover the signings')
await chain.close()

const report = { features, comparable_pools_by_target_population: pools, failures }
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 1) + '\n')
console.log(JSON.stringify(report))
if (failures.length) process.exitCode = 1
