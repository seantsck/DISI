-- DISI v0.19
-- 028_residual_canonical_drift_reconciliation.sql
-- Residual canonical drift reconciliation. Run after 027.
--
-- Built from database/research/028/ (reconciliation-manifest.json, audit.mjs, build.mjs).
--
-- After Migration 027, live still differed substantively from a fresh 001 -> 027 replay
-- in exactly two reviewed places, both left over from the historical missing-002 execution
-- path on live. This small, data-only forward migration removes them:
--
--   1. The Yusniel Diaz trade-package wording. The target is the frozen chain's committed
--      wording ("Traded as part of a five-player package ..."); the known live wording is
--      ("Traded in five-player package ..."). Only return_description changes.
--   2. Three 2018 class-membership source links (Alex De Jesus, Diego Cartaya, Jerming Rosario,
--      via the Cartaya article) carry confidence VERIFIED live and HIGH in the frozen chain.
--      HIGH is the target: there is no evidence that live's VERIFIED was a separately
--      adjudicated upgrade. Only confidence changes.
--
-- Exactly four corrections, each guarded: a row must be in its canonical state or in the exact
-- known live variant, otherwise (missing, duplicated, any other value) the whole transaction
-- aborts. Rows are found by stable keys (player slug, organization name, dates, population key,
-- source URL), never by id. Nothing else is touched: no DDL, grants, policies, functions, scouting,
-- development, environment or Migration-027 data.
--
-- Not reconciled on purpose: initcap() capitalisation, float formatting, observed-through dates and
-- retrieval timestamps. New logic must not use initcap() or other engine-sensitive functions.

begin;

create temporary table _m028 on commit drop as
select $m028${"class_membership_confidence":[{"canonical":{"confidence":"HIGH","membership_basis":"OFFICIAL_CLUB_ANNOUNCEMENT","note":null,"supports_fields":"{CLASS_MEMBERSHIP}"},"live":{"confidence":"VERIFIED"},"selector":{"organization_name":"Los Angeles Dodgers","player_slug":"alex-de-jesus","population_key":"DODGERS-2018-OPENING","signing_year":2018,"source_url":"https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518"}},{"canonical":{"confidence":"HIGH","membership_basis":"OFFICIAL_CLUB_ANNOUNCEMENT","note":null,"supports_fields":"{CLASS_MEMBERSHIP}"},"live":{"confidence":"VERIFIED"},"selector":{"organization_name":"Los Angeles Dodgers","player_slug":"diego-cartaya","population_key":"DODGERS-2018-OPENING","signing_year":2018,"source_url":"https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518"}},{"canonical":{"confidence":"HIGH","membership_basis":"OFFICIAL_CLUB_ANNOUNCEMENT","note":null,"supports_fields":"{CLASS_MEMBERSHIP}"},"live":{"confidence":"VERIFIED"},"selector":{"organization_name":"Los Angeles Dodgers","player_slug":"jerming-rosario","population_key":"DODGERS-2018-OPENING","signing_year":2018,"source_url":"https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518"}}],"transaction_descriptions":[{"canonical":{"return_description":"Traded as part of a five-player package to Baltimore Orioles for SS Manny Machado"},"live":{"return_description":"Traded in five-player package to Baltimore Orioles for SS Manny Machado"},"selector":{"from_organization_name":"Los Angeles Dodgers","player_slug":"yusniel-diaz","to_organization_name":"Baltimore Orioles","transaction_date":"2018-07-19","transaction_type":"TRADE"}}]}$m028$::jsonb as j;

-- ===========================================================================
-- 1. TRANSACTION WORDING
-- ===========================================================================

do $$
declare
  e jsonb;
  s jsonb;
  pid uuid;
  fo uuid;
  too uuid;
  cur public.transactions%rowtype;
  total int;
begin
  for e in select x from _m028, jsonb_array_elements(j -> 'transaction_descriptions') x loop
    s := e -> 'selector';
    select id into pid from public.players where slug = s ->> 'player_slug';
    select id into fo from public.organizations where name = s ->> 'from_organization_name';
    select id into too from public.organizations where name = s ->> 'to_organization_name';
    if pid is null or fo is null or too is null then
      raise exception '028: transaction references are unresolved: %', s;
    end if;
    select count(*) into total from public.transactions t
    where t.player_id = pid and t.transaction_date = (s ->> 'transaction_date')::date and t.transaction_type = s ->> 'transaction_type'
      and t.from_organization_id = fo and t.to_organization_id = too;
    if total = 0 then
      raise exception '028: the target transaction is missing: %', s;
    elsif total > 1 then
      raise exception '028: the target transaction exists % times: %', total, s;
    end if;
    select t.* into cur from public.transactions t
    where t.player_id = pid and t.transaction_date = (s ->> 'transaction_date')::date and t.transaction_type = s ->> 'transaction_type'
      and t.from_organization_id = fo and t.to_organization_id = too;
    if cur.return_description is not distinct from e -> 'canonical' ->> 'return_description' then
      null;
    elsif cur.return_description is not distinct from e -> 'live' ->> 'return_description' then
      update public.transactions set return_description = e -> 'canonical' ->> 'return_description' where id = cur.id;
    else
      raise exception '028: transaction % has unexpected wording %', s, cur.return_description;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 2. 2018 CLASS-MEMBERSHIP SOURCE-LINK CONFIDENCE
