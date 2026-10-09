#!/usr/bin/env node
// Exports the research input for migration 020: every tracked player as it
// stood after migration 019, built in an in-process Postgres (PGlite) from the
// canonical SQL files. Never connects to Supabase.
//
//   node database/research/020/export-players.mjs [--out research-output/020]
//
// Writes players.json (one entry per player: slug, name, aliases, MLB id,
// B-Ref id hint from an already-cited Baseball-Reference page, first signing,
// verified MLB reach / debut) and league-no-id.json (other clubs' signees
// without an MLB id, the input for resolve-ids.mjs).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { parseArgs } from '../../../scripts/mlb/lib/args.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const args = parseArgs(process.argv.slice(2))
const outDir = args.out || path.join(root, 'research-output/020')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8'))
const through = manifest.canonical_sql.filter((f) => f < '020_')

const db = new PGlite({ extensions: { pgcrypto } })
await db.exec('create role anon nologin; create role authenticated nologin;')
for (const f of through) await db.exec(fs.readFileSync(path.join(root, 'database/sql', f), 'utf8'))

// First signing per player, preferring the Dodgers franchise.
const rows = (await db.query(`select distinct on (p.id) p.slug, p.full_name, p.mlb_id, p.bref_id, s.signing_year, s.signing_date,
    o.abbreviation as org, o.franchise_key, oa.reached_mlb_verified as reached, oc.mlb_debut_date, debut.abbreviation as debut_org,
    (select array_agg(distinct src.url) from sources src where src.id in (oc.source_id, oa.source_id)) as urls,
    (select array_agg(a.alias order by a.alias) from player_aliases a where a.player_id = p.id) as aliases
  from players p
  join signings s on s.player_id = p.id
  join organizations o on o.id = s.organization_id
  left join outcome_audits oa on oa.player_id = p.id
  left join outcomes oc on oc.player_id = p.id
  left join organizations debut on debut.id = oc.mlb_debut_organization_id
  order by p.id, (o.franchise_key = 'DODGERS') desc, s.signing_year`)).rows
await db.close()

const parseBref = (u) => u?.match(/baseball-reference\.com\/players\/\w\/(\w+)\.shtml/)?.[1] ?? null
const parseMlb = (u) => u?.match(/\bmi?lb\.com\/(?:[a-z]+\/)?player\/(?:[a-z0-9-]+-)?(\d+)/)?.[1] ?? null
const day = (d) => (d ? d.toISOString().slice(0, 10) : null)

const players = rows.map((r) => {
  const urls = r.urls || []
  const urlMlbId = urls.map(parseMlb).find(Boolean)
  return {
    slug: r.slug,
    name: r.full_name,
    aliases: r.aliases || [],
    mlbId: r.mlb_id ? Number(r.mlb_id) : urlMlbId ? Number(urlMlbId) : null,
    brefHint: r.bref_id || urls.map(parseBref).find(Boolean) || null,
    signingYear: r.signing_year,
    signingDate: day(r.signing_date),
    teamAbbr: r.org,
    dodgers: r.franchise_key === 'DODGERS',
    reachedMlb: r.reached ?? null,
    debutDate: day(r.mlb_debut_date),
    debutTeam: r.debut_org,
  }
}).sort((a, b) => a.slug.localeCompare(b.slug))

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'players.json'), JSON.stringify(players, null, 1))
fs.writeFileSync(path.join(outDir, 'league-no-id.json'), JSON.stringify(players.filter((p) => !p.dodgers && !p.mlbId), null, 1))
process.stderr.write(`players ${players.length}; with MLB id ${players.filter((p) => p.mlbId).length}; ` +
  `B-Ref hint ${players.filter((p) => p.brefHint).length}; league without id ${players.filter((p) => !p.dodgers && !p.mlbId).length}\n`)
