# DISI ingestion and provenance workflow

The rules behind this workflow (maturity, outcome audits, acquisition cost, transaction attribution, readiness) are consolidated in [`RESEARCH-METHODOLOGY.md`](RESEARCH-METHODOLOGY.md). Two never change: `NOT_AUDITED` is not `AUDITED_NO_MLB`, and an unknown cost is not `$0`.

How new facts enter the database. The goal is complete signing classes from authoritative sources, not a hand-picked list of well-known players.

## Source priority

| Priority | Tier (`source_tiers.tier_code`) | Authoritative for | Never used for |
| --- | --- | --- | --- |
| 1 | `OFFICIAL_CLUB_RELEASE` — official Dodgers / MLB club releases | class membership, stated class size, club transactions | — |
| 2 | `MLB_TRANSACTION_LOG` — official MLB transaction logs | exact signing dates, additional class members | class size on its own |
| 3 | `MLB_PIPELINE` — MLB Pipeline trackers and prospect profiles | prospect rank, reported bonus, position, market | class size, league census |
| 4 | `BASEBALL_REFERENCE` | MLB debut, MLB outcomes, **bWAR**, historical transactions | fWAR |
| 5 | `FANGRAPHS` | **fWAR** only | bWAR |
| 6 | `MILB_MLB_PLAYER_RECORD` | development milestones, minor-league progression, biography | bWAR |
| 7 | `MLB_COM_REPORTING` | context, reported class size until an official release is found | — |

When two sources disagree about the same fact type, the lower priority number wins. Record both; do not delete the losing source.

## Every source keeps

`sources.url` (unique), `source_name`, `source_type`, `title`, `publication_date`, `accessed_at`, `source_tier`, and optional `notes`. Every fact link keeps a `confidence` (`evidence.confidence`, `outcome_audits.confidence`, `player_metric_observations.confidence`).

## Populations: what a count describes

**An announcement total is not necessarily the full signing-period total.** A club's international-class release usually describes the players announced when the signing period opens; the club keeps signing players for the rest of the period. DISI therefore records which population a count describes:

| Population | Meaning | Can be a rate denominator? |
| --- | --- | --- |
| Signing class | The class year a signing is counted in (`signings.signing_year`). | — |
| Announced opening class (`OPENING_CLASS`) | Players named or counted in the club's opening announcement. | No. Statistics are labelled *opening-class cohort rates*. |
| Full signing period (`FULL_SIGNING_PERIOD`) | Every international signing in the period (e.g. Jan 15 – Dec 15). | Yes, once complete, fully audited and five years mature. |
| Top-prospect sample (`TOP_PROSPECT_SAMPLE`) | MLB Pipeline Top 30/50 trackers. | No. |
| Historical verified set (`HISTORICAL_VERIFIED_SET`) | Individually verified historical signings. | No. |
| Other defined population (`OTHER_DEFINED_POPULATION`) | E.g. a calendar-year count that spans two periods. | No. |

A player can be announced in a class while the formal MLB transaction is dated later (Eduardo Rojas: announced January 2024, transaction May 30, 2024), so `announced_date` and `formal_transaction_date` are separate fields and `signing_date` is never rewritten.

## Adding a signing class

1. **Register the class source.** Prefer the official club release. Insert into `sources` with `source_tier = 'OFFICIAL_CLUB_RELEASE'`, `publication_date` and `accessed_at`.
2. **Define the population.** Insert a `signing_populations` row:
   - `population_scope = 'OPENING_CLASS'` for a club's opening announcement, `'FULL_SIGNING_PERIOD'` only when the source covers the whole period (e.g. "signed 26 players during the recently completed period");
   - `expected_size` only when a source states the total, with `expected_size_source_id`;
   - `stated_composition` for any stated position / country breakdown;
   - `rate_analysis_suitable = true` only for a full signing period.
