-- DISI v0.39
-- 054_full_career_transaction_history.sql
-- Full-career transaction history: a player's moves between clubs other than the Dodgers. Run after 053.
--
-- Built from database/research/054/ (migration-values.json, build.mjs). Do not edit by hand: change the research and rebuild.
--
-- DODGERS ASSET LEDGER != FULL CAREER HISTORY. The canonical transaction ledger (transaction_events, transaction_event_assets) records Dodgers
-- transactions only, from the Dodgers' side, and every asset, package, control-interval and value view reads it as such. A move between two other
-- clubs written there would read as a Dodgers exit. 054 gives those moves their own home:
--   * player_career_transactions: one sourced movement fact about one player, in the player's direction (a trade from one club to another, a
--     release from a club, a free-agent signing by a club, a waiver claim, a purchase). Neither end is ever a Dodgers organization. No package, no
--     return, no value, no attribution. 46 reviewed rows for the 33 open transitions of the 16 transaction-blocked development needs, each stated by
--     the official MLB transaction log or the Retrosheet transaction database with an exact date.
--   * v_player_career_transactions: the player's transaction stream, both layers in his direction, each row labelled DODGERS_LEDGER or
--     CAREER_HISTORY. Read by the dossier and /development for chronology only.
--   * The development research queue reads career history for a move between two other clubs: a direct move, or a release and a later signing
--     (two facts, never one synthetic transaction), between his last game for the first club and his first for the second.
--   CAREER TRANSACTION != DODGERS ASSET TRANSACTION   CAREER MOVE != ASSET PACKAGE   CAREER MOVE != DODGERS CONTROL CHANGE
--   THIRD-PARTY TRADE != DODGERS TRADE   CAREER TRANSACTION != RETURN VALUE   CAREER TRANSACTION != PREDICTION FEATURE
--   ONE KNOWN MOVE != COMPLETE CAREER
-- It adds one table, one view and one product-contract row (the application reads the view), so the executive snapshot's contract count moves:
-- the explicit snapshot refresh runs once, only when a snapshot drifts.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA
-- ===========================================================================

create temporary table _m054 on commit drop as
select $m054${{payload_json}}$m054$::jsonb as j;

create temporary table _m054_before on commit drop as
select
  (select md5(string_agg(t::text, '|' order by t::text)) from (select e::text from public.transaction_events e union all select a::text from public.transaction_event_assets a
     union all select r::text from public.transaction_asset_resolutions r union all select o::text from public.dodgers_control_observations o
     union all select x::text from public.transactions x) t(t)) as ledger_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.player_season_stints t) as stints_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.development_milestones t) as milestones_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.development_progression_decisions t) as decisions_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.outcome_audits t) as audits_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.player_mlb_team_season_war t) as war_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from (select r::text from public.signing_financial_reports r union all select s::text from public.signing_financial_resolutions s) t(t)) as costs_hash
from _m054;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 054 was written for
-- ===========================================================================

do $$
declare
  p jsonb;
  n int;
  k text;
begin
  if to_regclass('public.product_database_status') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null then
    raise exception '054: Migration 045b has not been applied';
  end if;
  -- the 053 view reads the player's asset side (pg_get_viewdef drops comments)
  if position('asset_side' in pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass)) = 0 then
    raise exception '054: Migration 053 has not been applied';
  end if;
  for k in select jsonb_array_elements_text(j -> 'existing_source_urls') from _m054 loop
    if not exists (select 1 from public.sources where url = k) then
      raise exception '054: the source % is missing', k;
    end if;
  end loop;
  select count(*) into n from public.sources s, _m054, jsonb_array_elements(j -> 'sources') x
    where s.url = x ->> 'url' and (s.title is distinct from x ->> 'title' or s.notes is distinct from x ->> 'notes' or s.source_type <> x ->> 'source_type');
  if n > 0 then
    raise exception '054: a source 054 adds already exists with other content';
  end if;
  for p in select y from _m054, jsonb_array_elements(j -> 'events') y loop
    if not exists (select 1 from public.players pl where pl.slug = p ->> 'player_slug') then
      raise exception '054: the player % is missing', p ->> 'player_slug';
    end if;
    for k in select unnest(array[nullif(p ->> 'from', ''), nullif(p ->> 'to', '')]) loop
      if k is not null and not exists (select 1 from public.organizations o where o.abbreviation = k and o.franchise_key is distinct from 'DODGERS') then
        raise exception '054: % is not a non-Dodgers organization (a Dodgers transaction belongs in the Dodgers ledger)', k;
      end if;
    end loop;
  end loop;
  -- a rerun finds exactly the reviewed rows; a first run finds no table
  if to_regclass('public.player_career_transactions') is not null then
    select count(*) into n from public.player_career_transactions c
      where c.event_key not in (select y ->> 'key' from _m054, jsonb_array_elements(j -> 'events') y);
    if n > 0 then
      raise exception '054: player_career_transactions holds % rows outside the reviewed set', n;
    end if;
  end if;
