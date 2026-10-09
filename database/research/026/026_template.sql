-- DISI v0.17
-- 026_scouting_evaluation_history.sql
-- Scouting / prospect evaluation history. Run after 025.
--
-- Built from reviewed research (database/research/026/): audit.mjs measures the
-- facts the guards and backfill depend on, seed-evidence.json holds the reviewed
-- public-evidence rows, and build.mjs assembles this file.
--
-- What an evaluation is. A scouting evaluation is an opinion some evaluator held
-- at a point in time: an observation, never ground truth. It is stored as an
-- immutable snapshot tied to a publication and a citation, kept apart from
-- performance, development progression, MLB outcomes and DISI's own model output
-- (public.model_predictions). Nothing here is overwritten when a newer evaluation
-- appears, and there is no mutable "current FV" or "current rank".
--
-- What this does:
--   * Drops the empty legacy public.evaluations table (migration 001), behind
--     guards: it must exist, hold no rows, still have the known 001 shape, have no
--     dependent objects or inbound foreign keys. Any failed guard aborts 026.
--   * Adds six tables: evaluation_scales, scouting_publications, player_evaluations
--     (snapshot header), player_evaluation_grades, player_evaluation_rankings and
--     player_evaluation_notes. Check constraints, not new enums.
--   * Enforces a snapshot lifecycle, DRAFT -> ACTIVE -> SUPERSEDED. A DRAFT is
--     being assembled (header and grades / rankings / notes writable, invisible to
--     every view). Activation seals it: an ACTIVE header and all its children can
--     no longer be inserted, updated or deleted. A correction is a new DRAFT that
--     names what it supersedes (same player and publication); activating it retires
--     the predecessor. Only DRAFTs can be deleted.
--   * Validates every grade against its scale in a trigger. A source grade such as
--     "45+" keeps its label, its numeric base (45) and a PLUS qualifier, so it is
--     never silently the same as an exact 45.
--   * Seeds the reviewed scale, publications, citations and the proof-cohort
--     evaluations whose values were read from public pages.
--   * Backfills the legacy MLB Pipeline international ranks that have provenance
--     (a tracker source with a publication date). The unsourced ranks are NOT
--     migrated as evaluation facts; they are queued. signings.international_rank
--     is left unchanged for backward compatibility.
--   * Adds five views: v_player_scouting_timeline, v_player_latest_external_evaluation,
--     v_dodgers_scouting_at_signing, v_scouting_source_coverage and
--     v_scouting_research_queue. All are security_invoker, SELECT-only for the API
--     roles, and exclude DISI_RESEARCH publications.
--
-- Snapshot identity (the uniqueness contract). Among ACTIVE evaluations:
--   (player_id, publication_id, evaluation_context, date_precision,
--    coalesce(evaluation_date), coalesce(evaluation_year), coalesce(evaluation_month),
--    primary source identity = source_id, or lower(trim(source_reference)))
-- is unique, with null-safe coalescing. Two undated reports from different
-- sources coexist; re-ingesting the same record is rejected (seeds use
-- ON CONFLICT DO NOTHING). A SUPERSEDED row leaves the key free for its successor.
--
-- Date semantics. evaluation_date is the date the evaluation was published (or
-- reported); date_precision is one of DAY, MONTH, YEAR, SEASON, UNKNOWN. Only DAY
-- carries a date. No day 1 is ever invented for coarser precision, and exact
-- day-based metrics are computed only from DAY precision.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 1. LEGACY public.evaluations: guarded drop
-- ===========================================================================

do $$
declare
  expected_columns text[] := array[
{{legacy_shape}}
  ];
  actual_columns text[];
  n bigint;
  deps text;
begin
  if to_regclass('public.evaluations') is null then
    -- Already dropped by an earlier run of this migration; anything else is unexpected.
    if to_regclass('public.scouting_publications') is null then
      raise exception '026: public.evaluations is missing but the scouting tables do not exist';
    end if;
    return;
  end if;

  execute 'select count(*) from public.evaluations' into n;
  if n <> 0 then
    raise exception '026: legacy public.evaluations holds % rows; refusing to drop it (no data is migrated silently)', n;
  end if;

  select array_agg(column_name::text || ':' || data_type::text order by ordinal_position)
  into actual_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'evaluations';
  if actual_columns is distinct from expected_columns then
    raise exception '026: legacy public.evaluations no longer has the migration-001 shape: %', actual_columns;
  end if;

  if exists (select 1 from pg_constraint where confrelid = 'public.evaluations'::regclass) then
    raise exception '026: other tables reference public.evaluations through a foreign key';
  end if;

  -- Anything that depends on the table other than its own constraints, defaults,
  -- indexes, triggers, policy, row type and TOAST table (views, rules, ...).
  select string_agg(distinct d.classid::regclass::text || ':' || d.objid::text, ', ') into deps
  from pg_depend d
  where d.refobjid = 'public.evaluations'::regclass and d.objid <> d.refobjid
    and d.classid <> 'pg_attrdef'::regclass
    and d.classid <> 'pg_type'::regclass
    and not (d.classid = 'pg_constraint'::regclass and exists (select 1 from pg_constraint c where c.oid = d.objid and c.conrelid = 'public.evaluations'::regclass))
    and not (d.classid = 'pg_policy'::regclass and exists (select 1 from pg_policy p where p.oid = d.objid and p.polrelid = 'public.evaluations'::regclass))
    and not (d.classid = 'pg_trigger'::regclass and exists (select 1 from pg_trigger g where g.oid = d.objid and g.tgrelid = 'public.evaluations'::regclass))
    and not (d.classid = 'pg_class'::regclass and exists (select 1 from pg_class c where c.oid = d.objid and c.relkind in ('i', 't')));
  if deps is not null then
    raise exception '026: objects depend on public.evaluations: %', deps;
  end if;
end $$;

-- Plain DROP (no CASCADE): if a dependent slipped past the guards, this fails too.
drop table if exists public.evaluations;

-- ===========================================================================
-- 2. TABLES
-- ===========================================================================

create table if not exists public.evaluation_scales (
  scale_code text primary key check (scale_code ~ '^[A-Z0-9_]+$'),
  label text not null check (btrim(label) <> ''),
  scale_kind text not null check (scale_kind in ('NUMERIC', 'ORDINAL')),
  scale_min numeric,
  scale_max numeric,
  scale_step numeric check (scale_step is null or scale_step > 0),
  ordered_labels text[],
  allows_qualifier boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  constraint evaluation_scales_shape_check check (coalesce(case scale_kind
    when 'NUMERIC' then scale_min is not null and scale_max is not null and scale_min < scale_max and ordered_labels is null
    else ordered_labels is not null and cardinality(ordered_labels) >= 2
         and scale_min is null and scale_max is null and scale_step is null and not allows_qualifier
  end, false))
);

