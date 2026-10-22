# DISI research methodology

How DISI decides what is known, what is not, and what may be published. This file consolidates rules that were introduced across
Migrations 017-049; each section names the object that enforces it. The ingestion workflow (what to record for a new class, player or
transaction) stays in [`INGESTION.md`](INGESTION.md); the plan is in [`ROADMAP.md`](ROADMAP.md).

## Core principles

- **`NOT_AUDITED` is not `AUDITED_NO_MLB`.** A player without an outcome audit has no outcome. A missing audit is a gap in DISI's
  research, never a failure of the player, and it is never counted in a numerator, a denominator, a failure count, a base rate or a model.
- **`UNKNOWN COST` is not `$0`.** An acquisition cost that is not known is `NULL` and is reported as unknown. A zero is recorded only
  where a source states that nothing was paid, and it needs its own reviewed evidence.
- **Missing is not zero, and unknown is not negative.** This holds for outcomes, costs, dates, bWAR and transaction returns.
- **A source says something; DISI decides what it accepts.** Reports are kept as what a source said. A disagreement between independent
  sources stays visible (a conflict) until a reviewed decision resolves it. There is no last-write-wins.
- **Nothing is published below its support threshold.** A rate, a probability, an expected value or a recommendation appears only when the
  documented methodology says its evidence is sufficient. Thresholds are never lowered so a number can appear.
- **No claim without provenance.** Every canonical fact has a retrievable source. A model or search-snippet assertion is not evidence.
- **`UNKNOWN DEVELOPMENT HISTORY` is not `NO DEVELOPMENT`.** A player with no season rows, no known first professional season or no known
  highest level has a gap in DISI's research. A missing season is never read as "did not play", and a record that starts years after the
  signing is the first *observed* record, not the first professional season.
- **`UNKNOWN TRANSACTION` is not `RELEASED`.** No exit is inferred from a player's absence from later records. An exit is a sourced event;
  without one the exit is unknown (or the player is still with the organization), and DISI does not say which.
- **`UNKNOWN TRADE RETURN` is not `ZERO VALUE`.** A return that is not recorded or not valued is `NULL`; a zero is a recorded zero.
- **`PLAYER LEFT THE ORGANIZATION` is not `PLAYER FAILED`.** An exit says what happened to the asset, not how the player turned out.
- **`KNOWN TRANSACTION` is not `KNOWN RETURN VALUE`.** A verified trade is recorded even when the Baseball-Reference WAR of what came back is
  not loaded; its return then reads `RETURN_WAR_UNKNOWN` (`NULL`). Transaction facts and value facts stay separate.
- **`KNOWN PACKAGE` is not `INDIVIDUALLY ATTRIBUTABLE VALUE`.** Knowing who was in a trade says nothing about how its value is shared.
- **`MISSING BWAR` is not `ZERO BWAR`.** A returned player with no loaded Baseball-Reference team-season WAR has an unknown Dodgers value.
  fWAR, estimates, search snippets and copied numbers without provenance are not substitutes.
- **`CASH AMOUNT UNKNOWN` is not `CASH AMOUNT ZERO`**, and an unstated pool-space amount is never estimated.
- **`PTBNL UNRESOLVED` is not `NO PLAYER RETURN`.** A player to be named later, a player-to-be-named-or-cash and future considerations stay
  unresolved until a source resolves them; DISI does not assume cash, a player or zero.

## Maturity

A signing is **mature** when it is at least five years old at the analysis date.

- With a signing date: `signing_date <= as_of - interval '5 years'` (Feb 29 falls back to Feb 28, as PostgreSQL does).
- Without one: `signing_year <= extract(year from as_of) - 5`.
- The analysis date is the data's own as-of date (the latest outcome-audit date, `2026-10-05` for the current data), never the wall clock.

This is the rule of Migration 032 (`v_player_realized_organizational_value.is_mature`) and the year form used by 018 and 019. On the
current data the date form and the year form select the same 98 signings. `lib/research/maturity.js` implements it and a test pins it to
the SQL. Maturity decides *who may be audited and counted*; it does not decide what the audit finds.

## Outcome audits

An outcome audit is one row in `outcome_audits`: an as-of date, `reached_mlb_verified`, a source, a confidence, a note and an
`outcome_state`:

| State | Meaning | Audit status |
|---|---|---|
| `REACHED_MLB` | MLB debut verified | `VERIFIED_MLB` |
| `NO_MLB_CAREER_ENDED` | no longer in affiliated baseball through the audit date, no MLB debut | `VERIFIED_NO_MLB` |
| `NO_MLB_ACTIVE_IN_MINORS` | still in affiliated baseball, no MLB debut yet | `VERIFIED_NO_MLB` |
| `NO_MLB_STATUS_UNKNOWN` | no MLB debut verified, affiliated status not established | `VERIFIED_NO_MLB` |
| (no row) | not audited | `NOT_AUDITED` |

