-- DISI v0.22
-- 031_financial_provenance_coverage_expansion.sql
-- Financial provenance and coverage expansion over the 030 ledger. Run after 030.
--
-- Built from database/research/031/ (seed-evidence.json, audit.mjs, build.mjs).
--
-- What this is. A research-data migration plus one small reviewed-decision object. It adds no
-- analytics. It fills facts that directly read sources state and improves their provenance.
--
-- What it does:
--   * Adds signing_financial_resolutions: a reviewed decision that says WHICH of several competing
--     ACTIVE reports DISI accepts as canonical for one signing and component. A source report records
--     what a source said; a resolution records what DISI currently accepts. Reports are never
--     rewritten, and the disagreement stays visible. A decision is allowed only where at least two
--     ACTIVE reports disagree, is sealed once recorded, is never deleted, and a later decision
--     supersedes (and retires) its predecessor. A correction of an unsourced legacy value is NOT a
--     resolution: it is an ordinary supersession of the legacy carry-forward row.
--     No decision is recorded in 031 (Sasaki stays unresolved; Rosario and Torres are deferred).
--   * Adds UNIQUE (id, signing_id, component_type) to signing_financial_reports (additive) so a
--     decision's selected report is tied to the same signing and component by a composite foreign key.
--   * Replaces v_signing_acquisition_financials (same columns plus resolved_components at the end) so a
--     component with an ACTIVE decision is RESOLVED to the selected report instead of CONFLICT.
--   * Pool capacity: environments for the Dodgers 2012-13, 2013-14, 2014-15 and 2020-21 periods, a pool
--     for the existing 2017-18 environment, and externally sourced BASE_POOL reports for all of them.
--     The existing 2021-22 pool ($4,644,000) is the sourced post-penalty allocation; the $500,000
--     Trevor Bauer penalty is recorded as a memo and is never subtracted again.
--   * Provenance: externally sourced reports for known bonuses that carried only a legacy
--     carry-forward (the legacy row stays ACTIVE as corroboration), and externally sourced bonuses for
--     four signings whose bonus was unknown.
--   * One correction: Carlos Rincon's unsourced legacy $350,000 is superseded by Baseball America's
--     directly read $325,000.
--   * Links Dodgers signings to the four added environments (and the 2017-18 environment) by supported
--     period membership: the signing date lies inside the period window. Pathway does not decide
--     membership, and international_pool_treatment is untouched.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA (database/research/031/seed-evidence.json)
-- ===========================================================================

create temporary table _m031 on commit drop as
select $m031${{payload_json}}$m031$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 031 was written for
-- ===========================================================================

do $$
declare
  e jsonb;
  org uuid;
  n int;
  r record;
