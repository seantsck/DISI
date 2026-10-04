const acronyms = new Map([
  ['mlb', 'MLB'], ['war', 'WAR'], ['lad', 'LAD'], ['nl', 'NL'], ['nlcs', 'NLCS'],
  ['nlcs', 'NLCS'], ['usd', 'USD'], ['dsl', 'DSL'], ['npb', 'NPB'], ['kbo', 'KBO']
])

export function money(value) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 1 : 1)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export function moneyExact(value) {
  if (value == null || value === '') return '—'
  return `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function num(value, digits = 1) {
  if (value == null || value === '') return '—'
  return Number(value).toFixed(digits)
}

export function pctFraction(value, digits = 1) {
  if (value == null || value === '') return '—'
  return `${(Number(value) * 100).toFixed(digits)}%`
}

export function pctPoints(value, digits = 1) {
  if (value == null || value === '') return '—'
  return `${Number(value).toFixed(digits)}%`
}

export function humanize(value) {
  if (!value) return '—'
  return String(value)
    .toLowerCase()
    .split('_')
    .map((word) => acronyms.get(word) || word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function dateLabel(value) {
  if (!value) return '—'
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return String(value)
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}
