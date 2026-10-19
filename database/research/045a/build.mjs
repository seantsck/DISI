#!/usr/bin/env node
// Assembles database/sql/045a_product_snapshot_serving.sql from:
//   045a_template.sql   hand-written header, precondition, contract / firewall statements and structural postconditions
//   snapshots.mjs       the product snapshot definitions (tables, refresh stages and drift checks are generated from them)
//   ../045/views.sql    the 045 release-status definition, re-issued with the 045a schema version and canonical file
//   ../045/contract.json  the product / decision-engine versions
//
//   node database/research/045a/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SNAPSHOTS, INTERNAL_VIEWS, CONTRACT_REMOVED_EARLIER, STAGED_FUNCTIONS, SERVING_FUNCTIONS } from './snapshots.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_VERSION = 'v0.36.1'
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const indent = (s, n) => s.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n')

export function tables(snapshots = SNAPSHOTS, migration = '045a') {
  return snapshots.map((s) => {
    const t = `public.${s.table}`
    const out = [
      `-- ${s.table}: ${s.grain}`,
      `create table if not exists ${t} as\nselect null::bigint as generation_id, x.* from (\n${indent(s.source, 2)}\n) x\nwith no data;`,
      `alter table ${t} alter column generation_id set not null;`,
      `alter table ${t} enable row level security;`,
      `comment on table ${t} is\n  ${lit(`DISI product snapshot (Migration ${migration}): ${s.grain}. A derived, persisted read model of the 042-045 analytical layer - not a source of facts; rebuilt only by disi_refresh_product_snapshots(). ${s.purpose}.`)};`,
      `revoke all on table ${t} from anon, authenticated;`,
      `grant select on table ${t} to anon, authenticated;`,
      `drop policy if exists public_read_${s.table} on ${t};`,
      `create policy public_read_${s.table} on ${t} for select to anon, authenticated using (true);`,
    ]
    for (const c of s.index ?? []) out.push(`create index if not exists ${s.table}_${c}_idx on ${t} (${c});`)
    return out.join('\n')
  }).join('\n\n')
}

export function refreshFunction(snapshots = SNAPSHOTS, { migration = '045a', validation = [] } = {}) {
  const stages = snapshots.map((s) => `  -- ${s.table}
  v_t := clock_timestamp();
  execute 'delete from public.${s.table}';
  execute $q$
    insert into public.${s.table}
    select $1, x.* from (
${indent(s.source, 6)}
    ) x
  $q$ using v_gen;
  get diagnostics v_n = row_count;
  snapshot := '${s.table}'; row_count := v_n; elapsed_ms := (extract(epoch from clock_timestamp() - v_t) * 1000)::int;
  return next;`).join('\n')
  return `create or replace function public.disi_refresh_product_snapshots()
returns table (snapshot text, row_count integer, elapsed_ms integer)
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_gen bigint;
  v_t timestamptz;
  v_n int;
  v_bad text;
begin
  -- one refresh at a time; EXCLUSIVE mode still lets readers (ACCESS SHARE) read the previous generation until this transaction commits
  lock table public.product_executive_snapshot in exclusive mode;
  select coalesce(max(generation_id), 0) + 1 into v_gen from public.product_executive_snapshot;
  -- each snapshot is its own statement: planned when it runs and released when it ends (the analytical views are staged since 043a)
${stages}
  -- validate the new generation before it can commit; every rule is derived from the snapshot itself, none is a fixed answer
  execute $q$
    with e as (select * from public.product_executive_snapshot)
    select concat_ws('; ',
      case when (select count(*) from e) <> 1 then 'executive snapshot is not one row' end,
      case when exists (select 1 from e where e.dodgers_signings <> (select count(distinct signing_id) from public.product_player_decision)) then 'player snapshot does not cover every Dodgers signing' end,
      case when exists (select 1 from e where e.supported_probability_targets <> (select count(distinct target_key) from public.product_prediction_readiness where baseline_supported)) then 'supported targets disagree with prediction readiness' end,
      case when exists (select 1 from e where e.supported_expected_value_models <> (select count(*) from public.product_expected_value_support where expected_value_supported)) then 'supported value models disagree with expected-value support' end,
      case when exists (select 1 from e where e.supported_expected_values <> (select count(expected_org_value_bwar) from public.product_player_expected_value)) then 'supported expected values disagree with the player snapshot' end,
      case when exists (select 1 from e where e.predictive_portfolio_recommendations <> (select count(*) from public.product_player_decision where optimization_eligible)) then 'recommendations disagree with the player snapshot' end,
      case when exists (select 1 from e where (e.supported_probability_targets = 0) <> (e.support_chain_state = 'NO_PREDICTIVE_LAYER_SUPPORTED')) then 'support-chain state disagrees with probability support' end,
      case when exists (select 1 from e where e.supported_probability_targets = 0 and e.supported_expected_value_models > 0) then 'expected value supported without probability support' end,
      case when exists (select 1 from e where e.supported_expected_value_models = 0 and (e.supported_expected_values > 0 or e.predictive_portfolio_recommendations > 0)) then 'predictive outputs without a supported value model' end,
      case when exists (select 1 from public.product_portfolio_scenarios where optimized_selection is not null and optimization_eligible_candidates = 0) then 'optimized selection without eligible candidates' end,
      case when exists (select 1 from public.product_player_expected_value where expected_org_value_bwar is not null and not expected_value_supported) then 'expected value published for an unsupported row' end${validation.map((v) => `,\n      ${v}`).join('')}
    )
  $q$ into v_bad;
  if v_bad <> '' then
    raise exception 'product snapshot refresh refused (generation %): %', v_gen, v_bad;
  end if;
end
$fn$;

comment on function public.disi_refresh_product_snapshots() is
  ${lit(`Rebuilds every DISI product snapshot (Migration ${migration}) as one new generation: one staged statement per snapshot, then support-chain validation derived from the snapshot itself; any violation raises and nothing changes. Run it explicitly in its own transaction after DISI research data changes - never from a page request. Owner only: no PUBLIC, anon or authenticated EXECUTE.`)};`
}

