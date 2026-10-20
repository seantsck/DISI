// The compact asset path shown on a player dossier (047): Signing -> affiliates / levels -> MLB debut -> Dodgers exit -> trade package -> return.
// Pure: built only from rows the dossier already loaded. A step is RECORDED (a stored fact), UNKNOWN (not on record: missing research, never
// "did not happen") or NOT_APPLICABLE. No step is ever invented, and no exit is inferred from a player's absence from later records.

import { attributionState } from './transaction-research.js'

const has = (v) => v !== null && v !== undefined && v !== ''
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

const RETURN_TEXT = Object.freeze({
  NOT_A_TRADE_EXIT: 'No trade return to attribute.',
  RETURN_STILL_ACCRUING: 'An asset this exit returned is still under Dodgers control, so the return is still accruing and not final.',
  CHAIN_INCOMPLETE: 'The chain after this exit is incomplete, so any return value shown is to date and not final.',
  VALUE_NOT_DETERMINED: 'The return exists but its value is not determined (not zero).',
  INDIVIDUALLY_ATTRIBUTED: 'Sole outgoing asset: the return is attributed to this player.',
  PACKAGE_LEVEL_ONLY: 'Shared package: the return is observable only at package level and is not credited to this player.',
  RECORDED_ZERO_RETURN: 'Every recorded return amount is zero.',
})

/**
 * @param {{ signings?: any[], devSummary?: any, devStints?: any[], devMilestones?: any[], transactions?: any[], realizedValue?: any[] }} d
 * @returns {{ key: string, label: string, state: 'RECORDED' | 'UNKNOWN' | 'NOT_APPLICABLE', detail: string }[]}
 */
export function assetPath(d) {
  const signings = d.signings ?? []
  const stints = d.devStints ?? []
  const transactions = d.transactions ?? []
  const decision = (d.realizedValue ?? [])[0] ?? null
  const sg = signings.find((s) => s.is_dodgers_franchise) ?? signings[0] ?? null
  const summary = d.devSummary ?? null
  const mlb = sg?.reached_mlb_verified === true
  /** @type {{ key: string, label: string, state: 'RECORDED' | 'UNKNOWN' | 'NOT_APPLICABLE', detail: string }[]} */
  const steps = []

  steps.push(sg
    ? { key: 'SIGNED', label: 'Signed', state: 'RECORDED', detail: has(sg.signing_date) ? `${sg.signing_date}` : `${sg.signing_year} (exact date not recorded)` }
    : { key: 'SIGNED', label: 'Signed', state: 'UNKNOWN', detail: 'No Dodgers signing recorded.' })

  if (stints.length > 0) {
    const first = Math.min(...stints.map((s) => s.season))
    const seasons = new Set(stints.map((s) => s.season)).size
    const gap = has(sg?.signing_year) && first - sg.signing_year > 1
    steps.push({
      key: 'DEVELOPMENT', label: 'Affiliates and levels', state: 'RECORDED',
      detail: `${plural(seasons, 'season', 'seasons')} recorded from ${first}${gap ? `; the earliest record is ${first - sg.signing_year} seasons after signing, so earlier seasons are not on record (unknown, not absent)` : ''}.`,
    })
  } else {
    steps.push({ key: 'DEVELOPMENT', label: 'Affiliates and levels', state: 'UNKNOWN', detail: 'No development seasons on record. That is missing research, not evidence of no development.' })
  }

  const level = summary?.highest_affiliated_level
  steps.push(mlb || has(level)
    ? { key: 'HIGHEST_LEVEL', label: 'Highest level', state: 'RECORDED', detail: mlb ? 'MLB (derived from the verified MLB debut)' : String(level).replaceAll('_', ' ') }
    : { key: 'HIGHEST_LEVEL', label: 'Highest level', state: 'UNKNOWN', detail: 'Not recorded.' })

  if (mlb) steps.push({ key: 'MLB_DEBUT', label: 'MLB debut', state: has(sg.mlb_debut_date) ? 'RECORDED' : 'UNKNOWN', detail: has(sg.mlb_debut_date) ? `${sg.mlb_debut_date}${has(sg.mlb_debut_org) ? ` with ${sg.mlb_debut_org}` : ''}` : 'Verified MLB player; debut date not recorded.' })
  else if (sg?.outcome_audit_status === 'VERIFIED_NO_MLB') steps.push({ key: 'MLB_DEBUT', label: 'MLB debut', state: 'NOT_APPLICABLE', detail: 'Audited: no MLB appearance found.' })
  else steps.push({ key: 'MLB_DEBUT', label: 'MLB debut', state: 'UNKNOWN', detail: 'Outcome not audited. NOT_AUDITED is not a negative result.' })

  const exits = transactions.filter((t) => t.from_franchise_key === 'DODGERS' && t.player_side === 'OUTGOING')
  const exit = exits[0] ?? null
  if (exit) {
    steps.push({ key: 'EXIT', label: 'Dodgers exit', state: 'RECORDED', detail: `${exit.transaction_date ?? 'date not recorded'} · ${String(exit.transaction_type).replaceAll('_', ' ').toLowerCase()}${exit.to_organization ? ` to ${exit.to_organization}` : ''}` })
  } else {
    steps.push({ key: 'EXIT', label: 'Dodgers exit', state: 'UNKNOWN', detail: 'No exit transaction recorded. The player may still be with the organization or the exit may be unresearched; neither is inferred from absence from later records.' })
  }

  const pkg = exits.find((t) => t.record_kind === 'PACKAGE_EVENT')
  if (pkg) {
    steps.push({ key: 'PACKAGE', label: 'Trade package', state: 'RECORDED', detail: `${plural(pkg.outgoing_asset_count ?? 0, 'asset', 'assets')} out, ${plural(pkg.incoming_asset_count ?? 0, 'asset', 'assets')} back${pkg.attribution_status === 'SHARED_PACKAGE_RETURN' ? ' (shared package)' : ''}.` })
  } else if (exit) {
    steps.push({ key: 'PACKAGE', label: 'Trade package', state: 'NOT_APPLICABLE', detail: 'The exit was a single-player transaction, not a trade package.' })
  }

  if (decision && exit) {
    const state = attributionState(decision)
    steps.push({ key: 'RETURN', label: 'Organizational return', state: ['VALUE_NOT_DETERMINED', 'CHAIN_INCOMPLETE', 'RETURN_STILL_ACCRUING'].includes(state) ? 'UNKNOWN' : 'RECORDED', detail: RETURN_TEXT[state] })
  }
  return steps
}