begin
  if to_regclass('public.signing_financial_reports') is null or to_regclass('public.signing_environment_financial_reports') is null
     or to_regclass('public.v_signing_acquisition_financials') is null then
    raise exception '031: Migration 030 has not been applied';
  end if;
  select id into org from public.organizations where name = (select j ->> 'organization_name' from _m031);
  if org is null then
    raise exception '031: the Dodgers organization is missing';
  end if;

  -- every seeded signing exists once, and its canonical bonus is the pre-031 value (or already the 031 value on a rerun)
  for e in select x from _m031, jsonb_array_elements(j -> 'signing_reports') x loop
    select count(*) into n from public.signings sg join public.players p on p.id = sg.player_id
    where p.slug = e ->> 'player_slug' and sg.organization_id = org and sg.signing_year = (e ->> 'signing_year')::int;
    if n <> 1 then
      raise exception '031: expected exactly one Dodgers signing for % %, found %', e ->> 'player_slug', e ->> 'signing_year', n;
    end if;
    select sg.signing_bonus_usd as b into r from public.signings sg join public.players p on p.id = sg.player_id
    where p.slug = e ->> 'player_slug' and sg.organization_id = org and sg.signing_year = (e ->> 'signing_year')::int;
    if e ->> 'kind' = 'NEW' and r.b is not null and r.b <> (e ->> 'amount')::numeric then
      raise exception '031: % already has a different bonus (%)', e ->> 'player_slug', r.b;
    elsif e ->> 'kind' = 'UPGRADE' and r.b is distinct from (e ->> 'amount')::numeric then
      raise exception '031: % has an unexpected bonus (%)', e ->> 'player_slug', r.b;
    elsif e ->> 'kind' = 'CORRECTION' and r.b not in ((e ->> 'legacy_amount')::numeric, (e ->> 'amount')::numeric) then
      raise exception '031: % has an unexpected bonus (%)', e ->> 'player_slug', r.b;
    end if;
  end loop;

  -- the environments the seed extends exist in the expected state
  for e in select x from _m031, jsonb_array_elements(j -> 'environment_column_updates') x loop
    select se.club_bonus_pool_usd as pool into r from public.signing_environments se
    where se.organization_id = org and se.signing_year = (e ->> 'signing_year')::int;
    if not found then
      raise exception '031: the Dodgers % environment is missing', e ->> 'signing_year';
    end if;
    if r.pool is not null and r.pool <> (e ->> 'to')::numeric then
      raise exception '031: the Dodgers % environment already has a different pool (%)', e ->> 'signing_year', r.pool;
    end if;
  end loop;
  select se.club_bonus_pool_usd as pool into r from public.signing_environments se where se.organization_id = org and se.signing_year = 2022;
  if r.pool is distinct from 4644000 then
    raise exception '031: the Dodgers 2021-22 environment does not carry the reviewed $4,644,000 allocation';
  end if;

  -- sources the seed cites as already registered
  for e in select x from _m031, jsonb_array_elements(j -> 'existing_sources') x loop
    if not exists (select 1 from public.sources where url = e #>> '{}') then
      raise exception '031: expected source % is not registered', e #>> '{}';
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 2. SCHEMA: reviewed financial-report resolutions
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.signing_financial_reports'::regclass and conname = 'signing_financial_reports_id_signing_component_key') then
    alter table public.signing_financial_reports add constraint signing_financial_reports_id_signing_component_key unique (id, signing_id, component_type);
  end if;
end $$;

create table if not exists public.signing_financial_resolutions (
  id uuid primary key default gen_random_uuid(),
  signing_id uuid not null,
  component_type text not null check (component_type in ('SIGNING_BONUS', 'POSTING_FEE', 'TRANSFER_FEE', 'RELEASE_FEE', 'POOL_CHARGE', 'OTHER_ACQUISITION_FEE')),
  selected_report_id uuid not null,
  basis text not null check (basis in ('AUTHORITATIVE_RULE', 'SOURCE_PRECEDENCE', 'OTHER_REVIEWED')),
  source_id uuid references public.sources(id) on delete restrict,
  rationale text not null check (nullif(btrim(rationale), '') is not null and char_length(rationale) <= 600),
  reviewed_by text not null check (nullif(btrim(reviewed_by), '') is not null),
  reviewed_at timestamptz not null,
  record_status text not null default 'ACTIVE' check (record_status in ('ACTIVE', 'RETRACTED')),
  supersedes_resolution_id uuid references public.signing_financial_resolutions(id) on delete restrict,
  retracted_at timestamptz,
  retraction_reason text,
  created_at timestamptz not null default now(),
  constraint signing_financial_resolutions_report_fkey foreign key (selected_report_id, signing_id, component_type)
    references public.signing_financial_reports (id, signing_id, component_type) on delete restrict,
  constraint signing_financial_resolutions_signing_fkey foreign key (signing_id) references public.signings(id) on delete restrict,
  -- an authoritative-rule decision cites the rule's source
  constraint signing_financial_resolutions_source_check check (basis <> 'AUTHORITATIVE_RULE' or source_id is not null),
  constraint signing_financial_resolutions_supersedes_check check (supersedes_resolution_id is null or supersedes_resolution_id <> id),
  constraint signing_financial_resolutions_retraction_check check ((record_status = 'RETRACTED') = (retracted_at is not null)
    and (record_status = 'ACTIVE' or nullif(btrim(retraction_reason), '') is not null)
    and (record_status = 'RETRACTED' or retraction_reason is null))
);
create unique index if not exists signing_financial_resolutions_active_key on public.signing_financial_resolutions (signing_id, component_type)
  where record_status = 'ACTIVE';
create unique index if not exists signing_financial_resolutions_supersedes_key on public.signing_financial_resolutions (supersedes_resolution_id)
  where supersedes_resolution_id is not null;
create index if not exists signing_financial_resolutions_report_idx on public.signing_financial_resolutions (selected_report_id);

comment on table public.signing_financial_resolutions is
  'Reviewed decisions: which of several competing ACTIVE source-backed reports DISI accepts as canonical for one signing and component. A report records what a source said; a resolution records what DISI accepts. Reports are never rewritten and the disagreement stays visible. Allowed only while at least two ACTIVE reports disagree. A correction of an unsourced legacy value is a supersession of the legacy row, not a resolution. Absence of a row means unresolved.';
comment on column public.signing_financial_resolutions.basis is
  'AUTHORITATIVE_RULE (source_id cites the rule), SOURCE_PRECEDENCE (one source is preferred over another, stated in the rationale) or OTHER_REVIEWED.';

create or replace function public.disi_signing_financial_resolution_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  sel public.signing_financial_reports%rowtype;
  pred public.signing_financial_resolutions%rowtype;
  distinct_amounts int;
begin
  if tg_op = 'DELETE' then
    raise exception 'financial resolutions are never deleted; retract them instead' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if old.record_status = 'RETRACTED' then
      raise exception 'a RETRACTED financial resolution is sealed (%)', old.id using errcode = '55000';
    end if;
    if new.record_status <> 'RETRACTED'
       or (to_jsonb(new) - 'record_status' - 'retracted_at' - 'retraction_reason') is distinct from (to_jsonb(old) - 'record_status' - 'retracted_at' - 'retraction_reason') then
      raise exception 'an ACTIVE financial resolution is sealed; the only change allowed is retraction (%)', old.id using errcode = '55000';
    end if;
    return new;
  end if;
  if new.record_status <> 'ACTIVE' then
    raise exception 'a new financial resolution starts ACTIVE' using errcode = '55000';
  end if;
  select * into sel from public.signing_financial_reports where id = new.selected_report_id;
  if not found or sel.signing_id <> new.signing_id or sel.component_type <> new.component_type
     or sel.record_status <> 'ACTIVE' or sel.currency_code <> 'USD' or sel.amount_basis = 'APPROXIMATE' then
    raise exception 'a resolution must select an ACTIVE, non-approximate USD report of the same signing and component' using errcode = '55000';
  end if;
  select count(distinct amount) into distinct_amounts from public.signing_financial_reports
  where signing_id = new.signing_id and component_type = new.component_type and record_status = 'ACTIVE'
    and currency_code = 'USD' and amount_basis is distinct from 'APPROXIMATE';
  if distinct_amounts < 2 then
    raise exception 'a resolution needs at least two ACTIVE reports with different amounts; a correction supersedes the old report instead' using errcode = '55000';
  end if;
  if new.supersedes_resolution_id is not null then
    select * into pred from public.signing_financial_resolutions where id = new.supersedes_resolution_id;
    if not found or pred.id = new.id or pred.signing_id <> new.signing_id or pred.component_type <> new.component_type then
      raise exception 'a new decision must supersede an existing decision of the same signing and component (%)', new.supersedes_resolution_id using errcode = '55000';
    end if;
    if pred.record_status = 'ACTIVE' then
      update public.signing_financial_resolutions
        set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'Superseded by a later decision.'
      where id = pred.id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_signing_financial_resolution_guard() from public, anon, authenticated;

drop trigger if exists signing_financial_resolutions_guard on public.signing_financial_resolutions;
create trigger signing_financial_resolutions_guard
before insert or update or delete on public.signing_financial_resolutions
for each row execute function public.disi_signing_financial_resolution_guard();

alter table public.signing_financial_resolutions enable row level security;
revoke all on table public.signing_financial_resolutions from anon, authenticated;
grant select on table public.signing_financial_resolutions to anon, authenticated;
drop policy if exists public_read_signing_financial_resolutions on public.signing_financial_resolutions;
create policy public_read_signing_financial_resolutions on public.signing_financial_resolutions for select to anon, authenticated using (true);

-- ===========================================================================
-- 3. SOURCES
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, author, publication_date, accessed_at, notes, source_tier)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'author', (x ->> 'publication_date')::date,
       (x ->> 'accessed_at')::timestamptz, x ->> 'notes', x ->> 'source_tier'
