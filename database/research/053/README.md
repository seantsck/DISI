# Research behind 053: transaction and chronology resolution

052 left 18 development needs `TRANSACTION_BLOCKED`: seasons with two organizations and no canonical transaction between them. 053 asked, for each
season, whether an approved source states a transaction, whether it is a Dodgers transaction (DISI's ledger records only those), and whether the
existing rule could read the one already on record. It records a transaction only where the evidence supports one and names every remaining
blocker.

```
npm run research:development -- --needs --history --save <before.json>             # the canonical state, read-only as the anon role
node scripts/mlb/player-transactions.mjs --input players.json --out <dir>           # the official transaction log and person record of each player
#   <dir>/tran.txt, tranDB.zip   https://www.retrosheet.org/transactions/tranDB.zip  (the file 049 read; identical sha256)
#   <dir>/BIOFILE.TXT            https://www.retrosheet.org/BIOFILE.TXT
#   <dir>/register/people-*.csv  https://github.com/chadwickbureau/register (data/)
#   <dir>/people/career-453845.json   the official career statistics of Kenny Lutz
node database/research/053/derive.mjs <dir> <before.json>                           # classification, workset, evidence and migration-values.json
node database/research/053/build.mjs                                                # the migration and its rollback, from migration-values.json
node database/research/053/canonical-dataset.mjs <after.json>                       # the same read of the canonical chain with 053 applied
node database/research/053/derive.mjs <dir> <before.json> <after.json>              # adds the before/after artifacts
npm run research:development -- --chronology --open                                 # every open two-organization season with its scope
```

The official log was read for 22 players (44 requests, 0 errors). No search snippet is evidence; no 403, authentication wall or paywall was
bypassed; the Retrosheet file was read fresh, not from any other project's cache.

| File | Purpose |
|---|---|
| `baseline.json` | the pre-053 state read from production: development needs and classes, the 57 two-organization seasons, the transaction and value queues, packages, and every primary blocker with its seasons |
| `workset.json` | the deterministic 053 workset: A the 18 primary needs, B the transaction and value items of the same players, C packages (none needed), D the adjacent hops |
| `transaction-blocker-classification.json` | one class per open season of the 18 needs, written before any data: MISSING_EVENT, EVENT_PRESENT_*, PACKAGE_MEMBERSHIP_OPEN, PTBNL_OPEN, TERMS_OPEN, SOURCE_LIMITED, NOT_A_TRANSACTION_GAP |
| `transaction-evidence.json` | the exact rows read (official log ids, Retrosheet rows), the identities and how each was matched, the source conflicts kept, and what was stated but not recorded |
| `transaction-research.json` | case by case: what the sources state, what was recorded, and the result (RECORDED, ALREADY_RECORDED, LATER_ORGANIZATION_HISTORY, STATED_NOT_RECORDED, SOURCE_LIMITED) |
| `package-research.json` | packages before and after, and the two trades 053 records: agreement, membership, terms (the Vizcaino cash amount is unknown, never zero) |
| `chronology-before-after.json` | every two-organization season state before (052 rule), with the detector correction alone, and after |
| `development-needs-before-after.json` | detector rows, needs, players and classes before and after; every primary need's before cause, evidence, write and after state |
| `transaction-needs-before-after.json` / `value-needs-before-after.json` | the two queues before and after, item by item, with the write that closed each resolved item |
| `migration-values.json` | the reviewed values the migration writes (ten Dodgers transactions; one pinned returned player whose WAR is not loaded) |
| `source-manifest.json` | the endpoints and files read, what the rows cite, and what was not used |
| `multi-org-detector.sql` | the 053 MULTI_ORG_SEASON_UNVERIFIED condition, spliced into the 052 view text by `build.mjs` |
| `architecture.md` / `research-notes.md` | the gap analysis and the findings |

## Result

- **Detector correction.** The 052 rule read a transaction by the ledger's columns (`from` is always the Dodgers) and required one transaction
  naming both organizations. It therefore read every acquisition backwards (latent: the only one, Valdez 2000, predates game logs) and could never
  read a release or a free-agent signing, which have no counterparty. 053 reads the player's direction from his asset side and recognizes the Dodgers
  end of a move (`BRACKETED_AT_DODGERS_BOUNDARY`). A release is never read as a trade, and the other club's signing is never implied.
- **Ten Dodgers transactions recorded** (official log or Retrosheet, identities matched by exact birth date): Baez's 2022 re-signing, Park's 2008
  signing and free agency, Vizcaino's 1997 re-signing and 2000 trade for Jim Leyritz (with cash of unstated amount) and Leyritz's free agency, Daal's
  2001 re-acquisition and 2002 free agency, Castro's 2010 signing and free agency.
- **Development needs 110 -> 108** (transaction-blocked 18 -> 16; detector rows 134 -> 132; players 66 -> 65). Baez closes with his recorded
  signing; Leon closes with the release DISI already had. Castro 2010 is bracketed, but his need stays open on 2006 and 2008.
- **Every remaining transaction-blocked need waits on a move between two other clubs** (33 seasons). For most of them the official log or Retrosheet
  states the move, but DISI's ledger records Dodgers transactions only: recording another club's trade there would read as a Dodgers exit in the
  asset views. They stay open and named, never closed.
- **Transaction queue 59 -> 58**: the Vizcaino, Park and Daal re-acquisitions close; the Vizcaino cash amount is a new terms item; Castro's 2011
  Dodgers season (his December 2010 re-signing is stated, not recorded) is reported by the interval 053 adds as well as the one before it.
- **Value queue 91 -> 93**: the Vizcaino 2000 trade's return value (Leyritz's Dodgers bWAR is not loaded) and its shared package (Vizcaino and cash)
  are new, honest unknowns. No unknown became a zero.
- **Unchanged**: 1859 stints, 1084 milestones, 42 progression decisions, outcome audits 47 / 46 / 127, 1880 WAR rows, 56 known costs
  ($121,700,237.33), benchmark support 90 / 19 / 71, fingerprint `af9ec05f...`, 0 probabilities, expected values and recommendations. One snapshot
  refresh (generation + 1): only the decision snapshot's content changes (Vizcaino).
