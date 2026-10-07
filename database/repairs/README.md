# Repair history

Troubleshooting used during the Supabase builds. These are preserved for
provenance but are **not** part of the clean canonical build sequence
(`database/manifest.json`). The `004a`–`004c` SQL files document issues from
the first manual Supabase build.

## 2026-10-06 — 003-era legacy MLB_DEBUT milestones backfilled (one-time live drift repair)

**Context.** The original remote Supabase database was historically seeded
from an incomplete early `002_dodgers_seed_cohort.sql` state (the manifest
records the uploaded 002 as an incomplete 32-line fragment; the repository
keeps the full corrected canonical file). Because the five players named in
migration 003's legacy MLB_DEBUT milestone insert did not all exist in that
live environment at the time, the insert matched zero rows there. Clean
canonical 001→021 builds correctly contain the five legacy `development_milestones`
rows; the live database had none.

**How it surfaced.** Migration 021 tags the legacy 003 rows in place
(`evidence_basis = 'LEGACY_OUTCOME_AUDIT'`) and adds the researched pipeline
rows. The clean canonical chain therefore holds 666 coded milestones, while
the live database initially produced 661 — the five legacy rows were missing
and so could not be tagged.

**The five canonical players** (from 003's named insert):
Yordan Alvarez, Oneil Cruz, Yusniel Díaz, Roki Sasaki, Josue De Paula.

**Resolution note.** The historical literal-name predicate (`'Yusniel Diaz'`)
no longer matches the live row because migration 020 normalized the stored
name to `Yusniel Díaz` (accent-only change). The live repair therefore
resolved the five players by **stable slug** (`yordan-alvarez`, `oneil-cruz`,
`yusniel-diaz`, `roki-sasaki`, `josue-de-paula`) instead of mutable display
name, and otherwise reproduced the canonical 003 statement exactly: same
column semantics (`player_id`, `milestone = 'MLB_DEBUT'`,
`milestone_date = outcomes.mlb_debut_date`, canonical age formula,
`organization_id = outcomes.mlb_debut_organization_id`, `source_id`,
`confidence = 'VERIFIED'`) and the same
`on conflict (player_id, milestone, milestone_date) do update` behavior.

**Outcome.** `INSERT 5`; migration 021 was then rerun (it is idempotent) and
tagged all five rows. Live now matches the canonical 001→021 test state
exactly: 666 coded milestones, 5 legacy-tagged, 7 MLB_DEBUT rows across 7
players, 828 stints across 167 players, 212 development-status rows, and the
canonical `v_database_status` values (47 verified Dodgers MLB outcomes, 220
Dodgers players, 48 league-benchmark players).

**Scope.** This repair is historical provenance documentation. It is not a
schema migration, does not change migration 021's research data, and is not
part of `manifest.json`. No credentials, connection strings or one-off repair
scripts are preserved here.

**Detection.** `scripts/db/verify-live-invariants.mjs` now asserts the
canonical counts so this class of drift fails loudly instead of surfacing as a
milestone discrepancy during a future migration.
