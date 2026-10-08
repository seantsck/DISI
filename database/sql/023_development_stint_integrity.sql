-- DISI v0.14
-- 023_development_stint_integrity.sql
-- Development stint integrity. Run after 022.
--
-- Built from reviewed research (database/research/023/): audit.mjs proves which
-- stints are season totals, values-decisions.json records the decisions, and
-- build.mjs assembles this file.
--
-- Problem (found by the post-022 audit): 56 stints with no team, no affiliate
-- and no dates are the MLB Stats API's team-less season-total splits, stored
-- beside the team stints they sum. Summing stint rows double-counted 1,786
-- games, the totals raised false missing-date / unresolved-organization queue
-- items, and one (Edgar Leon's 2026 cross-level rookie total) made an active
-- Tigers DSL player look out of affiliated baseball. Two historical
-- affiliate -> organization rules (Augusta 2021+, Vancouver 2011+) were wrong.
--
-- What this does:
--   * Adds player_season_stints.stint_kind (TEAM_STINT, SEASON_TOTAL,
--     UNRESOLVED) and season_total_basis (SAME_LEVEL, CROSS_LEVEL, SUB_SEASON),
--     tied together by CHECK constraints. No row is deleted or altered beyond
--     the two new columns; a season-total row stays as source evidence.
--   * Tags exactly the reviewed season totals, resolved by natural key, behind
--     guards that RE-PROVE the aggregate arithmetic. If a total does not equal
--     the sum of its component team stints the migration raises and rolls back.
--   * Corrects Augusta GreenJackets 2021+ -> Atlanta Braves and Vancouver
--     Canadians 2011+ -> Toronto Blue Jays. Raw affiliate names are preserved.
--   * Re-derives player_development_status from team stints only (still
--     appearance-based; developmental-arrival semantics are migration 024).
--   * Recreates the stint, summary, coverage and research-queue views so every
--     additive or coverage calculation reads team stints only; fixes the 021
--     SEASON_GAP scoping bug (a bare player_id bound to the inner table and
--     measured the whole table's season span); exempts FOREIGN_PRO clubs from
--     UNRESOLVED_ORGANIZATION (foreign clubs are organization-unmapped by design).
--   * Leaves all 832 milestones untouched.
--
-- Additive rule for every consumer: sum or count stints only WHERE
-- stint_kind = 'TEAM_STINT'. A SEASON_TOTAL row may stand in only where no
-- component team stints exist (none today).
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 1. SCHEMA: stint_kind / season_total_basis
-- ===========================================================================

alter table public.player_season_stints add column if not exists stint_kind text not null default 'TEAM_STINT';
alter table public.player_season_stints add column if not exists season_total_basis text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'player_season_stints_stint_kind_check'
                 and conrelid = 'public.player_season_stints'::regclass) then
    alter table public.player_season_stints add constraint player_season_stints_stint_kind_check
      check (stint_kind in ('TEAM_STINT', 'SEASON_TOTAL', 'UNRESOLVED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'player_season_stints_season_total_basis_check'
                 and conrelid = 'public.player_season_stints'::regclass) then
    alter table public.player_season_stints add constraint player_season_stints_season_total_basis_check
      check (case when stint_kind = 'SEASON_TOTAL'
                  then coalesce(season_total_basis in ('SAME_LEVEL', 'CROSS_LEVEL', 'SUB_SEASON'), false)
                  else season_total_basis is null end);
  end if;
end $$;

comment on column public.player_season_stints.stint_kind is
  'TEAM_STINT: a real team/affiliate stint (the additive unit). SEASON_TOTAL: the source''s team-less aggregate of several team stints, kept as evidence and EXCLUDED from additive and coverage calculations. UNRESOLVED: a team-less row not proven to be a total.';
comment on column public.player_season_stints.season_total_basis is
  'How a SEASON_TOTAL relates to its components: SAME_LEVEL (all at the total''s level), CROSS_LEVEL (components span levels, e.g. rookie sport id 16), SUB_SEASON (a split-season label such as 2018.1 covering only some of the season''s teams). NULL for every other stint_kind.';

-- ===========================================================================
-- 2. REVIEWED RESEARCH DATA (database/research/023/values-decisions.json)
-- ===========================================================================

create temporary table _m023_totals (
  slug text, season int, level text, source_level text, league_name text,
  basis text, games int, components text[]
) on commit drop;

insert into _m023_totals (slug, season, level, source_level, league_name, basis, games, components) values
('alex-de-jesus', 2019, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 57, null::text[]),
('alex-de-jesus', 2022, 'HIGH_A', 'A+', null, 'SAME_LEVEL', 74, null::text[]),
('alexander-albertus', 2023, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 45, null::text[]),
('alexis-dominguez', 2025, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 12, null::text[]),
('allen-ajoti', 2026, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 14, null::text[]),
('anderson-jerez', 2023, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 17, null::text[]),
('andres-luna', 2025, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 14, null::text[]),
('aneudy-almonte', 2025, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 13, null::text[]),
('carlos-frias', 2009, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 16, null::text[]),
('carlos-rincon', 2016, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 52, null::text[]),
('carlos-rincon', 2021, 'AA', 'AA', null, 'SAME_LEVEL', 101, null::text[]),
('christian-muniz', 2024, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 12, null::text[]),
('dailoui-abad', 2022, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 18, null::text[]),
('diego-cartaya', 2019, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 49, null::text[]),
('edgar-aviles', 2022, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 17, null::text[]),
('edgar-leon', 2023, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 13, null::text[]),
('edgar-leon', 2026, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 9, null::text[]),
('erick-batista', 2024, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 14, null::text[]),
('gersel-pitre', 2015, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 40, null::text[]),
('hendrik-clementina', 2017, 'OTHER', 'ROK', 'Pioneer League', 'SAME_LEVEL', 51, null::text[]),
('jeral-perez', 2024, 'LOW_A', 'A', null, 'SAME_LEVEL', 105, null::text[]),
('jerami-rodriguez', 2019, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 16, null::text[]),
('jeremy-castro', 2023, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 14, null::text[]),
('jhonny-jimenez', 2024, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 13, null::text[]),
('jhosman-theran', 2026, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 39, null::text[]),
('jose-gonzalez', 2023, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 32, null::text[]),
('jose-villegas', 2025, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 14, null::text[]),
('julio-lugo-prospect', 2016, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 14, null::text[]),
('leider-padilla', 2026, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 26, null::text[]),
('lenix-osuna', 2014, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 18, null::text[]),
('lenix-osuna', 2018, 'FOREIGN_PRO', 'AAA', 'Mexican League', 'SUB_SEASON', 7, array['Diablos Rojos del Mexico', 'Guerreros de Oaxaca']::text[]),
('lesther-medrano', 2023, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 5, null::text[]),
('miguel-dominguez', 2023, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 39, null::text[]),
('miguel-droz', 2021, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 39, null::text[]),
('misja-harcksen', 2015, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 18, null::text[]),
('misja-harcksen', 2016, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 21, null::text[]),
('moises-acacio', 2026, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 31, null::text[]),
('nicolas-cruz', 2022, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 15, null::text[]),
('paris-johnson', 2024, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 26, null::text[]),
('railin-familia', 2025, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 36, null::text[]),
('raynerd-ortega', 2024, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 30, null::text[]),
('rodmar-angela', 2023, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 29, null::text[]),
('roger-lasso', 2021, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 42, null::text[]),
('roger-lasso', 2023, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 33, null::text[]),
('roger-lasso', 2024, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 36, null::text[]),
('ronny-brito', 2016, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 59, null::text[]),
('ronny-brito', 2017, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 28, null::text[]),
('ronny-brito', 2018, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 61, null::text[]),
('roque-gutierrez', 2021, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 12, null::text[]),
('sean-linan', 2025, 'HIGH_A', 'A+', null, 'SAME_LEVEL', 11, null::text[]),
('starling-heredia', 2016, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 64, null::text[]),
('starling-heredia', 2017, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 26, null::text[]),
('thayron-liranzo', 2024, 'HIGH_A', 'A+', 'Midwest League', 'SAME_LEVEL', 100, null::text[]),
('victor-rodrigues', 2023, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 47, null::text[]),
('yojackson-laya', 2026, 'OTHER', 'ROK', null, 'CROSS_LEVEL', 27, null::text[]),
('yuliangel-de-la-cruz', 2022, 'INTERNATIONAL_ROOKIE', 'ROK', 'Dominican Summer League', 'SAME_LEVEL', 15, null::text[]);

-- ===========================================================================
-- 3. TAG THE SEASON TOTALS (resolved by natural key; arithmetic re-proven)
-- ===========================================================================

create temporary table _m023_resolved on commit drop as
select t.*, s.id as stint_id
from _m023_totals t
join public.players p on p.slug = t.slug
join public.player_season_stints s
  on s.player_id = p.id and s.season = t.season and s.level::text = t.level
 and coalesce(s.league_name, '') = coalesce(t.league_name, '')
 and s.affiliate_team is null and s.team_id is null;

do $$
declare
  expected int;
  resolved int;
  bad text;
begin
  select count(*) into expected from _m023_totals;
  select count(*) into resolved from _m023_resolved;
  if expected <> resolved then
    raise exception '023: % reviewed season totals but % resolved to a team-less stint', expected, resolved;
  end if;

  -- Every total must equal the sum of its component team stints. Components are
  -- the player's same-season, same-source-level team stints (or the reviewed
  -- subset for a split-season total). Only statistics the total reports are
  -- compared; innings are compared in thirds.
  select string_agg(format('%s %s %s', r.slug, r.season, r.level), '; ') into bad
  from _m023_resolved r
  join public.player_season_stints t on t.id = r.stint_id
  left join lateral (
    select count(*) as n, count(distinct c.level) as levels, min(c.level::text) as one_level,
      sum(c.g) as g, sum(c.pa) as pa, sum(c.ab) as ab, sum(c.h) as h, sum(c.b2) as b2, sum(c.b3) as b3,
      sum(c.hr) as hr, sum(c.bb) as bb, sum(c.so) as so, sum(c.sb) as sb, sum(c.cs) as cs,
      sum(c.pg) as pg, sum(c.gs) as gs, sum(c.bf) as bf, sum(c.h_allowed) as h_allowed, sum(c.r) as r,
      sum(c.er) as er, sum(c.hr_allowed) as hr_allowed, sum(c.pbb) as pbb, sum(c.pso) as pso,
      sum(round(c.ip * 3)) as ip3
    from public.player_season_stints c
    where c.player_id = t.player_id and c.season = t.season and c.source_level = t.source_level
      and c.team_id is not null and c.affiliate_team is not null
      and (r.components is null or c.affiliate_team = any (r.components))
  ) comp on true
  where comp.n < 2
     or (r.basis = 'SUB_SEASON' and comp.n <> cardinality(r.components))
     or (r.basis = 'SAME_LEVEL' and not (comp.levels = 1 and comp.one_level = t.level::text))
     or (r.basis = 'CROSS_LEVEL' and comp.levels = 1 and comp.one_level = t.level::text)
     or (t.g is not null and t.g <> coalesce(comp.g, 0))
     or (t.pa is not null and t.pa <> coalesce(comp.pa, 0))
     or (t.ab is not null and t.ab <> coalesce(comp.ab, 0))
     or (t.h is not null and t.h <> coalesce(comp.h, 0))
     or (t.b2 is not null and t.b2 <> coalesce(comp.b2, 0))
     or (t.b3 is not null and t.b3 <> coalesce(comp.b3, 0))
     or (t.hr is not null and t.hr <> coalesce(comp.hr, 0))
     or (t.bb is not null and t.bb <> coalesce(comp.bb, 0))
     or (t.so is not null and t.so <> coalesce(comp.so, 0))
     or (t.sb is not null and t.sb <> coalesce(comp.sb, 0))
     or (t.cs is not null and t.cs <> coalesce(comp.cs, 0))
     or (t.pg is not null and t.pg <> coalesce(comp.pg, 0))
     or (t.gs is not null and t.gs <> coalesce(comp.gs, 0))
     or (t.bf is not null and t.bf <> coalesce(comp.bf, 0))
     or (t.h_allowed is not null and t.h_allowed <> coalesce(comp.h_allowed, 0))
     or (t.r is not null and t.r <> coalesce(comp.r, 0))
     or (t.er is not null and t.er <> coalesce(comp.er, 0))
     or (t.hr_allowed is not null and t.hr_allowed <> coalesce(comp.hr_allowed, 0))
     or (t.pbb is not null and t.pbb <> coalesce(comp.pbb, 0))
     or (t.pso is not null and t.pso <> coalesce(comp.pso, 0))
     or (t.ip is not null and round(t.ip * 3) <> coalesce(comp.ip3, 0))
     or coalesce(t.g, t.pg) is distinct from r.games;
  if bad is not null then
    raise exception '023: season total does not equal the sum of its components: %', bad;
  end if;
end $$;

update public.player_season_stints s
set stint_kind = 'SEASON_TOTAL', season_total_basis = r.basis
from _m023_resolved r
where s.id = r.stint_id
  and (s.stint_kind is distinct from 'SEASON_TOTAL' or s.season_total_basis is distinct from r.basis);

-- No team-less row may remain a TEAM_STINT: every aggregate is now explicitly
-- classified (anything not proven stays UNRESOLVED when ingested).
do $$
declare bad int;
begin
  select count(*) into bad from public.player_season_stints
  where stint_kind = 'TEAM_STINT' and (affiliate_team is null or team_id is null);
  if bad <> 0 then
    raise exception '023: % team-less stints remain classified as TEAM_STINT', bad;
  end if;
end $$;

-- ===========================================================================
-- 4. ORGANIZATION CORRECTIONS (raw affiliate names preserved)
-- ===========================================================================
-- Augusta GreenJackets: Giants through 2020, Braves from 2021.
-- Vancouver Canadians: Blue Jays from 2011 (never Oakland in this period).
-- The development.mjs affiliation rules carry the same correction for future ingest.

do $$
begin
  if not exists (select 1 from public.organizations where name = 'Atlanta Braves')
     or not exists (select 1 from public.organizations where name = 'Toronto Blue Jays') then
    raise exception '023: organizations Atlanta Braves / Toronto Blue Jays must exist';
  end if;
end $$;

update public.player_season_stints s
set organization_id = o.id, organization_name = o.name
from public.organizations o
where o.name = 'Atlanta Braves' and s.affiliate_team = 'Augusta GreenJackets' and s.season >= 2021
  and (s.organization_id is distinct from o.id or s.organization_name is distinct from o.name);

update public.player_season_stints s
set organization_id = o.id, organization_name = o.name
from public.organizations o
where o.name = 'Toronto Blue Jays' and s.affiliate_team = 'Vancouver Canadians' and s.season >= 2011
  and (s.organization_id is distinct from o.id or s.organization_name is distinct from o.name);

-- ===========================================================================
-- 5. CURRENT DEVELOPMENT STATUS (team stints only; still appearance-based)
-- ===========================================================================
-- The 021 derivation, unchanged except that SEASON_TOTAL rows are excluded, so
-- an aggregate (Edgar Leon's cross-level 2026 rookie total) can no longer look
-- like unaffiliated play. Rows are rewritten only when the classification moved.

with team_stints as (
  select * from public.player_season_stints where stint_kind = 'TEAM_STINT'
)
insert into public.player_development_status (player_id, status, basis, status_season, as_of_date, note)
select
  pl.id,
  case
    when audited.reached_mlb_verified is true then 'MLB'::public.development_status
    when foreign_after.last_season is not null
      and (highest.affiliated_rank is null or foreign_after.last_season > highest.last_season)
      then 'OUT_OF_AFFILIATED_BASEBALL'::public.development_status
    when highest.level is not null then
      case highest.level
        when 'AAA' then 'AAA'::public.development_status
        when 'AA' then 'AA'::public.development_status
        when 'HIGH_A' then 'HIGH_A'::public.development_status
        when 'LOW_A' then 'A_BALL'::public.development_status
        when 'A' then 'A_BALL'::public.development_status
        else 'ROOKIE_LEVEL'::public.development_status
      end
    when pl.mlb_id is null then 'UNKNOWN'::public.development_status
    else 'NOT_YET_DEBUTED'::public.development_status
  end,
  case when audited.reached_mlb_verified is true then 'AUDITED_OUTCOME' else 'STINTS' end,
  coalesce(highest.last_season, foreign_after.last_season),
  coalesce((select max(s.as_of_date) from team_stints s where s.player_id = pl.id), current_date),
  case
    when audited.reached_mlb_verified is true then null
    when highest.level is not null then 'Highest affiliated level reached: ' || highest.level
    when foreign_after.last_season is not null then 'Professional play recorded outside affiliated baseball'
    else 'No professional seasons recorded in the sources reviewed'
  end
from public.players pl
left join lateral (
  select dls.level, dls.level_rank as affiliated_rank, max(dls.season) as last_season
  from team_stints dls
  where dls.player_id = pl.id and dls.affiliated and dls.level <> 'MLB'
  group by dls.level, dls.level_rank
  order by dls.level_rank desc, last_season desc
  limit 1
) highest on true
left join lateral (
  select max(dls.season) as last_season
  from team_stints dls
  where dls.player_id = pl.id and not dls.affiliated
) foreign_after on true
left join lateral (
  select oa.reached_mlb_verified
  from public.outcome_audits oa
  where oa.player_id = pl.id
  order by oa.audited_through_date desc
  limit 1
) audited on true
where pl.id in (select player_id from team_stints)
   or audited.reached_mlb_verified is true
on conflict (player_id) do update
set status = excluded.status,
    basis = excluded.basis,
    status_season = excluded.status_season,
    as_of_date = excluded.as_of_date,
    note = excluded.note
where (public.player_development_status.status, public.player_development_status.basis,
       public.player_development_status.status_season, public.player_development_status.note)
  is distinct from (excluded.status, excluded.basis, excluded.status_season, excluded.note);

-- ===========================================================================
-- 6. VIEWS (extended, not duplicated)
-- ===========================================================================

-- 6a. Stints for the dossier: season totals stay visible as provenance and are
-- labelled by the two appended columns.
create or replace view public.v_player_development_stints
with (security_invoker = true)
as
select
  s.id as stint_id,
  s.player_id,
  p.slug as player_slug,
  s.season,
  s.age_during_season,
  s.level_rank,
  s.organization_name,
  o.abbreviation as organization_abbreviation,
  s.affiliate_team,
  s.league_name,
  s.level::text as level,
  dl.label as level_label,
  s.source_level,
  s.level_classification,
  s.era::text as era,
  s.first_game_date,
  s.last_game_date,
  case
    when s.pg is not null and s.g is not null then concat_ws(' / ', s.g::text, s.pa::text || ' PA', round(s.ip, 1)::text || ' IP')
    when s.pg is not null then concat_ws(' / ', s.pg::text, round(s.ip, 1)::text || ' IP')
    else concat_ws(' / ', s.g::text, s.pa::text || ' PA')
  end as line_summary,
  s.g, s.pa, s.ab, s.h, s.b2, s.b3, s.hr, s.bb, s.so, s.sb, s.cs,
  s.avg, s.obp, s.slg, s.ops,
  s.pg, s.gs, s.ip, s.bf, s.h_allowed, s.r, s.er, s.hr_allowed, s.pbb, s.pso,
  s.era_, s.whip,
  s.batter_k_pct, s.batter_bb_pct, s.pitcher_k_pct, s.pitcher_bb_pct, s.pitcher_k_minus_bb_pct,
  s.affiliated,
  s.detail,
  s.source_urls,
  s.as_of_date,
  -- 023 additions. Appended at the end: create or replace view may extend a
  -- view with new columns but may not reorder existing ones.
  s.stint_kind,
  s.season_total_basis
from public.player_season_stints s
join public.players p on p.id = s.player_id
left join public.organizations o on o.id = s.organization_id
left join public.development_levels dl on dl.level = s.level;

-- 6b. Player development summary: the 022 view, with highest level and the
-- organization count reading team stints only. Column list unchanged.
create or replace view public.v_dodgers_player_development_summary
with (security_invoker = true)
as
select
  p.id as player_id,
  p.slug as player_slug,
  p.full_name,
  p.birth_date,
  p.mlb_id,
  sg.signing_year,
  sg.signing_date,
  public.disi_age_years(p.birth_date, sg.signing_date) as age_at_signing,
  signing_m.milestone_date as professional_signing_date,
  pro_deb.milestone_date as professional_debut_date_exact,
  pro_deb.season_year as professional_debut_season,
  dsl.milestone_date as first_dsl_date,
  dsl.season_year as first_dsl_season,
  complex_m.milestone_date as first_complex_date,
  complex_m.season_year as first_complex_season,
  a_m.milestone_date as first_a_date,
  a_m.season_year as first_a_season,
  high_a.milestone_date as first_high_a_date,
  high_a.season_year as first_high_a_season,
  aa.milestone_date as first_aa_date,
  aa.season_year as first_aa_season,
  aaa.milestone_date as first_aaa_date,
  aaa.season_year as first_aaa_season,
  mlb.milestone_date as mlb_debut_date,
  mlb.season_year as mlb_debut_season,
  public.disi_age_years(p.birth_date, a_m.milestone_date) as age_at_first_a_exact,
  public.disi_age_years(p.birth_date, high_a.milestone_date) as age_at_first_high_a_exact,
  public.disi_age_years(p.birth_date, aa.milestone_date) as age_at_first_aa_exact,
  public.disi_age_years(p.birth_date, aaa.milestone_date) as age_at_first_aaa_exact,
  public.disi_age_years(p.birth_date, mlb.milestone_date) as age_at_mlb_debut_exact,
  -- Season-based approximations, clearly labelled. From first stints at the
  -- level (mid-year convention: age as of the season after the first stint).
  case when a_m.season_year is not null and p.birth_date is not null
       then a_m.season_year - extract(year from p.birth_date)::int end as approx_age_at_first_a,
  case when aa.season_year is not null and p.birth_date is not null
       then aa.season_year - extract(year from p.birth_date)::int end as approx_age_at_first_aa,
  case when mlb.season_year is not null and p.birth_date is not null
       then mlb.season_year - extract(year from p.birth_date)::int end as approx_age_at_mlb_debut,
  -- Elapsed times, exact only where both endpoint dates exist.
  public.disi_development_days(sg.signing_date, pro_deb.milestone_date) as days_signing_to_pro_debut_exact,
  public.disi_development_days(sg.signing_date, a_m.milestone_date) as days_signing_to_a_exact,
  public.disi_development_days(sg.signing_date, aa.milestone_date) as days_signing_to_aa_exact,
  public.disi_development_days(sg.signing_date, aaa.milestone_date) as days_signing_to_aaa_exact,
  public.disi_development_days(sg.signing_date, mlb.milestone_date) as days_signing_to_mlb_exact,
  public.disi_development_years(sg.signing_date, aa.milestone_date) as years_signing_to_aa_exact,
  public.disi_development_years(sg.signing_date, mlb.milestone_date) as years_signing_to_mlb_exact,
  public.disi_development_days(a_m.milestone_date, aa.milestone_date) as days_a_to_aa_exact,
  public.disi_development_days(aa.milestone_date, aaa.milestone_date) as days_aa_to_aaa_exact,
  public.disi_development_days(aaa.milestone_date, mlb.milestone_date) as days_aaa_to_mlb_exact,
  -- Season-based approximations (labelled; NOT exact elapsed time).
  case when sg.signing_date is not null and a_m.season_year is not null
       then a_m.season_year - extract(year from sg.signing_date)::int end as approx_years_signing_to_a,
  case when sg.signing_date is not null and aa.season_year is not null
       then aa.season_year - extract(year from sg.signing_date)::int end as approx_years_signing_to_aa,
  case when sg.signing_date is not null and mlb.season_year is not null
       then mlb.season_year - extract(year from sg.signing_date)::int end as approx_years_signing_to_mlb,
  ds.status as current_development_status,
  ds.status_season as current_development_season,
  ds.note as development_status_note,
  highest.level as highest_affiliated_level,
  highest.highest_season as highest_affiliated_season,
  org_changes.organization_count,
  oa.reached_mlb_verified,
  -- 022 additions. Appended at the end: create or replace view may extend a
  -- view with new columns but may not insert or reorder existing ones.
  public.disi_development_days(sg.signing_date, high_a.milestone_date) as days_signing_to_high_a_exact,
  public.disi_development_years(sg.signing_date, high_a.milestone_date) as years_signing_to_high_a_exact,
  public.disi_development_days(a_m.milestone_date, high_a.milestone_date) as days_a_to_high_a_exact,
  public.disi_development_days(high_a.milestone_date, aa.milestone_date) as days_high_a_to_aa_exact
from public.players p
left join public.signings sg on sg.player_id = p.id
left join lateral (
  select d.milestone_date from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'PROFESSIONAL_SIGNING' and d.milestone_date is not null
  order by d.milestone_date limit 1
) signing_m on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'PROFESSIONAL_DEBUT'
) pro_deb on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'DSL_DEBUT'
) dsl on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'COMPLEX_DEBUT'
) complex_m on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'A_DEBUT'
) a_m on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'HIGH_A_DEBUT'
) high_a on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'AA_DEBUT'
) aa on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'AAA_DEBUT'
) aaa on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'MLB_DEBUT'
) mlb on true
left join public.player_development_status ds on ds.player_id = p.id
left join lateral (
  select dls.level, max(dls.season) as highest_season
  from public.player_season_stints dls
  where dls.player_id = p.id and dls.affiliated and dls.stint_kind = 'TEAM_STINT'
  group by dls.level, dls.level_rank
  order by coalesce(dls.level_rank, 0) desc
  limit 1
) highest on true
left join lateral (
  select count(distinct s.organization_id)::int as organization_count
  from public.player_season_stints s
  where s.player_id = p.id and s.organization_id is not null and s.stint_kind = 'TEAM_STINT'
) org_changes on true
left join public.outcome_audits oa on oa.player_id = p.id;

