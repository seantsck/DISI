#!/usr/bin/env node
// Read-only public-view privilege audit behind migration 025.
//
//   node database/research/025/audit.mjs                                   # local canonical chain (before 025)
//   node --env-file=.env.local database/research/025/audit.mjs --live      # live database, read-only
//
// Every statement is a catalog SELECT: no INSERT/UPDATE/DELETE/TRUNCATE probe is
// ever sent. Structural writability comes from information_schema.views
// (is_updatable / is_insertable_into), INSTEAD OF triggers and non-SELECT rules
// on each view, and the RLS policies of the base tables underneath it.
// Writes audit-report-<local|live>.json (deterministic: sorted, no timestamps,
// no connection details). The DSN is read only from DISI_LIVE_DB_URL and is
// never printed.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const live = process.argv.includes('--live')

let query
let close
if (live) {
  const url = process.env.DISI_LIVE_DB_URL
  if (!url) { console.error('--live needs DISI_LIVE_DB_URL (use node --env-file=.env.local)'); process.exit(2) }
  const pgSpecifier = ['p', 'g'].join('')
  const { default: pg } = await import(pgSpecifier)
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: 'disi-audit-025' })
  await client.connect()
  await client.query('set default_transaction_read_only = on')
  query = async (sql) => (await client.query(sql)).rows
  close = () => client.end()
} else {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8'))
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin;')
  for (const file of manifest.canonical_sql) {
    if (/^02[5-9]_|^0[3-9]\d_/.test(file)) break
    await db.exec(fs.readFileSync(path.join(root, 'database/sql', file), 'utf8'))
  }
  query = async (sql) => (await db.query(sql)).rows
  close = () => db.close()
}

const ROLES = ['anon', 'authenticated', 'service_role', 'PUBLIC']
const privsOf = async (relkind) => {
  const rows = await query(`select c.relname, coalesce(r.rolname, 'PUBLIC') as grantee, a.privilege_type
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    left join pg_roles r on r.oid = a.grantee
    where n.nspname = 'public' and c.relkind = '${relkind}'`)
  const out = {}
  for (const r of rows) {
    if (!ROLES.includes(r.grantee)) continue
    ;((out[r.relname] ??= {})[r.grantee] ??= []).push(r.privilege_type)
  }
  for (const v of Object.values(out)) for (const k of Object.keys(v)) v[k] = [...new Set(v[k])].sort()
  return out
}

const views = await query(`select c.relname as name, pg_get_userbyid(c.relowner) as owner,
    coalesce(array_to_string(c.reloptions, ','), '') as options,
    v.is_updatable, v.is_insertable_into, v.check_option
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  left join information_schema.views v on v.table_schema = 'public' and v.table_name = c.relname
  where n.nspname = 'public' and c.relkind = 'v' order by 1`)
const viewPrivs = await privsOf('v')
const tablePrivs = await privsOf('r')
const deps = await query(`select distinct v.relname as view, d.refobjid::regclass::text as ref, rc.relkind::text as kind
  from pg_depend d join pg_rewrite rw on rw.oid = d.objid join pg_class v on v.oid = rw.ev_class
  join pg_namespace n on n.oid = v.relnamespace join pg_class rc on rc.oid = d.refobjid
  where d.classid = 'pg_rewrite'::regclass and d.refobjid <> v.oid and n.nspname = 'public' and v.relkind = 'v'
    and rc.relkind in ('r', 'v', 'm', 'p', 'f')`)
