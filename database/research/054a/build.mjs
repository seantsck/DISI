#!/usr/bin/env node
// Assembles database/sql/054a_development_queue_performance.sql and database/release/sql/rollback-054a.sql from:
//   054a_template.sql / rollback_template.sql   hand-written guards and postconditions
//   database/sql/054_...sql                     the 054 research-queue view, read from its frozen file: the 054a view is that text with only
//                                               `with team_stints as (` replaced by `with team_stints as not materialized (`, and the rollback
//                                               restores the 054 statement byte for byte
//
//   node database/research/054a/build.mjs
//
// Deterministic: the same inputs always produce the same files.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => fs.readFileSync(path.resolve(here, f), 'utf8').replace(/\r\n/g, '\n')
const need = (cond, msg) => { if (!cond) throw new Error(msg) }

export const HEADER = 'create or replace view public.v_dodgers_development_research_queue\nwith (security_invoker = true)\nas\n'
export const BEFORE = 'with team_stints as ('
export const AFTER = 'with team_stints as not materialized ('

/** The 054 research-queue statement, from the frozen 054 file, and the 054a statement derived from it. */
export function queueViews(sql054) {
  const start = sql054.indexOf(HEADER)
  const end = sql054.indexOf('\n-- ===========================================================================\n-- 6. POSTCONDITIONS')
  need(start > 0 && end > start, 'the 054 research-queue view')
  const view054 = sql054.slice(start, end).replace(/\n+$/, '')
  need(view054.endsWith(';') && !/;\n/.test(view054) && !/^(create|grant|revoke|comment|alter|drop)\b/m.test(view054.slice(HEADER.length)), 'the 054 view is one statement')
  need(view054.split(BEFORE).length === 2, 'the 054 view names team_stints once, as its first CTE')
  need(view054.slice(HEADER.length).startsWith(BEFORE), 'team_stints is the first CTE')
  need(!view054.includes('materialized'), 'the 054 view carries no materialization hint')
  need(view054.includes('progression as (\n'), 'the 054 progression CTE')
  const view054a = view054.replace(BEFORE, AFTER)
  const query = (v) => v.slice(HEADER.length, -1)
  return { view054, view054a, query054: query(view054), query054a: query(view054a) }
}

const fill = (template, values) => {
  let out = template
  for (const [k, val] of Object.entries(values)) out = out.split(`{{${k}}}`).join(val)
  need(!/\{\{\w+\}\}/.test(out), 'unreplaced placeholder')
  return out
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const v = queueViews(read('../../sql/054_full_career_transaction_history.sql'))
  const values = { queue_query_054: v.query054, queue_query_054a: v.query054a, queue_view_054: v.view054, queue_view_054a: v.view054a }
  const sql = fill(read('054a_template.sql'), values)
  const dest = path.join(here, '../../sql/054a_development_queue_performance.sql')
  fs.writeFileSync(dest, sql)
  process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
  const rollback = fill(read('rollback_template.sql'), values)
  const rdest = path.join(here, '../../release/sql/rollback-054a.sql')
  fs.writeFileSync(rdest, rollback)
  process.stderr.write(`wrote ${path.relative(process.cwd(), rdest)} (${rollback.split('\n').length - 1} lines)\n`)
}
