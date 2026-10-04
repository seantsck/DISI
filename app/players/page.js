import Link from 'next/link'
import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import FilterForm from '../components/FilterForm'
import SortHeader from '../components/SortHeader'
import RowLink from '../components/RowLink'
import Pagination from '../components/Pagination'
import PlayerLink from '../components/PlayerLink'
import AuditBadge from '../components/AuditBadge'
import { getPlayerDirectory } from '../../lib/data.js'
import { PLAYERS_SPEC, AUDIT_STATUSES } from '../../lib/specs.js'
import { parseTableState, tableHref, activeFilterCount } from '../../lib/table-state.js'
import { bwar, dateLabel, auditLabel, MISSING } from '../../lib/format.js'

export const metadata = { title: 'Players' }

const PATH = '/players'
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export default async function PlayersPage({ searchParams }) {
  const state = parseTableState(PLAYERS_SPEC, await searchParams)
  const { live, error, rows, total, outOfRange, facets } = await getPlayerDirectory(state)
  const filtersOn = activeFilterCount(state, PLAYERS_SPEC)
  const lettersWithPlayers = new Set((facets.letter || []).map((l) => l.value))
  const years = [...new Set((facets.decade || []).filter((d) => d.value != null).map((d) => Number(d.value)))].sort((a, b) => a - b)
  // Era options are decade boundaries; selecting one sets the first-signing-year range.
  const fromOptions = years.map((d) => ({ value: String(d), label: `${d}` }))
  const toOptions = years.map((d) => ({ value: String(d + 9), label: `${d + 9}` }))

  const fields = live ? [
    { name: 'q', type: 'search', label: 'Player search', placeholder: 'Name or alias' },
    { name: 'org_scope', type: 'select', label: 'Scope', options: [
      { value: 'dodgers', label: 'Signed by the Dodgers franchise' },
      { value: 'all', label: 'All players in database' },
    ] },
    { name: 'country', type: 'select', label: 'Country', options: (facets.country || []).filter((c) => c.value).map((c) => ({ value: c.value, label: `${c.value} (${c.count})` })) },
    { name: 'position', type: 'select', label: 'Position', options: (facets.position || []).filter((p) => p.value).map((p) => ({ value: p.value, label: `${p.value} (${p.count})` })) },
    { name: 'year_min', type: 'select', label: 'First signed from', options: fromOptions },
    { name: 'year_max', type: 'select', label: 'First signed to', options: toOptions },
    { name: 'mlb', type: 'select', label: 'MLB reached', options: [
      { value: 'yes', label: 'Yes (verified)' }, { value: 'no', label: 'No (verified)' }, { value: 'unknown', label: 'Unknown (not audited)' },
    ] },
    { name: 'dodgers_debut', type: 'select', label: 'Dodgers-franchise MLB debut', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    { name: 'audit', type: 'select', label: 'Outcome audit', options: AUDIT_STATUSES.map((s) => ({ value: s, label: auditLabel(s) })) },
  ] : []

  const header = (key, label, opts = {}) => (
    <SortHeader spec={PLAYERS_SPEC} state={state} pathname={PATH} sortKey={key} label={label} {...opts} />
  )

  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Player database</span>
          <h1>Players</h1>
          <p>One entry per person. A player can carry aliases, more than one signing record, transactions and outcome records; each links to a research dossier.</p>
        </div>
        <DataMode live={live} error={error} />
      </header>

      {!live && <DataUnavailable error={error} />}

      {live && <>
        <nav className="letter-bar" aria-label="Browse alphabetically">
          <Link className={!state.filters.letter ? 'active' : ''} href={tableHref(PATH, PLAYERS_SPEC, state, { filters: { letter: null } })} scroll={false}>All</Link>
          {LETTERS.map((letter) => lettersWithPlayers.has(letter) ? (
            <Link
              key={letter}
              className={state.filters.letter === letter ? 'active' : ''}
              aria-current={state.filters.letter === letter ? 'true' : undefined}
              href={tableHref(PATH, PLAYERS_SPEC, state, { filters: { letter } })}
              scroll={false}
            >{letter}</Link>
          ) : <span key={letter} className="disabled" aria-hidden="true">{letter}</span>)}
        </nav>

        <FilterForm
          pathname={PATH}
          fields={fields}
          values={state.filters}
          defaults={{ org_scope: 'dodgers' }}
          hidden={{ ...(state.sort.isDefault ? {} : { sort: state.sort.key, dir: state.sort.dir }), letter: state.filters.letter }}
          resetHref={filtersOn ? PATH : undefined}
        />

        <section className="table-panel">
          <Pagination spec={PLAYERS_SPEC} state={state} pathname={PATH} total={total} outOfRange={outOfRange} />
          <div className="table-scroll">
            <table className="research-table">
              <thead>
                <tr>
                  {header('player', 'Player')}
                  {header('country', 'Signing market')}
                  {header('position', 'Pos')}
                  {header('first_year', 'First signed', { numeric: true })}
                  <th scope="col">Organizations</th>
                  {header('audit', 'Outcome audit')}
                  {header('debut', 'MLB debut')}
                  {header('bwar', 'Career bWAR', { numeric: true, title: 'Baseball-Reference WAR' })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RowLink key={r.player_id} href={`/players/${r.player_slug}`}>
                    <td className="sticky-col">
                      <PlayerLink slug={r.player_slug} name={r.full_name} />
                      {r.aliases?.length > 0 && <small className="alias">{r.aliases.join(', ')}</small>}
                    </td>
                    <td>{r.first_signing_market || MISSING}</td>
                    <td>{r.primary_position || MISSING}</td>
                    <td className="num">{r.first_signing_year ?? MISSING}</td>
                    <td>{r.organizations?.length ? r.organizations.join(', ') : MISSING}</td>
                    <td><AuditBadge status={r.outcome_audit_status} /></td>
                    <td>
                      {dateLabel(r.mlb_debut_date)}
                      {r.mlb_debut_org && <span className="muted"> · {r.mlb_debut_org}</span>}
                    </td>
                    <td className="num">{bwar(r.career_bwar)}</td>
                  </RowLink>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="empty-row">No players match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination spec={PLAYERS_SPEC} state={state} pathname={PATH} total={total} outOfRange={outOfRange} />
        </section>
      </>}
    </main>
  )
}
