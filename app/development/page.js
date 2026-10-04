import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import { getDevelopmentData } from '../../lib/data'
import { money, num, humanize } from '../../lib/format'

export const metadata = { title:'Development — DISI' }

export default async function DevelopmentPage() {
  const { live, error, debuts } = await getDevelopmentData()
  const timed = debuts.filter((r) => r.years_signing_to_mlb != null)
  return <main className="shell page-main">
    <header className="page-hero"><div><span className="eyebrow">Longitudinal progression</span><h1>Development</h1><p>Observed signing-to-MLB timing where both signing and debut dates are supported in the current database.</p></div><DataMode live={live} error={error} /></header>
    {!live && <DataUnavailable error={error} />}
    <div className="page-guardrail"><strong>Coverage is intentionally incomplete.</strong> DISI only calculates development speed when both dates are present; missing milestones stay missing rather than being inferred.</div>
    <section className="timeline-panel">
      <div className="table-head"><div><span className="eyebrow">Observed MLB progression</span><h2>Signing → MLB debut</h2></div><span className="micro-note">{timed.length} timed cases</span></div>
      <div className="development-list">{debuts.map((r) => <article className="development-row" key={`${r.full_name}-${r.signing_year}`}><div><strong>{r.full_name}</strong><span>{r.signing_year} · {r.country_market} · {humanize(r.pathway)}</span></div><div className="development-metric"><strong>{r.years_signing_to_mlb == null ? 'Date gap' : `${num(r.years_signing_to_mlb,2)} yrs`}</strong><span>to {r.mlb_debut_org || 'MLB'}</span></div><div className="development-metric"><strong>{r.career_war == null ? '—' : num(r.career_war)}</strong><span>career WAR</span></div><div className="development-metric"><strong>{money(r.signing_bonus_usd)}</strong><span>signing bonus</span></div></article>)}</div>
    </section>
  </main>
}
