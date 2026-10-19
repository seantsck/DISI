// Table UX: synchronized top scrollbar (ScrollableTable) and URL-backed /markets sorting.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncScrollLeft, measureOverflow } from '../../lib/scroll-sync.js'
import {
  parseSummarySort, nextSummarySort, summarySortHref, sortSummaryRows, SUMMARY_COLUMNS, SUMMARY_TABLES,
} from '../../lib/summary-sort.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

// ---- scrollbar ------------------------------------------------------------------------------------------------------

test('/signings and /players wrap their table in ScrollableTable instead of a bare table-scroll div', () => {
  for (const f of ['app/signings/page.js', 'app/players/page.js']) {
    const src = read(f)
    assert.match(src, /import ScrollableTable from '..\/components\/ScrollableTable'/, f)
    assert.match(src, /<ScrollableTable label="[^"]+">[\s\S]*<table className="research-table">[\s\S]*<\/table>\s*<\/ScrollableTable>/, f)
    assert.doesNotMatch(src, /<div className="table-scroll">/, f)
  }
})

test('ScrollableTable renders a top track and keeps the native table-scroll container; the table is not cloned', () => {
  const src = read('app/components/ScrollableTable.js')
  assert.match(src, /className=\{`table-scroll-top/)
  assert.match(src, /className="table-scroll"/)
  assert.equal((src.match(/\{children\}/g) ?? []).length, 1)
  assert.match(src, /ResizeObserver/)
  assert.match(src, /inactive/)
  assert.match(src, /aria-hidden="true"/)
})

test('sticky first columns are untouched: the table keeps its own markup and the container still scrolls', () => {
  assert.match(read('app/globals.css'), /\.table-scroll\{overflow:auto/)
  assert.match(read('app/globals.css'), /\.table-scroll-top\.inactive\{display:none\}/)
})

test('syncScrollLeft mirrors the position, ignores equal positions and cannot loop', () => {
  const top = { scrollLeft: 0 }
  const body = { scrollLeft: 120 }
  assert.equal(syncScrollLeft(body, top), true)
  assert.equal(top.scrollLeft, 120)
  // the resulting echo event from the target finds equal positions and does nothing
  assert.equal(syncScrollLeft(top, body), false)
  assert.equal(syncScrollLeft({ scrollLeft: 120.3 }, body), false)
  assert.equal(syncScrollLeft(null, body), false)
  assert.equal(syncScrollLeft(body, undefined), false)
})

test('measureOverflow: the track is needed only when the content is wider than the container', () => {
  assert.deepEqual(measureOverflow({ scrollWidth: 1800, clientWidth: 900 }), { contentWidth: 1800, overflowing: true })
  assert.deepEqual(measureOverflow({ scrollWidth: 900, clientWidth: 900 }), { contentWidth: 900, overflowing: false })
  assert.equal(measureOverflow({ scrollWidth: 900.4, clientWidth: 900 }).overflowing, false)
  assert.deepEqual(measureOverflow(null), { contentWidth: 0, overflowing: false })
})

// ---- markets sorting ------------------------------------------------------------------------------------------------

const labelFor = (r) => r.name
const rows = [
  { name: 'Dominican Republic', tracked_signings: 40, known_cost_count: 10, known_acquisition_cost_usd: 5000, audited_outcomes: 5, verified_mlb_players: 2, verified_no_mlb: 3, not_audited: 35, observed_career_bwar: 12.5 },
  { name: 'Cuba', tracked_signings: 40, known_cost_count: 4, known_acquisition_cost_usd: null, audited_outcomes: 5, verified_mlb_players: 1, verified_no_mlb: 4, not_audited: 35, observed_career_bwar: null },
  { name: 'Japan', tracked_signings: 7, known_cost_count: 7, known_acquisition_cost_usd: 900, audited_outcomes: 7, verified_mlb_players: 0, verified_no_mlb: 7, not_audited: 0, observed_career_bwar: 0 },
  { name: 'australia', tracked_signings: 7, known_cost_count: 0, known_acquisition_cost_usd: 0, audited_outcomes: 0, verified_mlb_players: 0, verified_no_mlb: 0, not_audited: 7, observed_career_bwar: 3 },
]
const names = (sorted) => sorted.map((r) => r.name)

test('no sort parameters keeps the data-layer order', () => {
  assert.equal(parseSummarySort({}, 'market'), null)
  assert.deepEqual(names(sortSummaryRows(rows, null, labelFor)), names(rows))
})

test('label sorts alphabetically in both directions (case-insensitive)', () => {
  assert.deepEqual(names(sortSummaryRows(rows, { key: 'label', dir: 'asc' }, labelFor)), ['australia', 'Cuba', 'Dominican Republic', 'Japan'])
  assert.deepEqual(names(sortSummaryRows(rows, { key: 'label', dir: 'desc' }, labelFor)), ['Japan', 'Dominican Republic', 'Cuba', 'australia'])
})

test('numeric columns sort numerically; ties break alphabetically by label in either direction', () => {
  assert.deepEqual(names(sortSummaryRows(rows, { key: 'tracked', dir: 'desc' }, labelFor)), ['Cuba', 'Dominican Republic', 'australia', 'Japan'])
  assert.deepEqual(names(sortSummaryRows(rows, { key: 'tracked', dir: 'asc' }, labelFor)), ['australia', 'Japan', 'Cuba', 'Dominican Republic'])
  // 5 and 12.5 style comparisons are numeric, not lexical (7 < 40)
  assert.deepEqual(names(sortSummaryRows(rows, { key: 'not_audited', dir: 'asc' }, labelFor)), ['Japan', 'australia', 'Cuba', 'Dominican Republic'])
})

test('missing values sort last in both directions and are never treated as zero', () => {
  assert.deepEqual(names(sortSummaryRows(rows, { key: 'known_cost', dir: 'asc' }, labelFor)), ['australia', 'Japan', 'Dominican Republic', 'Cuba'])
  assert.deepEqual(names(sortSummaryRows(rows, { key: 'known_cost', dir: 'desc' }, labelFor)), ['Dominican Republic', 'Japan', 'australia', 'Cuba'])
  // a real 0 bWAR (Japan) sorts above a missing one (Cuba) when ascending
  assert.deepEqual(names(sortSummaryRows(rows, { key: 'bwar', dir: 'asc' }, labelFor)), ['Japan', 'australia', 'Dominican Republic', 'Cuba'])
  assert.deepEqual(names(sortSummaryRows([{ name: 'X', tracked_signings: 'n/a' }, { name: 'Y', tracked_signings: 1 }], { key: 'tracked', dir: 'desc' }, labelFor)), ['Y', 'X'])
})

test('a missing label sorts last', () => {
  const r = [{ name: null }, { name: 'B' }, { name: 'A' }]
  assert.deepEqual(sortSummaryRows(r, { key: 'label', dir: 'asc' }, labelFor).map((x) => x.name), ['A', 'B', null])
  assert.deepEqual(sortSummaryRows(r, { key: 'label', dir: 'desc' }, labelFor).map((x) => x.name), ['B', 'A', null])
})

test('sorting is deterministic and does not mutate its input', () => {
  const before = names(rows)
  const a = sortSummaryRows(rows, { key: 'audited', dir: 'desc' }, labelFor)
  const b = sortSummaryRows(rows, { key: 'audited', dir: 'desc' }, labelFor)
  assert.deepEqual(names(rows), before)
  assert.notEqual(a, rows)
  assert.deepEqual(names(a), names(b))
  const dup = [{ name: 'Same', tracked_signings: 1, id: 1 }, { name: 'Same', tracked_signings: 1, id: 2 }, { name: 'Same', tracked_signings: 1, id: 3 }]
  assert.deepEqual(sortSummaryRows(dup, { key: 'tracked', dir: 'asc' }, labelFor).map((x) => x.id), [1, 2, 3])
})

test('every sortable column the page offers is defined', () => {
  assert.deepEqual(Object.keys(SUMMARY_COLUMNS),
    ['label', 'tracked', 'known_cost_count', 'known_cost', 'audited', 'verified_mlb', 'verified_no_mlb', 'not_audited', 'bwar'])
  for (const key of Object.keys(SUMMARY_COLUMNS).filter((k) => k !== 'label')) assert.ok(SUMMARY_COLUMNS[key].field, key)
})

test('parameters: separate names per table, valid values only, first click then reverse', () => {
  assert.deepEqual(SUMMARY_TABLES, { market: { sortParam: 'market_sort', dirParam: 'market_dir' }, pathway: { sortParam: 'pathway_sort', dirParam: 'pathway_dir' } })
  assert.deepEqual(parseSummarySort({ market_sort: 'label' }, 'market'), { key: 'label', dir: 'asc' })
  assert.deepEqual(parseSummarySort({ market_sort: 'bwar' }, 'market'), { key: 'bwar', dir: 'desc' })
  assert.deepEqual(parseSummarySort({ market_sort: 'bwar', market_dir: 'asc' }, 'market'), { key: 'bwar', dir: 'asc' })
  assert.deepEqual(parseSummarySort({ market_sort: 'bwar', market_dir: 'sideways' }, 'market'), { key: 'bwar', dir: 'desc' })
  assert.equal(parseSummarySort({ market_sort: 'drop table' }, 'market'), null)
  assert.equal(parseSummarySort({ market_sort: 'toString' }, 'market'), null)
  assert.equal(parseSummarySort({ market_sort: 'bwar' }, 'pathway'), null)
  assert.deepEqual(parseSummarySort({ pathway_sort: ['label', 'bwar'] }, 'pathway'), { key: 'label', dir: 'asc' })
  assert.deepEqual(nextSummarySort(null, 'label'), { key: 'label', dir: 'asc' })
  assert.deepEqual(nextSummarySort({ key: 'label', dir: 'asc' }, 'label'), { key: 'label', dir: 'desc' })
  assert.deepEqual(nextSummarySort({ key: 'label', dir: 'desc' }, 'label'), { key: 'label', dir: 'asc' })
  assert.deepEqual(nextSummarySort({ key: 'label', dir: 'desc' }, 'tracked'), { key: 'tracked', dir: 'desc' })
})

test('sorting one table preserves the other table\'s sort and any other parameters', () => {
  const params = { pathway_sort: 'audited', pathway_dir: 'asc', q: 'x' }
  const href = summarySortHref('/markets', params, 'market', 'tracked')
  const q = new URL(href, 'http://x').searchParams
  assert.equal(q.get('market_sort'), 'tracked')
  assert.equal(q.get('market_dir'), 'desc')
  assert.equal(q.get('pathway_sort'), 'audited')
  assert.equal(q.get('pathway_dir'), 'asc')
  assert.equal(q.get('q'), 'x')
  // second click on the same column reverses only that table
  const again = new URL(summarySortHref('/markets', Object.fromEntries(q), 'market', 'tracked'), 'http://x').searchParams
  assert.equal(again.get('market_dir'), 'asc')
  assert.equal(again.get('pathway_sort'), 'audited')
  assert.equal(again.get('pathway_dir'), 'asc')
  assert.equal(new URL(summarySortHref('/markets', {}, 'pathway', 'label'), 'http://x').search, '?pathway_sort=label&pathway_dir=asc')
})

test('/markets wires both tables independently', () => {
  const src = read('app/markets/page.js')
  assert.match(src, /table="market"/)
  assert.match(src, /table="pathway"/)
  assert.match(src, /searchParams/)
  assert.match(src, /sortSummaryRows\(rows, sort, labelFor\)/)
  assert.match(src, /<ScrollableTable/)
})
