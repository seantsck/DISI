#!/usr/bin/env node
// Offline audit for Migration 028. It builds the canonical chain through 027 in memory
// (no network, no real database) and checks that every canonical value in
// reconciliation-manifest.json equals what a fresh replay holds, that the manifest holds
// exactly the four reviewed corrections, and which public views the live variants change.
//
//   node database/research/028/audit.mjs   ->  database/research/028/audit-report.json

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'reconciliation-manifest.json'), 'utf8'))
const cats = manifest.categories
const failures = []
const check = (label, ok) => { if (!ok) failures.push(label) }

const tx = cats.transaction_descriptions.entries
const links = cats.class_membership_confidence.entries
check('exactly one transaction correction', tx.length === 1)
check('exactly three class-membership confidence corrections', links.length === 3)
check('the manifest holds exactly the four corrections', Object.keys(cats).sort().join() === 'class_membership_confidence,transaction_descriptions')

const ch = await buildChainThrough('027_canonical_seed_drift_reconciliation.sql')
const q = ch.query

// transaction: canonical wording equals the frozen chain; the live wording differs and is the only difference
for (const t of tx) {
  const rows = await q(`select t.return_description from transactions t join players p on p.id = t.player_id join organizations fo on fo.id = t.from_organization_id join organizations too on too.id = t.to_organization_id
    where p.slug = $1 and t.transaction_date = $2::date and t.transaction_type = $3 and fo.name = $4 and too.name = $5`,
  [t.selector.player_slug, t.selector.transaction_date, t.selector.transaction_type, t.selector.from_organization_name, t.selector.to_organization_name])
  check(`transaction ${t.selector.player_slug}: expected exactly one replay row`, rows.length === 1)
  if (rows.length === 1) check(`transaction ${t.selector.player_slug}: canonical wording differs from replay`, rows[0].return_description === t.canonical.return_description)
  check(`transaction ${t.selector.player_slug}: live wording equals canonical`, t.live.return_description !== t.canonical.return_description)
}

// class-membership links
for (const l of links) {
  const rows = await q(`select ms.confidence::text as confidence, ms.membership_basis, ms.supports_fields::text as supports_fields, ms.note
    from signing_population_member_sources ms join signing_population_members m on m.id = ms.member_id join signing_populations sp on sp.id = m.population_id
    join signings sg on sg.id = m.signing_id join players p on p.id = sg.player_id join organizations o on o.id = sg.organization_id join sources so on so.id = ms.source_id
    where sp.population_key = $1 and p.slug = $2 and o.name = $3 and sg.signing_year = $4 and so.url = $5`,
  [l.selector.population_key, l.selector.player_slug, l.selector.organization_name, l.selector.signing_year, l.selector.source_url])
  check(`link ${l.selector.player_slug}: expected exactly one replay row`, rows.length === 1)
  if (rows.length === 1) {
    const r = rows[0]
    check(`link ${l.selector.player_slug}: canonical link differs from replay`, r.confidence === l.canonical.confidence && r.membership_basis === l.canonical.membership_basis
      && r.supports_fields === l.canonical.supports_fields && r.note === l.canonical.note)
  }
  check(`link ${l.selector.player_slug}: live confidence equals canonical`, l.live.confidence !== l.canonical.confidence)
}
check('all three links cite the same 2018 class article', new Set(links.map((l) => l.selector.source_url)).size === 1 && new Set(links.map((l) => l.selector.population_key)).size === 1)

// which public views the live variants change (empirically, inside a rolled-back transaction)
const names = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)).map((r) => r.relname)
const viewHashes = async () => {
  const out = {}
  for (const v of names) {
    const cols = (await q(`select a.attname, format_type(a.atttypid, a.atttypmod) as t from pg_attribute a where a.attrelid = 'public.${v}'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`))
      .filter((c) => c.t !== 'uuid' && !/^(accessed|retrieved)/.test(c.attname))
    const rows = await q(`select ${cols.map((c) => `"${c.attname}"::text as "${c.attname}"`).join(', ')} from public.${v}`)
    out[v] = crypto.createHash('md5').update(rows.map((r) => JSON.stringify(r)).sort().join('\n')).digest('hex')
  }
  return out
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const canonicalViews = await viewHashes()
await ch.db.exec('begin;')
for (const t of tx) {
  await ch.db.exec(`update transactions set return_description = ${lit(t.live.return_description)} where return_description = ${lit(t.canonical.return_description)};`)
}
for (const l of links) {
  await ch.db.exec(`update signing_population_member_sources set confidence = ${lit(l.live.confidence)}::confidence_level where id = (select ms.id from signing_population_member_sources ms
    join signing_population_members m on m.id = ms.member_id join signing_populations sp on sp.id = m.population_id join signings sg on sg.id = m.signing_id join players p on p.id = sg.player_id
    join sources so on so.id = ms.source_id where sp.population_key = ${lit(l.selector.population_key)} and p.slug = ${lit(l.selector.player_slug)} and so.url = ${lit(l.selector.source_url)});`)
}
const driftedViews = await viewHashes()
await ch.db.exec('rollback;')
const affectedViews = names.filter((v) => canonicalViews[v] !== driftedViews[v])
check('the manifest lists exactly the views the variants change', JSON.stringify([...new Set(Object.values(cats).flatMap((c) => c.affected_views))].sort()) === JSON.stringify(affectedViews))
await ch.close()

const report = {
  audited_against: 'canonical replay 001-027 (in memory)',
  corrections: { transaction_descriptions: tx.length, class_membership_confidence: links.length, total: tx.length + links.length },
  canonical_wording: tx.map((t) => t.canonical.return_description),
  live_wording: tx.map((t) => t.live.return_description),
  links: links.map((l) => `${l.selector.player_slug} ${l.selector.population_key}: ${l.live.confidence} -> ${l.canonical.confidence}`),
  affected_views: affectedViews,
  failures,
}
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (failures.length) { console.error(`audit failed (${failures.length})`); process.exit(1) }