**What one research task may conclude** (`lib/research/outcome-audit.js`, applying `scripts/mlb/lib/classify.mjs`):

| Conclusion | Writes an audit? | When |
|---|---|---|
| `VERIFIED_MLB` | yes | a verified MLB debut, any signing year |
| `VERIFIED_NO_MLB` | yes | career ended in a class through **2021**; or still active in a class through **2020** |
| `NOT_AUDITED` | no | the observation exists but the class is too recent to call it an outcome (recorded as progress only) |
| `INSUFFICIENT_EVIDENCE` | no | no affiliated season and no usable transaction, or an unclear status; the player stays `NOT_AUDITED` |

Insufficient evidence is never a negative outcome, and an unfinished career is not a failure. `auditCaptureGaps()` lists what a written
audit still lacks: the as-of date, the MLB identity, a retrievable source with a retrieval time, a rationale, the outcome state, and the
debut date and organization (for `VERIFIED_MLB`) or the last affiliated season or final transaction (for `VERIFIED_NO_MLB`).

**Source hierarchy for MLB / no-MLB** (highest first; `source_tiers`): the official club release and the official MLB transaction log
(identity, dates, club transactions); the MLB Stats API person, season and transaction records (debut date, affiliated seasons, final
transaction); Baseball-Reference (MLB outcome and bWAR); FanGraphs (identifiers only); MLB.com reporting; reputable secondary
reconstructions (names only, never an outcome). A lower tier never overrides a higher one for the same fact.

**The 046 cohort** (`npm run research:outcomes -- --mature --status not_audited`): the order is the `v_dodgers_mature_outcome_queue`
priority (class tier 100 / 80 / 60, plus 10 if never researched), then signing year, signing date, sort name, player id. Every row says why
it is or is not resolvable: `NOT_MATURE`, `NO_MLB_ID`, `NOT_YET_RESEARCHED`, `INSUFFICIENT_EVIDENCE`,
`ACTIVE_IN_AFFILIATED_BALL_POLICY_HOLD`, `RESEARCH_COMPLETE_AWAITING_AUDIT_REVIEW`.

## Acquisition cost

The ledger is `signing_financial_reports` (Migrations 030/031): one row per source-stated component with `amount`, `currency_code`,
`amount_basis` (`EXACT`, `ROUNDED` with its precision, `APPROXIMATE`, `RULE_DERIVED`), `report_origin`, `source_id`, `evidence_basis`,
`confidence`, `retrieved_at` and a short note. ACTIVE reports are sealed; a correction supersedes, a retraction states a reason, nothing is
deleted.

| Cost state (`lib/research/cost-research.js`) | Meaning |
|---|---|
| `KNOWN_COMPLETE` | every required component has a known amount |
| `KNOWN_PARTIAL` | some required components are missing; the amount is a lower bound |
| `KNOWN_UNJUDGED` | an amount is known but DISI defines no required component for the route |
| `KNOWN_ZERO` | the evidenced total is exactly zero |
| `UNKNOWN` | no amount is known; **never** treated as zero |
| `NO_COST_RULE` | DISI defines no required component and no amount is known |

- A figure printed with every digit is `EXACT`; a rounded figure is `ROUNDED` with the precision of its last stated digit;
  `APPROXIMATE` never selects a canonical value.
- Several independent reports that agree select that amount. Reports that disagree stay ACTIVE side by side and the canonical bonus is
  `NULL`; the view reports a `CONFLICT` and it is queued. A reviewed `signing_financial_resolutions` row is the only way to choose.
- Known spend is always a lower bound while any cost is unknown.
- A page is used only if it was fetched and read directly. A page that answers 403/404/406 is not used and not worked around. A claim
  seen only in a search snippet is never stored.

**Priority** (`npm run research:costs -- --missing`; deterministic, never a score from a model): tier 1 mature and audited; 2 verified MLB;
3 a class with a reported population of at least 20; 4 a trade-value contributor; 5 the rest. Within a tier: verified MLB first, higher
observed bWAR, older class, name, signing id.

## Transactions and value attribution

Transaction events (`transaction_events`, `transaction_event_assets`, 033/034) record how a player left the organization:

| Disposition | Event type |
|---|---|
| released | `RELEASE` |
| traded | `TRADE` |
| sold / assigned | `SALE`, `WAIVER` |
| Rule 5 loss | `RULE5_SELECTION` |
| free agency | `FREE_AGENCY` |
| expansion draft loss | `EXPANSION_DRAFT` |
| unknown | none recorded; **no exit is inferred from absence** |

- **Package-level attribution.** The value of a multi-player trade return belongs to the package. A player's trade return is
  *individually attributable* only when the player was the sole outgoing asset; otherwise it is exposed at package level and the individual
  share is `NULL`. The full value of a package is never credited to one signing.
