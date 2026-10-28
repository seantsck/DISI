// Verifier hardening after 056: no canonical player holds both a Dodgers signing and a Top-prospect benchmark signing
// (RANKING APPEARANCE != NEW SIGNING). A Dodgers signing that appears in a benchmark list (Cartaya, Rosario, Luis Rodriguez) is mapped to the
// Dodgers record and is not an overlap; a second, benchmark signing for the same player is. Every fixture below is written to a throwaway
// clone of the canonical head, never to the shared chain.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildCanonicalChain } from './canonical-chain.mjs'
import * as invariants from '../../scripts/db/lib/invariants.mjs'

const { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS, SIGNING_ROLE_OVERLAP_SQL } = invariants
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CHECK = 'dodgers_benchmark_signing_overlap_players'
const MAPPED = ['diego-cartaya', 'jerming-rosario', 'luis-rodriguez-2019']

let chain
let headDump
const clone = async () => {
  const db = new PGlite({ loadDataDir: headDump, extensions: { pgcrypto } })
  return { db, query: async (s, p) => (await db.query(s, p)).rows, close: () => db.close() }
}
const overlap = async (c) => (await c.query(SIGNING_ROLE_OVERLAP_SQL))[0].n
const signingOf = async (c, slug) => (await c.query(`select s.id, s.player_id, s.signing_year, s.signing_date, s.pathway::text as pathway from public.signings s
  join public.players p on p.id = s.player_id where p.slug = $1`, [slug]))[0]
// a second signing for an existing player, recorded as a Top-prospect benchmark signing with another club (the forbidden shape)
const addBenchmarkSigning = async (c, slug, club = 'NYY') => {
  const s = await signingOf(c, slug)
  await c.db.query(`insert into public.signings (player_id, organization_id, signing_year, signing_date, pathway, record_scope)
    select $1, o.id, $2, $3, $4::public.acquisition_pathway, 'MLB_PIPELINE_TOP_PROSPECT' from public.organizations o where o.abbreviation = $5`,
  [s.player_id, s.signing_year, s.signing_date, s.pathway, club])
}

before(async () => {
  chain = await buildCanonicalChain()
  headDump = await chain.db.dumpDataDir('none')
})
after(async () => { await chain?.close() })

test('the check is one hard check in the population group, pinned at 0 in the head and in every historical expectation layer', async () => {
  const report = await checkInvariants(chain.query)
  const mine = report.hard.filter((h) => h.name === CHECK)
  assert.equal(mine.length, 1)
  assert.deepEqual(mine[0], { group: 'population', name: CHECK, expected: 0, actual: 0, pass: true })
  assert.equal(report.hard.length, 259)
  assert.deepEqual(failedChecks(report), [])
  assert.equal(CANONICAL_EXPECTATIONS[CHECK], 0)
  const layers = Object.entries(invariants).filter(([k]) => k.startsWith('EXPECTATIONS_THROUGH_'))
  assert.ok(layers.length >= 9 && layers.some(([k]) => k === 'EXPECTATIONS_THROUGH_055') && layers.some(([k]) => k === 'EXPECTATIONS_THROUGH_046'))
  for (const [k, v] of layers) assert.equal(v[CHECK], 0, k)
})

test('valid head state: distinct Dodgers and benchmark players, 220 / 178, and no player holds both kinds of signing', async () => {
  const [r] = await chain.query(`select
      (select count(distinct s.player_id) from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS')::int as dodgers,
      (select count(distinct s.player_id) from public.signings s where s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')::int as benchmark,
      (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id
        where o.franchise_key = 'DODGERS' and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')::int as dodgers_benchmark_rows`)
  assert.deepEqual(r, { dodgers: 220, benchmark: 178, dodgers_benchmark_rows: 0 })
  assert.equal(await overlap(chain), 0)
})

