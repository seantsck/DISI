# 061 audit report

**Audit and scope pass only.** No 061 SQL, rollback, release plan or manifest change exists, nothing touched production, and no frozen migration changed.
Baseline: `main` = `318a7243f33680ba7e8a9f1f4e6e50b99ffb968f`, 64 frozen migrations (001-060), `UNRELEASED_ADDITIONS = []`, no 061 file (`baseline.json`).

## Result in one paragraph

52 owner research items were mapped to the database as it stands after 060. **10 are ready to write with the existing tables** (nine exact amounts or dates and one conditional note), and **no schema change is needed for them**. Only three of those nine were confirmed against the page the owner cited (Lantigua $1.5M, the Braves $4.5M, and Garland's signing date); six rest on pages this audit could not open (HTTP 403 or empty), so those sources must be captured before a build. Two cited pages **contradict** the owner finding (Máximo Martínez: the page says the amount "was not announced"; Vizcaíno: the page says "with cash" and names no amount). One is only "about $2MM" (Blake), which the schema cannot store as approximate. No identity or route item has enough source to write: 18 items lack evidence.

## Classification counts

| Classification | All | Transaction | Identity / route |
|---|---:|---:|---:|
| `APPLY_EXACT` | 9 | 9 | 0 |
| `APPLY_CONDITIONAL` | 1 | 1 | 0 |
| `APPLY_UNDISCLOSED` | 0 | 0 | 0 |
| `APPLY_IDENTITY` | 0 | 0 | 0 |
| `ALREADY_PRESENT` | 5 | 3 | 2 |
| `PARTIAL` | 1 | 0 | 1 |
| `INSUFFICIENT_EVIDENCE` | 18 | 5 | 13 |
| `SCHEMA_PROVENANCE_BLOCKED` | 3 | 3 | 0 |
| `DOES_NOT_ANSWER_GAP` | 11 | 6 | 5 |
| `DEFER_LOW_MATERIALITY` | 4 | 4 | 0 |
| **Total** | **52** | **31** | **21** |

## How the existing structures behave (these drive the classifications)

- **Cash amounts and pool-space amounts are plain columns** on `transaction_event_assets` (`cash_amount_usd`, `pool_space_amount_usd`, numeric(14,2), NULL = unknown). They are exact only: there is no amount-quality field, so an approximate figure cannot be stored as approximate (T04, T10).
- **Filling an existing NULL amount is an UPDATE of that asset.** No package membership changes. Nothing else reads these columns except `v_transaction_event_complete` and the transaction research queue, so **no value, realized-value, executive or prediction output moves** (checked through `pg_depend`; the value queue stays 79).
- **The asset has one `source_id`, already the MLB transactions record.** The source for an amount should go in an `evidence` row on the event (`entity_type` `transaction_event`, a field name, the source), which is how `evidence` is already used. A new `sources` row is a real URL only.
- **`transaction_asset_resolutions` can resolve a placeholder only to a PLAYER (`NAMED_PLAYER`) or to cash (`CASH_SETTLEMENT`, with the amount NULL allowed).** A `FUTURE_CONSIDERATIONS` placeholder can never be resolved to pool space. So Lantigua and Cingrani gain a pool-space asset beside the placeholder (the Martínez 2023 shape), and the placeholder rows stay in the queue.
- **A resolution needs a source and a resolution date** (both NOT NULL). The owner gave neither for Frías or Pérez.
- **Register ids already live on the assets.** Roberts, Muegge, García and Juárez already carry `bref_register_id`.
- **The benchmark people (Puason, Cappe, E. Rodríguez, Patiño, Gómez, Guzmán, Fernández, C. Martínez, Machado, Armenteros, Pérez, O. Rodríguez, Gastón, Larrondo) are not DISI players.** 050/055/056 left them as cohort decisions (`IDENTITY_INSUFFICIENT_EVIDENCE` or `ROUTE_NOT_ESTABLISHED`). Resolving any of them would add a player, a signing and a population member, not edit an existing row.
- Pathways `CUBAN_AMATEUR` and `CUBAN_PRO` already exist, and the routes are never guessed.

## Table 1: transaction facts

| ID | Event key | Package / player | Owner finding | Current DISI state | Classification | Amount quality | Proposed table / field | Provenance (source check) | Queue effect | Org-value effect | Materiality |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T01 | `LAD_CLE_2017_CARLOS_FRIAS` | Carlos Frías / Cleveland 2017 | The deferred PTBNL/cash outcome ultimately became cash, amount undisclosed. | INCOMING PLAYER_TO_BE_NAMED asset 77100ab3 ("Player to be named later"), no resolution; queue PTBNL_UNRESOLVED (priority 2). | `SCHEMA_PROVENANCE_BLOCKED` | UNDISCLOSED | transaction_asset_resolutions: resolution_type CASH_SETTLEMENT, resolved_asset_id NULL, cash_amount_usd NULL (the structure exists and represents "ca… | no source supplied | PTBNL_UNRESOLVED -1 once unblocked (transaction queue 57 -> 56); not proposed now. | none (cash is not an input to any value view) | LOW_MATERIALITY |
| T02 | `LAD_CWS_2024_JERAL_PEREZ` | Jeral Pérez / White Sox 2024 | The PTBNL/cash consideration ultimately became undisclosed cash. | OUTGOING PLAYER_TO_BE_NAMED asset 83942980 ("Player to be named later or cash considerations"), no resolution; queue PTBNL_UNRESOLVED (priority 2). T… | `SCHEMA_PROVENANCE_BLOCKED` | UNDISCLOSED | transaction_asset_resolutions: CASH_SETTLEMENT, cash_amount_usd NULL | no source supplied | PTBNL_UNRESOLVED -1 once unblocked (57 -> 56) | none | LOW_MATERIALITY |
| T03 | `LAD_CIN_2025_ARNALDO_LANTIGUA` | Arnaldo Lantigua / Reds 2025 | $1.5 million international bonus-pool space | INCOMING FUTURE_CONSIDERATIONS asset 8f5ac6ba only; NO pool-space asset exists on the event; queue FUTURE_CONSIDERATIONS_UNRESOLVED. | `APPLY_EXACT` | EXACT | INSERT one transaction_event_assets row: INCOMING, INTERNATIONAL_BONUS_POOL_SPACE, pool_space_amount_usd 1500000.00 (the Martinez 2023 pattern). The … | READ_SUPPORTS | none (new asset has a known amount; FUTURE_CONSIDERATIONS_UNRESOLVED stays 3) | none | LOW_MATERIALITY |
| T04 | `LAD_CWS_2023_MAXIMO_MARTINEZ` | Máximo Martínez / White Sox 2023 | roughly $1.4 million international bonus-pool money | INCOMING INTERNATIONAL_BONUS_POOL_SPACE asset 499cd8c7 with NULL amount, plus FUTURE_CONSIDERATIONS asset 0697dc03; queue POOL_SPACE_AMOUNT_UNKNOWN a… | `INSUFFICIENT_EVIDENCE` | APPROXIMATE | none | READ_DOES_NOT_SUPPORT | none (stays POOL_SPACE_AMOUNT_UNKNOWN) | none | LOW_MATERIALITY |
| T05 | `LAD_STL_2019_TONY_CINGRANI` | Cingrani / Gyorko / Cardinals 2019 (cash) | Cardinals sent $2,938,710 cash | INCOMING CASH asset dec30979 ("Cash"), amount NULL; the Cardinals sent it to the Dodgers; queue CASH_AMOUNT_UNKNOWN. | `APPLY_EXACT` | EXACT | UPDATE the existing CASH asset dec30979: cash_amount_usd = 2938710.00 (NULL -> value; no new asset, package membership unchanged). | UNREACHABLE_EMPTY_BODY | CASH_AMOUNT_UNKNOWN -1 (57 -> 56) | none | LOW_MATERIALITY |
| T06 | `LAD_STL_2019_TONY_CINGRANI` | Cingrani / Gyorko / Cardinals 2019 (pool space) | Cardinals sent $250,000 international bonus-pool space | No pool-space asset on the event; INCOMING FUTURE_CONSIDERATIONS asset 21ee26a2 exists (queue FUTURE_CONSIDERATIONS_UNRESOLVED). | `APPLY_EXACT` | EXACT | INSERT one INCOMING INTERNATIONAL_BONUS_POOL_SPACE asset, pool_space_amount_usd 250000.00. The FUTURE_CONSIDERATIONS placeholder stays (same limit as… | UNREACHABLE_EMPTY_BODY | none | none | LOW_MATERIALITY |
| T07 | `LAD_ATL_2017_ADRIAN_GONZALEZ` | Braves 2017 / González-Kemp | Dodgers sent $4.5 million cash | OUTGOING CASH asset b72070b3, amount NULL; queue CASH_AMOUNT_UNKNOWN. | `APPLY_EXACT` | EXACT | UPDATE CASH asset b72070b3: cash_amount_usd = 4500000.00. Package membership unchanged (Kemp in; González, Kazmir, McCarthy, Culberson, cash out). | READ_SUPPORTS | CASH_AMOUNT_UNKNOWN -1 | none | LOW_MATERIALITY |
| T08 | `LAD_BOS_2020_JETER_DOWNS` | Red Sox 2020 / Betts-Price | Boston sent the Dodgers $48 million | INCOMING CASH asset 0579bf73, amount NULL (Boston sent it to the Dodgers, matching the owner finding); queue CASH_AMOUNT_UNKNOWN. | `APPLY_EXACT` | EXACT | UPDATE CASH asset 0579bf73: cash_amount_usd = 48000000.00. The ESPN headline says "3 years": one lump sum on the asset; the schedule is not modelled. | UNREACHABLE_HTTP_403 | CASH_AMOUNT_UNKNOWN -1 | none | LOW_MATERIALITY |
| T09 | `LAD_CIN_2018_YASIEL_PUIG` | Reds 2018 / Puig-Kemp-Wood-Farmer | Dodgers sent Cincinnati $7 million | OUTGOING CASH asset bceba469, amount NULL; queue CASH_AMOUNT_UNKNOWN. | `APPLY_EXACT` | EXACT | UPDATE CASH asset bceba469: cash_amount_usd = 7000000.00. | UNREACHABLE_HTTP_403 | CASH_AMOUNT_UNKNOWN -1 | none | LOW_MATERIALITY |
| T10 | `LAD_CLE_2008_SANTANA_BLAKE` | Cleveland 2008 / Santana-Blake | Cleveland sent the Dodgers $2 million | INCOMING CASH asset 0ff0a74a, amount NULL; queue CASH_AMOUNT_UNKNOWN. | `SCHEMA_PROVENANCE_BLOCKED` | APPROXIMATE | none | READ_APPROXIMATE | none | none | LOW_MATERIALITY |
| T11 | `LAD_MIN_2024_RAYNE_DONCON` | Twins 2024 / Doncon-Margot (guaranteed) | Guaranteed: Dodgers sent Minnesota $6 million | OUTGOING CASH asset e7fd9f83, amount NULL; queue CASH_AMOUNT_UNKNOWN. | `APPLY_EXACT` | EXACT | UPDATE CASH asset e7fd9f83: cash_amount_usd = 6000000.00 (the guaranteed part only; NOT 8,000,000). | UNREACHABLE_HTTP_403 | CASH_AMOUNT_UNKNOWN -1 | none | LOW_MATERIALITY |
| T12 | `LAD_MIN_2024_RAYNE_DONCON` | Twins 2024 / Doncon-Margot (conditional) | Conditional: an additional $2 million if Minnesota declined Margot's 2025 option | No conditional component exists. The single OUTGOING CASH asset is the only cash on the event. | `APPLY_CONDITIONAL` | CONDITIONAL | One evidence row on the event (entity_type transaction_event, field_name conditional_cash_component) whose note states: up to $2,000,000 additional, … | UNREACHABLE_HTTP_403 | none | none | LOW_MATERIALITY |
| T13 | `LAD_NYY_2000_JOSE_VIZCAINO` | Yankees 2000 / Vizcaíno-Leyritz | Dodgers sent José Vizcaíno + $500,000 for Jim Leyritz | OUTGOING CASH asset 32d8b9dc, amount NULL (note: "unknown, never zero"); queue CASH_AMOUNT_UNKNOWN. | `INSUFFICIENT_EVIDENCE` | UNKNOWN | none | READ_DOES_NOT_SUPPORT | none | none | LOW_MATERIALITY |
| T14 | `LAD_TOR_2019_RONNY_BRITO` | Blue Jays 2019 / Martin-Brito | Toronto sent the Dodgers $16.4 million | INCOMING CASH asset 6dc8ea18, amount NULL (the event reads "for cash and C Russell Martin"); queue CASH_AMOUNT_UNKNOWN. | `APPLY_EXACT` | EXACT | UPDATE CASH asset 6dc8ea18: cash_amount_usd = 16400000.00. | UNREACHABLE_HTTP_403 | CASH_AMOUNT_UNKNOWN -1 | none | LOW_MATERIALITY |
| T15 | `LAD_ATL_2006_AYBAR_BETEMIT` | Aybar / Báez / Betemit 2006 | cash included, amount undisclosed | OUTGOING CASH asset 3ed1638d, amount NULL: DISI already records cash moving with an unknown amount. | `ALREADY_PRESENT` | UNDISCLOSED | none (no table distinguishes "undisclosed" from "unknown"; NULL is the honest value) | no source supplied | none (CASH_AMOUNT_UNKNOWN stays) | none | LOW_MATERIALITY |
| T16 | `LAD_ATL_2024_ELIO_CAMPOS` | Elio Campos / Braves 2024 | cash undisclosed | INCOMING CASH asset 84cf5018, amount NULL. | `ALREADY_PRESENT` | UNDISCLOSED | none | no source supplied | none | none | LOW_MATERIALITY |
| T17 | `LAD_NYM_1998_GREG_MCMICHAEL` | Greg McMichael / Mets 1998 | cash undisclosed | OUTGOING CASH asset b1b3dc48, amount NULL. | `ALREADY_PRESENT` | UNDISCLOSED | none | no source supplied | none | none | LOW_MATERIALITY |
| T18 | `LAD_DET_2023_EDDYS_LEONARD` | Eddys Leonard / Tigers 2023 | A general deadline statement that deals were in the $1-$100,000 range | INCOMING CASH asset 184df13b, amount NULL. | `DOES_NOT_ANSWER_GAP` | UNKNOWN | none | no source supplied | none | none | LOW_MATERIALITY |
| T19 | `LAD_KCR_1995_OFFERMAN / LAD_NYY_1996_BILLY_BREWER` | Mike Judd / José Offerman | Conditional return remains unknown. | Offerman -> Billy Brewer (1995) and Brewer -> Mike Judd (1996) are both recorded with named players; neither event has a placeholder or a queue row. | `INSUFFICIENT_EVIDENCE` | UNKNOWN | none | no source supplied | none | none | LOW_MATERIALITY |
| T20 | `LAD_DET_1960_AMOROS` | Gail Harris (Amorós trade 1960) | The research does not clearly answer the later Dodgers exit (the Sandy Amorós transaction is known). | Return asset acquired 1960-05-07; no exit, no continued-control observation; queue RETURN_ASSET_EXIT_MISSING. | `DOES_NOT_ANSWER_GAP` | UNKNOWN | none | no source supplied | none | none (Harris's value stays unresolved) | MATERIAL |
| T21 | `LAD_DET_1999_DAVE_MLICKI` | Robinson Checo | Acquisition from Detroit is established; later Dodgers exit unanswered. | Acquisition recorded (asset with bref_id checoro01); queue EXIT_NOT_RESEARCHED_DOWNSTREAM. | `DOES_NOT_ANSWER_GAP` | UNKNOWN | none | no source supplied | none | none | MATERIAL |
| T22 | `LAD_DET_1999_DAVE_MLICKI` | Apostol Garcia | No later exit supplied. | Queue EXIT_NOT_RESEARCHED_DOWNSTREAM and DOWNSTREAM_WAR_NOT_LOADED. | `INSUFFICIENT_EVIDENCE` | UNKNOWN | none | no source supplied | none | none | MATERIAL |
| T23 | `LAD_DET_1999_DAVE_MLICKI` | Rick Roberts | NYT transactions page (2000-08-25) with a DFA | Queue EXIT_NOT_RESEARCHED_DOWNSTREAM and DOWNSTREAM_WAR_NOT_LOADED; register id robert001ric already on the asset. | `DOES_NOT_ANSWER_GAP` | UNKNOWN | none | UNREACHABLE_HTTP_403 | none | none | MATERIAL |
| T24 | `LAD_ARI_2005_SHAWN_GREEN` | Danny Muegge | The 2005 Shawn Green trade establishes acquisition; it does not establish a later exit. | Acquisition recorded; queue EXIT_NOT_RESEARCHED_DOWNSTREAM and DOWNSTREAM_WAR_NOT_LOADED. | `DOES_NOT_ANSWER_GAP` | UNKNOWN | none | no source supplied | none | none | MATERIAL |
| T25 | `LAD_ARI_2005_SHAWN_GREEN` | William Juárez | Same as Muegge. | Acquisition recorded; queue EXIT_NOT_RESEARCHED_DOWNSTREAM and DOWNSTREAM_WAR_NOT_LOADED. | `DOES_NOT_ANSWER_GAP` | UNKNOWN | none | no source supplied | none | none | MATERIAL |
| T26 | `(new) LAD_FREE_AGENT_SIGNING_2010_JON_GARLAND` | Jon Garland — 2010-11-26 free-agent signing | Dodgers signed Jon Garland on 2010-11-26 for the 2011 season (one year, $5M base, incentives, 2012 option). | Events for Garland: 2009-08-31 acquisition (LAD_ARI_2009_TONY_ABREU) and 2009-11-05 free agency (LAD_FREE_AGENCY_2009_JON_GARLAND). No 2010-11-26 sig… | `APPLY_EXACT` | EXACT_DATE_ONLY | INSERT one transaction_events row (transaction_type FREE_AGENT_SIGNING, date 2010-11-26, from_organization = the Dodgers, the Casey Blake 2008 event … | READ_SUPPORTS_DATE_ONLY | DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION -1 (measured: transaction queue 57 -> 56) | none measured; the value queue stays 79 and the known spend… | MATERIAL |
| T27 | `BOS_LAD_2012_GONZALEZ_BECKETT_CRAWFORD` | 2012 Red Sox mega-trade (cash) | The research did not establish the exact financial figure. | INCOMING CASH asset 668bf477 ("Cash"), amount NULL (the two PTBNLs are already resolved to named players). | `INSUFFICIENT_EVIDENCE` | UNKNOWN | none | no source supplied | none | none | LOW_MATERIALITY |
| T28 | `CHC_LAD_2000_VALDEZ_REACQ` | Carlos Valdez / Cubs (cash) | Unknown cash; no figure supplied | OUTGOING CASH asset 2e37ad8e on CHC_LAD_2000_VALDEZ_REACQ, amount NULL (the earlier 1999 PTBNL is already resolved to Brian Stephenson). | `DEFER_LOW_MATERIALITY` | UNKNOWN | none | no source supplied | none | none | LOW_MATERIALITY |
| T29 | `LAD_CWS_2001_GARY_MAJEWSKI` | Gary Majewski / White Sox (cash) | Unknown cash; no figure supplied | INCOMING CASH asset 22edaacf, amount NULL. | `DEFER_LOW_MATERIALITY` | UNKNOWN | none | no source supplied | none | none | LOW_MATERIALITY |
| T30 | `LAD_TB_2006_DIONER_NAVARRO` | Dioner Navarro / Tampa Bay (cash) | Unknown cash; no figure supplied | INCOMING CASH asset 85d95c3d, amount NULL (the PTBNL is already resolved to Justin Ruggiano). | `DEFER_LOW_MATERIALITY` | UNKNOWN | none | no source supplied | none | none | LOW_MATERIALITY |
| T31 | `LAD_TEX_2021_BILLY_MCKINNEY` | Billy McKinney / Rangers (cash) | Unknown cash; no figure supplied | INCOMING CASH asset 4cbb93c2, amount NULL. | `DEFER_LOW_MATERIALITY` | UNKNOWN | none | no source supplied | none | none | LOW_MATERIALITY |

### Reasoning for each non-trivial transaction item

**T01 Carlos Frías / Cleveland 2017** (`SCHEMA_PROVENANCE_BLOCKED`)
- Why: transaction_asset_resolutions.source_id is NOT NULL (ON DELETE RESTRICT) and resolution_date is NOT NULL (>= the event date). The owner supplied neither a source nor a date, and DISI has no source naming the outcome. Inventing a source or a date is forbidden.
- Smallest honest fix: Owner supplies one real source and the date the PTBNL/cash was settled; then a sources row plus one CASH_SETTLEMENT resolution (cash_amount_usd NULL). No schema change.

**T02 Jeral Pérez / White Sox 2024** (`SCHEMA_PROVENANCE_BLOCKED`)
- Why: Same rule as T01: no source and no resolution date were supplied; the resolution row cannot be written without both.
- Smallest honest fix: Owner supplies a real source and settlement date; one CASH_SETTLEMENT resolution. No schema change.

**T03 Arnaldo Lantigua / Reds 2025** (`APPLY_EXACT`)
- Provenance: Source page read: "Mark Sheldon of MLB.com reported the Dodgers received $1.5 million in international bonus pool space from Cincinnati" (a blog citing MLB.com). Amount is as reported. Record it as an evidence row (entity_type transaction_event, field_name pool_space_amount_usd, source_id = a new sources row for the real URL); the asset keeps the MLB transactions source.
- Owner decision: Add a pool asset and keep the placeholder (recommended, queue unchanged) vs retype the existing FUTURE_CONSIDERATIONS asset (queue -1, but it rewrites a source-backed row).

**T04 Máximo Martínez / White Sox 2023** (`INSUFFICIENT_EVIDENCE`)
- Why: The cited page says "The amount of international slot money the Dodgers received was not announced, but teams are required to trade it in increments of $250,000". The $1,410,000 in the text is the White Sox total pool as of June 11, not the amount traded. The source does not give roughly $1.4M. Separately, pool_space_amount_usd is exact numeric(14,2) with no amount-quality field, so an approximate figure could not be stored as approximate even if it were sourced.
- Smallest honest fix: A source that states the amount traded. If it is only approximate, the smallest honest solution is an amount-quality marker (for example an amount_quality column or an evidence note); that is a schema or convention change and is not proposed.

**T05 Cingrani / Gyorko / Cardinals 2019 (cash)** (`APPLY_EXACT`)
- Provenance: Owner-supplied exact figure. The Seattle Times page returned an empty body to this audit, so the figure is NOT verified here. Evidence row (transaction_event / cash_amount_usd / new sources row) needs a captured copy before the build.

**T06 Cingrani / Gyorko / Cardinals 2019 (pool space)** (`APPLY_EXACT`)
- Provenance: Owner-supplied; same unreachable source as T05. Needs the captured source before the build.
- Owner decision: Same add-vs-retype decision as T03.

**T07 Braves 2017 / González-Kemp** (`APPLY_EXACT`)
- Provenance: Source page read: "The Dodgers are also sending cash in the deal. The amount is unknown, but reported to be $4.5 million per Jon Heyman of FanRag Sports", and later "Cash to Braves ($4.5 million)". The amount is a reported figure from a blog, not a club announcement; record it as reported, with the evidence row.

**T08 Red Sox 2020 / Betts-Price** (`APPLY_EXACT`)
- Provenance: Owner-supplied; ESPN returned HTTP 403 to this audit, so it is NOT verified here. Needs a captured copy before the build.

**T09 Reds 2018 / Puig-Kemp-Wood-Farmer** (`APPLY_EXACT`)
- Provenance: Owner-supplied; MLB.com returned HTTP 403 to this audit, so it is NOT verified here.

**T10 Cleveland 2008 / Santana-Blake** (`SCHEMA_PROVENANCE_BLOCKED`)
- Why: The source page reads "Casey Blake and about $2MM in 2008": an approximate figure, with a possibly ambiguous "in 2008". cash_amount_usd is exact numeric(14,2) with no amount-quality field, so "about $2MM" cannot be stored as such, and storing 2000000.00 would turn an approximation into an exact amount.
- Smallest honest fix: A source with the exact amount. Otherwise an amount-quality marker (an evidence note flagged APPROXIMATE, or a column); not proposed in a data-only 061.

**T11 Twins 2024 / Doncon-Margot (guaranteed)** (`APPLY_EXACT`)
- Provenance: Owner-supplied; MLB.com returned HTTP 403 to this audit, so it is NOT verified here.

**T12 Twins 2024 / Doncon-Margot (conditional)** (`APPLY_CONDITIONAL`)
- Why: A second CASH asset with 2000000 would read as cash moved; with NULL it would raise a false CASH_AMOUNT_UNKNOWN. The supplied press release is dated at the February 2024 trade and cannot show the option decision made after the 2024 season, so the trigger is unproven and the item stays conditional/unresolved.
- Provenance: Owner-supplied; source unreachable (HTTP 403).

**T13 Yankees 2000 / Vizcaíno-Leyritz** (`INSUFFICIENT_EVIDENCE`)
- Why: The cited Baseball-Almanac page reads "Traded by Los Angeles Dodgers with cash to New York Yankees in exchange for Jim Leyritz (June 20, 2000)". It names no amount, and nothing on the page contains $500,000.
- Smallest honest fix: A source that states the amount.

**T14 Blue Jays 2019 / Martin-Brito** (`APPLY_EXACT`)
- Provenance: Owner-supplied; MLB.com returned HTTP 403 to this audit, so it is NOT verified here.

**T18 Eddys Leonard / Tigers 2023** (`DOES_NOT_ANSWER_GAP`)
- Why: A league-wide range is not Leonard's amount, and a range cannot be encoded as an exact value.

**T19 Mike Judd / José Offerman** (`INSUFFICIENT_EVIDENCE`)
- Why: The owner supplied no new fact; no DISI gap blocks on it.

**T20 Gail Harris (Amorós trade 1960)** (`DOES_NOT_ANSWER_GAP`)
- Why: The Amorós transaction is the acquisition, not Harris's exit.

**T21 Robinson Checo** (`DOES_NOT_ANSWER_GAP`)
- Why: The finding repeats the acquisition DISI already has.

**T22 Apostol Garcia** (`INSUFFICIENT_EVIDENCE`)
- Why: No exit or WAR fact was supplied.

**T23 Rick Roberts** (`DOES_NOT_ANSWER_GAP`)
- Why: A designation for assignment does not end Dodgers control: the player stays in the organization until traded, released or outrighted off. It does not close the control interval. The page was also unreachable (HTTP 403).

**T24 Danny Muegge** (`DOES_NOT_ANSWER_GAP`)
- Why: Repeats the acquisition already recorded.

**T25 William Juárez** (`DOES_NOT_ANSWER_GAP`)
- Why: Repeats the acquisition already recorded.

**T26 Jon Garland — 2010-11-26 free-agent signing** (`APPLY_EXACT`)
- Provenance: Source page read: "11-26-2010 Signed by Los Angeles Dodgers (November 26, 2010)". The page does NOT state the contract terms ($5M, incentives, 2012 option); those are not recorded. The same page also lists "10-30-2011 Granted free agency", which is a possible follow-on exit event (not an owner finding, so not counted here).

**T27 2012 Red Sox mega-trade (cash)** (`INSUFFICIENT_EVIDENCE`)
- Why: No figure supplied.

**T28 Carlos Valdez / Cubs (cash)** (`DEFER_LOW_MATERIALITY`)
- Why: Cash amounts feed no value or product output; only the transaction queue counts the row.

**T29 Gary Majewski / White Sox (cash)** (`DEFER_LOW_MATERIALITY`)
- Why: Cash-only gap; no value or product effect.

**T30 Dioner Navarro / Tampa Bay (cash)** (`DEFER_LOW_MATERIALITY`)
- Why: Cash-only gap; no value or product effect.

**T31 Billy McKinney / Rangers (cash)** (`DEFER_LOW_MATERIALITY`)
- Why: Cash-only gap; no value or product effect.

## Table 2: identity / route

| ID | Person | Current issue | Owner finding | Current identity state | Classification | Proposed structure | Evidence quality | Queue effect |
|---|---|---|---|---|---|---|---|---|
| I01 | Rick Roberts | Register id for a Dodgers return asset | Candidate Register id robert001ric | The Dodgers return asset on LAD_DET_1999_DAVE_MLICKI already carries bref_register_id robert001ric. | `ALREADY_PRESENT` | none | already stored | none |
| I02 | Apostol Garcia | Bullpen page offered as identity | Bullpen page Apostol_Garcia | The asset already carries bref_register_id garcia002apo and mlb_id 472796. | `DOES_NOT_ANSWER_GAP` | none | A Bullpen page is not a Register id | none |
| I03 | Danny Muegge | Register id for a Dodgers return asset | Candidate Register id muegge001dan | The asset on LAD_ARI_2005_SHAWN_GREEN already carries bref_register_id muegge001dan and mlb_id 458260. | `ALREADY_PRESENT` | none | already stored | none |
| I04 | William Juárez | Bullpen page offered as identity | Bullpen page William_Juárez | The asset already carries bref_register_id juarez001wil and mlb_id 452705. | `DOES_NOT_ANSWER_GAP` | none | A Bullpen page is not a Register id | none |
| I05 | Robert Puason | 2019 list entry (rank 2, OAK) not matched | Baseball America player page 6917 | 056 cohort decision IDENTITY_INSUFFICIENT_EVIDENCE: a name-matching OAK signing (2019-07-02, born 2002-09-11, MLB id 691188) exists but birth year / position family does… | `INSUFFICIENT_EVIDENCE` | none | one unreachable page; a single signal is not enough to resolve | none |
| I06 | Yiddi Cappe | 2019 list entry (rank 7, SS) with no signing in the class window | Signed with Miami on 2021-01-15 for $3.5M | 056 cohort decision IDENTITY_INSUFFICIENT_EVIDENCE: no signing in the 2019 window names him. Not a DISI player. | `PARTIAL` | none | If true, this proves a 2021 Miami signing outside the 2019 class window; it does not show class membership, no earlier professional signing, or the route. Source unreachable (no response). | none |
| I07 | Enmanuel Rodríguez / Emmanuel Rodriguez | Only a spelling variant matches (MIN 2019-07-02, born 2003-02-28, MLB id 691181); the list names no club | "I believe so" | 056 cohort decision IDENTITY_INSUFFICIENT_EVIDENCE. | `INSUFFICIENT_EVIDENCE` | none | belief, no source | none |
| I08 | Wildred Patino / Wilderd Patiño | ARI 2017 list entry (rank 25, OF) | Spelling / diacritic variants of one person | 055 notes: the official transaction reads "Arizona Diamondbacks signed free agent CF Wilderd Patino" (2017-10-02) and the person record spells Wilderd Patiño. The transp… | `INSUFFICIENT_EVIDENCE` | none (the existing rule blocks it; relaxing it would weaken the identity rules,… | Club, window and position family do agree, but identity-rules.mjs does not accept a two-letter transposition. This is the one identity item an owner ruling could change. | none |
| I09 | Antonio Gomez | Published as a catcher; the matching NYY signing (2018-07-02, born 2001-11-13, MLB id 682625) does not fit the position… | DOB 2001-11-13, Caracas, Venezuela (a Google Doc) | 055 cohort decision IDENTITY_INSUFFICIENT_EVIDENCE. | `DOES_NOT_ANSWER_GAP` | none | The birth date already matches the candidate. The open question is catcher versus pitcher, which a DOB and city do not answer. The document is private (HTTP 401). | none |
| I10 | Alvin Guzman | Published OF; the matching ARI signing (2018-07-02, born 2001-10-20, MLB id 682630) does not fit the position family | "He is OF" | 055 cohort decision IDENTITY_INSUFFICIENT_EVIDENCE. | `INSUFFICIENT_EVIDENCE` | none | assertion, no source | none |
| I11 | Eduarqi / Eduarqui Fernandez | Only a spelling variant matches (MIL 2018-07-02, born 2001-11-20, MLB id 682631); the list names no club | Canonical spelling is Eduarqui Fernandez | 055 cohort decision IDENTITY_INSUFFICIENT_EVIDENCE. | `INSUFFICIENT_EVIDENCE` | none (an alias or canonical-name change needs a person match first) | A spelling preference does not establish that the listed prospect is that person; no corroborating club | none |
| I12 | Christopher Martinez (2015, #26, 3B) | A name-matching signing exists but birth year / position do not fit | Still unknown | 050 cohort decision IDENTITY_INSUFFICIENT_EVIDENCE. | `INSUFFICIENT_EVIDENCE` | none | none | none |
| I13 | Yeyson Yrizarry | DISI records a Dominican birth country; the matching official signing (Yeyson Yrizarri, TEX, 2013-07-02, MLB id 650979)… | Birth country Dominican Republic | 050 identity CONFLICT; the stored country is not rewritten. DISI player has MLB and Baseball-Reference identity NOT_FOUND. | `INSUFFICIENT_EVIDENCE` | none | The cited article is a 2013 signing roundup that could not be read (HTTP 403); a signing article normally gives a signing market, which is not a birth country. The official record points th… | none |
| I14 | Yeremy Rosario | MLB / Baseball-Reference identity NOT_FOUND | Purple Row roundup | DISI: COL, 2014, Dominican Republic, SS, bonus 800000.00 (identity_resolved false). | `DOES_NOT_ANSWER_GAP` | none | Page read: the Rockies signed shortstop Yeremy Rosario, ranked No. 22 by MLB.com, for a reported $800,000. That matches what DISI already holds, but it gives no MLB id, birth date or other … | none |
| I15 | Jonathan Amundaray | MLB / Baseball-Reference identity NOT_FOUND | MLB.com signing roundup | DISI: NYY, 2014, Venezuela, OF, bonus 1500000.00 (identity_resolved false). | `INSUFFICIENT_EVIDENCE` | none | Source unreachable (HTTP 403); a signing roundup would not by itself supply an identity key. | none |
| I16 | Jonathan Machado | Cuban signee (STL 2016, rank 17) route not established | He was only 14 | 050 cohort decision ROUTE_NOT_ESTABLISHED; not a DISI player. | `INSUFFICIENT_EVIDENCE` | none (pathway CUBAN_AMATEUR exists) | Age alone does not establish the route | none |
| I17 | Lázaro Armenteros | Cuban signee (OAK 2016, rank 10) route not established | Youth prospect, Cuba U-15, defected young, Oakland 2016; no Serie Nacional history supplied | 050 cohort decision ROUTE_NOT_ESTABLISHED. | `INSUFFICIENT_EVIDENCE` | none (CUBAN_AMATEUR would be the pathway if a source states no professional pla… | No source is cited, and the absence of a supplied pro history does not state that there was none | none |
| I18 | Yanio Pérez | Cuban signee (TEX 2016, rank 14) route not established | Played the 2013 and 2014 Cuban Serie Nacional, then signed with Texas | 050 cohort decision ROUTE_NOT_ESTABLISHED (verified TEX signing 2016-09-23, born 1995-08-10). | `INSUFFICIENT_EVIDENCE` | none (CUBAN_PRO would be the pathway) | Plausible and specific, but no source URL was supplied for the Serie Nacional seasons | none |
| I19 | Osiel Rodríguez | Cuban signee (NYY 2018, rank 9) route not established | Signed by the Yankees at 16; Cuba U-15; defected before signing | 055 cohort decision ROUTE_NOT_ESTABLISHED (signing 2018-07-29, born 2001-11-22). | `INSUFFICIENT_EVIDENCE` | none | Youth national team is not professional history, but no source states there was none | none |
| I20 | Sandy Gastón | Cuban signee (TB 2018, rank 14) route not established | 16-year-old amateur | 055 cohort decision ROUTE_NOT_ESTABLISHED (signing 2018-11-01, born 2001-12-16). | `INSUFFICIENT_EVIDENCE` | none | Source unreachable (HTTP 403); age alone would not close it | none |
| I21 | Denny Larrondo | Cuban signee (NYY 2018, rank 29) route not established | 17 years old | 055 cohort decision ROUTE_NOT_ESTABLISHED (signing 2018-07-02). | `DOES_NOT_ANSWER_GAP` | none | Page read: "The 17-year-old right-hander from Cuba was signed by the Yankees in 2018 and pitched 12 games for the Yankees' Gulf Coast League team last season". Age and nationality only; not… | none |

## Table 3: deferred residuals

| Item | Unresolved detail | Why still unknown | Materiality | Blocks value? | Recommendation |
|---|---|---|---|---|---|
| T01 Carlos Frías / Cleveland 2017 | The deferred PTBNL/cash outcome ultimately became cash, amount undisclosed. | transaction_asset_resolutions.source_id is NOT NULL (ON DELETE RESTRICT) and resolution_date is NOT NULL (>= the event date). The owner supplied neit… | LOW_MATERIALITY | no | Owner supplies one real source and the date the PTBNL/cash was settled; then a sources row plus one CASH_SETT… |
| T02 Jeral Pérez / White Sox 2024 | The PTBNL/cash consideration ultimately became undisclosed cash. | Same rule as T01: no source and no resolution date were supplied; the resolution row cannot be written without both. | LOW_MATERIALITY | no | Owner supplies a real source and settlement date; one CASH_SETTLEMENT resolution. No schema change. |
| T04 Máximo Martínez / White Sox 2023 | roughly $1.4 million international bonus-pool money | The cited page says "The amount of international slot money the Dodgers received was not announced, but teams are required to trade it in increments … | LOW_MATERIALITY | no | Leave unknown unless a source states the amount |
| T10 Cleveland 2008 / Santana-Blake | Cleveland sent the Dodgers $2 million | The source page reads "Casey Blake and about $2MM in 2008": an approximate figure, with a possibly ambiguous "in 2008". cash_amount_usd is exact nume… | LOW_MATERIALITY | no | A source with the exact amount. Otherwise an amount-quality marker (an evidence note flagged APPROXIMATE, or … |
| T13 Yankees 2000 / Vizcaíno-Leyritz | Dodgers sent José Vizcaíno + $500,000 for Jim Leyritz | The cited Baseball-Almanac page reads "Traded by Los Angeles Dodgers with cash to New York Yankees in exchange for Jim Leyritz (June 20, 2000)". It n… | LOW_MATERIALITY | no | Leave unknown unless a source states the amount |
| T18 Eddys Leonard / Tigers 2023 | A general deadline statement that deals were in the $1-$100,000 range | A league-wide range is not Leonard's amount, and a range cannot be encoded as an exact value. | LOW_MATERIALITY | no | Leave unknown unless a source states the amount |
| T19 Mike Judd / José Offerman | Conditional return remains unknown. | The owner supplied no new fact; no DISI gap blocks on it. | LOW_MATERIALITY | no | Leave unknown unless a source states the amount |
| T20 Gail Harris (Amorós trade 1960) | The research does not clearly answer the later Dodgers exit (the Sandy Amorós transaction… | The Amorós transaction is the acquisition, not Harris's exit. | MATERIAL | yes | Needs an exit/WAR source (the Dodgers-control interval); queue for the next transaction research batch |
| T21 Robinson Checo | Acquisition from Detroit is established; later Dodgers exit unanswered. | The finding repeats the acquisition DISI already has. | MATERIAL | yes | Needs an exit/WAR source (the Dodgers-control interval); queue for the next transaction research batch |
| T22 Apostol Garcia | No later exit supplied. | No exit or WAR fact was supplied. | MATERIAL | yes | Needs an exit/WAR source (the Dodgers-control interval); queue for the next transaction research batch |
| T23 Rick Roberts | NYT transactions page (2000-08-25) with a DFA | A designation for assignment does not end Dodgers control: the player stays in the organization until traded, released or outrighted off. It does not… | MATERIAL | yes | Needs an exit/WAR source (the Dodgers-control interval); queue for the next transaction research batch |
| T24 Danny Muegge | The 2005 Shawn Green trade establishes acquisition; it does not establish a later exit. | Repeats the acquisition already recorded. | MATERIAL | yes | Needs an exit/WAR source (the Dodgers-control interval); queue for the next transaction research batch |
| T25 William Juárez | Same as Muegge. | Repeats the acquisition already recorded. | MATERIAL | yes | Needs an exit/WAR source (the Dodgers-control interval); queue for the next transaction research batch |
| T27 2012 Red Sox mega-trade (cash) | The research did not establish the exact financial figure. | No figure supplied. | LOW_MATERIALITY | no | Leave unknown unless a source states the amount |
| T28 Carlos Valdez / Cubs (cash) | Unknown cash; no figure supplied | Cash amounts feed no value or product output; only the transaction queue counts the row. | LOW_MATERIALITY | no | Defer: cash-only; no output reads it |
| T29 Gary Majewski / White Sox (cash) | Unknown cash; no figure supplied | Cash-only gap; no value or product effect. | LOW_MATERIALITY | no | Defer: cash-only; no output reads it |
| T30 Dioner Navarro / Tampa Bay (cash) | Unknown cash; no figure supplied | Cash-only gap; no value or product effect. | LOW_MATERIALITY | no | Defer: cash-only; no output reads it |
| T31 Billy McKinney / Rangers (cash) | Unknown cash; no figure supplied | Cash-only gap; no value or product effect. | LOW_MATERIALITY | no | Defer: cash-only; no output reads it |
| I02 Apostol Garcia | Bullpen page offered as identity | A Bullpen page is not a Register id | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I04 William Juárez | Bullpen page offered as identity | A Bullpen page is not a Register id | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I05 Robert Puason | 2019 list entry (rank 2, OAK) not matched | one unreachable page; a single signal is not enough to resolve | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I06 Yiddi Cappe | 2019 list entry (rank 7, SS) with no signing in the class window | If true, this proves a 2021 Miami signing outside the 2019 class window; it does not show class membership, no earlier professional signing, or the r… | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I07 Enmanuel Rodríguez / Emmanuel Rodriguez | Only a spelling variant matches (MIN 2019-07-02, born 2003-02-28, MLB id 691181); the lis… | belief, no source | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I08 Wildred Patino / Wilderd Patiño | ARI 2017 list entry (rank 25, OF) | Club, window and position family do agree, but identity-rules.mjs does not accept a two-letter transposition. This is the one identity item an owner … | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I09 Antonio Gomez | Published as a catcher; the matching NYY signing (2018-07-02, born 2001-11-13, MLB id 682… | The birth date already matches the candidate. The open question is catcher versus pitcher, which a DOB and city do not answer. The document is privat… | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I10 Alvin Guzman | Published OF; the matching ARI signing (2018-07-02, born 2001-10-20, MLB id 682630) does … | assertion, no source | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I11 Eduarqi / Eduarqui Fernandez | Only a spelling variant matches (MIL 2018-07-02, born 2001-11-20, MLB id 682631); the lis… | A spelling preference does not establish that the listed prospect is that person; no corroborating club | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I12 Christopher Martinez (2015, #26, 3B) | A name-matching signing exists but birth year / position do not fit | none | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I13 Yeyson Yrizarry | DISI records a Dominican birth country; the matching official signing (Yeyson Yrizarri, T… | The cited article is a 2013 signing roundup that could not be read (HTTP 403); a signing article normally gives a signing market, which is not a birt… | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I14 Yeremy Rosario | MLB / Baseball-Reference identity NOT_FOUND | Page read: the Rockies signed shortstop Yeremy Rosario, ranked No. 22 by MLB.com, for a reported $800,000. That matches what DISI already holds, but … | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I15 Jonathan Amundaray | MLB / Baseball-Reference identity NOT_FOUND | Source unreachable (HTTP 403); a signing roundup would not by itself supply an identity key. | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I16 Jonathan Machado | Cuban signee (STL 2016, rank 17) route not established | Age alone does not establish the route | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I17 Lázaro Armenteros | Cuban signee (OAK 2016, rank 10) route not established | No source is cited, and the absence of a supplied pro history does not state that there was none | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I18 Yanio Pérez | Cuban signee (TEX 2016, rank 14) route not established | Plausible and specific, but no source URL was supplied for the Serie Nacional seasons | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I19 Osiel Rodríguez | Cuban signee (NYY 2018, rank 9) route not established | Youth national team is not professional history, but no source states there was none | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I20 Sandy Gastón | Cuban signee (TB 2018, rank 14) route not established | Source unreachable (HTTP 403); age alone would not close it | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |
| I21 Denny Larrondo | Cuban signee (NYY 2018, rank 29) route not established | Page read: "The 17-year-old right-hander from Cuba was signed by the Yankees in 2018 and pitched 12 games for the Yankees' Gulf Coast League team las… | LOW_MATERIALITY | no | Leave unresolved; needs a primary source |

Every identity / route item is low materiality for value: none is a tracked Dodgers return or a Dodgers signing, and none of them sits in the transaction or value queue. They sit in the benchmark queue (`BENCHMARK_IDENTITY_UNRESOLVED` 3, `POPULATION_MEMBERS_NOT_TRACKED` 10), which this audit does not propose to move.

## Proposed 061 build scope (not built)

Data only. Ten transaction items, zero identity items.

1. **Exact cash / pool-space amounts (8).**
   - Confirmed in the cited page (2): **T03** Lantigua pool space `1500000.00` (INSERT an INCOMING pool-space asset); **T07** Braves 2017 cash `4500000.00` (UPDATE `b72070b3`).
   - Owner-supplied, source must be captured before the build (6): **T05** Cingrani cash `2938710.00` (UPDATE `dec30979`); **T06** Cingrani pool space `250000.00` (INSERT); **T08** Betts/Price cash `48000000.00` (UPDATE `0579bf73`); **T09** Puig cash `7000000.00` (UPDATE `bceba469`); **T11** Doncon guaranteed cash `6000000.00` (UPDATE `e7fd9f83`); **T14** Martin/Brito cash `16400000.00` (UPDATE `6dc8ea18`).
2. **Undisclosed consideration resolutions (0).** T01 and T02 are blocked on a real source and a settlement date.
3. **Conditional financial components (1).** **T12** Doncon: up to $2,000,000 more if Minnesota declined Margot's 2025 option, as an evidence note, never as an amount; the trigger is not established.
4. **Missing transaction chronology / events (1).** **T26** Garland `FREE_AGENT_SIGNING` 2010-11-26 (one event, one PLAYER asset; no cash and no salary). Optional follow-on for the owner: the same page lists his 2011-10-30 free agency.
5. **Identity / register / alias facts (0).**
6. **Country / route / classification facts (0).**

Writes: 1 `transaction_events` row, 2 `transaction_event_assets` inserts, 6 `transaction_event_assets` updates (each NULL to a value, and nothing else on the row), up to 8 `sources` rows (real URLs), and one `evidence` row per amount or date plus one for the conditional note. Items are excluded when classified insufficient, does-not-answer-gap or deferred-low-materiality.

### Measured effect (a rolled-back transaction on a copy of the replay through 060)

| | Before | After all ten |
|---|---:|---:|
| Transaction queue | 57 | **50** (six `CASH_AMOUNT_UNKNOWN` and one `DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION` leave) |
| Value queue | 79 | 79 |
| Known Dodgers acquisition cost | 127632237.33 | 127632237.33 |
| Pool-space inserts (Lantigua, Cingrani) | | change nothing: their `FUTURE_CONSIDERATIONS` rows stay |

CASH_AMOUNT_UNKNOWN goes 17 to 11. If a source for T05/T08/T09/T11/T14 cannot be captured, each is removed from the build and the matching queue row stays.

## Decisions the owner needs to make

1. **Capture or confirm the five unreachable pages behind the six items** (Seattle Times for T05/T06, ESPN for T08, and three MLB.com pages for T09, T11/T12 and T14), or accept the owner-reviewed figures without them. This audit cannot tell you they are right or wrong.
2. **Lantigua and Cingrani pool space:** add a pool asset and keep the placeholder (recommended), or retype the placeholder (queue -1, rewrites a source-backed row).
3. **Frías and Pérez:** supply one real source and settlement date each; both are otherwise ready.
4. **Martínez** needs a source for the amount actually traded, and **Blake** an exact figure; an approximate marker would be a schema or convention change.
5. **Patiño:** only an identity-rule ruling could move it; the audit does not propose weakening the rule.
6. **Garland 2011 exit** (optional follow-on).

## Schema / provenance blockers

- `SCHEMA_PROVENANCE_BLOCKED`: 3 (T01, T02: missing source and date input, no schema change; T10: no amount-quality field).
- **Schema change required for the proposed 061 payload: NO.**
- The approximate-amount limit (T04, T10) would need a schema change or a convention; neither is proposed.

## Not touched

bWAR (the 39 `BWAR_MISSING` cases belong to 062), `player_mlb_team_season_war`, CAREER_BWAR observations, signing bonuses, the prediction layer, production, deployments, frozen migrations 001-060, and 060's SQL and rollback bytes.

## Method and limits

- Replay: the canonical chain through 060 in PGlite (`baseline.json`); production was not read.
- Sources: each cited URL was requested once, read-only, on 2026-11-05. Pages that returned 403/401/empty or no response are recorded as such in `mapping.json` (`source_check`); nothing was inferred from what such a page probably says.
- The effect table comes from an in-memory experiment that was rolled back; no migration SQL was written.
