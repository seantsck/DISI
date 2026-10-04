import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import { getAssetConversionData } from '../../lib/data'
import { money, num, humanize, dateLabel } from '../../lib/format'

export const metadata = { title:'Asset Conversion — DISI' }

export default async function AssetConversionPage() {
  const { live, error, trades, cases } = await getAssetConversionData()
  const rosso = cases.find((c) => c.player === 'Ramon Rosso')
  return <main className="shell page-main">
    <header className="page-hero"><div><span className="eyebrow">Organizational value realization</span><h1>Asset Conversion</h1><p>How identified international talent was traded, released, or converted into major-league help under specific competitive conditions.</p></div><DataMode live={live} error={error} /></header>
    {!live && <DataUnavailable error={error} />}
    <div className="page-guardrail"><strong>Career WAR and Dodgers return WAR are not equivalent valuations.</strong> Multi-player packages use shared attribution, and competitive context is preserved separately from ex-post player outcomes.</div>
    <section className="trade-grid">{trades.map((t) => <article className="trade-card" key={t.event_key}>
      <div className="trade-date">{dateLabel(t.transaction_date)}</div>
      <div className="trade-path"><div><span>Outgoing DISI asset</span><strong>{t.disi_player}</strong><small>{num(t.disi_player_later_career_war)} later career WAR</small></div><i>→</i><div><span>Dodgers return</span><strong>{t.incoming_asset_name}</strong><small>{num(t.return_dodgers_regular_season_war)} LAD regular-season WAR</small></div></div>
      <div className="context-strip"><span>{t.club_wins}–{t.club_losses}</span><span>{Number(t.division_lead_games) >= 0 ? `+${t.division_lead_games}` : t.division_lead_games} games in division</span><span>{t.regular_season_games_remaining} games left</span><span>Urgency {t.need_urgency}/5</span></div>
      <h3>{humanize(t.strategic_context_label)}</h3>
      <p>{humanize(t.need_category)} · {humanize(t.acquisition_horizon)} · {humanize(t.acquisition_season_postseason_result)}</p>
      <span className="tag emphasis">{humanize(t.attribution_status)}</span>
    </article>)}</section>
    {rosso && <section className="release-control"><div><span className="eyebrow">Control case</span><h2>Ramon Rosso: MLB talent identified, no direct return</h2><p>Rosso later reached MLB after leaving the organization. Unlike the three trade cases, Los Angeles received no trade asset in return.</p></div><div className="release-stats"><span><strong>{money(rosso.signing_bonus_usd)}</strong> signing bonus</span><span><strong>{num(rosso.later_career_war)}</strong> later career WAR</span></div></section>}
  </main>
}
