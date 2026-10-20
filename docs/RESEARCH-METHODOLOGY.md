# DISI research methodology

How DISI decides what is known, what is not, and what may be published. This file consolidates rules that were introduced across
Migrations 017-046; each section names the object that enforces it. The ingestion workflow (what to record for a new class, player or
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
- **Chain status** (`product_player_decision.chain_status`): `NO_TRADE_CHAIN`, `STILL_ACTIVE`, `COMPLETE_TERMINAL`, and four incomplete
  states (`INCOMPLETE_EXIT_NOT_RESEARCHED`, `INCOMPLETE_EXIT_UNRECORDED`, `INCOMPLETE_PENDING_CONSIDERATION`, `INCOMPLETE_RETURN_UNRECORDED`).
- `npm run research:transactions -- --missing | --traded | --unresolved-attribution | --chains` lists the open work in a fixed order
  (queue priority, then the documented issue rank, then player and event).

A transaction chain is completed by recording the exit event, its assets with stable identities and the return's team-season bWAR under the
033 audit; it is not completed by inferring from an MLB transaction text alone.

## Development-history readiness (audit, no new structure)

046 checked whether the current model supports the next phase. It does, with no schema addition:

| Need | Where it lives |
|---|---|
| signing date | `signings.signing_date` (197 of 220; the 23 without are queued as `SIGNING_DATE_MISSING`) |
| birth date and age at signing | `players.birth_date`; `v_player_directory.age_at_signing` (197 of 220) |
| affiliate history | `player_season_stints` (one row per player / team / league / level / season) |
| level progression | `development_levels`, `development_level_era_map`, `development_milestones` (exact dates where a dated record exists) |
| MLB debut | `outcomes` / `players.mlb_debut_date` (47 verified debuts) |
| time to MLB | `v_signing_records.years_signing_to_mlb`, and exact elapsed days between milestone endpoints |
| development duration | derived metrics that need both endpoint dates; season-based approximations are labelled separately |

The gap is coverage (`v_dodgers_development_coverage`: 167 of 268 players have stints; the development research queue holds 111 items), not
structure. That is research work for a later phase.

## Prediction readiness and blockers

The product publishes an estimate only when its evidence meets a documented threshold, and it states exactly what is missing.
`lib/research/readiness-blockers.js` derives the statements from persisted snapshot rows only (`product_database_status`,
`product_executive_snapshot`, `product_prediction_readiness`, `product_expected_value_support`, `product_portfolio_decision_support`,
`product_player_decision`). The same function feeds `/prediction-readiness` and `npm run research:readiness`.

| Layer | Supported when | Blockers it can report |
|---|---|---|
| Organization outcome rates | at least one population is rate-eligible (018: complete, fully audited, mature, a full signing period) | population size unknown or incomplete; scope is not a full signing period; `N of M` signings `NOT_AUDITED`; mature signings `NOT_AUDITED`; unresolved class-membership conflicts; expected class signees missing |
| Player outcome probabilities | a target / reference population meets its 041 minimums (labelled, positives, negatives) | labelled / positive / negative outcomes still needed; reference players `NOT_AUDITED` |
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
npm run research:transactions   transaction / value items   -- --missing | --traded | --unresolved-attribution | --chains
npm run research:readiness      blockers for every layer
npm run research:progress       against database/research/046/baseline.json
```

`DISI_RESEARCH_DB_URL` (or `DISI_VERIFY_DB_URL`) names the database; `--input dataset.json` reads a dataset saved with `--save`. Output has
no timestamps, so the same data always prints the same bytes.