3. **Add players.** Insert `players` (slugs are assigned automatically). Leave unknown biography fields `NULL`. Add spelling variants to `player_aliases`.
4. **Add signings.** Insert `signings` with `record_scope`, `country_market`, `pathway`, `signing_date` (from the transaction log), and only the cost components the sources state: `signing_bonus_usd`, `posting_fee_usd`, `transfer_fee_usd`. Never enter `0` for unknown.
5. **Record membership.** For each signing, insert `signing_population_members` and one `signing_population_member_sources` row per source with its `membership_basis` and the `supports_fields` it actually supports. A class list supports `CLASS_MEMBERSHIP` (and published position / country); only an MLB transaction record supports `FORMAL_TRANSACTION_DATE`.
6. **Set dates separately.** `announced_date` from the announcement; `formal_transaction_date` and `transaction_source_id` from the MLB transaction record. Never overwrite `signing_date`.
7. **Link field evidence.** One `evidence` row per signing and source; use `field_name` when a source supports one specific field (for example `signing_bonus_usd`).
8. **Record disagreements.** When sources disagree, keep the canonical value, store the other as an alias or leave the field NULL, and add a `research_source_conflicts` row. Never delete a player because one source omits them.
9. **Check coverage.** `/research` (views `v_dodgers_signing_population_coverage`, `v_dodgers_class_source_reconciliation`, `v_dodgers_signing_period_research_queue`) recomputes everything live. A population turns complete only when its stated size is matched and no conflict is open.

Example: the official 2025 release states 29 international amateur free agents and their position and country breakdown, but does not name them. The names came from secondary class tables (True Blue LA, Dodgers Digest) and each was verified against MLB transaction records. The opening class is complete at 29/29, but the full 2025 signing period is not: no source states its total, and MLB records show further signings later in the year (`signing_period_candidates`).

## Research scripts

The repeatable way to gather facts is `scripts/mlb/` (full reference in `scripts/mlb/README.md`). The scripts read public MLB Stats API and Baseball-Reference data, cache every response with its retrieval time, and write review artifacts to `research-output/`. They never write to a database.

```bash
npm run research:test                                   # offline tests for the scripts
node scripts/mlb/org-signings.mjs --year 2025 --start 2025-01-15 --end 2025-12-15
node scripts/mlb/resolve-ids.mjs --input players.json
node scripts/mlb/player-outcomes.mjs --input players.json --audit-date 2026-10-05
node scripts/mlb/bref-war.mjs --input mlb-players.json
node scripts/mlb/reconcile-class.mjs --list class.txt --signings research-output/org-signings-119-2025/org-signings.json
node scripts/mlb/outcome-sql-values.mjs --outcomes a.json --bwar bref-war.json --audit-date 2026-10-05 --out values.sql
```

Workflow: run the research → review the JSON / CSV artifacts and the decisions report → record manual decisions (e.g. identity) in a decisions file → generate VALUES → build a migration from a template (see `database/research/019/` and `020/`) → run `npm test` (the DB test applies every migration in PGlite and re-runs the latest) → apply in the Supabase SQL Editor.

## Recording player identity

- **Identifier roles.** `players.mlb_id` is the MLB Stats API person id and the anchor of every identity: biography and the other ids are applied only to a player whose MLB id is resolved. `bref_id` is the Baseball-Reference page id, recorded only for players with an MLB debut. `fangraphs_id` comes from MLB's cross-reference and is only an identifier; it never implies fWAR.
- **Resolution.** Several signals, never a name alone (club transaction name + club + year; a B-Ref page DISI already cites; name + debut year + debut franchise). Ambiguous or name-only matches are never selected. Every attempt is in `player_identity_resolutions` (query, candidates, signals, status, confidence) and anything unresolved is in `v_dodgers_player_identity_research_queue`.
- **Canonical name vs alias.** `full_name` / `canonical_name` is one spelling; every other spelling is a `player_aliases` row (`PREVIOUS_DISI_SPELLING`, `MLB_RECORD_NAME`, `PUBLISHED_SPELLING`, `SOURCE_VARIANT`). Names change only for accent-only differences. Slugs never change, and players are never merged because their names match.
- **Birth country vs signing market vs nationality.** `players.birth_country` is where the player was born (the literal value of a birth / player record: Joseph Deng Thon, born in Juba before 2011, is Sudan); `signings.country_market` is where he was signed; `players.nationality` is stated only where a source states it. None is derived from another, and a class list or signing announcement is evidence for the signing market only, never for birth country.
- **Fill NULLs only; record disagreements.** A source value that contradicts a stored value becomes a `research_source_conflicts` row; the stored value stays.
- **Field-level provenance.** Every identity field has its own `evidence` row (`field_name`) naming the source and its retrieval time (`sources.accessed_at`). Coverage counts a value as *resolved* only when such a row exists and no conflict is open; a non-null value without one is *unsourced* and queued.
- **Dates and ages.** `signing_date` (recorded signing / agreement date), `announced_date` (class announcement) and `formal_transaction_date` (MLB transaction) are different facts. `v_signing_ages` computes an age from each separately and `signing_date_basis` says whether the signing date matches the transaction. `age_at_signing` uses `signing_date` only; when it is missing the age is NULL, never borrowed from another date. Ages are completed years (`disi_age_years`) and decimal years truncated to one place (`disi_age_decimal`); the signing-age band uses completed years. `age_at_mlb_debut` uses the audited outcome debut date, then the progress record, then the MLB person record (`mlb_debut_date_basis`).

