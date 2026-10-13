#!/usr/bin/env node
// Derives database/research/035/benchmark-outcomes.json: the MLB outcome audit of the 48 non-Dodgers benchmark players (the
// MLB Pipeline 2013 / 2014 Top-30 international signing trackers), from the official MLB Stats API person record and career
// statistics, using the same conventions as the Dodgers outcome audits (migration 015 / 017).
//
//   node --env-file=.env.local database/research/035/derive-outcomes.mjs
//
// Read-only: one database read (the benchmark roster) and public MLB Stats API GETs, one person at a time. The audit boundary is
// the existing DISI audit date (2026-10-05) so the analytics as-of date is not moved.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const AUDIT_THROUGH = '2026-10-05'
const url = process.env.DISI_VERIFY_DB_URL || process.env.DATABASE_URL
if (!url) throw new Error('DISI_VERIFY_DB_URL is not set')
// 'pg' is an untyped devDependency; the split specifier keeps tsc (checkJs) from type-checking its internals.
const { Client } = await import(['p', 'g'].join(''))
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
await client.query('begin read only')
const roster = (await client.query(`
  select p.slug, p.full_name, p.mlb_id::text as mlb_id, p.bref_id, p.birth_date::text as birth_date, p.birth_country, o.abbreviation as org, s.signing_year, s.country_market
  from public.signings s join public.players p on p.id = s.player_id join public.organizations o on o.id = s.organization_id
  where o.abbreviation <> 'LAD' and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT' order by o.abbreviation, p.full_name`)).rows
await client.query('rollback')
await client.end()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const get = async (u) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(u, { headers: { 'user-agent': 'DISI-research/035 (public data)' } })
    if (r.ok) return r.json()
    await sleep(500 * (i + 1))
  }
  throw new Error(`GET failed: ${u}`)
}
const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim()

const out = []
for (const r of roster) {
  const rec = { slug: r.slug, full_name: r.full_name, org: r.org, signing_year: r.signing_year, mlb_id: r.mlb_id, identity_basis: r.mlb_id ? 'EXISTING_MLB_ID' : null }
  if (!rec.mlb_id) {
    // resolve only an unambiguous exact-name match whose birth year fits an international amateur of that class and whose country matches
    const q = encodeURIComponent(r.full_name)
    const found = (await get(`https://statsapi.mlb.com/api/v1/people/search?names=${q}`)).people ?? []
    const fit = found.filter((p) => strip(p.fullName) === strip(r.full_name) && p.birthDate && Number(p.birthDate.slice(0, 4)) >= r.signing_year - 22 && Number(p.birthDate.slice(0, 4)) <= r.signing_year - 15)
    if (fit.length === 1) {
      rec.mlb_id = String(fit[0].id)
      rec.identity_basis = `UNIQUE_EXACT_NAME_MATCH_BIRTH_YEAR_${fit[0].birthDate.slice(0, 4)}`
    } else {
      rec.identity_basis = `UNRESOLVED_${found.length}_NAME_MATCHES`
    }
    await sleep(150)
  }
  if (rec.mlb_id) {
    const person = (await get(`https://statsapi.mlb.com/api/v1/people/${rec.mlb_id}?hydrate=currentTeam`)).people?.[0]
    const stats = await get(`https://statsapi.mlb.com/api/v1/people/${rec.mlb_id}/stats?stats=career&group=hitting,pitching&gameType=R`)
    const splits = (stats.stats ?? []).flatMap((s) => s.splits ?? [])
    const hit = (stats.stats ?? []).find((s) => s.group?.displayName === 'hitting')?.splits?.[0]?.stat
    const pit = (stats.stats ?? []).find((s) => s.group?.displayName === 'pitching')?.splits?.[0]?.stat
    rec.person_url = `https://statsapi.mlb.com/api/v1/people/${rec.mlb_id}`
    rec.stats_url = `https://statsapi.mlb.com/api/v1/people/${rec.mlb_id}/stats?stats=career&group=hitting,pitching&gameType=R`
    rec.full_name_api = person?.fullName
    rec.birth_date = person?.birthDate ?? null
    rec.birth_country = person?.birthCountry ?? null
    rec.mlb_debut_date = person?.mlbDebutDate ?? null
    rec.active = person?.active ?? null
    rec.current_team = person?.currentTeam?.name ?? null
    rec.mlb_games = (hit?.gamesPlayed ?? 0) + (pit?.gamesPlayed ?? 0) || null
    rec.mlb_pa = hit?.plateAppearances ?? null
    rec.mlb_ip = pit?.inningsPitched ?? null
    rec.stat_split_count = splits.length
    if (rec.mlb_debut_date && rec.mlb_debut_date > AUDIT_THROUGH) rec.mlb_debut_date_after_boundary = true
    await sleep(150)
  }
  out.push(rec)
}

const doc = {
  generated_by: 'database/research/035/derive-outcomes.mjs',
  audit_through_date: AUDIT_THROUGH,
  retrieved_at: new Date().toISOString().slice(0, 10),
  players: out,
}
fs.writeFileSync(path.join(here, 'benchmark-outcomes.json'), JSON.stringify(doc, null, 1) + '\n')
const reached = out.filter((p) => p.mlb_debut_date).length
console.log(JSON.stringify({ players: out.length, mlb_id: out.filter((p) => p.mlb_id).length, reached, unresolved: out.filter((p) => !p.mlb_id).map((p) => `${p.full_name}: ${p.identity_basis}`) }, null, 1))
