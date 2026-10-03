# DISI Dashboard

Dodgers International Signing Intelligence executive dashboard prototype.

## What it reads

The live dashboard reads these Supabase views created in the DISI SQL sequence:

- `v_dodgers_portfolio_signals`
- `v_dodgers_executive_dashboard_feed`
- `v_dodgers_executive_findings_v2`

If Supabase environment variables are missing or the fetch fails, the app falls back to the verified sample values from the current 17-player mature tracked cohort. The UI clearly labels that mode as **Verified sample mode**.

## Setup

1. Copy `.env.example` to `.env.local`.
2. In Supabase, open **Connect** and copy your Project URL and **publishable key**.
3. Fill `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
4. Run `npm install` then `npm run dev`.
5. For production, add the same two environment variables to Vercel.

Do not put a Supabase secret key or service-role key in any `NEXT_PUBLIC_` variable.

## Data API note

DISI's views already use explicit `GRANT SELECT` statements. Current Supabase projects require explicit grants for new public-schema objects to be reachable through the Data API. RLS and grants are separate controls.

## Database lineage

The complete SQL history is preserved under `database/`.

- `database/sql/` contains the canonical 001–011 build sequence.
- `database/repairs/` contains the 004a–004c troubleshooting scripts used during the initial manual Supabase build.
- `database/README.md` explains the purpose and execution order of every layer.

The uploaded `002_dodgers_seed_cohort(1).sql` was an incomplete fragment, so the repository uses the full corrected canonical `002_dodgers_seed_cohort.sql` from the DISI build instead.
