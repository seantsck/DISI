-- DISI v0.18
-- 027_canonical_seed_drift_reconciliation.sql
-- Canonical seed drift reconciliation. Run after 026.
--
-- Built from database/research/027/ (reconciliation-manifest.json, audit.mjs, build.mjs).
--
-- Why. The committed Migration-002 seed contains supplementary rows that the live
-- database never received, and one block of that seed (two trainers, four player-
-- trainer links) is unsupported. A fresh 001 -> 026 replay and live therefore did not
-- represent the same canonical facts. This is a normal forward migration: it makes a
-- fresh replay and live converge. Migrations 001-026 are not edited.
--
-- What it does (every step is guarded and idempotent):
--   1. Sources: restores the 12 missing Migration-002 MLB.com sources and normalises the
--      3 URLs whose type / title / tier differ, to the committed canonical representation.
--      The identity of a source is its URL.
--   2. Signing environments: restores the 8 committed environments (organization + signing year).
--   3. Signing -> environment links: links the 30 affected signings. Each must either already
--      be linked to its expected environment, or have a NULL link with every guarded signing
--      field equal to the manifest.
--   4. Transactions: restores the Lantigua -> Cincinnati trade (2025-01-17), once.
--   5. Aliases: restores the two committed source-spelling aliases, nothing else.
--   6. Signing evidence: restores the 26 missing canonical claims and updates the 3 live
--      variants (same signing, field and source as the canonical claim, a different
--      confidence / note written by a later migration) in place to the committed form.
--      A claim's identity is (signing, field_name, source URL); no semantic duplicate is
--      kept and no evidence row is ever deleted. Three further claims (Morales 2024, Melburne
--      2026, Arias 2026) are restored with a NEUTRAL note: the committed seed note asserted that
--      an MLB.com article reported trainer relationships, which has not been directly verified.
--      The evidence row stays as signing provenance; the note neither asserts nor denies a
--      trainer / academy relationship. A replay holding the original note is corrected in place.
--   7. Legacy trainer seed: removes the two unsupported trainers and four links. Removal means
--      DISI lacks sufficient verified evidence for these relationships; it does not mean the
--      players had no trainer or academy. The legacy tables and views stay until 028.
--
-- Allowed starting states are the canonical replay and the known live drift. Any other state
-- (a changed environment link, a conflicting transaction, unexpected source metadata, an
-- unexpected evidence variant, unexpected trainer data) aborts the whole transaction.
--
-- Joins use stable keys only: player slug, organization name, signing year, source URL.
-- No sequence-generated id and no mutable player name is used as a join key.
--
-- Not reconciled on purpose: capitalisation differences caused by engine-specific initcap(),
-- float formatting and retrieval timestamps. They do not change canonical meaning. New migration
-- logic must not use initcap() or any locale- or engine-sensitive normalisation.
--
-- Data only: no table, view, function, grant, policy or RLS setting changes.

begin;

create temporary table _m027 on commit drop as
select $m027${{payload_json}}$m027$::jsonb as j;

-- ===========================================================================
-- 1. SOURCES
-- ===========================================================================

do $$
declare
  e jsonb;
  cur public.sources%rowtype;
  cur_json jsonb;
