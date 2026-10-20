# DISI research commands (046)

Read-only commands that tell a researcher what to work on next. They connect as the public `anon` role in a read-only session, so they can
only see what the website can see (the persisted `product_*` snapshots and the public views). They never write. Their output has no
timestamps and a fixed order, so the same data always prints the same bytes.

```
DISI_RESEARCH_DB_URL=... npm run research:queue
npm run research:outcomes     -- --mature --status not_audited [--year 2021] [--market Venezuela] [--limit 20] [--format text|json|csv]
npm run research:outcomes     -- --evaluate research-output/046/player-outcomes.json    # audit conclusions for a scripts/mlb artifact
npm run research:costs        -- --missing [--mature] [--mlb yes|no] [--year 2018] [--market Venezuela] [--limit 25]
npm run research:transactions -- --missing | --traded | --unresolved-attribution | --chains
npm run research:readiness
npm run research:progress     -- --baseline database/research/046/baseline.json
```

| Option | Meaning |
|---|---|
| `DISI_RESEARCH_DB_URL` (or `DISI_VERIFY_DB_URL`) | the database; never printed. A read-only transaction that switches to `anon` |
| `--input dataset.json` | read a saved dataset instead of connecting |
| `--save dataset.json` | with a database connection, save the raw query results (aggregates and public rows only) |
| `--format` | `text` (default), `json`, `csv` |

`NOT_AUDITED` is shown as itself and never as a no-MLB result; an unknown cost is shown as `UNKNOWN`, never `0`.
The logic lives in `lib/research/` (pure functions, unit-tested in `tests/unit/research-046.test.mjs`).
The MLB Stats API research scripts that gather evidence for an audit are in `scripts/mlb/`.
