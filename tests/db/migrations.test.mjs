// Executes the complete canonical SQL lineage (database/manifest.json) in an
// in-process Postgres (PGlite) and checks the research-database rules.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { foldText, slugify } from '../../lib/text.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sqlDir = path.join(root, 'database/sql')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8'))
const readSql = (file) => fs.readFileSync(path.join(sqlDir, file), 'utf8')

/** @type {PGlite} */
let db
const rows = async (sql, params) => (await db.query(sql, params)).rows
const one = async (sql, params) => (await rows(sql, params))[0]

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  await db.exec('create role anon nologin; create role authenticated nologin;')
  for (const file of manifest.canonical_sql) {
    try {
      await db.exec(readSql(file))
    } catch (error) {
      throw new Error(`${file} failed: ${error.message}`)
    }
  }
}, { timeout: 180000 })

after(async () => { await db?.close() })

test('manifest lists every canonical SQL file, in order', () => {
  const files = fs.readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort()
  assert.deepEqual(manifest.canonical_sql, files)
  assert.equal(manifest.notes.canonical_build_count, files.length)
})

// Each migration replaces some views of the one before it, so rerunnability is
// checked for the latest migration in the manifest.
test('the latest migration is rerunnable without changing data', async () => {
  const latest = manifest.canonical_sql.at(-1)
  const snapshot = async () => one(`select
      (select string_agg(slug || coalesce(mlb_id::text, ''), ',' order by id) from players) as players,
      (select count(*) from signings)::int as signings,
      (select string_agg(coalesce(formal_transaction_date::text, '') || coalesce(announced_date::text, '') || coalesce(country_market, ''), ',' order by id) from signings) as signing_facts,
      (select count(*) from player_metric_observations)::int as metrics,
      (select count(*) from sources)::int as sources,
      (select count(*) from evidence)::int as evidence,
      (select count(*) from player_aliases)::int as aliases,
      (select count(*) from signing_population_members)::int as members,
      (select count(*) from signing_population_member_sources)::int as member_sources,
      (select count(*) from research_source_conflicts)::int as conflicts,
      (select count(*) from signing_period_candidates)::int as candidates,
      (select string_agg(coalesce(source_id::text,'') || tracked_signings || coalesce(population_scope, ''), ',' order by id) from signing_census_coverage) as coverage`)
  const beforeRun = await snapshot()
  await db.exec(readSql(latest))
  assert.deepEqual(await snapshot(), beforeRun)
})

test('ASCII fold: SQL mapping strings are aligned and match the JS helper', async () => {
  const upper = 'ÁÀÂÄÃÅĀĂĄÉÈÊËĒĖĘĚÍÌÎÏĪĮÓÒÔÖÕØŌŐÚÙÛÜŪŮŰÑŃÇĆČÝŸŠŽŁĐ'
  const { folded } = await one('select public.disi_ascii_fold($1) as folded', [upper])
  assert.equal(folded, 'aaaaaaaaaeeeeeeeeiiiiiioooooooouuuuuuunncccyyszld')
  assert.equal(foldText(upper), folded)
  for (const name of ['Yadier Álvarez', 'Samuel Muñoz', 'Hung-Chih Kuo', "Jos'e  O'Neil"]) {
    const r = await one('select public.disi_ascii_fold($1) as f, public.disi_slugify($1) as s', [name])
    assert.equal(r.f, foldText(name))
    assert.equal(r.s, slugify(name))
  }
})

test('every player has a unique canonical slug', async () => {
  const players = await rows('select full_name, slug from players')
  assert.ok(players.length > 200)
  assert.equal(new Set(players.map((p) => p.slug)).size, players.length)
  const byBase = new Map()
  for (const p of players) {
    assert.match(p.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/)
    const base = slugify(p.full_name)
    byBase.set(base, [...(byBase.get(base) || []), p.slug])
  }
  for (const [base, slugs] of byBase) {
    if (slugs.length === 1) assert.equal(slugs[0], base, `${base} has no collision, so its slug is the plain name slug`)
    else {
      assert.ok(slugs.includes(base), `the first ${base} keeps the plain slug`)
      for (const slug of slugs) assert.ok(slug === base || slug.startsWith(`${base}-`))
    }
  }
})

