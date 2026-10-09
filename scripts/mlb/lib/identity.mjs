// Identity-resolution rules. A name match alone never resolves an identity;
// ambiguous or single-signal matches are returned for manual review.

import { foldText, slugify } from '../../../lib/text.js'
import { parseIsoDate } from './normalize.mjs'

/** Name comparison key: accents, case, punctuation and qualifiers removed. */
export const nameKey = (s) => slugify(String(s ?? '').replace(/\([^)]*\)/g, ' '))

const diacritics = (s) => (String(s ?? '').normalize('NFD').match(/\p{Diacritic}/gu) || []).length

/**
 * Index of Baseball-Reference WAR files by MLB id and by B-Ref id.
 * Each entry keeps the B-Ref name, first season and first team.
 */
export function indexWarFiles(...texts) {
  const byMlbId = new Map()
  const byBrefId = new Map()
  for (const text of texts) {
    const lines = text.split(/\r?\n/)
    const header = lines[0].split(',')
    const col = (n) => {
      const i = header.indexOf(n)
      if (i < 0) throw new Error(`Column ${n} missing from WAR file`)
      return i
    }
    const [iName, iMlb, iBref, iYear, iTeam] = ['name_common', 'mlb_ID', 'player_ID', 'year_ID', 'team_ID'].map(col)
    for (let n = 1; n < lines.length; n += 1) {
      if (!lines[n]) continue
      const f = lines[n].split(',')
      const brefId = f[iBref]
      const mlbId = Number(f[iMlb]) || null
      const year = Number(f[iYear])
      const cur = byBrefId.get(brefId) || { brefId, mlbIds: new Set(), name: f[iName], firstYear: year, firstTeam: f[iTeam], lastYear: year }
      if (mlbId) cur.mlbIds.add(mlbId)
      if (year < cur.firstYear) { cur.firstYear = year; cur.firstTeam = f[iTeam] }
      cur.lastYear = Math.max(cur.lastYear, year)
      byBrefId.set(brefId, cur)
    }
  }
  for (const entry of byBrefId.values()) {
    for (const id of entry.mlbIds) byMlbId.set(id, [...(byMlbId.get(id) || []), entry])
  }
  return { byMlbId, byBrefId }
}

/** Baseball-Reference team codes for the Dodgers franchise. */
const TEAM_FRANCHISE = { BRO: 'DODGERS', LAD: 'DODGERS' }
const franchiseOf = (team) => TEAM_FRANCHISE[team] || team

/**
 * Resolves a Baseball-Reference id.
 * Inputs: mlbId, brefHint (id from a page DISI already cites), lahman (MLB's
 * cross-reference), name, aliases, debutDate, debutTeam (B-Ref / MLB code).
 * Status: RESOLVED, CONFLICT, AMBIGUOUS, NEEDS_REVIEW, NOT_FOUND, NOT_APPLICABLE.
 */
export function resolveBref(player, index) {
  const { mlbId, brefHint, lahman, name, aliases = [], debutDate, debutTeam, reachedMlb } = player
  /** @param {string} status @param {Record<string, any>} [extra] */
  const out = (status, extra = {}) => ({
    status, brefId: null, mlbId: mlbId ?? null, method: null, confidence: null, signals: [], candidates: [], note: null, ...extra,
  })
  if (reachedMlb === false) return out('NOT_APPLICABLE', { note: 'No MLB debut; Baseball-Reference major-league ids apply to MLB players.' })

  if (mlbId && index.byMlbId.has(mlbId)) {
    const entries = index.byMlbId.get(mlbId)
    const ids = [...new Set(entries.map((e) => e.brefId))]
    const candidates = entries.map((e) => ({ brefId: e.brefId, name: e.name, firstYear: e.firstYear, firstTeam: e.firstTeam }))
    if (ids.length > 1) return out('AMBIGUOUS', { candidates, note: 'Several Baseball-Reference ids share this MLB id.' })
    const brefId = ids[0]
    const disagreeing = [lahman && lahman !== brefId ? `MLB lahman cross-reference ${lahman}` : null, brefHint && brefHint !== brefId ? `cited page ${brefHint}` : null].filter(Boolean)
    if (disagreeing.length) return out('CONFLICT', { candidates, note: `B-Ref WAR file maps MLB id ${mlbId} to ${brefId}, but ${disagreeing.join(' and ')} disagree.` })
    const signals = ['MLB_ID_IN_BREF_WAR_FILE', ...(lahman === brefId ? ['MLB_LAHMAN_XREF_AGREES'] : []), ...(brefHint === brefId ? ['CITED_BREF_PAGE_AGREES'] : [])]
    return out('RESOLVED', { brefId, method: 'BREF_WAR_FILE_MLB_ID', confidence: 'VERIFIED', signals, candidates })
  }

  if (brefHint && index.byBrefId.has(brefHint)) {
    const e = index.byBrefId.get(brefHint)
    const ids = [...e.mlbIds]
    if (ids.length !== 1) return out('AMBIGUOUS', { candidates: [{ brefId: e.brefId, mlbIds: ids }], note: 'Cited B-Ref id maps to zero or several MLB ids.' })
    return out('RESOLVED', { brefId: brefHint, mlbId: ids[0], method: 'CITED_BREF_PAGE', confidence: 'VERIFIED',
      signals: ['BREF_ID_FROM_CITED_PAGE', 'MLB_ID_IN_BREF_WAR_FILE'], candidates: [{ brefId: e.brefId, name: e.name, firstYear: e.firstYear, firstTeam: e.firstTeam, mlbId: ids[0] }] })
  }

  // Name search: needs agreement of debut year AND debut franchise to resolve.
  const keys = new Set([name, ...aliases].map(nameKey))
  const named = [...index.byBrefId.values()].filter((e) => keys.has(nameKey(e.name)))
  const candidates = named.map((e) => ({ brefId: e.brefId, name: e.name, firstYear: e.firstYear, firstTeam: e.firstTeam, mlbIds: [...e.mlbIds] }))
  if (!named.length) return out('NOT_FOUND', { note: `No Baseball-Reference entry named "${name}".` })
  const debutYear = parseIsoDate(debutDate) ? Number(debutDate.slice(0, 4)) : null
  const strong = named.filter((e) => debutYear && e.firstYear === debutYear && debutTeam && franchiseOf(e.firstTeam) === franchiseOf(debutTeam))
  if (strong.length === 1 && strong[0].mlbIds.size === 1) {
    return out('RESOLVED', { brefId: strong[0].brefId, mlbId: [...strong[0].mlbIds][0], method: 'NAME_DEBUT_YEAR_DEBUT_TEAM', confidence: 'HIGH',
      signals: ['NAME', 'DEBUT_YEAR', 'DEBUT_FRANCHISE'], candidates })
  }
  if (strong.length > 1 || named.length > 1) return out('AMBIGUOUS', { candidates, note: 'More than one Baseball-Reference entry matches; not selected automatically.' })
  return out('NEEDS_REVIEW', { candidates, note: 'A single name match without debut-year and debut-team agreement is not enough.' })
}

