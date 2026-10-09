// Migration 027 - canonical seed drift reconciliation.
//
// Both allowed starting states are exercised on a 001-026 database: the canonical replay
// (state A) and the KNOWN live drift (state B). Scenarios run inside rolled-back
// transactions, so the shared database stays pristine until the final rerun test, which
// commits. Unexpected third states must abort the whole migration.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { cats027, driftParts, liveDriftSql, lit, withoutTransaction } from './drift-027.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '027_canonical_seed_drift_reconciliation.sql'
const sql027 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const inner = withoutTransaction(sql027)

let chain
const q = (sql, params) => chain.query(sql, params)
const one = async (sql) => (await q(sql))[0]
before(async () => { chain = await buildChainThrough('026_scouting_evaluation_history.sql') }, { timeout: 180000 })
after(async () => { await chain.close() })

const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
/** Runs `body` in a transaction that is always rolled back. */
async function inTxn(body) {
  await chain.db.exec('begin;')
  try { return await body() } finally { await chain.db.exec('rollback;') }
}
/** Resolves to the error message of `sql` (or 'accepted'); always rolled back. */
async function attempt(sql) {
  await chain.db.exec('begin;')
  try { await chain.db.exec(sql); return 'accepted' } catch (e) { return String(e.message) } finally { await chain.db.exec('rollback;') }
}

/** The semantic content of every table the reconciliation touches, by natural keys only (no ids, no timestamps). */
async function content() {
  const c = {}
  c.environments = await q(`select o.name as org, e.signing_year, e.regime::text, e.club_bonus_pool_usd::text, e.pool_after_trades_usd::text, e.signing_period_label,
    e.max_individual_bonus_usd::text, e.overage_tax_rate::text, e.tradeable_pool_space, e.penalty_status, e.rules_summary, e.cba_regime, e.notes
    from signing_environments e join organizations o on o.id = e.organization_id order by 1, 2`)
  c.links = await q(`select p.slug, o.name as org, s.signing_year, eo.name as env_org, e.signing_year as env_year
    from signings s join players p on p.id = s.player_id join organizations o on o.id = s.organization_id
    left join signing_environments e on e.id = s.signing_environment_id left join organizations eo on eo.id = e.organization_id order by 1, 2, 3`)
  c.transactions = await q(`select p.slug, t.transaction_date::text, t.transaction_type, fo.name as from_org, too.name as to_org, t.return_description, t.estimated_org_value_war::text,
    t.estimated_org_value_usd::text, t.value_model_version, t.notes, so.url, t.confidence::text
    from transactions t join players p on p.id = t.player_id left join organizations fo on fo.id = t.from_organization_id left join organizations too on too.id = t.to_organization_id
    left join sources so on so.id = t.source_id order by 1, 2, 3`)
  c.aliases = await q(`select p.slug, a.alias, a.alias_type, a.language_code from player_aliases a join players p on p.id = a.player_id order by 1, 2`)
  c.sources = await q(`select url, source_name, source_type, title, author, publication_date::text, notes, source_tier from sources order by url`)
  c.evidence = (await q(`select e.entity_type, case when e.entity_type = 'signing' then p.slug || '|' || o.name || '|' || s.signing_year else pl.slug end as entity_key,
      coalesce(e.field_name, '') as field_name, so.url, e.confidence::text, coalesce(e.evidence_note, '') as note
    from evidence e left join signings s on e.entity_type = 'signing' and s.id = e.entity_id left join players p on p.id = s.player_id left join organizations o on o.id = s.organization_id
    left join players pl on e.entity_type = 'player' and pl.id = e.entity_id join sources so on so.id = e.source_id`))
    .map((r) => JSON.stringify(r)).sort()
  c.trainers = await q(`select name, academy_name, country, city, notes from trainers order by 1`)
  c.trainerLinks = await q(`select p.slug, t.name, pt.relationship_type, pt.confidence::text from player_trainers pt join players p on p.id = pt.player_id join trainers t on t.id = pt.trainer_id order by 1, 2`)
  return c
}
const hashes = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, md5(v)]))
const nonTrainer = (h) => { const { trainers, trainerLinks, ...rest } = h; return rest }

