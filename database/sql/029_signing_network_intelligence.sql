-- DISI v0.20
-- 029_signing_network_intelligence.sql
-- Trainer / academy / program / showcase signing-network layer. Run after 028.
--
-- Built from database/research/029/ (seed-evidence.json, audit.mjs, build.mjs).
--
-- What this is. A relationship / evidence layer connecting players to the people, academies,
-- programs and showcase leagues that sources name in their amateur development and signing
-- pathway. A row exists only where a source directly says so. Absence of a row means "no
-- verified network attribution stored", never "no network existed". It records associations,
-- not causes: no WAR, bonus or success credit is assigned to any network entity here.
--
-- What it does:
--   * Replaces the retired Migration-002 trainer layer (trainers, player_trainers,
--     v_player_trainers, v_dodgers_trainer_network). Those hold 0 rows on live and in a replay
--     (Migration 027); the drop is guarded and aborts if anything unexpected exists.
--   * Adds UNIQUE (id, player_id) to signings (additive) so a relationship's optional signing_id
--     can be tied to the same player by a declarative composite foreign key.
--   * Adds five tables: network_entities, network_entity_aliases, network_entity_relationships,
--     player_network_relationships and network_entity_identity_reviews.
--       - entity_type says WHAT an entity is (PERSON, ACADEMY, PROGRAM, SHOWCASE_LEAGUE, AGENCY,
--         OTHER). The ROLE (trained with, represented by, ...) lives on the relationship, so one
--         person can appear in several roles without duplicate identities. Clubs stay in organizations.
--       - name_basis (NAMED, DESCRIPTIVE, NICKNAME_ONLY) never invents a proper name. A descriptive
--         entity ("Yasser Mendez's academy") points at the person the source used to describe it
--         through descriptor_anchor_entity_id. The anchor means ONLY "the source described this entity
--         through this person"; it implies no operation, ownership or affiliation.
--       - Identity-defining fields and creation provenance are sealed. A new name is an alias.
--       - Aliases keep the exact printed spelling and a generated lookup_key from
--         disi_network_lookup_key(): fixed translate() maps and a fixed regex only (no lower(),
--         initcap() or locale-dependent behaviour), so PostgreSQL and the PGlite replay agree.
--         lookup_key is for search only; every relationship joins on entity ids.
--       - Relationships are ACTIVE or RETRACTED. ACTIVE content is sealed, deletes are forbidden,
--         retraction records when and why, and a correction is a new ACTIVE row naming the row it
--         supersedes (the predecessor is retired in the same statement).
--       - network_entity_identity_reviews records uncertain duplicate candidates. It never merges.
--   * Seeds only what the Baseball America Dodgers international reviews (2016-04-01, 2018-04-30)
--     directly state for five players: 9 entities, 1 alias, 9 player relationships.
--   * Adds four views: v_player_signing_network, v_network_entity_player_history,
--     v_dodgers_network_coverage and v_network_research_queue. All are security_invoker, SELECT-only.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 1. LEGACY TRAINER LAYER: guarded drop
-- ===========================================================================

do $$
declare
  legacy_present int;
  n_rows bigint;
  dependents int;
begin
  select count(*) into legacy_present from unnest(array[
    to_regclass('public.trainers'), to_regclass('public.player_trainers'),
    to_regclass('public.v_player_trainers'), to_regclass('public.v_dodgers_trainer_network')]) r where r is not null;
  if legacy_present = 0 then
    -- already replaced: the new layer must be present, otherwise this is an unexpected state
    if to_regclass('public.network_entities') is null then
      raise exception '029: the legacy trainer objects are gone but the network layer does not exist';
    end if;
    return;
  end if;
  if legacy_present <> 4 then
    raise exception '029: expected all four legacy trainer objects or none, found %', legacy_present;
  end if;
  select (select count(*) from public.trainers) + (select count(*) from public.player_trainers) into n_rows;
  if n_rows <> 0 then
    raise exception '029: the legacy trainer tables hold % row(s); they must be empty (Migration 027) before they can be dropped', n_rows;
  end if;
  -- nothing besides the two legacy views may depend on the legacy tables, and nothing may depend on those views
  select count(*) into dependents
  from pg_depend d
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class v on v.oid = rw.ev_class
  where d.refobjid in ('public.trainers'::regclass, 'public.player_trainers'::regclass, 'public.v_player_trainers'::regclass, 'public.v_dodgers_trainer_network'::regclass)
    and d.deptype = 'n'
    and v.relname not in ('v_player_trainers', 'v_dodgers_trainer_network');
  if dependents <> 0 then
    raise exception '029: % unexpected view(s) depend on the legacy trainer objects', dependents;
  end if;
  select count(*) into dependents from pg_constraint
  where contype = 'f' and confrelid in ('public.trainers'::regclass, 'public.player_trainers'::regclass)
    and conrelid not in ('public.player_trainers'::regclass);
  if dependents <> 0 then
    raise exception '029: an unexpected foreign key references the legacy trainer tables';
  end if;
  drop view public.v_player_trainers;
  drop view public.v_dodgers_trainer_network;
  drop table public.player_trainers;
  drop table public.trainers;
end $$;

-- ===========================================================================
-- 2. SIGNINGS: additive composite key
-- ===========================================================================
-- (id, player_id) is trivially unique because id is the primary key. It lets a relationship's
-- optional signing_id be tied to the SAME player by a declarative composite foreign key.

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.signings'::regclass and conname = 'signings_id_player_id_key') then
    alter table public.signings add constraint signings_id_player_id_key unique (id, player_id);
  end if;
end $$;

-- ===========================================================================
-- 3. DETERMINISTIC LOOKUP NORMALISER
-- ===========================================================================
-- Fixed translate() maps for supported accented Latin letters and A-Z, then a fixed regex that turns
-- every run of characters outside a-z0-9 into one space, then trim. No lower(), no initcap(), no
-- collation or locale dependence, and no character class ranges (spelled out), so a PostgreSQL
-- server and the PGlite replay return identical keys. Characters outside the map become separators.

create or replace function public.disi_network_lookup_key(p_text text)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.translate(p_text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÀÂÄÃÅĀĂĄÇĆČĎĐÉÈÊËĒĖĘĚÍÌÎÏĪĮŁĽÑŃÓÒÔÖÕØŌŐŘŠŚŤÚÙÛÜŪŮŰÝŸŹŻŽáàâäãåāăąçćčďđéèêëēėęěíìîïīįłľñńóòôöõøōőřšśťúùûüūůűýÿźżž', 'abcdefghijklmnopqrstuvwxyzaaaaaaaaacccddeeeeeeeeiiiiiillnnoooooooorsstuuuuuuuyyzzzaaaaaaaaacccddeeeeeeeeiiiiiillnnoooooooorsstuuuuuuuyyzzz'),
    '[^abcdefghijklmnopqrstuvwxyz0123456789]+', ' ', 'g'));
