# Asset identity resolution

Rules: `player_id` only for DISI tracked signings (no `players` row is created for a return asset); `mlb_id` is the official
MLBAM person id; `bref_id` is the Baseball-Reference major-league / career id and its constraint is unchanged;
`bref_register_id` is the separate Register (minor-league) identifier. Nothing was guessed: an id appears only where an
official or Baseball-Reference record carries it.

## How each id was established

| Population | MLB id | Baseball-Reference id |
|---|---|---|
| Tracked signings (145 assets) | `players.mlb_id` (verified in 020), re-checked by the audit | `players.bref_id` where the signing reached MLB |
| 2009+ non-tracked players | the person id on the official transaction rows of the same transaction (not a name search) | the `player_ID` the Baseball-Reference WAR files carry for that MLB id |
| Pre-2009 MLB players | `mlb_ID` in the WAR files for the Baseball-Reference id | the link target on the team-year transaction page |
| Pre-2009 minor leaguers | none | Register id from the link target on the team-year page (`/register/player.fcgi?id=...`) |

## Register ids (9)

Melvin Geho `geho--001mel` (1957), Rick Clelland `clella001ric` (1995), Arnie Gooch `gooch-001arn` (1998), Jorge Nunez
`nunez-001jor` (1999), Chad Ricketts `ricket001rob` (1999), Brian Stephenson `stephe002bri` (1999), Orlando Rodriguez
`rodrig005orl` (2001), Andre Simpson `simpso001and` (2001), Carlos Ortega `ortega001car` (2001, outgoing). Each Register page
was fetched once to confirm it is a minor-league record. The format constraint is
`^[a-z][a-z-]{2,5}[0-9]{3}[a-z]{1,4}$` (hyphens appear for short surnames).

## Verified MLB ids called out in Phase 1

Angel German 642549, Breyvic Valera 591971, Dean Kremer 665152, Rylan Bannon 676625, Zach Pop 647315 (previously unresolved
existing assets). Mike Antonini 502103: the Hu trade's row names "Michael Antonini"; the official person record is Mike Antonini,
so the asset uses the canonical name and one identity.

## Coverage

266 PLAYER assets: 145 `player_id`, 257 `mlb_id`, 150 `bref_id`, 9 `bref_register_id`, 0 without any identity. The 9 Register
players carry no MLB id (pre-2009 minor leaguers); Antonini, Miller, Vasquez, Brito and Oliver Gonzalez carry an MLB id and
no Baseball-Reference id because no MLB appearance has been observed (each has a dated no-MLB-appearance observation).
