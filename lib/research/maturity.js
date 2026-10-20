import { MATURITY_YEARS } from './policy.js'

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** `date - interval '5 years'` as PostgreSQL computes it: Feb 29 falls back to Feb 28 in a non-leap year. */
export function subtractYears(isoDate, years) {
  if (!ISO.test(String(isoDate))) throw new Error(`not an ISO date: ${isoDate}`)
  const [y, m, d] = isoDate.split('-').map(Number)
  const target = y - years
  const leap = (target % 4 === 0 && target % 100 !== 0) || target % 400 === 0
  const day = m === 2 && d === 29 && !leap ? 28 : d
  return `${String(target).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * The existing DISI maturity rule (032): with a signing date, the signing is at least five years old at the analysis date;
 * without one, the signing year is at most five years before the analysis year. The analysis date is the data's own as-of date
 * (the latest outcome-audit date), never the wall clock.
 * @param {{ signing_date?: string | null, signing_year?: number | null }} signing
 * @param {string} asOf ISO date
 * @returns {boolean | null} null when the signing has neither a date nor a year
 */
export function isMatureSigning(signing, asOf) {
  if (!ISO.test(String(asOf))) throw new Error('an ISO as-of date is required')
  if (signing?.signing_date) return signing.signing_date <= subtractYears(asOf, MATURITY_YEARS)
  if (signing?.signing_year != null) return Number(signing.signing_year) <= Number(asOf.slice(0, 4)) - MATURITY_YEARS
  return null
}

/** @returns {'MATURE' | 'DEVELOPING' | 'UNKNOWN'} */
export function maturityStatus(signing, asOf) {
  const m = isMatureSigning(signing, asOf)
  return m === null ? 'UNKNOWN' : m ? 'MATURE' : 'DEVELOPING'
}
