#!/usr/bin/env node
// research:development - the player-development research queue. Read-only. UNKNOWN DEVELOPMENT HISTORY is never "no development".
//
//   npm run research:development -- --missing [--mature] [--mlb yes|no] [--year 2018] [--market Venezuela] [--player slug] [--limit 25]
//   npm run research:development -- --coverage      # per-dimension coverage with denominators
//   npm run research:development -- --timing        # descriptive signing-to-MLB / highest-level facts (no rates, no scores)
//   npm run research:development -- --mlb-coverage   # 048: the verified MLB cohort's documented path, player by player, with denominators
//   npm run research:development -- --needs          # 048: the queue de-duplicated by the evidence gap each item names
//   npm run research:development -- --review [--player slug]   # 048: the reviewer's packet for pending progression decisions (decides nothing)
//   npm run research:development -- --no-mlb-coverage   # 051: the audited no-MLB cohort's documented path, Dodgers-affiliate and later career apart

import { developmentCoverage, developmentQueue, developmentRecords, timingFacts } from '../../lib/research/development-research.js'
import { auditedNoMlbCoverage, verifiedMlbCoverage } from '../../lib/research/history-coverage.js'
import { developmentNeedSummary, developmentNeeds } from '../../lib/research/development-needs.js'
import { progressionReviewPacket, renderReviewPacket } from '../../lib/research/progression-review.js'
import { stableJson } from '../../lib/research/format.js'
import { parseArgs, emit, run, int } from './lib/cli.mjs'
import { loadDataset } from './lib/source.mjs'

/** player_id -> that player's stint rows, from the history queries. */
function stintsByPlayer(data) {
  const out = new Map()
  for (const s of data.stints ?? []) {
    if (!out.has(s.player_id)) out.set(s.player_id, [])
    out.get(s.player_id).push(s)
  }
  return out
}

