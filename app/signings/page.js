import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import { getSigningsData } from '../../lib/data'
import { money, num, humanize } from '../../lib/format'

export const metadata = { title:'Signings — DISI' }

export default async function SigningsPage() {
  const { live, error, rows, scope } = await getSigningsData()
  const knownSpend = rows.reduce((sum,r) => sum + Number(r.total_known_acquisition_cost_usd || 0), 0)
  const observedMlb = rows.filter((r) => r.reached_mlb).length
  const years = [...new Set(rows.map((r) => r.signing_year))].sort()
  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div><span className="eyebrow">Tracked cohort</span><h1>Signings</h1><p>Player-level acquisition records, bonus capital, pathway, market, and observed MLB outcomes.</p></div>
        <DataMode live={live} error={error} />
      </header>
      {!live && <DataUnavailable error={error} />}
      <div className="page-guardrail"><strong>{scope}.</strong> Younger, unaudited players should not be treated as failures simply because an MLB outcome is not yet observed.</div>
      <section className="mini-kpis">
        <div><span>Rows</span><strong>{rows.length}</strong></div><div><span>Known acquisition cost</span><strong>{money(knownSpend)}</strong></div><div><span>Observed MLB rows</span><strong>{observedMlb}</strong></div><div><span>Signing years</span><strong>{years[0]}–{years.at(-1)}</strong></div>
      </section>
      <section className="table-panel">
        <div className="table-head"><div><span className="eyebrow">Player ledger</span><h2>Tracked international signings</h2></div><span className="micro-note">Observed facts only</span></div>
        <div className="table-scroll"><table><thead><tr><th>Player</th><th>Year</th><th>Market</th><th>Pathway</th><th>Known acquisition cost</th><th>Scope</th><th>MLB outcome</th><th>Debut org</th><th>Career WAR</th></tr></thead><tbody>
          {rows.map((r) => <tr key={`${r.full_name}-${r.signing_year}`}><td><strong>{r.full_name}</strong></td><td>{r.signing_year}</td><td>{r.country_market}</td><td><span className="tag">{humanize(r.pathway)}</span></td><td>{money(r.total_known_acquisition_cost_usd)}</td>
            <td><span className="tag">{humanize(r.record_scope)}</span></td>
            <td><span className={`status ${r.reached_mlb ? 'yes' : ''}`}>{r.reached_mlb ? 'Reached MLB' : r.outcome_audited ? 'No MLB debut verified' : 'Not audited'}</span></td>
            <td>{r.mlb_debut_org || '—'}</td><td>{r.career_war == null ? '—' : num(r.career_war)}</td></tr>)}
        </tbody></table></div>
      </section>
    </main>
  )
}
