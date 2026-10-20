// Deterministic comparison helpers: a total order with NULLs last and an explicit final tie-break.

/** @param {any} a @param {any} b */
export function cmpNullsLast(a, b) {
  const an = a === null || a === undefined
  const bn = b === null || b === undefined
  if (an || bn) return an === bn ? 0 : an ? 1 : -1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Builds a comparator from [(row) => key, 'asc' | 'desc'] pairs; NULL keys always sort last in both directions. */
export function orderBy(...keys) {
  return (a, b) => {
    for (const [fn, dir] of keys) {
      const x = fn(a)
      const y = fn(b)
      const xn = x === null || x === undefined
      const yn = y === null || y === undefined
      if (xn || yn) { if (xn !== yn) return xn ? 1 : -1; continue }
      const c = x < y ? -1 : x > y ? 1 : 0
      if (c) return dir === 'desc' ? -c : c
    }
    return 0
  }
}
