// How much of the path from signing to MLB debut is documented (048). A partial chronology must visibly remain partial: the strongest state
// this ever shows is "no gap visible at season precision", never "complete". PARTIAL HISTORY != NO HISTORY; MISSING SEASON != NO SEASON PLAYED.
import { humanize } from '../../lib/format.js'

const START_LABEL = {
  FROM_SIGNING_SEASON: 'The first structured record is the signing season or the next one.',
  SOURCE_BEGINS_LATE: 'The source begins late: the first structured record is two or more seasons after signing. That is the first OBSERVED season, not the first professional season.',
  NO_PRE_MLB_RECORD: 'The source returns no structured record before the MLB debut.',
  NO_AFFILIATED_RECORD: 'No minor-league record is on file.',
}

const FIRST_PRO_LABEL = {
  KNOWN: 'Known (the earliest record is the signing season or the next)',
  PRIOR_PROFESSIONAL_CAREER: 'Not established: signed as an established professional, so affiliated records do not show when his professional career began',
  FIRST_OBSERVED_ONLY: 'Not established: the earliest record is only the first observed season',
  NO_AFFILIATED_RECORD: 'Not established: no first-appearance season is on record',
}

/** @param {{ coverage: ReturnType<typeof import('../../lib/research/history-coverage.js').historyCoverage>, firstProStatus?: string | null }} props */
export default function DocumentedPath({ coverage, firstProStatus = null }) {
  const partial = coverage.state !== 'NO_OPEN_GAP'
  return (
    <div className="documented-path" data-state={coverage.state}>
      <h3 className="sub">How much of this path is documented</h3>
      <p>
        <strong>{partial ? 'Partial history' : 'No gap visible at season precision'}</strong>
        {' '}— {coverage.pre_mlb_seasons_observed} pre-MLB season{coverage.pre_mlb_seasons_observed === 1 ? '' : 's'} on record
        {coverage.first_observed_season != null && <>, first observed season {coverage.first_observed_season}</>}.
        {' '}{START_LABEL[coverage.history_start] ?? ''}
      </p>
      {firstProStatus && <p className="muted small-note"><strong>First professional season:</strong> {FIRST_PRO_LABEL[firstProStatus] ?? humanize(firstProStatus)}.</p>}
      {coverage.gaps.length > 0 && (
        <ul className="plain-list">
          {coverage.gaps.map((g) => <li key={g.code}><strong>{humanize(g.code)}</strong> · {g.detail}</li>)}
        </ul>
      )}
      {coverage.notes.length > 0 && (
        <ul className="plain-list muted">
          {coverage.notes.map((n) => <li key={n.code}><strong>{humanize(n.code)}</strong> · {n.detail}</li>)}
        </ul>
      )}
      <p className="muted small-note">A missing season is unknown, not a season the player did not play. The record is season-level; exact appearance dates appear only where a dated game log supports them.</p>
    </div>
  )
}
