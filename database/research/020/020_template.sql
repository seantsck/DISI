-- DISI v0.11
-- 020_player_identity_and_biography_enrichment.sql
-- Canonical player identity: external identifiers (MLB, Baseball-Reference,
-- FanGraphs), biography fields with field-level provenance, position at
-- signing, derived ages, and identity research views. Run after 019.
--
-- Built from reviewed research artifacts (database/research/020/), produced by
-- scripts/mlb/player-identities.mjs, resolve-bref.mjs, resolve-fangraphs.mjs
-- and identity-sql-values.mjs against the MLB Stats API person records
-- (hydrate=xrefId) and Baseball-Reference's WAR data files. Retrieved 2026-10-05.
--
-- Identity rules:
--   * Values only fill NULL fields. An existing value that a source contradicts
--     is kept and the disagreement is recorded in research_source_conflicts.
--   * An identifier is never written if another player already holds it.
--   * Each biography field gets its own evidence row naming the field it
--     supports. A source for birth date is not evidence for nationality,
--     position or any other field.
--   * Nationality is never derived from birth country; bats/throws are never
--     derived from position. Neither is written here.
--   * Names: full_name changes only when the reviewed source spelling differs
--     from the DISI spelling by accents alone (same slug, same letters). The
--     previous spelling becomes a PREVIOUS_DISI_SPELLING alias. Slugs never change.
--   * Players are never merged. Unresolved identities stay NULL and appear in
--     v_dodgers_player_identity_research_queue.
--
-- Rerunnable.

begin;

-- ===========================================================================
-- 1. SCHEMA
-- ===========================================================================

alter table public.players add column if not exists birth_state_province text;
alter table public.players add column if not exists current_position text;
alter table public.players add column if not exists mlb_debut_date date;

comment on column public.players.birth_country is
  'Country of birth as recorded by the player record source. Not a signing market and not a nationality.';
comment on column public.players.nationality is
  'Nationality only where a source states it. Never derived from birth country.';
comment on column public.players.birth_state_province is
  'State / province of birth (MLB person record birthStateProvince).';
comment on column public.players.current_position is
  'Current primary position on the MLB person record as of retrieval. Distinct from primary_position (DISI research position) and signings.position_at_signing.';
comment on column public.players.mlb_debut_date is
  'MLB debut date on the MLB person record (identity attribute). The audited outcome lives in outcomes.mlb_debut_date; a disagreement is recorded as a conflict.';
comment on column public.players.canonical_name is
  'Canonical display spelling of the player''s name, including accents where the identity source records them. Alternative spellings are player_aliases.';

alter table public.signings add column if not exists position_at_signing text;
alter table public.signings add column if not exists position_at_signing_source_id uuid
  references public.sources(id) on delete set null;
comment on column public.signings.position_at_signing is
  'Position named on the club''s signing transaction (MLB transaction description), not the player''s later position.';

-- How each external identifier was (or was not) resolved, with the query,
-- candidates and signals reviewed. One row per player per identifier system.
create table if not exists public.player_identity_resolutions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  id_system text not null check (id_system in ('MLB','BASEBALL_REFERENCE','FANGRAPHS')),
  external_id text,
  status text not null check (status in (
    'RESOLVED','AMBIGUOUS','NEEDS_REVIEW','CONFLICT','NOT_FOUND','NOT_APPLICABLE','NOT_AVAILABLE')),
  method text,
  confidence public.confidence_level,
  signals text[] not null default array[]::text[],
  candidates jsonb,
  query jsonb,
  source_id uuid references public.sources(id) on delete set null,
  decided_on date not null,
  note text,
  created_at timestamptz not null default now(),
  unique (player_id, id_system),
  check (status <> 'RESOLVED' or external_id is not null),
  check (status in ('RESOLVED','CONFLICT') or external_id is null)
);
create index if not exists player_identity_resolutions_status_idx
  on public.player_identity_resolutions(id_system, status);

alter table public.player_identity_resolutions enable row level security;
revoke all on table public.player_identity_resolutions from anon, authenticated;
grant select on table public.player_identity_resolutions to anon, authenticated;
drop policy if exists public_read_player_identity_resolutions on public.player_identity_resolutions;
create policy public_read_player_identity_resolutions
on public.player_identity_resolutions
for select
to anon, authenticated
using (true);