begin
  -- the three URLs whose metadata differs: canonical or the exact known live variant
  for e in select x from _m027, jsonb_array_elements(j -> 'source_metadata_variants') x loop
    select * into cur from public.sources where url = e -> 'canonical' ->> 'url';
    if not found then
      raise exception '027: source % is missing; expected its canonical or known live variant', e -> 'canonical' ->> 'url';
    end if;
    cur_json := jsonb_build_object('url', cur.url, 'source_name', cur.source_name, 'source_type', cur.source_type, 'title', cur.title,
      'author', cur.author, 'publication_date', cur.publication_date::text, 'notes', cur.notes, 'source_tier', cur.source_tier);
    if cur_json = e -> 'canonical' then
      null;
    elsif cur_json = e -> 'live' then
      update public.sources set
        source_name = e -> 'canonical' ->> 'source_name', source_type = e -> 'canonical' ->> 'source_type',
        title = e -> 'canonical' ->> 'title', author = e -> 'canonical' ->> 'author',
        publication_date = (e -> 'canonical' ->> 'publication_date')::date, notes = e -> 'canonical' ->> 'notes',
        source_tier = e -> 'canonical' ->> 'source_tier'
      where id = cur.id;
    else
      raise exception '027: source % has unexpected metadata %', cur.url, cur_json;
    end if;
  end loop;

  -- the twelve missing sources: absent (insert) or already canonical
  for e in select x from _m027, jsonb_array_elements(j -> 'sources_missing') x loop
    select * into cur from public.sources where url = e -> 'canonical' ->> 'url';
    if not found then
      insert into public.sources (source_name, source_type, title, url, author, publication_date, notes, source_tier)
      values (e -> 'canonical' ->> 'source_name', e -> 'canonical' ->> 'source_type', e -> 'canonical' ->> 'title',
        e -> 'canonical' ->> 'url', e -> 'canonical' ->> 'author', (e -> 'canonical' ->> 'publication_date')::date,
        e -> 'canonical' ->> 'notes', e -> 'canonical' ->> 'source_tier');
    else
      cur_json := jsonb_build_object('url', cur.url, 'source_name', cur.source_name, 'source_type', cur.source_type, 'title', cur.title,
        'author', cur.author, 'publication_date', cur.publication_date::text, 'notes', cur.notes, 'source_tier', cur.source_tier);
      if cur_json <> e -> 'canonical' then
        raise exception '027: source % exists with unexpected metadata %', cur.url, cur_json;
      end if;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 2. SIGNING ENVIRONMENTS
-- ===========================================================================

do $$
declare
  e jsonb;
  c jsonb;
  org_id uuid;
  cur public.signing_environments%rowtype;
  cur_json jsonb;
begin
  for e in select x from _m027, jsonb_array_elements(j -> 'signing_environments') x loop
    c := e -> 'canonical';
    select id into org_id from public.organizations where name = c ->> 'organization_name';
    if org_id is null then
      raise exception '027: organization % not found', c ->> 'organization_name';
    end if;
    select * into cur from public.signing_environments where organization_id = org_id and signing_year = (c ->> 'signing_year')::int;
    if not found then
      insert into public.signing_environments (organization_id, signing_year, regime, club_bonus_pool_usd, pool_after_trades_usd,
        signing_period_label, max_individual_bonus_usd, overage_tax_rate, tradeable_pool_space, penalty_status, rules_summary, cba_regime, notes)
      values (org_id, (c ->> 'signing_year')::int, (c ->> 'regime')::public.signing_regime, (c ->> 'club_bonus_pool_usd')::numeric,
        (c ->> 'pool_after_trades_usd')::numeric, c ->> 'signing_period_label', (c ->> 'max_individual_bonus_usd')::numeric,
        (c ->> 'overage_tax_rate')::numeric, (c ->> 'tradeable_pool_space')::boolean, c ->> 'penalty_status', c ->> 'rules_summary',
        c ->> 'cba_regime', c ->> 'notes');
    else
      cur_json := jsonb_build_object('organization_name', c ->> 'organization_name', 'signing_year', cur.signing_year, 'regime', cur.regime::text,
        'club_bonus_pool_usd', cur.club_bonus_pool_usd::text, 'pool_after_trades_usd', cur.pool_after_trades_usd::text,
        'signing_period_label', cur.signing_period_label, 'max_individual_bonus_usd', cur.max_individual_bonus_usd::text,
        'overage_tax_rate', cur.overage_tax_rate::text, 'tradeable_pool_space', cur.tradeable_pool_space, 'penalty_status', cur.penalty_status,
        'rules_summary', cur.rules_summary, 'cba_regime', cur.cba_regime, 'notes', cur.notes);
      if cur_json <> c then
        raise exception '027: signing environment % / % exists with unexpected content %', c ->> 'organization_name', c ->> 'signing_year', cur_json;
      end if;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 3. SIGNING -> ENVIRONMENT LINKS
-- ===========================================================================

do $$
declare
  e jsonb;
  s public.signings%rowtype;
  env_id uuid;
  guard_now jsonb;
