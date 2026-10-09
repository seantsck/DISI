#!/usr/bin/env node
// Offline audit for Migration 027. It builds the canonical chain through 026 in memory
// (no network, no real database) and checks that every canonical value in
// reconciliation-manifest.json equals what a fresh replay holds. It also records the
// facts the guards depend on and exits non-zero on any failure.
//
//   node database/research/027/audit.mjs   ->  database/research/027/audit-report.json

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'reconciliation-manifest.json'), 'utf8'))
const cats = manifest.categories
const failures = []
const fail = (m) => failures.push(m)
const expectCount = { signing_environments: 8, signing_environment_assignments: 30, transactions: 1, player_aliases: 2, sources_missing: 12,
  source_metadata_variants: 3, evidence_missing: 26, evidence_variants: 3, evidence_note_neutralizations: 3, legacy_trainers: 2, legacy_player_trainers: 4 }
for (const [k, n] of Object.entries(expectCount)) if (cats[k]?.entries.length !== n) fail(`${k}: expected ${n} entries, found ${cats[k]?.entries.length}`)

const ch = await buildChainThrough('026_scouting_evaluation_history.sql')
const q = ch.query
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
const check = (label, ok) => { if (!ok) fail(label) }

// signing environments
const envCols = `o.name as organization_name, e.signing_year, e.regime::text as regime, e.club_bonus_pool_usd::text as club_bonus_pool_usd, e.pool_after_trades_usd::text as pool_after_trades_usd,
  e.signing_period_label, e.max_individual_bonus_usd::text as max_individual_bonus_usd, e.overage_tax_rate::text as overage_tax_rate, e.tradeable_pool_space,
  e.penalty_status, e.rules_summary, e.cba_regime, e.notes`
const envs = await q(`select ${envCols} from signing_environments e join organizations o on o.id = e.organization_id`)
for (const e of cats.signing_environments.entries) check(`environment ${JSON.stringify(e.selector)} differs from replay`, envs.some((r) => same(Object.fromEntries(Object.keys(e.canonical).map((k) => [k, r[k]])), e.canonical)))
check('replay has exactly the manifest environments', envs.length === cats.signing_environments.entries.length)

// signing -> environment links
const links = await q(`select p.slug as player_slug, o.name as organization_name, s.signing_year, eo.name as eo, e.signing_year as ey,
    s.signing_date::text as signing_date, s.country_market, s.pathway::text as pathway, s.signing_bonus_usd::text as signing_bonus_usd,
    s.bonus_publicly_reported, s.international_rank::text as international_rank, s.rank_source, s.record_scope
  from signings s join players p on p.id = s.player_id join organizations o on o.id = s.organization_id
  join signing_environments e on e.id = s.signing_environment_id join organizations eo on eo.id = e.organization_id`)
check('replay has exactly the manifest links', links.length === cats.signing_environment_assignments.entries.length)
for (const a of cats.signing_environment_assignments.entries) {
  const r = links.find((l) => l.player_slug === a.selector.player_slug && l.organization_name === a.selector.organization_name && l.signing_year === a.selector.signing_year)
  if (!r) { fail(`signing link ${JSON.stringify(a.selector)} missing in replay`); continue }
  check(`signing link ${a.selector.player_slug} environment`, r.eo === a.canonical.environment.organization_name && r.ey === a.canonical.environment.signing_year)
  check(`signing link ${a.selector.player_slug} guard fields`, same(Object.fromEntries(Object.keys(a.guard).map((k) => [k, r[k]])), a.guard))
}

// transactions
const txs = await q(`select p.slug as player_slug, t.transaction_date::text as transaction_date, t.transaction_type, fo.name as from_organization_name, too.name as to_organization_name,
    t.return_description, t.estimated_org_value_war::text as estimated_org_value_war, t.estimated_org_value_usd::text as estimated_org_value_usd, t.value_model_version, t.notes,
    so.url as source_url, t.confidence::text as confidence
  from transactions t join players p on p.id = t.player_id left join organizations fo on fo.id = t.from_organization_id left join organizations too on too.id = t.to_organization_id left join sources so on so.id = t.source_id`)
for (const t of cats.transactions.entries) check(`transaction ${JSON.stringify(t.selector)} differs from replay`, txs.some((r) => same(r, t.canonical)))

// aliases
const aliases = await q(`select p.slug as player_slug, a.alias, a.alias_type, a.language_code from player_aliases a join players p on p.id = a.player_id`)
for (const a of cats.player_aliases.entries) check(`alias ${a.selector.alias} differs from replay`, aliases.some((r) => same(r, a.canonical)))

// sources
const sources = await q(`select url, source_name, source_type, title, author, publication_date::text as publication_date, notes, source_tier from sources`)
for (const s of [...cats.sources_missing.entries, ...cats.source_metadata_variants.entries]) check(`source ${s.selector.url} differs from replay`, sources.some((r) => same(r, s.canonical)))
for (const s of cats.source_metadata_variants.entries) check(`source variant ${s.selector.url}: live equals canonical`, !same(s.live, s.canonical))

// evidence
const evidence = await q(`select p.slug as player_slug, o.name as organization_name, s.signing_year, e.field_name, so.url, e.confidence::text as confidence, e.evidence_note
  from evidence e join signings s on e.entity_type = 'signing' and s.id = e.entity_id join players p on p.id = s.player_id join organizations o on o.id = s.organization_id join sources so on so.id = e.source_id`)
