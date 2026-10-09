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
  VERIFIED_NO_MLB: 'No MLB debut (audited)',
  NOT_AUDITED: 'Not audited',
}

/** @param {string | null | undefined} status */
export function auditLabel(status) {
  return (status && AUDIT_LABELS[/** @type {keyof typeof AUDIT_LABELS} */ (status)]) || MISSING
}

const CLASS_STATUS_LABELS = {
  COMPLETE: 'Full signing period complete',
  OPENING_CLASS_COMPLETE: 'Announced opening class complete',
  OPENING_CLASS_PARTIAL: 'Announced opening class partial',
  COUNT_CONFLICT: 'Source count conflict',
  DECLARED_COMPLETE_ROWS_MISSING: 'Declared complete · rows missing',
  PARTIAL: 'Partial',
  POPULATION_UNKNOWN: 'Population unknown',
  VERIFIED_SAMPLE_POPULATION_UNKNOWN: 'Verified sample · population unknown',
}

const POPULATION_SCOPE_LABELS = {
  OPENING_CLASS: 'Announced opening class',
  FULL_SIGNING_PERIOD: 'Full signing period',
  HISTORICAL_VERIFIED_SET: 'Historical verified set',
  TOP_PROSPECT_SAMPLE: 'Top-prospect sample',
  OTHER_DEFINED_POPULATION: 'Other defined population',
}

/** @param {string | null | undefined} scope */
export function populationScopeLabel(scope) {
  return (scope && POPULATION_SCOPE_LABELS[/** @type {keyof typeof POPULATION_SCOPE_LABELS} */ (scope)]) || MISSING
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

const HAND_LABELS = { L: 'Left', R: 'Right', S: 'Switch' }

/** Bats / throws code (L, R, S) as a word. Unknown stays the missing marker. */
export function handLabel(/** @type {string | null | undefined} */ code) {
  return (code && HAND_LABELS[/** @type {keyof typeof HAND_LABELS} */ (code)]) || MISSING
}

const AGE_BAND_LABELS = {
  '16_OR_YOUNGER': '16 or younger',
  17: '17',
  18: '18',
  '19_TO_22': '19–22',
  '23_OR_OLDER': '23 or older',
}

/** Signing-age band from v_player_bio.signing_age_band. */
export function ageBandLabel(/** @type {string | null | undefined} */ band) {
  return (band && AGE_BAND_LABELS[/** @type {keyof typeof AGE_BAND_LABELS} */ (band)]) || MISSING
}

/** Height in inches as feet and inches (73 → 6′ 1″). */
export function heightLabel(/** @type {unknown} */ inches) {
  if (isMissing(inches)) return MISSING
  const n = Math.round(Number(inches))
  if (!Number.isFinite(n) || n <= 0) return MISSING
  return `${Math.floor(n / 12)}′ ${n % 12}″`
}

/** Age in decimal years (16.9) with its unit, or the missing marker. */
export function ageLabel(/** @type {unknown} */ age) {
  if (isMissing(age)) return MISSING
  const n = Number(age)
  return Number.isFinite(n) ? `${n.toFixed(1)} yrs` : MISSING
}
