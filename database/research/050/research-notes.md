# Migration 050: research notes

Every decision below is in `identity-research.json` (signals), `outcome-research.json` (outcome facts) and `cohort-decisions.json` (what the
migration did). Retrieved 2026-10-22; the audit boundary stays 2026-10-05.

## The lists

- **2015.** The official MLB Pipeline feed as captured on 2015-05-11 (`last_updated` 2015-05-11T20:38:53Z): 30 international prospects ranked
  before the 2015-16 signing period opened, with no club. Clubs are read from the same feed's later revision (captured 2019-04-30,
  `last_updated` 2018-12-06), which names where each listed player signed. That revision is itself a different ranking (it added Yadier Álvarez,
  Vladimir Gutiérrez, Yusniel Díaz, Alfredo Rodríguez, Eddie Martínez, Lucius Fox and Lázaro Armenteros and dropped seven) and is recorded, not used.
- **2016.** No capture of the feed exists from before the 2016-17 period opened; the earliest (captured 2017-09-16, `last_updated` 2017-05-27) is
  the list inside the period, naming each club. Its later revision kept every member and no longer names a club for four Atlanta signees
  (Kevin Maitan, Abrahan Gutierrez, Yunior Severino, Yenci Peña); the official log shows each of them signing again with another club in
  2017-18. Their 2016 Atlanta signing is the benchmark signing; the later signings are recorded in `outcome-research.json`.
- The 2016 ranking was updated after these players signed, so it is a signing-period observation and gives no signing-time expectation feature
  (the 039 cutoff rule); the 2015 ranking predates every 2015 signing.

## Every listed player

