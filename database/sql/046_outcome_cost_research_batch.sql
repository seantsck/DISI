-- DISI v0.36.2
-- 046_outcome_cost_research_batch.sql
-- A reviewed acquisition-cost research batch. Run after 045b.
--
-- Built from database/research/046/ (research-evidence.json, build.mjs).
--
-- What this is. A research-data migration. It adds no table, view, function, grant or policy, and it changes no outcome audit.
-- It records signing bonuses that sources DISI could read directly state, with the provenance the 030/031 ledger requires:
--   * Eight signings whose bonus was unknown receive one externally sourced SIGNING_BONUS report each and, because the report is
--     the only one, the canonical signing_bonus_usd and bonus_publicly_reported flag (the same treatment Migration 031 gave NEW facts).
--   * One signing (Adrian Beltre) receives two disagreeing reports from two sources. Both stay ACTIVE, no resolution is recorded and
--     the canonical bonus stays NULL: the view reports a CONFLICT, which is a visible research task, not a value.
--   * Every other bonus that was unknown stays unknown. Nothing is estimated, inferred from other years or replaced by zero.
-- It then runs the explicit snapshot refresh once, only when this run changed a report, so the persisted product read models carry
-- the new facts as one coherent generation (the product never reads these tables at request time).
--
-- Rerunnable: every statement is idempotent; the refresh runs only when a report was added.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA (database/research/046/research-evidence.json)
-- ===========================================================================

