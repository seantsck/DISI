-- DISI v0.35
-- 044_executive_product.sql
-- The executive product contract: a one-row executive overview (coverage, known spend, realized organizational value with its
-- components separate, and the support state of every predictive layer) and per-target prediction readiness (the evidence, the
-- minimums and what is still needed). Both are bounded so application pages read them cheaply. Run after 043.
--
-- Built from database/research/044/ (views.sql, build.mjs; design in ../042/final-decision-architecture.md).
--
-- Rerunnable: every statement is idempotent. Adds views only.

begin;

do $$
begin
  if to_regclass('public.v_portfolio_candidate_readiness') is null or to_regclass('public.v_player_realized_organizational_value') is null then
    raise exception '044: Migrations 042 and 043 have not been applied';
  end if;
end $$;

{{views}}

do $$
declare t text;
begin
  foreach t in array array['v_executive_overview', 'v_prediction_readiness'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

do $$
declare
  bad text;
  o record;
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
    raise exception '044: API roles hold privileges beyond SELECT: %', bad;
  end if;
  select * into o from public.v_executive_overview;
  if (select count(*) from public.v_executive_overview) <> 1 then
    raise exception '044 postcondition: the executive overview must be exactly one row';
  end if;
  -- the overview never reports a predictive output its upstream does not support
  if (o.supported_probability_targets = 0 and o.non_null_probabilities <> 0)
     or (o.supported_expected_value_models = 0 and (o.supported_expected_values <> 0 or o.predictive_portfolio_recommendations <> 0)) then
    raise exception '044 postcondition: the overview reports unsupported predictive outputs';
  end if;
end $$;

commit;