begin
  for e in select x from _m027, jsonb_array_elements(j -> 'signing_environment_assignments') x loop
    select sg.* into s
    from public.signings sg
    join public.players p on p.id = sg.player_id
    join public.organizations o on o.id = sg.organization_id
    where p.slug = e -> 'selector' ->> 'player_slug' and o.name = e -> 'selector' ->> 'organization_name'
      and sg.signing_year = (e -> 'selector' ->> 'signing_year')::int;
    if not found then
      raise exception '027: signing % not found', e -> 'selector';
    end if;
    select se.id into env_id
    from public.signing_environments se join public.organizations o on o.id = se.organization_id
    where o.name = e -> 'canonical' -> 'environment' ->> 'organization_name'
      and se.signing_year = (e -> 'canonical' -> 'environment' ->> 'signing_year')::int;
    if env_id is null then
      raise exception '027: environment % not found', e -> 'canonical' -> 'environment';
    end if;
    guard_now := jsonb_build_object('signing_date', s.signing_date::text, 'country_market', s.country_market, 'pathway', s.pathway::text,
      'signing_bonus_usd', s.signing_bonus_usd::text, 'bonus_publicly_reported', s.bonus_publicly_reported,
      'international_rank', s.international_rank::text, 'rank_source', s.rank_source, 'record_scope', s.record_scope);
    if guard_now <> e -> 'guard' then
      raise exception '027: signing % differs from the expected canonical fields: %', e -> 'selector', guard_now;
    end if;
    if s.signing_environment_id is null then
      update public.signings set signing_environment_id = env_id where id = s.id;
    elsif s.signing_environment_id <> env_id then
      raise exception '027: signing % is linked to an unexpected environment', e -> 'selector';
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 4. TRANSACTIONS
-- ===========================================================================

do $$
declare
  e jsonb;
  c jsonb;
  pid uuid;
  fo uuid;
  too uuid;
  sid uuid;
  total int;
  matching int;
begin
  for e in select x from _m027, jsonb_array_elements(j -> 'transactions') x loop
    c := e -> 'canonical';
    select id into pid from public.players where slug = c ->> 'player_slug';
    select id into fo from public.organizations where name = c ->> 'from_organization_name';
    select id into too from public.organizations where name = c ->> 'to_organization_name';
    select id into sid from public.sources where url = c ->> 'source_url';
    if pid is null or fo is null or too is null or sid is null then
      raise exception '027: transaction references are unresolved: %', e -> 'selector';
    end if;
    select count(*),
           count(*) filter (where t.from_organization_id is not distinct from fo and t.to_organization_id is not distinct from too
             and t.return_description is not distinct from c ->> 'return_description'
             and t.estimated_org_value_war is not distinct from (c ->> 'estimated_org_value_war')::numeric
             and t.estimated_org_value_usd is not distinct from (c ->> 'estimated_org_value_usd')::numeric
             and t.value_model_version is not distinct from c ->> 'value_model_version'
             and t.notes is not distinct from c ->> 'notes'
             and t.source_id is not distinct from sid and t.confidence::text = c ->> 'confidence')
      into total, matching
    from public.transactions t
    where t.player_id = pid and t.transaction_date = (c ->> 'transaction_date')::date and t.transaction_type = c ->> 'transaction_type';
    if total = 0 then
      insert into public.transactions (player_id, transaction_date, transaction_type, from_organization_id, to_organization_id,
        return_description, estimated_org_value_war, estimated_org_value_usd, value_model_version, notes, source_id, confidence)
      values (pid, (c ->> 'transaction_date')::date, c ->> 'transaction_type', fo, too, c ->> 'return_description',
        (c ->> 'estimated_org_value_war')::numeric, (c ->> 'estimated_org_value_usd')::numeric, c ->> 'value_model_version', c ->> 'notes',
        sid, (c ->> 'confidence')::public.confidence_level);
    elsif total <> 1 or matching <> 1 then
      raise exception '027: a conflicting transaction exists for %', e -> 'selector';
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 5. ALIASES
-- ===========================================================================

do $$
declare
  e jsonb;
  c jsonb;
  pid uuid;
  cur public.player_aliases%rowtype;
