// Display formatting. Every formatter returns the em dash for NULL so a missing
// value is never rendered as zero; tables explain the dash in a legend and the
// player dossier spells it out as "Unknown".

export const MISSING = '—'

const acronyms = new Map([
  ['mlb', 'MLB'], ['war', 'WAR'], ['bwar', 'bWAR'], ['fwar', 'fWAR'], ['lad', 'LAD'], ['bro', 'BRO'],
  ['nl', 'NL'], ['nlcs', 'NLCS'], ['usd', 'USD'], ['dsl', 'DSL'], ['npb', 'NPB'], ['kbo', 'KBO'],
  ['hof', 'HOF'], ['latam', 'LatAm'], ['mlb.com', 'MLB.com'], ['milb', 'MiLB'],
])

/** @param {unknown} value */
const isMissing = (value) => value == null || value === ''

/** Compact money: $10K, $397.5K, $1.85M. */
export function money(/** @type {unknown} */ value) {
  if (isMissing(value)) return MISSING
  const n = Number(value)
  const trim = (/** @type {string} */ s) => s.replace(/\.?0+$/, '')
  if (Math.abs(n) >= 1_000_000) return `$${trim((n / 1_000_000).toFixed(2))}M`
  if (Math.abs(n) >= 1_000) return `$${trim((n / 1_000).toFixed(1))}K`
  return `$${n.toFixed(0)}`
}

export function moneyExact(/** @type {unknown} */ value) {
  if (isMissing(value)) return MISSING
  return `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function num(/** @type {unknown} */ value, digits = 1) {
  if (isMissing(value)) return MISSING
  return Number(value).toFixed(digits)
}

/** Baseball-Reference WAR, one decimal. */
export function bwar(/** @type {unknown} */ value) {
  return num(value, 1)
}

export function pctFraction(/** @type {unknown} */ value, digits = 1) {
  if (isMissing(value)) return MISSING
  return `${(Number(value) * 100).toFixed(digits)}%`
}

export function pctPoints(/** @type {unknown} */ value, digits = 1) {
  if (isMissing(value)) return MISSING
  return `${Number(value).toFixed(digits)}%`
}

export function humanize(/** @type {unknown} */ value) {
  if (isMissing(value)) return MISSING
  return String(value)
    .toLowerCase()
    .split('_')
    .map((word) => acronyms.get(word) || word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function dateLabel(/** @type {unknown} */ value) {
  if (isMissing(value)) return MISSING
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return String(value)
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)))
}

/** @param {boolean | null | undefined} value */
export function yesNoUnknown(value) {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return 'Unknown'
}

const AUDIT_LABELS = {
  VERIFIED_MLB: 'MLB debut verified',
  VERIFIED_NO_MLB: 'No MLB debut found',
  NOT_AUDITED: 'Not audited',
}

/** @param {string | null | undefined} status */
export function auditLabel(status) {
  return (status && AUDIT_LABELS[/** @type {keyof typeof AUDIT_LABELS} */ (status)]) || MISSING
}

const CLASS_STATUS_LABELS = {
  COMPLETE: 'Complete',
  DECLARED_COMPLETE_ROWS_MISSING: 'Declared complete · rows missing',
  PARTIAL: 'Partial',
  POPULATION_UNKNOWN: 'Population unknown',
  VERIFIED_SAMPLE_POPULATION_UNKNOWN: 'Verified sample · population unknown',
}

/** @param {string | null | undefined} status */
export function classStatusLabel(status) {
  return (status && CLASS_STATUS_LABELS[/** @type {keyof typeof CLASS_STATUS_LABELS} */ (status)]) || MISSING
}

/** Readable current-status codes such as LAST_MLB_2022 or ACTIVE_MLB_2026. */
export function statusLabel(/** @type {string | null | undefined} */ value) {
  if (!value) return MISSING
  const last = value.match(/^LAST_MLB(?:_APPEARANCE)?_(\d{4})$/)
  if (last) return `Last MLB season ${last[1]}`
  const active = value.match(/^ACTIVE_MLB(?:_(\d{4}))?$/)
  if (active) return active[1] ? `Active in MLB (${active[1]})` : 'Active in MLB'
  const reached = value.match(/^REACHED_MLB_(\d{4})$/)
  if (reached) return `Reached MLB in ${reached[1]}`
  if (value === 'HOF') return 'Retired · Hall of Fame'
  return humanize(value)
}
