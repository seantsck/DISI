import { getDashboardData } from '../lib/data'

function money(value) {
  if (value == null) return '—'
  if (Math.abs(value) >= 1_000_000) return `$${(Number(value) / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `$${(Number(value) / 1_000).toFixed(0)}K`
  return `$${Number(value).toFixed(0)}`
}

function num(value, digits = 1) {
  if (value == null) return '—'
  return Number(value).toFixed(digits)
}

function pct(value) {
  if (value == null) return '—'
  return `${(Number(value) * 100).toFixed(1)}%`
}

function humanize(value) {
  if (!value) return '—'
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

function Kpi({ label, value, note }) {
  return (
    <div className="kpi-card">
      <div className="eyebrow">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-note">{note}</div>
    </div>
  )
}

function Bar({ label, value, max, suffix = '' }) {
  const width = max > 0 ? Math.max(2, Math.min(100, (Number(value) / max) * 100)) : 0
  return (
    <div className="bar-row">
      <div className="bar-label"><span>{label}</span><strong>{value}{suffix}</strong></div>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${width}%` }} /></div>
    </div>
  )
}

export default async function DashboardPage() {
  const { live, signals, cases, findings } = await getDashboardData()
  const maxWar = Math.max(...cases.map((c) => Math.max(0, Number(c.later_career_war || 0))), 1)

  return (
    <main>
      <header className="hero shell">
        <div className="hero-topline">
          <span className="brand-mark">DISI</span>
          <span className={`data-badge ${live ? 'live' : ''}`}>{live ? 'Live Supabase data' : 'Verified sample mode'}</span>
        </div>
        <div className="hero-grid">
          <div>
            <p className="kicker">Dodgers International Signing Intelligence</p>
            <h1>From signing capital to championship-window value.</h1>
            <p className="lede">A public-data decision-support prototype separating talent identification, development, asset disposition, trade return, and competitive context.</p>
          </div>
          <aside className="method-card">
            <span className="eyebrow">Methodology guardrail</span>
            <strong>Tracked mature sample ≠ organization-wide hit rate.</strong>
            <p>Missing outcomes are audited explicitly, trade packages use shared attribution, and current findings are descriptive rather than causal.</p>
          </aside>
        </div>
      </header>

      <section className="shell kpi-grid">
        <Kpi label="Mature tracked signings" value={signals.mature_tracked_signings} note="Five-year-mature, audited sample" />
        <Kpi label="Verified MLB reach" value={pct(signals.mature_tracked_mlb_reach_rate)} note={`${signals.verified_mlb_players} of ${signals.mature_tracked_signings} tracked signings`} />
        <Kpi label="Tracked bonus capital" value={money(signals.mature_tracked_bonus_spend_usd)} note={`${signals.premium_5m_plus_share_of_bonus_spend_pct}% concentrated in $5M+ bonuses`} />
        <Kpi label="Later career WAR" value={num(signals.observed_later_career_war)} note={`${num(signals.observed_dodgers_regular_season_war_from_tracked_trade_returns)} LAD regular-season WAR from tracked trade returns`} />
      </section>

      <section className="shell split-grid">
        <article className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Capital allocation</span>
              <h2>Premium spend concentration</h2>
            </div>
            <span className="big-stat">{signals.premium_5m_plus_share_of_bonus_spend_pct}%</span>
          </div>
          <div className="allocation-stack">
            <div className="allocation-premium" style={{ width: `${signals.premium_5m_plus_share_of_bonus_spend_pct}%` }} />
          </div>
          <div className="legend-row"><span>$5M+ bonuses: {money(signals.premium_5m_plus_bonus_spend_usd)}</span><span>Sub-$5M: {money(Number(signals.mature_tracked_bonus_spend_usd) - Number(signals.premium_5m_plus_bonus_spend_usd))}</span></div>
          <div className="callout">
            <strong>Observed result:</strong> the $5M+ group accounts for {signals.premium_5m_plus_share_of_bonus_spend_pct}% of tracked mature bonus spend and {num(signals.premium_5m_plus_observed_career_war)} observed career WAR.
          </div>
        </article>

        <article className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Identification outcome</span>
              <h2>Later WAR by MLB-reaching asset</h2>
            </div>
          </div>
          <div className="bars">
            {cases.map((c) => <Bar key={c.player} label={c.player} value={num(c.later_career_war)} max={maxWar} />)}
          </div>
        </article>
      </section>

      <section className="shell panel findings-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Executive readout</span>
            <h2>What the tracked sample is actually saying</h2>
          </div>
          <span className="micro-note">Public-data prototype</span>
        </div>
        <div className="findings-grid">
          {findings.map((f) => (
            <article className="finding" key={f.finding_order}>
              <span className="finding-number">0{f.finding_order}</span>
              <span className="finding-category">{f.finding_category}</span>
              <h3>{f.finding}</h3>
              <p>{f.evidence}</p>
              <small>{f.analytical_caution}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="shell case-section">
        <div className="section-heading case-heading">
          <div>
            <span className="eyebrow">Asset conversion cases</span>
            <h2>Four MLB-reaching signings, four different value paths</h2>
          </div>
        </div>
        <div className="case-grid">
          {cases.map((c) => (
            <article className="case-card" key={c.player}>
              <div className="case-card-top">
                <div>
                  <span className="year-pill">{c.signing_year}</span>
                  <h3>{c.player}</h3>
                  <p>{humanize(c.identification_signal)}</p>
                </div>
                <div className="war-block">
                  <strong>{num(c.later_career_war)}</strong>
                  <span>later career WAR</span>
                </div>
              </div>

              <div className="case-metrics">
                <div><span>Signing bonus</span><strong>{money(c.signing_bonus_usd)}</strong></div>
                <div><span>WAR / $1M</span><strong>{num(c.identification_war_per_million, 2)}</strong></div>
                <div><span>Disposition</span><strong>{humanize(c.realization_channel)}</strong></div>
                <div><span>Return</span><strong>{c.return_asset || 'No direct return'}</strong></div>
              </div>

              {c.return_asset && (
                <div className="context-box">
                  <div className="context-title">Competitive context</div>
                  <div className="context-grid">
                    <span>{humanize(c.strategic_context_label)}</span>
                    <span>Urgency {c.need_urgency}/5</span>
                    <span>{humanize(c.acquisition_horizon)}</span>
                    <span>{num(c.return_lad_regular_season_war)} LAD WAR</span>
                  </div>
                </div>
              )}

              <div className="signal-row"><span>{humanize(c.conversion_signal)}</span><span>{humanize(c.attribution_status)}</span></div>
              <p className="caution">{c.attribution_caution}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="shell footer">
        <div>
          <strong>DISI v0.1</strong>
          <span>Public-data baseball operations portfolio prototype</span>
        </div>
        <div>
          <p>Next analytical expansion: complete historical signing census, development milestones, trainer networks, comparable-player models, and pool optimization.</p>
          <p className="db-lineage">Database lineage: canonical SQL layers 001–011 are preserved in <code>/database/sql</code>; repair history is preserved separately in <code>/database/repairs</code>.</p>
        </div>
      </footer>
    </main>
  )
}
