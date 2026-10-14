import Link from 'next/link'
import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import { getReadinessData } from '../../lib/data.js'
import { predictionReadiness } from '../../lib/decision-display.js'
import { humanize, num, MISSING } from '../../lib/format.js'

export const metadata = { title: 'Prediction Readiness' }
export const dynamic = 'force-dynamic'

const MODEL_LABELS = /** @type {Record<string, string>} */ ({
  BASE_RATE: 'Base rate (naive reference)',
  POPULATION_STRATIFIED_RATE: 'Population-stratified rate',
  LOGISTIC_L2: 'Regularized logistic regression',
})

export default async function PredictionReadinessPage() {
  const { live, error, overview, targets, evaluations, expectedValueSupport } = await getReadinessData()
  const readiness = predictionReadiness(overview)

  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Evidence before estimates</span>
          <h1>Prediction Readiness</h1>
          <p>
            Whether DISI has enough verified evidence to estimate player outcomes, expected organizational value or portfolio decisions,
            and exactly what evidence is still missing. Nothing is estimated until its support threshold is met.
          </p>
        </div>
        <DataMode live={live} error={error} />
      </header>

      {!live && <DataUnavailable error={error} />}

      {live && overview && <>
        <section aria-labelledby="headline-heading" className="panel section-gap">
          <span className="eyebrow">Current state</span>
          <h2 id="headline-heading" className="readiness-headline">{readiness.statement}</h2>
          <div className="mini-kpis">
            <div><span>Supported outcome targets</span><strong>{readiness.supportedTargets} of {readiness.targets}</strong></div>
            <div><span>Published player probabilities</span><strong>{readiness.published ? Number(overview.non_null_probabilities).toLocaleString() : 'None'}</strong></div>
            <div><span>Supported expected values</span><strong>{readiness.supportedExpectedValues > 0 ? readiness.supportedExpectedValues : 'None'}</strong></div>
            <div><span>Predictive portfolio recommendations</span><strong>{readiness.recommendations > 0 ? readiness.recommendations : 'None'}</strong></div>
          </div>
          <p className="page-guardrail">
            <strong>Why nothing is estimated.</strong> A probability is published only when its reference population has at least the
            minimum number of labelled outcomes, positives and negatives. Players who are young, still developing, inside the outcome
            horizon or not yet audited are never counted as failures, and the outcome-selected historical record is never used to train.
            Expected organizational value needs a supported probability and enough observed value; portfolio recommendations need a
            supported expected value. Each layer inherits the layer below it.
          </p>
        </section>

        <section aria-labelledby="targets-heading" className="table-panel">
          <div className="table-head">
            <div><span className="eyebrow">Outcome probability (041)</span><h2 id="targets-heading">Evidence by target and reference population</h2></div>
          </div>
          <div className="table-scroll">
            <table className="research-table">
              <thead><tr>
                <th>Target</th><th>Reference population</th><th className="num">Labelled</th><th className="num">Positive</th><th className="num">Negative</th>
                <th className="num">Open horizon</th><th className="num">Unaudited</th><th>Minimum</th><th>State</th><th>What is needed</th>
              </tr></thead>
              <tbody>
                {targets.map((/** @type {any} */ t) => (
                  <tr key={`${t.target_key}-${t.reference_population}`}>
                    <td className="sticky-col"><strong>{t.target_label}</strong></td>
                    <td>{humanize(t.reference_population)}</td>
                    <td className="num">{t.labelled_n}</td>
                    <td className="num">{t.positive_n}</td>
                    <td className="num">{t.negative_n}</td>
                    <td className="num">{t.censored_n}</td>
                    <td className="num">{t.unaudited_n}</td>
                    <td>{t.min_reference_n} / {t.min_positives} / {t.min_negatives}</td>
                    <td><span className={`tag${t.baseline_supported ? '' : ' emphasis'}`}>{humanize(t.readiness_state)}</span></td>
                    <td className="wrap">{t.baseline_supported ? 'Supported' : `+${t.additional_labels_needed} labelled, +${t.additional_positives_needed} positive, +${t.additional_negatives_needed} negative`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="micro-note table-foot">Minimum = labelled / positive / negative outcomes. The top-prospect benchmark sample is its own reference population and is never pooled with Dodgers signings.</p>
        </section>

        <section aria-labelledby="models-heading" className="table-panel">
          <div className="table-head">
            <div><span className="eyebrow">Recorded out-of-time evaluation</span><h2 id="models-heading">No fitted model beats the naive base rate</h2></div>
          </div>
          <div className="table-scroll">
            <table className="research-table">
              <thead><tr><th>Model</th><th>Target</th><th className="num">Rows</th><th className="num">Positives</th><th className="num">Folds</th><th className="num">Brier score</th><th className="num">Skill vs base rate</th><th>Decision</th></tr></thead>
              <tbody>
                {evaluations.map((/** @type {any} */ e) => (
                  <tr key={`${e.target_key}-${e.model_key}`}>
                    <td className="sticky-col"><strong>{MODEL_LABELS[e.model_key] ?? e.model_key}</strong></td>
                    <td>{humanize(e.target_key)}</td>
                    <td className="num">{e.evaluated_rows}</td>
                    <td className="num">{e.positive_n}</td>
                    <td className="num">{e.folds}</td>
                    <td className="num">{e.brier_score == null ? MISSING : num(e.brier_score, 3)}</td>
                    <td className="num">{e.model_key === 'BASE_RATE' ? 'reference' : num(e.brier_skill_vs_base_rate, 3)}</td>
                    <td>{humanize(e.decision)}{e.evaluation_current ? '' : ' (stale)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="micro-note table-foot">
            Leave-one-signing-year-out validation; lower Brier is better and negative skill means worse than the base rate. These are
            evaluation diagnostics of the method, not accuracy claims about any player. No model coefficients are stored or used.
          </p>
        </section>

        <section aria-labelledby="ev-heading" className="table-panel">
          <div className="table-head">
            <div><span className="eyebrow">Expected organizational value (042)</span><h2 id="ev-heading">Value models and their blockers</h2></div>
            <Link href="/portfolio">Portfolio decision support →</Link>
          </div>
          <div className="table-scroll">
            <table className="research-table">
              <thead><tr><th>Value model</th><th>Depends on</th><th>Probability</th><th>Conditional value</th><th>State</th><th>Blocking evidence</th></tr></thead>
              <tbody>
                {expectedValueSupport.map((/** @type {any} */ m) => (
                  <tr key={m.value_model_key}>
                    <td className="sticky-col"><strong>{humanize(m.value_model_key)}</strong></td>
                    <td>{humanize(m.probability_target_key)}</td>
                    <td>{m.probability_supported ? 'Supported' : 'Not supported'}</td>
                    <td>{m.conditional_value_n} of {m.min_conditional_n} observations</td>
                    <td><span className={`tag${m.expected_value_supported ? '' : ' emphasis'}`}>{humanize(m.support_state)}</span></td>
                    <td className="wrap">{m.blocking_reasons || MISSING}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </>}
    </main>
  )
}
