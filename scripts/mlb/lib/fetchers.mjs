// MLB Stats API fetch helpers. Each returns normalized data plus the sources
// (exact URL + retrieval time) it was derived from.

import fs from 'node:fs'
import { config, statsApi } from '../config.mjs'
import { createClient } from './http.mjs'
import { normalizePerson, normalizeTransaction, normalizeSeasonSplits, sortTransactions } from './normalize.mjs'

export function defaultClient(args = {}) {
  return createClient({
    cacheDir: args['no-cache'] ? null : (args.cache || config.cacheDir),
    minIntervalMs: config.minIntervalMs,
    retries: config.retries,
    userAgent: config.userAgent,
    offline: Boolean(args.offline),
  })
}

const source = (res) => ({ url: res.url, retrievedAt: res.retrievedAt })

export async function fetchPerson(client, id, api = statsApi()) {
  const res = await client.getJson(api.person(id))
  return { person: normalizePerson(res.data.people?.[0]), sources: [source(res)] }
}

export async function fetchHistory(client, id, api = statsApi()) {
  const res = await client.getJson(api.personTransactions(id))
  const tx = (res.data.transactions ?? []).map(normalizeTransaction).filter(Boolean)
  return { transactions: sortTransactions(tx), sources: [source(res)] }
}

export async function fetchTeamTransactions(client, teamId, start, end, api = statsApi()) {
  const res = await client.getJson(api.teamTransactions(teamId, start, end))
  const tx = (res.data.transactions ?? []).map(normalizeTransaction).filter(Boolean)
  return { transactions: sortTransactions(tx), sources: [source(res)] }
}

export async function fetchSeasons(client, id, api = statsApi()) {
  const sources = []
  const mlb = []
  const milb = []
  for (const group of ['hitting', 'pitching']) {
    const m = await client.getJson(api.mlbSeasons(id, group))
    sources.push(source(m))
    mlb.push(...normalizeSeasonSplits(m.data))
    const n = await client.getJson(api.milbSeasons(id, group))
    sources.push(source(n))
    milb.push(...normalizeSeasonSplits(n.data))
  }
  return { mlbSplits: mlb.filter((s) => s.level === 'MLB'), milbSplits: milb.filter((s) => s.level !== 'MLB'), sources }
}

/** Reads a JSON array of player inputs ({ name, signingYear, mlbId?, aliases? }). */
export function readPlayers(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  const list = Array.isArray(parsed) ? parsed : parsed.records
  if (!Array.isArray(list)) throw new Error(`${file}: expected an array or { records: [] }`)
  return list
}
