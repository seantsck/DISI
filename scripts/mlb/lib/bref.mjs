// Baseball-Reference WAR data files (war_daily_bat.txt, war_daily_pitch.txt).
// Career bWAR = sum of batting WAR rows + sum of pitching WAR rows for the
// player's mlb_ID (pitchers' batting WAR is part of their Baseball-Reference
// total). The formula is validated against existing DISI bWAR values before use.

/** Minimal CSV line parser (the files have no quoted commas in used columns). */
function splitLine(line) {
  return line.split(',')
}

/**
 * Aggregates per-player WAR for the requested MLB ids.
 * @param {string} text  file contents
 * @param {Set<number>} mlbIds
 * @returns {Map<number, { brefId: string, warHundredths: number, firstYear: number, lastYear: number, rows: number }>}
 */
export function aggregateWar(text, mlbIds) {
  const lines = text.split(/\r?\n/)
  const header = splitLine(lines[0])
  const col = (name) => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`Column ${name} missing from WAR file`)
    return i
  }
  const iId = col('mlb_ID'), iBref = col('player_ID'), iYear = col('year_ID'), iWar = col('WAR')
  const out = new Map()
  for (let n = 1; n < lines.length; n += 1) {
    const line = lines[n]
    if (!line) continue
    const f = splitLine(line)
    const id = Number(f[iId])
    if (!mlbIds.has(id)) continue
    // WAR has two decimals in the files; summing integer hundredths keeps totals exact.
    const hundredths = f[iWar] === 'NULL' || f[iWar] === '' ? 0 : Math.round(Number(f[iWar]) * 100)
    const year = Number(f[iYear])
    const cur = out.get(id) || { brefId: f[iBref], warHundredths: 0, firstYear: year, lastYear: year, rows: 0 }
    cur.warHundredths += hundredths
    cur.firstYear = Math.min(cur.firstYear, year)
    cur.lastYear = Math.max(cur.lastYear, year)
    cur.rows += 1
    out.set(id, cur)
  }
  return out
}

/**
 * One decimal, rounding half away from zero as Baseball-Reference displays it
 * (-3.25 → -3.3, 38.75 → 38.8). Validated against all 42 page-keyed DISI values.
 */
export function roundWar(x) {
  return (Math.sign(x) * Math.round(Math.abs(x) * 10 + 1e-9)) / 10
}

/** Combines batting and pitching aggregates into career bWAR (one decimal). */
export function careerBwar(batting, pitching, mlbIds) {
  const out = []
  for (const id of [...mlbIds].sort((a, b) => a - b)) {
    const b = batting.get(id)
    const p = pitching.get(id)
    if (!b && !p) continue
    out.push({
      mlbId: id,
      brefId: (b || p).brefId,
      careerBwar: roundWar(((b?.warHundredths ?? 0) + (p?.warHundredths ?? 0)) / 100),
      firstYear: Math.min(b?.firstYear ?? Infinity, p?.firstYear ?? Infinity),
      lastYear: Math.max(b?.lastYear ?? -Infinity, p?.lastYear ?? -Infinity),
    })
  }
  return out
}