test('slug collisions use birth year, then a counter, and slugs are stable', async () => {
  await db.transaction(async (tx) => {
    const a = (await tx.query("insert into players (full_name) values ('José López') returning slug")).rows[0]
    const b = (await tx.query("insert into players (full_name, birth_date) values ('Jose Lopez', '2006-03-01') returning slug")).rows[0]
    const c = (await tx.query("insert into players (full_name) values ('JOSE LOPEZ') returning slug")).rows[0]
    assert.equal(a.slug, 'jose-lopez-2')
    assert.equal(b.slug, 'jose-lopez-2006')
    assert.equal(c.slug, 'jose-lopez-3')
    const renamed = (await tx.query("update players set full_name = 'Jose A. Lopez' where slug = 'jose-lopez-2' returning slug")).rows[0]
    assert.equal(renamed.slug, 'jose-lopez-2', 'renaming a player keeps the published slug')
    await tx.rollback()
  })
})

test('bWAR is backfilled only from Baseball-Reference-cited values', async () => {
  const r = await one(`select
      count(*)::int as n,
      count(*) filter (where m.value is distinct from o.career_war)::int as mismatched,
      count(*) filter (where s.url !~* 'baseball-reference\\.com')::int as non_bref
    from player_metric_observations m
    join outcomes o on o.player_id = m.player_id
    join sources s on s.id = m.source_id
    where m.metric_key = 'CAREER_BWAR'`)
  assert.equal(r.n, 44)
  assert.equal(r.mismatched, 0)
  assert.equal(r.non_bref, 0)

  const leonard = await one(`select d.career_bwar, o.career_war
    from v_player_dossier d join outcomes o on o.player_id = d.player_id where d.full_name = 'Eddys Leonard'`)
  assert.equal(leonard.career_bwar, null, 'MLB.com-cited value is not relabelled bWAR')
  assert.equal(Number(leonard.career_war), -0.2, 'legacy value is preserved')
  const task = await one("select detail from v_research_tasks where task_type = 'BWAR_MISSING' and full_name = 'Eddys Leonard'")
  assert.match(task.detail, /does not cite Baseball-Reference/)

  const pages = await one("select career_bwar, bwar_observed_through_season, bwar_observed_through_date from v_player_dossier where full_name = 'Andy Pages'")
  assert.equal(Number(pages.career_bwar), 10.9)
  assert.equal(pages.bwar_observed_through_season, 2026)
  assert.ok(pages.bwar_observed_through_date instanceof Date)
})

test('metric provider guard rejects substituted WAR sources', async () => {
  const player = await one("select id from players where full_name = 'Andy Pages'")
  const mlb = await one("select id from sources where url like 'https://www.mlb.com/%' limit 1")
  const bref = await one("select id from sources where url like 'https://www.baseball-reference.com/%' limit 1")
  await assert.rejects(
    db.query("insert into player_metric_observations (player_id, metric_key, value, observed_through_date, source_id) values ($1, 'CAREER_BWAR', 1, '2030-01-01', $2)", [player.id, mlb.id]),
    /CAREER_BWAR must cite a Baseball-Reference source/,
  )
  await assert.rejects(
    db.query("insert into player_metric_observations (player_id, metric_key, value, observed_through_date, source_id) values ($1, 'CAREER_FWAR', 1, '2030-01-01', $2)", [player.id, bref.id]),
    /CAREER_FWAR must cite a FanGraphs source/,
  )
})

test('class status names the population: opening classes are never reported as complete classes', async () => {
  const classes = await rows("select * from v_class_research_coverage where franchise_key = 'DODGERS' order by signing_year")
  assert.deepEqual(classes.filter((c) => c.class_status === 'COMPLETE').map((c) => c.signing_year), [],
    'no full signing-period population is complete')
  assert.deepEqual(classes.filter((c) => c.class_status === 'OPENING_CLASS_COMPLETE').map((c) => c.signing_year), [2021, 2023, 2024, 2025])
  const by = Object.fromEntries(classes.map((c) => [c.signing_year, c]))
  assert.equal(by[2025].expected_class_size, 29)
  assert.equal(by[2025].population_member_count, 29)
  assert.equal(by[2025].missing_from_expected, 0)
  assert.equal(by[2025].opening_class_complete, true)
  assert.equal(by[2025].full_period_complete, false)
  assert.equal(by[2025].full_period_expected, null)
  assert.equal(by[2025].expected_size_source_tier, 'OFFICIAL_CLUB_RELEASE')
  assert.equal(by[2024].expected_size_source_tier, 'OFFICIAL_CLUB_RELEASE')
  assert.equal(by[2022].class_status, 'COUNT_CONFLICT')
  assert.equal(by[2022].needs_official_size_source, true)
  assert.equal(by[2017].class_status, 'POPULATION_UNKNOWN', 'the 26-player 2016-17 total no longer applies to 2017-18 signings')
  assert.equal(by[2016].expected_class_size, 26)
  assert.equal(by[2016].population_scope, 'FULL_SIGNING_PERIOD')
  assert.equal(by[1951].class_status, 'VERIFIED_SAMPLE_POPULATION_UNKNOWN')
  assert.equal(by[1951].expected_class_size, null)
})

