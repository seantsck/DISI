# Migration 031: design

## A report is not a decision

- `signing_financial_reports` (030): what a source said. Sealed; a new source adds a row; disagreeing independent reports coexist.
- `signing_financial_resolutions` (031): which ACTIVE report DISI currently accepts as canonical for one signing and component.

A decision does not rewrite, retract or reorder any report, and the disagreement stays visible. Absence of a decision means unresolved.

## `signing_financial_resolutions`

| Column | Meaning |
|---|---|
| `signing_id`, `component_type`, `selected_report_id` | what is decided; a composite FK ties the report to the same signing and component |
| `basis` | `AUTHORITATIVE_RULE` (requires `source_id`), `SOURCE_PRECEDENCE`, `OTHER_REVIEWED` |
| `rationale`, `reviewed_by`, `reviewed_at` | why, by whom, when |
| `record_status`, `supersedes_resolution_id`, retraction fields | the 030 lifecycle |

- **Guard trigger:**
  - the selected report must be ACTIVE, USD and not APPROXIMATE;
  - at least two ACTIVE reports with different amounts must compete;
  - sealed once recorded; never deleted;
  - a later decision supersedes and retires its predecessor;
  - one ACTIVE decision per signing and component.
- **Not for corrections.** An unsourced legacy value replaced by a directly read source is a supersession of the legacy report (Rincon), which needs no decision.
- **Behavior:**
  - A component with an ACTIVE decision is `RESOLVED` in `v_signing_acquisition_financials` (`resolved_components`), not `CONFLICT`.
  - The canonical column must equal the selected amount (the verifier checks both directions).
  - `FINANCIAL_REPORT_CONFLICT` leaves the queue.
  - If the selected report is later retracted, or the competition disappears, `financial_resolution_selection_violations` fails.
- **Signings only.** An environment-ledger decision is deferred until a real environment conflict exists.

## Lineage rules for provenance

| Case | Action |
|---|---|
| External report, same amount as the legacy value | add the external row; the legacy row stays ACTIVE (corroboration); FINANCIAL_SOURCE_MISSING clears |
| External report within a ROUNDED interval of the legacy value | same as above |
| External report, different amount, legacy has no source | supersede the legacy row (retired, reason recorded) and move the column |
| Two external reports disagree | seed neither unless a decision is recorded in the same migration (030 would otherwise force the column to NULL) |

## Period membership and links

An environment row's `signing_year` is the calendar year the period opened. A Dodgers signing is linked to an environment only when its `signing_date` lies inside that period's window (July 2 - June 15; 2020-21: January 15 - December 15, 2021). Undated signings are never linked. Pathway does not decide membership and `international_pool_treatment` is untouched: membership and treatment are separate facts.

## What 031 does not do

No pool charge, post-trade pool or pre-penalty base is stored without a printed figure. Seeded bases are only EXACT or ROUNDED. No new view or analytic is added.
