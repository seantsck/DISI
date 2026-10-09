// Polite HTTP client for public research endpoints: request pacing, retries
// with backoff on 429 / 5xx / network errors, and an on-disk cache so reruns are
// reproducible and do not hit the network again. Every response carries the
// exact URL and the time it was retrieved.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export class HttpError extends Error {
  /** @param {string} url @param {number} status */
  constructor(url, status) {
    super(`HTTP ${status} for ${url}`)
    this.url = url
    this.status = status
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {{
 *   cacheDir?: string | null,
 *   minIntervalMs?: number,
 *   retries?: number,
 *   userAgent?: string,
 *   fetchImpl?: typeof fetch,
 *   now?: () => Date,
 *   log?: (msg: string) => void,
 *   offline?: boolean,
 *   backoffMs?: number,
 * }} [options]
 */
export function createClient(options = {}) {
  const {
    cacheDir = null,
    minIntervalMs = 750,
    retries = 3,
    userAgent = 'DISI research scripts',
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    log = (msg) => process.stderr.write(`${msg}\n`),
    offline = false,
    backoffMs = 1000,
  } = options
  let lastRequest = 0
  const stats = { network: 0, cache: 0, retries: 0, errors: 0 }

  const cacheFile = (url) => cacheDir && path.join(cacheDir, `${createHash('sha256').update(url).digest('hex').slice(0, 40)}.json`)

  async function pace() {
    const wait = lastRequest + minIntervalMs - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequest = Date.now()
  }

  /** @param {string} url @returns {Promise<{ url: string, body: string, retrievedAt: string, fromCache: boolean }>} */
  async function getText(url) {
    const file = cacheFile(url)
    if (file && fs.existsSync(file)) {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'))
      stats.cache += 1
      return { url, body: cached.body, retrievedAt: cached.retrievedAt, fromCache: true }
    }
    if (offline) throw new Error(`Offline mode: ${url} is not cached`)

    for (let attempt = 0; ; attempt += 1) {
      await pace()
      try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json, text/plain, */*' } })
        if (res.status === 429 || res.status >= 500) throw Object.assign(new HttpError(url, res.status), { retryable: true })
        if (!res.ok) throw new HttpError(url, res.status)
        const body = await res.text()
        const retrievedAt = now().toISOString()
        stats.network += 1
        if (file) {
          fs.mkdirSync(path.dirname(file), { recursive: true })
          fs.writeFileSync(file, JSON.stringify({ url, retrievedAt, status: res.status, body }))
        }
        return { url, body, retrievedAt, fromCache: false }
      } catch (error) {
        const retryable = error.retryable || !(error instanceof HttpError)
        if (!retryable || attempt >= retries) {
          stats.errors += 1
          throw error
        }
        stats.retries += 1
        const backoff = backoffMs * 2 ** attempt
        log(`retry ${attempt + 1}/${retries} in ${backoff}ms: ${error.message}`)
        await sleep(backoff)
      }
    }
  }

  /** @param {string} url */
  async function getJson(url) {
    const res = await getText(url)
    return { ...res, data: JSON.parse(res.body) }
  }

  return { getText, getJson, stats }
}