test('database status reports counts consistent with the 016 universe', async () => {
  const s = await one('select * from v_database_status')
  const u = await one('select * from v_dodgers_universe_summary')
  assert.equal(s.tracked_signings, Number(u.tracked_signings))
  assert.equal(s.outcome_audits_completed, Number(u.audited_outcomes))
  assert.equal(s.verified_mlb_outcomes, Number(u.verified_mlb_reach))
  assert.equal(s.outcome_audit_queue, Number(u.outcome_audit_queue))
  assert.equal(Number(s.known_acquisition_cost_usd), Number(u.known_acquisition_cost_usd))
  assert.equal(s.classes_with_known_population, 8)
  assert.equal(s.complete_classes, 0)
  assert.equal(s.opening_classes_complete, 4)
  assert.equal(s.full_periods_complete, 0)
  assert.equal(s.rate_eligible_populations, 0)
})

test('signing records keep unknowns NULL and use text codes for alphabetical sorting', async () => {
  const r = await one(`select
      count(*)::int as n,
      count(*) filter (where is_dodgers_franchise)::int as dodgers,
      count(*) filter (where total_known_acquisition_cost_usd = 0)::int as zero_cost,
      count(*) filter (where not outcome_audited and reached_mlb_verified is not null)::int as unaudited_with_value,
      count(*) filter (where outcome_audit_status = 'NOT_AUDITED' and outcome_audited)::int as status_mismatch
    from v_signing_records`)
  assert.equal(r.n, 268)
  assert.equal(r.dodgers, 220)
  assert.equal(r.zero_cost, 0)
  assert.equal(r.unaudited_with_value, 0)
  assert.equal(r.status_mismatch, 0)

  const types = await rows(`select column_name, data_type from information_schema.columns
    where table_name = 'v_signing_records' and column_name in ('pathway','signing_date','signing_bonus_usd','career_bwar','player_sort_name')`)
  const byName = Object.fromEntries(types.map((t) => [t.column_name, t.data_type]))
  assert.equal(byName.pathway, 'text', 'enum is exposed as text so it sorts alphabetically')
  assert.equal(byName.signing_date, 'date')
  assert.equal(byName.signing_bonus_usd, 'numeric')
  assert.equal(byName.career_bwar, 'numeric')

  const dates = await rows("select signing_date from v_signing_records where is_dodgers_franchise order by signing_date asc nulls last limit 2")
  assert.equal(dates[0].signing_date.toISOString().slice(0, 10), '1951-02-06', 'dates sort chronologically')
  const names = (await rows('select full_name from v_signing_records order by player_sort_name')).map((r) => foldText(r.full_name))
  assert.deepEqual(names, [...names].sort(), 'player_sort_name orders names alphabetically')
})

test('Brooklyn-era signings display the historical organization name', async () => {
  const r = await one("select organization_name, franchise_key, mlb_debut_org from v_signing_records where full_name = 'Sandy Amoros'")
  assert.equal(r.organization_name, 'Brooklyn Dodgers')
  assert.equal(r.franchise_key, 'DODGERS')
  assert.equal(r.mlb_debut_org, 'BRO')
})

test('player timeline runs signing → debut → metric', async () => {
  const events = await rows(`select t.event_type from v_player_timeline t join players p on p.id = t.player_id
    where p.full_name = 'Andy Pages' order by t.event_year, t.event_date nulls last, t.event_order`)
  const order = events.map((e) => e.event_type)
  assert.ok(order.indexOf('SIGNING') < order.indexOf('MLB_DEBUT'))
  assert.ok(order.indexOf('MLB_DEBUT') < order.indexOf('METRIC'))
})

