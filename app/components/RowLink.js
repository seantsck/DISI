'use client'

import { useRouter } from 'next/navigation'

/**
 * Table row that opens `href` when clicked. The player-name cell contains a
 * real link, so keyboard and middle-click navigation keep working.
 */
export default function RowLink({ href, children }) {
  const router = useRouter()

  function onClick(event) {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.target.closest('a, button, input, select, summary')) return
    if (window.getSelection()?.toString()) return
    if (event.metaKey || event.ctrlKey) {
      window.open(href, '_blank', 'noopener')
      return
    }
    router.push(href)
  }

  return <tr className="row-link" onClick={onClick}>{children}</tr>
}
