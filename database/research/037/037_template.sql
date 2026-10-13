-- DISI v0.28
-- 037_development_pathway_intelligence.sql
-- Development pathway intelligence: derived, read-only views that turn the 021-024 development facts into an observed season path,
-- per-player pathway features, a DISI-convention pathway class, and pathway summaries against the 036 realized-outcome spine.
-- Run after 036.
--
-- Built from database/research/037/ (views.sql, audit.mjs, build.mjs; design in database/research/036/architecture-report.md).
--
-- What this is. No table, no fact: 021-024 are not rewritten. Developmental arrival comes from 024 (a reviewed early cameo is not an
-- arrival); repeats, regressions, absences and same-level runs come from the 023 team stints; outcomes come from
-- v_player_realized_outcome. A pathway class describes an observed path. No reason for a promotion, repeat, regression or absence
-- is inferred, a young active player is never labelled a failure, professional signings are never placed on the amateur ladder,
-- and no class is presented as a cause of, or a forecast for, an outcome.
--
-- Views: v_player_development_season_path, v_player_development_pathway, v_development_pathway_summary,
-- v_development_pathway_research_queue.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
begin
  if to_regclass('public.v_player_realized_outcome') is null or to_regclass('public.scouting_expectation_bands') is null then
    raise exception '037: Migration 036 has not been applied';
  end if;
  if to_regclass('public.v_player_development_progression') is null or to_regclass('public.development_progression_decisions') is null then
    raise exception '037: the Migration 024 progression layer is missing';
  end if;
  if not exists (select 1 from public.development_levels where level = 'AA' and progression_rank is not null and affiliated) then
    raise exception '037: the development level taxonomy has no ranked affiliated AA level';
  end if;
end $$;

-- ===========================================================================
-- 2. VIEWS
-- ===========================================================================

{{views}}

-- ===========================================================================
-- 3. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['v_player_development_season_path', 'v_player_development_pathway', 'v_development_pathway_summary',
                           'v_development_pathway_research_queue'] loop
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
    raise exception '037: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- one pathway row per Dodgers signing
  select count(*) into n from public.v_player_development_pathway;
  select count(*) into expected from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS';
  if n <> expected then
    raise exception '037 postcondition: % pathway rows for % Dodgers signings', n, expected;
  end if;
  -- one season-path row per player and season with affiliated developmental team stints
  select count(*) into expected from (select distinct s.player_id, s.season from public.player_season_stints s join public.development_levels dl on dl.level = s.level
    where s.stint_kind = 'TEAM_STINT' and dl.affiliated and dl.progression_rank is not null) d;
  select count(*) into n from public.v_player_development_season_path;
  if n <> expected then
    raise exception '037 postcondition: % season-path rows for % player-seasons', n, expected;
  end if;
  -- professional signings are never on the amateur ladder; a young active player is never an exit or a stall below 3 seasons
  select count(*) into n from public.v_player_development_pathway
  where (signing_route = 'PROFESSIONAL_SIGNING') <> (pathway_class = 'NOT_CLASSIFIED_PROFESSIONAL_SIGNING')
     or (pathway_class = 'EARLY_EXIT' and active_affiliated)
     or (pathway_class = 'STALLED' and (current_same_level_run < 3 or not active_affiliated))
     or (pathway_class = 'STILL_DEVELOPING' and (not active_affiliated or seasons_since_debut >= 6 or aa_or_higher_arrival_season is not null));
  if n <> 0 then
    raise exception '037 postcondition: % pathway row(s) violate the class rules', n;
  end if;
end $$;

commit;
