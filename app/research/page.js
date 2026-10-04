import Link from 'next/link'
import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import PlayerLink from '../components/PlayerLink'
import { getResearchData, RESEARCH_TASK_TYPES } from '../../lib/data.js'
import { humanize, classStatusLabel, pctFraction, dateLabel, MISSING } from '../../lib/format.js'

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
  const { live, error, classes, tasks, taskCounts, tiers } = await getResearchData(taskType)
  const totalTasks = Object.values(taskCounts).reduce((a, b) => a + Number(b), 0)

  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Data operations</span>
          <h1>Research &amp; Data Coverage</h1>
          <p>How complete each Dodgers signing class is, which source supports the expected class size, and what research remains. A class is marked complete only when a source declares the full class and every expected signee is in the database.</p>
        </div>
        <DataMode live={live} error={error} />
      </header>

      {!live && <DataUnavailable error={error} />}

      {live && <>
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