begin
  for e in select x from _m027, jsonb_array_elements(j -> 'player_aliases') x loop
    c := e -> 'canonical';
    select id into pid from public.players where slug = c ->> 'player_slug';
    if pid is null then
      raise exception '027: player % not found', c ->> 'player_slug';
    end if;
    select * into cur from public.player_aliases where player_id = pid and alias = c ->> 'alias';
    if not found then
      insert into public.player_aliases (player_id, alias, alias_type, language_code)
      values (pid, c ->> 'alias', c ->> 'alias_type', c ->> 'language_code');
    elsif cur.alias_type is distinct from c ->> 'alias_type' or cur.language_code is distinct from c ->> 'language_code' then
      raise exception '027: alias % exists with unexpected content', c ->> 'alias';
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 6. SIGNING EVIDENCE
-- ===========================================================================
-- Row order matters to the public timeline: v_player_timeline shows, for each signing, the
-- evidence that sorts first by (field_name nulls first, created_at). In a canonical replay the
-- seed's claims were created first. A restored (or in-place corrected) claim therefore gets a
-- created_at just before the earliest other evidence of the same signing, spaced by its replay
-- rank, so a repaired live database and a fresh replay show the same source. created_at is
-- bookkeeping only; no canonical claim depends on its value.

create temporary table _m027_base on commit drop as
select sg.id as signing_id, coalesce(min(ev.created_at), now()) as base
from (select distinct sg2.id
      from _m027, jsonb_array_elements(j -> 'evidence') x
      join public.players p on p.slug = x -> 'selector' ->> 'player_slug'
      join public.organizations o on o.name = x -> 'selector' ->> 'organization_name'
      join public.signings sg2 on sg2.player_id = p.id and sg2.organization_id = o.id and sg2.signing_year = (x -> 'selector' ->> 'signing_year')::int) sg
left join public.evidence ev on ev.entity_type = 'signing' and ev.entity_id = sg.id
group by sg.id;

do $$
declare
  e jsonb;
  sel jsonb;
  sid uuid;
  src uuid;
  total int;
  canon int;
  variant int;
  legacy int;
  rec record;
begin
  for e in select x from _m027, jsonb_array_elements(j -> 'evidence') x loop
    sel := e -> 'selector';
    select sg.id into sid
    from public.signings sg join public.players p on p.id = sg.player_id join public.organizations o on o.id = sg.organization_id
    where p.slug = sel ->> 'player_slug' and o.name = sel ->> 'organization_name' and sg.signing_year = (sel ->> 'signing_year')::int;
    select id into src from public.sources where url = sel ->> 'url';
    if sid is null or src is null then
      raise exception '027: evidence references are unresolved: %', sel;
    end if;
    select count(*),
           count(*) filter (where ev.confidence::text = e -> 'canonical' ->> 'confidence' and ev.evidence_note is not distinct from e -> 'canonical' ->> 'evidence_note'),
           count(*) filter (where jsonb_typeof(e -> 'live') = 'object'
             and ev.confidence::text = e -> 'live' ->> 'confidence' and ev.evidence_note is not distinct from e -> 'live' ->> 'evidence_note'),
           count(*) filter (where jsonb_typeof(e -> 'legacy') = 'object'
             and ev.confidence::text = e -> 'legacy' ->> 'confidence' and ev.evidence_note is not distinct from e -> 'legacy' ->> 'evidence_note')
      into total, canon, variant, legacy
    from public.evidence ev
    where ev.entity_type = 'signing' and ev.entity_id = sid and ev.field_name is not distinct from sel ->> 'field_name' and ev.source_id = src;
    if total = 0 then
      insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note, created_at)
      values ('signing', sid, sel ->> 'field_name', src, (e -> 'canonical' ->> 'confidence')::public.confidence_level, e -> 'canonical' ->> 'evidence_note',
        (select base from _m027_base where signing_id = sid) - interval '1 second' + (e ->> 'rank')::int * interval '1 millisecond');
    elsif total = 1 and canon = 1 then
      null;
    elsif total = 1 and variant = 1 then
      update public.evidence ev set confidence = (e -> 'canonical' ->> 'confidence')::public.confidence_level,
             evidence_note = e -> 'canonical' ->> 'evidence_note',
             created_at = (select base from _m027_base where signing_id = sid) - interval '1 second' + (e ->> 'rank')::int * interval '1 millisecond'
      where ev.entity_type = 'signing' and ev.entity_id = sid and ev.field_name is not distinct from sel ->> 'field_name' and ev.source_id = src;
    elsif total = 1 and legacy = 1 then
      -- the committed seed note that asserted an unverified trainer relationship: neutralised in place
      update public.evidence ev set confidence = (e -> 'canonical' ->> 'confidence')::public.confidence_level,
             evidence_note = e -> 'canonical' ->> 'evidence_note'
      where ev.entity_type = 'signing' and ev.entity_id = sid and ev.field_name is not distinct from sel ->> 'field_name' and ev.source_id = src;
    else
      raise exception '027: unexpected evidence for claim %: % row(s), % canonical, % known-variant, % seed-note', sel, total, canon, variant, legacy;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 7. LEGACY TRAINER SEED
