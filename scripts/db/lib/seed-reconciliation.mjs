// Read-only checks for the canonical Migration-002 supplementary seed that Migration 027
// reconciled (database/research/027/reconciliation-manifest.json). Each query returns the
// NUMBER OF VIOLATIONS (expected 0): a canonical fact that is missing, duplicated or in a
// non-canonical form. They check presence and integrity of the manifest's facts only - never
// global totals - so legitimate growth of sources, evidence or transactions cannot fail them.
//
// Nothing here writes. Selectors are stable keys (player slug, organization name, signing
// year, source URL), never sequence-generated ids, so the same checks run on any database.

import fs from 'node:fs'

const manifest = JSON.parse(fs.readFileSync(new URL('../../../database/research/027/reconciliation-manifest.json', import.meta.url), 'utf8'))
const cats = manifest.categories
const lit = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
const claims = [...cats.evidence_missing.entries, ...cats.evidence_variants.entries, ...cats.evidence_note_neutralizations.entries]
const variantClaims = cats.evidence_variants.entries

const claimMatch = `ev.entity_type = 'signing' and p.slug = x -> 'selector' ->> 'player_slug' and o.name = x -> 'selector' ->> 'organization_name'
      and sg.signing_year = (x -> 'selector' ->> 'signing_year')::int and ev.field_name is not distinct from x -> 'selector' ->> 'field_name'
      and s.url = x -> 'selector' ->> 'url'`
const claimFrom = `from public.evidence ev join public.signings sg on sg.id = ev.entity_id join public.players p on p.id = sg.player_id
      join public.organizations o on o.id = sg.organization_id join public.sources s on s.id = ev.source_id`

