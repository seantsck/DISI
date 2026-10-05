import { cache } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import DataUnavailable from '../../components/DataUnavailable'
import AuditBadge from '../../components/AuditBadge'
import PlayerLink from '../../components/PlayerLink'
import { getPlayerDossier } from '../../../lib/data.js'
import {
  money, moneyExact, num, bwar, humanize, dateLabel, yesNoUnknown, statusLabel, populationScopeLabel, MISSING,
} from '../../../lib/format.js'

const loadDossier = cache(getPlayerDossier)

export async function generateMetadata({ params }) {
  const { slug } = await params
  const { player } = await loadDossier(slug)
  return { title: player ? player.full_name : 'Player not found' }
}

const UNKNOWN = 'Unknown'

/** Value or the word "Unknown"; never fabricates a biography field. */
function known(value, format = (v) => v) {
  return value == null || value === '' ? <span className="unknown">{UNKNOWN}</span> : format(value)
}

function moneyFact(value) {
  return value == null
    ? <span className="unknown">Unknown (not $0)</span>
    : <span title={moneyExact(value)}>{moneyExact(value)}</span>
}

function heightLabel(inches) {
  const n = Number(inches)
  return `${Math.floor(n / 12)}′ ${Math.round(n % 12)}″`
}

function Fact({ label, children }) {
  return <div className="fact"><dt>{label}</dt><dd>{children}</dd></div>
}

function SourceLink({ url, title }) {
  if (!url) return null
  return <a className="source-link" href={url} target="_blank" rel="noopener noreferrer">{title || new URL(url).hostname}</a>
}

function AssetList({ assets }) {
  if (!assets?.length) return <span className="unknown">{UNKNOWN}</span>
  return assets.map((a, i) => (
    <span key={`${a.name}-${i}`}>{i > 0 && ', '}{a.slug ? <PlayerLink slug={a.slug} name={a.name} /> : a.name}</span>
  ))
}

/** Neutral wording for audited non-MLB outcomes; never a failure label. */
function outcomeStateLabel(state, through) {
  const date = through ? dateLabel(through) : 'the audit date'
  switch (state) {
    case 'NO_MLB_CAREER_ENDED': return `Did not reach MLB through ${date}; no longer in affiliated baseball`
    case 'NO_MLB_ACTIVE_IN_MINORS': return `Still in affiliated baseball; no MLB debut through ${date}`
    case 'NO_MLB_STATUS_UNKNOWN': return `No MLB debut through ${date}; current affiliated status not established`
    default: return humanize(state)
  }
}

function dispositionLabel(p) {
  const when = p.final_transaction_date ? ` ${dateLabel(p.final_transaction_date)}` : ''
  const by = p.final_organization ? ` by ${p.final_organization}` : ''
  switch (p.disposition) {
    case 'RELEASED': return `Released${when}${by}`
    case 'FREE_AGENT': return `Became a free agent${when}`
    case 'RETIRED': return `Retired${when}`
    case 'ACTIVE': return 'Active in affiliated baseball'
    case 'UNKNOWN': return <span className="unknown">Not recorded in transactions</span>
    default: return <span className="unknown">{UNKNOWN}</span>
  }
}

function timelineDate(event) {
  if (event.date_precision === 'DAY' && event.event_date) return dateLabel(event.event_date)
  return event.event_year ?? 'Date unknown'
}

