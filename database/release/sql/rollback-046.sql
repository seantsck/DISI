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
select $r046${"new_sources":[{"accessed_at":"2026-10-20T02:54:45Z","author":"Dustin Nosler","notes":"Prospect profile; its acquisition line gives the signing route, month and bonus.","publication_date":"2020-03-11","source_name":"Dodgers Digest","source_tier":"OTHER","source_type":"ARTICLE","title":"2020 Dodgers Top 100 Prospects: No. 5, 3B Miguel Vargas","url":"https://dodgersdigest.com/2020/03/11/2020-dodgers-top-100-prospects-no-5-3b-miguel-vargas/"},{"accessed_at":"2026-10-20T02:58:38Z","author":"Dustin Nosler","notes":"Opening-day roster of the 2021 class; three signees carry a reported bonus in parentheses and the rest none.","publication_date":"2021-01-15","source_name":"Dodgers Digest","source_tier":"OTHER","source_type":"ARTICLE","title":"Wilman Diaz, Jesus Galiz highlight Dodgers' 2021 international signing class","url":"https://dodgersdigest.com/2021/01/15/wilman-diaz-jesus-galiz-highlight-dodgers-2021-international-signing-class/"},{"accessed_at":"2026-10-20T02:57:36Z","author":"CBS Detroit","notes":"News report on the son's signing that states the father's 1988 Dodgers bonus.","publication_date":"2017-09-28","source_name":"CBS Detroit","source_tier":"OTHER","source_type":"ARTICLE","title":"Tigers Sign 17-Year-Old Son Of Pedro Martinez","url":"https://www.cbsnews.com/detroit/news/tigers-sign-17-year-old-son-of-pedro-martinez"},{"accessed_at":"2026-10-20T02:55:24Z","author":"Rory Costello","notes":"SABR biography; the page prints no revision date.","publication_date":null,"source_name":"SABR Biography Project","source_tier":"OTHER","source_type":"ARTICLE","title":"Sandy Amorós","url":"https://sabr.org/bioproj/person/sandy-amoros/"},{"accessed_at":"2026-10-20T02:55:33Z","author":"Malcolm Allen","notes":"SABR biography; publication_date is the page's last-revised date.","publication_date":"2021-06-09","source_name":"SABR Biography Project","source_tier":"OTHER","source_type":"ARTICLE","title":"Juan Guzmán","url":"https://sabr.org/bioproj/person/juan-guzman/"},{"accessed_at":"2026-10-20T02:55:50Z","author":"J.W. Stewart","notes":"SABR biography; publication_date is the page's last-revised date.","publication_date":"2022-10-29","source_name":"SABR Biography Project","source_tier":"OTHER","source_type":"ARTICLE","title":"Raúl Mondesí","url":"https://sabr.org/bioproj/person/raul-mondesi/"},{"accessed_at":"2026-10-20T02:56:18Z","author":"Zac Petrillo","notes":"SABR biography; publication_date is the page's last-revised date.","publication_date":"2024-01-23","source_name":"SABR Biography Project","source_tier":"OTHER","source_type":"ARTICLE","title":"Adrian Beltré","url":"https://sabr.org/bioproj/person/adrian-beltre/"},{"accessed_at":"2026-10-20T02:57:22Z","author":"Associated Press","notes":"Wire report on Commissioner Selig's ruling; the date is the one in the page URL.","publication_date":"1999-12-21","source_name":"ESPN.com (Associated Press)","source_tier":"OTHER","source_type":"ARTICLE","title":"Dodgers fined, but Beltre denied free agency","url":"https://a.espncdn.com/mlb/news/1999/1221/246027.html"}],"organization_name":"Los Angeles Dodgers","signing_reports":[{"amount":"1000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"OTHER","kind":"NEW","note":"SABR's Amorós biography says Dodgers scout Al Campanis signed the outfielder for a $1,000 bonus. The page places the signing in the winter of 1951-52; DISI's signing year (1951) is unchanged here.","player_slug":"sandy-amoros","ref":"amoros-sabr","signing_year":1951,"source_url":"https://sabr.org/bioproj/person/sandy-amoros/"},{"amount":"4000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"OTHER","kind":"NEW","note":"SABR's Guzmán biography says Juan Guzmán signed with the Dodgers for a $4,000 bonus.","player_slug":"juan-guzman","ref":"guzman-sabr","signing_year":1985,"source_url":"https://sabr.org/bioproj/person/juan-guzman/"},{"amount":"4000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"OTHER","kind":"NEW","note":"SABR's Mondesí biography says he joined the Dodgers organization with his signature and a $4,000 signing bonus.","player_slug":"raul-mondesi","ref":"mondesi-sabr","signing_year":1988,"source_url":"https://sabr.org/bioproj/person/raul-mondesi/"},{"amount":"6500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"NEW","note":"CBS Detroit says that when Pedro Martinez's father signed with the Dodgers in 1988 he was given a $6,500 signing bonus.","player_slug":"pedro-martinez","ref":"pmartinez-cbs","signing_year":1988,"source_url":"https://www.cbsnews.com/detroit/news/tigers-sign-17-year-old-son-of-pedro-martinez"},{"amount":"300000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"NEW","note":"Dodgers Digest's profile lists Miguel Vargas as an international free agent (Cuba) in September 2017 with a $300,000 signing bonus.","player_slug":"miguel-vargas","ref":"vargas-dd","signing_year":2017,"source_url":"https://dodgersdigest.com/2020/03/11/2020-dodgers-top-100-prospects-no-5-3b-miguel-vargas/"},{"amount":"2697500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"NEW","note":"Dodgers Digest's 2021 class list prints Wilman Diaz (Venezuela) at $2,697,500.","player_slug":"wilman-diaz","ref":"wdiaz-dd","signing_year":2021,"source_url":"https://dodgersdigest.com/2021/01/15/wilman-diaz-jesus-galiz-highlight-dodgers-2021-international-signing-class/"},{"amount":"812500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"NEW","note":"Dodgers Digest's 2021 class list prints Jesus Galiz (Venezuela) at $812,500.","player_slug":"jesus-galiz","ref":"galiz-dd","signing_year":2021,"source_url":"https://dodgersdigest.com/2021/01/15/wilman-diaz-jesus-galiz-highlight-dodgers-2021-international-signing-class/"},{"amount":"497500.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"NEW","note":"Dodgers Digest's 2021 class list prints Rayne Doncon (Dominican Republic) at $497,500.","player_slug":"rayne-doncon","ref":"doncon-dd","signing_year":2021,"source_url":"https://dodgersdigest.com/2021/01/15/wilman-diaz-jesus-galiz-highlight-dodgers-2021-international-signing-class/"},{"amount":"23000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"OTHER","kind":"CONFLICT","note":"SABR's Beltré biography says the Dodgers signed him for $23,000 on July 7, 1994. The AP report of Selig's 1999 ruling gives $17,000; the two disagree, so no canonical bonus is set.","player_slug":"adrian-beltre","ref":"beltre-sabr","signing_year":1994,"source_url":"https://sabr.org/bioproj/person/adrian-beltre/"},{"amount":"17000.00","amount_basis":"EXACT","amount_precision":null,"confidence":"MEDIUM","evidence_basis":"NEWS_REPORT","kind":"CONFLICT","note":"AP (ESPN.com, 1999-12-21) says Beltré received a $17,000 signing bonus when he signed. SABR gives $23,000; the disagreement is unresolved and no canonical bonus is set.","player_slug":"adrian-beltre","ref":"beltre-espn","signing_year":1994,"source_url":"https://a.espncdn.com/mlb/news/1999/1221/246027.html"}]}$r046$::jsonb as j;

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
