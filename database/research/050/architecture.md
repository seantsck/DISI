# Migration 050: architecture

## 1. Why 050

049 left the remaining transaction work blocked by sources DISI cannot read today (the Baseball-Reference WAR files answer 403; obscure
historical exits; unnamed conditional considerations; unreadable cash terms). The next tractable bottleneck was outcome support. The nearest
041 target was `POSITIVE_BWAR_WITHIN_10_SEASONS` in the Top-prospect benchmark (43 labelled, 7 positive), but the five unresolved 035 identities
alone could not reach 50 labelled rows. 050 therefore resolves what it can of those five and extends the same benchmark methodology to the
mature 2015 and 2016 classes. No threshold is touched; the evidence decides what becomes supported.

## 2. Sources

| Need | Source | Read how |
|---|---|---|
| List membership, rank, position | MLB Pipeline's official prospect data feed, `/gen/players/prospects/<year>/playerProspects.json`, list `int` (what the mlb.com Prospect Watch page renders) | mlb.com answers 403 to direct reads; the feed is read from Internet Archive captures (`id_` raw mode). Capture URL, timestamp, `last_updated` and SHA-256 are recorded |
| Signing club and date | Official MLB transaction log (`statsapi.mlb.com/api/v1/transactions`): `SFA` "signed free agent" and `SGN` "signed" rows, per club over the class window | direct |
| Identity, outcome | MLB person record and career statistics (as 035) | direct |
| Birth-date cross-check, Baseball-Reference id | Chadwick register (`people-*.csv`, registered by 049 as an identity crosswalk only) | direct, local copy |
| Signing route of a Cuban signee | the official record (a winter-league / Caribbean Series season before the signing year), else a directly read Wikipedia account of Cuban National Series play | direct; tier `OTHER`, route only |
| bWAR | Baseball-Reference only | answers 403: nothing loaded |

The 2015 cohort is the list as published before the 2015-16 signing period opened (2015-05-11); its clubs come from a later revision of the same
feed, which names where each listed player signed. No pre-signing capture of the 2016 feed exists; the 2016 cohort is the earliest capture,
the list as updated inside the 2016-17 period (2017-05-27). Both later revisions are recorded beside the cohorts and never used as them (the
2015 revision re-ranked the list and added seven Cuban signees; the 2016 revision no longer names a club for four Atlanta signees, whom the official log shows signing again elsewhere).

## 3. Identity (never by name alone)

A listed player is `RESOLVED` only when exactly one person the official log shows signing inside the class window (1 June of the class year to
30 June of the next) matches the published name, the club agrees with the club the list names (when it names one), the birth year fits the
class, the position family (pitcher / non-pitcher) agrees, and the register birth date equals the MLB person record where the register holds
the person. A one-letter or prefix spelling variant (Leodys / Leody, Yonathan / Jonathan, Yerdeluis / Yerdel, Emmanuel / Enmanuel) is accepted
only together with the list's own club. A published maternal surname counts (Micker Zapata is Micker Adolfo Zapata); a middle name never does.
A namesake who signed with a different club than the list names is recorded as considered and set aside. Two persons, a different club only, a
register birth-date disagreement or a disagreement with the country a legacy row already records are `CONFLICT`. The rules are pure functions
(`identity-rules.mjs`) with unit tests.

## 4. Membership and duplicates

- `RANKING APPEARANCE != NEW SIGNING`. A listed player the Dodgers signed (Starling Heredia, Ronny Brito) is never a benchmark row: his one
  Dodgers signing stays `TRACKED_DODGERS` and is not touched. It already carries an MLB Pipeline international rank from another edition of the
  list (5 and 21, against 3 and 18 in the pre-signing feed); recording a second, differing edition would put two MLB Pipeline ranks on one
  signing, which the 026 legacy-rank rule refuses, and the edition behind the stored value cannot be read today. The observed rank is kept in
  `cohort-decisions.json`. Every Dodgers row is byte-identical after 050.
- One player, one signing, many observations: an MLB id belongs to one player (unique); a player ranked twice is one player.
- `SOURCE LIST MEMBERSHIP != VERIFIED SIGNING`. An unresolved member is not added; the population's `stated_composition` lists every member's
  decision, and the existing `POPULATION_MEMBERS_NOT_TRACKED` queue item counts the gap.
- A Cuban signee whose route no readable source states is verified as a signing but not added: an unknown route is never guessed amateur
  (which would put a possible professional into the amateur training population) or professional.

## 5. Database (data-only, with one demonstrated definition fix)

