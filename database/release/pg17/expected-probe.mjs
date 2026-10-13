// Runs database/release/sql/live-state-probe.sql on disposable PG17 databases built from the frozen 034 (1edf314) and from 034 + 035
// (candidate sources) and prints the expected probe output for each state. Never touches a hosted database.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const WORK = path.resolve(process.argv[2]), REPO = path.resolve(process.argv[3])
const req = createRequire(path.join(WORK, 'deps', 'package.json'))
const { default: EmbeddedPostgres } = await import(pathToFileURL(req.resolve('embedded-postgres')).href)
const { default: pg } = await import(pathToFileURL(req.resolve('pg')).href)
const port = 56000 + Math.floor(Math.random() * 900)
const dataDir = path.join(WORK, 'pgdata-probe-' + port)
const probe = fs.readFileSync(path.join(REPO, 'database/release/sql/live-state-probe.sql'), 'utf8')
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {} })
await server.initialise(); await server.start()
const connect = async (db) => { const c = new pg.Client({ host: 'localhost', port, user: 'postgres', password: 'postgres', database: db }); await c.connect(); return c }
try {
  for (const [label, root, upto] of [['frozen 034 (1edf314)', 't034', 34], ['034 + 035 (candidate)', 't035', 35]]) {
    const name = `probe_${upto}`
    const a = await connect('postgres'); await a.query(`create database ${name}`); await a.end()
    const c = await connect(name)
    await c.query('create role anon nologin').catch(() => {}); await c.query('create role authenticated nologin').catch(() => {})
    const files = JSON.parse(fs.readFileSync(path.join(WORK, root, 'database/manifest.json'), 'utf8')).canonical_sql.slice(0, upto)
    for (const f of files) await c.query(fs.readFileSync(path.join(WORK, root, 'database/sql', f), 'utf8'))
    const results = [].concat(await c.query(probe)).filter((r) => r.command === 'SELECT')
    console.log(`\n=== expected probe output: ${label}`)
    for (const r of results.slice(1)) console.table(r.rows)
    await c.end()
  }
} finally { await server.stop(); fs.rmSync(dataDir, { recursive: true, force: true }) }
