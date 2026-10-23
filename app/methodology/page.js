import Link from 'next/link'
import manifest from '../../database/manifest.json'

export const metadata = { title: 'Methodology' }

const rules = [
  ['Missing is never zero', 'Unknown bonuses, fees, dates, outcomes and biography fields stay NULL and display as “—” or “Unknown”. A sum of known costs never treats an unknown component as $0.'],
  ['Unaudited is never failure', 'A player is “not audited” until public records support either a verified MLB debut or a verified absence of one. Only audited players count as reaching or not reaching MLB.'],
  ['Audited no-MLB is not career failure', 'An audited no-MLB player’s path is described by what is recorded: the highest recorded affiliated level, the last observed affiliated season and the seasons on record. A last observed season is not a career end or a release, a missing season is unknown, later play with another organization is not Dodgers development, and no reason is inferred from a gap.'],
  ['Organizations and levels are season facts', 'A stint’s organization is the parent the official team record names for that team in that season, never one inferred from the affiliate’s name, an adjacent season or the modern franchise. A league’s classification is also a season fact: a historical label is never carried to another season, and a level is never assigned by assumption. The cancelled 2020 minor-league season is not a player’s missing season; every other missing season stays unknown. A change of organization is explained only by a recorded transaction.'],
  ['Disagreeing sources stay disagreeing', 'When independent sources report different amounts, every report is kept, the canonical value stays unknown and the signing is queued as a conflict. A reviewed decision, never the latest report, is the only way to choose one.'],
  ['Samples are not censuses', 'A historically verified set or an MLB Pipeline Top 30/50 tracker is a sample. A population is complete only when a source states its size, every member is in the database and no source conflict is open.'],
  ['Announcement total ≠ signing-period total', 'A club’s class announcement usually describes the players signed when the period opens; signing continues afterwards. A complete announced opening class is never treated as a complete signing period.'],
  ['Rates require eligible denominators', 'An organization MLB reach rate requires a complete full signing-period population, a complete outcome audit and five years of maturity. Statistics over an opening class are labelled opening-class cohort rates. Otherwise verified MLB players are reported as counts.'],
  ['Announced ≠ transacted', 'A player can be announced in a class while the formal MLB transaction is dated later. Announcement date, transaction date and class year are stored separately; a verified transaction date is never rewritten.'],
  ['Costs stay separate', 'Signing bonus, posting fee and transfer / acquisition fee are separate fields. Total known acquisition cost adds only the components that are known.'],
  ['Package-aware trades', 'The full return of a multi-player trade is shown at package level and is never assigned to one outgoing player.'],
  ['One franchise, historical names', 'Brooklyn and Los Angeles share franchise key DODGERS for value realization, while historical organization names (e.g. Brooklyn Dodgers, 1952 debut) are preserved.'],
  ['Pathways stay separate', 'Teenage amateur signings, Cuban professionals, Mexican League transfers and posted NPB/KBO players are distinct acquisition populations.'],
]

const decisionLayers = [
  ['Scouting expectation (036)', 'Public rankings and grades are recorded as opinions at a date. An expectation counts as known at signing only if it was published by the signing date; calibration is descriptive and needs audited outcomes.'],
  ['Development pathway (037)', 'Season-level levels and progression decisions describe what happened. Pathway summaries are descriptive and never imply that a pathway causes an outcome.'],
  ['Network context (038)', 'Trainer and academy associations are source-stated. Outcomes by network entity are shown with their selection bias and are never ranked.'],
  ['Market and pathway intelligence (039)', 'A signing-time feature record holds only facts knowable at signing (no outcome, position at signing). Samples stay separate; a census rate needs a fully audited class.'],
  ['Historical comparables (040)', 'Up to 20 earlier, non-outcome-selected signings matched on signing-time features; a missing value never matches; outcomes are attached only after the comparables are chosen. Comparables are history, not a forecast.'],
  ['Outcome probability (041)', 'A probability is published only when its reference population has at least 50 labelled outcomes, 10 positives and 10 negatives. Young, active, censored or unaudited players are never negatives. Today no target qualifies, and no fitted model beats the naive base rate out of time, so every probability is NULL with a reason.'],
  ['Organizational value (042)', 'Realized value is regular-season bWAR the Dodgers obtained: as Dodgers, plus trade returns attributable to a single outgoing player. Shared-package value, unattributable downstream value and MLB value produced for other clubs are kept separate. Expected value needs a supported probability and enough observed value, so it is not estimated today.'],
  ['Portfolio decision support (043)', 'Each candidate is assessed with information available at its signing date. Only candidates with a supported expected value, complete cost and complete features may enter value-based optimization; none qualifies today, so DISI shows feasibility, history and the evidence needed, never a ranking.'],
]

