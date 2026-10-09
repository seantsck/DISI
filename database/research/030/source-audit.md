# Migration 030: source audit

Reviewed 2026-10-09. Each page was fetched once (HTTP 200) and parsed directly. Facts are stored as
short DISI paraphrases; no publisher text is stored. Search snippets were not used as evidence.
No paywall, bot protection or HTTP restriction was bypassed.

| Key | Source | Published | Read | Used for |
|---|---|---|---|---|
| ba2013 | Baseball America, "2012-13 International Reviews: Los Angeles Dodgers" (Ben Badler) | 2013-02-21 | directly, new in 030 | Ryu exact posting bid $25,737,737.33 (EXACT); Ryu $5M bonus (ROUNDED); Puig $12M bonus (ROUNDED); Puig signed before July 2, 2012 (exempt from the pools: NOT_APPLICABLE); the pre-pool rule |
| cbs2012 | CBS Sports, "Dodgers sign Hyun-jin Ryu for six years, $36 million" (Matt Snyder) | 2012-12-09 | directly, new | Ryu $5M bonus inside the $36M / six-year contract (only the bonus is stored); $25.7M posting fee (ROUNDED) |
| cbs2025 | CBS Sports, "Roki Sasaki signs with Dodgers ..." (R.J. Anderson, Mike Axisa) | 2025-01-17 | directly, new | Sasaki $6.5M bonus (ROUNDED); posting fee "25% of his bonus, so $1.625 million" (RULE_DERIVED 0.25 x 6.5M); subject to the bonus pools; Dodgers' original 2025 pool $5,146,200 (EXACT) |
| mlbtr2025 | MLB Trade Rumors, "Dodgers Sign Roki Sasaki" (Anthony Franco; updated post) | 2025-01-22 | directly, new | Sasaki $6.5MM bonus (ROUNDED); "$1.3MM posting fee", club limited to 20% (RULE_DERIVED 0.20 x 6.5M); $5.1462MM available on January 15 (ROUNDED, precision 100); subject to the pool system |
| ba2016 | Baseball America, "International Reviews: Los Angeles Dodgers" (2015 class) | 2016-04-01 | re-read from the copy fetched for 027 | 2015-16 pool after trades $700,000 (EXACT); about $45M spent so far (APPROXIMATE); 100% overage tax (rate 1.0); Alvarez $16M, Diaz $15.5M, Estevez $6M bonuses (ROUNDED); those three under the pool (SUBJECT) |
| ba2018 | Baseball America, "International Reviews: Los Angeles Dodgers" (2017 class) | 2018-04-30 | re-read from the copy fetched for 027 | 2017-18 individual bonus cap $300,000 (EXACT) |
| roundup2019 | MLB.com 2019-20 all-club roundup (existing DISI source) | n/a | not re-read (MLB.com answered HTTP 406) | carried from DISI's `international_org_period_summary`: Dodgers pool $5,366,400 and spend $5,354,000 |
| mlb_callis_ryu | MLB.com, Jim Callis on the Dodgers' roster build (existing) | n/a | not re-read (HTTP 406) | carried from DISI's existing field-level evidence for Ryu's $25.7M posting fee (ROUNDED) |
| mlb_es_valenzuela | MLB.com en Espanol, Fernando Valenzuela obituary (existing) | n/a | not re-read (HTTP 406) | carried from DISI's existing field-level evidence for the $120,000 transfer (EXACT as recorded) |

## Conflicts kept, not resolved

- **Sasaki posting fee.** CBS Sports says 25% of the bonus ($1,625,000). MLB Trade Rumors says 20%
  ($1,300,000). Both are ACTIVE `RULE_DERIVED` reports with their stated rate and base. Neither source
  is labelled false. `posting_fee_usd` stays NULL and `FINANCIAL_REPORT_CONFLICT` is queued.

## Values deliberately not stored

- The $36M Ryu contract, the $42M Puig contract, and Ryu's $1M-per-year performance bonuses: these
  are contract value, not acquisition cost.
- Baseball America's "$90 million total tab" projection for 2015-16: a projection, not a reported
  tax amount. Only the rate (1.0) and the approximate spend are stored.
- CBS's $8,233,920 maximum pool (base pool plus the 60% tradeable allowance) and the "$1,353,800
  additional pool space" the Dodgers had to acquire: these are requirements and limits, not
  reported transactions. See the backlog.
- Sasaki's pool charge: CBS's arithmetic implies the full $6.5M counted against the pool, but no
  source states a pool charge. It is not derived from the bonus (backlog).

## Unreachable

MLB.com (406), True Blue LA (403), mlbplayers.com CBA PDF (404). Nothing from them is new 030 evidence.

`source-audit.json` holds the same information in machine-readable form.