| List | Rank | Published name | List club | MLB id (match) | Official signing | Route | Outcome at 2026-10-05 | Decision |
|---|---|---|---|---|---|---|---|---|
| 2015 | 1 | Jhailyn Ortiz | PHI | 665560 | PHI 2015-07-10 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 2 | Vladimir Guerrero Jr. | TOR | 665489 | TOR 2015-07-02 | OTHER | MLB 2019-04-26 | added |
| 2015 | 3 | Starling Heredia | LAD | 665752 | LAD 2015-07-02 | — | — | Dodgers signing (mapped, untouched) |
| 2015 | 4 | Wander Javier | MIN | 665820 | MIN 2015-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 5 | Seuly Matias | KC | 665890 | KC 2015-07-04 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 6 | Alvaro Seijas | STL | 661099 | STL 2015-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 7 | Daniel Montano | COL | 665914 | COL 2015-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 8 | Gilberto Celestino | HOU | 665482 | HOU 2015-07-02 | LATAM_AMATEUR | MLB 2021-06-02 | added |
| 2015 | 9 | Yonathan Perlaza | CHC | 666632 | CHC 2015-08-26 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 10 | Cristian Pache | ATL | 665506 | ATL 2015-07-04 | LATAM_AMATEUR | MLB 2020-08-21 | added |
| 2015 | 11 | Albert Guaimaro | — | 665911 | BOS 2015-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 12 | Andres Gimenez | NYM | 665926 | NYM 2015-07-02 | LATAM_AMATEUR | MLB 2020-07-24 | added |
| 2015 | 13 | Yonathan Sierra Estiwal | CHC | 666626 (variant: Jonathan Sierra) | CHC 2015-08-23 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 14 | Gregory Guerrero | NYM | 665872 | NYM 2015-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 15 | Leodys Taveras | TEX | 665750 (variant: Leody Taveras) | TEX 2015-07-02 | LATAM_AMATEUR | MLB 2020-07-24 | added |
| 2015 | 16 | Aramis Ademan | CHC | 666620 | CHC 2015-08-23 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 17 | Anderson Amarista | — | 665915 | COL 2015-07-19 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 18 | Ronny Brito | LAD | 665798 | LAD 2015-07-02 | — | — | Dodgers signing (mapped, untouched) |
| 2015 | 19 | Juan Soto | WSH | 665742 | WSH 2015-07-02 | LATAM_AMATEUR | MLB 2018-05-15 | added |
| 2015 | 20 | Cristian Olivo | CIN | 665891 | CIN 2015-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 21 | Derian Cruz | ATL | 665505 | ATL 2015-07-04 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 22 | Miguel Aparicio | — | 665918 | TEX 2015-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 23 | Miguel Amaya | CHC | 665804 | CHC 2015-07-17 | LATAM_AMATEUR | MLB 2023-05-04 | added |
| 2015 | 24 | Simon Muzziotti | — | 665922 | BOS 2015-07-02 | LATAM_AMATEUR | MLB 2022-04-11 | added |
| 2015 | 25 | Fernando Tatis Jr. | CWS | 665487 | CWS 2015-07-02 | LATAM_AMATEUR | MLB 2019-03-28 | added |
| 2015 | 26 | Christopher Martinez | — | — | — | — | — | not added: INSUFFICIENT_EVIDENCE |
| 2015 | 27 | Jeison Guzman | — | 665834 | KC 2015-07-03 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 28 | Rafael Marchan | — | 665561 | PHI 2015-07-03 | LATAM_AMATEUR | MLB 2020-09-14 | added |
| 2015 | 29 | Carlos Vargas | SEA | 665799 | SEA 2015-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2015 | 30 | Franklin Reyes | — | 665485 | CWS 2015-07-02 | OTHER | no MLB debut | added |
| 2016 | 1 | Luis Robert | CWS | 673357 | CWS 2017-05-27 | CUBAN_PRO | MLB 2020-07-24 | added |
| 2016 | 2 | Kevin Maitan | ATL | 670867 | ATL 2016-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2016 | 3 | Adrian Morejon | SD | 670970 | SD 2016-07-07 | CUBAN_PRO | MLB 2019-07-21 | added |
| 2016 | 4 | Norge Ruiz | OAK | 650204 | OAK 2016-12-23 | CUBAN_PRO | MLB 2022-08-19 | added |
| 2016 | 5 | Cionel Perez | HOU | 672335 | HOU 2016-12-09 | CUBAN_PRO | MLB 2018-07-11 | added |
| 2016 | 6 | Vladimir Gutierrez | CIN | 661269 | CIN 2016-09-07 | CUBAN_PRO | MLB 2021-05-28 | added |
| 2016 | 7 | Lourdes Gurriel | TOR | 666971 | TOR 2016-11-12 | CUBAN_PRO | MLB 2018-04-20 | added |
| 2016 | 8 | Alfredo Rodriguez | CIN | 670895 | CIN 2016-07-04 | CUBAN_PRO | no MLB debut | added |
| 2016 | 9 | Luis Almanzar | SD | 671275 | SD 2016-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2016 | 10 | Lazaro Armenteros | OAK | 670860 | OAK 2016-07-02 | — | — | not added: route not established |
| 2016 | 11 | Gabriel Arias | SD | 672356 | SD 2016-07-02 | LATAM_AMATEUR | MLB 2022-04-20 | added |
| 2016 | 12 | Jorge Ona | SD | 671250 | SD 2016-07-20 | CUBAN_AMATEUR | MLB 2020-09-07 | added |
| 2016 | 13 | Luis Garcia | WSH | 671277 | WSH 2016-07-02 | OTHER | MLB 2020-08-14 | added |
| 2016 | 14 | Yanio Perez | TEX | 672350 | TEX 2016-09-23 | — | — | not added: route not established |
| 2016 | 15 | Freudis Nova | HOU | 671265 | HOU 2016-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2016 | 16 | Jeisson Rosario | SD | 671271 | SD 2016-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2016 | 17 | Jonathan Machado | STL | 671054 | STL 2016-07-15 | — | — | not added: route not established |
| 2016 | 18 | David Garcia | TEX | 671272 | TEX 2016-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2016 | 19 | Victor Garcia | STL | 671270 | STL 2016-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2016 | 20 | Randy Arozarena | STL | 668227 | STL 2016-08-01 | CUBAN_PRO | MLB 2019-08-14 | added |
| 2016 | 21 | Yasel Antuna | WSH | 671276 | WSH 2016-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2016 | 22 | Jordy Barley | SD | 672357 | SD 2016-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2016 | 23 | Francisco Morales | PHI | 672839 | PHI 2016-07-02 | LATAM_AMATEUR | MLB 2022-05-09 | added |
| 2016 | 24 | Ronald Bolanos | SD | 671790 | SD 2016-08-11 | CUBAN_PRO | MLB 2019-09-03 | added |
| 2016 | 25 | Abrahan Gutierrez | ATL | 670868 | ATL 2016-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2016 | 26 | Yunior Severino | ATL | 670870 | ATL 2016-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2016 | 27 | Jose Sanchez | WSH | 672566 | WSH 2016-07-13 | LATAM_AMATEUR | no MLB debut | added |
| 2016 | 28 | Yerdeluis Vargas | OAK | 670864 (variant: Yerdel Vargas) | OAK 2016-07-02 | LATAM_AMATEUR | no MLB debut | added |
| 2016 | 29 | Yenci Pena | ATL | 672562 | ATL 2016-07-13 | LATAM_AMATEUR | no MLB debut | added |
| 2016 | 30 | Marcos Brito | OAK | 670862 | OAK 2016-07-02 | LATAM_AMATEUR | no MLB debut | added |

Notes on the table:
- A one-letter or prefix variant is accepted only with the list's own club: Leodys / Leody Taveras (TEX), Yonathan Sierra Estiwal / Jonathan
  Sierra (CHC), Yerdeluis / Yerdel Vargas (OAK). Accent-only differences (Andrés Giménez) are exact.
- Luis García Jr. (born in New York), Vladimir Guerrero Jr. (born in Montreal) and Franklin Reyes (born in the United States) signed in the
  international period; their signing market is not sourced, so `country_market` is NULL and the pathway is `OTHER`, never inferred from a
  birthplace. They count toward support (labels need no market) but are not in the model rows (an incomplete feature is never imputed).
