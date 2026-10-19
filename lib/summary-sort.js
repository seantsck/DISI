// URL-backed sorting for the two /markets summary tables. Each table has its own parameter pair
// (market_sort / market_dir, pathway_sort / pathway_dir) so sorting one never disturbs the other.
// With no parameters the rows keep the order the data layer returns (tracked signings, then label).

/** @typedef {'asc' | 'desc'} SortDir */

export const SUMMARY_COLUMNS = {
  label: { type: 'text' },
  tracked: { type: 'number', field: 'tracked_signings' },
  known_cost_count: { type: 'number', field: 'known_cost_count' },
  known_cost: { type: 'number', field: 'known_acquisition_cost_usd' },
  audited: { type: 'number', field: 'audited_outcomes' },
  verified_mlb: { type: 'number', field: 'verified_mlb_players' },
  verified_no_mlb: { type: 'number', field: 'verified_no_mlb' },
  not_audited: { type: 'number', field: 'not_audited' },
  bwar: { type: 'number', field: 'observed_career_bwar' },
}

export const SUMMARY_TABLES = {
  market: { sortParam: 'market_sort', dirParam: 'market_dir' },
  pathway: { sortParam: 'pathway_sort', dirParam: 'pathway_dir' },
}

const readParam = (params, name) => {
  const v = params?.[name]
  return Array.isArray(v) ? v[0] : v
}

/** First-click direction: text ascending, values descending. */
export const summaryInitialDir = (key) => (SUMMARY_COLUMNS[key].type === 'text' ? 'asc' : 'desc')

/** Parses one table's sort from search params; unknown columns fall back to the default (null). */
export function parseSummarySort(params, table) {
  const { sortParam, dirParam } = SUMMARY_TABLES[table]
  const key = readParam(params, sortParam)
  if (!key || !Object.hasOwn(SUMMARY_COLUMNS, key)) return null
  const dir = readParam(params, dirParam)
  return { key, dir: dir === 'asc' || dir === 'desc' ? dir : summaryInitialDir(key) }
}

/** The sort a header click switches to: reverse when already sorted by this column, otherwise the first direction. */
export function nextSummarySort(current, key) {
  if (current?.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: summaryInitialDir(key) }
}

/** Link query for sorting `table` by `key`, preserving every other query parameter (including the other table's sort). */
export function summarySortHref(pathname, params, table, key) {
  const { sortParam, dirParam } = SUMMARY_TABLES[table]
  const next = nextSummarySort(parseSummarySort(params, table), key)
  const q = new URLSearchParams()
  for (const [k, raw] of Object.entries(params ?? {})) {
    if (k === sortParam || k === dirParam) continue
    for (const v of Array.isArray(raw) ? raw : [raw]) if (v != null) q.append(k, v)
  }
  q.set(sortParam, next.key)
  q.set(dirParam, next.dir)
  return `${pathname}?${q.toString()}`
}

const numberOrNull = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const textCompare = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0)

/**
 * Returns a sorted copy (the input is never mutated). Missing values (null / undefined / non-numeric) sort last in
 * either direction and are never treated as zero. Ties break on the label ascending, then on the original position.
 * @param {any[]} rows
 * @param {{ key: string, dir: SortDir } | null} sort
 * @param {(row: any) => string | null} labelFor
 */
export function sortSummaryRows(rows, sort, labelFor) {
  const copy = rows.slice()
  if (!sort) return copy
  const col = SUMMARY_COLUMNS[sort.key]
  const sign = sort.dir === 'asc' ? 1 : -1
  const value = (r) => (col.type === 'text' ? (labelFor(r) ?? null) : numberOrNull(r[col.field]))
  const decorated = copy.map((row, index) => ({ row, index, v: value(row), label: labelFor(row) ?? '' }))
  decorated.sort((x, y) => {
    const xm = x.v == null
    const ym = y.v == null
    if (xm !== ym) return xm ? 1 : -1
    if (!xm) {
      const c = col.type === 'text' ? textCompare(String(x.v), String(y.v)) : Number(x.v) - Number(y.v)
      if (c !== 0) return sign * c
    }
    return textCompare(x.label, y.label) || x.index - y.index
  })
  return decorated.map((d) => d.row)
}
