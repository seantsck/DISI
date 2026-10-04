import Link from 'next/link'
import { tableHref } from '../../lib/table-state.js'

export default function Pagination({ spec, state, pathname, total, outOfRange = false }) {
  const pages = Math.max(1, Math.ceil(total / spec.pageSize))
  const page = Math.min(state.page, pages)
  const from = total === 0 ? 0 : (page - 1) * spec.pageSize + 1
  const to = Math.min(total, page * spec.pageSize)
  const hrefFor = (p) => tableHref(pathname, spec, state, { page: p })
  const visible = [...new Set([1, page - 1, page, page + 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b)

  if (outOfRange) {
    return (
      <nav className="pagination" aria-label="Pagination">
        <span className="micro-note">Page {state.page} is past the last matching row.</span>
        <div className="pagination-links"><Link href={hrefFor(1)} scroll={false}>Go to page 1</Link></div>
      </nav>
    )
  }

  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="micro-note">{total === 0 ? 'No matching rows' : `Rows ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}</span>
      {pages > 1 && (
        <div className="pagination-links">
          {page > 1 ? <Link href={hrefFor(page - 1)} scroll={false}>← Prev</Link> : <span className="disabled">← Prev</span>}
          {visible.map((p, i) => (
            <span key={p} className="page-group">
              {i > 0 && p - visible[i - 1] > 1 && <span className="ellipsis">…</span>}
              {p === page ? <span aria-current="page" className="current">{p}</span> : <Link href={hrefFor(p)} scroll={false}>{p}</Link>}
            </span>
          ))}
          {page < pages ? <Link href={hrefFor(page + 1)} scroll={false}>Next →</Link> : <span className="disabled">Next →</span>}
        </div>
      )}
    </nav>
  )
}