end $$;

-- ===========================================================================
-- 2. THE CAREER-HISTORY TABLE (one sourced movement fact about one player, in his direction)
-- ===========================================================================

create table if not exists public.player_career_transactions (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (event_key ~ '^CAREER_[0-9]{8}_[A-Z_]+_[A-Z]{2,4}_[A-Z]{2,4}_[A-Z0-9_]+$'),
  player_id uuid not null references public.players(id) on delete restrict,
  transaction_date date not null,
  transaction_type text not null check (transaction_type in ('TRADE', 'WAIVER_CLAIM', 'PURCHASE', 'RELEASE', 'FREE_AGENT_SIGNING')),
  from_organization_id uuid references public.organizations(id) on delete restrict,
  to_organization_id uuid references public.organizations(id) on delete restrict,
  historical_label text check (historical_label is null or char_length(btrim(historical_label)) between 1 and 200),
  description text not null check (char_length(btrim(description)) between 1 and 600),
  source_id uuid not null references public.sources(id) on delete restrict,
  source_reference text not null check (source_reference ~ '^(MLB transaction|Retrosheet transaction) [0-9]+$'),
  created_at timestamptz not null default now(),
  -- the mechanism fixes the shape: a move names both clubs; a release has no destination; a signing has no origin
  constraint player_career_transactions_shape_check check (
    (transaction_type in ('TRADE', 'WAIVER_CLAIM', 'PURCHASE') and from_organization_id is not null and to_organization_id is not null and from_organization_id <> to_organization_id)
    or (transaction_type = 'RELEASE' and from_organization_id is not null and to_organization_id is null)
    or (transaction_type = 'FREE_AGENT_SIGNING' and from_organization_id is null and to_organization_id is not null))
);
create unique index if not exists player_career_transactions_fact_key on public.player_career_transactions
  (player_id, transaction_date, transaction_type, coalesce(from_organization_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(to_organization_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists player_career_transactions_player_id_idx on public.player_career_transactions (player_id, transaction_date);
alter table public.player_career_transactions enable row level security;
comment on table public.player_career_transactions is
  'DISI career history (Migration 054): one sourced movement fact about one player between clubs other than the Dodgers, in the player''s direction. Never a Dodgers transaction (those are the Dodgers asset ledger, transaction_events), never a package, a return, a value or an attribution. Chronology evidence only.';
revoke all on table public.player_career_transactions from anon, authenticated;
grant select on table public.player_career_transactions to anon, authenticated;
drop policy if exists public_read_player_career_transactions on public.player_career_transactions;
create policy public_read_player_career_transactions on public.player_career_transactions for select to anon, authenticated using (true);

-- ===========================================================================
-- 3. SOURCES AND THE REVIEWED ROWS
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, notes, source_tier, accessed_at)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'notes', x ->> 'source_tier', (j ->> 'retrieved_at')::timestamptz
from _m054, jsonb_array_elements(j -> 'sources') x
on conflict (url) do nothing;

insert into public.player_career_transactions (event_key, player_id, transaction_date, transaction_type, from_organization_id, to_organization_id, historical_label,
  description, source_id, source_reference)
select x ->> 'key', pl.id, (x ->> 'date')::date, x ->> 'type', fo.id, too.id, nullif(x ->> 'historical_label', ''), x ->> 'description', so.id, x ->> 'source_reference'
from _m054 cross join jsonb_array_elements(j -> 'events') x
join public.players pl on pl.slug = x ->> 'player_slug'
left join public.organizations fo on fo.abbreviation = nullif(x ->> 'from', '')
left join public.organizations too on too.abbreviation = nullif(x ->> 'to', '')
join public.sources so on so.url = x ->> 'source_url'
on conflict (event_key) do nothing;

-- ===========================================================================
-- 4. THE PLAYER'S TRANSACTION STREAM (both layers, in his direction, each labelled)
-- ===========================================================================

create or replace view public.v_player_career_transactions
with (security_invoker = true)
as
select a.player_id, p.slug as player_slug, e.event_key, e.transaction_date, e.transaction_type,
  case when a.asset_side = 'INCOMING' then tor.abbreviation else fo.abbreviation end as from_organization,
  case when a.asset_side = 'INCOMING' then fo.abbreviation else tor.abbreviation end as to_organization,
  'DODGERS_LEDGER'::text as layer, e.historical_label, e.description, src.url as source_url
from public.transaction_event_assets a
join public.transaction_events e on e.id = a.event_id
join public.players p on p.id = a.player_id
left join public.organizations fo on fo.id = e.from_organization_id
left join public.organizations tor on tor.id = e.to_organization_id
left join public.sources src on src.id = coalesce(a.source_id, e.source_id)
where a.player_id is not null and a.asset_type = 'PLAYER'
union all
select c.player_id, p.slug, c.event_key, c.transaction_date, c.transaction_type, fo.abbreviation, tor.abbreviation,
  'CAREER_HISTORY'::text, c.historical_label, c.description, src.url
from public.player_career_transactions c
join public.players p on p.id = c.player_id
left join public.organizations fo on fo.id = c.from_organization_id
left join public.organizations tor on tor.id = c.to_organization_id
left join public.sources src on src.id = c.source_id;
comment on view public.v_player_career_transactions is
  'DISI (Migration 054): a player''s transactions in his own direction. DODGERS_LEDGER rows are the Dodgers asset ledger (packages, returns and value live there); CAREER_HISTORY rows are his moves between other clubs (chronology only). A consumer must never read a CAREER_HISTORY row as a Dodgers exit, acquisition, package or return.';
revoke all on table public.v_player_career_transactions from anon, authenticated;
grant select on table public.v_player_career_transactions to anon, authenticated;

insert into public.disi_product_contract (relation_name, relation_kind, product_area, contract_tier, app_routes, purpose, introduced_in)
values ('v_player_career_transactions', 'VIEW', 'DEVELOPMENT', 'DOSSIER', array['/players/[slug]', '/development'],
  'A player''s transaction stream in his direction (Dodgers ledger and career history, labelled) for development chronology', '054')
on conflict (relation_name) do nothing;

-- ===========================================================================
-- 5. RESEARCH QUEUE: the 053 view with the MULTI_ORG_SEASON_UNVERIFIED condition reading career history
-- ===========================================================================

{{queue_view_054}}

-- ===========================================================================
-- 6. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  rec jsonb;
  n int;
  b record;
begin
  select * into b from _m054_before;
  for rec in select y from _m054, jsonb_array_elements(j -> 'events') y loop
    select count(*) into n from public.player_career_transactions c
      join public.players pl on pl.id = c.player_id
      left join public.organizations fo on fo.id = c.from_organization_id
      left join public.organizations too on too.id = c.to_organization_id
      where c.event_key = rec ->> 'key' and pl.slug = rec ->> 'player_slug' and c.transaction_date = (rec ->> 'date')::date and c.transaction_type = rec ->> 'type'
        and coalesce(fo.abbreviation, '') = rec ->> 'from' and coalesce(too.abbreviation, '') = rec ->> 'to' and c.source_reference = rec ->> 'source_reference';
    if n <> 1 then
      raise exception '054 postcondition: the career move % is not recorded exactly as reviewed', rec ->> 'key';
    end if;
  end loop;
  if (select count(*) from public.player_career_transactions) <> (select jsonb_array_length(j -> 'events') from _m054) then
    raise exception '054 postcondition: player_career_transactions holds rows outside the reviewed set';
  end if;
  select count(*) into n from public.player_career_transactions c
    left join public.organizations fo on fo.id = c.from_organization_id left join public.organizations too on too.id = c.to_organization_id
    where fo.franchise_key = 'DODGERS' or too.franchise_key = 'DODGERS';
  if n > 0 then
    raise exception '054 postcondition: % career rows touch a Dodgers organization', n;
  end if;
  -- nothing else changed: the Dodgers ledger, development, outcome, WAR and cost rows are byte-identical
  if b.ledger_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from (select e::text from public.transaction_events e union all select a::text from public.transaction_event_assets a
       union all select r::text from public.transaction_asset_resolutions r union all select o::text from public.dodgers_control_observations o
       union all select x::text from public.transactions x) t(t)) then
    raise exception '054 postcondition: the Dodgers asset ledger changed; career history never writes it';
  end if;
  if b.stints_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.player_season_stints t)
     or b.milestones_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.development_milestones t)
     or b.decisions_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.development_progression_decisions t) then
    raise exception '054 postcondition: a development row changed';
  end if;
  if b.audits_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.outcome_audits t)
     or b.war_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.player_mlb_team_season_war t)
     or b.costs_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from (select r::text from public.signing_financial_reports r union all select s::text from public.signing_financial_resolutions s) t(t)) then
    raise exception '054 postcondition: an outcome audit, a WAR row or an acquisition cost changed';
  end if;
  -- career history reaches no asset, package, control or value view: only the stream and the research queue read it
  select count(*) into n from (
    select distinct v.relname from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class
    where d.refobjid = 'public.player_career_transactions'::regclass and v.relname <> 'player_career_transactions') x
    where x.relname not in ('v_player_career_transactions', 'v_dodgers_development_research_queue');
  if n > 0 then
    raise exception '054 postcondition: % views outside the chronology read career history', n;
  end if;
end $$;

-- ===========================================================================
-- 7. GENERATION: one coherent refresh, only when a snapshot drifts (the executive snapshot counts the product contract)
-- ===========================================================================

do $$
begin
  if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    perform * from public.disi_refresh_product_snapshots();
  end if;
end $$;

commit;
