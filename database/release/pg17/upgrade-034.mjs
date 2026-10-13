// For each earlier 034 revision R (d3d9e85, 1ac2f75, b0c7f37): replay 001-033 + 034@R on a disposable PG17, then apply the frozen
// 034 (1edf314) over it. Checks that the frozen 034 succeeds, that the result converges with a clean 001-034@1edf314 replay, and
// prints a view-definition fingerprint per revision (to identify which 034 revision a database holds, from read-only catalog queries).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const WORK = path.resolve(process.argv[2]), REPO = path.resolve(process.argv[3])
const S = WORK
// embedded-postgres and pg come from the throwaway work directory (run.sh installs them there), never from the repo
const req = createRequire(path.join(WORK, 'deps', 'package.json'))
const { default: EmbeddedPostgres } = await import(pathToFileURL(req.resolve('embedded-postgres')).href)
const { default: pg } = await import(pathToFileURL(req.resolve('pg')).href)
const T034 = path.join(S, 't034')
const port = 55000 + Math.floor(Math.random() * 900)
const dataDir = path.join(S, 'pgdata-up-' + port)
const md5 = (v) => crypto.createHash('md5').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex')
const files = JSON.parse(fs.readFileSync(path.join(T034, 'database/manifest.json'), 'utf8')).canonical_sql
const read = (f) => fs.readFileSync(path.join(T034, 'database/sql', f), 'utf8')
const at = (rev) => execFileSync('git', ['-C', REPO, 'show', `${rev}:database/sql/034_downstream_organizational_value_chains.sql`], { encoding: 'utf8', maxBuffer: 1 << 26 })
const FP_SQL = fs.readFileSync(path.join(REPO, 'database/release/sql/fingerprint-034.sql'), 'utf8')
let failed = 0
const check = (n, ok, d = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`) }

const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {} })
await server.initialise(); await server.start()
const connect = async (db) => { const c = new pg.Client({ host: 'localhost', port, user: 'postgres', password: 'postgres', database: db }); await c.connect(); return c }
let k = 0
async function fresh() {
  const name = `up_${k++}`
  const a = await connect('postgres'); await a.query(`create database ${name}`); await a.end()
  const c = await connect(name)
  await c.query(`create role anon nologin`).catch(() => {}); await c.query(`create role authenticated nologin`).catch(() => {})
  for (const f of files.slice(0, 33)) await c.query(read(f))
  return c
}
const state = async (c) => {
  const tables = (await c.query(`select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1`)).rows.map((r) => r.relname)
  const t = {}
  for (const x of tables) {
    const cols = (await c.query(`select attname, format_type(atttypid, atttypmod) ty from pg_attribute where attrelid=('public.'||quote_ident($1))::regclass and attnum>0 and not attisdropped order by attnum`, [x])).rows
      .filter((y) => !/^(uuid|timestamp with time zone)$/.test(y.ty) && !/^(id|created_at|updated_at)$/.test(y.attname))
    const list = cols.map((y) => `t.${pg.escapeIdentifier(y.attname)}`).join(',') || '1'
    t[x] = md5((await c.query(`select (${list})::text r from public.${pg.escapeIdentifier(x)} t`)).rows.map((r) => r.r).sort())
  }
  const v = (await c.query(`select relname, pg_get_viewdef(oid) d from pg_class where relnamespace='public'::regnamespace and relkind='v' order by 1`)).rows
  const acl = (await c.query(`select relname, coalesce(relacl::text,'') a, relrowsecurity r, coalesce(array_to_string(reloptions,','),'') o from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v') order by 1`)).rows
  const fn = (await c.query(`select p.oid::regprocedure::text f, md5(pg_get_functiondef(p.oid)) h from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' order by 1`)).rows
  const trg = (await c.query(`select tgname, tgrelid::regclass::text t from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace) order by 1,2`)).rows
  return { t, v, acl, fn, trg }
}
const fingerprint = async (c) => (await c.query(FP_SQL)).rows

try {
  const ref = await fresh(); await ref.query(read(files[33]))
  const refState = await state(ref)
  const fps = { '1edf314': await fingerprint(ref) }
  await ref.end()
  for (const rev of ['d3d9e85', '1ac2f75', 'b0c7f37']) {
    const c = await fresh()
    await c.query(at(rev))
    fps[rev] = await fingerprint(c)
    let err = null
    try { await c.query(read(files[33])) } catch (e) { err = e.message }
    check(`frozen 034 applies over 034@${rev}`, !err, err || '')
    if (!err) {
      const s = await state(c)
      const diffT = Object.keys(refState.t).filter((x) => refState.t[x] !== s.t[x])
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
      check(`034@${rev} -> frozen 034 converges with clean frozen replay (rows, views, ACL/RLS, functions, triggers)`,
        diffT.length === 0 && same(refState.v, s.v) && same(refState.acl, s.acl) && same(refState.fn, s.fn) && same(refState.trg, s.trg),
        [diffT.length && 'tables:' + diffT.join(','), !same(refState.v, s.v) && 'views:' + refState.v.filter((x, i) => !same(x, s.v[i])).map((x) => x.relname).join(','), !same(refState.acl, s.acl) && 'acl', !same(refState.fn, s.fn) && 'fn', !same(refState.trg, s.trg) && 'trg'].filter(Boolean).join(' '))
    }
    await c.end()
  }
  console.log('\nFingerprint per 034 revision (fingerprint-034.sql):')
  const names = [...new Set(Object.values(fps).flat().map((r) => r.view_name))]
  console.log(['view'].concat(Object.keys(fps)).join('\t'))
  for (const n of names) console.log([n].concat(Object.keys(fps).map((r) => { const x = fps[r].find((y) => y.view_name === n); return x ? `m${x.materialized_ctes}/r${x.realization_refs}` : 'absent' })).join('\t'))
  const sig = Object.fromEntries(Object.entries(fps).map(([r, rows]) => [r, rows.map((x) => `${x.view_name}:${x.materialized_ctes}:${x.realization_refs}`).join(',')]))
  check('fingerprint distinguishes all four 034 revisions', new Set(Object.values(sig)).size === 4, JSON.stringify(sig))
  fs.writeFileSync(path.join(S, 'fingerprints-034.json'), JSON.stringify(fps, null, 1))
} catch (e) { check('run', false, e.stack) } finally { await server.stop(); fs.rmSync(dataDir, { recursive: true, force: true }) }
console.log(failed ? `\n${failed} FAILED` : '\nall upgrade checks passed')
process.exitCode = failed ? 1 : 0