- **Explicit return states:** `LOADED`, `NO_MLB_APPEARANCE_OBSERVED`, `NO_PLAYER_RETURN`, `PLAYER_RETURN_PENDING`, `RETURN_UNRECORDED`,
  `RETURN_WAR_UNKNOWN`, `TIMING_UNRESOLVED`. Cash, pool space and prospects are not valued.
- **Chain status** (`product_player_decision.chain_status`): `NO_TRADE_CHAIN`, `STILL_ACTIVE`, `COMPLETE_TERMINAL`, and the incomplete states.
  Five describe an open transaction history (`INCOMPLETE_IDENTITY`, `INCOMPLETE_EXIT_NOT_RESEARCHED`, `INCOMPLETE_EXIT_UNRECORDED`,
  `INCOMPLETE_PENDING_CONSIDERATION`, `INCOMPLETE_RETURN_UNRECORDED`); two describe a chain recorded to its end whose returned players' value is
  unavailable (`INCOMPLETE_WAR_NOT_LOADED`, `INCOMPLETE_TIMING`). The tooling reports the two kinds separately (049).
- `npm run research:transactions -- --missing | --traded | --unresolved-attribution | --chains | --packages | --ptbnl | --future-consideration |
  --cash-unknown | --value-blocked | --bucket ...` lists the open work in a fixed order (queue priority, then the documented issue rank, then
  player and event); every item carries its blocker bucket and the evidence that would close it.

A transaction chain is completed by recording the exit event, its assets with stable identities and the return's team-season bWAR under the
033 audit; it is not completed by inferring from an MLB transaction text alone.

### What the chain statuses mean (047)

`chain_status` describes the players the Dodgers **received** in a signing's trade, not the signing itself:

| Status | Meaning |
|---|---|
| `NO_TRADE_CHAIN` | the signing has no trade lineage (a release, another exit, or no recorded exit) |
| `COMPLETE_TERMINAL` | every returned asset's own exit is recorded |
| `STILL_ACTIVE` | the signing was **traded** and an asset it returned is still under Dodgers control, so value is still accruing |
| `INCOMPLETE_EXIT_NOT_RESEARCHED` / `INCOMPLETE_EXIT_UNRECORDED` | a returned asset's exit is not recorded |
| `INCOMPLETE_PENDING_CONSIDERATION` / `INCOMPLETE_RETURN_UNRECORDED` | a returned asset was itself traded for a player to be named later, or for a return that is not recorded |
| `INCOMPLETE_WAR_NOT_LOADED` / `INCOMPLETE_TIMING` (049: **value** blockers) | the transaction chain is recorded to its end; a returned player has no loaded Baseball-Reference team-season WAR, or his same-season stint order cannot be resolved. The chain is **not** transaction-incomplete |

A signing's **own** exit is established by the exit summary (`v_dodgers_international_exit_summary.control_state`: `STILL_DODGERS_CONTROLLED`,
`LEFT_DODGERS_CONTROL`, `NO_EXIT_EVIDENCE`, `HISTORY_UNAVAILABLE`), which agrees with the transaction queue's `EXIT_STATUS_UNVERIFIED` and
`EXIT_TRANSACTION_MISSING` issues.

### Package-level truth before player-level attribution (047)

- **A complete trade package** has a date, both organizations, every outgoing and incoming piece named (or a player to be named later
  resolved), and a source for each. A transaction sentence naming one side is **not** a complete package. `packageCompleteness` counts, per
  trade, the open issues (`TRADE_RETURN_UNRECORDED`, `PTBNL_UNRESOLVED`, `FUTURE_CONSIDERATIONS_UNRESOLVED`, `CASH_AMOUNT_UNKNOWN`,
  `POOL_SPACE_AMOUNT_UNKNOWN`).
- **Package membership is verified against an independent source** where one exists: the five packages DISI records for Offerman, Mondesí,
  Amorós, Fernández and the 1962 Miller trade agree with Retrosheet's membership (`database/research/047/transaction-evidence.json`).
- **Value concepts stay separate and are never summed:** direct Dodgers value the signed player produced; value he produced for other
  organizations; Dodgers value obtained through the transaction; the package-level amount; and the part of the package attributable to him.
- **Attribution states** (`attributionState`): `NOT_A_TRADE_EXIT`, `RETURN_STILL_ACCRUING`, `CHAIN_INCOMPLETE`, `VALUE_NOT_DETERMINED`,
  `PACKAGE_LEVEL_ONLY`, `INDIVIDUALLY_ATTRIBUTED`, `RECORDED_ZERO_RETURN`.
- **When value can be attributed to one player:** only when he was the sole outgoing asset (`INDIVIDUALLY_ATTRIBUTED`). Value is never split
  equally among the outgoing players and never credited in full to the DISI signing. **When attribution must stay unresolved:** a shared
  package, an incomplete chain, or a return whose value is not determined. That is better than false precision.

### Transaction truth, package truth, return identity, return value, attribution (049)

