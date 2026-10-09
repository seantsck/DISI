#!/usr/bin/env node
// Converts REVIEWED identity artifacts into deterministic SQL VALUES blocks and
// a decisions report. Never connects to a database.
//
//   node scripts/mlb/identity-sql-values.mjs \
//     --players research-output/020/players-with-ids.json \
//     --identities research-output/020/player-identities.json \
//     --bref research-output/020/resolve-bref.json \
//     --fangraphs research-output/020/resolve-fangraphs.json \
//     --league-ids research-output/020/league/resolve-ids.json[,more.json] //     [--decisions database/research/020/identity-decisions.json] \
//     --out database/research/020/values.sql

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, requireArg } from './lib/args.mjs'
import { chooseCanonicalName } from './lib/identity.mjs'
import { foldText } from '../../lib/text.js'
import { stableStringify, sortRecords } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const records = (f) => (f ? load(f).records ?? load(f) : [])
const players = sortRecords(load(requireArg(args, 'players')), ['slug'])
const identities = new Map(records(requireArg(args, 'identities')).map((r) => [r.slug, r]))
const bref = new Map(records(args.bref).map((r) => [r.slug, r]))
const fangraphs = new Map(records(args.fangraphs).map((r) => [r.slug, r]))
// --league-ids may list several resolve-ids artifacts (comma-separated).
const leagueIds = new Map(String(args['league-ids'] || '').split(',').filter(Boolean).flatMap(records).map((r) => [r.slug, r]))
// Documented manual identity decisions (signals, confidence, aliases, note).
const manual = new Map(records(args.decisions).map((r) => [r.slug, r]))

// JSON values are wrapped so arrays of candidates become jsonb, not text[].
class Json { constructor(value) { this.value = value } }
const json = (v) => (v == null ? null : new Json(v))
const q = (v) => {
  if (v == null) return 'null'
  if (v instanceof Json) return `${q(JSON.stringify(JSON.parse(stableStringify(v.value))))}::jsonb`
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return `array[${v.map(q).join(',')}]::text[]`
  return `'${String(v).replace(/'/g, "''")}'`
}
const row = (values) => `(${values.map(q).join(',')})`
const compact = (s) => foldText(String(s ?? '').replace(/\([^)]*\)/g, ' ')).replace(/[^a-z0-9]/g, '')

const blocks = { ids: [], bio: [], positions: [], resolutions: [], sources: new Map(), aliases: [] }
const decisions = []
const addSource = (s, kind) => { if (s?.url && !blocks.sources.has(s.url)) blocks.sources.set(s.url, row([s.url, s.retrievedAt, kind])) }

