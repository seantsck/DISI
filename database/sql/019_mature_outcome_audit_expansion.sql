-- DISI v0.10
-- 019_mature_outcome_audit_expansion.sql
-- Evidence-based outcome audits for mature Dodgers signings, structured
-- professional-progress records, and outcome research views. Run after 018.
--
-- Built from reviewed research artifacts (database/research/019/), produced by
-- the scripts in scripts/mlb/ against the MLB Stats API and Baseball-Reference's
-- WAR data files. Data retrieved 2026-10-05; audits are "through 2026-10-05".
--
-- Audit policy (scripts/mlb/lib/classify.mjs auditDecision):
--   * A verified MLB debut (MLB person record) is audited for any class.
--   * "No longer in affiliated baseball" (final release / free agency /
--     retirement, or no affiliated appearance for two seasons) is audited only
--     for classes through 2021.
--   * "Active in the minors, no MLB debut" is audited only for classes through 2020.
--   * Insufficient evidence is never audited. Recent / developing players get a
--     progress record, not an outcome.
--   * Every audit with reached_mlb_verified = false must have outcome evidence
--     (enforced by a deferred constraint trigger).
--   * bWAR rows cite Baseball-Reference (the 017 provider trigger still applies).
--
-- Existing audits are never overwritten. Rate rules from 018 are unchanged.
-- Rerunnable.

begin;

-- ===========================================================================
-- 1. SCHEMA
-- ===========================================================================

alter table public.outcome_audits add column if not exists outcome_state text;
alter table public.outcome_audits drop constraint if exists outcome_audits_outcome_state_check;
alter table public.outcome_audits add constraint outcome_audits_outcome_state_check check (
  outcome_state is null
  or (reached_mlb_verified and outcome_state = 'REACHED_MLB')
  or (not reached_mlb_verified and outcome_state in (
        'NO_MLB_CAREER_ENDED', 'NO_MLB_ACTIVE_IN_MINORS', 'NO_MLB_STATUS_UNKNOWN'))
);
comment on column public.outcome_audits.outcome_state is
  'REACHED_MLB; NO_MLB_CAREER_ENDED (no longer in affiliated baseball through the audit date); NO_MLB_ACTIVE_IN_MINORS (still playing affiliated ball, no MLB debut yet); NO_MLB_STATUS_UNKNOWN (no MLB debut verified, affiliated status not established).';

-- Structured professional progress. Exists for audited AND developing players;
-- a progress row is never itself an outcome.
create table if not exists public.player_professional_progress (
  player_id uuid primary key references public.players(id) on delete cascade,
  as_of_date date not null,
  mlb_debut_date date,
  mlb_debut_team text,
  last_mlb_season integer,
  highest_level text check (highest_level in ('MLB','AAA','AA','A+','A','A-','ROK')),
  highest_level_season integer,
  last_affiliated_season integer,
  last_affiliated_team text,
  last_affiliated_level text check (last_affiliated_level in ('MLB','AAA','AA','A+','A','A-','ROK')),
  final_transaction_type text,
  final_transaction_date date,
  final_organization text,
  final_transaction_description text,
  disposition text check (disposition in ('RELEASED','FREE_AGENT','RETIRED','ACTIVE','UNKNOWN')),
  active_in_affiliated_ball boolean,
  continued_outside_affiliated boolean,
  research_recommendation text,
  updated_at timestamptz not null default now()
);
comment on column public.player_professional_progress.continued_outside_affiliated is
  'Independent or foreign professional play after leaving affiliated baseball. NULL = not researched.';

-- Field-level provenance for outcome facts.
create table if not exists public.outcome_evidence (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete restrict,
  supports_fields text[] not null check (supports_fields <@ array[
    'MLB_REACH','MLB_DEBUT_DATE','MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL','LAST_AFFILIATED_SEASON',
    'FINAL_TRANSACTION','DISPOSITION','ACTIVE_STATUS','LEGACY_AUDIT']),
  confidence public.confidence_level not null default 'VERIFIED',
  note text,
  created_at timestamptz not null default now(),
  unique (player_id, source_id)
);
create index if not exists outcome_evidence_player_idx on public.outcome_evidence(player_id);

