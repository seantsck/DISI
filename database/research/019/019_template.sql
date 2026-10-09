-- DISI v0.10
-- 019_mature_outcome_audit_expansion.sql
-- Evidence-based outcome audits for mature Dodgers signings, structured
-- professional-progress records, and outcome research views. Run after 018.
--
-- Built from reviewed research artifacts (database/research/019/), produced by
-- the scripts in scripts/mlb/ against the MLB Stats API and Baseball-Reference's
-- WAR data files. Data retrieved 2026-10-05; audits are "through 2026-10-05".
--
-- Audit policy (scripts/mlb/lib/classify.mjs auditDecision):
--   * A verified MLB debut (MLB person record) is audited for any class.
--   * "No longer in affiliated baseball" (final release / free agency /
--     retirement, or no affiliated appearance for two seasons) is audited only
--     for classes through 2021.
--   * "Active in the minors, no MLB debut" is audited only for classes through 2020.
--   * Insufficient evidence is never audited. Recent / developing players get a
--     progress record, not an outcome.
--   * Every audit with reached_mlb_verified = false must have outcome evidence
--     (enforced by a deferred constraint trigger).
--   * bWAR rows cite Baseball-Reference (the 017 provider trigger still applies).
--
-- Existing audits are never overwritten. Rate rules from 018 are unchanged.
-- Rerunnable.

begin;

-- ===========================================================================
-- 1. SCHEMA
-- ===========================================================================

alter table public.outcome_audits add column if not exists outcome_state text;
alter table public.outcome_audits drop constraint if exists outcome_audits_outcome_state_check;
alter table public.outcome_audits add constraint outcome_audits_outcome_state_check check (
  outcome_state is null
  or (reached_mlb_verified and outcome_state = 'REACHED_MLB')
  or (not reached_mlb_verified and outcome_state in (
        'NO_MLB_CAREER_ENDED', 'NO_MLB_ACTIVE_IN_MINORS', 'NO_MLB_STATUS_UNKNOWN'))
);
comment on column public.outcome_audits.outcome_state is
  'REACHED_MLB; NO_MLB_CAREER_ENDED (no longer in affiliated baseball through the audit date); NO_MLB_ACTIVE_IN_MINORS (still playing affiliated ball, no MLB debut yet); NO_MLB_STATUS_UNKNOWN (no MLB debut verified, affiliated status not established).';

-- Structured professional progress. Exists for audited AND developing players;
-- a progress row is never itself an outcome.
create table if not exists public.player_professional_progress (
  player_id uuid primary key references public.players(id) on delete cascade,
  as_of_date date not null,
  mlb_debut_date date,
  mlb_debut_team text,
  last_mlb_season integer,
  highest_level text check (highest_level in ('MLB','AAA','AA','A+','A','A-','ROK')),
  highest_level_season integer,
  last_affiliated_season integer,
  last_affiliated_team text,
  last_affiliated_level text check (last_affiliated_level in ('MLB','AAA','AA','A+','A','A-','ROK')),
  final_transaction_type text,
  final_transaction_date date,
  final_organization text,
  final_transaction_description text,
  disposition text check (disposition in ('RELEASED','FREE_AGENT','RETIRED','ACTIVE','UNKNOWN')),
  active_in_affiliated_ball boolean,
  continued_outside_affiliated boolean,
  research_recommendation text,
  updated_at timestamptz not null default now()
);
comment on column public.player_professional_progress.continued_outside_affiliated is
  'Independent or foreign professional play after leaving affiliated baseball. NULL = not researched.';

-- Field-level provenance for outcome facts.
create table if not exists public.outcome_evidence (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete restrict,
  supports_fields text[] not null check (supports_fields <@ array[
    'MLB_REACH','MLB_DEBUT_DATE','MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL','LAST_AFFILIATED_SEASON',
    'FINAL_TRANSACTION','DISPOSITION','ACTIVE_STATUS','LEGACY_AUDIT']),
  confidence public.confidence_level not null default 'VERIFIED',
  note text,
  created_at timestamptz not null default now(),
  unique (player_id, source_id)
);
create index if not exists outcome_evidence_player_idx on public.outcome_evidence(player_id);