const NEUTRAL = cats027.evidence_note_neutralizations.neutral_note
const AFFECTED_VIEWS = ['v_dodgers_signing_cohort', 'v_dodgers_signing_leaderboard', 'v_player_signing_profile', 'v_signing_efficiency', 'v_dodgers_asset_realization',
  'v_signing_asset_outcomes', 'v_dodgers_executive_case_studies', 'v_dodgers_mature_asset_realization', 'v_player_sources', 'v_player_transactions', 'v_player_timeline',
  'v_dodgers_signing_year_summary', 'v_player_bio', 'v_player_directory', 'v_player_identity_scope', 'v_dodgers_player_identity_coverage', 'v_signing_records',
  'v_dodgers_class_source_reconciliation']
/** Row sets of the views with uuid and retrieval/access-timestamp columns removed (substantive content only). */
async function viewContent() {
  const out = {}
  for (const v of AFFECTED_VIEWS) {
    const cols = (await q(`select a.attname, format_type(a.atttypid, a.atttypmod) as t from pg_attribute a where a.attrelid = 'public.${v}'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`))
      .filter((c) => c.t !== 'uuid' && !/^(accessed|retrieved)/.test(c.attname))
    const rows = await q(`select ${cols.map((c) => `"${c.attname}"::text as "${c.attname}"`).join(', ')} from public.${v}`)
    out[v] = md5(rows.map((r) => JSON.stringify(r)).sort())
  }
  return out
}
const diffKeys = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k])

async function untouched() {
  return {
    scouting: md5(await q(`select (select count(*) from player_evaluations), (select md5(string_agg(e::text, '|' order by e.id)) from player_evaluations e),
      (select md5(string_agg(g::text, '|' order by g.id)) from player_evaluation_grades g), (select md5(string_agg(r::text, '|' order by r.id)) from player_evaluation_rankings r),
      (select md5(string_agg(n::text, '|' order by n.id)) from player_evaluation_notes n)`)),
    development: md5(await q(`select (select md5(string_agg(s::text, '|' order by s.id)) from player_season_stints s), (select md5(string_agg(m::text, '|' order by m.id)) from development_milestones m),
      (select md5(string_agg(d::text, '|' order by d.id)) from development_progression_decisions d), (select md5(string_agg(x::text, '|' order by x.player_id)) from player_development_status x)`)),
    security: md5(await q(`select
      (select jsonb_agg(jsonb_build_array(c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type) order by c.relname, 2, 3) from pg_class c
         cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v')),
      (select jsonb_agg(jsonb_build_array(relname, relrowsecurity, reloptions::text) order by relname) from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v')),
      (select jsonb_agg(jsonb_build_array(tablename, policyname, cmd) order by tablename, policyname) from pg_policies where schemaname = 'public'),
      (select jsonb_agg(jsonb_build_array(proname, prosecdef, proconfig::text, proacl::text) order by proname, oid) from pg_proc where pronamespace = 'public'::regnamespace),
      (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'), (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')`)),
  }
}

let stateA // content hashes and view hashes after 027 on the canonical replay

