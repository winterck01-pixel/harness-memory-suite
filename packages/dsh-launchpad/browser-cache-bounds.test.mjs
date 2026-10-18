import test from 'node:test'
import assert from 'node:assert/strict'
import { pruneMap, pruneObject, pruneAliasedMap } from './browser-cache-bounds.js'

test('pruneMap removes oldest unprotected entries and keeps protected work', () => {
  const cache = new Map([
    ['old-terminal', { active: false }],
    ['active', { active: true }],
    ['new-terminal', { active: false }],
  ])

  pruneMap(cache, 2, value => value.active)

  assert.deepEqual([...cache.keys()], ['active', 'new-terminal'])
})

test('pruneMap remains soft-bounded when every entry is protected', () => {
  const cache = new Map([['active-a', true], ['active-b', true]])
  pruneMap(cache, 1, Boolean)
  assert.equal(cache.size, 2)
})

test('pruneObject trims oldest terminal status records while retaining active statuses', () => {
  const ledger = { 'old:1': 'completed', 'run:2': 'polling', 'new:3': 'failed' }

  pruneObject(ledger, 2, status => ['queued', 'waiting', 'submitting', 'polling', 'running', 'processing'].includes(status))

  assert.deepEqual(ledger, { 'run:2': 'polling', 'new:3': 'failed' })
})

test('pruneAliasedMap evicts idle records with all aliases, preserving protected records', () => {
  const idle = { active: false }
  const observed = { active: true }
  const records = new Map([['old-account', idle], ['active-account', observed], ['model-key', idle]])
  const aliases = new Map([['video:old-model', 'old-account'], ['image:active-model', 'active-account']])

  pruneAliasedMap(records, aliases, 1, record => record.active)

  assert.deepEqual([...records.keys()], ['active-account'])
  assert.deepEqual([...aliases], [['image:active-model', 'active-account']])
})
