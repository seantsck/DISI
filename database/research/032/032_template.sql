-- DISI v0.23
-- 032_player_value_organizational_realization.sql
-- Player value and organizational realization: team-season bWAR facts and the derived views that separate a
-- player's career outcome from the value realized by the Dodgers. Run after 031.
--
-- Built from database/research/032/ (war-seed.json, scope-config.json, audit.mjs, build.mjs).
--
-- What this is. A factual layer plus derived views. The facts are Baseball-Reference team-season bWAR rows
-- (one row per player, season, team, stint and BAT / PITCH component). Everything else is derived. No dollar
-- valuation, no speculative weights, no downstream chain beyond one transaction hop, and no value is attributed
-- to trainers, academies or programs.
--
-- What it does:
--   * Adds player_mlb_team_season_war (bWAR only; BAT and PITCH kept apart; ACTIVE / RETRACTED lifecycle with
--     supersession; a row whose team code cannot be mapped stays visible with organization_id NULL).
--   * Adds bref_team_code_map (Baseball-Reference franchise code -> DISI organization, with season ranges).
--   * Adds transaction_event_assets.bref_id (nullable) so an incoming trade-return player can join team-season
--     WAR without a DISI players row.
--   * Loads 754 team-season rows for the 47 verified MLB-reached Dodgers signings and the three modeled return
--     assets (Josh Fields, Tony Watson, Manny Machado) from the two Baseball-Reference WAR data files.
--   * Reconciles the legacy career-WAR stores against the loaded facts (Carlos Frias, Roger Cedeno: outcomes
--     career_war backfilled; Eddys Leonard: CAREER_BWAR observation added). Only values the new facts prove.
--   * Adds four views: v_trade_realization_edges, v_player_organizational_realization,
--     v_dodgers_international_value_portfolio and v_value_research_queue. All security_invoker, SELECT-only.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA (database/research/032/war-seed.json)
-- ===========================================================================

create temporary table _m032 on commit drop as
select $m032${{payload_json}}$m032$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
declare
  p jsonb;
  n int;