-- Conflict types gain biography fields.
alter table public.research_source_conflicts drop constraint if exists research_source_conflicts_conflict_type_check;
alter table public.research_source_conflicts add constraint research_source_conflicts_conflict_type_check
  check (conflict_type in ('NAME_SPELLING','POSITION','BIRTH_COUNTRY','COUNTRY_MARKET','CLASS_MEMBERSHIP',
    'POPULATION_COUNT','PERIOD_ASSIGNMENT','POPULATION_DEFINITION','OUTCOME','IDENTITY',
    'BIRTH_DATE','HANDEDNESS'));

-- Age in completed years and in decimal years (truncated to one decimal) on a
-- given date. NULL when either date is missing or the date precedes birth.
create or replace function public.disi_age_years(p_birth date, p_on date)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p_birth is null or p_on is null or p_on < p_birth then null
              else extract(year from age(p_on, p_birth))::int end
$$;

create or replace function public.disi_age_decimal(p_birth date, p_on date)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p_birth is null or p_on is null or p_on < p_birth then null
              else trunc(((p_on - p_birth) / 365.2425)::numeric, 1) end
$$;

create or replace function public.disi_signing_age_band(p_age_years integer)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_age_years is null then null
    when p_age_years <= 16 then '16_OR_YOUNGER'
    when p_age_years = 17 then '17'
    when p_age_years = 18 then '18'
    when p_age_years <= 22 then '19_TO_22'
    else '23_OR_OLDER'
  end
$$;

-- ===========================================================================
-- 2. REVIEWED RESEARCH DATA (scripts/mlb/identity-sql-values.mjs output)
-- ===========================================================================

create temporary table _m020_ids (slug text, mlb_id bigint, mlb_id_basis text, bref_id text, fangraphs_id text) on commit drop;
insert into _m020_ids values
{{ids}};

create temporary table _m020_bio (
  slug text, canonical_name text, rename_full_name boolean, canonical_name_source text, mlb_full_name text,
  birth_date date, birth_city text, birth_state_province text, birth_country text, raw_birth_country text,
  bats text, throws text, height_in numeric, weight_lb numeric, current_position text, mlb_debut_date date, identity_url text
) on commit drop;
insert into _m020_bio values
{{bio}};

create temporary table _m020_positions (slug text, signing_year int, position_at_signing text, transaction_date date, transaction_url text) on commit drop;
insert into _m020_positions values
{{positions}};

create temporary table _m020_resolutions (
  slug text, id_system text, external_id text, status text, method text, confidence text,
  signals text[], candidates jsonb, query jsonb, source_url text, note text
) on commit drop;
insert into _m020_resolutions values
{{resolutions}};

create temporary table _m020_sources (url text, retrieved_at timestamptz, kind text) on commit drop;
insert into _m020_sources values
{{sources}};

create temporary table _m020_aliases (slug text, alias text, alias_type text, source_url text) on commit drop;
insert into _m020_aliases values
{{aliases}};
delete from _m020_aliases where slug = '__none__';

-- ===========================================================================
-- 3. SOURCES (accessed_at = retrieval time)
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, accessed_at, notes, source_tier)
select
  case s.kind when 'BREF_WAR_DATA_FILE' then 'Baseball-Reference' else 'MLB Stats API' end,
  case s.kind
    when 'MLB_PLAYER_IDENTITY' then 'MLB_PERSON_RECORD'
    when 'MLB_PLAYER_TRANSACTIONS' then 'MLB_TRANSACTION_LOG'
    when 'MLB_TEAM_TRANSACTIONS' then 'MLB_TRANSACTION_LOG'
    else 'WAR_DATA_FILE'
  end,
  case s.kind
    when 'MLB_PLAYER_IDENTITY' then 'MLB player identity record: ' || coalesce(b.mlb_full_name, s.url)
    when 'MLB_PLAYER_TRANSACTIONS' then 'MLB transaction history'
    when 'MLB_TEAM_TRANSACTIONS' then 'MLB club transaction log: ' || substring(s.url from 'startDate=([0-9-]+)') || ' to ' || substring(s.url from 'endDate=([0-9-]+)')
    when 'BREF_WAR_DATA_FILE' then 'Baseball-Reference WAR data: ' || regexp_replace(s.url, '^.*/', '')
  end,
  s.url, s.retrieved_at,
  case s.kind
    when 'MLB_PLAYER_IDENTITY' then 'MLB person record with cross-reference ids (birth data, bats/throws, height/weight, position, Lahman and FanGraphs ids).'
    when 'BREF_WAR_DATA_FILE' then 'Maps MLB ids (mlb_ID) to Baseball-Reference ids (player_ID).'
  end,
  public.disi_infer_source_tier(s.url, null)
