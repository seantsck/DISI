// Test helper: SQL that turns a canonical 001->026 database into the KNOWN live drift of the
// Migration-002 supplementary seed, built from the reconciliation manifest (stable selectors,
// never ids). Used by the 027 reconciliation tests and the verifier drift tests.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const manifest027 = JSON.parse(fs.readFileSync(path.join(root, 'database/research/027/reconciliation-manifest.json'), 'utf8'))
export const cats027 = manifest027.categories

export const lit = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)

const signingId = (s) => `(select sg.id from signings sg join players p on p.id = sg.player_id join organizations o on o.id = sg.organization_id
  where p.slug = ${lit(s.player_slug)} and o.name = ${lit(s.organization_name)} and sg.signing_year = ${Number(s.signing_year)})`
const sourceId = (url) => `(select id from sources where url = ${lit(url)})`
const claimWhere = (sel) => `entity_type = 'signing' and entity_id = ${signingId(sel)} and field_name is not distinct from ${lit(sel.field_name)} and source_id = ${sourceId(sel.url)}`

/** Parts of the drift, individually addressable so tests can apply them one at a time. */
export const driftParts = {
  environments: () => `update signings set signing_environment_id = null where signing_environment_id is not null; delete from signing_environments;`,
  transaction: () => cats027.transactions.entries.map((t) => `delete from transactions where player_id = (select id from players where slug = ${lit(t.selector.player_slug)})
    and transaction_date = ${lit(t.selector.transaction_date)} and transaction_type = ${lit(t.selector.transaction_type)};`).join('\n'),
  aliases: () => cats027.player_aliases.entries.map((a) => `delete from player_aliases where alias = ${lit(a.selector.alias)}
    and player_id = (select id from players where slug = ${lit(a.selector.player_slug)});`).join('\n'),
  // delete every missing claim (and the 3 variant claims), then restore the 3 live variants; finally drop the 12 sources
  evidence: () => [
    ...[...cats027.evidence_missing.entries, ...cats027.evidence_note_neutralizations.entries].map((c) => `delete from evidence where ${claimWhere(c.selector)};`),
    ...cats027.evidence_variants.entries.map((c) => `update evidence set confidence = ${lit(c.live.confidence)}::confidence_level, evidence_note = ${lit(c.live.evidence_note)}
      where ${claimWhere(c.selector)};`),
  ].join('\n'),
  sourceMetadata: () => cats027.source_metadata_variants.entries.map((s) => `update sources set source_type = ${lit(s.live.source_type)}, title = ${lit(s.live.title)},
    publication_date = ${s.live.publication_date ? `${lit(s.live.publication_date)}::date` : 'null'}, source_tier = ${lit(s.live.source_tier)}, source_name = ${lit(s.live.source_name)}
    where url = ${lit(s.selector.url)};`).join('\n'),
  missingSources: () => cats027.sources_missing.entries.map((s) => `delete from sources where url = ${lit(s.selector.url)};`).join('\n'),
  trainers: () => `delete from player_trainers; delete from trainers;`,
}

/** The whole known live drift, in dependency order. */
export const liveDriftSql = ({ trainers = true } = {}) => [
  driftParts.environments(), driftParts.transaction(), driftParts.aliases(), driftParts.evidence(), driftParts.sourceMetadata(),
  driftParts.missingSources(), ...(trainers ? [driftParts.trainers()] : []),
].join('\n')

/** Removes the leading `begin;` and trailing `commit;` so a migration can run inside a caller-owned transaction. */
export const withoutTransaction = (sql) => sql.replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '')