- Símon Muzziotti signed with Boston on 2015-07-02 and, per the official log, with Philadelphia on 2016-07-05; the 2015 Boston signing is the
  benchmark signing (the first signing in the class window), and the second is recorded.
- Christopher Martinez: the list names no club; the only name-matching signing in the window does not fit the published entry (birth year or
  position), so he is not resolved.

## Cuban signees: the route

| Player | Evidence | Route |
|---|---|---|
| Luis Robert Jr. | "Robert played in the Cuban National Series for Ciego de Ávila from 2013 to 2015." | `CUBAN_PRO` |
| Adrián Morejón | "He appeared in the Cuban National Series for the Huracanes de Mayabeque that year." | `CUBAN_PRO` |
| Norge Ruiz | official record: Caribbean Series 2013, 2014 (Cuba); account: Cuban National Series, Camagüey | `CUBAN_PRO` |
| Cionel Pérez | "Pérez played two seasons for Matanzas of the Cuban National Series." | `CUBAN_PRO` |
| Vladimir Gutiérrez | "He played in the Cuban National Series for the Vegueros de Pinar del Río ..." | `CUBAN_PRO` |
| Lourdes Gurriel Jr. | official record: Caribbean Series 2015 (Cuba); account: debuted in the Cuban National Series in 2010 | `CUBAN_PRO` |
| Alfredo Rodríguez | "Rodríguez began his professional career in the Cuban National Series for Isla de la Juventud." | `CUBAN_PRO` |
| Randy Arozarena | "During the 2013-14 and 2014-15 seasons, Arozarena played for Vegueros de Pinar del Río ..." | `CUBAN_PRO` |
| Ronald Bolaños | "Before coming to the United States, Bolaños played for Mayabeque of the Cuban National Series." | `CUBAN_PRO` |
| Jorge Oña | "He began his professional career in 2017 with the Fort Wayne TinCaps ..." (after his 2016 signing) | `CUBAN_AMATEUR` |
| Lázaro Armenteros | the account mentions youth play and his US debut only | not established: not added |
| Yanio Pérez | no account found | not established: not added |
| Jonathan Machado | no account found | not established: not added |

A professional route keeps a signing in the benchmark population (its outcome is shown) but out of every amateur training row (041
`PROFESSIONAL_ROUTE`). The Wikipedia accounts are tier `OTHER` and are used for the route only, never for identity, outcome or WAR.

## The five legacy identities (035)

| Slug | Tracker (013) | Result | Evidence |
|---|---|---|---|
| `emmanuel-dejesus` | BOS 2013, LHP, Venezuela | **RESOLVED**, MLB 646241 (Enmanuel De Jesus) | official signing BOS 2013-08-09 ("signed free agent LHP Enmanuel De Jesus"); the tracker's club; one-letter first name and spacing variant; born 1996-12-10 in Venezuela, equal in the register; pitcher. Reached MLB 2023-09-09 (32 games); no Baseball-Reference row is loaded |
| `micker-zapata` | CWS 2013, OF, Dominican Republic | **RESOLVED**, MLB 650520 (Micker Adolfo) | official signing CWS 2013-07-02 ("signed free agent RF Micker Adolfo"); the person record's maternal surname is Zapata; the tracker's club; born 1996-09-11 in the Dominican Republic, equal in the register; outfielder. No MLB debut; not flagged active |
| `yeyson-yrizarry` | TEX 2013, SS, Dominican Republic | **CONFLICT** | the only matching official signing is Yeyson Yrizarri (MLB 650979, TEX 2013-07-02, a one-letter variant), born in Venezuela; the tracker row records the Dominican Republic. The disagreement stays open: no identity, no audit, the stored country is not rewritten |
| `yeremy-rosario` | COL 2014, SS, Dominican Republic | INSUFFICIENT_EVIDENCE | no Colorado signing transaction in the 2014-15 window names a matching player; no MLB person record by that name |
| `jonathan-amundaray` | NYY 2014, OF, Venezuela | INSUFFICIENT_EVIDENCE | no Yankees signing transaction in the 2014-15 window names a matching player; no MLB person record by that name |

The two resolved legacy rows keep their tracker name; the MLB record name is an alias (`MLB_RECORD_NAME`). Their signing date is not written
(none of the 43 rows 035 resolved carries one, and it would move the signing-time feature cutoff); it is in `identity-research.json`.

## bWAR

The 23 reachers (10 from 2015, 12 from 2016, Emmanuel DeJesus) have no Baseball-Reference team-season row in DISI and the data files answer 403,
so none is loaded. Their bWAR-target labels stay NULL; their `outcomes.career_war` is NULL; each is a `BENCHMARK_REACHED_WITHOUT_TEAM_SEASON_FACTS`
queue item. No other WAR system or estimate is used.

## Signing bonuses

Neither the feed nor the transaction log states a bonus. Every new benchmark bonus is NULL (`BENCHMARK_BONUS_UNKNOWN`); no bonus is inferred.