from _m020_sources s
left join _m020_bio b on b.identity_url = s.url
on conflict (url) do nothing;

-- ===========================================================================
-- 4. IDENTIFIERS (fill NULLs; never take an id another player holds)
-- ===========================================================================

-- Differences from an existing id are recorded, never overwritten.
insert into public.research_source_conflicts (
  conflict_key, conflict_type, player_id, field_name, value_a, value_b, source_b_id, status, note
)
select 'IDENTITY:' || f.field || ':' || p.slug, 'IDENTITY', p.id, f.field, f.current_value, f.new_value,
       (select src.id from public.sources src where src.url = b.identity_url),
       'UNRESOLVED', 'Existing identifier kept; the 020 identity research found a different value.'
from _m020_ids i
join public.players p on p.slug = i.slug
left join _m020_bio b on b.slug = i.slug
cross join lateral (values
  ('mlb_id', p.mlb_id::text, i.mlb_id::text),
  ('bref_id', p.bref_id, i.bref_id),
  ('fangraphs_id', p.fangraphs_id, i.fangraphs_id)
) f(field, current_value, new_value)
where f.current_value is not null and f.new_value is not null and f.current_value <> f.new_value
on conflict (conflict_key) do nothing;

-- An identifier already held by another player is a collision: recorded, not applied.
insert into public.research_source_conflicts (
  conflict_key, conflict_type, player_id, field_name, value_a, value_b, status, note
)
select 'IDENTITY_COLLISION:' || f.field || ':' || p.slug, 'IDENTITY', p.id, f.field, o.slug, f.new_value,
       'UNRESOLVED', 'Identifier already belongs to another DISI player (value_a); not applied. Players are never merged automatically.'
from _m020_ids i
join public.players p on p.slug = i.slug
cross join lateral (values ('mlb_id', i.mlb_id::text), ('bref_id', i.bref_id), ('fangraphs_id', i.fangraphs_id)) f(field, new_value)
join public.players o on o.id <> p.id and (
  (f.field = 'mlb_id' and o.mlb_id::text = f.new_value) or
  (f.field = 'bref_id' and o.bref_id = f.new_value) or
  (f.field = 'fangraphs_id' and o.fangraphs_id = f.new_value))
where f.new_value is not null
on conflict (conflict_key) do nothing;

update public.players p
set mlb_id = i.mlb_id
from _m020_ids i
where p.slug = i.slug and p.mlb_id is null
  and not exists (select 1 from public.players o where o.mlb_id = i.mlb_id);

update public.players p
set bref_id = i.bref_id
from _m020_ids i
where p.slug = i.slug and p.bref_id is null and i.bref_id is not null and p.mlb_id = i.mlb_id
  and not exists (select 1 from public.players o where o.bref_id = i.bref_id);

update public.players p
set fangraphs_id = i.fangraphs_id
from _m020_ids i
where p.slug = i.slug and p.fangraphs_id is null and i.fangraphs_id is not null and p.mlb_id = i.mlb_id
  and not exists (select 1 from public.players o where o.fangraphs_id = i.fangraphs_id);

-- ===========================================================================
-- 5. NAMES AND ALIASES
-- ===========================================================================

-- Previous spellings and MLB record names (alias rows first, so no spelling is lost).
insert into public.player_aliases (player_id, alias, alias_type, source_id)
select p.id, a.alias, a.alias_type, src.id
from _m020_aliases a
join public.players p on p.slug = a.slug
left join public.sources src on src.url = a.source_url
where a.alias is distinct from p.full_name or a.alias_type = 'PREVIOUS_DISI_SPELLING'
on conflict (player_id, alias) do nothing;

-- Accent-only respelling: same letters, same slug. Guarded again here.
update public.players p
set full_name = b.canonical_name
from _m020_bio b
join _m020_ids i on i.slug = b.slug
where p.slug = b.slug and b.rename_full_name and p.mlb_id = i.mlb_id
  and p.full_name <> b.canonical_name
  and public.disi_ascii_fold(p.full_name) = public.disi_ascii_fold(b.canonical_name)
  and exists (select 1 from public.player_aliases a where a.player_id = p.id and a.alias = p.full_name);

