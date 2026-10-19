// Pure helpers for ScrollableTable: mirrors horizontal scroll between the top track and the table container.
// Setting scrollLeft to the value it already has fires no scroll event, so the two never feed back into each other.

/** Copies source.scrollLeft to target only when they differ (sub-pixel noise is ignored). Returns true when it moved. */
export function syncScrollLeft(source, target) {
  if (!source || !target) return false
  if (Math.abs(target.scrollLeft - source.scrollLeft) < 0.5) return false
  target.scrollLeft = source.scrollLeft
  return true
}

/** The overflow state of a scroll container: the content width the top track must mirror, and whether the track is needed. */
export function measureOverflow(container) {
  if (!container) return { contentWidth: 0, overflowing: false }
  const contentWidth = container.scrollWidth
  return { contentWidth, overflowing: contentWidth - container.clientWidth > 1 }
}
