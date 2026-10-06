import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTableState, serializeTableState, tableHref, nextSort, applyTableQuery, initialDir, activeFilterCount, NONE,
} from '../../lib/table-state.js'
import { SIGNINGS_SPEC, PLAYERS_SPEC } from '../../lib/specs.js'

/** Records every supabase-js builder call so query construction can be asserted. */
function fakeBuilder() {
  const calls = []
  const handler = {
    get(target, prop) {
      if (prop === 'calls') return calls
      return (...args) => { calls.push([prop, ...args]); return proxy }
    },
  }
  const proxy = new Proxy({}, handler)
  return proxy
}

test('defaults: signing year descending, Dodgers scope, page 1', () => {
  const state = parseTableState(SIGNINGS_SPEC, {})
  assert.deepEqual(state.sort, { key: 'year', dir: 'desc', isDefault: true })
  assert.equal(state.page, 1)
  assert.deepEqual(state.filters, { org_scope: 'dodgers' })
})

test('unknown sort keys and directions fall back safely', () => {
  assert.equal(parseTableState(SIGNINGS_SPEC, { sort: 'drop table' }).sort.key, 'year')
  const s = parseTableState(SIGNINGS_SPEC, { sort: 'player', dir: 'sideways' })
  assert.deepEqual(s.sort, { key: 'player', dir: 'asc', isDefault: false })
  assert.equal(parseTableState(SIGNINGS_SPEC, { sort: 'bwar' }).sort.dir, 'desc')
})

test('first-click direction depends on column type', () => {
  assert.equal(initialDir('text'), 'asc')
  assert.equal(initialDir('money'), 'desc')
  assert.equal(initialDir('date'), 'desc')
  assert.equal(initialDir('number'), 'desc')
})

test('filters are validated', () => {
  const state = parseTableState(SIGNINGS_SPEC, {
    year: '19x1', year_min: '2025', year_max: '2015', audit: 'MAYBE', mlb: 'unknown',
    dodgers_debut: 'perhaps', org_scope: 'mars', market: 'Venezuela', page: '-4', q: '%%%',
  })
  assert.equal(state.filters.year, undefined)
  assert.equal(state.filters.year_min, '2015', 'reversed range is swapped')
  assert.equal(state.filters.year_max, '2025')
  assert.equal(state.filters.audit, undefined)
  assert.equal(state.filters.mlb, 'unknown')
  assert.equal(state.filters.dodgers_debut, undefined)
  assert.equal(state.filters.org_scope, 'dodgers')
  assert.equal(state.filters.market, 'Venezuela')
  assert.equal(state.filters.q, undefined, 'a query with no searchable tokens is dropped')
  assert.equal(state.page, 1)
})

test('array-valued params use the first value; URLSearchParams also works', () => {
  assert.equal(parseTableState(SIGNINGS_SPEC, { market: ['Cuba', 'Japan'] }).filters.market, 'Cuba')
  assert.equal(parseTableState(SIGNINGS_SPEC, new URLSearchParams('sort=date&dir=asc')).sort.key, 'date')
})

test('serialization omits defaults and round-trips', () => {
  const state = parseTableState(SIGNINGS_SPEC, { sort: 'cost', dir: 'desc', market: 'Cuba', page: '3', org_scope: 'all' })
  const qs = serializeTableState(SIGNINGS_SPEC, state).toString()
  assert.equal(qs, 'org_scope=all&market=Cuba&sort=cost&dir=desc&page=3')
  assert.deepEqual(parseTableState(SIGNINGS_SPEC, new URLSearchParams(qs)), state)
  assert.equal(serializeTableState(SIGNINGS_SPEC, parseTableState(SIGNINGS_SPEC, {})).toString(), '')
})

test('changing a filter or sort resets to page 1', () => {
  const state = parseTableState(SIGNINGS_SPEC, { page: '4', market: 'Cuba' })
  assert.equal(tableHref('/signings', SIGNINGS_SPEC, state, { filters: { position: 'SS' } }), '/signings?market=Cuba&position=SS')
  assert.equal(tableHref('/signings', SIGNINGS_SPEC, state, { filters: { market: null } }), '/signings')
  assert.equal(tableHref('/signings', SIGNINGS_SPEC, state, { page: 5 }), '/signings?market=Cuba&page=5')
})

