import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventLog } from '../lib/store.js'
import { MemoryEngine } from '../lib/engine.js'

function dir(t) {
  const path = mkdtempSync(join(tmpdir(), 'mnemo-d15-atomic-'))
  t.after(() => rmSync(path, { recursive: true, force: true }))
  return path
}

test('D15 atomic: validation sees refreshed external review under the writer lock and aborts before bytes', t => {
  const path = dir(t), log = new EventLog(path), other = new EventLog(path)
  log.append({ kind: 'create', id: 'a', text: 'original', scope: 's' })
  other.append({ kind: 'review', id: 'a', trust: 'confirmed' })
  const bytes = readFileSync(log.path, 'utf8')
  assert.throws(() => log.append({ kind: 'revise', id: 'a', text: 'unsafe' }, { validate: state => {
    assert.ok(existsSync(join(path, '.writer-lock')))
    assert.equal(state.items.get('a').trust, 'confirmed')
    throw Error('human protected source')
  } }), /human protected/)
  assert.equal(readFileSync(log.path, 'utf8'), bytes)
  assert.equal(log.seq, 2)
  assert.equal(log.items.get('a').text, 'original')
  assert.equal(existsSync(join(path, '.writer-lock')), false)
})

test('D15 atomic: runtime sidecar also respects validation; false and async validation never writes', t => {
  const path = dir(t), log = new EventLog(path)
  log.append({ kind: 'runtime-state', state: { value: 'original' } })
  const bytes = readFileSync(log.statePath, 'utf8')
  assert.throws(() => log.append({ kind: 'runtime-state', state: { value: 'unsafe' } }, { validate: state => {
    assert.ok(existsSync(join(path, '.writer-lock')))
    assert.equal(state.runtimeState.value, 'original')
    return false
  } }), /validation rejected/)
  assert.equal(readFileSync(log.statePath, 'utf8'), bytes)
  assert.throws(() => log.append({ kind: 'create', id: 'a', text: 'unsafe' }, { validate: async () => true }), /synchronous/)
  assert.throws(() => log.append({ kind: 'create', id: 'a', text: 'unsafe' }, { validate: () => Promise.resolve(true) }), /synchronous/)
  assert.equal(log.seq, 0)
  assert.equal(log.items.size, 0)
  assert.equal(existsSync(join(path, '.writer-lock')), false)
})

test('D15 atomic: human confirmation inserted immediately before append invalidates evaluated revision', async t => {
  const path = dir(t), e = new MemoryEngine({ dir: path, config: { eval: { AUTO_PROMOTE: true } } })
  e.setScope('s'); e.start('session')
  const item = e.remember({ text: 'orchard timeout=30', cues: ['orchard'], scope: 's', source: 'agent' })
  const tasks = [
    ...Array.from({ length: 100 }, (_, elapsed) => ({ id: `t${elapsed}`, independentId: `i${elapsed}`, kind: 'task', input: { elapsed }, expected: elapsed >= 60 })),
    { id: 'regression', independentId: 'r', kind: 'regression', input: { elapsed: 45 }, expected: false },
    { id: 'probe', independentId: 'p', kind: 'probe', input: { elapsed: 45 }, expected: false },
  ]
  const receipt = await e.evaluateRevision(item.id, { text: 'orchard timeout=60', scope: 's', tasks,
    execute: ({ task, memory }) => task.input.elapsed >= Number(memory.text.match(/timeout=(\d+)/)[1]),
    judge: (task, output) => output === task.expected,
  })
  assert.equal(e.gate(receipt.candidate, { receipt, scope: 's' }).action, 'promote')
  const append = e.log.append.bind(e.log), other = new EventLog(path), before = e.log.seq
  e.log.append = (event, options) => {
    if (event.kind === 'revise') other.append({ kind: 'review', id: item.id, trust: 'confirmed', reason: 'human confirmation at commit boundary' })
    return append(event, options)
  }
  assert.throws(() => e.applyEvaluatedRevision(item.id, { receipt, scope: 's' }), /cannot be automatically revised|changed|stale|evaluation|protected/i)
  const replay = new EventLog(path); replay.load()
  assert.equal(replay.seq, before + 1, 'only the human review may be appended')
  assert.equal(replay.items.get(item.id).trust, 'confirmed')
  assert.equal(replay.items.get(item.id).text, 'orchard timeout=30')
  assert.equal(e._evaluatedCandidates.get(item.id).receipt, receipt, 'aborted write must not consume the receipt')
})