export default async function PlayerPage({ params }) {
  const { slug } = await params
  const { live, error, player, signings, timeline, transactions, sources, trainers, metrics, memberships } = await loadDossier(slug)

  if (!live) {
    return (
      <main className="shell page-main">
        <header className="page-hero"><div><span className="eyebrow">Player dossier</span><h1>Player data unavailable</h1></div></header>
        <DataUnavailable error={error} />
      </main>
    )
  }
  if (!player) notFound()

  const p = player
  const birthPlace = [p.birth_city, p.birth_country].filter(Boolean).join(', ')
  const bwarHistory = metrics.filter((m) => m.metric_key === 'CAREER_BWAR')
  const fwarHistory = metrics.filter((m) => m.metric_key === 'CAREER_FWAR')

  return (
    <main className="shell page-main dossier">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/players">Players</Link> <span aria-hidden="true">/</span> <span>{p.full_name}</span>
      </nav>

      <header className="dossier-head">
        <div>
          <span className="eyebrow">Player dossier</span>
          <h1>{p.full_name}</h1>
          {p.aliases.length > 0 && <p className="aliases">Also recorded as {p.aliases.join(' · ')}</p>}
          <div className="signal-row">
            {p.primary_position && <span>{p.primary_position}</span>}
            {(p.birth_country || signings[0]?.country_market) && <span>{p.birth_country || signings[0]?.country_market}</span>}
            {signings.map((s) => <span key={s.signing_id}>{s.organization_name} {s.signing_year}</span>)}
            {p.current_status && <span>{statusLabel(p.current_status)}</span>}
          </div>
        </div>
        <div className="dossier-war">
          <span className="eyebrow">Career bWAR</span>
          <strong>{p.career_bwar == null ? MISSING : bwar(p.career_bwar)}</strong>
          <small>
            {p.career_bwar == null
              ? (p.reached_mlb_verified ? 'No Baseball-Reference observation recorded yet' : 'No MLB value recorded')
              : <>
                  Through {p.bwar_observed_through_season ? `the ${p.bwar_observed_through_season} season` : dateLabel(p.bwar_observed_through_date)}
                  {p.is_active && <> · <b>active player, total still changing</b></>}
                  <br />Observed {dateLabel(p.bwar_observed_through_date)}
                </>}
          </small>
        </div>
      </header>

      <div className="dossier-grid">
        <section className="panel">
          <h2>Biography</h2>
          <dl className="fact-grid">
            <Fact label="Full name">{p.full_name}</Fact>
            <Fact label="Aliases">{p.aliases.length ? p.aliases.join(', ') : <span className="unknown">None recorded</span>}</Fact>
            <Fact label="Birth date">{known(p.birth_date, dateLabel)}</Fact>
            <Fact label="Birthplace">{known(birthPlace)}</Fact>
            <Fact label="Birth country">{known(p.birth_country)}</Fact>
            <Fact label="Nationality">{known(p.nationality)}</Fact>
            <Fact label="Position">{known(p.primary_position)}{p.secondary_positions?.length ? ` (also ${p.secondary_positions.join(', ')})` : ''}</Fact>
            <Fact label="Bats / throws">{known(p.bats)} / {known(p.throws)}</Fact>
            {p.height_in != null && <Fact label="Height">{heightLabel(p.height_in)}</Fact>}
            {p.weight_lb != null && <Fact label="Weight">{num(p.weight_lb, 0)} lb</Fact>}
          </dl>
        </section>

        <section className="panel">
          <h2>MLB outcome</h2>
          <dl className="fact-grid">
            <Fact label="Outcome audit"><AuditBadge status={p.outcome_audit_status} /></Fact>
            <Fact label="Audited through">{p.audited_through_date ? dateLabel(p.audited_through_date) : <span className="unknown">Not yet audited</span>}</Fact>
            <Fact label="MLB reached">{p.outcome_audit_status === 'NOT_AUDITED' ? <span className="unknown">Unknown — not audited</span> : yesNoUnknown(p.reached_mlb_verified)}</Fact>
            <Fact label="MLB debut">{p.mlb_debut_date ? dateLabel(p.mlb_debut_date) : <span className="unknown">{p.reached_mlb_verified === false ? 'None found' : UNKNOWN}</span>}</Fact>
            <Fact label="Debut organization">{known(p.mlb_debut_org_name)}</Fact>
            <Fact label="Debut directly with Dodgers franchise">{p.mlb_debut_date ? yesNoUnknown(p.direct_dodgers_franchise_debut) : <span className="unknown">Not applicable</span>}</Fact>
            <Fact label="Current / final status">{known(p.current_status, statusLabel)}</Fact>
            {p.outcome_state && p.outcome_state !== 'REACHED_MLB' && (
              <Fact label="Outcome">{outcomeStateLabel(p.outcome_state, p.audited_through_date)}</Fact>
            )}
            {p.outcome_audit_status !== 'NOT_AUDITED' && (
              <Fact label="Audit confidence">{p.audit_confidence ? humanize(p.audit_confidence) : <span className="unknown">{UNKNOWN}</span>}</Fact>
            )}
            <Fact label="Career bWAR">
              {p.career_bwar == null ? <span className="unknown">{UNKNOWN}</span> : <>
                {bwar(p.career_bwar)} <span className="muted">through {p.bwar_observed_through_season ?? dateLabel(p.bwar_observed_through_date)}</span>{' '}
                <SourceLink url={p.bwar_source_url} title="Baseball-Reference" />
              </>}
            </Fact>
            {p.career_fwar != null && (
              <Fact label="Career fWAR (FanGraphs, separate metric)">
                {num(p.career_fwar)} <span className="muted">through {p.fwar_observed_through_season ?? dateLabel(p.fwar_observed_through_date)}</span>{' '}
                <SourceLink url={p.fwar_source_url} title="FanGraphs" />
              </Fact>
            )}
          </dl>
          {p.progress_as_of_date && (
            <>
              <h3 className="sub">
                {p.outcome_audit_status === 'NOT_AUDITED' ? 'Professional progress (not an outcome)' : 'Professional record'}
              </h3>
              <dl className="fact-grid">
                <Fact label="Highest level">{p.highest_level ? `${p.highest_level}${p.highest_level_season ? ` (${p.highest_level_season})` : ''}` : <span className="unknown">No affiliated games recorded</span>}</Fact>
                <Fact label="Last affiliated season">{p.last_affiliated_season ? `${p.last_affiliated_season}${p.last_affiliated_team ? ` · ${p.last_affiliated_team}` : ''}` : <span className="unknown">{UNKNOWN}</span>}</Fact>
                <Fact label="Disposition">{dispositionLabel(p)}</Fact>
                <Fact label="Outside affiliated baseball">{p.continued_outside_affiliated ? 'Continued professionally (e.g. Mexican League)' : <span className="unknown">Not recorded</span>}</Fact>
              </dl>
              <p className="muted small-note">As of {dateLabel(p.progress_as_of_date)} from MLB / MiLB records; see Sources and provenance.</p>
            </>
          )}
          <p className="method-note">
            <strong>bWAR</strong> is Baseball-Reference Wins Above Replacement (also called rWAR). Other WAR implementations, such as
            FanGraphs fWAR, use different inputs and can differ for the same player. DISI stores each metric with its own source and
            observation date and never converts or blends them.
          </p>
        </section>
      </div>

      <section className="panel section-gap">
        <h2>Acquisition</h2>
        {signings.length === 0 && <p className="unknown">No signing record is linked to this player.</p>}
        {signings.map((s) => (
          <div className="signing-block" key={s.signing_id}>
            <h3>{s.organization_name} · {s.signing_year}</h3>
            <dl className="fact-grid wide">
              <Fact label="Signing year">{s.signing_year}</Fact>
              <Fact label="Signing date">{known(s.signing_date, dateLabel)}</Fact>
              <Fact label="Announced in class">{s.announced_date ? dateLabel(s.announced_date) : <span className="unknown">Not recorded</span>}</Fact>
              <Fact label="Formal MLB transaction">{s.formal_transaction_date ? dateLabel(s.formal_transaction_date) : <span className="unknown">Not verified</span>}</Fact>
              <Fact label="Signing market">{known(s.country_market)}</Fact>
              <Fact label="Acquisition pathway">{humanize(s.pathway)}</Fact>
              <Fact label="Source league">{known(s.source_league)}</Fact>
              <Fact label="Source club">{known(s.source_club)}</Fact>
              <Fact label="Professional experience before acquisition">{known(s.professional_experience_years, (v) => `${num(v, 1)} years`)}</Fact>
              <Fact label="Age at signing">{known(s.age_at_signing, (v) => num(v, 1))}</Fact>
              <Fact label="Signing bonus">{moneyFact(s.signing_bonus_usd)}</Fact>
              <Fact label="Posting fee">{moneyFact(s.posting_fee_usd)}</Fact>
              <Fact label="Transfer / acquisition fee">{moneyFact(s.transfer_fee_usd)}</Fact>
              <Fact label="Total known acquisition cost">{moneyFact(s.total_known_acquisition_cost_usd)}</Fact>
              <Fact label="International prospect rank">{s.international_rank == null ? <span className="unknown">Unranked / unknown</span> : `No. ${num(s.international_rank, 0)}`}</Fact>
              <Fact label="Rank source">{known(s.rank_source)}</Fact>
              <Fact label="Record scope">{humanize(s.record_scope)}</Fact>
              <Fact label="Signing-class coverage">{known(s.coverage_type, humanize)}</Fact>
            </dl>
            {memberships.some((m) => m.signing_id === s.signing_id) && (
              <>
                <h4 className="sub">Class membership</h4>
                <ul className="plain-list">
                  {memberships.filter((m) => m.signing_id === s.signing_id).map((m) => (
                    <li key={m.population_key}>
                      <strong>{populationScopeLabel(m.population_scope)}</strong> · {m.period_label}
                      {m.membership_status === 'PROVISIONAL' && <span className="muted"> (provisional)</span>}
                      <span className="muted">
                        {' · '}{m.source_count} source{m.source_count === 1 ? '' : 's'}
                        {m.membership_bases?.length ? `: ${m.membership_bases.map(humanize).join(', ')}` : ''}
                        {' · population '}{humanize(m.completeness_status)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {s.signing_notes && <p className="note">{s.signing_notes}</p>}
          </div>
        ))}
      </section>

      <section className="panel section-gap">
        <h2>Timeline</h2>
        {timeline.length === 0 ? <p className="unknown">No dated events recorded.</p> : (
          <ol className="timeline">
            {timeline.map((e, i) => (
              <li key={`${e.event_type}-${i}`} className={`timeline-${e.event_type.toLowerCase()}`}>
                <span className="timeline-date">{timelineDate(e)}</span>
                <div>
                  <strong>{e.title}</strong>
                  {e.detail && <p>{e.detail}</p>}
                  <SourceLink url={e.source_url} title={e.source_title} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="dossier-grid">
        <section className="panel">
          <h2>Development</h2>
          <h3 className="sub">Trainer / academy relationships</h3>
          {trainers.length === 0 ? <p className="unknown">None recorded.</p> : (
            <ul className="plain-list">
              {trainers.map((t, i) => (
                <li key={i}>
                  <strong>{t.trainer_name}</strong>{t.academy_name && ` · ${t.academy_name}`}
                  <span className="muted"> · {humanize(t.relationship_type)}{t.country && ` · ${t.country}`} · confidence {humanize(t.confidence)}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="sub">Milestones and progression</h3>
          {timeline.some((e) => e.event_type === 'DEVELOPMENT')
            ? <p className="muted">Development milestones are shown in the timeline.</p>
            : <p className="unknown">No minor-league milestones recorded yet. Progression data will come from MiLB / MLB player records.</p>}
        </section>

        <section className="panel">
          <h2>bWAR observations</h2>
          {bwarHistory.length === 0 ? <p className="unknown">No Baseball-Reference observation recorded.</p> : (
            <table className="compact-table">
              <thead><tr><th>Observed</th><th>Through season</th><th className="num">Career bWAR</th><th>Source</th></tr></thead>
              <tbody>{bwarHistory.map((m) => (
                <tr key={m.observed_through_date}>
                  <td>{dateLabel(m.observed_through_date)}</td>
                  <td>{m.observed_through_season ?? MISSING}</td>
                  <td className="num">{bwar(m.value)}</td>
                  <td><SourceLink url={m.sources?.url} title="Baseball-Reference" /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {fwarHistory.length > 0 && (
            <>
              <h3 className="sub">fWAR observations (FanGraphs — not comparable to bWAR)</h3>
              <table className="compact-table">
                <thead><tr><th>Observed</th><th>Through season</th><th className="num">Career fWAR</th><th>Source</th></tr></thead>
                <tbody>{fwarHistory.map((m) => (
                  <tr key={m.observed_through_date}>
                    <td>{dateLabel(m.observed_through_date)}</td><td>{m.observed_through_season ?? MISSING}</td>
                    <td className="num">{num(m.value)}</td><td><SourceLink url={m.sources?.url} title="FanGraphs" /></td>
                  </tr>
                ))}</tbody>
              </table>
            </>
          )}
        </section>
      </div>

      <section className="panel section-gap">
        <h2>Transactions and disposition</h2>
        {transactions.length === 0 ? <p className="unknown">No trades, releases or other transactions recorded.</p> : transactions.map((t, i) => (
          <article className="transaction-block" key={t.event_key || `${t.transaction_date}-${i}`}>
            <div className="trade-date">{dateLabel(t.transaction_date)} · {humanize(t.transaction_type)}</div>
            <h3>{t.description || humanize(t.transaction_type)}</h3>
            {t.record_kind === 'PACKAGE_EVENT' && (
              <dl className="fact-grid wide">
                <Fact label="From → to">{t.from_organization || UNKNOWN} → {t.to_organization || UNKNOWN}</Fact>
                <Fact label="Outgoing package">{<AssetList assets={t.outgoing_assets} />} <span className="muted">({t.outgoing_asset_count} asset{t.outgoing_asset_count === 1 ? '' : 's'})</span></Fact>
                <Fact label="Incoming return">{<AssetList assets={t.incoming_assets} />}</Fact>
                <Fact label="Return attribution">
                  {t.attribution_status === 'SHARED_PACKAGE_RETURN'
                    ? 'Shared package: the return is not attributed to this player alone'
                    : t.attribution_status === 'SOLE_OUTGOING_ASSET' ? 'Sole outgoing asset' : MISSING}
                </Fact>
                {t.return_asset_name && (
                  <Fact label="Return value to Dodgers">
                    {t.return_asset_name}: {bwar(t.return_dodgers_regular_season_bwar)} regular-season bWAR with LAD
                    {t.return_observed_through_date && <span className="muted"> (through {dateLabel(t.return_observed_through_date)})</span>}
                    {t.return_world_series_roster && <span className="muted"> · World Series roster</span>}
                  </Fact>
                )}
                {t.club_wins != null && (
                  <Fact label="Competitive context">
                    {t.club_wins}–{t.club_losses}
                    {t.division_lead_games != null && ` · ${Number(t.division_lead_games) >= 0 ? '+' : ''}${t.division_lead_games} games in division`}
                    {t.regular_season_games_remaining != null && ` · ${t.regular_season_games_remaining} games left`}
                    {t.need_category && ` · need: ${humanize(t.need_category)}`}
                    {t.need_urgency != null && ` (urgency ${t.need_urgency}/5)`}
                    {t.acquisition_season_postseason_result && ` · season result: ${humanize(t.acquisition_season_postseason_result)}`}
                  </Fact>
                )}
              </dl>
            )}
            {t.valuation_note && <p className="note">{t.valuation_note}</p>}
            <SourceLink url={t.source_url} title={t.source_title} />
          </article>
        ))}
      </section>

      <section className="panel section-gap">
        <h2>Sources and provenance</h2>
        {sources.length === 0 ? <p className="unknown">No sources are linked to this player yet.</p> : (
          <div className="table-scroll">
            <table className="compact-table">
              <thead><tr><th>Fact</th><th>Source</th><th>Tier</th><th>Published</th><th>Accessed</th><th>Confidence</th></tr></thead>
              <tbody>{sources.map((s, i) => (
                <tr key={`${s.source_id}-${s.fact}-${i}`}>
                  <td>{s.fact}</td>
                  <td><SourceLink url={s.url} title={s.title || s.source_name} /><small className="muted block">{s.source_name} · {humanize(s.source_type)}</small></td>
                  <td>{humanize(s.source_tier)}</td>
                  <td>{dateLabel(s.publication_date)}</td>
                  <td>{dateLabel(s.accessed_date)}</td>
                  <td>{s.confidence ? humanize(s.confidence) : MISSING}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