$$;
revoke execute on function public.disi_network_lookup_key(text) from public, anon, authenticated;

comment on function public.disi_network_lookup_key(text) is
  'Search-only normalisation of a network name: fixed accent / case maps and a fixed regex, identical on every engine. Never a join key; relationships join on entity ids.';

-- ===========================================================================
-- 4. TABLES
-- ===========================================================================

create table if not exists public.network_entities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  entity_type text not null check (entity_type in ('PERSON', 'ACADEMY', 'PROGRAM', 'SHOWCASE_LEAGUE', 'AGENCY', 'OTHER')),
  canonical_name text not null check (nullif(btrim(canonical_name), '') is not null),
  name_basis text not null check (name_basis in ('NAMED', 'DESCRIPTIVE', 'NICKNAME_ONLY')),
  descriptor_anchor_entity_id uuid references public.network_entities(id) on delete restrict,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  region text,
  city text,
  active_from_year int check (active_from_year is null or active_from_year between 1900 and 2100),
  active_to_year int check (active_to_year is null or active_to_year between 1900 and 2100),
  website_url text check (website_url is null or website_url ~ '^https?://'),
  notes text check (notes is null or char_length(notes) <= 500),
  source_id uuid not null references public.sources(id) on delete restrict,
  evidence_basis text not null check (evidence_basis in ('TEAM_RELEASE', 'MLB_PIPELINE_PROFILE', 'PUBLISHED_INTERNATIONAL_REVIEW', 'PLAYER_PROFILE',
    'TRAINER_OR_ACADEMY_PROFILE', 'INTERVIEW', 'SECONDARY_REPORT', 'MANUAL_RESEARCH', 'OTHER')),
  confidence public.confidence_level not null,
  retrieved_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint network_entities_active_years_check check (active_from_year is null or active_to_year is null or active_to_year >= active_from_year),
  constraint network_entities_anchor_check check (descriptor_anchor_entity_id is null or (name_basis = 'DESCRIPTIVE' and descriptor_anchor_entity_id <> id))
);

create table if not exists public.network_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.network_entities(id) on delete cascade,
  alias text not null check (nullif(btrim(alias), '') is not null),
  alias_type text not null check (alias_type in ('LEGAL_NAME', 'COMMON_NAME', 'NICKNAME', 'SPANISH_FORM', 'ACCENT_VARIANT', 'FORMER_NAME', 'BRAND_NAME', 'OTHER')),
  language_code text check (language_code is null or language_code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  valid_from_year int check (valid_from_year is null or valid_from_year between 1900 and 2100),
  valid_to_year int check (valid_to_year is null or valid_to_year between 1900 and 2100),
  lookup_key text generated always as (public.disi_network_lookup_key(alias)) stored,
  source_id uuid not null references public.sources(id) on delete restrict,
  confidence public.confidence_level not null,
  retrieved_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (entity_id, alias),
  constraint network_entity_aliases_key_check check (lookup_key <> ''),
  constraint network_entity_aliases_period_check check (valid_from_year is null or valid_to_year is null or valid_to_year >= valid_from_year)
);
create index if not exists network_entity_aliases_lookup_idx on public.network_entity_aliases (lookup_key);

