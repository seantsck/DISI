# 061 post-audit evidence amendment

The audit in `audit-report.md` (commit `60c6dc4`) classified 52 owner items. This amendment records what changed **after** it, from the owner's reviewed evidence decisions of 2026-11-05 and a new read of the cited pages. The original audit files are preserved unchanged; the machine-readable form is `amendment.json`, and what each page said, when it was read and how is in `source-capture-amendment.json`.

| Item | In the audit | In the build | Why it changed |
|---|---|---|---|
| Gyorko cash $2,938,710 | exact, source unreadable | exact | A readable corroborating page (the True Blue LA payroll worksheet) lists `Cash from St. Louis (Gyorko) -$2,938,710`. It shows no wire citation, so none is claimed. |
| Cingrani pool $250,000 | exact | **removed**; a known component with amount NULL | The Cardinals' announcement names 2019/2020 International Cap Space and no amount. 250,000 would be inferred from trading increments. |
| Betts / Price $48,000,000 | exact, source unreadable | exact | MLB.com (archive snapshot) and the Associated Press on Boston.com (read directly) both state it. |
| Puig-Kemp-Wood-Farmer $7,000,000 | exact, source unreadable | exact | MLB.com (archive snapshot) plus the payroll worksheet line. |
| Martin / Brito $16,400,000 | exact, source unreadable | exact | MLB.com (archive snapshot): Toronto agreed to pick up $16.4 million of the salary. Recorded as the trade's cash consideration, not a Dodgers cost. |
| Gonzalez-Kemp $4,500,000 | exact, confirmed | unchanged | Reported per Jon Heyman; recorded as reported. |
| Lantigua $1,500,000 pool space | exact, confirmed | unchanged | The placeholder is kept, not retyped. |
| Margot | $6,000,000 exact; $2,000,000 conditional, trigger unproven | **two separate components; the condition is now triggered** | The Associated Press (2024-11-01) reports the option was declined and that Los Angeles will pay Minnesota an additional $2 million on Dec. 1, 2026. The additional amount is a distinct CASH asset that says it is owed, not paid. |
| Carlos Frias | SCHEMA_PROVENANCE_BLOCKED | **HOLD**: no write | The named Cleveland announcement answered HTTP 403 and has no archive copy. It was never read, so it cannot be registered as a source, and a resolution cannot be written on an unread source. The structure is ready (CASH_SETTLEMENT, amount NULL, 2017-01-30). |
| Jeral Perez | SCHEMA_PROVENANCE_BLOCKED | unchanged, unresolved | The official record still reads player to be named later or cash considerations. |
| Garland | signing 2010-11-26 only | signing **and** exit 2011-10-30 | The MLB.com transaction list gives both ends; the exit closes the interval the signing opens. The 2009 interval is untouched. |

Net: 8 exact financial facts, 0 undisclosed resolutions, 1 known component with an unknown amount, 2 events. Measured on the replay: transaction queue 57 -> 51, value queue 79 -> 79 (`before-after.json`).

Still not written: Martinez, Vizcaino, Blake, Perez, the low-materiality residuals and every identity / route item.
