// Read-only structural checks for the signing-network layer (Migration 029).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0) of a structural or integrity rule.
// None of them pins research coverage: how many entities, relationships or attributed players
// exist may legitimately grow, so counts such as "5 of 64" are seed facts tested elsewhere,
// never permanent hard invariants. Nothing here writes.

const PERIOD_SHAPE = (side) => `not coalesce(case ${side}_precision
    when 'DAY' then ${side}_date is not null and ${side}_year = extract(year from ${side}_date)::int and ${side}_month = extract(month from ${side}_date)::int
    when 'MONTH' then ${side}_date is null and ${side}_year is not null and ${side}_month is not null
    when 'YEAR' then ${side}_date is null and ${side}_year is not null and ${side}_month is null
    when 'SEASON' then ${side}_date is null and ${side}_year is not null and ${side}_month is null
    when 'UNKNOWN' then ${side}_date is null and ${side}_year is null and ${side}_month is null
  end, false)`

// Fixed fixtures for the deterministic normaliser (input, expected key). Differences here mean the
// function stopped being engine-independent.
export const LOOKUP_FIXTURES = [
  ['Raúl Valera', 'raul valera'],
  ['Raul Valera', 'raul valera'],
  ['Banana', 'banana'],
  ["Franklin Ferreras' program", 'franklin ferreras program'],
  ["Yasser Mendez's academy", 'yasser mendez s academy'],
  ['  JOSÉ   PEÑA-ÑANDÚ, Jr. ', 'jose pena nandu jr'],
  ['International Prospect League (IPL)', 'international prospect league ipl'],
  ['ÁÉÍÓÚ áéíóú ÀÈÌÒÙ ÂÊÎÔÛ ÄËÏÖÜ Ç ç', 'aeiou aeiou aeiou aeiou aeiou c c'],
  ['İstanbul', 'stanbul'],
]
const sqlLiteral = (value) => `'${value.replace(/'/g, "''")}'`
const fixtureRows = LOOKUP_FIXTURES.map(([input, expected]) => `(${sqlLiteral(input)}, ${sqlLiteral(expected)})`).join(', ')

