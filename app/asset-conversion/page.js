import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import PlayerLink from '../components/PlayerLink'
import { getAssetConversionData } from '../../lib/data.js'
import { bwar, humanize, dateLabel, MISSING } from '../../lib/format.js'
import { attributionLedger, attributionStateCounts, chainBlocker } from '../../lib/research/transaction-research.js'

export const metadata = { title: 'Asset Conversion' }

// Rendered per request so pages always reflect the live database (never a build-time snapshot).
export const dynamic = 'force-dynamic'


const STATE_TEXT = {
  NOT_A_TRADE_EXIT: ['Not a trade exit', 'No trade return to attribute (a release, another exit, or no exit event).'],
  RETURN_STILL_ACCRUING: ['Return still accruing', 'The signing was traded and an asset it returned is still under Dodgers control. Value is to date, not final.'],
  CHAIN_INCOMPLETE: ['Transaction history open', 'The exit, the package or a later hop is not yet recorded. Value shown is to date and not final.'],
  VALUE_NOT_DETERMINED: ['Value not determined', 'The transaction is recorded; the value of what came back is not determined (for example, a returned player\'s Baseball-Reference WAR is not loaded). This is unknown, not zero.'],
  INDIVIDUALLY_ATTRIBUTED: ['Individually attributed', 'The signing was the sole outgoing asset, so the return is attributed to it.'],
  PACKAGE_LEVEL_ONLY: ['Package level only', 'Shared package: the return is observable at package level and is not credited to this player.'],
  RECORDED_ZERO_RETURN: ['Recorded zero return', 'Every recorded return amount is exactly zero.'],
}
const STATE_ORDER = ['CHAIN_INCOMPLETE', 'RETURN_STILL_ACCRUING', 'VALUE_NOT_DETERMINED', 'PACKAGE_LEVEL_ONLY', 'INDIVIDUALLY_ATTRIBUTED', 'RECORDED_ZERO_RETURN', 'NOT_A_TRADE_EXIT']
const UNRESOLVED_STATES = new Set(['CHAIN_INCOMPLETE', 'RETURN_STILL_ACCRUING', 'VALUE_NOT_DETERMINED', 'PACKAGE_LEVEL_ONLY'])
// null is "not determined", never zero; a recorded zero prints as 0.00
const measure = (v) => (v == null ? <span className="unknown">not determined</span> : bwar(v))

// 049: KNOWN TRANSACTION != KNOWN RETURN VALUE. What is missing is one of three different things, and they are never shown as one generic "incomplete".
const MISSING_TEXT = {
  CHAIN_OR_MEMBERSHIP: 'Transaction history: what happened to a returned asset, or who was in the package, is not recorded',
  VALUE: 'Value: the transaction chain is recorded; a returned player\'s WAR (or same-season timing) is not available',
}
// why individual attribution is withheld, in the model\'s own terms
const WITHHELD_TEXT = {
  CHAIN_INCOMPLETE: 'the transaction history is open',
  RETURN_STILL_ACCRUING: 'a returned asset is still under Dodgers control',
  VALUE_NOT_DETERMINED: 'the value of the return is not determined',
  PACKAGE_LEVEL_ONLY: 'shared package: never split or weighted',
  INDIVIDUALLY_ATTRIBUTED: null,
  RECORDED_ZERO_RETURN: null,
  NOT_A_TRADE_EXIT: null,
}

function Assets({ assets }) {
  if (!assets?.length) return MISSING
  return assets.map((a, i) => <span key={`${a.name}-${i}`}>{i > 0 && ', '}{a.slug ? <PlayerLink slug={a.slug} name={a.name} /> : a.name}</span>)
}