-- 6c. Development data coverage: presence flags read team stints only.
create or replace view public.v_dodgers_development_coverage
with (security_invoker = true)
as
select
  count(*)::int as tracked_players,
  count(*) filter (where pre.has_stints)::int as players_with_stints,
  count(*) filter (where not pre.has_stints)::int as players_without_stints,
  count(*) filter (where not pre.has_stints and d.mlb_id is not null)::int as resolved_players_without_stints,
  count(*) filter (where pre.has_mlb)::int as players_with_mlb_history,
  count(*) filter (where pre.has_mlb and pre.has_pre_mlb)::int as mlb_players_with_pre_mlb_history,
  count(*) filter (where pre.has_mlb and pre.has_pre_mlb_partial)::int as mlb_players_with_partial_pre_mlb_history,
  count(*) filter (where pre.has_mlb and not pre.has_pre_mlb)::int as mlb_players_missing_pre_mlb_history,
  count(*) filter (where not pre.has_mlb and pre.has_stints)::int as non_mlb_players_with_history,
  count(*) filter (where first_aa_date is not null)::int as players_with_exact_first_aa_date,
  count(*) filter (where first_aa_season is not null)::int as players_with_first_aa_season,
  count(*) filter (where first_aaa_date is not null)::int as players_with_exact_first_aaa_date,
  count(*) filter (where first_aaa_season is not null)::int as players_with_first_aaa_season,
  count(*) filter (where years_signing_to_mlb_exact is not null)::int as players_with_signing_to_mlb_time
