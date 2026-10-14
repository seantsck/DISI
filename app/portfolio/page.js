import Link from 'next/link'
import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import { getPortfolioData } from '../../lib/data.js'
import { decisionStateLabel, scenarioOptimization, budgetStateLabel, snapshotFreshness } from '../../lib/decision-display.js'
import { money, bwar, humanize, pctFraction, num, MISSING } from '../../lib/format.js'

export const metadata = { title: 'Portfolio' }
export const dynamic = 'force-dynamic'

export default async function PortfolioPage() {
  const { live, error, freshness, decisionSupport, history, scenarios } = await getPortfolioData()
  const all = history.find((/** @type {any} */ h) => h.grain === 'ALL')
  const byGrain = (/** @type {string} */ g) => history.filter((/** @type {any} */ h) => h.grain === g)
  const basePool = scenarios.filter((/** @type {any} */ s) => s.scenario_key === 'BASE_POOL')
  const recommendations = decisionSupport[0]?.predictive_recommendations_total ?? 0

  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Evidence-first decision support</span>
          <h1>Portfolio</h1>
          <p>
            How the Dodgers allocated international signing capital and what it realized (retrospective), what DISI can responsibly say
            about each candidate at its decision date, and how candidate sets compare with the international pool.
          </p>
        </div>
        <DataMode live={live} error={error} />
      </header>

      {!live && <DataUnavailable error={error} />}

      {live && <>
        {snapshotFreshness(freshness) && <p className="snapshot-freshness">{snapshotFreshness(freshness)}</p>}
        <p className="page-guardrail">
          <strong>{recommendations > 0 ? `${recommendations} candidate(s) are eligible for value-based optimization.` : 'No predictive portfolio recommendation is made.'}</strong>{' '}
          {recommendations > 0
            ? 'Only candidates with a supported expected value, complete cost and complete signing-time features enter the optimization.'
            : 'Expected organizational value is not supported by current evidence, so no candidate is ranked and no value-maximizing portfolio is produced. '}
          {recommendations === 0 && <Link className="text-link" href="/prediction-readiness">See what evidence is missing →</Link>}
        </p>

        <section aria-labelledby="states-heading" className="table-panel">
          <div className="table-head">
            <div><span className="eyebrow">Decision support by state</span><h2 id="states-heading">What DISI may and may not say</h2></div>
          </div>
          <div className="table-scroll">
            <table className="research-table">
              <thead><tr><th>State</th><th className="num">Dodgers candidates</th><th>DISI may say</th><th>DISI may not say</th></tr></thead>
              <tbody>
                {decisionSupport.map((/** @type {any} */ d) => (
                  <tr key={d.decision_support_state}>
                    <td className="sticky-col"><strong>{decisionStateLabel(d.decision_support_state)}</strong></td>
                    <td className="num">{d.candidates}</td>
                    <td className="wrap">{d.may_say}</td>
                    <td className="wrap">{d.may_not_say}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="micro-note table-foot">States use only facts knowable at each signing (signing-time features, earlier comparables and population-level evidence), never the player&apos;s later outcome.</p>
        </section>

        {all && (
          <section aria-labelledby="history-heading" className="table-panel">
            <div className="table-head">
              <div><span className="eyebrow">Retrospective</span><h2 id="history-heading">Historical capital allocation and realized value</h2></div>
            </div>
            <div className="mini-kpis">
              <div><span>Tracked / opening-class amateur signings</span><strong>{all.signings}</strong></div>
              <div><span>Known spend (lower bound)</span><strong>{money(all.known_spend_usd)}</strong></div>
              <div><span>Signings with known cost</span><strong>{all.known_cost_signings} ({pctFraction(all.cost_coverage)})</strong></div>
              <div><span>Mature: realized org. bWAR</span><strong>{bwar(all.mature_realized_org_bwar)}</strong></div>
            </div>
            <p className="micro-note">
              {all.mature_value_resolved} of {all.mature_signings} mature signings have a resolved organizational value; {all.mature_positive_value_signings} produced positive value.
              The {all.outcome_selected_signings_excluded} outcome-selected historical signings are excluded. This describes what happened and does not imply a better allocation was knowable at the time.
            </p>
            {[['SIGNING_ERA', 'By signing era'], ['MARKET_GROUP', 'By market group'], ['SIGNING_YEAR', 'By signing year']].map(([grain, title]) => (
              <details key={grain} className="case-details" open={grain === 'SIGNING_ERA'}>
                <summary>{title}</summary>
                <div className="table-scroll">
                  <table className="research-table">
                    <thead><tr><th>{humanize(grain)}</th><th className="num">Signings</th><th className="num">Known cost</th><th className="num">Known spend</th><th className="num">Share of known spend</th><th className="num">Largest signing share</th><th className="num">Mature resolved</th><th className="num">Realized org. bWAR</th><th>Spend</th></tr></thead>
                    <tbody>
                      {byGrain(grain).map((/** @type {any} */ h) => (
                        <tr key={h.grain_value}>
                          <td className="sticky-col">{humanize(h.grain_value)}</td>
                          <td className="num">{h.signings}</td>
                          <td className="num">{h.known_cost_signings}</td>
                          <td className="num">{money(h.known_spend_usd)}</td>
                          <td className="num">{pctFraction(h.share_of_known_spend)}</td>
                          <td className="num">{pctFraction(h.largest_signing_share_of_known_spend)}</td>
                          <td className="num">{h.mature_value_resolved} / {h.mature_signings}</td>
                          <td className="num">{bwar(h.mature_realized_org_bwar)}</td>
                          <td>{h.spend_state === 'SPEND_COMPLETE' ? 'Complete' : 'Lower bound'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </section>
        )}

        <section aria-labelledby="pool-heading" className="table-panel">
          <div className="table-head">
            <div><span className="eyebrow">Budget scenarios</span><h2 id="pool-heading">Known costs against the reported international pool</h2></div>
          </div>
          <div className="table-scroll">
            <table className="research-table">
              <thead><tr><th>Year</th><th>Regime</th><th className="num">Reported pool</th><th className="num">Candidates</th><th className="num">Costs unknown</th><th className="num">Known cost</th><th>Feasibility</th><th>Value optimization</th></tr></thead>
              <tbody>
                {basePool.map((/** @type {any} */ s) => {
                  const opt = scenarioOptimization(s)
                  return (
                    <tr key={s.signing_year}>
                      <td className="sticky-col"><strong>{s.signing_year}</strong></td>
                      <td>{humanize(s.signing_regime)}</td>
                      <td className="num">{money(s.reported_pool_usd)}</td>
                      <td className="num">{s.candidates}</td>
                      <td className="num">{s.incomplete_cost_candidates}</td>
                      <td className="num">{money(s.known_cost_usd)}</td>
                      <td>{budgetStateLabel(s.budget_state)}</td>
                      <td className="wrap">{opt.supported ? `${opt.selection.length} selected · ${num(opt.expectedValue, 2)} expected bWAR` : opt.label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="micro-note table-foot">
            Reported pool (after trades when reported). Known acquisition costs of amateur signings approximate pool usage; this is not a
            reconciled pool ledger. Unknown costs make feasibility indeterminate rather than zero. Reserve and pool-size scenarios
            (30% reserve, ±25% pool) are in v_portfolio_scenario_evaluation. {MISSING} = unknown.
          </p>
        </section>
      </>}
    </main>
  )
}