test('benchmark-source overlap is allowed: Cartaya, Rosario and Luis Rodriguez are on the published lists and stay single Dodgers signings', async () => {
  for (const [migration, slugs] of [['055', ['diego-cartaya', 'jerming-rosario']], ['056', ['luis-rodriguez-2019']]]) {
    const decisions = JSON.parse(fs.readFileSync(path.join(root, `database/research/${migration}/cohort-decisions.json`), 'utf8'))
    const rows = Array.isArray(decisions) ? decisions : (decisions.decisions ?? Object.values(decisions).find(Array.isArray))
    for (const slug of slugs) assert.equal(rows.find((d) => d.slug === slug)?.decision, 'MAPPED_TO_EXISTING_DODGERS_SIGNING', slug)
  }
  const rows = await chain.query(`select p.slug, s.record_scope, o.franchise_key, s.international_rank::text as rank,
      (select count(*) from public.signings x where x.player_id = p.id)::int as signings
    from public.players p join public.signings s on s.player_id = p.id join public.organizations o on o.id = s.organization_id
    where p.slug = any($1) order by 1`, [MAPPED])
  assert.deepEqual(rows.map((r) => [r.slug, r.record_scope, r.franchise_key, r.rank, r.signings]), [
    ['diego-cartaya', 'TRACKED_DODGERS', 'DODGERS', '1.00', 1],
    ['jerming-rosario', 'TRACKED_DODGERS', 'DODGERS', null, 1],
    ['luis-rodriguez-2019', 'TRACKED_DODGERS', 'DODGERS', '4.00', 1],
  ])

  // a Dodgers signing additionally held as a member of a benchmark sample population is still one signing: not an overlap
  const c = await clone()
  try {
    const luis = await signingOf(c, 'luis-rodriguez-2019')
    await c.db.query(`insert into public.signing_population_members (population_id, signing_id, membership_status, note)
      select sp.id, $1, 'PROVISIONAL', 'test fixture: listed Dodgers signing' from public.signing_populations sp where sp.population_key = 'MLB-2019-PIPELINE-TOP30'`, [luis.id])
    assert.equal((await c.query(`select count(*)::int as n from public.signing_population_members where signing_id = $1`, [luis.id]))[0].n, 1)
    assert.equal(await overlap(c), 0)
    const report = await checkInvariants(c.query)
    assert.equal(report.hard.find((h) => h.name === CHECK).pass, true)
  } finally { await c.close() }
})

test('an actual canonical overlap fails: a benchmark signing for the Dodgers player Luis Rodriguez is one violating player', async () => {
  const c = await clone()
  try {
    await addBenchmarkSigning(c, 'luis-rodriguez-2019')
    const [who] = await c.query(`select p.slug from public.players p
      where exists (select 1 from public.signings s join public.organizations o on o.id = s.organization_id where s.player_id = p.id and o.franchise_key = 'DODGERS')
        and exists (select 1 from public.signings s where s.player_id = p.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')`)
    assert.equal(who.slug, 'luis-rodriguez-2019')
    assert.equal(await overlap(c), 1)
    const report = await checkInvariants(c.query)
    const mine = report.hard.find((h) => h.name === CHECK)
    assert.deepEqual(mine, { group: 'population', name: CHECK, expected: 0, actual: 1, pass: false })
    assert.ok(failedChecks(report).some((f) => f.name === CHECK))
  } finally { await c.close() }
})

test('multiple violations count players, not signings: two Dodgers players with benchmark copies (one with two) and a benchmark signing recorded at a Dodgers club give 3', async () => {
  const c = await clone()
  try {
    await addBenchmarkSigning(c, 'diego-cartaya')
    assert.equal(await overlap(c), 1)
    await addBenchmarkSigning(c, 'diego-cartaya', 'CHC')
    assert.equal(await overlap(c), 1, 'a second benchmark copy for the same player is still one violating player')
    await addBenchmarkSigning(c, 'jerming-rosario')
    assert.equal(await overlap(c), 2)
    // a benchmark-scope signing recorded at a Dodgers-franchise club is a Dodgers signing too: the benchmark player Jasson Dominguez gains one
    await addBenchmarkSigning(c, 'jasson-dominguez', 'LAD')
    assert.equal(await overlap(c), 3)
  } finally { await c.close() }
})