test('state A (canonical replay): 027 changes only the unsupported trainer seed; every other canonical fact is untouched', async () => {
  await inTxn(async () => {
    const before = await content()
    const beforeH = hashes(before)
    assert.equal(before.trainers.length, 2)
    assert.equal(before.trainerLinks.length, 4)
    assert.equal(before.environments.length, 8)
    assert.equal(before.links.filter((l) => l.env_org).length, 30)
    assert.equal(before.transactions.length, 5)
    assert.equal(before.aliases.length, 50)
    const guard = await untouched()
    await chain.db.exec(inner)
    const after = await content()
    const afterH = hashes(after)
    // a canonical replay already holds every reconciled fact; the only change besides the trainer seed is the three neutralised notes
    const { evidence: evAfterH, ...restAfter } = nonTrainer(afterH)
    const { evidence: evBeforeH, ...restBefore } = nonTrainer(beforeH)
    assert.deepEqual(restAfter, restBefore)
    assert.notEqual(evAfterH, evBeforeH)
    const removed = before.evidence.filter((r) => !after.evidence.includes(r)).map((r) => JSON.parse(r))
    const added = after.evidence.filter((r) => !before.evidence.includes(r)).map((r) => JSON.parse(r))
    assert.deepEqual(removed.map((r) => r.entity_key).sort(), ['emil-morales|Los Angeles Dodgers|2024', 'ezequiel-melburne|Los Angeles Dodgers|2026', 'rubel-arias|Los Angeles Dodgers|2026'])
    assert.deepEqual(added.map((r) => r.entity_key).sort(), removed.map((r) => r.entity_key).sort())
    assert.ok(removed.every((r) => /trainer/i.test(r.note)) && added.every((r) => r.note === NEUTRAL && r.confidence === 'HIGH'))
    assert.deepEqual(added.map((r) => r.url).sort(), removed.map((r) => r.url).sort(), 'the signing / source provenance is untouched')
    assert.deepEqual([after.trainers.length, after.trainerLinks.length], [0, 0])
    // the legacy structures stay until 028
    const legacy = await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname in ('trainers', 'player_trainers', 'v_player_trainers', 'v_dodgers_trainer_network') order by 1`)
    assert.deepEqual(legacy.map((l) => l.relname), ['player_trainers', 'trainers', 'v_dodgers_trainer_network', 'v_player_trainers'])
    assert.deepEqual(await untouched(), guard, '025 security, 026 scouting and development are unchanged')
    stateA = { content: afterH, views: await viewContent() }
  })
})

test('state B (the known live drift): the same migration converges to exactly the state-A result', async () => {
  assert.ok(stateA, 'state A runs first')
  await inTxn(async () => {
    await chain.db.exec(liveDriftSql())
    const drifted = await content()
    // it really is the live drift
    assert.deepEqual([drifted.environments.length, drifted.links.filter((l) => l.env_org).length, drifted.transactions.length, drifted.aliases.length, drifted.trainers.length, drifted.trainerLinks.length],
      [0, 0, 4, 48, 0, 0])
    for (const s of cats027.sources_missing.entries) assert.equal((await q(`select 1 from sources where url = ${lit(s.selector.url)}`)).length, 0)
    const driftedViews = await viewContent()
    assert.ok(diffKeys(driftedViews, stateA.views).length >= 10, 'the drift is visible in the affected public views')
    const guard = await untouched()
    await chain.db.exec(inner)
    const repaired = await content()
    assert.deepEqual(hashes(repaired), stateA.content, 'live-drift state and canonical replay hold the same content after 027')
    assert.equal(repaired.environments.length, 8)
    assert.equal(repaired.links.filter((l) => l.env_org).length, 30)
    assert.equal(repaired.transactions.length, 5)
    assert.equal(repaired.aliases.length, 50)
    const repairedViews = await viewContent()
    assert.deepEqual(diffKeys(repairedViews, stateA.views), [], `affected views still differ: ${diffKeys(repairedViews, stateA.views)}`)
    assert.deepEqual(await untouched(), guard)
  })
})

test('each reconciled category lands exactly on its manifest facts', async () => {
  await inTxn(async () => {
    await chain.db.exec(liveDriftSql())
    await chain.db.exec(inner)
    // environments and links
    for (const e of cats027.signing_environments.entries) {
      const r = await one(`select se.regime::text, se.club_bonus_pool_usd::text as pool from signing_environments se join organizations o on o.id = se.organization_id
        where o.name = ${lit(e.selector.organization_name)} and se.signing_year = ${e.selector.signing_year}`)
      assert.deepEqual([r.regime, r.pool], [e.canonical.regime, e.canonical.club_bonus_pool_usd])
    }
    assert.equal((await one(`select count(*)::int as n from signings where signing_environment_id is not null`)).n, 30)
    // Lantigua -> Cincinnati, once
    const tx = await q(`select p.slug, t.transaction_date::text as d, t.return_description, fo.name as f, too.name as t from transactions t join players p on p.id = t.player_id
      join organizations fo on fo.id = t.from_organization_id join organizations too on too.id = t.to_organization_id where p.slug = 'arnaldo-lantigua'`)
    assert.deepEqual(tx, [{ slug: 'arnaldo-lantigua', d: '2025-01-17', return_description: 'Traded to Cincinnati Reds for future considerations', f: 'Los Angeles Dodgers', t: 'Cincinnati Reds' }])
    // exactly the two committed aliases, nothing else added
    assert.deepEqual(await q(`select p.slug, a.alias from player_aliases a join players p on p.id = a.player_id where a.alias in ('Oneal Cruz', 'Yadiel Alvarez') order by 2`),
      [{ slug: 'oneil-cruz', alias: 'Oneal Cruz' }, { slug: 'yadier-alvarez', alias: 'Yadiel Alvarez' }])
    assert.equal((await one(`select count(*)::int as n from player_aliases`)).n, 50)
    // sources: the 12 restored, the 3 variants canonical
    const urls = cats027.sources_missing.entries.map((s) => s.selector.url)
    const present = await q(`select url from sources where url = any($1::text[])`, [urls])
    assert.equal(present.length, 12)
    for (const v of cats027.source_metadata_variants.entries) {
      const r = await one(`select source_type, title, source_tier, publication_date::text as pub from sources where url = ${lit(v.selector.url)}`)
      assert.deepEqual([r.source_type, r.title, r.source_tier, r.pub], [v.canonical.source_type, v.canonical.title, v.canonical.source_tier, v.canonical.publication_date])
    }
    // evidence: 32 canonical claims once each; the 3 live variants are gone (updated in place, none duplicated)
    let present32 = 0
    for (const c of [...cats027.evidence_missing.entries, ...cats027.evidence_variants.entries, ...cats027.evidence_note_neutralizations.entries]) {
      const r = await q(`select e.confidence::text as c, e.evidence_note as n from evidence e where e.entity_type = 'signing'
        and e.entity_id = (select sg.id from signings sg join players p on p.id = sg.player_id join organizations o on o.id = sg.organization_id
          where p.slug = ${lit(c.selector.player_slug)} and o.name = ${lit(c.selector.organization_name)} and sg.signing_year = ${c.selector.signing_year})
        and e.field_name is not distinct from ${lit(c.selector.field_name)} and e.source_id = (select id from sources where url = ${lit(c.selector.url)})`)
      assert.equal(r.length, 1, JSON.stringify(c.selector))
      assert.deepEqual([r[0].c, r[0].n], [c.canonical.confidence, c.canonical.evidence_note])
      present32++
    }
    assert.equal(present32, 32)
    for (const v of cats027.evidence_variants.entries) {
      assert.equal((await q(`select 1 from evidence where evidence_note = ${lit(v.live.evidence_note)} and confidence = ${lit(v.live.confidence)}::confidence_level
        and entity_id = (select sg.id from signings sg join players p on p.id = sg.player_id where p.slug = ${lit(v.selector.player_slug)} and sg.signing_year = ${v.selector.signing_year})`)).length, 0)
    }
  })
})

test('the unsupported trainer seed is removed, never migrated: no trainer fact re-enters DISI', async () => {
  await inTxn(async () => {
    await chain.db.exec(inner)
    assert.deepEqual([(await one(`select count(*)::int as n from trainers`)).n, (await one(`select count(*)::int as n from player_trainers`)).n], [0, 0])
    // nothing new in any table mentions the legacy trainers as a fact, and no network objects exist yet (that is 028)
    // the three evidence rows that asserted trainer relationships stay as signing provenance with a neutral note
    const neutral = await q(`select p.slug, o.name as org, s.signing_year, so.url, e.confidence::text as confidence, e.evidence_note from evidence e join signings s on s.id = e.entity_id
      join players p on p.id = s.player_id join organizations o on o.id = s.organization_id join sources so on so.id = e.source_id
      where e.entity_type = 'signing' and e.evidence_note ~* 'trainer|academy' order by 1`)
    assert.deepEqual(neutral.map((n) => n.slug), ['emil-morales', 'ezequiel-melburne', 'rubel-arias'])
    assert.ok(neutral.every((n) => n.evidence_note === NEUTRAL && n.confidence === 'HIGH'))
    assert.deepEqual(neutral.map((n) => n.url), cats027.evidence_note_neutralizations.entries.map((c) => c.selector.url))
    assert.match(NEUTRAL, /^Migration 002 source retained for signing provenance\. Trainer\/academy attribution is not carried forward pending direct source verification\.$/)
    assert.doesNotMatch(NEUTRAL, /no trainer|did not have|never had/i, 'it must not claim that no relationship existed')
    // no trainer / academy identity is asserted anywhere in evidence, sources or aliases (the four MLB.com candidates stay in the research backlog)
    assert.equal((await one(`select count(*)::int as n from evidence where evidence_note ~* 'ramos|fausto|valera|banana|ferreras|trainer relationships|as trainer'`)).n, 0)
    assert.equal((await one(`select count(*)::int as n from sources where coalesce(title, '') || coalesce(notes, '') ~* 'trainer|academy|ramos|valera'`)).n, 0)
    for (const slug of ['emil-morales', 'rubel-arias', 'ezequiel-melburne', 'joendry-vargas']) {
      assert.equal((await one(`select count(*)::int as n from player_trainers pt join players p on p.id = pt.player_id where p.slug = ${lit(slug)}`)).n, 0, slug)
    }
    const backlog = fs.readFileSync(path.join(root, 'database/research/027/research-backlog.md'), 'utf8')
    for (const name of ['Emil Morales', 'Rubel Arias', 'Ezequiel Melburne', 'Joendry Vargas']) assert.ok(backlog.includes(name), `${name} stays in the research backlog`)
    assert.equal((await one(`select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v') and relname ~ 'network|academy'
      and relname not in ('v_dodgers_trainer_network')`)).n, 0)
    assert.equal((await one(`select count(*)::int as n from player_aliases a join players p on p.id = a.player_id where p.slug in ('emil-morales', 'ezequiel-melburne', 'rubel-arias')`)).n, 0)
  })
})

test('unexpected third states abort the whole migration and change nothing', async () => {
  const link = cats027.signing_environment_assignments.entries[0]
  const signing = `(select sg.id from signings sg join players p on p.id = sg.player_id join organizations o on o.id = sg.organization_id
    where p.slug = ${lit(link.selector.player_slug)} and o.name = ${lit(link.selector.organization_name)} and sg.signing_year = ${link.selector.signing_year})`
  const variant = cats027.source_metadata_variants.entries[1]
  const missingSource = cats027.sources_missing.entries[0]
  const claim = cats027.evidence_variants.entries[0]
  const claimId = `(select sg.id from signings sg join players p on p.id = sg.player_id where p.slug = ${lit(claim.selector.player_slug)} and sg.signing_year = ${claim.selector.signing_year})`
  const claimSrc = `(select id from sources where url = ${lit(claim.selector.url)})`
  const neutralClaim = cats027.evidence_note_neutralizations.entries[0]
  const neutralId = `(select sg.id from signings sg join players p on p.id = sg.player_id where p.slug = ${lit(neutralClaim.selector.player_slug)} and sg.signing_year = ${neutralClaim.selector.signing_year})`
  const neutralSrc = `(select id from sources where url = ${lit(neutralClaim.selector.url)})`
  const A = (mutation) => `${mutation}\n${inner}`
  const B = (mutation) => `${liveDriftSql()}\n${mutation}\n${inner}`
  /** @type {[string, string, RegExp][]} */
  const cases = [
    ['a signing linked to a different environment', A(`update signings set signing_environment_id = (select id from signing_environments where signing_year <> ${link.canonical.environment.signing_year} limit 1) where id = ${signing};`), /unexpected environment/],
    ['an environment with unexpected content', A(`update signing_environments set regime = 'OTHER' where signing_year = ${cats027.signing_environments.entries[0].selector.signing_year};`), /exists with unexpected content/],
    ['a drifted signing whose other fields changed', B(`update signings set signing_bonus_usd = 1 where id = ${signing};`), /differs from the expected canonical fields/],
    ['a conflicting transaction for the same event', B(`insert into transactions (player_id, transaction_date, transaction_type, return_description) select id, date '2025-01-17', 'TRADE', 'a different return' from players where slug = 'arnaldo-lantigua';`), /conflicting transaction/],
    ['a duplicated transaction', A(`insert into transactions (player_id, transaction_date, transaction_type, from_organization_id, to_organization_id, return_description, source_id, confidence)
      select player_id, transaction_date, transaction_type, from_organization_id, to_organization_id, return_description, source_id, confidence from transactions where transaction_date = date '2025-01-17';`), /conflicting transaction/],
    ['a source variant with unexpected metadata', B(`update sources set title = 'Something nobody expected' where url = ${lit(variant.selector.url)};`), /unexpected metadata/],
    ['a restored source that exists with unexpected metadata', A(`update sources set title = 'Edited' where url = ${lit(missingSource.selector.url)};`), /exists with unexpected metadata/],
    ['an unexpected evidence variant', B(`update evidence set confidence = 'LOW', evidence_note = 'an unreviewed rewrite' where entity_id = ${claimId} and source_id = ${claimSrc} and field_name is null;`), /unexpected evidence/],
    ['a duplicated canonical claim', A(`insert into evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
      select entity_type, entity_id, field_name, source_id, confidence, evidence_note from evidence where entity_id = ${claimId} and source_id = ${claimSrc} and field_name is null;`), /unexpected evidence/],
    ['an alias with unexpected content', A(`update player_aliases set alias_type = 'LEGAL_NAME' where alias = 'Oneal Cruz';`), /exists|unexpected content/],
    ['a neutralised claim with an unexpected note', A(`update evidence set evidence_note = 'rewritten by hand' where entity_id = ${neutralId} and source_id = ${neutralSrc} and field_name is null;`), /unexpected evidence/],
    ['an extra legacy trainer', A(`insert into trainers (name, country) values ('Somebody Else', 'Dominican Republic');`), /unexpected legacy trainer data/],
    ['a changed legacy link', A(`update player_trainers set confidence = 'HIGH' where trainer_id = (select id from trainers where name = 'Fausto Garcia');`), /does not match the known seed row/],
    ['trainers appearing in an otherwise empty (live) state', B(`insert into trainers (name, country) values ('Someone', 'Venezuela');`), /unexpected legacy trainer data/],
  ]
  for (const [label, sql, pattern] of cases) assert.match(await attempt(sql), pattern, label)
  // an aborted run changed nothing
  const intact = await one(`select (select count(*) from trainers)::int as t, (select count(*) from signing_environments)::int as e`)
  assert.deepEqual(intact, { t: 2, e: 8 })
})

test('027 is a data-only forward migration: no schema, grant, policy or function change, and migrations 001-026 are untouched', async () => {
  const code = sql027.replace(/--[^\n]*/g, '')
  assert.doesNotMatch(code, /\b(create|alter|drop)\s+(table|view|function|index|policy|trigger|type|schema|extension)\b/i)
  assert.doesNotMatch(code, /\b(grant|revoke)\b/i)
  assert.doesNotMatch(code, /initcap\s*\(/i, 'no engine-sensitive normalisation in new migration logic')
  assert.doesNotMatch(code, /full_name\s*=|canonical_name\s*=/i, 'no mutable player name is used as a key')
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  assert.ok(frozen['026_scouting_evaluation_history.sql'] && frozen['002_dodgers_seed_cohort.sql'])
  assert.equal(frozen[FILE], undefined, '027 itself is not yet frozen')
})

test('rerun is a no-op: the committed migration applied twice (and over the drifted state) changes nothing the second time', async () => {
  await chain.db.exec(liveDriftSql())
  await chain.db.exec(sql027)
  const first = hashes(await content())
  const firstSecurity = await untouched()
  await chain.db.exec(sql027)
  assert.deepEqual(hashes(await content()), first)
  assert.deepEqual(await untouched(), firstSecurity)
  assert.deepEqual(first, stateA.content, 'and it still equals the canonical replay result')
  assert.deepEqual([(await one(`select count(*)::int as n from trainers`)).n, (await one(`select count(*)::int as n from player_trainers`)).n], [0, 0])
})
