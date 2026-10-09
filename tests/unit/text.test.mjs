import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldText, slugify, searchTokens } from '../../lib/text.js'

test('foldText lower-cases and strips diacritics', () => {
  assert.equal(foldText('Yadier Álvarez'), 'yadier alvarez')
  assert.equal(foldText('Samuel Muñoz'), 'samuel munoz')
  assert.equal(foldText('Øystein Łukasz Đorđe'), 'oystein lukasz dorde')
  assert.equal(foldText(null), '')
})

test('slugify produces canonical URL slugs', () => {
  assert.equal(slugify('Hung-Chih Kuo'), 'hung-chih-kuo')
  assert.equal(slugify('Chin-lung Hu'), 'chin-lung-hu')
  assert.equal(slugify('Yuliangel De La Cruz'), 'yuliangel-de-la-cruz')
  assert.equal(slugify("  O'Neil  Cruz  "), 'o-neil-cruz')
  assert.equal(slugify('Álvarez'), 'alvarez')
  assert.equal(slugify('***'), '')
})

test('searchTokens removes LIKE and PostgREST metacharacters', () => {
  assert.deepEqual(searchTokens('Pedro Martínez'), ['pedro', 'martinez'])
  assert.deepEqual(searchTokens('100% pe_dro*'), ['100', 'pe', 'dro'])
  assert.deepEqual(searchTokens('a,b(c)'), ['a', 'b', 'c'])
  assert.deepEqual(searchTokens('   '), [])
  assert.equal(searchTokens('a b c d e f g h').length, 6)
})
