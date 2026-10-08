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
      (select string_agg(stint_kind || coalesce(season_total_basis, '') || coalesce(organization_id::text, ''), ',' order by id) from player_season_stints) as stint_classes,
      (select string_agg(concat_ws('|', season::text, level::text, coalesce(affiliate_team, ''), coalesce(league_name, ''), coalesce(source_level, ''), level_classification, era::text, affiliated::text,
        coalesce(g::text, ''), coalesce(pa::text, ''), coalesce(pg::text, ''), coalesce(ip::text, ''),
        coalesce(first_game_date::text, ''), coalesce(last_game_date::text, ''), coalesce(game_date_basis, '')), ',' order by player_id, season, level, coalesce(affiliate_team, ''), coalesce(league_name, '')) from player_season_stints) as stint_values,
      (select count(*) from development_milestones where event_code is not null)::int as coded_milestones,
      (select string_agg(concat_ws('|', event_code, coalesce(milestone_date::text, ''), coalesce(season_year::text, ''), date_precision::text, coalesce(evidence_basis, ''), coalesce(prior_evidence_basis, '')), ','
        order by player_id, event_code, coalesce(milestone_date::text, '9999'), coalesce(season_year, 0)) from development_milestones where event_code is not null) as milestone_values,
      (select count(*) from player_development_status)::int as dev_status,
      (select string_agg(concat_ws('|', player_id::text, event_code, milestone_id::text, progression_role, coalesce(developmental_arrival_date::text, ''),
        coalesce(developmental_arrival_season::text, ''), review_status, confidence::text, notes, reviewed_at::text, as_of_date::text), ',' order by player_id, event_code)
        from development_progression_decisions) as progression_decisions,
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
  // 023 corrected Elio Campos's Augusta 2025 stint to the Braves, so his 2025 season is no longer
  // a false multi-organization season: 10 -> 9.
  assert.deepEqual([multi.multi_stint, multi.multi_level, multi.multi_org], [173, 140, 9])
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
    // 023 excludes season-total rows: Edgar Leon's cross-level 2026 rookie total no longer reads as
    // unaffiliated play (A_BALL 29 -> 30, OUT_OF_AFFILIATED_BASEBALL 2 -> 1). 024 makes status the
    // highest unambiguously established developmental level: five reviewed AAA cameos move and pending
    // milestones do not count as reached (AAA 14 -> 7, AA 12 -> 14, A_BALL 30 -> 33, ROOKIE_LEVEL 92 -> 94).
    ROOKIE_LEVEL: 94, MLB: 47, A_BALL: 33, HIGH_A: 16, AAA: 7, AA: 14, OUT_OF_AFFILIATED_BASEBALL: 1,
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
  assert.deepEqual(ooa.map((r) => r.slug), ['lenix-osuna'])
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
    // 022 reported 146/61/28/19/11/6 from first appearances; 024 measures to developmental arrival
    [146, 58, 26, 17, 4, 6])
  assert.deepEqual(
    [c.season_only_dsl_debut, c.season_only_complex_debut, c.season_only_first_a,
      c.season_only_first_high_a, c.season_only_first_aa, c.season_only_first_aaa],
    [0, 0, 0, 1, 1, 1])
  assert.equal(c.players_with_unresolved_date_conflicts, 0)
})

