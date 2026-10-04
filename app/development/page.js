import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import PlayerLink from '../components/PlayerLink'
import { getDevelopmentData } from '../../lib/data.js'
import { money, num, bwar, humanize, dateLabel } from '../../lib/format.js'

export const metadata = { title: 'Development' }

// Rendered per request so pages always reflect the live database (never a build-time snapshot).
export const dynamic = 'force-dynamic'

export default async function DevelopmentPage() {
  const { live, error, debuts } = await getDevelopmentData()
  const timed = debuts.filter((r) => r.years_signing_to_mlb != null)
  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Longitudinal progression</span>
          <h1>Development</h1>
          <p>Verified MLB debuts among Dodgers-franchise signings, ordered by time from signing to debut where both dates are recorded.</p>
        </div>
        <DataMode live={live} error={error} />
      </header>
      {!live && <DataUnavailable error={error} />}
      {live && <>
        <div className="page-guardrail"><strong>Coverage is intentionally incomplete.</strong> Development speed is calculated only when both the exact signing date and the MLB debut date are recorded; missing milestones stay missing rather than being inferred.</div>
        <section className="timeline-panel">
          <div className="table-head">
            <div><span className="eyebrow">Verified MLB progression</span><h2>Signing → MLB debut</h2></div>
            <span className="micro-note">{timed.length} of {debuts.length} verified debuts have both dates</span>
          </div>
          <div className="development-list">
            {debuts.map((r) => (
              <article className="development-row" key={r.signing_id}>
                <div>
                  <strong><PlayerLink slug={r.player_slug} name={r.full_name} /></strong>
                  <span>{r.signing_year} · {r.country_market || 'Unknown market'} · {humanize(r.pathway)}</span>
                </div>
                <div className="development-metric">
                  <strong>{r.years_signing_to_mlb == null ? 'Date gap' : `${num(r.years_signing_to_mlb, 2)} yrs`}</strong>
                  <span>to {r.mlb_debut_org || 'MLB'} · {dateLabel(r.mlb_debut_date)}</span>
                </div>
                <div className="development-metric">
                  <strong>{bwar(r.career_bwar)}</strong>
                  <span>career bWAR{r.career_bwar != null && r.current_status?.startsWith('ACTIVE') ? ` thru ${r.bwar_observed_through_season}` : ''}</span>
                </div>
                <div className="development-metric">
                  <strong>{money(r.signing_bonus_usd)}</strong>
                  <span>signing bonus</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </>}
    </main>
  )
}