The order is fixed and never reversed: **1** what happened to the asset, **2** who was in the package, **3** who the returned players are, **4**
what the returned players were worth to the Dodgers, **5** how much of that belongs to one signing. A later layer never blocks an earlier one.

**Policy.** A verified transaction or package is recorded when the model can represent its value as unresolved. Lack of valuation evidence is not a
reason to erase known transaction history. (047 left Bob Miller's 1967 exit and Tony Abreu's return unrecorded because the returned players' WAR
could not be loaded; the model already represents that as `RETURN_WAR_UNKNOWN` and `INCOMPLETE_WAR_NOT_LOADED`, so 049 records them.)

**Three kinds of missing evidence** (`BLOCKER_BUCKETS`, derived by `lib/research/transaction-research.js`, stored nowhere):

| Bucket | Meaning | Examples |
|---|---|---|
| `CHAIN_OR_MEMBERSHIP` | DISI does not know what happened to the asset or who was in the package | `TRADE_RETURN_UNRECORDED`, `PTBNL_UNRESOLVED`, `FUTURE_CONSIDERATIONS_UNRESOLVED`, a returned asset's missing exit |
| `TERMS` | the players are known; an amount is not | `CASH_AMOUNT_UNKNOWN`, `POOL_SPACE_AMOUNT_UNKNOWN` |
| `VALUE` | the transaction is known; the value of the return, or its attribution, is not | `DOWNSTREAM_WAR_NOT_LOADED`, `TIMING_UNRESOLVED`, `TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED` |

A package count hides the split: a package whose membership is open is a different problem from one whose players are all known and only a cash
amount is not. `packageBlockerSplit` reports both (they overlap, and are not added). `INCOMPLETE_WAR_NOT_LOADED` and `INCOMPLETE_TIMING` chains
read as `VALUE_NOT_DETERMINED` in the attribution state, never as `CHAIN_INCOMPLETE`.

**Recording a deferred player.** When a trade is agreed on one date and a player to be named later is delivered on another, the event carries
the **agreement** date (the date the return is measured from), the delivery date is kept in the event description and the delivered player's
asset note, and a corrected event quotes the text DISI stored before it. The migration is forward-only. A separate "player to be named later"
asset is **not** added when the named player is the only outgoing asset: the model counts every outgoing asset, so a placeholder and the player it
resolved to would turn a one-player trade into a "shared package" in the older package views. (Where several players leave, the existing
placeholder-and-resolution pattern still applies.)

**Identity.** A player is joined to a source row by an identifier crosswalk (Retrosheet id, MLBAM id, Baseball-Reference id from the Chadwick
Register) **and** an exact birth-date match against Retrosheet's BIOFILE and the MLB person record, never by name alone. A minor leaguer with no
Baseball-Reference career id gets an MLB id only, reconciled by official season-by-season affiliations that bracket the trade (a counterparty-side
season before it, a Dodgers-organization season after it).

**Value.** Dodgers bWAR is Baseball-Reference team-season WAR measured after the acquisition (the 032 / 033 timing rule, unchanged): the
counterparty's single stint anchors a same-season Dodgers stint, and if the order cannot be resolved the return is `TIMING_UNRESOLVED`,
not zero. fWAR cannot be stored as team-season WAR (`war_system = 'BWAR'`), and `CAREER_BWAR` must cite a Baseball-Reference source. The
verifier's identity rule (a returned player of a tracked-signing trade needs loaded WAR or an observed zero) is relaxed **only** for ids pinned in
`CANONICAL_EXPECTATIONS.transaction_war_unavailable_mlb_ids`, and only while the model shows the player as `RETURN_WAR_UNKNOWN` with a `NULL`
Dodgers bWAR. Today the list is one id: Jon Garland.

**Attribution** is unchanged: individual only for a sole outgoing asset, package-level for a shared package, never split, weighted or credited
in full to one signing, and withheld while the value is unknown.

## Development history (046 audit, 047 research, 048 coverage)

046 checked whether the current model supports development research. It does, with no schema addition, and 047 used it:

| Need | Where it lives |
|---|---|
| signing date | `signings.signing_date` (197 of 220; the 23 without are queued as `SIGNING_DATE_MISSING`) |
| birth date and age at signing | `players.birth_date`; `v_player_directory.age_at_signing` (197 of 220) |
| affiliate history | `player_season_stints` (one row per player / team / league / level / season) |
| level progression | `development_levels`, `development_level_era_map`, `development_milestones` (exact dates where a dated record exists), `development_progression_decisions` |
| MLB debut | `outcomes` / `players.mlb_debut_date` (47 verified debuts) |
| exit | `transaction_events` (033/034), `v_dodgers_international_exit_summary` |
| time to MLB, time to a level | derived from canonical dates (never stored): exact elapsed days between milestone endpoints; season-based approximations are labelled separately |

### What a complete development history is