do $$
declare t text;
begin
  foreach t in array array['player_professional_progress', 'outcome_evidence'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'public_read_' || t, t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', 'public_read_' || t, t);
  end loop;
end $$;

-- Existing audits: their cited source becomes outcome evidence (supports MLB_REACH).
insert into public.outcome_evidence (player_id, source_id, supports_fields, confidence, note)
select oa.player_id, oa.source_id, array['MLB_REACH','LEGACY_AUDIT'], oa.confidence, oa.audit_note
from public.outcome_audits oa
where oa.source_id is not null
on conflict (player_id, source_id) do nothing;

-- A verified "did not reach MLB" requires evidence. Deferred so an audit and its
-- evidence can be written in the same transaction, in either order.
create or replace function public.outcome_audits_require_evidence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.reached_mlb_verified = false and not exists (
    select 1 from public.outcome_evidence e
    where e.player_id = new.player_id and 'MLB_REACH' = any(e.supports_fields)
  ) then
    raise exception 'outcome audit for player % says no MLB debut but has no MLB_REACH outcome evidence', new.player_id;
  end if;
  return null;
end;
$$;
revoke execute on function public.outcome_audits_require_evidence() from public, anon, authenticated;

drop trigger if exists outcome_audits_require_evidence on public.outcome_audits;
create constraint trigger outcome_audits_require_evidence
after insert or update on public.outcome_audits
deferrable initially deferred
for each row execute function public.outcome_audits_require_evidence();

-- ===========================================================================
-- 2. REVIEWED RESEARCH DATA (scripts/mlb/outcome-sql-values.mjs output)
-- ===========================================================================

create temporary table _m019_identity (slug text, mlb_id bigint, mlb_full_name text, identity_basis text, identity_note text) on commit drop;
insert into _m019_identity values
('roger-cedeno',112155,'Roger Cedeno','NAME_SEARCH_CORROBORATED','MLB name search; birth year 1974, Venezuela, outfielder and a Los Angeles Dodgers MLB debut (1995) match the 1991 Dodgers signing record.'),
('carlos-frias',516910,'Carlos Frías','NAME_SEARCH_CORROBORATED','MLB name search; birth year 1989, Dominican Republic, right-handed pitcher and a Los Angeles Dodgers MLB debut (2014) match the 2007 Dodgers signing record.'),
('julian-leon',624645,'Julian Leon','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('lenix-osuna',624646,'Lenix Osuna','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('william-soto',624648,'Willian Soto','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('gersel-pitre',649957,'Gersel Pitre','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('hendrik-clementina',649955,'Hendrik Clementina','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('julio-lugo-prospect',649956,'Julio Lugo','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('misja-harcksen',649958,'Misja Harcksen','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('shakir-albert',649954,'Shakir Albert','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('aldo-espinoza',665852,'Aldo Espinoza','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('carlos-rincon',665779,'Carlos Rincon','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('christopher-arias',665931,'Christopher Arias','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('damaso-marte-jr',666006,'Damaso Marte Jr.','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('luis-rodriguez-2015',665960,'Luis Rodriguez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('omar-estevez',666784,'Omar Estévez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('ronny-brito',665798,'Ronny Brito','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('starling-heredia',665752,'Starling Heredia','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('yadier-alvarez',665751,'Yadier Álvarez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('alex-de-jesus',682942,'Alex De Jesus','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('christian-suarez',682949,'Christian Suarez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('diego-cartaya',682616,'Diego Cartaya','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('ender-avendano',682937,'Ender Avendano','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('gregory-pereira',682946,'Gregory Pereira','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jerami-rodriguez',682951,'Jeremi Rodriguez','DODGERS_TRANSACTION_SPELLING_VARIANT','Dodgers signed free agent RHP "Jeremi Rodriguez" on 2018-07-02 (MLB id 682951), the same date and position as the DISI 2018 signing of Jerami Rodriguez; treated as a spelling variant.'),
('jerming-rosario',682645,'Jerming Rosario','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('luis-izturis',682950,'Luis Izturis','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('miguel-droz',682940,'Miguel Droz','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('rafael-tua',682948,'Rafael Tua','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('lesther-medrano',692327,'Lesther Medrano','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('luis-rodriguez-2019',691177,'Luis Rodriguez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('roque-gutierrez',692262,'Roque Gutierrez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('yeiner-fernandez',691558,'Yeiner Fernandez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('brian-diaz',699070,'Brian Diaz','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('carlos-avila',699066,'Carlos Avila','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('christian-romero',699071,'Christian Romero','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('dailoui-abad',699060,'Dailoui Abad','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('elio-campos',699069,'Elio Campos','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('isaac-barreto',699064,'Isaac Barreto','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jesus-galiz',694188,'Jesus Galiz','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jhonny-jimenez',699075,'Jhonny Jimenez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jorge-carpintero',699058,'Jorge Carpintero','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('juan-alonso',699076,'Juan Alonso','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('kelvin-ramirez',699062,'Kelvin Ramirez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('luis-guerra',699065,'Luis Guerra','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('maximo-martinez',699059,'Maximo Martinez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('michael-vilchez',699074,'Michael Vilchez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('miguel-bastardo',699072,'Miguel Bastardo','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('missael-soto',699057,'Missael Soto','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('pedro-santillan',699063,'Pedro Santillan','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('rayne-doncon',699061,'Rayne Doncon','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('roger-lasso',699068,'Roger Lasso','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('sebastian-jimenez',699067,'Sebastian Jimenez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('thayron-liranzo',699073,'Thayron Liranzo','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('wilman-diaz',694180,'Wilman Diaz','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('abel-lorenzo',806867,'Abel Lorenzo','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('accimias-morales',703193,'Accimias Morales','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('agustin-acosta',802528,'Agustin Acosta','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('aldrin-batista',702881,'Aldrin Batista','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('alexander-albertus',800316,'Alexander Albertus','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('anderson-estevez',802740,'Anderson Estevez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('angel-cruz',807654,'Angel Cruz','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('arod-mckenzie',803242,'Arod McKenzie','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('ben-serunkuma',805205,'Ben Serunkuma','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('callum-wallace',800527,'Callum Wallace','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('daniel-arrias',800328,'Daniel Arrias','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('domingo-geronimo',800383,'Domingo Geronimo','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('edgar-aviles',800530,'Edgar Aviles','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('edgar-gomez',807626,'Edgar Gomez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('edgar-leon',800453,'Edgar Leon','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('eduardo-guerrero',800370,'Eduardo Guerrero','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('enrike-sevilya',800288,'Enrike Sevilya','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('erick-nava',812748,'Erick Nava','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('franderly-morel',806918,'Franderly Morel','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('ilmerson-colon',805623,'Ilmerson Colon','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('javier-bartolozzi',812745,'Javier Bartolozzi','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('javier-pena',800351,'Javier Pena','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jecsua-liborius',807403,'Jecsua Liborius','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jeral-perez',800419,'Jeral Perez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jeremy-castro',812746,'Jeremy Castro','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jholbran-herder',800408,'Jholbran Herder','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jose-gonzalez',806919,'Jose Gonzalez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jose-torrez',807404,'Jose Torrez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('joseilyn-gonzalez',805120,'Joseilyn Gonzalez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('juan-hernandez',806638,'Juan Hernandez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('kosuke-matsuda',800494,'Kosuke Matsuda','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('luciano-romero',800355,'Luciano Romero','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('mairoshendrick-martinus',800302,'Mairo Martinus','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('marco-corcho',806866,'Marco Corcho','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('miguel-dominguez',800399,'Miguel Dominguez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('natanael-castillo',800390,'Natanael Castillo','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('nicolas-cruz',800395,'Nicolas Cruz','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('oswaldo-osorio',800424,'Oswaldo Osorio','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('paris-johnson',807379,'Paris Johnson','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('peter-bonilla',800361,'Peter Bonilla','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('railin-familia',812747,'Railin Familia','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('raynerd-ortega',800380,'Raynerd Ortega','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('ricardo-montero',805110,'Ricardo Montero','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('rodmar-angela',806791,'Rodmar Angela','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('roiger-mujica',800487,'Roiger Mujica','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('samuel-munoz',703153,'Samuel Munoz','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('sean-linan',800344,'Sean Paul Liñan','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('steven-castillo',800481,'Steven Castillo','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('tim-fischer',808444,'Tim Fischer','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('umar-male',805773,'Umar Male','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('victor-rodrigues',800332,'Victor Rodrigues','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('yhonaider-gudino',800521,'Yhonaider Gudino','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('yorfran-medina',800337,'Yorfran Medina','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('yoryi-simarra',800366,'Yoryi Simarra','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('yuliangel-de-la-cruz',800447,'Yuliangel De La Cruz','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('anderson-jerez',808214,'Anderson Jerez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('arnaldo-lantigua',806984,'Arnaldo Lantigua','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('daniel-mielcarek',808028,'Daniel Mielcarek','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('eduardo-quintero',808234,'Eduardo Quintero','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('elias-medina',808257,'Elias Medina','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('erick-batista',808209,'Erick Batista','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('harold-gonzalez',808339,'Harold Gonzalez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('javier-herrera',808223,'Javier Herrera','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jesus-tillero',808313,'Jesus Tillero','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('joendry-vargas',806959,'Joendry Vargas','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('luis-carias',808218,'Luis Carias','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('robinson-ventura',808332,'Robinson Ventura','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('samuel-sanchez',808247,'Samuel Sanchez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('alexis-dominguez',821826,'Alexis Dominguez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('allen-ajoti',821808,'Allen Ajoti','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('angel-ramirez',821633,'Angel Ramirez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('axel-perez',821612,'Axel Perez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('carlos-sardina',821658,'Carlos Sardina','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('christian-muniz',821650,'Christian Muniz','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('david-romero',821661,'David Romero','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('eduardo-rojas',821672,'Eduardo Rojas','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('emil-morales',815896,'Emil Morales','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('erny-orellana',821786,'Erny Orellana','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('euri-rosa',821817,'Euri Rosa','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('francisco-espinoza',821689,'Francisco Espinoza','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('heudy-pena',821263,'Heudy Pena','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jose-lopez',821653,'Jose Lopez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('leider-padilla',821636,'Leider Padilla','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('michael-ramirez',821679,'Michael Ramirez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('rafy-peguero',821801,'Rafy Peguero','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('reyli-mariano',821697,'Reyli Mariano','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('yojackson-laya',821684,'Yojackson Laya','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('adrian-torres',830397,'Adrian Torres','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('alexis-reyes',829490,'Alexis Reyes','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('andres-luna',831322,'Andres Luna','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('aneudy-almonte',825160,'Aneudy Almonte','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('antoni-urena',829482,'Antoni Urena','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('bryan-lara',832440,'Bryan Lara','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('carlos-ramirez',830439,'Carlos Ramirez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('cesar-sanchez',829479,'Cesar Sanchez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('degerson-diaz',830481,'Degerson Diaz','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('derik-aquino',830468,'Derik Aquino','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('devlyn-bautista',830426,'Devlyn Bautista','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('ezequiel-aparicio',830452,'Ezequiel Aparicio','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('hendry-arvelo',829498,'Hendry Arvelo','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('ivan-pacheco',830612,'Ivan Pacheco','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jhon-gil',830459,'Jhon Gil','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jhosman-theran',830420,'Jhosman Theran','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jose-rivas',830449,'Jose Rivas','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jose-villegas',830413,'Jose Villegas','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('joseph-deng-thon',830188,'Joseph Deng Thon','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('juan-macero',830471,'Juan Macero','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('luis-gamez',830800,'Luis Gamez','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('luis-luna',830463,'Luis Luna','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('luis-tovar',830434,'Luis Tovar','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('moises-acacio',830432,'Moises Acacio','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('moises-rangel',830404,'Moises Rangel','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('ricardo-roman',830429,'Ricardo Roman','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('samuel-savinon',829493,'Samuel Savinon','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('shai-romero',829476,'Shai Romero','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('ariel-reynoso',837605,'Ariel Reynoso','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('ezequiel-melburne',836606,'Ezequiel Melburne','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jose-requena',837769,'Jose Requena','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('jose-victorino',837652,'Jose Victorino','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.'),
('rubel-arias',837601,'Rubel Arias','DODGERS_TRANSACTION_MATCH','MLB "signed free agent" transaction with the Dodgers around the signing year.');

create temporary table _m019_progress (
  slug text, as_of_date date, mlb_debut_date date, mlb_debut_team text, highest_level text, highest_level_season int,
  last_affiliated_season int, last_affiliated_team text, last_affiliated_level text, final_transaction_type text,
  final_transaction_date date, final_organization text, final_transaction_description text, disposition text,
  active_in_affiliated_ball boolean, research_recommendation text, last_mlb_season int, continued_outside_affiliated boolean
) on commit drop;
insert into _m019_progress values
('roger-cedeno','2026-10-05','1995-06-20','Los Angeles Dodgers','MLB',1995,2005,'St. Louis Cardinals','MLB',null,null,null,null,null,false,'VERIFIED_MLB',2005,null),
('carlos-frias','2026-10-05','2014-08-04','Los Angeles Dodgers','MLB',2014,2017,'Columbus Clippers','AAA',null,null,null,null,null,false,'VERIFIED_MLB',2016,true),
('julian-leon','2026-10-05',null,null,'AAA',2018,2019,'Mobile BayBears','AA',null,null,null,null,'UNKNOWN',false,'NO_MLB_CAREER_ENDED',null,null),
('lenix-osuna','2026-10-05',null,null,'A+',2017,2017,'Rancho Cucamonga Quakes','A+',null,null,null,null,'UNKNOWN',false,'NO_MLB_CAREER_ENDED',null,true),
('william-soto','2026-10-05',null,null,'A',2016,2017,'Great Lakes Loons','A',null,null,null,null,'UNKNOWN',false,'NO_MLB_CAREER_ENDED',null,null),
('gersel-pitre','2026-10-05',null,null,'A',2017,2019,'Great Lakes Loons','A','REL','2025-11-12','Leones del Caracas','Leones del Caracas released C Gersel Pitre.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('hendrik-clementina','2026-10-05',null,null,'AAA',2022,2023,'Gwinnett Stripers','AAA',null,null,null,null,'UNKNOWN',false,'NO_MLB_CAREER_ENDED',null,null),
('julio-lugo-prospect','2026-10-05',null,null,'ROK',2014,2016,'DSL Dodgers 1','ROK','REL','2016-08-12','DSL LAD Mega','DSL Dodgers2 released RHP Julio Lugo.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('misja-harcksen','2026-10-05',null,null,'ROK',2014,2016,'AZL Dodgers','ROK','REL','2016-09-18','Ogden Raptors','Ogden Raptors released RHP Misja Harcksen.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('shakir-albert','2026-10-05',null,null,'A',2017,2017,'Great Lakes Loons','A','REL','2018-05-16','AZL Dodgers 2','AZL Dodgers released RF Shakir Albert.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('aldo-espinoza','2026-10-05',null,null,'ROK',2016,2019,'AZL Dodgers Lasorda','ROK','REL','2020-07-01','ACL Dodgers','AZL Dodgers 1 released 2B Aldo Espinoza.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('carlos-rincon','2026-10-05',null,null,'AAA',2022,2022,'Syracuse Mets','AAA',null,null,null,null,'UNKNOWN',false,'NO_MLB_CAREER_ENDED',null,null),
('christopher-arias','2026-10-05',null,null,'ROK',2017,2017,'DSL Dodgers 2','ROK','REL','2018-01-05','DSL LAD Mega','DSL Dodgers2 released LF Christopher Arias.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('damaso-marte-jr','2026-10-05',null,null,null,null,null,null,null,'REL','2017-02-15','AZL Dodgers 2','AZL Dodgers released SS Damaso Marte, Jr.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('luis-rodriguez-2015','2026-10-05',null,null,'ROK',2016,2019,'AZL Dodgers Lasorda','ROK','REL','2019-11-17','ACL Dodgers','AZL Dodgers Lasorda released 3B Luis Rodriguez.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('omar-estevez','2026-10-05',null,null,'AAA',2021,2022,'Oklahoma City Dodgers','AAA',null,null,null,null,'UNKNOWN',false,'NO_MLB_CAREER_ENDED',null,null),
('ronny-brito','2026-10-05',null,null,'A+',2019,2021,'Vancouver Canadians','A+','REL','2021-08-03','Vancouver Canadians','Vancouver Canadians released SS Ronny Brito.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('starling-heredia','2026-10-05',null,null,'A+',2019,2019,'Rancho Cucamonga Quakes','A+','REL','2020-07-01','Rancho Cucamonga Quakes','Rancho Cucamonga Quakes released LF Starling Heredia.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('yadier-alvarez','2026-10-05',null,null,'AAA',2022,2022,'Oklahoma City Dodgers','AAA',null,null,null,null,'UNKNOWN',false,'NO_MLB_CAREER_ENDED',null,null),
('alex-de-jesus','2026-10-05',null,null,'AA',2024,2025,'New Hampshire Fisher Cats','AA',null,null,null,null,'UNKNOWN',false,'INSUFFICIENT_EVIDENCE',null,null),
('christian-suarez','2026-10-05',null,null,'AA',2024,2026,'Tulsa Drillers','AA',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('diego-cartaya','2026-10-05',null,null,'AAA',2024,2026,'Eugene Emeralds','A+','REL','2026-04-25','Eugene Emeralds','Eugene Emeralds released C Diego Cartaya.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('ender-avendano','2026-10-05',null,null,'ROK',2019,2019,'DSL LAD Bautista','ROK',null,null,null,null,'UNKNOWN',false,'NO_MLB_CAREER_ENDED',null,null),
('gregory-pereira','2026-10-05',null,null,'ROK',2019,2019,'DSL LAD Bautista','ROK','REL','2019-12-13','DSL LAD Bautista','DSL Dodgers Bautista released OF Gregory Pereira.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('jerami-rodriguez','2026-10-05',null,null,'ROK',2019,2019,'DSL Dodgers Shoemaker','ROK','REL','2021-02-09','DSL LAD Mega','DSL Dodgers Shoemaker released RHP Jeremi Rodriguez.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('jerming-rosario','2026-10-05',null,null,'AAA',2024,2026,'Oklahoma City Comets','AAA',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('luis-izturis','2026-10-05',null,null,'ROK',2019,2019,'DSL Dodgers Shoemaker','ROK','REL','2020-09-17','DSL LAD Mega','DSL Dodgers Shoemaker released SS Luis Izturis.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('miguel-droz','2026-10-05',null,null,'ROK',2019,2022,'ACL Dodgers','ROK','REL','2022-08-03','ACL Dodgers','ACL Dodgers released SS Miguel Droz.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('rafael-tua','2026-10-05',null,null,'ROK',2019,2022,'ACL Dodgers','ROK','REL','2022-08-03','ACL Dodgers','ACL Dodgers released RHP Rafael Tua.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('lesther-medrano','2026-10-05',null,null,'ROK',2021,2023,'DSL LAD Bautista','ROK','REL','2023-09-06','DSL LAD Mega','DSL LAD Mega released RHP Lesther Medrano.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('luis-rodriguez-2019','2026-10-05',null,null,'A+',2024,2024,'Great Lakes Loons','A+',null,null,null,null,'UNKNOWN',false,'NO_MLB_CAREER_ENDED',null,null),
('roque-gutierrez','2026-10-05',null,null,'AA',2025,2026,'Tulsa Drillers','AA',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('yeiner-fernandez','2026-10-05',null,null,'AA',2024,2026,'Tulsa Drillers','AA',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('brian-diaz','2026-10-05',null,null,'ROK',2021,2021,'DSL LAD Bautista','ROK','REL','2022-03-21','DSL LAD Bautista','DSL Dodgers Bautista released RHP Brian Diaz.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('carlos-avila','2026-10-05',null,null,'AAA',2025,2025,'Oklahoma City Comets','AAA','REL','2026-03-31','ACL Dodgers','ACL Dodgers released C Carlos Avila.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('christian-romero','2026-10-05',null,null,'AAA',2024,2026,'Oklahoma City Comets','AAA',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('dailoui-abad','2026-10-05',null,null,'A',2023,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('elio-campos','2026-10-05',null,null,'AAA',2025,2025,'Gwinnett Stripers','AAA','REL','2026-03-15','FCL Braves','FCL Braves released 2B Elio Campos.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('isaac-barreto','2026-10-05',null,null,null,null,null,null,null,null,null,null,null,'UNKNOWN',false,'INSUFFICIENT_EVIDENCE',null,null),
('jesus-galiz','2026-10-05',null,null,'A+',2024,2026,'Great Lakes Loons','A+',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('jhonny-jimenez','2026-10-05',null,null,'A',2025,2026,'Ontario Tower Buzzers','A','REL','2026-08-06','Ontario Tower Buzzers','Ontario Tower Buzzers released RHP Jhonny Jimenez.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('jorge-carpintero','2026-10-05',null,null,null,null,null,null,null,null,null,null,null,'UNKNOWN',false,'INSUFFICIENT_EVIDENCE',null,null),
('juan-alonso','2026-10-05',null,null,'A+',2024,2024,'Great Lakes Loons','A+','REL','2024-11-19','Great Lakes Loons','Great Lakes Loons released OF Juan Alonso.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('kelvin-ramirez','2026-10-05',null,null,'AA',2025,2026,'Tulsa Drillers','AA',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('luis-guerra','2026-10-05',null,null,'A+',2023,2023,'Great Lakes Loons','A+','REL','2024-03-26','ACL Dodgers','ACL Dodgers released SS Luis Guerra.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('maximo-martinez','2026-10-05',null,null,'ROK',2021,2025,'ACL White Sox','ROK','REL','2026-05-01','ACL White Sox','ACL White Sox released RHP Maximo Martinez.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('michael-vilchez','2026-10-05',null,null,'A',2025,2025,'Rancho Cucamonga Quakes','A','REL','2025-08-27','ACL Dodgers','ACL Dodgers released RHP Michael Vilchez.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('miguel-bastardo','2026-10-05',null,null,'ROK',2021,2021,'DSL Dodgers Shoemaker','ROK','REL','2022-01-07','DSL LAD Mega','DSL Dodgers Shoemaker released RHP Miguel Bastardo.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('missael-soto','2026-10-05',null,null,'ROK',2021,2022,'DSL LAD Bautista','ROK',null,null,null,null,'UNKNOWN',false,'NO_MLB_CAREER_ENDED',null,null),
('pedro-santillan','2026-10-05',null,null,'A',2024,2024,'Rancho Cucamonga Quakes','A','REL','2025-11-14','Rancho Cucamonga Quakes','Rancho Cucamonga Quakes released RHP Pedro Santillan.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('rayne-doncon','2026-10-05',null,null,'A+',2024,2026,'Cedar Rapids Kernels','A+','REL','2026-07-30','Cedar Rapids Kernels','Cedar Rapids Kernels released 3B Rayne Doncon.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('roger-lasso','2026-10-05',null,null,'A',2025,2025,'Rancho Cucamonga Quakes','A','REL','2025-08-08','ACL Dodgers','ACL Dodgers released OF Roger Lasso.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('sebastian-jimenez','2026-10-05',null,null,null,null,null,null,null,'REL','2022-05-25','DSL LAD Bautista','DSL Dodgers Bautista released LHP Sebastian Jimenez.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('thayron-liranzo','2026-10-05',null,null,'AA',2025,2026,'Erie SeaWolves','AA',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('wilman-diaz','2026-10-05',null,null,'A+',2025,2025,'Great Lakes Loons','A+','REL','2025-08-06','Great Lakes Loons','Great Lakes Loons released SS Wilman Diaz.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('abel-lorenzo','2026-10-05',null,null,'A',2026,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('accimias-morales','2026-10-05',null,null,'A+',2026,2026,'Great Lakes Loons','A+',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('agustin-acosta','2026-10-05',null,null,'AA',2026,2026,'Tulsa Drillers','AA',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('aldrin-batista','2026-10-05',null,null,'A+',2024,2025,'Winston-Salem Dash','A+',null,null,null,null,'UNKNOWN',false,'INSUFFICIENT_EVIDENCE',null,null),
('alexander-albertus','2026-10-05',null,null,'A',2024,2026,'Kannapolis Cannon Ballers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('anderson-estevez','2026-10-05',null,null,'ROK',2022,2023,'DSL LAD Bautista','ROK','REL','2023-12-14','DSL LAD Bautista','DSL LAD Bautista released RHP Anderson Estevez.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('angel-cruz','2026-10-05',null,null,'A',2026,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('arod-mckenzie','2026-10-05',null,null,'ROK',2022,2022,'DSL LAD Mega','ROK','REL','2023-09-06','DSL LAD Mega','DSL LAD Mega released LHP Arod McKenzie.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('ben-serunkuma','2026-10-05',null,null,'A',2023,2024,'Rancho Cucamonga Quakes','A','REL','2024-08-06','ACL Dodgers','ACL Dodgers released RHP Ben Serunkuma.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('callum-wallace','2026-10-05',null,null,'A',2024,2024,'Rancho Cucamonga Quakes','A','REL','2025-03-23','Rancho Cucamonga Quakes','Rancho Cucamonga Quakes released RHP Callum Wallace.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('daniel-arrias','2026-10-05',null,null,'ROK',2022,2022,'DSL LAD Bautista','ROK','REL','2022-08-02','DSL LAD Bautista','DSL LAD Bautista released CF Daniel Arrias.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('domingo-geronimo','2026-10-05',null,null,'AA',2025,2026,'Ontario Tower Buzzers','A','REL','2026-05-21','Ontario Tower Buzzers','Ontario Tower Buzzers released RHP Domingo Geronimo.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('edgar-aviles','2026-10-05',null,null,'ROK',2022,2022,'DSL LAD Bautista','ROK','REL','2023-05-09','DSL LAD Mega','DSL LAD Mega released RHP Edgar Aviles.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('edgar-gomez','2026-10-05',null,null,null,null,null,null,null,null,null,null,null,'UNKNOWN',false,'INSUFFICIENT_EVIDENCE',null,null),
('edgar-leon','2026-10-05',null,null,'A',2025,2026,'ACL Dodgers','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('eduardo-guerrero','2026-10-05',null,null,'AAA',2024,2026,'Great Lakes Loons','A+',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('enrike-sevilya','2026-10-05',null,null,'ROK',2022,2023,'DSL LAD Mega','ROK','REL','2023-09-06','DSL LAD Mega','DSL LAD Mega released RHP Enrike Sevilya.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('erick-nava','2026-10-05',null,null,'ROK',2023,2023,'DSL LAD Bautista','ROK','REL','2023-12-14','DSL LAD Bautista','DSL LAD Bautista released RHP Erick Nava.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('franderly-morel','2026-10-05',null,null,'ROK',2023,2026,'ACL Dodgers','ROK','REL','2026-08-13','ACL Dodgers','ACL Dodgers released LHP Franderly Morel.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('ilmerson-colon','2026-10-05',null,null,'ROK',2022,2024,'DSL LAD Mega','ROK','REL','2024-12-16','DSL LAD Mega','DSL LAD Mega released LHP Ilmerson Colon.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('javier-bartolozzi','2026-10-05',null,null,'A',2026,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('javier-pena','2026-10-05',null,null,'ROK',2022,2023,'DSL LAD Bautista','ROK','REL','2023-09-06','DSL LAD Bautista','DSL LAD Bautista released C Javier Pena.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('jecsua-liborius','2026-10-05',null,null,'A',2026,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('jeral-perez','2026-10-05',null,null,'AA',2026,2026,'Birmingham Barons','AA',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('jeremy-castro','2026-10-05',null,null,'ROK',2023,2024,'DSL LAD Bautista','ROK','REL','2024-07-30','DSL LAD Bautista','DSL LAD Bautista released RHP Jeremy Castro.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('jholbran-herder','2026-10-05',null,null,'A',2025,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('jose-gonzalez','2026-10-05',null,null,'A',2026,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('jose-torrez','2026-10-05',null,null,'ROK',2023,2024,'DSL LAD Bautista','ROK','REL','2025-04-02','DSL LAD Bautista','DSL LAD Bautista released C Jose Torrez.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('joseilyn-gonzalez','2026-10-05',null,null,'A+',2025,2026,'Great Lakes Loons','A+',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('juan-hernandez','2026-10-05',null,null,'ROK',2022,2024,'DSL LAD Bautista','ROK','REL','2025-03-25','DSL LAD Bautista','DSL LAD Bautista released RHP Juan Hernandez.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('kosuke-matsuda','2026-10-05',null,null,null,null,null,null,null,'REL','2022-08-25','ACL Dodgers','ACL Dodgers released RHP Kosuke Matsuda.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('luciano-romero','2026-10-05',null,null,'ROK',2022,2025,'ACL Dodgers','ROK','REL','2025-08-08','ACL Dodgers','ACL Dodgers released RHP Luciano Romero.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('mairoshendrick-martinus','2026-10-05',null,null,'A+',2025,2026,'Great Lakes Loons','A+',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('marco-corcho','2026-10-05',null,null,'A',2024,2026,'ACL Dodgers','ROK','REL','2026-06-03','ACL Dodgers','ACL Dodgers released RHP Marco Corcho.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('miguel-dominguez','2026-10-05',null,null,'ROK',2022,2023,'DSL LAD Bautista','ROK','REL','2024-06-01','DSL LAD Bautista','DSL LAD Bautista released C Miguel Dominguez.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('natanael-castillo','2026-10-05',null,null,'ROK',2022,2022,'DSL LAD Mega','ROK','REL','2023-06-01','DSL LAD Mega','DSL LAD Mega released SS Natanael Castillo.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('nicolas-cruz','2026-10-05',null,null,'A+',2024,2026,'Great Lakes Loons','A+',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('oswaldo-osorio','2026-10-05',null,null,'A',2024,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('paris-johnson','2026-10-05',null,null,'ROK',2023,2024,'DSL LAD Bautista','ROK','REL','2024-12-16','DSL LAD Mega','DSL LAD Mega released OF Paris Johnson.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('peter-bonilla','2026-10-05',null,null,'A',2026,2026,'Ontario Tower Buzzers','A','REL','2026-08-06','Ontario Tower Buzzers','Ontario Tower Buzzers released LHP Peter Bonilla.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('railin-familia','2026-10-05',null,null,'ROK',2023,2025,'DSL LAD Bautista','ROK','REL','2025-08-27','DSL LAD Mega','DSL LAD Mega released C Railin Familia.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('raynerd-ortega','2026-10-05',null,null,'A',2025,2025,'Rancho Cucamonga Quakes','A','REL','2026-03-23','ACL Dodgers','ACL Dodgers released SS Raynerd Ortega.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('ricardo-montero','2026-10-05',null,null,'A',2026,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('rodmar-angela','2026-10-05',null,null,'ROK',2023,2023,'DSL LAD Bautista','ROK','REL','2024-05-13','DSL LAD Mega','DSL LAD Mega released OF Rodmar Angela.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('roiger-mujica','2026-10-05',null,null,'ROK',2022,2026,'ACL Dodgers','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('samuel-munoz','2026-10-05',null,null,'A+',2025,2026,'Great Lakes Loons','A+',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('sean-linan','2026-10-05',null,null,'AAA',2025,2026,'Somerset Patriots','AA',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('steven-castillo','2026-10-05',null,null,'ROK',2022,2022,'DSL LAD Bautista','ROK','REL','2023-05-05','DSL LAD Bautista','DSL LAD Bautista released RHP Steven Castillo.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('tim-fischer','2026-10-05',null,null,'ROK',2023,2025,'ACL Dodgers','ROK','REL','2025-08-23','ACL Dodgers','ACL Dodgers released RHP Tim Fischer.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('umar-male','2026-10-05',null,null,'AA',2023,2023,'Tulsa Drillers','AA','REL','2024-03-11','Tulsa Drillers','Tulsa Drillers released C Umar Male.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('victor-rodrigues','2026-10-05',null,null,'A+',2026,2026,'Great Lakes Loons','A+',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('yhonaider-gudino','2026-10-05',null,null,null,null,null,null,null,null,null,null,null,'UNKNOWN',false,'INSUFFICIENT_EVIDENCE',null,null),
('yorfran-medina','2026-10-05',null,null,'ROK',2022,2024,'DSL LAD Mega','ROK','REL','2025-04-17','DSL LAD Mega','DSL LAD Mega released OF Yorfran Medina.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('yoryi-simarra','2026-10-05',null,null,'ROK',2022,2025,'ACL Dodgers','ROK','REL','2025-08-08','ACL Dodgers','ACL Dodgers released RHP Yoryi Simarra.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('yuliangel-de-la-cruz','2026-10-05',null,null,'ROK',2022,2026,'ACL Dodgers','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('anderson-jerez','2026-10-05',null,null,'ROK',2023,2024,'DSL LAD Mega','ROK','REL','2025-03-26','DSL LAD Mega','DSL LAD Mega released RHP Anderson Jerez.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('arnaldo-lantigua','2026-10-05',null,null,'A',2025,2026,'Daytona Tortugas','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('daniel-mielcarek','2026-10-05',null,null,'ROK',2023,2026,'ACL Dodgers','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('eduardo-quintero','2026-10-05',null,null,'AA',2026,2026,'Tulsa Drillers','AA',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('elias-medina','2026-10-05',null,null,'ROK',2023,2026,'ACL Dodgers','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('erick-batista','2026-10-05',null,null,'ROK',2023,2024,'DSL LAD Bautista','ROK','REL','2025-03-26','DSL LAD Mega','DSL LAD Mega released RHP Erick Batista.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('harold-gonzalez','2026-10-05',null,null,'ROK',2023,2026,'ACL Dodgers','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('javier-herrera','2026-10-05',null,null,'AAA',2025,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('jesus-tillero','2026-10-05',null,null,'A',2025,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('joendry-vargas','2026-10-05',null,null,'A',2025,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('luis-carias','2026-10-05',null,null,'A',2025,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('robinson-ventura','2026-10-05',null,null,'ROK',2023,2024,'DSL LAD Bautista','ROK','REL','2025-04-02','DSL LAD Bautista','DSL LAD Bautista released RHP Robinson Ventura.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('samuel-sanchez','2026-10-05',null,null,'A',2024,2025,'Rancho Cucamonga Quakes','A',null,null,null,null,'UNKNOWN',false,'INSUFFICIENT_EVIDENCE',null,null),
('alexis-dominguez','2026-10-05',null,null,'ROK',2024,2025,'DSL LAD Bautista','ROK','REL','2025-11-07','DSL LAD Bautista','DSL LAD Bautista released RHP Alexis Dominguez.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('allen-ajoti','2026-10-05',null,null,'ROK',2024,2026,'DSL LAD Bautista','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('angel-ramirez','2026-10-05',null,null,null,null,null,null,null,'REL','2024-12-16','DSL LAD Mega','DSL LAD Mega released RHP Angel Ramirez.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('axel-perez','2026-10-05',null,null,'ROK',2025,2026,'DSL Orioles Black','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('carlos-sardina','2026-10-05',null,null,'ROK',2024,2024,'DSL LAD Mega','ROK','REL','2025-01-16','DSL LAD Mega','DSL LAD Mega released RHP Carlos Sardina.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('christian-muniz','2026-10-05',null,null,'ROK',2024,2024,'DSL LAD Bautista','ROK','REL','2025-03-26','DSL LAD Bautista','DSL LAD Bautista released RHP Christian Muniz.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('david-romero','2026-10-05',null,null,'ROK',2024,2024,'DSL LAD Bautista','ROK','REL','2025-01-16','DSL LAD Bautista','DSL LAD Bautista released 2B David Romero.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('eduardo-rojas','2026-10-05',null,null,'AAA',2026,2026,'Oklahoma City Comets','AAA',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('emil-morales','2026-10-05',null,null,'A+',2026,2026,'Great Lakes Loons','A+',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('erny-orellana','2026-10-05',null,null,'ROK',2024,2026,'DSL LAD Mega','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('euri-rosa','2026-10-05',null,null,'ROK',2024,2026,'ACL Dodgers','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('francisco-espinoza','2026-10-05',null,null,'A',2026,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('heudy-pena','2026-10-05',null,null,'ROK',2024,2025,'DSL LAD Bautista','ROK','REL','2025-08-27','DSL LAD Bautista','DSL LAD Bautista released SS Heudy Pena.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('jose-lopez','2026-10-05',null,null,'ROK',2024,2025,'DSL LAD Mega','ROK','REL','2025-11-07','DSL LAD Mega','DSL LAD Mega released RHP Jose Lopez.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('leider-padilla','2026-10-05',null,null,'ROK',2024,2026,'ACL Dodgers','ROK','REL','2026-08-13','ACL Dodgers','ACL Dodgers released OF Leider Padilla.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('michael-ramirez','2026-10-05',null,null,'ROK',2024,2026,'ACL Dodgers','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('rafy-peguero','2026-10-05',null,null,'ROK',2024,2026,'DSL LAD Mega','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('reyli-mariano','2026-10-05',null,null,'AA',2026,2026,'Tulsa Drillers','AA',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('yojackson-laya','2026-10-05',null,null,'ROK',2024,2026,'ACL Dodgers','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('adrian-torres','2026-10-05',null,null,'ROK',2025,2025,'DSL LAD Mega','ROK',null,null,null,null,'UNKNOWN',false,'INSUFFICIENT_EVIDENCE',null,null),
('alexis-reyes','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Bautista','ROK','REL','2026-08-29','DSL LAD Bautista','DSL LAD Bautista released RHP Alexis Reyes.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('andres-luna','2026-10-05',null,null,'ROK',2025,2025,'DSL LAD Bautista','ROK','REL','2025-08-28','DSL LAD Mega','DSL LAD Mega released RHP Andres Luna.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('aneudy-almonte','2026-10-05',null,null,'ROK',2025,2026,'ACL Dodgers','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('antoni-urena','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Mega','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('bryan-lara','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Bautista','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('carlos-ramirez','2026-10-05',null,null,'ROK',2025,2025,'DSL LAD Mega','ROK',null,null,null,null,'UNKNOWN',false,'INSUFFICIENT_EVIDENCE',null,null),
('cesar-sanchez','2026-10-05',null,null,'ROK',2025,2026,'ACL Dodgers','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('degerson-diaz','2026-10-05',null,null,'ROK',2025,2025,'DSL LAD Bautista','ROK','REL','2025-11-07','DSL LAD Bautista','DSL LAD Bautista released OF Degerson Diaz.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('derik-aquino','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Mega','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('devlyn-bautista','2026-10-05',null,null,'ROK',2025,2025,'DSL LAD Mega','ROK','REL','2025-08-27','DSL LAD Mega','DSL LAD Mega released OF Devlyn Bautista.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('ezequiel-aparicio','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Mega','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('hendry-arvelo','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Mega','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('ivan-pacheco','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Mega','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('jhon-gil','2026-10-05',null,null,'ROK',2025,2026,'ACL Dodgers','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('jhosman-theran','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Bautista','ROK','REL','2026-08-29','DSL LAD Bautista','DSL LAD Bautista released OF Jhosman Theran.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('jose-rivas','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Mega','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('jose-villegas','2026-10-05',null,null,'ROK',2025,2025,'DSL LAD Bautista','ROK','REL','2026-03-17','DSL LAD Bautista','DSL LAD Bautista released RHP Jose Villegas.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('joseph-deng-thon','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Mega','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('juan-macero','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Mega','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('luis-gamez','2026-10-05',null,null,'A',2026,2026,'Ontario Tower Buzzers','A',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('luis-luna','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Mega','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('luis-tovar','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Mega','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('moises-acacio','2026-10-05',null,null,'ROK',2025,2026,'ACL Dodgers','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('moises-rangel','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Bautista','ROK','REL','2026-08-29','DSL LAD Bautista','DSL LAD Bautista released C Moises Rangel.','RELEASED',false,'NO_MLB_CAREER_ENDED',null,null),
('ricardo-roman','2026-10-05',null,null,'ROK',2026,2026,'DSL LAD Mega','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('samuel-savinon','2026-10-05',null,null,'ROK',2025,2026,'ACL Dodgers','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('shai-romero','2026-10-05',null,null,'ROK',2025,2026,'DSL LAD Bautista','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('ariel-reynoso','2026-10-05',null,null,'ROK',2026,2026,'DSL LAD Bautista','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('ezequiel-melburne','2026-10-05',null,null,'ROK',2026,2026,'DSL LAD Bautista','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('jose-requena','2026-10-05',null,null,'ROK',2026,2026,'DSL Arizona Black','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('jose-victorino','2026-10-05',null,null,'ROK',2026,2026,'DSL LAD Mega','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null),
('rubel-arias','2026-10-05',null,null,'ROK',2026,2026,'DSL LAD Bautista','ROK',null,null,null,null,'ACTIVE',true,'NO_MLB_ACTIVE_IN_MINORS',null,null);

create temporary table _m019_audits (slug text, reached_mlb boolean, outcome_state text, is_new_audit boolean, evidence_summary text) on commit drop;
insert into _m019_audits values
('roger-cedeno',true,'REACHED_MLB',true,'MLB debut 1995-06-20 in the MLB person record.'),
('carlos-frias',true,'REACHED_MLB',true,'MLB debut 2014-08-04 in the MLB person record.'),
('julian-leon',false,'NO_MLB_CAREER_ENDED',true,'No affiliated appearance since 2019; no MLB debut through 2026-10-05.'),
('lenix-osuna',false,'NO_MLB_CAREER_ENDED',true,'No affiliated appearance since 2017; no MLB debut through 2026-10-05.'),
('william-soto',false,'NO_MLB_CAREER_ENDED',true,'No affiliated appearance since 2017; no MLB debut through 2026-10-05.'),
('gersel-pitre',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2025-11-12; last affiliated season 2019 (A); no MLB debut through 2026-10-05.'),
('hendrik-clementina',false,'NO_MLB_CAREER_ENDED',true,'No affiliated appearance since 2023; no MLB debut through 2026-10-05.'),
('julio-lugo-prospect',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2016-08-12; last affiliated season 2016 (ROK); no MLB debut through 2026-10-05.'),
('misja-harcksen',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2016-09-18; last affiliated season 2016 (ROK); no MLB debut through 2026-10-05.'),
('shakir-albert',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2018-05-16; last affiliated season 2017 (A); no MLB debut through 2026-10-05.'),
('aldo-espinoza',null,'NO_MLB_CAREER_ENDED',false,'Final transaction REL on 2020-07-01; last affiliated season 2019 (ROK); no MLB debut through 2026-10-05.'),
('carlos-rincon',null,'NO_MLB_CAREER_ENDED',false,'No affiliated appearance since 2022; no MLB debut through 2026-10-05.'),
('christopher-arias',null,'NO_MLB_CAREER_ENDED',false,'Final transaction REL on 2018-01-05; last affiliated season 2017 (ROK); no MLB debut through 2026-10-05.'),
('damaso-marte-jr',null,'NO_MLB_CAREER_ENDED',false,'Final transaction REL on 2017-02-15; no affiliated games recorded; no MLB debut through 2026-10-05.'),
('luis-rodriguez-2015',null,'NO_MLB_CAREER_ENDED',false,'Final transaction REL on 2019-11-17; last affiliated season 2019 (ROK); no MLB debut through 2026-10-05.'),
('omar-estevez',null,'NO_MLB_CAREER_ENDED',false,'No affiliated appearance since 2022; no MLB debut through 2026-10-05.'),
('ronny-brito',null,'NO_MLB_CAREER_ENDED',false,'Final transaction REL on 2021-08-03; last affiliated season 2021 (A+); no MLB debut through 2026-10-05.'),
('starling-heredia',null,'NO_MLB_CAREER_ENDED',false,'Final transaction REL on 2020-07-01; last affiliated season 2019 (A+); no MLB debut through 2026-10-05.'),
('yadier-alvarez',null,'NO_MLB_CAREER_ENDED',false,'No affiliated appearance since 2022; no MLB debut through 2026-10-05.'),
('alex-de-jesus',null,'NO_MLB_STATUS_UNKNOWN',false,'Last affiliated season 2025, no exit transaction; status unclear.'),
('christian-suarez',false,'NO_MLB_ACTIVE_IN_MINORS',true,'Played affiliated AA in 2026; no MLB debut through 2026-10-05.'),
('diego-cartaya',null,'NO_MLB_CAREER_ENDED',false,'Final transaction REL on 2026-04-25; last affiliated season 2026 (A+); no MLB debut through 2026-10-05.'),
('ender-avendano',false,'NO_MLB_CAREER_ENDED',true,'No affiliated appearance since 2019; no MLB debut through 2026-10-05.'),
('gregory-pereira',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2019-12-13; last affiliated season 2019 (ROK); no MLB debut through 2026-10-05.'),
('jerami-rodriguez',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2021-02-09; last affiliated season 2019 (ROK); no MLB debut through 2026-10-05.'),
('jerming-rosario',null,'NO_MLB_ACTIVE_IN_MINORS',false,'Played affiliated AAA in 2026; no MLB debut through 2026-10-05.'),
('luis-izturis',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2020-09-17; last affiliated season 2019 (ROK); no MLB debut through 2026-10-05.'),
('miguel-droz',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2022-08-03; last affiliated season 2022 (ROK); no MLB debut through 2026-10-05.'),
('rafael-tua',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2022-08-03; last affiliated season 2022 (ROK); no MLB debut through 2026-10-05.'),
('lesther-medrano',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2023-09-06; last affiliated season 2023 (ROK); no MLB debut through 2026-10-05.'),
('luis-rodriguez-2019',null,'NO_MLB_CAREER_ENDED',false,'No affiliated appearance since 2024; no MLB debut through 2026-10-05.'),
('roque-gutierrez',false,'NO_MLB_ACTIVE_IN_MINORS',true,'Played affiliated AA in 2026; no MLB debut through 2026-10-05.'),
('yeiner-fernandez',false,'NO_MLB_ACTIVE_IN_MINORS',true,'Played affiliated AA in 2026; no MLB debut through 2026-10-05.'),
('brian-diaz',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2022-03-21; last affiliated season 2021 (ROK); no MLB debut through 2026-10-05.'),
('carlos-avila',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2026-03-31; last affiliated season 2025 (AAA); no MLB debut through 2026-10-05.'),
('elio-campos',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2026-03-15; last affiliated season 2025 (AAA); no MLB debut through 2026-10-05.'),
('jhonny-jimenez',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2026-08-06; last affiliated season 2026 (A); no MLB debut through 2026-10-05.'),
('juan-alonso',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2024-11-19; last affiliated season 2024 (A+); no MLB debut through 2026-10-05.'),
('luis-guerra',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2024-03-26; last affiliated season 2023 (A+); no MLB debut through 2026-10-05.'),
('maximo-martinez',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2026-05-01; last affiliated season 2025 (ROK); no MLB debut through 2026-10-05.'),
('michael-vilchez',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2025-08-27; last affiliated season 2025 (A); no MLB debut through 2026-10-05.'),
('miguel-bastardo',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2022-01-07; last affiliated season 2021 (ROK); no MLB debut through 2026-10-05.'),
('missael-soto',false,'NO_MLB_CAREER_ENDED',true,'No affiliated appearance since 2022; no MLB debut through 2026-10-05.'),
('pedro-santillan',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2025-11-14; last affiliated season 2024 (A); no MLB debut through 2026-10-05.'),
('rayne-doncon',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2026-07-30; last affiliated season 2026 (A+); no MLB debut through 2026-10-05.'),
('roger-lasso',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2025-08-08; last affiliated season 2025 (A); no MLB debut through 2026-10-05.'),
('sebastian-jimenez',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2022-05-25; no affiliated games recorded; no MLB debut through 2026-10-05.'),
('wilman-diaz',false,'NO_MLB_CAREER_ENDED',true,'Final transaction REL on 2025-08-06; last affiliated season 2025 (A+); no MLB debut through 2026-10-05.');

create temporary table _m019_sources (slug text, url text, retrieved_at timestamptz, supports_fields text[]) on commit drop;
insert into _m019_sources values
('roger-cedeno','https://statsapi.mlb.com/api/v1/people/112155','2026-10-05T21:08:31.025Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('roger-cedeno','https://statsapi.mlb.com/api/v1/transactions?playerId=112155','2026-10-05T21:08:31.448Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('roger-cedeno','https://statsapi.mlb.com/api/v1/people/112155/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:08:32.316Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('roger-cedeno','https://statsapi.mlb.com/api/v1/people/112155/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:08:33.075Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('roger-cedeno','https://statsapi.mlb.com/api/v1/people/112155/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:08:33.714Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('roger-cedeno','https://statsapi.mlb.com/api/v1/people/112155/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:08:34.500Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('carlos-frias','https://statsapi.mlb.com/api/v1/people/516910','2026-10-05T21:08:35.237Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('carlos-frias','https://statsapi.mlb.com/api/v1/transactions?playerId=516910','2026-10-05T21:08:36.015Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('carlos-frias','https://statsapi.mlb.com/api/v1/people/516910/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:08:36.778Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('carlos-frias','https://statsapi.mlb.com/api/v1/people/516910/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:08:37.596Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('carlos-frias','https://statsapi.mlb.com/api/v1/people/516910/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:08:38.301Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('carlos-frias','https://statsapi.mlb.com/api/v1/people/516910/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:08:39.210Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('julian-leon','https://statsapi.mlb.com/api/v1/people/624645','2026-10-05T21:06:49.875Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('julian-leon','https://statsapi.mlb.com/api/v1/transactions?playerId=624645','2026-10-05T21:08:39.805Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('julian-leon','https://statsapi.mlb.com/api/v1/people/624645/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:08:40.559Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('julian-leon','https://statsapi.mlb.com/api/v1/people/624645/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:08:41.385Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('julian-leon','https://statsapi.mlb.com/api/v1/people/624645/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:08:42.082Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('julian-leon','https://statsapi.mlb.com/api/v1/people/624645/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:08:42.841Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('lenix-osuna','https://statsapi.mlb.com/api/v1/people/624646','2026-10-05T21:06:50.666Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('lenix-osuna','https://statsapi.mlb.com/api/v1/transactions?playerId=624646','2026-10-05T21:08:43.595Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('lenix-osuna','https://statsapi.mlb.com/api/v1/people/624646/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:08:44.319Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('lenix-osuna','https://statsapi.mlb.com/api/v1/people/624646/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:08:45.100Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('lenix-osuna','https://statsapi.mlb.com/api/v1/people/624646/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:08:45.852Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('lenix-osuna','https://statsapi.mlb.com/api/v1/people/624646/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:08:46.707Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('william-soto','https://statsapi.mlb.com/api/v1/people/624648','2026-10-05T21:08:20.662Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('william-soto','https://statsapi.mlb.com/api/v1/transactions?playerId=624648','2026-10-05T21:08:47.472Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('william-soto','https://statsapi.mlb.com/api/v1/people/624648/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:08:48.204Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('william-soto','https://statsapi.mlb.com/api/v1/people/624648/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:08:48.973Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('william-soto','https://statsapi.mlb.com/api/v1/people/624648/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:08:49.697Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('william-soto','https://statsapi.mlb.com/api/v1/people/624648/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:08:50.572Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('gersel-pitre','https://statsapi.mlb.com/api/v1/people/649957','2026-10-05T21:06:52.902Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('gersel-pitre','https://statsapi.mlb.com/api/v1/transactions?playerId=649957','2026-10-05T21:08:51.224Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('gersel-pitre','https://statsapi.mlb.com/api/v1/people/649957/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:08:51.972Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('gersel-pitre','https://statsapi.mlb.com/api/v1/people/649957/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:08:52.834Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('gersel-pitre','https://statsapi.mlb.com/api/v1/people/649957/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:08:53.521Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('gersel-pitre','https://statsapi.mlb.com/api/v1/people/649957/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:08:54.259Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('hendrik-clementina','https://statsapi.mlb.com/api/v1/people/649955','2026-10-05T21:06:53.656Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('hendrik-clementina','https://statsapi.mlb.com/api/v1/transactions?playerId=649955','2026-10-05T21:08:55.002Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('hendrik-clementina','https://statsapi.mlb.com/api/v1/people/649955/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:08:55.762Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('hendrik-clementina','https://statsapi.mlb.com/api/v1/people/649955/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:08:56.597Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('hendrik-clementina','https://statsapi.mlb.com/api/v1/people/649955/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:08:57.240Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('hendrik-clementina','https://statsapi.mlb.com/api/v1/people/649955/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:08:58.027Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('julio-lugo-prospect','https://statsapi.mlb.com/api/v1/people/649956','2026-10-05T21:08:20.985Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('julio-lugo-prospect','https://statsapi.mlb.com/api/v1/transactions?playerId=649956','2026-10-05T21:08:58.781Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('julio-lugo-prospect','https://statsapi.mlb.com/api/v1/people/649956/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:08:59.546Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('julio-lugo-prospect','https://statsapi.mlb.com/api/v1/people/649956/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:00.315Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('julio-lugo-prospect','https://statsapi.mlb.com/api/v1/people/649956/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:01.050Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('julio-lugo-prospect','https://statsapi.mlb.com/api/v1/people/649956/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:01.833Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('misja-harcksen','https://statsapi.mlb.com/api/v1/people/649958','2026-10-05T21:06:55.151Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('misja-harcksen','https://statsapi.mlb.com/api/v1/transactions?playerId=649958','2026-10-05T21:09:02.579Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('misja-harcksen','https://statsapi.mlb.com/api/v1/people/649958/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:03.347Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('misja-harcksen','https://statsapi.mlb.com/api/v1/people/649958/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:04.110Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('misja-harcksen','https://statsapi.mlb.com/api/v1/people/649958/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:04.857Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('misja-harcksen','https://statsapi.mlb.com/api/v1/people/649958/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:05.656Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('shakir-albert','https://statsapi.mlb.com/api/v1/people/649954','2026-10-05T21:06:55.919Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('shakir-albert','https://statsapi.mlb.com/api/v1/transactions?playerId=649954','2026-10-05T21:09:06.369Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('shakir-albert','https://statsapi.mlb.com/api/v1/people/649954/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:07.133Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('shakir-albert','https://statsapi.mlb.com/api/v1/people/649954/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:07.944Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('shakir-albert','https://statsapi.mlb.com/api/v1/people/649954/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:08.637Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('shakir-albert','https://statsapi.mlb.com/api/v1/people/649954/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:09.441Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('aldo-espinoza','https://statsapi.mlb.com/api/v1/people/665852','2026-10-05T21:13:19.687Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('aldo-espinoza','https://statsapi.mlb.com/api/v1/transactions?playerId=665852','2026-10-05T21:13:20.144Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('aldo-espinoza','https://statsapi.mlb.com/api/v1/people/665852/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:20.887Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('aldo-espinoza','https://statsapi.mlb.com/api/v1/people/665852/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:21.712Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('aldo-espinoza','https://statsapi.mlb.com/api/v1/people/665852/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:22.409Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('aldo-espinoza','https://statsapi.mlb.com/api/v1/people/665852/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:23.222Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('carlos-rincon','https://statsapi.mlb.com/api/v1/people/665779','2026-10-05T21:13:23.939Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('carlos-rincon','https://statsapi.mlb.com/api/v1/transactions?playerId=665779','2026-10-05T21:13:24.707Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('carlos-rincon','https://statsapi.mlb.com/api/v1/people/665779/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:25.456Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('carlos-rincon','https://statsapi.mlb.com/api/v1/people/665779/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:26.376Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('carlos-rincon','https://statsapi.mlb.com/api/v1/people/665779/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:27.001Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('carlos-rincon','https://statsapi.mlb.com/api/v1/people/665779/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:27.775Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('christopher-arias','https://statsapi.mlb.com/api/v1/people/665931','2026-10-05T21:13:14.026Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('christopher-arias','https://statsapi.mlb.com/api/v1/transactions?playerId=665931','2026-10-05T21:13:28.511Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('christopher-arias','https://statsapi.mlb.com/api/v1/people/665931/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:29.264Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('christopher-arias','https://statsapi.mlb.com/api/v1/people/665931/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:30.088Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('christopher-arias','https://statsapi.mlb.com/api/v1/people/665931/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:30.775Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('christopher-arias','https://statsapi.mlb.com/api/v1/people/665931/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:31.582Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('damaso-marte-jr','https://statsapi.mlb.com/api/v1/people/666006','2026-10-05T21:13:32.293Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('damaso-marte-jr','https://statsapi.mlb.com/api/v1/transactions?playerId=666006','2026-10-05T21:13:33.056Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('damaso-marte-jr','https://statsapi.mlb.com/api/v1/people/666006/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:33.811Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('damaso-marte-jr','https://statsapi.mlb.com/api/v1/people/666006/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:34.585Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('damaso-marte-jr','https://statsapi.mlb.com/api/v1/people/666006/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:35.316Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('damaso-marte-jr','https://statsapi.mlb.com/api/v1/people/666006/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:36.091Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-rodriguez-2015','https://statsapi.mlb.com/api/v1/people/665960','2026-10-05T21:13:36.837Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('luis-rodriguez-2015','https://statsapi.mlb.com/api/v1/transactions?playerId=665960','2026-10-05T21:13:37.588Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('luis-rodriguez-2015','https://statsapi.mlb.com/api/v1/people/665960/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:38.363Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-rodriguez-2015','https://statsapi.mlb.com/api/v1/people/665960/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:39.195Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-rodriguez-2015','https://statsapi.mlb.com/api/v1/people/665960/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:39.877Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-rodriguez-2015','https://statsapi.mlb.com/api/v1/people/665960/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:40.657Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('omar-estevez','https://statsapi.mlb.com/api/v1/people/666784','2026-10-05T21:13:41.367Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('omar-estevez','https://statsapi.mlb.com/api/v1/transactions?playerId=666784','2026-10-05T21:13:42.153Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('omar-estevez','https://statsapi.mlb.com/api/v1/people/666784/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:42.898Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('omar-estevez','https://statsapi.mlb.com/api/v1/people/666784/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:43.735Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('omar-estevez','https://statsapi.mlb.com/api/v1/people/666784/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:44.421Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('omar-estevez','https://statsapi.mlb.com/api/v1/people/666784/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:45.172Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ronny-brito','https://statsapi.mlb.com/api/v1/people/665798','2026-10-05T21:13:45.945Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('ronny-brito','https://statsapi.mlb.com/api/v1/transactions?playerId=665798','2026-10-05T21:13:46.718Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('ronny-brito','https://statsapi.mlb.com/api/v1/people/665798/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:47.446Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ronny-brito','https://statsapi.mlb.com/api/v1/people/665798/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:48.286Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ronny-brito','https://statsapi.mlb.com/api/v1/people/665798/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:48.979Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ronny-brito','https://statsapi.mlb.com/api/v1/people/665798/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:49.753Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('starling-heredia','https://statsapi.mlb.com/api/v1/people/665752','2026-10-05T21:13:50.476Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('starling-heredia','https://statsapi.mlb.com/api/v1/transactions?playerId=665752','2026-10-05T21:13:51.260Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('starling-heredia','https://statsapi.mlb.com/api/v1/people/665752/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:52.012Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('starling-heredia','https://statsapi.mlb.com/api/v1/people/665752/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:52.859Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('starling-heredia','https://statsapi.mlb.com/api/v1/people/665752/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:53.529Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('starling-heredia','https://statsapi.mlb.com/api/v1/people/665752/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:54.287Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('yadier-alvarez','https://statsapi.mlb.com/api/v1/people/665751','2026-10-05T21:13:55.025Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('yadier-alvarez','https://statsapi.mlb.com/api/v1/transactions?playerId=665751','2026-10-05T21:13:55.780Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('yadier-alvarez','https://statsapi.mlb.com/api/v1/people/665751/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:56.548Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('yadier-alvarez','https://statsapi.mlb.com/api/v1/people/665751/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:57.337Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('yadier-alvarez','https://statsapi.mlb.com/api/v1/people/665751/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:58.043Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('yadier-alvarez','https://statsapi.mlb.com/api/v1/people/665751/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:58.936Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('alex-de-jesus','https://statsapi.mlb.com/api/v1/people/682942','2026-10-05T21:13:59.597Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('alex-de-jesus','https://statsapi.mlb.com/api/v1/transactions?playerId=682942','2026-10-05T21:14:00.351Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('alex-de-jesus','https://statsapi.mlb.com/api/v1/people/682942/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:01.105Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('alex-de-jesus','https://statsapi.mlb.com/api/v1/people/682942/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:01.962Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('alex-de-jesus','https://statsapi.mlb.com/api/v1/people/682942/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:02.611Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('alex-de-jesus','https://statsapi.mlb.com/api/v1/people/682942/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:03.394Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('christian-suarez','https://statsapi.mlb.com/api/v1/people/682949','2026-10-05T21:06:58.979Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('christian-suarez','https://statsapi.mlb.com/api/v1/transactions?playerId=682949','2026-10-05T21:09:10.153Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('christian-suarez','https://statsapi.mlb.com/api/v1/people/682949/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:10.905Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('christian-suarez','https://statsapi.mlb.com/api/v1/people/682949/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:11.696Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('christian-suarez','https://statsapi.mlb.com/api/v1/people/682949/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:12.441Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('christian-suarez','https://statsapi.mlb.com/api/v1/people/682949/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:13.276Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('diego-cartaya','https://statsapi.mlb.com/api/v1/people/682616','2026-10-05T21:14:04.150Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('diego-cartaya','https://statsapi.mlb.com/api/v1/transactions?playerId=682616','2026-10-05T21:14:04.911Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('diego-cartaya','https://statsapi.mlb.com/api/v1/people/682616/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:05.645Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('diego-cartaya','https://statsapi.mlb.com/api/v1/people/682616/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:06.533Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('diego-cartaya','https://statsapi.mlb.com/api/v1/people/682616/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:07.167Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('diego-cartaya','https://statsapi.mlb.com/api/v1/people/682616/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:07.960Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ender-avendano','https://statsapi.mlb.com/api/v1/people/682937','2026-10-05T21:06:59.716Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('ender-avendano','https://statsapi.mlb.com/api/v1/transactions?playerId=682937','2026-10-05T21:09:13.958Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('ender-avendano','https://statsapi.mlb.com/api/v1/people/682937/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:14.714Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ender-avendano','https://statsapi.mlb.com/api/v1/people/682937/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:15.494Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ender-avendano','https://statsapi.mlb.com/api/v1/people/682937/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:16.206Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ender-avendano','https://statsapi.mlb.com/api/v1/people/682937/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:17.000Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('gregory-pereira','https://statsapi.mlb.com/api/v1/people/682946','2026-10-05T21:07:00.455Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('gregory-pereira','https://statsapi.mlb.com/api/v1/transactions?playerId=682946','2026-10-05T21:09:17.741Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('gregory-pereira','https://statsapi.mlb.com/api/v1/people/682946/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:18.506Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('gregory-pereira','https://statsapi.mlb.com/api/v1/people/682946/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:19.289Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('gregory-pereira','https://statsapi.mlb.com/api/v1/people/682946/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:20.030Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('gregory-pereira','https://statsapi.mlb.com/api/v1/people/682946/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:20.799Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jerami-rodriguez','https://statsapi.mlb.com/api/v1/people/682951','2026-10-05T21:09:21.539Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jerami-rodriguez','https://statsapi.mlb.com/api/v1/transactions?playerId=682951','2026-10-05T21:09:22.303Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jerami-rodriguez','https://statsapi.mlb.com/api/v1/people/682951/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:23.064Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jerami-rodriguez','https://statsapi.mlb.com/api/v1/people/682951/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:23.832Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jerami-rodriguez','https://statsapi.mlb.com/api/v1/people/682951/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:24.585Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jerami-rodriguez','https://statsapi.mlb.com/api/v1/people/682951/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:25.336Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jerming-rosario','https://statsapi.mlb.com/api/v1/people/682645','2026-10-05T21:14:08.678Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jerming-rosario','https://statsapi.mlb.com/api/v1/transactions?playerId=682645','2026-10-05T21:14:09.460Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jerming-rosario','https://statsapi.mlb.com/api/v1/people/682645/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:10.203Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jerming-rosario','https://statsapi.mlb.com/api/v1/people/682645/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:10.975Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jerming-rosario','https://statsapi.mlb.com/api/v1/people/682645/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:11.715Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jerming-rosario','https://statsapi.mlb.com/api/v1/people/682645/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:12.616Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-izturis','https://statsapi.mlb.com/api/v1/people/682950','2026-10-05T21:07:01.980Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('luis-izturis','https://statsapi.mlb.com/api/v1/transactions?playerId=682950','2026-10-05T21:09:26.094Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('luis-izturis','https://statsapi.mlb.com/api/v1/people/682950/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:26.828Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-izturis','https://statsapi.mlb.com/api/v1/people/682950/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:27.616Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-izturis','https://statsapi.mlb.com/api/v1/people/682950/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:28.364Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-izturis','https://statsapi.mlb.com/api/v1/people/682950/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:29.138Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('miguel-droz','https://statsapi.mlb.com/api/v1/people/682940','2026-10-05T21:07:02.751Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('miguel-droz','https://statsapi.mlb.com/api/v1/transactions?playerId=682940','2026-10-05T21:09:29.895Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('miguel-droz','https://statsapi.mlb.com/api/v1/people/682940/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:30.648Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('miguel-droz','https://statsapi.mlb.com/api/v1/people/682940/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:31.437Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('miguel-droz','https://statsapi.mlb.com/api/v1/people/682940/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:32.157Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('miguel-droz','https://statsapi.mlb.com/api/v1/people/682940/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:32.932Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('rafael-tua','https://statsapi.mlb.com/api/v1/people/682948','2026-10-05T21:07:03.497Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('rafael-tua','https://statsapi.mlb.com/api/v1/transactions?playerId=682948','2026-10-05T21:09:33.697Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('rafael-tua','https://statsapi.mlb.com/api/v1/people/682948/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:34.430Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('rafael-tua','https://statsapi.mlb.com/api/v1/people/682948/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:35.228Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('rafael-tua','https://statsapi.mlb.com/api/v1/people/682948/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:35.959Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('rafael-tua','https://statsapi.mlb.com/api/v1/people/682948/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:36.791Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('lesther-medrano','https://statsapi.mlb.com/api/v1/people/692327','2026-10-05T21:07:05.002Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('lesther-medrano','https://statsapi.mlb.com/api/v1/transactions?playerId=692327','2026-10-05T21:09:37.479Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('lesther-medrano','https://statsapi.mlb.com/api/v1/people/692327/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:38.232Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('lesther-medrano','https://statsapi.mlb.com/api/v1/people/692327/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:39.017Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('lesther-medrano','https://statsapi.mlb.com/api/v1/people/692327/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:39.763Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('lesther-medrano','https://statsapi.mlb.com/api/v1/people/692327/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:40.582Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-rodriguez-2019','https://statsapi.mlb.com/api/v1/people/691177','2026-10-05T21:14:13.233Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('luis-rodriguez-2019','https://statsapi.mlb.com/api/v1/transactions?playerId=691177','2026-10-05T21:14:13.995Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('luis-rodriguez-2019','https://statsapi.mlb.com/api/v1/people/691177/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:14.739Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-rodriguez-2019','https://statsapi.mlb.com/api/v1/people/691177/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:15.604Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-rodriguez-2019','https://statsapi.mlb.com/api/v1/people/691177/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:16.244Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-rodriguez-2019','https://statsapi.mlb.com/api/v1/people/691177/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:17.030Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('roque-gutierrez','https://statsapi.mlb.com/api/v1/people/692262','2026-10-05T21:07:05.762Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('roque-gutierrez','https://statsapi.mlb.com/api/v1/transactions?playerId=692262','2026-10-05T21:09:41.295Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('roque-gutierrez','https://statsapi.mlb.com/api/v1/people/692262/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:42.060Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('roque-gutierrez','https://statsapi.mlb.com/api/v1/people/692262/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:42.843Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('roque-gutierrez','https://statsapi.mlb.com/api/v1/people/692262/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:43.583Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('roque-gutierrez','https://statsapi.mlb.com/api/v1/people/692262/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:44.459Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('yeiner-fernandez','https://statsapi.mlb.com/api/v1/people/691558','2026-10-05T21:07:06.497Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('yeiner-fernandez','https://statsapi.mlb.com/api/v1/transactions?playerId=691558','2026-10-05T21:09:45.114Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('yeiner-fernandez','https://statsapi.mlb.com/api/v1/people/691558/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:45.842Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('yeiner-fernandez','https://statsapi.mlb.com/api/v1/people/691558/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:46.720Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('yeiner-fernandez','https://statsapi.mlb.com/api/v1/people/691558/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:47.376Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('yeiner-fernandez','https://statsapi.mlb.com/api/v1/people/691558/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:48.204Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('brian-diaz','https://statsapi.mlb.com/api/v1/people/699070','2026-10-05T21:07:08.767Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('brian-diaz','https://statsapi.mlb.com/api/v1/transactions?playerId=699070','2026-10-05T21:09:48.910Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('brian-diaz','https://statsapi.mlb.com/api/v1/people/699070/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:49.670Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('brian-diaz','https://statsapi.mlb.com/api/v1/people/699070/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:50.470Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('brian-diaz','https://statsapi.mlb.com/api/v1/people/699070/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:51.171Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('brian-diaz','https://statsapi.mlb.com/api/v1/people/699070/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:51.992Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('carlos-avila','https://statsapi.mlb.com/api/v1/people/699066','2026-10-05T21:07:09.549Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('carlos-avila','https://statsapi.mlb.com/api/v1/transactions?playerId=699066','2026-10-05T21:09:52.694Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('carlos-avila','https://statsapi.mlb.com/api/v1/people/699066/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:53.458Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('carlos-avila','https://statsapi.mlb.com/api/v1/people/699066/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:54.292Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('carlos-avila','https://statsapi.mlb.com/api/v1/people/699066/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:54.966Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('carlos-avila','https://statsapi.mlb.com/api/v1/people/699066/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:55.739Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('christian-romero','https://statsapi.mlb.com/api/v1/people/699071','2026-10-05T21:07:10.288Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('christian-romero','https://statsapi.mlb.com/api/v1/transactions?playerId=699071','2026-10-05T21:09:56.502Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('christian-romero','https://statsapi.mlb.com/api/v1/people/699071/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:09:57.244Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('christian-romero','https://statsapi.mlb.com/api/v1/people/699071/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:09:58.019Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('christian-romero','https://statsapi.mlb.com/api/v1/people/699071/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:09:58.754Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('christian-romero','https://statsapi.mlb.com/api/v1/people/699071/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:09:59.619Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('dailoui-abad','https://statsapi.mlb.com/api/v1/people/699060','2026-10-05T21:07:11.035Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('dailoui-abad','https://statsapi.mlb.com/api/v1/transactions?playerId=699060','2026-10-05T21:10:00.281Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('dailoui-abad','https://statsapi.mlb.com/api/v1/people/699060/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:01.029Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('dailoui-abad','https://statsapi.mlb.com/api/v1/people/699060/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:01.782Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('dailoui-abad','https://statsapi.mlb.com/api/v1/people/699060/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:02.549Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('dailoui-abad','https://statsapi.mlb.com/api/v1/people/699060/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:03.391Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('elio-campos','https://statsapi.mlb.com/api/v1/people/699069','2026-10-05T21:07:11.814Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('elio-campos','https://statsapi.mlb.com/api/v1/transactions?playerId=699069','2026-10-05T21:10:04.055Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('elio-campos','https://statsapi.mlb.com/api/v1/people/699069/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:04.811Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('elio-campos','https://statsapi.mlb.com/api/v1/people/699069/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:05.658Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('elio-campos','https://statsapi.mlb.com/api/v1/people/699069/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:06.331Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('elio-campos','https://statsapi.mlb.com/api/v1/people/699069/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:07.107Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('isaac-barreto','https://statsapi.mlb.com/api/v1/people/699064','2026-10-05T21:07:12.574Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('isaac-barreto','https://statsapi.mlb.com/api/v1/transactions?playerId=699064','2026-10-05T21:10:07.932Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('isaac-barreto','https://statsapi.mlb.com/api/v1/people/699064/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:08.606Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('isaac-barreto','https://statsapi.mlb.com/api/v1/people/699064/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:09.375Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('isaac-barreto','https://statsapi.mlb.com/api/v1/people/699064/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:10.121Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('isaac-barreto','https://statsapi.mlb.com/api/v1/people/699064/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:10.892Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jesus-galiz','https://statsapi.mlb.com/api/v1/people/694188','2026-10-05T21:07:13.318Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jesus-galiz','https://statsapi.mlb.com/api/v1/transactions?playerId=694188','2026-10-05T21:10:11.639Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jesus-galiz','https://statsapi.mlb.com/api/v1/people/694188/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:12.374Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jesus-galiz','https://statsapi.mlb.com/api/v1/people/694188/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:13.201Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jesus-galiz','https://statsapi.mlb.com/api/v1/people/694188/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:13.877Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jesus-galiz','https://statsapi.mlb.com/api/v1/people/694188/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:14.672Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jhonny-jimenez','https://statsapi.mlb.com/api/v1/people/699075','2026-10-05T21:07:14.084Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jhonny-jimenez','https://statsapi.mlb.com/api/v1/transactions?playerId=699075','2026-10-05T21:10:15.428Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jhonny-jimenez','https://statsapi.mlb.com/api/v1/people/699075/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:16.192Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jhonny-jimenez','https://statsapi.mlb.com/api/v1/people/699075/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:16.950Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jhonny-jimenez','https://statsapi.mlb.com/api/v1/people/699075/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:17.705Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jhonny-jimenez','https://statsapi.mlb.com/api/v1/people/699075/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:18.545Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jorge-carpintero','https://statsapi.mlb.com/api/v1/people/699058','2026-10-05T21:07:14.870Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jorge-carpintero','https://statsapi.mlb.com/api/v1/transactions?playerId=699058','2026-10-05T21:10:19.230Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jorge-carpintero','https://statsapi.mlb.com/api/v1/people/699058/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:19.993Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jorge-carpintero','https://statsapi.mlb.com/api/v1/people/699058/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:20.745Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jorge-carpintero','https://statsapi.mlb.com/api/v1/people/699058/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:21.508Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jorge-carpintero','https://statsapi.mlb.com/api/v1/people/699058/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:22.272Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('juan-alonso','https://statsapi.mlb.com/api/v1/people/699076','2026-10-05T21:07:15.604Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('juan-alonso','https://statsapi.mlb.com/api/v1/transactions?playerId=699076','2026-10-05T21:10:23.038Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('juan-alonso','https://statsapi.mlb.com/api/v1/people/699076/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:23.784Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('juan-alonso','https://statsapi.mlb.com/api/v1/people/699076/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:24.617Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('juan-alonso','https://statsapi.mlb.com/api/v1/people/699076/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:25.303Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('juan-alonso','https://statsapi.mlb.com/api/v1/people/699076/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:26.084Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('kelvin-ramirez','https://statsapi.mlb.com/api/v1/people/699062','2026-10-05T21:07:16.371Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('kelvin-ramirez','https://statsapi.mlb.com/api/v1/transactions?playerId=699062','2026-10-05T21:10:26.816Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('kelvin-ramirez','https://statsapi.mlb.com/api/v1/people/699062/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:27.561Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('kelvin-ramirez','https://statsapi.mlb.com/api/v1/people/699062/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:28.338Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('kelvin-ramirez','https://statsapi.mlb.com/api/v1/people/699062/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:29.075Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('kelvin-ramirez','https://statsapi.mlb.com/api/v1/people/699062/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:29.894Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-guerra','https://statsapi.mlb.com/api/v1/people/699065','2026-10-05T21:07:17.120Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('luis-guerra','https://statsapi.mlb.com/api/v1/transactions?playerId=699065','2026-10-05T21:10:30.609Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('luis-guerra','https://statsapi.mlb.com/api/v1/people/699065/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:31.368Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-guerra','https://statsapi.mlb.com/api/v1/people/699065/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:32.184Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-guerra','https://statsapi.mlb.com/api/v1/people/699065/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:32.877Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-guerra','https://statsapi.mlb.com/api/v1/people/699065/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:33.655Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('maximo-martinez','https://statsapi.mlb.com/api/v1/people/699059','2026-10-05T21:07:17.885Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('maximo-martinez','https://statsapi.mlb.com/api/v1/transactions?playerId=699059','2026-10-05T21:10:34.401Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('maximo-martinez','https://statsapi.mlb.com/api/v1/people/699059/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:35.140Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('maximo-martinez','https://statsapi.mlb.com/api/v1/people/699059/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:35.935Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('maximo-martinez','https://statsapi.mlb.com/api/v1/people/699059/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:36.661Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('maximo-martinez','https://statsapi.mlb.com/api/v1/people/699059/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:37.496Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('michael-vilchez','https://statsapi.mlb.com/api/v1/people/699074','2026-10-05T21:07:18.640Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('michael-vilchez','https://statsapi.mlb.com/api/v1/transactions?playerId=699074','2026-10-05T21:10:38.210Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('michael-vilchez','https://statsapi.mlb.com/api/v1/people/699074/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:38.935Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('michael-vilchez','https://statsapi.mlb.com/api/v1/people/699074/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:39.692Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('michael-vilchez','https://statsapi.mlb.com/api/v1/people/699074/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:40.456Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('michael-vilchez','https://statsapi.mlb.com/api/v1/people/699074/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:41.276Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('miguel-bastardo','https://statsapi.mlb.com/api/v1/people/699072','2026-10-05T21:07:19.405Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('miguel-bastardo','https://statsapi.mlb.com/api/v1/transactions?playerId=699072','2026-10-05T21:10:41.990Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('miguel-bastardo','https://statsapi.mlb.com/api/v1/people/699072/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:42.745Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('miguel-bastardo','https://statsapi.mlb.com/api/v1/people/699072/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:43.526Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('miguel-bastardo','https://statsapi.mlb.com/api/v1/people/699072/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:44.273Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('miguel-bastardo','https://statsapi.mlb.com/api/v1/people/699072/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:45.072Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('missael-soto','https://statsapi.mlb.com/api/v1/people/699057','2026-10-05T21:07:20.164Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('missael-soto','https://statsapi.mlb.com/api/v1/transactions?playerId=699057','2026-10-05T21:10:45.772Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('missael-soto','https://statsapi.mlb.com/api/v1/people/699057/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:46.570Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('missael-soto','https://statsapi.mlb.com/api/v1/people/699057/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:47.304Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('missael-soto','https://statsapi.mlb.com/api/v1/people/699057/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:48.052Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('missael-soto','https://statsapi.mlb.com/api/v1/people/699057/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:48.844Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('pedro-santillan','https://statsapi.mlb.com/api/v1/people/699063','2026-10-05T21:07:20.918Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('pedro-santillan','https://statsapi.mlb.com/api/v1/transactions?playerId=699063','2026-10-05T21:10:49.587Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('pedro-santillan','https://statsapi.mlb.com/api/v1/people/699063/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:50.341Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('pedro-santillan','https://statsapi.mlb.com/api/v1/people/699063/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:51.108Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('pedro-santillan','https://statsapi.mlb.com/api/v1/people/699063/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:51.843Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('pedro-santillan','https://statsapi.mlb.com/api/v1/people/699063/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:52.648Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('rayne-doncon','https://statsapi.mlb.com/api/v1/people/699061','2026-10-05T21:07:21.672Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('rayne-doncon','https://statsapi.mlb.com/api/v1/transactions?playerId=699061','2026-10-05T21:10:53.377Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('rayne-doncon','https://statsapi.mlb.com/api/v1/people/699061/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:54.117Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('rayne-doncon','https://statsapi.mlb.com/api/v1/people/699061/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:54.998Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('rayne-doncon','https://statsapi.mlb.com/api/v1/people/699061/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:55.649Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('rayne-doncon','https://statsapi.mlb.com/api/v1/people/699061/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:10:56.452Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('roger-lasso','https://statsapi.mlb.com/api/v1/people/699068','2026-10-05T21:07:22.429Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('roger-lasso','https://statsapi.mlb.com/api/v1/transactions?playerId=699068','2026-10-05T21:10:57.173Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('roger-lasso','https://statsapi.mlb.com/api/v1/people/699068/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:10:57.925Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('roger-lasso','https://statsapi.mlb.com/api/v1/people/699068/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:10:58.775Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('roger-lasso','https://statsapi.mlb.com/api/v1/people/699068/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:10:59.428Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('roger-lasso','https://statsapi.mlb.com/api/v1/people/699068/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:11:00.238Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('sebastian-jimenez','https://statsapi.mlb.com/api/v1/people/699067','2026-10-05T21:07:23.160Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('sebastian-jimenez','https://statsapi.mlb.com/api/v1/transactions?playerId=699067','2026-10-05T21:11:00.939Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('sebastian-jimenez','https://statsapi.mlb.com/api/v1/people/699067/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:11:01.706Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('sebastian-jimenez','https://statsapi.mlb.com/api/v1/people/699067/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:11:02.516Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('sebastian-jimenez','https://statsapi.mlb.com/api/v1/people/699067/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:11:03.221Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('sebastian-jimenez','https://statsapi.mlb.com/api/v1/people/699067/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:11:03.993Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('thayron-liranzo','https://statsapi.mlb.com/api/v1/people/699073','2026-10-05T21:07:23.935Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('thayron-liranzo','https://statsapi.mlb.com/api/v1/transactions?playerId=699073','2026-10-05T21:11:04.743Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('thayron-liranzo','https://statsapi.mlb.com/api/v1/people/699073/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:11:05.486Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('thayron-liranzo','https://statsapi.mlb.com/api/v1/people/699073/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:11:06.364Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('thayron-liranzo','https://statsapi.mlb.com/api/v1/people/699073/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:11:07.091Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('thayron-liranzo','https://statsapi.mlb.com/api/v1/people/699073/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:11:07.828Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('wilman-diaz','https://statsapi.mlb.com/api/v1/people/694180','2026-10-05T21:07:24.687Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('wilman-diaz','https://statsapi.mlb.com/api/v1/transactions?playerId=694180','2026-10-05T21:11:08.578Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('wilman-diaz','https://statsapi.mlb.com/api/v1/people/694180/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:11:09.304Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('wilman-diaz','https://statsapi.mlb.com/api/v1/people/694180/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:11:10.195Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('wilman-diaz','https://statsapi.mlb.com/api/v1/people/694180/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:11:10.829Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('wilman-diaz','https://statsapi.mlb.com/api/v1/people/694180/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:11:11.626Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('abel-lorenzo','https://statsapi.mlb.com/api/v1/people/806867','2026-10-05T21:11:12.354Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('abel-lorenzo','https://statsapi.mlb.com/api/v1/transactions?playerId=806867','2026-10-05T21:11:13.114Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('abel-lorenzo','https://statsapi.mlb.com/api/v1/people/806867/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:11:13.875Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('abel-lorenzo','https://statsapi.mlb.com/api/v1/people/806867/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:11:14.682Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('abel-lorenzo','https://statsapi.mlb.com/api/v1/people/806867/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:11:15.401Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('abel-lorenzo','https://statsapi.mlb.com/api/v1/people/806867/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:11:16.174Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('accimias-morales','https://statsapi.mlb.com/api/v1/people/703193','2026-10-05T21:11:16.903Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('accimias-morales','https://statsapi.mlb.com/api/v1/transactions?playerId=703193','2026-10-05T21:11:17.674Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('accimias-morales','https://statsapi.mlb.com/api/v1/people/703193/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:11:18.409Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('accimias-morales','https://statsapi.mlb.com/api/v1/people/703193/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:11:19.195Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('accimias-morales','https://statsapi.mlb.com/api/v1/people/703193/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:11:19.935Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('accimias-morales','https://statsapi.mlb.com/api/v1/people/703193/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:11:20.762Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('agustin-acosta','https://statsapi.mlb.com/api/v1/people/802528','2026-10-05T21:11:21.470Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('agustin-acosta','https://statsapi.mlb.com/api/v1/transactions?playerId=802528','2026-10-05T21:11:22.236Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('agustin-acosta','https://statsapi.mlb.com/api/v1/people/802528/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:11:22.984Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('agustin-acosta','https://statsapi.mlb.com/api/v1/people/802528/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:11:23.804Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('agustin-acosta','https://statsapi.mlb.com/api/v1/people/802528/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:11:24.516Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('agustin-acosta','https://statsapi.mlb.com/api/v1/people/802528/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:11:25.286Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('aldrin-batista','https://statsapi.mlb.com/api/v1/people/702881','2026-10-05T21:11:26.035Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('aldrin-batista','https://statsapi.mlb.com/api/v1/transactions?playerId=702881','2026-10-05T21:11:26.809Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('aldrin-batista','https://statsapi.mlb.com/api/v1/people/702881/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:11:27.545Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('aldrin-batista','https://statsapi.mlb.com/api/v1/people/702881/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:11:28.301Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('aldrin-batista','https://statsapi.mlb.com/api/v1/people/702881/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:11:29.067Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('aldrin-batista','https://statsapi.mlb.com/api/v1/people/702881/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:11:29.885Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('alexander-albertus','https://statsapi.mlb.com/api/v1/people/800316','2026-10-05T21:11:30.560Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('alexander-albertus','https://statsapi.mlb.com/api/v1/transactions?playerId=800316','2026-10-05T21:11:31.314Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('alexander-albertus','https://statsapi.mlb.com/api/v1/people/800316/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:11:32.079Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('alexander-albertus','https://statsapi.mlb.com/api/v1/people/800316/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:11:32.899Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('alexander-albertus','https://statsapi.mlb.com/api/v1/people/800316/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:11:33.599Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('alexander-albertus','https://statsapi.mlb.com/api/v1/people/800316/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:11:34.376Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('anderson-estevez','https://statsapi.mlb.com/api/v1/people/802740','2026-10-05T21:11:35.099Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('anderson-estevez','https://statsapi.mlb.com/api/v1/transactions?playerId=802740','2026-10-05T21:11:35.884Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('anderson-estevez','https://statsapi.mlb.com/api/v1/people/802740/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:11:36.621Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('anderson-estevez','https://statsapi.mlb.com/api/v1/people/802740/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:11:37.447Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('anderson-estevez','https://statsapi.mlb.com/api/v1/people/802740/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:11:38.171Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('anderson-estevez','https://statsapi.mlb.com/api/v1/people/802740/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:11:38.949Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('angel-cruz','https://statsapi.mlb.com/api/v1/people/807654','2026-10-05T21:11:39.676Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('angel-cruz','https://statsapi.mlb.com/api/v1/transactions?playerId=807654','2026-10-05T21:11:40.445Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('angel-cruz','https://statsapi.mlb.com/api/v1/people/807654/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:11:41.191Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('angel-cruz','https://statsapi.mlb.com/api/v1/people/807654/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:11:41.967Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('angel-cruz','https://statsapi.mlb.com/api/v1/people/807654/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:11:42.689Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('angel-cruz','https://statsapi.mlb.com/api/v1/people/807654/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:11:43.501Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('arod-mckenzie','https://statsapi.mlb.com/api/v1/people/803242','2026-10-05T21:11:44.197Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('arod-mckenzie','https://statsapi.mlb.com/api/v1/transactions?playerId=803242','2026-10-05T21:11:45.001Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('arod-mckenzie','https://statsapi.mlb.com/api/v1/people/803242/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:11:45.720Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('arod-mckenzie','https://statsapi.mlb.com/api/v1/people/803242/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:11:46.505Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('arod-mckenzie','https://statsapi.mlb.com/api/v1/people/803242/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:11:47.256Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('arod-mckenzie','https://statsapi.mlb.com/api/v1/people/803242/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:11:48.047Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ben-serunkuma','https://statsapi.mlb.com/api/v1/people/805205','2026-10-05T21:11:48.795Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('ben-serunkuma','https://statsapi.mlb.com/api/v1/transactions?playerId=805205','2026-10-05T21:11:49.567Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('ben-serunkuma','https://statsapi.mlb.com/api/v1/people/805205/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:11:50.351Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ben-serunkuma','https://statsapi.mlb.com/api/v1/people/805205/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:11:51.069Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ben-serunkuma','https://statsapi.mlb.com/api/v1/people/805205/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:11:51.819Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ben-serunkuma','https://statsapi.mlb.com/api/v1/people/805205/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:11:52.647Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('callum-wallace','https://statsapi.mlb.com/api/v1/people/800527','2026-10-05T21:11:53.319Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('callum-wallace','https://statsapi.mlb.com/api/v1/transactions?playerId=800527','2026-10-05T21:11:54.117Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('callum-wallace','https://statsapi.mlb.com/api/v1/people/800527/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:11:54.858Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('callum-wallace','https://statsapi.mlb.com/api/v1/people/800527/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:11:55.631Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('callum-wallace','https://statsapi.mlb.com/api/v1/people/800527/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:11:56.356Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('callum-wallace','https://statsapi.mlb.com/api/v1/people/800527/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:11:57.141Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('daniel-arrias','https://statsapi.mlb.com/api/v1/people/800328','2026-10-05T21:11:57.861Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('daniel-arrias','https://statsapi.mlb.com/api/v1/transactions?playerId=800328','2026-10-05T21:11:58.632Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('daniel-arrias','https://statsapi.mlb.com/api/v1/people/800328/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:11:59.356Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('daniel-arrias','https://statsapi.mlb.com/api/v1/people/800328/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:12:00.195Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('daniel-arrias','https://statsapi.mlb.com/api/v1/people/800328/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:12:00.853Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('daniel-arrias','https://statsapi.mlb.com/api/v1/people/800328/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:12:01.666Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('domingo-geronimo','https://statsapi.mlb.com/api/v1/people/800383','2026-10-05T21:12:02.379Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('domingo-geronimo','https://statsapi.mlb.com/api/v1/transactions?playerId=800383','2026-10-05T21:12:03.119Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('domingo-geronimo','https://statsapi.mlb.com/api/v1/people/800383/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:12:03.898Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('domingo-geronimo','https://statsapi.mlb.com/api/v1/people/800383/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:12:04.663Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('domingo-geronimo','https://statsapi.mlb.com/api/v1/people/800383/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:12:05.408Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('domingo-geronimo','https://statsapi.mlb.com/api/v1/people/800383/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:12:06.223Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('edgar-aviles','https://statsapi.mlb.com/api/v1/people/800530','2026-10-05T21:12:06.911Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('edgar-aviles','https://statsapi.mlb.com/api/v1/transactions?playerId=800530','2026-10-05T21:12:07.655Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('edgar-aviles','https://statsapi.mlb.com/api/v1/people/800530/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:12:08.417Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('edgar-aviles','https://statsapi.mlb.com/api/v1/people/800530/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:12:09.199Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('edgar-aviles','https://statsapi.mlb.com/api/v1/people/800530/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:12:09.954Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('edgar-aviles','https://statsapi.mlb.com/api/v1/people/800530/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:12:10.735Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('edgar-gomez','https://statsapi.mlb.com/api/v1/people/807626','2026-10-05T21:12:11.471Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('edgar-gomez','https://statsapi.mlb.com/api/v1/transactions?playerId=807626','2026-10-05T21:12:12.303Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('edgar-gomez','https://statsapi.mlb.com/api/v1/people/807626/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:12:12.968Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('edgar-gomez','https://statsapi.mlb.com/api/v1/people/807626/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:12:13.762Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('edgar-gomez','https://statsapi.mlb.com/api/v1/people/807626/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:12:14.483Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('edgar-gomez','https://statsapi.mlb.com/api/v1/people/807626/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:12:15.271Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('edgar-leon','https://statsapi.mlb.com/api/v1/people/800453','2026-10-05T21:12:15.998Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('edgar-leon','https://statsapi.mlb.com/api/v1/transactions?playerId=800453','2026-10-05T21:12:16.777Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('edgar-leon','https://statsapi.mlb.com/api/v1/people/800453/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:12:17.496Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('edgar-leon','https://statsapi.mlb.com/api/v1/people/800453/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:12:18.283Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('edgar-leon','https://statsapi.mlb.com/api/v1/people/800453/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:12:19.003Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('edgar-leon','https://statsapi.mlb.com/api/v1/people/800453/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:12:19.868Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('eduardo-guerrero','https://statsapi.mlb.com/api/v1/people/800370','2026-10-05T21:12:20.539Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('eduardo-guerrero','https://statsapi.mlb.com/api/v1/transactions?playerId=800370','2026-10-05T21:12:21.314Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('eduardo-guerrero','https://statsapi.mlb.com/api/v1/people/800370/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:12:22.038Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('eduardo-guerrero','https://statsapi.mlb.com/api/v1/people/800370/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:12:22.918Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('eduardo-guerrero','https://statsapi.mlb.com/api/v1/people/800370/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:12:23.566Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('eduardo-guerrero','https://statsapi.mlb.com/api/v1/people/800370/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:12:24.352Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('enrike-sevilya','https://statsapi.mlb.com/api/v1/people/800288','2026-10-05T21:12:25.091Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('enrike-sevilya','https://statsapi.mlb.com/api/v1/transactions?playerId=800288','2026-10-05T21:12:25.849Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('enrike-sevilya','https://statsapi.mlb.com/api/v1/people/800288/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:12:26.610Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('enrike-sevilya','https://statsapi.mlb.com/api/v1/people/800288/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:12:27.435Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('enrike-sevilya','https://statsapi.mlb.com/api/v1/people/800288/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:12:28.112Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('enrike-sevilya','https://statsapi.mlb.com/api/v1/people/800288/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:12:28.923Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('erick-nava','https://statsapi.mlb.com/api/v1/people/812748','2026-10-05T21:12:29.660Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('erick-nava','https://statsapi.mlb.com/api/v1/transactions?playerId=812748','2026-10-05T21:12:30.414Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('erick-nava','https://statsapi.mlb.com/api/v1/people/812748/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:12:31.178Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('erick-nava','https://statsapi.mlb.com/api/v1/people/812748/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:12:31.968Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('erick-nava','https://statsapi.mlb.com/api/v1/people/812748/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:12:32.689Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('erick-nava','https://statsapi.mlb.com/api/v1/people/812748/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:12:33.502Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('franderly-morel','https://statsapi.mlb.com/api/v1/people/806918','2026-10-05T21:12:34.219Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('franderly-morel','https://statsapi.mlb.com/api/v1/transactions?playerId=806918','2026-10-05T21:12:34.961Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('franderly-morel','https://statsapi.mlb.com/api/v1/people/806918/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:12:35.731Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('franderly-morel','https://statsapi.mlb.com/api/v1/people/806918/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:12:36.501Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('franderly-morel','https://statsapi.mlb.com/api/v1/people/806918/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:12:37.252Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('franderly-morel','https://statsapi.mlb.com/api/v1/people/806918/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:12:38.066Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ilmerson-colon','https://statsapi.mlb.com/api/v1/people/805623','2026-10-05T21:12:38.761Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('ilmerson-colon','https://statsapi.mlb.com/api/v1/transactions?playerId=805623','2026-10-05T21:12:39.524Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('ilmerson-colon','https://statsapi.mlb.com/api/v1/people/805623/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:12:40.254Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ilmerson-colon','https://statsapi.mlb.com/api/v1/people/805623/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:12:41.050Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ilmerson-colon','https://statsapi.mlb.com/api/v1/people/805623/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:12:41.790Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ilmerson-colon','https://statsapi.mlb.com/api/v1/people/805623/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:12:42.608Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('javier-bartolozzi','https://statsapi.mlb.com/api/v1/people/812745','2026-10-05T21:12:43.300Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('javier-bartolozzi','https://statsapi.mlb.com/api/v1/transactions?playerId=812745','2026-10-05T21:12:44.078Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('javier-bartolozzi','https://statsapi.mlb.com/api/v1/people/812745/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:12:44.798Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('javier-bartolozzi','https://statsapi.mlb.com/api/v1/people/812745/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:12:45.600Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('javier-bartolozzi','https://statsapi.mlb.com/api/v1/people/812745/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:12:46.323Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('javier-bartolozzi','https://statsapi.mlb.com/api/v1/people/812745/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:12:47.152Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('javier-pena','https://statsapi.mlb.com/api/v1/people/800351','2026-10-05T21:12:47.905Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('javier-pena','https://statsapi.mlb.com/api/v1/transactions?playerId=800351','2026-10-05T21:12:48.650Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('javier-pena','https://statsapi.mlb.com/api/v1/people/800351/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:12:49.426Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('javier-pena','https://statsapi.mlb.com/api/v1/people/800351/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:12:50.194Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('javier-pena','https://statsapi.mlb.com/api/v1/people/800351/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:12:50.928Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('javier-pena','https://statsapi.mlb.com/api/v1/people/800351/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:12:51.708Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jecsua-liborius','https://statsapi.mlb.com/api/v1/people/807403','2026-10-05T21:12:52.452Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jecsua-liborius','https://statsapi.mlb.com/api/v1/transactions?playerId=807403','2026-10-05T21:12:53.210Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jecsua-liborius','https://statsapi.mlb.com/api/v1/people/807403/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:12:53.937Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jecsua-liborius','https://statsapi.mlb.com/api/v1/people/807403/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:12:54.737Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jecsua-liborius','https://statsapi.mlb.com/api/v1/people/807403/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:12:55.467Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jecsua-liborius','https://statsapi.mlb.com/api/v1/people/807403/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:12:56.300Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jeral-perez','https://statsapi.mlb.com/api/v1/people/800419','2026-10-05T21:12:57.001Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jeral-perez','https://statsapi.mlb.com/api/v1/transactions?playerId=800419','2026-10-05T21:12:57.763Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jeral-perez','https://statsapi.mlb.com/api/v1/people/800419/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:12:58.506Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jeral-perez','https://statsapi.mlb.com/api/v1/people/800419/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:12:59.344Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jeral-perez','https://statsapi.mlb.com/api/v1/people/800419/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:12:59.999Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jeral-perez','https://statsapi.mlb.com/api/v1/people/800419/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:00.781Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jeremy-castro','https://statsapi.mlb.com/api/v1/people/812746','2026-10-05T21:13:01.525Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jeremy-castro','https://statsapi.mlb.com/api/v1/transactions?playerId=812746','2026-10-05T21:13:02.337Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jeremy-castro','https://statsapi.mlb.com/api/v1/people/812746/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:03.198Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jeremy-castro','https://statsapi.mlb.com/api/v1/people/812746/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:03.958Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jeremy-castro','https://statsapi.mlb.com/api/v1/people/812746/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:04.713Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jeremy-castro','https://statsapi.mlb.com/api/v1/people/812746/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:05.512Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jholbran-herder','https://statsapi.mlb.com/api/v1/people/800408','2026-10-05T21:13:06.230Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jholbran-herder','https://statsapi.mlb.com/api/v1/transactions?playerId=800408','2026-10-05T21:13:06.986Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jholbran-herder','https://statsapi.mlb.com/api/v1/people/800408/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:07.704Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jholbran-herder','https://statsapi.mlb.com/api/v1/people/800408/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:08.515Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jholbran-herder','https://statsapi.mlb.com/api/v1/people/800408/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:09.248Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jholbran-herder','https://statsapi.mlb.com/api/v1/people/800408/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:10.086Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jose-gonzalez','https://statsapi.mlb.com/api/v1/people/806919','2026-10-05T21:13:10.776Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jose-gonzalez','https://statsapi.mlb.com/api/v1/transactions?playerId=806919','2026-10-05T21:13:11.540Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jose-gonzalez','https://statsapi.mlb.com/api/v1/people/806919/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:12.283Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jose-gonzalez','https://statsapi.mlb.com/api/v1/people/806919/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:13.110Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jose-gonzalez','https://statsapi.mlb.com/api/v1/people/806919/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:13.811Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jose-gonzalez','https://statsapi.mlb.com/api/v1/people/806919/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:14.622Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jose-torrez','https://statsapi.mlb.com/api/v1/people/807404','2026-10-05T21:13:15.353Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jose-torrez','https://statsapi.mlb.com/api/v1/transactions?playerId=807404','2026-10-05T21:13:16.116Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jose-torrez','https://statsapi.mlb.com/api/v1/people/807404/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:16.848Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jose-torrez','https://statsapi.mlb.com/api/v1/people/807404/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:17.664Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jose-torrez','https://statsapi.mlb.com/api/v1/people/807404/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:18.391Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jose-torrez','https://statsapi.mlb.com/api/v1/people/807404/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:19.143Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('joseilyn-gonzalez','https://statsapi.mlb.com/api/v1/people/805120','2026-10-05T21:13:19.880Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('joseilyn-gonzalez','https://statsapi.mlb.com/api/v1/transactions?playerId=805120','2026-10-05T21:13:20.654Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('joseilyn-gonzalez','https://statsapi.mlb.com/api/v1/people/805120/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:21.428Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('joseilyn-gonzalez','https://statsapi.mlb.com/api/v1/people/805120/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:22.217Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('joseilyn-gonzalez','https://statsapi.mlb.com/api/v1/people/805120/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:22.931Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('joseilyn-gonzalez','https://statsapi.mlb.com/api/v1/people/805120/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:23.751Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('juan-hernandez','https://statsapi.mlb.com/api/v1/people/806638','2026-10-05T21:13:24.436Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('juan-hernandez','https://statsapi.mlb.com/api/v1/transactions?playerId=806638','2026-10-05T21:13:25.206Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('juan-hernandez','https://statsapi.mlb.com/api/v1/people/806638/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:25.949Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('juan-hernandez','https://statsapi.mlb.com/api/v1/people/806638/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:26.725Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('juan-hernandez','https://statsapi.mlb.com/api/v1/people/806638/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:27.477Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('juan-hernandez','https://statsapi.mlb.com/api/v1/people/806638/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:28.269Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('kosuke-matsuda','https://statsapi.mlb.com/api/v1/people/800494','2026-10-05T21:13:28.999Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('kosuke-matsuda','https://statsapi.mlb.com/api/v1/transactions?playerId=800494','2026-10-05T21:13:29.758Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('kosuke-matsuda','https://statsapi.mlb.com/api/v1/people/800494/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:30.507Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('kosuke-matsuda','https://statsapi.mlb.com/api/v1/people/800494/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:31.273Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('kosuke-matsuda','https://statsapi.mlb.com/api/v1/people/800494/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:32.026Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('kosuke-matsuda','https://statsapi.mlb.com/api/v1/people/800494/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:32.774Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luciano-romero','https://statsapi.mlb.com/api/v1/people/800355','2026-10-05T21:13:33.546Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('luciano-romero','https://statsapi.mlb.com/api/v1/transactions?playerId=800355','2026-10-05T21:13:34.287Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('luciano-romero','https://statsapi.mlb.com/api/v1/people/800355/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:35.041Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luciano-romero','https://statsapi.mlb.com/api/v1/people/800355/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:35.812Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luciano-romero','https://statsapi.mlb.com/api/v1/people/800355/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:36.559Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luciano-romero','https://statsapi.mlb.com/api/v1/people/800355/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:37.361Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('mairoshendrick-martinus','https://statsapi.mlb.com/api/v1/people/800302','2026-10-05T21:13:38.091Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('mairoshendrick-martinus','https://statsapi.mlb.com/api/v1/transactions?playerId=800302','2026-10-05T21:13:38.852Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('mairoshendrick-martinus','https://statsapi.mlb.com/api/v1/people/800302/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:39.597Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('mairoshendrick-martinus','https://statsapi.mlb.com/api/v1/people/800302/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:40.434Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('mairoshendrick-martinus','https://statsapi.mlb.com/api/v1/people/800302/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:41.103Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('mairoshendrick-martinus','https://statsapi.mlb.com/api/v1/people/800302/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:41.900Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('marco-corcho','https://statsapi.mlb.com/api/v1/people/806866','2026-10-05T21:13:42.646Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('marco-corcho','https://statsapi.mlb.com/api/v1/transactions?playerId=806866','2026-10-05T21:13:43.417Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('marco-corcho','https://statsapi.mlb.com/api/v1/people/806866/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:44.161Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('marco-corcho','https://statsapi.mlb.com/api/v1/people/806866/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:44.934Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('marco-corcho','https://statsapi.mlb.com/api/v1/people/806866/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:45.663Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('marco-corcho','https://statsapi.mlb.com/api/v1/people/806866/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:46.504Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('miguel-dominguez','https://statsapi.mlb.com/api/v1/people/800399','2026-10-05T21:13:47.191Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('miguel-dominguez','https://statsapi.mlb.com/api/v1/transactions?playerId=800399','2026-10-05T21:13:47.955Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('miguel-dominguez','https://statsapi.mlb.com/api/v1/people/800399/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:48.700Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('miguel-dominguez','https://statsapi.mlb.com/api/v1/people/800399/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:49.501Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('miguel-dominguez','https://statsapi.mlb.com/api/v1/people/800399/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:50.231Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('miguel-dominguez','https://statsapi.mlb.com/api/v1/people/800399/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:51.000Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('natanael-castillo','https://statsapi.mlb.com/api/v1/people/800390','2026-10-05T21:13:51.738Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('natanael-castillo','https://statsapi.mlb.com/api/v1/transactions?playerId=800390','2026-10-05T21:13:52.537Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('natanael-castillo','https://statsapi.mlb.com/api/v1/people/800390/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:53.268Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('natanael-castillo','https://statsapi.mlb.com/api/v1/people/800390/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:54.045Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('natanael-castillo','https://statsapi.mlb.com/api/v1/people/800390/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:54.773Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('natanael-castillo','https://statsapi.mlb.com/api/v1/people/800390/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:13:55.573Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('nicolas-cruz','https://statsapi.mlb.com/api/v1/people/800395','2026-10-05T21:13:56.303Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('nicolas-cruz','https://statsapi.mlb.com/api/v1/transactions?playerId=800395','2026-10-05T21:13:57.076Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('nicolas-cruz','https://statsapi.mlb.com/api/v1/people/800395/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:13:57.803Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('nicolas-cruz','https://statsapi.mlb.com/api/v1/people/800395/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:13:58.594Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('nicolas-cruz','https://statsapi.mlb.com/api/v1/people/800395/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:13:59.319Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('nicolas-cruz','https://statsapi.mlb.com/api/v1/people/800395/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:00.149Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('oswaldo-osorio','https://statsapi.mlb.com/api/v1/people/800424','2026-10-05T21:14:00.849Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('oswaldo-osorio','https://statsapi.mlb.com/api/v1/transactions?playerId=800424','2026-10-05T21:14:01.597Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('oswaldo-osorio','https://statsapi.mlb.com/api/v1/people/800424/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:02.352Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('oswaldo-osorio','https://statsapi.mlb.com/api/v1/people/800424/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:03.181Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('oswaldo-osorio','https://statsapi.mlb.com/api/v1/people/800424/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:03.853Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('oswaldo-osorio','https://statsapi.mlb.com/api/v1/people/800424/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:04.640Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('paris-johnson','https://statsapi.mlb.com/api/v1/people/807379','2026-10-05T21:14:05.387Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('paris-johnson','https://statsapi.mlb.com/api/v1/transactions?playerId=807379','2026-10-05T21:14:06.138Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('paris-johnson','https://statsapi.mlb.com/api/v1/people/807379/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:06.874Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('paris-johnson','https://statsapi.mlb.com/api/v1/people/807379/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:07.683Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('paris-johnson','https://statsapi.mlb.com/api/v1/people/807379/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:08.392Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('paris-johnson','https://statsapi.mlb.com/api/v1/people/807379/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:09.141Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('peter-bonilla','https://statsapi.mlb.com/api/v1/people/800361','2026-10-05T21:14:09.900Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('peter-bonilla','https://statsapi.mlb.com/api/v1/transactions?playerId=800361','2026-10-05T21:14:10.657Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('peter-bonilla','https://statsapi.mlb.com/api/v1/people/800361/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:11.428Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('peter-bonilla','https://statsapi.mlb.com/api/v1/people/800361/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:12.346Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('peter-bonilla','https://statsapi.mlb.com/api/v1/people/800361/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:12.955Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('peter-bonilla','https://statsapi.mlb.com/api/v1/people/800361/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:13.751Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('railin-familia','https://statsapi.mlb.com/api/v1/people/812747','2026-10-05T21:14:14.460Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('railin-familia','https://statsapi.mlb.com/api/v1/transactions?playerId=812747','2026-10-05T21:14:15.233Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('railin-familia','https://statsapi.mlb.com/api/v1/people/812747/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:15.982Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('railin-familia','https://statsapi.mlb.com/api/v1/people/812747/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:16.796Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('railin-familia','https://statsapi.mlb.com/api/v1/people/812747/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:17.517Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('railin-familia','https://statsapi.mlb.com/api/v1/people/812747/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:18.300Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('raynerd-ortega','https://statsapi.mlb.com/api/v1/people/800380','2026-10-05T21:14:19.043Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('raynerd-ortega','https://statsapi.mlb.com/api/v1/transactions?playerId=800380','2026-10-05T21:14:19.806Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('raynerd-ortega','https://statsapi.mlb.com/api/v1/people/800380/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:20.556Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('raynerd-ortega','https://statsapi.mlb.com/api/v1/people/800380/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:21.378Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('raynerd-ortega','https://statsapi.mlb.com/api/v1/people/800380/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:22.086Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('raynerd-ortega','https://statsapi.mlb.com/api/v1/people/800380/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:22.845Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ricardo-montero','https://statsapi.mlb.com/api/v1/people/805110','2026-10-05T21:14:23.607Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('ricardo-montero','https://statsapi.mlb.com/api/v1/transactions?playerId=805110','2026-10-05T21:14:24.379Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('ricardo-montero','https://statsapi.mlb.com/api/v1/people/805110/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:25.124Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ricardo-montero','https://statsapi.mlb.com/api/v1/people/805110/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:25.911Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ricardo-montero','https://statsapi.mlb.com/api/v1/people/805110/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:26.640Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ricardo-montero','https://statsapi.mlb.com/api/v1/people/805110/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:27.476Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('rodmar-angela','https://statsapi.mlb.com/api/v1/people/806791','2026-10-05T21:14:28.139Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('rodmar-angela','https://statsapi.mlb.com/api/v1/transactions?playerId=806791','2026-10-05T21:14:28.901Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('rodmar-angela','https://statsapi.mlb.com/api/v1/people/806791/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:29.664Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('rodmar-angela','https://statsapi.mlb.com/api/v1/people/806791/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:30.458Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('rodmar-angela','https://statsapi.mlb.com/api/v1/people/806791/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:31.183Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('rodmar-angela','https://statsapi.mlb.com/api/v1/people/806791/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:31.938Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('roiger-mujica','https://statsapi.mlb.com/api/v1/people/800487','2026-10-05T21:14:32.701Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('roiger-mujica','https://statsapi.mlb.com/api/v1/transactions?playerId=800487','2026-10-05T21:14:33.468Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('roiger-mujica','https://statsapi.mlb.com/api/v1/people/800487/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:34.197Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('roiger-mujica','https://statsapi.mlb.com/api/v1/people/800487/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:34.998Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('roiger-mujica','https://statsapi.mlb.com/api/v1/people/800487/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:35.685Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('roiger-mujica','https://statsapi.mlb.com/api/v1/people/800487/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:36.513Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('samuel-munoz','https://statsapi.mlb.com/api/v1/people/703153','2026-10-05T21:14:37.222Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('samuel-munoz','https://statsapi.mlb.com/api/v1/transactions?playerId=703153','2026-10-05T21:14:38.011Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('samuel-munoz','https://statsapi.mlb.com/api/v1/people/703153/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:38.757Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('samuel-munoz','https://statsapi.mlb.com/api/v1/people/703153/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:39.580Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('samuel-munoz','https://statsapi.mlb.com/api/v1/people/703153/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:40.279Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('samuel-munoz','https://statsapi.mlb.com/api/v1/people/703153/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:41.044Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('sean-linan','https://statsapi.mlb.com/api/v1/people/800344','2026-10-05T21:14:41.789Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('sean-linan','https://statsapi.mlb.com/api/v1/transactions?playerId=800344','2026-10-05T21:14:42.557Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('sean-linan','https://statsapi.mlb.com/api/v1/people/800344/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:43.307Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('sean-linan','https://statsapi.mlb.com/api/v1/people/800344/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:44.074Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('sean-linan','https://statsapi.mlb.com/api/v1/people/800344/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:44.810Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('sean-linan','https://statsapi.mlb.com/api/v1/people/800344/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:45.674Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('steven-castillo','https://statsapi.mlb.com/api/v1/people/800481','2026-10-05T21:14:46.327Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('steven-castillo','https://statsapi.mlb.com/api/v1/transactions?playerId=800481','2026-10-05T21:14:47.087Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('steven-castillo','https://statsapi.mlb.com/api/v1/people/800481/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:47.916Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('steven-castillo','https://statsapi.mlb.com/api/v1/people/800481/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:48.657Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('steven-castillo','https://statsapi.mlb.com/api/v1/people/800481/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:49.356Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('steven-castillo','https://statsapi.mlb.com/api/v1/people/800481/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:50.162Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('tim-fischer','https://statsapi.mlb.com/api/v1/people/808444','2026-10-05T21:14:50.916Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('tim-fischer','https://statsapi.mlb.com/api/v1/transactions?playerId=808444','2026-10-05T21:14:51.638Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('tim-fischer','https://statsapi.mlb.com/api/v1/people/808444/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:52.403Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('tim-fischer','https://statsapi.mlb.com/api/v1/people/808444/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:53.161Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('tim-fischer','https://statsapi.mlb.com/api/v1/people/808444/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:53.916Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('tim-fischer','https://statsapi.mlb.com/api/v1/people/808444/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:54.723Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('umar-male','https://statsapi.mlb.com/api/v1/people/805773','2026-10-05T21:14:55.427Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('umar-male','https://statsapi.mlb.com/api/v1/transactions?playerId=805773','2026-10-05T21:14:56.192Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('umar-male','https://statsapi.mlb.com/api/v1/people/805773/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:14:56.949Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('umar-male','https://statsapi.mlb.com/api/v1/people/805773/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:14:57.738Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('umar-male','https://statsapi.mlb.com/api/v1/people/805773/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:14:58.474Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('umar-male','https://statsapi.mlb.com/api/v1/people/805773/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:14:59.228Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('victor-rodrigues','https://statsapi.mlb.com/api/v1/people/800332','2026-10-05T21:14:59.998Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('victor-rodrigues','https://statsapi.mlb.com/api/v1/transactions?playerId=800332','2026-10-05T21:15:00.738Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('victor-rodrigues','https://statsapi.mlb.com/api/v1/people/800332/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:01.463Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('victor-rodrigues','https://statsapi.mlb.com/api/v1/people/800332/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:02.378Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('victor-rodrigues','https://statsapi.mlb.com/api/v1/people/800332/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:02.990Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('victor-rodrigues','https://statsapi.mlb.com/api/v1/people/800332/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:03.790Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('yhonaider-gudino','https://statsapi.mlb.com/api/v1/people/800521','2026-10-05T21:15:04.508Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('yhonaider-gudino','https://statsapi.mlb.com/api/v1/transactions?playerId=800521','2026-10-05T21:15:05.297Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('yhonaider-gudino','https://statsapi.mlb.com/api/v1/people/800521/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:06.029Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('yhonaider-gudino','https://statsapi.mlb.com/api/v1/people/800521/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:06.813Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('yhonaider-gudino','https://statsapi.mlb.com/api/v1/people/800521/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:07.580Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('yhonaider-gudino','https://statsapi.mlb.com/api/v1/people/800521/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:08.363Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('yorfran-medina','https://statsapi.mlb.com/api/v1/people/800337','2026-10-05T21:15:09.068Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('yorfran-medina','https://statsapi.mlb.com/api/v1/transactions?playerId=800337','2026-10-05T21:15:09.835Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('yorfran-medina','https://statsapi.mlb.com/api/v1/people/800337/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:10.711Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('yorfran-medina','https://statsapi.mlb.com/api/v1/people/800337/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:11.386Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('yorfran-medina','https://statsapi.mlb.com/api/v1/people/800337/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:12.107Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('yorfran-medina','https://statsapi.mlb.com/api/v1/people/800337/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:12.871Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('yoryi-simarra','https://statsapi.mlb.com/api/v1/people/800366','2026-10-05T21:15:13.620Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('yoryi-simarra','https://statsapi.mlb.com/api/v1/transactions?playerId=800366','2026-10-05T21:15:14.403Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('yoryi-simarra','https://statsapi.mlb.com/api/v1/people/800366/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:15.128Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('yoryi-simarra','https://statsapi.mlb.com/api/v1/people/800366/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:15.907Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('yoryi-simarra','https://statsapi.mlb.com/api/v1/people/800366/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:16.657Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('yoryi-simarra','https://statsapi.mlb.com/api/v1/people/800366/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:17.454Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('yuliangel-de-la-cruz','https://statsapi.mlb.com/api/v1/people/800447','2026-10-05T21:15:18.166Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('yuliangel-de-la-cruz','https://statsapi.mlb.com/api/v1/transactions?playerId=800447','2026-10-05T21:15:18.922Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('yuliangel-de-la-cruz','https://statsapi.mlb.com/api/v1/people/800447/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:19.652Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('yuliangel-de-la-cruz','https://statsapi.mlb.com/api/v1/people/800447/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:20.450Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('yuliangel-de-la-cruz','https://statsapi.mlb.com/api/v1/people/800447/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:21.180Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('yuliangel-de-la-cruz','https://statsapi.mlb.com/api/v1/people/800447/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:21.998Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('anderson-jerez','https://statsapi.mlb.com/api/v1/people/808214','2026-10-05T21:07:26.962Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('anderson-jerez','https://statsapi.mlb.com/api/v1/transactions?playerId=808214','2026-10-05T21:15:22.685Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('anderson-jerez','https://statsapi.mlb.com/api/v1/people/808214/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:23.420Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('anderson-jerez','https://statsapi.mlb.com/api/v1/people/808214/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:24.202Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('anderson-jerez','https://statsapi.mlb.com/api/v1/people/808214/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:24.944Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('anderson-jerez','https://statsapi.mlb.com/api/v1/people/808214/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:25.742Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('arnaldo-lantigua','https://statsapi.mlb.com/api/v1/people/806984','2026-10-05T21:07:27.724Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('arnaldo-lantigua','https://statsapi.mlb.com/api/v1/transactions?playerId=806984','2026-10-05T21:15:26.487Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('arnaldo-lantigua','https://statsapi.mlb.com/api/v1/people/806984/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:27.227Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('arnaldo-lantigua','https://statsapi.mlb.com/api/v1/people/806984/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:28.049Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('arnaldo-lantigua','https://statsapi.mlb.com/api/v1/people/806984/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:28.736Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('arnaldo-lantigua','https://statsapi.mlb.com/api/v1/people/806984/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:29.522Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('daniel-mielcarek','https://statsapi.mlb.com/api/v1/people/808028','2026-10-05T21:07:28.494Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('daniel-mielcarek','https://statsapi.mlb.com/api/v1/transactions?playerId=808028','2026-10-05T21:15:30.257Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('daniel-mielcarek','https://statsapi.mlb.com/api/v1/people/808028/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:31.023Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('daniel-mielcarek','https://statsapi.mlb.com/api/v1/people/808028/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:31.821Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('daniel-mielcarek','https://statsapi.mlb.com/api/v1/people/808028/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:32.523Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('daniel-mielcarek','https://statsapi.mlb.com/api/v1/people/808028/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:33.281Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('eduardo-quintero','https://statsapi.mlb.com/api/v1/people/808234','2026-10-05T21:07:29.213Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('eduardo-quintero','https://statsapi.mlb.com/api/v1/transactions?playerId=808234','2026-10-05T21:15:34.059Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('eduardo-quintero','https://statsapi.mlb.com/api/v1/people/808234/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:34.794Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('eduardo-quintero','https://statsapi.mlb.com/api/v1/people/808234/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:35.660Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('eduardo-quintero','https://statsapi.mlb.com/api/v1/people/808234/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:36.313Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('eduardo-quintero','https://statsapi.mlb.com/api/v1/people/808234/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:37.112Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('elias-medina','https://statsapi.mlb.com/api/v1/people/808257','2026-10-05T21:07:29.977Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('elias-medina','https://statsapi.mlb.com/api/v1/transactions?playerId=808257','2026-10-05T21:15:37.860Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('elias-medina','https://statsapi.mlb.com/api/v1/people/808257/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:38.604Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('elias-medina','https://statsapi.mlb.com/api/v1/people/808257/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:39.443Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('elias-medina','https://statsapi.mlb.com/api/v1/people/808257/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:40.137Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('elias-medina','https://statsapi.mlb.com/api/v1/people/808257/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:40.913Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('erick-batista','https://statsapi.mlb.com/api/v1/people/808209','2026-10-05T21:07:30.726Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('erick-batista','https://statsapi.mlb.com/api/v1/transactions?playerId=808209','2026-10-05T21:15:41.659Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('erick-batista','https://statsapi.mlb.com/api/v1/people/808209/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:42.411Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('erick-batista','https://statsapi.mlb.com/api/v1/people/808209/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:43.192Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('erick-batista','https://statsapi.mlb.com/api/v1/people/808209/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:44.004Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('erick-batista','https://statsapi.mlb.com/api/v1/people/808209/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:44.832Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('harold-gonzalez','https://statsapi.mlb.com/api/v1/people/808339','2026-10-05T21:07:31.496Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('harold-gonzalez','https://statsapi.mlb.com/api/v1/transactions?playerId=808339','2026-10-05T21:15:45.432Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('harold-gonzalez','https://statsapi.mlb.com/api/v1/people/808339/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:46.175Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('harold-gonzalez','https://statsapi.mlb.com/api/v1/people/808339/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:46.987Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('harold-gonzalez','https://statsapi.mlb.com/api/v1/people/808339/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:47.697Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('harold-gonzalez','https://statsapi.mlb.com/api/v1/people/808339/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:48.468Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('javier-herrera','https://statsapi.mlb.com/api/v1/people/808223','2026-10-05T21:07:32.247Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('javier-herrera','https://statsapi.mlb.com/api/v1/transactions?playerId=808223','2026-10-05T21:15:49.217Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('javier-herrera','https://statsapi.mlb.com/api/v1/people/808223/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:49.960Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('javier-herrera','https://statsapi.mlb.com/api/v1/people/808223/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:50.815Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('javier-herrera','https://statsapi.mlb.com/api/v1/people/808223/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:51.483Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('javier-herrera','https://statsapi.mlb.com/api/v1/people/808223/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:52.283Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jesus-tillero','https://statsapi.mlb.com/api/v1/people/808313','2026-10-05T21:07:33.024Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jesus-tillero','https://statsapi.mlb.com/api/v1/transactions?playerId=808313','2026-10-05T21:15:53.028Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jesus-tillero','https://statsapi.mlb.com/api/v1/people/808313/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:53.747Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jesus-tillero','https://statsapi.mlb.com/api/v1/people/808313/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:54.546Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jesus-tillero','https://statsapi.mlb.com/api/v1/people/808313/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:55.287Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jesus-tillero','https://statsapi.mlb.com/api/v1/people/808313/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:56.103Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('joendry-vargas','https://statsapi.mlb.com/api/v1/people/806959','2026-10-05T21:07:33.762Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('joendry-vargas','https://statsapi.mlb.com/api/v1/transactions?playerId=806959','2026-10-05T21:15:56.796Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('joendry-vargas','https://statsapi.mlb.com/api/v1/people/806959/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:15:57.543Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('joendry-vargas','https://statsapi.mlb.com/api/v1/people/806959/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:15:58.350Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('joendry-vargas','https://statsapi.mlb.com/api/v1/people/806959/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:15:59.049Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('joendry-vargas','https://statsapi.mlb.com/api/v1/people/806959/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:15:59.849Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-carias','https://statsapi.mlb.com/api/v1/people/808218','2026-10-05T21:07:34.532Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('luis-carias','https://statsapi.mlb.com/api/v1/transactions?playerId=808218','2026-10-05T21:16:00.590Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('luis-carias','https://statsapi.mlb.com/api/v1/people/808218/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:16:01.342Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-carias','https://statsapi.mlb.com/api/v1/people/808218/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:16:02.104Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-carias','https://statsapi.mlb.com/api/v1/people/808218/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:16:02.857Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-carias','https://statsapi.mlb.com/api/v1/people/808218/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:16:03.685Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('robinson-ventura','https://statsapi.mlb.com/api/v1/people/808332','2026-10-05T21:07:35.266Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('robinson-ventura','https://statsapi.mlb.com/api/v1/transactions?playerId=808332','2026-10-05T21:16:04.378Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('robinson-ventura','https://statsapi.mlb.com/api/v1/people/808332/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:16:05.128Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('robinson-ventura','https://statsapi.mlb.com/api/v1/people/808332/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:16:05.901Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('robinson-ventura','https://statsapi.mlb.com/api/v1/people/808332/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:16:06.627Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('robinson-ventura','https://statsapi.mlb.com/api/v1/people/808332/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:16:07.421Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('samuel-sanchez','https://statsapi.mlb.com/api/v1/people/808247','2026-10-05T21:07:36.040Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('samuel-sanchez','https://statsapi.mlb.com/api/v1/transactions?playerId=808247','2026-10-05T21:16:08.155Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('samuel-sanchez','https://statsapi.mlb.com/api/v1/people/808247/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:16:08.906Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('samuel-sanchez','https://statsapi.mlb.com/api/v1/people/808247/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:16:09.692Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('samuel-sanchez','https://statsapi.mlb.com/api/v1/people/808247/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:16:10.425Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('samuel-sanchez','https://statsapi.mlb.com/api/v1/people/808247/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:16:11.245Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('alexis-dominguez','https://statsapi.mlb.com/api/v1/people/821826','2026-10-05T21:16:11.935Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('alexis-dominguez','https://statsapi.mlb.com/api/v1/transactions?playerId=821826','2026-10-05T21:16:12.700Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('alexis-dominguez','https://statsapi.mlb.com/api/v1/people/821826/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:16:13.478Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('alexis-dominguez','https://statsapi.mlb.com/api/v1/people/821826/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:16:14.248Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('alexis-dominguez','https://statsapi.mlb.com/api/v1/people/821826/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:16:14.992Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('alexis-dominguez','https://statsapi.mlb.com/api/v1/people/821826/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:16:15.787Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('allen-ajoti','https://statsapi.mlb.com/api/v1/people/821808','2026-10-05T21:16:16.515Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('allen-ajoti','https://statsapi.mlb.com/api/v1/transactions?playerId=821808','2026-10-05T21:16:17.269Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('allen-ajoti','https://statsapi.mlb.com/api/v1/people/821808/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:16:18.018Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('allen-ajoti','https://statsapi.mlb.com/api/v1/people/821808/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:16:18.814Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('allen-ajoti','https://statsapi.mlb.com/api/v1/people/821808/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:16:19.552Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('allen-ajoti','https://statsapi.mlb.com/api/v1/people/821808/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:16:20.353Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('angel-ramirez','https://statsapi.mlb.com/api/v1/people/821633','2026-10-05T21:16:21.074Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('angel-ramirez','https://statsapi.mlb.com/api/v1/transactions?playerId=821633','2026-10-05T21:16:21.843Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('angel-ramirez','https://statsapi.mlb.com/api/v1/people/821633/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:16:22.585Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('angel-ramirez','https://statsapi.mlb.com/api/v1/people/821633/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:16:23.355Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('angel-ramirez','https://statsapi.mlb.com/api/v1/people/821633/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:16:24.100Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('angel-ramirez','https://statsapi.mlb.com/api/v1/people/821633/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:16:24.903Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('axel-perez','https://statsapi.mlb.com/api/v1/people/821612','2026-10-05T21:16:25.628Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('axel-perez','https://statsapi.mlb.com/api/v1/transactions?playerId=821612','2026-10-05T21:16:26.399Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('axel-perez','https://statsapi.mlb.com/api/v1/people/821612/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:16:27.149Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('axel-perez','https://statsapi.mlb.com/api/v1/people/821612/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:16:27.923Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('axel-perez','https://statsapi.mlb.com/api/v1/people/821612/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:16:28.686Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('axel-perez','https://statsapi.mlb.com/api/v1/people/821612/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:16:29.495Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('carlos-sardina','https://statsapi.mlb.com/api/v1/people/821658','2026-10-05T21:16:30.188Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('carlos-sardina','https://statsapi.mlb.com/api/v1/transactions?playerId=821658','2026-10-05T21:16:30.959Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('carlos-sardina','https://statsapi.mlb.com/api/v1/people/821658/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:16:31.712Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('carlos-sardina','https://statsapi.mlb.com/api/v1/people/821658/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:16:32.518Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('carlos-sardina','https://statsapi.mlb.com/api/v1/people/821658/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:16:33.208Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('carlos-sardina','https://statsapi.mlb.com/api/v1/people/821658/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:16:34.040Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('christian-muniz','https://statsapi.mlb.com/api/v1/people/821650','2026-10-05T21:16:34.745Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('christian-muniz','https://statsapi.mlb.com/api/v1/transactions?playerId=821650','2026-10-05T21:16:35.516Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('christian-muniz','https://statsapi.mlb.com/api/v1/people/821650/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:16:36.267Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('christian-muniz','https://statsapi.mlb.com/api/v1/people/821650/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:16:37.034Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('christian-muniz','https://statsapi.mlb.com/api/v1/people/821650/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:16:37.760Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('christian-muniz','https://statsapi.mlb.com/api/v1/people/821650/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:16:38.568Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('david-romero','https://statsapi.mlb.com/api/v1/people/821661','2026-10-05T21:16:39.291Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('david-romero','https://statsapi.mlb.com/api/v1/transactions?playerId=821661','2026-10-05T21:16:40.047Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('david-romero','https://statsapi.mlb.com/api/v1/people/821661/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:16:40.806Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('david-romero','https://statsapi.mlb.com/api/v1/people/821661/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:16:41.591Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('david-romero','https://statsapi.mlb.com/api/v1/people/821661/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:16:42.315Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('david-romero','https://statsapi.mlb.com/api/v1/people/821661/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:16:43.096Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('eduardo-rojas','https://statsapi.mlb.com/api/v1/people/821672','2026-10-05T21:16:43.834Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('eduardo-rojas','https://statsapi.mlb.com/api/v1/transactions?playerId=821672','2026-10-05T21:16:44.611Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('eduardo-rojas','https://statsapi.mlb.com/api/v1/people/821672/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:16:45.358Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('eduardo-rojas','https://statsapi.mlb.com/api/v1/people/821672/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:16:46.158Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('eduardo-rojas','https://statsapi.mlb.com/api/v1/people/821672/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:16:46.865Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('eduardo-rojas','https://statsapi.mlb.com/api/v1/people/821672/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:16:47.628Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('emil-morales','https://statsapi.mlb.com/api/v1/people/815896','2026-10-05T21:16:48.371Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('emil-morales','https://statsapi.mlb.com/api/v1/transactions?playerId=815896','2026-10-05T21:16:49.136Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('emil-morales','https://statsapi.mlb.com/api/v1/people/815896/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:16:49.884Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('emil-morales','https://statsapi.mlb.com/api/v1/people/815896/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:16:50.723Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('emil-morales','https://statsapi.mlb.com/api/v1/people/815896/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:16:51.385Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('emil-morales','https://statsapi.mlb.com/api/v1/people/815896/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:16:52.155Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('erny-orellana','https://statsapi.mlb.com/api/v1/people/821786','2026-10-05T21:16:52.907Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('erny-orellana','https://statsapi.mlb.com/api/v1/transactions?playerId=821786','2026-10-05T21:16:53.673Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('erny-orellana','https://statsapi.mlb.com/api/v1/people/821786/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:16:54.427Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('erny-orellana','https://statsapi.mlb.com/api/v1/people/821786/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:16:55.225Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('erny-orellana','https://statsapi.mlb.com/api/v1/people/821786/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:16:55.936Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('erny-orellana','https://statsapi.mlb.com/api/v1/people/821786/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:16:56.703Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('euri-rosa','https://statsapi.mlb.com/api/v1/people/821817','2026-10-05T21:16:57.449Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('euri-rosa','https://statsapi.mlb.com/api/v1/transactions?playerId=821817','2026-10-05T21:16:58.215Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('euri-rosa','https://statsapi.mlb.com/api/v1/people/821817/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:16:58.945Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('euri-rosa','https://statsapi.mlb.com/api/v1/people/821817/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:16:59.753Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('euri-rosa','https://statsapi.mlb.com/api/v1/people/821817/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:17:00.530Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('euri-rosa','https://statsapi.mlb.com/api/v1/people/821817/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:17:01.262Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('francisco-espinoza','https://statsapi.mlb.com/api/v1/people/821689','2026-10-05T21:17:02.007Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('francisco-espinoza','https://statsapi.mlb.com/api/v1/transactions?playerId=821689','2026-10-05T21:17:02.766Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('francisco-espinoza','https://statsapi.mlb.com/api/v1/people/821689/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:17:03.540Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('francisco-espinoza','https://statsapi.mlb.com/api/v1/people/821689/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:17:04.335Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('francisco-espinoza','https://statsapi.mlb.com/api/v1/people/821689/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:17:05.057Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('francisco-espinoza','https://statsapi.mlb.com/api/v1/people/821689/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:17:05.831Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('heudy-pena','https://statsapi.mlb.com/api/v1/people/821263','2026-10-05T21:17:06.578Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('heudy-pena','https://statsapi.mlb.com/api/v1/transactions?playerId=821263','2026-10-05T21:17:07.346Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('heudy-pena','https://statsapi.mlb.com/api/v1/people/821263/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:17:08.087Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('heudy-pena','https://statsapi.mlb.com/api/v1/people/821263/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:17:08.885Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('heudy-pena','https://statsapi.mlb.com/api/v1/people/821263/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:17:09.614Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('heudy-pena','https://statsapi.mlb.com/api/v1/people/821263/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:17:10.392Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jose-lopez','https://statsapi.mlb.com/api/v1/people/821653','2026-10-05T21:17:11.129Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jose-lopez','https://statsapi.mlb.com/api/v1/transactions?playerId=821653','2026-10-05T21:17:11.895Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jose-lopez','https://statsapi.mlb.com/api/v1/people/821653/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:17:12.633Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jose-lopez','https://statsapi.mlb.com/api/v1/people/821653/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:17:13.416Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jose-lopez','https://statsapi.mlb.com/api/v1/people/821653/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:17:14.181Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jose-lopez','https://statsapi.mlb.com/api/v1/people/821653/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:17:14.933Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('leider-padilla','https://statsapi.mlb.com/api/v1/people/821636','2026-10-05T21:17:15.687Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('leider-padilla','https://statsapi.mlb.com/api/v1/transactions?playerId=821636','2026-10-05T21:17:16.441Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('leider-padilla','https://statsapi.mlb.com/api/v1/people/821636/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:17:17.197Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('leider-padilla','https://statsapi.mlb.com/api/v1/people/821636/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:17:17.999Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('leider-padilla','https://statsapi.mlb.com/api/v1/people/821636/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:17:18.731Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('leider-padilla','https://statsapi.mlb.com/api/v1/people/821636/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:17:19.542Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('michael-ramirez','https://statsapi.mlb.com/api/v1/people/821679','2026-10-05T21:17:20.276Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('michael-ramirez','https://statsapi.mlb.com/api/v1/transactions?playerId=821679','2026-10-05T21:17:21.018Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('michael-ramirez','https://statsapi.mlb.com/api/v1/people/821679/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:17:21.757Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('michael-ramirez','https://statsapi.mlb.com/api/v1/people/821679/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:17:22.533Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('michael-ramirez','https://statsapi.mlb.com/api/v1/people/821679/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:17:23.292Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('michael-ramirez','https://statsapi.mlb.com/api/v1/people/821679/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:17:24.082Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('rafy-peguero','https://statsapi.mlb.com/api/v1/people/821801','2026-10-05T21:17:24.810Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('rafy-peguero','https://statsapi.mlb.com/api/v1/transactions?playerId=821801','2026-10-05T21:17:25.566Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('rafy-peguero','https://statsapi.mlb.com/api/v1/people/821801/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:17:26.314Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('rafy-peguero','https://statsapi.mlb.com/api/v1/people/821801/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:17:27.110Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('rafy-peguero','https://statsapi.mlb.com/api/v1/people/821801/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:17:27.843Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('rafy-peguero','https://statsapi.mlb.com/api/v1/people/821801/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:17:28.614Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('reyli-mariano','https://statsapi.mlb.com/api/v1/people/821697','2026-10-05T21:17:29.357Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('reyli-mariano','https://statsapi.mlb.com/api/v1/transactions?playerId=821697','2026-10-05T21:17:30.113Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('reyli-mariano','https://statsapi.mlb.com/api/v1/people/821697/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:17:30.862Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('reyli-mariano','https://statsapi.mlb.com/api/v1/people/821697/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:17:31.679Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('reyli-mariano','https://statsapi.mlb.com/api/v1/people/821697/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:17:32.385Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('reyli-mariano','https://statsapi.mlb.com/api/v1/people/821697/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:17:33.165Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('yojackson-laya','https://statsapi.mlb.com/api/v1/people/821684','2026-10-05T21:17:33.900Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('yojackson-laya','https://statsapi.mlb.com/api/v1/transactions?playerId=821684','2026-10-05T21:17:34.661Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('yojackson-laya','https://statsapi.mlb.com/api/v1/people/821684/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:17:35.412Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('yojackson-laya','https://statsapi.mlb.com/api/v1/people/821684/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:17:36.198Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('yojackson-laya','https://statsapi.mlb.com/api/v1/people/821684/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:17:36.916Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('yojackson-laya','https://statsapi.mlb.com/api/v1/people/821684/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:17:37.673Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('adrian-torres','https://statsapi.mlb.com/api/v1/people/830397','2026-10-05T21:17:38.419Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('adrian-torres','https://statsapi.mlb.com/api/v1/transactions?playerId=830397','2026-10-05T21:17:39.203Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('adrian-torres','https://statsapi.mlb.com/api/v1/people/830397/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:17:39.929Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('adrian-torres','https://statsapi.mlb.com/api/v1/people/830397/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:17:40.712Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('adrian-torres','https://statsapi.mlb.com/api/v1/people/830397/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:17:41.467Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('adrian-torres','https://statsapi.mlb.com/api/v1/people/830397/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:17:42.264Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('alexis-reyes','https://statsapi.mlb.com/api/v1/people/829490','2026-10-05T21:17:42.974Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('alexis-reyes','https://statsapi.mlb.com/api/v1/transactions?playerId=829490','2026-10-05T21:17:43.760Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('alexis-reyes','https://statsapi.mlb.com/api/v1/people/829490/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:17:44.495Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('alexis-reyes','https://statsapi.mlb.com/api/v1/people/829490/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:17:45.289Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('alexis-reyes','https://statsapi.mlb.com/api/v1/people/829490/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:17:46.012Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('alexis-reyes','https://statsapi.mlb.com/api/v1/people/829490/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:17:46.799Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('andres-luna','https://statsapi.mlb.com/api/v1/people/831322','2026-10-05T21:17:47.534Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('andres-luna','https://statsapi.mlb.com/api/v1/transactions?playerId=831322','2026-10-05T21:17:48.301Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('andres-luna','https://statsapi.mlb.com/api/v1/people/831322/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:17:49.051Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('andres-luna','https://statsapi.mlb.com/api/v1/people/831322/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:17:49.797Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('andres-luna','https://statsapi.mlb.com/api/v1/people/831322/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:17:50.551Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('andres-luna','https://statsapi.mlb.com/api/v1/people/831322/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:17:51.348Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('aneudy-almonte','https://statsapi.mlb.com/api/v1/people/825160','2026-10-05T21:17:52.073Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('aneudy-almonte','https://statsapi.mlb.com/api/v1/transactions?playerId=825160','2026-10-05T21:17:52.846Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('aneudy-almonte','https://statsapi.mlb.com/api/v1/people/825160/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:17:53.599Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('aneudy-almonte','https://statsapi.mlb.com/api/v1/people/825160/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:17:54.367Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('aneudy-almonte','https://statsapi.mlb.com/api/v1/people/825160/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:17:55.132Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('aneudy-almonte','https://statsapi.mlb.com/api/v1/people/825160/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:17:55.912Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('antoni-urena','https://statsapi.mlb.com/api/v1/people/829482','2026-10-05T21:17:56.635Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('antoni-urena','https://statsapi.mlb.com/api/v1/transactions?playerId=829482','2026-10-05T21:17:57.396Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('antoni-urena','https://statsapi.mlb.com/api/v1/people/829482/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:17:58.154Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('antoni-urena','https://statsapi.mlb.com/api/v1/people/829482/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:17:58.976Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('antoni-urena','https://statsapi.mlb.com/api/v1/people/829482/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:17:59.669Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('antoni-urena','https://statsapi.mlb.com/api/v1/people/829482/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:18:00.445Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('bryan-lara','https://statsapi.mlb.com/api/v1/people/832440','2026-10-05T21:18:01.190Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('bryan-lara','https://statsapi.mlb.com/api/v1/transactions?playerId=832440','2026-10-05T21:18:01.956Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('bryan-lara','https://statsapi.mlb.com/api/v1/people/832440/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:18:02.726Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('bryan-lara','https://statsapi.mlb.com/api/v1/people/832440/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:18:03.486Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('bryan-lara','https://statsapi.mlb.com/api/v1/people/832440/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:18:04.244Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('bryan-lara','https://statsapi.mlb.com/api/v1/people/832440/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:18:05.011Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('carlos-ramirez','https://statsapi.mlb.com/api/v1/people/830439','2026-10-05T21:18:05.720Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('carlos-ramirez','https://statsapi.mlb.com/api/v1/transactions?playerId=830439','2026-10-05T21:18:06.497Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('carlos-ramirez','https://statsapi.mlb.com/api/v1/people/830439/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:18:07.257Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('carlos-ramirez','https://statsapi.mlb.com/api/v1/people/830439/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:18:08.043Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('carlos-ramirez','https://statsapi.mlb.com/api/v1/people/830439/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:18:08.792Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('carlos-ramirez','https://statsapi.mlb.com/api/v1/people/830439/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:18:09.570Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('cesar-sanchez','https://statsapi.mlb.com/api/v1/people/829479','2026-10-05T21:18:10.302Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('cesar-sanchez','https://statsapi.mlb.com/api/v1/transactions?playerId=829479','2026-10-05T21:18:11.077Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('cesar-sanchez','https://statsapi.mlb.com/api/v1/people/829479/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:18:11.831Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('cesar-sanchez','https://statsapi.mlb.com/api/v1/people/829479/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:18:12.596Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('cesar-sanchez','https://statsapi.mlb.com/api/v1/people/829479/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:18:13.329Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('cesar-sanchez','https://statsapi.mlb.com/api/v1/people/829479/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:18:14.130Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('degerson-diaz','https://statsapi.mlb.com/api/v1/people/830481','2026-10-05T21:18:14.875Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('degerson-diaz','https://statsapi.mlb.com/api/v1/transactions?playerId=830481','2026-10-05T21:18:15.610Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('degerson-diaz','https://statsapi.mlb.com/api/v1/people/830481/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:18:16.375Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('degerson-diaz','https://statsapi.mlb.com/api/v1/people/830481/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:18:17.167Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('degerson-diaz','https://statsapi.mlb.com/api/v1/people/830481/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:18:17.884Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('degerson-diaz','https://statsapi.mlb.com/api/v1/people/830481/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:18:18.649Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('derik-aquino','https://statsapi.mlb.com/api/v1/people/830468','2026-10-05T21:18:19.396Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('derik-aquino','https://statsapi.mlb.com/api/v1/transactions?playerId=830468','2026-10-05T21:18:20.174Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('derik-aquino','https://statsapi.mlb.com/api/v1/people/830468/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:18:20.918Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('derik-aquino','https://statsapi.mlb.com/api/v1/people/830468/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:18:21.675Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('derik-aquino','https://statsapi.mlb.com/api/v1/people/830468/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:18:22.444Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('derik-aquino','https://statsapi.mlb.com/api/v1/people/830468/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:18:23.219Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('devlyn-bautista','https://statsapi.mlb.com/api/v1/people/830426','2026-10-05T21:18:23.948Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('devlyn-bautista','https://statsapi.mlb.com/api/v1/transactions?playerId=830426','2026-10-05T21:18:24.704Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('devlyn-bautista','https://statsapi.mlb.com/api/v1/people/830426/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:18:25.479Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('devlyn-bautista','https://statsapi.mlb.com/api/v1/people/830426/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:18:26.265Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('devlyn-bautista','https://statsapi.mlb.com/api/v1/people/830426/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:18:27.001Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('devlyn-bautista','https://statsapi.mlb.com/api/v1/people/830426/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:18:27.752Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ezequiel-aparicio','https://statsapi.mlb.com/api/v1/people/830452','2026-10-05T21:18:28.514Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('ezequiel-aparicio','https://statsapi.mlb.com/api/v1/transactions?playerId=830452','2026-10-05T21:18:29.269Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('ezequiel-aparicio','https://statsapi.mlb.com/api/v1/people/830452/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:18:30.043Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ezequiel-aparicio','https://statsapi.mlb.com/api/v1/people/830452/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:18:30.813Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ezequiel-aparicio','https://statsapi.mlb.com/api/v1/people/830452/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:18:31.540Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ezequiel-aparicio','https://statsapi.mlb.com/api/v1/people/830452/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:18:32.325Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('hendry-arvelo','https://statsapi.mlb.com/api/v1/people/829498','2026-10-05T21:18:33.040Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('hendry-arvelo','https://statsapi.mlb.com/api/v1/transactions?playerId=829498','2026-10-05T21:18:33.802Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('hendry-arvelo','https://statsapi.mlb.com/api/v1/people/829498/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:18:34.559Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('hendry-arvelo','https://statsapi.mlb.com/api/v1/people/829498/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:18:35.358Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('hendry-arvelo','https://statsapi.mlb.com/api/v1/people/829498/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:18:36.045Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('hendry-arvelo','https://statsapi.mlb.com/api/v1/people/829498/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:18:36.834Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ivan-pacheco','https://statsapi.mlb.com/api/v1/people/830612','2026-10-05T21:18:37.574Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('ivan-pacheco','https://statsapi.mlb.com/api/v1/transactions?playerId=830612','2026-10-05T21:18:38.345Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('ivan-pacheco','https://statsapi.mlb.com/api/v1/people/830612/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:18:39.089Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ivan-pacheco','https://statsapi.mlb.com/api/v1/people/830612/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:18:39.866Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ivan-pacheco','https://statsapi.mlb.com/api/v1/people/830612/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:18:40.614Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ivan-pacheco','https://statsapi.mlb.com/api/v1/people/830612/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:18:41.399Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jhon-gil','https://statsapi.mlb.com/api/v1/people/830459','2026-10-05T21:18:42.117Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jhon-gil','https://statsapi.mlb.com/api/v1/transactions?playerId=830459','2026-10-05T21:18:42.881Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jhon-gil','https://statsapi.mlb.com/api/v1/people/830459/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:18:43.630Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jhon-gil','https://statsapi.mlb.com/api/v1/people/830459/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:18:44.436Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jhon-gil','https://statsapi.mlb.com/api/v1/people/830459/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:18:45.152Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jhon-gil','https://statsapi.mlb.com/api/v1/people/830459/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:18:45.924Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jhosman-theran','https://statsapi.mlb.com/api/v1/people/830420','2026-10-05T21:18:46.669Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jhosman-theran','https://statsapi.mlb.com/api/v1/transactions?playerId=830420','2026-10-05T21:18:47.444Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jhosman-theran','https://statsapi.mlb.com/api/v1/people/830420/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:18:48.196Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jhosman-theran','https://statsapi.mlb.com/api/v1/people/830420/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:18:48.978Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jhosman-theran','https://statsapi.mlb.com/api/v1/people/830420/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:18:49.715Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jhosman-theran','https://statsapi.mlb.com/api/v1/people/830420/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:18:50.473Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jose-rivas','https://statsapi.mlb.com/api/v1/people/830449','2026-10-05T21:18:51.243Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jose-rivas','https://statsapi.mlb.com/api/v1/transactions?playerId=830449','2026-10-05T21:18:52.006Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jose-rivas','https://statsapi.mlb.com/api/v1/people/830449/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:18:52.755Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jose-rivas','https://statsapi.mlb.com/api/v1/people/830449/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:18:53.549Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jose-rivas','https://statsapi.mlb.com/api/v1/people/830449/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:18:54.271Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jose-rivas','https://statsapi.mlb.com/api/v1/people/830449/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:18:55.042Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jose-villegas','https://statsapi.mlb.com/api/v1/people/830413','2026-10-05T21:18:55.772Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jose-villegas','https://statsapi.mlb.com/api/v1/transactions?playerId=830413','2026-10-05T21:18:56.561Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jose-villegas','https://statsapi.mlb.com/api/v1/people/830413/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:18:57.282Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jose-villegas','https://statsapi.mlb.com/api/v1/people/830413/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:18:58.065Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jose-villegas','https://statsapi.mlb.com/api/v1/people/830413/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:18:58.809Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jose-villegas','https://statsapi.mlb.com/api/v1/people/830413/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:18:59.600Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('joseph-deng-thon','https://statsapi.mlb.com/api/v1/people/830188','2026-10-05T21:19:00.327Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('joseph-deng-thon','https://statsapi.mlb.com/api/v1/transactions?playerId=830188','2026-10-05T21:19:01.092Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('joseph-deng-thon','https://statsapi.mlb.com/api/v1/people/830188/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:19:01.839Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('joseph-deng-thon','https://statsapi.mlb.com/api/v1/people/830188/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:19:02.610Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('joseph-deng-thon','https://statsapi.mlb.com/api/v1/people/830188/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:19:03.348Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('joseph-deng-thon','https://statsapi.mlb.com/api/v1/people/830188/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:19:04.153Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('juan-macero','https://statsapi.mlb.com/api/v1/people/830471','2026-10-05T21:19:04.878Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('juan-macero','https://statsapi.mlb.com/api/v1/transactions?playerId=830471','2026-10-05T21:19:05.648Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('juan-macero','https://statsapi.mlb.com/api/v1/people/830471/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:19:06.394Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('juan-macero','https://statsapi.mlb.com/api/v1/people/830471/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:19:07.184Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('juan-macero','https://statsapi.mlb.com/api/v1/people/830471/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:19:07.918Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('juan-macero','https://statsapi.mlb.com/api/v1/people/830471/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:19:08.673Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-gamez','https://statsapi.mlb.com/api/v1/people/830800','2026-10-05T21:19:09.417Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('luis-gamez','https://statsapi.mlb.com/api/v1/transactions?playerId=830800','2026-10-05T21:19:10.209Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('luis-gamez','https://statsapi.mlb.com/api/v1/people/830800/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:19:10.941Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-gamez','https://statsapi.mlb.com/api/v1/people/830800/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:19:11.699Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-gamez','https://statsapi.mlb.com/api/v1/people/830800/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:19:12.453Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-gamez','https://statsapi.mlb.com/api/v1/people/830800/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:19:13.255Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-luna','https://statsapi.mlb.com/api/v1/people/830463','2026-10-05T21:19:13.978Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('luis-luna','https://statsapi.mlb.com/api/v1/transactions?playerId=830463','2026-10-05T21:19:14.744Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('luis-luna','https://statsapi.mlb.com/api/v1/people/830463/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:19:15.491Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-luna','https://statsapi.mlb.com/api/v1/people/830463/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:19:16.293Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-luna','https://statsapi.mlb.com/api/v1/people/830463/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:19:16.984Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-luna','https://statsapi.mlb.com/api/v1/people/830463/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:19:17.773Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-tovar','https://statsapi.mlb.com/api/v1/people/830434','2026-10-05T21:19:18.515Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('luis-tovar','https://statsapi.mlb.com/api/v1/transactions?playerId=830434','2026-10-05T21:19:19.261Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('luis-tovar','https://statsapi.mlb.com/api/v1/people/830434/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:19:20.006Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-tovar','https://statsapi.mlb.com/api/v1/people/830434/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:19:20.798Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('luis-tovar','https://statsapi.mlb.com/api/v1/people/830434/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:19:21.538Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('luis-tovar','https://statsapi.mlb.com/api/v1/people/830434/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:19:22.299Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('moises-acacio','https://statsapi.mlb.com/api/v1/people/830432','2026-10-05T21:19:23.056Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('moises-acacio','https://statsapi.mlb.com/api/v1/transactions?playerId=830432','2026-10-05T21:19:23.836Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('moises-acacio','https://statsapi.mlb.com/api/v1/people/830432/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:19:24.592Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('moises-acacio','https://statsapi.mlb.com/api/v1/people/830432/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:19:25.419Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('moises-acacio','https://statsapi.mlb.com/api/v1/people/830432/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:19:26.119Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('moises-acacio','https://statsapi.mlb.com/api/v1/people/830432/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:19:26.905Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('moises-rangel','https://statsapi.mlb.com/api/v1/people/830404','2026-10-05T21:19:27.629Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('moises-rangel','https://statsapi.mlb.com/api/v1/transactions?playerId=830404','2026-10-05T21:19:28.398Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('moises-rangel','https://statsapi.mlb.com/api/v1/people/830404/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:19:29.140Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('moises-rangel','https://statsapi.mlb.com/api/v1/people/830404/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:19:29.945Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('moises-rangel','https://statsapi.mlb.com/api/v1/people/830404/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:19:30.656Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('moises-rangel','https://statsapi.mlb.com/api/v1/people/830404/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:19:31.440Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ricardo-roman','https://statsapi.mlb.com/api/v1/people/830429','2026-10-05T21:19:32.183Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('ricardo-roman','https://statsapi.mlb.com/api/v1/transactions?playerId=830429','2026-10-05T21:19:32.946Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('ricardo-roman','https://statsapi.mlb.com/api/v1/people/830429/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:19:33.699Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ricardo-roman','https://statsapi.mlb.com/api/v1/people/830429/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:19:34.461Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ricardo-roman','https://statsapi.mlb.com/api/v1/people/830429/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:19:35.222Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ricardo-roman','https://statsapi.mlb.com/api/v1/people/830429/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:19:36.027Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('samuel-savinon','https://statsapi.mlb.com/api/v1/people/829493','2026-10-05T21:19:36.729Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('samuel-savinon','https://statsapi.mlb.com/api/v1/transactions?playerId=829493','2026-10-05T21:19:37.498Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('samuel-savinon','https://statsapi.mlb.com/api/v1/people/829493/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:19:38.253Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('samuel-savinon','https://statsapi.mlb.com/api/v1/people/829493/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:19:39.028Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('samuel-savinon','https://statsapi.mlb.com/api/v1/people/829493/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:19:39.765Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('samuel-savinon','https://statsapi.mlb.com/api/v1/people/829493/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:19:40.580Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('shai-romero','https://statsapi.mlb.com/api/v1/people/829476','2026-10-05T21:19:41.278Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('shai-romero','https://statsapi.mlb.com/api/v1/transactions?playerId=829476','2026-10-05T21:19:42.053Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('shai-romero','https://statsapi.mlb.com/api/v1/people/829476/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:19:42.805Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('shai-romero','https://statsapi.mlb.com/api/v1/people/829476/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:19:43.589Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('shai-romero','https://statsapi.mlb.com/api/v1/people/829476/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:19:44.326Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('shai-romero','https://statsapi.mlb.com/api/v1/people/829476/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:19:45.111Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ariel-reynoso','https://statsapi.mlb.com/api/v1/people/837605','2026-10-05T21:07:39.100Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('ariel-reynoso','https://statsapi.mlb.com/api/v1/transactions?playerId=837605','2026-10-05T21:19:45.846Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('ariel-reynoso','https://statsapi.mlb.com/api/v1/people/837605/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:19:46.592Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ariel-reynoso','https://statsapi.mlb.com/api/v1/people/837605/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:19:47.364Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ariel-reynoso','https://statsapi.mlb.com/api/v1/people/837605/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:19:48.106Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ariel-reynoso','https://statsapi.mlb.com/api/v1/people/837605/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:19:48.864Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ezequiel-melburne','https://statsapi.mlb.com/api/v1/people/836606','2026-10-05T21:07:39.846Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('ezequiel-melburne','https://statsapi.mlb.com/api/v1/transactions?playerId=836606','2026-10-05T21:19:49.625Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('ezequiel-melburne','https://statsapi.mlb.com/api/v1/people/836606/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:19:50.387Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ezequiel-melburne','https://statsapi.mlb.com/api/v1/people/836606/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:19:51.165Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('ezequiel-melburne','https://statsapi.mlb.com/api/v1/people/836606/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:19:51.906Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('ezequiel-melburne','https://statsapi.mlb.com/api/v1/people/836606/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:19:52.673Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jose-requena','https://statsapi.mlb.com/api/v1/people/837769','2026-10-05T21:07:40.620Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jose-requena','https://statsapi.mlb.com/api/v1/transactions?playerId=837769','2026-10-05T21:19:53.439Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jose-requena','https://statsapi.mlb.com/api/v1/people/837769/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:19:54.188Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jose-requena','https://statsapi.mlb.com/api/v1/people/837769/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:19:54.968Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jose-requena','https://statsapi.mlb.com/api/v1/people/837769/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:19:55.689Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jose-requena','https://statsapi.mlb.com/api/v1/people/837769/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:19:56.464Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jose-victorino','https://statsapi.mlb.com/api/v1/people/837652','2026-10-05T21:07:41.365Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('jose-victorino','https://statsapi.mlb.com/api/v1/transactions?playerId=837652','2026-10-05T21:19:57.223Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('jose-victorino','https://statsapi.mlb.com/api/v1/people/837652/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:19:57.971Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jose-victorino','https://statsapi.mlb.com/api/v1/people/837652/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:19:58.739Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('jose-victorino','https://statsapi.mlb.com/api/v1/people/837652/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:19:59.487Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('jose-victorino','https://statsapi.mlb.com/api/v1/people/837652/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:20:00.257Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('rubel-arias','https://statsapi.mlb.com/api/v1/people/837601','2026-10-05T21:07:42.124Z',array['MLB_REACH','MLB_DEBUT_DATE']::text[]),
('rubel-arias','https://statsapi.mlb.com/api/v1/transactions?playerId=837601','2026-10-05T21:20:01.002Z',array['FINAL_TRANSACTION','DISPOSITION']::text[]),
('rubel-arias','https://statsapi.mlb.com/api/v1/people/837601/stats?stats=yearByYear&group=hitting&sportId=1','2026-10-05T21:20:01.730Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('rubel-arias','https://statsapi.mlb.com/api/v1/people/837601/stats?stats=yearByYear&group=hitting&leagueListId=milb_all','2026-10-05T21:20:02.519Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]),
('rubel-arias','https://statsapi.mlb.com/api/v1/people/837601/stats?stats=yearByYear&group=pitching&sportId=1','2026-10-05T21:20:03.259Z',array['MLB_DEBUT_ORGANIZATION','HIGHEST_LEVEL']::text[]),
('rubel-arias','https://statsapi.mlb.com/api/v1/people/837601/stats?stats=yearByYear&group=pitching&leagueListId=milb_all','2026-10-05T21:20:04.035Z',array['HIGHEST_LEVEL','LAST_AFFILIATED_SEASON','ACTIVE_STATUS']::text[]);

create temporary table _m019_bwar (slug text, mlb_id bigint, bref_id text, career_bwar numeric, observed_through_season int, bat_url text, pitch_url text, retrieved_at timestamptz) on commit drop;
insert into _m019_bwar values
('roger-cedeno',112155,'cedenro01',1.7,2005,'https://www.baseball-reference.com/data/war_daily_bat.txt','https://www.baseball-reference.com/data/war_daily_pitch.txt','2026-10-05T21:22:01.003Z'),
('carlos-frias',516910,'friasca01',-0.3,2016,'https://www.baseball-reference.com/data/war_daily_bat.txt','https://www.baseball-reference.com/data/war_daily_pitch.txt','2026-10-05T21:22:01.003Z');

-- ===========================================================================
-- 3. IDENTITY (fill NULL MLB ids; MLB spellings become aliases)
-- ===========================================================================

update public.players p
set mlb_id = i.mlb_id
from _m019_identity i
where p.slug = i.slug
  and p.mlb_id is null
  and not exists (select 1 from public.players o where o.mlb_id = i.mlb_id);

insert into public.sources (source_name, source_type, title, url, accessed_at, source_tier)
select distinct on (s.url)
  'MLB Stats API',
  case
    when s.url ~ '/transactions\?playerId=' then 'MLB_PLAYER_TRANSACTIONS'
    when s.url ~ '/stats\?' then 'MLB_PLAYER_SEASON_STATS'
    else 'MLB_PLAYER_RECORD'
  end,
  case
    when s.url ~ '/transactions\?playerId=' then 'MLB transaction history: '
    when s.url ~ 'leagueListId=milb_all' then 'MiLB season record: '
    when s.url ~ '/stats\?' then 'MLB season record: '
    else 'MLB player record: '
  end || coalesce(i.mlb_full_name, s.slug),
  s.url, s.retrieved_at,
  public.disi_infer_source_tier(s.url, null)
from _m019_sources s
left join _m019_identity i on i.slug = s.slug
order by s.url, s.retrieved_at
on conflict (url) do nothing;

insert into public.player_aliases (player_id, alias, alias_type, source_id)
select p.id, i.mlb_full_name, 'MLB_RECORD_NAME', src.id
from _m019_identity i
join public.players p on p.slug = i.slug
join public.sources src on src.url = 'https://statsapi.mlb.com/api/v1/people/' || i.mlb_id
where i.mlb_full_name is not null and i.mlb_full_name <> p.full_name
on conflict (player_id, alias) do nothing;

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'player', p.id, 'mlb_id', src.id,
       case when i.identity_basis = 'DODGERS_TRANSACTION_MATCH' then 'VERIFIED' else 'HIGH' end::public.confidence_level,
       i.identity_note
from _m019_identity i
join public.players p on p.slug = i.slug and p.mlb_id = i.mlb_id
join public.sources src on src.url = 'https://statsapi.mlb.com/api/v1/people/' || i.mlb_id
where not exists (select 1 from public.evidence e where e.entity_type = 'player' and e.entity_id = p.id
                  and e.field_name = 'mlb_id' and e.source_id = src.id);

-- ===========================================================================
-- 4. PROGRESS AND OUTCOME EVIDENCE
-- ===========================================================================

insert into public.player_professional_progress (
  player_id, as_of_date, mlb_debut_date, mlb_debut_team, last_mlb_season, highest_level, highest_level_season,
  last_affiliated_season, last_affiliated_team, last_affiliated_level, final_transaction_type, final_transaction_date,
  final_organization, final_transaction_description, disposition, active_in_affiliated_ball, continued_outside_affiliated,
  research_recommendation
)
select p.id, g.as_of_date, g.mlb_debut_date, g.mlb_debut_team, g.last_mlb_season, g.highest_level, g.highest_level_season,
       g.last_affiliated_season, g.last_affiliated_team, g.last_affiliated_level, g.final_transaction_type, g.final_transaction_date,
       g.final_organization, g.final_transaction_description, g.disposition, g.active_in_affiliated_ball, g.continued_outside_affiliated,
       g.research_recommendation
from _m019_progress g
join public.players p on p.slug = g.slug
on conflict (player_id) do update set
  as_of_date = excluded.as_of_date, mlb_debut_date = excluded.mlb_debut_date, mlb_debut_team = excluded.mlb_debut_team,
  last_mlb_season = excluded.last_mlb_season, highest_level = excluded.highest_level,
  highest_level_season = excluded.highest_level_season, last_affiliated_season = excluded.last_affiliated_season,
  last_affiliated_team = excluded.last_affiliated_team, last_affiliated_level = excluded.last_affiliated_level,
  final_transaction_type = excluded.final_transaction_type, final_transaction_date = excluded.final_transaction_date,
  final_organization = excluded.final_organization, final_transaction_description = excluded.final_transaction_description,
  disposition = excluded.disposition, active_in_affiliated_ball = excluded.active_in_affiliated_ball,
  continued_outside_affiliated = excluded.continued_outside_affiliated,
  research_recommendation = excluded.research_recommendation;

insert into public.outcome_evidence (player_id, source_id, supports_fields, confidence, note)
select p.id, src.id, s.supports_fields, 'VERIFIED'::public.confidence_level, null
from _m019_sources s
join public.players p on p.slug = s.slug
join public.sources src on src.url = s.url
where cardinality(s.supports_fields) > 0
on conflict (player_id, source_id) do update set supports_fields = excluded.supports_fields;

-- ===========================================================================
-- 5. OUTCOME AUDITS (new audits only; existing audits are never overwritten)
-- ===========================================================================

insert into public.outcome_audits (player_id, audited_through_date, reached_mlb_verified, source_id, confidence, audit_note, outcome_state)
select p.id, g.as_of_date, a.reached_mlb,
       (select src.id from public.sources src where src.url = 'https://statsapi.mlb.com/api/v1/people/' || i.mlb_id),
       case when a.outcome_state = 'NO_MLB_CAREER_ENDED' and g.final_transaction_type is null
            then 'HIGH' else 'VERIFIED' end::public.confidence_level,
       a.evidence_summary || ' (MLB Stats API, through ' || to_char(g.as_of_date, 'YYYY-MM-DD') || '.)',
       a.outcome_state
from _m019_audits a
join public.players p on p.slug = a.slug
join _m019_progress g on g.slug = a.slug
join _m019_identity i on i.slug = a.slug
where a.is_new_audit
on conflict (player_id) do nothing;

-- Existing audits: add the outcome state only (reached flag untouched).
update public.outcome_audits oa
set outcome_state = case when oa.reached_mlb_verified then 'REACHED_MLB' else coalesce(a.outcome_state, 'NO_MLB_STATUS_UNKNOWN') end
from public.players p
left join _m019_audits a on a.slug = p.slug and not a.is_new_audit
where oa.player_id = p.id
  and oa.outcome_state is null;

-- Any existing "no MLB" audit that the new research contradicts is flagged, not changed.
insert into public.research_source_conflicts (conflict_key, conflict_type, player_id, field_name, value_a, value_b, source_b_id, status, note)
select 'OUTCOME:' || p.slug, 'CLASS_MEMBERSHIP', p.id, 'reached_mlb_verified',
       'Existing audit: no MLB debut', 'MLB person record shows an MLB debut on ' || g.mlb_debut_date,
       (select src.id from public.sources src where src.url = 'https://statsapi.mlb.com/api/v1/people/' || i.mlb_id),
       'UNRESOLVED', 'Existing audit left unchanged; review required.'
from public.outcome_audits oa
join public.players p on p.id = oa.player_id
join _m019_progress g on g.slug = p.slug
join _m019_identity i on i.slug = p.slug
where not oa.reached_mlb_verified and g.mlb_debut_date is not null
on conflict (conflict_key) do nothing;

-- ===========================================================================
-- 6. VERIFIED MLB OUTCOMES AND bWAR
-- ===========================================================================

insert into public.outcomes (
  player_id, reached_mlb, mlb_debut_date, mlb_debut_organization_id, current_status, outcome_through_season, source_id, confidence
)
select p.id, true, g.mlb_debut_date, debut.id,
       case when g.last_mlb_season >= extract(year from g.as_of_date)::int
            then 'ACTIVE_MLB_' || g.last_mlb_season else 'LAST_MLB_' || g.last_mlb_season end,
       extract(year from g.as_of_date)::int,
       (select src.id from public.sources src where src.url = 'https://statsapi.mlb.com/api/v1/people/' || i.mlb_id),
       'VERIFIED'
from _m019_audits a
join public.players p on p.slug = a.slug
join _m019_progress g on g.slug = a.slug
join _m019_identity i on i.slug = a.slug
left join public.organizations debut on debut.name = g.mlb_debut_team
where a.is_new_audit and a.reached_mlb
on conflict (player_id) do nothing;

insert into public.sources (source_name, source_type, title, url, accessed_at, notes, source_tier)
select distinct on (u.url) 'Baseball-Reference', 'WAR_DATA_FILE', u.title, u.url, u.retrieved_at,
       'Baseball-Reference WAR data file. Career bWAR = sum of batting and pitching WAR rows for the player''s mlb_ID.',
       'BASEBALL_REFERENCE'
from (
  select bat_url as url, retrieved_at, 'Baseball-Reference WAR data: batting (war_daily_bat.txt)' as title from _m019_bwar
  union all
  select pitch_url, retrieved_at, 'Baseball-Reference WAR data: pitching (war_daily_pitch.txt)' from _m019_bwar
) u
order by u.url, u.retrieved_at
on conflict (url) do nothing;

insert into public.player_metric_observations (
  player_id, metric_key, value, observed_through_date, observed_through_season, source_id, confidence, notes
)
select p.id, 'CAREER_BWAR', b.career_bwar, (b.retrieved_at at time zone 'UTC')::date, b.observed_through_season,
       bat.id, 'VERIFIED',
       'Sum of Baseball-Reference batting and pitching WAR rows for mlb_ID ' || b.mlb_id || ' (' || b.bref_id || '); pitching file: ' || b.pitch_url
from _m019_bwar b
join public.players p on p.slug = b.slug
join public.sources bat on bat.url = b.bat_url
on conflict (player_id, metric_key, observed_through_date) do nothing;

update public.players p
set bref_id = b.bref_id
from _m019_bwar b
where p.slug = b.slug and p.bref_id is null
  and not exists (select 1 from public.players o where o.bref_id = b.bref_id);

-- ===========================================================================
-- 7. VIEWS
-- ===========================================================================

-- 7a. Conflict types gain OUTCOME and IDENTITY.
alter table public.research_source_conflicts drop constraint if exists research_source_conflicts_conflict_type_check;
alter table public.research_source_conflicts add constraint research_source_conflicts_conflict_type_check
  check (conflict_type in ('NAME_SPELLING','POSITION','BIRTH_COUNTRY','COUNTRY_MARKET','CLASS_MEMBERSHIP',
    'POPULATION_COUNT','PERIOD_ASSIGNMENT','POPULATION_DEFINITION','OUTCOME','IDENTITY'));

update public.research_source_conflicts set conflict_type = 'OUTCOME'
where conflict_key like 'OUTCOME:%' and conflict_type <> 'OUTCOME';

-- MLB spellings that differ from the DISI name (beyond accents / qualifiers).
insert into public.research_source_conflicts (
  conflict_key, conflict_type, player_id, field_name, value_a, value_b, source_b_id, status, resolution
)
select 'NAME:' || p.slug, 'NAME_SPELLING', p.id, 'full_name', p.full_name, i.mlb_full_name, src.id, 'RESOLVED',
       'DISI name kept (it matches the signing source); MLB spelling stored as an alias. Identity basis: ' || i.identity_basis || '.'
from _m019_identity i
join public.players p on p.slug = i.slug
join public.sources src on src.url = 'https://statsapi.mlb.com/api/v1/people/' || i.mlb_id
where i.mlb_full_name is not null
  and public.disi_ascii_fold(regexp_replace(p.full_name, '\s*\([^)]*\)', '', 'g')) <> public.disi_ascii_fold(i.mlb_full_name)
on conflict (conflict_key) do nothing;

-- Identities resolved by name search rather than a Dodgers transaction.
insert into public.research_source_conflicts (
  conflict_key, conflict_type, player_id, field_name, value_a, value_b, source_b_id, status, resolution, note
)
select 'IDENTITY:' || p.slug, 'IDENTITY', p.id, 'mlb_id', p.full_name, i.mlb_full_name || ' (MLB id ' || i.mlb_id || ')',
       src.id, 'RESOLVED', i.identity_note, 'Resolved by corroborating evidence rather than a Dodgers signing transaction.'
from _m019_identity i
join public.players p on p.slug = i.slug
join public.sources src on src.url = 'https://statsapi.mlb.com/api/v1/people/' || i.mlb_id
where i.identity_basis <> 'DODGERS_TRANSACTION_MATCH'
on conflict (conflict_key) do nothing;

-- 7b. Player dossier (replaces 017): existing columns kept; outcome state and
-- structured progress appended.
create or replace view public.v_player_dossier
with (security_invoker = true)
as
select
  p.id as player_id,
  p.slug as player_slug,
  p.full_name,
  p.canonical_name,
  coalesce(pa.aliases, array[]::text[]) as aliases,
  p.birth_date,
  p.birth_city,
  p.birth_country,
  p.nationality,
  p.primary_position,
  p.secondary_positions,
  p.bats,
  p.throws,
  p.height_in,
  p.weight_lb,
  p.mlb_id,
  p.bref_id,
  p.fangraphs_id,
  case
    when oa.player_id is null then 'NOT_AUDITED'
    when oa.reached_mlb_verified then 'VERIFIED_MLB'
    else 'VERIFIED_NO_MLB'
  end as outcome_audit_status,
  oa.reached_mlb_verified,
  oa.audited_through_date,
  oa.audit_note,
  oa.confidence::text as audit_confidence,
  oc.mlb_debut_date,
  debut.abbreviation as mlb_debut_org,
  debut.name as mlb_debut_org_name,
  case when debut.id is null then null else debut.franchise_key = 'DODGERS' end
    as direct_dodgers_franchise_debut,
  oc.mlb_games,
  oc.mlb_pa,
  oc.mlb_ip,
  oc.years_of_mlb_service,
  oc.current_status,
  oc.outcome_through_season,
  (oc.current_status ilike 'ACTIVE%' or oc.current_status ilike 'REACHED_MLB_%') as is_active,
  w.career_bwar,
  w.bwar_source_id,
  w.bwar_source_url,
  w.bwar_observed_through_date,
  w.bwar_observed_through_season,
  w.career_fwar,
  w.fwar_source_id,
  w.fwar_source_url,
  w.fwar_observed_through_date,
  w.fwar_observed_through_season,
  oa.outcome_state,
  pp.as_of_date as progress_as_of_date,
  pp.highest_level,
  pp.highest_level_season,
  pp.last_affiliated_season,
  pp.last_affiliated_team,
  pp.last_affiliated_level,
  pp.final_transaction_type,
  pp.final_transaction_date,
  pp.final_organization,
  pp.disposition,
  pp.active_in_affiliated_ball,
  pp.continued_outside_affiliated,
  (select count(*)::int from public.outcome_evidence e where e.player_id = p.id) as outcome_evidence_count
from public.players p
left join lateral (
  select array_agg(a.alias order by a.alias) as aliases
  from public.player_aliases a
  where a.player_id = p.id
) pa on true
left join public.outcome_audits oa on oa.player_id = p.id
left join public.outcomes oc on oc.player_id = p.id
left join public.organizations debut on debut.id = oc.mlb_debut_organization_id
left join public.v_player_war w on w.player_id = p.id
left join public.player_professional_progress pp on pp.player_id = p.id;

-- 7c. Player provenance (replaces 018): adds outcome evidence.
create or replace view public.v_player_sources
with (security_invoker = true)
as
with facts as (
  select s.player_id,
         'Signing ' || s.signing_year || coalesce(' · ' || replace(e.field_name, '_usd', ''), '') as fact,
         e.source_id, e.confidence::text as confidence, e.evidence_note as note
  from public.evidence e
  join public.signings s on s.id = e.entity_id
  where e.entity_type = 'signing'
  union all
  select e.entity_id, 'Player record' || coalesce(' · ' || e.field_name, ''),
         e.source_id, e.confidence::text, e.evidence_note
  from public.evidence e
  where e.entity_type = 'player'
  union all
  select oc.player_id, 'MLB outcome', oc.source_id, oc.confidence::text, null
  from public.outcomes oc where oc.source_id is not null
  union all
  select oa.player_id, 'Outcome audit', oa.source_id, oa.confidence::text, oa.audit_note
  from public.outcome_audits oa where oa.source_id is not null
  union all
  select m.player_id,
         case m.metric_key when 'CAREER_BWAR' then 'Career bWAR' else 'Career fWAR' end
           || ' through ' || to_char(m.observed_through_date, 'YYYY-MM-DD'),
         m.source_id, m.confidence::text, m.notes
  from public.player_metric_observations m
  union all
  select t.player_id, 'Transaction ' || coalesce(to_char(t.transaction_date, 'YYYY-MM-DD'), ''),
         t.source_id, t.confidence::text, t.return_description
  from public.transactions t where t.source_id is not null
  union all
  select a.player_id, 'Transaction ' || to_char(e.transaction_date, 'YYYY-MM-DD'),
         coalesce(a.source_id, e.source_id), null, e.description
  from public.transaction_event_assets a
  join public.transaction_events e on e.id = a.event_id
  where a.player_id is not null and coalesce(a.source_id, e.source_id) is not null
  union all
  select a.player_id, 'Trade return metrics', r.source_id, null, r.valuation_note
  from public.transaction_event_assets a
  join public.transaction_return_metrics r on r.event_id = a.event_id
  where a.player_id is not null and r.source_id is not null
  union all
  select m.player_id, 'Development · ' || replace(initcap(m.milestone::text), '_', ' '),
         m.source_id, m.confidence::text, m.notes
  from public.development_milestones m where m.source_id is not null
  union all
  select s.player_id, 'Signing class ' || s.signing_year || ' size', c.source_id, null, c.notes
  from public.signings s
  join public.organizations o on o.id = s.organization_id
  join public.signing_census_coverage c
    on s.signing_year between c.period_start_year and c.period_end_year
  join public.organizations co on co.id = c.organization_id and co.franchise_key = o.franchise_key
  where c.source_id is not null
  union all
  select s.player_id,
         'Class membership · ' || pop.period_label || ' (' || replace(initcap(ms.membership_basis), '_', ' ') || ')',
         ms.source_id, ms.confidence::text,
         concat_ws(' ', ms.note, 'Supports: ' || array_to_string(ms.supports_fields, ', ') || '.')
  from public.signing_population_member_sources ms
  join public.signing_population_members pm on pm.id = ms.member_id
  join public.signing_populations pop on pop.id = pm.population_id
  join public.signings s on s.id = pm.signing_id
  union all
  select a.player_id, 'Alias · ' || a.alias, a.source_id, null, null
  from public.player_aliases a where a.source_id is not null
  union all
  select oe.player_id,
         'Outcome evidence · ' || array_to_string(array(select replace(initcap(f), '_', ' ') from unnest(oe.supports_fields) f), ', '),
         oe.source_id, oe.confidence::text, oe.note
  from public.outcome_evidence oe
)
select distinct
  f.player_id,
  f.fact,
  src.id as source_id,
  src.source_name,
  src.source_type,
  coalesce(src.source_tier, public.disi_infer_source_tier(src.url, src.source_type)) as source_tier,
  st.priority as tier_priority,
  src.title,
  src.url,
  src.publication_date,
  (src.accessed_at at time zone 'UTC')::date as accessed_date,
  f.confidence,
  f.note
from facts f
join public.sources src on src.id = f.source_id
left join public.source_tiers st
  on st.tier_code = coalesce(src.source_tier, public.disi_infer_source_tier(src.url, src.source_type));

-- 7d. Outcome audit progress (Dodgers franchise).
create or replace view public.v_dodgers_outcome_audit_progress
with (security_invoker = true)
as
with r as (
  select s.signing_year, oa.player_id is not null as audited, oa.reached_mlb_verified, oa.outcome_state,
         (s.signing_year <= extract(year from current_date)::int - 5) as mature
  from public.signings s
  join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
  left join public.outcome_audits oa on oa.player_id = s.player_id
)
select
  count(*)::int as tracked_signings,
  count(*) filter (where audited)::int as audited,
  count(*) filter (where reached_mlb_verified)::int as verified_mlb,
  count(*) filter (where reached_mlb_verified = false)::int as verified_no_mlb,
  count(*) filter (where outcome_state = 'NO_MLB_CAREER_ENDED')::int as no_mlb_career_ended,
  count(*) filter (where outcome_state = 'NO_MLB_ACTIVE_IN_MINORS')::int as no_mlb_active_in_minors,
  count(*) filter (where outcome_state = 'NO_MLB_STATUS_UNKNOWN')::int as no_mlb_status_unknown,
  count(*) filter (where not audited)::int as unaudited,
  count(*) filter (where not audited and mature)::int as mature_unaudited,
  count(*) filter (where not audited and not mature)::int as developing_unaudited,
  round(100.0 * count(*) filter (where audited) / nullif(count(*), 0), 1) as audit_completion_pct,
  round(100.0 * count(*) filter (where audited and mature) / nullif(count(*) filter (where mature), 0), 1) as mature_audit_completion_pct
from r;

-- 7e. Mature outcome queue: unaudited signings at least five years old.
create or replace view public.v_dodgers_mature_outcome_queue
with (security_invoker = true)
as
select
  p.id as player_id,
  p.slug as player_slug,
  p.full_name,
  p.mlb_id,
  s.signing_year,
  extract(year from current_date)::int - s.signing_year as years_since_signing,
  case
    when s.signing_year <= 2014 then 'TIER_1_THROUGH_2014'
    when s.signing_year <= 2020 then 'TIER_2_2015_2020'
    else 'TIER_3_RECENT_MATURE'
  end as audit_tier,
  pp.highest_level,
  pp.last_affiliated_season,
  pp.last_affiliated_team,
  pp.disposition,
  pp.research_recommendation,
  case
    when pp.player_id is null then 'NOT_YET_RESEARCHED'
    when pp.research_recommendation = 'INSUFFICIENT_EVIDENCE' then 'INSUFFICIENT_EVIDENCE'
    when pp.research_recommendation = 'NO_MLB_ACTIVE_IN_MINORS' then 'STILL_DEVELOPING'
    else 'AWAITING_REVIEW'
  end as unaudited_reason,
  case
    when s.signing_year <= 2014 then 100
    when s.signing_year <= 2020 then 80
    else 60
  end + case when pp.player_id is null then 10 else 0 end as priority
from public.signings s
join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
join public.players p on p.id = s.player_id
left join public.outcome_audits oa on oa.player_id = s.player_id
left join public.player_professional_progress pp on pp.player_id = s.player_id
where oa.player_id is null
  and s.signing_year <= extract(year from current_date)::int - 5;

-- 7f. Outcomes by signing class. A tracked-cohort share is shown only when every
-- tracked player is audited and is always labelled as a tracked-cohort outcome;
-- organization rate analysis follows the 018 population rules.
create or replace view public.v_dodgers_outcome_by_signing_class
with (security_invoker = true)
as
with r as (
  select s.signing_year, oa.player_id is not null as audited, oa.reached_mlb_verified, oa.outcome_state
  from public.signings s
  join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
  left join public.outcome_audits oa on oa.player_id = s.player_id
),
agg as (
  select signing_year,
         count(*)::int as tracked_players,
         count(*) filter (where audited)::int as audited,
         count(*) filter (where reached_mlb_verified)::int as mlb_reached,
         count(*) filter (where reached_mlb_verified = false)::int as verified_no_mlb,
         count(*) filter (where outcome_state = 'NO_MLB_ACTIVE_IN_MINORS')::int as no_mlb_still_active,
         count(*) filter (where not audited)::int as unresolved
  from r
  group by signing_year
),
pops as (
  select y.signing_year,
         array_agg(distinct pc.population_scope order by pc.population_scope) as population_scopes,
         bool_or(pc.rate_eligible) as any_rate_eligible
  from public.v_dodgers_signing_population_coverage pc
  cross join lateral generate_series(pc.signing_year, coalesce((select p.class_year_end from public.signing_populations p where p.population_key = pc.population_key), pc.signing_year)) as y(signing_year)
  group by y.signing_year
)
select
  a.signing_year,
  a.tracked_players,
  a.audited,
  a.mlb_reached,
  a.verified_no_mlb,
  a.no_mlb_still_active,
  a.unresolved,
  case
    when a.signing_year <= extract(year from current_date)::int - 10 then 'MATURE_10_PLUS_YEARS'
    when a.signing_year <= extract(year from current_date)::int - 5 then 'MATURE_5_TO_9_YEARS'
    else 'DEVELOPING'
  end as maturity_status,
  coalesce(p.population_scopes, array[]::text[]) as population_scopes,
  coalesce(p.any_rate_eligible, false) as organization_rate_allowed,
  (a.unresolved = 0) as all_tracked_audited,
  'TRACKED_COHORT_OUTCOME' as cohort_label,
  case when a.unresolved = 0 and a.tracked_players > 0
    then round(a.mlb_reached::numeric / a.tracked_players, 4) end as tracked_cohort_mlb_share,
  'Share of the players DISI tracks for this class. Not an organization-wide class rate unless organization_rate_allowed is true.' as cohort_caveat
from agg a
left join pops p on p.signing_year = a.signing_year;

do $$
declare v text;
begin
  foreach v in array array['v_player_dossier', 'v_player_sources', 'v_dodgers_outcome_audit_progress',
    'v_dodgers_mature_outcome_queue', 'v_dodgers_outcome_by_signing_class'] loop
    execute format('revoke all on public.%I from anon, authenticated', v);
    execute format('grant select on public.%I to anon, authenticated', v);
  end loop;
end $$;

commit;
