# Migration 035 — League-wide international benchmarking: architecture report

Status: research + local implementation. Not committed, pushed, applied or merged. Public data only.

## 1. Benchmark inventory

DISI already holds 48 non-Dodgers international signings, all with `record_scope = MLB_PIPELINE_TOP_PROSPECT`: the MLB Pipeline
Top-30 international signing trackers for 2013 (20 players) and 2014 (28 players), across 19 organizations (NYY 9, BOS/COL/TEX 4,
CHC/CWS/HOU/MIL 3, KC/MIN/SEA/TOR 2, the rest 1). Each tracker names 30 players, so 10 (2013) and 2 (2014) tracker members are not held and are queued as untracked, not as non-reachers. No other non-Dodgers international data exists: no full signing-period
rosters, no non-Dodgers bonus ledgers, no non-Dodgers transaction chains.

## 2. Benchmark universes (A–E)

| Universe | Definition | Held by DISI | Status |
|---|---|---|---|
| A | Every non-Dodgers international signing of a class (full signing period) | 0 | not obtainable from public tracker pages; no sourced denominator |
| B | Top-prospect tracker members (rank-selected sample) | 48 | held; **sample, not census** |
| C | Players who reached MLB (outcome-selected) | 11 of the 43 identifiable | held but selection-biased; never a denominator |
| D | Signees with a disclosed bonus above a threshold | partial | bonus known for 47/48 benchmark rows; threshold selection is rank-correlated |
| E | Organization-reported class | 0 | no such public record |

Only B is a defined population. It is used as a **Top-prospect sample benchmark** only.

## 3–8. Denominators, regimes, identity, metrics, bias, rate eligibility

3. **Denominators.** A rate needs a sourced size of the *signing period*, not of the tracker. None is held for any organization.
4. **Regimes.** Pre-2016 (uncapped bonus pools with tax rules), 2016-17 and 2019-20 pool eras differ in what a bonus buys; benchmark rows
   are 2013/2014 only and are compared only within their own regime.
5. **Organization identity.** Existing stable `organizations` ids (franchise_key); the Brooklyn/Los Angeles rule is unchanged.
6. **Outcome tiers.** Tier 1: reach / debut / years-to-debut / age / bonus (comparable once audited). Tier 2: original-organization vs
   elsewhere bWAR from loaded team-season facts. Tier 3: organizational realization with transaction lineage — **Dodgers only**,
   not comparable, never claimed for a benchmark row.
7. **Sample bias.** A tracker lists ranked prospects: reach rates are upward-biased relative to the full period, and the bias differs
   by organization. Reach is never described as an organization hit rate.
8. **Rate eligibility.** `rate_eligible_strict` requires FULL_SIGNING_PERIOD + sourced expected size + members = size + every member
   identified + every member outcome-audited + mature cohort (class end ≤ as-of − 5). No class meets it today.

## 9–14. Coverage, cost, maturity, comparability

9. **Coverage model.** `census_state`: CENSUS_COMPLETE / CENSUS_PARTIAL / UNKNOWN_COVERAGE / TOP_PROSPECT_SAMPLE / VERIFIED_SAMPLE /
   OPENING_CLASS_PARTIAL / CURATED_SAMPLE — derived, never stored.
10. **Cost.** Non-Dodgers acquisition cost is bonus only (no pool charge or tax per organization); acquisition-cost metrics use
    COMPLETE cost only, so none are computed for benchmark rows.
11. **Maturity.** Both tracker classes are mature (2013, 2014 ≤ 2026 − 5); maturity is necessary, never sufficient.
12. **Comparability labels.** SAMPLE_COMPARISON (default); CLASS_COMPLETE_COMPARISON (strictly eligible class); LEAGUE-RATE is
    reserved and not producible: it would need every organization's class complete for one period.
13. **Dodgers comparator.** The 2013/2014 trackers contain no Dodgers member, so no Dodgers-vs-sample comparison exists inside them
    (queue item SAMPLE_HAS_NO_DODGERS_COMPARATOR, informational).
14. **Bounded cohort.** The 48 players; no expansion in 035.

## 15–20. Findings (computed at the 2026-10-05 audit boundary)

15. 43 of 48 identified by an existing MLB id or a unique exact-name + birth-year match; 5 unresolved (queued, not inferred).
16. 11 reached MLB (2013 class 6/17 identified, 2014 class 5/26); years signing→debut season 4–9, median 7.
17. 1 non-reacher is active in affiliated baseball; 31 have no recorded debut and no established affiliated status
    (`NO_MLB_STATUS_UNKNOWN`) — absence of a debut record is not proof of a career end.
18. 59 team-season bWAR rows for the 11 reachers, same two Baseball-Reference data files and checksums as 032–034.
19. Original-organization bWAR is NULL for reachers who never played for their signing organization (not zero).
20. Gleyber Torres (20.9 career bWAR, none for the signing organization) is the clearest example that signing-organization value is
    not career value — the benchmark keeps the two apart.

## 21–26. Design

21. **No new table.** Outcomes, audits and evidence reuse the Dodgers outcome-audit stores; populations reuse `signing_populations`.
22. **Views (3, security_invoker, MATERIALIZED wrappers for PostgREST LIMIT plans):**
    `v_international_benchmark_player_outcomes`, `v_international_benchmark_class_coverage`, `v_international_benchmark_research_queue`.
23. **Queue issues:** BENCHMARK_IDENTITY_UNRESOLVED, BENCHMARK_OUTCOME_UNAUDITED, BENCHMARK_REACHED_WITHOUT_TEAM_SEASON_FACTS,
    BENCHMARK_BONUS_UNKNOWN, POPULATION_MEMBERS_NOT_TRACKED, POPULATION_DENOMINATOR_NOT_SOURCED, SAMPLE_HAS_NO_DODGERS_COMPARATOR.
24. **Verifier:** 8 new checks (scope, unaudited ≠ false, outcome state, bWAR split, tiers, strict eligibility, census state, labels).
25. **Supported metrics:** reach (audited), debut, years to debut season, career / original-org / elsewhere bWAR (Baseball-Reference),
    bonus and age at signing, class coverage and blockers.
26. **Unsupported (by design):** organization hit rates, league rates, organization ranking, $/WAR, acquisition efficiency for
    non-Dodgers, causal scouting/academy claims, any inference of non-reach from missing data.

## 27–31. Gate

27. Population clearly defined: yes (48 tracker members). 28. Denominators explicit: yes — none, stated. 29. No unsupported
league-wide claim: yes. 30. Reproducible from public data with retained provenance: yes (MLB person URLs, Baseball-Reference files).
31. Census/sample state representable: yes. Fits one migration: yes (data + 3 views, no table).

## 32. Decision

**IMPLEMENT IN 035:** Top-prospect sample outcome completion (43 audits, 11 outcomes, 59 team-season rows), the coverage model,
strict derived rate eligibility, three views, eight verifier checks.

**DEFER TO 036:** full signing-period rosters and denominators per organization; non-Dodgers bonus pool / tax ledgers; additional
tracker classes; the five unresolved identities; expansion to other benchmark universes; any rate or league comparison.
