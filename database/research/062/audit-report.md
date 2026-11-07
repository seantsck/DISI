# 062 audit: the 39 BWAR_MISSING players

**Gate result: no numeric write is supported under the existing schema. No migration is built.** `SCHEMA_CHANGE_REQUIRED = YES`
for any of the 39 to close now; that change is an owner decision and is not made here.

The baseline is canonical `main` `7e30624`, frozen through 061 (65 migrations). Production, read-only on 2026-11-06 after the 061 freeze:
verifier 259/259, generation 16, drift 0, `CAREER_BWAR` 58, `BWAR_MISSING` 39, transaction queue 51, value queue 79. The canonical 001-061
replay (`baseline-build.json`) reproduces every logical value; it is one snapshot generation behind (15).

| Class | Players |
|---|---:|
| `APPLY_NUMERIC` | 0 |
| `NO_MLB_BUT_SEMANTICS_SUPPORTED` | 0 |
| `IDENTITY_BLOCKED` | 0 |
| `SOURCE_BLOCKED` | 12 |
| `NOT_CURRENTLY_ASSESSABLE` | 27 |
| `ALREADY_PRESENT` | 0 |
| **Total** | **39** |

## What the numeric evidence is

- **Accepted by the provider rule.** The 017 trigger `player_metric_observations_check_provider` accepts a `CAREER_BWAR` row only if its source URL
  starts with `baseball-reference.com`. The only WAR data sources that pass are the live files (`war_daily_bat.txt` and `war_daily_pitch.txt`)
  that 032, 035 and 059 read at 2026-09-28 (bat `ef920800…`, pitch `061df2f8…`).
  - Those bytes are not on this machine: `research-output/032-work/raw` is gone.
  - The live URL still answers 403 behind a Cloudflare challenge, which is not worked around.
  - So no value can honestly cite those rows.
- **Readable but rejected by the provider rule.** These are the two Internet Archive captures 057 pinned:
  - batting, 2026-09-11, taken mid-season for 2026;
  - pitching, 2026-02-10, which ends with 2025.

  Their source rows cite `web.archive.org`, so the trigger refuses them for `CAREER_BWAR`. This is what 059 recorded as "a separate decision".
- **No later capture.** The Internet Archive index has no capture of either file after those two.
- **MLB Stats API.** The official person record of each player (pinned in `source-capture.json`) is used only for two things:
  - to corroborate identity;
  - to list which MLB seasons exist, which shows whether a capture holds the whole career.

  No game, plate-appearance or other count is turned into WAR.

## Step 5: semantics of players without an MLB career

- **What `CAREER_BWAR` represents.** It is a dated, career-to-date Baseball-Reference MLB bWAR observation, as 017 and 059 define it. It is
  numeric and NOT NULL, with no "not applicable" state. The absence of a row is the unknown state, and `v_player_war.career_bwar` is NULL.
- **Whether absence of an MLB career supports a numeric zero.** No. `BWAR_MISSING` is raised only for `reached_mlb_verified` players, so a
  player without an MLB career never enters this queue, and nothing in the schema, tests or product reads a missing observation as 0.0.
- **The 39.** All 39 are verified MLB players with a recorded debut, so `NO_MLB_BUT_SEMANTICS_SUPPORTED` is 0 and no zero is considered for
  anyone.
- **Máximo Acosta.** DISI already holds his MLB Baseball-Reference id `acostma02` (MLBAM 691185, debut 2025-08-18 with Miami), not only the
  register id. He is classified like the others.

## Step 6: identity

- **Hard keys match for all 39.** MLBAM id, birth date and MLB debut match the Stats API. The Baseball-Reference / MLBAM pair is the same in
  both captures, in both directions: no id carries a second id. Every capture season is an MLB season of that player.
- **One spelling variant, recorded and not changed:** Emmanuel DeJesus. The Stats API spells him "Enmanuel De Jesus"; every hard key matches.
- No identity write is needed or proposed.

## SOURCE_BLOCKED (12): complete career in the captures, not citable

Each of these players:
- has no 2026 MLB appearance per the Stats API;
- has every MLB season (batting with PA, and pitching) present in the captures.

The value below is the 032 / 059 pattern applied to the capture rows: the sum of BAT + PITCH WAR (a NULL WAR is left out, never read as 0),
rounded to one decimal half away from zero. **None is written.**

