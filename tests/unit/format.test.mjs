import { test } from 'node:test'
import assert from 'node:assert/strict'
import { money, moneyExact, bwar, num, humanize, dateLabel, statusLabel, auditLabel, yesNoUnknown, MISSING } from '../../lib/format.js'

test('missing values never render as zero', () => {
  for (const fn of [money, moneyExact, bwar, num, humanize, dateLabel]) {
    assert.equal(fn(null), MISSING)
    assert.equal(fn(undefined), MISSING)
    assert.equal(fn(''), MISSING)
  }
  assert.equal(yesNoUnknown(null), 'Unknown')
})

test('a real zero is still zero', () => {
  assert.equal(money(0), '$0')
  assert.equal(bwar(0), '0.0')
  assert.equal(yesNoUnknown(false), 'No')
})

test('money formatting', () => {
  assert.equal(money(10000), '$10K')
  assert.equal(money(397500), '$397.5K')
  assert.equal(money(1850000), '$1.85M')
  assert.equal(money(25700000), '$25.7M')
  assert.equal(money(100000), '$100K')
  assert.equal(money('120000.00'), '$120K')
  assert.equal(moneyExact(25700000), '$25,700,000')
})

test('bWAR keeps sign and one decimal', () => {
  assert.equal(bwar(-2.4), '-2.4')
  assert.equal(bwar('95.000'), '95.0')
})

test('labels', () => {
  assert.equal(humanize('LATAM_AMATEUR'), 'LatAm Amateur')
  assert.equal(humanize('MLB_PIPELINE_TOP_PROSPECT'), 'MLB Pipeline Top Prospect')
  assert.equal(dateLabel('1956-07-14'), 'Jul 14, 1956')
  assert.equal(statusLabel('LAST_MLB_APPEARANCE_2022'), 'Last MLB season 2022')
  assert.equal(statusLabel('ACTIVE_MLB_2026'), 'Active in MLB (2026)')
  assert.equal(statusLabel('HOF'), 'Retired · Hall of Fame')
  assert.equal(auditLabel('NOT_AUDITED'), 'Not audited')
})