Identity workflow (see `database/research/020/README.md`):

```bash
node scripts/mlb/player-identities.mjs --input players-with-ids.json      # MLB person record + position at signing
node scripts/mlb/resolve-bref.mjs --input players-with-ids.json --identities player-identities.json
node scripts/mlb/resolve-fangraphs.mjs --identities player-identities.json
node scripts/mlb/identity-sql-values.mjs --players ... --identities ... --bref ... --fangraphs ... --out values.sql
```

Review `AMBIGUOUS`, `NEEDS_REVIEW`, `CONFLICT` and `NOT_FOUND` rows by hand; record the decision and its reason in the research README. Only `RESOLVED` rows are applied.

## Recording outcomes

- **Outcome audit:** `outcome_audits` with `audited_through_date`, `reached_mlb_verified`, `outcome_state`, `source_id`, `confidence`. A player without an audit row is "not audited", which is different from "did not reach MLB". A "no MLB" audit must have `outcome_evidence` supporting `MLB_REACH` (the database enforces it) and should state *why*: final release / free agency / retirement, two seasons without affiliated play, or still active. If the evidence does not establish that, leave the player unaudited.
- **Progress:** `player_professional_progress` holds highest level, last affiliated season and team, final transaction and disposition. Record it for developing players too; it is not an outcome.
- **MLB debut:** `outcomes.mlb_debut_date` and `mlb_debut_organization_id` from Baseball-Reference. Use the historical organization row (e.g. `BRO` for a Brooklyn debut).
- **bWAR:** insert into `player_metric_observations` with `metric_key = 'CAREER_BWAR'`, the Baseball-Reference page as `source_id`, `observed_through_date` (the date you read the value) and `observed_through_season`. Add a new row on each refresh instead of overwriting, so active players keep their history. The database rejects bWAR citing any non-Baseball-Reference source.
- **fWAR:** same table with `metric_key = 'CAREER_FWAR'` and a FanGraphs source. It is displayed separately and never replaces bWAR.
- Do not write new values to the legacy `outcomes.career_war` column.

## Transactions

Use `transaction_events` + `transaction_event_assets` for every trade so the whole package is recorded (`OUTGOING` and `INCOMING` assets). Return metrics go in `transaction_return_metrics` at event level; never assign a multi-player return to one outgoing player.

## Development history and transaction chains (047, 048, 049)

- **Read the source directly** (curl, raw file or archive); never store a search-snippet claim. Record the exact row or passage and the
  retrieval time.
- **Match identity on two signals.** A transaction asset is matched to a DISI player by name **and** birth date (or an MLB id), never by name.
- **Record an exit only when the source states it.** An asset the source does not mention after its acquisition stays unresolved. (049: do
  not hold a stated exit or trade back because a returned player's bWAR cannot be loaded. `KNOWN TRANSACTION != KNOWN RETURN VALUE`: record the
  transaction, leave the value `RETURN_WAR_UNKNOWN`, and never invent a number.)
- **Development stints come from the pipeline** (`scripts/mlb/player-seasons.mjs`, then `development-milestones.mjs`, then
  `development-sql-values.mjs`), whole careers, with seasons the API does not return left unknown. A level debut after the MLB debut season is
  a rehab or demotion appearance, not a milestone.
