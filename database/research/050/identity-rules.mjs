// The 050 identity and route rules, as pure functions (no network, no files), shared by derive-research.mjs and the unit tests.
//
// SOURCE LIST MEMBERSHIP != VERIFIED SIGNING and nothing is resolved by name alone: decideIdentity() resolves a listed player only when exactly
// one person the official MLB transaction log shows signing inside the class window matches the published name, the club agrees with the club
// the list names (when it names one), the birth year fits the class, the position family agrees, and the register birth date (when held)
// equals the MLB person record's. A spelling variant is accepted only together with the list's own club. Open disagreements stay CONFLICT.

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\bjr\b\.?/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()

export const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/** How a published name relates to one of a person's recorded names (never a middle name):
 *  EXACT    same normalised name, ignoring spacing (De Jesus / DeJesus) and accents
 *  TOKEN    same first name and a shared surname (a published paternal + maternal surname, or the maternal surname alone)
 *  VARIANT  one-letter first-name or surname spelling difference (five letters or more), or a first name the other one begins with (five letters
 *           or more), with the rest of the name agreeing. A VARIANT is never accepted unless the list independently names the same club. */
export function nameMatch(published, names) {
  const p = norm(published).split(' ')
  const rank = { EXACT: 3, TOKEN: 2, VARIANT: 1 }
  let best = null
  const take = (m) => { if (!best || rank[m] > rank[best]) best = m }
  const firstClose = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && (lev(a, b) === 1 || a.startsWith(b) || b.startsWith(a)))
  const surClose = (ps, qs) => ps.some((t) => qs.includes(t)) || ps.join('') === qs.join('')
  for (const n of names.filter(Boolean)) {
    const q = norm(n).split(' ')
    if (p.join('') === q.join('')) { take('EXACT'); continue }
    const ps = p.slice(1), qs = q.slice(1)
    if (!ps.length || !qs.length) continue
    if (p[0] === q[0] && surClose(ps, qs)) { take('TOKEN'); continue }
    if (firstClose(p[0], q[0]) && surClose(ps, qs)) { take('VARIANT'); continue }
    if (p[0] === q[0] && ps.some((t) => t.length >= 5 && qs.some((u) => u.length >= 5 && lev(t, u) === 1))) take('VARIANT')
  }
  return best
}

/** The names a person is recorded under: the MLB person record (with its maternal surname) and the signing transaction's own wording. */
export const recordedNames = (rec, s) => [rec?.fullName, `${rec?.firstName ?? ''} ${rec?.lastName ?? ''}`, `${rec?.useName ?? ''} ${rec?.lastName ?? ''}`,
  rec?.nameMatrilineal ? `${rec.firstName} ${rec.nameMatrilineal}` : null, rec?.nameMatrilineal ? `${rec.firstName} ${rec.lastName} ${rec.nameMatrilineal}` : null,
  rec?.nameMatrilineal ? `${rec.useName ?? rec.firstName} ${rec.nameMatrilineal}` : null, s?.person_name, s?.described_name]

/** A cheap screen on the names a transaction carries, before the person record is read. */
export function screenName(published, s) {
  const f0 = norm(published).split(' ')[0]
  return [s.person_name, s.described_name].filter(Boolean).some((n) => { const g = norm(n).split(' ')[0]; return g === f0 || (g.length >= 5 && f0.length >= 5 && (lev(g, f0) === 1 || g.startsWith(f0) || f0.startsWith(g))) })
    || Boolean(nameMatch(published, [s.person_name, s.described_name]))
}

export const family = (pos) => (/^(RHP|LHP|P)$/.test(pos ?? '') ? 'PITCHER' : pos ? 'NON_PITCHER' : null)
export const apiFamily = (p) => (p?.primaryPosition?.type === 'Pitcher' || p?.primaryPosition?.abbreviation === 'P' ? 'PITCHER' : p?.primaryPosition ? 'NON_PITCHER' : null)

/** An official signing transaction: "signed free agent ..." (SFA) or "signed ..." (SGN). Extensions and re-signings are not signings. */
export const isSigning = (x) => (x.typeCode === 'SFA' || (x.typeCode === 'SGN' && /\bsigned\b/i.test(x.description ?? ''))) && !/extension|re-signed|renew/i.test(x.description ?? '')
/** The player name as the transaction text writes it ("... signed free agent CF Jonathan Machado to a minor league contract."). */
export const describedName = (d) => /signed (?:free agent )?(?:(?:[A-Z0-9]{1,3}\/)*[A-Z0-9]{1,3} )?(.+?)(?: to (?:a |an )?|\.$)/.exec(d ?? '')?.[1] ?? null

/**
 * The identity decision for one listed player.
 * @param {any} entry       { published_name, published_position, class_year, list_club, stored_country? }
 * @param {any[]} candidates signings in the window whose recorded names match: { person_id, date, club, description, transaction_id, match, rec }
 * @param {(id: string) => ({ birth: string|null, bbref: string|null } | null)} registerOf
 */
