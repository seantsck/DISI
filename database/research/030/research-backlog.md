# Migration 030: research backlog

Leads found while reviewing sources for 030. They are **not** seeded, because each one either needs a
canonical change outside 030's scope, an identity check, or a source that states the fact directly.

## Sourced bonuses not yet in DISI (would change canonical columns)

- **William Soto, Ariel Sandoval, Cristian Gomez (2012 class).** Baseball America's 2012-13 review
  gives $190,000 (July 2), $150,000 (December) and $250,000 (July). DISI has no bonus for them. Each
  needs a signing-identity check and a reviewed canonical change.
- **Julio Urias.** The same review describes a package deal "believed to be worth around $1.8
  million" and says the amount intended for Urias is unconfirmed. DISI carries a $450,000 transfer
  fee as a legacy carry-forward with no source. Find a source for the split, or leave it as is.

## Pool facts

- **Lantigua / Campbell pool-space trades (2025).** MLB Trade Rumors says the Dodgers added pool space
  by trading minor leaguers, including Dylan Campbell and Arnaldo Lantigua. DISI's 027-reconciled
  transaction wording is unchanged. Recording POOL_SPACE_ACQUIRED rows needs the amounts (not stated)
  and a review of the transaction's return description.
- **Sasaki pool charge.** CBS Sports' arithmetic ($5,146,200 pool + $1,353,800 additional =
  $6,500,000) implies the full bonus was charged against the pool. No source states the charge. Store
  a POOL_CHARGE only from a direct statement; never copy it from the bonus.
- **2025 maximum pool ($8,233,920) and the $1,353,800 needed.** These are limits and requirements,
  not transactions. A POOL_AFTER_TRADES for 2025 needs the final pool after the trades.
- **2021-22 Bauer penalty.** The environment's rules text says the pool was reduced by $500,000. It is
  not known whether the $4,644,000 stored pool is before or after that reduction. A PENALTY_REDUCTION
  report plus a clarified BASE_POOL is needed before true utilization.
- **Pool capacity for 2012, 2013, 2014, 2017 and 2021** (queued as POOL_CAPACITY_UNKNOWN). Adding
  environments for those periods needs sourced pools.
- **2015-16 final spend.** Baseball America's ~$45M was "so far" as of April 2016. The final period
  spend, and the tax actually paid (OVERAGE_TAX_PAID), need a direct source; neither may be derived
  from the rate.

## Pool treatment

- **Hyun-Jin Ryu (2012, posted KBO veteran)** and **Yordan Alvarez (2016, Cuban)** stay UNKNOWN until a
  source states how the pool applied.
- 113 pool-era Dodgers signings with a signal are queued as POOL_TREATMENT_UNKNOWN. Note that bonuses
  at or below the small-bonus exemption did not count against the pools (2012-16 rules), so
  "amateur in the pool era" alone is not enough to set SUBJECT.

## Provenance upgrades

- **FINANCIAL_SOURCE_MISSING (90).** 84 known signing values (83 bonuses + Urias' transfer) and 6
  environment values have only a legacy carry-forward. 33 of the bonuses have an evidence note that
  mentions a bonus; re-reading those sources is the cheapest upgrade.
- **Valenzuela $120,000 and Ryu's MLB.com $25.7M** were carried from existing field-level evidence
  without re-reading (MLB.com HTTP 406). Re-read them when reachable and confirm the basis.

## Schema follow-ups

- A reviewed **conflict resolution** object (a decision with a reason that selects one ACTIVE report
  for the canonical column). Until it exists, a conflicted column stays NULL.
- A **2019-20 class**: only 3 of the 50 reported signings are DISI members; true utilization needs the
  full population and their pool charges.