update public.players p
set canonical_name = b.canonical_name
from _m020_bio b
join _m020_ids i on i.slug = b.slug
where p.slug = b.slug and p.mlb_id = i.mlb_id
  and p.canonical_name is distinct from b.canonical_name
  and (p.canonical_name is null or public.disi_ascii_fold(p.canonical_name) = public.disi_ascii_fold(b.canonical_name));

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'player', p.id, 'canonical_name', src.id, 'HIGH',
       'Accented spelling from ' || replace(initcap(b.canonical_name_source), '_', '-')
       || '; previous DISI spelling kept as an alias.'
from _m020_bio b
join public.players p on p.slug = b.slug and p.full_name = b.canonical_name
join public.sources src on src.url = case when b.canonical_name_source = 'BASEBALL_REFERENCE'
  then 'https://www.baseball-reference.com/data/war_daily_bat.txt' else b.identity_url end
where b.rename_full_name
  and not exists (select 1 from public.evidence e where e.entity_type = 'player' and e.entity_id = p.id
                  and e.field_name = 'canonical_name' and e.source_id = src.id);

-- ===========================================================================
-- 6. BIOGRAPHY (fill NULLs; disagreements recorded; evidence per field)
-- ===========================================================================

-- Disagreements with existing values (kept) unless the same field already has
-- an open conflict.
insert into public.research_source_conflicts (
  conflict_key, conflict_type, player_id, field_name, value_a, value_b, source_b_id, status, note
)
select 'BIO:' || f.field || ':' || p.slug, f.conflict_type, p.id, f.field, f.current_value, f.new_value, src.id,
       'UNRESOLVED', 'Existing DISI value kept; the MLB person record differs.'
from _m020_bio b
join _m020_ids i on i.slug = b.slug
join public.players p on p.slug = b.slug and p.mlb_id = i.mlb_id
join public.sources src on src.url = b.identity_url
cross join lateral (values
  ('birth_date', 'BIRTH_DATE', p.birth_date::text, b.birth_date::text),
  ('birth_country', 'BIRTH_COUNTRY', p.birth_country, b.birth_country),
  ('bats', 'HANDEDNESS', p.bats, b.bats),
  ('throws', 'HANDEDNESS', p.throws, b.throws)
) f(field, conflict_type, current_value, new_value)
where f.current_value is not null and f.new_value is not null and f.current_value <> f.new_value
  and not exists (select 1 from public.research_source_conflicts c
                  where c.player_id = p.id and c.field_name = f.field and c.status = 'UNRESOLVED')
on conflict (conflict_key) do nothing;

-- Birth-country corrections. These legacy birth_country values were seeded
-- with the player's signing country (the class / signing source), which
-- supports signings.country_market, not a birthplace. No evidence row ever
-- supported them as birth countries. Each is replaced only when the MLB person
-- record gives the corrected value; the signing market is not touched, and the
-- conflict row keeps the legacy value (value_a) with the reason.
create temporary table _m020_birth_corrections (
  slug text, legacy_value text, corrected_value text, conflict_key text, resolution text
) on commit drop;
insert into _m020_birth_corrections values
('josue-de-paula', 'Dominican Republic', 'United States', 'BIO:birth_country:josue-de-paula',
 'Corrected to United States: the MLB person record gives Brooklyn, NY. The legacy value was his signing country; he moved to the Dominican Republic and signed out of it, which stays as the signing market.'),
('damaso-marte-jr', 'Dominican Republic', 'United States', 'BIO:birth_country:damaso-marte-jr',
 'Corrected to United States: the MLB person record gives Orlando, FL. The legacy value was his signing country; he was signed from the Dominican Republic, which stays as the signing market.'),
('isaac-barreto', 'Colombia', 'Venezuela', 'BIO:birth_country:isaac-barreto',
 'Corrected to Venezuela: the MLB person record gives Maracaibo, Venezuela. Colombia comes from the Dodgers 2021 class release, which lists his signing country; it stays as the signing market.'),
('luciano-romero', 'Venezuela', 'Dominican Republic', 'BIO:birth_country:luciano-romero',
 'Corrected to Dominican Republic: the MLB person record gives La Romana, Dominican Republic. Venezuela comes from the 2022 class list and stays as the signing market.'),