const neutral = cats.evidence_note_neutralizations.neutral_note
for (const c of cats.evidence_note_neutralizations.entries) {
  const hits = evidence.filter((r) => r.player_slug === c.selector.player_slug && r.organization_name === c.selector.organization_name
    && r.signing_year === c.selector.signing_year && r.field_name === c.selector.field_name && r.url === c.selector.url)
  check(`neutralized claim ${JSON.stringify(c.selector)}: expected exactly one replay row`, hits.length === 1)
  if (hits.length === 1) check(`neutralized claim ${c.selector.player_slug}: replay must hold the original (trainer-asserting) note`, hits[0].confidence === c.replay_original.confidence && hits[0].evidence_note === c.replay_original.evidence_note)
  check(`neutralized claim ${c.selector.player_slug}: original must assert a trainer / academy`, /trainer|academy/i.test(c.replay_original.evidence_note))
  check(`neutralized claim ${c.selector.player_slug}: canonical note must be the neutral text`, c.canonical.evidence_note === neutral && c.canonical.confidence === c.replay_original.confidence)
}
check('the neutral note asserts no trainer identity', !/ramos|garcia|valera|ferreras|genao|nina|mendez/i.test(neutral) && /not carried forward pending direct source verification/.test(neutral))
for (const c of [...cats.evidence_missing.entries, ...cats.evidence_variants.entries]) {
  const hits = evidence.filter((r) => r.player_slug === c.selector.player_slug && r.organization_name === c.selector.organization_name
    && r.signing_year === c.selector.signing_year && r.field_name === c.selector.field_name && r.url === c.selector.url)
  check(`evidence ${JSON.stringify(c.selector)}: expected exactly one replay row`, hits.length === 1)
  if (hits.length === 1) check(`evidence ${JSON.stringify(c.selector)} differs from replay`, hits[0].confidence === c.canonical.confidence && hits[0].evidence_note === c.canonical.evidence_note)
}
for (const v of cats.evidence_variants.entries) check(`evidence variant ${v.selector.player_slug}: live equals canonical`, !same(v.live, v.canonical))
const claimIds = new Set([...cats.evidence_missing.entries, ...cats.evidence_variants.entries, ...cats.evidence_note_neutralizations.entries].map((c) => JSON.stringify(c.selector)))
check('evidence claims are unique', claimIds.size === cats.evidence_missing.entries.length + cats.evidence_variants.entries.length + cats.evidence_note_neutralizations.entries.length)
check('no remaining canonical note asserts a trainer / academy', [...cats.evidence_missing.entries, ...cats.evidence_variants.entries].every((c) => !/trainer|academy/i.test(c.canonical.evidence_note)))
const neutralizedNotes = cats.evidence_note_neutralizations.entries.map((c) => `${c.selector.player_slug} ${c.selector.signing_year}: "${c.replay_original.evidence_note}" -> neutral`)
const missingUrls = new Set(cats.sources_missing.entries.map((s) => s.selector.url))
const citingMissing = [...cats.evidence_missing.entries, ...cats.evidence_note_neutralizations.entries].filter((c) => missingUrls.has(c.selector.url)).length

// legacy trainers
const trainers = await q(`select name, academy_name, country, city, notes from trainers`)
const trainerLinks = await q(`select p.slug as player_slug, t.name as trainer_name, t.academy_name, pt.relationship_type, pt.start_date::text as start_date, pt.end_date::text as end_date, pt.confidence::text as confidence
  from player_trainers pt join players p on p.id = pt.player_id join trainers t on t.id = pt.trainer_id`)
check('replay has exactly the manifest trainers', trainers.length === cats.legacy_trainers.entries.length && cats.legacy_trainers.entries.every((t) => trainers.some((r) => same(r, t.canonical))))
check('replay has exactly the manifest trainer links', trainerLinks.length === cats.legacy_player_trainers.entries.length && cats.legacy_player_trainers.entries.every((t) => trainerLinks.some((r) => same(r, t.canonical))))

// the repaired objects are used by nothing in 017-026 (so reconciliation cannot change a 017-026 fact)
const sqlDir = path.join(root, 'database/sql')
const later = fs.readdirSync(sqlDir).filter((f) => /^0(1[7-9]|2[0-6])_/.test(f))
const objects = ['signing_environments', 'signing_environment_id', 'public.transactions', 'player_trainers', 'public.trainers']
const references = []
for (const f of later) {
  const text = fs.readFileSync(path.join(sqlDir, f), 'utf8').replace(/--[^\n]*/g, '')
  for (const o of objects) if (text.includes(o)) references.push(`${f}: ${o}`)
}
const missingSourceReferences = []
for (const f of later) {
  const text = fs.readFileSync(path.join(sqlDir, f), 'utf8')
  for (const u of missingUrls) if (text.includes(u.replace('https://', ''))) missingSourceReferences.push(`${f}: ${u}`)
}

// affected views exist
const views = new Set((await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v'`)).map((r) => r.relname))
const affectedViews = [...new Set(Object.values(cats).flatMap((c) => c.affected_views))].sort()
for (const v of affectedViews) check(`affected view ${v} does not exist`, views.has(v))
await ch.close()

const report = {
  audited_against: 'canonical replay 001-026 (in memory)',
  entries: Object.fromEntries(Object.keys(expectCount).map((k) => [k, cats[k].entries.length])),
  evidence_claims_total: cats.evidence_missing.entries.length + cats.evidence_variants.entries.length + cats.evidence_note_neutralizations.entries.length,
  evidence_claims_citing_missing_sources: citingMissing,
  live_observation: { signing_environments: cats.signing_environments.live_rows, trainers: cats.legacy_trainers.live_rows },
  references_to_repaired_objects_in_017_026: references,
  references_to_missing_sources_in_017_026: missingSourceReferences,
  target_rule: manifest.target_rule,
  neutralized_trainer_notes: neutralizedNotes,
  affected_views: affectedViews,
  failures,
}
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (failures.length) { console.error(`audit failed (${failures.length})`); process.exit(1) }
