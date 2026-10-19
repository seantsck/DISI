import Link from 'next/link'
import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import ScrollableTable from '../components/ScrollableTable'
import { getMarketsData } from '../../lib/data.js'
import { parseSummarySort, sortSummaryRows, summarySortHref } from '../../lib/summary-sort.js'
import { money, moneyExact, bwar, humanize } from '../../lib/format.js'

export const metadata = { title: 'Markets' }

// Rendered per request so pages always reflect the live database (never a build-time snapshot).
export const dynamic = 'force-dynamic'

const COLUMNS = [
  ['tracked', 'Tracked signings'],
  ['known_cost_count', 'With known cost'],
  ['known_cost', 'Known acquisition cost'],
  ['audited', 'Audited'],
  ['verified_mlb', 'Verified MLB'],
  ['verified_no_mlb', 'Verified no MLB'],
  ['not_audited', 'Not audited'],
  ['bwar', 'Observed bWAR'],
]

function SummaryHeader({ table, params, sort, sortKey, label, numeric = false }) {
  const active = sort?.key === sortKey
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <th aria-sort={ariaSort} className={numeric ? 'num' : undefined} scope="col">
      <Link href={summarySortHref('/markets', params, table, sortKey)} scroll={false} className={`sort-link${active ? ' active' : ''}`} title={`Sort by ${label}`}>
        {label}
        <span aria-hidden="true" className="sort-icon">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </Link>
    </th>
  )
}

function SummaryTable({ table, params, rows, labelKey, labelFor, hrefFor }) {
  const sort = parseSummarySort(params, table)
  const sorted = sortSummaryRows(rows, sort, labelFor)
  const head = { table, params, sort }
  return (
    <ScrollableTable label={`Signings by ${labelKey.toLowerCase()}`}>
      <table className="research-table">
        <thead>
          <tr>
            <SummaryHeader {...head} sortKey="label" label={labelKey} />
            {COLUMNS.map(([key, label]) => <SummaryHeader key={key} {...head} sortKey={key} label={label} numeric />)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={labelFor(r)}>
              <td><Link className="player-link" href={hrefFor(r)}>{labelFor(r)}</Link></td>
              <td className="num">{r.tracked_signings}</td>
              <td className="num">{r.known_cost_count}</td>
              <td className="num" title={moneyExact(r.known_acquisition_cost_usd)}>{money(r.known_acquisition_cost_usd)}</td>
              <td className="num">{r.audited_outcomes}</td>
              <td className="num">{r.verified_mlb_players}</td>
              <td className="num">{r.verified_no_mlb}</td>
              <td className="num">{r.not_audited}</td>
              <td className="num" title={`${r.players_with_bwar} players with a bWAR observation`}>{bwar(r.observed_career_bwar)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollableTable>
  )
}

export default async function MarketsPage({ searchParams }) {
  const params = await searchParams
  const { live, error, markets, pathways } = await getMarketsData()
  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Geography and acquisition pathway</span>
          <h1>Markets</h1>
          <p>Dodgers-franchise signing records grouped by country / market and by acquisition pathway, with known cost and audited outcomes.</p>
        </div>
        <DataMode live={live} error={error} />
      </header>
      {!live && <DataUnavailable error={error} />}
      {live && <>
        <div className="page-guardrail">
          <strong>Counts, not hit rates.</strong> The tracked set mixes complete classes, partial reconstructions and individually verified historical signings, and many outcomes are not yet audited. Known cost sums only recorded components. Observed bWAR sums Baseball-Reference career WAR for players that have an observation; it is not a market value estimate.
        </div>
        <section className="table-panel">
          <div className="table-head"><div><span className="eyebrow">Country / market</span><h2>Signings by market</h2></div></div>
          <SummaryTable
            table="market"
            params={params}
            rows={markets}
            labelKey="Market"
            labelFor={(r) => r.country_market || 'Unknown market'}
            hrefFor={(r) => `/signings?market=${encodeURIComponent(r.country_market ?? '__none')}`}
          />
        </section>
        <section className="table-panel">
          <div className="table-head"><div><span className="eyebrow">Acquisition pathway</span><h2>Signings by pathway</h2></div></div>
          <SummaryTable
            table="pathway"
            params={params}
            rows={pathways}
            labelKey="Pathway"
            labelFor={(r) => humanize(r.pathway)}
            hrefFor={(r) => `/signings?pathway=${encodeURIComponent(r.pathway)}`}
          />
        </section>
      </>}
    </main>
  )
}
