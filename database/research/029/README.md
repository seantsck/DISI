# Research behind migration 029

Everything needed to inspect and rebuild `database/sql/029_signing_network_intelligence.sql`: the audit that measures the migration's preconditions and
coverage contract, the reviewed seed, the source audit and the assembly of the migration. Design: `schema-design.md`. Sources: `source-audit.json`.

| File | Purpose |
| --- | --- |
| `seed-evidence.json` | The reviewed, directly read network facts (9 entities, 1 alias, 9 player relationships) and the researched no-attribution cases |
| `audit.mjs` → `audit-report.json` | Offline audit against a fresh 001 → 028 replay: legacy trainer layer empty, no unexpected dependents, seed references resolve, exact seed counts, the 64-signing coverage denominator (5 attributed, 59 missing, 34 of them MLB-reaching), CUBAN_PRO kept out |
| `029_template.sql` + `build.mjs` | Hand-written schema, triggers, views and guards, and the build that injects the deterministic lookup maps, the period columns and the seed payload |
| `test-029.mjs` | Local harness: applies 029 twice over a 001-028 replay |
| `research-backlog.md` | The four unverified MLB.com candidates (Morales, Arias, Melburne, Vargas) and the researched cases with nothing stated |

```
node database/research/029/audit.mjs && node database/research/029/build.mjs
```

## What 029 holds

- **Seed (Baseball America, 2016-04-01 and 2018-04-30, read directly):** Cruz trained with Valera (stage unknown); Heredia trained with Ferreras and played in the Dominican Prospect League (both pre-signing,
  tied to the signing) and Ferreras' descriptive program also produced him (`DEVELOPED_AT`, unknown stage, MEDIUM); Brito trained with Genao and played in the International Prospect League; Christopher Arias trained with Nina and played in
  the IPL; Vivas signed out of Yasser Mendez's descriptive academy (`SIGNED_OUT_OF`, at signing).
- **Not seeded:** any entity-to-entity relationship (possessive wording alone is represented by the descriptor anchor), any identity review, the four MLB.com candidates, any player alias for a publisher's spelling
  (Yorbit Vivas, Onil Cruz), and any Cuban signing without a stated network.
- **Coverage after the seed:** 5 of the 64 primary signings are attributed; 59 are queued, 34 of them MLB-reaching. CUBAN_PRO (3 signings) is a separate segment and is not part of the denominator.

## Design notes

- Aliases are immutable, source-backed identity observations (insert-only, no lifecycle); they get their own sealing trigger, so there are four triggers in total.
- Valera's canonical name is the spelling Baseball America prints, `Raul Valera`; no accented form is stored, because no directly read source supports one. The only seeded alias is the nickname `Banana`. The normaliser still resolves accented forms to the same lookup key.

## Limitations

- Two readable public pages are the only source of seeded facts; they are all-rights-reserved, so only facts and citations are stored.
- Geography is never invented: no country, region or city is stored for any seeded entity.
- Coverage numbers are research progress, not invariants.
