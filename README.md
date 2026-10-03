# DISI v0.1

Dodgers International Signing Intelligence — database foundation.

## What this migration creates

- Players and aliases
- MLB organizations
- International signing transactions
- Signing-market/regime context
- Trainer/academy relationships
- Scouting evaluations and FV/20–80 grades
- Seasonal performance records
- Development milestones
- MLB outcomes
- Market snapshots
- League translation factors
- Model predictions
- Signing-pool portfolio scenarios
- Field/entity-level provenance via Sources + Evidence
- Public-read/private-write RLS baseline
- Two analytical views

## Important modeling rules

1. Unknown values stay NULL. A missing signing bonus is never treated as zero.
2. Acquisition pathway is explicit so a 16-year-old Dominican amateur is not modeled as equivalent to an established NPB/KBO professional.
3. Observed facts and model predictions are stored separately.
4. Every important externally sourced value can be linked to evidence and a confidence level.
5. Signing-regime context is stored by club/year because MLB rules and penalties change the economics of comparisons.

## Install

Open the DISI Supabase project:

SQL Editor -> New query -> paste `001_disi_core_schema.sql` -> Run.

Then run the three verification queries at the bottom of the file.

## Included migrations

### 001_disi_core_schema.sql
Creates the normalized database, provenance layer, signing-regime context, scouting/performance/development tables, transaction layer, model-output tables, RLS, and analytical views.

### 002_dodgers_seed_cohort.sql
Loads an initial Dodgers-specific research cohort spanning 2015–2026, including:
- verified/reported signing bonuses
- international signing environments
- source records and evidence
- acquisition pathways
- NPB context for Roki Sasaki
- trainer relationships for Emil Morales, Ezequiel Melburne and Rubel Arias
- an example transaction record for Arnaldo Lantigua

Run 001 first, then 002.

## Next analytical migration

`003_observed_outcomes_and_development.sql`

This will add mature outcomes and development milestones, then support the first real DISI analyses:
- MLB reach rate
- development velocity
- bonus efficiency
- organizational value vs. player career value
- signing-regime comparisons
