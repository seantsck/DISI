// Normalization of MLB Stats API records into small, stable shapes.

import { foldText } from '../../../lib/text.js'

/**
 * Extracts an MLB person id from a number, a numeric string, or an MLB / MLB
 * Stats API URL. Returns null when no unambiguous id is present.
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseMlbPersonId(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (/^\d{1,9}$/.test(s)) return Number(s) > 0 ? Number(s) : null
  const patterns = [
    /\/api\/v1\/people\/(\d{1,9})(?:[/?#]|$)/,
    /[?&]playerId=(\d{1,9})(?:&|$)/,
    /\bmi?lb\.com\/(?:[a-z]+\/)?player\/(?:[a-z0-9-]+-)?(\d{1,9})(?:[/?#]|$)/i,
  ]
  for (const re of patterns) {
    const m = s.match(re)
    if (m) return Number(m[1])
  }
  return null
}

/**
 * Strict ISO date parsing: accepts YYYY-MM-DD or an ISO timestamp and returns
 * YYYY-MM-DD, or null for anything that is not a real calendar date.
 * @param {unknown} value
 */
export function parseIsoDate(value) {
  if (typeof value !== 'string') return null
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

const COUNTRY_CODES = {
  DOM: 'Dominican Republic', VEN: 'Venezuela', MEX: 'Mexico', PAN: 'Panama', COL: 'Colombia',
  JPN: 'Japan', USA: 'United States', CUB: 'Cuba', NIC: 'Nicaragua', CUR: 'Curacao', KOR: 'South Korea',
  // Long-form names MLB uses for countries DISI records under their common name.
  'Republic of Korea': 'South Korea',
}

/** MLB uses both country names and three-letter codes; unknown codes stay null. */
export function normalizeCountry(value) {
  if (!value || typeof value !== 'string') return null
  const v = value.trim()
  if (COUNTRY_CODES[v]) return COUNTRY_CODES[v]
  if (/^[A-Z]{2}\d$/.test(v)) return null // e.g. "RU1": not a resolvable country code
  if (v === 'USA') return 'United States'
  return v
}

/** DISI position convention: RHP / LHP for pitchers, OF for any outfield spot. */
export function normalizePosition(person) {
  const ab = person?.primaryPosition?.abbreviation
  if (!ab) return null
  if (ab === 'P' || ab === 'TWP') return { R: 'RHP', L: 'LHP' }[person?.pitchHand?.code] || null
  if (['CF', 'LF', 'RF'].includes(ab)) return 'OF'
  return ab
}

/** "6' 1\"" → 73 (inches). Returns null for anything else. */
export function parseHeight(value) {
  if (typeof value !== 'string') return null
  const m = value.match(/^\s*(\d)'\s*(\d{1,2})"?\s*$/)
  if (!m) return null
  const inches = Number(m[1]) * 12 + Number(m[2])
  return Number(m[2]) < 12 && inches >= 48 && inches <= 96 ? inches : null
}

/** Cross-reference ids published on the MLB person record (hydrate=xrefId). */
export function xrefIds(raw) {
  const out = {}
  for (const x of raw?.xrefIds ?? []) {
    if (x?.xrefType && x?.xrefId && !(x.xrefType in out)) out[x.xrefType] = String(x.xrefId)
  }
  return out
}

export function normalizePerson(raw) {
  if (!raw || !raw.id) return null
  const weight = Number(raw.weight)
  return {
    mlbId: raw.id,
    fullName: raw.fullName ?? null,
    foldedName: foldText(raw.fullName ?? ''),
    birthDate: parseIsoDate(raw.birthDate),
    birthCity: raw.birthCity ?? null,
    birthStateProvince: raw.birthStateProvince ?? null,
    birthCountry: normalizeCountry(raw.birthCountry),
    rawBirthCountry: raw.birthCountry ?? null,
    heightIn: parseHeight(raw.height),
    weightLb: Number.isFinite(weight) && weight > 80 && weight < 400 ? weight : null,
    xref: xrefIds(raw),
    bats: raw.batSide?.code ?? null,
    throws: raw.pitchHand?.code ?? null,
    position: normalizePosition(raw),
    mlbDebutDate: parseIsoDate(raw.mlbDebutDate),
    draftYear: raw.draftYear ?? null,
    active: raw.active ?? null,
  }
}

/** Transaction codes that represent a professional contract or roster control. */
export const CONTRACT_TYPE_CODES = new Set(['SFA', 'SGN', 'DR', 'SE', 'TR', 'REL', 'DFA', 'CLW', 'OUT', 'RTN', 'PUR', 'DES', 'RET'])

export function normalizeTransaction(raw) {
  if (!raw || !raw.person?.id || !raw.id) return null
  const date = parseIsoDate(raw.date) || parseIsoDate(raw.effectiveDate)
  if (!date) return null
  const desc = raw.description ?? ''
  const pos = desc.match(/signed free agent (\S+) /i)
  return {
    transactionId: raw.id,
    mlbId: raw.person.id,
    playerName: raw.person.fullName ?? null,
    date,
    typeCode: raw.typeCode ?? null,
    typeDesc: raw.typeDesc ?? null,
    fromTeamId: raw.fromTeam?.id ?? null,
    fromTeamName: raw.fromTeam?.name ?? null,
    toTeamId: raw.toTeam?.id ?? null,
    toTeamName: raw.toTeam?.name ?? null,
    positionInDescription: pos ? pos[1] : null,
    description: desc,
  }
}

/** Orders transactions chronologically with the transaction id as tiebreak. */
export function sortTransactions(list) {
  return [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.transactionId - b.transactionId))
}

export const LEVELS = {
  1: { level: 'MLB', rank: 7 },
  11: { level: 'AAA', rank: 6 },
  12: { level: 'AA', rank: 5 },
  13: { level: 'A+', rank: 4 },
  14: { level: 'A', rank: 3 },
  15: { level: 'A-', rank: 2 },
  16: { level: 'ROK', rank: 1 },
}

/**
 * Leagues the Stats API files under a minor-league sport id that are NOT
 * MLB-affiliated (the Mexican League was classified as Triple-A until 2020).
 */
export const UNAFFILIATED_LEAGUES = new Set(['Mexican League'])

/** Season splits from /people/{id}/stats, excluding the "Minors" aggregate rows. */
export function normalizeSeasonSplits(response) {
  const out = []
  for (const block of response?.stats ?? []) {
    for (const sp of block.splits ?? []) {
      const sportId = sp.sport?.id
      const lvl = LEVELS[sportId]
      if (!lvl || !sp.season) continue
      out.push({
        // Split-season leagues report seasons such as "2018.1"; keep the year.
        season: Number.parseInt(String(sp.season), 10),
        // The raw label ("2018.1") and the aggregate team count are kept so a
        // team-less aggregate split can be recognised, never guessed.
        seasonLabel: String(sp.season),
        numTeams: sp.numTeams ?? null,
        level: lvl.level,
        levelRank: lvl.rank,
        sportId,
        group: block.group?.displayName ?? null,
        teamId: sp.team?.id ?? null,
        teamName: sp.team?.name ?? null,
        league: sp.league?.name ?? null,
        games: sp.stat?.gamesPlayed ?? null,
        // Full stat block (batting or pitching) for development-history work;
        // outcome summaries ignore it.
        stat: sp.stat ?? null,
        age: Number.isFinite(Number(sp.stat?.age)) ? Number(sp.stat.age) : null,
        affiliated: !UNAFFILIATED_LEAGUES.has(sp.league?.name ?? ''),
      })
    }
  }
  return out.sort((a, b) => a.season - b.season || a.levelRank - b.levelRank || String(a.teamName).localeCompare(String(b.teamName)))
}