from _m031, jsonb_array_elements(j -> 'new_sources') x
on conflict (url) do nothing;

-- ===========================================================================
-- 4. ENVIRONMENTS AND POOL CAPACITY
-- ===========================================================================

do $$
declare
  e jsonb;
  org uuid := (select id from public.organizations where name = (select j ->> 'organization_name' from _m031));
  r record;
begin
  for e in select x from _m031, jsonb_array_elements(j -> 'environments') x loop
    select * into r from public.signing_environments where organization_id = org and signing_year = (e ->> 'signing_year')::int;
    if not found then
      insert into public.signing_environments (organization_id, signing_year, regime, club_bonus_pool_usd, pool_after_trades_usd, signing_period_label,
        max_individual_bonus_usd, overage_tax_rate, tradeable_pool_space, penalty_status, rules_summary, cba_regime, notes)
      values (org, (e ->> 'signing_year')::int, (e ->> 'regime')::public.signing_regime, (e ->> 'club_bonus_pool_usd')::numeric, null, e ->> 'signing_period_label',
        null, null, (e ->> 'tradeable_pool_space')::boolean, null, e ->> 'rules_summary', null, e ->> 'notes');
    elsif r.regime::text <> e ->> 'regime' or r.club_bonus_pool_usd is distinct from (e ->> 'club_bonus_pool_usd')::numeric
          or r.signing_period_label is distinct from e ->> 'signing_period_label' then
      raise exception '031: a Dodgers % environment exists with unexpected content', e ->> 'signing_year';
    end if;
  end loop;
  for e in select x from _m031, jsonb_array_elements(j -> 'environment_column_updates') x loop
    update public.signing_environments set club_bonus_pool_usd = (e ->> 'to')::numeric
    where organization_id = org and signing_year = (e ->> 'signing_year')::int and club_bonus_pool_usd is null;
  end loop;
