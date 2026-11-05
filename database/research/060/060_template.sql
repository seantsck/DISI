-- DISI v0.45
-- 060_owner_reviewed_acquisition_costs.sql
-- Owner-reviewed acquisition costs: 25 Dodgers signing bonuses supplied and reviewed by the owner on 2026-11-04. Run after 059.
--
-- Built from database/research/060/ (research-evidence.json, baseline.json, build.mjs). Do not edit by hand: change the input and rebuild.
--
-- What this is. A reviewed acquisition-cost data batch over the 030 / 031 financial ledger. It adds no table, view, function, grant, policy,
-- trigger, source, player or signing, and changes no definition.
--   * The 25 values are OWNER_REVIEWED_INPUT: the owner supplied and reviewed them; DISI did not research, corroborate or replace them, and no
--     external citation is retained. No source row, URL or publisher is created for them.
--   * 24 signings whose bonus was unknown gain one SIGNING_BONUS ledger report each through the ledger's unsourced-canonical path
--     (LEGACY_CARRYFORWARD: no source, no amount basis, evidence LEGACY_CANONICAL_VALUE, confidence UNVERIFIED, a note naming the owner-reviewed
--     input), and the canonical signings.signing_bonus_usd is set to it. v_signing_acquisition_financials reports them LEGACY_CANONICAL_ONLY,
--     never EXTERNALLY_SOURCED. bonus_publicly_reported is not changed: an owner-supplied value is not a public report.
--   * Pedro Astacio (1987) is a reviewed KNOWN $0.00, not an unknown. KNOWN ZERO != UNKNOWN; no other signing receives a zero.
--   * Adrian Beltre (1994) gains no report. His two ACTIVE 046 reports (SABR $23,000; ESPN.com / AP $17,000) both stay ACTIVE, and one reviewed
--     signing_financial_resolutions row (OTHER_REVIEWED) selects the existing $23,000 report; the canonical bonus becomes $23,000 and the
--     component reads RESOLVED, no longer CONFLICT. The disagreement stays visible.
--   * Every other unknown bonus stays NULL. Known-cost Dodgers signings 56 -> 81, unknown 164 -> 139, known acquisition cost +$5,932,000.00.
-- It then runs the explicit snapshot refresh once, only when this run changed a value.
--
-- Rerunnable: a rerun finds every fact present and changes nothing (no report, resolution or refresh). After rollback-060 (which retracts, never
-- deletes) a reapply records the same facts again as new ACTIVE rows.
--
-- Statement timeout: SET LOCAL raises the hosted 2min default for this transaction only (the refresh-product-snapshots.sql convention).
-- Verification: this transaction proves the write and its direct result with inexpensive checks (the 25 values, the ledger and resolution rows,
-- the cost counts, every other signing's money columns and every other ledger row unchanged, one drift-free generation). Each phase raises a
-- NOTICE with its elapsed time.

begin;
set local statement_timeout = '600s';

-- ===========================================================================
-- 0. REVIEWED INPUT (database/research/060/research-evidence.json)
-- ===========================================================================

create temporary table _m060 on commit drop as
select $m060${{payload_json}}$m060$::jsonb as j;

-- the 25 reviewed signings, resolved once (a slug / year that is not exactly one Dodgers signing is refused below)
create temporary table _m060_rows on commit drop as
select x ->> 'player_slug' as slug, (x ->> 'signing_year')::int as signing_year, (x ->> 'amount')::numeric(14,2) as amount, x ->> 'treatment' as treatment,
       (x ->> 'known_zero')::boolean as known_zero, (x ->> 'before_bonus')::numeric(14,2) as before_bonus, (x ->> 'before_reported')::boolean as before_reported,
       case when (x ->> 'known_zero')::boolean then m.j ->> 'known_zero_note' else m.j ->> 'note' end as note,
       (select array_agg(sg.id) from public.signings sg join public.players p on p.id = sg.player_id join public.organizations o on o.id = sg.organization_id
        where p.slug = x ->> 'player_slug' and sg.signing_year = (x ->> 'signing_year')::int and o.name = m.j ->> 'organization_name') as ids
from _m060 m, jsonb_array_elements(m.j -> 'bonuses') x;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 060 was written for
-- ===========================================================================

create temporary table _m060_state (applied int, generation bigint) on commit drop;

do $$
declare
  m jsonb := (select j from _m060);
  r record;
  sid uuid;
  b jsonb := m -> 'beltre';
  sel uuid;
  bel uuid;
  n int;
  applied int := 0;
  this_applied boolean;
begin
  if to_regclass('public.signing_financial_resolutions') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null
     or not exists (select 1 from public.player_metric_observations o join public.players p on p.id = o.player_id
                    where p.slug = 'rafael-devers' and o.metric_key = 'CAREER_BWAR' and o.observed_through_date = date '2026-09-28') then
    raise exception '060: Migration 059 has not been applied';
  end if;
  if (select count(*) from _m060_rows) <> 25 or (select count(distinct (slug, signing_year)) from _m060_rows) <> 25
     or (select sum(amount) from _m060_rows) <> (m ->> 'total_usd')::numeric then
    raise exception '060: the reviewed input is not 25 distinct signings totalling %', m ->> 'total_usd';
  end if;
  for r in select * from _m060_rows order by signing_year, slug loop
    if cardinality(coalesce(r.ids, '{}')) <> 1 then
      raise exception '060: % (%) does not match exactly one Dodgers signing', r.slug, r.signing_year;
    end if;
    sid := r.ids[1];
    if (select bonus_publicly_reported from public.signings where id = sid) is distinct from r.before_reported
       or (select posting_fee_usd from public.signings where id = sid) is not null or (select transfer_fee_usd from public.signings where id = sid) is not null then
      raise exception '060: % carries an unexpected canonical value; the reviewed input no longer applies', r.slug;
    end if;
    if r.treatment = 'OWNER_REVIEWED_LEDGER_FACT' then
      -- a reviewed bonus that was unknown must still be unknown, or already be exactly this fact
      this_applied := exists (select 1 from public.signing_financial_reports f where f.signing_id = sid and f.component_type = 'SIGNING_BONUS' and f.record_status = 'ACTIVE'
                              and f.report_origin = 'LEGACY_CARRYFORWARD' and f.amount = r.amount and f.note = r.note);
      select count(*) into n from public.signing_financial_reports f where f.signing_id = sid and f.component_type = 'SIGNING_BONUS' and f.record_status = 'ACTIVE'
        and not (f.report_origin = 'LEGACY_CARRYFORWARD' and f.amount = r.amount and f.note = r.note);
      if n > 0 then
        raise exception '060: % already has a different active bonus report; the reviewed input no longer applies', r.slug;
      end if;
      if exists (select 1 from public.signing_financial_resolutions d where d.signing_id = sid and d.record_status = 'ACTIVE') then
        raise exception '060: % has a financial resolution; the reviewed input no longer applies', r.slug;
      end if;
      if (select signing_bonus_usd from public.signings where id = sid) is distinct from (case when this_applied then r.amount else r.before_bonus end) then
        raise exception '060: % carries a canonical bonus that is not the reviewed one; it is not overwritten', r.slug;
      end if;
    else
      -- Beltre: exactly the two ACTIVE 046 reports, and no resolution other than this one
      select f.id into sel from public.signing_financial_reports f join public.sources so on so.id = f.source_id
      where f.signing_id = sid and f.component_type = 'SIGNING_BONUS' and f.record_status = 'ACTIVE' and f.report_origin = 'EXTERNAL_SOURCE'
        and so.url = b ->> 'selected_url' and f.amount = (b ->> 'selected_amount')::numeric;
      if sel is null or (select count(*) from public.signing_financial_reports f where f.signing_id = sid and f.component_type = 'SIGNING_BONUS' and f.record_status = 'ACTIVE') <> 2
         or not exists (select 1 from public.signing_financial_reports f join public.sources so on so.id = f.source_id
                        where f.signing_id = sid and f.component_type = 'SIGNING_BONUS' and f.record_status = 'ACTIVE' and f.report_origin = 'EXTERNAL_SOURCE'
                          and so.url = b ->> 'competing_url' and f.amount = (b ->> 'competing_amount')::numeric) then
        raise exception '060: Beltre no longer has exactly the two ACTIVE 046 bonus reports ($23,000 SABR, $17,000 ESPN.com / AP)';
      end if;
      bel := sid;
      this_applied := exists (select 1 from public.signing_financial_resolutions d where d.signing_id = sid and d.component_type = 'SIGNING_BONUS' and d.record_status = 'ACTIVE'
                              and d.selected_report_id = sel and d.basis = b ->> 'basis' and d.reviewed_by = b ->> 'reviewed_by'
                              and d.reviewed_at = (b ->> 'reviewed_at')::timestamptz and d.rationale = b ->> 'rationale');
      if exists (select 1 from public.signing_financial_resolutions d where d.signing_id = sid and d.record_status = 'ACTIVE') and not this_applied then
        raise exception '060: Beltre already has a different financial resolution; a second one is not recorded';
      end if;
      if (select signing_bonus_usd from public.signings where id = sid) is distinct from (case when this_applied then r.amount else r.before_bonus end) then
        raise exception '060: Beltre carries a canonical bonus that does not match the reviewed state';
      end if;
    end if;
    applied := applied + this_applied::int;
  end loop;
  if applied not in (0, 25) then
    raise exception '060: % of the 25 reviewed facts are present; a partial state is refused', applied;
  end if;
  -- on a first run the cost and ledger state is exactly the reviewed baseline
  if applied = 0 then
    if (select count(*) from public.v_signing_records where is_dodgers_franchise and total_known_acquisition_cost_usd is not null) <> (m -> 'baseline' ->> 'known')::int
       or (select count(*) from public.v_signing_records where is_dodgers_franchise and total_known_acquisition_cost_usd is null) <> (m -> 'baseline' ->> 'unknown')::int
       or (select coalesce(sum(total_known_acquisition_cost_usd), 0) from public.v_signing_records where is_dodgers_franchise) <> (m -> 'baseline' ->> 'known_usd')::numeric
       or (select count(*) from public.signings where signing_bonus_usd = 0) <> (m -> 'baseline' ->> 'zero_bonuses')::int then
      raise exception '060: the Dodgers acquisition-cost state is not the reviewed baseline (% known / % unknown)', (m -> 'baseline' ->> 'known'), (m -> 'baseline' ->> 'unknown');
    end if;
    if (select count(*) from public.signing_financial_reports where record_status = 'ACTIVE' and report_origin = 'EXTERNAL_SOURCE') <> (m -> 'baseline' ->> 'active_external')::int
       or (select count(*) from public.signing_financial_reports where record_status = 'ACTIVE' and report_origin = 'LEGACY_CARRYFORWARD') <> (m -> 'baseline' ->> 'active_legacy')::int
       or (select count(*) from public.signing_financial_reports where record_status = 'ACTIVE' and report_origin = 'RULE_DERIVED') <> (m -> 'baseline' ->> 'active_rule')::int
       or (select count(*) from public.signing_financial_resolutions where record_status = 'ACTIVE') <> (m -> 'baseline' ->> 'active_resolutions')::int then
      raise exception '060: the financial ledger is not the reviewed baseline';
    end if;
    if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
      raise exception '060: the product snapshots drift before 060';
    end if;
  end if;
  insert into _m060_state values (applied, (select max(generation_id) from public.product_executive_snapshot));
  raise notice '060 phase preconditions: done at +% (% of 25 already applied)', clock_timestamp() - now(), applied;
end $$;

-- inexpensive before-state: the cost counts and fingerprints of everything 060 must not move
create temporary table _m060_before on commit drop as
select (select count(*) from public.v_signing_records where is_dodgers_franchise and total_known_acquisition_cost_usd is not null)::int as known,
       (select coalesce(sum(total_known_acquisition_cost_usd), 0) from public.v_signing_records where is_dodgers_franchise) as known_usd,
       (select array_agg(id order by id) from public.signings where signing_bonus_usd = 0) as zero_ids,
       (select md5(coalesce(string_agg(md5(concat_ws('|', s.id, s.signing_bonus_usd, s.posting_fee_usd, s.transfer_fee_usd, s.bonus_publicly_reported, s.international_pool_treatment)), '' order by s.id), ''))
        from public.signings s where not s.id = any (select ids[1] from _m060_rows)) as other_signings,
       (select md5(coalesce(string_agg(md5(to_jsonb(f)::text), '' order by f.id), '')) from public.signing_financial_reports f
        where f.note is null or f.note not in (select note from _m060_rows)) as other_reports,
       (select md5(coalesce(string_agg(md5(to_jsonb(d)::text), '' order by d.id), '')) from public.signing_financial_resolutions d
        where d.rationale <> (select j -> 'beltre' ->> 'rationale' from _m060)) as other_resolutions,
       (select md5(coalesce(string_agg(md5(to_jsonb(e)::text), '' order by e.id), '')) from public.signing_environment_financial_reports e) as environment_reports;

-- ===========================================================================
-- 2. THE 24 OWNER-REVIEWED LEDGER FACTS AND CANONICAL BONUSES
-- ===========================================================================

create temporary table _m060_changed (n int) on commit drop;

do $$
declare
  r record;
begin
  for r in select * from _m060_rows where treatment = 'OWNER_REVIEWED_LEDGER_FACT' order by signing_year, slug loop
    if exists (select 1 from public.signing_financial_reports f where f.signing_id = r.ids[1] and f.component_type = 'SIGNING_BONUS' and f.record_status = 'ACTIVE'
               and f.report_origin = 'LEGACY_CARRYFORWARD' and f.amount = r.amount and f.note = r.note) then
      continue;
    end if;
    insert into public.signing_financial_reports (signing_id, component_type, amount, currency_code, report_origin, evidence_basis, confidence, note)
    values (r.ids[1], 'SIGNING_BONUS', r.amount, 'USD', 'LEGACY_CARRYFORWARD', 'LEGACY_CANONICAL_VALUE', ((select j ->> 'confidence' from _m060))::public.confidence_level, r.note);
    update public.signings set signing_bonus_usd = r.amount where id = r.ids[1];
    insert into _m060_changed values (1);
  end loop;
  raise notice '060 phase ledger facts: done at +% (% written)', clock_timestamp() - now(), (select count(*) from _m060_changed);
end $$;

-- ===========================================================================
-- 3. BELTRE: A REVIEWED RESOLUTION OF THE EXISTING 046 CONFLICT
-- ===========================================================================

do $$
declare
  b jsonb := (select j -> 'beltre' from _m060);
  sid uuid := (select ids[1] from _m060_rows where treatment = 'RESOLVE_EXISTING_CONFLICT');
  sel uuid;
begin
  select f.id into sel from public.signing_financial_reports f join public.sources so on so.id = f.source_id
  where f.signing_id = sid and f.component_type = 'SIGNING_BONUS' and f.record_status = 'ACTIVE' and so.url = b ->> 'selected_url' and f.amount = (b ->> 'selected_amount')::numeric;
  if not exists (select 1 from public.signing_financial_resolutions d where d.signing_id = sid and d.component_type = 'SIGNING_BONUS' and d.record_status = 'ACTIVE') then
    insert into public.signing_financial_resolutions (signing_id, component_type, selected_report_id, basis, rationale, reviewed_by, reviewed_at)
    values (sid, 'SIGNING_BONUS', sel, b ->> 'basis', b ->> 'rationale', b ->> 'reviewed_by', (b ->> 'reviewed_at')::timestamptz);
    update public.signings set signing_bonus_usd = (b ->> 'selected_amount')::numeric where id = sid;
    insert into _m060_changed values (1);
  end if;
  raise notice '060 phase resolution: done at +%', clock_timestamp() - now();
end $$;

-- ===========================================================================
-- 4. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  m jsonb := (select j from _m060);
  b jsonb := m -> 'beltre';
  st record;
  bf record;
  r record;
  cur record;
  first_run boolean;
begin
  select * into st from _m060_state;
  select * into bf from _m060_before;
  first_run := st.applied = 0;
  for r in select * from _m060_rows order by signing_year, slug loop
    select s.signing_bonus_usd, s.bonus_publicly_reported, v.bonus_status, v.bonus_source_status, v.resolved_components, v.known_acquisition_cost_usd
      into cur from public.signings s join public.v_signing_acquisition_financials v on v.signing_id = s.id where s.id = r.ids[1];
    if cur.signing_bonus_usd is distinct from r.amount or cur.bonus_publicly_reported is distinct from r.before_reported or cur.bonus_status <> 'KNOWN'
       or cur.known_acquisition_cost_usd is distinct from r.amount then
      raise exception '060 postcondition: % must be KNOWN at % (got %, %), with the public-report flag unchanged', r.slug, r.amount, cur.signing_bonus_usd, cur.bonus_status;
    end if;
    if r.treatment = 'OWNER_REVIEWED_LEDGER_FACT' then
      if cur.bonus_source_status <> 'LEGACY_CANONICAL_ONLY'
         or (select count(*) from public.signing_financial_reports x where x.signing_id = r.ids[1] and x.component_type = 'SIGNING_BONUS' and x.record_status = 'ACTIVE') <> 1
         or not exists (select 1 from public.signing_financial_reports x where x.signing_id = r.ids[1] and x.component_type = 'SIGNING_BONUS' and x.record_status = 'ACTIVE'
                        and x.report_origin = 'LEGACY_CARRYFORWARD' and x.source_id is null and x.amount_basis is null and x.evidence_basis = 'LEGACY_CANONICAL_VALUE'
                        and x.amount = r.amount and x.note = r.note) then
        raise exception '060 postcondition: % must carry exactly one unsourced owner-reviewed report (source status %)', r.slug, cur.bonus_source_status;
      end if;
    else
      if cur.bonus_source_status <> 'EXTERNALLY_SOURCED' or not ('SIGNING_BONUS' = any (cur.resolved_components))
         or (select count(*) from public.signing_financial_reports x where x.signing_id = r.ids[1] and x.component_type = 'SIGNING_BONUS' and x.record_status = 'ACTIVE') <> 2
         or (select count(*) from public.signing_financial_resolutions d where d.signing_id = r.ids[1] and d.record_status = 'ACTIVE') <> 1
         or not exists (select 1 from public.signing_financial_resolutions d join public.signing_financial_reports x on x.id = d.selected_report_id
                        join public.sources so on so.id = x.source_id
                        where d.signing_id = r.ids[1] and d.record_status = 'ACTIVE' and d.basis = b ->> 'basis' and so.url = b ->> 'selected_url'
                          and x.amount = (b ->> 'selected_amount')::numeric and x.record_status = 'ACTIVE') then
        raise exception '060 postcondition: Beltre must be RESOLVED to the existing $23,000 report with both 046 reports ACTIVE';
      end if;
    end if;
  end loop;
  if (select sum(s.signing_bonus_usd) from public.signings s where s.id = any (select ids[1] from _m060_rows)) <> (m ->> 'total_usd')::numeric then
    raise exception '060 postcondition: the 25 reviewed bonuses do not total %', m ->> 'total_usd';
  end if;
  -- the cost counts: +25 known on a first run, nothing on a rerun
  if (select count(*) from public.v_signing_records where is_dodgers_franchise and total_known_acquisition_cost_usd is not null) <> (m -> 'after' ->> 'known')::int
     or (select count(*) from public.v_signing_records where is_dodgers_franchise and total_known_acquisition_cost_usd is null) <> (m -> 'after' ->> 'unknown')::int
     or (select count(*) from public.v_signing_records where is_dodgers_franchise and total_known_acquisition_cost_usd is not null) <> bf.known + (case when first_run then 25 else 0 end)
     or (select coalesce(sum(total_known_acquisition_cost_usd), 0) from public.v_signing_records where is_dodgers_franchise)
        <> bf.known_usd + (case when first_run then (m ->> 'total_usd')::numeric else 0 end) then
    raise exception '060 postcondition: the Dodgers cost counts are not % known / % unknown', m -> 'after' ->> 'known', m -> 'after' ->> 'unknown';
  end if;
  -- KNOWN ZERO != UNKNOWN: the only new zero is the reviewed one
  if (select array_agg(id order by id) from public.signings where signing_bonus_usd = 0) is distinct from
     (select array_agg(x order by x) from (select unnest(coalesce(bf.zero_ids, '{}'))
        union select ids[1] from _m060_rows where known_zero) z(x)) then
    raise exception '060 postcondition: a zero bonus other than the reviewed known zero exists';
  end if;
  -- nothing else moved: every other signing's money columns, every other ledger row and resolution, the environment ledger
  if (select md5(coalesce(string_agg(md5(concat_ws('|', s.id, s.signing_bonus_usd, s.posting_fee_usd, s.transfer_fee_usd, s.bonus_publicly_reported, s.international_pool_treatment)), '' order by s.id), ''))
      from public.signings s where not s.id = any (select ids[1] from _m060_rows)) <> bf.other_signings
     or (select md5(coalesce(string_agg(md5(to_jsonb(f)::text), '' order by f.id), '')) from public.signing_financial_reports f
         where f.note is null or f.note not in (select note from _m060_rows)) <> bf.other_reports
     or (select md5(coalesce(string_agg(md5(to_jsonb(d)::text), '' order by d.id), '')) from public.signing_financial_resolutions d
         where d.rationale <> b ->> 'rationale') <> bf.other_resolutions
     or (select md5(coalesce(string_agg(md5(to_jsonb(e)::text), '' order by e.id), '')) from public.signing_environment_financial_reports e) <> bf.environment_reports then
    raise exception '060 postcondition: a signing, ledger row, resolution or environment fact outside the 25 reviewed signings changed';
  end if;
  if first_run and ((select count(*) from _m060_changed) <> 25) then
    raise exception '060 postcondition: a first run must record exactly 25 facts (recorded %)', (select count(*) from _m060_changed);
  end if;
  if not first_run and exists (select 1 from _m060_changed) then
    raise exception '060 postcondition: a rerun changed a value';
  end if;
  raise notice '060 phase postconditions: done at +%', clock_timestamp() - now();
end $$;

-- ===========================================================================
-- 5. GENERATION: one coherent refresh, only when this run changed a value
-- ===========================================================================

do $$
declare
  st record;
  tn text;
  g bigint[];
  want bigint;
begin
  select * into st from _m060_state;
  want := st.generation + case when exists (select 1 from _m060_changed) then 1 else 0 end;
  if exists (select 1 from _m060_changed) then
    perform * from public.disi_refresh_product_snapshots();
  end if;
  if (select max(generation_id) from public.product_executive_snapshot) <> want
     or exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    raise exception '060 postcondition: expected one drift-free generation % (a refresh only when a value changed)', want;
  end if;
  for tn in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'product\_%' order by 1 loop
    execute format('select array_agg(distinct generation_id) from public.%I', tn) into g;
    if g is distinct from array[want] then
      raise exception '060 postcondition: snapshot % is not at the single generation %', tn, want;
    end if;
  end loop;
  raise notice '060 phase snapshots: done at +% (generation %)', clock_timestamp() - now(), want;
end $$;

commit;