There is **no single "complete" flag**. Completeness is six independent dimensions (`lib/research/development-research.js`), each `KNOWN`,
`UNKNOWN` or `NOT_APPLICABLE`, each reported with its own denominator:

| Dimension | Known when | Not applicable |
|---|---|---|
| `SIGNING_DATE` | the signing has a recorded date | never |
| `FIRST_PRO_SEASON` | the earliest recorded season is the signing season or the next, **and** the player was an amateur signing | never. A record starting two or more seasons after signing is only the first *observed* record; an established professional's first affiliated season is not his first professional season (048) |
| `HIGHEST_LEVEL` | a highest affiliated level is known, or a verified MLB debut (MLB, derived from the audited outcome) | never |
| `MLB_DEBUT` | a verified MLB player has a debut date | not a verified MLB player |
| `EXIT` | the exit summary says the player left control (an exit event exists) | still Dodgers-controlled |
| `CHRONOLOGY` | stints are on record and no chronology issue is open (season gap, unclassified level, unresolved organization, unresolved multi-org season, missing game date, level-skip cameo candidate, non-monotonic progression) | never |

A player can have a complete outcome audit and an incomplete development history, or complete timing and an incomplete transaction history;
the states are independent. A **complete transaction chain** is one whose signing exit is recorded and whose returned assets' exits and
returns are recorded (`COMPLETE_TERMINAL`, or `STILL_ACTIVE` where a returned asset is still held).

### The development research queue

`npm run research:development` orders every signing with at least one `UNKNOWN` dimension, deterministically (no score, no model):

| Tier | Signings |
|---|---|
| 1 | verified MLB players missing the signing date, the debut date or the first professional season |
| 2 | mature audited players missing the highest level |
| 3 | players who produced Dodgers bWAR and have any other open dimension |
| 4 | players traded away with an incomplete pre-trade history |
| 5 | audited no-MLB players with any open dimension |
| 6 | players not yet audited (younger or active) with any open dimension |
| 7 | the remainder |

Within a tier: Dodgers bWAR (higher first, `NULL` last), signing year, signing date, sort name, signing id. Same data, same bytes.

### First observed season, first professional season (048)

`FIRST OBSERVED SEASON != FIRST PROFESSIONAL SEASON`. `firstProSeasonStatus` returns exactly one of:

| Status | Meaning |
|---|---|
| `KNOWN` | an amateur signing whose earliest first-appearance season (professional debut, DSL, complex, Low-A) is the signing season or the next |
| `FIRST_OBSERVED_ONLY` | the earliest record starts two or more seasons after signing: it is the first *observed* record; the earlier seasons are missing |
| `PRIOR_PROFESSIONAL_CAREER` | the signing pathway is `CUBAN_PRO`, `JAPAN_PRO`, `KOREA_PRO`, `POSTED_PLAYER` or `MEXICAN_LEAGUE_TRANSFER` (the 037 `PROFESSIONAL_SIGNING` route), with or without an affiliated record: affiliated records cannot show when his professional career began |
| `NO_AFFILIATED_RECORD` | no first-appearance season is on record |

