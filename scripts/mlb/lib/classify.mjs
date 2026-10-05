// Research classification rules. These functions RECOMMEND; a reviewer decides
// what becomes a migration. Nothing here writes to a database.

import { foldText } from '../../../lib/text.js'
import { CONTRACT_TYPE_CODES, sortTransactions } from './normalize.mjs'

/** De-duplicates records by a key, keeping the first occurrence. */
export function dedupeBy(list, keyFn) {
  const seen = new Set()
  const out = []
  for (const item of list) {
    const key = keyFn(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** Finds names that appear more than once after accent/case folding. */
export function findDuplicateNames(list, nameFn = (x) => x.fullName) {
  const groups = new Map()
  for (const item of list) {
    const key = foldText(nameFn(item)).replace(/\s+/g, ' ').trim()
    groups.set(key, [...(groups.get(key) || []), item])
  }
  return [...groups.entries()].filter(([, items]) => items.length > 1).map(([name, items]) => ({ name, items }))
}

/**
 * A signing is a first professional contract when no earlier transaction of a
 * contract type exists. Showcase-league activity (status changes such as
 * "Green-South activated ...") is not a professional contract.
 */
export function firstProfessionalContract(history, signing) {
  const prior = sortTransactions(history).filter((t) =>
    t.transactionId !== signing.transactionId
    && (t.date < signing.date || (t.date === signing.date && t.transactionId < signing.transactionId))
    && CONTRACT_TYPE_CODES.has(t.typeCode))
  return { first: prior.length === 0, priorContracts: prior }
}

/** @param {string} date @param {{ key: string, start: string, end: string }[]} periods */
export function assignPeriod(date, periods) {
  return periods.find((p) => date >= p.start && date <= p.end)?.key ?? null
}

/**
 * International-amateur profile: born outside the US / Canada / Puerto Rico,
 * never drafted, no MLB debut before the signing, and at most maxAge at signing.
 */
export function internationalAmateurProfile(person, signingDate, { maxAge = 23 } = {}) {
  const reasons = []
  if (['United States', 'USA', 'Canada', 'Puerto Rico'].includes(person.birthCountry ?? '')) reasons.push('DRAFT_ELIGIBLE_BIRTH_COUNTRY')
  if (person.draftYear) reasons.push('DRAFTED')
  if (person.mlbDebutDate && person.mlbDebutDate < signingDate) reasons.push('ALREADY_MLB')
  let age = null
  if (person.birthDate) {
    age = Math.round(((Date.parse(signingDate) - Date.parse(person.birthDate)) / (365.25 * 864e5)) * 10) / 10
    if (age > maxAge) reasons.push('OVER_AGE')
  } else {
    reasons.push('BIRTH_DATE_UNKNOWN')
  }
  return { fits: reasons.length === 0, ageAtSigning: age, reasons }
}

/**
 * Reconciles a published class list with signing records by folded name
 * (aliases allowed). Returns matched pairs plus unmatched entries on each side.
 */
export function reconcileClassList(listNames, signings) {
  const index = new Map()
  for (const s of signings) {
    for (const n of [s.fullName, ...(s.aliases || [])]) {
      const key = foldText(n).replace(/\s+/g, ' ').trim()
      if (!index.has(key)) index.set(key, s)
    }
  }
  const matched = []
  const unmatchedList = []
  const used = new Set()
  for (const name of listNames) {
    const hit = index.get(foldText(name).replace(/\s+/g, ' ').trim())
    if (hit) { matched.push({ listedName: name, signing: hit }); used.add(hit) } else unmatchedList.push(name)
  }
  return { matched, unmatchedList, unmatchedSignings: signings.filter((s) => !used.has(s)) }
}

const DISPOSITION_BY_CODE = { REL: 'RELEASED', DES: 'FREE_AGENT', RET: 'RETIRED' }

/**
 * Summarises professional progress and recommends an outcome-audit state.
 * Recommendations: VERIFIED_MLB, NO_MLB_CAREER_ENDED, NO_MLB_ACTIVE_IN_MINORS,
 * INSUFFICIENT_EVIDENCE. Absence of data is never read as "no MLB".
 */
export function summarizeOutcome({ person, mlbSplits = [], milbSplits = [], transactions = [], auditDate }) {
  const auditSeason = Number(auditDate.slice(0, 4))
  const reachedMlb = Boolean(person.mlbDebutDate && person.mlbDebutDate <= auditDate)
  // Affiliated play only; Mexican League (and similar) seasons are reported separately.
  const allSplits = [...milbSplits, ...mlbSplits]
  const splits = allSplits.filter((s) => s.affiliated !== false)
  const outside = allSplits.filter((s) => s.affiliated === false)
  const highest = splits.reduce((best, s) => (!best || s.levelRank > best.levelRank || (s.levelRank === best.levelRank && s.season < best.season) ? s : best), null)
  const last = splits.reduce((acc, s) => (!acc || s.season > acc.season || (s.season === acc.season && s.levelRank > acc.levelRank) ? s : acc), null)
  const sorted = sortTransactions(transactions)
  const exit = [...sorted].reverse().find((t) => DISPOSITION_BY_CODE[t.typeCode])
  const latest = sorted.at(-1) ?? null
  const exitIsFinal = Boolean(exit && latest && exit.transactionId === latest.transactionId)

  let debutTeam = null
  if (reachedMlb && mlbSplits.length) {
    const firstSeason = Math.min(...mlbSplits.map((s) => s.season))
    const teams = [...new Set(mlbSplits.filter((s) => s.season === firstSeason && s.teamName).map((s) => s.teamName))]
    debutTeam = teams.length === 1 ? teams[0] : null
  }

  const activeThisSeason = Boolean(last && last.season >= auditSeason)
  let recommendation
  let reason
  if (reachedMlb) {
    recommendation = 'VERIFIED_MLB'
    reason = `MLB debut ${person.mlbDebutDate} in the MLB person record.`
  } else if (exitIsFinal) {
    // The latest transaction is a release, free agency or retirement: the player
    // is not under an affiliated contract as of the audit date.
    recommendation = 'NO_MLB_CAREER_ENDED'
    reason = `Final transaction ${exit.typeCode} on ${exit.date}`
      + (last ? `; last affiliated season ${last.season} (${last.level})` : '; no affiliated games recorded')
      + `; no MLB debut through ${auditDate}.`
  } else if (!splits.length && !sorted.length) {
    recommendation = 'INSUFFICIENT_EVIDENCE'
    reason = 'No affiliated season or transaction found.'
  } else if (activeThisSeason) {
    recommendation = 'NO_MLB_ACTIVE_IN_MINORS'
    reason = `Played affiliated ${last.level} in ${last.season}; no MLB debut through ${auditDate}.`
  } else if (last && last.season <= auditSeason - 2) {
    recommendation = 'NO_MLB_CAREER_ENDED'
    reason = `No affiliated appearance since ${last.season}; no MLB debut through ${auditDate}.`
  } else {
    recommendation = 'INSUFFICIENT_EVIDENCE'
    reason = last ? `Last affiliated season ${last.season}, no exit transaction; status unclear.` : 'Transactions only, no affiliated seasons.'
  }

  return {
    mlbId: person.mlbId,
    reachedMlb,
    mlbDebutDate: reachedMlb ? person.mlbDebutDate : null,
    mlbDebutTeam: debutTeam,
    lastMlbSeason: mlbSplits.length ? Math.max(...mlbSplits.map((x) => x.season)) : null,
    highestLevel: highest?.level ?? null,
    highestLevelSeason: highest?.season ?? null,
    lastAffiliatedSeason: last?.season ?? null,
    lastAffiliatedTeam: last?.teamName ?? null,
    lastAffiliatedLevel: last?.level ?? null,
    finalTransaction: exitIsFinal ? { typeCode: exit.typeCode, date: exit.date, organization: exit.fromTeamName ?? exit.toTeamName, description: exit.description } : null,
    disposition: reachedMlb ? null : exitIsFinal ? DISPOSITION_BY_CODE[exit.typeCode] : activeThisSeason ? 'ACTIVE' : 'UNKNOWN',
    activeInAffiliatedBall: activeThisSeason && !exitIsFinal,
    // true when unaffiliated professional seasons follow the last affiliated one;
    // null when none are recorded (independent / foreign play is not fully researched).
    continuedOutsideAffiliated: outside.some((o) => !last || o.season >= last.season) ? true : null,
    outsideAffiliatedSeasons: outside.map((o) => ({ season: o.season, team: o.teamName, league: o.league })),
    recommendation,
    reason,
  }
}

/**
 * Audit policy: which recommendations may become outcome audits.
 *  - A verified MLB debut is audited for any signing year.
 *  - "No longer in affiliated ball" is audited only for classes through
 *    negativeThroughYear; newer classes are still developing.
 *  - "Active in the minors without an MLB debut" is audited only for classes
 *    through activeNegativeThroughYear (long-mature classes).
 *  - Insufficient evidence is never audited.
 */
export const DEFAULT_AUDIT_POLICY = { negativeThroughYear: 2021, activeNegativeThroughYear: 2020 }

export function auditDecision(summary, signingYear, policy = DEFAULT_AUDIT_POLICY) {
  switch (summary.recommendation) {
    case 'VERIFIED_MLB':
      return { audit: true, reachedMlb: true, outcomeState: 'REACHED_MLB', reason: 'Verified MLB debut.' }
    case 'NO_MLB_CAREER_ENDED':
      return signingYear <= policy.negativeThroughYear
        ? { audit: true, reachedMlb: false, outcomeState: 'NO_MLB_CAREER_ENDED', reason: summary.reason }
        : { audit: false, reason: `Class ${signingYear} is newer than ${policy.negativeThroughYear}; recorded as progress only.` }
    case 'NO_MLB_ACTIVE_IN_MINORS':
      return signingYear <= policy.activeNegativeThroughYear
        ? { audit: true, reachedMlb: false, outcomeState: 'NO_MLB_ACTIVE_IN_MINORS', reason: summary.reason }
        : { audit: false, reason: 'Still developing in affiliated ball; not an outcome yet.' }
    default:
      return { audit: false, reason: 'Insufficient evidence; left unaudited.' }
  }
}
