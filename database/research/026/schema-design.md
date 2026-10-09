# Migration 026 schema design

An evaluation is **an opinion held at a point in time**: an observation with a source, never ground truth. It is kept
apart from performance, development progression, MLB outcomes and DISI's own predictions
(`public.model_predictions`), and it is never overwritten. There is no mutable "current FV" or "current rank".

## Tables (six new; the empty legacy `public.evaluations` is dropped behind guards)

| Table | Purpose |
| --- | --- |
| `evaluation_scales` | Scales for scouting grades (`SCOUTING_20_80`: 20-80 step 5, qualifiers allowed). Numeric or ordinal. |
| `scouting_publications` | The evaluative *product* (a list or tracker series), with `origin` (EXTERNAL / TEAM_PUBLIC / DISI_RESEARCH), access class, `bulk_ingest_allowed` and the existing `source_tiers` tier. Citations stay in `sources`. |
| `player_evaluations` | The snapshot header: player × publication × as-of date, context, ETA, role, provenance, `record_status`. |
| `player_evaluation_grades` | One row per graded dimension: FV, tools, pitches, risk. |
| `player_evaluation_rankings` | A rank with its mandatory scope and list label. |
| `player_evaluation_notes` | Short analyst paraphrases (<= 500 characters); never publisher text. |

## Context, not type

`evaluation_context` is the *occasion* (PRE_SIGNING, SIGNING, ORG_LIST, GLOBAL_LIST, INTERNATIONAL_CLASS_LIST, IN_SEASON_REPORT,
TRADE_COVERAGE, MLB_READY, OTHER). ORG_LIST = organization prospect list; GLOBAL_LIST = MLB-wide prospect list;
INTERNATIONAL_CLASS_LIST = international amateur / free-agent class list; PRE_SIGNING = pre-signing context established by dates. What was measured is whatever child rows exist (grades, rankings, notes, ETA, role). A profile with a
rank, an FV, tool grades and an ETA is one snapshot. PRE_SIGNING / SIGNING are used only where dates support them.

## Grades

