// Research-script configuration. Everything is overridable through environment
// variables so public endpoints stay isolated from application code.
// No credentials are used or needed: all endpoints are public and read-only.

export const config = {
  statsApiBase: process.env.MLB_STATS_API_BASE || 'https://statsapi.mlb.com/api/v1',
  brefDataBase: process.env.BREF_DATA_BASE || 'https://www.baseball-reference.com/data',
  cacheDir: process.env.DISI_RESEARCH_CACHE || '.cache/mlb',
  outputDir: process.env.DISI_RESEARCH_OUTPUT || 'research-output',
  // Polite pacing between live requests (milliseconds) and retry policy.
  minIntervalMs: Number(process.env.DISI_RESEARCH_INTERVAL_MS || 750),
  retries: Number(process.env.DISI_RESEARCH_RETRIES || 3),
  userAgent: process.env.DISI_RESEARCH_USER_AGENT || 'DISI research scripts (public-data baseball research; contact via repository)',
  // The Dodgers' MLB Stats API team id.
  dodgersTeamId: 119,
}

/** MLB Stats API endpoint builders. */
export function statsApi(base = config.statsApiBase) {
  return {
    person: (id) => `${base}/people/${id}`,
    personIdentity: (id) => `${base}/people/${id}?hydrate=xrefId`,
    teams: (season) => `${base}/teams?sportId=1&season=${season}`,
    personTransactions: (id) => `${base}/transactions?playerId=${id}`,
    teamTransactions: (teamId, startDate, endDate) =>
      `${base}/transactions?teamId=${teamId}&startDate=${startDate}&endDate=${endDate}`,
    mlbSeasons: (id, group) => `${base}/people/${id}/stats?stats=yearByYear&group=${group}&sportId=1`,
    milbSeasons: (id, group) => `${base}/people/${id}/stats?stats=yearByYear&group=${group}&leagueListId=milb_all`,
    peopleSearch: (name) => `${base}/people/search?names=${encodeURIComponent(name)}`,
    // Game-level log for a season (used by player-game-levels to resolve exact
    // first/last appearance dates where the API supports them).
    gameLog: (id, group, season) => `${base}/people/${id}/stats?stats=gameLog&group=${group}&season=${season}`,
  }
}

export function brefData(base = config.brefDataBase) {
  return {
    warBatting: `${base}/war_daily_bat.txt`,
    warPitching: `${base}/war_daily_pitch.txt`,
  }
}
