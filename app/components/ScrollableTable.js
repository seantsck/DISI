'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { syncScrollLeft, measureOverflow } from '../../lib/scroll-sync.js'

/**
 * Wraps a wide table in the existing `table-scroll` container (native bottom scrollbar) and adds a second horizontal
 * scrollbar above it. The top track is only a scrollbar: it holds an empty spacer as wide as the table's scroll width and
 * mirrors scrollLeft with the real container. The table is never cloned. The track is hidden when nothing overflows.
 */
export default function ScrollableTable({ children, label = 'Table' }) {
  const bodyRef = useRef(null)
  const topRef = useRef(null)
  const [state, setState] = useState({ contentWidth: 0, overflowing: false })

  const measure = useCallback(() => {
    const next = measureOverflow(bodyRef.current)
    setState((prev) => (prev.contentWidth === next.contentWidth && prev.overflowing === next.overflowing ? prev : next))
  }, [])

  useEffect(() => {
    measure()
    const body = bodyRef.current
    if (!body) return undefined
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(body)
    if (body.firstElementChild) observer?.observe(body.firstElementChild)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  // When the track appears, line it up with the table's current position.
  useEffect(() => {
    if (state.overflowing) syncScrollLeft(bodyRef.current, topRef.current)
  }, [state.overflowing, state.contentWidth])

  return (
    <div className="scroll-table">
      <div
        ref={topRef}
        className={`table-scroll-top${state.overflowing ? '' : ' inactive'}`}
        aria-hidden="true"
        data-testid="table-scroll-top"
        tabIndex={-1}
        onScroll={() => syncScrollLeft(topRef.current, bodyRef.current)}
      >
        <div className="table-scroll-spacer" style={{ width: state.contentWidth || undefined }} />
      </div>
      <div
        ref={bodyRef}
        className="table-scroll"
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={() => syncScrollLeft(bodyRef.current, topRef.current)}
      >
        {children}
      </div>
    </div>
  )
}
