-- DISI v0.31
-- 040_historical_archetypes_comparables.sql
-- Historical archetypes and comparables: structured archetype keys and deterministic, explainable comparable sets built ONLY from the
-- 039 signing-time features; outcomes are attached after the comparable set is fixed. Run after 039.
--
-- Built from database/research/040/ (views.sql, audit.mjs, build.mjs; design in database/research/039/architecture-report.md).
--
-- What this is. No table, no fact. Comparables are earlier-signed players (history that existed at the time) with the same route and
-- position family at signing, never from the outcome-selected historical set, ordered by a fixed hierarchy with every matched
-- dimension listed. Benchmark and Dodgers comparables stay separable; populations are never pooled in a share; a share needs 10+
-- mature audited comparables of one population class. No likeness claim, no forecast.
--
-- Views: v_player_historical_archetype, v_player_comparables, v_player_comparable_summary, v_archetype_outcome_summary,
-- v_archetype_research_queue.
--
-- Rerunnable: every statement is idempotent.

begin;

do $$
begin
  if to_regclass('public.v_signing_time_features') is null or to_regclass('public.market_groups') is null then
    raise exception '040: Migration 039 has not been applied';
  end if;
end $$;

{{views}}

do $$
declare t text;
begin
  foreach t in array array['v_player_historical_archetype', 'v_player_comparables', 'v_player_comparable_summary', 'v_archetype_outcome_summary',
                           'v_archetype_research_queue'] loop
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
    raise exception '040: API roles hold privileges beyond SELECT: %', bad;
  end if;
  select count(*) into n from public.v_player_historical_archetype;
  select count(*) into expected from public.signings;
  if n <> expected then
    raise exception '040 postcondition: % archetype rows for % signings', n, expected;
  end if;
  -- comparables: earlier signing year, same route and position family, never outcome-selected, at most 20, ranks 1..n without gaps
  select count(*) into n from public.v_player_comparables c
  join public.v_signing_time_features t on t.signing_id = c.target_signing_id
  join public.v_signing_time_features k on k.signing_id = c.comparable_signing_id
  where k.signing_year >= t.signing_year or k.signing_route <> t.signing_route or k.position_family <> t.position_family
     or k.population_class = 'OUTCOME_SELECTED_SAMPLE' or c.comparable_rank > 20;
  if n <> 0 then
    raise exception '040 postcondition: % comparable row(s) violate the selection rules', n;
  end if;
end $$;

commit;