test('multi-player trades are attributed at package level', async () => {
  const cruz = await one("select attribution_status, outgoing_asset_count, jsonb_array_length(outgoing_assets) as n from v_player_transactions where full_name = 'Oneil Cruz'")
  assert.equal(cruz.attribution_status, 'SHARED_PACKAGE_RETURN')
  assert.equal(cruz.outgoing_asset_count, 2)
  assert.equal(cruz.n, 2)
})

test('every player source carries URL, tier and accessed date', async () => {
  const r = await one(`select count(*)::int as n,
      count(*) filter (where url is null or source_tier is null or accessed_date is null)::int as incomplete
    from v_player_sources`)
  assert.ok(r.n > 100)
  assert.equal(r.incomplete, 0)
})

test('security: all public views are security_invoker and new tables have RLS', async () => {
  const views = await rows(`select c.relname, coalesce(c.reloptions::text, '') as opts
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'`)
  assert.ok(views.length > 40)
  for (const v of views) assert.match(v.opts, /security_invoker=(true|on)/, `${v.relname} must be security_invoker`)

  const tables = await rows(`select relname, relrowsecurity from pg_class
    where relname in ('player_metric_observations', 'source_tiers', 'signing_populations', 'signing_population_members',
      'signing_population_member_sources', 'research_source_conflicts', 'signing_period_candidates') and relkind = 'r'`)
  assert.equal(tables.length, 7)
  for (const t of tables) assert.equal(t.relrowsecurity, true)
})

test('security: anon can read research views but cannot write', async () => {
  await db.transaction(async (tx) => {
    await tx.query('set local role anon')
    const r = (await tx.query('select count(*)::int as n from v_signing_records')).rows[0]
    assert.equal(r.n, 268)
    const player = (await tx.query("select player_id from v_player_directory where full_name = 'Andy Pages'")).rows[0]
    await assert.rejects(
      tx.query("insert into player_metric_observations (player_id, metric_key, value, observed_through_date, source_id) values ($1, 'CAREER_BWAR', 1, '2031-01-01', gen_random_uuid())", [player.player_id]),
      /permission denied/,
    )
    await tx.rollback()
  })
  await db.transaction(async (tx) => {
    await tx.query('set local role anon')
    await assert.rejects(tx.query("update players set full_name = 'x'"), /permission denied/)
    await tx.rollback()
  })
})

// ---------------------------------------------------------------------------
// 018: signing populations, class membership and the 2022 / 2024 / 2025 backfill
// ---------------------------------------------------------------------------

const population = (key) => one('select * from v_dodgers_signing_population_coverage where population_key = $1', [key])
const membersOf = (key) => rows('select r.* from v_signing_records r where $1 = any(r.population_keys)', [key])
const countBy = (list, fn) => list.reduce((acc, x) => { const k = fn(x); acc[k] = (acc[k] || 0) + 1; return acc }, {})
const positionGroups = async (key) => countBy(
  await rows('select disi_position_group(primary_position) as g from v_signing_records where $1 = any(population_keys)', [key]),
  (r) => r.g,
)

test('2024 announced opening class is 19 of 19, and the full period is not claimed complete', async () => {
  const opening = await population('DODGERS-2024-OPENING')
  assert.equal(opening.expected_population, 19)
  assert.equal(opening.tracked_population, 19)
  assert.equal(Number(opening.coverage_rate), 1)
  assert.equal(opening.population_complete, true)
  assert.deepEqual(await positionGroups('DODGERS-2024-OPENING'), { P: 7, C: 4, IF: 5, OF: 3 })
  const full = await population('DODGERS-2024-FULL-PERIOD')
  assert.equal(full.expected_population, null)
  assert.equal(full.population_complete, false)
})

test('Eduardo Rojas: announced 2024 class member with his verified May 30, 2024 transaction date', async () => {
  const r = await one(`select r.*, p.mlb_id from v_signing_records r join players p on p.id = r.player_id where r.full_name = 'Eduardo Rojas'`)
  assert.equal(Number(r.mlb_id), 821672)
  assert.equal(r.signing_year, 2024)
  assert.equal(r.primary_position, 'C')
  assert.equal(r.country_market, 'Venezuela')
  assert.equal(r.formal_transaction_date.toISOString().slice(0, 10), '2024-05-30')
  assert.equal(r.signing_date.toISOString().slice(0, 10), '2024-05-30', 'transaction date is not rewritten to the announcement day')
  assert.equal(r.announced_date.toISOString().slice(0, 10), '2024-01-15')
  assert.equal(r.opening_class_member, true)
  const rec = await one(`select classification from v_dodgers_class_source_reconciliation where full_name = 'Eduardo Rojas'`)
  assert.equal(rec.classification, 'ANNOUNCED_TRANSACTION_LATER')
})

