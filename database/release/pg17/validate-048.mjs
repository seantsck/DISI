// Independent validation of migration 048 (verified MLB development coverage) on a disposable, real PostgreSQL 17
// server (embedded-postgres, scratchpad only). Sources come from git archives: tbase = the released baseline (default origin/main: 001-047),
// tcand = the candidate (default HEAD). Never touches a hosted database: no connection string is read.
//
//   node database/release/pg17/validate-048.mjs <work-dir>     (run-048.sh prepares the work dir)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const WORK = path.resolve(process.argv[2])
const req = createRequire(path.join(WORK, 'deps', 'package.json'))
const { default: EmbeddedPostgres } = await import(pathToFileURL(req.resolve('embedded-postgres')).href)
const { default: pg } = await import(pathToFileURL(req.resolve('pg')).href)
const TBASE = path.join(WORK, 'tbase'), TC = path.join(WORK, 'tcand')
const port = 54000 + Math.floor(Math.random() * 900)
const dataDir = path.join(WORK, 'pgdata-' + port)
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex')
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

const FILE = '048_verified_mlb_development_coverage.sql'
const ROLLBACK = 'database/release/sql/rollback-048.sql'
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {} })
await server.initialise()
await server.start()
const connect = async (db) => { const c = new pg.Client({ host: 'localhost', port, user: 'postgres', password: 'postgres', database: db }); c.on('error', () => {}); await c.connect(); return c }
const sqlFiles = (root) => JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8')).canonical_sql
const readSql = (root, f) => fs.readFileSync(path.join(root, 'database/sql', f), 'utf8')
async function freshDb(name) {
  const admin = await connect('postgres'); await admin.query(`create database ${name}`); await admin.end()
  const c = await connect(name)
  await c.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$`)
  return c
}
async function apply(c, root, files) { for (const f of files) { try { await c.query(readSql(root, f)) } catch (e) { throw new Error(`${f}: ${e.message}`) } } }
const rowsOf = async (c, sql, params) => (await c.query(sql, params)).rows
const q = (c) => async (sql, params) => rowsOf(c, sql, params)
async function contentHashes(c) {
  const tables = (await rowsOf(c, `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) {
    const rows = (await rowsOf(c, `select t::text as r from public.${pg.escapeIdentifier(t)} t`)).map((r) => r.r).sort()
    out[t] = { n: rows.length, h: md5(rows) }
  }
  return out
}
const catalog = async (c) => ({
  views: Object.fromEntries((await rowsOf(c, `select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)).map((r) => [r.relname, r.d])),
  acls: await rowsOf(c, `select relname, relkind, coalesce(relacl::text, '') as acl, relrowsecurity as rls, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v') order by 1`),
  pol: await rowsOf(c, `select tablename, policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' order by 1, 2`),
  fn: await rowsOf(c, `select p.oid::regprocedure::text as f, md5(pg_get_functiondef(p.oid)) as h, coalesce(p.proacl::text, '') as acl from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
  trg: await rowsOf(c, `select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
})
const SNAP = ['product_executive_snapshot', 'product_prediction_readiness', 'product_model_evaluations', 'product_expected_value_support', 'product_portfolio_decision_support',
  'product_portfolio_history', 'product_portfolio_scenarios', 'product_player_decision', 'product_player_expected_value', 'product_player_comparables', 'product_database_status']
const RESEARCH = ['development_milestones', 'development_progression_decisions', 'player_season_stints', 'sources']
const inRole = async (c, role, sql) => {
  await c.query('begin'); try { await c.query(`set local role ${role}`); await c.query('savepoint s'); try { await c.query(sql); return 'ALLOWED' } catch (e) { return e.code } } finally { await c.query('rollback') }
}
const status = async (c) => (await rowsOf(c, `select signings_with_known_cost, known_acquisition_cost_usd::text as cost, open_research_tasks, outcome_audit_queue, outcome_audits_completed, generation_id::int as g from public.product_database_status`))[0]
const drift = (c) => rowsOf(c, `select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`)
const chains = async (c) => Object.fromEntries((await rowsOf(c, `select chain_status, count(*)::int as n from public.product_player_decision group by 1`)).map((r) => [r.chain_status, r.n]))
const counts = async (c) => (await rowsOf(c, `select (select count(*)::int from public.transaction_events) as events, (select count(*)::int from public.transaction_event_assets) as assets,
  (select count(*)::int from public.player_season_stints) as stints, (select count(*)::int from public.development_milestones) as milestones,
  (select count(*)::int from public.development_progression_decisions) as decisions, (select count(*)::int from public.transaction_asset_timing_observations) as timing`))[0]

try {
  const vc = await connect('postgres'); const ver = (await vc.query('select version() as v')).rows[0].v; await vc.end()
  console.log(`server: ${ver}`)
  check('PostgreSQL major version is 17', /PostgreSQL 17\./.test(ver), ver.split(',')[0])

  // --- identity: manifest, frozen history, file hygiene
  const frozen = JSON.parse(fs.readFileSync(path.join(TC, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const cohort = JSON.parse(fs.readFileSync(path.join(TC, 'database/research/048/development-cohort.json'), 'utf8'))
  const cohort047 = JSON.parse(fs.readFileSync(path.join(TC, 'database/research/047/development-cohort.json'), 'utf8')).players.map((p) => p.slug)
  const base = sqlFiles(TBASE), cand = sqlFiles(TC)
  const slugs = cohort.players.map((p) => p.slug)
  const fresh = slugs.filter((s) => !cohort.already_researched.includes(s))
  check('baseline manifest ends at 047 (51 files)', base.length === 51 && base.at(-1) === '047_development_transaction_research_batch.sql')
  check('candidate manifest = baseline + 048 (52 files), forward-only', JSON.stringify(cand) === JSON.stringify([...base, FILE]))
  const frozenOk = base.every((f) => f in frozen && sha1(readSql(TC, f).replace(/\r\n/g, '\n')) === frozen[f] && readSql(TBASE, f) === readSql(TC, f))
  check('001-047 are byte-identical between the baseline and the candidate and match the frozen hashes (51 entries)', frozenOk && Object.keys(frozen).length === 51)
  const sql = readSql(TC, FILE)
  const rbSql = fs.readFileSync(path.join(TC, ROLLBACK), 'utf8')
  console.log(`  ${FILE}: sha256 ${sha256(sql)}  ${Buffer.byteLength(sql)} bytes`)
  console.log(`  rollback-048.sql: sha256 ${sha256(rbSql)}  ${Buffer.byteLength(rbSql)} bytes`)
  const body = sql.replace(/\$m048\$[\s\S]*?\$m048\$/g, '')
  check('048: no CRLF; one transaction; no DDL on the public schema', !sql.includes('\r') && /^begin;$/m.test(sql) && /^commit;$/m.test(sql) && !/\b(create|alter|drop)\s+(table|view|function|policy|trigger|index)\b/i.test(body.replace(/create temporary table[^;]*;/gi, '')))
  const plan = fs.readFileSync(path.join(TC, 'database/release/048-release-plan.md'), 'utf8')
  check('release-plan hashes match the files', plan.includes(sha256(sql)) && plan.includes(sha256(rbSql)))

  // --- A: the released 001-047 (the production state), then 048
  const A = await freshDb('disi_a')
  let t0 = Date.now()
  await apply(A, TBASE, base)
  console.log(`  001-047 replay on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const inv = await import(path.join(TC, 'scripts/db/lib/invariants.mjs'))
  const { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_047 } = inv
  const pre = await checkInvariants(q(A), EXPECTATIONS_THROUGH_047); const fpre = failedChecks(pre)
  check(`the through-047 expectations hold on the PRE-release state (production today): ${pre.hard.length - fpre.length}/${pre.hard.length}`, fpre.length === 0 && pre.hard.length === 247, fpre.map((x) => x.name).join(', '))
  const preHead = failedChecks(await checkInvariants(q(A)))
  check(`the HEAD verifier on the pre-release state fails only the pinned development counts 048 moves (${preHead.length} of 247, expected before applying 048)`,
    preHead.length === 15 && preHead.every((x) => ['development', 'progression'].includes(x.group)), preHead.map((x) => x.name).join(','))
  const S0 = { cat: await catalog(A), full: await contentHashes(A), st: await status(A), chains: await chains(A), counts: await counts(A) }
  const verified = (await rowsOf(A, `select player_slug from public.v_signing_records where is_dodgers_franchise and reached_mlb_verified order by 1`)).map((r) => r.player_slug)
  check('cohort = verified MLB players minus the 047 cohort, derived from the database (47 - 10 = 37); two already researched by 021', verified.length === 47 && JSON.stringify([...slugs].sort()) === JSON.stringify(verified.filter((s) => !cohort047.includes(s)).sort()) && cohort.already_researched.length === 2 && fresh.length === 35)
  const totals0 = (await rowsOf(A, `select count(*)::int as n from public.player_season_stints where stint_kind = 'SEASON_TOTAL'`))[0].n
  t0 = Date.now()
  await apply(A, TC, [FILE])
  const ms = Date.now() - t0
  const S1 = { cat: await catalog(A), full: await contentHashes(A), st: await status(A), chains: await chains(A), counts: await counts(A) }
  check(`048 applies in one transaction (${ms} ms, including the snapshot refresh)`, true)
  check('NO catalog change: view definitions, ACLs, RLS, policies, functions and triggers are identical', md5(S1.cat) === md5(S0.cat))
  const changed = Object.keys(S1.full).filter((t) => S1.full[t].h !== S0.full[t].h).sort()
  check('only the four research tables and the eleven snapshots changed', JSON.stringify(changed) === JSON.stringify([...RESEARCH, ...SNAP].sort()), changed.join(','))
  const sourcesAdded = S1.full.sources.n - S0.full.sources.n
  check('rows added: 776 stints, 200 milestones, 15 pending decisions; no transaction event, asset or timing row moved',
    S1.counts.stints - S0.counts.stints === 776 && S1.counts.milestones - S0.counts.milestones === 200 && S1.counts.decisions - S0.counts.decisions === 15
      && S1.counts.events === S0.counts.events && S1.counts.assets === S0.counts.assets && S1.counts.timing === S0.counts.timing, `${JSON.stringify(S1.counts)} sources +${sourcesAdded}`)
  check('audits, outcomes, costs, the ledger, players, transactions and the 033/034 observation tables are untouched', ['outcome_audits', 'outcome_evidence', 'outcomes', 'signings', 'signing_financial_reports', 'players', 'transaction_events', 'transaction_event_assets', 'transaction_asset_resolutions', 'transaction_asset_timing_observations', 'dodgers_control_observations', 'player_mlb_team_season_war', 'research_source_conflicts']
    .every((t) => S1.full[t].h === S0.full[t].h))
  check('NOT_AUDITED, audits, known costs and spend are unchanged', S1.st.signings_with_known_cost === S0.st.signings_with_known_cost && S1.st.cost === S0.st.cost && S1.st.outcome_audit_queue === S0.st.outcome_audit_queue && S1.st.outcome_audits_completed === S0.st.outcome_audits_completed, JSON.stringify(S1.st))
  check('transaction chains are unchanged', JSON.stringify(S1.chains) === JSON.stringify(S0.chains), JSON.stringify(S1.chains))
  // development
  const per = await rowsOf(A, `select count(distinct p.slug)::int as players, count(*)::int as stints, min(s.season) filter (where p.slug = 'pedro-astacio') as astacio_first from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = any($1)`, [slugs])
  check('35 players gain their whole recorded career; 37 hold stints; Astacio\'s 1987-89 seasons stay absent (first record 1990), not filled in', per[0].players === 37 && per[0].astacio_first === 1990 && S1.counts.stints - S0.counts.stints === 776)
  check('the two players Migration 021 researched hold exactly the stints they held (no overwrite, no duplicate milestone)', (await rowsOf(A, `select count(*)::int as n from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = 'roger-cedeno'`))[0].n === 22
    && (await rowsOf(A, `select count(*)::int as n from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = 'carlos-frias'`))[0].n === 24
    && (await rowsOf(A, `select count(*)::int as n from (select m.player_id, m.event_code from public.development_milestones m join public.players p on p.id = m.player_id where p.slug in ('roger-cedeno','carlos-frias') and m.event_code in ('DSL_DEBUT','COMPLEX_DEBUT','A_DEBUT','HIGH_A_DEBUT','AA_DEBUT','AAA_DEBUT','MLB_DEBUT') group by 1, 2 having count(*) > 1) x`))[0].n === 0)
  check('no team-less cohort row is left as a team stint; 50 more proven season totals', (await rowsOf(A, `select count(*)::int as n from public.player_season_stints where stint_kind = 'TEAM_STINT' and (affiliate_team is null or team_id is null)`))[0].n === 0
    && (await rowsOf(A, `select count(*)::int as n from public.player_season_stints where stint_kind = 'SEASON_TOTAL'`))[0].n - totals0 === 50)
  check('no level-debut milestone after the MLB debut season; season-precision milestones carry no date; every MLB debut milestone equals the verified audit date',
    (await rowsOf(A, `select count(*)::int as n from public.development_milestones m join public.players p on p.id = m.player_id join public.development_milestones d on d.player_id = m.player_id and d.event_code = 'MLB_DEBUT'
      where p.slug = any($1) and m.event_code in ('DSL_DEBUT', 'COMPLEX_DEBUT', 'A_DEBUT', 'HIGH_A_DEBUT', 'AA_DEBUT', 'AAA_DEBUT') and m.as_of_date = date '2026-10-20' and m.season_year > d.season_year`, [fresh]))[0].n === 0
    && (await rowsOf(A, `select count(*)::int as n from public.development_milestones where date_precision = 'SEASON' and milestone_date is not null`))[0].n === 0
    && (await rowsOf(A, `select count(*)::int as n from public.development_milestones m join public.players p on p.id = m.player_id join public.v_signing_records s on s.player_id = p.id and s.is_dodgers_franchise where m.event_code = 'MLB_DEBUT' and m.milestone_date is distinct from s.mlb_debut_date`))[0].n === 0)
  check('15 ambiguous-sequence decisions are PENDING_REVIEW for six players; none is reviewed; Jansen\'s two are untouched',
    (await rowsOf(A, `select count(*)::int as n from public.development_progression_decisions d join public.players p on p.id = d.player_id where d.as_of_date = date '2026-10-20' and p.slug <> 'kenley-jansen' and d.progression_role = 'REVIEW_REQUIRED' and d.review_status = 'PENDING_REVIEW'`))[0].n === 15
    && (await rowsOf(A, `select count(*)::int as n from public.development_progression_decisions where review_status = 'REVIEWED'`))[0].n === 11
    && (await rowsOf(A, `select count(*)::int as n from public.development_progression_decisions d join public.players p on p.id = d.player_id where p.slug = 'kenley-jansen' and d.review_status = 'PENDING_REVIEW'`))[0].n === 2
    && (await rowsOf(A, `select count(*)::int as n from public.v_dodgers_development_research_queue where issue = 'NON_MONOTONIC_PROGRESSION'`))[0].n === 0)
  check('Mexican League seasons stay FOREIGN_PRO and are never on the progression ladder', (await rowsOf(A, `select count(*)::int as n from public.player_season_stints s join public.players p on p.id = s.player_id where p.slug = 'karim-garcia' and s.level = 'FOREIGN_PRO' and s.affiliated = false`))[0].n >= 10
    && (await rowsOf(A, `select count(*)::int as n from public.v_player_development_progression where level = 'FOREIGN_PRO'`))[0].n === 0)
  const timing = (await rowsOf(A, `select count(*) filter (where d.days_signing_to_mlb_exact is not null)::int as n, count(*)::int as of from public.v_signing_records s join public.v_dodgers_player_development_summary d on d.player_id = s.player_id where s.is_dodgers_franchise and s.reached_mlb_verified`))[0]
  check('signing-to-MLB with both exact dates: 45 of 47 (16 before); the two without a signing date are not calculable', timing.n === 45 && timing.of === 47, JSON.stringify(timing))
  const gens = await Promise.all(SNAP.map(async (t) => (await rowsOf(A, `select coalesce(array_agg(distinct generation_id), '{}') as g from public.${t}`))[0].g))
  check('one coherent generation: +1 and identical across all eleven snapshots; drift 0', gens.every((g) => g.length === 1 && Number(g[0]) === S0.st.g + 1) && (await drift(A)).length === 0, JSON.stringify(gens[0]))
  const post = await checkInvariants(q(A)); const fpost = failedChecks(post)
  check(`HEAD verifier after 048: ${post.hard.length - fpost.length}/${post.hard.length}`, fpost.length === 0 && post.hard.length === 247, fpost.map((x) => x.name).join(', '))
  const support = (await rowsOf(A, `select support_chain_state, supported_expected_value_models::int as m, predictive_portfolio_recommendations::int as r from public.product_executive_snapshot`))[0]
  check('no predictive layer became supported: the support chain, expected-value models and recommendations are unchanged', support.support_chain_state === 'NO_PREDICTIVE_LAYER_SUPPORTED' && support.m === 0 && support.r === 0)
  // exact idempotency
  await apply(A, TC, [FILE])
  check('048 exact idempotency (all rows incl. ids / timestamps, definitions, ACLs, policies, functions); no further generation', md5({ cat: await catalog(A), full: await contentHashes(A) }) === md5({ cat: S1.cat, full: S1.full }))
  // API boundary
  const attempts = [
    ['anon', `select 1 from public.player_season_stints limit 1`], ['authenticated', `select 1 from public.development_progression_decisions limit 1`],
    ['anon', `insert into public.player_season_stints (player_id, season, level, source_level, level_classification, era, level_rank, affiliated, as_of_date) select id, 2030, 'AAA', 'AAA', 'SPORT_ID_11', 'CLASSIC_AFFILIATED_1989_2016', 6, true, current_date from public.players limit 1`],
    ['authenticated', `update public.player_season_stints set g = 1`], ['anon', `delete from public.development_milestones`],
    ['authenticated', `insert into public.development_progression_decisions (player_id, event_code, milestone_id, progression_role, decision_basis, review_status, confidence, notes, reviewed_at, as_of_date) values (gen_random_uuid(), 'AA_DEBUT', gen_random_uuid(), 'REVIEW_REQUIRED', 'STINT_CHRONOLOGY_REVIEW', 'PENDING_REVIEW', 'LOW', 'x', now(), current_date)`],
    ['anon', `update public.development_progression_decisions set notes = 'x'`], ['anon', `select * from public.disi_refresh_product_snapshots()`],
  ]
  const outcome = []
  for (const [role, stmt] of attempts) outcome.push(await inRole(A, role, stmt))
  check('the research tables stay public-read and API-write-denied; anon / authenticated cannot write or run the refresh (42501)', outcome[0] === 'ALLOWED' && outcome[1] === 'ALLOWED' && outcome.slice(2).every((d) => d === '42501'), outcome.join(','))
  check('the product still reads: anon sees the snapshots and the development views', (await inRole(A, 'anon', `select 1 from public.product_database_status`)) === 'ALLOWED' && (await inRole(A, 'anon', `select 1 from public.v_player_development_stints`)) === 'ALLOWED'
    && (await inRole(A, 'anon', `select 1 from public.v_player_development_progression`)) === 'ALLOWED')
  check('no SECURITY DEFINER function was added', (await rowsOf(A, `select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef`))[0].n === 1)

  // --- B: rollback on a copy of the post-048 state
  await A.end()
  const admin = await connect('postgres'); await admin.query(`create database disi_b template disi_a`); await admin.end()
  const B = await connect('disi_b')
  t0 = Date.now()
  await B.query(rbSql)
  const rms = Date.now() - t0
  const SB = { st: await status(B), full: await contentHashes(B), cat: await catalog(B), chains: await chains(B), counts: await counts(B) }
  check(`rollback-048 commits in one transaction (${rms} ms)`, true)
  check('after rollback the stints, milestones, decisions and events equal the pre-048 state, row for row', SB.counts.stints === S0.counts.stints && SB.counts.milestones === S0.counts.milestones && SB.counts.decisions === S0.counts.decisions && SB.counts.events === S0.counts.events
    && ['player_season_stints', 'development_milestones', 'development_progression_decisions'].every((t) => SB.full[t].h === S0.full[t].h), JSON.stringify(SB.counts))
  check('after rollback the chain statuses equal the pre-048 state and the snapshots are coherent with zero drift', JSON.stringify(SB.chains) === JSON.stringify(S0.chains) && (await drift(B)).length === 0)
  check('after rollback the catalog is unchanged', md5(SB.cat) === md5(S0.cat))
  let again = ''
  try { await B.query(rbSql) } catch (e) { again = e.message; await B.query('rollback').catch(() => {}) }
  check('a second rollback refuses (the database is no longer in the post-048 state)', /rollback-048: .* is not the pending row 048 wrote/.test(again), again.slice(0, 90))
  const rv = await checkInvariants(q(B), EXPECTATIONS_THROUGH_047); const frv = failedChecks(rv)
  check(`the through-047 verifier after rollback: ${rv.hard.length - frv.length}/${rv.hard.length}`, frv.length === 0, frv.map((x) => x.name).join(', '))
  await apply(B, TC, [FILE])
  const rep = await checkInvariants(q(B)); const frep = failedChecks(rep)
  check(`unlike 046, 048 can be applied again after its rollback: the HEAD verifier passes ${rep.hard.length - frep.length}/${rep.hard.length}`, frep.length === 0 && (await counts(B)).stints === S1.counts.stints, frep.map((x) => x.name).join(', '))
  await B.end()
} catch (e) {
  check('validator ran to completion', false, e.message)
} finally {
  await server.stop().catch(() => {})
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
