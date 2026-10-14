# 043a: decision-engine performance (post-043 query-shape correction)

`database/sql/043a_decision_engine_performance.sql` is built from this directory:

```
node database/research/043a/build.mjs
```

The build is deterministic. `043a_template.sql` holds the precondition and the structural postconditions. `views.sql` holds the
four staged functions and their wrapper views.

## Why it exists

The first production release of 042-045 (2026-10-14) was interrupted before any application deployment. 042 and 043 committed, and
044 was being applied. Then the hosted PostgreSQL restarted. The instance has 1 GB of memory, shared_buffers 224 MB and work_mem 2 MB. The partial
release was rolled back cleanly, and production was restored to its exact post-041 state (verifier 223/223, identical state snapshot).

The incident reproduces on a disposable PostgreSQL 17 limited to 1 GB with the production memory settings. The 044 apply is
OOM-killed (signal 9). The cause is **planner memory, not executor memory**:

- PostgreSQL inlines views. A statement over a stacked view plans every layer beneath it, and work_mem does not bound planning.
- A one-time filter (`where (select any_supported from s)`) skips a per-player layer at *execution* while support is absent. The
  layer is still *planned*.
- Top-level planner memory before this patch:

  | Statement | Planner memory |
  | --- | --- |
  | `v_player_realized_organizational_value` | 69 MB |
  | `v_player_expected_organizational_value` | 112 MB |
  | `v_expected_value_research_queue` | 124 MB |
  | `v_portfolio_candidate_readiness` | 231 MB |
  | each 043 view over it | about 255 MB |
  | the 044 executive overview | about 700 MB |
  | the 045 release status | about 690 MB |

  The overview planned the 041 probability layer three times, the 042 expected-value support three to four times and the per-player
  expected value twice. The 044 migration evaluated the overview twice inside its own transaction.
- Raising `join_collapse_limit` or `from_collapse_limit` changes almost nothing (669 to 626 MB). The memory comes from plan volume,
  not from join search.

## What it changes

The four views become thin `security_invoker` wrappers over staged PL/pgSQL functions:

| View | Function |
| --- | --- |
| `v_player_realized_organizational_value` | `disi_player_realized_organizational_value()` |
| `v_player_expected_organizational_value` | `disi_player_expected_organizational_value()` |
| `v_expected_value_research_queue` | `disi_expected_value_research_queue()` |
| `v_portfolio_candidate_readiness` | `disi_portfolio_candidate_readiness()` |

How the functions run:

- Each stage is a separate dynamic statement (`EXECUTE`). It is planned only when it runs, and its planner memory is released when it
  ends. No plan is cached in a pooled connection.
- Intermediate results, at most a few hundred rows, pass between stages as `jsonb` and are read back with explicit column types.
  `jsonb` keeps `numeric` values exactly.
- **Gated stages keep the original one-time-filter semantics.** The per-candidate expected values are read only when some value model
  is supported. While support is absent, that layer is now neither executed (as before) nor planned (new).
- Each function is `STABLE` (read-only, enforced by PostgreSQL), `SECURITY INVOKER` and `set search_path = ''`.
  - Each has `EXECUTE` revoked from PUBLIC and granted to anon and authenticated. Those roles need it to read the views, and the RLS of
    the caller applies throughout.
  - Through the API it returns exactly what its view returns.
  - The pure IMMUTABLE `disi_*` helpers were already executable through PUBLIC. The verifier forbids any API-executable `disi_`
    function that is VOLATILE or SECURITY DEFINER.
- The realized-value wrapper restores the 042 typmods (`numeric(9,3)` and `numeric(14,2)`) with explicit casts. Every value already fits them.

044 and 045 (never committed) use the same pattern:

- `v_executive_overview` is a wrapper over `disi_executive_overview()`. Each aggregate is its own statement, and the per-player counts are gated.
- `v_research_roadmap` is a wrapper over `disi_research_roadmap()`. Each queue is counted by its own statement.
- `v_disi_release_status` reads its support counts from the overview.
- Their postconditions are structural. No migration evaluates an analytical view.

## Evidence

**Semantic equivalence.** Every bundle view is byte-identical to the original 042-045 definitions (row count and the md5 of all
sorted rows) in three states:

- unsupported (today's data)
- probability-only (the REACH target supported)
- expected value supported: a stand-in conditional value gives 143 expected values, 14 optimization-eligible candidates and 20 optimized
  selections, `PREDICTIVE_DECISIONS_SUPPORTED`

Every public column, type and typmod, comment, option, ACL, policy and table row is unchanged.

**Planning.** At the top level every staged view, and every view over one, plans in under 2 MB. A booby-trapped per-player view, which
fails as soon as it is planned, proves the gated layers are never planned while support is absent (`tests/db/performance-043a.test.mjs`,
`tests/db/executive-044.test.mjs`).

**Constrained PostgreSQL 17** (1 GB cgroup, no swap, production memory and planner settings, anon `statement_timeout` 3 s):

- 042 → 045 apply without an OOM kill: 0.49 / 0.75 / 0.03 / 0.03 / 0.03 s.
- Per-read memory (cgroup peak above baseline):

  | View | Before | After |
  | --- | --- | --- |
  | executive overview | 816 MB | 71 MB |
  | release status | 760 MB | 72 MB |
  | candidate readiness | 282 MB | 74 MB |
  | each 043 view over it | about 308 MB | about 78 MB |
  | every bundle view (maximum) | | 78 MB or less |

- 10-run medians: overview 275 ms, all other heavy app queries 130-145 ms. None over 1.5 s.
- Concurrent visitors, each loading the home page, `/portfolio`, `/prediction-readiness` and a dossier, with 0 errors:
  - 4 visitors: non-reclaimable peak 475 MB.
  - 8 visitors: 800 MB, against 770 MB for the same concurrency over the pre-042 product contract that production serves today.