Reused, no new table: `players`, `player_aliases`, `signings` (`record_scope = 'MLB_PIPELINE_TOP_PROSPECT'`, `signing_date` and
`formal_transaction_date` from the official transaction, `position_at_signing` as published, `international_rank` as published, bonus NULL),
`signing_populations` (two `TOP_PROSPECT_SAMPLE` populations, `expected_size` 30, `rate_analysis_suitable` false), `signing_population_members`
and their sources, `signing_census_coverage` (the two sample rows the League Benchmark page lists), `evidence` (per field), 026 evaluations and
rankings (`INTERNATIONAL_CLASS`, the existing MLB Pipeline publication, list size 30, banded by the 036 bands), `outcome_evidence`,
`outcome_audits` and `outcomes` (the 035 conventions, `career_war` NULL), and `outcome_model_evaluations` (the 041 rows, replaced only after
the migration proves they are the 041 ones).

The demonstrated requirement. `disi_executive_overview()` (044) counted a target as a supported probability target when ANY reference population
supported it, while `v_player_outcome_probability` shows a probability only for the Dodgers tracked / opening-class population. With the
benchmark reach target supported, the overview would have reported one supported target and `PROBABILITIES_PUBLISHED_FOR_SUPPORTED_TARGETS` while
0 probabilities exist. The snapshot refresh (`disi_refresh_product_snapshots()`, 045b) validates each generation against the same pooled count.
050 replaces one statement of each (guarded by the live body's md5 before, and the reviewed body's md5 after); signatures, grants, security,
volatility and every other statement are byte-identical to 044 / 045b. The same rule moves in the verifier (three checks) and in
`lib/research/readiness-blockers.js`. On every pre-050 database the new and old counts are equal (no population was supported), so frozen-state
verification is unaffected.

## 6. Labels, horizons and bWAR

050 writes no label. The 041 views derive them, with `signing_year` from the official signing date: Luis Robert Jr. (2016 list, signed
2017-05-27) has `signing_year` 2017, so his 10-season horizon (2027) is open; a 2016 signing's 10-season horizon (2026) has elapsed. Miguel
Amaya (signed 2015, debuted 2023) is `FALSE` for reach within 7 seasons while his audit stays `REACHED_MLB`. No Baseball-Reference row exists for
any new reacher and the files answer 403, so every reacher's bWAR targets stay NULL (`OUTCOME_UNAUDITED`); an audited non-reacher is `FALSE`
without WAR. fWAR cannot be stored as team-season WAR (`war_system` check).

## 7. Support and the evaluation

Thresholds are unchanged (50 / 10 / 10; 10 events per feature) and cannot be lowered (`outcome_targets` checks). After 050 the benchmark
`REACH_MLB_WITHIN_7_SEASONS` meets them (90 / 19 / 71): a reference baseline of 0.211 (90% Wilson 0.149-0.290) for that rank-selected sample.
Nothing else crosses. The 041 evaluation is re-run unchanged (same target, rows rule, features, models, lambda, leave-one-signing-year-out):
101 rows, 19 positives, 6 folds; Brier skill -0.015 (population-stratified rate) and -0.037 (L2 logistic, also short of the 60 events six
features need). Both stay `MODEL_NOT_SUPPORTED`. The stored rows are replaced only after proving they are the 041 rows; the fingerprint moves
from `683251fe2e7522fcd346cf6a26004e08` to `af9ec05feb3ee1518cb7608193cd209a` and `evaluation_current` is true.

## 8. Support chain after 050

041 probability: 0 non-null (benchmark rows are never predicted for; Dodgers rows keep `REFERENCE_POPULATION_NOT_SUPPORTED`). 042 expected
value: unsupported (its support is the Dodgers population's). 043 recommendations: 0. 044 executive: 0 supported probability targets,
`NO_SUPPORTED_PROBABILITY_TARGET`. 045 release: `NO_PREDICTIVE_LAYER_SUPPORTED`. The product shows the benchmark baseline as a reference result
on Prediction readiness and the League Benchmark page, never as a Dodgers estimate.

## 9. Verifier

248 hard checks: the existing 247 plus `outcome_population_isolation_violations` (no probability or eligibility outside the Dodgers population;
no Dodgers row eligible without the Dodgers population's own support). Pinned counts move (players 268 -> 322, benchmark players 48 -> 102,
evaluations 51 -> 105, legacy ranks 59 -> 113 with 48 -> 102 represented, 11 unrepresented unchanged); the 049 values are kept as
`EXPECTATIONS_THROUGH_049`.

## 10. Rollback

`database/release/sql/rollback-050.sql`, one guarded transaction: refuses if later research depends on a 050 player; removes exactly the 050
rankings (the 026 guard seals ACTIVE rankings, so the two guard triggers are disabled inside this transaction only and re-enabled before
commit, which is proved), players, signings, members, coverage rows, populations, audits, outcomes and evidence; returns the two legacy rows to
unresolved; restores the 041 evaluation rows exactly and the 044 / 045b function definitions; refreshes once. Every research table equals its
pre-050 content (the two legacy player rows differ only in the `updated_at` the existing trigger stamps); the sources stay as provenance; 050
can be applied again.