A player signed in 1985 whose API history begins in 1988 does not get 1988 as his first professional season. A Japanese, Korean, Cuban or
Mexican League professional entering MLB is not an amateur beginning professional baseball. Honouring the pathway corrected the 047 figure on
the pre-048 state from 164 to 163 of 220 (Puig, a Cuban professional, had been counted). Prior professional leagues stay `FOREIGN_PRO` stints
(never an affiliated level, never on the progression ladder); where the API holds none (Sasaki's NPB years) that career is a documented
limitation, not an invented row, and no subsystem was added for it.

### How much of a path is documented (048)

`historyCoverage` (`lib/research/history-coverage.js`) describes the path from signing to the MLB debut at season precision. It never fills a
season, a level or an organization; it names why the record is silent:

| Gap | Meaning |
|---|---|
| `SOURCE_UNAVAILABLE` | the source returns no structured pre-MLB record for the player |
| `SOURCE_BEGINS_LATE` | the first structured record is two or more seasons after signing |
| `NO_EVIDENCE_FOUND` | a season between the first record and the debut season has no record |
| `ORGANIZATION_UNCLEAR` | a pre-MLB stint has no organization resolved from its team, league and season |
| `LEVEL_UNCLEAR` | a pre-MLB stint could not be placed on the level ladder |

Notes explain and do not open an obligation: `LEAGUE_SEASON_NOT_PLAYED` (the 2020 minor-league season was cancelled, so no affiliated record
exists for any player that year; this says nothing about where a player was) and `PRIOR_PROFESSIONAL_CAREER`. There is no "complete":
`NO_OPEN_GAP` means only that no gap is visible at season precision, and a path with a prior professional career is `PARTIAL` by construction.
`PARTIAL HISTORY != NO HISTORY`. A post-MLB minor-league stint (rehabilitation, demotion, a late reassignment) is not part of the pre-MLB path
and is never a developmental arrival: `POST-MLB MINOR-LEAGUE STINT != DEVELOPMENTAL ARRIVAL`.

### Career events are not exits (048)

A sourced `RELEASED` / `RETIRED` development milestone records a dated career event. It is not an organization exit unless the transaction model
independently establishes that exit. `DATED RELEASE/RETIREMENT EVENT KNOWN != ORGANIZATION KNOWN`; `UNKNOWN ORGANIZATION != DODGERS`. Where the source
does not name the organization it stays NULL and is never filled from an adjacent stint. The Dodgers exit comes only from `transaction_events` /
`transaction_event_assets` and `v_dodgers_international_exit_summary` (proved by `tests/db/research-048.test.mjs`).

### Ambiguous level sequences are reviewed by a person (048)

`AMBIGUOUS LEVEL SEQUENCE != CANONICAL LEVEL DEBUT`. When a lower level is first recorded in a *later* season than a higher one, every level in
the inverted pairs becomes a `REVIEW_REQUIRED` / `PENDING_REVIEW` decision (confidence `LOW`) whose note lists the season-by-season path. Neither
reading (an early cameo at the higher level, or a later reassignment, demotion or rehabilitation at the lower one) is asserted. Players whose
reviewed decisions already exist (Migration 024) are not asked again. `npm run research:development -- --review [--player slug]` prints the
reviewer's packet: the pending decisions and their notes, the source stints in chronological order, the first appearance at each level, the exact
pairs that run backward, the competing readings with the decision each would produce, and the evidence that would settle it. It reads only; it
decides nothing and writes nothing.

### The development queue, de-duplicated (048)

`v_dodgers_development_research_queue` raises one row per detector, and several detectors fire on the same missing evidence (an undated log-era
stint raises `MISSING_FIRST_GAME_DATE`, `MISSING_LAST_GAME_DATE` and `GAME_LOG_UNAVAILABLE`, and the same absence keeps level debuts at season
precision). `developmentNeeds` merges them into one need per player and evidence gap: `SOURCE_CONFLICT`, `SEQUENCE_REVIEW`, `SEASON_COVERAGE`,
`LEVEL_CLASSIFICATION`, `ORGANIZATION`, `GAME_DATES`. Nothing is deleted: each need lists the detectors it merges, the raw detector count is kept
beside it, an unrecognised detector is its own need, and the order is deterministic. The player-level queue (the seven tiers above) is unchanged.

### Descriptive timing (never a model)

`--timing` reports signing-to-MLB intervals where both dates are exact (45 of 47 verified MLB players after 048; 16 before) and the highest
level reached among **audited** non-MLB players (44 of 46). `NOT_AUDITED` players are never counted as negative outcomes, and nothing is
compared across cohorts or turned into a rate or score. Everything states its denominator. Because an established professional's interval is
acquisition to debut, not development from an amateur signing, the two routes are described separately (amateur signings 38 of 39,
established professionals 7 of 8) and never compared. The interval is never inferred from a signing year or a debut season: two players
(Amorós, Díaz) have no recorded signing date, so theirs is not calculable.

### Source policy for development and transactions

1. official league or club transaction records; 2. authoritative structured baseball records (the MLB Stats API; Retrosheet's transaction
database); 3. high-quality historical references; 4. reputable news reporting; 5. SABR and research biographies; 6. archive material;
7. aggregators only when clearly marked. Authority is not truth: a disagreement is kept as two reports. A URL alone is not evidence: each
record names the specific fact the source supports (047 stores the exact Retrosheet row). Retrosheet has no tier of its own in
`source_tiers`; it is registered as `OTHER` (the lowest) with its authority stated in the source notes, rather than borrowing a higher tier.

### Automation safety

Automation may discover, retrieve, parse, propose candidate events, detect discrepancies and queue work. A canonical write is a reviewed,
provenance-backed migration: an identity is matched on name **and** birth date, never on a name; a total is classified only after the
migration proves it; an ambiguous level sequence becomes a `PENDING_REVIEW` decision, never a self-asserted review. A language model does
not write dates, transaction types, affiliate levels, trade participants, bWAR or attribution.

### What 047 recorded

- Five downstream exits (four free-agency grants, one release) from Retrosheet, each closing a real control interval; the assets the source
  does not cover stay unresolved, and a found-but-unvaluable exit (Bob Miller, 1967) is documented, not recorded.
- Ten verified MLB players' whole recorded careers (255 stints, 41 first-appearance milestones). Seasons the API does not return stay
  unknown; level debuts after the MLB debut season (rehab or demotion appearances) are not milestones.
- Fourteen team-less aggregate rows classified as season totals, each proven equal to its component team stints.

### What 048 recorded

- The whole recorded careers of the remaining verified MLB players: 35 with new rows (776 stints, 200 first-appearance milestones, 50 proven
  season totals); Cedeño and Frías were already on record from Migration 021 and are unchanged. The verified MLB cohort's pre-MLB history went
  from 10 to 42 of 47; a verified first professional season from 3 to 19 (under the pathway rule); signing-to-MLB with both exact dates from 16
  to 45. Of the 47 paths, 44 are partial and 3 show no gap at season precision; none is "complete".
- Fifteen pending progression reviews for six players (Kuo, Santana, Urías, Cruz, Abreu and Díaz); Jansen's two stay pending, and none is decided.
- Not done on purpose: a player's final release or retirement transaction is a milestone that names no organization and is never read as a
  Dodgers exit; organizations are not re-resolved (the 021 affiliation table is unchanged); game-log dates are not retrieved; minor-league
  years the API does not hold (the 1950s, most pre-1990 rookie leagues) stay unknown.

### What 049 recorded

- **The 2009 Tony Abreu trade, corrected forward** (official MLB log + Retrosheet 64131): Arizona sent Jon Garland to the Dodgers on 2009-08-31 for
  a player to be named later; Abreu was named and delivered 2009-10-09; Garland elected free agency 2009-11-05. Garland's Dodgers bWAR is not
  loaded, so the return is `RETURN_WAR_UNKNOWN` (`NULL`); Abreu stays the only outgoing asset, so the trade becomes individually attributable the
  day Garland's Baseball-Reference WAR is loaded. Before 049 the unrecorded return read as a 0.00 individually attributable amount; it is now `NULL`.
- **The 1967 Dodgers-Twins trade** that ended Bob Miller's Dodgers career (Retrosheet 60573, read independently in the SABR biographies of
  Versalles, Grant and Perranoski): Miller, Roseboro and Perranoski for Mudcat Grant and Zoilo Versalles, and Grant's and Versalles's 1968
  expansion-draft exits. Chico Fernández's chain is recorded to its end; Grant's and Versalles's value is unknown, not zero. The sources disagree
  on one day (November 27 or 28); the disagreement is in the record.
