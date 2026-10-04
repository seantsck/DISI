# DISI Dashboard

Dodgers International Signing Intelligence is a public-data decision-support prototype for international signing capital, talent identification, development, asset disposition, trade return, and competitive context.

## Product routes

- `/` — executive overview
- `/signings` — tracked signing ledger
- `/markets` — country-market and acquisition-pathway composition
- `/league` — cross-organization international signing benchmark
- `/development` — observed signing-to-MLB timing where dates are supported
- `/asset-conversion` — package-aware trade and release cases with competitive context
- `/methodology` — analytical guardrails and database provenance

## Live Supabase views

The application reads the following views when Supabase is configured:

- `v_dodgers_portfolio_signals`
- `v_dodgers_executive_dashboard_feed`
- `v_dodgers_executive_findings_v2`
- `v_dodgers_signing_cohort`
- `v_dodgers_market_summary`
- `v_dodgers_pathway_summary`
- `v_dodgers_competitive_asset_conversion`

There is **no fallback/mock dataset** in v0.4. If Supabase environment variables are missing, a view is absent, or a query fails, the UI displays a data-unavailable state and does not substitute hard-coded baseball records.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase Project URL and **publishable key**.
3. Run `npm install`.
4. Run `npm run dev`.
5. Add the same environment variables in Vercel for production.

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Never put a Supabase secret key or legacy service-role key in a `NEXT_PUBLIC_` variable.

## Database lineage

The complete SQL history is preserved under `database/`.

- `database/sql/` contains the canonical 001–013 build sequence.
- `database/repairs/` contains the 004a–004c troubleshooting scripts used during the initial manual Supabase build.
- `database/README.md` explains the purpose and execution order of every layer.

These files were originally executed manually in Supabase SQL Editor. They are retained as analytical provenance and should not be treated as Supabase CLI migration history without first creating a clean baseline.


## v0.4 data expansion

- `012_historical_census_framework.sql` extends the tracked Dodgers history back to 1951 with verified public records and adds explicit census/coverage metadata.
- `013_league_benchmark_seed.sql` begins the all-MLB comparison layer with signed players from MLB Pipeline's 2013 and 2014 Top 30 international prospect trackers.
- Historical and league benchmark rows are deliberately labeled by scope. A historical verified set or Top 30 tracker is never described as a complete census.

### Historical cost semantics

Historical acquisition costs distinguish signing bonuses, posting fees, and transfer/acquisition fees. Unknown components remain `NULL`. Historical MLB outcomes are also marked as audited vs. not-yet-audited so an unresearched old signing is never displayed as a verified failure.

## v0.5 portfolio-universe architecture

The homepage is no longer driven primarily by the four audited MLB-reaching case studies. It now leads with `v_dodgers_universe_summary` and signing-class coverage across the entire reconstructed Dodgers international acquisition universe.

`014_portfolio_universe_and_source_pipeline.sql`:
- adds a public-source registry,
- adds organization-period signing/pool summaries,
- reconstructs missing Dodgers classes and notable signings,
- adds Andy Pages, Miguel Vargas, Jorbit Vivas, Eddys Leonard, Keibert Ruiz and many additional class members,
- records complete vs partial class coverage,
- provides portfolio-wide views that do not treat unaudited players as failures.


## v0.7 outcome expansion and rate guardrail

`016_historical_positive_outcomes_and_rate_guardrail.sql` adds 39 sourced MLB-reaching outcomes across the franchise's international history and introduces franchise identity so Brooklyn and Los Angeles Dodgers debuts are both treated as direct Dodgers-franchise outcomes.

The application no longer presents an MLB reach percentage merely because individual players have been audited. A class becomes rate-eligible only if its signing population is explicitly complete, every tracked player in that class has an outcome audit, and the class is at least five years old.
