# Research behind migration 020

Everything needed to inspect and rebuild `database/sql/020_player_identity_and_biography_enrichment.sql`.

| File | What it is |
| --- | --- |
| `export-players.mjs` | Exports every tracked player as of migration 019 (built in PGlite, never Supabase) → `artifacts/players.json`, `artifacts/league-no-id.json` |
| `artifacts/league-resolve-ids.*` | `resolve-ids.mjs` for the 48 other-club signees: 42 club-transaction matches, 6 not found |
| `artifacts/bref-stage1-resolve-bref.json` | `resolve-bref.mjs` before MLB records were fetched: MLB ids for 42 older Dodgers players from B-Ref pages DISI already cites (40) or name + debut year + debut franchise (2) |
| `identity-decisions.json` | Documented manual identity decisions (Hyo-Jun Park → MLB 660829) with signals, evidence and aliases |
| `artifacts/hoy-park-*` | `resolve-ids.mjs` rerun for Hyo-Jun Park with the MLB spellings as aliases: the Yankees' 2014-07-02 signing of SS Hoy Jun Park |
| `merge-ids.mjs` | Merges those proposals and decisions → `artifacts/players-with-ids.json` with an `idBasis` per player |
| `artifacts/player-identities.*` | `player-identities.mjs`: MLB person record (with cross-reference ids) and transaction-history position at signing, with endpoint and retrieval time |
| `artifacts/resolve-bref.*` | `resolve-bref.mjs`: query, candidates, signals, selection and confidence per player |
| `artifacts/resolve-fangraphs.*` | `resolve-fangraphs.mjs`: FanGraphs ids from MLB's cross-reference |
| `values.sql`, `values-decisions.json` | `identity-sql-values.mjs` output: VALUES blocks and the per-player decision |
| `020_template.sql`, `views.sql`, `build.mjs` | Migration template, views and the builder |

All data were retrieved 2026-10-05 (each record carries its `sources` with retrieval timestamps).

## Rebuild

```bash
node database/research/020/export-players.mjs --out research-output/020
node scripts/mlb/resolve-ids.mjs --input research-output/020/league-no-id.json --out research-output/020/league
node scripts/mlb/resolve-bref.mjs --input research-output/020/players.json --out research-output/020/bref-stage1
node scripts/mlb/resolve-ids.mjs --input database/research/020/artifacts/hoy-park-input.json --out research-output/020/hoy-park
node database/research/020/merge-ids.mjs --players research-output/020/players.json \
  --league-ids research-output/020/league/resolve-ids.json \
  --bref research-output/020/bref-stage1/resolve-bref.json \
  --decisions database/research/020/identity-decisions.json --out research-output/020/players-with-ids.json
node scripts/mlb/player-identities.mjs --input research-output/020/players-with-ids.json --out research-output/020
node scripts/mlb/resolve-bref.mjs --input research-output/020/players-with-ids.json \
  --identities research-output/020/player-identities.json --out research-output/020
node scripts/mlb/resolve-fangraphs.mjs --identities research-output/020/player-identities.json --out research-output/020
# review, then:
node scripts/mlb/identity-sql-values.mjs --players research-output/020/players-with-ids.json \
  --identities research-output/020/player-identities.json --bref research-output/020/resolve-bref.json \
  --fangraphs research-output/020/resolve-fangraphs.json \
  --league-ids research-output/020/league/resolve-ids.json,database/research/020/artifacts/hoy-park-resolve-ids.json \
  --decisions database/research/020/identity-decisions.json --out database/research/020/values.sql
node database/research/020/build.mjs
```

With the original cache (`.cache/mlb`, `--offline`) every step is byte-identical. Live data change (current position, weight, new debuts).

## Identity rules applied

- **Multiple signals, never a name alone.** MLB ids come from the existing DISI id, a club "signed free agent" transaction matching name + signing club + signing year, a Baseball-Reference page DISI already cites (B-Ref WAR file maps it to one `mlb_ID`), or name + debut year + debut franchise. A single name match is `NEEDS_REVIEW`; two candidates are `AMBIGUOUS`. Neither is applied.
- **B-Ref ids** come from Baseball-Reference's own WAR files (`mlb_ID → player_ID`) and must agree with MLB's Lahman cross-reference; a disagreement is a `CONFLICT`. B-Ref ids are recorded only for MLB players (`NOT_APPLICABLE` otherwise), and only once an MLB identity is resolved: an unresolved player is `NOT_FOUND`, not "no MLB debut".
- **FanGraphs ids** come only from MLB's cross-reference. No fWAR is collected.
- **Fill NULLs only.** Existing values are never overwritten; a disagreement becomes a `research_source_conflicts` row and stays in the identity queue.
- **Field-level evidence.** One `evidence` row per field (`field_name`) per source, only where the source value equals the stored value. The MLB person record is evidence for birth date, birthplace, bats, throws, height, weight, current position and debut date — not for nationality, which no source here states.
- **Birth country is not signing market.** A class list or signing announcement supports `signings.country_market` (where the player was signed), never `players.birth_country`. Five legacy birth countries had been seeded from the signing country with no birth-record source; 020 corrects them from the MLB person record and keeps the legacy value on the resolved conflict row (see Manual decisions).
- **Coverage semantics.** A field is *present* when non-null, *resolved* when an evidence row backs it and no source conflict is open, *conflicted* when a conflict is open, and *unsourced* when it is present with neither (`v_dodgers_player_identity_coverage`). Unsourced values are queued.
- **Names.** `full_name` changes only for accent-only differences confirmed by Baseball-Reference or MLB (same letters, same slug). The previous spelling becomes a `PREVIOUS_DISI_SPELLING` alias. Other spellings become `MLB_RECORD_NAME` aliases. Players are never merged.

