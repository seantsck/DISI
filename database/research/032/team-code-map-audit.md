# Migration 032: team-code map audit

Every Baseball-Reference team code that appears in the 754 loaded rows is mapped to a DISI organization with the
seasons the code is used. A code can resolve to a franchise whose DISI organization row has a different name
(BRO and LAD are both the Dodgers franchise; MON and WSN the Nationals; ANA, CAL and LAA the Angels; FLA and MIA the
Marlins; TBD and TBR the Rays). No mapping exists for a code the seed does not use.

| Code | Organization | From | To | Rows loaded | Note |
|---|---|---|---|---|---|
| ANA | LAA | 1997 | 2004 | 3 | Anaheim Angels |
| ARI | ARI | 1998 | open | 16 | Arizona Diamondbacks |
| ATL | ATL | 1966 | open | 4 | Atlanta Braves |
| BAL | BAL | 1954 | open | 19 | Baltimore Orioles |
| BOS | BOS | 1901 | open | 35 | Boston Red Sox |
| BRO | BRO | 1884 | 1957 | 6 | Brooklyn Dodgers (Dodgers franchise) |
| CAL | LAA | 1965 | 1996 | 2 | California Angels |
| CHC | CHC | 1876 | open | 6 | Chicago Cubs |
| CHW | CWS | 1901 | open | 9 | Chicago White Sox (B-Ref code CHW) |
| CIN | CIN | 1890 | open | 11 | Cincinnati Reds |
| CLE | CLE | 1901 | open | 16 | Cleveland franchise |
| COL | COL | 1993 | open | 10 | Colorado Rockies |
| DET | DET | 1901 | open | 12 | Detroit Tigers |
| FLA | MIA | 1993 | 2011 | 4 | Florida Marlins (Miami franchise) |
| HOU | HOU | 1962 | open | 28 | Houston franchise |
| KCR | KC | 1969 | open | 8 | Kansas City Royals (B-Ref code KCR) |
| LAA | LAA | 2005 | open | 4 | Los Angeles Angels |
| LAD | LAD | 1958 | open | 313 | Los Angeles Dodgers (Dodgers franchise) |
| MIA | MIA | 2012 | open | 0 | Miami Marlins |
| MIL | MIL | 1970 | open | 5 | Milwaukee Brewers |
| MIN | MIN | 1961 | open | 4 | Minnesota Twins |
| MON | WSH | 1969 | 2004 | 12 | Montreal Expos (Washington franchise) |
| NYM | NYM | 1962 | open | 26 | New York Mets |
| NYY | NYY | 1903 | open | 12 | New York Yankees |
| OAK | OAK | 1968 | open | 0 | Oakland Athletics |
| PHI | PHI | 1883 | open | 20 | Philadelphia Phillies |
| PIT | PIT | 1887 | open | 44 | Pittsburgh Pirates |
| SDP | SD | 1969 | open | 26 | San Diego Padres (B-Ref code SDP) |
| SEA | SEA | 1977 | open | 9 | Seattle Mariners |
| SFG | SFG | 1958 | open | 13 | San Francisco Giants |
| STL | STL | 1892 | open | 5 | St. Louis Cardinals |
| TBD | TB | 1998 | 2007 | 4 | Tampa Bay Devil Rays (Rays franchise) |
| TBR | TB | 2008 | open | 5 | Tampa Bay Rays |
| TEX | TEX | 1972 | open | 22 | Texas Rangers |
| TOR | TOR | 1977 | open | 29 | Toronto Blue Jays |
| WSN | WSH | 2005 | open | 12 | Washington Nationals (B-Ref code WSN) |

- Codes used by loaded rows: 34. Unmapped codes: 0. Rows outside their code's season range: 0.
- A row whose code has no mapping would stay visible with `organization_id` NULL and appear as `TEAM_HISTORY_UNRESOLVED`; none does.
- The trigger refuses any organization other than the one the map names.