create table if not exists public.network_entity_relationships (
  id uuid primary key default gen_random_uuid(),
  subject_entity_id uuid not null references public.network_entities(id) on delete restrict,
  relationship_type text not null check (relationship_type in ('OPERATES', 'AFFILIATED_WITH', 'MEMBER_OF', 'SUCCEEDED_BY', 'MERGED_INTO')),
  object_entity_id uuid not null references public.network_entities(id) on delete restrict,
  start_precision text not null default 'UNKNOWN' check (start_precision in ('DAY', 'MONTH', 'YEAR', 'SEASON', 'UNKNOWN')),
  start_date date,
  start_year int check (start_year is null or start_year between 1900 and 2100),
  start_month int check (start_month is null or start_month between 1 and 12),
  end_precision text not null default 'UNKNOWN' check (end_precision in ('DAY', 'MONTH', 'YEAR', 'SEASON', 'UNKNOWN')),
  end_date date,
  end_year int check (end_year is null or end_year between 1900 and 2100),
  end_month int check (end_month is null or end_month between 1 and 12),
  source_id uuid not null references public.sources(id) on delete restrict,
  evidence_basis text not null check (evidence_basis in ('TEAM_RELEASE', 'MLB_PIPELINE_PROFILE', 'PUBLISHED_INTERNATIONAL_REVIEW', 'PLAYER_PROFILE',
    'TRAINER_OR_ACADEMY_PROFILE', 'INTERVIEW', 'SECONDARY_REPORT', 'MANUAL_RESEARCH', 'OTHER')),
  confidence public.confidence_level not null,
  retrieved_at timestamptz not null,
  note text check (note is null or char_length(note) <= 300),
  record_status text not null default 'ACTIVE' check (record_status in ('ACTIVE', 'RETRACTED')),
  retracted_at timestamptz,
  retraction_reason text,
  supersedes_relationship_id uuid references public.network_entity_relationships(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint network_entity_relationships_self_check check (subject_entity_id <> object_entity_id),
  constraint network_entity_relationships_supersedes_check check (supersedes_relationship_id is null or supersedes_relationship_id <> id),
  constraint network_entity_relationships_retraction_check check ((record_status = 'RETRACTED') = (retracted_at is not null)
    and (record_status = 'ACTIVE' or nullif(btrim(retraction_reason), '') is not null)
    and (record_status = 'RETRACTED' or retraction_reason is null)),
  constraint network_entity_relationships_start_shape_check check (coalesce(case start_precision
    when 'DAY' then start_date is not null and start_year = extract(year from start_date)::int and start_month = extract(month from start_date)::int
    when 'MONTH' then start_date is null and start_year is not null and start_month is not null
    when 'YEAR' then start_date is null and start_year is not null and start_month is null
    when 'SEASON' then start_date is null and start_year is not null and start_month is null
    else start_date is null and start_year is null and start_month is null
  end, false)),
  constraint network_entity_relationships_end_shape_check check (coalesce(case end_precision
    when 'DAY' then end_date is not null and end_year = extract(year from end_date)::int and end_month = extract(month from end_date)::int
    when 'MONTH' then end_date is null and end_year is not null and end_month is not null
    when 'YEAR' then end_date is null and end_year is not null and end_month is null
    when 'SEASON' then end_date is null and end_year is not null and end_month is null
    else end_date is null and end_year is null and end_month is null
  end, false)),
  constraint network_entity_relationships_period_order_check check ((start_date is null or end_date is null or end_date >= start_date) and (start_year is null or end_year is null or end_year >= start_year))
);
create unique index if not exists network_entity_relationships_supersedes_key on public.network_entity_relationships (supersedes_relationship_id)
  where supersedes_relationship_id is not null;
create unique index if not exists network_entity_relationships_active_key on public.network_entity_relationships (
  subject_entity_id, relationship_type, object_entity_id, start_precision, coalesce(start_date, date '0001-01-01'), coalesce(start_year, 0), coalesce(start_month, 0),
  end_precision, coalesce(end_date, date '0001-01-01'), coalesce(end_year, 0), coalesce(end_month, 0)) where record_status = 'ACTIVE';
create index if not exists network_entity_relationships_object_idx on public.network_entity_relationships (object_entity_id);

create table if not exists public.player_network_relationships (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete restrict,
  entity_id uuid not null references public.network_entities(id) on delete restrict,
  signing_id uuid,
  relationship_type text not null check (relationship_type in ('TRAINED_WITH', 'DEVELOPED_AT', 'SIGNED_OUT_OF', 'SHOWCASED_IN', 'REPRESENTED_BY')),
  stage text not null check (stage in ('PRE_SIGNING', 'AT_SIGNING', 'POST_SIGNING', 'UNKNOWN')),
  start_precision text not null default 'UNKNOWN' check (start_precision in ('DAY', 'MONTH', 'YEAR', 'SEASON', 'UNKNOWN')),
  start_date date,
  start_year int check (start_year is null or start_year between 1900 and 2100),
  start_month int check (start_month is null or start_month between 1 and 12),
  end_precision text not null default 'UNKNOWN' check (end_precision in ('DAY', 'MONTH', 'YEAR', 'SEASON', 'UNKNOWN')),
  end_date date,
  end_year int check (end_year is null or end_year between 1900 and 2100),
  end_month int check (end_month is null or end_month between 1 and 12),
  source_id uuid not null references public.sources(id) on delete restrict,
  evidence_basis text not null check (evidence_basis in ('TEAM_RELEASE', 'MLB_PIPELINE_PROFILE', 'PUBLISHED_INTERNATIONAL_REVIEW', 'PLAYER_PROFILE',
    'TRAINER_OR_ACADEMY_PROFILE', 'INTERVIEW', 'SECONDARY_REPORT', 'MANUAL_RESEARCH', 'OTHER')),
  confidence public.confidence_level not null,
  retrieved_at timestamptz not null,
  note text check (note is null or char_length(note) <= 300),
  record_status text not null default 'ACTIVE' check (record_status in ('ACTIVE', 'RETRACTED')),
  retracted_at timestamptz,
  retraction_reason text,
  supersedes_relationship_id uuid references public.player_network_relationships(id) on delete restrict,
  created_at timestamptz not null default now(),
  -- a relationship tied to a signing must belong to that signing's player
  constraint player_network_relationships_signing_player_fkey foreign key (signing_id, player_id) references public.signings (id, player_id) on delete restrict,
  constraint player_network_relationships_supersedes_check check (supersedes_relationship_id is null or supersedes_relationship_id <> id),
  constraint player_network_relationships_retraction_check check ((record_status = 'RETRACTED') = (retracted_at is not null)
    and (record_status = 'ACTIVE' or nullif(btrim(retraction_reason), '') is not null)
    and (record_status = 'RETRACTED' or retraction_reason is null)),
  constraint player_network_relationships_start_shape_check check (coalesce(case start_precision
    when 'DAY' then start_date is not null and start_year = extract(year from start_date)::int and start_month = extract(month from start_date)::int
    when 'MONTH' then start_date is null and start_year is not null and start_month is not null
    when 'YEAR' then start_date is null and start_year is not null and start_month is null
    when 'SEASON' then start_date is null and start_year is not null and start_month is null
    else start_date is null and start_year is null and start_month is null
  end, false)),
  constraint player_network_relationships_end_shape_check check (coalesce(case end_precision
    when 'DAY' then end_date is not null and end_year = extract(year from end_date)::int and end_month = extract(month from end_date)::int
    when 'MONTH' then end_date is null and end_year is not null and end_month is not null
    when 'YEAR' then end_date is null and end_year is not null and end_month is null
    when 'SEASON' then end_date is null and end_year is not null and end_month is null
    else end_date is null and end_year is null and end_month is null
  end, false)),
  constraint player_network_relationships_period_order_check check ((start_date is null or end_date is null or end_date >= start_date) and (start_year is null or end_year is null or end_year >= start_year))
);
create unique index if not exists player_network_relationships_supersedes_key on public.player_network_relationships (supersedes_relationship_id)
  where supersedes_relationship_id is not null;
create unique index if not exists player_network_relationships_active_key on public.player_network_relationships (
  player_id, entity_id, relationship_type, coalesce(signing_id::text, ''), start_precision, coalesce(start_date, date '0001-01-01'), coalesce(start_year, 0), coalesce(start_month, 0),
  end_precision, coalesce(end_date, date '0001-01-01'), coalesce(end_year, 0), coalesce(end_month, 0)) where record_status = 'ACTIVE';
create index if not exists player_network_relationships_player_idx on public.player_network_relationships (player_id);
create index if not exists player_network_relationships_entity_idx on public.player_network_relationships (entity_id);

create table if not exists public.network_entity_identity_reviews (
  id uuid primary key default gen_random_uuid(),
  entity_a_id uuid not null references public.network_entities(id) on delete restrict,
  entity_b_id uuid not null references public.network_entities(id) on delete restrict,
  status text not null default 'OPEN' check (status in ('OPEN', 'DISTINCT', 'SAME_PENDING_MERGE')),
  reason text not null check (nullif(btrim(reason), '') is not null),
  source_id uuid references public.sources(id) on delete restrict,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  -- each candidate pair is represented once, in a fixed order
  constraint network_entity_identity_reviews_pair_check check (entity_a_id < entity_b_id),
  constraint network_entity_identity_reviews_decision_check check ((status = 'OPEN') = (reviewed_at is null)),
  unique (entity_a_id, entity_b_id)
);

comment on table public.network_entities is
  'Canonical non-player network identities (people, academies, programs, showcase leagues, agencies). entity_type is WHAT the entity is; the role lives on the relationship. name_basis never invents a proper name. Identity and creation provenance are sealed; a new name is an alias.';
comment on column public.network_entities.descriptor_anchor_entity_id is
  'For a DESCRIPTIVE entity: the PERSON the source used to describe it ("Yasser Mendez''s academy"). It means only that the source described the entity through this person; it implies no operation, ownership or affiliation.';
comment on table public.network_entity_aliases is
  'Exact printed alternate names with provenance. lookup_key is generated by disi_network_lookup_key() for search and entity resolution only; relationships join on entity ids.';
comment on table public.network_entity_relationships is
  'Dated relationships between network entities (operates, affiliated with, member of, succeeded by, merged into). Only source-stated relationships; possessive wording alone is not a relationship.';
comment on table public.player_network_relationships is
  'Source-stated player-to-network associations. A row is an association, not a cause: no WAR, bonus or success is credited to the entity. Absence of a row means no verified network attribution is stored. ACTIVE rows are sealed; a correction is a new row that supersedes the old one.';
comment on column public.player_network_relationships.signing_id is
  'Set only when the source ties the relationship to that specific signing / acquisition. The composite foreign key guarantees it belongs to the same player.';
comment on column public.player_network_relationships.stage is
  'PRE_SIGNING only where the wording says the player signed after the training / play; AT_SIGNING for "signed out of"; UNKNOWN for a bare "trained with" or "also produced". Article context alone never sets a stage.';
comment on table public.network_entity_identity_reviews is
  'Candidate duplicate network entities awaiting a decision. Reviewing never merges.';

-- ===========================================================================
-- 5. SEALING AND INTEGRITY TRIGGERS
-- ===========================================================================

create or replace function public.disi_network_entity_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  anchor_type text;
begin
  if tg_table_name = 'network_entities' then
    if tg_op = 'INSERT' then
      if new.descriptor_anchor_entity_id is not null then
        select entity_type into anchor_type from public.network_entities where id = new.descriptor_anchor_entity_id;
        if anchor_type is distinct from 'PERSON' then
          raise exception 'a descriptor anchor must be an existing PERSON entity' using errcode = '55000';
        end if;
      end if;
      return new;
    elsif tg_op = 'UPDATE' then
      if (to_jsonb(new) - 'country_code' - 'region' - 'city' - 'active_from_year' - 'active_to_year' - 'website_url' - 'notes')
         is distinct from (to_jsonb(old) - 'country_code' - 'region' - 'city' - 'active_from_year' - 'active_to_year' - 'website_url' - 'notes') then
        raise exception 'network entity identity and creation provenance are sealed; record a new name as an alias (%)', old.slug using errcode = '55000';
      end if;
      return new;
    else
      if exists (select 1 from public.player_network_relationships where entity_id = old.id)
         or exists (select 1 from public.network_entity_relationships where subject_entity_id = old.id or object_entity_id = old.id)
         or exists (select 1 from public.network_entity_identity_reviews where entity_a_id = old.id or entity_b_id = old.id) then
        raise exception 'a network entity with relationship history cannot be deleted (%)', old.slug using errcode = '55000';
      end if;
      return old;
    end if;
  end if;
  -- aliases are insert-only; they disappear only together with a deleted parent entity
  if tg_op = 'UPDATE' then
    raise exception 'network aliases are insert-only (%)', old.alias using errcode = '55000';
  elsif tg_op = 'DELETE' then
    if exists (select 1 from public.network_entities where id = old.entity_id) then
      raise exception 'network aliases cannot be deleted while their entity exists (%)', old.alias using errcode = '55000';
    end if;
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_network_entity_guard() from public, anon, authenticated;

create or replace function public.disi_network_entity_relationship_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  subject_type text;
  object_type text;
  compatible boolean;
  pred public.network_entity_relationships%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'network relationships are never deleted; retract them instead' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if old.record_status = 'RETRACTED' then
      raise exception 'a RETRACTED relationship is sealed (%)', old.id using errcode = '55000';
    end if;
    if new.record_status <> 'RETRACTED'
       or (to_jsonb(new) - 'record_status' - 'retracted_at' - 'retraction_reason') is distinct from (to_jsonb(old) - 'record_status' - 'retracted_at' - 'retraction_reason') then
      raise exception 'an ACTIVE relationship is sealed; the only change allowed is retraction (%)', old.id using errcode = '55000';
    end if;
    return new;
  end if;
  if new.record_status <> 'ACTIVE' then
    raise exception 'a new relationship starts ACTIVE' using errcode = '55000';
  end if;
  select entity_type into subject_type from public.network_entities where id = new.subject_entity_id;
  select entity_type into object_type from public.network_entities where id = new.object_entity_id;
  compatible := false;
  if new.relationship_type in ('OPERATES', 'AFFILIATED_WITH') then
    compatible := coalesce(subject_type = 'PERSON' and object_type in ('ACADEMY', 'PROGRAM'), false);
  elsif new.relationship_type = 'MEMBER_OF' then
    compatible := coalesce(subject_type = 'PERSON' and object_type = 'PROGRAM', false);
  elsif new.relationship_type in ('SUCCEEDED_BY', 'MERGED_INTO') then
    compatible := coalesce(subject_type = object_type, false);
  end if;
  if not compatible then
    raise exception '% does not accept a % subject and a % object', new.relationship_type, subject_type, object_type using errcode = '55000';
  end if;
  if new.supersedes_relationship_id is not null then
    select * into pred from public.network_entity_relationships where id = new.supersedes_relationship_id;
    if not found or pred.id = new.id or pred.relationship_type <> new.relationship_type
       or not (pred.subject_entity_id = new.subject_entity_id or pred.object_entity_id = new.object_entity_id) then
      raise exception 'a correction must supersede an existing relationship of the same type that shares its subject or its object (%)', new.supersedes_relationship_id
        using errcode = '55000';
    end if;
    if pred.record_status = 'ACTIVE' then
      update public.network_entity_relationships
        set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'Superseded by a corrected relationship.'
      where id = pred.id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_network_entity_relationship_guard() from public, anon, authenticated;

create or replace function public.disi_player_network_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  entity_kind text;
  compatible boolean;
  pred public.player_network_relationships%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'network relationships are never deleted; retract them instead' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if old.record_status = 'RETRACTED' then
      raise exception 'a RETRACTED relationship is sealed (%)', old.id using errcode = '55000';
    end if;
    if new.record_status <> 'RETRACTED'
       or (to_jsonb(new) - 'record_status' - 'retracted_at' - 'retraction_reason') is distinct from (to_jsonb(old) - 'record_status' - 'retracted_at' - 'retraction_reason') then
      raise exception 'an ACTIVE relationship is sealed; the only change allowed is retraction (%)', old.id using errcode = '55000';
    end if;
    return new;
  end if;
  if new.record_status <> 'ACTIVE' then
    raise exception 'a new relationship starts ACTIVE' using errcode = '55000';
  end if;
  select entity_type into entity_kind from public.network_entities where id = new.entity_id;
  compatible := false;
  if new.relationship_type = 'TRAINED_WITH' then
    compatible := coalesce(entity_kind = 'PERSON', false);
  elsif new.relationship_type in ('DEVELOPED_AT', 'SIGNED_OUT_OF') then
    compatible := coalesce(entity_kind in ('ACADEMY', 'PROGRAM'), false);
  elsif new.relationship_type = 'SHOWCASED_IN' then
    compatible := coalesce(entity_kind = 'SHOWCASE_LEAGUE', false);
  elsif new.relationship_type = 'REPRESENTED_BY' then
    compatible := coalesce(entity_kind in ('PERSON', 'AGENCY'), false);
  end if;
  if not compatible then
    raise exception '% does not accept a % entity', new.relationship_type, entity_kind using errcode = '55000';
  end if;
  if new.supersedes_relationship_id is not null then
    select * into pred from public.player_network_relationships where id = new.supersedes_relationship_id;
    if not found or pred.id = new.id or pred.player_id <> new.player_id or pred.relationship_type <> new.relationship_type then
      raise exception 'a correction must supersede an existing relationship of the same player and type (%)', new.supersedes_relationship_id using errcode = '55000';
    end if;
    if pred.record_status = 'ACTIVE' then
      update public.player_network_relationships
        set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'Superseded by a corrected relationship.'
      where id = pred.id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_player_network_guard() from public, anon, authenticated;

drop trigger if exists network_entities_guard on public.network_entities;
create trigger network_entities_guard
before insert or update or delete on public.network_entities
for each row execute function public.disi_network_entity_guard();
drop trigger if exists network_entity_aliases_guard on public.network_entity_aliases;
create trigger network_entity_aliases_guard
before insert or update or delete on public.network_entity_aliases
for each row execute function public.disi_network_entity_guard();
drop trigger if exists network_entity_relationships_guard on public.network_entity_relationships;
create trigger network_entity_relationships_guard
before insert or update or delete on public.network_entity_relationships
for each row execute function public.disi_network_entity_relationship_guard();
drop trigger if exists player_network_relationships_guard on public.player_network_relationships;
create trigger player_network_relationships_guard
before insert or update or delete on public.player_network_relationships
for each row execute function public.disi_player_network_guard();

-- ===========================================================================
-- 6. SECURITY: RLS, public read, no API writes
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['network_entities', 'network_entity_aliases', 'network_entity_relationships', 'player_network_relationships', 'network_entity_identity_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists public_read_%I on public.%I', t, t);
    execute format('create policy public_read_%I on public.%I for select to anon, authenticated using (true)', t, t);
  end loop;
end $$;

-- ===========================================================================
-- 7. REVIEWED RESEARCH DATA (database/research/029/seed-evidence.json)
-- ===========================================================================
-- Only what two Baseball America reviews state directly, for five players. Each insert is
-- skipped when its identity already exists (at any status), so reruns and later corrections
-- never recreate a row.

create temporary table _m029 on commit drop as
select $m029${"aliases":[{"alias":"Banana","alias_type":"NICKNAME","confidence":"HIGH","entity_slug":"raul-valera","language_code":null,"retrieved_at":"2026-10-08T23:45:00Z","source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"}],"entities":[{"anchor_slug":null,"canonical_name":"Raul Valera","confidence":"HIGH","entity_type":"PERSON","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","name_basis":"NAMED","notes":"Baseball America's 2015-class Dodgers review identifies him as Raul Valera and gives the nickname Banana.","retrieved_at":"2026-10-08T23:45:00Z","slug":"raul-valera","source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"anchor_slug":null,"canonical_name":"Franklin Ferreras","confidence":"HIGH","entity_type":"PERSON","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","name_basis":"NAMED","notes":"Named in Baseball America's 2015-class Dodgers review as the person Starling Heredia trained with.","retrieved_at":"2026-10-08T23:45:00Z","slug":"franklin-ferreras","source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"anchor_slug":null,"canonical_name":"Laurentino Genao","confidence":"HIGH","entity_type":"PERSON","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","name_basis":"NAMED","notes":"Named in Baseball America's 2015-class Dodgers review as the person Ronny Brito trained with.","retrieved_at":"2026-10-08T23:45:00Z","slug":"laurentino-genao","source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"anchor_slug":null,"canonical_name":"Amauris Nina","confidence":"HIGH","entity_type":"PERSON","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","name_basis":"NAMED","notes":"Named in Baseball America's 2015-class Dodgers review as the person Christopher Arias trained with.","retrieved_at":"2026-10-08T23:45:00Z","slug":"amauris-nina","source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"anchor_slug":null,"canonical_name":"Yasser Mendez","confidence":"HIGH","entity_type":"PERSON","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","name_basis":"NAMED","notes":"Named in Baseball America's 2017-class Dodgers review, which describes an academy through him.","retrieved_at":"2026-10-08T23:45:00Z","slug":"yasser-mendez","source_url":"https://www.baseballamerica.com/stories/international-reviews-los-angeles-dodgers-2018/"},{"anchor_slug":null,"canonical_name":"Dominican Prospect League","confidence":"HIGH","entity_type":"SHOWCASE_LEAGUE","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","name_basis":"NAMED","notes":"Named in Baseball America's 2015-class Dodgers review as a league Starling Heredia played in. No geography is stored beyond the name.","retrieved_at":"2026-10-08T23:45:00Z","slug":"dominican-prospect-league","source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"anchor_slug":null,"canonical_name":"International Prospect League","confidence":"HIGH","entity_type":"SHOWCASE_LEAGUE","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","name_basis":"NAMED","notes":"Named in Baseball America's 2015-class Dodgers review as a league Ronny Brito and Christopher Arias played in (abbreviated IPL there).","retrieved_at":"2026-10-08T23:45:00Z","slug":"international-prospect-league","source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"anchor_slug":"franklin-ferreras","canonical_name":"Franklin Ferreras' program","confidence":"MEDIUM","entity_type":"PROGRAM","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","name_basis":"DESCRIPTIVE","notes":"A program the source describes only through Franklin Ferreras. The anchor records the wording; it does not assert operation or ownership. No proper name is given.","retrieved_at":"2026-10-08T23:45:00Z","slug":"franklin-ferreras-program","source_url":"https://www.baseballamerica.com/stories/international-reviews-los-angeles-dodgers-2018/"},{"anchor_slug":"yasser-mendez","canonical_name":"Yasser Mendez's academy","confidence":"MEDIUM","entity_type":"ACADEMY","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","name_basis":"DESCRIPTIVE","notes":"An academy the source describes only through Yasser Mendez. The anchor records the wording; it does not assert operation or ownership. No proper name is given.","retrieved_at":"2026-10-08T23:45:00Z","slug":"yasser-mendez-academy","source_url":"https://www.baseballamerica.com/stories/international-reviews-los-angeles-dodgers-2018/"}],"player_relationships":[{"confidence":"HIGH","entity_slug":"raul-valera","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Baseball America's 2015-class review says Cruz trained with Valera, known as Banana. It gives no dates and does not tie the training to the signing.","player_slug":"oneil-cruz","ref":"cruz-valera","relationship_type":"TRAINED_WITH","retrieved_at":"2026-10-08T23:45:00Z","signing":null,"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/","stage":"UNKNOWN"},{"confidence":"HIGH","entity_slug":"franklin-ferreras","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Baseball America's 2015-class review says Heredia signed on July 2 after playing in the Dominican Prospect League and training with Ferreras.","player_slug":"starling-heredia","ref":"heredia-ferreras","relationship_type":"TRAINED_WITH","retrieved_at":"2026-10-08T23:45:00Z","signing":{"organization_name":"Los Angeles Dodgers","signing_year":2015},"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/","stage":"PRE_SIGNING"},{"confidence":"HIGH","entity_slug":"dominican-prospect-league","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Same sentence: Heredia signed on July 2 after playing in the Dominican Prospect League.","player_slug":"starling-heredia","ref":"heredia-dpl","relationship_type":"SHOWCASED_IN","retrieved_at":"2026-10-08T23:45:00Z","signing":{"organization_name":"Los Angeles Dodgers","signing_year":2015},"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/","stage":"PRE_SIGNING"},{"confidence":"MEDIUM","entity_slug":"franklin-ferreras-program","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Baseball America's 2017-class review says Ferreras' program also produced Heredia. This is neither exclusive nor causal attribution, and no period is given.","player_slug":"starling-heredia","ref":"heredia-ferreras-program","relationship_type":"DEVELOPED_AT","retrieved_at":"2026-10-08T23:45:00Z","signing":null,"source_url":"https://www.baseballamerica.com/stories/international-reviews-los-angeles-dodgers-2018/","stage":"UNKNOWN"},{"confidence":"HIGH","entity_slug":"laurentino-genao","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Baseball America's 2015-class review says Brito signed out of the Dominican Republic after playing in the International Prospect League and training with Genao.","player_slug":"ronny-brito","ref":"brito-genao","relationship_type":"TRAINED_WITH","retrieved_at":"2026-10-08T23:45:00Z","signing":{"organization_name":"Los Angeles Dodgers","signing_year":2015},"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/","stage":"PRE_SIGNING"},{"confidence":"HIGH","entity_slug":"international-prospect-league","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Same sentence: Brito signed after playing in the International Prospect League.","player_slug":"ronny-brito","ref":"brito-ipl","relationship_type":"SHOWCASED_IN","retrieved_at":"2026-10-08T23:45:00Z","signing":{"organization_name":"Los Angeles Dodgers","signing_year":2015},"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/","stage":"PRE_SIGNING"},{"confidence":"HIGH","entity_slug":"amauris-nina","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Baseball America's 2015-class review says Christopher Arias signed on July 2 after playing in the IPL and training with Nina.","player_slug":"christopher-arias","ref":"arias-nina","relationship_type":"TRAINED_WITH","retrieved_at":"2026-10-08T23:45:00Z","signing":{"organization_name":"Los Angeles Dodgers","signing_year":2015},"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/","stage":"PRE_SIGNING"},{"confidence":"HIGH","entity_slug":"international-prospect-league","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Same sentence: Arias signed after playing in the IPL, the International Prospect League.","player_slug":"christopher-arias","ref":"arias-ipl","relationship_type":"SHOWCASED_IN","retrieved_at":"2026-10-08T23:45:00Z","signing":{"organization_name":"Los Angeles Dodgers","signing_year":2015},"source_url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/","stage":"PRE_SIGNING"},{"confidence":"HIGH","entity_slug":"yasser-mendez-academy","evidence_basis":"PUBLISHED_INTERNATIONAL_REVIEW","note":"Baseball America's 2017-class review says the Dodgers signed Vivas, spelled Yorbit there, in July out of Mendez's academy.","player_slug":"jorbit-vivas","ref":"vivas-mendez-academy","relationship_type":"SIGNED_OUT_OF","retrieved_at":"2026-10-08T23:45:00Z","signing":{"organization_name":"Los Angeles Dodgers","signing_year":2017},"source_url":"https://www.baseballamerica.com/stories/international-reviews-los-angeles-dodgers-2018/","stage":"AT_SIGNING"}],"sources":[{"accessed_at":"2026-10-08T23:45:00Z","author":"Ben Badler","notes":"Review of the Dodgers' 2015-16 international signing class.","publication_date":"2016-04-01","source_name":"Baseball America","source_tier":"OTHER","source_type":"ARTICLE","title":"International Reviews: Los Angeles Dodgers","url":"https://www.baseballamerica.com/stories/2015-international-reviews-los-angeles-dodgers/"},{"accessed_at":"2026-10-08T23:45:00Z","author":"Ben Badler","notes":"Review of the Dodgers' 2017-18 international signing class.","publication_date":"2018-04-30","source_name":"Baseball America","source_tier":"OTHER","source_type":"ARTICLE","title":"International Reviews: Los Angeles Dodgers","url":"https://www.baseballamerica.com/stories/international-reviews-los-angeles-dodgers-2018/"}]}$m029$::jsonb as j;

insert into public.sources (source_name, source_type, title, url, author, publication_date, accessed_at, notes, source_tier)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'author', (x ->> 'publication_date')::date,
       (x ->> 'accessed_at')::timestamptz, x ->> 'notes', x ->> 'source_tier'
from _m029, jsonb_array_elements(j -> 'sources') x
on conflict (url) do nothing;

do $$
declare
  e jsonb;
  anchor uuid;
begin
  for e in select x from _m029, jsonb_array_elements(j -> 'entities') x loop
    if not exists (select 1 from public.network_entities where slug = e ->> 'slug') then
      anchor := null;
      if e ->> 'anchor_slug' is not null then
        select id into anchor from public.network_entities where slug = e ->> 'anchor_slug';
        if anchor is null then
          raise exception '029: descriptor anchor % not found', e ->> 'anchor_slug';
        end if;
      end if;
      insert into public.network_entities (slug, entity_type, canonical_name, name_basis, descriptor_anchor_entity_id, notes, source_id, evidence_basis, confidence, retrieved_at)
      select e ->> 'slug', e ->> 'entity_type', e ->> 'canonical_name', e ->> 'name_basis', anchor, e ->> 'notes', s.id, e ->> 'evidence_basis',
             (e ->> 'confidence')::public.confidence_level, (e ->> 'retrieved_at')::timestamptz
      from public.sources s where s.url = e ->> 'source_url';
      if not found then
        raise exception '029: source for entity % not found', e ->> 'slug';
      end if;
    end if;
  end loop;
end $$;

insert into public.network_entity_aliases (entity_id, alias, alias_type, language_code, source_id, confidence, retrieved_at)
select en.id, x ->> 'alias', x ->> 'alias_type', x ->> 'language_code', s.id, (x ->> 'confidence')::public.confidence_level, (x ->> 'retrieved_at')::timestamptz
from _m029, jsonb_array_elements(j -> 'aliases') x
join public.network_entities en on en.slug = x ->> 'entity_slug'
join public.sources s on s.url = x ->> 'source_url'
on conflict (entity_id, alias) do nothing;

do $$
declare
  e jsonb;
  pid uuid;
  eid uuid;
  sid uuid;
  src uuid;
begin
  for e in select x from _m029, jsonb_array_elements(j -> 'player_relationships') x loop
    select id into pid from public.players where slug = e ->> 'player_slug';
    select id into eid from public.network_entities where slug = e ->> 'entity_slug';
    select id into src from public.sources where url = e ->> 'source_url';
    if pid is null or eid is null or src is null then
      raise exception '029: references for relationship % are unresolved', e ->> 'ref';
    end if;
    sid := null;
    if e -> 'signing' is not null and jsonb_typeof(e -> 'signing') = 'object' then
      select sg.id into sid from public.signings sg join public.organizations o on o.id = sg.organization_id
      where sg.player_id = pid and o.name = e -> 'signing' ->> 'organization_name' and sg.signing_year = (e -> 'signing' ->> 'signing_year')::int;
      if sid is null then
        raise exception '029: signing for relationship % not found', e ->> 'ref';
      end if;
    end if;
    if not exists (select 1 from public.player_network_relationships
                   where player_id = pid and entity_id = eid and relationship_type = e ->> 'relationship_type' and signing_id is not distinct from sid) then
      insert into public.player_network_relationships (player_id, entity_id, signing_id, relationship_type, stage, source_id, evidence_basis, confidence, retrieved_at, note)
      values (pid, eid, sid, e ->> 'relationship_type', e ->> 'stage', src, e ->> 'evidence_basis', (e ->> 'confidence')::public.confidence_level,
              (e ->> 'retrieved_at')::timestamptz, e ->> 'note');
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 8. VIEWS
-- ===========================================================================
-- ACTIVE relationships only. Each view joins canonical systems (signings, organizations, the 026
-- external evaluations) and copies none of their facts into network tables. No view assigns WAR,
-- bonus or success to a network entity.

create or replace view public.v_player_signing_network
with (security_invoker = true)
as
select
  pr.id as relationship_id,
  p.id as player_id, p.slug as player_slug, p.full_name as player_name,
  pr.relationship_type, pr.stage,
  e.id as entity_id, e.slug as entity_slug, e.canonical_name as entity_name, e.entity_type, e.name_basis,
  anchor.canonical_name as descriptor_anchor_name,
  pr.signing_id, (pr.signing_id is not null) as relationship_tied_to_signing,
  sg.signing_year, org.name as signing_organization, sg.country_market, sg.pathway::text as pathway, sg.signing_bonus_usd, sg.bonus_publicly_reported,
  pr.start_precision, pr.start_date, pr.start_year, pr.start_month, pr.end_precision, pr.end_date, pr.end_year, pr.end_month,
  case pr.start_precision when 'DAY' then pr.start_date::text when 'MONTH' then to_char(make_date(pr.start_year, pr.start_month, 1), 'YYYY-MM')
    when 'YEAR' then pr.start_year::text when 'SEASON' then pr.start_year::text || ' season' else 'Period unknown' end as start_label,
  pr.confidence::text as confidence, pr.evidence_basis,
  so.url as source_url, so.title as source_title, so.publication_date as source_published, pr.retrieved_at, pr.note,
  ev.publication_name as latest_external_publication, ev.evaluation_label as latest_external_evaluation_date,
  ev.future_value_label as latest_external_future_value, ev.rank_summary as latest_external_rank
from public.player_network_relationships pr
join public.players p on p.id = pr.player_id
join public.network_entities e on e.id = pr.entity_id
left join public.network_entities anchor on anchor.id = e.descriptor_anchor_entity_id
join public.sources so on so.id = pr.source_id
left join lateral (
  select s2.* from public.signings s2
  where s2.player_id = pr.player_id and (pr.signing_id is null or s2.id = pr.signing_id)
  order by s2.signing_year limit 1
) sg on true
left join public.organizations org on org.id = sg.organization_id
left join lateral (
  select t.publication_name, t.evaluation_label, t.future_value_label, t.rank_summary
  from public.v_player_scouting_timeline t
  where t.player_id = pr.player_id
  order by (t.date_precision = 'UNKNOWN'), t.sort_key desc, t.retrieved_at desc limit 1
) ev on true
where pr.record_status = 'ACTIVE';

comment on view public.v_player_signing_network is
  'Source-stated network associations per tracked player (ACTIVE only), with signing year, market and bonus joined from signings and the latest external evaluation joined from the 026 timeline. Associations only: no credit, cause or ranking. A player with no row has no verified network attribution stored.';

create or replace view public.v_network_entity_player_history
with (security_invoker = true)
as
select
  e.id as entity_id, e.slug as entity_slug, e.canonical_name as entity_name, e.entity_type, e.name_basis,
  anchor.canonical_name as descriptor_anchor_name,
  count(pr.id)::int as relationship_count,
  count(distinct pr.player_id)::int as distinct_players,
  array_agg(distinct pr.relationship_type order by pr.relationship_type) filter (where pr.id is not null) as relationship_types,
  string_agg(distinct p.slug, ', ' order by p.slug) filter (where pr.id is not null) as player_slugs,
  min(sg.signing_year) as first_signing_year, max(sg.signing_year) as last_signing_year,
  count(distinct sg.signing_year)::int as distinct_signing_years,
  count(*) filter (where pr.stage = 'UNKNOWN')::int as stage_unknown_relationships
from public.network_entities e
left join public.network_entities anchor on anchor.id = e.descriptor_anchor_entity_id
left join public.player_network_relationships pr on pr.entity_id = e.id and pr.record_status = 'ACTIVE'
left join public.players p on p.id = pr.player_id
left join lateral (
  select s2.signing_year from public.signings s2
  where s2.player_id = pr.player_id and (pr.signing_id is null or s2.id = pr.signing_id) order by s2.signing_year limit 1
) sg on true
group by e.id, e.slug, e.canonical_name, e.entity_type, e.name_basis, anchor.canonical_name;

comment on view public.v_network_entity_player_history is
  'Which tracked players have source-stated relationships with each network entity: counts and lists only. It reports association, never WAR, bonus or success credit, and no rate or ranking.';

create or replace view public.v_dodgers_network_coverage
with (security_invoker = true)
as
with population as (
  select sg.id as signing_id, sg.player_id, sg.signing_year, sg.country_market,
    case sg.pathway::text when 'CUBAN_PRO' then 'CUBAN_PRO' else 'PRIMARY_LATIN_AMERICAN_CUBAN_AMATEUR' end as coverage_segment,
    exists (select 1 from public.outcome_audits oa where oa.player_id = sg.player_id and oa.reached_mlb_verified) as mlb_reached,
    exists (select 1 from public.player_network_relationships pr where pr.player_id = sg.player_id and pr.record_status = 'ACTIVE') as attributed
  from public.signings sg
  join public.organizations o on o.id = sg.organization_id and o.franchise_key = 'DODGERS'
  where sg.pathway::text in ('LATAM_AMATEUR', 'CUBAN_AMATEUR', 'CUBAN_PRO')
    and (sg.bonus_publicly_reported or sg.international_rank is not null
         or exists (select 1 from public.outcome_audits oa where oa.player_id = sg.player_id and oa.reached_mlb_verified))
),
grains as (
  select coverage_segment, 'ALL'::text as breakdown, 'All'::text as breakdown_value, mlb_reached, attributed from population
  union all
  select coverage_segment, 'SIGNING_ERA', case when signing_year < 2010 then 'Before 2010' when signing_year < 2018 then '2010-2017' else '2018 and later' end, mlb_reached, attributed from population
  union all
  select coverage_segment, 'COUNTRY_MARKET', coalesce(country_market, 'Unknown'), mlb_reached, attributed from population
)
select
  coverage_segment,
  (coverage_segment = 'PRIMARY_LATIN_AMERICAN_CUBAN_AMATEUR') as is_primary_denominator,
  case coverage_segment when 'CUBAN_PRO' then 'Dodgers CUBAN_PRO signings with a reported bonus, an international rank or verified MLB reach; reported separately and never blended into the primary denominator'
    else 'Dodgers LATAM_AMATEUR and CUBAN_AMATEUR signings with a reported bonus, an international rank or verified MLB reach; not all international signings' end as denominator_definition,
  breakdown, breakdown_value,
  count(*)::int as signings,
  count(*) filter (where attributed)::int as with_network_attribution,
  count(*) filter (where not attributed)::int as without_network_attribution,
  round(100.0 * count(*) filter (where attributed) / count(*), 1) as attribution_percent,
  count(*) filter (where mlb_reached)::int as mlb_reached_signings,
  count(*) filter (where mlb_reached and not attributed)::int as mlb_reached_without_attribution
from grains
group by coverage_segment, breakdown, breakdown_value;

comment on view public.v_dodgers_network_coverage is
  'Verified network attribution coverage of Dodgers international amateur signings that carry an analytical signal. The primary denominator is LATAM_AMATEUR + CUBAN_AMATEUR only, not all international signings; CUBAN_PRO is a separate segment. Coverage is a research-progress measure, not a rate of anything about players.';

create or replace view public.v_network_research_queue
with (security_invoker = true)
as
with primary_population as (
  select sg.player_id, sg.signing_year,
    exists (select 1 from public.outcome_audits oa where oa.player_id = sg.player_id and oa.reached_mlb_verified) as mlb_reached
  from public.signings sg
  join public.organizations o on o.id = sg.organization_id and o.franchise_key = 'DODGERS'
  where sg.pathway::text in ('LATAM_AMATEUR', 'CUBAN_AMATEUR')
    and (sg.bonus_publicly_reported or sg.international_rank is not null
         or exists (select 1 from public.outcome_audits oa where oa.player_id = sg.player_id and oa.reached_mlb_verified))
),
issues as (
  select pp.player_id, null::uuid as entity_id, 'SIGNING_WITHOUT_NETWORK_ATTRIBUTION'::text as issue,
    case when pp.mlb_reached then 1 else 2 end as priority, pp.mlb_reached,
    format('%s Dodgers amateur signing with no source-stated network relationship stored%s', pp.signing_year, case when pp.mlb_reached then '; the player reached MLB' else '' end) as detail
  from primary_population pp
  where not exists (select 1 from public.player_network_relationships pr where pr.player_id = pp.player_id and pr.record_status = 'ACTIVE')
  union all
  select pr.player_id, pr.entity_id, 'RELATIONSHIP_STAGE_UNKNOWN', 3,
    exists (select 1 from public.outcome_audits oa where oa.player_id = pr.player_id and oa.reached_mlb_verified),
    format('%s relationship has no stated chronology relative to the signing', pr.relationship_type)
  from public.player_network_relationships pr
  where pr.record_status = 'ACTIVE' and pr.stage = 'UNKNOWN'
  union all
  select null::uuid, r.entity_a_id, 'POSSIBLE_DUPLICATE_NETWORK_ENTITY', 2, false,
    format('Open identity review between %s and %s: %s', ea.canonical_name, eb.canonical_name, r.reason)
  from public.network_entity_identity_reviews r
  join public.network_entities ea on ea.id = r.entity_a_id
  join public.network_entities eb on eb.id = r.entity_b_id
  where r.status = 'OPEN'
  union all
  select null::uuid, e.id, 'UNRESOLVED_NETWORK_IDENTITY', 2, false,
    format('%s is known only by a nickname; a sourced proper name would resolve it', e.canonical_name)
  from public.network_entities e
  where e.name_basis = 'NICKNAME_ONLY'
)
select i.player_id, p.slug as player_slug, p.full_name, i.entity_id, e.slug as entity_slug, e.canonical_name as entity_name,
       i.issue, i.priority, i.mlb_reached, i.detail
from issues i
left join public.players p on p.id = i.player_id
left join public.network_entities e on e.id = i.entity_id;

comment on view public.v_network_research_queue is
  'Unresolved network research. SIGNING_WITHOUT_NETWORK_ATTRIBUTION is scoped to the primary coverage population (Dodgers LATAM_AMATEUR + CUBAN_AMATEUR signings with a signal) with MLB reach as priority metadata, not a duplicate issue. Conditions the schema forbids are not queued, and nothing is queued from unverified search snippets.';

-- ===========================================================================
-- 9. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'network_entities', 'network_entity_aliases', 'network_entity_relationships', 'player_network_relationships', 'network_entity_identity_reviews',
    'v_player_signing_network', 'v_network_entity_player_history', 'v_dodgers_network_coverage', 'v_network_research_queue'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

do $$
declare
  bad text;
  e jsonb;
  n int;
begin
  select string_agg(format('%s:%s:%s', c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type), ', ' order by 1) into bad
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    and a.privilege_type <> 'SELECT';
  if bad is not null then
    raise exception '029: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- every seeded entity, alias and relationship is present exactly once
  for e in select x from _m029, jsonb_array_elements(j -> 'entities') x loop
    select count(*) into n from public.network_entities where slug = e ->> 'slug';
    if n <> 1 then raise exception '029 postcondition: entity % present % times', e ->> 'slug', n; end if;
  end loop;
  for e in select x from _m029, jsonb_array_elements(j -> 'player_relationships') x loop
    select count(*) into n from public.player_network_relationships pr
    join public.players p on p.id = pr.player_id join public.network_entities en on en.id = pr.entity_id
    where p.slug = e ->> 'player_slug' and en.slug = e ->> 'entity_slug' and pr.relationship_type = e ->> 'relationship_type';
    if n <> 1 then raise exception '029 postcondition: relationship % present % times', e ->> 'ref', n; end if;
  end loop;
end $$;

commit;
