-- DISI 046: logical rollback of the research batch (WRITE; run only with explicit owner approval, after a failed post-release verification).
--
-- Built from database/research/046/ (research-evidence.json); regenerate with: node database/research/046/build.mjs
--
-- 046 inserted ten ACTIVE signing-bonus reports and set eight canonical bonuses. Financial reports are never deleted (the ledger
-- seals them), so this file RETRACTS exactly those ten reports with a stated reason, returns the eight canonical bonuses to NULL / false
-- (their state before 046) and refreshes the product snapshots once. The eight source rows are provenance of what was read and stay.
--
-- It is guarded: it refuses to run unless all ten reports are present and ACTIVE, and unless nothing else has been recorded for the nine
-- signings since (no further bonus report, no resolution). One transaction. After a rollback the reports are RETRACTED, so migration 046
-- must not be re-applied (its idempotency check recognises a retracted report as already applied); re-release needs a new migration.

begin;

create temporary table _r046 on commit drop as
select $r046${{payload_json}}$r046$::jsonb as j;

do $$
declare
  e jsonb;
  sid uuid;
  active_n int;
  expected_n int;
begin
  if to_regclass('public.product_database_status') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null then
    raise exception 'rollback-046: this is not a 045b database';
  end if;
  for e in select x from _r046, jsonb_array_elements(j -> 'signing_reports') x loop
    select sg.id into sid from public.signings sg join public.players p on p.id = sg.player_id
    join public.organizations o on o.id = sg.organization_id and o.name = (select j ->> 'organization_name' from _r046)
    where p.slug = e ->> 'player_slug' and sg.signing_year = (e ->> 'signing_year')::int;
    if sid is null then
      raise exception 'rollback-046: the signing for % is missing', e ->> 'player_slug';
    end if;
    if not exists (select 1 from public.signing_financial_reports r join public.sources so on so.id = r.source_id
                   where r.signing_id = sid and r.component_type = 'SIGNING_BONUS' and r.record_status = 'ACTIVE'
                     and so.url = e ->> 'source_url' and r.amount = (e ->> 'amount')::numeric) then
      raise exception 'rollback-046: report % is not present and ACTIVE; this database is not in the post-046 state', e ->> 'ref';
    end if;
    select count(*) into active_n from public.signing_financial_reports
    where signing_id = sid and component_type = 'SIGNING_BONUS' and record_status = 'ACTIVE';
    select count(*) into expected_n from _r046, jsonb_array_elements(j -> 'signing_reports') y
    where y ->> 'player_slug' = e ->> 'player_slug' and (y ->> 'signing_year') = e ->> 'signing_year';
    if active_n <> expected_n then
      raise exception 'rollback-046: % has % active bonus reports but 046 wrote %; later research exists', e ->> 'player_slug', active_n, expected_n;
    end if;
    if to_regclass('public.signing_financial_resolutions') is not null and exists (
         select 1 from public.signing_financial_resolutions where signing_id = sid and component_type = 'SIGNING_BONUS' and record_status = 'ACTIVE') then
      raise exception 'rollback-046: a bonus resolution exists for %', e ->> 'player_slug';
    end if;
  end loop;
end $$;

-- 1. retract exactly the reports 046 wrote
update public.signing_financial_reports r
set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'Migration 046 rolled back.'
from _r046, jsonb_array_elements(j -> 'signing_reports') e, public.sources so, public.signings sg, public.players p
where r.record_status = 'ACTIVE' and r.component_type = 'SIGNING_BONUS'
  and so.id = r.source_id and so.url = e ->> 'source_url' and r.amount = (e ->> 'amount')::numeric
  and sg.id = r.signing_id and p.id = sg.player_id and p.slug = e ->> 'player_slug' and sg.signing_year = (e ->> 'signing_year')::int;

-- 2. return the canonical bonuses 046 set to their pre-046 state (unknown, not publicly reported)
update public.signings sg
set signing_bonus_usd = null, bonus_publicly_reported = false
from _r046, jsonb_array_elements(j -> 'signing_reports') e, public.players p
where e ->> 'kind' = 'NEW' and p.id = sg.player_id and p.slug = e ->> 'player_slug' and sg.signing_year = (e ->> 'signing_year')::int
  and sg.signing_bonus_usd = (e ->> 'amount')::numeric;

-- 3. postconditions
do $$
declare
  e jsonb;
  status text;
begin
  for e in select x from _r046, jsonb_array_elements(j -> 'signing_reports') x loop
    select f.bonus_status into status from public.v_signing_acquisition_financials f
    join public.signings sg on sg.id = f.signing_id join public.players p on p.id = sg.player_id
    where p.slug = e ->> 'player_slug' and sg.signing_year = (e ->> 'signing_year')::int;
    if status <> 'UNKNOWN' then
      raise exception 'rollback-046 postcondition: % is % instead of UNKNOWN', e ->> 'player_slug', status;
    end if;
  end loop;
end $$;

-- 4. one coherent generation without the research
do $$
begin
  perform * from public.disi_refresh_product_snapshots();
end $$;

commit;
