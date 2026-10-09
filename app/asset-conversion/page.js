import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import PlayerLink from '../components/PlayerLink'
import { getAssetConversionData } from '../../lib/data.js'
import { bwar, humanize, dateLabel, MISSING } from '../../lib/format.js'

export const metadata = { title: 'Asset Conversion' }

// Rendered per request so pages always reflect the live database (never a build-time snapshot).
export const dynamic = 'force-dynamic'

function Assets({ assets }) {
  if (!assets?.length) return MISSING
  return assets.map((a, i) => <span key={`${a.name}-${i}`}>{i > 0 && ', '}{a.slug ? <PlayerLink slug={a.slug} name={a.name} /> : a.name}</span>)
}

export default async function AssetConversionPage() {
  const { live, error, packages, dispositions, bwarBySlug } = await getAssetConversionData()
  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Organizational value realization</span>
          <h1>Asset Conversion</h1>
          <p>How Dodgers international signings left the organization by trade or release, what came back, and the competitive context at the time.</p>
        </div>
        <DataMode live={live} error={error} />
      </header>
      {!live && <DataUnavailable error={error} />}
      {live && <>
        <div className="page-guardrail">
          <strong>A player&apos;s later career bWAR and the Dodgers&apos; return are different measures.</strong> When several players were traded together, the return is shown at package level and is not credited to any one of them.
        </div>
        <section className="trade-grid">
          {packages.map((t) => {
            const war = bwarBySlug[t.player_slug]
            return (
              <article className="trade-card" key={`${t.event_key}-${t.player_slug}`}>
                <div className="trade-date">{dateLabel(t.transaction_date)} · {t.from_organization} → {t.to_organization}</div>
                <div className="trade-path">
                  <div>
                    <span>Outgoing international signing</span>
                    <strong><PlayerLink slug={t.player_slug} name={t.full_name} /></strong>
                    <small>{war?.career_bwar == null ? 'No bWAR recorded' : `${bwar(war.career_bwar)} later career bWAR`}</small>
                  </div>
                  <i>→</i>
                  <div>
                    <span>Dodgers return</span>
                    <strong><Assets assets={t.incoming_assets} /></strong>
                    <small>{t.return_dodgers_regular_season_bwar == null ? 'Return bWAR not recorded' : `${bwar(t.return_dodgers_regular_season_bwar)} LAD regular-season bWAR`}</small>
                  </div>
                </div>
                <p>Outgoing package: <Assets assets={t.outgoing_assets} /></p>
                {t.club_wins != null && (
                  <div className="context-strip">
                    <span>{t.club_wins}–{t.club_losses}</span>
                    {t.division_lead_games != null && <span>{Number(t.division_lead_games) >= 0 ? `+${t.division_lead_games}` : t.division_lead_games} games in division</span>}
                    {t.regular_season_games_remaining != null && <span>{t.regular_season_games_remaining} games left</span>}
                    {t.need_urgency != null && <span>Urgency {t.need_urgency}/5</span>}
                  </div>
                )}
                {t.strategic_context_label && <h3>{humanize(t.strategic_context_label)}</h3>}
                <p>{[t.need_category, t.acquisition_horizon, t.acquisition_season_postseason_result].filter(Boolean).map(humanize).join(' · ')}</p>
                <span className="tag emphasis">{t.attribution_status === 'SHARED_PACKAGE_RETURN' ? 'Shared package return' : 'Sole outgoing asset'}</span>
              </article>
            )
          })}
        </section>
        {dispositions.length > 0 && (
          <section className="table-panel">
            <div className="table-head"><div><span className="eyebrow">Other dispositions</span><h2>Releases and single-player transactions</h2></div></div>
            <div className="table-scroll">
              <table className="research-table">
                <thead><tr><th>Date</th><th>Player</th><th>Type</th><th>Description</th><th className="num">Later career bWAR</th></tr></thead>
                <tbody>{dispositions.map((t, i) => (
                  <tr key={`${t.player_slug}-${i}`}>
                    <td>{dateLabel(t.transaction_date)}</td>
                    <td><PlayerLink slug={t.player_slug} name={t.full_name} /></td>
                    <td>{humanize(t.transaction_type)}</td>
                    <td className="wrap">{t.description || MISSING}</td>
                    <td className="num">{bwar(bwarBySlug[t.player_slug]?.career_bwar)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        )}
      </>}
    </main>
  )
}
