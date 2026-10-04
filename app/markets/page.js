import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import { getMarketsData } from '../../lib/data'
import { money, num, humanize } from '../../lib/format'

export const metadata = { title:'Markets — DISI' }

function SummaryTable({ rows, labelKey }) {
  const labelFor = (r) => r.country_market || (r.pathway ? humanize(r.pathway) : r.name) || 'Unknown'
  return <div className="table-scroll"><table><thead><tr><th>{labelKey}</th><th>Tracked signings</th><th>Known bonus spend</th><th>Observed MLB players</th><th>Observed career WAR</th></tr></thead><tbody>{rows.map((r) => <tr key={r.country_market || r.pathway || r.name}><td><strong>{labelFor(r)}</strong></td><td>{r.tracked_signings}</td><td>{money(r.known_bonus_spend_usd ?? r.bonus_spend_usd)}</td><td>{r.observed_mlb_players ?? r.mlb_players ?? 0}</td><td>{num(r.observed_career_war ?? 0)}</td></tr>)}</tbody></table></div>
}

export default async function MarketsPage() {
  const { live, error, markets, pathways } = await getMarketsData()
  return <main className="shell page-main">
    <header className="page-hero"><div><span className="eyebrow">Geographic & acquisition context</span><h1>Markets</h1><p>Where tracked international capital was deployed and how the observed outcomes are distributed.</p></div><DataMode live={live} error={error} /></header>
    {!live && <DataUnavailable error={error} />}
    <div className="page-guardrail"><strong>Do not read these as true market hit rates yet.</strong> The tracked dataset is selective and mixes mature and developing cohorts. Counts, spend, and observed outcomes are shown descriptively.</div>
    <section className="table-panel"><div className="table-head"><div><span className="eyebrow">Country market</span><h2>Tracked signing footprint</h2></div></div><SummaryTable rows={markets} labelKey="Market" /></section>
    <section className="table-panel"><div className="table-head"><div><span className="eyebrow">Acquisition pathway</span><h2>Teenage amateur vs. professional pathways</h2></div></div><SummaryTable rows={pathways} labelKey="Pathway" /></section>
  </main>
}