- **Never classify by assertion.** A team-less aggregate becomes a season total only when the migration proves it; an ambiguous level
  sequence becomes a `PENDING_REVIEW` progression decision.
- **Supersede, don't delete.** A sealed observation that a new exact fact replaces is retracted with a reason.
- Rebuild with `node database/research/047/build.mjs`; the evidence is regenerated by `derive-transactions.mjs` and `derive-development.mjs`.

### Extending development coverage to a cohort (048)

1. **Derive the cohort; never hard-code it.** The verified MLB players (`reached_mlb_verified`) minus every earlier controlled cohort, in the
   deterministic development-queue order. A player is not dropped for being difficult: difficulty gives a partial or unresolved result.
2. **Run the same three scripts** (`player-seasons.mjs`, `development-milestones.mjs`, `development-sql-values.mjs`) against the cached
   official MLB Stats API; then `node database/research/048/derive-development.mjs <dir>` (the cohort, the post-debut rule, and the rows already
   on record), and `derive-reviews.mjs <dir>` (pending reviews for inverted level sequences). `build.mjs` assembles the migration and its rollback.
3. **Never overwrite or duplicate** a row already on record (Migration 021 stored two of the 37): the build removes them from the values and the
   migration refuses to run if the state disagrees.
4. **`FIRST OBSERVED SEASON != FIRST PROFESSIONAL SEASON`.** Load the whole career the source holds; do not assume the first record is the
   first professional season, and do not add a milestone, season or level the source does not return. An established professional (Cuban,
   Mexican League, NPB, KBO) keeps his prior league as `FOREIGN_PRO` and his first affiliated season is not his first professional season.
5. **Decide nothing about an ambiguous level sequence.** Record it as `PENDING_REVIEW` with the season-by-season path in the note; a person
   decides it from `npm run research:development -- --review`.
6. **Report gaps by cause** (`SOURCE_UNAVAILABLE`, `SOURCE_BEGINS_LATE`, `NO_EVIDENCE_FOUND`, `ORGANIZATION_UNCLEAR`, `LEVEL_UNCLEAR`), not as one
   missing-data count, and keep the MLB debut milestone equal to the verified outcome-audit date (the migration refuses a mismatch).

### Completing transaction chains and packages (049)

1. **Order of truth.** Transaction, then package membership, then returned-player identity, then the value of the return, then attribution to a
   signing. Do not let a later layer block an earlier one.
2. **Read the transactions database directly** (Retrosheet `tranDB.zip`; the official MLB transaction log by player id) and cross-read a second
   source for package membership (SABR biographies, Baseball-Reference when readable). A page that does not load supports nothing; a search
   snippet is discovery only.
3. **Identity needs two signals.** Join a player to a row by the Chadwick Register crosswalk (Retrosheet / MLBAM / Baseball-Reference ids) **and** an
   exact birth date. For a minor leaguer with no career id, use the official season-by-season affiliations: a counterparty-side season before the
   trade and a Dodgers-organization season after it. Never join on a name.
4. **A trade is recorded when its membership is known**, whether or not its value is. Do not record a Dodgers exit that no source states, and
   do not read a player's disappearance as a release.
5. **A deferred player.** Record the agreement date as the event date; keep the delivery date in the description and the asset note; quote the text
   DISI stored before. Do not add a placeholder asset for a player to be named later when he is the only outgoing asset (it is counted as a
   second outgoing asset).
6. **Value is Baseball-Reference only.** Load team-season rows (`player_mlb_team_season_war`, `war_system = 'BWAR'`) from the Baseball-Reference
   WAR files with provenance. If the files answer 403, record the access result and leave the return `RETURN_WAR_UNKNOWN`. Do not use fWAR,
   estimates or numbers copied from another site.
7. **Cash, pool space and future considerations** are recorded only with a stated amount or item. An unnamed payment is `NULL`, never `0`.
8. Rebuild with `node database/research/049/build.mjs`; the evidence is regenerated by `node database/research/049/derive-transactions.mjs <dir>`.

## Before publishing a change

Run `npm test`. The database test executes every migration in order, reruns the latest migration, and checks slugs, bWAR provenance, class status rules, NULL handling and the read-only security model.
