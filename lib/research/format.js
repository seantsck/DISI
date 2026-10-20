// Deterministic output for the research commands: stable key order, no timestamps, no locale-dependent formatting.

const cell = (v) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(';') : typeof v === 'object' ? JSON.stringify(v) : String(v))

/** Fixed-width text table. @param {Record<string, any>[]} rows @param {string[]} columns */
export function textTable(rows, columns) {
  const w = columns.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)))
  const line = (vals) => vals.map((v, i) => v.padEnd(w[i])).join('  ').trimEnd()
  return [line(columns), line(w.map((x) => '-'.repeat(x))), ...rows.map((r) => line(columns.map((c) => cell(r[c]))))].join('\n')
}

export function csv(rows, columns) {
  const q = (v) => { const s = cell(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [columns.join(','), ...rows.map((r) => columns.map((c) => q(r[c])).join(','))].join('\n')
}

/** JSON with recursively sorted keys. */
export function stableJson(value) {
  const sort = (v) => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v
  return JSON.stringify(sort(value), null, 2)
}
