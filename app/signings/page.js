import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import FilterForm from '../components/FilterForm'
import SortHeader from '../components/SortHeader'
import RowLink from '../components/RowLink'
import Pagination from '../components/Pagination'
import PlayerLink from '../components/PlayerLink'
import AuditBadge from '../components/AuditBadge'
import { getSigningsTable } from '../../lib/data.js'
import { SIGNINGS_SPEC, AUDIT_STATUSES } from '../../lib/specs.js'
import { parseTableState, activeFilterCount, NONE } from '../../lib/table-state.js'
import { money, moneyExact, num, bwar, humanize, dateLabel, auditLabel, yesNoUnknown, MISSING } from '../../lib/format.js'

export const metadata = { title: 'Signings' }

const PATH = '/signings'

/** @param {{ value: string | null, count: number }[]} options @param {(v: string) => string} [label] */
function toOptions(options, label = (v) => v) {
  return options.map((o) => ({
    value: o.value == null ? NONE : o.value,
    label: `${o.value == null ? 'Unknown' : label(o.value)} (${o.count})`,
  }))
}

/** @param {any} r @param {string} field */
function moneyCell(r, field) {
  const value = r[field]
  return <td className="num" title={value == null ? 'Unknown — not recorded (not $0)' : moneyExact(value)}>{money(value)}</td>
}