end $$;

do $$
declare
  e jsonb;
  org uuid := (select id from public.organizations where name = (select j ->> 'organization_name' from _m031));
  eid uuid;
  src uuid;
begin
  for e in select x from _m031, jsonb_array_elements(j -> 'environment_reports') x loop
    select id into eid from public.signing_environments where organization_id = org and signing_year = (e ->> 'signing_year')::int;
    select id into src from public.sources where url = e ->> 'source_url';
    if eid is null or src is null then
      raise exception '031: references for environment report % are unresolved', e ->> 'ref';
    end if;
    if not exists (select 1 from public.signing_environment_financial_reports where signing_environment_id = eid and metric_type = e ->> 'metric_type'
                   and source_id = src and amount_usd is not distinct from (e ->> 'amount_usd')::numeric) then
      insert into public.signing_environment_financial_reports (signing_environment_id, metric_type, amount_usd, amount_basis, amount_precision,
        report_origin, source_id, evidence_basis, confidence, retrieved_at, note)
      select eid, e ->> 'metric_type', (e ->> 'amount_usd')::numeric, e ->> 'amount_basis', (e ->> 'amount_precision')::numeric,
        'EXTERNAL_SOURCE', src, e ->> 'evidence_basis', (e ->> 'confidence')::public.confidence_level, so.accessed_at, e ->> 'note'
      from public.sources so where so.id = src;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 5. SIGNING REPORTS: provenance upgrades, new bonuses, one correction