`dimension_code` (OVERALL, HIT, POWER, GAME_POWER, RAW_POWER, RUN, FIELD, ARM, FASTBALL, CURVEBALL, SLIDER, CHANGEUP,
SPLITTER, CUTTER, OTHER_PITCH, COMMAND, CONTROL, RISK, OTHER) × `temporal_basis` (PRESENT / FUTURE / UNSPECIFIED) ×
`source_label` (the source's own name, kept verbatim). **FV is `OVERALL` with temporal basis `FUTURE`.**

A source grade is stored three ways at once: `raw_label` (as printed, `45+`), `raw_value` (the numeric base, `45`) and
`qualifier` (`NONE` / `PLUS` / `MINUS`). A trigger validates the value against its scale (range, step), that the label
and base agree, that the qualifier matches the label's suffix, and that the scale allows qualifiers. `45+`, `45` and
`45-` are three different observations. A source that gives a single value (FanGraphs' *Throw*) uses `UNSPECIFIED`.
Any normalised number is derived in a view and must say whether it uses the numeric base only; nothing normalised is stored.

## Rankings

`rank` ≥ 1, `ranking_scope` (ORGANIZATION, MLB_GLOBAL, INTERNATIONAL_CLASS, LEAGUE, POSITION, ROOKIE_CLASS, OTHER) and a
non-blank `scope_label` are required. `organization_id` is required for ORGANIZATION scope and forbidden otherwise.
`list_size` (when stated) must be at least the rank. Absence from a list is never stored as "rank > N".

## Dates

`date_precision` ∈ DAY, MONTH, YEAR, SEASON, UNKNOWN (a text CHECK, not the old two-value enum). Only DAY carries
`evaluation_date`; MONTH has year + month; YEAR and SEASON have a year; UNKNOWN has nothing. `evaluation_date` is the date the
evaluation was published or reported. Views compute exact day-based values only from DAY precision.

## Snapshot identity

Among ACTIVE evaluations, unique on `(player_id, publication_id, evaluation_context, date_precision,
coalesce(evaluation_date), coalesce(evaluation_year), coalesce(evaluation_month), coalesce(source_id::text,
'ref:' || lower(btrim(source_reference))))`. Two different undated reports from different sources coexist; re-ingesting
the same record is rejected (seeds use `ON CONFLICT DO NOTHING`). A SUPERSEDED row frees the key for its correction.

## Snapshot lifecycle: DRAFT, ACTIVE, SUPERSEDED

`record_status` is `DRAFT` (default), `ACTIVE` or `SUPERSEDED`.

- **DRAFT**: the header and its grades, rankings and notes can be inserted, updated and deleted. Nothing reads a DRAFT: every
  view filters `record_status = 'ACTIVE'`. A DRAFT can be deleted.
- **ACTIVE** (activation = `UPDATE ... SET record_status = 'ACTIVE'`): sealed. `disi_evaluation_guard` rejects any header change
  other than ACTIVE -> SUPERSEDED, and `disi_evaluation_child_immutable` rejects every insert, update and delete of a grade,
  ranking or note whose evaluation is not a DRAFT (including moving a child between evaluations). An ACTIVE or SUPERSEDED header
  cannot be deleted. `player_evaluations.player_id` is `ON DELETE RESTRICT`: a player with any evaluation cannot be deleted (a DRAFT must be deleted explicitly first; its children cascade). The foreign key is the contract; the sealing trigger is only a second line of defence.
- **SUPERSEDED**: sealed and retired; it appears in no analytical view.
- A new evaluation must start as DRAFT, so a sealed snapshot is always complete when it becomes visible.

Correction: (1) insert a DRAFT with `supersedes_evaluation_id`; (2) populate its children; (3) activate it. Activation
retires an ACTIVE predecessor in the same statement; alternatively the predecessor may be marked SUPERSEDED first, which is
allowed only once a DRAFT or ACTIVE replacement exists. The predecessor's contents are never touched.

Supersession constraints: the predecessor must exist, differ from the row itself (check constraint), belong to the same
player and the same publication, and not be a DRAFT; a predecessor has at most one replacement ever (unique index on
`supersedes_evaluation_id`). Cycles are impossible: only a DRAFT can name a predecessor and only a sealed row can be named, so a
sealed row can never be edited to point at its own replacement. The verifier recomputes all of this from the data.

## Provenance

Every evaluation has a publication, a primary `source_id` (a `sources` row with URL, accessed time and tier) **or** a print
`source_reference`, an `evidence_basis`, a `confidence`, and `retrieved_at`. Extra citations use the existing `evidence`
table. `archive_url` records a verified snapshot. A live primary source is sufficient provenance, so a missing archive is *not* an issue by
itself. MISSING_ARCHIVE_REFERENCE is queued only when `archive_url` is null and the evidence is a `SECONDARY_CITATION` or
`preservation_concern` is set (`SOURCE_EDITED_AFTER_PUBLICATION`, `SOURCE_UNAVAILABLE`, `SOURCE_UNSTABLE`).

## External vs DISI

`origin` is a property of the publication, so a snapshot cannot disagree with its publisher. 026 seeds only EXTERNAL
evaluations. DISI_RESEARCH is allowed by the schema but unseeded and excluded from every 026 view. **DISI_MODEL does not
exist** here: model output stays in `model_predictions`.

## Views (all `security_invoker`, SELECT-only, ACTIVE + non-DISI_RESEARCH only)

`v_player_scouting_timeline`, `v_player_latest_external_evaluation` (latest per player *and publication*),
`v_dodgers_scouting_at_signing`, `v_scouting_source_coverage`, `v_scouting_research_queue`. Deferred until coverage supports
them: prospect re-valuation and expected-vs-realized.

## Legacy data

`public.evaluations` (migration 001) was empty, unreferenced and replaced; it is dropped only if it still has the 001 shape,
zero rows, no dependents and no inbound foreign keys. `signings.international_rank` is left unchanged for compatibility; its
48 provenance-backed values are mirrored as evaluations, and its 11 unsourced values are queued, not migrated.
