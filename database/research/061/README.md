# 061 transaction research closure

Migration 061 writes the reviewed transaction facts that the scope audit supported, and nothing else. It is **data only**: no table, view, function, enum, trigger, grant or policy, and no change to signings, bonuses, the financial ledger, outcomes, WAR, metrics, benchmarks or any prediction output. It is built and **not applied, not merged, not frozen**.

## What it writes

- Six existing CASH assets whose amount was NULL receive their reported amount: Gyorko (St. Louis) $2,938,710, Gonzalez-Kemp (Dodgers to Atlanta) $4,500,000, Betts / Price (Boston) $48,000,000, Puig-Kemp-Wood-Farmer (Dodgers to Cincinnati) $7,000,000, Margot guaranteed (Dodgers to Minnesota) $6,000,000, Martin / Brito (Toronto) $16,400,000.
- Three assets are added beside what is recorded: Lantigua pool space $1,500,000 (the Future Considerations placeholder stays); a Cingrani / Gyorko pool-space component whose amount stays NULL (no $250,000 is inferred); Margot's separate $2,000,000 CASH component (the part that depended on Minnesota declining the 2025 option, now triggered; owed, payable 2026-12-01, not stored as $8,000,000).
- Two Garland events: FREE_AGENT_SIGNING 2010-11-26 and FREE_AGENCY 2011-10-30 (the 2011 Dodgers control interval; his contract is not recorded).
- Twelve `sources` rows for the real pages that were read (with their actual retrieval times) and 17 `evidence` rows, one per fact and source.

Not written: Carlos Frias (HOLD, the named announcement could not be read), Jeral Perez (unresolved), Maximo Martinez, Jose Vizcaino, Casey Blake, the low-materiality residuals and every identity / route item.

## Files

| File | What it is |
|---|---|
| `research-evidence.json` | The only copy of the 061 values: sources, amount updates, added assets, events and evidence. |
| `baseline-build.json` | The measured pre-061 state on the canonical replay through 060 (`node database/research/061/measure.mjs --chain 060_owner_reviewed_acquisition_costs.sql --baseline`). |
| `061_template.sql`, `rollback_template.sql`, `build.mjs` | The migration, the rollback and their deterministic assembly. The build refuses any input the baseline does not allow (a non-NULL amount, an unsourced 250,000 pool amount, a pseudo-source, a missing source). |
| `measure.mjs` | The 060 measurement's headline numbers plus the transaction rows 061 touches, the Garland events and control intervals, the 061 sources and evidence, both queues and the fingerprints of every transaction row it must not move. |
| `report.mjs`, `before-after.json` | 061 applied to a replay: the queues by issue and the rows that left or entered, the headline numbers, the Garland intervals, and which fingerprints held. |
| `amendment.md`, `amendment.json` | The reviewed **post-audit evidence amendment**: what changed after the scope audit and why. |
| `source-capture-amendment.json` | What each page said, when it was read, how (directly or through an archive snapshot), and its SHA-256. The Frias page is listed as not readable. |
| `final-materiality.json` | Materiality of the final payload and of what is left unresolved. |

The scope audit (commit `60c6dc4`) is preserved unchanged: `owner-research-input.json`, `baseline.json`, `mapping.json`, `materiality.json`, `audit-report.md`.

## Commands

```
node database/research/061/build.mjs            # write the migration and the rollback
node database/research/061/build.mjs --check    # exit 1 unless both equal the build output
node database/research/061/report.mjs [--dump <post-060 PGlite tar>]
```

## Result (measured on the replay)

- Transaction queue **57 -> 51**: `CASH_AMOUNT_UNKNOWN` 17 -> 11, `DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION` 6 -> 5 (Garland), `POOL_SPACE_AMOUNT_UNKNOWN` 1 -> 2 (the Cingrani component is now known to exist and its amount is not stated).
- Value queue **79 -> 79**, rows identical. Known acquisition cost 81 / 139 and $127,632,237.33, CAREER_BWAR 58, BWAR_MISSING 39, outputs 0 / 0 / 0 / 0 / 0: unchanged.
- Garland: the 2009 interval is untouched; a second interval opens on 2010-11-26 and closes on 2011-10-30 (`CLOSED_EXIT_RECORDED`, not a trade-package lineage).
- No snapshot drift, so no refresh: generation unchanged, drift 0.

## Consequences

- While 061 is applied, `rollback-049` is unavailable (it refuses when a later transaction exists for Jon Garland). Roll 061 back first.
- `rollback-061` returns the six amounts to NULL, deletes the added assets, events and evidence, and **keeps the twelve source rows** as provenance (the 049 convention); a reapply finds them and does not duplicate them. No sealed row is written, so nothing is retracted.