-- ===========================================================================

do $$
declare
  e jsonb;
  s jsonb;
  c jsonb;
  cur record;
  total int;
begin
  for e in select x from _m028, jsonb_array_elements(j -> 'class_membership_confidence') x loop
    s := e -> 'selector';
    c := e -> 'canonical';
    select count(*) into total
    from public.signing_population_member_sources ms
    join public.signing_population_members m on m.id = ms.member_id
    join public.signing_populations sp on sp.id = m.population_id
    join public.signings sg on sg.id = m.signing_id
    join public.players p on p.id = sg.player_id
    join public.organizations o on o.id = sg.organization_id
    join public.sources so on so.id = ms.source_id
    where sp.population_key = s ->> 'population_key' and p.slug = s ->> 'player_slug' and o.name = s ->> 'organization_name'
      and sg.signing_year = (s ->> 'signing_year')::int and so.url = s ->> 'source_url';
    if total = 0 then
      raise exception '028: the target source link is missing: %', s;
    elsif total > 1 then
      raise exception '028: the target source link exists % times: %', total, s;
    end if;
    select ms.id, ms.confidence::text as confidence, ms.membership_basis, ms.supports_fields::text as supports_fields, ms.note into cur
    from public.signing_population_member_sources ms
    join public.signing_population_members m on m.id = ms.member_id
    join public.signing_populations sp on sp.id = m.population_id
    join public.signings sg on sg.id = m.signing_id
    join public.players p on p.id = sg.player_id
    join public.organizations o on o.id = sg.organization_id
    join public.sources so on so.id = ms.source_id
    where sp.population_key = s ->> 'population_key' and p.slug = s ->> 'player_slug' and o.name = s ->> 'organization_name'
      and sg.signing_year = (s ->> 'signing_year')::int and so.url = s ->> 'source_url';
    if cur.membership_basis is distinct from c ->> 'membership_basis' or cur.supports_fields is distinct from c ->> 'supports_fields'
       or cur.note is distinct from c ->> 'note' then
      raise exception '028: source link % differs from the reviewed link in a field other than confidence', s;
    end if;
    if cur.confidence = c ->> 'confidence' then
      null;
    elsif cur.confidence = e -> 'live' ->> 'confidence' then
      update public.signing_population_member_sources set confidence = (c ->> 'confidence')::public.confidence_level where id = cur.id;
    else
      raise exception '028: source link % has unexpected confidence %', s, cur.confidence;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- POSTCONDITIONS
-- ===========================================================================

do $$
declare
  e jsonb;
  s jsonb;
  n int;
begin
  for e in select x from _m028, jsonb_array_elements(j -> 'transaction_descriptions') x loop
    s := e -> 'selector';
    select count(*) into n from public.transactions t
    join public.players p on p.id = t.player_id join public.organizations fo on fo.id = t.from_organization_id join public.organizations too on too.id = t.to_organization_id
    where p.slug = s ->> 'player_slug' and t.transaction_date = (s ->> 'transaction_date')::date and t.transaction_type = s ->> 'transaction_type'
      and fo.name = s ->> 'from_organization_name' and too.name = s ->> 'to_organization_name'
      and t.return_description = e -> 'canonical' ->> 'return_description';
    if n <> 1 then raise exception '028 postcondition: transaction % does not carry the canonical wording exactly once', s; end if;
  end loop;
  for e in select x from _m028, jsonb_array_elements(j -> 'class_membership_confidence') x loop
    s := e -> 'selector';
    select count(*) into n
    from public.signing_population_member_sources ms
    join public.signing_population_members m on m.id = ms.member_id join public.signing_populations sp on sp.id = m.population_id
    join public.signings sg on sg.id = m.signing_id join public.players p on p.id = sg.player_id join public.organizations o on o.id = sg.organization_id
    join public.sources so on so.id = ms.source_id
    where sp.population_key = s ->> 'population_key' and p.slug = s ->> 'player_slug' and o.name = s ->> 'organization_name'
      and sg.signing_year = (s ->> 'signing_year')::int and so.url = s ->> 'source_url' and ms.confidence::text = e -> 'canonical' ->> 'confidence';
    if n <> 1 then raise exception '028 postcondition: source link % is not at its canonical confidence', s; end if;
  end loop;
end $$;

commit;