test('Allen Ajoti stays the canonical MLB identity; "Allan Atoji" is a sourced alias', async () => {
  const players = await rows(`select id, full_name, mlb_id from players where full_name in ('Allen Ajoti', 'Allan Atoji')`)
  assert.deepEqual(players.map((p) => p.full_name), ['Allen Ajoti'])
  assert.equal(Number(players[0].mlb_id), 821808)
  const alias = await one(`select a.alias, a.alias_type, s.url from player_aliases a join sources s on s.id = a.source_id
    where a.player_id = $1 and a.alias = 'Allan Atoji'`, [players[0].id])
  assert.equal(alias.alias_type, 'PUBLISHED_SPELLING')
  assert.match(alias.url, /truebluela\.com/)
  const search = await one(`select count(*)::int as n from v_player_directory where search_text like '%atoji%'`)
  assert.equal(search.n, 1, 'the alias is searchable')
  const conflict = await one(`select status from research_source_conflicts where conflict_key = 'NAME:ajoti'`)
  assert.equal(conflict.status, 'RESOLVED')
})

test('2025 announced opening class is 29 of 29 with the stated country and position totals', async () => {
  const opening = await population('DODGERS-2025-OPENING')
  assert.equal(opening.expected_population, 29)
  assert.equal(opening.tracked_population, 29)
  assert.equal(opening.population_complete, true)
  const members = await membersOf('DODGERS-2025-OPENING')
  assert.equal(members.length, 29)
  assert.deepEqual(countBy(members, (r) => r.country_market), {
    Venezuela: 12, 'Dominican Republic': 8, Mexico: 4, Colombia: 2, Japan: 1, Panama: 1, 'South Sudan': 1,
  })
  assert.deepEqual(await positionGroups('DODGERS-2025-OPENING'), { P: 16, C: 4, IF: 6, OF: 3 })
  const added = ['Aneudy Almonte', 'Hendry Arvelo', 'Luis Gamez', 'Bryan Lara', 'Andres Luna', 'Ivan Pacheco',
    'Alexis Reyes', 'Shai Romero', 'Cesar Sanchez', 'Samuel Savinon', 'Antoni Urena']
  const found = members.filter((m) => added.includes(m.full_name))
  assert.equal(found.length, 11)
  for (const m of found) {
    assert.equal(m.signing_bonus_usd, null, `${m.full_name}: no bonus is invented`)
    assert.ok(m.formal_transaction_date, `${m.full_name}: MLB transaction verified`)
  }
  const urena = await one(`select count(*)::int as n from player_aliases a join players p on p.id = a.player_id
    where p.full_name = 'Antoni Urena' and a.alias = $1`, ['Antoni Ureña'])
  assert.equal(urena.n, 1)
})

test('every 2025 opening-class member has membership provenance that verifies only class facts', async () => {
  const r = await one(`select
      count(distinct pm.id)::int as members,
      count(distinct pm.id) filter (where ms.id is not null)::int as with_source,
      bool_and(ms.membership_basis = 'SECONDARY_CLASS_RECONSTRUCTION') as all_secondary,
      bool_or('FORMAL_TRANSACTION_DATE' = any(ms.supports_fields)) as claims_dates
    from signing_population_members pm
    join signing_populations p on p.id = pm.population_id and p.population_key = 'DODGERS-2025-OPENING'
    left join signing_population_member_sources ms on ms.member_id = pm.id`)
  assert.equal(r.members, 29)
  assert.equal(r.with_source, 29)
  assert.equal(r.all_secondary, true)
  assert.equal(r.claims_dates, false, 'a class-list source does not verify transaction dates')
  await assert.rejects(
    db.query(`insert into signing_population_member_sources (member_id, source_id, membership_basis, supports_fields)
              select pm.id, s.id, 'SECONDARY_CLASS_RECONSTRUCTION', array['BONUS'] from signing_population_members pm, sources s limit 1`),
    /check constraint/,
    'BONUS is not a fact a membership source can support',
  )
})