export function driftFunction(snapshots = SNAPSHOTS, migration = '045a') {
  const stages = snapshots.map((s) => {
    const drop = `array[${['generation_id', ...(s.volatile ?? [])].map(lit).join(', ')}]`
    const dropSrc = `array[${(s.volatile ?? []).map(lit).join(', ') || "''"}]`
    return `  execute $q$
    with s as materialized (select to_jsonb(t) - ${drop}::text[] as j from public.${s.table} t),
    v as materialized (select to_jsonb(x) - ${dropSrc}::text[] as j from (
${indent(s.source, 6)}
    ) x)
    select (select count(*) from (select j from v except all select j from s) a)::int, (select count(*) from (select j from s except all select j from v) b)::int
  $q$ into v_missing, v_extra;
  snapshot := '${s.table}'; missing_rows := v_missing; extra_rows := v_extra;
  return next;`
  }).join('\n')
  return `create or replace function public.disi_product_snapshot_drift()
returns table (snapshot text, missing_rows integer, extra_rows integer)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_missing int;
  v_extra int;
begin
  -- each snapshot compared with a fresh evaluation of its analytical source, one statement at a time
${stages}
end
$fn$;

comment on function public.disi_product_snapshot_drift() is
  ${lit(`For the verifier (Migration ${migration}): per product snapshot, the rows its analytical source would produce now that the snapshot lacks (missing_rows) and the snapshot rows it would not produce (extra_rows), ignoring generation metadata. Both 0 = the snapshot is current. Owner only.`)};`
}

function releaseStatus() {
  const contract = JSON.parse(fs.readFileSync(path.join(here, '../045/contract.json'), 'utf8'))
  const views = fs.readFileSync(path.join(here, '../045/views.sql'), 'utf8').replace(/\r\n/g, '\n')
  const start = views.indexOf('create or replace view public.v_disi_release_status')
  const end = views.indexOf('-- ---------------------------------------------------------------------------\n-- Research roadmap')
  if (start < 0 || end < 0) throw new Error('release-status block not found in 045 views.sql')
  let block = views.slice(start, end).trimEnd()
  for (const [k, v] of [['product_version', contract.product_version], ['schema_version', SCHEMA_VERSION], ['decision_engine_version', contract.decision_engine_version]]) {
    if (!block.includes(`{{${k}}}`)) throw new Error(`no {{${k}}}`)
    block = block.split(`{{${k}}}`).join(v)
  }
  const canonical = `'045_final_integration_release.sql'::text as canonical_through`
  if (!block.includes(canonical)) throw new Error('canonical_through literal not found')
  return block.replace(canonical, `'045a_product_snapshot_serving.sql'::text as canonical_through`)
}

function contract() {
  const removed = [...INTERNAL_VIEWS, ...CONTRACT_REMOVED_EARLIER].map(lit).join(', ')
  const rows = SNAPSHOTS.map((s) => `  (${lit(s.table)}, 'TABLE', ${lit(s.area)}, ${lit(s.tier)}, array[${s.routes.map(lit).join(', ')}], ${lit(s.purpose)}, '045a')`).join(',\n')
  return `delete from public.disi_product_contract where relation_name in (${removed});
insert into public.disi_product_contract (relation_name, relation_kind, product_area, contract_tier, app_routes, purpose, introduced_in) values
${rows}
on conflict (relation_name) do nothing;`
}

function firewall() {
  return [
    `do $$\ndeclare v text;\nbegin\n  foreach v in array array[${INTERNAL_VIEWS.map(lit).join(', ')}] loop\n    execute format('revoke all on public.%I from anon, authenticated', v);\n  end loop;\nend $$;`,
    `do $$\ndeclare f text;\nbegin\n  foreach f in array array[${[...STAGED_FUNCTIONS, ...SERVING_FUNCTIONS].map(lit).join(', ')}] loop\n    execute format('revoke all on function public.%I() from public, anon, authenticated', f);\n  end loop;\nend $$;`,
  ].join('\n\n')
}

/** The migration SQL. */
export function assemble() {
  let sql = fs.readFileSync(path.join(here, '045a_template.sql'), 'utf8').replace(/\r\n/g, '\n')
  const parts = {
    tables: tables(), refresh_function: refreshFunction(), drift_function: driftFunction(), release_status: releaseStatus(),
    contract: contract(), firewall: firewall(),
    snapshot_tables: SNAPSHOTS.map((s) => lit(s.table)).join(', '),
    internal_views: INTERNAL_VIEWS.map(lit).join(', '),
    closed_functions: [...STAGED_FUNCTIONS, ...SERVING_FUNCTIONS].map(lit).join(', '),
  }
  for (const [k, v] of Object.entries(parts)) {
    if (!sql.includes(`{{${k}}}`)) throw new Error(`template has no {{${k}}}`)
    sql = sql.split(`{{${k}}}`).join(v)
  }
  if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')
  return sql
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  const sql = assemble()
  const dest = path.join(here, '../../sql/045a_product_snapshot_serving.sql')
  fs.writeFileSync(dest, sql)
  process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
}
