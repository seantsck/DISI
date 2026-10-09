// Deterministic research artifacts: object keys are sorted, records are sorted
// by an explicit key, and every artifact states what produced it.

import fs from 'node:fs'
import path from 'node:path'

/** JSON with recursively sorted object keys and 2-space indentation. */
export function stableStringify(value) {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
    }
    return v
  }
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`
}

/** Sorts records by one or more keys (strings compared with localeCompare 'en'). */
export function sortRecords(records, keys) {
  return [...records].sort((a, b) => {
    for (const k of keys) {
      const x = a[k], y = b[k]
      if (x === y) continue
      if (x == null) return 1
      if (y == null) return -1
      if (typeof x === 'number' && typeof y === 'number') return x - y
      const c = String(x).localeCompare(String(y), 'en')
      if (c) return c
    }
    return 0
  })
}

const csvCell = (v) => {
  if (v == null) return ''
  const s = Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(records, columns) {
  return [columns.join(','), ...records.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'
}

/**
 * Writes `<name>.json` (and `<name>.csv` when columns are given).
 * The artifact meta block records the command, parameters and endpoints, not a
 * wall-clock timestamp, so reruns over the same cache are byte-identical.
 * Per-record retrieval timestamps live in each record's `sources`.
 */
export function writeArtifact(dir, name, { meta, records, columns, sortKeys }) {
  fs.mkdirSync(dir, { recursive: true })
  const sorted = sortKeys ? sortRecords(records, sortKeys) : records
  const json = path.join(dir, `${name}.json`)
  fs.writeFileSync(json, stableStringify({ meta, records: sorted }))
  const written = [json]
  if (columns) {
    const csv = path.join(dir, `${name}.csv`)
    fs.writeFileSync(csv, toCsv(sorted, columns))
    written.push(csv)
  }
  return written
}
