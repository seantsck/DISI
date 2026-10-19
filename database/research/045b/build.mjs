#!/usr/bin/env node
// Assembles database/sql/045b_database_status_snapshot.sql from 045b_template.sql and snapshots.mjs, reusing the 045a generators so
// the refresh / drift functions of 045a and 045b can differ only by the eleventh snapshot and its validation rule.
//
//   node database/research/045b/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tables, refreshFunction, driftFunction } from '../045a/build.mjs'
import { ALL_SNAPSHOTS, STATUS_SNAPSHOT, NEWLY_INTERNAL_VIEWS, SERVING_FUNCTIONS } from './snapshots.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

// the status snapshot is one row and describes the same generation as the executive snapshot (derived from the snapshots themselves)
const VALIDATION = [
  `case when (select count(*) from public.product_database_status) <> 1 then 'status snapshot is not one row' end`,
  `case when exists (select 1 from e join public.product_database_status s on s.tracked_signings is distinct from e.dodgers_signings) then 'status snapshot disagrees with the executive snapshot' end`,
]

function contract() {
  const s = STATUS_SNAPSHOT
  return `delete from public.disi_product_contract where relation_name in (${NEWLY_INTERNAL_VIEWS.map(lit).join(', ')});
insert into public.disi_product_contract (relation_name, relation_kind, product_area, contract_tier, app_routes, purpose, introduced_in) values
  (${lit(s.table)}, 'TABLE', ${lit(s.area)}, ${lit(s.tier)}, array[${s.routes.map(lit).join(', ')}], ${lit(s.purpose)}, '045b')
on conflict (relation_name) do nothing;`
}

function firewall() {
  return `do $$\ndeclare v text;\nbegin\n  foreach v in array array[${NEWLY_INTERNAL_VIEWS.map(lit).join(', ')}] loop\n    execute format('revoke all on public.%I from anon, authenticated', v);\n  end loop;\nend $$;`
}

/** The migration SQL. */
export function assemble() {
  let sql = fs.readFileSync(path.join(here, '045b_template.sql'), 'utf8').replace(/\r\n/g, '\n')
  const parts = {
    tables: tables([STATUS_SNAPSHOT], '045b'),
    refresh_function: refreshFunction(ALL_SNAPSHOTS, { migration: '045b', validation: VALIDATION }),
    drift_function: driftFunction(ALL_SNAPSHOTS, '045b'),
    contract: contract(), firewall: firewall(),
    newly_internal_views: NEWLY_INTERNAL_VIEWS.map(lit).join(', '),
    serving_functions: SERVING_FUNCTIONS.map(lit).join(', '),
  }
  for (const [k, v] of Object.entries(parts)) {
    if (!sql.includes(`{{${k}}}`)) throw new Error(`template has no {{${k}}}`)
    sql = sql.split(`{{${k}}}`).join(v)
  }
  if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')
  return sql
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  const sql = assemble()
  const dest = path.join(here, '../../sql/045b_database_status_snapshot.sql')
  fs.writeFileSync(dest, sql)
  process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
}