run(async () => {
  const args = parseArgs(process.argv.slice(2))
  const wantsHistory = args['mlb-coverage'] === true || args['no-mlb-coverage'] === true || args.review === true
  if (wantsHistory) args.history = true
  const { data } = await loadDataset(args)
  if (args.coverage === true || args.timing === true) {
    const result = args.coverage === true ? developmentCoverage(data) : timingFacts(data)
    console.log(args.format === 'json' ? stableJson(result) : `${args.coverage === true ? 'Development-history coverage' : 'Descriptive development timing'} as of ${data.asOf}\n\n${JSON.stringify(result, null, 2)}`)
    return
  }
  if (args['mlb-coverage'] === true) {
    if (!(data.stints ?? []).length) throw new Error('No stint history in this dataset: load it from the database, or save one with --history --save.')
    const cov = verifiedMlbCoverage(data, stintsByPlayer(data), developmentRecords)
    if (args.format === 'json') { console.log(stableJson(cov)); return }
    const { rows, ...summary } = cov
    emit(args, {
      title: `Verified MLB development coverage as of ${data.asOf}`,
      summary,
      rows: rows.map((r) => ({
        player: r.full_name, signed: r.signing_year, debut: r.mlb_debut_date ?? '', path: r.history.state, start: r.history.history_start,
        first_observed: r.history.first_observed_season ?? '', first_pro: r.dims.FIRST_PRO_SEASON, pre_mlb_seasons: r.history.pre_mlb_seasons_observed,
        gaps: r.history.gaps.map((g) => g.code).join(' '), notes: r.history.notes.map((g) => g.code).join(' '), days_to_mlb: r.days_signing_to_mlb_exact ?? '',
      })),
      columns: ['player', 'signed', 'debut', 'path', 'start', 'first_observed', 'first_pro', 'pre_mlb_seasons', 'gaps', 'notes', 'days_to_mlb'],
    })
    return
  }
  if (args['no-mlb-coverage'] === true) {
    if (!(data.stints ?? []).length) throw new Error('No stint history in this dataset: load it from the database, or save one with --history --save.')
    const cov = auditedNoMlbCoverage(data, stintsByPlayer(data), developmentRecords, developmentNeeds)
    if (args.format === 'json') { console.log(stableJson(cov)); return }
    const { rows, ...summary } = cov
    const lv = (h) => (h ? `${h.level} (${h.season})` : '')
    emit(args, {
      title: `Audited no-MLB development coverage as of ${data.asOf} (descriptive; not a success or failure rate, not a causal explanation)`,
      summary,
      rows: rows.map((r) => ({
        player: r.full_name, signed: r.signing_year, route: r.pathway ?? '', first_observed: r.history.first_observed_season ?? '', first_pro: r.first_pro_status,
        highest: r.highest_level_recorded ?? 'UNKNOWN', at_dodgers_affiliate: lv(r.segments.highest_level_at_dodgers_affiliate),
        last_observed: r.segments.last_observed_affiliated ? `${r.segments.last_observed_affiliated.season} ${r.segments.last_observed_affiliated.organizations.join('/')}` : '',
        chronology: r.dims.CHRONOLOGY, dated: `${r.exact_dates.dated}/${r.exact_dates.log_era_stints}`, gaps: r.history.gaps.map((g) => g.code).join(' '), needs: r.needs.join(' '),
      })),
      columns: ['player', 'signed', 'route', 'first_observed', 'first_pro', 'highest', 'at_dodgers_affiliate', 'last_observed', 'chronology', 'dated', 'gaps', 'needs'],
    })
    return
  }
  if (args.needs === true) {
    const needs = developmentNeeds(data)
    emit(args, {
      title: `Development research needs (de-duplicated by evidence gap) as of ${data.asOf}`,
      summary: developmentNeedSummary(data),
      rows: needs.map((n) => ({ ...n, issues: n.issues.join(' ') })),
      columns: ['need', 'signing_year', 'full_name', 'priority', 'issues'],
    })
    return
  }
  if (args.review === true) {
    if (!(data.stints ?? []).length) throw new Error('No stint history in this dataset: load it from the database, or save one with --history --save.')
    const wanted = args.player && args.player !== true ? String(args.player) : null
    const bySigning = new Map((data.signings ?? []).map((s) => [s.player_id, s]))
    const stints = stintsByPlayer(data)
    const ids = [...new Set((data.progressionDecisions ?? []).filter((d) => d.review_status === 'PENDING_REVIEW').map((d) => d.player_id))]
      .filter((id) => !wanted || bySigning.get(id)?.player_slug === wanted)
      .sort((a, b) => (bySigning.get(a)?.player_slug ?? a).localeCompare(bySigning.get(b)?.player_slug ?? b))
    const packets = ids.map((id) => {
      const s = bySigning.get(id) ?? { player_id: id }
      return progressionReviewPacket(
        { player_id: id, player_slug: s.player_slug, full_name: s.full_name, signing_year: s.signing_year, mlb_debut_date: s.mlb_debut_date },
        (data.progressionDecisions ?? []).filter((d) => d.player_id === id),
        (data.progression ?? []).filter((p) => p.player_id === id),
        stints.get(id) ?? [],
      )
    })
    if (args.format === 'json') { console.log(stableJson({ pending_players: packets.length, packets })); return }
    console.log(`Pending progression reviews as of ${data.asOf}: ${packets.length} player(s). This command only reports; it never writes or decides.\n`)
    console.log(packets.map(renderReviewPacket).join('\n\n' + '-'.repeat(78) + '\n\n') || '(none pending)')
    return
  }
  const mlb = args.mlb === 'yes' ? true : args.mlb === 'no' ? false : undefined
  const rows = developmentQueue(data, {
    missing: args.missing === true, mature: args.mature === true ? true : undefined, mlb,
    year: int(args.year), market: args.market && args.market !== true ? String(args.market) : undefined,
    player: args.player && args.player !== true ? String(args.player) : undefined, limit: int(args.limit),
  })
  const view = rows.map((r) => ({ ...r, missing_fields: r.missing.join(' '), exit_status: r.exit }))
  emit(args, {
    title: `Development research queue as of ${data.asOf}`,
    rows: view,
    summary: developmentCoverage(data),
    columns: ['rank', 'tier', 'signing_year', 'full_name', 'outcome', 'highest_level', 'mlb_debut_date', 'exit_status', 'source_count', 'missing_fields'],
  })
})
