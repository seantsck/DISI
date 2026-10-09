// Config-driven, URL-backed table state for server-side sorting, filtering and
// pagination. Sorting and filtering run in Postgres (via PostgREST), so dates
// sort as dates, money and bWAR as numbers, and NULLs are always placed last
// instead of being coerced to zero.

import { searchTokens } from './text.js'

/**
 * @typedef {'text'|'number'|'date'|'money'|'boolean'} ColumnType
 * @typedef {{ column: string, type: ColumnType }} SortDef
 * @typedef {'asc'|'desc'} SortDir
 * @typedef {{ key: string, dir: SortDir, isDefault: boolean }} SortState
 *
 * @typedef {{ kind: 'search', column: string }} SearchFilter
 * @typedef {{ kind: 'scope', options: Record<string, { column: string, value: boolean } | null>, default: string }} ScopeFilter
 * @typedef {{ kind: 'year', column: string, op: 'eq'|'gte'|'lte' }} YearFilter
 * @typedef {{ kind: 'value', column: string }} ValueFilter
 * @typedef {{ kind: 'enum', column: string, values: string[] }} EnumFilter
 * @typedef {{ kind: 'contains', column: string }} ContainsFilter
 * @typedef {{ kind: 'tristate', column: string }} TristateFilter
 * @typedef {{ kind: 'bool', column: string }} BoolFilter
 * @typedef {SearchFilter|ScopeFilter|YearFilter|ValueFilter|EnumFilter|ContainsFilter|TristateFilter|BoolFilter} FilterDef
 *
 * @typedef {{
 *   pageSize: number,
 *   sorts: Record<string, SortDef>,
 *   defaultSort: { key: string, dir: SortDir },
 *   tiebreak: { column: string, ascending: boolean }[],
 *   filters: Record<string, FilterDef>
 * }} TableSpec
 *
 * @typedef {{ sort: SortState, page: number, filters: Record<string, string> }} TableState
 */

/** Value used in URLs for "field is unknown / NULL". */
export const NONE = '__none'

const YEAR_MIN = 1800
const YEAR_MAX = 2100
const MAX_VALUE_LENGTH = 80

/**
 * @param {Record<string, string | string[] | undefined> | URLSearchParams | undefined} params
 * @param {string} name
 */
function readParam(params, name) {
  if (!params) return undefined
  if (params instanceof URLSearchParams) return params.get(name) ?? undefined
  const raw = params[name]
  return Array.isArray(raw) ? raw[0] : raw
}

/** @param {string | undefined} raw */
function parseYear(raw) {
  if (!raw || !/^\d{4}$/.test(raw)) return undefined
  const n = Number(raw)
  return n >= YEAR_MIN && n <= YEAR_MAX ? n : undefined
}

/** Default first-click direction: text ascending, values descending. */
export function initialDir(/** @type {ColumnType} */ type) {
  return type === 'text' ? 'asc' : 'desc'
}

/**
 * Parses and validates URL query parameters into table state. Unknown sort
 * keys, malformed years and unrecognised enum values are discarded.
 * @param {TableSpec} spec
 * @param {Record<string, string | string[] | undefined> | URLSearchParams | undefined} params
 * @returns {TableState}
 */
export function parseTableState(spec, params) {
  /** @type {Record<string, string>} */
  const filters = {}

  for (const [name, def] of Object.entries(spec.filters)) {
    const raw = readParam(params, name)?.trim()
    if (def.kind === 'scope') {
      filters[name] = raw && raw in def.options ? raw : def.default
      continue
    }
    if (!raw) continue
    switch (def.kind) {
      case 'search':
        if (searchTokens(raw).length) filters[name] = raw.slice(0, MAX_VALUE_LENGTH)
        break
      case 'year': {
        const year = parseYear(raw)
        if (year !== undefined) filters[name] = String(year)
        break
      }
      case 'enum':
        if (def.values.includes(raw)) filters[name] = raw
        break
      case 'tristate':
        if (raw === 'yes' || raw === 'no' || raw === 'unknown') filters[name] = raw
        break
      case 'bool':
        if (raw === 'yes' || raw === 'no') filters[name] = raw
        break
      default:
        if (raw.length <= MAX_VALUE_LENGTH) filters[name] = raw
    }
  }

  // A reversed year range is swapped rather than silently returning nothing.
  const yearRange = Object.entries(spec.filters).filter(([, d]) => d.kind === 'year')
  const minName = yearRange.find(([, d]) => d.kind === 'year' && d.op === 'gte')?.[0]
  const maxName = yearRange.find(([, d]) => d.kind === 'year' && d.op === 'lte')?.[0]
  if (minName && maxName && filters[minName] && filters[maxName] && Number(filters[minName]) > Number(filters[maxName])) {
    ;[filters[minName], filters[maxName]] = [filters[maxName], filters[minName]]
  }

  const sortKey = readParam(params, 'sort')
  const dirRaw = readParam(params, 'dir')
  /** @type {SortState} */
  let sort = { ...spec.defaultSort, isDefault: true }
  if (sortKey && spec.sorts[sortKey]) {
    const dir = dirRaw === 'asc' || dirRaw === 'desc' ? dirRaw : initialDir(spec.sorts[sortKey].type)
    sort = { key: sortKey, dir, isDefault: sortKey === spec.defaultSort.key && dir === spec.defaultSort.dir }
  }

  const pageRaw = Number(readParam(params, 'page'))
  const page = Number.isInteger(pageRaw) && pageRaw > 1 && pageRaw < 100000 ? pageRaw : 1

  return { sort, page, filters }
}

