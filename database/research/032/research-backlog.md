# Migration 032: research backlog

## Deliberately out of 032

- **Downstream chains beyond one hop.** A return asset that later left in a recorded transaction raises `DOWNSTREAM_ASSET_CHAIN_INCOMPLETE`; no descendant value is attributed. Machado, Fields and Watson all have later non-Dodgers seasons, but no recorded exit transaction for any of them exists in DISI (Machado left as a free agent).
- **Weighted package attribution.** Shared packages stay package-level. A sourced weight table would need an explicit, reviewed basis; equal splits and prospect-value weights were rejected.
- **fWAR.** No FanGraphs WAR row was loaded; the two systems stay separate. The MLB Stats API `sabermetrics.war` field is a third system and was not used.
- **Dollar valuation, surplus value, arbitration or free-agent pricing, scouting accuracy, development causality, network value.** Not built.
- **A true "after the first Dodgers exit" measure.** `non_dodgers_mlb_bwar` is the canonical name; a temporal post-exit value can be added if it proves useful.

## Data work this surfaces

- **Trade records.** Five verified MLB players first appeared for another organization with no recorded exit transaction: Carlos Santana, Juan Guzman, Roberto Clemente, Jorbit Vivas, Eddys Leonard (`TRADE_RECORD_MISSING`). Each needs a sourced transaction.
- **Trade events.** Only three trades are modeled with assets (Alvarez, Cruz, Diaz); the Lantigua trade has no incoming player and no event.
- **Outcomes.** Seven mature signings were never audited and one has an unknown status (`OUTCOME_INCOMPLETE`).
- **Acquisition cost.** 33 verified MLB-reached signings have a PARTIAL, UNKNOWN or NO_RULE cost and therefore no cost-aware ratio.
- **Acquisition-boundary timing.** Return value starts at the specific acquisition. A same-season Dodgers stint is placed only through the counterparty's single stint (B-Ref stint order is chronological); anything else is `TRADE_RETURN_TIMING_UNRESOLVED` and the return stays NULL. Game-log or transaction-date chronology would resolve such a case. None exists today (the three modeled assets are all resolved with no pre-acquisition Dodgers stint).
- **Rate eligibility.** No signing period is rate-eligible, so every portfolio figure is a tracked / verified-set analytic, not an organization-wide rate.
- **Legacy stores.** `outcomes.career_war` and the `CAREER_BWAR` observations now agree for all 47 players; only one of the two should remain the long-term canonical store (a later decision).
