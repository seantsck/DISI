-- DISI rollback of Migration 060 (owner-reviewed acquisition costs). WRITE: run only with explicit owner approval.
--
-- Built from database/research/060/ (research-evidence.json, baseline.json); regenerate with: node database/research/060/build.mjs
--
-- 060 recorded 24 owner-reviewed SIGNING_BONUS ledger reports (unsourced-canonical path), set those 24 canonical bonuses, recorded one reviewed
-- resolution of Adrian Beltre's existing 046 conflict and set his canonical bonus to the selected $23,000. The ledger never deletes, so this file:
--   * RETRACTS exactly the 24 reports 060 wrote, with a stated reason;
--   * RETRACTS the Beltre resolution 060 wrote, so his $23,000 / $17,000 conflict is unresolved again;
--   * returns the 25 canonical bonuses to their exact pre-060 values (NULL) and asserts bonus_publicly_reported is still its pre-060 value
--     (060 never changes it);
--   * keeps every pre-existing report, including both Beltre reports (ACTIVE), and refreshes the product snapshots once.
-- It is guarded: it refuses unless all 25 facts are present exactly as 060 wrote them and nothing later depends on them (no other ACTIVE bonus
-- report or resolution for the 25, no report superseding a 060 report, no resolution selecting one). One transaction. 060 can be reapplied
-- afterwards: it records the facts again as new ACTIVE rows; the retracted rows stay as history.

begin;
set local statement_timeout = '600s';