-- ===========================================================================
-- UPGRADE: an externally sourced report for a bonus that carried only a legacy carry-forward. The legacy
--   row stays ACTIVE as corroboration; it is not retracted because the amount did not change.
-- NEW: a bonus that was unknown. The canonical column and flag are set and an external report is added.
-- CORRECTION: the legacy amount was wrong; the external report supersedes (and retires) the legacy row
--   and the canonical column moves to the sourced amount.

do $$
declare
  e jsonb;
  org uuid := (select id from public.organizations where name = (select j ->> 'organization_name' from _m031));
  sid uuid;
  src uuid;
  legacy uuid;
begin
  for e in select x from _m031, jsonb_array_elements(j -> 'signing_reports') x loop
    select sg.id into sid from public.signings sg join public.players p on p.id = sg.player_id
    where p.slug = e ->> 'player_slug' and sg.organization_id = org and sg.signing_year = (e ->> 'signing_year')::int;
    select id into src from public.sources where url = e ->> 'source_url';
    if sid is null or src is null then
      raise exception '031: references for report % are unresolved', e ->> 'ref';
    end if;
    if exists (select 1 from public.signing_financial_reports where signing_id = sid and component_type = 'SIGNING_BONUS'
               and source_id = src and amount = (e ->> 'amount')::numeric) then
      continue;
    end if;
    legacy := null;
    if e ->> 'kind' = 'CORRECTION' then
      select id into legacy from public.signing_financial_reports
      where signing_id = sid and component_type = 'SIGNING_BONUS' and report_origin = 'LEGACY_CARRYFORWARD' and record_status = 'ACTIVE'
        and amount = (e ->> 'legacy_amount')::numeric;
      if legacy is null then
        raise exception '031: the legacy carry-forward to correct is missing for %', e ->> 'player_slug';
      end if;
    end if;
    insert into public.signing_financial_reports (signing_id, component_type, amount, currency_code, amount_basis, amount_precision,
      report_origin, source_id, evidence_basis, confidence, retrieved_at, note, supersedes_report_id)
    select sid, 'SIGNING_BONUS', (e ->> 'amount')::numeric, 'USD', e ->> 'amount_basis', (e ->> 'amount_precision')::numeric,
      'EXTERNAL_SOURCE', src, e ->> 'evidence_basis', (e ->> 'confidence')::public.confidence_level, so.accessed_at, e ->> 'note', legacy
    from public.sources so where so.id = src;
    if e ->> 'kind' in ('NEW', 'CORRECTION') then
      update public.signings set signing_bonus_usd = (e ->> 'amount')::numeric, bonus_publicly_reported = true where id = sid;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 6. ENVIRONMENT LINKS (supported period membership; pathway is irrelevant)
-- ===========================================================================

do $$
declare
  w jsonb;
  org uuid := (select id from public.organizations where name = (select j ->> 'organization_name' from _m031));
  eid uuid;
begin
  for w in select x from _m031, jsonb_array_elements(j -> 'link_windows') x loop
    select id into eid from public.signing_environments where organization_id = org and signing_year = (w ->> 'signing_year')::int;
    if eid is null then
      raise exception '031: the Dodgers % environment is missing', w ->> 'signing_year';
    end if;
    update public.signings
    set signing_environment_id = eid
    where organization_id = org and signing_environment_id is null and signing_date is not null
      and signing_date between (w ->> 'from')::date and (w ->> 'to')::date;
  end loop;
end $$;

-- ===========================================================================
-- 7. VIEW: a component with an ACTIVE decision is RESOLVED (columns of 030 unchanged, one appended)
-- ===========================================================================

{{view_signing_financials}}