create temporary table _m046 on commit drop as
select $m046${"new_sources":[{"accessed_at":"2026-10-20T02:54:45Z","author":"Dustin Nosler","notes":"Prospect profile; its acquisition line gives the signing route, month and bonus.","publication_date":"2020-03-11","source_name":"Dodgers Digest","source_tier":"OTHER","source_type":"ARTICLE","title":"2020 Dodgers Top 100 Prospects: No. 5, 3B Miguel Vargas","url":"https://dodgersdigest.com/2020/03/11/2020-dodgers-top-100-prospects-no-5-3b-miguel-vargas/"},{"accessed_at":"2026-10-20T02:58:38Z","author":"Dustin Nosler","notes":"Opening-day roster of the 2021 class; three signees carry a reported bonus in parentheses and the rest none.","publication_date":"2021-01-15","source_name":"Dodgers Digest","source_tier":"OTHER","source_type":"ARTICLE","title":"Wilman Diaz, Jesus Galiz highlight Dodgers' 2021 international signing class","url":"https://dodgersdigest.com/2021/01/15/wilman-diaz-jesus-galiz-highlight-dodgers-2021-international-signing-class/"},{"accessed_at":"2026-10-20T02:57:36Z","author":"CBS Detroit","notes":"News report on the son's signing that states the father's 1988 Dodgers bonus.","publication_date":"2017-09-28","source_name":"CBS Detroit","source_tier":"OTHER","source_type":"ARTICLE","title":"Tigers Sign 17-Year-Old Son Of Pedro Martinez","url":"https://www.cbsnews.com/detroit/news/tigers-sign-17-year-old-son-of-pedro-martinez"},{"accessed_at":"2026-10-20T02:55:24Z","author":"Rory Costello","notes":"SABR biography; the page prints no revision date.","publication_date":null,"source_name":"SABR Biography Project","source_tier":"OTHER","source_type":"ARTICLE","title":"Sandy Amorós","url":"https://sabr.org/bioproj/person/sandy-amoros/"},{"accessed_at":"2026-10-20T02:55:33Z","author":"Malcolm Allen","notes":"SABR biography; publication_date is the page's last-revised date.","publication_date":"2021-06-09","source_name":"SABR Biography Project","source_tier":"OTHER","source_type":"ARTICLE","title":"Juan Guzmán","url":"https://sabr.org/bioproj/person/juan-guzman/"},{"accessed_at":"2026-10-20T02:55:50Z","author":"J.W. Stewart","notes":"SABR biography; publication_date is the page's last-revised date.","publication_date":"2022-10-29","source_name":"SABR Biography Project","source_tier":"OTHER","source_type":"ARTICLE","title":"Raúl Mondesí","url":"https://sabr.org/bioproj/person/raul-mondesi/"},{"accessed_at":"2026-10-20T02:56:18Z","author":"Zac Petrillo","notes":"SABR biography; publication_date is the page's last-revised date.","publication_date":"2024-01-23","source_name":"SABR Biography Project","source_tier":"OTHER","source_type":"ARTICLE","title":"Adrian Beltré","url":"https://sabr.org/bioproj/person/adrian-beltre/"},{"accessed_at":"2026-10-20T02:57:22Z","author":"Associated Press","notes":"Wire report on Commissioner Selig's ruling; the date is the one in the page URL.","publication_date":"1999-12-21","source_name":"ESPN.com (Associated Press)","source_tier":"OTHER","source_type":"ARTICLE","title":"Dodgers fined, but Beltre denied free agency","url":"https://a.espncdn.com/mlb/news/1999/1221/246027.html"}],"organization_name":"Los Angeles Dodgers","signing_reports":[{"amount":"1000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"OTHER","kind":"NEW","note":"SABR's Amorós biography says Dodgers scout Al Campanis signed the outfielder for a $1,000 bonus. The page places the signing in the winter of 1951-52; DISI's signing year (1951) is unchanged here.","player_slug":"sandy-amoros","ref":"amoros-sabr","signing_year":1951,"source_url":"https://sabr.org/bioproj/person/sandy-amoros/"},{"amount":"4000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"OTHER","kind":"NEW","note":"SABR's Guzmán biography says Juan Guzmán signed with the Dodgers for a $4,000 bonus.","player_slug":"juan-guzman","ref":"guzman-sabr","signing_year":1985,"source_url":"https://sabr.org/bioproj/person/juan-guzman/"},{"amount":"4000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"OTHER","kind":"NEW","note":"SABR's Mondesí biography says he joined the Dodgers organization with his signature and a $4,000 signing bonus.","player_slug":"raul-mondesi","ref":"mondesi-sabr","signing_year":1988,"source_url":"https://sabr.org/bioproj/person/raul-mondesi/"},{"amount":"6500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"NEW","note":"CBS Detroit says that when Pedro Martinez's father signed with the Dodgers in 1988 he was given a $6,500 signing bonus.","player_slug":"pedro-martinez","ref":"pmartinez-cbs","signing_year":1988,"source_url":"https://www.cbsnews.com/detroit/news/tigers-sign-17-year-old-son-of-pedro-martinez"},{"amount":"300000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"NEW","note":"Dodgers Digest's profile lists Miguel Vargas as an international free agent (Cuba) in September 2017 with a $300,000 signing bonus.","player_slug":"miguel-vargas","ref":"vargas-dd","signing_year":2017,"source_url":"https://dodgersdigest.com/2020/03/11/2020-dodgers-top-100-prospects-no-5-3b-miguel-vargas/"},{"amount":"2697500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"NEW","note":"Dodgers Digest's 2021 class list prints Wilman Diaz (Venezuela) at $2,697,500.","player_slug":"wilman-diaz","ref":"wdiaz-dd","signing_year":2021,"source_url":"https://dodgersdigest.com/2021/01/15/wilman-diaz-jesus-galiz-highlight-dodgers-2021-international-signing-class/"},{"amount":"812500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"NEW","note":"Dodgers Digest's 2021 class list prints Jesus Galiz (Venezuela) at $812,500.","player_slug":"jesus-galiz","ref":"galiz-dd","signing_year":2021,"source_url":"https://dodgersdigest.com/2021/01/15/wilman-diaz-jesus-galiz-highlight-dodgers-2021-international-signing-class/"},{"amount":"497500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"NEW","note":"Dodgers Digest's 2021 class list prints Rayne Doncon (Dominican Republic) at $497,500.","player_slug":"rayne-doncon","ref":"doncon-dd","signing_year":2021,"source_url":"https://dodgersdigest.com/2021/01/15/wilman-diaz-jesus-galiz-highlight-dodgers-2021-international-signing-class/"},{"amount":"23000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"OTHER","kind":"CONFLICT","note":"SABR's Beltré biography says the Dodgers signed him for $23,000 on July 7, 1994. The AP report of Selig's 1999 ruling gives $17,000; the two disagree, so no canonical bonus is set.","player_slug":"adrian-beltre","ref":"beltre-sabr","signing_year":1994,"source_url":"https://sabr.org/bioproj/person/adrian-beltre/"},{"amount":"17000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"CONFLICT","note":"AP (ESPN.com, 1999-12-21) says Beltré received a $17,000 signing bonus when he signed. SABR gives $23,000; the disagreement is unresolved and no canonical bonus is set.","player_slug":"adrian-beltre","ref":"beltre-espn","signing_year":1994,"source_url":"https://a.espncdn.com/mlb/news/1999/1221/246027.html"}]}$m046$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 046 was written for
-- ===========================================================================

do $$
declare
  e jsonb;
  org uuid;
  sid uuid;
  n int;
  applied boolean;
begin
  if to_regclass('public.product_database_status') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null
     or to_regclass('public.signing_financial_reports') is null or to_regclass('public.v_signing_acquisition_financials') is null then
    raise exception '046: Migration 045b has not been applied';
  end if;
  select id into org from public.organizations where name = (select j ->> 'organization_name' from _m046);
  if org is null then
    raise exception '046: the organization is missing';
  end if;
  for e in select x from _m046, jsonb_array_elements(j -> 'signing_reports') x loop
    select sg.id into sid from public.signings sg join public.players p on p.id = sg.player_id
    where p.slug = e ->> 'player_slug' and sg.organization_id = org and sg.signing_year = (e ->> 'signing_year')::int;
    if sid is null then
      raise exception '046: the signing for % (%) is missing', e ->> 'player_slug', e ->> 'signing_year';
    end if;
    -- a bonus researched as unknown must still be unknown, or already be exactly this fact
    applied := exists (select 1 from public.signing_financial_reports r join public.sources so on so.id = r.source_id
                       where r.signing_id = sid and r.component_type = 'SIGNING_BONUS' and r.record_status = 'ACTIVE'
                         and so.url = e ->> 'source_url' and r.amount = (e ->> 'amount')::numeric);
    select count(*) into n from public.signing_financial_reports r
    where r.signing_id = sid and r.component_type = 'SIGNING_BONUS' and r.record_status = 'ACTIVE'
      and not exists (select 1 from public.sources so where so.id = r.source_id and so.url = e ->> 'source_url' and r.amount = (e ->> 'amount')::numeric);
    if e ->> 'kind' = 'NEW' and n > 0 then
      raise exception '046: % already has a different active bonus report; the research no longer applies', e ->> 'player_slug';
    end if;
    if e ->> 'kind' = 'NEW' and not applied and (select signing_bonus_usd from public.signings where id = sid) is not null then
      raise exception '046: % already carries a canonical bonus; the research no longer applies', e ->> 'player_slug';
    end if;
    if e ->> 'kind' = 'CONFLICT' and (select signing_bonus_usd from public.signings where id = sid) is not null then
      raise exception '046: % has a canonical bonus although its sources disagree', e ->> 'player_slug';
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 2. SOURCES
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, author, publication_date, accessed_at, notes, source_tier)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'author', (x ->> 'publication_date')::date,
       (x ->> 'accessed_at')::timestamptz, x ->> 'notes', x ->> 'source_tier'
from _m046, jsonb_array_elements(j -> 'new_sources') x
on conflict (url) do nothing;

-- ===========================================================================
-- 3. SIGNING-BONUS REPORTS
-- ===========================================================================
-- NEW: the only report for a bonus that was unknown. The canonical column and flag are set.
-- CONFLICT: one of several independent reports that disagree. Every one stays ACTIVE; the canonical column is left NULL.

create temporary table _m046_changed (n int) on commit drop;

do $$
declare
  e jsonb;
  org uuid := (select id from public.organizations where name = (select j ->> 'organization_name' from _m046));
  sid uuid;
  src uuid;
begin
  for e in select x from _m046, jsonb_array_elements(j -> 'signing_reports') x loop
    select sg.id into sid from public.signings sg join public.players p on p.id = sg.player_id
    where p.slug = e ->> 'player_slug' and sg.organization_id = org and sg.signing_year = (e ->> 'signing_year')::int;
    select id into src from public.sources where url = e ->> 'source_url';
    if sid is null or src is null then
      raise exception '046: references for report % are unresolved', e ->> 'ref';
    end if;
    if exists (select 1 from public.signing_financial_reports where signing_id = sid and component_type = 'SIGNING_BONUS'
               and source_id = src and amount = (e ->> 'amount')::numeric) then
      continue;
    end if;
    insert into public.signing_financial_reports (signing_id, component_type, amount, currency_code, amount_basis, amount_precision,
      report_origin, source_id, evidence_basis, confidence, retrieved_at, note)
    select sid, 'SIGNING_BONUS', (e ->> 'amount')::numeric, 'USD', e ->> 'amount_basis', (e ->> 'amount_precision')::numeric,
      'EXTERNAL_SOURCE', src, e ->> 'evidence_basis', (e ->> 'confidence')::public.confidence_level, so.accessed_at, e ->> 'note'
    from public.sources so where so.id = src;
    insert into _m046_changed values (1);
    if e ->> 'kind' = 'NEW' then
      update public.signings set signing_bonus_usd = (e ->> 'amount')::numeric, bonus_publicly_reported = true where id = sid;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 4. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  e jsonb;
  org uuid := (select id from public.organizations where name = (select j ->> 'organization_name' from _m046));
  sid uuid;
  bonus numeric;
  status text;
  nreports int;
begin
  for e in select x from _m046, jsonb_array_elements(j -> 'signing_reports') x loop
    select sg.id, sg.signing_bonus_usd into sid, bonus from public.signings sg join public.players p on p.id = sg.player_id
    where p.slug = e ->> 'player_slug' and sg.organization_id = org and sg.signing_year = (e ->> 'signing_year')::int;
    if not exists (select 1 from public.signing_financial_reports r join public.sources so on so.id = r.source_id
                   where r.signing_id = sid and r.component_type = 'SIGNING_BONUS' and r.record_status = 'ACTIVE'
                     and so.url = e ->> 'source_url' and r.amount = (e ->> 'amount')::numeric and r.report_origin = 'EXTERNAL_SOURCE') then
      raise exception '046 postcondition: report % is missing', e ->> 'ref';
    end if;
    select count(*) into nreports from public.signing_financial_reports
    where signing_id = sid and component_type = 'SIGNING_BONUS' and record_status = 'ACTIVE';
    select bonus_status into status from public.v_signing_acquisition_financials where signing_id = sid;
    if e ->> 'kind' = 'NEW' and (bonus is distinct from (e ->> 'amount')::numeric or status <> 'KNOWN' or nreports <> 1) then
      raise exception '046 postcondition: % must be KNOWN at the reported amount from one report (status %, reports %)', e ->> 'player_slug', status, nreports;
    end if;
    if e ->> 'kind' = 'CONFLICT' and (bonus is not null or status <> 'CONFLICT' or nreports < 2) then
      raise exception '046 postcondition: % must stay an unresolved CONFLICT with a NULL canonical bonus (status %, reports %)', e ->> 'player_slug', status, nreports;
    end if;
  end loop;
  -- nothing was invented: no zero bonus anywhere, and no bonus without an ACTIVE external or legacy report behind it
  if exists (select 1 from public.signings where signing_bonus_usd = 0) then
    raise exception '046 postcondition: a zero bonus exists; an unknown amount must stay NULL';
  end if;
end $$;

-- ===========================================================================
-- 5. GENERATION: one coherent refresh, only when this run added a report
-- ===========================================================================

do $$
begin
  if exists (select 1 from _m046_changed) then
    perform * from public.disi_refresh_product_snapshots();
  end if;
end $$;

commit;
