// Executes the complete canonical SQL lineage (database/manifest.json) in an
// in-process Postgres (PGlite) and checks the research-database rules.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildCanonicalChain, manifest } from './canonical-chain.mjs'
import { foldText, slugify } from '../../lib/text.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sqlDir = path.join(root, 'database/sql')
const readSql = (file) => fs.readFileSync(path.join(sqlDir, file), 'utf8')

/** @type {PGlite} */
let db
const rows = async (sql, params) => (await db.query(sql, params)).rows
const one = async (sql, params) => (await rows(sql, params))[0]

before(async () => {
  db = (await buildCanonicalChain()).db
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
      (select string_agg(concat_ws('|', full_name, canonical_name, bref_id, fangraphs_id, birth_date, birth_city, birth_country, bats, throws, height_in, current_position), ',' order by id) from players) as identities,
      (select string_agg(coalesce(position_at_signing, ''), ',' order by id) from signings) as positions_at_signing,
      (select string_agg(player_id::text || id_system || status || coalesce(external_id, ''), ',' order by player_id, id_system) from player_identity_resolutions) as resolutions,
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
      (select count(*) from player_professional_progress)::int as progress,
      (select count(*) from outcome_evidence)::int as outcome_evidence,
      (select string_agg(player_id::text || reached_mlb_verified || coalesce(outcome_state, ''), ',' order by player_id) from outcome_audits) as audits,
      (select count(*) from outcomes)::int as outcomes,
      (select string_agg(coalesce(source_id::text,'') || tracked_signings || coalesce(population_scope, ''), ',' order by id) from signing_census_coverage) as coverage,
      (select count(*) from player_season_stints)::int as stints,
      (select string_agg(concat_ws('|', season::text, level::text, coalesce(affiliate_team, ''), coalesce(league_name, ''), coalesce(source_level, ''), level_classification, era::text, affiliated::text,
        coalesce(g::text, ''), coalesce(pa::text, ''), coalesce(pg::text, ''), coalesce(ip::text, ''),
        coalesce(first_game_date::text, ''), coalesce(last_game_date::text, ''), coalesce(game_date_basis, '')), ',' order by player_id, season, level, coalesce(affiliate_team, ''), coalesce(league_name, '')) from player_season_stints) as stint_values,
      (select count(*) from development_milestones where event_code is not null)::int as coded_milestones,
      (select string_agg(concat_ws('|', event_code, coalesce(milestone_date::text, ''), coalesce(season_year::text, ''), date_precision::text, coalesce(evidence_basis, ''), coalesce(prior_evidence_basis, '')), ','
        order by player_id, event_code, coalesce(milestone_date::text, '9999'), coalesce(season_year, 0)) from development_milestones where event_code is not null) as milestone_values,
      (select count(*) from player_development_status)::int as dev_status,
      (select string_agg(status::text || basis || coalesce(status_season::text, '') || coalesce(note, ''), ',' order by player_id) from player_development_status) as dev_status_values`)
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
    where m.metric_key = 'CAREER_BWAR' and m.notes like 'Backfilled in 017%'`)
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
  const r = await one("select organization_name, franchise_key, mlb_debut_org from v_signing_records where public.disi_ascii_fold(full_name) = 'sandy amoros'")
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

// ---------------------------------------------------------------------------
// 019: evidence-based outcome audits, professional progress, outcome views
// ---------------------------------------------------------------------------

// Accent-insensitive: 020 respells some names with their accents (Roger Cedeño).
const dossier = (name) => one('select * from v_player_dossier where public.disi_ascii_fold(full_name) = public.disi_ascii_fold($1)', [name])

test('019 adds 35 evidence-backed audits: 2 verified MLB, 33 verified no MLB', async () => {
  const p = await one('select * from v_dodgers_outcome_audit_progress')
  assert.equal(p.audited, 93)
  assert.equal(p.verified_mlb, 47)
  assert.equal(p.verified_no_mlb, 46)
  assert.equal(p.unaudited, 127)
  assert.equal(p.mature_unaudited, 7)
  const states = await rows(`select outcome_state, count(*)::int as n from outcome_audits group by 1 order by 1`)
  assert.ok(states.every((s) => s.outcome_state !== null), 'every audit has an outcome state')
})

test('an unaudited player is never treated as reached_mlb = false, even with progress data', async () => {
  const r = await one(`select
      count(*) filter (where pp.research_recommendation = 'NO_MLB_CAREER_ENDED')::int as researched_negative,
      count(*) filter (where r.reached_mlb_verified is not null)::int as with_value,
      count(*) filter (where r.outcome_audit_status <> 'NOT_AUDITED')::int as audited
    from v_signing_records r
    join player_professional_progress pp on pp.player_id = r.player_id
    where r.is_dodgers_franchise and r.signing_year >= 2022`)
  assert.ok(r.researched_negative > 0, 'there are recent players whose research points to no MLB')
  assert.equal(r.with_value, 0, 'they stay unaudited: reached_mlb_verified is NULL, not false')
  assert.equal(r.audited, 0)
})

test('recent and developing players are not negative outcomes', async () => {
  const r = await one(`select count(*)::int as n from outcome_audits oa join signings s on s.player_id = oa.player_id
    join organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
    where not oa.reached_mlb_verified and s.signing_year >= 2022`)
  assert.equal(r.n, 0)
  const developing = await rows(`select full_name, unaudited_reason from v_dodgers_mature_outcome_queue where signing_year = 2021 order by full_name`)
  assert.equal(developing.length, 7)
  assert.ok(developing.every((d) => ['STILL_DEVELOPING', 'INSUFFICIENT_EVIDENCE'].includes(d.unaudited_reason)))
})

test('a verified no-MLB audit cannot exist without outcome evidence', async () => {
  // A player with no outcome evidence at all (not part of the 019 research).
  const player = await one(`select p.id as player_id from players p
    where not exists (select 1 from outcome_evidence e where e.player_id = p.id)
      and not exists (select 1 from outcome_audits oa where oa.player_id = p.id) limit 1`)
  await db.transaction(async (tx) => {
    await tx.query('set constraints all immediate')
    await assert.rejects(
      tx.query(`insert into outcome_audits (player_id, audited_through_date, reached_mlb_verified, outcome_state)
                values ($1, '2026-10-05', false, 'NO_MLB_CAREER_ENDED')`, [player.player_id]),
      /no MLB_REACH outcome evidence/,
    )
    await tx.rollback()
  })
  await db.transaction(async (tx) => {
    await tx.query(`insert into outcome_evidence (player_id, source_id, supports_fields)
                    select $1, id, array['MLB_REACH'] from sources where url like 'https://statsapi.mlb.com/api/v1/people/%' limit 1`, [player.player_id])
    await tx.query('set constraints all immediate')
    await tx.query(`insert into outcome_audits (player_id, audited_through_date, reached_mlb_verified, outcome_state)
                    values ($1, '2026-10-05', false, 'NO_MLB_CAREER_ENDED')`, [player.player_id])
    await tx.rollback()
  })
  const all = await one(`select count(*)::int as n from outcome_audits oa where not oa.reached_mlb_verified
    and not exists (select 1 from outcome_evidence e where e.player_id = oa.player_id and 'MLB_REACH' = any(e.supports_fields))`)
  assert.equal(all.n, 0, 'every existing negative audit has evidence')
})

test('outcome state must agree with the reached flag', async () => {
  const player = await one(`select player_id from outcome_audits where reached_mlb_verified limit 1`)
  await assert.rejects(
    db.query(`update outcome_audits set outcome_state = 'NO_MLB_CAREER_ENDED' where player_id = $1`, [player.player_id]),
    /check constraint/,
  )
})

test('new MLB outcomes: Roger Cedeno and Carlos Frias with Baseball-Reference bWAR', async () => {
  const cedeno = await dossier('Roger Cedeno')
  assert.equal(cedeno.outcome_state, 'REACHED_MLB')
  assert.equal(cedeno.mlb_debut_date.toISOString().slice(0, 10), '1995-06-20')
  assert.equal(cedeno.mlb_debut_org, 'LAD')
  assert.equal(cedeno.direct_dodgers_franchise_debut, true)
  assert.equal(Number(cedeno.career_bwar), 1.7)
  assert.match(cedeno.bwar_source_url, /^https:\/\/www\.baseball-reference\.com\/data\/war_daily_bat\.txt$/)
  assert.equal(cedeno.bwar_observed_through_season, 2005)
  assert.equal(cedeno.current_status, 'LAST_MLB_2005')
  const frias = await dossier('Carlos Frias')
  assert.equal(Number(frias.career_bwar), -0.3)
  assert.equal(frias.continued_outside_affiliated, true, 'later Mexican League play is recorded separately')
  const identity = await one(`select status, resolution from research_source_conflicts where conflict_key = 'IDENTITY:roger-cedeno'`)
  assert.equal(identity.status, 'RESOLVED')
  assert.match(identity.resolution, /Venezuela/)
})

test('negative evidence is structured: level, last season, disposition, sources', async () => {
  const osuna = await dossier('Lenix Osuna')
  assert.equal(osuna.outcome_state, 'NO_MLB_CAREER_ENDED')
  assert.equal(osuna.highest_level, 'A+', 'Mexican League seasons are not counted as affiliated Triple-A')
  assert.equal(osuna.continued_outside_affiliated, true)
  assert.ok(osuna.outcome_evidence_count >= 3)
  const pitre = await dossier('Gersel Pitre')
  assert.equal(pitre.disposition, 'RELEASED')
  assert.equal(pitre.last_affiliated_season, 2019)
  assert.equal(pitre.audit_confidence, 'VERIFIED')
  const fields = await rows(`select distinct unnest(e.supports_fields) as f from outcome_evidence e
    join players p on p.id = e.player_id where p.full_name = 'Gersel Pitre' order by 1`)
  assert.deepEqual(fields.map((f) => f.f), ['ACTIVE_STATUS', 'DISPOSITION', 'FINAL_TRANSACTION', 'HIGHEST_LEVEL', 'LAST_AFFILIATED_SEASON', 'MLB_DEBUT_DATE', 'MLB_DEBUT_ORGANIZATION', 'MLB_REACH'])
})

test('existing audits are preserved; only their outcome state and progress are added', async () => {
  const rosario = await dossier('Jerming Rosario')
  assert.equal(rosario.reached_mlb_verified, false)
  assert.match(rosario.audit_note, /Active with Triple-A Oklahoma City/)
  assert.equal(rosario.outcome_state, 'NO_MLB_ACTIVE_IN_MINORS')
  assert.equal(rosario.highest_level, 'AAA')
  const dejesus = await dossier('Alex De Jesus')
  assert.equal(dejesus.outcome_state, 'NO_MLB_STATUS_UNKNOWN', 'insufficient status evidence is labelled, not guessed')
})

test('2018 and 2019 tracked classes are fully audited but remain tracked-cohort outcomes', async () => {
  const classes = await rows(`select * from v_dodgers_outcome_by_signing_class where signing_year in (2018, 2019) order by signing_year`)
  for (const c of classes) {
    assert.equal(c.unresolved, 0, `${c.signing_year} fully audited`)
    assert.equal(c.all_tracked_audited, true)
    assert.equal(c.organization_rate_allowed, false, 'no qualifying full signing-period population')
    assert.equal(c.cohort_label, 'TRACKED_COHORT_OUTCOME')
    assert.notEqual(c.tracked_cohort_mlb_share, null)
  }
  assert.deepEqual(classes.map((c) => [c.signing_year, c.tracked_players]), [[2018, 10], [2019, 4]])
})

test('a fully audited historical sample still cannot become an organization rate', async () => {
  const historical = await rows(`select * from v_dodgers_outcome_by_signing_class where signing_year <= 2012`)
  assert.ok(historical.every((c) => c.unresolved === 0), 'the historical verified set is fully audited')
  assert.ok(historical.every((c) => c.organization_rate_allowed === false))
  const pop = await one(`select rate_eligible, rate_exclusion_reason from v_dodgers_signing_population_coverage where population_key = 'DODGERS-1951-2012-HISTORICAL'`)
  assert.equal(pop.rate_eligible, false)
  assert.equal(pop.rate_exclusion_reason, 'SCOPE_NOT_A_FULL_SIGNING_PERIOD')
  const summary = await one('select rate_eligible_classes from v_dodgers_rate_eligible_summary')
  assert.equal(Number(summary.rate_eligible_classes), 0)
})

test('every bWAR observation still cites Baseball-Reference', async () => {
  const r = await one(`select count(*)::int as n, count(*) filter (where s.url !~* '^https?://(www\\.)?baseball-reference\\.com/')::int as other
    from player_metric_observations m join sources s on s.id = m.source_id where m.metric_key = 'CAREER_BWAR'`)
  assert.equal(r.n, 46)
  assert.equal(r.other, 0)
})

test('anon cannot write the 019 tables', async () => {
  for (const sql of [
    `insert into player_professional_progress (player_id, as_of_date) select id, '2026-10-05' from players limit 1`,
    `delete from outcome_evidence`,
    `update outcome_audits set outcome_state = null`,
  ]) {
    await db.transaction(async (tx) => {
      await tx.query('set local role anon')
      await assert.rejects(tx.query(sql), /permission denied/)
      await tx.rollback()
    })
  }
  await db.transaction(async (tx) => {
    await tx.query('set local role anon')
    const n = (await tx.query('select count(*)::int as n from v_dodgers_mature_outcome_queue')).rows[0].n
    assert.equal(n, 7)
    await tx.rollback()
  })
})

// ---------------------------------------------------------------------------
// 020: player identity and biography
// ---------------------------------------------------------------------------

test('020 identifiers: MLB, Baseball-Reference and FanGraphs ids are unique, and every MLB player has a B-Ref id', async () => {
  const r = await one(`select count(*)::int as players, count(mlb_id)::int as mlb, count(bref_id)::int as bref, count(fangraphs_id)::int as fg,
      count(distinct mlb_id)::int as mlb_distinct, count(distinct bref_id)::int as bref_distinct, count(distinct fangraphs_id)::int as fg_distinct
    from players`)
  assert.deepEqual([r.players, r.mlb, r.bref, r.fg], [268, 263, 58, 139])
  assert.equal(r.mlb_distinct, r.mlb)
  assert.equal(r.bref_distinct, r.bref)
  assert.equal(r.fg_distinct, r.fg)
  const cov = await one(`select mlb_players, mlb_players_with_bref_id from v_dodgers_player_identity_coverage where scope = 'ALL_TRACKED_PLAYERS'`)
  assert.equal(cov.mlb_players_with_bref_id, cov.mlb_players)
  const cedeno = await one(`select mlb_id, bref_id from players where slug = 'roger-cedeno'`)
  assert.deepEqual([Number(cedeno.mlb_id), cedeno.bref_id], [112155, 'cedenro01'])
  const ev = await one(`select count(*)::int as n from evidence e join sources s on s.id = e.source_id
    where e.entity_type = 'player' and e.field_name = 'bref_id' and s.url ~ 'baseball-reference\\.com/data/war_daily'`)
  assert.equal(ev.n, 58, 'each B-Ref id cites the Baseball-Reference WAR file')
  const fwar = await one(`select count(*)::int as n from player_metric_observations where metric_key = 'CAREER_FWAR'`)
  assert.equal(fwar.n, 0, 'a FanGraphs id does not add fWAR')
})

test('020 unresolved identities keep NULL ids and biography and are queued, never auto-resolved', async () => {
  const unresolved = await rows(`select slug, birth_date, bats, throws from players where mlb_id is null order by slug`)
  assert.deepEqual(unresolved.map((r) => r.slug),
    ['emmanuel-dejesus', 'jonathan-amundaray', 'micker-zapata', 'yeremy-rosario', 'yeyson-yrizarry'])
  for (const r of unresolved) assert.deepEqual([r.birth_date, r.bats, r.throws], [null, null, null], `${r.slug} has no invented biography`)
  const queued = await rows(`select player_slug from v_dodgers_player_identity_research_queue where issue = 'MLB_ID_UNRESOLVED' order by 1`)
  assert.deepEqual(queued.map((r) => r.player_slug), unresolved.map((r) => r.slug))
  const bref = await one(`select r.status from player_identity_resolutions r join players p on p.id = r.player_id
    where p.slug = 'emmanuel-dejesus' and r.id_system = 'BASEBALL_REFERENCE'`)
  assert.equal(bref.status, 'NOT_FOUND', 'an unresolved player is not declared to have no MLB debut')
  // An ambiguous / review status can never carry an applied id; RESOLVED always needs one.
  for (const [sql, label] of [
    [`insert into player_identity_resolutions (player_id, id_system, external_id, status, decided_on) values ($1, 'MLB', '123', 'AMBIGUOUS', current_date)`, 'ambiguous with id'],
    [`insert into player_identity_resolutions (player_id, id_system, status, decided_on) values ($1, 'MLB', 'RESOLVED', current_date)`, 'resolved without id'],
  ]) {
    await db.transaction(async (tx) => {
      const pid = (await tx.query(`select id from players where slug = 'emmanuel-dejesus'`)).rows[0].id
      await tx.query(`delete from player_identity_resolutions where player_id = $1 and id_system = 'MLB'`, [pid])
      await assert.rejects(tx.query(sql, [pid]), /check constraint/, label)
      await tx.rollback()
    })
  }
})

test('020 biography: values carry field-level evidence; existing values are kept and disagreements recorded', async () => {
  const urias = await one(`select * from v_player_bio where player_slug = 'julio-urias'`)
  assert.equal(urias.full_name, 'Julio Urías')
  assert.equal(urias.birth_country, 'Mexico')
  assert.equal(urias.nationality, null, 'nationality is never derived from birth country')
  assert.ok(urias.birth_date && urias.bats && urias.throws && urias.birth_city)
  const fields = (await rows(`select distinct e.field_name from evidence e join players p on p.id = e.entity_id
    where e.entity_type = 'player' and p.slug = 'julio-urias' and e.field_name is not null`)).map((r) => r.field_name)
  for (const f of ['birth_date', 'birth_city', 'birth_country', 'bats', 'throws', 'height_in', 'weight_lb', 'mlb_id']) {
    assert.ok(fields.includes(f), `evidence for ${f}`)
  }
  assert.ok(!fields.includes('nationality'))
  const thon = await rows(`select c.note from research_source_conflicts c join players p on p.id = c.player_id
    where p.slug = 'joseph-deng-thon' and c.field_name = 'birth_country'`)
  assert.equal(thon.length, 1, 'a conflict is not duplicated')
  assert.match(thon[0].note, /before South Sudan/)
})

test('020 names: accent-only respelling keeps the slug, the old spelling is an alias, search ignores accents', async () => {
  const c = await one(`select full_name, canonical_name, slug from players where slug = 'roger-cedeno'`)
  assert.deepEqual([c.full_name, c.canonical_name, c.slug], ['Roger Cedeño', 'Roger Cedeño', 'roger-cedeno'])
  const renamed = await one(`select count(*)::int as n from player_aliases where alias_type = 'PREVIOUS_DISI_SPELLING'`)
  assert.equal(renamed.n, 28)
  const bad = await one(`select count(*)::int as n from player_aliases a join players p on p.id = a.player_id
    where a.alias_type = 'PREVIOUS_DISI_SPELLING' and public.disi_ascii_fold(a.alias) <> public.disi_ascii_fold(p.full_name)`)
  assert.equal(bad.n, 0, 'no rename beyond accents')
  for (const [q, slug] of [['cedeno', 'roger-cedeno'], ['Cedeño', 'roger-cedeno'], ['atoji', 'allen-ajoti'],
    ['jeremi', 'jerami-rodriguez'], ['urena', 'antoni-urena'], ['Ureña', 'antoni-urena']]) {
    const hit = await rows(`select player_slug from v_player_directory where search_text like '%' || public.disi_ascii_fold($1) || '%'`, [q])
    assert.ok(hit.some((r) => r.player_slug === slug), `${q} finds ${slug}`)
  }
  const ajoti = await rows(`select id from players where public.disi_ascii_fold(full_name) in ('allen ajoti', 'allan atoji')`)
  assert.equal(ajoti.length, 1, 'an alias is not a second player')
})

test('020 ages: derived only when both dates exist, and each age names its date', async () => {
  const r = await one(`select
      count(*) filter (where age_at_signing is not null and (birth_date is null or signing_date is null))::int as invented_signing,
      count(*) filter (where age_at_announcement is not null and (birth_date is null or announced_date is null))::int as invented_announce,
      count(*) filter (where age_at_formal_transaction is not null and (birth_date is null or formal_transaction_date is null))::int as invented_tx,
      count(*) filter (where age_at_signing is not null and signing_date_basis is null)::int as unlabeled
    from v_signing_ages`)
  assert.deepEqual([r.invented_signing, r.invented_announce, r.invented_tx, r.unlabeled], [0, 0, 0, 0])
  const debut = await one(`select count(*) filter (where age_at_mlb_debut is not null and (birth_date is null or mlb_debut_date is null))::int as bad,
      count(*) filter (where age_at_mlb_debut is not null)::int as n from v_player_bio`)
  assert.deepEqual([debut.bad, debut.n], [0, 58])
  const urias = await one(`select signing_age_band, mlb_debut_date_basis from v_player_bio where player_slug = 'julio-urias'`)
  assert.deepEqual([urias.signing_age_band, urias.mlb_debut_date_basis], ['16_OR_YOUNGER', 'OUTCOME_RECORD'])
  const fn = await one(`select public.disi_age_years('2006-07-03', '2023-07-02') as y, public.disi_age_decimal('2006-07-03', '2023-07-02') as d,
    public.disi_age_years(null, '2023-07-02') as n, public.disi_signing_age_band(17) as b`)
  assert.deepEqual([fn.y, Number(fn.d), fn.n, fn.b], [16, 16.9, null, '17'])
})

test('020 birth country and signing market are separate fields and filters', async () => {
  const p = await one(`select b.birth_country, d.signing_markets from v_player_bio b
    join v_player_directory d using (player_id) where b.player_slug = 'rafy-peguero'`)
  assert.equal(p.birth_country, 'United States')
  assert.deepEqual(p.signing_markets, ['Dominican Republic'])
  const us = await rows(`select distinct facet from v_player_filter_options where facet in ('birth_country', 'signing_market') and value = 'United States'`)
  assert.deepEqual(us.map((f) => f.facet), ['birth_country'], 'United States is a birth country here, never a signing market')
  const all = (await rows(`select distinct facet from v_player_filter_options`)).map((r) => r.facet)
  for (const f of ['bats', 'throws', 'signing_age_band', 'birth_country', 'signing_market']) assert.ok(all.includes(f), f)
})

test('020 position at signing comes from the signing transaction, not the current position', async () => {
  const r = await one(`select count(*)::int as n, count(*) filter (where position_at_signing_source_id is null)::int as unsourced
    from signings where position_at_signing is not null`)
  assert.deepEqual([r.n, r.unsourced], [225, 0])
  const lorenzo = await one(`select s.position_at_signing, p.current_position from signings s join players p on p.id = s.player_id where p.slug = 'abel-lorenzo'`)
  assert.deepEqual([lorenzo.position_at_signing, lorenzo.current_position], ['C', 'OF'])
})

test('020 views are security_invoker; anon reads identity data but cannot write it', async () => {
  const views = await rows(`select c.relname, coalesce(c.reloptions::text, '') as opts from pg_class c
    where c.relname in ('v_player_bio', 'v_signing_ages', 'v_player_identity_scope', 'v_dodgers_player_identity_coverage',
      'v_dodgers_player_identity_research_queue', 'v_player_directory', 'v_player_dossier', 'v_player_filter_options')`)
  assert.equal(views.length, 8)
  for (const v of views) assert.match(v.opts, /security_invoker=(true|on)/, v.relname)
  const rls = await one(`select relrowsecurity from pg_class where relname = 'player_identity_resolutions'`)
  assert.equal(rls.relrowsecurity, true)
  for (const sql of [
    `update players set birth_date = '2000-01-01'`,
    `update players set bref_id = null`,
    `delete from player_identity_resolutions`,
    `insert into player_aliases (player_id, alias) select id, 'x' from players limit 1`,
  ]) {
    await db.transaction(async (tx) => {
      await tx.query('set local role anon')
      await assert.rejects(tx.query(sql), /permission denied/)
      await tx.rollback()
    })
  }
  await db.transaction(async (tx) => {
    await tx.query('set local role anon')
    assert.equal((await tx.query('select count(*)::int as n from v_player_bio')).rows[0].n, 268)
    assert.ok((await tx.query('select count(*)::int as n from v_dodgers_player_identity_research_queue')).rows[0].n > 0)
    await tx.rollback()
  })
})

// ---------------------------------------------------------------------------
// 020 correction pass: birth country vs signing market, Hoy Park, Dodgers scope
// ---------------------------------------------------------------------------

const birthAndMarket = (slug) => one(`select p.birth_country, p.birth_city, p.birth_state_province,
    array(select distinct s.country_market from signings s where s.player_id = p.id and s.country_market is not null) as markets
  from players p where p.slug = $1`, [slug])

test('020 corrections: De Paula and Marte Jr. were born in the United States; Dominican Republic stays their signing market', async () => {
  const dp = await birthAndMarket('josue-de-paula')
  assert.deepEqual([dp.birth_country, dp.birth_city, dp.birth_state_province, dp.markets], ['United States', 'Brooklyn', 'NY', ['Dominican Republic']])
  const dm = await birthAndMarket('damaso-marte-jr')
  assert.deepEqual([dm.birth_country, dm.birth_city, dm.birth_state_province, dm.markets], ['United States', 'Orlando', 'FL', ['Dominican Republic']])
  // The legacy value is kept on the resolved conflict, with the reason; evidence names the correction.
  const c = await one(`select status, value_a, value_b, resolution from research_source_conflicts where conflict_key = 'BIO:birth_country:josue-de-paula'`)
  assert.deepEqual([c.status, c.value_a, c.value_b], ['RESOLVED', 'Dominican Republic', 'United States'])
  assert.match(c.resolution, /signing market/)
  const ev = await one(`select e.evidence_note from evidence e join players p on p.id = e.entity_id
    where e.entity_type = 'player' and e.field_name = 'birth_country' and p.slug = 'josue-de-paula'`)
  assert.match(ev.evidence_note, /replaces legacy value "Dominican Republic"/)
})

test('020 corrections: Barreto, Romero and Deng Thon take the MLB birth country; class countries stay signing markets', async () => {
  const expected = {
    'isaac-barreto': ['Venezuela', ['Colombia']],
    'luciano-romero': ['Dominican Republic', ['Venezuela']],
    'joseph-deng-thon': ['Sudan', ['South Sudan']],
  }
  for (const [slug, [born, markets]] of Object.entries(expected)) {
    const r = await birthAndMarket(slug)
    assert.deepEqual([r.birth_country, r.markets], [born, markets], slug)
  }
  const thon = await one(`select p.nationality, c.status, c.resolution from players p
    join research_source_conflicts c on c.player_id = p.id and c.conflict_key = 'BIRTH_COUNTRY:deng-thon' where p.slug = 'joseph-deng-thon'`)
  assert.equal(thon.nationality, null, 'nationality is not inferred from either country')
  assert.equal(thon.status, 'RESOLVED')
  assert.match(thon.resolution, /2011-07-09/)
  const romeroMarket = await one(`select status from research_source_conflicts where conflict_key = 'MARKET:luciano-romero-2022'`)
  assert.equal(romeroMarket.status, 'RESOLVED')
})

test('020 corrections never overwrite signing markets', { timeout: 180000 }, async () => {
  // Every signing market equals its 019 value: the snapshot of all markets is compared with a
  // build that stops at 019.
  const after = await rows(`select p.slug, s.signing_year, s.country_market from signings s join players p on p.id = s.player_id order by 1, 2`)
  const before = new PGlite({ extensions: { pgcrypto } })
  try {
    await before.exec('create role anon nologin; create role authenticated nologin;')
    for (const file of manifest.canonical_sql.filter((f) => f < '020_')) await before.exec(readSql(file))
    const prior = (await before.query(`select p.slug, s.signing_year, s.country_market from signings s join players p on p.id = s.player_id order by 1, 2`)).rows
    assert.deepEqual(after, prior)
  } finally {
    await before.close()
  }
})

test('020 Hyo-Jun Park resolves to MLB player Hoy Park (660829) on documented signing-transaction evidence', async () => {
  const p = await one(`select * from v_player_bio where player_slug = 'hyo-jun-park'`)
  assert.equal(p.full_name, 'Hyo-Jun Park', 'the DISI tracker spelling stays the name')
  assert.deepEqual([Number(p.mlb_id), p.bref_id, p.fangraphs_id], [660829, 'parkho01', '18027'])
  assert.equal(p.birth_date.toISOString().slice(0, 10), '1996-04-07')
  assert.deepEqual([p.birth_city, p.birth_country], ['Seoul', 'South Korea'])
  assert.deepEqual([...p.aliases].sort(), ['Hoy Jun Park', 'Hoy Park'])
  const r = await one(`select r.status, r.method, r.confidence::text, r.signals, r.note, s.url from player_identity_resolutions r
    join players p on p.id = r.player_id left join sources s on s.id = r.source_id
    where p.slug = 'hyo-jun-park' and r.id_system = 'MLB'`)
  assert.deepEqual([r.status, r.method, r.confidence], ['RESOLVED', 'MANUAL_LINKED_SIGNING_TRANSACTION', 'HIGH'])
  assert.ok(r.signals.includes('SIGNING_CLUB') && r.signals.includes('SIGNING_PERIOD_OPENING_DATE'), 'not a name-only link')
  assert.match(r.url, /transactions\?teamId=147&startDate=2014-01-01/)
  assert.match(r.note, /not on name similarity/)
  const alias = await one(`select a.alias_type, s.url from player_aliases a join players p on p.id = a.player_id
    left join sources s on s.id = a.source_id where p.slug = 'hyo-jun-park' and a.alias = 'Hoy Jun Park'`)
  assert.equal(alias.alias_type, 'MLB_TRANSACTION_NAME')
  assert.ok(alias.url, 'the alias cites the transaction log')
  const hit = await rows(`select player_slug from v_player_directory where search_text like '%hoy park%'`)
  assert.deepEqual(hit.map((h) => h.player_slug), ['hyo-jun-park'])
})

test('020 coverage: a conflicted field is present but not resolved', async () => {
  const before = await one(`select with_birth_country, birth_country_resolved, birth_country_conflicted, birth_country_unsourced
    from v_dodgers_player_identity_coverage where scope = 'ALL_TRACKED_PLAYERS'`)
  assert.equal(before.with_birth_country,
    before.birth_country_resolved + before.birth_country_conflicted + before.birth_country_unsourced)
  // Legacy birth countries no source backs are present but not resolved: the five unresolved benchmark
  // players, and Enrike Sevilya (MLB gives Moscow with the non-standard country code "RU1").
  assert.deepEqual([before.with_birth_country, before.birth_country_resolved, before.birth_country_unsourced], [268, 262, 6])
  const unsourced = await rows(`select player_slug from v_dodgers_player_identity_research_queue where issue = 'BIRTH_COUNTRY_UNSOURCED' order by 1`)
  assert.deepEqual(unsourced.map((r) => r.player_slug),
    ['emmanuel-dejesus', 'enrike-sevilya', 'jonathan-amundaray', 'micker-zapata', 'yeremy-rosario', 'yeyson-yrizarry'])
  await db.transaction(async (tx) => {
    const pid = (await tx.query(`select id from players where slug = 'rafy-peguero'`)).rows[0].id
    await tx.query(`insert into research_source_conflicts (conflict_key, conflict_type, player_id, field_name, value_a, value_b)
      values ('TEST:peguero', 'BIRTH_COUNTRY', $1, 'birth_country', 'United States', 'Dominican Republic')`, [pid])
    const c = (await tx.query(`select with_birth_country, birth_country_resolved, birth_country_conflicted
      from v_dodgers_player_identity_coverage where scope = 'ALL_TRACKED_PLAYERS'`)).rows[0]
    assert.equal(c.with_birth_country, before.with_birth_country, 'still present')
    assert.equal(c.birth_country_resolved, before.birth_country_resolved - 1, 'no longer resolved')
    assert.equal(c.birth_country_conflicted, before.birth_country_conflicted + 1)
    const b = (await tx.query(`select open_conflict_fields from v_player_bio where player_id = $1`, [pid])).rows[0]
    assert.deepEqual(b.open_conflict_fields, ['birth_country'])
    await tx.rollback()
  })
})

test('020 Dodgers-facing counts exclude other-club benchmark players unless all players are requested', async () => {
  const status = await one(`select dodgers_players, league_benchmark_players, total_players from v_database_status`)
  assert.deepEqual([status.dodgers_players, status.league_benchmark_players, status.total_players], [220, 48, 268])
  const dodgersFacet = await one(`select coalesce(sum(row_count), 0)::int as n from v_player_filter_options
    where facet = 'name_initial' and has_dodgers_signing`)
  const allFacet = await one(`select sum(row_count)::int as n from v_player_filter_options where facet = 'name_initial'`)
  assert.deepEqual([dodgersFacet.n, allFacet.n], [220, 268])
  // Hyo-Jun Park (Yankees, South Korea) is counted only in the benchmark row.
  const korea = await rows(`select has_dodgers_signing, row_count from v_player_filter_options
    where facet = 'signing_market' and value = 'South Korea' order by has_dodgers_signing`)
  const dodgersKorea = await one(`select count(*)::int as n from v_player_directory
    where has_dodgers_signing and 'South Korea' = any(signing_markets)`)
  const leagueKorea = await rows(`select player_slug from v_player_directory
    where not has_dodgers_signing and 'South Korea' = any(signing_markets) order by 1`)
  assert.ok(leagueKorea.some((r) => r.player_slug === 'hyo-jun-park'))
  assert.deepEqual(korea.map((r) => [r.has_dodgers_signing, r.row_count]),
    [[false, leagueKorea.length], ...(dodgersKorea.n ? [[true, dodgersKorea.n]] : [])])
  const cov = await one(`select players from v_dodgers_player_identity_coverage where scope = 'DODGERS_SIGNEES'`)
  assert.equal(cov.players, 220)
  const dir = await one(`select count(*)::int as n from v_player_directory where has_dodgers_signing`)
  assert.equal(dir.n, 220)
})

// ---------------------------------------------------------------------------
// 021: player development history (stints, milestones, status, views)
// ---------------------------------------------------------------------------

test('021 stints: 828 rows over 167 players; a player-season with several teams, levels or organizations is several rows', async () => {
  const t = await one(`select count(*)::int as n, count(distinct player_id)::int as players,
    count(*) filter (where source_id is null)::int as null_source,
    count(*) filter (where first_game_date is not null or last_game_date is not null)::int as dated,
    count(*) filter (where game_date_basis is not null)::int as dated_basis
    from player_season_stints`)
  // 022 filled 746 stints with game-verified first/last appearance dates; the
  // 60 log-era stints without a team identity (or without any logged games)
  // stay NULL: absence is recorded, never fabricated.
  assert.deepEqual([t.n, t.players, t.null_source, t.dated, t.dated_basis], [828, 167, 0, 746, 746])
  const multi = await one(`select
    (select count(*)::int from (select player_id, season from player_season_stints group by 1, 2 having count(*) > 1) x) as multi_stint,
    (select count(*)::int from (select player_id, season from player_season_stints group by 1, 2 having count(distinct level) > 1) x) as multi_level,
    (select count(*)::int from (select player_id, season from player_season_stints group by 1, 2 having count(distinct organization_id) > 1) x) as multi_org`)
  assert.deepEqual([multi.multi_stint, multi.multi_level, multi.multi_org], [173, 140, 10])
  // uniqueness holds even for rows whose source recorded no team/league name
  const dup = await one(`select count(*)::int as n from (
    select player_id, season, coalesce(affiliate_team, '') t, coalesce(league_name, '') l, level
    from player_season_stints group by 1, 2, 3, 4, 5 having count(*) > 1) x`)
  assert.equal(dup.n, 0)
  const levels = Object.fromEntries((await rows(`select level::text, count(*)::int as n from player_season_stints group by 1`))
    .map((r) => [r.level, r.n]))
  assert.deepEqual(levels, {
    INTERNATIONAL_ROOKIE: 334, COMPLEX_ROOKIE: 158, LOW_A: 122, HIGH_A: 71,
    AA: 46, AAA: 32, MLB: 14, FOREIGN_PRO: 8, OTHER: 43,
  })
})

test('021 preserves the source label beside the canonical level; unknown stays unknown', async () => {
  // Lenix Osuna, 2017-2018: complex, Midwest, California and Mexican-league
  // stints each keep the label the MLB Stats API filed them under.
  const osuna = await rows(`select s.season, s.affiliate_team, s.league_name, s.source_level, s.level::text as level, s.affiliated
    from player_season_stints s join players p on p.id = s.player_id
    where p.slug = 'lenix-osuna' and s.season in (2017, 2018) order by s.season, s.affiliate_team nulls last, s.league_name`)
  const byTeam = Object.fromEntries(osuna.map((r) => [`${r.season}|${r.affiliate_team}`, r]))
  assert.deepEqual([byTeam['2017|AZL Dodgers'].source_level, byTeam['2017|AZL Dodgers'].level], ['ROK', 'COMPLEX_ROOKIE'])
  assert.deepEqual([byTeam['2017|Great Lakes Loons'].source_level, byTeam['2017|Great Lakes Loons'].level], ['A', 'LOW_A'])
  assert.deepEqual([byTeam['2017|Rancho Cucamonga Quakes'].source_level, byTeam['2017|Rancho Cucamonga Quakes'].level], ['A+', 'HIGH_A'])
  assert.equal(byTeam['2017|Diablos Rojos del Mexico'].level, 'FOREIGN_PRO')
  // 2018: four Mexican clubs (one with no recorded team name) are four stints
  const mexican = osuna.filter((r) => r.league_name === 'Mexican League' && r.season === 2018)
  assert.equal(mexican.length, 4)
  assert.ok(mexican.some((r) => r.affiliate_team === null))
  const unknown = await one(`select count(*)::int as n, count(*) filter (where level = 'OTHER')::int as other,
    count(*) filter (where affiliated)::int as affiliated
    from player_season_stints where level_classification = 'UNKNOWN_ROOKIE_LEAGUE'`)
  assert.deepEqual([unknown.n, unknown.other, unknown.affiliated], [43, 43, 0])
})

test('021 keeps the 019 correction: the Mexican League is FOREIGN_PRO and never affiliated AAA', async () => {
  const fp = await rows(`select s.league_name, s.source_level, s.affiliated, s.organization_id, s.level::text as level
    from player_season_stints s where s.level = 'FOREIGN_PRO' order by s.league_name, s.affiliate_team nulls last`)
  assert.equal(fp.length, 8)
  for (const r of fp) {
    assert.equal(r.league_name, 'Mexican League')
    assert.equal(r.level, 'FOREIGN_PRO')
    assert.equal(r.affiliated, false)
    assert.equal(r.organization_id, null, 'Mexican clubs are not MLB organizations')
    assert.equal(r.source_level, 'AAA', 'the MLB Stats API filed the Mexican League under the Triple-A sport id before 2021')
  }
  const bad = await one(`select count(*)::int as n from player_season_stints
    where league_name = 'Mexican League' and (level <> 'FOREIGN_PRO' or affiliated)`)
  assert.equal(bad.n, 0)
})

test('021 milestones: SEASON precision never fabricates a date, DAY always has one; legacy 003 debuts are tagged, not duplicated', async () => {
  const m = await one(`select count(*)::int as n,
    count(*) filter (where date_precision = 'SEASON' and milestone_date is not null)::int as fabricated,
    count(*) filter (where date_precision = 'DAY' and milestone_date is null)::int as dayless,
    count(*) filter (where date_precision = 'SEASON' and season_year is null)::int as seasonless
    from development_milestones where event_code is not null`)
  assert.deepEqual([m.n, m.fabricated, m.dayless, m.seasonless], [832, 0, 0, 0])
  const oc = await one(`select count(*)::int as n,
    count(*) filter (where milestone_date is null and season_year is not null)::int as season_only
    from development_milestones where event_code = 'ORGANIZATION_CHANGE'`)
  assert.deepEqual([oc.n, oc.season_only], [18, 18])
  const legacy = await one(`select count(*)::int as n, count(*) filter (where date_precision = 'DAY')::int as day,
    count(*) filter (where season_year is not null)::int as with_season
    from development_milestones where evidence_basis = 'LEGACY_OUTCOME_AUDIT'`)
  assert.deepEqual([legacy.n, legacy.day, legacy.with_season], [5, 5, 5])
  const debuts = await one(`select count(*)::int as n, count(distinct player_id)::int as players
    from development_milestones where event_code = 'MLB_DEBUT'`)
  assert.deepEqual([debuts.n, debuts.players], [7, 7])
  const exact = await rows(`select p.slug, m.milestone_date::text as d from development_milestones m
    join players p on p.id = m.player_id
    where m.event_code = 'MLB_DEBUT' and m.evidence_basis = 'MLB_PERSON_RECORD' order by 1`)
  assert.deepEqual(exact, [
    { slug: 'carlos-frias', d: '2014-08-04' },
    { slug: 'roger-cedeno', d: '1995-06-20' },
  ])
})

test('021 derived metrics: exact elapsed times need both endpoint dates; season approximations are separate, labelled columns', async () => {
  const cedeno = await one(`select signing_date::text as signing, mlb_debut_date::text as debut,
    days_signing_to_mlb_exact, years_signing_to_mlb_exact, approx_years_signing_to_mlb,
    first_aa_season, mlb_debut_season
    from v_dodgers_player_development_summary where player_slug = 'roger-cedeno'`)
  assert.deepEqual([cedeno.signing, cedeno.debut, cedeno.days_signing_to_mlb_exact, Number(cedeno.years_signing_to_mlb_exact)],
    ['1991-03-03', '1995-06-20', 1570, 4.29])
  assert.equal(cedeno.approx_years_signing_to_mlb, 4)
  assert.deepEqual([cedeno.first_aa_season, cedeno.mlb_debut_season], [1993, 1995])
  // an exact elapsed time exists only where both endpoint dates exist
  const bad = await one(`select count(*)::int as n from v_dodgers_player_development_summary
    where days_signing_to_mlb_exact is not null and (signing_date is null or mlb_debut_date is null)`)
  assert.equal(bad.n, 0)
  // after 022, game-log evidence dates 24 of the 25 AA debuts in place; the one
  // whose first AA season predates the gameLog era stays season-precision, dateless
  const aa = await one(`select count(*)::int as n, count(*) filter (where milestone_date is not null)::int as dated
    from development_milestones where event_code = 'AA_DEBUT'`)
  assert.deepEqual([aa.n, aa.dated], [25, 24])
})

test('021 development status: a classification, not a grade; absence of data is never "not reached"', async () => {
  const byStatus = Object.fromEntries((await rows(`select status::text, count(*)::int as n from player_development_status group by 1`))
    .map((r) => [r.status, r.n]))
  assert.deepEqual(byStatus, {
    ROOKIE_LEVEL: 92, MLB: 47, A_BALL: 29, HIGH_A: 16, AAA: 14, AA: 12, OUT_OF_AFFILIATED_BASEBALL: 2,
  })
  // every player with stints has a status; 47 verified MLB audits are AUDITED_OUTCOME
  const orphans = await one(`select count(*)::int as n from players p
    where exists (select 1 from player_season_stints s where s.player_id = p.id)
      and not exists (select 1 from player_development_status d where d.player_id = p.id)`)
  assert.equal(orphans.n, 0)
  const audited = await one(`select count(*)::int as n from player_development_status where basis = 'AUDITED_OUTCOME'`)
  assert.equal(audited.n, 47)
  // development outside affiliated baseball is information, not failure, and names the prior level
  const ooa = await rows(`select p.slug, d.note from player_development_status d join players p on p.id = d.player_id
    where d.status = 'OUT_OF_AFFILIATED_BASEBALL' order by 1`)
  assert.deepEqual(ooa.map((r) => r.slug), ['edgar-leon', 'lenix-osuna'])
  assert.ok(ooa.every((r) => /Highest affiliated level reached: (LOW_A|HIGH_A)/.test(r.note)))
})

test('021 signing-class measures are tracked-cohort counts: reach uses any evidence, medians need both dates', async () => {
  const sasaki2025 = await one(`select tracked_players, reached_mlb, median_years_signing_to_mlb_exact, years_signing_to_mlb_n,
    cohort_scope from v_dodgers_development_by_signing_class where signing_year = 2025`)
  assert.deepEqual([sasaki2025.tracked_players, sasaki2025.reached_mlb, sasaki2025.years_signing_to_mlb_n], [29, 1, 1])
  assert.equal(Number(sasaki2025.median_years_signing_to_mlb_exact), 0.15)
  assert.equal(sasaki2025.cohort_scope, 'TRACKED_COHORT')
  const class2023 = await one(`select tracked_players, reached_a, reached_high_a, reached_aa, reached_aaa, reached_mlb
    from v_dodgers_development_by_signing_class where signing_year = 2023`)
  assert.deepEqual([class2023.tracked_players, class2023.reached_a, class2023.reached_high_a, class2023.reached_aa, class2023.reached_aaa, class2023.reached_mlb],
    [13, 7, 1, 1, 1, 0])
  // after 022 the 2023 AA median is calculable: Eduardo Quintero signed
  // 2023-01-15 and first appeared at Double-A on 2026-09-13 (both exact)
  const medians = await one(`select median_years_signing_to_aa_exact, median_years_signing_to_mlb_exact
    from v_dodgers_development_by_signing_class where signing_year = 2023`)
  assert.deepEqual([Number(medians.median_years_signing_to_aa_exact), medians.median_years_signing_to_mlb_exact], [3.66, null])
})

test('021 organization changes: per-stint ownership in the same season, plus a SEASON-precision milestone', async () => {
  const batista = await rows(`select s.organization_name, s.level::text as level
    from player_season_stints s join players p on p.id = s.player_id
    where p.slug = 'aldrin-batista' and s.season = 2023 order by s.level_rank nulls last, s.organization_name`)
  const orgs = [...new Set(batista.map((r) => r.organization_name))]
  assert.deepEqual(orgs.sort(), ['Chicago White Sox', 'Los Angeles Dodgers'])
  const oc = await one(`select m.season_year, m.affiliate, m.date_precision::text as precision, m.milestone_date
    from development_milestones m join players p on p.id = m.player_id
    where p.slug = 'aldrin-batista' and m.event_code = 'ORGANIZATION_CHANGE'`)
  assert.deepEqual([oc.season_year, oc.affiliate, oc.precision, oc.milestone_date], [2023, 'Chicago White Sox', 'SEASON', null])
  // the queue flags the unresolved two-org season for review without asserting a trade date
  const flagged = await one(`select count(*)::int as n from v_dodgers_development_research_queue
    where player_slug = 'aldrin-batista' and issue = 'MULTI_ORG_SEASON_UNVERIFIED'`)
  assert.equal(flagged.n, 1)
})

test('021 MLB-reach counts are scope-explicit: 58 tracked = 47 Dodgers signings + 11 benchmark', async () => {
  // "MLB players" always needs its scope: all tracked (Dodgers signings + benchmark players) vs the
  // outcome-audited subset, which is Dodgers signings only by policy. bref_id is recorded only for
  // players with an MLB debut, so it must cover the same 58.
  const r = await one(`with scope as (
      select p.id, coalesce(bool_or(o.franchise_key = 'DODGERS'), false) as dodgers
      from players p
      left join signings s on s.player_id = p.id
      left join organizations o on o.id = s.organization_id
      group by p.id)
    select
      (select count(*)::int from players where mlb_debut_date is not null) as all_tracked_mlb,
      (select count(*)::int from players where bref_id is not null) as with_bref_id,
      (select count(*)::int from scope sc join players p on p.id = sc.id where sc.dodgers and p.mlb_debut_date is not null) as dodgers_mlb,
      (select count(*)::int from scope sc join players p on p.id = sc.id where not sc.dodgers and p.mlb_debut_date is not null) as benchmark_mlb,
      (select count(*)::int from outcome_audits where reached_mlb_verified) as audited_mlb`)
  assert.equal(r.with_bref_id, r.all_tracked_mlb, 'B-Ref id covers every tracked player with verified MLB reach')
  assert.deepEqual([r.all_tracked_mlb, r.dodgers_mlb, r.benchmark_mlb, r.audited_mlb], [58, 47, 11, 47])
  assert.equal(r.dodgers_mlb + r.benchmark_mlb, r.all_tracked_mlb)
  assert.equal(r.audited_mlb, r.dodgers_mlb, 'only Dodgers signings carry verified MLB outcome audits')
  // the Dodgers-scoped status view reports the same audited figure
  const status = await one(`select verified_mlb_outcomes from v_database_status`)
  assert.equal(status.verified_mlb_outcomes, 47)
})

test('021 coverage view: populations add up', async () => {
  const c = await one(`select * from v_dodgers_development_coverage`)
  assert.deepEqual([c.tracked_players, c.players_with_stints, c.players_without_stints], [268, 167, 101])
  assert.equal(c.players_with_stints + c.players_without_stints, c.tracked_players)
  assert.equal(c.players_with_mlb_history + c.non_mlb_players_with_history, c.players_with_stints)
  assert.deepEqual([c.players_with_mlb_history, c.mlb_players_missing_pre_mlb_history], [2, 0])
  assert.deepEqual([c.players_with_exact_first_aa_date, c.players_with_first_aa_season], [24, 25])
  assert.deepEqual([c.players_with_exact_first_aaa_date, c.players_with_first_aaa_season], [15, 16])
  assert.equal(c.players_with_signing_to_mlb_time, 6)
})

test('021 views are security_invoker and anon can read development data but cannot write it', async () => {
  const names = ['v_dodgers_development_by_bonus_band', 'v_dodgers_development_by_market', 'v_dodgers_development_by_signing_class',
    'v_dodgers_development_coverage', 'v_dodgers_development_research_queue', 'v_dodgers_player_development_summary',
    'v_player_development_milestones', 'v_player_development_stints']
  const views = await rows(`select relname, coalesce(reloptions::text, '') as opts from pg_class
    where relname in (${names.map((_, i) => `$${i + 1}`).join(',')}) and relkind = 'v'`, names)
  assert.equal(views.length, 8)
  for (const v of views) assert.match(v.opts, /security_invoker=(true|on)/, `${v.relname} must be security_invoker`)
  const tables = await rows(`select relname, relrowsecurity from pg_class where relname in
    ('player_season_stints', 'player_development_status', 'development_levels', 'development_level_era_map', 'development_event_codes') and relkind = 'r'`)
  assert.equal(tables.length, 5)
  for (const t of tables) assert.equal(t.relrowsecurity, true)
  await db.transaction(async (tx) => {
    await tx.query('set local role anon')
    const stints = (await tx.query('select count(*)::int as n from v_player_development_stints')).rows[0]
    assert.equal(stints.n, 828)
    const summary = (await tx.query('select count(*)::int as n from v_dodgers_player_development_summary')).rows[0]
    assert.equal(summary.n, 268)
    await assert.rejects(tx.query(
      `insert into player_season_stints (player_id, season, affiliate_team, source_level, level, level_classification, era, affiliated, as_of_date)
       select id, 2026, 'x', 'ROK', 'OTHER', 'UNKNOWN_ROOKIE_LEAGUE', 'MODERN_FOUR_LEVEL_2021_PLUS', false, '2026-10-06' from players limit 1`),
      /permission denied/,
    )
    await tx.rollback()
  })
})

// ---------------------------------------------------------------------------
// 022: exact development dates from official game logs
// ---------------------------------------------------------------------------

test('022 upgrades: 400 SEASON-precision debuts carry exact game-log dates in place, each naming the basis it replaced', async () => {
  const r = await one(`select
      count(*)::int as n,
      count(*) filter (where date_precision = 'DAY' and milestone_date is not null)::int as exact,
      count(*) filter (where date_precision = 'SEASON')::int as still_season,
      count(*) filter (where prior_evidence_basis is not null)::int as with_prior,
      count(*) filter (where prior_evidence_basis is not null and date_precision <> 'DAY')::int as prior_without_exact,
      count(*) filter (where evidence_basis <> 'GAME_LOG')::int as not_game_log
    from development_milestones
    where event_code in ('DSL_DEBUT','COMPLEX_DEBUT','A_DEBUT','HIGH_A_DEBUT','AA_DEBUT','AAA_DEBUT')`)
  assert.deepEqual([r.n, r.exact, r.still_season, r.with_prior, r.prior_without_exact, r.not_game_log], [403, 400, 3, 400, 0, 3],
    'the three non-GAME_LOG rows are exactly the pre-log-era season-precision debuts')
  // the three debuts whose first season predates the gameLog era stay
  // season-precision: Roger Cedeño's 1993 AA/AAA and 1998 High-A
  const seasonOnly = await rows(`select p.slug, m.event_code, m.season_year
    from development_milestones m join players p on p.id = m.player_id
    where m.event_code in ('HIGH_A_DEBUT','AA_DEBUT','AAA_DEBUT') and m.date_precision = 'SEASON' order by 1, 2`)
  assert.deepEqual(seasonOnly.map((s) => [s.slug, s.event_code, s.season_year]), [
    ['roger-cedeno', 'AAA_DEBUT', 1993],
    ['roger-cedeno', 'AA_DEBUT', 1993],
    ['roger-cedeno', 'HIGH_A_DEBUT', 1998],
  ])
  // spot-check a full ladder: Carlos Frias 2011 High-A → 2013 AA → 2014 AAA,
  // while his existing exact MLB debut (2014-08-04) was never overwritten
  const frias = await rows(`select m.event_code, m.milestone_date::text as d, m.evidence_basis, m.prior_evidence_basis
    from development_milestones m join players p on p.id = m.player_id
    where p.slug = 'carlos-frias' and m.event_code in ('HIGH_A_DEBUT','AA_DEBUT','AAA_DEBUT','MLB_DEBUT') order by m.milestone_date`)
  assert.deepEqual(frias, [
    { event_code: 'HIGH_A_DEBUT', d: '2011-07-08', evidence_basis: 'GAME_LOG', prior_evidence_basis: 'SEASON_SPLITS' },
    { event_code: 'AA_DEBUT', d: '2013-07-31', evidence_basis: 'GAME_LOG', prior_evidence_basis: 'SEASON_SPLITS' },
    { event_code: 'AAA_DEBUT', d: '2014-04-30', evidence_basis: 'GAME_LOG', prior_evidence_basis: 'SEASON_SPLITS' },
    { event_code: 'MLB_DEBUT', d: '2014-08-04', evidence_basis: 'MLB_PERSON_RECORD', prior_evidence_basis: null },
  ])
  // the season_year that carried the reviewed season fact survives the upgrade
  const seasons = await one(`select count(*)::int as n from development_milestones
    where prior_evidence_basis is not null and (season_year is null or extract(year from milestone_date) <> season_year)`)
  assert.equal(seasons.n, 0)
})

test('022 professional debuts: 166 exact first games; a same-day signing stays a distinct, honestly-typed fact', async () => {
  const r = await one(`select
      count(*)::int as n,
      count(*) filter (where date_precision = 'DAY' and milestone_date is not null)::int as exact,
      count(*) filter (where evidence_basis <> 'GAME_LOG')::int as not_game_log,
      count(*) filter (where milestone <> 'OTHER')::int as mistyped
    from development_milestones where event_code = 'PROFESSIONAL_DEBUT'`)
  assert.deepEqual([r.n, r.exact, r.not_game_log, r.mistyped], [166, 166, 0, 0])
  // every PROFESSIONAL_DEBUT falls in the player's first stint season (the rule
  // that separates an evidenced first game from an approximated one)
  const late = await one(`select count(*)::int as n from development_milestones m
    where m.event_code = 'PROFESSIONAL_DEBUT' and m.season_year is not null
      and m.season_year <> (select min(s.season) from player_season_stints s where s.player_id = m.player_id)`)
  assert.equal(late.n, 0)
  // Ilmerson Colon signed and first appeared on the same day: two facts, two
  // rows. The signing moves to the dedicated 'SIGNED' enum value (unused since
  // 001) so 001's unique (player_id, milestone, milestone_date) keeps both.
  const colon = await rows(`select m.event_code, m.milestone::text as type, m.milestone_date::text as d
    from development_milestones m join players p on p.id = m.player_id
    where p.slug = 'ilmerson-colon' and m.event_code in ('PROFESSIONAL_SIGNING','PROFESSIONAL_DEBUT') order by m.event_code`)
  assert.deepEqual(colon, [
    { event_code: 'PROFESSIONAL_DEBUT', type: 'OTHER', d: '2022-06-20' },
    { event_code: 'PROFESSIONAL_SIGNING', type: 'SIGNED', d: '2022-06-20' },
  ])
  const signed = await one(`select count(*)::int as n, count(*) filter (where milestone <> 'SIGNED')::int as mistyped
    from development_milestones where event_code = 'PROFESSIONAL_SIGNING'`)
  assert.deepEqual([signed.n, signed.mistyped], [154, 0])
})

test('022 stint dates: 746 stints carry verified first/last appearance dates; unknown-team and unlogged stints stay NULL', async () => {
  const r = await one(`select
      count(*)::int as n,
      count(*) filter (where first_game_date is not null or last_game_date is not null)::int as dated,
      count(*) filter (where first_game_date is not null and last_game_date is null)::int as first_without_last,
      count(*) filter (where first_game_date is not null and last_game_date < first_game_date)::int as reversed,
      count(*) filter (where first_game_date is not null and extract(year from first_game_date) <> season)::int as wrong_season,
      count(*) filter (where first_game_date is not null and game_date_basis <> 'GAME_LOG')::int as basis
    from player_season_stints`)
  assert.deepEqual([r.n, r.dated, r.first_without_last, r.reversed, r.wrong_season, r.basis], [828, 746, 0, 0, 0, 0])
  // 60 log-era stints stay undated: 56 have no team identity for the games to
  // attach to, 4 are 2018 Mexican-League stints the gameLog era never covered
  const undated = await one(`select
      count(*) filter (where season >= 2006 and first_game_date is null)::int as log_era,
      count(*) filter (where season >= 2006 and first_game_date is null and affiliate_team is null)::int as null_team,
      count(*) filter (where season >= 2006 and first_game_date is null and affiliate_team is not null
        and level = 'FOREIGN_PRO' and season = 2018)::int as mexican_2018
    from player_season_stints`)
  assert.deepEqual([undated.log_era, undated.null_team, undated.mexican_2018], [60, 56, 4])
  // every dated stint cites the gameLog endpoint it was derived from
  const uncited = await one(`select count(*)::int as n from player_season_stints s
    where s.first_game_date is not null and not exists (
      select 1 from jsonb_array_elements_text(s.source_urls) u where u like '%stats=gameLog%')`)
  assert.equal(uncited.n, 0)
  // pre-2006 stints are never dated from the log era
  const old = await one(`select count(*)::int as n from player_season_stints where season < 2006 and first_game_date is not null`)
  assert.equal(old.n, 0)
})

test('022 coverage: the date-coverage view reports exact versus season-only facts and zero unresolved conflicts', async () => {
  const c = await one('select * from v_dodgers_development_date_coverage')
  assert.deepEqual(
    [c.tracked_players, c.exact_pro_debut, c.exact_dsl_debut, c.exact_complex_debut, c.exact_first_a,
      c.exact_first_high_a, c.exact_first_aa, c.exact_first_aaa, c.exact_mlb_debut],
    [268, 166, 157, 97, 71, 36, 24, 15, 7])
  assert.deepEqual(
    [c.exact_signing_to_pro_debut, c.exact_signing_to_a, c.exact_signing_to_high_a,
      c.exact_signing_to_aa, c.exact_signing_to_aaa, c.exact_signing_to_mlb],
    [146, 61, 28, 19, 11, 6])
  assert.deepEqual(
    [c.season_only_dsl_debut, c.season_only_complex_debut, c.season_only_first_a,
      c.season_only_first_high_a, c.season_only_first_aa, c.season_only_first_aaa],
    [0, 0, 0, 1, 1, 1])
  assert.equal(c.players_with_unresolved_date_conflicts, 0)
})

test('022 queue: missing dates are review items, and no exact-date conflict exists', async () => {
  const issues = Object.fromEntries((await rows(`select issue, count(*)::int as n
    from v_dodgers_development_research_queue group by 1`)).map((r) => [r.issue, r.n]))
  assert.equal(issues.MISSING_FIRST_GAME_DATE, 46)
  assert.equal(issues.MISSING_LAST_GAME_DATE, 46)
  assert.equal(issues.SEASON_ONLY_MILESTONE, 1)
  assert.equal(issues.GAME_LOG_UNAVAILABLE ?? 0, 0, 'every stints-carrying player has at least one dated stint')
  assert.equal(issues.EXACT_DATE_CONFLICT, undefined, 'no game evidence disagreed with a stored exact date')
  const conflicts = await one(`select count(*)::int as n from research_source_conflicts where conflict_type = 'EXACT_DATE_CONFLICT'`)
  assert.equal(conflicts.n, 0)
  // the flagged player is the pre-log-era one: reached MLB before 2006
  const flagged = await rows(`select player_slug from v_dodgers_development_research_queue where issue = 'MLB_PLAYER_MISSING_PRE_MLB_EXACT_DATES'`)
  assert.deepEqual(flagged.map((r) => r.player_slug), ['roger-cedeno'])
})

test('022 views: the new coverage view is security_invoker, granted, and anon can read the extended data', async () => {
  const views = await rows(`select relname, coalesce(reloptions::text, '') as opts from pg_class
    where relname in ('v_dodgers_development_date_coverage', 'v_dodgers_player_development_summary') and relkind = 'v'`)
  assert.equal(views.length, 2)
  for (const v of views) assert.match(v.opts, /security_invoker=(true|on)/, v.relname)
  const grants = await rows(`select grantee, privilege_type from information_schema.role_table_grants
    where table_name = 'v_dodgers_development_date_coverage' and grantee in ('anon', 'authenticated') order by 1`)
  assert.deepEqual(grants.map((g) => [g.grantee, g.privilege_type]), [['anon', 'SELECT'], ['authenticated', 'SELECT']])
  await db.transaction(async (tx) => {
    await tx.query('set local role anon')
    const cov = (await tx.query('select exact_pro_debut, tracked_players from v_dodgers_development_date_coverage')).rows[0]
    assert.deepEqual([cov.exact_pro_debut, cov.tracked_players], [166, 268])
    // the extended summary columns are readable and derived only from exact dates
    const bad = (await tx.query(`select count(*)::int as n from v_dodgers_player_development_summary
      where days_signing_to_high_a_exact is not null
        and (signing_date is null or first_high_a_date is null)`)).rows[0]
    assert.equal(bad.n, 0)
    await tx.rollback()
  })
})