const triggers = await query(`select c.relname as view, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and not t.tgisinternal`)
const rules = await query(`select tablename as view, rulename from pg_rules where schemaname = 'public' and rulename <> '_RETURN'`)
const tables = await query(`select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)
const policies = await query(`select tablename as table, policyname as name, cmd, roles::text as roles, permissive
  from pg_policies where schemaname = 'public' order by 1, 2`)
const defaults = await query(`select pg_get_userbyid(d.defaclrole) as for_role, coalesce(n.nspname, '(all schemas)') as schema,
    d.defaclobjtype::text as objtype, coalesce(r.rolname, 'PUBLIC') as grantee,
    string_agg(a.privilege_type, ',' order by a.privilege_type) as privileges
  from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a left join pg_roles r on r.oid = a.grantee
  where coalesce(r.rolname, 'PUBLIC') in ('anon', 'authenticated', 'PUBLIC') and (n.nspname = 'public' or n.nspname is null)
  group by 1, 2, 3, 4 order by 1, 2, 3, 4`)
await close()

// -- base tables beneath each view (transitively through other views) ----------------------
const kindOf = Object.fromEntries(deps.map((d) => [d.ref.replace(/^public\./, ''), d.kind]))
const direct = {}
for (const d of deps) (direct[d.view] ??= new Set()).add(d.ref.replace(/^public\./, ''))
const baseTables = (name, seen = new Set()) => {
  const out = new Set()
  for (const ref of direct[name] ?? []) {
    if (seen.has(ref)) continue
    seen.add(ref)
    if (kindOf[ref] === 'v' && direct[ref]) for (const t of baseTables(ref, seen)) out.add(t)
    else if (kindOf[ref] !== 'v') out.add(ref)
  }
  return out
}
const tableInfo = Object.fromEntries(tables.map((t) => [t.name, t]))
const writePolicy = (table) => policies.filter((p) => p.table === table && p.cmd !== 'SELECT'
  && /anon|authenticated|public/.test(p.roles))

// -- repository facts: where each view is defined, and whether the app reads it --------------
const sqlFiles = fs.readdirSync(path.join(root, 'database/sql')).filter((f) => f.endsWith('.sql')).sort()
const sqlText = Object.fromEntries(sqlFiles.map((f) => [f, fs.readFileSync(path.join(root, 'database/sql', f), 'utf8')]))
const appText = ['lib', 'app'].flatMap((d) => fs.readdirSync(path.join(root, d), { recursive: true })
  .filter((f) => /\.(js|mjs|jsx|ts|tsx)$/.test(String(f))).map((f) => fs.readFileSync(path.join(root, d, String(f)), 'utf8'))).join('\n')
const definedIn = (name) => sqlFiles.filter((f) => new RegExp(`create\\s+(or\\s+replace\\s+)?view\\s+(public\\.)?${name}\\b`, 'i').test(sqlText[f]))
  .map((f) => f.slice(0, 3))

const EXTRA = ['DELETE', 'INSERT', 'REFERENCES', 'TRIGGER', 'TRUNCATE', 'UPDATE']
const inventory = views.map((v) => {
  const p = viewPrivs[v.name] ?? {}
  const bases = [...baseTables(v.name)].sort()
  const writePolicies = bases.flatMap((t) => writePolicy(t).map((w) => `${t}:${w.name}:${w.cmd}`))
  const writable = v.is_updatable === 'YES' || v.is_insertable_into === 'YES'
  const instead = triggers.filter((t) => t.view === v.name).map((t) => t.tgname)
  const viewRules = rules.filter((r) => r.view === v.name).map((r) => r.rulename)
  const securityInvoker = /security_invoker=(true|on)/.test(v.options)
  const apiRead = (p.anon ?? []).includes('SELECT') || (p.authenticated ?? []).includes('SELECT')
  let classification = 'READ_ONLY_ANALYTICS'
  if (instead.length || viewRules.length) classification = 'INTENTIONALLY_WRITABLE'
  else if (!apiRead) classification = 'INTERNAL/NOT_API'
  else if (writable && writePolicies.length) classification = 'REVIEW_REQUIRED'
  return {
    schema: 'public',
    view: v.name,
    owner: v.owner,
    security_invoker: securityInvoker,
    is_updatable: v.is_updatable,
    is_insertable_into: v.is_insertable_into,
    check_option: v.check_option,
    anon: p.anon ?? [],
    authenticated: p.authenticated ?? [],
    public_role: p.PUBLIC ?? [],
    service_role: p.service_role ?? [],
    anon_extra: (p.anon ?? []).filter((x) => EXTRA.includes(x)),
    authenticated_extra: (p.authenticated ?? []).filter((x) => EXTRA.includes(x)),
    base_tables: bases,
    base_tables_without_rls: bases.filter((t) => tableInfo[t] && !tableInfo[t].rls),
    base_table_write_policies_for_api_roles: writePolicies,
    instead_of_triggers: instead,
    rules: viewRules,
    defined_in_migrations: definedIn(v.name),
    read_by_app: new RegExp(`['"\`]${v.name}['"\`]`).test(appText),
    classification,
  }
})
const broad = inventory.filter((v) => v.anon_extra.length || v.authenticated_extra.length)
const report = {
  mode: live ? 'live' : 'local-canonical-before-025',
  views_total: inventory.length,
  views_non_security_invoker: inventory.filter((v) => !v.security_invoker).map((v) => v.view),
  views_anon_beyond_select: inventory.filter((v) => v.anon_extra.length).length,
  views_authenticated_beyond_select: inventory.filter((v) => v.authenticated_extra.length).length,
  views_public_role_grants: inventory.filter((v) => v.public_role.length).map((v) => v.view),
  views_structurally_updatable_or_insertable: inventory.filter((v) => v.is_updatable === 'YES' || v.is_insertable_into === 'YES').map((v) => v.view),
  views_with_base_write_policies_for_api_roles: inventory.filter((v) => v.base_table_write_policies_for_api_roles.length).map((v) => v.view),
  views_intentionally_writable: inventory.filter((v) => v.classification === 'INTENTIONALLY_WRITABLE').map((v) => v.view),
  classification_counts: inventory.reduce((t, v) => ((t[v.classification] = (t[v.classification] || 0) + 1), t), {}),
  broad_grant_views: broad.map((v) => v.view),
  base_tables_total: tables.length,
  base_tables_without_rls: tables.filter((t) => !t.rls).map((t) => t.name),
  base_table_grants_beyond_select: Object.entries(tablePrivs).flatMap(([t, p]) => ['anon', 'authenticated']
    .filter((r) => (p[r] ?? []).some((x) => EXTRA.includes(x))).map((r) => `${t}:${r}:${p[r].join(',')}`)).sort(),
  write_policies_for_api_roles: policies.filter((p) => p.cmd !== 'SELECT' && /anon|authenticated|public/.test(p.roles))
    .map((p) => `${p.table}:${p.name}:${p.cmd}:${p.roles}`),
  default_privileges_for_api_roles: defaults,
  inventory,
}
const out = path.join(here, `audit-report-${live ? 'live' : 'local'}.json`)
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
console.log(`${report.mode}: views ${report.views_total}; non-security_invoker ${report.views_non_security_invoker.length}; anon>SELECT ${report.views_anon_beyond_select}; authenticated>SELECT ${report.views_authenticated_beyond_select}`)
console.log(`updatable/insertable ${report.views_structurally_updatable_or_insertable.length}; base write policies for api roles ${report.views_with_base_write_policies_for_api_roles.length}; intentionally writable ${report.views_intentionally_writable.length}`)
console.log(`classification ${JSON.stringify(report.classification_counts)}; tables ${report.base_tables_total} (no RLS: ${report.base_tables_without_rls.length}); table grants beyond SELECT ${report.base_table_grants_beyond_select.length}; write policies ${report.write_policies_for_api_roles.length}`)
console.log(`default privileges for api roles: ${JSON.stringify(defaults)}`)
console.log(`wrote ${path.relative(root, out)}`)