-- ===========================================================================
-- Allowed starting states: empty (live) or exactly the known 2 trainers and 4 links
-- (canonical replay). Anything else aborts. The tables and views stay until 028.

do $$
declare
  n_trainers int;
  n_links int;
  e jsonb;
  c jsonb;
  hits int;
  expected_trainers int;
  expected_links int;
begin
  select count(*) into n_trainers from public.trainers;
  select count(*) into n_links from public.player_trainers;
  select jsonb_array_length(j -> 'legacy_trainers'), jsonb_array_length(j -> 'legacy_player_trainers')
    into expected_trainers, expected_links from _m027;
  if n_trainers = 0 and n_links = 0 then
    return;
  end if;
  if n_trainers <> expected_trainers or n_links <> expected_links then
    raise exception '027: unexpected legacy trainer data (% trainers, % links); expected 0/0 or % / %', n_trainers, n_links, expected_trainers, expected_links;
  end if;
  for e in select x from _m027, jsonb_array_elements(j -> 'legacy_trainers') x loop
    c := e -> 'canonical';
    select count(*) into hits from public.trainers t
    where t.name = c ->> 'name' and t.academy_name is not distinct from c ->> 'academy_name' and t.country is not distinct from c ->> 'country'
      and t.city is not distinct from c ->> 'city' and t.notes is not distinct from c ->> 'notes';
    if hits <> 1 then
      raise exception '027: legacy trainer % does not match the known seed row', c ->> 'name';
    end if;
  end loop;
  for e in select x from _m027, jsonb_array_elements(j -> 'legacy_player_trainers') x loop
    c := e -> 'canonical';
    select count(*) into hits
    from public.player_trainers pt join public.players p on p.id = pt.player_id join public.trainers t on t.id = pt.trainer_id
    where p.slug = c ->> 'player_slug' and t.name = c ->> 'trainer_name' and t.academy_name is not distinct from c ->> 'academy_name'
      and pt.relationship_type = c ->> 'relationship_type' and pt.start_date is not distinct from (c ->> 'start_date')::date
      and pt.end_date is not distinct from (c ->> 'end_date')::date and pt.confidence::text = c ->> 'confidence';
    if hits <> 1 then
      raise exception '027: legacy trainer link % / % does not match the known seed row', c ->> 'player_slug', c ->> 'trainer_name';
    end if;
  end loop;
  delete from public.player_trainers;
  delete from public.trainers;
end $$;

-- ===========================================================================
-- POSTCONDITIONS: every canonical fact is present exactly once
-- ===========================================================================

do $$
declare
  e jsonb;
  c jsonb;
  n int;