from public.v_dodgers_player_development_summary d
left join lateral (
  select
    exists (select 1 from public.player_season_stints s where s.player_id = d.player_id and s.stint_kind = 'TEAM_STINT') as has_stints,
    exists (select 1 from public.player_season_stints s where s.player_id = d.player_id and s.stint_kind = 'TEAM_STINT' and s.affiliated and s.level <> 'MLB') as has_pre_mlb,
    exists (select 1 from public.player_season_stints s where s.player_id = d.player_id and s.stint_kind = 'TEAM_STINT' and s.affiliated and s.level <> 'MLB'
            and (s.g > 0 or s.pa > 0 or s.pg > 0)) as has_pre_mlb_partial,
    exists (select 1 from public.player_season_stints s where s.player_id = d.player_id and s.stint_kind = 'TEAM_STINT' and s.level = 'MLB') as has_mlb
) pre on true;

-- 6d. Research queue: the 022 queue over team stints only, with the SEASON_GAP
-- scoping fixed and FOREIGN_PRO clubs exempt from UNRESOLVED_ORGANIZATION.
create or replace view public.v_dodgers_development_research_queue
with (security_invoker = true)
as
with team_stints as (
  -- 023: a season-total row repeats its component team stints, so it never
  -- counts as development history, a missing date or an unresolved organization.
  select * from public.player_season_stints where stint_kind = 'TEAM_STINT'
),
base as (
  select
    p.id as player_id,
    p.slug as player_slug,
    p.full_name,
    p.mlb_id,
    sg.signing_year,
    (select max(s.as_of_date) from team_stints s where s.player_id = p.id) as last_research_date,
    (select count(distinct s.season)::int from team_stints s where s.player_id = p.id) as stint_count,
    exists (select 1 from team_stints s where s.player_id = p.id) as has_stints,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.level_classification in ('UNRECOGNIZED_SPORT','UNKNOWN_ROOKIE_LEAGUE')
    ) as has_unknown_level,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.organization_id is null
        and s.level <> 'FOREIGN_PRO' -- foreign clubs are organization-unmapped by design
    ) as has_unresolved_organization,
    exists (
      select 1 from team_stints s1
      join team_stints s2
        on s2.player_id = s1.player_id and s2.season = s1.season
       and s2.id > s1.id
      where s1.player_id = p.id
        and s1.organization_id is not null and s2.organization_id is not null
        and s1.organization_id <> s2.organization_id
    ) as has_multi_org_season,
    exists (
      select 1 from public.development_milestones m
      where m.player_id = p.id and m.event_code = 'MLB_DEBUT'
    ) as has_mlb_milestone,
    not exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.level <> 'MLB'
    ) as no_pre_mlb_history,
    -- 022 date-coverage facts
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.season >= 2006 and s.first_game_date is null
    ) as has_undated_log_era_stint,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.season >= 2006 and s.last_game_date is null
    ) as has_stint_missing_last_date,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.season >= 2006 and s.first_game_date is not null
    ) as has_any_dated_stint,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.level_classification in ('UNKNOWN_ROOKIE_LEAGUE','UNRECOGNIZED_SPORT')
        and s.season >= 2006 and s.first_game_date is null
    ) as has_unknown_level_undated,
    exists (
      select 1 from public.development_milestones m
      where m.player_id = p.id and m.date_precision = 'SEASON'
        and m.event_code in ('DSL_DEBUT','COMPLEX_DEBUT','A_DEBUT','HIGH_A_DEBUT','AA_DEBUT','AAA_DEBUT')
    ) as has_season_only_debut_milestone,
    exists (
      select 1 from public.development_milestones m
      where m.player_id = p.id and m.date_precision = 'DAY'
        and m.event_code in ('A_DEBUT','HIGH_A_DEBUT','AA_DEBUT','AAA_DEBUT')
    ) as has_exact_level_debut_milestone,
    exists (
      select 1 from public.research_source_conflicts c
      where c.player_id = p.id and c.conflict_type = 'EXACT_DATE_CONFLICT' and c.status = 'UNRESOLVED'
    ) as has_exact_date_conflict,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.level <> 'MLB' and s.affiliated
    ) as has_pre_mlb_history
  from public.players p
  left join public.signings sg on sg.player_id = p.id
  join public.organizations o on o.id = sg.organization_id
  where o.franchise_key = 'DODGERS'
)
select
  player_id, player_slug, full_name, mlb_id, signing_year,
  issue, priority, detail