- **Four MLB ids** for assets recorded by name only (Apostol Garcia, Rick Roberts, Danny Muegge, William Juárez), each reconciled by affiliations
  bracketing the trade. **No exit was recorded** for any of them, for Gail Harris or for Robinson Checo: no readable source states one, and a
  disappearance is not a release.
- **Left open on purpose:** the Offerman return (an unnamed conditional deal), the Frías player-to-be-named-or-cash (neither club's log records a
  delivery), the Jeral Pérez player-to-be-named-or-cash, three future-consideration packages and every cash and pool-space amount.
- **Effect:** seven incomplete chains read as five whose transaction history is open and two whose history is recorded and whose value is unknown;
  open packages 21 to 20; the queues keep 59 and 91 items; no audit, cost, threshold, probability, expected value or recommendation moved. One published
  figure moves: while Abreu's return was unrecorded it read as a `0.00` return, so his organizational value counted as resolved; now that the return is recorded
  and its WAR is unknown, his organizational value is `VALUE_UNRESOLVED` and the realized totals drop by his 1.23 direct bWAR (298.83 to 297.60; resolved
  signings 88 to 87). That is the existing `RETURN_WAR_UNKNOWN` rule working, not a loss of value.

## International benchmark (035, 050)

```
RANKING APPEARANCE != NEW SIGNING     RANKING CLASS YEAR != SIGNING YEAR     SOURCE LIST MEMBERSHIP != VERIFIED SIGNING
RANKED PROSPECT SAMPLE != LEAGUE CENSUS     BENCHMARK SUPPORT != DODGERS SUPPORT     MLB REACH != POSITIVE BWAR
```

The benchmark is a rank-selected sample: the players MLB Pipeline ranked in its international Top 30 lists (2013-2016) who have a verified
non-Dodgers signing. It is not every international signing, not an organization's population and not a Dodgers comparison denominator, and no
figure from it is a rate of international signings. Allowed framing: "Among this MLB Pipeline Top-30 benchmark sample (2015 list, 27 signings) ...".

- **Membership.** A listed player becomes a benchmark signing only when the official MLB transaction log shows his signing inside the class
  window and his identity is resolved by more than his name (section "Recording player identity" in `INGESTION.md`). A listed player the Dodgers
  signed stays his one Dodgers signing (never a second, benchmark copy). An unresolved member is queued, never added and never a non-reacher; the
  population's `stated_composition` records every member's decision.
- **Signing year.** The year of the official signing, not the list's class year: a 2016-list player signed in 2017 has `signing_year` 2017, and
  the 041 horizons use it (`signing_year + horizon <= last complete season`).
- **Route.** A Cuban signee with prior professional play (Cuban National Series, or a professional season in the official record before the
  signing year) is a professional route and never trains an amateur estimate; a route no readable source states is not guessed, and the signing
  is not added.
- **Outcome.** The 035 conventions at the unchanged analysis boundary (2026-10-05). No MLB debut found is not a career end; a reacher without
  loaded Baseball-Reference team-season WAR has no bWAR label (NULL, never zero).