/** FanGraphs id from MLB's official cross-reference only. */
export function resolveFangraphs(identity) {
  const fg = identity?.xref?.fangraphs
  if (fg && /^\d+$|^sa\d+$/.test(fg)) {
    return { status: 'RESOLVED', fangraphsId: fg, method: 'MLB_XREF', confidence: 'VERIFIED', signals: ['MLB_PERSON_XREF_FANGRAPHS'] }
  }
  return { status: 'NOT_AVAILABLE', fangraphsId: null, method: null, confidence: null, signals: [] }
}

/** Marks ids claimed by more than one player as conflicts. */
export function findIdCollisions(rows, idField) {
  const seen = new Map()
  for (const r of rows) {
    const id = r[idField]
    if (id == null) continue
    seen.set(id, [...(seen.get(id) || []), r])
  }
  return [...seen.entries()].filter(([, list]) => list.length > 1).map(([id, list]) => ({ id, players: list.map((r) => r.slug) }))
}

/**
 * Canonical spelling: a primary-source name may replace the DISI name only
 * when it is the same name apart from diacritics and carries more of them
 * (e.g. "Roger Cedeno" → "Roger Cedeño"). Any other difference becomes an
 * alias and is never a rename.
 */
export function chooseCanonicalName(disiName, sourceNames) {
  const key = (s) => slugify(s)
  let best = disiName
  let source = null
  for (const [label, name] of sourceNames) {
    if (!name || key(name) !== key(disiName)) continue
    if (foldText(name).replace(/[^a-z0-9]/g, '') !== foldText(disiName).replace(/[^a-z0-9]/g, '')) continue
    if (diacritics(name) > diacritics(best)) { best = name; source = label }
  }
  return { canonicalName: best, rename: best !== disiName, source }
}

const POSITION = { RHP: 'RHP', LHP: 'LHP', C: 'C', '1B': '1B', '2B': '2B', '3B': '3B', SS: 'SS', OF: 'OF', CF: 'OF', LF: 'OF', RF: 'OF', IF: 'INF', INF: 'INF', UT: 'UTIL', DH: 'DH' }

/**
 * Position at signing from the club's "signed free agent <POS> <name>"
 * transaction in the signing window. Returns null when no such record exists.
 * @param {any[]} history
 * @param {{ teamId: number, signingYear: number, signingDate?: string | null }} signing
 */
export function signingPosition(history, { teamId, signingYear, signingDate }) {
  const lo = `${signingYear - 1}-07-01`
  const hi = `${signingYear + 1}-01-31`
  const within = history.filter((t) => t.typeCode === 'SFA' && t.toTeamId === teamId && t.date >= lo && t.date <= hi && t.positionInDescription)
  if (!within.length) return null
  const target = signingDate ? Date.parse(signingDate) : Date.parse(`${signingYear}-07-01`)
  const tx = within.reduce((best, t) => (Math.abs(Date.parse(t.date) - target) < Math.abs(Date.parse(best.date) - target) ? t : best))
  const position = POSITION[tx.positionInDescription.toUpperCase()] ?? null
  return position ? { position, date: tx.date, transactionId: tx.transactionId, description: tx.description } : null
}