/**
 * Serialises state back to query parameters, omitting defaults so URLs stay
 * short and canonical.
 * @param {TableSpec} spec
 * @param {TableState} state
 */
export function serializeTableState(spec, state) {
  const out = new URLSearchParams()
  for (const [name, def] of Object.entries(spec.filters)) {
    const value = state.filters[name]
    if (value == null || value === '') continue
    if (def.kind === 'scope' && value === def.default) continue
    out.set(name, value)
  }
  if (!state.sort.isDefault) {
    out.set('sort', state.sort.key)
    out.set('dir', state.sort.dir)
  }
  if (state.page > 1) out.set('page', String(state.page))
  return out
}

/**
 * @param {string} pathname
 * @param {TableSpec} spec
 * @param {TableState} state
 * @param {{ sort?: SortState, page?: number, filters?: Record<string, string | null> }} [patch]
 */
export function tableHref(pathname, spec, state, patch = {}) {
  /** @type {Record<string, string>} */
  const filters = { ...state.filters }
  for (const [k, v] of Object.entries(patch.filters ?? {})) {
    if (v == null || v === '') delete filters[k]
    else filters[k] = v
  }
  const changedQuery = Boolean(patch.filters || patch.sort)
  const next = {
    sort: patch.sort ?? state.sort,
    page: patch.page ?? (changedQuery ? 1 : state.page),
    filters,
  }
  const qs = serializeTableState(spec, next).toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/**
 * The state a column header link should switch to: toggles direction when
 * the column is already sorted, otherwise uses the column's first direction.
 * @param {TableSpec} spec
 * @param {TableState} state
 * @param {string} key
 * @returns {SortState}
 */
export function nextSort(spec, state, key) {
  const def = spec.sorts[key]
  const dir = state.sort.key === key ? (state.sort.dir === 'asc' ? 'desc' : 'asc') : initialDir(def.type)
  return { key, dir, isDefault: key === spec.defaultSort.key && dir === spec.defaultSort.dir }
}

/**
 * Applies filters, ordering and the page range to a PostgREST query builder.
 * Accepts any object exposing the supabase-js filter methods used here.
 * @template Q
 * @param {Q} query
 * @param {TableSpec} spec
 * @param {TableState} state
 * @returns {Q}
 */
export function applyTableQuery(query, spec, state) {
  /** @type {any} */
  let q = query
  for (const [name, def] of Object.entries(spec.filters)) {
    const value = state.filters[name]
    if (value == null) continue
    switch (def.kind) {
      case 'search':
        for (const token of searchTokens(value)) q = q.ilike(def.column, `%${token}%`)
        break
      case 'scope': {
        const option = def.options[value]
        if (option) q = q.eq(option.column, option.value)
        break
      }
      case 'year':
        q = q[def.op](def.column, Number(value))
        break
      case 'value':
      case 'enum':
        q = value === NONE ? q.is(def.column, null) : q.eq(def.column, value)
        break
      case 'contains':
        q = q.filter(def.column, 'cs', `{"${value.replace(/["\\]/g, (c) => `\\${c}`)}"}`)
        break
      case 'tristate':
        q = value === 'unknown' ? q.is(def.column, null) : q.eq(def.column, value === 'yes')
        break
      case 'bool':
        q = q.eq(def.column, value === 'yes')
        break
    }
  }

  const primary = spec.sorts[state.sort.key]
  q = q.order(primary.column, { ascending: state.sort.dir === 'asc', nullsFirst: false })
  for (const t of spec.tiebreak) {
    if (t.column !== primary.column) q = q.order(t.column, { ascending: t.ascending, nullsFirst: false })
  }

  const from = (state.page - 1) * spec.pageSize
  return q.range(from, from + spec.pageSize - 1)
}

/** @param {TableState} state */
export function activeFilterCount(state, /** @type {TableSpec} */ spec) {
  return Object.entries(state.filters).filter(([name, value]) => {
    const def = spec.filters[name]
    return def && !(def.kind === 'scope' && value === def.default)
  }).length
}