test('022 queue: missing dates are review items, and no exact-date conflict exists', async () => {
  const issues = Object.fromEntries((await rows(`select issue, count(*)::int as n
    from v_dodgers_development_research_queue group by 1`)).map((r) => [r.issue, r.n]))
  // 022 reported 46 players for each; 44 of those flags came from season-total rows that repeat
  // their component team stints. 023 keeps the two genuine 2018 Mexican League source gaps.
  assert.equal(issues.MISSING_FIRST_GAME_DATE, 2)
  assert.equal(issues.MISSING_LAST_GAME_DATE, 2)
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

// ---------------------------------------------------------------------------
// 023 — development stint integrity
// ---------------------------------------------------------------------------

const stintOf = (slug, season, where = '') => rows(`select s.stint_kind, s.season_total_basis, s.level::text as level,
    s.affiliate_team, coalesce(s.g, s.pg) as games, s.organization_name
  from player_season_stints s join players p on p.id = s.player_id
  where p.slug = $1 and s.season = $2 ${where} order by s.affiliate_team nulls first, s.level::text`, [slug, season])

test('023 classification: 56 season totals (34 same-level, 21 cross-level, 1 sub-season); all 828 raw rows retained; 772 team stints; 0 unresolved', async () => {
  const k = Object.fromEntries((await rows(`select stint_kind, coalesce(season_total_basis, '-') as basis, count(*)::int as n
    from player_season_stints group by 1, 2`)).map((r) => [`${r.stint_kind}/${r.basis}`, r.n]))
  assert.deepEqual(k, {
    'TEAM_STINT/-': 772, 'SEASON_TOTAL/SAME_LEVEL': 34, 'SEASON_TOTAL/CROSS_LEVEL': 21, 'SEASON_TOTAL/SUB_SEASON': 1,
  })
  const raw = await one('select count(*)::int as n, count(distinct player_id)::int as players from player_season_stints')
  assert.deepEqual([raw.n, raw.players], [828, 167])
  // every season total is team-less and every team stint has a team: nothing in between
  const bad = await one(`select count(*)::int as n from player_season_stints
    where (stint_kind = 'SEASON_TOTAL') <> (affiliate_team is null and team_id is null)
       or (stint_kind = 'TEAM_STINT' and (affiliate_team is null or team_id is null))`)
  assert.equal(bad.n, 0)
  // no stint was duplicated by the tagging
  const dup = await one(`select count(*)::int as n from (select player_id, season, level, coalesce(affiliate_team, ''), coalesce(league_name, '')
    from player_season_stints group by 1, 2, 3, 4, 5 having count(*) > 1) x`)
  assert.equal(dup.n, 0)
})

test('023 schema: the two columns are tied together by CHECK constraints', async () => {
  const attempt = async (sql) => {
    await db.exec('begin;')
    try { await db.exec(sql); return 'accepted' } catch (e) { return String(e.message) } finally { await db.exec('rollback;') }
  }
  const team = `(select id from player_season_stints where stint_kind = 'TEAM_STINT' limit 1)`
  assert.match(await attempt(`update player_season_stints set stint_kind = 'BOGUS' where id = ${team}`), /stint_kind_check/)
  assert.match(await attempt(`update player_season_stints set stint_kind = 'SEASON_TOTAL' where id = ${team}`), /season_total_basis_check/,
    'a season total must state its basis')
  assert.match(await attempt(`update player_season_stints set season_total_basis = 'SAME_LEVEL' where id = ${team}`), /season_total_basis_check/,
    'a team stint cannot carry a basis')
  assert.match(await attempt(`update player_season_stints set stint_kind = 'SEASON_TOTAL', season_total_basis = 'BOGUS' where id = ${team}`), /season_total_basis_check/)
  assert.equal(await attempt(`update player_season_stints set stint_kind = 'UNRESOLVED' where id = ${team}`), 'accepted')
})

test('023 season totals stay as evidence beside their components; same-level, cross-level and sub-season are each recognised', async () => {
  // Jeral Perez 2024: a same-level total over two Low-A teams
  const perez = await stintOf('jeral-perez', 2024)
  assert.deepEqual(perez.map((r) => [r.stint_kind, r.season_total_basis, r.affiliate_team, r.games]), [
    ['SEASON_TOTAL', 'SAME_LEVEL', null, 105],
    ['TEAM_STINT', null, 'Kannapolis Cannon Ballers', 30],
    ['TEAM_STINT', null, 'Rancho Cucamonga Quakes', 75],
  ])
  // Edgar Leon 2026: a cross-level rookie total over ACL + two DSL Tigers squads
  const leon = await stintOf('edgar-leon', 2026)
  assert.deepEqual(leon.map((r) => [r.stint_kind, r.season_total_basis, r.games]),
    [['SEASON_TOTAL', 'CROSS_LEVEL', 9], ['TEAM_STINT', null, 4], ['TEAM_STINT', null, 2], ['TEAM_STINT', null, 3]]) // ACL Dodgers, DSL Tigers 1, DSL Tigers 2
  assert.equal(leon[0].level, 'OTHER', 'the total keeps the unclassified rookie label it was ingested with')
  // Lenix Osuna 2018: a sub-season total of Diablos Rojos (2) + Oaxaca (5); Durango (21) is a separate split
  const osuna = await stintOf('lenix-osuna', 2018)
  assert.deepEqual(osuna.map((r) => [r.stint_kind, r.season_total_basis, r.affiliate_team, r.games]), [
    ['SEASON_TOTAL', 'SUB_SEASON', null, 7],
    ['TEAM_STINT', null, 'Diablos Rojos del Mexico', 2],
    ['TEAM_STINT', null, 'Generales de Durango', 21],
    ['TEAM_STINT', null, 'Guerreros de Oaxaca', 5],
  ])
  // the dossier view still lists the total, labelled by the two appended columns
  const view = await rows(`select stint_kind, season_total_basis, g from v_player_development_stints
    where player_slug = 'jeral-perez' and season = 2024 and affiliate_team is null`)
  assert.deepEqual(view.map((r) => [r.stint_kind, r.season_total_basis, r.g]), [['SEASON_TOTAL', 'SAME_LEVEL', 105]])
})

test('023 regressions: Brito 2016, Cruz 2022 and Linan 2025 totals equal their components', async () => {
  /** @type {Array<[string, number, number, number[]]>} */
  const cases = [
    ['ronny-brito', 2016, 59, [25, 34]],
    ['nicolas-cruz', 2022, 15, [1, 14]],
    ['sean-linan', 2025, 11, [1, 10]],
  ]
  for (const [slug, season, total, parts] of cases) {
    const r = await rows(`select t.season_total_basis, coalesce(t.g, t.pg) as games,
        (select array_agg(coalesce(c.g, c.pg) order by coalesce(c.g, c.pg)) from player_season_stints c
          where c.player_id = t.player_id and c.season = t.season and c.source_level = t.source_level and c.stint_kind = 'TEAM_STINT') as parts
      from player_season_stints t join players p on p.id = t.player_id
      where p.slug = $1 and t.season = $2 and t.stint_kind = 'SEASON_TOTAL'`, [slug, season])
    assert.equal(r.length, 1, `${slug} ${season}`)
    assert.equal(r[0].season_total_basis, 'SAME_LEVEL', `${slug} ${season}`)
    assert.equal(r[0].games, total, `${slug} ${season}`)
    assert.deepEqual(r[0].parts, parts.slice().sort((x, y) => x - y), `${slug} ${season} components`)
  }
})

test('023 additive analytics: summing TEAM_STINT rows no longer double-counts', async () => {
  const t = await one(`select
      coalesce(sum(g) filter (where stint_kind = 'TEAM_STINT'), 0)::int as g, coalesce(sum(pg) filter (where stint_kind = 'TEAM_STINT'), 0)::int as pg,
      coalesce(sum(pa) filter (where stint_kind = 'TEAM_STINT'), 0)::int as pa, coalesce(sum(ab) filter (where stint_kind = 'TEAM_STINT'), 0)::int as ab,
      coalesce(sum(h) filter (where stint_kind = 'TEAM_STINT'), 0)::int as h, coalesce(sum(bf) filter (where stint_kind = 'TEAM_STINT'), 0)::int as bf,
      round(coalesce(sum(ip) filter (where stint_kind = 'TEAM_STINT'), 0), 1)::text as ip,
      coalesce(sum(coalesce(g, pg)) filter (where stint_kind = 'SEASON_TOTAL'), 0)::int as double_counted,
      sum(g)::int as naive_g, sum(pg)::int as naive_pg, sum(pa)::int as naive_pa, sum(ab)::int as naive_ab,
      sum(h)::int as naive_h, sum(bf)::int as naive_bf, round(sum(ip), 1)::text as naive_ip
    from player_season_stints`)
  assert.deepEqual([t.g, t.pg, t.pa, t.ab, t.h, t.bf, t.ip], [16573, 4430, 64651, 55098, 13902, 39150, '8592.3'])
  assert.deepEqual([t.naive_g, t.naive_pg, t.naive_pa, t.naive_ab, t.naive_h, t.naive_bf, t.naive_ip],
    [17997, 4792, 70329, 59907, 15183, 42026, '9206.3'], 'the raw rows still hold the pre-023 totals')
  assert.equal(t.double_counted, 1786)
  // for every total, its components sum to exactly its own line (it is the aggregate, not an extra appearance)
  const bad = await one(`select count(*)::int as n from player_season_stints t
    join lateral (select sum(c.g) g, sum(c.pg) pg from player_season_stints c
      where c.player_id = t.player_id and c.season = t.season and c.source_level = t.source_level and c.stint_kind = 'TEAM_STINT') comp on true
    where t.stint_kind = 'SEASON_TOTAL' and t.season_total_basis <> 'SUB_SEASON'
      and (coalesce(t.g, 0) <> coalesce(comp.g, 0) or coalesce(t.pg, 0) <> coalesce(comp.pg, 0))`)
  assert.equal(bad.n, 0)
})

test('023 date coverage: season totals are not missing dates; the four remaining undated team stints are 2018 Mexican League source gaps', async () => {
  const u = await rows(`select p.slug, s.affiliate_team, s.level::text as level, s.season, s.affiliated
    from player_season_stints s join players p on p.id = s.player_id
    where s.season >= 2006 and s.first_game_date is null and s.stint_kind = 'TEAM_STINT' order by 1, 2`)
  assert.deepEqual(u.map((r) => [r.slug, r.affiliate_team]), [
    ['carlos-frias', 'Leones de Yucatan'], ['lenix-osuna', 'Diablos Rojos del Mexico'],
    ['lenix-osuna', 'Generales de Durango'], ['lenix-osuna', 'Guerreros de Oaxaca'],
  ])
  assert.ok(u.every((r) => r.level === 'FOREIGN_PRO' && r.season === 2018 && r.affiliated === false))
  const raw = await one(`select count(*) filter (where season >= 2006 and first_game_date is null)::int as n,
    count(*) filter (where first_game_date is not null)::int as dated from player_season_stints`)
  assert.deepEqual([raw.n, raw.dated], [60, 746], 'raw rows are untouched: 56 totals + 4 team stints, 746 dated')
})

test('023 research queue: totals raise no false flags; FOREIGN_PRO is organization-exempt; counts after the correction', async () => {
  const issues = Object.fromEntries((await rows(`select issue, count(*)::int as n from v_dodgers_development_research_queue group by 1`)).map((r) => [r.issue, r.n]))
  assert.deepEqual(issues, {
    IDENTITY_BUT_NO_PROFESSIONAL_SEASONS: 53, MISSING_FIRST_GAME_DATE: 2, MISSING_LAST_GAME_DATE: 2,
    MLB_PLAYER_MISSING_PRE_MLB_EXACT_DATES: 1, MLB_PLAYER_MISSING_PRE_MLB_HISTORY: 5, MULTI_ORG_SEASON_UNVERIFIED: 9,
    SEASON_GAP: 15, SEASON_ONLY_MILESTONE: 1, UNKNOWN_LEVEL_CLASSIFICATION: 11, UNRESOLVED_ORGANIZATION: 1,
    LEVEL_SKIP_CAMEO_CANDIDATE: 4, // added by 024 (heuristic candidates; 023 alone left 100 flags)
  })
  assert.equal(Object.values(issues).reduce((a, b) => a + b, 0), 104)
  const who = async (issue) => (await rows(`select player_slug from v_dodgers_development_research_queue where issue = $1 order by 1`, [issue])).map((r) => r.player_slug)
  assert.deepEqual(await who('MISSING_FIRST_GAME_DATE'), ['carlos-frias', 'lenix-osuna'])
  assert.deepEqual(await who('MISSING_LAST_GAME_DATE'), ['carlos-frias', 'lenix-osuna'])
  // Frias's Columbus Clippers 2017 (no Cleveland mapping) is the one genuinely unresolved organization
  assert.deepEqual(await who('UNRESOLVED_ORGANIZATION'), ['carlos-frias'])
  const col = await one(`select organization_id is null as unresolved, level::text as level from player_season_stints s join players p on p.id = s.player_id
    where p.slug = 'carlos-frias' and s.affiliate_team = 'Columbus Clippers'`)
  assert.deepEqual([col.unresolved, col.level], [true, 'AAA'])
  // foreign clubs are organization-unmapped by design and are never flagged for it
  const foreign = await one(`select count(*)::int as n from player_season_stints where level = 'FOREIGN_PRO' and organization_id is null and stint_kind = 'TEAM_STINT'`)
  assert.ok(foreign.n >= 5)
  assert.ok(!(await who('UNRESOLVED_ORGANIZATION')).includes('lenix-osuna'))
  // a player whose only gap was a season total is no longer flagged
  for (const slug of ['jeral-perez', 'ronny-brito', 'nicolas-cruz', 'sean-linan', 'edgar-leon']) {
    for (const issue of ['MISSING_FIRST_GAME_DATE', 'MISSING_LAST_GAME_DATE', 'UNRESOLVED_ORGANIZATION', 'UNKNOWN_LEVEL_GAME_LOG']) {
      assert.ok(!(await who(issue)).includes(slug), `${slug} must not carry ${issue}`)
    }
  }
})

test('023 SEASON_GAP: scoped per player over distinct team-stint seasons - 15 genuine gaps, never the old 144', async () => {
  const flagged = (await rows(`select player_slug from v_dodgers_development_research_queue where issue = 'SEASON_GAP' order by 1`)).map((r) => r.player_slug)
  // an independent oracle: per player, the span of team-stint seasons exceeds the number of distinct seasons
  const oracle = (await rows(`with t as (
      select player_id, count(distinct season) as n, max(season) - min(season) + 1 as span
      from player_season_stints where stint_kind = 'TEAM_STINT' group by 1)
    select p.slug from t join players p on p.id = t.player_id
    where t.n >= 2 and t.span > t.n
      and p.id in (select sg.player_id from signings sg join organizations o on o.id = sg.organization_id where o.franchise_key = 'DODGERS')
    order by 1`)).map((r) => r.slug)
  assert.deepEqual(flagged, oracle)
  assert.equal(flagged.length, 15)
  assert.notEqual(flagged.length, 144, 'the unscoped 021 check flagged the table-wide span for every multi-stint player')
  // a player with consecutive seasons is not flagged (Cedeno's 1992-2005 run has no gap)
  assert.ok(!flagged.includes('roger-cedeno'))
  // a gap-free multi-season player: Edgar Leon 2022-2026 has no missing year
  assert.ok(!flagged.includes('edgar-leon'))
})

test('023 status: season totals no longer look like unaffiliated play (Edgar Leon), and nothing else moved', async () => {
  const leon = await one(`select d.status::text as status, d.status_season from player_development_status d join players p on p.id = d.player_id where p.slug = 'edgar-leon'`)
  assert.deepEqual([leon.status, leon.status_season], ['A_BALL', 2025])
  const ooa = await rows(`select p.slug from player_development_status d join players p on p.id = d.player_id where d.status = 'OUT_OF_AFFILIATED_BASEBALL'`)
  assert.deepEqual(ooa.map((r) => r.slug), ['lenix-osuna'], 'Osuna genuinely played only Mexican League ball after High-A')
  // 024 then makes status developmental: a reviewed one-game AAA cameo no longer counts (see the 024 tests)
  const cameo = await one(`select d.status::text as status from player_development_status d join players p on p.id = d.player_id where p.slug = 'eduardo-guerrero'`)
  assert.equal(cameo.status, 'AA')
})

test('023 organizations: Augusta 2021+ is the Braves, Vancouver 2011+ the Blue Jays; raw affiliate names and legitimate stints are untouched', async () => {
  const stints = await rows(`select p.slug, s.season, s.affiliate_team, s.organization_name, s.organization_id is not null as resolved
    from player_season_stints s join players p on p.id = s.player_id
    where s.affiliate_team in ('Augusta GreenJackets', 'Vancouver Canadians') order by 3, 2, 1`)
  assert.deepEqual(stints.map((r) => [r.slug, r.season, r.affiliate_team, r.organization_name, r.resolved]), [
    ['elio-campos', 2025, 'Augusta GreenJackets', 'Atlanta Braves', true],
    ['ronny-brito', 2019, 'Vancouver Canadians', 'Toronto Blue Jays', true],
    ['ronny-brito', 2021, 'Vancouver Canadians', 'Toronto Blue Jays', true],
    ['alex-de-jesus', 2022, 'Vancouver Canadians', 'Toronto Blue Jays', true],
    ['alex-de-jesus', 2023, 'Vancouver Canadians', 'Toronto Blue Jays', true],
  ])
  const ids = await one(`select count(distinct s.organization_id)::int as n from player_season_stints s join organizations o on o.id = s.organization_id
    where (s.affiliate_team = 'Augusta GreenJackets' and o.name = 'Atlanta Braves') or (s.affiliate_team = 'Vancouver Canadians' and o.name = 'Toronto Blue Jays')`)
  assert.equal(ids.n, 2)
})

test('023 organization effects: Campos loses the false multi-org season, Brito the unresolved one; real organization changes are untouched', async () => {
  const counts = await rows(`select player_slug, organization_count from v_dodgers_player_development_summary
    where player_slug in ('elio-campos', 'ronny-brito') order by 1`)
  assert.deepEqual(counts.map((r) => [r.player_slug, r.organization_count]), [['elio-campos', 2], ['ronny-brito', 2]])
  const flags = await rows(`select player_slug, issue from v_dodgers_development_research_queue
    where player_slug in ('elio-campos', 'ronny-brito') and issue in ('MULTI_ORG_SEASON_UNVERIFIED', 'UNRESOLVED_ORGANIZATION')`)
  assert.deepEqual(flags, [])
  const changes = await rows(`select p.slug, m.season_year, m.notes from development_milestones m join players p on p.id = m.player_id
    where m.event_code = 'ORGANIZATION_CHANGE' and p.slug in ('elio-campos', 'ronny-brito') order by 1`)
  assert.deepEqual(changes.map((r) => [r.slug, r.season_year]), [['elio-campos', 2024], ['ronny-brito', 2019]])
  assert.match(changes[0].notes, /Los Angeles Dodgers to Atlanta Braves/)
  assert.match(changes[1].notes, /Los Angeles Dodgers to Toronto Blue Jays/)
  const n = await one(`select count(*)::int as n, count(*) filter (where event_code is not null)::int as coded from development_milestones where event_code = 'ORGANIZATION_CHANGE'`)
  assert.equal(n.n, 18)
  // genuine multi-organization seasons (trades) are still queued
  const multi = (await rows(`select player_slug from v_dodgers_development_research_queue where issue = 'MULTI_ORG_SEASON_UNVERIFIED' order by 1`)).map((r) => r.player_slug)
  assert.deepEqual(multi, ['aldrin-batista', 'alex-de-jesus', 'carlos-rincon', 'diego-cartaya', 'edgar-leon', 'hendrik-clementina', 'jeral-perez', 'sean-linan', 'thayron-liranzo'])
})

test('023 leaves milestones, the 019 Mexican League rule and the first-appearance layer exactly as 022 left them', async () => {
  const m = await one(`select count(*) filter (where event_code is not null)::int as coded,
    count(*) filter (where event_code = 'PROFESSIONAL_DEBUT')::int as pro, count(*) filter (where event_code = 'MLB_DEBUT')::int as mlb,
    count(*) filter (where date_precision = 'SEASON' and milestone_date is not null)::int as season_with_date from development_milestones`)
  assert.deepEqual([m.coded, m.pro, m.mlb, m.season_with_date], [832, 166, 7, 0])
  const mex = await one(`select count(*)::int as n, count(*) filter (where level <> 'FOREIGN_PRO' or affiliated)::int as violations,
    count(*) filter (where stint_kind = 'SEASON_TOTAL')::int as totals from player_season_stints where league_name = 'Mexican League'`)
  assert.equal(mex.violations, 0)
  assert.equal(mex.totals, 1, 'only Osuna 2018 is a Mexican League season total, and it is still FOREIGN_PRO')
  const cov = await one('select * from v_dodgers_development_date_coverage')
  assert.deepEqual([cov.exact_signing_to_pro_debut, cov.exact_signing_to_a, cov.exact_signing_to_aaa], [146, 58, 4],
    'unchanged by 023; 024 measures elapsed time to developmental arrival')
})

test('023 views: the stints view appends the two columns; every development view stays security_invoker with SELECT-only grants', async () => {
  const cols = (await rows(`select column_name from information_schema.columns where table_name = 'v_player_development_stints' order by ordinal_position`)).map((r) => r.column_name)
  assert.deepEqual(cols.slice(-3), ['as_of_date', 'stint_kind', 'season_total_basis'])
  const views = ['v_dodgers_player_development_summary', 'v_player_development_stints', 'v_player_development_milestones',
    'v_dodgers_development_by_signing_class', 'v_dodgers_development_by_market', 'v_dodgers_development_by_bonus_band',
    'v_dodgers_development_research_queue', 'v_dodgers_development_coverage', 'v_dodgers_development_date_coverage']
  const opts = await rows(`select relname, coalesce(reloptions::text, '') as opts from pg_class where relname = any($1) and relkind = 'v'`, [views])
  assert.equal(opts.length, views.length)
  for (const v of opts) assert.match(v.opts, /security_invoker=(true|on)/, v.relname)
  const objects = [...views, 'player_season_stints', 'player_development_status', 'development_levels', 'development_level_era_map', 'development_event_codes']
  const grants = await rows(`select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
    from information_schema.role_table_grants where grantee in ('anon', 'authenticated') and table_name = any($1) group by 1, 2`, [objects])
  assert.equal(grants.length, objects.length * 2)
  assert.ok(grants.every((g) => g.privs === 'SELECT'), JSON.stringify(grants.filter((g) => g.privs !== 'SELECT')))
  const rls = await rows(`select relname from pg_class where relname in ('player_season_stints', 'player_development_status') and relrowsecurity`)
  assert.equal(rls.length, 2)
  await db.transaction(async (tx) => {
    await tx.query('set local role anon')
    const read = (await tx.query(`select count(*) filter (where stint_kind = 'SEASON_TOTAL')::int as totals from v_player_development_stints`)).rows[0]
    assert.equal(read.totals, 56)
    await assert.rejects(() => tx.query(`update player_season_stints set stint_kind = 'TEAM_STINT'`), /permission denied/)
    await tx.rollback()
  })
})

test('023 migration guard: a broken aggregate raises and rolls back everything; the repaired state reruns cleanly', async () => {
  const latest = readSql('023_development_stint_integrity.sql')
  const target = `(select t.id from player_season_stints t join players p on p.id = t.player_id where p.slug = 'jeral-perez' and t.season = 2024 and t.stint_kind = 'SEASON_TOTAL')`
  // damage the arithmetic of one total and revert one corrected organization
  await db.exec(`update player_season_stints set g = g + 1 where id = ${target};
    update player_season_stints set organization_name = 'San Francisco Giants',
      organization_id = (select id from organizations where name = 'San Francisco Giants') where affiliate_team = 'Augusta GreenJackets'`)
  try {
    await assert.rejects(async () => { await db.exec(latest) }, /season total does not equal the sum of its components: jeral-perez 2024/)
    await db.exec('rollback;').catch(() => {})
    // the failed run changed nothing: Augusta is still the (reverted) Giants
    const aug = await one(`select organization_name from player_season_stints where affiliate_team = 'Augusta GreenJackets'`)
    assert.equal(aug.organization_name, 'San Francisco Giants')
  } finally {
    // repair both tampered facts directly: 023 cannot be replayed over the wider views of a later
    // migration (the latest migration's rerun is covered by its own test)
    await db.exec(`update player_season_stints set g = g - 1 where id = ${target};
      update player_season_stints set organization_name = 'Atlanta Braves',
        organization_id = (select id from organizations where name = 'Atlanta Braves') where affiliate_team = 'Augusta GreenJackets'`)
  }
  const fixed = await one(`select organization_name from player_season_stints where affiliate_team = 'Augusta GreenJackets'`)
  assert.equal(fixed.organization_name, 'Atlanta Braves')
  const k = await one(`select count(*) filter (where stint_kind = 'SEASON_TOTAL')::int as totals from player_season_stints`)
  assert.equal(k.totals, 56)
})

// ---------------------------------------------------------------------------
// 024 — development progression decisions
// ---------------------------------------------------------------------------

const progressionOf = (slug) => rows(`select event_code, first_appearance_date::text as first_date, first_appearance_season as first_season,
    first_appearance_precision as first_precision, progression_role, review_status,
    developmental_arrival_date::text as dev_date, developmental_arrival_season as dev_season,
    developmental_arrival_precision as dev_precision, development_state as state
  from v_player_development_progression where player_slug = $1 order by progression_rank`, [slug])
const byEvent = (list) => Object.fromEntries(list.map((r) => [r.event_code, r]))
const summaryOf = (slug) => one(`select * from v_dodgers_player_development_summary where player_slug = $1`, [slug])

test('024 decisions: 20 rows (11 reviewed, 9 pending), one per player and event, each tied to its own first-appearance milestone', async () => {
  const d = await rows(`select p.slug, d.event_code, d.progression_role, d.review_status, d.confidence::text as confidence,
      d.developmental_arrival_date::text as arrival, d.developmental_arrival_precision::text as precision, d.developmental_arrival_season as season
    from development_progression_decisions d join players p on p.id = d.player_id
    order by 1, array_position(array['DSL_DEBUT', 'COMPLEX_DEBUT', 'A_DEBUT', 'HIGH_A_DEBUT', 'AA_DEBUT', 'AAA_DEBUT', 'MLB_DEBUT'], d.event_code)`)
  assert.deepEqual(d.map((r) => [r.slug, r.event_code, r.progression_role, r.arrival]), [
    ['carlos-avila', 'A_DEBUT', 'REVIEW_REQUIRED', null],
    ['carlos-avila', 'AA_DEBUT', 'REVIEW_REQUIRED', null],
    ['carlos-avila', 'AAA_DEBUT', 'REVIEW_REQUIRED', null],
    ['carlos-frias', 'A_DEBUT', 'REVIEW_REQUIRED', null],
    ['carlos-frias', 'HIGH_A_DEBUT', 'REVIEW_REQUIRED', null],
    ['christian-romero', 'AA_DEBUT', 'REVIEW_REQUIRED', null],
    ['christian-romero', 'AAA_DEBUT', 'REVIEW_REQUIRED', null],
    ['eduardo-guerrero', 'AAA_DEBUT', 'EARLY_CAMEO', null],
    ['eduardo-rojas', 'AAA_DEBUT', 'EARLY_CAMEO', null],
    ['elio-campos', 'COMPLEX_DEBUT', 'POST_ESTABLISHMENT_APPEARANCE', null],
    ['elio-campos', 'AAA_DEBUT', 'EARLY_CAMEO', null],
    ['javier-herrera', 'AAA_DEBUT', 'EARLY_CAMEO', null],
    ['jeral-perez', 'A_DEBUT', 'EARLY_CAMEO', '2024-04-05'],
    ['mairoshendrick-martinus', 'HIGH_A_DEBUT', 'EARLY_CAMEO', '2026-08-02'],
    ['nicolas-cruz', 'A_DEBUT', 'REVIEW_REQUIRED', null],
    ['nicolas-cruz', 'HIGH_A_DEBUT', 'REVIEW_REQUIRED', null],
    ['omar-estevez', 'COMPLEX_DEBUT', 'POST_ESTABLISHMENT_APPEARANCE', null],
    ['roger-cedeno', 'HIGH_A_DEBUT', 'POST_ESTABLISHMENT_APPEARANCE', null],
    ['ronny-brito', 'HIGH_A_DEBUT', 'EARLY_CAMEO', '2021-05-04'],
    ['sean-linan', 'AAA_DEBUT', 'EARLY_CAMEO', null],
  ])
  assert.equal(d.filter((r) => r.review_status === 'REVIEWED').length, 11)
  assert.equal(d.filter((r) => r.review_status === 'PENDING_REVIEW').length, 9)
  assert.ok(d.filter((r) => r.review_status === 'PENDING_REVIEW').every((r) => r.progression_role === 'REVIEW_REQUIRED' && r.confidence === 'LOW'))
  assert.ok(d.filter((r) => r.arrival).every((r) => r.precision === 'DAY' && Number(r.arrival.slice(0, 4)) === r.season))
  const fk = await one(`select count(*)::int as n from development_progression_decisions d
    join development_milestones m on m.id = d.milestone_id and m.player_id = d.player_id and m.event_code = d.event_code`)
  assert.equal(fk.n, 20, 'every decision references the milestone of its own player and event')
})

test('024 constraints: unique (player, event), the composite milestone key, and the role/arrival/review rules are enforced', async () => {
  const attempt = async (sql) => {
    await db.exec('begin;')
    try { await db.exec(sql); return 'accepted' } catch (e) { return String(e.message) } finally { await db.exec('rollback;') }
  }
  const cameo = `(select d.id from development_progression_decisions d join players p on p.id = d.player_id where p.slug = 'eduardo-guerrero')`
  assert.match(await attempt(`insert into development_progression_decisions (player_id, event_code, milestone_id, progression_role, decision_basis, review_status, confidence, notes, reviewed_at, as_of_date)
    select player_id, event_code, milestone_id, 'DEVELOPMENTAL_ARRIVAL', decision_basis, 'REVIEWED', confidence, 'dup', now(), current_date
    from development_progression_decisions where id = ${cameo}`), /player_event_key|duplicate key/)
  // a milestone of a different player cannot be borrowed
  assert.match(await attempt(`update development_progression_decisions set milestone_id =
    (select m.id from development_milestones m join players p on p.id = m.player_id where p.slug = 'sean-linan' and m.event_code = 'AAA_DEBUT')
    where id = ${cameo}`), /milestone_fkey|foreign key/)
  assert.match(await attempt(`update development_progression_decisions set developmental_arrival_date = date '2026-01-01',
    developmental_arrival_precision = 'DAY', developmental_arrival_season = 2026, progression_role = 'POST_ESTABLISHMENT_APPEARANCE' where id = ${cameo}`), /arrival_check/)
  assert.match(await attempt(`update development_progression_decisions set developmental_arrival_date = date '2026-01-01',
    developmental_arrival_precision = 'DAY', developmental_arrival_season = 2025 where id = ${cameo}`), /arrival_check/, 'a DAY arrival carries its own season')
  assert.match(await attempt(`update development_progression_decisions set developmental_arrival_precision = 'DAY' where id = ${cameo}`), /arrival_check/)
  assert.match(await attempt(`update development_progression_decisions set progression_role = 'REVIEW_REQUIRED' where id = ${cameo}`), /review_check/,
    'REVIEW_REQUIRED is always pending')
  assert.match(await attempt(`update development_progression_decisions set progression_role = 'SKIPPED_LEVEL' where id = ${cameo}`), /role_check/,
    'skipped is derived, never stored')
  assert.equal(await attempt(`update development_progression_decisions set developmental_arrival_precision = 'SEASON', developmental_arrival_season = 2027 where id = ${cameo}`), 'accepted')
})

test('024 preserves raw history: 828 stints, 832 milestones, every first-appearance fact and every 023 classification', async () => {
  const t = await one(`select (select count(*) from player_season_stints)::int as stints,
    (select count(*) filter (where stint_kind = 'TEAM_STINT') from player_season_stints)::int as team,
    (select count(*) filter (where stint_kind = 'SEASON_TOTAL') from player_season_stints)::int as totals,
    (select count(*) from development_milestones where event_code is not null)::int as milestones,
    (select count(*) from development_milestones where event_code = 'ORGANIZATION_CHANGE')::int as org_changes`)
  assert.deepEqual([t.stints, t.team, t.totals, t.milestones, t.org_changes], [828, 772, 56, 832, 18])
  // the progression view's first appearance IS the milestone, untouched
  const drift = await one(`select count(*)::int as n from v_player_development_progression pr
    join development_milestones m on m.id = pr.milestone_id
    where pr.first_appearance_date is distinct from m.milestone_date
       or pr.first_appearance_season is distinct from coalesce(m.season_year, extract(year from m.milestone_date)::int)`)
  assert.equal(drift.n, 0)
  // first_* summary columns are literal first appearances
  const g = await summaryOf('eduardo-guerrero')
  assert.equal(g.first_aaa_date.toISOString().slice(0, 10), '2024-08-03', 'the one-game AAA cameo stays the first AAA appearance')
  const m = await summaryOf('mairoshendrick-martinus')
  assert.equal(m.first_high_a_date.toISOString().slice(0, 10), '2025-04-20')
  assert.equal(m.age_at_first_high_a_exact, (await one(`select public.disi_age_years(p.birth_date, date '2025-04-20') as a from players p where slug = 'mairoshendrick-martinus'`)).a,
    'age_at_first_* still measures the first appearance')
})

test('024 Cedeno: the 1998 High-A stint and first-appearance fact stay; development skips High-A; AA/AAA stay 1993 SEASON with no inferred order', async () => {
  const stint = await rows(`select s.affiliate_team, coalesce(s.g, s.pg) as games from player_season_stints s join players p on p.id = s.player_id
    where p.slug = 'roger-cedeno' and s.season = 1998 and s.level = 'HIGH_A'`)
  assert.deepEqual(stint.map((r) => [r.affiliate_team, r.games]), [['Vero Beach Dodgers', 6]])
  const pr = byEvent(await progressionOf('roger-cedeno'))
  assert.deepEqual([pr.HIGH_A_DEBUT.first_season, pr.HIGH_A_DEBUT.first_precision, pr.HIGH_A_DEBUT.progression_role, pr.HIGH_A_DEBUT.dev_season, pr.HIGH_A_DEBUT.state],
    [1998, 'SEASON', 'POST_ESTABLISHMENT_APPEARANCE', null, 'SKIPPED'])
  assert.deepEqual([pr.AA_DEBUT.dev_date, pr.AA_DEBUT.dev_season, pr.AA_DEBUT.dev_precision, pr.AA_DEBUT.state], [null, 1993, 'SEASON', 'REACHED'])
  assert.deepEqual([pr.AAA_DEBUT.dev_date, pr.AAA_DEBUT.dev_season, pr.AAA_DEBUT.dev_precision, pr.AAA_DEBUT.state], [null, 1993, 'SEASON', 'REACHED'])
  assert.deepEqual([pr.MLB_DEBUT.dev_date, pr.MLB_DEBUT.dev_precision, pr.MLB_DEBUT.state], ['1995-06-20', 'DAY', 'REACHED'])
  assert.equal(pr.A_DEBUT.state, 'SKIPPED', 'a level never played with a higher arrival is derived as skipped')
  const s = await summaryOf('roger-cedeno')
  assert.deepEqual([s.first_high_a_season, s.dev_high_a_season, s.dev_high_a_state, s.dev_high_a_role], [1998, null, 'SKIPPED', 'POST_ESTABLISHMENT_APPEARANCE'])
  assert.equal(s.days_aa_to_aaa_exact, null, 'two SEASON-precision arrivals never yield an exact interval or an order')
})

test('024 Guerrero: the AAA cameo is kept but not reached; A -> High-A -> AA stands; status AA; no backward sequence', async () => {
  const pr = byEvent(await progressionOf('eduardo-guerrero'))
  assert.deepEqual([pr.AAA_DEBUT.first_date, pr.AAA_DEBUT.progression_role, pr.AAA_DEBUT.dev_date, pr.AAA_DEBUT.state],
    ['2024-08-03', 'EARLY_CAMEO', null, 'NOT_REACHED'])
  assert.deepEqual([pr.A_DEBUT.dev_date, pr.HIGH_A_DEBUT.dev_date, pr.AA_DEBUT.dev_date], ['2024-08-06', '2025-04-05', '2025-08-15'])
  assert.ok([pr.A_DEBUT, pr.HIGH_A_DEBUT, pr.AA_DEBUT].every((r) => r.state === 'REACHED'))
  const s = await summaryOf('eduardo-guerrero')
  assert.deepEqual([s.current_development_status, s.current_development_season, s.highest_affiliated_level], ['AA', 2025, 'AAA'],
    'status is developmental; highest_affiliated_level still shows the cameo')
  assert.deepEqual([s.days_a_to_high_a_exact, s.days_a_to_aa_exact, s.days_high_a_to_aa_exact, s.days_signing_to_aaa_exact, s.days_aa_to_aaa_exact],
    [242, 374, 132, null, null])
})

test('024 reviewed later arrivals: Martinus, Brito and Perez development intervals use the reviewed arrival', async () => {
  const m = await summaryOf('mairoshendrick-martinus')
  assert.deepEqual([m.dev_high_a_date.toISOString().slice(0, 10), m.dev_high_a_state, m.dev_high_a_role], ['2026-08-02', 'REACHED', 'EARLY_CAMEO'])
  assert.deepEqual([m.days_signing_to_high_a_exact, m.days_a_to_high_a_exact], [1660, 451])
  // the Low-A development between the cameo and the arrival is preserved
  const lowA = await one(`select sum(coalesce(s.g, s.pg))::int as g from player_season_stints s join players p on p.id = s.player_id
    where p.slug = 'mairoshendrick-martinus' and s.level = 'LOW_A' and s.stint_kind = 'TEAM_STINT'`)
  assert.equal(lowA.g, 184)
  const b = await summaryOf('ronny-brito')
  assert.deepEqual([b.dev_high_a_date.toISOString().slice(0, 10), b.days_a_to_high_a_exact], ['2021-05-04', 690])
  const j = await summaryOf('jeral-perez')
  assert.deepEqual([j.first_a_date.toISOString().slice(0, 10), j.dev_a_date.toISOString().slice(0, 10)], ['2023-04-20', '2024-04-05'])
  assert.deepEqual([j.days_signing_to_a_exact, j.days_a_to_high_a_exact, j.days_a_to_aa_exact], [811, 364, 728])
})

test('024 REVIEW_REQUIRED stays unknown: every unresolved level of an ambiguous sequence is UNRESOLVED (never REACHED, NOT_REACHED or SKIPPED) and its metrics are NULL', async () => {
  const pending = [['carlos-frias', 'A_DEBUT'], ['carlos-frias', 'HIGH_A_DEBUT'],
    ['carlos-avila', 'A_DEBUT'], ['carlos-avila', 'AA_DEBUT'], ['carlos-avila', 'AAA_DEBUT'],
    ['christian-romero', 'AA_DEBUT'], ['christian-romero', 'AAA_DEBUT'],
    ['nicolas-cruz', 'A_DEBUT'], ['nicolas-cruz', 'HIGH_A_DEBUT']]
  const unresolved = await rows(`select player_slug, event_code from v_player_development_progression where development_state = 'UNRESOLVED' order by 1, 2`)
  assert.deepEqual(unresolved.map((r) => [r.player_slug, r.event_code]).sort(), pending.slice().sort())
  for (const [slug, event] of pending) {
    const r = byEvent(await progressionOf(slug))[event]
    assert.deepEqual([r.progression_role, r.review_status, r.dev_date, r.dev_season, r.state], ['REVIEW_REQUIRED', 'PENDING_REVIEW', null, null, 'UNRESOLVED'], slug)
    assert.ok(r.first_date, `${slug} keeps its first appearance`)
    const s = await summaryOf(slug)
    assert.equal(s.progression_review_pending, true, slug)
  }
  const frias = await summaryOf('carlos-frias')
  assert.deepEqual([frias.days_signing_to_a_exact, frias.days_signing_to_high_a_exact, frias.days_a_to_aa_exact, frias.days_a_to_high_a_exact, frias.days_high_a_to_aa_exact],
    [null, null, null, null, null], 'never guessed')
  const avila = await summaryOf('carlos-avila')
  assert.deepEqual([avila.days_signing_to_aa_exact, avila.days_signing_to_aaa_exact, avila.days_aa_to_aaa_exact], [null, null, null])
  const romero = await summaryOf('christian-romero')
  assert.deepEqual([romero.days_signing_to_aa_exact, romero.days_signing_to_aaa_exact, romero.days_high_a_to_aa_exact, romero.days_aa_to_aaa_exact], [null, null, null, null])
  const cruz = await summaryOf('nicolas-cruz')
  assert.deepEqual([cruz.days_signing_to_a_exact, cruz.days_signing_to_high_a_exact], [null, null])
})

test('024 status is the highest unambiguously established level: pending milestones never count as reached nor invalidate a verified higher level; highest_affiliated_level still shows appearances', async () => {
  const st = Object.fromEntries((await rows(`select s.player_slug, s.current_development_status as status, s.current_development_season as season,
      s.highest_affiliated_level as highest, s.progression_review_pending as pending, s.development_status_note as note
    from v_dodgers_player_development_summary s where s.player_slug in ('carlos-frias', 'carlos-avila', 'christian-romero', 'nicolas-cruz')`))
    .map((r) => [r.player_slug, r]))
  assert.deepEqual(['carlos-frias', 'carlos-avila', 'christian-romero', 'nicolas-cruz'].map((s) => [s, st[s].status, st[s].season, st[s].highest, st[s].pending]), [
    ['carlos-frias', 'MLB', 2017, 'MLB', true], // verified MLB outcome; his pending levels are below it
    ['carlos-avila', 'ROOKIE_LEVEL', 2025, 'AAA', true],
    ['christian-romero', 'HIGH_A', 2025, 'AAA', true],
    ['nicolas-cruz', 'ROOKIE_LEVEL', 2024, 'HIGH_A', true],
  ])
  assert.equal(st['carlos-avila'].note, 'Highest affiliated level reached: COMPLEX_ROOKIE (unambiguous); progression pending review: A_DEBUT, AA_DEBUT, AAA_DEBUT')
  assert.equal(st['christian-romero'].note, 'Highest affiliated level reached: HIGH_A (unambiguous); progression pending review: AA_DEBUT, AAA_DEBUT')
  assert.equal(st['nicolas-cruz'].note, 'Highest affiliated level reached: COMPLEX_ROOKIE (unambiguous); progression pending review: A_DEBUT, HIGH_A_DEBUT')
})

test('024 elapsed metrics: development intervals use developmental arrival, never negative, no inversion left', async () => {
  const c = await one(`select count(days_signing_to_pro_debut_exact)::int as s_pro, count(days_signing_to_a_exact)::int as s_a,
      count(days_signing_to_high_a_exact)::int as s_ha, count(days_signing_to_aa_exact)::int as s_aa,
      count(days_signing_to_aaa_exact)::int as s_aaa, count(days_signing_to_mlb_exact)::int as s_mlb,
      count(days_a_to_high_a_exact)::int as a_ha, count(days_a_to_aa_exact)::int as a_aa, count(days_high_a_to_aa_exact)::int as ha_aa,
      count(days_aa_to_aaa_exact)::int as aa_aaa, count(days_aaa_to_mlb_exact)::int as aaa_mlb,
      count(*) filter (where least(days_signing_to_a_exact, days_signing_to_high_a_exact, days_signing_to_aa_exact, days_signing_to_aaa_exact,
        days_a_to_high_a_exact, days_a_to_aa_exact, days_high_a_to_aa_exact, days_aa_to_aaa_exact, days_aaa_to_mlb_exact) < 0)::int as negative
    from v_dodgers_player_development_summary`)
  assert.deepEqual([c.s_pro, c.s_a, c.s_ha, c.s_aa, c.s_aaa, c.s_mlb, c.a_ha, c.a_aa, c.ha_aa, c.aa_aaa, c.aaa_mlb, c.negative],
    [146, 58, 26, 17, 4, 6, 34, 18, 17, 8, 1, 0])
  // every exact interval equals the difference of the developmental arrivals it names
  const bad = await one(`select count(*)::int as n from v_dodgers_player_development_summary
    where days_a_to_high_a_exact is distinct from public.disi_development_days(dev_a_date, dev_high_a_date)
       or days_aa_to_aaa_exact is distinct from public.disi_development_days(dev_aa_date, dev_aaa_date)
       or days_signing_to_aaa_exact is distinct from public.disi_development_days(signing_date, dev_aaa_date)`)
  assert.equal(bad.n, 0)
  // with every arrival known, no interval would be negative: no reached pair runs backward
  const inverted = await one(`select count(*)::int as n from v_player_development_progression lo
    join v_player_development_progression hi on hi.player_id = lo.player_id and hi.progression_tier > lo.progression_tier
    where lo.development_state = 'REACHED' and hi.development_state = 'REACHED'
      and case when lo.developmental_arrival_date is not null and hi.developmental_arrival_date is not null
               then lo.developmental_arrival_date > hi.developmental_arrival_date
               else lo.developmental_arrival_season > hi.developmental_arrival_season end`)
  assert.equal(inverted.n, 0)
  // ...whereas raw first appearances still contain the reviewed inversions (raw history stays raw)
  const raw = await one(`select count(distinct lo.player_id)::int as n from v_player_development_progression lo
    join v_player_development_progression hi on hi.player_id = lo.player_id and hi.progression_tier > lo.progression_tier
    where case when lo.first_appearance_date is not null and hi.first_appearance_date is not null
               then lo.first_appearance_date > hi.first_appearance_date
               else lo.first_appearance_season > hi.first_appearance_season end`)
  assert.equal(raw.n, 14)
  // first-appearance coverage is unchanged; the elapsed coverage now counts developmental intervals
  const cov = await one('select * from v_dodgers_development_date_coverage')
  assert.deepEqual([cov.exact_first_a, cov.exact_first_high_a, cov.exact_first_aa, cov.exact_first_aaa], [71, 36, 24, 15])
  assert.deepEqual([cov.exact_signing_to_a, cov.exact_signing_to_aa, cov.exact_signing_to_aaa], [58, 17, 4])
})

test('024 status: highest level developmentally reached; highest_affiliated_level stays appearance-based', async () => {
  const byStatus = Object.fromEntries((await rows(`select status::text, count(*)::int as n from player_development_status group by 1`)).map((r) => [r.status, r.n]))
  assert.deepEqual(byStatus, { ROOKIE_LEVEL: 94, MLB: 47, A_BALL: 33, HIGH_A: 16, AAA: 7, AA: 14, OUT_OF_AFFILIATED_BASEBALL: 1 })
  // every player whose status sits below the highest level they appeared at, and why
  const moved = await rows(`select s.player_slug, s.current_development_status as status, s.highest_affiliated_level as highest
    from v_dodgers_player_development_summary s
    where s.current_development_status::text not in ('MLB', 'OUT_OF_AFFILIATED_BASEBALL', 'UNKNOWN', 'NOT_YET_DEBUTED')
      and s.highest_affiliated_level is not null
      and (case s.current_development_status::text when 'ROOKIE_LEVEL' then 2 when 'A_BALL' then 3 when 'HIGH_A' then 4 when 'AA' then 5 when 'AAA' then 6 end)
        < (select l.progression_rank from development_levels l where l.level = s.highest_affiliated_level)
    order by 1`)
  assert.deepEqual(moved.map((r) => [r.player_slug, r.highest, r.status]), [
    ['carlos-avila', 'AAA', 'ROOKIE_LEVEL'], // pending A / AA / AAA
    ['christian-romero', 'AAA', 'HIGH_A'], // pending AA / AAA
    ['eduardo-guerrero', 'AAA', 'AA'], // reviewed AAA cameo
    ['eduardo-rojas', 'AAA', 'A_BALL'],
    ['elio-campos', 'AAA', 'A_BALL'],
    ['javier-herrera', 'AAA', 'A_BALL'],
    ['nicolas-cruz', 'HIGH_A', 'ROOKIE_LEVEL'], // pending A / High-A
    ['sean-linan', 'AAA', 'AA'],
  ])
})

test('024 research queue: no uncovered inversion; level-skip cameo candidates are listed but never change analytics', async () => {
  const issues = Object.fromEntries((await rows(`select issue, count(*)::int as n from v_dodgers_development_research_queue group by 1`)).map((r) => [r.issue, r.n]))
  assert.equal(issues.NON_MONOTONIC_PROGRESSION, undefined)
  assert.equal(issues.LEVEL_SKIP_CAMEO_CANDIDATE, 4)
  assert.equal(Object.values(issues).reduce((a, b) => a + b, 0), 104)
  const candidates = (await rows(`select player_slug from v_dodgers_development_research_queue where issue = 'LEVEL_SKIP_CAMEO_CANDIDATE' order by 1`)).map((r) => r.player_slug)
  assert.deepEqual(candidates, ['agustin-acosta', 'domingo-geronimo', 'reyli-mariano', 'umar-male'])
  // a candidate has no decision, so its 1-game AA appearance still counts as arrival until reviewed
  for (const slug of candidates) {
    const s = await summaryOf(slug)
    assert.deepEqual([s.dev_aa_state, s.dev_aa_role], ['REACHED', null], slug)
  }
  // removing a decision re-exposes its inversion in the queue (inside a rolled-back transaction)
  await db.transaction(async (tx) => {
    await tx.query(`delete from development_progression_decisions where player_id = (select id from players where slug = 'eduardo-guerrero')`)
    const q = (await tx.query(`select issue from v_dodgers_development_research_queue where player_slug = 'eduardo-guerrero' and issue = 'NON_MONOTONIC_PROGRESSION'`)).rows
    assert.equal(q.length, 1)
    await tx.rollback()
  })
})

test('024 ladder: FOREIGN_PRO and OTHER are never on it; every ladder player has one row per level', async () => {
  const levels = (await rows(`select distinct level from v_player_development_progression order by 1`)).map((r) => r.level)
  assert.deepEqual(levels, ['AA', 'AAA', 'COMPLEX_ROOKIE', 'HIGH_A', 'INTERNATIONAL_ROOKIE', 'LOW_A', 'MLB'])
  const shape = await one(`select count(*)::int as n, count(distinct player_id)::int as players from v_player_development_progression`)
  assert.deepEqual([shape.n, shape.players], [172 * 7, 172])
  // Lenix Osuna's Mexican League seasons create no ladder level
  const osuna = byEvent(await progressionOf('lenix-osuna'))
  assert.equal(osuna.AAA_DEBUT.first_date, null)
})

test('024 security: the decisions table has RLS and SELECT-only grants; the progression view is security_invoker; anon cannot write', async () => {
  const t = await one(`select relrowsecurity as rls from pg_class where relname = 'development_progression_decisions'`)
  assert.equal(t.rls, true)
  const v = await one(`select coalesce(reloptions::text, '') as opts from pg_class where relname = 'v_player_development_progression' and relkind = 'v'`)
  assert.match(v.opts, /security_invoker=(true|on)/)
  const grants = await rows(`select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
    from information_schema.role_table_grants where grantee in ('anon', 'authenticated')
      and table_name in ('development_progression_decisions', 'v_player_development_progression', 'v_dodgers_player_development_summary', 'v_dodgers_development_research_queue')
    group by 1, 2`)
  assert.equal(grants.length, 8)
  assert.ok(grants.every((g) => g.privs === 'SELECT'), JSON.stringify(grants))
  await db.transaction(async (tx) => {
    await tx.query('set local role anon')
    const n = (await tx.query(`select count(*)::int as n from development_progression_decisions`)).rows[0].n
    assert.equal(n, 20)
    const states = (await tx.query(`select count(*)::int as n from v_player_development_progression where development_state = 'UNRESOLVED'`)).rows[0].n
    assert.equal(states, 9)
    await assert.rejects(() => tx.query(`delete from development_progression_decisions`), /permission denied/)
    await tx.rollback()
  })
})

test('024 cohort views: the 021 reached_* columns stay first appearances (documented); developmental counts are appended', async () => {
  const cls = await one(`select sum(reached_aaa)::int as appeared_aaa, sum(developmentally_reached_aaa)::int as dev_aaa,
      sum(reached_aa)::int as appeared_aa, sum(developmentally_reached_aa)::int as dev_aa,
      sum(progression_review_pending_players)::int as pending
    from v_dodgers_development_by_signing_class`)
  // the developmental counts drop by exactly the cameo / pending AAA and AA players among Dodgers signings
  const expected = await one(`select count(*) filter (where s.dev_aaa_state = 'REACHED')::int as dev_aaa,
      count(*) filter (where s.first_aaa_date is not null or s.first_aaa_season is not null)::int as appeared_aaa,
      count(*) filter (where s.dev_aa_state = 'REACHED')::int as dev_aa,
      count(*) filter (where s.progression_review_pending)::int as pending
    from v_dodgers_player_development_summary s
    where s.player_id in (select sg.player_id from signings sg join organizations o on o.id = sg.organization_id where o.franchise_key = 'DODGERS')`)
  assert.deepEqual([cls.appeared_aaa, cls.dev_aaa, cls.dev_aa, cls.pending], [expected.appeared_aaa, expected.dev_aaa, expected.dev_aa, expected.pending])
  assert.ok(cls.dev_aaa < cls.appeared_aaa, 'cameo and pending AAA appearances are not developmental arrivals')
  assert.equal(cls.pending, 4)
  for (const view of ['v_dodgers_development_by_market', 'v_dodgers_development_by_bonus_band']) {
    const r = await one(`select sum(developmentally_reached_aaa)::int as dev_aaa, sum(progression_review_pending_players)::int as pending from ${view}`)
    assert.deepEqual([r.dev_aaa, r.pending], [cls.dev_aaa, 4], view)
  }
  const comment = await one(`select col_description('public.v_dodgers_development_by_signing_class'::regclass,
    (select attnum from pg_attribute where attrelid = 'public.v_dodgers_development_by_signing_class'::regclass and attname = 'reached_aaa')) as c`)
  assert.match(comment.c, /FIRST APPEARANCE/)
})

// ---------------------------------------------------------------------------
// 025 — public view grant hardening
// ---------------------------------------------------------------------------

const inventory025 = JSON.parse(fs.readFileSync(path.join(root, 'database/research/025/view-inventory.json'), 'utf8'))
const legacyBroad = inventory025.views.filter((v) => v.live_beyond_select_before_025).map((v) => v.view)
// Every API-role privilege on every public relation, straight from the ACLs (MAINTAIN included).
const apiAcl = async () => rows(`select c.relname, c.relkind::text as kind, coalesce(r.rolname, 'PUBLIC') as grantee,
    string_agg(a.privilege_type, ',' order by a.privilege_type) as privs
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where n.nspname = 'public' and c.relkind in ('r', 'v') and coalesce(r.rolname, 'PUBLIC') in ('anon', 'authenticated', 'service_role', 'PUBLIC')
  group by 1, 2, 3 order by 1, 3`)
const securitySnapshot = async () => one(`select
    (select string_agg(relname || ':' || relrowsecurity || ':' || relforcerowsecurity, ',' order by relname) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r') as rls,
    (select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename, policyname)
      from pg_policies where schemaname = 'public') as policies,
    (select string_agg(c.relname || ':' || pg_get_viewdef(c.oid), ',' order by c.relname) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v') as view_definitions`)

test('025 inventory: every one of the 86 public views is reviewed, read-only analytics, security_invoker and not updatable', async () => {
  assert.equal(inventory025.views.length, 86)
  assert.equal(legacyBroad.length, 43, 'the live audit found 43 legacy views with ALL privileges')
  assert.deepEqual(inventory025.intentionally_writable, [])
  const views = await rows(`select c.relname, coalesce(array_to_string(c.reloptions, ','), '') as opts, v.is_updatable, v.is_insertable_into
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join information_schema.views v on v.table_schema = 'public' and v.table_name = c.relname
    where n.nspname = 'public' and c.relkind = 'v' order by 1`)
  assert.deepEqual(views.map((v) => v.relname), inventory025.views.map((v) => v.view).sort())
  for (const v of views) {
    assert.match(v.opts, /security_invoker=(true|on)/, v.relname)
    assert.deepEqual([v.is_updatable, v.is_insertable_into], ['NO', 'NO'], v.relname)
  }
  const instead = await one(`select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and not t.tgisinternal`)
  const rules = await one(`select count(*)::int as n from pg_rules where schemaname = 'public' and rulename <> '_RETURN'`)
  assert.deepEqual([instead.n, rules.n], [0, 0], 'no INSTEAD OF trigger or rule makes any view writable')
})

test('025 grants: anon and authenticated hold SELECT only on every public view and table (no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN)', async () => {
  const acl = await apiAcl()
  for (const kind of ['v', 'r']) {
    for (const role of ['anon', 'authenticated']) {
      const relations = acl.filter((a) => a.kind === kind && a.grantee === role)
      assert.equal(relations.length, kind === 'v' ? 86 : 42, `${role} ${kind}`)
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
        assert.deepEqual(relations.filter((a) => a.privs.split(',').includes(privilege)).map((a) => a.relname), [], `${role} ${privilege} on ${kind}`)
      }
      assert.ok(relations.every((a) => a.privs === 'SELECT'), `${role} ${kind}`)
    }
  }
  assert.deepEqual(acl.filter((a) => a.grantee === 'PUBLIC'), [], 'PUBLIC holds nothing')
  const tables = await one(`select count(*)::int as n, count(*) filter (where relrowsecurity)::int as rls from pg_class c
    join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`)
  assert.deepEqual([tables.n, tables.rls], [42, 42])
  const write = await one(`select count(*)::int as n from pg_policies where schemaname = 'public' and cmd <> 'SELECT'`)
  assert.equal(write.n, 0, 'no table policy grants writes to anyone')
})

test('025 repairs the live drift: Supabase-default ALL grants on the 43 legacy views become SELECT; service_role, RLS, policies and view definitions are untouched; rerun is a no-op', async () => {
  await db.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; end $$;`)
  // reproduce the live state: ALL (incl. MAINTAIN) for anon / authenticated on the legacy views, and service_role ALL everywhere
  for (const v of legacyBroad) await db.exec(`grant all on public.${v} to anon, authenticated`)
  await db.exec(`grant all on public.v_dodgers_signing_cohort to service_role; grant all on public.players to service_role`)
  const drifted = (await apiAcl()).filter((a) => ['anon', 'authenticated'].includes(a.grantee) && a.privs !== 'SELECT')
  assert.equal(drifted.length, 86, '43 views x 2 roles carry more than SELECT before 025')
  assert.ok(drifted.every((a) => a.privs.includes('MAINTAIN') && a.privs.includes('TRUNCATE')))
  const before = await securitySnapshot()
  const serviceBefore = (await apiAcl()).filter((a) => a.grantee === 'service_role')

  await db.exec(readSql('025_public_view_grant_hardening.sql'))
  const after = await apiAcl()
  assert.deepEqual(after.filter((a) => ['anon', 'authenticated'].includes(a.grantee) && a.privs !== 'SELECT'), [])
  assert.equal(after.filter((a) => a.kind === 'v' && ['anon', 'authenticated'].includes(a.grantee) && a.privs === 'SELECT').length, 172)
  assert.deepEqual(after.filter((a) => a.grantee === 'service_role'), serviceBefore, 'service_role privileges are not changed')
  assert.deepEqual(await securitySnapshot(), before, 'RLS, policies and view definitions are unchanged')

  await db.exec(readSql('025_public_view_grant_hardening.sql'))
  assert.deepEqual(await apiAcl(), after, 'rerun changes nothing')
  assert.deepEqual(await securitySnapshot(), before)
  await db.exec(`revoke all on public.v_dodgers_signing_cohort from service_role; revoke all on public.players from service_role`)
})

test('025 guards: an unreviewed public view or a non-security_invoker view stops the migration with nothing changed', async () => {
  const sql = readSql('025_public_view_grant_hardening.sql')
  await db.exec(`create view public.zz_unreviewed with (security_invoker = true) as select 1 as x; grant all on public.zz_unreviewed to anon;`)
  try {
    await assert.rejects(async () => { await db.exec(sql) }, /not in the reviewed inventory: zz_unreviewed/)
    await db.exec('rollback;').catch(() => {})
  } finally {
    await db.exec('drop view public.zz_unreviewed')
  }
  await db.exec(`alter view public.v_dodgers_signing_cohort set (security_invoker = false); grant all on public.v_dodgers_market_summary to anon;`)
  try {
    await assert.rejects(async () => { await db.exec(sql) }, /not security_invoker: v_dodgers_signing_cohort/)
    await db.exec('rollback;').catch(() => {})
    const still = await one(`select string_agg(a.privilege_type, ',' order by a.privilege_type) as p from pg_class c
      cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee
      where c.relname = 'v_dodgers_market_summary' and r.rolname = 'anon'`)
    assert.match(still.p, /INSERT/, 'the failed run rolled back: the drifted grant is still there')
  } finally {
    await db.exec(`alter view public.v_dodgers_signing_cohort set (security_invoker = true)`)
    await db.exec(sql)
  }
  const clean = (await apiAcl()).filter((a) => ['anon', 'authenticated'].includes(a.grantee) && a.privs !== 'SELECT')
  assert.deepEqual(clean, [])
})

test('025 leaves the 024 development security intact', async () => {
  const t = await one(`select relrowsecurity as rls from pg_class where relname = 'development_progression_decisions'`)
  assert.equal(t.rls, true)
  const dev = await rows(`select c.relname, coalesce(array_to_string(c.reloptions, ','), '') as opts from pg_class c
    join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and c.relname like '%development%'`)
  assert.equal(dev.length, 10)
  assert.ok(dev.every((v) => /security_invoker=(true|on)/.test(v.opts)))
  const acl = (await apiAcl()).filter((a) => /development|player_season_stints/.test(a.relname) && ['anon', 'authenticated'].includes(a.grantee))
  assert.equal(acl.length, 34, '7 development tables + 10 development views, x 2 roles')
  assert.ok(acl.every((a) => a.privs === 'SELECT'))
})