for (const p of players) {
  const ident = identities.get(p.slug)
  const br = bref.get(p.slug)
  const fg = fangraphs.get(p.slug)
  const identityUrl = ident?.sources?.find((s) => /hydrate=xrefId/.test(s.url))?.url ?? null
  const decision = { slug: p.slug, name: p.name, mlbId: p.mlbId ?? null, idBasis: p.idBasis ?? null }

  // ---- MLB identity resolution
  if (p.mlbId && ident?.status === 'FOUND') {
    const basis = p.idBasis === 'EXISTING' ? 'EXISTING_DISI_ID' : p.idBasis
    const signals = { EXISTING_DISI_ID: ['DISI_RECORD'], CLUB_TRANSACTION_MATCH: ['NAME', 'SIGNING_CLUB', 'SIGNING_YEAR'],
      BREF_CITED_BREF_PAGE: ['BREF_ID_FROM_CITED_PAGE', 'MLB_ID_IN_BREF_WAR_FILE'],
      BREF_NAME_DEBUT_YEAR_DEBUT_TEAM: ['NAME', 'DEBUT_YEAR', 'DEBUT_FRANCHISE'] }[basis] || manual.get(p.slug)?.signals || [basis]
    const man = manual.get(p.slug)
    const lr = leagueIds.get(p.slug)
    blocks.ids.push(row([p.slug, p.mlbId, basis, br?.status === 'RESOLVED' ? br.brefId : null, fg?.status === 'RESOLVED' ? fg.fangraphsId : null]))
    blocks.resolutions.push(row([p.slug, 'MLB', String(p.mlbId), 'RESOLVED', basis,
      man?.confidence ?? (basis === 'BREF_NAME_DEBUT_YEAR_DEBUT_TEAM' ? 'HIGH' : 'VERIFIED'), signals,
      json(lr?.candidates), json({ mlbId: p.mlbId, name: p.name, aliases: p.aliases, signingYear: p.signingYear, club: p.teamAbbr }),
      man?.aliases?.[0]?.sourceUrl ?? identityUrl, man?.note ?? null]))
    for (const a of man?.aliases ?? []) {
      addSource(lr?.sources?.find((s) => s.url === a.sourceUrl), 'MLB_TEAM_TRANSACTIONS')
      blocks.aliases.push(row([p.slug, a.alias, a.aliasType, a.sourceUrl]))
    }
    addSource(ident.sources.find((s) => /hydrate=xrefId/.test(s.url)), 'MLB_PLAYER_IDENTITY')

    const brefName = br?.candidates?.find((c) => c.brefId === br.brefId)?.name ?? null
    const canon = chooseCanonicalName(p.name, [['BASEBALL_REFERENCE', brefName], ['MLB', ident.mlbFullName]])
    blocks.bio.push(row([p.slug, canon.canonicalName, canon.rename, canon.source, ident.mlbFullName, ident.birthDate, ident.birthCity,
      ident.birthStateProvince, ident.birthCountry, ident.rawBirthCountry, ident.bats, ident.throws, ident.heightIn, ident.weightLb,
      ident.currentPosition, ident.mlbDebutDate ?? null, identityUrl]))
    if (canon.rename) blocks.aliases.push(row([p.slug, p.name, 'PREVIOUS_DISI_SPELLING', null]))
    if (ident.mlbFullName && compact(ident.mlbFullName) !== compact(p.name) && compact(ident.mlbFullName) !== compact(canon.canonicalName)) {
      blocks.aliases.push(row([p.slug, ident.mlbFullName, 'MLB_RECORD_NAME', identityUrl]))
    }
    if (ident.positionAtSigning) {
      const txUrl = ident.sources.find((s) => /transactions\?playerId=/.test(s.url))
      addSource(txUrl, 'MLB_PLAYER_TRANSACTIONS')
      blocks.positions.push(row([p.slug, p.signingYear, ident.positionAtSigning.position, ident.positionAtSigning.date, txUrl?.url ?? null]))
    }
    Object.assign(decision, { canonicalName: canon.canonicalName, renamed: canon.rename, birthDate: ident.birthDate, bats: ident.bats, throws: ident.throws })
  } else {
    const lr = leagueIds.get(p.slug)
    blocks.resolutions.push(row([p.slug, 'MLB', null, lr?.status === 'NOT_FOUND' || !lr ? 'NOT_FOUND' : 'NEEDS_REVIEW', null, null, [],
      json(lr?.candidates ?? []), json({ name: p.name, signingYear: p.signingYear, club: p.teamAbbr }), null,
      'No MLB transaction or name-search match with the signing club; left for manual identity research.']))
  }

  // ---- Baseball-Reference
  if (br) {
    blocks.resolutions.push(row([p.slug, 'BASEBALL_REFERENCE', br.brefId ?? null, br.status, br.method, br.confidence, br.signals ?? [],
      json(br.candidates?.length ? br.candidates : null), json(br.query), br.sources?.[0]?.url ?? null, br.note ?? null]))
    for (const s of br.sources ?? []) addSource(s, 'BREF_WAR_DATA_FILE')
    decision.bref = br.status === 'RESOLVED' ? br.brefId : br.status
  }
  // ---- FanGraphs (MLB cross-reference only; no fWAR)
  if (fg) {
    blocks.resolutions.push(row([p.slug, 'FANGRAPHS', fg.fangraphsId ?? null, fg.status, fg.method, fg.confidence, fg.signals ?? [],
      null, json({ mlbId: fg.mlbId }), fg.sources?.[0]?.url ?? null, fg.note ?? null]))
    decision.fangraphs = fg.status === 'RESOLVED' ? fg.fangraphsId : fg.status
  }
  decisions.push(decision)
}

const header = (name, cols) => `-- ${name}(${cols})`
const sql = [
  header('ids', 'slug, mlb_id, mlb_id_basis, bref_id, fangraphs_id'), blocks.ids.join(',\n'),
  header('bio', 'slug, canonical_name, rename_full_name, canonical_name_source, mlb_full_name, birth_date, birth_city, birth_state_province, birth_country, raw_birth_country, bats, throws, height_in, weight_lb, current_position, mlb_debut_date, identity_url'), blocks.bio.join(',\n'),
  header('positions', 'slug, signing_year, position_at_signing, transaction_date, transaction_url'), blocks.positions.join(',\n'),
  header('resolutions', 'slug, id_system, external_id, status, method, confidence, signals, candidates, query, source_url, note'), blocks.resolutions.join(',\n'),
  header('sources', 'url, retrieved_at, kind'), [...blocks.sources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v).join(',\n'),
  header('aliases', 'slug, alias, alias_type, source_url'), blocks.aliases.join(',\n') || "('__none__', null, null, null)",
].join('\n\n') + '\n'

const out = requireArg(args, 'out')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, sql)
fs.writeFileSync(out.replace(/\.sql$/, '') + '-decisions.json', stableStringify({ records: decisions }))
process.stderr.write(`players ${decisions.length}; MLB ids ${blocks.ids.length}; bio ${blocks.bio.length}; positions ${blocks.positions.length}; aliases ${blocks.aliases.length} → ${out}\n`)
