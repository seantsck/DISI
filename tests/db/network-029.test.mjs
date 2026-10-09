// Migration 029 - signing-network intelligence.
//
// One 001-028 database is built; the migration's behaviour on that pre-029 state is tested in
// rolled-back transactions, then 029 is applied for real (committed) and the remaining tests run
// on the resulting database, again in rolled-back transactions. Test order matters.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { lit, withoutTransaction } from './drift-027.mjs'
import { LOOKUP_FIXTURES, NETWORK_QUERIES } from '../../scripts/db/lib/network-invariants.mjs'
import { RECONCILIATION_QUERIES } from '../../scripts/db/lib/seed-reconciliation.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '029_signing_network_intelligence.sql'
const sql029 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const inner = withoutTransaction(sql029)
const seed = JSON.parse(fs.readFileSync(path.join(root, 'database/research/029/seed-evidence.json'), 'utf8'))
const BA2016 = seed.sources[0].url
const BA2018 = seed.sources[1].url

let chain
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
before(async () => { chain = await buildChainThrough('028_residual_canonical_drift_reconciliation.sql') }, { timeout: 180000 })
after(async () => { await chain.close() })

const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
let depth = 0
/** Runs `body` in a transaction that is always rolled back. */
async function inTxn(body) {
  await chain.db.exec('begin;')
  depth++
  try { return await body() } finally { depth--; await chain.db.exec('rollback;') }
}
/** Resolves to the error message of `sql` (or 'accepted'); always undone (a savepoint inside inTxn, a transaction outside it). */
async function attempt(sql) {
  if (depth > 0) {
    await chain.db.exec('savepoint attempt_sp;')
    try { await chain.db.exec(sql); return 'accepted' } catch (e) { return String(e.message) } finally { await chain.db.exec('rollback to savepoint attempt_sp; release savepoint attempt_sp;') }
  }
  await chain.db.exec('begin;')
  try { await chain.db.exec(sql); return 'accepted' } catch (e) { return String(e.message) } finally { await chain.db.exec('rollback;') }
}
const tableHashes = async () => {
  const tables = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5((await q(`select t::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const securityHash = async () => md5(await q(`select
  (select jsonb_agg(jsonb_build_array(c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type) order by c.relname, 2, 3) from pg_class c
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') and c.relname not like 'network\\_%' and c.relname not like '%\\_network%' and c.relname <> 'v_dodgers_network_coverage'),
  (select jsonb_agg(jsonb_build_array(tablename, policyname, cmd) order by tablename, policyname) from pg_policies where schemaname = 'public' and tablename not like 'network\\_%' and tablename <> 'player_network_relationships'
     and tablename not in ('trainers', 'player_trainers'))`))

// ---------------------------------------------------------------------------------------------
// 029 on the pre-029 database
// ---------------------------------------------------------------------------------------------

test('baseline: a 001-028 replay is clean - trainers 0 / 0, 47 tables / 91 views, no network object yet', async () => {
  assert.deepEqual([(await one('select count(*)::int as n from trainers')).n, (await one('select count(*)::int as n from player_trainers')).n], [0, 0])
  assert.deepEqual(await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`), { tables: 47, views: 91 })
  assert.equal((await one(`select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace and (relname like 'network\\_%' or relname like 'player\\_network\\_%')`)).n, 0)
})

test('legacy drop: guarded - clean drop in the empty state, and every unexpected state aborts with nothing changed', async () => {
  // the clean drop (inside a rolled-back transaction)
  await inTxn(async () => {
    await chain.db.exec(inner)
    const gone = await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname in ('trainers', 'player_trainers', 'v_player_trainers', 'v_dodgers_trainer_network')`)
    assert.deepEqual(gone, [])
  })
  assert.match(await attempt(`insert into trainers (name, country) values ('Somebody', 'Dominican Republic');\n${inner}`), /legacy trainer tables hold 1 row/)
  assert.match(await attempt(`insert into trainers (name) values ('Somebody'); insert into player_trainers (player_id, trainer_id) select p.id, t.id from players p cross join trainers t limit 1;\n${inner}`), /hold 2 row/)
  assert.match(await attempt(`drop view v_player_trainers;\n${inner}`), /expected all four legacy trainer objects or none, found 3/)
  assert.match(await attempt(`create view public.v_unexpected_dependent as select * from public.v_player_trainers;\n${inner}`), /unexpected view\(s\) depend/)
  assert.match(await attempt(`create view public.v_unexpected_dependent2 as select * from public.trainers;\n${inner}`), /unexpected view\(s\) depend/)
  // no unsupported legacy fact migrates: nothing in any new table can come from the old seed
  assert.equal((await one(`select count(*)::int as n from trainers`)).n, 0)
  // an aborted run changed nothing
  assert.deepEqual(await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as t`), { t: 47 })
})

test('029 applied for real: 47 -> 50 tables and 91 -> 93 views; 5 tables, 4 views, 4 functions, 4 triggers and 1 signings constraint are added', async () => {
  const before = await tableHashes()
  await chain.db.exec(sql029)
  const counts = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
  assert.deepEqual(counts, { tables: 50, views: 93 })
  const tables = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and (relname like 'network\\_%' or relname = 'player_network_relationships') order by 1`)).map((r) => r.relname)
  assert.deepEqual(tables, ['network_entities', 'network_entity_aliases', 'network_entity_identity_reviews', 'network_entity_relationships', 'player_network_relationships'])
  const views = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' and relname in ('v_player_signing_network', 'v_network_entity_player_history', 'v_dodgers_network_coverage', 'v_network_research_queue') order by 1`)).map((r) => r.relname)
  assert.equal(views.length, 4)
  const functions = (await q(`select proname from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'disi\\_network\\_%' or proname = 'disi_player_network_guard') order by 1`)).map((r) => r.proname)
  assert.deepEqual(functions, ['disi_network_entity_guard', 'disi_network_entity_relationship_guard', 'disi_network_lookup_key', 'disi_player_network_guard'])
  const triggers = (await q(`select tgname from pg_trigger where not tgisinternal and tgrelid in ('public.network_entities'::regclass, 'public.network_entity_aliases'::regclass,
    'public.network_entity_relationships'::regclass, 'public.player_network_relationships'::regclass) order by 1`)).map((r) => r.tgname)
  assert.deepEqual(triggers, ['network_entities_guard', 'network_entity_aliases_guard', 'network_entity_relationships_guard', 'player_network_relationships_guard'])
  assert.equal((await one(`select count(*)::int as n from pg_constraint where conrelid = 'public.signings'::regclass and conname = 'signings_id_player_id_key' and contype = 'u'`)).n, 1)
  assert.deepEqual(await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname in ('trainers', 'player_trainers', 'v_player_trainers', 'v_dodgers_trainer_network')`), [])
  // nothing outside the new tables, the dropped legacy tables and the signings constraint changed in any table's rows
  const after = await tableHashes()
  const changed = Object.keys(after).filter((t) => before[t] !== after[t])
  assert.deepEqual(changed.filter((t) => !/^network_|player_network_relationships$|^sources$/.test(t)), [], 'only the new tables and the two registered sources change')
  // 026 scouting, development, 027 and 028 are untouched
  for (const t of ['player_evaluations', 'player_evaluation_grades', 'player_evaluation_rankings', 'player_evaluation_notes', 'scouting_publications', 'player_season_stints',
    'development_milestones', 'development_progression_decisions', 'signings', 'signing_environments', 'transactions', 'evidence', 'signing_population_member_sources']) {
    assert.equal(after[t], before[t], `${t} is unchanged`)
  }
})

// ---------------------------------------------------------------------------------------------
// the seed
// ---------------------------------------------------------------------------------------------

test('seed: 9 entities, 1 alias, 9 player relationships, 0 entity relationships, 0 identity reviews - exactly what two Baseball America reviews state', async () => {
  const counts = await one(`select (select count(*) from network_entities)::int as entities, (select count(*) from network_entity_aliases)::int as aliases,
    (select count(*) from player_network_relationships)::int as player_relationships, (select count(*) from network_entity_relationships)::int as entity_relationships,
    (select count(*) from network_entity_identity_reviews)::int as reviews`)
  assert.deepEqual(counts, { entities: 9, aliases: 1, player_relationships: 9, entity_relationships: 0, reviews: 0 })
  assert.deepEqual(await q(`select entity_type, count(*)::int as n from network_entities group by 1 order by 1`),
    [{ entity_type: 'ACADEMY', n: 1 }, { entity_type: 'PERSON', n: 5 }, { entity_type: 'PROGRAM', n: 1 }, { entity_type: 'SHOWCASE_LEAGUE', n: 2 }])
  assert.deepEqual(await q(`select p.slug, count(*)::int as n from player_network_relationships r join players p on p.id = r.player_id group by 1 order by 1`),
    [{ slug: 'christopher-arias', n: 2 }, { slug: 'jorbit-vivas', n: 1 }, { slug: 'oneil-cruz', n: 1 }, { slug: 'ronny-brito', n: 2 }, { slug: 'starling-heredia', n: 3 }])
  assert.deepEqual(await q(`select s.url, count(*)::int as n from player_network_relationships r join sources s on s.id = r.source_id group by 1 order by 1`),
    [{ url: BA2016, n: 7 }, { url: BA2018, n: 2 }])
  // the two reviews are registered as ordinary sources: tier OTHER, published 2016-04-01 and 2018-04-30
  assert.deepEqual(await q(`select source_name, source_type, source_tier, publication_date::text as pub from sources where url in ($1, $2) order by publication_date`, [BA2016, BA2018]),
    [{ source_name: 'Baseball America', source_type: 'ARTICLE', source_tier: 'OTHER', pub: '2016-04-01' }, { source_name: 'Baseball America', source_type: 'ARTICLE', source_tier: 'OTHER', pub: '2018-04-30' }])
  assert.equal((await one(`select count(*)::int as n from player_network_relationships where relationship_type = 'SCOUTED_BY'`)).n, 0)
})

test('seed semantics: Cruz bare TRAINED_WITH is UNKNOWN; Heredia program is DEVELOPED_AT / UNKNOWN / MEDIUM; Vivas is SIGNED_OUT_OF / AT_SIGNING; signing links only where the source ties it', async () => {
  const rel = async (slug) => q(`select e.slug as entity, r.relationship_type, r.stage, r.confidence::text as confidence, r.signing_id is not null as linked, sg.signing_year, r.start_precision, r.end_precision
    from player_network_relationships r join players p on p.id = r.player_id join network_entities e on e.id = r.entity_id left join signings sg on sg.id = r.signing_id
    where p.slug = $1 order by 2, 1`, [slug])
  assert.deepEqual(await rel('oneil-cruz'), [{ entity: 'raul-valera', relationship_type: 'TRAINED_WITH', stage: 'UNKNOWN', confidence: 'HIGH', linked: false, signing_year: null, start_precision: 'UNKNOWN', end_precision: 'UNKNOWN' }])
  assert.deepEqual(await rel('starling-heredia'), [
    { entity: 'franklin-ferreras-program', relationship_type: 'DEVELOPED_AT', stage: 'UNKNOWN', confidence: 'MEDIUM', linked: false, signing_year: null, start_precision: 'UNKNOWN', end_precision: 'UNKNOWN' },
    { entity: 'dominican-prospect-league', relationship_type: 'SHOWCASED_IN', stage: 'PRE_SIGNING', confidence: 'HIGH', linked: true, signing_year: 2015, start_precision: 'UNKNOWN', end_precision: 'UNKNOWN' },
    { entity: 'franklin-ferreras', relationship_type: 'TRAINED_WITH', stage: 'PRE_SIGNING', confidence: 'HIGH', linked: true, signing_year: 2015, start_precision: 'UNKNOWN', end_precision: 'UNKNOWN' }])
  assert.deepEqual((await rel('ronny-brito')).map((r) => [r.entity, r.relationship_type, r.stage, r.linked]), [['international-prospect-league', 'SHOWCASED_IN', 'PRE_SIGNING', true], ['laurentino-genao', 'TRAINED_WITH', 'PRE_SIGNING', true]])
  assert.deepEqual((await rel('christopher-arias')).map((r) => [r.entity, r.relationship_type, r.stage, r.linked]), [['international-prospect-league', 'SHOWCASED_IN', 'PRE_SIGNING', true], ['amauris-nina', 'TRAINED_WITH', 'PRE_SIGNING', true]])
  assert.deepEqual(await rel('jorbit-vivas'), [{ entity: 'yasser-mendez-academy', relationship_type: 'SIGNED_OUT_OF', stage: 'AT_SIGNING', confidence: 'HIGH', linked: true, signing_year: 2017, start_precision: 'UNKNOWN', end_precision: 'UNKNOWN' }])
  assert.equal((await one(`select count(*)::int as n from player_network_relationships r where r.relationship_type = 'DEVELOPED_AT' and r.entity_id in (select id from network_entities where slug = 'yasser-mendez-academy')`)).n, 0,
    'the Mendez wording is SIGNED_OUT_OF, never DEVELOPED_AT')
  // publication dates stay on the source: no relationship period was manufactured from them
  assert.equal((await one(`select count(*)::int as n from player_network_relationships where start_precision <> 'UNKNOWN' or end_precision <> 'UNKNOWN'`)).n, 0)
  // researched players with no stated network stay without rows; so do the four unverified backlog players
  for (const slug of ['yadier-alvarez', 'yusniel-diaz', 'omar-estevez', 'emil-morales', 'rubel-arias', 'ezequiel-melburne', 'joendry-vargas']) {
    assert.equal((await one(`select count(*)::int as n from player_network_relationships r join players p on p.id = r.player_id where p.slug = $1`, [slug])).n, 0, slug)
  }
  // a publisher's spelling is not an identity: no player alias was added for Yorbit Vivas or Onil Cruz
  assert.equal((await one(`select count(*)::int as n from player_aliases where alias ~* 'yorbit|onil '`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from player_aliases`)).n, 50)
})