/** name -> SQL returning one row { n } = number of violations. */
export const RECONCILIATION_QUERIES = {
  // the 8 canonical Migration-002 environments exist, once, with their stable attributes
  reconciliation_signing_environment_violations: `select count(*)::int as n from jsonb_array_elements(${lit(cats.signing_environments.entries.map((e) => e.canonical))}) x
    where (select count(*) from public.signing_environments se join public.organizations o on o.id = se.organization_id
      where o.name = x ->> 'organization_name' and se.signing_year = (x ->> 'signing_year')::int
        and jsonb_build_object('organization_name', o.name, 'signing_year', se.signing_year, 'regime', se.regime::text,
          'club_bonus_pool_usd', se.club_bonus_pool_usd::text, 'pool_after_trades_usd', se.pool_after_trades_usd::text,
          'signing_period_label', se.signing_period_label, 'max_individual_bonus_usd', se.max_individual_bonus_usd::text,
          'overage_tax_rate', se.overage_tax_rate::text, 'tradeable_pool_space', se.tradeable_pool_space, 'penalty_status', se.penalty_status,
          'rules_summary', se.rules_summary, 'cba_regime', se.cba_regime, 'notes', se.notes) = x) <> 1`,

  // the 30 affected signings resolve to their expected environment
  reconciliation_signing_link_violations: `select count(*)::int as n from jsonb_array_elements(${lit(cats.signing_environment_assignments.entries.map((e) => ({ selector: e.selector, environment: e.canonical.environment })))}) x
    where (select count(*) from public.signings sg join public.players p on p.id = sg.player_id join public.organizations o on o.id = sg.organization_id
      join public.signing_environments se on se.id = sg.signing_environment_id join public.organizations eo on eo.id = se.organization_id
      where p.slug = x -> 'selector' ->> 'player_slug' and o.name = x -> 'selector' ->> 'organization_name'
        and sg.signing_year = (x -> 'selector' ->> 'signing_year')::int
        and eo.name = x -> 'environment' ->> 'organization_name' and se.signing_year = (x -> 'environment' ->> 'signing_year')::int) <> 1`,

  // no affected signing is left without an environment
  reconciliation_affected_signings_without_environment: `select count(*)::int as n from jsonb_array_elements(${lit(cats.signing_environment_assignments.entries.map((e) => e.selector))}) x
    where exists (select 1 from public.signings sg join public.players p on p.id = sg.player_id join public.organizations o on o.id = sg.organization_id
      where p.slug = x ->> 'player_slug' and o.name = x ->> 'organization_name' and sg.signing_year = (x ->> 'signing_year')::int
        and sg.signing_environment_id is null)`,

  // the Lantigua -> Cincinnati trade exists exactly once, in canonical form
  reconciliation_transaction_violations: `select count(*)::int as n from jsonb_array_elements(${lit(cats.transactions.entries.map((e) => e.canonical))}) x
    where (select count(*) from public.transactions t join public.players p on p.id = t.player_id
      where p.slug = x ->> 'player_slug' and t.transaction_date = (x ->> 'transaction_date')::date and t.transaction_type = x ->> 'transaction_type') <> 1
      or (select count(*) from public.transactions t join public.players p on p.id = t.player_id
        left join public.organizations fo on fo.id = t.from_organization_id left join public.organizations too on too.id = t.to_organization_id
        left join public.sources so on so.id = t.source_id
        where p.slug = x ->> 'player_slug' and t.transaction_date = (x ->> 'transaction_date')::date and t.transaction_type = x ->> 'transaction_type'
          and fo.name is not distinct from x ->> 'from_organization_name' and too.name is not distinct from x ->> 'to_organization_name'
          and t.return_description is not distinct from x ->> 'return_description' and so.url is not distinct from x ->> 'source_url'
          and t.confidence::text = x ->> 'confidence') <> 1`,

  // the two committed aliases exist exactly once
  reconciliation_alias_violations: `select count(*)::int as n from jsonb_array_elements(${lit(cats.player_aliases.entries.map((e) => e.canonical))}) x
    where (select count(*) from public.player_aliases a join public.players p on p.id = a.player_id
      where p.slug = x ->> 'player_slug' and a.alias = x ->> 'alias' and a.alias_type is not distinct from x ->> 'alias_type'
        and a.language_code is not distinct from x ->> 'language_code') <> 1`,

  // the 12 restored sources exist, and the 3 metadata-sensitive URLs have their canonical metadata
  reconciliation_source_violations: `select count(*)::int as n from jsonb_array_elements(${lit([...cats.sources_missing.entries, ...cats.source_metadata_variants.entries].map((e) => e.canonical))}) x
    where (select count(*) from public.sources s
      where s.url = x ->> 'url' and s.source_name = x ->> 'source_name' and s.source_type = x ->> 'source_type'
        and s.title is not distinct from x ->> 'title' and s.source_tier is not distinct from x ->> 'source_tier'
        and s.publication_date is not distinct from (x ->> 'publication_date')::date) <> 1`,

  // each canonical evidence claim exists exactly once, in canonical form
  reconciliation_evidence_violations: `select count(*)::int as n from jsonb_array_elements(${lit(claims.map((c) => ({ selector: c.selector, canonical: c.canonical })))}) x
    where (select count(*) ${claimFrom} where ${claimMatch}) <> 1
       or (select count(*) ${claimFrom} where ${claimMatch}
             and ev.confidence::text = x -> 'canonical' ->> 'confidence' and ev.evidence_note is not distinct from x -> 'canonical' ->> 'evidence_note') <> 1`,

  // a known drift variant never coexists with, or replaces, the canonical claim
  reconciliation_evidence_variant_coexistence: `select count(*)::int as n from jsonb_array_elements(${lit(variantClaims.map((c) => ({ selector: c.selector, live: c.live })))}) x
    where exists (select 1 ${claimFrom} where ${claimMatch}
      and ev.confidence::text = x -> 'live' ->> 'confidence' and ev.evidence_note is not distinct from x -> 'live' ->> 'evidence_note')`,

  // the seed notes that asserted unverified trainer relationships never come back
  reconciliation_trainer_note_violations: `select count(*)::int as n from jsonb_array_elements(${lit(cats.evidence_note_neutralizations.entries.map((c) => c.replay_original.evidence_note))}) x
    where exists (select 1 from public.evidence ev where ev.evidence_note = x #>> '{}')`,

  // the unsupported Migration-002 trainer seed stays removed until 028 retires the legacy objects
  legacy_trainers_rows: 'select count(*)::int as n from public.trainers',
  legacy_player_trainers_rows: 'select count(*)::int as n from public.player_trainers',
}

export const RECONCILIATION_CHECK_NAMES = Object.keys(RECONCILIATION_QUERIES)