('joseph-deng-thon', 'South Sudan', 'Sudan', 'BIRTH_COUNTRY:deng-thon',
 'Birth country set to the literal value on the MLB person record: Juba, Sudan. He was born 2007-08-05, before South Sudan''s independence (2011-07-09), so Sudan is the country of birth as recorded; Juba is in present-day South Sudan. Club and class sources describe him as South Sudanese (the first South Sudanese player signed professionally); South Sudan stays as the signing market. Nationality is not recorded because no source states it as such.');

update public.players p
set birth_country = c.corrected_value
from _m020_birth_corrections c
join _m020_bio b on b.slug = c.slug
where p.slug = c.slug and p.birth_country = c.legacy_value and b.birth_country = c.corrected_value;

update public.research_source_conflicts r
set status = 'RESOLVED', resolution = c.resolution
from _m020_birth_corrections c
join public.players p on p.slug = c.slug
where r.conflict_key = c.conflict_key and r.status = 'UNRESOLVED' and p.birth_country = c.corrected_value;

-- The 2022 market conflict was birth country vs signing market: two facts, both now recorded.
update public.research_source_conflicts r
set status = 'RESOLVED',
    resolution = 'Different fields, not a disagreement: birth country Dominican Republic (MLB person record) and signing market Venezuela (2022 class list).'
from public.players p
where r.conflict_key = 'MARKET:luciano-romero-2022' and r.status = 'UNRESOLVED'
  and p.slug = 'luciano-romero' and p.birth_country = 'Dominican Republic';

update public.players p
set birth_date = coalesce(p.birth_date, b.birth_date),
    birth_city = coalesce(p.birth_city, b.birth_city),
    birth_state_province = coalesce(p.birth_state_province, b.birth_state_province),
    birth_country = coalesce(p.birth_country, b.birth_country),
    bats = coalesce(p.bats, b.bats),
    throws = coalesce(p.throws, b.throws),
    height_in = coalesce(p.height_in, b.height_in),
    weight_lb = coalesce(p.weight_lb, b.weight_lb),
    current_position = coalesce(p.current_position, b.current_position),
    mlb_debut_date = coalesce(p.mlb_debut_date, b.mlb_debut_date)
from _m020_bio b
join _m020_ids i on i.slug = b.slug
where p.slug = b.slug and p.mlb_id = i.mlb_id;

-- Evidence: one row per field the MLB person record supports AND that agrees
-- with the stored value. Identifier evidence names its own source.
insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'player', p.id, f.field, src.id, 'VERIFIED',
       'MLB person record (MLB id ' || p.mlb_id || ')' || coalesce(f.note, '') || '.'
from _m020_bio b
join _m020_ids i on i.slug = b.slug
join public.players p on p.slug = b.slug and p.mlb_id = i.mlb_id
join public.sources src on src.url = b.identity_url
cross join lateral (values
  ('mlb_id', true, null),
  ('birth_date', b.birth_date = p.birth_date, null),
  ('birth_city', b.birth_city = p.birth_city, null),
  ('birth_state_province', b.birth_state_province = p.birth_state_province, null),
  ('birth_country', b.birth_country = p.birth_country,
     concat(case when b.raw_birth_country <> b.birth_country then ': birthCountry "' || b.raw_birth_country || '"' end,
            (select '; replaces legacy value "' || c.legacy_value || '", which was the signing country (kept as signing market)'
               from _m020_birth_corrections c where c.slug = b.slug))),
  ('bats', b.bats = p.bats, null),
  ('throws', b.throws = p.throws, null),
  ('height_in', b.height_in = p.height_in, null),
  ('weight_lb', b.weight_lb = p.weight_lb, ' (weight as listed at retrieval)'),
  ('current_position', b.current_position = p.current_position, ' (position as of retrieval)'),
  ('mlb_debut_date', b.mlb_debut_date = p.mlb_debut_date, null),
  ('fangraphs_id', i.fangraphs_id = p.fangraphs_id, ': FanGraphs cross-reference id')
) f(field, agrees, note)
where f.agrees
  and not exists (select 1 from public.evidence e where e.entity_type = 'player' and e.entity_id = p.id
                  and e.field_name = f.field and e.source_id = src.id);

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'player', p.id, 'bref_id', src.id, coalesce(r.confidence, 'HIGH')::public.confidence_level,
       'Baseball-Reference WAR data file maps mlb_ID ' || p.mlb_id || ' to ' || p.bref_id
       || coalesce(' (' || array_to_string(r.signals, ', ') || ')', '') || '.'
