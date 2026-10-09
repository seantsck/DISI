import Link from 'next/link'
import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import PlayerLink from '../components/PlayerLink'
import { getResearchData, RESEARCH_TASK_TYPES } from '../../lib/data.js'
import { humanize, classStatusLabel, populationScopeLabel, pctFraction, dateLabel, MISSING } from '../../lib/format.js'

export const metadata = { title: 'Research & Data Coverage' }

const TASK_LABELS = {
  CLASS_MEMBERS_MISSING: 'Expected class members not yet in database',
  BWAR_MISSING: 'Verified MLB player without Baseball-Reference bWAR',
  OUTCOME_AUDIT: 'Outcome not yet audited',
  CLASS_SIZE_SOURCE_NOT_OFFICIAL: 'Class size not yet backed by an official release',
  MARKET_MISSING: 'Signing market unknown',
  SIGNING_DATE_MISSING: 'Exact signing date unknown',
  ACQUISITION_COST_UNKNOWN: 'Acquisition cost unknown',
}

export default async function ResearchPage({ searchParams }) {
  const raw = (await searchParams).task
  const taskType = RESEARCH_TASK_TYPES.includes(raw) ? raw : undefined
  const { live, error, classes, tasks, taskCounts, tiers, populations, reconciliation, periodQueue, outcomeProgress, outcomeClasses } = await getResearchData(taskType)
  const totalTasks = Object.values(taskCounts).reduce((a, b) => a + Number(b), 0)

  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Data operations</span>
          <h1>Research &amp; Data Coverage</h1>
          <p>How complete each Dodgers signing population is, which source supports its size, and what research remains. An announced opening class is not the full signing period: clubs keep signing players after the opening announcement, so only a complete full-period population can support an organization MLB reach rate.</p>
        </div>
        <DataMode live={live} error={error} />
      </header>

      {!live && <DataUnavailable error={error} />}

      {live && <>
        {outcomeProgress && (
          <section className="table-panel">
            <div className="table-head">
              <div><span className="eyebrow">Outcome audits</span><h2>Outcome audits by signing class</h2></div>
              <span className="micro-note">
                {outcomeProgress.audited} of {outcomeProgress.tracked_signings} audited · {outcomeProgress.mature_unaudited} mature signings still unaudited · {outcomeProgress.developing_unaudited} developing
              </span>
            </div>
            <div className="table-scroll">
              <table className="research-table">
                <thead>
                  <tr>
                    <th className="num">Year</th><th className="num">Tracked</th><th className="num">Audited</th><th className="num">Reached MLB</th>
                    <th className="num">No MLB (audited)</th><th className="num">Unaudited</th><th>Maturity</th><th>Tracked-cohort outcome</th><th>Organization rate</th>
                  </tr>
                </thead>
                <tbody>
                  {outcomeClasses.map((c) => (
                    <tr key={c.signing_year}>
                      <td className="num">{c.signing_year}</td>
                      <td className="num">{c.tracked_players}</td>
                      <td className="num">{c.audited}</td>
                      <td className="num">{c.mlb_reached}</td>
                      <td className="num">{c.verified_no_mlb}{c.no_mlb_still_active > 0 && <small className="muted block">{c.no_mlb_still_active} still active</small>}</td>
                      <td className="num">{c.unresolved}</td>
                      <td>{humanize(c.maturity_status)}</td>
                      <td>{c.tracked_cohort_mlb_share == null ? <span className="muted">Not all audited</span> : `${pctFraction(c.tracked_cohort_mlb_share, 0)} of tracked players`}</td>
                      <td>{c.organization_rate_allowed ? 'Allowed' : <span className="muted">Not allowed</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="micro-note table-foot">A tracked-cohort outcome describes only the players DISI tracks for that class (often a historical sample or a partial class). It is not an organization-wide class rate unless a complete full signing-period population qualifies.</p>
          </section>
        )}

        <section className="table-panel">
          <div className="table-head">
            <div><span className="eyebrow">Populations</span><h2>Signing populations and rate eligibility</h2></div>
            <span className="micro-note">Announcement total is not necessarily the full signing-period total</span>
          </div>
          <div className="table-scroll">
            <table className="research-table">
              <thead>
                <tr>
                  <th className="num">Class year</th><th>Population</th><th>Period</th><th className="num">Expected</th>
                  <th className="num">Tracked</th><th className="num">Coverage</th><th>Completeness</th><th>Source</th>
                  <th>Organization rate analysis</th>
                </tr>
              </thead>
              <tbody>
                {populations.map((p) => (
                  <tr key={p.population_key}>
                    <td className="num">{p.signing_year}</td>
                    <td>
                      <strong>{populationScopeLabel(p.population_scope)}</strong>
                      {p.provisional_members > 0 && <small className="muted block">{p.provisional_members} provisional</small>}
                    </td>
                    <td>{p.period_label}</td>
                    <td className="num">{p.expected_population ?? MISSING}</td>
                    <td className="num">{p.tracked_population}</td>
                    <td className="num">{p.coverage_rate == null ? MISSING : pctFraction(p.coverage_rate, 0)}</td>
                    <td>
                      {humanize(p.completeness_status)}
                      {p.unresolved_conflicts > 0 && <small className="muted block">{p.unresolved_conflicts} unresolved conflict{p.unresolved_conflicts === 1 ? '' : 's'}</small>}
                    </td>
                    <td className="source-cell">
                      {p.source_url
                        ? <>
                            <a className="source-link" href={p.source_url} target="_blank" rel="noopener noreferrer">{p.source_title || 'Source'}</a>
                            <small className="muted block">{humanize(p.source_tier)}{p.source_published && ` · ${dateLabel(p.source_published)}`}</small>
                          </>
                        : <span className="muted">No source for the population size</span>}
                    </td>
                    <td>{p.rate_eligible ? 'Eligible' : humanize(p.rate_exclusion_reason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="micro-note table-foot">Only a complete, fully audited, five-year-mature full signing-period population can produce an organization MLB reach rate. Statistics over an announced opening class are labelled opening-class cohort rates.</p>
        </section>

        <section className="table-panel">
          <div className="table-head">
            <div><span className="eyebrow">Signing periods</span><h2>Population research queue</h2></div>
            <span className="micro-note">{periodQueue.length} highest-priority items</span>
          </div>
          <div className="table-scroll">
            <table className="research-table">
              <thead><tr><th className="num">Priority</th><th>Task</th><th className="num">Year</th><th>Player</th><th>Detail</th></tr></thead>
              <tbody>
                {periodQueue.map((t, i) => (
                  <tr key={`${t.task_type}-${t.population_key || t.player_id || t.full_name}-${i}`}>
                    <td className="num">{t.priority}</td>
                    <td>{humanize(t.task_type)}</td>
                    <td className="num">{t.signing_year ?? MISSING}</td>
                    <td>{t.player_slug ? <PlayerLink slug={t.player_slug} name={t.full_name} /> : (t.full_name || <span className="muted">Population</span>)}</td>
                    <td className="wrap">{t.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="table-panel">
          <div className="table-head">
            <div><span className="eyebrow">Reconciliation</span><h2>Signings with unresolved class or source questions</h2></div>
            <span className="micro-note">{reconciliation.length} flagged signings</span>
          </div>
          <div className="table-scroll">
            <table className="research-table">
              <thead><tr><th className="num">Year</th><th>Player</th><th>Classification</th><th>Announced</th><th>MLB transaction</th><th className="num">Sources</th><th>Conflicts</th></tr></thead>
              <tbody>
                {reconciliation.map((r) => (
                  <tr key={`${r.signing_year}-${r.player_slug}`}>
                    <td className="num">{r.signing_year}</td>
                    <td><PlayerLink slug={r.player_slug} name={r.full_name} /></td>
                    <td>{humanize(r.classification)}</td>
                    <td>{dateLabel(r.announced_date)}</td>
                    <td>{dateLabel(r.formal_transaction_date)}</td>
                    <td className="num">{r.source_count}</td>
                    <td>{(r.conflict_types || []).map(humanize).join(', ') || MISSING}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="table-panel">
          <div className="table-head">
            <div><span className="eyebrow">By signing year</span><h2>Signing-class coverage</h2></div>
            <span className="micro-note">Tracked counts are computed live from signing rows</span>
          </div>
          <div className="table-scroll">
            <table className="research-table">
              <thead>
                <tr>
                  <th className="num">Year</th>
                  <th>Status</th>
                  <th className="num">Expected</th>
                  <th className="num">Tracked</th>
                  <th className="num">Coverage</th>
                  <th>Source for expected size</th>
                  <th className="num">Known bonus</th>
                  <th className="num">Outcome audits</th>
                  <th className="num">Verified MLB</th>
                  <th className="num">With bWAR</th>
                  <th className="num">Research queue</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.signing_year}>
                    <td className="num"><Link className="player-link" href={`/signings?year=${c.signing_year}`}>{c.signing_year}</Link></td>
                    <td>
                      <span className={`class-status class-${String(c.class_status).toLowerCase()}`}>{classStatusLabel(c.class_status)}</span>
                      {c.declaration_period && c.declaration_period.includes('–') && <small className="muted block">Declared for {c.declaration_period}</small>}
                    </td>
                    <td className="num">{c.expected_class_size ?? MISSING}</td>
                    <td className="num">{c.tracked_class_size}</td>
                    <td className="num">{c.coverage_rate == null ? MISSING : pctFraction(c.coverage_rate, 0)}</td>
                    <td className="source-cell">
                      {c.expected_size_source_url
                        ? <>
                            <a className="source-link" href={c.expected_size_source_url} target="_blank" rel="noopener noreferrer">{c.expected_size_source_title || 'Source'}</a>
                            <small className="muted block">{humanize(c.expected_size_source_tier)}{c.expected_size_source_published && ` · ${dateLabel(c.expected_size_source_published)}`}{c.needs_official_size_source && ' · official release needed'}</small>
                          </>
                        : <span className="muted">{c.expected_class_size == null ? 'Class size not established' : MISSING}</span>}
                    </td>
                    <td className="num">{c.known_bonus_count}</td>
                    <td className="num">{c.outcome_audit_count}</td>
                    <td className="num">{c.verified_mlb_count}</td>
                    <td className="num">{c.bwar_count}</td>
                    <td className="num">
                      <strong>{c.research_queue_items}</strong>
                      {c.missing_from_expected > 0 && <small className="muted block">{c.missing_from_expected} signees missing</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="micro-note table-foot">Research queue = expected signees not yet in the database + outcomes not yet audited + verified MLB players without bWAR + one item when the class size lacks an official source.</p>
        </section>

        <section className="table-panel">
          <div className="table-head">
            <div><span className="eyebrow">Open work</span><h2>Research queue</h2></div>
            <span className="micro-note">{totalTasks.toLocaleString()} open tasks for the Dodgers franchise</span>
          </div>
          <nav className="task-filter" aria-label="Filter research tasks">
            <Link className={!taskType ? 'active' : ''} href="/research" scroll={false}>All ({totalTasks})</Link>
            {RESEARCH_TASK_TYPES.map((type) => (
              <Link key={type} className={taskType === type ? 'active' : ''} href={`/research?task=${type}`} scroll={false}>
                {TASK_LABELS[type]} ({taskCounts[type] ?? 0})
              </Link>
            ))}
          </nav>
          <div className="table-scroll">
            <table className="research-table">
              <thead><tr><th className="num">Priority</th><th>Task</th><th className="num">Year</th><th>Player</th><th>Detail</th></tr></thead>
              <tbody>
                {tasks.map((t, i) => (
                  <tr key={`${t.task_type}-${t.player_id || t.signing_year}-${i}`}>
                    <td className="num">{t.priority}</td>
                    <td>{TASK_LABELS[t.task_type] || humanize(t.task_type)}</td>
                    <td className="num">{t.signing_year}</td>
                    <td>{t.player_slug ? <PlayerLink slug={t.player_slug} name={t.full_name} /> : <span className="muted">Class-level</span>}</td>
                    <td className="wrap">{t.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tasks.length >= 200 && <p className="micro-note table-foot">Showing the 200 highest-priority tasks. Filter by task type to see more specific lists.</p>}
        </section>

        <section className="table-panel">
          <div className="table-head"><div><span className="eyebrow">Ingestion strategy</span><h2>Source priority</h2></div></div>
          <div className="table-scroll">
            <table className="research-table">
              <thead><tr><th className="num">Priority</th><th>Source tier</th><th>Authoritative for</th><th>Not used for</th><th>Notes</th></tr></thead>
              <tbody>{tiers.map((t) => (
                <tr key={t.tier_code}>
                  <td className="num">{t.priority}</td>
                  <td><strong>{t.label}</strong></td>
                  <td className="wrap">{(t.authoritative_for || []).map(humanize).join(', ') || MISSING}</td>
                  <td className="wrap">{(t.not_authoritative_for || []).map(humanize).join(', ') || MISSING}</td>
                  <td className="wrap">{t.notes}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      </>}
    </main>
  )
}
