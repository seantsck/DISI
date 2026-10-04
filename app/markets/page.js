import Link from 'next/link'
import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import { getMarketsData } from '../../lib/data.js'
import { money, moneyExact, bwar, humanize } from '../../lib/format.js'

export const metadata = { title: 'Markets' }

// Rendered per request so pages always reflect the live database (never a build-time snapshot).
export const dynamic = 'force-dynamic'

function SummaryTable({ rows, labelKey, labelFor, hrefFor }) {
  return (
    <div className="table-scroll">
      <table className="research-table">
        <thead>
          <tr>
            <th>{labelKey}</th>
            <th className="num">Tracked signings</th>
            <th className="num">With known cost</th>
            <th className="num">Known acquisition cost</th>
            <th className="num">Audited</th>
            <th className="num">Verified MLB</th>
            <th className="num">Verified no MLB</th>
            <th className="num">Not audited</th>
            <th className="num">Observed bWAR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
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
    </div>
  )
}

export default async function MarketsPage() {
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
            rows={markets}
            labelKey="Market"
            labelFor={(r) => r.country_market || 'Unknown market'}
            hrefFor={(r) => `/signings?market=${encodeURIComponent(r.country_market ?? '__none')}`}
          />
        </section>
        <section className="table-panel">
          <div className="table-head"><div><span className="eyebrow">Acquisition pathway</span><h2>Signings by pathway</h2></div></div>
          <SummaryTable
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