/** name -> SQL returning one row { n } = number of violations. */
export const NETWORK_QUERIES = {
  // the retired Migration-002 trainer layer is gone (replaces the 027 empty-table checks)
  network_legacy_trainer_objects_present: `select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace
    and relname in ('trainers', 'player_trainers', 'v_player_trainers', 'v_dodgers_trainer_network')`,

  // every entity carries creation provenance; the descriptor anchor is a PERSON and only a DESCRIPTIVE entity has one
  network_entity_provenance_violations: `select count(*)::int as n from public.network_entities
    where source_id is null or evidence_basis is null or confidence is null or retrieved_at is null or nullif(btrim(canonical_name), '') is null
       or not exists (select 1 from public.sources s where s.id = source_id)`,
  network_entity_anchor_violations: `select count(*)::int as n from public.network_entities e
    where (e.name_basis = 'DESCRIPTIVE' and (e.descriptor_anchor_entity_id is null or not exists (select 1 from public.network_entities a where a.id = e.descriptor_anchor_entity_id and a.entity_type = 'PERSON')))
       or (e.name_basis <> 'DESCRIPTIVE' and e.descriptor_anchor_entity_id is not null)
       or e.descriptor_anchor_entity_id = e.id`,

  // alias provenance and lookup integrity: the stored key is exactly what the normaliser returns
  network_alias_violations: `select count(*)::int as n from public.network_entity_aliases a
    where a.source_id is null or not exists (select 1 from public.network_entities e where e.id = a.entity_id)
       or not exists (select 1 from public.sources s where s.id = a.source_id)
       or a.lookup_key is distinct from public.disi_network_lookup_key(a.alias) or a.lookup_key = ''`,

  // orphans and provenance on both relationship tables
  network_player_relationship_violations: `select count(*)::int as n from public.player_network_relationships r
    where not exists (select 1 from public.players p where p.id = r.player_id) or not exists (select 1 from public.network_entities e where e.id = r.entity_id)
       or not exists (select 1 from public.sources s where s.id = r.source_id) or r.evidence_basis is null or r.retrieved_at is null`,
  network_entity_relationship_violations: `select count(*)::int as n from public.network_entity_relationships r
    where not exists (select 1 from public.network_entities e where e.id = r.subject_entity_id) or not exists (select 1 from public.network_entities e where e.id = r.object_entity_id)
       or not exists (select 1 from public.sources s where s.id = r.source_id) or r.evidence_basis is null or r.retrieved_at is null or r.subject_entity_id = r.object_entity_id`,

  // relationship / entity type compatibility (both tables)
  network_relationship_compatibility_violations: `select (
      (select count(*) from public.player_network_relationships r join public.network_entities e on e.id = r.entity_id
        where not (case r.relationship_type
          when 'TRAINED_WITH' then e.entity_type = 'PERSON'
          when 'DEVELOPED_AT' then e.entity_type in ('ACADEMY', 'PROGRAM')
          when 'SIGNED_OUT_OF' then e.entity_type in ('ACADEMY', 'PROGRAM')
          when 'SHOWCASED_IN' then e.entity_type = 'SHOWCASE_LEAGUE'
          when 'REPRESENTED_BY' then e.entity_type in ('PERSON', 'AGENCY') else false end))
    + (select count(*) from public.network_entity_relationships r join public.network_entities s on s.id = r.subject_entity_id join public.network_entities o on o.id = r.object_entity_id
        where not (case r.relationship_type
          when 'OPERATES' then s.entity_type = 'PERSON' and o.entity_type in ('ACADEMY', 'PROGRAM')
          when 'AFFILIATED_WITH' then s.entity_type = 'PERSON' and o.entity_type in ('ACADEMY', 'PROGRAM')
          when 'MEMBER_OF' then s.entity_type = 'PERSON' and o.entity_type = 'PROGRAM'
          when 'SUCCEEDED_BY' then s.entity_type = o.entity_type
          when 'MERGED_INTO' then s.entity_type = o.entity_type else false end))
    )::int as n`,

  // a relationship tied to a signing belongs to that signing's player
  network_signing_player_mismatches: `select count(*)::int as n from public.player_network_relationships r
    where r.signing_id is not null and not exists (select 1 from public.signings s where s.id = r.signing_id and s.player_id = r.player_id)`,

  // period shape: only DAY carries a date, no invented first-of-month, end never before start
  network_period_violations: `select (
      (select count(*) from public.player_network_relationships where ${PERIOD_SHAPE('start')} or ${PERIOD_SHAPE('end')}
         or (start_date is not null and end_date is not null and end_date < start_date) or (start_year is not null and end_year is not null and end_year < start_year))
    + (select count(*) from public.network_entity_relationships where ${PERIOD_SHAPE('start')} or ${PERIOD_SHAPE('end')}
         or (start_date is not null and end_date is not null and end_date < start_date) or (start_year is not null and end_year is not null and end_year < start_year))
    )::int as n`,

  // lifecycle and supersession integrity (both tables): retraction is recorded, no ACTIVE predecessor, same player / type, one replacement
  network_supersession_violations: `select (
      (select count(*) from public.player_network_relationships r
        where (r.record_status = 'RETRACTED' and (r.retracted_at is null or nullif(btrim(r.retraction_reason), '') is null))
           or (r.record_status = 'ACTIVE' and (r.retracted_at is not null or r.retraction_reason is not null))
           or (r.supersedes_relationship_id is not null and (r.supersedes_relationship_id = r.id or not exists (select 1 from public.player_network_relationships o
                where o.id = r.supersedes_relationship_id and o.player_id = r.player_id and o.relationship_type = r.relationship_type and o.record_status = 'RETRACTED')))
           or exists (select 1 from public.player_network_relationships x where x.supersedes_relationship_id = r.supersedes_relationship_id and x.id <> r.id and r.supersedes_relationship_id is not null))
    + (select count(*) from public.network_entity_relationships r
        where (r.record_status = 'RETRACTED' and (r.retracted_at is null or nullif(btrim(r.retraction_reason), '') is null))
           or (r.record_status = 'ACTIVE' and (r.retracted_at is not null or r.retraction_reason is not null))
           or (r.supersedes_relationship_id is not null and (r.supersedes_relationship_id = r.id or not exists (select 1 from public.network_entity_relationships o
                where o.id = r.supersedes_relationship_id and o.relationship_type = r.relationship_type and o.record_status = 'RETRACTED'
                  and (o.subject_entity_id = r.subject_entity_id or o.object_entity_id = r.object_entity_id))))
           or exists (select 1 from public.network_entity_relationships x where x.supersedes_relationship_id = r.supersedes_relationship_id and x.id <> r.id and r.supersedes_relationship_id is not null))
    )::int as n`,

  // sealing: a guard trigger on each of the four tables, each covering INSERT, UPDATE and DELETE
  network_guard_trigger_violations: `select (4 - count(*))::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgenabled <> 'D' and (t.tgtype & 28) = 28
      and c.relname in ('network_entities', 'network_entity_aliases', 'network_entity_relationships', 'player_network_relationships')
      and t.tgname in ('network_entities_guard', 'network_entity_aliases_guard', 'network_entity_relationships_guard', 'player_network_relationships_guard')`,

  // identity reviews: each pair once in fixed order, status and review timestamp agree
  network_identity_review_violations: `select count(*)::int as n from public.network_entity_identity_reviews r
    where r.entity_a_id >= r.entity_b_id or ((r.status = 'OPEN') <> (r.reviewed_at is null))
       or r.status not in ('OPEN', 'DISTINCT', 'SAME_PENDING_MERGE')`,

  // the normaliser is still deterministic: IMMUTABLE, invoker rights, empty search_path, no API EXECUTE, and the fixed fixtures hold
  network_normalizer_violations: `select (
      (select count(*) from (values ${fixtureRows}) f(input, expected) where public.disi_network_lookup_key(f.input) is distinct from f.expected)
    + (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'disi_network_lookup_key'
        and (p.provolatile <> 'i' or p.prosecdef or not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
             or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute')))
    + (select case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'disi_network_lookup_key') then 0 else 1 end)
    )::int as n`,
}

export const NETWORK_CHECK_NAMES = Object.keys(NETWORK_QUERIES)