test('the seven 2025 players with 2024-12-16 transactions are flagged, not forced into a period', async () => {
  const r = await rows(`select full_name from v_dodgers_class_source_reconciliation
    where classification = 'PERIOD_ASSIGNMENT_AMBIGUOUS' order by full_name`)
  assert.deepEqual(r.map((x) => x.full_name),
    ['Alexis Reyes', 'Aneudy Almonte', 'Antoni Urena', 'Cesar Sanchez', 'Hendry Arvelo', 'Samuel Savinon', 'Shai Romero'])
  const full = await population('DODGERS-2025-FULL-PERIOD')
  assert.equal(full.tracked_population, 22)
})

test('opening-class completeness never implies full signing-period completeness', async () => {
  const pops = await rows('select population_key, population_scope, population_complete, rate_analysis_suitable from v_dodgers_signing_population_coverage')
  for (const p of pops.filter((x) => x.population_scope === 'OPENING_CLASS')) assert.equal(p.rate_analysis_suitable, false)
  for (const year of [2021, 2023, 2024, 2025]) {
    assert.equal(pops.find((p) => p.population_key === `DODGERS-${year}-OPENING`).population_complete, true)
    assert.equal(pops.find((p) => p.population_key === `DODGERS-${year}-FULL-PERIOD`).population_complete, false,
      `${year} full period stays incomplete`)
  }
  await assert.rejects(
    db.query(`update signing_populations set rate_analysis_suitable = true where population_key = 'DODGERS-2025-OPENING'`),
    /check constraint/,
  )
})

test('an opening class alone can never enable an organization hit rate, even when fully audited', async () => {
  await db.transaction(async (tx) => {
    await tx.query(`insert into outcome_audits (player_id, audited_through_date, reached_mlb_verified, audit_note)
      select s.player_id, date '2026-10-05', false, 'test fixture'
      from signing_population_members pm
      join signing_populations p on p.id = pm.population_id and p.population_key = 'DODGERS-2021-OPENING'
      join signings s on s.id = pm.signing_id
      on conflict (player_id) do nothing`)
    const e = (await tx.query('select rate_eligible, exclusion_reason, opening_class_complete from v_dodgers_class_analysis_eligibility where signing_year = 2021')).rows[0]
    assert.equal(e.opening_class_complete, true)
    assert.equal(e.rate_eligible, false)
    assert.notEqual(e.exclusion_reason, 'RATE_ELIGIBLE')
    const summary = (await tx.query('select rate_eligible_classes from v_dodgers_rate_eligible_summary')).rows[0]
    assert.equal(Number(summary.rate_eligible_classes), 0)
    const cohort = (await tx.query('select * from v_dodgers_opening_class_cohort_rates where signing_year = 2021')).rows[0]
    assert.equal(cohort.cohort_rate_eligible, true)
    assert.equal(cohort.rate_label, 'OPENING_CLASS_COHORT_RATE')
    assert.match(cohort.rate_caveat, /Not the organization/)
    await tx.rollback()
  })
})

test('positive control: a complete, audited, mature full-period population does become rate-eligible', async () => {
  await db.transaction(async (tx) => {
    const p = (await tx.query(`select tracked_population from v_dodgers_signing_population_coverage where population_key = 'DODGERS-2019-20-FULL-PERIOD'`)).rows[0]
    await tx.query(`update signing_populations set expected_size = $1 where population_key = 'DODGERS-2019-20-FULL-PERIOD'`, [p.tracked_population])
    await tx.query(`insert into outcome_audits (player_id, audited_through_date, reached_mlb_verified, audit_note)
      select s.player_id, date '2026-10-05', false, 'test fixture'
      from signing_population_members pm
      join signing_populations sp on sp.id = pm.population_id and sp.population_key = 'DODGERS-2019-20-FULL-PERIOD'
      join signings s on s.id = pm.signing_id
      on conflict (player_id) do nothing`)
    const e = (await tx.query('select rate_eligible from v_dodgers_class_analysis_eligibility where signing_year = 2019')).rows[0]
    assert.equal(e.rate_eligible, true)
    const summary = (await tx.query('select rate_eligible_classes, rate_eligible_signings from v_dodgers_rate_eligible_summary')).rows[0]
    assert.equal(Number(summary.rate_eligible_classes), 1)
    assert.equal(Number(summary.rate_eligible_signings), p.tracked_population, 'only population members enter the denominator')
    await tx.rollback()
  })
})

