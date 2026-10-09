#!/usr/bin/env node
// Reconciles a published class list (one name per line, or CSV with a "name"
// column) against an org-signings artifact. Reports matches, names on the list
// without a transaction, and transactions not on the list.
//
//   node scripts/mlb/reconcile-class.mjs --list class-2025.txt --signings research-output/org-signings-119-2025/org-signings.json

import fs from 'node:fs'
import { config } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { reconcileClassList, findDuplicateNames } from './lib/classify.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const listText = fs.readFileSync(requireArg(args, 'list', 'class list file'), 'utf8')
const lines = listText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
const header = lines[0].toLowerCase().split(',')
const nameCol = header.indexOf('name')
const names = nameCol >= 0 ? lines.slice(1).map((l) => l.split(',')[nameCol].trim()) : lines
const artifact = JSON.parse(fs.readFileSync(requireArg(args, 'signings', 'org-signings.json'), 'utf8'))
const signings = artifact.records.filter((r) => !r.error)

const { matched, unmatchedList, unmatchedSignings } = reconcileClassList(names, signings)
const records = [
  ...matched.map((m) => ({ status: 'LISTED_AND_TRANSACTION', name: m.listedName, mlbId: m.signing.mlbId, transactionDate: m.signing.transactionDate })),
  ...unmatchedList.map((n) => ({ status: 'LISTED_NO_TRANSACTION', name: n, mlbId: null, transactionDate: null })),
  ...unmatchedSignings.map((s) => ({ status: 'TRANSACTION_NOT_LISTED', name: s.fullName, mlbId: s.mlbId, transactionDate: s.transactionDate })),
]
const outDir = args.out || `${config.outputDir}/reconcile-class`
const files = writeArtifact(outDir, 'reconcile-class', {
  meta: { command: 'reconcile-class', listCount: names.length, duplicateListNames: findDuplicateNames(names.map((n) => ({ fullName: n }))).map((d) => d.name) },
  records,
  sortKeys: ['status', 'name'],
  columns: ['status', 'name', 'mlbId', 'transactionDate'],
})
process.stderr.write(`${matched.length} matched, ${unmatchedList.length} listed-only, ${unmatchedSignings.length} transaction-only → ${files.join(', ')}\n`)
