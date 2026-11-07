# 062 amendment: owner-observed current career bWAR (2026-11-06)

## What changed after the audit

- **The audit, unchanged** (`audit.mjs`, `audit.json`, `audit-report.md`, `source-capture.json`). It could not retrieve complete, current
  Baseball-Reference data independently:
  - the live site answers HTTP 403;
  - the newest archived captures are the batting file of 2026-09-11 (mid-season) and the pitching file of 2026-02-10.

  It found 0 writable players under the 017 rule, 12 with complete careers in the captures and 27 who played in MLB in 2026.
- **The owner input.** The owner then read the current career WAR on each of the 39 players' Baseball-Reference pages and supplied the values
  (`owner-input.json`, 2026-11-06).
  - The values supersede the archived partial-season values for the purposes of 062.
  - They are **owner-observed**. Neither DISI nor any automated process read those pages, and no source row, observation or note claims
    otherwise. The confidence is `UNVERIFIED`, the 060 convention for owner input.
- **No archive rule.** The archived-copy provider-rule plan (a narrow change to the 017 rule, built but never committed) is withdrawn:
  - The owner's values cite the canonical current player page, `https://www.baseball-reference.com/players/<l>/<bref_id>.shtml`, which the 017
    rule already accepts.
  - 062 is data only. There is no schema or provider change, and no Wayback URL is cited.
- **Identity still holds.** The audit's identity verification is reused: MLBAM id, birth date and MLB debut match the MLB Stats API, and each
  bref_id ↔ MLBAM pair matches both Baseball-Reference WAR files. No identity is written.
  - The external spelling "Enmanuel De Jesus" is noted, and the DISI name is not changed.
  - Máximo Acosta's bref_id is `acostma02`.

## Seven rows held, not written

- **The conflict.** Eleven of the 39 already have team-season rows that 057 loaded through 2025, and `outcomes.career_war` equals those sums.
  The verifier's `value_career_reconciliation_violations` requires a player's latest `CAREER_BWAR` to stay within 0.1 of both.
- **Who is held.** For seven of them the current career value includes 2026 and differs by more:

  | Player | Owner value | Through-2025 ledger | Difference |
  |---|---:|---:|---:|
  | Juan Soto | 45.6 | 42.57 | 3.03 |
  | Fernando Tatis Jr. | 31.7 | 27.34 | 4.36 |
  | Vladimir Guerrero Jr. | 26.9 | 25.73 | 1.17 |
  | Andrés Giménez | 20.5 | 19.37 | 1.13 |
  | Miguel Amaya | 4.7 | 3.35 | 1.35 |
  | Rafael Marchán | 0.7 | 1.41 | 0.71 |
  | Enmanuel De Jesus | 0.0 | −0.18 | 0.18 |

  De Jesus's 0.0 is not the reason: it is a valid value, held only because of the ledger.
- **Why not write them.** Writing them would fail the verifier and leave two career stores disagreeing. They stay NULL and keep `BWAR_MISSING`.
- **What would close them** (an owner decision):
  - load their 2026 team-season rows from a readable source;
  - or change how the reconciliation check treats a ledger that ends before the career does.
- **Written within tolerance.** The other four 057-loaded players are within 0.1 and are written: Pache, Taveras, Celestino and Muzziotti.

## Corrections recorded

- **057 note.** Gilberto Celestino and Símon Muzziotti did not play in MLB in 2026. 057's note says all eleven of its players did; the frozen
  notes are not edited.
- **Celestino's value.** The owner value (0.3) differs from the 2026-09-11 capture value (0.2), which is consistent with a later
  Baseball-Reference revision. The other eleven complete-career values match the captures.