test('entities: a PERSON and the descriptive academy / program stay distinct; the anchor records wording and implies no operation, ownership or affiliation', async () => {
  const e = await q(`select e.slug, e.entity_type, e.name_basis, e.canonical_name, a.slug as anchor from network_entities e left join network_entities a on a.id = e.descriptor_anchor_entity_id order by e.slug`)
  const by = Object.fromEntries(e.map((x) => [x.slug, x]))
  assert.deepEqual([by['yasser-mendez'].entity_type, by['yasser-mendez'].name_basis, by['yasser-mendez'].anchor], ['PERSON', 'NAMED', null])
  assert.deepEqual([by['yasser-mendez-academy'].entity_type, by['yasser-mendez-academy'].name_basis, by['yasser-mendez-academy'].anchor, by['yasser-mendez-academy'].canonical_name], ['ACADEMY', 'DESCRIPTIVE', 'yasser-mendez', "Yasser Mendez's academy"])
  assert.deepEqual([by['franklin-ferreras-program'].entity_type, by['franklin-ferreras-program'].name_basis, by['franklin-ferreras-program'].anchor], ['PROGRAM', 'DESCRIPTIVE', 'franklin-ferreras'])
  assert.notEqual(by['yasser-mendez'].slug, by['yasser-mendez-academy'].slug)
  assert.equal((await one(`select count(*)::int as n from network_entity_relationships`)).n, 0, 'possessive wording alone seeds no OPERATES / AFFILIATED_WITH')
  // the proper-name entities are NAMED; only the two possessive descriptions are DESCRIPTIVE; no nickname-only entity exists
  assert.deepEqual(await q(`select name_basis, count(*)::int as n from network_entities group by 1 order by 1`), [{ name_basis: 'DESCRIPTIVE', n: 2 }, { name_basis: 'NAMED', n: 7 }])
  assert.deepEqual(await q(`select e.slug, a.alias, a.alias_type, a.lookup_key from network_entity_aliases a join network_entities e on e.id = a.entity_id`),
    [{ slug: 'raul-valera', alias: 'Banana', alias_type: 'NICKNAME', lookup_key: 'banana' }])
  // Valera is canonically the spelling the directly read source prints; no accented form is stored, and no alias was added for it
  assert.equal((await one(`select canonical_name from network_entities where slug = 'raul-valera'`)).canonical_name, 'Raul Valera')
  assert.equal((await one(`select count(*)::int as n from network_entities where canonical_name = 'Raúl Valera'`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from network_entity_aliases where alias = 'Banana'`)).n, 1)
  assert.equal((await one(`select count(*)::int as n from network_entity_aliases`)).n, 1)
  assert.equal((await one(`select count(*)::int as n from network_entity_aliases where alias ~ 'Ra.l'`)).n, 0)
  assert.doesNotMatch((await one(`select notes from network_entities where slug = 'raul-valera'`)).notes, /accent|Raúl/)
  // the normaliser still resolves both spellings to one key
  const keys = await q(`select public.disi_network_lookup_key('Raul Valera') as plain, public.disi_network_lookup_key('Raúl Valera') as accented`)
  assert.deepEqual([keys[0].plain, keys[0].accented], ['raul valera', 'raul valera'])
  // geography is never invented
  assert.equal((await one(`select count(*)::int as n from network_entities where country_code is not null or region is not null or city is not null or website_url is not null`)).n, 0)
  // no entity or relationship note is long, and none quotes a publisher
  assert.equal((await one(`select count(*)::int as n from player_network_relationships where char_length(note) > 300`)).n, 0)
})

// ---------------------------------------------------------------------------------------------
// the deterministic normaliser
// ---------------------------------------------------------------------------------------------

// An independent JavaScript reference of the documented transformation (explicit maps, fixed separators).
const MAP = { a: 'áàâäãåāăą', c: 'çćč', d: 'ďđ', e: 'éèêëēėęě', i: 'íìîïīį', l: 'łľ', n: 'ñń', o: 'óòôöõøōő', r: 'ř', s: 'šś', t: 'ť', u: 'úùûüūůű', y: 'ýÿ', z: 'źżž' }
const reference = (text) => {
  let out = ''
  for (const ch of text) {
    const accent = Object.entries(MAP).find(([, chars]) => [...chars].some((c) => c === ch || c.toUpperCase() === ch))
    if (accent) out += accent[0]
    else if (ch >= 'A' && ch <= 'Z') out += String.fromCharCode(ch.charCodeAt(0) + 32)
    else out += ch
  }
  return out.replace(/[^abcdefghijklmnopqrstuvwxyz0123456789]+/g, ' ').trim()
}

test('lookup normaliser: fixed fixtures, an independent reference, IMMUTABLE / invoker / empty search_path / no API EXECUTE, and no lower() or initcap()', async () => {
  for (const [input, expected] of LOOKUP_FIXTURES) {
    assert.equal((await one(`select public.disi_network_lookup_key($1) as k`, [input])).k, expected, input)
    assert.equal(reference(input), expected, `reference: ${input}`)
  }
  const samples = ['Ñandú Pérez', "O'Brien-Núñez", 'DOMINICAN prospect LEAGUE 2015', 'Åsa Ørsted', 'sao   paulo', '12 de Octubre', 'Zoë & Zoé', '', '   ', '--!!--', 'Łukasz Żółć', 'Curaçao']
  for (const s of samples) assert.equal((await one(`select public.disi_network_lookup_key($1) as k`, [s])).k, reference(s), JSON.stringify(s))
  assert.equal((await one(`select public.disi_network_lookup_key(null) as k`)).k, null, 'strict: null in, null out')
  const fn = await one(`select p.provolatile::text as vol, p.prosecdef as secdef, p.proconfig::text as cfg, has_function_privilege('anon', p.oid, 'execute') as anon_x,
    has_function_privilege('authenticated', p.oid, 'execute') as auth_x, p.prosrc from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'disi_network_lookup_key'`)
  assert.deepEqual([fn.vol, fn.secdef, fn.anon_x, fn.auth_x], ['i', false, false, false])
  assert.match(fn.cfg, /search_path/)
  assert.doesNotMatch(fn.prosrc, /\blower\s*\(|initcap\s*\(|collate|upper\s*\(/i, 'no locale-sensitive function in the normaliser')
  const code = sql029.replace(/--[^\n]*/g, '')
  assert.doesNotMatch(code, /initcap\s*\(/i)
  // the generated key always equals the function, and an alias with no letters or digits is refused
  assert.match(await attempt(`insert into network_entity_aliases (entity_id, alias, alias_type, source_id, confidence, retrieved_at)
    select e.id, '--!!--', 'OTHER', s.id, 'LOW', now() from network_entities e cross join sources s where e.slug = 'raul-valera' and s.url = ${lit(BA2016)}`), /lookup_key_check|check/)
  assert.match(await attempt(`update network_entity_aliases set lookup_key = 'x'`), /can only be updated to DEFAULT|generated|insert-only/i)
  // alias lookup is a search aid, never a join key: no production object joins on it
  const defs = (await q(`select pg_get_viewdef(c.oid) as d from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('v_player_signing_network', 'v_network_entity_player_history', 'v_dodgers_network_coverage', 'v_network_research_queue')`)).map((r) => r.d).join('\n')
  assert.doesNotMatch(defs, /lookup_key/)
})

test('aliases: exact printed spelling kept, insert-only, source-backed, one row per entity and spelling', async () => {
  await inTxn(async () => {
    const ins = (alias, extra = '') => `insert into network_entity_aliases (entity_id, alias, alias_type, language_code, source_id, confidence, retrieved_at${extra ? ', valid_from_year, valid_to_year' : ''})
      select e.id, ${lit(alias)}, 'COMMON_NAME', 'es', s.id, 'MEDIUM', now()${extra} from network_entities e cross join sources s where e.slug = 'raul-valera' and s.url = ${lit(BA2016)}`
    await chain.db.exec(ins('Raúl "Banana" Valera'))
    const row = await one(`select alias, lookup_key from network_entity_aliases where alias like 'Ra%l "Banana" Valera'`)
    assert.deepEqual([row.alias, row.lookup_key], ['Raúl "Banana" Valera', 'raul banana valera'])
    assert.match(await attempt(ins('Raúl "Banana" Valera')), /duplicate key|unique/i)
    assert.match(await attempt(ins('x', ', 2010, 2005')), /period_check|check/)
    assert.match(await attempt(`update network_entity_aliases set alias = 'Other' where alias = 'Banana'`), /insert-only/)
    assert.match(await attempt(`delete from network_entity_aliases where alias = 'Banana'`), /cannot be deleted while their entity exists/)
    assert.match(await attempt(`insert into network_entity_aliases (entity_id, alias, alias_type, source_id, confidence, retrieved_at) select e.id, 'No Source', 'OTHER', null, 'LOW', now() from network_entities e limit 1`), /null value|not-null/i)
    assert.match(await attempt(`insert into network_entity_aliases (entity_id, alias, alias_type, source_id, confidence, retrieved_at) select e.id, 'Odd', 'MADE_UP', s.id, 'LOW', now() from network_entities e cross join sources s limit 1`), /alias_type_check|check/)
    assert.match(await attempt(`insert into network_entity_aliases (entity_id, alias, alias_type, language_code, source_id, confidence, retrieved_at) select e.id, 'Odd', 'OTHER', 'ENGLISH', s.id, 'LOW', now() from network_entities e cross join sources s limit 1`), /language_code_check|check/)
  })
})

// ---------------------------------------------------------------------------------------------
// entity integrity
// ---------------------------------------------------------------------------------------------

const SRC = (url = BA2016) => `(select id from sources where url = ${lit(url)})`
const addEntity = (slug, type, { name = slug, basis = 'NAMED', anchor = null } = {}) => `insert into network_entities (slug, entity_type, canonical_name, name_basis, descriptor_anchor_entity_id, source_id, evidence_basis, confidence, retrieved_at)
  values (${lit(slug)}, ${lit(type)}, ${lit(name)}, ${lit(basis)}, ${anchor ? `(select id from network_entities where slug = ${lit(anchor)})` : 'null'}, ${SRC()}, 'MANUAL_RESEARCH', 'MEDIUM', now())`
const ENT = (slug) => `(select id from network_entities where slug = ${lit(slug)})`
const PLAYER = (slug) => `(select id from players where slug = ${lit(slug)})`
const addRel = (o) => `insert into player_network_relationships (player_id, entity_id, signing_id, relationship_type, stage, source_id, evidence_basis, confidence, retrieved_at${o.extraCols ?? ''})
  values (${PLAYER(o.player ?? 'yordan-alvarez')}, ${ENT(o.entity)}, ${o.signing ?? 'null'}, ${lit(o.type)}, ${lit(o.stage ?? 'UNKNOWN')}, ${SRC()}, 'MANUAL_RESEARCH', 'MEDIUM', now()${o.extraVals ?? ''})`

test('entities: identity and creation provenance are sealed, enrichment stays editable, anchors must be PERSON and DESCRIPTIVE-only, history blocks deletion', async () => {
  await inTxn(async () => {
    for (const set of ["slug = 'renamed'", "entity_type = 'OTHER'", "canonical_name = 'Renamed'", "name_basis = 'NICKNAME_ONLY'", `descriptor_anchor_entity_id = ${ENT('raul-valera')}`,
      `source_id = ${SRC(BA2016)}`, "evidence_basis = 'OTHER'", "confidence = 'LOW'", "retrieved_at = now()"]) {
      assert.match(await attempt(`update network_entities set ${set} where slug = 'yasser-mendez'`), /identity and creation provenance are sealed|anchor_check|check/, set)
    }
    assert.equal(await attempt(`update network_entities set country_code = 'DO', region = 'Santo Domingo', city = 'Boca Chica', active_from_year = 2010, active_to_year = 2020, website_url = 'https://example.org', notes = 'analyst enrichment' where slug = 'yasser-mendez'`), 'accepted')
    assert.match(await attempt(`update network_entities set country_code = 'Dominican' where slug = 'yasser-mendez'`), /country_code_check|check/)
    assert.match(await attempt(`update network_entities set active_from_year = 2020, active_to_year = 2010 where slug = 'yasser-mendez'`), /active_years_check|check/)
    assert.match(await attempt(`update network_entities set notes = '${'x'.repeat(501)}' where slug = 'yasser-mendez'`), /notes_check|check/)
    // anchors: a PERSON, descriptive only, never self
    assert.equal(await attempt(addEntity('new-program', 'PROGRAM', { name: "Someone's program", basis: 'DESCRIPTIVE', anchor: 'raul-valera' })), 'accepted')
    assert.match(await attempt(addEntity('bad-anchor', 'PROGRAM', { name: 'x', basis: 'DESCRIPTIVE', anchor: 'dominican-prospect-league' })), /anchor must be an existing PERSON/)
    assert.match(await attempt(addEntity('named-with-anchor', 'PROGRAM', { name: 'x', basis: 'NAMED', anchor: 'raul-valera' })), /anchor_check|check/)
    assert.match(await attempt(`insert into network_entities (slug, entity_type, canonical_name, name_basis, source_id, evidence_basis, confidence, retrieved_at) values ('Bad Slug', 'PERSON', 'x', 'NAMED', ${SRC()}, 'OTHER', 'LOW', now())`), /slug_check|check/)
    assert.match(await attempt(addEntity('trainer-type', 'TRAINER')), /entity_type_check|check/)
    assert.match(await attempt(addEntity('agent-type', 'AGENT')), /entity_type_check|check/)
    assert.match(await attempt(addEntity('scout-type', 'SCOUT')), /entity_type_check|check/)
    assert.match(await attempt(`insert into network_entities (slug, entity_type, canonical_name, name_basis, evidence_basis, confidence, retrieved_at) values ('no-source', 'PERSON', 'x', 'NAMED', 'OTHER', 'LOW', now())`), /null value|not-null/i)
    for (const t of ['PERSON', 'ACADEMY', 'PROGRAM', 'SHOWCASE_LEAGUE', 'AGENCY', 'OTHER']) assert.equal(await attempt(addEntity(`t-${t.toLowerCase().replace('_', '-')}`, t)), 'accepted', t)
    for (const b of ['NAMED', 'DESCRIPTIVE', 'NICKNAME_ONLY']) {
      assert.equal(await attempt(addEntity(`b-${b.toLowerCase().replace('_', '-')}`, 'PERSON', { basis: b, anchor: b === 'DESCRIPTIVE' ? 'raul-valera' : null })), 'accepted', b)
    }
    // an entity with relationship history cannot be deleted (guard + foreign keys), and neither can an anchor
    assert.match(await attempt(`delete from network_entities where slug = 'raul-valera'`), /relationship history cannot be deleted/)
    assert.match(await attempt(`delete from network_entities where slug = 'franklin-ferreras'`), /relationship history cannot be deleted|foreign key|violates/i)
    assert.equal(await attempt(`${addEntity('lonely', 'OTHER')}; delete from network_entities where slug = 'lonely'`), 'accepted')
  })
})

test('identity reviews: each pair once in fixed order, status and review time agree, nothing is merged', async () => {
  await inTxn(async () => {
    const [a, b] = (await q(`select id from network_entities where slug in ('franklin-ferreras', 'franklin-ferreras-program') order by id`)).map((r) => r.id)
    const review = (x, y, status = 'OPEN', reviewed = false) => `insert into network_entity_identity_reviews (entity_a_id, entity_b_id, status, reason, reviewed_at) values ('${x}', '${y}', '${status}', 'overlapping labels', ${reviewed ? 'now()' : 'null'})`
    assert.equal(await attempt(review(a, b)), 'accepted')
    assert.match(await attempt(review(b, a)), /pair_check|check/, 'reverse order is refused: one row per unordered pair')
    assert.match(await attempt(`${review(a, b)}; ${review(a, b)}`), /duplicate key|unique/i)
    assert.match(await attempt(review(a, a)), /pair_check|check/)
    assert.match(await attempt(review(a, b, 'MERGED')), /status_check|check/)
    assert.match(await attempt(review(a, b, 'DISTINCT', false)), /decision_check|check/)
    assert.match(await attempt(review(a, b, 'OPEN', true)), /decision_check|check/)
    assert.equal(await attempt(review(a, b, 'DISTINCT', true)), 'accepted')
    assert.equal(await attempt(review(a, b, 'SAME_PENDING_MERGE', true)), 'accepted')
    const before = (await one(`select count(*)::int as n from network_entities`)).n
    await chain.db.exec(review(a, b))
    await chain.db.exec(`update network_entity_identity_reviews set status = 'SAME_PENDING_MERGE', reviewed_at = now()`)
    assert.equal((await one(`select count(*)::int as n from network_entities`)).n, before, 'a review never merges or deletes an entity')
    assert.equal((await one(`select count(*)::int as n from player_network_relationships`)).n, 9)
  })
})

// ---------------------------------------------------------------------------------------------
// relationship integrity
// ---------------------------------------------------------------------------------------------

test('player relationships: vocabulary, type compatibility, stage values and provenance are enforced in the database', async () => {
  await inTxn(async () => {
    for (const [slug, type] of [['t-person', 'PERSON'], ['t-academy', 'ACADEMY'], ['t-program', 'PROGRAM'], ['t-league', 'SHOWCASE_LEAGUE'], ['t-agency', 'AGENCY'], ['t-other', 'OTHER']]) await chain.db.exec(addEntity(slug, type))
    const allowed = { TRAINED_WITH: ['t-person'], DEVELOPED_AT: ['t-academy', 't-program'], SIGNED_OUT_OF: ['t-academy', 't-program'], SHOWCASED_IN: ['t-league'], REPRESENTED_BY: ['t-person', 't-agency'] }
    const all = ['t-person', 't-academy', 't-program', 't-league', 't-agency', 't-other']
    for (const [type, ok] of Object.entries(allowed)) {
      for (const entity of all) {
        const result = await attempt(addRel({ type, entity }))
        if (ok.includes(entity)) assert.equal(result, 'accepted', `${type} -> ${entity}`)
        else assert.match(result, /does not accept/, `${type} -> ${entity}`)
      }
    }
    assert.match(await attempt(addRel({ type: 'SCOUTED_BY', entity: 't-person' })), /relationship_type_check|check|does not accept/)
    assert.match(await attempt(addRel({ type: 'TRAINED_WITH', entity: 't-person', stage: 'EARLY' })), /stage_check|check/)
    for (const stage of ['PRE_SIGNING', 'AT_SIGNING', 'POST_SIGNING', 'UNKNOWN']) assert.equal(await attempt(addRel({ type: 'TRAINED_WITH', entity: 't-person', stage })), 'accepted', stage)
    assert.match(await attempt(`${addRel({ type: 'TRAINED_WITH', entity: 't-person' })}; ${addRel({ type: 'TRAINED_WITH', entity: 't-person' })}`), /active_key|duplicate key/, 'one ACTIVE row per fact')
    // provenance is required
    assert.match(await attempt(`insert into player_network_relationships (player_id, entity_id, relationship_type, stage, evidence_basis, confidence, retrieved_at)
      values (${PLAYER('yordan-alvarez')}, ${ENT('t-person')}, 'TRAINED_WITH', 'UNKNOWN', 'OTHER', 'LOW', now())`), /null value|not-null/i)
    assert.match(await attempt(addRel({ type: 'TRAINED_WITH', entity: 't-person', extraCols: ', note', extraVals: `, '${'x'.repeat(301)}'` })), /note_check|check/)
    assert.equal(await attempt(addRel({ type: 'TRAINED_WITH', entity: 't-person', extraCols: ', note', extraVals: `, '${'x'.repeat(300)}'` })), 'accepted')
    assert.match(await attempt(`insert into player_network_relationships (player_id, entity_id, relationship_type, stage, source_id, evidence_basis, confidence, retrieved_at)
      values (${PLAYER('yordan-alvarez')}, ${ENT('t-person')}, 'TRAINED_WITH', 'UNKNOWN', ${SRC()}, 'HEARSAY', 'LOW', now())`), /evidence_basis_check|check/)
    for (const basis of ['TEAM_RELEASE', 'MLB_PIPELINE_PROFILE', 'PUBLISHED_INTERNATIONAL_REVIEW', 'PLAYER_PROFILE', 'TRAINER_OR_ACADEMY_PROFILE', 'INTERVIEW', 'SECONDARY_REPORT', 'MANUAL_RESEARCH', 'OTHER']) {
      assert.equal(await attempt(`insert into player_network_relationships (player_id, entity_id, relationship_type, stage, source_id, evidence_basis, confidence, retrieved_at)
        values (${PLAYER('yordan-alvarez')}, ${ENT('t-person')}, 'TRAINED_WITH', 'UNKNOWN', ${SRC()}, '${basis}', 'LOW', now())`), 'accepted', basis)
    }
  })
})

test('signing linkage: the composite foreign key ties a relationship to the same player\'s signing and nothing else', async () => {
  await inTxn(async () => {
    await chain.db.exec(addEntity('t-person', 'PERSON'))
    const signingOf = (slug) => `(select s.id from signings s where s.player_id = ${PLAYER(slug)} limit 1)`
    assert.equal(await attempt(addRel({ type: 'TRAINED_WITH', entity: 't-person', player: 'yordan-alvarez', signing: signingOf('yordan-alvarez') })), 'accepted')
    assert.equal(await attempt(addRel({ type: 'TRAINED_WITH', entity: 't-person', player: 'yordan-alvarez', signing: 'null' })), 'accepted', 'signing_id is optional')
    assert.match(await attempt(addRel({ type: 'TRAINED_WITH', entity: 't-person', player: 'yordan-alvarez', signing: signingOf('oneil-cruz') })), /signing_player_fkey|foreign key|violates/i,
      "another player's signing is refused by the database")
    assert.match(await attempt(addRel({ type: 'TRAINED_WITH', entity: 't-person', player: 'yordan-alvarez', signing: `'00000000-0000-4000-8000-000000000000'` })), /foreign key|violates/i)
    assert.match(await attempt(`update signings set player_id = ${PLAYER('oneil-cruz')} where id = ${signingOf('jorbit-vivas')}`), /foreign key|violates|unique/i,
      'a linked signing cannot be re-assigned to another player')
    assert.equal((await one(`select count(*)::int as n from player_network_relationships r where r.signing_id is not null and not exists (select 1 from signings s where s.id = r.signing_id and s.player_id = r.player_id)`)).n, 0)
  })
})

const periodVals = (o) => ({ extraCols: ', start_precision, start_date, start_year, start_month, end_precision, end_date, end_year, end_month',
  extraVals: `, ${lit(o[0])}, ${o[1] ? `date '${o[1]}'` : 'null'}, ${o[2] ?? 'null'}, ${o[3] ?? 'null'}, ${lit(o[4])}, ${o[5] ? `date '${o[5]}'` : 'null'}, ${o[6] ?? 'null'}, ${o[7] ?? 'null'}` })

test('periods: DAY / MONTH / YEAR / SEASON / UNKNOWN with independent start and end precision, no invented day 1, end never before start', async () => {
  await inTxn(async () => {
    await chain.db.exec(addEntity('t-person', 'PERSON'))
    const rel = (p) => addRel({ type: 'TRAINED_WITH', entity: 't-person', ...periodVals(p) })
    assert.equal(await attempt(rel(['DAY', '2014-03-09', 2014, 3, 'MONTH', null, 2015, 6])), 'accepted', 'start and end precision differ')
    assert.equal(await attempt(rel(['YEAR', null, 2014, null, 'SEASON', null, 2015, null])), 'accepted')
    assert.equal(await attempt(rel(['UNKNOWN', null, null, null, 'UNKNOWN', null, null, null])), 'accepted')
    assert.match(await attempt(rel(['DAY', null, 2014, 3, 'UNKNOWN', null, null, null])), /start_shape_check|check/)
    assert.match(await attempt(rel(['DAY', '2014-03-09', 2015, 3, 'UNKNOWN', null, null, null])), /start_shape_check|check/)
    assert.match(await attempt(rel(['MONTH', '2014-03-01', 2014, 3, 'UNKNOWN', null, null, null])), /start_shape_check|check/, 'no fabricated first-of-month')
    assert.match(await attempt(rel(['YEAR', '2014-01-01', 2014, null, 'UNKNOWN', null, null, null])), /start_shape_check|check/, 'no fabricated January 1')
    assert.match(await attempt(rel(['YEAR', null, 2014, 5, 'UNKNOWN', null, null, null])), /start_shape_check|check/)
    assert.match(await attempt(rel(['UNKNOWN', null, 2014, null, 'UNKNOWN', null, null, null])), /start_shape_check|check/)
    assert.match(await attempt(rel(['WEEK', null, 2014, null, 'UNKNOWN', null, null, null])), /start_precision_check|check/)
    assert.match(await attempt(rel(['UNKNOWN', null, null, null, 'DAY', null, 2015, 3])), /end_shape_check|check/)
    assert.match(await attempt(rel(['DAY', '2015-03-09', 2015, 3, 'DAY', '2014-03-09', 2014, 3])), /period_order_check|check/)
    assert.match(await attempt(rel(['YEAR', null, 2016, null, 'YEAR', null, 2014, null])), /period_order_check|check/)
    assert.equal((await q(`select 1 from information_schema.columns where table_name = 'player_network_relationships' and column_name = 'publication_date'`)).length, 0, 'the source owns the publication date')
  })
})

test('entity-to-entity relationships: vocabulary, compatibility, no self-links, dated affiliations; none are seeded from possessive wording', async () => {
  await inTxn(async () => {
    for (const [slug, type] of [['p1', 'PERSON'], ['p2', 'PERSON'], ['ac1', 'ACADEMY'], ['pr1', 'PROGRAM'], ['pr2', 'PROGRAM'], ['ac2', 'ACADEMY'], ['lg', 'SHOWCASE_LEAGUE']]) await chain.db.exec(addEntity(slug, type))
    const rel = (subject, type, object, extra = {}) => `insert into network_entity_relationships (subject_entity_id, relationship_type, object_entity_id, source_id, evidence_basis, confidence, retrieved_at${extra.cols ?? ''})
      values (${ENT(subject)}, ${lit(type)}, ${ENT(object)}, ${SRC()}, 'MANUAL_RESEARCH', 'MEDIUM', now()${extra.vals ?? ''})`
    const ok = [['p1', 'OPERATES', 'ac1'], ['p1', 'OPERATES', 'pr1'], ['p1', 'AFFILIATED_WITH', 'ac1'], ['p1', 'AFFILIATED_WITH', 'pr1'], ['p1', 'MEMBER_OF', 'pr1'], ['pr1', 'SUCCEEDED_BY', 'pr2'], ['ac1', 'MERGED_INTO', 'ac2'], ['p1', 'MERGED_INTO', 'p2']]
    for (const [s, t, o] of ok) assert.equal(await attempt(rel(s, t, o)), 'accepted', `${s} ${t} ${o}`)
    const bad = [['p1', 'MEMBER_OF', 'ac1'], ['ac1', 'OPERATES', 'p1'], ['pr1', 'AFFILIATED_WITH', 'p1'], ['lg', 'OPERATES', 'ac1'], ['p1', 'OPERATES', 'lg'], ['pr1', 'SUCCEEDED_BY', 'ac1'], ['p1', 'SUCCEEDED_BY', 'ac1'], ['ac1', 'MERGED_INTO', 'pr1']]
    for (const [s, t, o] of bad) assert.match(await attempt(rel(s, t, o)), /does not accept/, `${s} ${t} ${o}`)
    assert.match(await attempt(rel('p1', 'MERGED_INTO', 'p1')), /self_check|check/)
    assert.match(await attempt(rel('p1', 'RENAMED_TO', 'ac1')), /relationship_type_check|check|does not accept/, 'a rename is an alias, not a relationship')
    assert.equal(await attempt(rel('p1', 'AFFILIATED_WITH', 'ac1', { cols: ', start_precision, start_year, end_precision, end_year', vals: ", 'YEAR', 2012, 'YEAR', 2016" })), 'accepted', 'dated affiliation')
    assert.equal(await attempt(`${rel('p1', 'AFFILIATED_WITH', 'ac1', { cols: ', start_precision, start_year, end_precision, end_year', vals: ", 'YEAR', 2012, 'YEAR', 2016" })}; ${rel('p1', 'AFFILIATED_WITH', 'ac1', { cols: ', start_precision, start_year, end_precision, end_year', vals: ", 'YEAR', 2017, 'UNKNOWN', null" })}`), 'accepted',
      'the same pair can be affiliated in different periods')
    assert.match(await attempt(rel('p1', 'AFFILIATED_WITH', 'ac1', { cols: ', start_precision, start_year, end_precision, end_year', vals: ", 'YEAR', 2016, 'YEAR', 2012" })), /period_order_check|check/)
  })
})

test('lifecycle: ACTIVE content is sealed, deletes are forbidden, retraction records when and why, RETRACTED is sealed', async () => {
  await inTxn(async () => {
    const id = `(select r.id from player_network_relationships r join players p on p.id = r.player_id where p.slug = 'oneil-cruz')`
    for (const set of ["stage = 'PRE_SIGNING'", "confidence = 'LOW'", "note = 'edited'", `entity_id = ${ENT('franklin-ferreras')}`, "relationship_type = 'DEVELOPED_AT'", 'start_year = 2010',
      `player_id = ${PLAYER('yordan-alvarez')}`, `source_id = ${SRC(BA2016)}`, "evidence_basis = 'OTHER'", 'retrieved_at = now()']) {
      assert.match(await attempt(`update player_network_relationships set ${set} where id = ${id}`), /ACTIVE relationship is sealed|check|signing_player/, set)
    }
    assert.match(await attempt(`delete from player_network_relationships where id = ${id}`), /never deleted/)
    assert.match(await attempt(`update player_network_relationships set record_status = 'RETRACTED' where id = ${id}`), /retraction_check|check/, 'retraction needs retracted_at and a reason')
    assert.match(await attempt(`update player_network_relationships set record_status = 'RETRACTED', retracted_at = now() where id = ${id}`), /retraction_check|check/)
    assert.match(await attempt(`update player_network_relationships set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = '  ' where id = ${id}`), /retraction_check|check/)
    assert.match(await attempt(`update player_network_relationships set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'wrong', note = 'sneaky edit' where id = ${id}`), /ACTIVE relationship is sealed/,
      'a retraction cannot carry a content change')
    await chain.db.exec(`update player_network_relationships set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'misread source' where id = ${id}`)
    assert.match(await attempt(`update player_network_relationships set note = 'x' where id = ${id}`), /RETRACTED relationship is sealed/)
    assert.match(await attempt(`update player_network_relationships set record_status = 'ACTIVE', retracted_at = null, retraction_reason = null where id = ${id}`), /RETRACTED relationship is sealed/, 'no un-retracting')
    assert.match(await attempt(`insert into player_network_relationships (player_id, entity_id, relationship_type, stage, source_id, evidence_basis, confidence, retrieved_at, record_status)
      values (${PLAYER('yordan-alvarez')}, ${ENT('raul-valera')}, 'TRAINED_WITH', 'UNKNOWN', ${SRC()}, 'OTHER', 'LOW', now(), 'RETRACTED')`), /retraction_check|starts ACTIVE|check/)
    assert.equal((await one(`select count(*)::int as n from player_network_relationships where record_status = 'ACTIVE'`)).n, 8, 'a retracted fact leaves every view')
    assert.equal((await one(`select count(*)::int as n from v_player_signing_network`)).n, 8)
    // the same lifecycle applies to entity-to-entity relationships
    await chain.db.exec(`${addEntity('p1', 'PERSON')}; ${addEntity('ac1', 'ACADEMY')}`)
    await chain.db.exec(`insert into network_entity_relationships (subject_entity_id, relationship_type, object_entity_id, source_id, evidence_basis, confidence, retrieved_at)
      values (${ENT('p1')}, 'OPERATES', ${ENT('ac1')}, ${SRC()}, 'MANUAL_RESEARCH', 'LOW', now())`)
    assert.match(await attempt(`update network_entity_relationships set confidence = 'HIGH'`), /ACTIVE relationship is sealed/)
    assert.match(await attempt(`delete from network_entity_relationships`), /never deleted/)
    await chain.db.exec(`update network_entity_relationships set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'unsupported'`)
    assert.match(await attempt(`update network_entity_relationships set confidence = 'HIGH'`), /RETRACTED relationship is sealed/)
  })
})

test('supersession: a correction is a new ACTIVE row naming its predecessor, which is retired in the same statement; invalid chains are impossible', async () => {
  await inTxn(async () => {
    const cruz = `(select r.id from player_network_relationships r join players p on p.id = r.player_id where p.slug = 'oneil-cruz')`
    await chain.db.exec(addEntity('other-person', 'PERSON'))
    const correction = (o = {}) => `insert into player_network_relationships (player_id, entity_id, relationship_type, stage, source_id, evidence_basis, confidence, retrieved_at, supersedes_relationship_id)
      values (${PLAYER(o.player ?? 'oneil-cruz')}, ${ENT(o.entity ?? 'other-person')}, ${lit(o.type ?? 'TRAINED_WITH')}, 'UNKNOWN', ${SRC()}, 'MANUAL_RESEARCH', 'MEDIUM', now(), ${o.supersedes ?? cruz})`
    // valid: the replacement entity may differ (identity correction); the predecessor is retired atomically with a recorded reason
    await chain.db.exec(correction())
    const rows = await q(`select e.slug, r.record_status, r.retraction_reason, r.supersedes_relationship_id is not null as is_correction from player_network_relationships r join players p on p.id = r.player_id
      join network_entities e on e.id = r.entity_id where p.slug = 'oneil-cruz' order by r.record_status`)
    assert.deepEqual(rows, [{ slug: 'other-person', record_status: 'ACTIVE', retraction_reason: null, is_correction: true },
      { slug: 'raul-valera', record_status: 'RETRACTED', retraction_reason: 'Superseded by a corrected relationship.', is_correction: false }])
    assert.deepEqual(await q(`select e.slug from v_player_signing_network v join network_entities e on e.id = v.entity_id where v.player_slug = 'oneil-cruz'`), [{ slug: 'other-person' }], 'only the correction is current')
    // the retired predecessor's content is untouched
    assert.equal((await one(`select r.note is not null as has_note from player_network_relationships r where r.record_status = 'RETRACTED'`)).has_note, true)
  })
  await inTxn(async () => {
    const cruz = `'${(await one(`select r.id from player_network_relationships r join players p on p.id = r.player_id where p.slug = 'oneil-cruz'`)).id}'`
    await chain.db.exec(`${addEntity('other-person', 'PERSON')}; ${addEntity('an-academy', 'ACADEMY')}`)
    const correction = (o = {}) => `insert into player_network_relationships (player_id, entity_id, relationship_type, stage, source_id, evidence_basis, confidence, retrieved_at, supersedes_relationship_id)
      values (${PLAYER(o.player ?? 'oneil-cruz')}, ${ENT(o.entity ?? 'other-person')}, ${lit(o.type ?? 'TRAINED_WITH')}, 'UNKNOWN', ${SRC()}, 'MANUAL_RESEARCH', 'MEDIUM', now(), ${o.supersedes ?? cruz})`
    assert.match(await attempt(correction({ player: 'yordan-alvarez' })), /same player and type/, 'a different player')
    assert.match(await attempt(correction({ type: 'REPRESENTED_BY' })), /same player and type/, 'a different relationship type')
    assert.match(await attempt(correction({ supersedes: `'00000000-0000-4000-8000-000000000000'` })), /same player and type/, 'a predecessor that does not exist')
    assert.match(await attempt(correction({ entity: 'an-academy' })), /does not accept/, 'the replacement entity must satisfy compatibility')
    assert.match(await attempt(`${correction()}; ${correction({ entity: 'franklin-ferreras' })}`), /supersedes_key|duplicate key/, 'at most one replacement per predecessor')
    assert.match(await attempt(`${correction()}; update player_network_relationships set supersedes_relationship_id = (select id from player_network_relationships where entity_id = ${ENT('other-person')}) where id = ${cruz}`),
      /RETRACTED relationship is sealed/, 'a retired predecessor cannot be edited into a cycle')
    assert.match(await attempt(`update player_network_relationships set supersedes_relationship_id = id where id = ${cruz}`), /sealed|supersedes_check|check/, 'no self-supersession')
    // a replacement may also supersede an already RETRACTED row once
    await chain.db.exec(`update player_network_relationships set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'misread' where id = ${cruz}`)
    assert.equal(await attempt(correction()), 'accepted')
    // entity-to-entity corrections: same type, shares subject or object
    await chain.db.exec(`${addEntity('p1', 'PERSON')}; ${addEntity('p2', 'PERSON')}; ${addEntity('ac1', 'ACADEMY')}; ${addEntity('ac2', 'ACADEMY')}`)
    await chain.db.exec(`insert into network_entity_relationships (subject_entity_id, relationship_type, object_entity_id, source_id, evidence_basis, confidence, retrieved_at)
      values (${ENT('p1')}, 'AFFILIATED_WITH', ${ENT('ac1')}, ${SRC()}, 'MANUAL_RESEARCH', 'LOW', now())`)
    const first = `(select id from network_entity_relationships limit 1)`
    const ner = (s, t, o) => `insert into network_entity_relationships (subject_entity_id, relationship_type, object_entity_id, source_id, evidence_basis, confidence, retrieved_at, supersedes_relationship_id)
      values (${ENT(s)}, ${lit(t)}, ${ENT(o)}, ${SRC()}, 'MANUAL_RESEARCH', 'MEDIUM', now(), ${first})`
    assert.match(await attempt(ner('p1', 'OPERATES', 'ac1')), /same type that shares/)
    assert.match(await attempt(ner('p2', 'AFFILIATED_WITH', 'ac2')), /same type that shares/, 'neither subject nor object is shared')
    assert.equal(await attempt(ner('p2', 'AFFILIATED_WITH', 'ac1')), 'accepted', 'a corrected subject keeps the object')
    assert.equal(await attempt(ner('p1', 'AFFILIATED_WITH', 'ac2')), 'accepted', 'a corrected object keeps the subject')
    assert.match(await attempt(`${ner('p2', 'AFFILIATED_WITH', 'ac1')}; ${ner('p1', 'AFFILIATED_WITH', 'ac2')}`), /supersedes_key|duplicate key/)
  })
})

// ---------------------------------------------------------------------------------------------
// views, coverage and the queue
// ---------------------------------------------------------------------------------------------

test('views: security_invoker, SELECT-only, ACTIVE only, join-not-copy, and no WAR / bonus / success credit anywhere', async () => {
  const names = ['v_player_signing_network', 'v_network_entity_player_history', 'v_dodgers_network_coverage', 'v_network_research_queue']
  for (const v of names) {
    const meta = await one(`select coalesce(array_to_string(c.reloptions, ','), '') as opts from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = $1`, [v])
    assert.match(meta.opts, /security_invoker=(true|on)/, v)
  }
  const defs = Object.fromEntries((await q(`select c.relname, pg_get_viewdef(c.oid) as d from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any($1)`, [names])).map((r) => [r.relname, r.d]))
  for (const [v, d] of Object.entries(defs)) {
    assert.doesNotMatch(d, /career_war|v_player_war|bwar|fwar|player_metric_observations|model_predictions/i, `${v} reads no performance or model data`)
    assert.doesNotMatch(d, /\b(sum|avg)\s*\(/i, `${v} credits nothing to an entity`)
  }
  const columns = await q(`select c.relname, a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and a.attnum > 0 and not a.attisdropped`, [names])
  assert.deepEqual(columns.filter((c) => /war|credit|success|win_rate|roi|rank_score/i.test(c.attname)), [], 'no credit, success or ranking column')
  assert.deepEqual(columns.filter((c) => c.relname !== 'v_player_signing_network' && /bonus/i.test(c.attname)), [], 'only the player view joins the signing bonus, as a fact about the signing')
  // v_player_signing_network: 9 rows, signing context joined, latest scouting context joined
  const rows = await q(`select player_slug, relationship_type, stage, entity_name, relationship_tied_to_signing, signing_year, signing_bonus_usd::int as bonus, country_market from v_player_signing_network order by player_slug, relationship_type, entity_name`)
  assert.equal(rows.length, 9)
  const heredia = rows.find((r) => r.player_slug === 'starling-heredia' && r.relationship_type === 'TRAINED_WITH')
  assert.deepEqual([heredia.signing_year, heredia.bonus, heredia.country_market, heredia.relationship_tied_to_signing], [2015, 2600000, 'Dominican Republic', true])
  const cruz = rows.find((r) => r.player_slug === 'oneil-cruz')
  assert.deepEqual([cruz.signing_year, cruz.relationship_tied_to_signing], [2015, false], 'an unlinked relationship still shows the player\'s signing, but says it is not tied to it')
  // v_network_entity_player_history: counts and lists, per entity
  const hist = Object.fromEntries((await q(`select entity_slug, relationship_count, distinct_players, relationship_types, player_slugs, first_signing_year from v_network_entity_player_history`)).map((r) => [r.entity_slug, r]))
  assert.equal(Object.keys(hist).length, 9)
  assert.deepEqual([hist['international-prospect-league'].relationship_count, hist['international-prospect-league'].distinct_players, hist['international-prospect-league'].player_slugs], [2, 2, 'christopher-arias, ronny-brito'])
  assert.deepEqual([hist['yasser-mendez'].relationship_count, hist['yasser-mendez-academy'].relationship_count], [0, 1], 'the person and the descriptive academy are counted separately')
  assert.deepEqual(hist['franklin-ferreras-program'].relationship_types, ['DEVELOPED_AT'])
})

test('coverage: the primary denominator is the 64 Dodgers Latin American / Cuban amateur signings with a signal; 5 attributed, 59 missing; CUBAN_PRO is a separate segment', async () => {
  const primary = await q(`select breakdown, breakdown_value, signings, with_network_attribution, without_network_attribution, attribution_percent::float as pct, mlb_reached_signings, mlb_reached_without_attribution, is_primary_denominator
    from v_dodgers_network_coverage where coverage_segment = 'PRIMARY_LATIN_AMERICAN_CUBAN_AMATEUR' order by breakdown, breakdown_value`)
  const all = primary.find((r) => r.breakdown === 'ALL')
  assert.deepEqual([all.signings, all.with_network_attribution, all.without_network_attribution, all.mlb_reached_signings, all.mlb_reached_without_attribution, all.is_primary_denominator], [64, 5, 59, 36, 34, true])
  assert.equal(all.pct, 7.8)
  for (const breakdown of ['SIGNING_ERA', 'COUNTRY_MARKET']) {
    const part = primary.filter((r) => r.breakdown === breakdown)
    assert.equal(part.reduce((s, r) => s + r.signings, 0), 64, `${breakdown} breakdown sums to the denominator`)
    assert.equal(part.reduce((s, r) => s + r.with_network_attribution, 0), 5)
  }
  const cuban = await q(`select signings, with_network_attribution, is_primary_denominator, denominator_definition from v_dodgers_network_coverage where coverage_segment = 'CUBAN_PRO' and breakdown = 'ALL'`)
  assert.deepEqual([cuban[0].signings, cuban[0].with_network_attribution, cuban[0].is_primary_denominator], [3, 0, false])
  assert.match(cuban[0].denominator_definition, /never blended into the primary denominator/)
  assert.match(all.denominator_definition ?? (await one(`select denominator_definition from v_dodgers_network_coverage where coverage_segment = 'PRIMARY_LATIN_AMERICAN_CUBAN_AMATEUR' and breakdown = 'ALL'`)).denominator_definition, /not all international signings/)
  assert.equal((await one(`select count(distinct coverage_segment)::int as n from v_dodgers_network_coverage`)).n, 2)
  // independent oracle for the denominator
  const oracle = await one(`select count(*)::int as n from signings s join organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
    where s.pathway::text in ('LATAM_AMATEUR', 'CUBAN_AMATEUR') and (s.bonus_publicly_reported or s.international_rank is not null
      or exists (select 1 from outcome_audits oa where oa.player_id = s.player_id and oa.reached_mlb_verified))`)
  assert.equal(oracle.n, 64)
})

test('research queue: 59 missing-attribution signings (MLB reach is priority, not a duplicate issue), 2 unknown-stage relationships; empty issue types stay empty', async () => {
  const issues = Object.fromEntries((await q(`select issue, count(*)::int as n from v_network_research_queue group by 1 order by 1`)).map((r) => [r.issue, r.n]))
  assert.deepEqual(issues, { RELATIONSHIP_STAGE_UNKNOWN: 2, SIGNING_WITHOUT_NETWORK_ATTRIBUTION: 59 })
  assert.deepEqual(await q(`select priority, mlb_reached, count(*)::int as n from v_network_research_queue where issue = 'SIGNING_WITHOUT_NETWORK_ATTRIBUTION' group by 1, 2 order by 1, 2`),
    [{ priority: 1, mlb_reached: true, n: 34 }, { priority: 2, mlb_reached: false, n: 25 }])
  assert.equal((await one(`select count(distinct player_id)::int as n from v_network_research_queue where issue = 'SIGNING_WITHOUT_NETWORK_ATTRIBUTION'`)).n, 59, 'one row per player, not a duplicate MLB row')
  assert.deepEqual((await q(`select player_slug from v_network_research_queue where issue = 'RELATIONSHIP_STAGE_UNKNOWN' order by 1`)).map((r) => r.player_slug), ['oneil-cruz', 'starling-heredia'])
  // the attributed five and the researched no-attribution cases outside the denominator are not queued as missing
  const queued = new Set((await q(`select player_slug from v_network_research_queue where issue = 'SIGNING_WITHOUT_NETWORK_ATTRIBUTION'`)).map((r) => r.player_slug))
  for (const slug of ['oneil-cruz', 'starling-heredia', 'ronny-brito', 'christopher-arias', 'jorbit-vivas']) assert.ok(!queued.has(slug), slug)
  assert.ok(queued.has('yadier-alvarez') && queued.has('omar-estevez'), 'Cuban amateur signings with no stated network are queued honestly')
  assert.ok(!queued.has('yusniel-diaz'), 'CUBAN_PRO stays out of the primary queue')
  await inTxn(async () => {
    // an OPEN identity review and a nickname-only entity raise the other two issues; resolving the review clears it
    await chain.db.exec(`${addEntity('nick-only', 'PERSON', { basis: 'NICKNAME_ONLY', name: 'Vampirin' })}`)
    const [a, b] = (await q(`select id from network_entities where slug in ('raul-valera', 'franklin-ferreras') order by id`)).map((r) => r.id)
    await chain.db.exec(`insert into network_entity_identity_reviews (entity_a_id, entity_b_id, reason) values ('${a}', '${b}', 'possible same person')`)
    const now = Object.fromEntries((await q(`select issue, count(*)::int as n from v_network_research_queue group by 1`)).map((r) => [r.issue, r.n]))
    assert.deepEqual([now.POSSIBLE_DUPLICATE_NETWORK_ENTITY, now.UNRESOLVED_NETWORK_IDENTITY], [1, 1])
    await chain.db.exec(`update network_entity_identity_reviews set status = 'DISTINCT', reviewed_at = now()`)
    assert.equal((await one(`select count(*)::int as n from v_network_research_queue where issue = 'POSSIBLE_DUPLICATE_NETWORK_ENTITY'`)).n, 0)
    // attributing a queued signing removes it from the queue and raises coverage
    await chain.db.exec(`${addEntity('t-person', 'PERSON')}; ${addRel({ player: 'yadier-alvarez', type: 'TRAINED_WITH', entity: 't-person' })}`)
    const cov = await one(`select with_network_attribution as a, without_network_attribution as m from v_dodgers_network_coverage where coverage_segment = 'PRIMARY_LATIN_AMERICAN_CUBAN_AMATEUR' and breakdown = 'ALL'`)
    assert.deepEqual(cov, { a: 6, m: 58 })
  })
  const vocab = (await q(`select distinct issue from v_network_research_queue`)).map((r) => r.issue)
  assert.ok(!vocab.includes('NETWORK_ALIAS_REVIEW') && !vocab.includes('SOURCE_UNAVAILABLE'))
})

test('dossier: the app reads the new network view (tolerantly) and no longer references the legacy trainer objects', async () => {
  const data = fs.readFileSync(path.join(root, 'lib/data.js'), 'utf8')
  const page = fs.readFileSync(path.join(root, 'app/players/[slug]/page.js'), 'utf8')
  assert.match(data, /from\('v_player_signing_network'\)/)
  assert.doesNotMatch(data, /v_player_trainers|v_dodgers_trainer_network|player_trainers/)
  assert.match(data, /networkAvailable/)
  assert.doesNotMatch(page, /trainer_name|academy_name|\btrainers\b/)
  assert.match(page, /No verified network attribution is stored/)
  assert.match(page, /not causes/)
  for (const column of ['relationship_id', 'entity_name', 'relationship_type', 'entity_type', 'name_basis', 'stage', 'confidence', 'relationship_tied_to_signing', 'source_url', 'source_title']) {
    assert.ok((await q(`select 1 from information_schema.columns where table_name = 'v_player_signing_network' and column_name = $1`, [column])).length === 1, column)
  }
})

// ---------------------------------------------------------------------------------------------
// security, verifier, regression, rerun
// ---------------------------------------------------------------------------------------------

test('security: RLS and SELECT-only for anon / authenticated on every new object, no write policy, helper functions invoker-rights with EXECUTE revoked, whole surface clean', async () => {
  const tables = ['network_entities', 'network_entity_aliases', 'network_entity_relationships', 'player_network_relationships', 'network_entity_identity_reviews']
  const views = ['v_player_signing_network', 'v_network_entity_player_history', 'v_dodgers_network_coverage', 'v_network_research_queue']
  for (const t of tables) {
    const m = await one(`select c.relrowsecurity as rls from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = $1`, [t])
    assert.equal(m.rls, true, t)
    assert.deepEqual((await q(`select policyname, cmd from pg_policies where schemaname = 'public' and tablename = $1`, [t])).map((p) => p.cmd), ['SELECT'], t)
  }
  const acl = await q(`select c.relname, coalesce(r.rolname, 'PUBLIC') as grantee, string_agg(a.privilege_type, ',' order by a.privilege_type) as privs
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and coalesce(r.rolname, 'PUBLIC') in ('anon', 'authenticated', 'PUBLIC') group by 1, 2 order by 1, 2`, [[...tables, ...views]])
  assert.equal(acl.length, 18, '9 relations x anon + authenticated')
  assert.ok(acl.every((a) => a.privs === 'SELECT' && a.grantee !== 'PUBLIC'))
  const fns = await q(`select p.proname, p.prosecdef, p.proconfig::text as cfg, has_function_privilege('anon', p.oid, 'execute') as a, has_function_privilege('authenticated', p.oid, 'execute') as b from pg_proc p
    where p.pronamespace = 'public'::regnamespace and (p.proname like 'disi\\_network\\_%' or p.proname = 'disi_player_network_guard')`)
  assert.equal(fns.length, 4)
  assert.ok(fns.every((f) => f.prosecdef === false && /search_path/.test(f.cfg) && f.a === false && f.b === false))
  const whole = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity)::int as no_rls,
    (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v' and coalesce(array_to_string(c.reloptions, ','), '') !~ 'security_invoker=(true|on)')::int as not_invoker,
    (select count(*) from pg_policies where schemaname = 'public' and cmd <> 'SELECT')::int as write_policies`)
  assert.deepEqual(whole, { no_rls: 0, not_invoker: 0, write_policies: 0 })
})

test('verifier queries: every network structural check passes on the seeded database and each fails on its own kind of damage', async () => {
  for (const [name, sql] of Object.entries(NETWORK_QUERIES)) assert.equal((await one(sql)).n, 0, name)
  for (const [name, sql] of Object.entries(RECONCILIATION_QUERIES)) assert.equal((await one(sql)).n, 0, name)
  const damage = async (sql, ...failing) => inTxn(async () => {
    await chain.db.exec(sql)
    const failed = []
    for (const [name, query] of Object.entries(NETWORK_QUERIES)) if ((await one(query)).n !== 0) failed.push(name)
    assert.deepEqual(failed.sort(), failing.sort(), sql.slice(0, 80))
  })
  const dis = () => 'set local session_replication_role = replica;'
  await damage(`create table public.trainers (id int);`, 'network_legacy_trainer_objects_present')
  await damage(`${dis()} update public.network_entities set descriptor_anchor_entity_id = null where slug = 'yasser-mendez-academy';`, 'network_entity_anchor_violations')
  await damage(`${dis()} alter table public.network_entity_aliases drop column lookup_key; alter table public.network_entity_aliases add column lookup_key text; update public.network_entity_aliases set lookup_key = 'wrong';`, 'network_alias_violations')
  await damage(`${dis()} update public.player_network_relationships set relationship_type = 'SHOWCASED_IN' where relationship_type = 'DEVELOPED_AT';`, 'network_relationship_compatibility_violations')
  await damage(`${dis()} alter table public.player_network_relationships drop constraint player_network_relationships_signing_player_fkey;
    update public.player_network_relationships set signing_id = (select id from public.signings where player_id = (select id from public.players where slug = 'yordan-alvarez')) where relationship_type = 'SIGNED_OUT_OF';`, 'network_signing_player_mismatches')
  await damage(`${dis()} alter table public.player_network_relationships drop constraint player_network_relationships_start_shape_check;
    update public.player_network_relationships set start_precision = 'MONTH' where relationship_type = 'SIGNED_OUT_OF';`, 'network_period_violations')
  await damage(`${dis()} alter table public.player_network_relationships drop constraint player_network_relationships_retraction_check;
    update public.player_network_relationships set record_status = 'RETRACTED' where relationship_type = 'SIGNED_OUT_OF';`, 'network_supersession_violations')
  await damage(`drop trigger network_entity_relationships_guard on public.network_entity_relationships;`, 'network_guard_trigger_violations')
  await damage(`drop trigger player_network_relationships_guard on public.player_network_relationships; create trigger player_network_relationships_guard before insert or update on public.player_network_relationships for each row execute function public.disi_player_network_guard();`, 'network_guard_trigger_violations')
  await damage(`insert into public.network_entity_identity_reviews (entity_a_id, entity_b_id, reason) select least(a.id, b.id), greatest(a.id, b.id), 'x' from public.network_entities a, public.network_entities b where a.slug = 'raul-valera' and b.slug = 'franklin-ferreras';
    alter table public.network_entity_identity_reviews drop constraint network_entity_identity_reviews_decision_check; update public.network_entity_identity_reviews set reviewed_at = now();`, 'network_identity_review_violations')
  await damage(`grant execute on function public.disi_network_lookup_key(text) to anon;`, 'network_normalizer_violations')
  await damage(`alter function public.disi_network_lookup_key(text) volatile;`, 'network_normalizer_violations')
  // coverage is research progress, not an invariant: attributing more signings fails nothing
  await damage(`${addEntity('t-person', 'PERSON')}; ${addRel({ player: 'yadier-alvarez', type: 'TRAINED_WITH', entity: 't-person' })}`)
})

test('029 is additive plus the guarded legacy drop: no data-bearing table other than the two registered sources and the new network tables changes; no network table carries scouting, development, WAR or bonus columns', async () => {
  const forbidden = await q(`select table_name, column_name from information_schema.columns where table_schema = 'public'
    and (table_name like 'network\\_%' or table_name = 'player_network_relationships')
    and column_name ~* 'war|bonus|rank|fv|future_value|grade|milestone|level|salary|credit|score'`)
  assert.deepEqual(forbidden, [], 'network tables hold no FV, rank, grade, development, WAR or bonus fact')
  const code = sql029.replace(/--[^\n]*/g, '')
  assert.doesNotMatch(code, /full_name\s*=|canonical_name\s*=\s*['"]/i, 'no player name is a key')
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  assert.ok(frozen['028_residual_canonical_drift_reconciliation.sql'], '028 is part of the frozen baseline')
  assert.equal(frozen[FILE], undefined, '029 itself is not yet frozen')
  const backlog = fs.readFileSync(path.join(root, 'database/research/029/research-backlog.md'), 'utf8')
  for (const name of ['Emil Morales', 'Rubel Arias', 'Ezequiel Melburne', 'Joendry Vargas']) assert.ok(backlog.includes(name), name)
})

test('rerun is a no-op: the committed migration applied again changes no row, grant, policy or definition', async () => {
  const snapshot = async () => ({ tables: await tableHashes(), security: await securityHash(),
    funcs: md5(await q(`select proname, pg_get_functiondef(oid) as d from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'disi\\_network\\_%' or proname = 'disi_player_network_guard') order by 1`)),
    views: md5(await q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)) })
  const first = await snapshot()
  await chain.db.exec(sql029)
  assert.deepEqual(await snapshot(), first)
  assert.deepEqual(await one(`select (select count(*) from network_entities)::int as e, (select count(*) from player_network_relationships)::int as r, (select count(*) from network_entity_aliases)::int as a`), { e: 9, r: 9, a: 1 })
})