| Player | bref / MLBAM | Capture rows | BAT | PITCH | Raw | 1 dp |
|---|---|---|---:|---:|---:|---:|
| Wander Franco | francwa01 / 677551 | BAT 2021-2023 | 11.25 | — | 11.25 | 11.3 |
| Vladimir Gutiérrez | gutievl01 / 661269 | BAT + PITCH 2021, 2022, 2024 | −0.13 | 1.11 | 0.98 | 1.0 |
| Gilberto Celestino | celesgi01 / 665482 | BAT 2021-2022 | 0.24 | — | 0.24 | 0.2 |
| Jorge Oña | onajo01 / 671250 | BAT 2020 | 0.20 | — | 0.20 | 0.2 |
| Orelvis Martínez | martior01 / 682619 | BAT 2024 (file value 0.00) | 0.00 | — | 0.00 | 0.0 |
| Máximo Acosta | acostma02 / 691185 | BAT 2025 | −0.03 | — | −0.03 | 0.0 |
| Símon Muzziotti | muzzisi01 / 665922 | BAT 2022 | −0.05 | — | −0.05 | −0.1 |
| Ronald Bolaños | bolanro01 / 671790 | BAT + PITCH 2019-2022 | −0.07 | −0.03 | −0.10 | −0.1 |
| Francisco Morales | moralfr02 / 672839 | BAT (NULL) + PITCH 2022 | — | −0.12 | −0.12 | −0.1 |
| Marco Luciano | luciama01 / 682617 | BAT 2023-2024 | −0.30 | — | −0.30 | −0.3 |
| Norge Ruiz | ruizno01 / 650204 | BAT (NULL) + PITCH 2022 | — | −0.38 | −0.38 | −0.4 |
| Andry Lara | laraan01 / 691251 | BAT (NULL) + PITCH 2025 | — | −0.40 | −0.40 | −0.4 |

Caveats if these are ever written:
- **Two values show as 0.0.** Martínez's 0.00 is the file's own value, and Acosta's −0.03 rounds to 0.0 (the 059 precedent is Espinoza,
  −0.02 → 0.0). Neither is a fabricated zero, but `numeric(9,3)` could store the unrounded value.
- **The five pitchers mix two file versions:** batting from 2026-09-11 and pitching from 2026-02-10. 057 accepted the same mix for team-season
  rows.

## NOT_CURRENTLY_ASSESSABLE (27): played in MLB in 2026

These players need a post-2026-season capture of both files, whatever the provider rule says:
- **24 batted in 2026.** The batting capture is from 2026-09-11, before the season ended.
- **3 pitched in 2026.** The pitching capture ends with 2025.

A pitcher who does not bat has no batting-file row in the DH era. So "no 2026 batting row" never means "did not play".

| Batted in 2026 (PA per the Stats API) | |
|---|---|
| Adael Amador 95 · Andrés Giménez 508 · Cristian Pache 8 · Everson Pereira 111 · Fernando Tatis Jr. 704 · Francisco Álvarez 420 · Gabriel Arias 149 · George Valera 38 | |
| Jasson Domínguez 222 · Juan Soto 482 · Julio Rodríguez 654 · Kevin Alcántara 28 · Leody Taveras 482 · Lourdes Gurriel Jr. 201 · Luis García Jr. 543 · Luis Matos 21 | |
| Luis Robert Jr. 230 · Miguel Amaya 254 · Noelvi Marte 201 · Osleivis Basabe 143 · Rafael Marchán 95 · Randy Arozarena 670 · Ronny Mauricio 62 · Vladimir Guerrero Jr. 609 | |

| Pitched in 2026 (G) | |
|---|---|
| Adrián Morejón 76 · Cionel Pérez 40 (Nationals and Mets) · Emmanuel DeJesus 30 | |

The 11 loaded by 057 (Soto, Guerrero Jr., Tatis Jr., Giménez, Taveras, Pache, Marchán, Amaya, DeJesus, Celestino, Muzziotti) hold team-season rows
through 2025.
- **Celestino and Muzziotti** have no 2026 appearance, so their career is complete in the captures (`SOURCE_BLOCKED`). This corrects 057's note
  that "all eleven played in 2026".
- **The other nine** are here.
- No through-2025 total is offered as a current value: a 10-season window that is complete is not a complete career.

## What would close them (owner decisions, none taken here)

1. **The 12 `SOURCE_BLOCKED`.** Amend the 017 provider rule so `CAREER_BWAR` also accepts a `WAR_DATA_FILE` / `BASEBALL_REFERENCE` source whose URL is
   a `web.archive.org/web/<timestamp>id_/` capture of a `baseball-reference.com` URL. This applies the 057 owner decision ("archived captures are
   canonical evidence") to the metric layer.
   - It is a function change, so a schema change. The 12 observations would then cite the 057 capture sources, with no new source.
   - `BWAR_MISSING` 39 → 27 and `CAREER_BWAR` 58 → 70.
2. **The 27 `NOT_CURRENTLY_ASSESSABLE`.** These need an Internet Archive capture of both files taken after the 2026 season, and the rule change in (1).
3. **Without either decision,** the 39 stay NULL, which is correct: unknown is not zero.

## Superseded for 062 (2026-11-06)

The owner then supplied owner-observed current career bWAR for all 39 players, read from their current Baseball-Reference pages.
- 062 writes those values (data only), not the archived values above. The archived-copy provider rule is withdrawn.
- This report stays the pre-decision gate record, and its identity verification still holds.
- See `amendment.md`.