export default async function SigningsPage({ searchParams }) {
  const state = parseTableState(SIGNINGS_SPEC, await searchParams)
  const { live, error, rows, total, outOfRange, facets } = await getSigningsTable(state)
  const allOrgs = state.filters.org_scope === 'all'
  const years = (facets.year || []).filter((y) => y.value != null).map((y) => y.value).sort((a, b) => Number(b) - Number(a))
  const yearOptions = years.map((y) => ({ value: y, label: y }))
  const filtersOn = activeFilterCount(state, SIGNINGS_SPEC)

  const fields = live ? [
    { name: 'q', type: 'search', label: 'Player search', placeholder: 'Name or alias, e.g. Valenzuela' },
    { name: 'org_scope', type: 'select', label: 'Organization scope', options: [
      { value: 'dodgers', label: 'Dodgers franchise (Brooklyn + Los Angeles)' },
      { value: 'all', label: 'All organizations in database' },
    ] },
    ...(allOrgs ? [{ name: 'org', type: 'select', label: 'Organization', options: toOptions(facets.org) }] : []),
    { name: 'year', type: 'select', label: 'Signing year', options: yearOptions },
    { name: 'year_min', type: 'select', label: 'Year from', options: yearOptions },
    { name: 'year_max', type: 'select', label: 'Year to', options: yearOptions },
    { name: 'market', type: 'select', label: 'Country / market', options: toOptions(facets.market) },
    { name: 'position', type: 'select', label: 'Position', options: toOptions(facets.position) },
    { name: 'pathway', type: 'select', label: 'Acquisition pathway', options: toOptions(facets.pathway, humanize) },
    { name: 'audit', type: 'select', label: 'Outcome audit', options: AUDIT_STATUSES.map((s) => ({ value: s, label: auditLabel(s) })) },
    { name: 'mlb', type: 'select', label: 'MLB reached', options: [
      { value: 'yes', label: 'Yes (verified)' }, { value: 'no', label: 'No (verified)' }, { value: 'unknown', label: 'Unknown (not audited)' },
    ] },
    { name: 'dodgers_debut', type: 'select', label: 'Debut with Dodgers franchise', options: [
      { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No — debuted elsewhere' },
    ] },
    { name: 'record_scope', type: 'select', label: 'Record scope', options: toOptions(facets.record_scope, humanize) },
    { name: 'coverage', type: 'select', label: 'Class coverage', options: toOptions(facets.coverage, humanize) },
  ] : []

  const header = (key, label, opts = {}) => (
    <SortHeader spec={SIGNINGS_SPEC} state={state} pathname={PATH} sortKey={key} label={label} {...opts} />
  )

  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Research table</span>
          <h1>Signings</h1>
          <p>One row per international signing record. Every column header sorts; filters and sort order are kept in the URL so a research view can be bookmarked or shared.</p>
        </div>
        <DataMode live={live} error={error} />
      </header>

      {!live && <DataUnavailable error={error} />}

      {live && <>
        <FilterForm
          pathname={PATH}
          fields={fields}
          values={state.filters}
          defaults={{ org_scope: 'dodgers' }}
          hidden={state.sort.isDefault ? {} : { sort: state.sort.key, dir: state.sort.dir }}
          resetHref={filtersOn ? PATH : undefined}
        />

        <div className="page-guardrail">
          <strong>Reading this table.</strong> {MISSING} means the value is not recorded; it is never zero. “Not audited” means outcome research is outstanding, not that the player failed. Signing bonus, posting fee and transfer fee are separate costs. bWAR is Baseball-Reference WAR, observed through the season shown on each player page.
        </div>

        <section className="table-panel">
          <Pagination spec={SIGNINGS_SPEC} state={state} pathname={PATH} total={total} outOfRange={outOfRange} />
          <div className="table-scroll">
            <table className="research-table">
              <thead>
                <tr>
                  {header('player', 'Player')}
                  {header('year', 'Year', { numeric: true })}
                  {header('date', 'Signing date')}
                  {allOrgs && header('org', 'Org')}
                  {header('market', 'Country / market')}
                  {header('position', 'Pos')}
                  {header('pathway', 'Pathway')}
                  {header('bonus', 'Signing bonus', { numeric: true })}
                  {header('posting', 'Posting fee', { numeric: true })}
                  {header('transfer', 'Transfer fee', { numeric: true })}
                  {header('cost', 'Total known cost', { numeric: true, title: 'Sum of known components only. Unknown when every component is unknown.' })}
                  {header('rank', 'Intl rank', { numeric: true })}
                  {header('scope', 'Record scope')}
                  {header('coverage', 'Class coverage')}
                  {header('audit', 'Outcome audit')}
                  {header('mlb', 'MLB reached')}
                  {header('debut', 'MLB debut')}
                  {header('debutorg', 'Debut org')}
                  {header('bwar', 'Career bWAR', { numeric: true, title: 'Baseball-Reference WAR' })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RowLink key={r.signing_id} href={`/players/${r.player_slug}`}>
                    <td className="sticky-col">
                      <PlayerLink slug={r.player_slug} name={r.full_name} />
                      {r.aliases?.length > 0 && <small className="alias">{r.aliases.join(', ')}</small>}
                    </td>
                    <td className="num">{r.signing_year}</td>
                    <td>{dateLabel(r.signing_date)}</td>
                    {allOrgs && <td title={r.organization_name}>{r.organization}</td>}
                    <td>{r.country_market || MISSING}</td>
                    <td>{r.primary_position || MISSING}</td>
                    <td>{humanize(r.pathway)}</td>
                    {moneyCell(r, 'signing_bonus_usd')}
                    {moneyCell(r, 'posting_fee_usd')}
                    {moneyCell(r, 'transfer_fee_usd')}
                    {moneyCell(r, 'total_known_acquisition_cost_usd')}
                    <td className="num">{r.international_rank == null ? MISSING : num(r.international_rank, 0)}</td>
                    <td>{humanize(r.record_scope)}</td>
                    <td>{humanize(r.coverage_type)}</td>
                    <td><AuditBadge status={r.outcome_audit_status} /></td>
                    <td>{r.outcome_audited ? yesNoUnknown(r.reached_mlb_verified) : 'Unknown'}</td>
                    <td>{dateLabel(r.mlb_debut_date)}</td>
                    <td title={r.mlb_debut_org_name || undefined}>
                      {r.mlb_debut_org || MISSING}
                      {r.direct_dodgers_franchise_debut && <span className="tag inline-tag" title="MLB debut directly with the Dodgers franchise">DOD</span>}
                    </td>
                    <td className="num">{bwar(r.career_bwar)}</td>
                  </RowLink>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={allOrgs ? 19 : 18} className="empty-row">No signing records match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination spec={SIGNINGS_SPEC} state={state} pathname={PATH} total={total} outOfRange={outOfRange} />
        </section>
      </>}
    </main>
  )
}