create temporary table _r060 on commit drop as
select $r060${"after":{"known":81,"known_usd":"127632237.33","unknown":139},"baseline":{"active_external":42,"active_legacy":88,"active_resolutions":0,"active_rule":0,"known":56,"known_usd":"121700237.33","unknown":164,"zero_bonuses":0},"beltre":{"basis":"OTHER_REVIEWED","competing_amount":"17000.00","competing_url":"https://a.espncdn.com/mlb/news/1999/1221/246027.html","player_slug":"adrian-beltre","rationale":"Owner-reviewed 060 acquisition-cost input (2026-11-04) accepts the existing $23,000 SABR Biography Project report for canonical DISI use. The $17,000 ESPN.com (Associated Press) report stays ACTIVE and the disagreement remains visible.","reviewed_at":"2026-11-04T00:00:00Z","reviewed_by":"Sean Cannon","selected_amount":"23000.00","selected_url":"https://sabr.org/bioproj/person/adrian-beltre/","signing_year":1994},"bonuses":[{"amount":"23000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"adrian-beltre","signing_year":1994,"treatment":"RESOLVE_EXISTING_CONFLICT"},{"amount":"75000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"carlos-santana","signing_year":2004,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"0.00","before_bonus":null,"before_reported":false,"known_zero":true,"player_slug":"pedro-astacio","signing_year":1987,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"200000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"pedro-baez","signing_year":2007,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"1400000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"willy-aybar","signing_year":2000,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"3000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"roger-cedeno","signing_year":1991,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"161000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"victor-gonzalez","signing_year":2012,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"15000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"rubby-de-la-rosa","signing_year":2007,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"15000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"elian-herrera","signing_year":2003,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"300000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"jorbit-vivas","signing_year":2017,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"50000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"jose-dominguez","signing_year":2007,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"600000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"miguel-droz","signing_year":2018,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"10000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"kelvin-ramirez","signing_year":2021,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"30000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"thayron-liranzo","signing_year":2021,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"10000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"aldrin-batista","signing_year":2022,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"75000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"alexander-albertus","signing_year":2022,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"397500.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"jeral-perez","signing_year":2022,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"320000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"mairoshendrick-martinus","signing_year":2022,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"757500.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"samuel-munoz","signing_year":2022,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"17500.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"sean-linan","signing_year":2022,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"50000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"aneudy-almonte","signing_year":2025,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"225000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"samuel-savinon","signing_year":2025,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"200000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"shai-romero","signing_year":2025,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"700000.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"arnaldo-lantigua","signing_year":2023,"treatment":"OWNER_REVIEWED_LEDGER_FACT"},{"amount":"297500.00","before_bonus":null,"before_reported":false,"known_zero":false,"player_slug":"eduardo-quintero","signing_year":2023,"treatment":"OWNER_REVIEWED_LEDGER_FACT"}],"confidence":"UNVERIFIED","known_zero_note":"Owner-reviewed acquisition-cost input supplied 2026-11-04; no external citation retained in this research batch. The reviewed amount is a known $0.00 bonus, not an unknown value.","note":"Owner-reviewed acquisition-cost input supplied 2026-11-04; no external citation retained in this research batch.","organization_name":"Los Angeles Dodgers","total_usd":"5932000.00"}$r060$::jsonb as j;

create temporary table _r060_rows on commit drop as
select x ->> 'player_slug' as slug, (x ->> 'signing_year')::int as signing_year, (x ->> 'amount')::numeric(14,2) as amount, x ->> 'treatment' as treatment,
       (x ->> 'known_zero')::boolean as known_zero, (x ->> 'before_bonus')::numeric(14,2) as before_bonus, (x ->> 'before_reported')::boolean as before_reported,
       case when (x ->> 'known_zero')::boolean then m.j ->> 'known_zero_note' else m.j ->> 'note' end as note,
       (select array_agg(sg.id) from public.signings sg join public.players p on p.id = sg.player_id join public.organizations o on o.id = sg.organization_id
        where p.slug = x ->> 'player_slug' and sg.signing_year = (x ->> 'signing_year')::int and o.name = m.j ->> 'organization_name') as ids
from _r060 m, jsonb_array_elements(m.j -> 'bonuses') x;

-- the rows 060 wrote, found exactly (the 24 reports and the one resolution)
create temporary table _r060_reports on commit drop as
select f.id, r.slug from _r060_rows r join public.signing_financial_reports f on f.signing_id = r.ids[1]
where r.treatment = 'OWNER_REVIEWED_LEDGER_FACT' and f.component_type = 'SIGNING_BONUS' and f.record_status = 'ACTIVE'
  and f.report_origin = 'LEGACY_CARRYFORWARD' and f.amount = r.amount and f.note = r.note;
create temporary table _r060_resolution on commit drop as
select d.id from _r060_rows r join public.signing_financial_resolutions d on d.signing_id = r.ids[1], _r060 m
where r.treatment = 'RESOLVE_EXISTING_CONFLICT' and d.component_type = 'SIGNING_BONUS' and d.record_status = 'ACTIVE'
  and d.basis = m.j -> 'beltre' ->> 'basis' and d.reviewed_by = m.j -> 'beltre' ->> 'reviewed_by'
  and d.reviewed_at = (m.j -> 'beltre' ->> 'reviewed_at')::timestamptz and d.rationale = m.j -> 'beltre' ->> 'rationale';

-- ===========================================================================
-- 1. GUARDS
-- ===========================================================================

do $$
declare
  m jsonb := (select j from _r060);
  r record;
begin
  if to_regclass('public.signing_financial_resolutions') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null then
    raise exception 'rollback-060: this is not a post-059 database';
  end if;
  if (select count(*) from _r060_rows) <> 25 or exists (select 1 from _r060_rows where cardinality(coalesce(ids, '{}')) <> 1) then
    raise exception 'rollback-060: the 25 reviewed signings do not each resolve to exactly one Dodgers signing';
  end if;
  if not exists (select 1 from _r060_reports) and not exists (select 1 from _r060_resolution) then
    raise exception 'rollback-060: Migration 060 is not applied';
  end if;
  if (select count(*) from _r060_reports) <> 24 or (select count(distinct slug) from _r060_reports) <> 24 or (select count(*) from _r060_resolution) <> 1 then
    raise exception 'rollback-060: % of the 24 reports and % of the one resolution 060 wrote are present; a partial state is refused',
      (select count(*) from _r060_reports), (select count(*) from _r060_resolution);
  end if;
  for r in select * from _r060_rows order by signing_year, slug loop
    if (select signing_bonus_usd from public.signings where id = r.ids[1]) is distinct from r.amount then
      raise exception 'rollback-060: % no longer carries the 060 bonus %; a later decision exists', r.slug, r.amount;
    end if;
    if (select bonus_publicly_reported from public.signings where id = r.ids[1]) is distinct from r.before_reported then
      raise exception 'rollback-060: the public-report flag of % changed after 060', r.slug;
    end if;
    if r.treatment = 'OWNER_REVIEWED_LEDGER_FACT' then
      if (select count(*) from public.signing_financial_reports f where f.signing_id = r.ids[1] and f.component_type = 'SIGNING_BONUS' and f.record_status = 'ACTIVE') <> 1
         or exists (select 1 from public.signing_financial_resolutions d where d.signing_id = r.ids[1] and d.record_status = 'ACTIVE') then
        raise exception 'rollback-060: % has a later bonus report or resolution; rollback refused', r.slug;
      end if;
    else
      if (select count(*) from public.signing_financial_reports f where f.signing_id = r.ids[1] and f.component_type = 'SIGNING_BONUS' and f.record_status = 'ACTIVE') <> 2
         or (select count(*) from public.signing_financial_resolutions d where d.signing_id = r.ids[1] and d.record_status = 'ACTIVE') <> 1 then
        raise exception 'rollback-060: Beltre has a later bonus report or resolution; rollback refused';
      end if;
    end if;
  end loop;
  if exists (select 1 from public.signing_financial_reports f where f.supersedes_report_id in (select id from _r060_reports))
     or exists (select 1 from public.signing_financial_resolutions d where d.selected_report_id in (select id from _r060_reports))
     or exists (select 1 from public.signing_financial_resolutions d where d.supersedes_resolution_id in (select id from _r060_resolution)) then
    raise exception 'rollback-060: a later financial decision depends on 060; rollback refused';
  end if;
  raise notice 'rollback-060 phase guards: done at +%', clock_timestamp() - now();
end $$;

create temporary table _r060_before on commit drop as
select (select count(*) from public.v_signing_records where is_dodgers_franchise and total_known_acquisition_cost_usd is not null)::int as known,
       (select coalesce(sum(total_known_acquisition_cost_usd), 0) from public.v_signing_records where is_dodgers_franchise) as known_usd,
       (select max(generation_id) from public.product_executive_snapshot) as generation,
       (select md5(coalesce(string_agg(md5(concat_ws('|', s.id, s.signing_bonus_usd, s.posting_fee_usd, s.transfer_fee_usd, s.bonus_publicly_reported, s.international_pool_treatment)), '' order by s.id), ''))
        from public.signings s where not s.id = any (select ids[1] from _r060_rows)) as other_signings,
       (select md5(coalesce(string_agg(md5(to_jsonb(f)::text), '' order by f.id), '')) from public.signing_financial_reports f
        where not f.id in (select id from _r060_reports)) as other_reports,
       (select md5(coalesce(string_agg(md5(to_jsonb(d)::text), '' order by d.id), '')) from public.signing_financial_resolutions d
        where not d.id in (select id from _r060_resolution)) as other_resolutions;

-- ===========================================================================
-- 2. RETRACT AND RESTORE
-- ===========================================================================

update public.signing_financial_reports set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'Migration 060 rolled back.'
where id in (select id from _r060_reports);
update public.signing_financial_resolutions set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'Migration 060 rolled back.'
where id in (select id from _r060_resolution);
update public.signings s set signing_bonus_usd = r.before_bonus from _r060_rows r where s.id = r.ids[1];

do $$
begin
  raise notice 'rollback-060 phase retract: done at +%', clock_timestamp() - now();
end $$;

-- ===========================================================================
-- 3. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  m jsonb := (select j from _r060);
  bf record;
  r record;
  cur record;
begin
  select * into bf from _r060_before;
  for r in select * from _r060_rows order by signing_year, slug loop
    select s.signing_bonus_usd, s.bonus_publicly_reported, v.bonus_status into cur
    from public.signings s join public.v_signing_acquisition_financials v on v.signing_id = s.id where s.id = r.ids[1];
    if cur.signing_bonus_usd is distinct from r.before_bonus or cur.bonus_publicly_reported is distinct from r.before_reported
       or cur.bonus_status <> (case when r.treatment = 'RESOLVE_EXISTING_CONFLICT' then 'CONFLICT' else 'UNKNOWN' end) then
      raise exception 'rollback-060 postcondition: % is % (bonus %) instead of its pre-060 state', r.slug, cur.bonus_status, cur.signing_bonus_usd;
    end if;
  end loop;
  -- Beltre: both 046 reports ACTIVE, no ACTIVE resolution
  if (select count(*) from public.signing_financial_reports f join _r060_rows rw on f.signing_id = rw.ids[1]
      where rw.treatment = 'RESOLVE_EXISTING_CONFLICT' and f.component_type = 'SIGNING_BONUS' and f.record_status = 'ACTIVE') <> 2
     or exists (select 1 from public.signing_financial_resolutions d join _r060_rows rw on d.signing_id = rw.ids[1] where d.record_status = 'ACTIVE') then
    raise exception 'rollback-060 postcondition: Beltre must be back to the two ACTIVE 046 reports with no resolution';
  end if;
  if (select count(*) from public.v_signing_records where is_dodgers_franchise and total_known_acquisition_cost_usd is not null) <> bf.known - 25
     or (select coalesce(sum(total_known_acquisition_cost_usd), 0) from public.v_signing_records where is_dodgers_franchise) <> bf.known_usd - (m ->> 'total_usd')::numeric
     or exists (select 1 from public.signings s join _r060_rows rw on s.id = rw.ids[1] where s.signing_bonus_usd = 0) then
    raise exception 'rollback-060 postcondition: the cost counts did not return by exactly the 25 reviewed signings';
  end if;
  if (select md5(coalesce(string_agg(md5(concat_ws('|', s.id, s.signing_bonus_usd, s.posting_fee_usd, s.transfer_fee_usd, s.bonus_publicly_reported, s.international_pool_treatment)), '' order by s.id), ''))
      from public.signings s where not s.id = any (select ids[1] from _r060_rows)) <> bf.other_signings
     or (select md5(coalesce(string_agg(md5(to_jsonb(f)::text), '' order by f.id), '')) from public.signing_financial_reports f
         where not f.id in (select id from _r060_reports)) <> bf.other_reports
     or (select md5(coalesce(string_agg(md5(to_jsonb(d)::text), '' order by d.id), '')) from public.signing_financial_resolutions d
         where not d.id in (select id from _r060_resolution)) <> bf.other_resolutions then
    raise exception 'rollback-060 postcondition: a signing, report or resolution outside 060 changed';
  end if;
  raise notice 'rollback-060 phase postconditions: done at +%', clock_timestamp() - now();
end $$;

-- ===========================================================================
-- 4. GENERATION: one coherent refresh without the 060 values
-- ===========================================================================

do $$
declare
  bf record;
  tn text;
  g bigint[];
begin
  select * into bf from _r060_before;
  perform * from public.disi_refresh_product_snapshots();
  if (select max(generation_id) from public.product_executive_snapshot) <> bf.generation + 1
     or exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    raise exception 'rollback-060 postcondition: the refresh did not produce exactly one new drift-free generation';
  end if;
  for tn in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'product\_%' order by 1 loop
    execute format('select array_agg(distinct generation_id) from public.%I', tn) into g;
    if g is distinct from array[bf.generation + 1] then
      raise exception 'rollback-060 postcondition: snapshot % is not at the single generation %', tn, bf.generation + 1;
    end if;
  end loop;
  raise notice 'rollback-060 phase snapshots: done at +% (generation %)', clock_timestamp() - now(), bf.generation + 1;
end $$;

commit;
