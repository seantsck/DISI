#!/usr/bin/env node
// Exports a DISI research view to a players.json input file, READ-ONLY, using
// the public Supabase REST endpoint and the publishable key from the
// environment (the same key the website uses). Nothing is written to Supabase.
//
//   node --env-file=.env.local scripts/mlb/export-queue.mjs --view v_dodgers_mature_outcome_queue --out players.json

import fs from 'node:fs'
import { parseArgs } from './lib/args.mjs'
import { stableStringify } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (e.g. node --env-file=.env.local ...)')
if (/sb_secret_|service_role/i.test(key)) throw new Error('Refusing to use a secret / service-role key. Use the publishable key.')

const view = args.view || 'v_dodgers_mature_outcome_queue'
if (!/^v_[a-z0-9_]+$/.test(view)) throw new Error('--view must be a DISI v_* view name')
const res = await fetch(`${url}/rest/v1/${view}?select=*`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
if (!res.ok) throw new Error(`${view}: HTTP ${res.status} ${await res.text()}`)
const rows = await res.json()
const players = rows.map((r) => ({ name: r.full_name, signingYear: r.signing_year, mlbId: r.mlb_id ?? null, slug: r.player_slug ?? null }))
fs.writeFileSync(args.out || 'players.json', stableStringify(players))
process.stderr.write(`${players.length} players from ${view} → ${args.out || 'players.json'}\n`)
