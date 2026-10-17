import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTaskInjectionPolicy as policy } from '../lib/task-injection-policy.js'

const item = (id, extra = {}) => ({ id, activeSeq: 1, source: 'agent', trust: 'unverified', kind: 'fact', text: 'private memory', ...extra })
const ids = result => result.items.map(entry => (entry.item ?? entry).id)

test('high relevance trial and unverified strategy cannot enter automatic injection', () => {
  const items = [item('trial', { source: 'task-trial', score: 100 }), item('evidence', { evidence: { source: 'task-trial' } }), item('state', { experienceState: 'trial' }), item('skill', { kind: 'skill', score: 200 }), item('confirmed', { kind: 'skill', trust: 'confirmed' }), item('admitted', { experienceState: 'trial', trust: 'confirmed' })]
  const result = policy({ items })
  assert.deepEqual(ids(result), ['confirmed', 'admitted'])
  assert.equal(result.stats.filtered, 4)
  assert.equal(items[0].trust, 'unverified')
})

test('runtime failed turns cap only general agent unverified facts without judging exposure set', () => {
  const items = [item('a'), item('b'), item('c'), item('human', { source: 'human' }), item('confirmed', { trust: 'confirmed' }), item('reported', { trust: 'reported' })]
  const before = structuredClone(items)
  assert.deepEqual(ids(policy({ items, failureStreak: 1 })), items.map(i => i.id))
  assert.deepEqual(ids(policy({ items, failureStreak: 2 })), ['a', 'b', 'human', 'confirmed', 'reported'])
  assert.deepEqual(ids(policy({ items, failureStreak: 20, options: { unverifiedAgentLimit: 1 } })), ['a', 'human', 'confirmed', 'reported'])
  assert.deepEqual(items, before)
  assert.equal(policy({ items, failureStreak: 20 }).decisions.find(d => d.id === 'c').reason, 'runtime-failure-agent-limit')
})

test('human and pinned rules survive suppressions and applicability mismatch with visible conflicts', () => {
  const items = [item('human-rule', { source: 'human', kind: 'rule', applicability: { tool: 'ssh' } }), item('pinned-rule', { pinned: true, kind: 'rule' }), item('human-fact', { source: 'human' })]
  const result = policy({ items, taskFeatures: { tool: 'browser' }, suppressed: items.map(i => ({ id: i.id, version: 1 })), failureStreak: 100 })
  assert.deepEqual(ids(result), ['human-rule', 'pinned-rule'])
  assert.equal(result.stats.protectedSuppressionConflicts, 2)
})

test('suppression applies to exact active version only and revised memory becomes usable', () => {
  const items = [item('old'), item('updated', { activeSeq: 2 }), item('no-version', { activeSeq: null }), item('typed', { activeSeq: 1 })]
  const suppressed = [{ id: 'old', version: 1 }, { id: 'updated', version: 1 }, { id: 'no-version', version: null }, { id: 'typed', version: '1' }]
  assert.deepEqual(ids(policy({ items, suppressed })), ['updated', 'no-version', 'typed'])
})

test('explicit structural metadata uses exact field values and never infers match from text', () => {
  const items = [item('match', { applicability: { tools: ['ssh', 'read'], prerequisites: { writable: false } } }), item('order', { applicability: { tools: ['read', 'ssh'] } }), item('nested', { applicability: { prerequisites: { writable: false, extra: true } } }), item('unknown', { text: 'ssh read writable false' })]
  const result = policy({ items, taskFeatures: { tools: ['ssh', 'read'], prerequisites: { writable: false }, target: 'audit' } })
  assert.deepEqual(ids(result), ['match', 'unknown'])
  assert.equal(result.decisions.at(-1).applicability, 'unknown')
  assert.equal(policy({ items }).decisions[0].applicability, 'unchecked')
})

test('policy is pure across repeated assemble and separate task-local state inputs', () => {
  const input = { items: [item('a', { touches: 999 }), item('b'), item('c')], failureStreak: 2, suppressed: [{ id: 'a', version: 1 }] }
  const snapshot = structuredClone(input)
  const first = policy(input)
  assert.deepEqual(policy(input), first)
  assert.deepEqual(input, snapshot)
  const moreReads = structuredClone(input)
  moreReads.items.forEach(i => { i.touches = (i.touches ?? 0) + 100; i.readCount = 500 })
  assert.deepEqual(policy(moreReads).decisions, first.decisions)
  assert.deepEqual(ids(policy(moreReads)), ids(first))
  assert.deepEqual(ids(policy({ items: input.items })), ['a', 'b', 'c'])
  assert.deepEqual(ids(first), ['b', 'c'])
  assert.strictEqual(first.items[0], input.items[1])
})

test('shadow reports safe filtering while enforce is the default', () => {
  const input = { items: [item('trial', { source: 'task-trial' }), item('safe', { source: 'human' })] }
  assert.deepEqual(ids(policy(input)), ['safe'])
  const shadow = policy({ ...input, options: { mode: 'shadow' } })
  assert.deepEqual(ids(shadow), ['trial', 'safe'])
  assert.equal(shadow.stats.wouldFilter, 1)
  assert.equal(shadow.stats.filtered, 0)
  assert.equal(shadow.decisions[0].action, 'would-filter')
  assert.ok(!JSON.stringify({ stats: shadow.stats, decisions: shadow.decisions }).includes('private memory'))
})

test('wrapped hits retain their score, order and identity; failure words do not classify memories', () => {
  const hits = [{ item: item('word', { source: 'human', text: '失败了也不要删' }), score: 0.9 }, { item: item('neutral', { text: 'success' }), score: 0.7 }]
  const result = policy({ items: hits })
  assert.deepEqual(ids(result), ['word', 'neutral'])
  assert.strictEqual(result.items[0], hits[0])
  assert.equal(result.items[1].score, 0.7)
})

test('configuration is bounded and does not leak process state', () => {
  const items = [item('a'), item('b')]
  assert.deepEqual(ids(policy({ items, failureStreak: 1, options: { failureStreakThreshold: 1, unverifiedAgentLimit: 0 } })), [])
  assert.deepEqual(ids(policy({ items, failureStreak: 1, options: { failureStreakThreshold: -1, unverifiedAgentLimit: -10 } })), ['a', 'b'])
  assert.deepEqual(policy({ items: null, options: null }).items, [])
})