begin
  for e in select x from _m027, jsonb_array_elements(j -> 'signing_environments') x loop
    c := e -> 'canonical';
    select count(*) into n from public.signing_environments se join public.organizations o on o.id = se.organization_id
    where o.name = c ->> 'organization_name' and se.signing_year = (c ->> 'signing_year')::int;
    if n <> 1 then raise exception '027 postcondition: environment % / % present % times', c ->> 'organization_name', c ->> 'signing_year', n; end if;
  end loop;
  for e in select x from _m027, jsonb_array_elements(j -> 'signing_environment_assignments') x loop
    select count(*) into n
    from public.signings sg join public.players p on p.id = sg.player_id join public.organizations o on o.id = sg.organization_id
    join public.signing_environments se on se.id = sg.signing_environment_id join public.organizations eo on eo.id = se.organization_id
    where p.slug = e -> 'selector' ->> 'player_slug' and o.name = e -> 'selector' ->> 'organization_name'
      and sg.signing_year = (e -> 'selector' ->> 'signing_year')::int
      and eo.name = e -> 'canonical' -> 'environment' ->> 'organization_name'
      and se.signing_year = (e -> 'canonical' -> 'environment' ->> 'signing_year')::int;
    if n <> 1 then raise exception '027 postcondition: signing % does not resolve to its environment', e -> 'selector'; end if;
  end loop;
  for e in select x from _m027, jsonb_array_elements(j -> 'transactions') x loop
    c := e -> 'canonical';
    select count(*) into n from public.transactions t join public.players p on p.id = t.player_id
    where p.slug = c ->> 'player_slug' and t.transaction_date = (c ->> 'transaction_date')::date and t.transaction_type = c ->> 'transaction_type';
    if n <> 1 then raise exception '027 postcondition: transaction % present % times', e -> 'selector', n; end if;
  end loop;
  for e in select x from _m027, jsonb_array_elements(j -> 'player_aliases') x loop
    c := e -> 'canonical';
    select count(*) into n from public.player_aliases a join public.players p on p.id = a.player_id
    where p.slug = c ->> 'player_slug' and a.alias = c ->> 'alias';
    if n <> 1 then raise exception '027 postcondition: alias % present % times', c ->> 'alias', n; end if;
  end loop;
  for e in select x from _m027, jsonb_array_elements(j -> 'sources_missing') x loop
    select count(*) into n from public.sources where url = e -> 'canonical' ->> 'url';
    if n <> 1 then raise exception '027 postcondition: source % present % times', e -> 'canonical' ->> 'url', n; end if;
  end loop;
  for e in select x from _m027, jsonb_array_elements(j -> 'source_metadata_variants') x loop
    c := e -> 'canonical';
    select count(*) into n from public.sources s
    where s.url = c ->> 'url' and s.source_type = c ->> 'source_type' and s.title is not distinct from c ->> 'title'
      and s.source_tier is not distinct from c ->> 'source_tier' and s.publication_date is not distinct from (c ->> 'publication_date')::date;
    if n <> 1 then raise exception '027 postcondition: source % is not in its canonical form', c ->> 'url'; end if;
  end loop;
  for e in select x from _m027, jsonb_array_elements(j -> 'evidence') x loop
    select count(*) into n
    from public.evidence ev join public.signings sg on sg.id = ev.entity_id join public.players p on p.id = sg.player_id
    join public.organizations o on o.id = sg.organization_id join public.sources s on s.id = ev.source_id
    where ev.entity_type = 'signing' and p.slug = e -> 'selector' ->> 'player_slug' and o.name = e -> 'selector' ->> 'organization_name'
      and sg.signing_year = (e -> 'selector' ->> 'signing_year')::int and ev.field_name is not distinct from e -> 'selector' ->> 'field_name'
      and s.url = e -> 'selector' ->> 'url';
    if n <> 1 then raise exception '027 postcondition: evidence claim % present % times', e -> 'selector', n; end if;
    select count(*) into n
    from public.evidence ev join public.signings sg on sg.id = ev.entity_id join public.players p on p.id = sg.player_id
    join public.organizations o on o.id = sg.organization_id join public.sources s on s.id = ev.source_id
    where ev.entity_type = 'signing' and p.slug = e -> 'selector' ->> 'player_slug' and o.name = e -> 'selector' ->> 'organization_name'
      and sg.signing_year = (e -> 'selector' ->> 'signing_year')::int and ev.field_name is not distinct from e -> 'selector' ->> 'field_name'
      and s.url = e -> 'selector' ->> 'url' and ev.confidence::text = e -> 'canonical' ->> 'confidence'
      and ev.evidence_note is not distinct from e -> 'canonical' ->> 'evidence_note';
    if n <> 1 then raise exception '027 postcondition: evidence claim % is not in its canonical form', e -> 'selector'; end if;
  end loop;
  if (select count(*) from public.trainers) <> 0 or (select count(*) from public.player_trainers) <> 0 then
    raise exception '027 postcondition: the legacy trainer seed is still present';
  end if;
end $$;

commit;
