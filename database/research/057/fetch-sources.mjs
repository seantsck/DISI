#!/usr/bin/env node
// Retrieves (with --fetch) and verifies the two archived Baseball-Reference WAR data files pinned in source-capture.json.
//
//   node database/research/057/fetch-sources.mjs [--fetch] [raw-dir]     (default raw-dir: research-output/057-work/raw, gitignored)
//
// The capture is read in the Internet Archive's raw mode (`id_`), so the payload is the original response body exactly as archived (gzip-
// encoded). Verified: the archived payload's SHA-1 in base32 equals the Internet Archive CDX digest, its SHA-256 and size are as recorded,
// and the decoded file's SHA-256, size, data rows, last season and rows in that season are as recorded. Refuses on any difference. Nothing
// is written except the raw files (with --fetch).

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const args = process.argv.slice(2)
const fetchFirst = args.includes('--fetch')
const rawDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(root, 'research-output/057-work/raw'))
const capture = JSON.parse(fs.readFileSync(path.join(here, 'source-capture.json'), 'utf8'))
const need = (cond, msg) => { if (!cond) throw new Error(msg) }

export const base32 = (buf) => {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0, v = 0, out = ''
  for (const x of buf) { v = (v << 8) | x; bits += 8; while (bits >= 5) { out += a[(v >>> (bits - 5)) & 31]; bits -= 5 } }
  if (bits > 0) out += a[(v << (5 - bits)) & 31]
  return out
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')

/** Reads, verifies and decodes one recorded capture; returns the decoded text. */
export function readCapture(spec, dir = rawDir) {
  const archived = fs.readFileSync(path.join(dir, spec.raw_file))
  need(archived.length === spec.archived_payload_bytes, `${spec.raw_file}: ${archived.length} bytes, recorded ${spec.archived_payload_bytes}`)
  need(sha256(archived) === spec.archived_payload_sha256, `${spec.raw_file}: archived payload SHA-256 differs from source-capture.json`)
  need(base32(crypto.createHash('sha1').update(archived).digest()) === spec.cdx_digest, `${spec.raw_file}: the payload is not the one the Internet Archive digest names`)
  const decoded = zlib.gunzipSync(archived)
  need(decoded.length === spec.decoded_bytes && sha256(decoded) === spec.decoded_sha256, `${spec.raw_file}: decoded SHA-256 differs from source-capture.json`)
  const text = decoded.toString('utf8')
  const lines = text.split('\n').filter((l) => l.length)
  const year = lines[0].split(',').indexOf('year_ID')
  const seasons = lines.slice(1).map((l) => Number(l.split(',')[year]))
  const max = seasons.reduce((m, y) => (y > m ? y : m), 0)
  need(seasons.length === spec.data_rows, `${spec.raw_file}: ${seasons.length} data rows, recorded ${spec.data_rows}`)
  need(max === spec.max_season && seasons.filter((y) => y === max).length === spec.rows_in_max_season, `${spec.raw_file}: last season or its row count differs`)
  return text
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(rawDir, { recursive: true })
  for (const spec of capture.files) {
    if (fetchFirst) {
      const res = await fetch(spec.url, { headers: { 'accept-encoding': 'identity', 'user-agent': 'DISI research (archived source verification)' } })
      need(res.ok, `${spec.url}: HTTP ${res.status}`)
      fs.writeFileSync(path.join(rawDir, spec.raw_file), Buffer.from(await res.arrayBuffer()))
      await new Promise((r) => setTimeout(r, 3000))
    }
    readCapture(spec)
    process.stderr.write(`${spec.component}: ${spec.url} verified (CDX ${spec.cdx_digest}, decoded SHA-256 ${spec.decoded_sha256}, ${spec.data_rows} rows, last season ${spec.max_season})\n`)
  }
}
