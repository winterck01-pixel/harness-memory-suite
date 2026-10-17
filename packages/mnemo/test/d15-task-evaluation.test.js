import test from 'node:test'
import assert from 'node:assert/strict'
import { runTaskEvaluation } from '../lib/evaluation.js'
import { decideTask } from '../lib/gate.js'

const candidate = { text: 'orchard timeout=60', cues: ['orchard'], kind: 'episode' }
const baseline = { text: 'orchard timeout=30' }
const context = { scope: 'project:orchard', revision: 'source-v1' }

const execute = ({ task, memory }) => ({ expired: task.input.elapsed >= Number(memory.text.match(/timeout=(\d+)/)?.[1]) })
const judge = (task, output) => output.expired === task.expected
const tasks = n => [
  ...Array.from({ length: n }, (_, i) => ({ id: `task-${i}`, independentId: `case-${i}`, kind: 'task', input: { elapsed: i }, expected: i >= 60 })),
  { id: 'regression', independentId: 'regression', kind: 'regression', input: { elapsed: 45 }, expected: false },
  { id: 'probe', independentId: 'probe', kind: 'probe', input: { elapsed: 45 }, expected: false },
]
const evaluate = (n, overrides = {}) => runTaskEvaluation({ candidate, baseline, tasks: tasks(n), execute, judge, ...context, ...overrides })

test('D15 task runner measures paired task completion and binds exact candidate and scope', async () => {
  const evaluation = await evaluate(100)
  const out = decideTask({ candidate, evaluation, ...context })
  assert.equal(out.action, 'promote')
  assert.equal(out.observedDelta, 0.30)
  assert.equal(out.N, 100)
  assert.ok(out.confidence.lower > 0)
  assert.equal(decideTask({ candidate: { ...candidate, text: 'timeout=600' }, evaluation, ...context }).action, 'propose')
  assert.equal(decideTask({ candidate, evaluation, ...context, revision: 'source-v2' }).action, 'propose')
  assert.equal(decideTask({ candidate, evaluation, ...context, scope: 'other' }).action, 'propose')
})

test('D15 counters, too few independent outcomes and missing probes cannot authorize promotion', async () => {
  assert.equal(decideTask({ candidate, ...context, sampleN: 100000, regression: { N: 100000 } }).action, 'propose')
  assert.equal(decideTask({ candidate, evaluation: await evaluate(2), ...context }).action, 'propose')
  const evaluation = await evaluate(100)
  evaluation.records = evaluation.records.filter(r => r.kind !== 'probe')
  assert.equal(decideTask({ candidate, evaluation, ...context }).action, 'propose')
})

test('D15 copied rows and correlated repetitions do not inflate sample size', async () => {
  const evaluation = await evaluate(100)
  evaluation.records[1].independentId = evaluation.records[0].independentId
  assert.equal(decideTask({ candidate, evaluation, ...context }).action, 'propose')
  await assert.rejects(evaluate(100, { tasks: [...tasks(2), ...tasks(2)] }), /duplicate/i)
  await assert.rejects(evaluate(100, { tasks: tasks(100).map(t => t.kind === 'task' ? { ...t, input: { project: 'copied' } } : t) }), /duplicate/i)
})

test('D15 regression, probe failure and execution errors fail closed', async () => {
  for (const kind of ['task', 'regression', 'probe']) {
    const evaluation = await evaluate(100, {
      execute: ({ memory, task }) => memory.text === candidate.text && task.kind === kind ? { expired: 'incorrect' } : execute({ task, memory: candidate }),
    })
    assert.equal(decideTask({ candidate, evaluation, ...context }).action, 'reject', kind)
  }
  const errored = await evaluate(100, { execute: () => { throw Error('worker died') } })
  assert.equal(decideTask({ candidate, evaluation: errored, ...context }).action, 'propose')
})

test('D15 identical outcomes need enough evidence for non-inferiority; retrieved bad memory loses tasks', async () => {
  const same = await evaluate(100, { baseline: candidate })
  assert.equal(decideTask({ candidate, evaluation: same, ...context }).action, 'propose')
  const enough = await evaluate(600, { baseline: candidate })
  assert.equal(decideTask({ candidate, evaluation: enough, ...context }).action, 'promote')
  const bad = { ...candidate, text: 'orchard timeout=5' }
  const evaluation = await evaluate(600, { candidate: bad, baseline: candidate })
  assert.equal(decideTask({ candidate: bad, evaluation, ...context }).action, 'reject')
})

test('D15 executor cannot see answer key or change later tasks during an awaited run', async () => {
  const corpus = tasks(100)
  let first = true
  const evaluation = await evaluate(100, { tasks: corpus, execute: ({ task, memory }) => {
    assert.equal(task.expected, undefined)
    if (first) { corpus[1].expected = 0; first = false }
    return execute({ task, memory })
  } })
  assert.equal(evaluation.records[1].candidateSuccess, true)
  assert.equal(decideTask({ candidate, evaluation, ...context }).action, 'promote')
})