do $$
declare t text;
begin
  foreach t in array array['player_professional_progress', 'outcome_evidence'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'public_read_' || t, t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', 'public_read_' || t, t);
  end loop;
end $$;

-- Existing audits: their cited source becomes outcome evidence (supports MLB_REACH).
insert into public.outcome_evidence (player_id, source_id, supports_fields, confidence, note)
select oa.player_id, oa.source_id, array['MLB_REACH','LEGACY_AUDIT'], oa.confidence, oa.audit_note
from public.outcome_audits oa
where oa.source_id is not null
on conflict (player_id, source_id) do nothing;

-- A verified "did not reach MLB" requires evidence. Deferred so an audit and its
-- evidence can be written in the same transaction, in either order.
create or replace function public.outcome_audits_require_evidence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.reached_mlb_verified = false and not exists (
    select 1 from public.outcome_evidence e
    where e.player_id = new.player_id and 'MLB_REACH' = any(e.supports_fields)
  ) then
    raise exception 'outcome audit for player % says no MLB debut but has no MLB_REACH outcome evidence', new.player_id;
  end if;
  return null;
end;
$$;
revoke execute on function public.outcome_audits_require_evidence() from public, anon, authenticated;

drop trigger if exists outcome_audits_require_evidence on public.outcome_audits;
create constraint trigger outcome_audits_require_evidence
after insert or update on public.outcome_audits
deferrable initially deferred
for each row execute function public.outcome_audits_require_evidence();

-- ===========================================================================
-- 2. REVIEWED RESEARCH DATA (scripts/mlb/outcome-sql-values.mjs output)
-- ===========================================================================

create temporary table _m019_identity (slug text, mlb_id bigint, mlb_full_name text, identity_basis text, identity_note text) on commit drop;
insert into _m019_identity values
{{identity}};

create temporary table _m019_progress (
  slug text, as_of_date date, mlb_debut_date date, mlb_debut_team text, highest_level text, highest_level_season int,
  last_affiliated_season int, last_affiliated_team text, last_affiliated_level text, final_transaction_type text,
  final_transaction_date date, final_organization text, final_transaction_description text, disposition text,
  active_in_affiliated_ball boolean, research_recommendation text, last_mlb_season int, continued_outside_affiliated boolean
) on commit drop;
insert into _m019_progress values
{{progress}};

create temporary table _m019_audits (slug text, reached_mlb boolean, outcome_state text, is_new_audit boolean, evidence_summary text) on commit drop;
insert into _m019_audits values
{{audits}};

create temporary table _m019_sources (slug text, url text, retrieved_at timestamptz, supports_fields text[]) on commit drop;
insert into _m019_sources values
{{sources}};

create temporary table _m019_bwar (slug text, mlb_id bigint, bref_id text, career_bwar numeric, observed_through_season int, bat_url text, pitch_url text, retrieved_at timestamptz) on commit drop;
{{bwar_insert}}

-- ===========================================================================
-- 3. IDENTITY (fill NULL MLB ids; MLB spellings become aliases)
-- ===========================================================================

update public.players p
set mlb_id = i.mlb_id
from _m019_identity i
where p.slug = i.slug
  and p.mlb_id is null
  and not exists (select 1 from public.players o where o.mlb_id = i.mlb_id);

insert into public.sources (source_name, source_type, title, url, accessed_at, source_tier)
select distinct on (s.url)
  'MLB Stats API',
  case
    when s.url ~ '/transactions\?playerId=' then 'MLB_PLAYER_TRANSACTIONS'
    when s.url ~ '/stats\?' then 'MLB_PLAYER_SEASON_STATS'
    else 'MLB_PLAYER_RECORD'
  end,
  case
    when s.url ~ '/transactions\?playerId=' then 'MLB transaction history: '
    when s.url ~ 'leagueListId=milb_all' then 'MiLB season record: '
    when s.url ~ '/stats\?' then 'MLB season record: '
    else 'MLB player record: '
  end || coalesce(i.mlb_full_name, s.slug),
  s.url, s.retrieved_at,
  public.disi_infer_source_tier(s.url, null)
from _m019_sources s
left join _m019_identity i on i.slug = s.slug
order by s.url, s.retrieved_at
on conflict (url) do nothing;

insert into public.player_aliases (player_id, alias, alias_type, source_id)
select p.id, i.mlb_full_name, 'MLB_RECORD_NAME', src.id
from _m019_identity i
join public.players p on p.slug = i.slug
join public.sources src on src.url = 'https://statsapi.mlb.com/api/v1/people/' || i.mlb_id
where i.mlb_full_name is not null and i.mlb_full_name <> p.full_name
on conflict (player_id, alias) do nothing;

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'player', p.id, 'mlb_id', src.id,
       case when i.identity_basis = 'DODGERS_TRANSACTION_MATCH' then 'VERIFIED' else 'HIGH' end::public.confidence_level,
       i.identity_note
from _m019_identity i
join public.players p on p.slug = i.slug and p.mlb_id = i.mlb_id
join public.sources src on src.url = 'https://statsapi.mlb.com/api/v1/people/' || i.mlb_id
where not exists (select 1 from public.evidence e where e.entity_type = 'player' and e.entity_id = p.id
                  and e.field_name = 'mlb_id' and e.source_id = src.id);

-- ===========================================================================
-- 4. PROGRESS AND OUTCOME EVIDENCE
-- ===========================================================================

insert into public.player_professional_progress (
  player_id, as_of_date, mlb_debut_date, mlb_debut_team, last_mlb_season, highest_level, highest_level_season,
  last_affiliated_season, last_affiliated_team, last_affiliated_level, final_transaction_type, final_transaction_date,
  final_organization, final_transaction_description, disposition, active_in_affiliated_ball, continued_outside_affiliated,
  research_recommendation
)
select p.id, g.as_of_date, g.mlb_debut_date, g.mlb_debut_team, g.last_mlb_season, g.highest_level, g.highest_level_season,
       g.last_affiliated_season, g.last_affiliated_team, g.last_affiliated_level, g.final_transaction_type, g.final_transaction_date,
       g.final_organization, g.final_transaction_description, g.disposition, g.active_in_affiliated_ball, g.continued_outside_affiliated,
       g.research_recommendation
from _m019_progress g
join public.players p on p.slug = g.slug
on conflict (player_id) do update set
  as_of_date = excluded.as_of_date, mlb_debut_date = excluded.mlb_debut_date, mlb_debut_team = excluded.mlb_debut_team,
  last_mlb_season = excluded.last_mlb_season, highest_level = excluded.highest_level,
  highest_level_season = excluded.highest_level_season, last_affiliated_season = excluded.last_affiliated_season,
  last_affiliated_team = excluded.last_affiliated_team, last_affiliated_level = excluded.last_affiliated_level,
  final_transaction_type = excluded.final_transaction_type, final_transaction_date = excluded.final_transaction_date,
  final_organization = excluded.final_organization, final_transaction_description = excluded.final_transaction_description,
  disposition = excluded.disposition, active_in_affiliated_ball = excluded.active_in_affiliated_ball,
  continued_outside_affiliated = excluded.continued_outside_affiliated,
  research_recommendation = excluded.research_recommendation;

insert into public.outcome_evidence (player_id, source_id, supports_fields, confidence, note)
select p.id, src.id, s.supports_fields, 'VERIFIED'::public.confidence_level, null
from _m019_sources s
join public.players p on p.slug = s.slug
join public.sources src on src.url = s.url
where cardinality(s.supports_fields) > 0
on conflict (player_id, source_id) do update set supports_fields = excluded.supports_fields;

-- ===========================================================================
-- 5. OUTCOME AUDITS (new audits only; existing audits are never overwritten)
-- ===========================================================================

insert into public.outcome_audits (player_id, audited_through_date, reached_mlb_verified, source_id, confidence, audit_note, outcome_state)
select p.id, g.as_of_date, a.reached_mlb,
       (select src.id from public.sources src where src.url = 'https://statsapi.mlb.com/api/v1/people/' || i.mlb_id),
       case when a.outcome_state = 'NO_MLB_CAREER_ENDED' and g.final_transaction_type is null
            then 'HIGH' else 'VERIFIED' end::public.confidence_level,
       a.evidence_summary || ' (MLB Stats API, through ' || to_char(g.as_of_date, 'YYYY-MM-DD') || '.)',
       a.outcome_state
from _m019_audits a
join public.players p on p.slug = a.slug
join _m019_progress g on g.slug = a.slug
join _m019_identity i on i.slug = a.slug
where a.is_new_audit
on conflict (player_id) do nothing;

-- Existing audits: add the outcome state only (reached flag untouched).
update public.outcome_audits oa
set outcome_state = case when oa.reached_mlb_verified then 'REACHED_MLB' else coalesce(a.outcome_state, 'NO_MLB_STATUS_UNKNOWN') end
from public.players p
left join _m019_audits a on a.slug = p.slug and not a.is_new_audit
where oa.player_id = p.id
  and oa.outcome_state is null;

-- Any existing "no MLB" audit that the new research contradicts is flagged, not changed.
insert into public.research_source_conflicts (conflict_key, conflict_type, player_id, field_name, value_a, value_b, source_b_id, status, note)
select 'OUTCOME:' || p.slug, 'CLASS_MEMBERSHIP', p.id, 'reached_mlb_verified',
       'Existing audit: no MLB debut', 'MLB person record shows an MLB debut on ' || g.mlb_debut_date,
       (select src.id from public.sources src where src.url = 'https://statsapi.mlb.com/api/v1/people/' || i.mlb_id),
       'UNRESOLVED', 'Existing audit left unchanged; review required.'
from public.outcome_audits oa
join public.players p on p.id = oa.player_id
join _m019_progress g on g.slug = p.slug
join _m019_identity i on i.slug = p.slug
where not oa.reached_mlb_verified and g.mlb_debut_date is not null
on conflict (conflict_key) do nothing;

-- ===========================================================================
-- 6. VERIFIED MLB OUTCOMES AND bWAR
-- ===========================================================================

insert into public.outcomes (
  player_id, reached_mlb, mlb_debut_date, mlb_debut_organization_id, current_status, outcome_through_season, source_id, confidence
)
select p.id, true, g.mlb_debut_date, debut.id,
       case when g.last_mlb_season >= extract(year from g.as_of_date)::int
            then 'ACTIVE_MLB_' || g.last_mlb_season else 'LAST_MLB_' || g.last_mlb_season end,
       extract(year from g.as_of_date)::int,
       (select src.id from public.sources src where src.url = 'https://statsapi.mlb.com/api/v1/people/' || i.mlb_id),
       'VERIFIED'
from _m019_audits a
join public.players p on p.slug = a.slug
join _m019_progress g on g.slug = a.slug
join _m019_identity i on i.slug = a.slug
left join public.organizations debut on debut.name = g.mlb_debut_team
where a.is_new_audit and a.reached_mlb
on conflict (player_id) do nothing;

insert into public.sources (source_name, source_type, title, url, accessed_at, notes, source_tier)
select distinct on (u.url) 'Baseball-Reference', 'WAR_DATA_FILE', u.title, u.url, u.retrieved_at,
       'Baseball-Reference WAR data file. Career bWAR = sum of batting and pitching WAR rows for the player''s mlb_ID.',
       'BASEBALL_REFERENCE'
from (
  select bat_url as url, retrieved_at, 'Baseball-Reference WAR data: batting (war_daily_bat.txt)' as title from _m019_bwar
  union all
  select pitch_url, retrieved_at, 'Baseball-Reference WAR data: pitching (war_daily_pitch.txt)' from _m019_bwar
) u
order by u.url, u.retrieved_at
on conflict (url) do nothing;

insert into public.player_metric_observations (
  player_id, metric_key, value, observed_through_date, observed_through_season, source_id, confidence, notes
)
select p.id, 'CAREER_BWAR', b.career_bwar, (b.retrieved_at at time zone 'UTC')::date, b.observed_through_season,
       bat.id, 'VERIFIED',
       'Sum of Baseball-Reference batting and pitching WAR rows for mlb_ID ' || b.mlb_id || ' (' || b.bref_id || '); pitching file: ' || b.pitch_url
from _m019_bwar b
join public.players p on p.slug = b.slug
join public.sources bat on bat.url = b.bat_url
on conflict (player_id, metric_key, observed_through_date) do nothing;

update public.players p
set bref_id = b.bref_id
from _m019_bwar b
where p.slug = b.slug and p.bref_id is null
  and not exists (select 1 from public.players o where o.bref_id = b.bref_id);

-- ===========================================================================
-- 7. VIEWS
-- ===========================================================================

{{views}}

commit;