from base,
lateral (
  select * from (values
    ('IDENTITY_BUT_NO_PROFESSIONAL_SEASONS', 3,
      'Resolved identity (MLB id); the season-splits query ran and returned no structured season rows'),
    ('SEASON_GAP', 2,
      'Stints have a gap of at least two seasons between first and last'),
    ('UNKNOWN_LEVEL_CLASSIFICATION', 2,
      'A stint could not be classified into the canonical level taxonomy'),
    ('UNRESOLVED_ORGANIZATION', 2,
      'A stint has no organization resolved from its team/league/season'),
    ('MULTI_ORG_SEASON_UNVERIFIED', 1,
      'Two organizations appear in the same season; verify the trade date'),
    ('MLB_PLAYER_MISSING_PRE_MLB_HISTORY', 1,
      'Reached MLB but no pre-MLB development record was found'),
    ('LEVEL_CONFLICT', 1,
      'Source-level label and canonical classification disagree; review the stint'),
    ('MISSING_FIRST_GAME_DATE', 3,
      'A log-era stint (2006+) has no verified first appearance date yet; a coverage gap, not a failure'),
    ('MISSING_LAST_GAME_DATE', 3,
      'A log-era stint (2006+) has no verified last appearance date yet; a coverage gap, not a failure'),
    ('SEASON_ONLY_MILESTONE', 2,
      'A level debut stays season-precision; game-log evidence did not cover its first season'),
    ('GAME_LOG_UNAVAILABLE', 3,
      'Log-era stints exist but none carry game-verified dates; the gameLog queries returned nothing for this player'),
    ('EXACT_DATE_CONFLICT', 1,
      'Game-log evidence disagrees with an existing exact date; the stored value was kept and the conflict recorded'),
    ('MLB_PLAYER_MISSING_PRE_MLB_EXACT_DATES', 2,
      'Reached MLB with pre-MLB stints, but no level-debut milestone carries an exact date yet'),
    ('UNKNOWN_LEVEL_GAME_LOG', 2,
      'A stint with an unclassified level has no dated appearances; game dates cannot be attributed to it')
  ) as v(issue, priority, detail)
) issues
where (issue = 'IDENTITY_BUT_NO_PROFESSIONAL_SEASONS' and mlb_id is not null and not has_stints)
   or (issue = 'SEASON_GAP' and has_stints and stint_count >= 2
       and (select max(s.season) - min(s.season) + 1 from team_stints s where s.player_id = base.player_id) > stint_count)
   or (issue = 'UNKNOWN_LEVEL_CLASSIFICATION' and has_unknown_level)
   or (issue = 'UNRESOLVED_ORGANIZATION' and has_unresolved_organization)
   or (issue = 'MULTI_ORG_SEASON_UNVERIFIED' and has_multi_org_season)
   or (issue = 'MLB_PLAYER_MISSING_PRE_MLB_HISTORY' and has_mlb_milestone and no_pre_mlb_history)
   or (issue = 'MISSING_FIRST_GAME_DATE' and has_undated_log_era_stint)
   or (issue = 'MISSING_LAST_GAME_DATE' and has_stint_missing_last_date)
   or (issue = 'SEASON_ONLY_MILESTONE' and has_season_only_debut_milestone)
   or (issue = 'GAME_LOG_UNAVAILABLE' and has_stints and has_undated_log_era_stint and not has_any_dated_stint)
   or (issue = 'EXACT_DATE_CONFLICT' and has_exact_date_conflict)
   or (issue = 'MLB_PLAYER_MISSING_PRE_MLB_EXACT_DATES' and has_mlb_milestone and has_pre_mlb_history
       and not has_exact_level_debut_milestone)
   or (issue = 'UNKNOWN_LEVEL_GAME_LOG' and has_unknown_level_undated);

-- ===========================================================================
-- 7. GRANTS (explicit; never rely on Supabase default privileges)
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'player_season_stints', 'player_development_status', 'development_levels',
    'development_level_era_map', 'development_event_codes',
    'v_dodgers_player_development_summary', 'v_player_development_stints', 'v_player_development_milestones',
    'v_dodgers_development_by_signing_class', 'v_dodgers_development_by_market', 'v_dodgers_development_by_bonus_band',
    'v_dodgers_development_research_queue', 'v_dodgers_development_coverage', 'v_dodgers_development_date_coverage'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

commit;