test('2022: discrepancies are explicit, later-period signings are added, nothing is deleted', async () => {
  const opening = await population('DODGERS-2022-OPENING')
  assert.equal(opening.expected_population, 30)
  assert.equal(opening.tracked_population, 31)
  assert.equal(opening.population_complete, false)
  assert.equal(opening.completeness_status, 'UNRESOLVED_CONFLICT')
  const full = await population('DODGERS-2022-FULL-PERIOD')
  assert.equal(full.tracked_population, 56)
  assert.equal(full.expected_population, null)

  const gudino = await one(`select r.classification, r.unresolved_flag, s.signing_year from v_dodgers_class_source_reconciliation r
    join signings s on s.id = r.signing_id where r.full_name = 'Yhonaider Gudino'`)
  assert.equal(gudino.signing_year, 2022, 'Gudino is preserved')
  assert.equal(gudino.classification, 'TRANSACTION_NOT_IN_ANNOUNCEMENT')
  assert.equal(gudino.unresolved_flag, true)

  const late = await rows(`select full_name, to_char(formal_transaction_date, 'YYYY-MM-DD') as d, classification
    from v_dodgers_class_source_reconciliation
    where full_name in ('Edgar Aviles', 'Alexander Albertus', 'Ilmerson Colon') order by full_name`)
  assert.deepEqual(late.map((r) => [r.full_name, r.d, r.classification]), [
    ['Alexander Albertus', '2022-06-01', 'ANNOUNCED_TRANSACTION_LATER'],
    ['Edgar Aviles', '2022-04-14', 'ANNOUNCED_TRANSACTION_LATER'],
    ['Ilmerson Colon', '2022-06-20', 'ANNOUNCED_TRANSACTION_LATER'],
  ])
  const laterOnly = await one(`select count(*)::int as n from v_dodgers_class_source_reconciliation
    where signing_year = 2022 and classification = 'LATER_PERIOD_SIGNING'`)
  assert.equal(laterOnly.n, 24)
  const adon = await one(`select classification from signing_period_candidates where full_name = 'Rancer Adon'`)
  assert.equal(adon.classification, 'PRIOR_PROFESSIONAL_CONTRACT')
  const notAdded = await one(`select count(*)::int as n from signings s join players p on p.id = s.player_id where p.full_name = 'Rancer Adon'`)
  assert.equal(notAdded.n, 0)
})

test('018 backfill leaves unknowns NULL and keeps legacy signing dates', async () => {
  const r = await one(`select
      count(*) filter (where total_known_acquisition_cost_usd = 0 or signing_bonus_usd = 0)::int as zeros,
      count(*) filter (where signing_year = 2022 and formal_transaction_date > date '2022-01-15' and signing_bonus_usd is not null)::int as invented_bonus,
      count(*) filter (where signing_year in (2022, 2024) and formal_transaction_date = signing_date)::int as dates_agree,
      count(*) filter (where signing_year in (2022, 2024))::int as n
    from v_signing_records`)
  assert.equal(r.zeros, 0)
  assert.equal(r.invented_bonus, 0)
  assert.equal(r.dates_agree, r.n)
  const lopez = await one(`select country_market from v_signing_records where full_name = 'Jose Lopez' and signing_year = 2024`)
  assert.equal(lopez.country_market, null, 'conflicting sources leave the market unknown')
})

test('anon cannot write any 018 table', async () => {
  for (const sql of [
    `insert into signing_populations (population_key, population_scope, class_year_start, class_year_end, period_label) values ('x', 'OPENING_CLASS', 2026, 2026, 'x')`,
    'delete from signing_population_members',
    `update research_source_conflicts set status = 'RESOLVED'`,
    `insert into signing_period_candidates (mlb_person_id, full_name, franchise_key, transaction_date, classification) values (1, 'x', 'DODGERS', '2026-01-01', 'IDENTIFIED_NOT_INGESTED')`,
  ]) {
    await db.transaction(async (tx) => {
      await tx.query('set local role anon')
      await assert.rejects(tx.query(sql), /permission denied/)
      await tx.rollback()
    })
  }
  await db.transaction(async (tx) => {
    await tx.query('set local role anon')
    const n = (await tx.query('select count(*)::int as n from v_dodgers_class_source_reconciliation')).rows[0].n
    assert.ok(n > 100)
    await tx.rollback()
  })
})
