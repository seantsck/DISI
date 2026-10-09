# Migration 029 schema design

A relationship / evidence layer: **who the sources say a player trained with, developed at, signed out of, was showcased in or was represented by.**
It records associations, not causes. No WAR, bonus, rank or success is credited to a network entity, and nothing here is copied from the scouting,
development or outcome systems; the views join them.

## Tables

| Table | Purpose |
| --- | --- |
| `network_entities` | Canonical non-player identities. `entity_type` is WHAT it is: PERSON, ACADEMY, PROGRAM, SHOWCASE_LEAGUE, AGENCY, OTHER. The role (trained with, represented by ...) lives on the relationship, so one person can appear in several roles without duplicate identities. Clubs stay in `organizations`. |
| `network_entity_aliases` | Exact printed alternate names with provenance and a generated, search-only `lookup_key`. Insert-only. |
| `network_entity_relationships` | Dated relationships between entities: OPERATES, AFFILIATED_WITH, MEMBER_OF, SUCCEEDED_BY, MERGED_INTO. |
| `player_network_relationships` | Source-stated player-to-entity associations: TRAINED_WITH, DEVELOPED_AT, SIGNED_OUT_OF, SHOWCASED_IN, REPRESENTED_BY. |
| `network_entity_identity_reviews` | Candidate duplicate pairs (OPEN, DISTINCT, SAME_PENDING_MERGE), each pair once in fixed order. It never merges anything. |

## Names

`name_basis` is NAMED, DESCRIPTIVE or NICKNAME_ONLY and never invents a proper name. A DESCRIPTIVE entity ("Yasser Mendez's academy") points at the PERSON the
source used to describe it through `descriptor_anchor_entity_id`. The anchor means only "the source described this entity through this person"; it does not
imply operation, ownership or affiliation. An entity-to-entity relationship exists only when the source explicitly states one, so possessive wording alone seeds none.

## Identity is sealed

`entity_type`, `slug`, `canonical_name`, `name_basis`, the anchor and the creation provenance (source, basis, confidence, retrieval time) cannot change.
A new name is an alias. Geography, active years, website and notes stay editable. An entity with relationship history cannot be deleted, and aliases cannot be updated or deleted while their entity exists.

## Normaliser

`disi_network_lookup_key(text)` is IMMUTABLE, strict, SECURITY INVOKER, `search_path = ''`, with EXECUTE revoked from PUBLIC / anon / authenticated. It uses only
fixed `translate()` maps (supported accented Latin letters and A-Z to ascii lower case) and a fixed regex that turns every run of characters outside
`a-z0-9` into one space, then trims. There is no `lower()`, `initcap()`, collation or character-class range, so PostgreSQL and the PGlite replay agree. Characters
outside the map become separators. The key is for search only; no object joins on it. It is a generated column, so it can never drift from the alias.

## Relationship rules

- **Type compatibility** is enforced by trigger: TRAINED_WITH to PERSON; DEVELOPED_AT and SIGNED_OUT_OF to ACADEMY or PROGRAM; SHOWCASED_IN to SHOWCASE_LEAGUE; REPRESENTED_BY to PERSON or AGENCY;
  OPERATES and AFFILIATED_WITH from PERSON to ACADEMY or PROGRAM; MEMBER_OF from PERSON to PROGRAM; SUCCEEDED_BY and MERGED_INTO between the same entity type. Self-links are forbidden.
- **Stage** (PRE_SIGNING, AT_SIGNING, POST_SIGNING, UNKNOWN) is separate from the **period**. "Signed after training / playing ..." is PRE_SIGNING; "signed out of ..." is AT_SIGNING; a bare
  "trained with" or "also produced" is UNKNOWN. Article context alone never sets a stage.
- **Period** reuses 026's precision per side (DAY, MONTH, YEAR, SEASON, UNKNOWN): only DAY carries a date, no day 1 is invented, end never precedes start. Publication dates stay on the source.
- **Signing link.** `signing_id` is optional and set only where the source ties the fact to that acquisition. The composite foreign key `(signing_id, player_id)` to `signings(id, player_id)` (supported
  by the additive `UNIQUE (id, player_id)` on `signings`) guarantees it belongs to the same player.
- **Provenance.** Every entity, alias and relationship has a `sources` row, an evidence basis (TEAM_RELEASE, MLB_PIPELINE_PROFILE, PUBLISHED_INTERNATIONAL_REVIEW, PLAYER_PROFILE, TRAINER_OR_ACADEMY_PROFILE,
  INTERVIEW, SECONDARY_REPORT, MANUAL_RESEARCH, OTHER), a confidence and a retrieval time. Extra citations use `evidence`. Notes are at most 300 characters, paraphrase only.

## Lifecycle

ACTIVE or RETRACTED; no DRAFT stage. ACTIVE content is sealed, deletes are forbidden, and the only allowed change is retraction, which records `retracted_at` and a reason. A correction is a new
ACTIVE row naming `supersedes_relationship_id`; the predecessor is retired in the same statement. Player relationships need the same player and relationship type (the entity may differ, as an identity
correction, but must satisfy compatibility); entity relationships need the same type and a shared subject or object. A unique index allows one replacement per predecessor, a self-link is a check
violation, and a cycle is impossible because a sealed row can never be edited to point at its own replacement. RETRACTED rows are sealed.

## Views

`v_player_signing_network`, `v_network_entity_player_history`, `v_dodgers_network_coverage` and `v_network_research_queue`, all `security_invoker`, SELECT-only, ACTIVE rows only. The coverage view's
primary denominator is the 64 Dodgers LATAM_AMATEUR + CUBAN_AMATEUR signings with a reported bonus, an international rank or verified MLB reach; CUBAN_PRO is a separate segment, never blended in.
Deferred: leaderboards, WAR or bonus attribution, outcome analytics, causal comparisons.

## Legacy trainer layer

`trainers`, `player_trainers`, `v_player_trainers` and `v_dodgers_trainer_network` are dropped behind a guard: all four must exist, both tables empty (Migration 027), nothing else depending on them.
The dossier reads `v_player_signing_network` instead.
