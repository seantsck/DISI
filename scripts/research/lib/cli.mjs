import { parseArgs } from '../../mlb/lib/args.mjs'
import { csv, stableJson, textTable } from '../../../lib/research/format.js'

export { parseArgs }

/** Prints rows in the requested format: --format text (default) | json | csv. */
export function emit(args, { rows, columns, summary, title }) {
  const format = String(args.format || 'text')
  if (format === 'json') { console.log(stableJson({ summary, rows })); return }
  if (format === 'csv') { console.log(csv(rows, columns)); return }
  if (title) console.log(`${title}\n`)
  if (summary) console.log(Object.entries(summary).map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`).join('\n') + '\n')
  console.log(rows.length ? textTable(rows, columns) : '(no rows)')
}

export function run(main) {
  main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1) })
}

export const int = (v) => (v === undefined || v === true ? undefined : Number(v))
