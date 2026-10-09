import Link from 'next/link'
import { nextSort, tableHref } from '../../lib/table-state.js'

/** Column header that links to the table sorted by this column. */
export default function SortHeader({ spec, state, pathname, sortKey, label, numeric = false, title = undefined }) {
  const active = state.sort.key === sortKey
  const ariaSort = active ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
  const href = tableHref(pathname, spec, state, { sort: nextSort(spec, state, sortKey) })
  return (
    <th aria-sort={ariaSort} className={numeric ? 'num' : undefined} scope="col">
      <Link href={href} scroll={false} className={`sort-link${active ? ' active' : ''}`} title={title || `Sort by ${label}`}>
        {label}
        <span aria-hidden="true" className="sort-icon">{active ? (state.sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </Link>
    </th>
  )
}