- **Rankings.** Each listed benchmark signing carries its point-in-time MLB Pipeline rank as a 026 evaluation (`INTERNATIONAL_CLASS`, list size
  30), dated by the feed it was read from. A ranking published after the signing gives no signing-time expectation feature.

### What 050 recorded

- The 2015 list (pre-signing, 2015-05-11) and the 2016 list (signing period, 2017-05-27) from the archived official MLB Pipeline feed: 27 + 27
  verified non-Dodgers benchmark signings; Starling Heredia and Ronny Brito (2015) stay Dodgers records; Christopher Martinez (2015) is
  unresolved; three Cuban signees of the 2016 list (Armenteros, Yanio Pérez, Machado) have no readable route and are not added.
- Nine professional-route Cuban signings (2016 list) are benchmark rows but out of every amateur training row; Jorge Oña is `CUBAN_AMATEUR`.
- Of the five 035 gaps: Emmanuel DeJesus and Micker Zapata resolved, Yeyson Yrizarry a conflict (birth country), Yeremy Rosario and Jonathan
  Amundaray without an official record.
- Reach within 7 seasons is now supported in the benchmark sample (90 labelled, 19 positive, 71 negative; baseline 0.211, 90% 0.149-0.290). The
  bWAR targets gained labels but no positives. No Dodgers target moved.

## Prediction readiness and blockers

The product publishes an estimate only when its evidence meets a documented threshold, and it states exactly what is missing.

**Benchmark support is not Dodgers support (050).** Player probabilities are made only for the Dodgers tracked / opening-class population, so a
supported probability target is a target supported in that population. A baseline supported only in the benchmark sample is reported as a
benchmark reference result (`BENCHMARK_REFERENCE_BASELINE_SUPPORTED`), never as a supported Dodgers target, never pooled, and never borrowed as a
Dodgers base rate, prior or transfer. The executive overview, the snapshot refresh check, the verifier and `readiness-blockers.js` all count it this
way; before 050 the overview counted a target supported in any population, which was harmless only because none was.
`lib/research/readiness-blockers.js` derives the statements from persisted snapshot rows only (`product_database_status`,
`product_executive_snapshot`, `product_prediction_readiness`, `product_expected_value_support`, `product_portfolio_decision_support`,
`product_player_decision`). The same function feeds `/prediction-readiness` and `npm run research:readiness`.

| Layer | Supported when | Blockers it can report |
|---|---|---|
| Organization outcome rates | at least one population is rate-eligible (018: complete, fully audited, mature, a full signing period) | population size unknown or incomplete; scope is not a full signing period; `N of M` signings `NOT_AUDITED`; mature signings `NOT_AUDITED`; unresolved class-membership conflicts; expected class signees missing |
| Player outcome probabilities | a target meets its 041 minimums (labelled, positives, negatives) in the Dodgers tracked / opening-class population; a benchmark-only baseline is reported as a fact and never supports this layer | Dodgers labelled / positive / negative outcomes still needed; reference players `NOT_AUDITED` |
| Acquisition economics | **no threshold is defined**: shown as measured facts | signings with unknown cost; signings `NOT_AUDITED`; only signings with complete cost are eligible for cost-aware ratios |
| Expected value | a supported probability and enough mature value observations | the probability is not supported; observations needed |
| Recommendations | a supported expected value | no supported expected value; no optimization-eligible candidate |

A count such as `48 of 220 signings have a known acquisition cost` is a fact. It is shown as passing or failing only where the methodology
defines a threshold, and more audits or more costs never publish a rate by themselves: rate support comes only from rate-eligible
populations.

## Commands (all read-only)

They connect as the public `anon` role in a read-only session (or read a saved dataset), so they can only see what the website can see.

```
npm run research:queue          open queues by category, with what each blocks
npm run research:outcomes       the audit cohort            -- --mature --status not_audited [--year --market --limit --format csv|json]
npm run research:costs          the cost queue              -- --missing [--mature --mlb yes|no --year --market --limit]
npm run research:transactions   transaction / value items   -- --missing | --traded | --unresolved-attribution | --chains [--value-blocked] | --packages [--membership|--terms] | --ptbnl | --future-consideration | --cash-unknown | --value-blocked | --bucket CHAIN_OR_MEMBERSHIP|TERMS|VALUE|OTHER
npm run research:development    development research queue  -- --missing [--mature --mlb yes|no --year --market --player --limit] | --coverage | --timing
npm run research:readiness      blockers for every layer, plus the development / transaction evidence gaps (reported, not gates)
npm run research:progress       against database/research/046/baseline.json
```

`DISI_RESEARCH_DB_URL` (or `DISI_VERIFY_DB_URL`) names the database; `--input dataset.json` reads a dataset saved with `--save`. Output has
no timestamps, so the same data always prints the same bytes.