const sources = [
  ['1', 'Official Dodgers / MLB club releases', 'Class membership and stated class totals. Preferred over transaction-log reconstruction whenever a complete class release exists.'],
  ['2', 'Official MLB transaction logs', 'Exact signing dates and additional class members. A log alone does not establish a class total.'],
  ['3', 'MLB Pipeline international trackers', 'Prospect rankings, reported bonuses, position and market. Prospect samples only.'],
  ['4', 'Baseball-Reference', 'MLB debut, historical major-league outcomes and bWAR.'],
  ['5', 'FanGraphs', 'fWAR, stored as a separate metric. Never substituted for bWAR.'],
  ['6', 'MiLB / MLB player records', 'Minor-league and development verification.'],
]

export default function MethodologyPage() {
  const layers = manifest.canonical_sql.length
  const last = manifest.canonical_sql[layers - 1].slice(0, 3)
  return (
    <main className="shell page-main methodology-page">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Research design</span>
          <h1>Methodology &amp; Data Provenance</h1>
          <p>DISI records what public sources establish about Dodgers international signings, keeps what is unknown visibly unknown, and links every fact to the source that supports it.</p>
        </div>
      </header>

      <section className="panel section-gap" aria-labelledby="war-heading">
        <span className="eyebrow">Player value metric</span>
        <h2 id="war-heading">bWAR: Baseball-Reference Wins Above Replacement</h2>
        <p>
          Career value in DISI is <strong>bWAR</strong>, the Baseball-Reference implementation of Wins Above Replacement (also called rWAR).
          Other implementations, notably FanGraphs <strong>fWAR</strong>, use different fielding, pitching and replacement-level inputs, and the two
          can differ materially for the same player. DISI stores each metric in its own field with its own source, observation date and
          through-season. The database rejects a bWAR value that does not cite Baseball-Reference and an fWAR value that does not cite FanGraphs.
          The two are never converted or blended.
        </p>
        <p>
          For active players, a career total keeps changing; every bWAR value shows the season it runs through and the date it was observed.
          The legacy <code>outcomes.career_war</code> column is retained for backward compatibility. It was migrated to bWAR only where its
          cited source is a Baseball-Reference page; values citing any other source are held back and listed in the research queue.
        </p>
      </section>

      <section className="section-gap" aria-labelledby="rules-heading">
        <h2 id="rules-heading" className="section-title">Data-quality rules</h2>
        <div className="principle-grid">
          {rules.map(([title, body], i) => (
            <article className="principle-card" key={title}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-gap" aria-labelledby="layers-heading">
        <h2 id="layers-heading" className="section-title">Decision layers and their limits</h2>
        <p className="page-guardrail">
          <strong>Each layer inherits the support of the layer below it.</strong> An unsupported outcome probability cannot become an expected
          value, an expected value cannot become a ranking, and a ranking cannot become a recommendation. The current state of every layer is on
          the <Link className="text-link" href="/prediction-readiness">Prediction Readiness</Link> page.
        </p>
        <div className="principle-grid">
          {decisionLayers.map(([title, body], i) => (
            <article className="principle-card" key={title}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="table-panel" aria-labelledby="sources-heading">
        <div className="table-head"><div><span className="eyebrow">Ingestion</span><h2 id="sources-heading">Source priority</h2></div></div>
        <div className="table-scroll">
          <table className="research-table">
            <thead><tr><th className="num">Priority</th><th>Source</th><th>Used for</th></tr></thead>
            <tbody>{sources.map(([rank, name, use]) => (
              <tr key={rank}><td className="num">{rank}</td><td><strong>{name}</strong></td><td className="wrap">{use}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="micro-note table-foot">
          Each source keeps its URL, source type, publication date, accessed date and tier; each fact keeps its confidence.
          See <Link className="text-link" href="/research">Research &amp; Data Coverage</Link> for class-level source support and <code>docs/INGESTION.md</code> in the repository for the ingestion workflow.
        </p>
      </section>

      <section className="method-stack">
        <article>
          <span className="eyebrow">Database lineage</span>
          <h2>{layers} canonical SQL layers</h2>
          <p>The repository preserves the full SQL sequence, from the core schema and seed cohort through outcome auditing, trade-package valuation, class coverage, organizational value and the decision-support layers, including lettered forward patches.</p>
          <code>database/sql/001 … {last}</code>
        </article>
        <article>
          <span className="eyebrow">Repair history</span>
          <h2>Troubleshooting is preserved</h2>
          <p>The initial manual Supabase build required three diagnostic / repair scripts. They are kept separately rather than presented as part of the clean build.</p>
          <code>database/repairs/004a … 004c</code>
        </article>
        <article>
          <span className="eyebrow">Security</span>
          <h2>Public read, private write</h2>
          <p>The browser and server use only the Supabase publishable key. Every table has row-level security with a read-only public policy, and every view runs with the caller&apos;s privileges.</p>
          <Link className="button-link" href="/signings">Open the signings table →</Link>
        </article>
      </section>
    </main>
  )
}