begin
  if to_regclass('public.v_signing_acquisition_financials') is null or to_regclass('public.signing_financial_resolutions') is null then
    raise exception '032: Migration 031 has not been applied';
  end if;
  for p in select x from _m032, jsonb_array_elements(j -> 'source_urls') x loop
    if not exists (select 1 from public.sources where url = p #>> '{}') then
      raise exception '032: the Baseball-Reference data file source % is not registered', p #>> '{}';
    end if;
  end loop;
  -- every return asset exists once and is a PLAYER on the INCOMING side
  for p in select x from _m032, jsonb_array_elements(j -> 'return_assets') x loop
    select count(*) into n from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
    where e.event_key = p ->> 'event_key' and a.asset_name = p ->> 'asset_name' and a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER';
    if n <> 1 then
      raise exception '032: return asset % (%) was not found once', p ->> 'asset_name', p ->> 'event_key';
    end if;
  end loop;
  -- every organization the team-code map names exists
  for p in select x from _m032, jsonb_array_elements(j -> 'team_map') x loop
    if not exists (select 1 from public.organizations where abbreviation = p ->> 'organization') then
      raise exception '032: organization % of team code % does not exist', p ->> 'organization', p ->> 'code';
    end if;
  end loop;
  -- every scoped DISI player exists and carries the bref_id the rows will join on
  select count(*) into n from public.outcome_audits a join public.players pl on pl.id = a.player_id where a.reached_mlb_verified and pl.bref_id is null;
  if n <> 0 then
    raise exception '032: % verified MLB-reached player(s) lack a bref_id', n;
  end if;
end $$;

-- ===========================================================================
-- 2. SCHEMA
-- ===========================================================================

create table if not exists public.bref_team_code_map (
  id uuid primary key default gen_random_uuid(),
  bref_team_code text not null check (bref_team_code ~ '^[A-Z]{2,3}$'),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  from_season int not null check (from_season between 1871 and 2100),
  to_season int check (to_season is null or (to_season between 1871 and 2100 and to_season >= from_season)),
  note text,
  created_at timestamptz not null default now(),
  unique (bref_team_code, from_season)
);

create table if not exists public.player_mlb_team_season_war (
  id uuid primary key default gen_random_uuid(),
  bref_id text not null check (bref_id ~ '^[a-z0-9]+$'),
  mlb_id text check (mlb_id is null or mlb_id ~ '^[0-9]+$'),
  player_id uuid references public.players(id) on delete restrict,
  season int not null check (season between 1871 and 2100),
  bref_team_code text not null check (bref_team_code ~ '^[A-Z]{2,3}$'),
  organization_id uuid references public.organizations(id) on delete restrict,
  stint_ordinal int not null check (stint_ordinal >= 1),
  component text not null check (component in ('BAT', 'PITCH')),
  war numeric(7,2),
  games int check (games is null or games >= 0),
  plate_appearances int check (plate_appearances is null or plate_appearances >= 0),
  ip_outs int check (ip_outs is null or ip_outs >= 0),
  league text,
  war_system text not null default 'BWAR' check (war_system = 'BWAR'),
  source_id uuid not null references public.sources(id) on delete restrict,
  observed_through_date date not null,
  observed_through_season int not null check (observed_through_season between 1871 and 2100),
  retrieved_at timestamptz not null,
  confidence public.confidence_level not null,
  note text check (note is null or char_length(note) <= 300),
  record_status text not null default 'ACTIVE' check (record_status in ('ACTIVE', 'RETRACTED')),
  supersedes_record_id uuid references public.player_mlb_team_season_war(id) on delete restrict,
  retracted_at timestamptz,
  retraction_reason text,
  created_at timestamptz not null default now(),
  constraint player_mlb_team_season_war_season_observed_check check (season <= observed_through_season),
  constraint player_mlb_team_season_war_supersedes_check check (supersedes_record_id is null or supersedes_record_id <> id),
  constraint player_mlb_team_season_war_retraction_check check ((record_status = 'RETRACTED') = (retracted_at is not null)
    and (record_status = 'ACTIVE' or nullif(btrim(retraction_reason), '') is not null)
    and (record_status = 'RETRACTED' or retraction_reason is null))
);
-- deterministic uniqueness: one ACTIVE row per player identity, season, team, stint and component
create unique index if not exists player_mlb_team_season_war_active_key on public.player_mlb_team_season_war
  (bref_id, season, bref_team_code, stint_ordinal, component) where record_status = 'ACTIVE';
create unique index if not exists player_mlb_team_season_war_supersedes_key on public.player_mlb_team_season_war (supersedes_record_id)
  where supersedes_record_id is not null;
create index if not exists player_mlb_team_season_war_bref_idx on public.player_mlb_team_season_war (bref_id);
create index if not exists player_mlb_team_season_war_player_idx on public.player_mlb_team_season_war (player_id) where player_id is not null;

alter table public.transaction_event_assets add column if not exists bref_id text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.transaction_event_assets'::regclass and conname = 'transaction_event_assets_bref_id_check') then
    alter table public.transaction_event_assets add constraint transaction_event_assets_bref_id_check
      check (bref_id is null or (bref_id ~ '^[a-z0-9]+$' and asset_type = 'PLAYER'));
  end if;
end $$;

comment on table public.bref_team_code_map is
  'Baseball-Reference franchise / team code -> DISI organization with the seasons the code is used. A code can name a different DISI organization row over time only where the franchise did (e.g. BRO and LAD both resolve to the Dodgers franchise). A loaded row whose code has no mapping keeps organization_id NULL and is queued as TEAM_HISTORY_UNRESOLVED.';
comment on table public.player_mlb_team_season_war is
  'Baseball-Reference bWAR by player, season, team and stint, BAT and PITCH components stored separately (a derived view sums them). bWAR only: fWAR and any other WAR system are never mixed in. war NULL means the file has no WAR for that row (a zero-PA batting row), never zero. Direct Dodgers value is the sum over rows whose organization is the Dodgers franchise; value for any other organization is never credited to Los Angeles. Facts are sealed ACTIVE rows with supersession; nothing is deleted.';
comment on column public.player_mlb_team_season_war.ip_outs is
  'Innings pitched as outs (IPouts in the source file), kept as an integer so no fractional-inning ambiguity is introduced.';
comment on column public.transaction_event_assets.bref_id is
  'Baseball-Reference id of an incoming PLAYER return asset whose identity was verified; lets the asset join team-season WAR without a DISI players row. NULL for cash, future considerations, non-player and unresolved assets.';

create or replace function public.disi_team_season_war_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pred public.player_mlb_team_season_war%rowtype;
  mapped uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'team-season WAR facts are never deleted; retract them instead' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if old.record_status = 'RETRACTED' then
      raise exception 'a RETRACTED team-season WAR fact is sealed (%)', old.id using errcode = '55000';
    end if;
    if new.record_status <> 'RETRACTED'
       or (to_jsonb(new) - 'record_status' - 'retracted_at' - 'retraction_reason') is distinct from (to_jsonb(old) - 'record_status' - 'retracted_at' - 'retraction_reason') then
      raise exception 'an ACTIVE team-season WAR fact is sealed; the only change allowed is retraction (%)', old.id using errcode = '55000';
    end if;
    return new;
  end if;
  if new.record_status <> 'ACTIVE' then
    raise exception 'a new team-season WAR fact starts ACTIVE' using errcode = '55000';
  end if;
  -- the organization must be exactly what the mapping says for that code and season; NULL only where no mapping exists
  select m.organization_id into mapped from public.bref_team_code_map m
  where m.bref_team_code = new.bref_team_code and new.season >= m.from_season and new.season <= coalesce(m.to_season, 9999)
  order by m.from_season desc limit 1;
  if new.organization_id is distinct from mapped then
    raise exception 'organization % does not match the team-code mapping for % in % (expected %)', new.organization_id, new.bref_team_code, new.season, mapped using errcode = '55000';
  end if;
  if new.supersedes_record_id is not null then
    select * into pred from public.player_mlb_team_season_war where id = new.supersedes_record_id;
    if not found or pred.id = new.id or pred.bref_id <> new.bref_id or pred.season <> new.season
       or pred.bref_team_code <> new.bref_team_code or pred.stint_ordinal <> new.stint_ordinal or pred.component <> new.component then
      raise exception 'a correction must supersede an existing fact of the same player, season, team, stint and component (%)', new.supersedes_record_id using errcode = '55000';
    end if;
    if pred.record_status = 'ACTIVE' then
      update public.player_mlb_team_season_war
        set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'Superseded by a corrected fact.'
      where id = pred.id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_team_season_war_guard() from public, anon, authenticated;

drop trigger if exists player_mlb_team_season_war_guard on public.player_mlb_team_season_war;
create trigger player_mlb_team_season_war_guard
before insert or update or delete on public.player_mlb_team_season_war
for each row execute function public.disi_team_season_war_guard();

do $$
declare t text;
begin
  foreach t in array array['bref_team_code_map', 'player_mlb_team_season_war'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists public_read_%I on public.%I', t, t);
    execute format('create policy public_read_%I on public.%I for select to anon, authenticated using (true)', t, t);
  end loop;
end $$;

-- ===========================================================================
-- 3. TEAM-CODE MAP, TEAM-SEASON FACTS, RETURN-ASSET IDENTITIES
-- ===========================================================================

insert into public.bref_team_code_map (bref_team_code, organization_id, from_season, to_season, note)
select x ->> 'code', o.id, (x ->> 'from')::int, (x ->> 'to')::int, x ->> 'note'
from _m032, jsonb_array_elements(j -> 'team_map') x
join public.organizations o on o.abbreviation = x ->> 'organization'
on conflict (bref_team_code, from_season) do nothing;

insert into public.player_mlb_team_season_war (bref_id, mlb_id, player_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games,
  plate_appearances, ip_outs, league, source_id, observed_through_date, observed_through_season, retrieved_at, confidence, note)
select r ->> 0, r ->> 1, pl.id, (r ->> 2)::int, r ->> 3, m.organization_id, (r ->> 4)::int, r ->> 5, nullif(r ->> 7, '')::numeric, nullif(r ->> 8, '')::int,
       nullif(r ->> 9, '')::int, nullif(r ->> 10, '')::int, nullif(r ->> 6, ''), so.id,
       (j ->> 'observed_through_date')::date, (j ->> 'observed_through_season')::int, (j ->> 'retrieved_at')::timestamptz, 'VERIFIED',
       case when r ->> 7 is null then 'The data file has no WAR for this zero-plate-appearance row; stored as NULL, not zero.' end
from _m032 cross join lateral jsonb_array_elements(j -> 'rows') r
join public.sources so on so.url = case when r ->> 5 = 'BAT' then j ->> 'bat_url' else j ->> 'pitch_url' end
left join public.players pl on pl.bref_id = r ->> 0
left join lateral (
  select m2.organization_id from public.bref_team_code_map m2
  where m2.bref_team_code = r ->> 3 and (r ->> 2)::int >= m2.from_season and (r ->> 2)::int <= coalesce(m2.to_season, 9999)
  order by m2.from_season desc limit 1
) m on true
on conflict (bref_id, season, bref_team_code, stint_ordinal, component) where record_status = 'ACTIVE' do nothing;

do $$
declare
  p jsonb;
begin
  for p in select x from _m032, jsonb_array_elements(j -> 'return_assets') x loop
    update public.transaction_event_assets a set bref_id = p ->> 'bref_id'
    from public.transaction_events e
    where a.event_id = e.id and e.event_key = p ->> 'event_key' and a.asset_name = p ->> 'asset_name' and a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER'
      and a.bref_id is null;
    if not exists (select 1 from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
                   where e.event_key = p ->> 'event_key' and a.asset_name = p ->> 'asset_name' and a.bref_id = p ->> 'bref_id') then
      raise exception '032: return asset % carries a different bref_id', p ->> 'asset_name';
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 4. LEGACY CAREER-WAR STORES: reconcile only what the loaded facts prove
-- ===========================================================================
-- Legacy stores keep one decimal (Baseball-Reference's displayed career total). A value is written only where
-- the store is empty and the loaded team-season rows round to exactly the reviewed value.

do $$
declare
  b jsonb;
  pid uuid;
  total numeric;
  src uuid;
  n int;
begin
  for b in select x from _m032, jsonb_array_elements(j -> 'backfills') x loop
    select id into pid from public.players where slug = b ->> 'slug';
    select round(sum(w.war), 1) into total from public.player_mlb_team_season_war w
    where w.player_id = pid and w.record_status = 'ACTIVE' and w.war_system = 'BWAR';
    if pid is null or total is distinct from (b ->> 'expected')::numeric then
      raise exception '032: the loaded rows for % total % but % was reviewed', b ->> 'slug', total, b ->> 'expected';
    end if;
    select id into src from public.sources where url = (select j ->> 'bat_url' from _m032);
    if b ->> 'store' = 'OUTCOMES_CAREER_WAR' then
      update public.outcomes set career_war = total where player_id = pid and career_war is null;
      get diagnostics n = row_count;
      if n = 1 or exists (select 1 from public.outcomes where player_id = pid and career_war = total) then
        insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
        select 'player', pid, 'career_war', src, 'VERIFIED',
               'Career bWAR is the sum of the player''s Baseball-Reference batting and pitching team-season WAR rows in the data files, rounded to one decimal.'
        where not exists (select 1 from public.evidence where entity_type = 'player' and entity_id = pid and field_name = 'career_war' and source_id = src);
      else
        raise exception '032: outcomes.career_war for % holds a different value', b ->> 'slug';
      end if;
    elsif b ->> 'store' = 'METRIC_CAREER_BWAR' then
      insert into public.player_metric_observations (player_id, metric_key, value, observed_through_date, observed_through_season, source_id, confidence, notes)
      select pid, 'CAREER_BWAR', total, (j ->> 'observed_through_date')::date, (j ->> 'observed_through_season')::int, src, 'VERIFIED',
             'Sum of the Baseball-Reference batting and pitching team-season WAR rows, rounded to one decimal.'
      from _m032
      where not exists (select 1 from public.player_metric_observations where player_id = pid and metric_key = 'CAREER_BWAR');
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 5. VIEWS
-- ===========================================================================

{{views}}

-- ===========================================================================
-- 6. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['bref_team_code_map', 'player_mlb_team_season_war', 'v_trade_realization_edges', 'v_player_organizational_realization',
    'v_dodgers_international_value_portfolio', 'v_value_research_queue'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

do $$
declare
  bad text;
  n int;
  expected int;
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
    raise exception '032: API roles hold privileges beyond SELECT: %', bad;
  end if;

  select jsonb_array_length(j -> 'rows') into expected from _m032;
  select count(*) into n from public.player_mlb_team_season_war w
  where w.record_status = 'ACTIVE' and exists (select 1 from _m032, jsonb_array_elements(j -> 'rows') r
    where r ->> 0 = w.bref_id and (r ->> 2)::int = w.season and r ->> 3 = w.bref_team_code and (r ->> 4)::int = w.stint_ordinal and r ->> 5 = w.component);
  if n <> expected then
    raise exception '032 postcondition: % of % reviewed team-season rows are present', n, expected;
  end if;
  -- every loaded row resolves to an organization (the seed was audited complete)
  select count(*) into n from public.player_mlb_team_season_war where organization_id is null and record_status = 'ACTIVE';
  if n <> 0 then
    raise exception '032 postcondition: % loaded row(s) have no organization', n;
  end if;
  -- the legacy stores now agree with the loaded facts for every loaded player (one-decimal tolerance)
  select count(*) into n from (
    select p.id, sum(w.war) as total, coalesce(m.value, oc.career_war) as legacy
    from public.players p join public.player_mlb_team_season_war w on w.player_id = p.id and w.record_status = 'ACTIVE'
    left join public.outcomes oc on oc.player_id = p.id
    left join lateral (select value from public.player_metric_observations x where x.player_id = p.id and x.metric_key = 'CAREER_BWAR'
                       order by observed_through_date desc limit 1) m on true
    group by p.id, m.value, oc.career_war) t
  where t.legacy is null or abs(t.total - t.legacy) > 0.1;
  if n <> 0 then
    raise exception '032 postcondition: % player(s) have a career total that does not reconcile', n;
  end if;
end $$;

commit;