## Results

All tracked players (268 = 220 Dodgers signees + 48 other-club benchmark players):

| | Before 020 | After 020: present | resolved | conflicted | unsourced |
| --- | --- | --- | --- | --- | --- |
| MLB id | 177 | 263 (Dodgers 220/220; other clubs 43/48) | 263 | 0 | 0 |
| Baseball-Reference id | 2 | 58 (every MLB player: 47 Dodgers, 11 other clubs) | 58 | 0 | 0 |
| FanGraphs id | 0 | 139 | | | |
| Birth date | 108 | 263 | 263 | 0 | 0 |
| Birth country | 265 | 268 | 262 | 0 | 6 |
| Bats / throws | 113 | 263 / 263 | 263 / 263 | 0 | 0 |
| Birth city (birthplace) | 0 | 262 | | | |
| Birth state / province | — | 22 | | | |
| Position at signing | — | 225 signings | | | |
| Signing age computable | 0 | 197 of 268 signings (66 lack a signing date, 5 a birth date) | | | |
| MLB debut age computable | — | 58 of 58 MLB players | | | |
| Aliases | 19 | 50 (28 previous DISI spellings, 2 Hoy Park spellings, 1 other MLB record name) | | | |

The six unsourced birth countries are the five unresolved benchmark players and Enrike Sevilya, whose MLB record gives Moscow with the non-standard country code `RU1`; DISI's "Russia" is not backed by a source and is not inferred from the city.

## Manual decisions

| Player | Decision |
| --- | --- |
| 28 accent-only respellings (e.g. Roger Cedeño, Julio Urías, Sandy Amorós, Pedro Martínez) | Canonical name takes the accented spelling recorded by Baseball-Reference / MLB; slug unchanged; old spelling kept as an alias. |
| Chico Fernandez, Jose Offerman | MLB id accepted on name + debut year + debut franchise (HIGH): both debuted with the franchise that signed them, and the MLB record's birth country matches DISI's. |
| Hyo-Jun Park (Yankees 2014) → Hoy Park, MLB 660829 | Linked on primary MLB evidence, not name similarity: the Yankees signed free agent SS **Hoy Jun Park** on 2014-07-02 (MLB transaction log), the opening day of the 2014 period, matching DISI's tracker record (SS, South Korea, Yankees, No. 13, $1.1M); MLB person record: born 1996-04-07 in Seoul. Resolution `MANUAL_LINKED_SIGNING_TRANSACTION`, confidence HIGH; aliases "Hoy Jun Park" (transaction) and "Hoy Park" (MLB record); B-Ref `parkho01` and FanGraphs 18027 follow from the MLB id. The DISI tracker spelling stays the name. The MLB.com biography states the same link but could not be retrieved by the research client (HTTP 406), so it is not stored as a source. |
| Josue De Paula | Birth country Dominican Republic → **United States** (MLB: Brooklyn, NY). He moved to and signed out of the Dominican Republic, which stays his signing market. |
| Damaso Marte Jr. | Dominican Republic → **United States** (MLB: Orlando, FL). Signed from the Dominican Republic; signing market unchanged. |
| Isaac Barreto | Colombia → **Venezuela** (MLB: Maracaibo). Colombia is the country in the Dodgers 2021 class release and stays the signing market. |
| Luciano Romero | Venezuela → **Dominican Republic** (MLB: La Romana). Venezuela is the 2022 class-list country and stays the signing market; the old market conflict is resolved as two different facts. |
| Joseph Deng Thon | South Sudan → **Sudan**, the literal value on the MLB person record (Juba). He was born 2007-08-05, before South Sudan's independence (2011-07-09); Juba is in present-day South Sudan. Club and class sources describe him as South Sudanese, and South Sudan stays the signing market. Nationality is left empty: no source states it as such. |
| Emmanuel DeJesus, Jonathan Amundaray, Micker Zapata, Yeremy Rosario, Yeyson Yrizarry | No MLB signing transaction or name match with the signing club; ids, birth date and handedness stay NULL; their legacy birth countries are reported as unsourced; queued. |

Each correction keeps the legacy value in `research_source_conflicts.value_a` with the reason in `resolution`, and the new `birth_country` evidence row names the value it replaces. No signing market changed (tested against a 019 build).

## Population scope

The database holds Dodgers signees and other clubs' signees kept as league benchmarks. Dodgers-facing pages count Dodgers signees only: the homepage shows 220 Dodgers players and lists the 48 benchmark players separately (`v_database_status.dodgers_players`, `league_benchmark_players`); `/players` defaults to Dodgers signees, labels the population, and its filter counts follow the scope (`v_player_filter_options.has_dodgers_signing`). Benchmark players are reachable through Scope → All players in database.