create table if not exists public.scouting_publications (
  id uuid primary key default gen_random_uuid(),
  publication_slug text not null unique check (publication_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  publication_name text not null check (btrim(publication_name) <> ''),
  publisher text not null check (btrim(publisher) <> ''),
  origin text not null check (origin in ('EXTERNAL', 'TEAM_PUBLIC', 'DISI_RESEARCH')),
  publication_kind text not null check (publication_kind in
    ('PROSPECT_LIST', 'SIGNING_TRACKER', 'PROSPECT_PROFILE', 'TEAM_REPORT', 'DATABASE', 'EVENT', 'OTHER')),
  default_scale_code text references public.evaluation_scales(scale_code),
  access_class text not null check (access_class in ('OPEN', 'MEMBERSHIP', 'PAID', 'PRINT', 'MIXED')),
  bulk_ingest_allowed boolean not null default false,
  source_tier text references public.source_tiers(tier_code),
  reference_url text,
  scope_notes text,
  methodology_notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.player_evaluations (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT, not CASCADE: a sealed historical evaluation must never disappear because a
  -- player row is deleted. The delete is refused by the foreign key itself (a DRAFT must be
  -- deleted explicitly first); the sealing trigger is a second line of defence, not the contract.
  player_id uuid not null references public.players(id) on delete restrict,
  publication_id uuid not null references public.scouting_publications(id) on delete restrict,
  evaluation_context text not null check (evaluation_context in
    ('PRE_SIGNING', 'SIGNING', 'ORG_LIST', 'GLOBAL_LIST', 'INTERNATIONAL_CLASS_LIST', 'IN_SEASON_REPORT', 'TRADE_COVERAGE', 'MLB_READY', 'OTHER')),
  date_precision text not null check (date_precision in ('DAY', 'MONTH', 'YEAR', 'SEASON', 'UNKNOWN')),
  evaluation_date date,
  evaluation_year int check (evaluation_year is null or evaluation_year between 1900 and 2100),
  evaluation_month int check (evaluation_month is null or evaluation_month between 1 and 12),
  organization_id uuid references public.organizations(id) on delete set null,
  stated_level text,
  eta_season int check (eta_season is null or eta_season between 1900 and 2100),
  role_label text,
  evaluator_name text,
  evaluator_role text,
  evidence_basis text not null check (evidence_basis in
    ('PUBLISHED_LIST', 'PUBLISHED_REPORT', 'TEAM_RELEASE', 'SECONDARY_CITATION', 'MANUAL_TRANSCRIPTION')),
  confidence public.confidence_level not null default 'MEDIUM',
  source_id uuid references public.sources(id) on delete restrict,
  source_reference text,
  archive_url text,
  preservation_concern text check (preservation_concern is null or preservation_concern in
    ('SOURCE_EDITED_AFTER_PUBLICATION', 'SOURCE_UNAVAILABLE', 'SOURCE_UNSTABLE')),
  retrieved_at timestamptz not null,
  summary_note text check (summary_note is null or char_length(summary_note) <= 500),
  record_status text not null default 'DRAFT' check (record_status in ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  supersedes_evaluation_id uuid references public.player_evaluations(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint player_evaluations_provenance_check
    check (source_id is not null or nullif(btrim(source_reference), '') is not null),
  constraint player_evaluations_date_shape_check check (coalesce(case date_precision
    when 'DAY' then evaluation_date is not null and evaluation_year = extract(year from evaluation_date)::int
                    and evaluation_month = extract(month from evaluation_date)::int
    when 'MONTH' then evaluation_date is null and evaluation_year is not null and evaluation_month is not null
    when 'YEAR' then evaluation_date is null and evaluation_year is not null and evaluation_month is null
    when 'SEASON' then evaluation_date is null and evaluation_year is not null and evaluation_month is null
    else evaluation_date is null and evaluation_year is null and evaluation_month is null
  end, false)),
  constraint player_evaluations_supersedes_check
    check (supersedes_evaluation_id is null or supersedes_evaluation_id <> id)
);

-- Snapshot identity among ACTIVE evaluations (see the header for the contract).
create unique index if not exists player_evaluations_snapshot_key
  on public.player_evaluations (
    player_id, publication_id, evaluation_context, date_precision,
    coalesce(evaluation_date, date '0001-01-01'), coalesce(evaluation_year, 0), coalesce(evaluation_month, 0),
    coalesce(source_id::text, 'ref:' || lower(btrim(source_reference))))
  where record_status = 'ACTIVE';
create index if not exists player_evaluations_player_idx on public.player_evaluations (player_id, evaluation_year);
create index if not exists player_evaluations_publication_idx on public.player_evaluations (publication_id);
-- A predecessor has at most one replacement, ever (a draft replacement included).
create unique index if not exists player_evaluations_supersedes_key on public.player_evaluations (supersedes_evaluation_id)
  where supersedes_evaluation_id is not null;

create table if not exists public.player_evaluation_grades (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.player_evaluations(id) on delete cascade,
  dimension_code text not null check (dimension_code in
    ('OVERALL', 'HIT', 'POWER', 'GAME_POWER', 'RAW_POWER', 'RUN', 'FIELD', 'ARM',
     'FASTBALL', 'CURVEBALL', 'SLIDER', 'CHANGEUP', 'SPLITTER', 'CUTTER', 'OTHER_PITCH',
     'COMMAND', 'CONTROL', 'RISK', 'OTHER')),
  temporal_basis text not null default 'UNSPECIFIED' check (temporal_basis in ('PRESENT', 'FUTURE', 'UNSPECIFIED')),
  raw_value numeric,
  raw_label text,
  qualifier text not null default 'NONE' check (qualifier in ('NONE', 'PLUS', 'MINUS')),
  scale_code text not null references public.evaluation_scales(scale_code),
  source_label text,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  constraint player_evaluation_grades_value_check
    check (raw_value is not null or nullif(btrim(raw_label), '') is not null),
  constraint player_evaluation_grades_qualifier_label_check check (coalesce(case qualifier
    when 'PLUS' then raw_label ~ '[+]$'
    when 'MINUS' then raw_label ~ '-$'
    else raw_label is null or raw_label !~ '[+-]$'
  end, false))
);
create unique index if not exists player_evaluation_grades_key
  on public.player_evaluation_grades (evaluation_id, dimension_code, temporal_basis, coalesce(source_label, ''));

create table if not exists public.player_evaluation_rankings (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.player_evaluations(id) on delete cascade,
  rank int not null check (rank >= 1),
  ranking_scope text not null check (ranking_scope in
    ('ORGANIZATION', 'MLB_GLOBAL', 'INTERNATIONAL_CLASS', 'LEAGUE', 'POSITION', 'ROOKIE_CLASS', 'OTHER')),
  scope_label text not null check (btrim(scope_label) <> ''),
  organization_id uuid references public.organizations(id) on delete restrict,
  list_size int check (list_size is null or list_size >= 1),
  eligibility_definition text,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  constraint player_evaluation_rankings_org_scope_check
    check ((ranking_scope = 'ORGANIZATION') = (organization_id is not null)),
  constraint player_evaluation_rankings_size_check check (list_size is null or list_size >= rank),
  unique (evaluation_id, ranking_scope, scope_label)
);

create table if not exists public.player_evaluation_notes (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.player_evaluations(id) on delete cascade,
  note_kind text not null check (note_kind in ('STRENGTH', 'WEAKNESS', 'RISK', 'PROJECTION', 'CONTEXT', 'OTHER')),
  note_seq int not null default 1 check (note_seq >= 1),
  note_text text not null check (char_length(btrim(note_text)) between 1 and 500),
  note_origin text not null default 'ANALYST_PARAPHRASE' check (note_origin = 'ANALYST_PARAPHRASE'),
  created_at timestamptz not null default now(),
  unique (evaluation_id, note_kind, note_seq)
);

comment on table public.scouting_publications is
  'An evaluative publication / product (a prospect list, signing tracker, profile series). One row per product; each evaluation cites a specific edition through sources. origin separates EXTERNAL and TEAM_PUBLIC evaluators from DISI_RESEARCH notes; DISI model output never lives here (public.model_predictions).';
comment on table public.evaluation_scales is
  'Scales for scouting grades. Raw grades are always stored in the source''s own scale; any normalization is derived analytics, never stored.';
comment on table public.player_evaluations is
  'Immutable point-in-time evaluation snapshots: what an evaluator believed about a player at a date, with provenance. NULL means not observed; no row means no verified evaluation found. evaluation_date is the publication / report date and is only set for DAY precision.';
comment on column public.player_evaluations.evaluation_context is
  'The occasion, not the measurement. ORG_LIST = organization prospect list; GLOBAL_LIST = MLB-wide prospect list; INTERNATIONAL_CLASS_LIST = international amateur / free-agent class list; PRE_SIGNING and SIGNING only where source and signing dates establish the chronology. What was measured is in the child grade / ranking / note rows and the eta_season / role_label columns.';
comment on column public.player_evaluations.stated_level is
  'The level label the source states for the player at evaluation time (FanGraphs: the Highest Level column), verbatim and not mapped.';
comment on column public.player_evaluations.archive_url is
  'An archive snapshot of the cited page, where one has been verified. A live primary source is sufficient provenance; NULL queues MISSING_ARCHIVE_REFERENCE only when preservation is warranted (a secondary citation or a preservation_concern).';
comment on column public.player_evaluations.preservation_concern is
  'Why an archive snapshot is materially warranted: SOURCE_EDITED_AFTER_PUBLICATION, SOURCE_UNAVAILABLE or SOURCE_UNSTABLE. NULL means the live primary source is sufficient on its own.';
comment on column public.player_evaluations.record_status is
  'DRAFT while a snapshot is being assembled (invisible to every view, children writable); ACTIVE once sealed (header and children immutable); SUPERSEDED once a replacement is active.';
comment on column public.player_evaluation_grades.raw_label is
  'The grade exactly as the source printed it (for example 45+). raw_value holds the numeric base; qualifier records the + or -.';
comment on column public.player_evaluation_grades.temporal_basis is
  'PRESENT or FUTURE for a present/future pair; UNSPECIFIED for a single value. Overall FV is dimension OVERALL with temporal basis FUTURE.';
comment on column public.player_evaluation_rankings.scope_label is
  'The list the rank belongs to, in the source''s words. A rank is meaningless without its scope: an organization #3 is not an MLB-wide #3.';

-- ===========================================================================
-- 3. IMMUTABILITY AND SCALE VALIDATION
-- ===========================================================================

create or replace function public.disi_evaluation_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  predecessor public.player_evaluations%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.record_status <> 'DRAFT' then
      raise exception 'a % evaluation is a sealed historical observation and cannot be deleted (%)', old.record_status, old.id
        using errcode = '55000';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.record_status <> 'DRAFT' then
      raise exception 'a new evaluation starts as DRAFT: populate its grades / rankings / notes, then activate it' using errcode = '55000';
    end if;
  else
    if old.record_status = 'SUPERSEDED' then
      raise exception 'a SUPERSEDED evaluation is sealed (%)', old.id using errcode = '55000';
    end if;
    if old.record_status = 'ACTIVE' then
      if (to_jsonb(new) - 'record_status') is distinct from (to_jsonb(old) - 'record_status') then
        raise exception 'an ACTIVE evaluation is sealed; assemble a replacement DRAFT that supersedes it instead (%)', old.id
          using errcode = '55000';
      end if;
      if new.record_status <> 'SUPERSEDED' then
        raise exception 'an ACTIVE evaluation can only move to SUPERSEDED (%)', old.id using errcode = '55000';
      end if;
      if not exists (select 1 from public.player_evaluations s
                     where s.supersedes_evaluation_id = old.id and s.record_status in ('DRAFT', 'ACTIVE')) then
        raise exception 'an evaluation is superseded only by a replacement: create the replacement DRAFT first (%)', old.id
          using errcode = '55000';
      end if;
      return new;
    end if;
    -- old is DRAFT
    if new.record_status = 'SUPERSEDED' then
      raise exception 'a DRAFT cannot be superseded; activate it or delete it (%)', old.id using errcode = '55000';
    end if;
  end if;

  -- new is a DRAFT being assembled, or a DRAFT being activated
  if new.supersedes_evaluation_id is not null then
    select * into predecessor from public.player_evaluations where id = new.supersedes_evaluation_id;
    if not found or predecessor.id = new.id or predecessor.player_id <> new.player_id
       or predecessor.publication_id <> new.publication_id or predecessor.record_status = 'DRAFT' then
      raise exception 'a correction must supersede a sealed (ACTIVE or SUPERSEDED) evaluation of the same player and publication (%)',
        new.supersedes_evaluation_id using errcode = '55000';
    end if;
    if tg_op = 'UPDATE' and new.record_status = 'ACTIVE' and predecessor.record_status = 'ACTIVE' then
      -- the replacement is sealed and its predecessor retired in one step
      update public.player_evaluations set record_status = 'SUPERSEDED' where id = predecessor.id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_evaluation_guard() from public, anon, authenticated;

drop trigger if exists player_evaluations_guard on public.player_evaluations;
create trigger player_evaluations_guard
before insert or update or delete on public.player_evaluations
for each row execute function public.disi_evaluation_guard();

create or replace function public.disi_evaluation_child_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_status text;
begin
  -- Children are writable only while their evaluation is a DRAFT. A parent that no
  -- longer exists (a cascade from deleting a DRAFT) is not a sealed snapshot.
  if tg_op in ('INSERT', 'UPDATE') then
    select record_status into parent_status from public.player_evaluations where id = new.evaluation_id;
    if found and parent_status <> 'DRAFT' then
      raise exception '% rows cannot change once their evaluation is %; assemble a replacement DRAFT instead', tg_table_name, parent_status
        using errcode = '55000';
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select record_status into parent_status from public.player_evaluations where id = old.evaluation_id;
    if found and parent_status <> 'DRAFT' then
      raise exception '% rows cannot change once their evaluation is %; assemble a replacement DRAFT instead', tg_table_name, parent_status
        using errcode = '55000';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke execute on function public.disi_evaluation_child_immutable() from public, anon, authenticated;

drop trigger if exists player_evaluation_grades_immutable on public.player_evaluation_grades;
create trigger player_evaluation_grades_immutable
before insert or update or delete on public.player_evaluation_grades
for each row execute function public.disi_evaluation_child_immutable();
drop trigger if exists player_evaluation_rankings_immutable on public.player_evaluation_rankings;
create trigger player_evaluation_rankings_immutable
before insert or update or delete on public.player_evaluation_rankings
for each row execute function public.disi_evaluation_child_immutable();
drop trigger if exists player_evaluation_notes_immutable on public.player_evaluation_notes;
create trigger player_evaluation_notes_immutable
before insert or update or delete on public.player_evaluation_notes
for each row execute function public.disi_evaluation_child_immutable();

create or replace function public.disi_evaluation_grade_check()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.evaluation_scales%rowtype;
  base numeric;
  suffix text;
begin
  select * into s from public.evaluation_scales where scale_code = new.scale_code;
  if not found then
    raise exception 'grade uses unknown scale %', new.scale_code;
  end if;
  if new.qualifier <> 'NONE' and not s.allows_qualifier then
    raise exception 'scale % does not allow a + / - qualifier', s.scale_code;
  end if;
  if s.scale_kind = 'NUMERIC' then
    if new.raw_value is null then
      raise exception 'numeric scale % requires raw_value (NULL means the source gave no grade: store no row)', s.scale_code;
    end if;
    if new.raw_value < s.scale_min or new.raw_value > s.scale_max then
      raise exception 'grade % is outside scale % (% to %)', new.raw_value, s.scale_code, s.scale_min, s.scale_max;
    end if;
    if s.scale_step is not null and mod(new.raw_value - s.scale_min, s.scale_step) <> 0 then
      raise exception 'grade % is not on the % step of scale %', new.raw_value, s.scale_step, s.scale_code;
    end if;
    if new.raw_label is not null then
      if new.raw_label !~ '^[0-9]+([.][0-9]+)?[+-]?$' then
        raise exception 'raw_label % must be the numeric grade with an optional + or -', new.raw_label;
      end if;
      base := regexp_replace(new.raw_label, '[+-]$', '')::numeric;
      suffix := substring(new.raw_label from '[+-]$');
      if base <> new.raw_value then
        raise exception 'raw_label % does not match raw_value %', new.raw_label, new.raw_value;
      end if;
      if coalesce(suffix, '') <> (case new.qualifier when 'PLUS' then '+' when 'MINUS' then '-' else '' end) then
        raise exception 'raw_label % does not match qualifier %', new.raw_label, new.qualifier;
      end if;
    elsif new.qualifier <> 'NONE' then
      raise exception 'a qualifier requires the printed raw_label';
    end if;
  else
    if new.raw_label is null or not (new.raw_label = any (s.ordered_labels)) then
      raise exception 'label % is not on ordinal scale %', new.raw_label, s.scale_code;
    end if;
    if new.raw_value is not null then
      raise exception 'an ordinal grade carries a label, not a numeric value';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_evaluation_grade_check() from public, anon, authenticated;

drop trigger if exists player_evaluation_grades_check_scale on public.player_evaluation_grades;
create trigger player_evaluation_grades_check_scale
before insert on public.player_evaluation_grades
for each row execute function public.disi_evaluation_grade_check();

-- ===========================================================================
-- 4. SECURITY: RLS, public read, no API writes
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['evaluation_scales', 'scouting_publications', 'player_evaluations',
                           'player_evaluation_grades', 'player_evaluation_rankings', 'player_evaluation_notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists public_read_%I on public.%I', t, t);
    execute format('create policy public_read_%I on public.%I for select to anon, authenticated using (true)', t, t);
  end loop;
end $$;

-- ===========================================================================
-- 5. REVIEWED RESEARCH DATA (database/research/026/seed-evidence.json)
-- ===========================================================================

insert into public.evaluation_scales
  (scale_code, label, scale_kind, scale_min, scale_max, scale_step, ordered_labels, allows_qualifier, notes)
values
{{scales}}
on conflict (scale_code) do nothing;

insert into public.scouting_publications
  (publication_slug, publication_name, publisher, origin, publication_kind, default_scale_code, access_class,
   bulk_ingest_allowed, source_tier, reference_url, scope_notes, methodology_notes)
values
{{publications}}
on conflict (publication_slug) do nothing;

insert into public.sources (source_name, source_type, title, url, author, publication_date, accessed_at, notes, source_tier)
select v.source_name, v.source_type, v.title, v.url, v.author, v.publication_date, v.accessed_at, v.notes,
       public.disi_infer_source_tier(v.url, v.source_type)
from (values
{{sources}}
) as v(source_name, source_type, title, url, author, publication_date, accessed_at, notes)
on conflict (url) do nothing;

create temporary table _m026_eval (
  ref text, player_slug text, publication_slug text, evaluation_context text, date_precision text,
  evaluation_date date, evaluation_year int, evaluation_month int, organization_name text, stated_level text,
  eta_season int, role_label text, evaluator_name text, evaluator_role text, evidence_basis text, confidence text,
  source_url text, source_reference text, archive_url text, retrieved_at timestamptz, summary_note text,
  preservation_concern text
) on commit drop;
insert into _m026_eval values
{{evaluations}};

-- Reviewed rows not yet stored (by snapshot identity, at any status, so a rerun - or a
-- later correction - never recreates them).
create temporary table _m026_eval_new on commit drop as
select v.*
from _m026_eval v
where not exists (
  select 1
  from public.players p
  join public.scouting_publications pub on pub.publication_slug = v.publication_slug
  left join public.sources so on so.url = v.source_url
  join public.player_evaluations e on e.player_id = p.id and e.publication_id = pub.id
   and e.evaluation_context = v.evaluation_context and e.date_precision = v.date_precision
   and coalesce(e.evaluation_date, date '0001-01-01') = coalesce(v.evaluation_date, date '0001-01-01')
   and coalesce(e.evaluation_year, 0) = coalesce(v.evaluation_year, 0)
   and coalesce(e.evaluation_month, 0) = coalesce(v.evaluation_month, 0)
   and coalesce(e.source_id::text, 'ref:' || lower(btrim(e.source_reference)))
     = coalesce(so.id::text, 'ref:' || lower(btrim(v.source_reference)))
  where p.slug = v.player_slug);

-- Snapshots are assembled as DRAFT, then sealed (activated) once complete.
insert into public.player_evaluations
  (player_id, publication_id, evaluation_context, date_precision, evaluation_date, evaluation_year, evaluation_month,
   organization_id, stated_level, eta_season, role_label, evaluator_name, evaluator_role, evidence_basis, confidence,
   source_id, source_reference, archive_url, retrieved_at, summary_note, preservation_concern, record_status)
select p.id, pub.id, v.evaluation_context, v.date_precision, v.evaluation_date, v.evaluation_year, v.evaluation_month,
       o.id, v.stated_level, v.eta_season, v.role_label, v.evaluator_name, v.evaluator_role, v.evidence_basis,
       v.confidence::public.confidence_level, so.id, v.source_reference, v.archive_url, v.retrieved_at, v.summary_note,
       v.preservation_concern, 'DRAFT'
from _m026_eval_new v
join public.players p on p.slug = v.player_slug
join public.scouting_publications pub on pub.publication_slug = v.publication_slug
left join public.organizations o on o.name = v.organization_name
left join public.sources so on so.url = v.source_url;

-- Map each new reference to its DRAFT by snapshot identity.
create temporary table _m026_eval_ids on commit drop as
select v.ref, e.id as evaluation_id
from _m026_eval_new v
join public.players p on p.slug = v.player_slug
join public.scouting_publications pub on pub.publication_slug = v.publication_slug
left join public.sources so on so.url = v.source_url
join public.player_evaluations e
  on e.player_id = p.id and e.publication_id = pub.id and e.record_status = 'DRAFT'
 and e.evaluation_context = v.evaluation_context and e.date_precision = v.date_precision
 and coalesce(e.evaluation_date, date '0001-01-01') = coalesce(v.evaluation_date, date '0001-01-01')
 and coalesce(e.evaluation_year, 0) = coalesce(v.evaluation_year, 0)
 and coalesce(e.evaluation_month, 0) = coalesce(v.evaluation_month, 0)
 and coalesce(e.source_id::text, 'ref:' || lower(btrim(e.source_reference)))
   = coalesce(so.id::text, 'ref:' || lower(btrim(v.source_reference)));

do $$
begin
  if (select count(*) from _m026_eval_ids) <> (select count(*) from _m026_eval_new) then
    raise exception '026: reviewed evaluations did not all resolve to stored drafts';
  end if;
end $$;

insert into public.player_evaluation_rankings
  (evaluation_id, rank, ranking_scope, scope_label, organization_id, list_size, eligibility_definition)
select ei.evaluation_id, v.rank, v.ranking_scope, v.scope_label, o.id, v.list_size, v.eligibility_definition
from (values
{{rankings}}
) as v(ref, rank, ranking_scope, scope_label, organization_name, list_size, eligibility_definition)
join _m026_eval_ids ei on ei.ref = v.ref
left join public.organizations o on o.name = v.organization_name
on conflict do nothing;

insert into public.player_evaluation_grades
  (evaluation_id, dimension_code, temporal_basis, raw_value, raw_label, qualifier, scale_code, source_label)
select ei.evaluation_id, v.dimension_code, v.temporal_basis, v.raw_value, v.raw_label, v.qualifier, v.scale_code, v.source_label
from (values
{{grades}}
) as v(ref, dimension_code, temporal_basis, raw_value, raw_label, qualifier, scale_code, source_label)
join _m026_eval_ids ei on ei.ref = v.ref
on conflict do nothing;

insert into public.player_evaluation_notes (evaluation_id, note_kind, note_seq, note_text)
select ei.evaluation_id, v.note_kind, v.note_seq, v.note_text
from (values
{{notes}}
) as v(ref, note_kind, note_seq, note_text)
join _m026_eval_ids ei on ei.ref = v.ref
on conflict do nothing;

-- Seal the assembled snapshots: from here their header and children are immutable.
update public.player_evaluations set record_status = 'ACTIVE'
where id in (select evaluation_id from _m026_eval_ids) and record_status = 'DRAFT';

-- ===========================================================================
-- 6. BACKFILL: legacy MLB Pipeline international ranks that have provenance
-- ===========================================================================
-- signings.international_rank held 59 MLB Pipeline Top 30/50 international ranks
-- with no per-row evidence. A rank is backfilled ONLY when its signing is linked
-- (through evidence) to a MLB Pipeline international tracker source that has a
-- publication date: the evaluation is dated to that publication, cites that
-- source, and carries the rank under INTERNATIONAL_CLASS scope. These are
-- international-class lists, so the context is INTERNATIONAL_CLASS_LIST: never
-- GLOBAL_LIST (not an MLB-wide list) and never PRE_SIGNING (no signing chronology
-- is claimed). The other ranks are not evaluation facts: they stay in
-- signings.international_rank and are queued as LEGACY_RANK_WITHOUT_EVALUATION.

create temporary table _m026_backfill on commit drop as
select distinct on (sg.id)
  sg.id as signing_id, sg.player_id, sg.organization_id, sg.signing_date, sg.signing_year,
  sg.international_rank::int as rank, so.id as source_id, so.title as source_title,
  so.publication_date, so.accessed_at, e.confidence
from public.signings sg
join public.evidence e on e.entity_type = 'signing' and e.entity_id = sg.id
join public.sources so on so.id = e.source_id
where sg.international_rank is not null and sg.rank_source = 'MLB Pipeline'
  and so.source_tier = 'MLB_PIPELINE' and so.source_type = 'INTERNATIONAL_TRACKER'
  and so.publication_date is not null
order by sg.id, so.publication_date, so.id;

do $$
declare
  sourced bigint;
  unsourced bigint;
begin
  select count(*) into sourced from _m026_backfill;
  select count(*) into unsourced from public.signings where international_rank is not null;
  unsourced := unsourced - sourced;
  if sourced <> {{expected_sourced}} or unsourced <> {{expected_unsourced}} then
    raise exception '026: legacy international ranks split % sourced / % unsourced, expected {{expected_sourced}} / {{expected_unsourced}}',
      sourced, unsourced;
  end if;
end $$;

insert into public.player_evaluations
  (player_id, publication_id, evaluation_context, date_precision, evaluation_date, evaluation_year, evaluation_month,
   organization_id, evidence_basis, confidence, source_id, retrieved_at, record_status)
select b.player_id, pub.id, 'INTERNATIONAL_CLASS_LIST',
  'DAY', b.publication_date, extract(year from b.publication_date)::int, extract(month from b.publication_date)::int,
  b.organization_id, 'PUBLISHED_LIST', b.confidence, b.source_id, b.accessed_at, 'DRAFT'
from _m026_backfill b
join public.scouting_publications pub on pub.publication_slug = 'mlb-pipeline-top-30-international-signings'
where not exists (
  select 1 from public.player_evaluations e
  where e.player_id = b.player_id and e.publication_id = pub.id and e.source_id = b.source_id);

insert into public.player_evaluation_rankings (evaluation_id, rank, ranking_scope, scope_label, list_size)
select e.id, b.rank, 'INTERNATIONAL_CLASS', b.source_title, nullif(substring(b.source_title from 'Top ([0-9]+)'), '')::int
from _m026_backfill b
join public.scouting_publications pub on pub.publication_slug = 'mlb-pipeline-top-30-international-signings'
join public.player_evaluations e
  on e.player_id = b.player_id and e.publication_id = pub.id and e.source_id = b.source_id and e.record_status = 'DRAFT'
on conflict do nothing;

update public.player_evaluations e set record_status = 'ACTIVE'
from _m026_backfill b, public.scouting_publications pub
where pub.publication_slug = 'mlb-pipeline-top-30-international-signings'
  and e.player_id = b.player_id and e.publication_id = pub.id and e.source_id = b.source_id
  and e.record_status = 'DRAFT';

do $$
begin
  if (select count(*) from _m026_backfill b
      join public.scouting_publications pub on pub.publication_slug = 'mlb-pipeline-top-30-international-signings'
      join public.player_evaluations e on e.player_id = b.player_id and e.publication_id = pub.id and e.source_id = b.source_id and e.record_status = 'ACTIVE'
      join public.player_evaluation_rankings r on r.evaluation_id = e.id and r.ranking_scope = 'INTERNATIONAL_CLASS' and r.rank = b.rank) <> {{expected_sourced}} then
    raise exception '026: the sourced legacy ranks were not all backfilled';
  end if;
end $$;

-- ===========================================================================
-- 7. VIEWS
-- ===========================================================================
-- Contract for every view below: ACTIVE evaluations only, DISI_RESEARCH
-- publications excluded (these are views of EXTERNAL / TEAM_PUBLIC opinion),
-- joined on player_id (never on a name), exact day-based metrics only from DAY
-- precision, grades shown with their printed label, numeric base AND qualifier.

create or replace view public.v_player_scouting_timeline
with (security_invoker = true)
as
select
  e.id as evaluation_id,
  e.player_id,
  p.slug as player_slug,
  p.full_name as player_name,
  pub.publication_slug,
  pub.publication_name,
  pub.publisher,
  pub.origin,
  e.evaluation_context,
  e.date_precision,
  e.evaluation_date,
  e.evaluation_year,
  e.evaluation_month,
  case e.date_precision
    when 'DAY' then to_char(e.evaluation_date, 'YYYY-MM-DD')
    when 'MONTH' then to_char(make_date(e.evaluation_year, e.evaluation_month, 1), 'YYYY-MM')
    when 'YEAR' then e.evaluation_year::text
    when 'SEASON' then e.evaluation_year::text || ' season'
    else 'Date unknown'
  end as evaluation_label,
  -- Chronological ordering only (unknown dates sort last); not a date.
  coalesce(lpad(e.evaluation_year::text, 4, '0'), '9999')
    || lpad(coalesce(e.evaluation_month, 0)::text, 2, '0')
    || coalesce(to_char(e.evaluation_date, 'DD'), '00') as sort_key,
  org.name as organization_name,
  e.stated_level,
  e.eta_season,
  e.role_label,
  e.evaluator_name,
  e.evaluator_role,
  fv.raw_label as future_value_label,
  fv.raw_value as future_value_numeric_base,
  fv.qualifier as future_value_qualifier,
  fv.scale_code as future_value_scale,
  pv.raw_label as present_overall_label,
  pv.raw_value as present_overall_numeric_base,
  pv.qualifier as present_overall_qualifier,
  rk.rank_summary,
  rk.rankings,
  coalesce(gr.n_grades, 0) as grade_count,
  coalesce(rk.n_rankings, 0) as ranking_count,
  coalesce(nt.n_notes, 0) as note_count,
  coalesce(gr.n_tool_grades, 0) > 0 as has_tool_grades,
  fv.raw_label is not null as has_future_value,
  coalesce(rk.n_rankings, 0) > 0 as has_ranking,
  e.summary_note,
  so.url as source_url,
  so.title as source_title,
  e.source_reference,
  e.archive_url,
  e.evidence_basis,
  e.confidence::text as confidence,
  e.retrieved_at,
  -- Signing context: the earliest recorded signing. Exact only for DAY precision.
  sg.signing_date,
  sg.signing_year,
  case when e.date_precision = 'DAY' and sg.signing_date is not null
       then e.evaluation_date - sg.signing_date end as days_from_signing_exact,
  case
    when e.date_precision = 'DAY' and sg.signing_date is not null then
      case when e.evaluation_date < sg.signing_date then 'BEFORE'
           when e.evaluation_date = sg.signing_date then 'SAME_DAY' else 'AFTER' end
    else 'UNKNOWN'
  end as evaluation_vs_signing,
  case when e.evaluation_year is not null and sg.signing_year is not null
       then e.evaluation_year - sg.signing_year end as approx_years_from_signing,
  -- Age: exact only for DAY precision; the year-level value is labelled approximate.
  case when e.date_precision = 'DAY' and p.birth_date is not null
       then public.disi_age_years(p.birth_date, e.evaluation_date) end as age_at_evaluation_exact,
  case when e.evaluation_year is not null and p.birth_date is not null
       then e.evaluation_year - extract(year from p.birth_date)::int end as approx_age_in_evaluation_year,
  -- Development level from DATED team stints, DAY precision only; otherwise NULL.
  lv.level as development_level_at_evaluation,
  case when lv.level is not null then 'EXACT_DATE' end as development_level_basis,
  case
    when e.date_precision = 'DAY' and p.mlb_debut_date is not null then
      case when e.evaluation_date < p.mlb_debut_date then 'PRE_MLB_DEBUT' else 'ON_OR_AFTER_MLB_DEBUT' end
    when e.evaluation_year is not null and p.mlb_debut_date is not null
         and e.evaluation_year < extract(year from p.mlb_debut_date)::int then 'PRE_MLB_DEBUT'
    when e.evaluation_year is not null and p.mlb_debut_date is not null
         and e.evaluation_year > extract(year from p.mlb_debut_date)::int then 'ON_OR_AFTER_MLB_DEBUT'
    when p.mlb_debut_date is null and oa.reached_mlb_verified is false then 'PRE_MLB_DEBUT'
    else 'UNKNOWN'
  end as mlb_status_at_evaluation
from public.player_evaluations e
join public.players p on p.id = e.player_id
join public.scouting_publications pub on pub.id = e.publication_id
left join public.sources so on so.id = e.source_id
left join public.organizations org on org.id = e.organization_id
left join public.outcome_audits oa on oa.player_id = p.id
left join lateral (
  select g.raw_label, g.raw_value, g.qualifier, g.scale_code from public.player_evaluation_grades g
  where g.evaluation_id = e.id and g.dimension_code = 'OVERALL' and g.temporal_basis = 'FUTURE'
  order by g.source_label nulls last limit 1
) fv on true
left join lateral (
  select g.raw_label, g.raw_value, g.qualifier from public.player_evaluation_grades g
  where g.evaluation_id = e.id and g.dimension_code = 'OVERALL' and g.temporal_basis = 'PRESENT'
  order by g.source_label nulls last limit 1
) pv on true
left join lateral (
  select count(*)::int as n_grades,
         count(*) filter (where g.dimension_code not in ('OVERALL', 'RISK'))::int as n_tool_grades
  from public.player_evaluation_grades g where g.evaluation_id = e.id
) gr on true
left join lateral (
  select count(*)::int as n_rankings,
         string_agg(r.scope_label || ' #' || r.rank, '; ' order by r.ranking_scope, r.scope_label) as rank_summary,
         jsonb_agg(jsonb_build_object('scope', r.ranking_scope, 'label', r.scope_label, 'rank', r.rank,
                                      'list_size', r.list_size) order by r.ranking_scope, r.scope_label) as rankings
  from public.player_evaluation_rankings r where r.evaluation_id = e.id
) rk on true
left join lateral (
  select count(*)::int as n_notes from public.player_evaluation_notes n where n.evaluation_id = e.id
) nt on true
left join lateral (
  select s.signing_date, s.signing_year from public.signings s
  where s.player_id = e.player_id order by s.signing_year, s.signing_date nulls last limit 1
) sg on true
left join lateral (
  select st.level::text as level from public.player_season_stints st
  where e.date_precision = 'DAY' and st.player_id = e.player_id and st.stint_kind = 'TEAM_STINT'
    and st.affiliated and st.first_game_date is not null and st.first_game_date <= e.evaluation_date
  order by st.first_game_date desc limit 1
) lv on true
where e.record_status = 'ACTIVE' and pub.origin <> 'DISI_RESEARCH';

comment on view public.v_player_scouting_timeline is
  'Every ACTIVE external / team-public evaluation snapshot in chronological order (sort_key). Opinions, not facts: separate from first appearances, development arrival, performance and outcomes. Day-based columns are exact only for DAY precision; approx_ columns are labelled approximations; future_value_* keep the printed label, numeric base and qualifier apart.';

create or replace view public.v_player_latest_external_evaluation
with (security_invoker = true)
as
select distinct on (t.player_id, t.publication_slug)
  t.player_id, t.player_slug, t.player_name, t.publication_slug, t.publication_name, t.publisher, t.origin,
  t.evaluation_id, t.evaluation_context, t.date_precision, t.evaluation_label, t.sort_key,
  t.future_value_label, t.future_value_numeric_base, t.future_value_qualifier, t.rank_summary,
  t.eta_season, t.source_url, t.evidence_basis, t.confidence
from public.v_player_scouting_timeline t
order by t.player_id, t.publication_slug, (t.date_precision = 'UNKNOWN'), t.sort_key desc, t.retrieved_at desc;

comment on view public.v_player_latest_external_evaluation is
  'The most recent snapshot per player and publication - what each evaluator last said, as of the evaluation_label date. It is never a single current FV or rank, and snapshots with unknown dates only win when a publication has nothing better.';

create or replace view public.v_dodgers_scouting_at_signing
with (security_invoker = true)
as
select
  t.player_id, t.player_slug, t.player_name,
  s.signing_year, s.signing_date, s.pathway::text as pathway, s.country_market, s.signing_bonus_usd,
  t.evaluation_id, t.publication_slug, t.publication_name, t.evaluation_context, t.date_precision,
  t.evaluation_label, t.days_from_signing_exact, t.evaluation_vs_signing, t.approx_years_from_signing,
  t.future_value_label, t.future_value_numeric_base, t.future_value_qualifier, t.rank_summary,
  t.eta_season, t.source_url, t.evidence_basis, t.confidence,
  case when t.evaluation_context in ('PRE_SIGNING', 'SIGNING') then 'SIGNING_CONTEXT' else 'SAME_YEAR' end as at_signing_basis
from public.v_player_scouting_timeline t
join public.signings s on s.player_id = t.player_id
join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
where t.evaluation_context in ('PRE_SIGNING', 'SIGNING') or t.evaluation_year = s.signing_year;

comment on view public.v_dodgers_scouting_at_signing is
  'What external evaluators said about a Dodgers signing around the time of signing: PRE_SIGNING / SIGNING contexts, or any evaluation published in the signing year. evaluation_vs_signing is exact only when both dates are DAY precision, otherwise UNKNOWN. The legacy unsourced signings.international_rank values are deliberately not shown here.';

create or replace view public.v_scouting_source_coverage
with (security_invoker = true)
as
select
  pub.publication_slug, pub.publication_name, pub.publisher, pub.origin, pub.publication_kind,
  pub.access_class, pub.bulk_ingest_allowed,
  count(e.id)::int as evaluations,
  count(distinct e.player_id)::int as players,
  min(e.evaluation_year) as first_year,
  max(e.evaluation_year) as last_year,
  count(e.id) filter (where e.date_precision = 'DAY')::int as day_precision,
  count(e.id) filter (where e.date_precision in ('MONTH', 'YEAR', 'SEASON'))::int as coarse_precision,
  count(e.id) filter (where e.date_precision = 'UNKNOWN')::int as unknown_date,
  count(e.id) filter (where exists (select 1 from public.player_evaluation_rankings r where r.evaluation_id = e.id))::int as with_ranking,
  count(e.id) filter (where exists (select 1 from public.player_evaluation_grades g where g.evaluation_id = e.id and g.dimension_code = 'OVERALL' and g.temporal_basis = 'FUTURE'))::int as with_future_value,
  count(e.id) filter (where exists (select 1 from public.player_evaluation_grades g where g.evaluation_id = e.id and g.dimension_code not in ('OVERALL', 'RISK')))::int as with_tool_grades,
  count(e.id) filter (where e.archive_url is not null)::int as with_archive_reference,
  count(e.id) filter (where e.evidence_basis = 'SECONDARY_CITATION')::int as secondary_citations
from public.scouting_publications pub
left join public.player_evaluations e on e.publication_id = pub.id and e.record_status = 'ACTIVE'
where pub.origin <> 'DISI_RESEARCH'
group by pub.id, pub.publication_slug, pub.publication_name, pub.publisher, pub.origin, pub.publication_kind,
         pub.access_class, pub.bulk_ingest_allowed;

comment on view public.v_scouting_source_coverage is
  'Coverage per external publication: how many ACTIVE snapshots, players, years, date precisions and content types DISI holds. A blind spot is a count of zero, not a negative finding.';

create or replace view public.v_scouting_research_queue
with (security_invoker = true)
as
with active as (
  select e.*, pub.publication_slug
  from public.player_evaluations e
  join public.scouting_publications pub on pub.id = e.publication_id
  where e.record_status = 'ACTIVE' and pub.origin <> 'DISI_RESEARCH'
),
issues as (
  select sg.player_id, 'LEGACY_RANK_WITHOUT_EVALUATION'::text as issue, 3 as priority,
    format('signings.international_rank %s (%s, signing year %s) has no provenance-backed evaluation; it is not an evaluation fact until a source is located',
           sg.international_rank::int, coalesce(sg.rank_source, 'source unrecorded'), sg.signing_year) as detail
  from public.signings sg
  where sg.international_rank is not null
    and not exists (
      select 1 from active a
      join public.player_evaluation_rankings r on r.evaluation_id = a.id and r.ranking_scope = 'INTERNATIONAL_CLASS'
      where a.player_id = sg.player_id and a.publication_slug like 'mlb-pipeline-%')
  union all
  -- Targeted: a live primary source is sufficient provenance, so a missing archive
  -- snapshot alone is not an issue. It is raised only where preservation is warranted:
  -- the evidence is a secondary citation, or a preservation_concern is recorded
  -- (source edited after publication, unavailable, or unstable).
  select a.player_id, 'MISSING_ARCHIVE_REFERENCE', 3,
    format('%s evaluation(s) need an archive snapshot of the original source: %s', count(*),
           string_agg(distinct case
             when a.evidence_basis = 'SECONDARY_CITATION' then 'relies on a secondary citation'
             when a.preservation_concern = 'SOURCE_EDITED_AFTER_PUBLICATION' then 'the cited page was edited after publication'
             when a.preservation_concern = 'SOURCE_UNAVAILABLE' then 'the original source is no longer accessible'
             else 'the cited source is unstable' end, '; '))
  from active a
  where a.archive_url is null and (a.evidence_basis = 'SECONDARY_CITATION' or a.preservation_concern is not null)
  group by a.player_id
  union all
  select a.player_id, 'EVALUATION_DATE_IMPRECISE', 2,
    format('%s evaluation(s) are dated only to %s precision; no exact date is invented', count(*), string_agg(distinct a.date_precision, '/'))
  from active a where a.date_precision in ('MONTH', 'YEAR', 'SEASON') group by a.player_id
  union all
  select a.player_id, 'EVALUATION_WITHOUT_DATE', 2,
    format('%s evaluation(s) have no date; they cannot be placed on the timeline', count(*))
  from active a where a.date_precision = 'UNKNOWN' group by a.player_id
  union all
  select sg.player_id, 'SIGNING_WITHOUT_SIGNING_EVALUATION', 3,
    format('Dodgers signing %s (%s) has a reported bonus or a recorded rank but no evaluation from its signing year or in a signing context',
           sg.signing_year, sg.pathway::text)
  from public.signings sg
  join public.organizations o on o.id = sg.organization_id and o.franchise_key = 'DODGERS'
  where (sg.bonus_publicly_reported or sg.international_rank is not null)
    and not exists (
      select 1 from active a
      where a.player_id = sg.player_id
        and (a.evaluation_context in ('PRE_SIGNING', 'SIGNING') or a.evaluation_year = sg.signing_year))
  union all
  select p.id, 'PLAYER_WITHOUT_SCOUTING_HISTORY', 3,
    'No verified external evaluation is recorded for a player who reached MLB or has a legacy recorded rank; absence of a row is not evidence that none exists'
  from public.players p
  where (exists (select 1 from public.outcome_audits oa where oa.player_id = p.id and oa.reached_mlb_verified)
         or exists (select 1 from public.signings sg where sg.player_id = p.id and sg.international_rank is not null))
    and not exists (select 1 from active a where a.player_id = p.id)
)
select p.id as player_id, p.slug as player_slug, p.full_name, p.mlb_id, i.issue, i.priority, i.detail
from issues i
join public.players p on p.id = i.player_id;

comment on view public.v_scouting_research_queue is
  'Unresolved scouting research, never false completeness. Conditions the schema already forbids (rank without scope, grade without scale, evaluation without a source) cannot occur and are not queued. Differing opinions between publications are not conflicts.';

-- ===========================================================================
-- 8. GRANTS (explicit; never rely on Supabase default privileges) AND POSTCONDITION
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'evaluation_scales', 'scouting_publications', 'player_evaluations', 'player_evaluation_grades',
    'player_evaluation_rankings', 'player_evaluation_notes',
    'v_player_scouting_timeline', 'v_player_latest_external_evaluation', 'v_dodgers_scouting_at_signing',
    'v_scouting_source_coverage', 'v_scouting_research_queue'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

-- Nothing in public may grant the API roles or PUBLIC more than SELECT (from the
-- ACLs themselves, so MAINTAIN is covered). Raises and rolls back otherwise.
do $$
declare
  bad text;
begin
  select string_agg(format('%s:%s:%s', c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type), ', ' order by 1) into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    and a.privilege_type <> 'SELECT';
  if bad is not null then
    raise exception '026: API roles hold privileges beyond SELECT: %', bad;
  end if;
end $$;

commit;
