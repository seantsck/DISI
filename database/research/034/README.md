# Migration 034: downstream organizational value chains

`database/sql/034_downstream_organizational_value_chains.sql` is generated from this folder:

```
python database/research/034/derive/assemble.py     # B-Ref team-year pages + official log (gitignored raw) -> exit-seed.json
node   database/research/034/derive-seed.mjs        # raw B-Ref WAR files (same checksums as 032 / 033) -> war-seed.json
python database/research/034/derive/amend_views.py  # 033 portfolio / queue views -> views-amend.sql
node   database/research/034/audit.mjs              # replays 001-033 in memory, checks every precondition and seed -> audit-report.json
node   database/research/034/build.mjs              # template + views + seeds -> the migration (deterministic)
node   database/research/034/effects.mjs            # fresh 001-034 replay -> analytics-effects.md
```

The raw transaction pages and the two WAR data files are gitignored scratch (`research-output/`); the reviewed seeds are the
committed source of truth and are enough to rebuild the migration.

| File | Purpose |
|---|---|
| `exit-seed.json` | 43 researched events (17 first-hop return-asset exits, 26 second-round exits, re-entries and re-signings) with 91 assets, 3 outgoing-placeholder resolutions, 4 asset observations, and the cases deliberately not seeded |
| `timing-seed.json` | 10 sourced chronology facts: first Dodgers appearance for Edman, McDermott, Rortvedt, Mota, Ruan and Checo (official game logs), Valo's season start, McDermott's last appearance, and the Punto and Bailey exit bounds |
| `war-seed.json` / `derive-seed.mjs` | 494 Baseball-Reference team-season rows (312 BAT, 182 PITCH) for 28 downstream return players; same two files and checksums as 032 / 033 |
| `scope-config.json` | data-file checksums, the canonical hop >= 2 players that need loading, team-code additions (none were needed) |
| `034_template.sql` / `views-new.sql` / `views-amend.sql` | hand-written schema, guard and backfill; the four new views; the additive amendments |
| `audit.mjs` / `audit-report.json` | pre-034 facts and the 033 analytics baseline the migration is compared against |
| `schema-design.md` | the timing table, the control-interval and lineage model, attribution levels, package identity |
| `research-backlog.md` | what remains unknown and what is deferred |
| `analytics-effects.md` | generated comparison of 033 and 034 analytics |

## What 034 establishes

- **Control intervals:** one continuous Dodgers tenure per player identity; a free-agent re-signing or reacquisition is a new interval.
  First-hop returns were credited with every later Dodgers season (Blake 9.16, Hundley 2.35); the interval-bounded value is 0.94 and 2.33.
- **Lineage:** a cycle-safe derived traversal of canonical transactions from every trade of tracked signings (41 root packages, depth 4).
- **Attribution:** `PLAYER_ATTRIBUTABLE` -> `PACKAGE_ATTRIBUTABLE` -> `CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE` -> `UNRESOLVED`; it only degrades.
- **Package-level aggregates** are deduplicated by `root_package_key` and never merged into a signing's individual total.
- **Timing:** acquisition-season chronology is resolved only on an accepted basis: the calendar, no Dodgers stint that season, the 032
  counterparty stint order, or a sourced timing fact. A single Dodgers team row, a single stint or the absence of an earlier modeled
  interval is never chronology evidence; Valo, Edman, McDermott, Rortvedt, Mota, Ruan and Checo each rest on a sourced fact.
- **Not in 034:** league-wide international benchmarking (035), valuation of cash, pool space or prospects, projections, fWAR.