export function decideIdentity(entry, candidates, registerOf, windowLabel = null) {
  // one person may have several signing rows in the window (a first signing and a later one with another club): the first is the signing
  const byPerson = new Map()
  for (const c of [...candidates].sort((a, b) => a.date.localeCompare(b.date) || a.transaction_id - b.transaction_id)) {
    if (!byPerson.has(c.person_id)) byPerson.set(c.person_id, { first: c, all: [] })
    byPerson.get(c.person_id).all.push({ date: c.date, club: c.club, description: c.description })
  }
  const people = [...byPerson.values()]
  const yearOk = (rec) => rec?.birthDate && Number(rec.birthDate.slice(0, 4)) >= entry.class_year - 26 && Number(rec.birthDate.slice(0, 4)) <= entry.class_year - 15
  const famOk = (rec) => !family(entry.published_position) || !apiFamily(rec) || family(entry.published_position) === apiFamily(rec)
  const plausible = people.filter((x) => yearOk(x.first.rec) && famOk(x.first.rec))
  // when the list names a club, a namesake who signed with a different club is a different player (recorded as considered, set aside); the
  // decision is made among the persons who signed with the listed club. Only if none did is a different-club match a disagreement.
  const sameClub = entry.list_club ? plausible.filter((x) => x.all.some((a) => a.club === entry.list_club)) : plausible
  const viable = sameClub.length ? sameClub : plausible
  const base = { ...entry, window: windowLabel, candidates_considered: people.map((x) => ({ person_id: x.first.person_id, name: x.first.rec?.fullName, birth_date: x.first.rec?.birthDate ?? null, club: x.first.club, date: x.first.date, match: x.first.match })) }
  if (!viable.length) return { ...base, result: 'INSUFFICIENT_EVIDENCE', reason: people.length ? 'A name-matching signing exists in the window but the birth year or position family does not fit the published entry' : 'No official signing transaction in the class window names a player matching the published name' }
  if (viable.length > 1) return { ...base, result: 'CONFLICT', reason: `${viable.length} different persons signed in the window match the published name` }
  const v = viable[0], rec = v.first.rec
  if (entry.list_club && v.first.club !== entry.list_club && !v.all.some((a) => a.club === entry.list_club)) {
    return { ...base, result: 'CONFLICT', reason: `The list names ${entry.list_club}; the only matching official signing is with ${v.first.club}` }
  }
  if (v.first.match === 'VARIANT' && !entry.list_club) return { ...base, result: 'INSUFFICIENT_EVIDENCE', reason: 'Only a spelling variant matches and the list names no club to corroborate it' }
  const reg = registerOf(String(rec.id)) ?? null
  if (reg?.birth && rec.birthDate && reg.birth !== rec.birthDate) return { ...base, result: 'CONFLICT', reason: `The register birth date ${reg.birth} differs from the MLB person record ${rec.birthDate}` }
  // a legacy benchmark row already carries the country its tracker stated; a different MLB birth country is an open disagreement, not an overwrite
  if (entry.stored_country && rec.birthCountry && entry.stored_country !== rec.birthCountry) {
    return { ...base, result: 'CONFLICT', candidate_mlb_id: String(rec.id), candidate_mlb_name: rec.fullName, candidate_signing: { club: v.first.club, date: v.first.date, description: v.first.description },
      reason: `The matching official signing (${rec.fullName}, ${v.first.club}, ${v.first.date}) is born in ${rec.birthCountry}; DISI's tracker row records ${entry.stored_country}. The disagreement stays open: identity is not resolved and the stored country is not rewritten.` }
  }
  const signing = v.all.find((a) => a.club === (entry.list_club ?? v.first.club)) ?? v.first
  return {
    ...base,
    result: 'RESOLVED',
    mlb_id: String(rec.id),
    mlb_name: rec.fullName,
    name_match: v.first.match,
    birth_date: rec.birthDate ?? null,
    birth_country: rec.birthCountry ?? null,
    mlb_primary_position: rec.primaryPosition?.abbreviation ?? null,
    register_birth_date: reg?.birth ?? null,
    register_bbref_id: reg?.bbref ?? null,
    signing: { club: signing.club, date: signing.date, description: signing.description },
    other_signings_in_window: v.all.filter((a) => a !== signing),
    signals: [
      `official signing transaction ${signing.date} (${signing.club}): "${signing.description}"`,
      entry.list_club ? `the list names ${entry.list_club}` : 'the list names no club',
      `name ${v.first.match === 'EXACT' ? 'identical to' : v.first.match === 'TOKEN' ? 'sharing first name and a surname with' : 'a one-letter or spacing variant of'} the MLB person record (${rec.fullName})`,
      `birth date ${rec.birthDate} (born ${rec.birthCountry ?? 'country not recorded'})`,
      reg ? (reg.birth ? `register birth date ${reg.birth} equals the person record` : 'register holds the person without a birth date') : 'not in the register',
      `position family ${family(entry.published_position) ?? 'unknown'} agrees with the MLB record (${rec.primaryPosition?.abbreviation ?? 'none'})`,
    ],
  }
}

/**
 * The signing route of a Cuban signee, from directly read accounts. CUBAN_PRO: an account says he played in the Cuban National Series, or the
 * official record holds a professional season before the signing year. CUBAN_AMATEUR: an account says his professional career began in the
 * signing year or later, and nothing points to earlier professional play. Otherwise null: the route is not established and the signing is
 * not added (queued), never guessed.
 * @param {{ seriesSentences: string[], startSentences: string[], proSeasonsBeforeSigning: any[], signingYear: number }} a
 */
export function classifyCubanRoute({ seriesSentences, startSentences, proSeasonsBeforeSigning, signingYear }) {
  const played = seriesSentences.some((s) => /\b(played|debuted|appeared|pitched|batted|spent|seasons?|made his debut|began his professional career)\b/i.test(s) && !/\b(never|did not|didn't)\b/i.test(s))
  const lateStart = startSentences.some((s) => Number(/began his professional career in (\d{4})/i.exec(s)?.[1]) >= signingYear)
  return played || proSeasonsBeforeSigning.length ? 'CUBAN_PRO' : lateStart ? 'CUBAN_AMATEUR' : null
}
