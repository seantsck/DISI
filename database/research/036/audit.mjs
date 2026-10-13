#!/usr/bin/env node
// Audits the 036 research inputs against the canonical 001-035 replay (in memory, PGlite) and writes audit-report.json.
//
//   node database/research/036/audit.mjs
//
// Measures the expectation coverage the bands will read (every ACTIVE external rank / FV observation by publication and measure),
// checks that every band family names an existing publication, scope or scale, that the bands of a family neither overlap nor leave
// a recorded observation of that family's measure unbanded, and that the outcome spine can key on one signing per player.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const bands = JSON.parse(fs.readFileSync(path.join(here, 'bands.json'), 'utf8'))
const failures = []

const chain = await buildChainThrough('035_international_benchmark_outcomes.sql')
const q = (s, p) => chain.query(s, p)

const observations = await q(`
  select sp.publication_slug, 'RANK' as measure, r.ranking_scope as scope, r.list_size, r.rank::numeric as value
  from player_evaluations e join scouting_publications sp on sp.id = e.publication_id join player_evaluation_rankings r on r.evaluation_id = e.id
  where e.record_status = 'ACTIVE' and sp.origin in ('EXTERNAL', 'TEAM_PUBLIC')
  union all
  select sp.publication_slug, 'GRADE', g.scale_code || ':' || g.dimension_code || ':' || g.temporal_basis, null, g.raw_value
  from player_evaluations e join scouting_publications sp on sp.id = e.publication_id join player_evaluation_grades g on g.evaluation_id = e.id
  where e.record_status = 'ACTIVE' and sp.origin in ('EXTERNAL', 'TEAM_PUBLIC') and g.dimension_code = 'OVERALL' and g.temporal_basis = 'FUTURE' and g.raw_value is not null
  order by 1, 2, 3, 5`)

const publications = new Set((await q('select publication_slug from scouting_publications')).map((r) => r.publication_slug))
const scales = new Set((await q('select scale_code from evaluation_scales')).map((r) => r.scale_code))
const familyCoverage = []
const banded = new Set()
for (const f of bands.families) {
  if (!publications.has(f.publication_slug)) failures.push(`${f.band_family}: unknown publication ${f.publication_slug}`)
  if (f.measure === 'GRADE' && !scales.has(f.scale_code)) failures.push(`${f.band_family}: unknown scale ${f.scale_code}`)
  const scope = f.measure === 'RANK' ? f.ranking_scope : `${f.scale_code}:${f.dimension_code}:${f.temporal_basis}`
  const sorted = [...f.bands].sort((a, b) => a.band_order - b.band_order)
  sorted.forEach((b, i) => {
    if (b.band_order !== i + 1) failures.push(`${f.band_family}: band orders are not 1..n`)
    if (b.upper_value !== null && b.upper_value < b.lower_value) failures.push(`${b.band_code}: empty range`)
    for (const c of sorted.slice(i + 1)) {
      if (b.lower_value <= (c.upper_value ?? Infinity) && c.lower_value <= (b.upper_value ?? Infinity)) failures.push(`${b.band_code} overlaps ${c.band_code}`)
    }
  })
  const mine = observations.filter((o) => o.publication_slug === f.publication_slug && o.measure === f.measure && o.scope === scope)
  const counts = {}
  for (const o of mine) {
    if (f.required_list_size && o.list_size !== f.required_list_size) continue
    const b = sorted.find((x) => Number(o.value) >= x.lower_value && (x.upper_value === null || Number(o.value) <= x.upper_value))
    if (!b) { failures.push(`${f.band_family}: observation value ${o.value} falls in no band`); continue }
    counts[b.band_code] = (counts[b.band_code] ?? 0) + 1
    banded.add(o)
  }
  familyCoverage.push({ band_family: f.band_family, observations: mine.length, by_band: Object.fromEntries(sorted.filter((b) => counts[b.band_code]).map((b) => [b.band_code, counts[b.band_code]])) })
}
const unbanded = observations.filter((o) => !banded.has(o))
const multi = (await q('select count(*)::int as n from (select player_id from signings group by 1 having count(*) > 1) d'))[0].n
if (multi) failures.push(`${multi} player(s) have more than one signing`)
const spine = (await q(`select
    (select count(*) from signings)::int as signings,
    (select count(*) from v_player_organizational_realization)::int as dodgers_rows,
    (select count(*) from v_international_benchmark_player_outcomes)::int as benchmark_rows,
    (select max(audited_through_date)::text from outcome_audits) as analysis_as_of_date`))[0]
if (spine.dodgers_rows + spine.benchmark_rows !== spine.signings) failures.push('the 032-034 and 035 outcome layers do not partition the signings')
await chain.close()

const report = {
  observations: observations.length,
  observations_by_publication: Object.fromEntries([...new Set(observations.map((o) => o.publication_slug))].sort().map((p) => [p, observations.filter((o) => o.publication_slug === p).length])),
  bands: bands.families.reduce((n, f) => n + f.bands.length, 0),
  family_coverage: familyCoverage,
  unbanded_observations: unbanded.length,
  spine,
  failures,
}
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 1) + '\n')
console.log(JSON.stringify(report))
if (failures.length) process.exitCode = 1