from _m020_ids i
join public.players p on p.slug = i.slug and p.bref_id = i.bref_id
join _m020_resolutions r on r.slug = i.slug and r.id_system = 'BASEBALL_REFERENCE'
join public.sources src on src.url = r.source_url
where not exists (select 1 from public.evidence e where e.entity_type = 'player' and e.entity_id = p.id
                  and e.field_name = 'bref_id' and e.source_id = src.id);

-- The person-record debut date must agree with an audited outcome's debut date.
insert into public.research_source_conflicts (
  conflict_key, conflict_type, player_id, field_name, value_a, source_a_id, value_b, source_b_id, status, note
)
select 'BIO:mlb_debut_date:' || p.slug, 'OUTCOME', p.id, 'mlb_debut_date', oc.mlb_debut_date::text, oc.source_id,
       p.mlb_debut_date::text, src.id, 'UNRESOLVED', 'Outcome record and MLB person record give different debut dates; the outcome record is kept.'
from public.players p
join public.outcomes oc on oc.player_id = p.id
join _m020_bio b on b.slug = p.slug
join public.sources src on src.url = b.identity_url
where oc.mlb_debut_date is not null and p.mlb_debut_date is not null and oc.mlb_debut_date <> p.mlb_debut_date
on conflict (conflict_key) do nothing;

-- ===========================================================================
-- 7. POSITION AT SIGNING (from the club's signing transaction)
-- ===========================================================================

update public.signings s
set position_at_signing = ps.position_at_signing,
    position_at_signing_source_id = src.id
from _m020_positions ps
join public.players p on p.slug = ps.slug
join public.sources src on src.url = ps.transaction_url
where s.player_id = p.id and s.signing_year = ps.signing_year
  and s.position_at_signing is null
  and (select count(*) from public.signings x where x.player_id = p.id and x.signing_year = ps.signing_year) = 1;

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, 'position_at_signing', s.position_at_signing_source_id, 'VERIFIED',
       'Position named on the ' || ps.transaction_date || ' signing transaction.'
from _m020_positions ps
join public.players p on p.slug = ps.slug
join public.signings s on s.player_id = p.id and s.signing_year = ps.signing_year
  and s.position_at_signing = ps.position_at_signing
where s.position_at_signing_source_id is not null
  and not exists (select 1 from public.evidence e where e.entity_type = 'signing' and e.entity_id = s.id
                  and e.field_name = 'position_at_signing');

-- ===========================================================================
-- 8. IDENTITY RESOLUTION RECORDS (never overwritten on rerun)
-- ===========================================================================

insert into public.player_identity_resolutions (
  player_id, id_system, external_id, status, method, confidence, signals, candidates, query, source_id, decided_on, note
)
select p.id, r.id_system, r.external_id, r.status, r.method, r.confidence::public.confidence_level,
       coalesce(r.signals, array[]::text[]), r.candidates, r.query, src.id, date '2026-10-05', r.note
from _m020_resolutions r
join public.players p on p.slug = r.slug
left join public.sources src on src.url = r.source_url
on conflict (player_id, id_system) do nothing;

-- A resolved id that could not be applied (collision / existing different id)
-- is not shown as resolved.
update public.player_identity_resolutions r
set status = 'CONFLICT',
    note = concat_ws(' ', r.note, 'Not applied: see research_source_conflicts.')
from public.players p
where p.id = r.player_id and r.status = 'RESOLVED'
  and ((r.id_system = 'MLB' and p.mlb_id::text is distinct from r.external_id)
    or (r.id_system = 'BASEBALL_REFERENCE' and p.bref_id is distinct from r.external_id)
    or (r.id_system = 'FANGRAPHS' and p.fangraphs_id is distinct from r.external_id));

-- ===========================================================================
-- 9. MANUAL DECISIONS
-- ===========================================================================

update public.research_source_conflicts
set note = 'Club and class sources say South Sudan; the MLB person record says Juba, Sudan. He was born '
        || '2007-08-05, before South Sudan''s independence (2011-07-09), so "Sudan" describes the state at birth and '
        || '"South Sudan" the country today: not a data error on either side. birth_country holds the literal '
        || 'birth-record value (Sudan); South Sudan is the signing market.'
where conflict_key = 'BIRTH_COUNTRY:deng-thon';

-- Birth-country corrections and the Hyo-Jun Park / Hoy Park link are documented
-- in section 6 and in database/research/020/README.md (identity-decisions.json).

-- ===========================================================================
-- 10. VIEWS
-- ===========================================================================

{{views}}

commit;