test('header links toggle the active column and start new columns at their first direction', () => {
  const state = parseTableState(SIGNINGS_SPEC, {})
  assert.deepEqual(nextSort(SIGNINGS_SPEC, state, 'year'), { key: 'year', dir: 'asc', isDefault: false })
  assert.deepEqual(nextSort(SIGNINGS_SPEC, state, 'player'), { key: 'player', dir: 'asc', isDefault: false })
  const byYearAsc = parseTableState(SIGNINGS_SPEC, { sort: 'year', dir: 'asc' })
  assert.deepEqual(nextSort(SIGNINGS_SPEC, byYearAsc, 'year'), { key: 'year', dir: 'desc', isDefault: true })
})

test('query: default order is signing year desc, then player name asc, nulls last', () => {
  const q = applyTableQuery(fakeBuilder(), SIGNINGS_SPEC, parseTableState(SIGNINGS_SPEC, {}))
  assert.deepEqual(q.calls, [
    ['eq', 'is_dodgers_franchise', true],
    ['order', 'signing_year', { ascending: false, nullsFirst: false }],
    ['order', 'player_sort_name', { ascending: true, nullsFirst: false }],
    ['order', 'signing_id', { ascending: true, nullsFirst: false }],
    ['range', 0, 49],
  ])
})

test('query: sorting by player does not duplicate the tiebreak column', () => {
  const q = applyTableQuery(fakeBuilder(), SIGNINGS_SPEC, parseTableState(SIGNINGS_SPEC, { sort: 'player', dir: 'desc', org_scope: 'all' }))
  assert.deepEqual(q.calls.filter((c) => c[0] === 'order').map((c) => c[1]), ['player_sort_name', 'signing_id'])
  assert.equal(q.calls.find((c) => c[0] === 'eq'), undefined, 'all-organization scope adds no filter')
})

test('query: typed filters map to the right PostgREST operators', () => {
  const state = parseTableState(SIGNINGS_SPEC, {
    q: 'Pedro Martínez', year_min: '1980', year_max: '1999', market: NONE, mlb: 'unknown',
    dodgers_debut: 'no', audit: 'VERIFIED_MLB', page: '2',
  })
  const calls = applyTableQuery(fakeBuilder(), SIGNINGS_SPEC, state).calls
  assert.deepEqual(calls.filter((c) => c[0] === 'ilike'), [['ilike', 'search_text', '%pedro%'], ['ilike', 'search_text', '%martinez%']])
  assert.ok(calls.some((c) => c[0] === 'gte' && c[1] === 'signing_year' && c[2] === 1980))
  assert.ok(calls.some((c) => c[0] === 'lte' && c[1] === 'signing_year' && c[2] === 1999))
  assert.ok(calls.some((c) => c[0] === 'is' && c[1] === 'country_market' && c[2] === null), 'unknown market is IS NULL, never empty string')
  assert.ok(calls.some((c) => c[0] === 'is' && c[1] === 'reached_mlb_verified' && c[2] === null), 'unknown MLB status is IS NULL, never false')
  assert.ok(calls.some((c) => c[0] === 'eq' && c[1] === 'direct_dodgers_franchise_debut' && c[2] === false))
  assert.ok(calls.some((c) => c[0] === 'eq' && c[1] === 'outcome_audit_status' && c[2] === 'VERIFIED_MLB'))
  assert.deepEqual(calls.at(-1), ['range', 50, 99])
})

test('query: array containment quotes values', () => {
  const state = parseTableState(PLAYERS_SPEC, { market: 'Dominican "Republic"' })
  const call = applyTableQuery(fakeBuilder(), PLAYERS_SPEC, state).calls.find((c) => c[0] === 'filter')
  assert.deepEqual(call, ['filter', 'signing_markets', 'cs', '{"Dominican \\"Republic\\""}'])
})

test('activeFilterCount ignores the default scope', () => {
  assert.equal(activeFilterCount(parseTableState(SIGNINGS_SPEC, {}), SIGNINGS_SPEC), 0)
  assert.equal(activeFilterCount(parseTableState(SIGNINGS_SPEC, { org_scope: 'all', market: 'Cuba' }), SIGNINGS_SPEC), 2)
})

test('every sort column and filter references a column name, not an expression', () => {
  for (const spec of [SIGNINGS_SPEC, PLAYERS_SPEC]) {
    for (const def of Object.values(spec.sorts)) assert.match(def.column, /^[a-z_]+$/)
    for (const def of Object.values(spec.filters)) if ('column' in def) assert.match(def.column, /^[a-z_]+$/)
    assert.ok(spec.sorts[spec.defaultSort.key])
  }
})