export default async function AssetConversionPage() {
  const { live, error, packages, dispositions, bwarBySlug, pathDecisions } = await getAssetConversionData()
  const stateCounts = attributionStateCounts(pathDecisions)
  const ledger = attributionLedger(pathDecisions)
  const historyOpen = pathDecisions.filter((d) => chainBlocker(d.chain_status) === 'CHAIN_OR_MEMBERSHIP').length
  const valueBlocked = pathDecisions.filter((d) => chainBlocker(d.chain_status) === 'VALUE').length
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
          <strong>A player&apos;s later career bWAR and the Dodgers&apos; return are different measures, and a known trade is not a known value.</strong> When several players were traded together, the return is shown at package level and is not credited to any one of them.
        </div>

        <section className="table-panel" aria-labelledby="asset-paths-heading">
          <div className="table-head"><div><span className="eyebrow">What happened to the asset</span><h2 id="asset-paths-heading">Asset paths of all {pathDecisions.length} tracked signings</h2></div></div>
          <div className="coverage-grid">
            {STATE_ORDER.filter((s) => stateCounts[s]).map((s) => (
              <div key={s}>
                <span>{STATE_TEXT[s][0]}</span>
                <strong>{stateCounts[s]} of {pathDecisions.length}</strong>
                <small>{STATE_TEXT[s][1]}</small>
              </div>
            ))}
          </div>
          {(historyOpen > 0 || valueBlocked > 0) && (
            <div className="coverage-grid">
              <div><span>Transaction history open</span><strong>{historyOpen} of {pathDecisions.length}</strong><small>{MISSING_TEXT.CHAIN_OR_MEMBERSHIP}.</small></div>
              <div><span>Transaction recorded, value unavailable</span><strong>{valueBlocked} of {pathDecisions.length}</strong><small>{MISSING_TEXT.VALUE}.</small></div>
            </div>
          )}
          <p className="muted small-note">Unresolved cases are shown, not dropped and not valued at zero. Direct Dodgers value, value produced for other clubs, the part of a return attributable to the player and package-level amounts are separate measures and are never added together.</p>
          <div className="table-scroll">
            <table className="research-table">
              <thead><tr>
                <th>Class</th><th>Player</th><th>State</th><th>Chain</th><th>What is missing</th><th>Why attribution is withheld</th>
                <th className="num">Direct Dodgers bWAR</th><th className="num">For other clubs</th><th className="num">Attributable to player</th>
                <th className="num">Package, first hop</th><th className="num">Package, downstream</th><th className="num">Observable, not attributable</th>
              </tr></thead>
              <tbody>{ledger.map((r) => (
                <tr key={r.signing_id}>
                  <td>{r.signing_year}</td>
                  <td><PlayerLink slug={r.player_slug} name={r.full_name} /></td>
                  <td><span className={`state-chip ${UNRESOLVED_STATES.has(r.attribution_state) ? 'unresolved' : r.attribution_state === 'INDIVIDUALLY_ATTRIBUTED' ? 'attributed' : ''}`}>{STATE_TEXT[r.attribution_state][0]}</span></td>
                  <td>{humanize(r.chain_status)}</td>
                  <td className="wrap">{MISSING_TEXT[chainBlocker(r.chain_status)] ?? '—'}</td>
                  <td className="wrap">{WITHHELD_TEXT[r.attribution_state] ?? '—'}</td>
                  <td className="num">{measure(r.direct_dodgers_bwar)}</td>
                  <td className="num">{measure(r.value_left_organization_bwar)}</td>
                  <td className="num">{measure(r.individually_attributable_trade_bwar)}</td>
                  <td className="num">{measure(r.package_first_hop_participation_bwar)}</td>
                  <td className="num">{measure(r.package_downstream_participation_bwar)}</td>
                  <td className="num">{measure(r.observable_not_attributable_bwar)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="muted small-note">Signings that left through no trade chain (a release, another exit, or no recorded exit) are counted above and are not listed. A player leaving the organization is not a player failing.</p>
        </section>

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
                    <small>{t.return_dodgers_regular_season_bwar == null ? 'Return value not determined (not zero)' : `${bwar(t.return_dodgers_regular_season_bwar)} LAD regular-season bWAR`}</small>
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