comment on view public.v_signing_acquisition_financials is
  'One row per signing: canonical component values, known acquisition cost paired with its completeness (COMPLETE / PARTIAL / UNKNOWN / NO_RULE from acquisition_cost_component_rules), and a separate pool / regulatory completeness. bonus_source_status and cost_source_coverage come from the ledger, never from bonus_publicly_reported; a LEGACY_CANONICAL_ONLY value is known in DISI but not externally sourced. A component with an ACTIVE reviewed resolution is RESOLVED to the selected report (resolved_components) and is not a conflict. Unknown is NULL, never zero. No WAR, salary, ROI or ranking.';

-- ===========================================================================
-- 8. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['signing_financial_resolutions', 'v_signing_acquisition_financials'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

do $$
declare
  bad text;
  e jsonb;
  n int;
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
    raise exception '031: API roles hold privileges beyond SELECT: %', bad;
  end if;

  -- every seeded signing report and environment report is present exactly once
  for e in select x from _m031, jsonb_array_elements(j -> 'signing_reports') x loop
    select count(*) into n from public.signing_financial_reports fr join public.signings sg on sg.id = fr.signing_id join public.players p on p.id = sg.player_id
    join public.sources so on so.id = fr.source_id
    where p.slug = e ->> 'player_slug' and sg.signing_year = (e ->> 'signing_year')::int and fr.component_type = 'SIGNING_BONUS'
      and so.url = e ->> 'source_url' and fr.amount = (e ->> 'amount')::numeric and fr.record_status = 'ACTIVE';
    if n <> 1 then raise exception '031 postcondition: report % present % times', e ->> 'ref', n; end if;
  end loop;
  for e in select x from _m031, jsonb_array_elements(j -> 'environment_reports') x loop
    select count(*) into n from public.signing_environment_financial_reports fr join public.signing_environments se on se.id = fr.signing_environment_id
    join public.organizations o on o.id = se.organization_id join public.sources so on so.id = fr.source_id
    where o.name = (select j ->> 'organization_name' from _m031) and se.signing_year = (e ->> 'signing_year')::int and fr.metric_type = e ->> 'metric_type'
      and so.url = e ->> 'source_url' and fr.record_status = 'ACTIVE';
    if n <> 1 then raise exception '031 postcondition: environment report % present % times', e ->> 'ref', n; end if;
  end loop;

  -- column / ledger reconciliation still holds for signing bonuses touched here
  select count(*) into n
  from public.signings s join public.players p on p.id = s.player_id
  where p.slug in (select x ->> 'player_slug' from _m031, jsonb_array_elements(j -> 'signing_reports') x)
    and (s.signing_bonus_usd is null
         or not exists (select 1 from public.signing_financial_reports fr where fr.signing_id = s.id and fr.component_type = 'SIGNING_BONUS'
                          and fr.record_status = 'ACTIVE' and fr.report_origin = 'EXTERNAL_SOURCE'));
  if n <> 0 then raise exception '031 postcondition: % touched signing(s) without a canonical bonus or an external report', n; end if;

  -- no pool capacity gap remains for the periods this migration covers
  select count(*) into n from public.signing_environments se join public.organizations o on o.id = se.organization_id
  where o.name = (select j ->> 'organization_name' from _m031) and se.signing_year in (2012, 2013, 2014, 2017, 2021, 2022) and se.club_bonus_pool_usd is null;
  if n <> 0 then raise exception '031 postcondition: % covered environment(s) have no pool', n; end if;

  -- Rincon's bonus is the corrected, sourced value and its legacy row is retired by supersession
  select count(*) into n from public.signings s join public.players p on p.id = s.player_id
  where p.slug = 'carlos-rincon' and s.signing_bonus_usd = 325000;
  if n <> 1 then raise exception '031 postcondition: Carlos Rincon is not at the corrected bonus'; end if;

  -- Sasaki's posting-fee conflict is untouched
  select count(*) into n from public.v_signing_acquisition_financials where player_slug = 'roki-sasaki' and posting_fee_usd is null
    and conflicting_components = array['POSTING_FEE'];
  if n <> 1 then raise exception '031 postcondition: the Sasaki posting-fee conflict changed'; end if;
end $$;

commit;
