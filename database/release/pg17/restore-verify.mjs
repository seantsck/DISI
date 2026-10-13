// Proves a pg_dump custom-format backup is recoverable: restores it into a disposable PostgreSQL 17 database and runs the frozen
// 034 verifier (178 hard invariants) against the restored copy. With --selftest it first builds the frozen 001-034 chain, dumps it
// with the same pg_dump flags the checklist uses, and verifies the round trip row-for-row. Never connects to a hosted database.
//   node restore-verify.mjs <work-dir> --selftest
//   node restore-verify.mjs <work-dir> <backup.dump>
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const WORK = path.resolve(process.argv[2])
const arg = process.argv[3]
const req = createRequire(path.join(WORK, 'deps', 'package.json'))
const { default: EmbeddedPostgres } = await import(pathToFileURL(req.resolve('embedded-postgres')).href)
const { default: pg } = await import(pathToFileURL(req.resolve('pg')).href)
const T034 = path.join(WORK, 't034')
const port = 57000 + Math.floor(Math.random() * 900)
const dataDir = path.join(WORK, 'pgdata-restore-' + port)
const env = { ...process.env, PGPASSWORD: 'postgres' }
const conn = ['-h', 'localhost', '-p', String(port), '-U', 'postgres']
let failed = 0
const check = (n, ok, d = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`) }
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')

const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {} })
await server.initialise(); await server.start()
const connect = async (db) => { const c = new pg.Client({ host: 'localhost', port, user: 'postgres', password: 'postgres', database: db }); await c.connect(); return c }
const createDb = async (name) => {
  const a = await connect('postgres')
  await a.query(`create database ${name}`)
  // Supabase API roles the dump's GRANTs refer to (cluster-wide; created once)
  for (const r of ['anon', 'authenticated', 'service_role']) await a.query(`create role ${r} nologin`).catch(() => {})
  await a.end()
}
const contentHashes = async (c) => {
  const tables = (await c.query(`select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1`)).rows.map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5((await c.query(`select t::text r from public.${pg.escapeIdentifier(t)} t`)).rows.map((r) => r.r).sort())
  return out
}
// pg_dump re-deparses view bodies (e.g. an explicit "AS text" alias), so views are compared by their result sets, not their text
const viewResults = async (c) => {
  const views = (await c.query(`select relname from pg_class where relnamespace='public'::regnamespace and relkind='v' order by 1`)).rows.map((r) => r.relname)
  const out = {}
  for (const v of views) out[v] = (await c.query(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) h from public.${pg.escapeIdentifier(v)} t`)).rows[0].h
  return out
}
const catalog = async (c) => (await c.query(`select relname, relkind, coalesce(relacl::text,'') a, relrowsecurity r, coalesce(array_to_string(reloptions,','),'') o,
  null::text v from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v') order by 1`)).rows

try {
  let dump = arg, source = null
  if (arg === '--selftest') {
    await createDb('source_db')
    source = await connect('source_db')
    const files = JSON.parse(fs.readFileSync(path.join(T034, 'database/manifest.json'), 'utf8')).canonical_sql
    for (const f of files) await source.query(fs.readFileSync(path.join(T034, 'database/sql', f), 'utf8'))
    dump = path.join(WORK, 'selftest-034.dump')
    // the checklist's backup command (schema public, custom format, owners and grants kept)
    execFileSync('pg_dump', [...conn, '-d', 'source_db', '--format=custom', '--schema=public', '--no-subscriptions', '--file', dump], { env })
  }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(dump)).digest('hex')
  console.log(`backup: ${dump}\nsha256: ${sha}\nbytes: ${fs.statSync(dump).size}`)
  const list = execFileSync('pg_restore', ['--list', dump], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const count = (re) => list.split('\n').filter((l) => re.test(l)).length
  console.log(`archive TOC: ${count(/ TABLE DATA public /)} table-data entries, ${count(/ VIEW public /)} views, ${count(/ POLICY public /)} policies, ${count(/ ACL public /)} ACLs`)
  check('pg_restore --list reads the archive', count(/ TABLE DATA public /) > 0)

  await createDb('restored_db')
  const restored = await connect('restored_db')
  await restored.query('drop schema if exists public cascade')
  execFileSync('pg_restore', [...conn, '-d', 'restored_db', '--exit-on-error', '--single-transaction', '--no-owner', dump], { env, stdio: ['ignore', 'inherit', 'inherit'] })
  check('pg_restore into a disposable PG17 database succeeds (single transaction, exit on error)', true)

  const { checkInvariants, failedChecks } = await import(path.join(T034, 'scripts/db/lib/invariants.mjs'))
  const report = await checkInvariants(async (sql, params) => (await restored.query(sql, params)).rows)
  const f = failedChecks(report)
  check(`frozen 034 verifier on the restored copy: ${report.hard.length - f.length}/${report.hard.length}`, f.length === 0, f.map((x) => x.name).join(', '))
  if (source) {
    check('round trip: every public table row-for-row identical (ids and timestamps included)', md5(await contentHashes(source)) === md5(await contentHashes(restored)))
    const [ca, cb] = [await catalog(source), await catalog(restored)]
    const catDiff = ca.filter((x, i) => JSON.stringify(x) !== JSON.stringify(cb[i]))
    check('round trip: every public view returns identical rows', md5(await viewResults(source)) === md5(await viewResults(restored)))
    check('round trip: RLS, ACLs and reloptions identical', catDiff.length === 0 && ca.length === cb.length,
      catDiff.slice(0, 3).map((x) => `${x.relname}: ${JSON.stringify(x)} vs ${JSON.stringify(cb.find((y) => y.relname === x.relname))}`).join(' | '))
    await source.end()
  }
  await restored.end()
} catch (e) { check('run', false, e.stack) } finally { await server.stop(); fs.rmSync(dataDir, { recursive: true, force: true }) }
console.log(failed ? `\n${failed} FAILED` : '\nbackup is recoverable')
process.exitCode = failed ? 1 : 0
