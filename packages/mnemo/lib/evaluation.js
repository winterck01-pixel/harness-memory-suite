import { createHash } from 'node:crypto'


function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  return value
}
export function candidateFingerprint(candidate) {
  return createHash('sha256').update(JSON.stringify(canonical(candidate))).digest('hex')
}
function immutable(value) {
  const copy = structuredClone(value)
  function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) }; return v }
  return freeze(copy)
}


export async function runTaskEvaluation({ candidate, baseline, tasks, execute, judge, scope, revision, diagnosticOnly = false }) {
  if (!candidate || !baseline || !Array.isArray(tasks) || !tasks.length || typeof execute !== 'function' || typeof judge !== 'function') throw Error('evaluation requires candidate, baseline, tasks, execute and judge')
  if (typeof scope !== 'string' || !scope || typeof revision !== 'string' || !revision) throw Error('evaluation requires scope and revision binding')
  const seen = new Set(), independent = new Set(), cases = new Set()
  for (const task of tasks) {
    if (typeof task.id !== 'string' || !task.id || typeof task.independentId !== 'string' || !task.independentId || !['task', 'regression', 'probe'].includes(task.kind)) throw Error('invalid evaluation task')

    const { id, independentId } = task
    const fingerprint = candidateFingerprint({kind:task.kind,input:task.input})
    if (seen.has(id) || independent.has(independentId) || cases.has(fingerprint)) throw Error('duplicate task or independence group or task content')
    seen.add(id); independent.add(independentId); cases.add(fingerprint)
  }


  const fixedCandidate = immutable(candidate), fixedBaseline = immutable(baseline), fixedTasks = immutable(tasks)
  const evaluation = { version: 1, metric: 'paired-task-success', candidateHash: candidateFingerprint(candidate), baselineHash: candidateFingerprint(baseline), scope, revision, diagnosticOnly: diagnosticOnly === true, records: [] }
  for (const input of fixedTasks) {
    const task = immutable(input), { id, independentId } = task
    const record = { taskId: id, independentId, taskHash: candidateFingerprint({kind:task.kind,input:task.input}), kind: task.kind }
    for (const [variant, memory] of [['baseline', fixedBaseline], ['candidate', fixedCandidate]]) {
      try {


        const publicTask = immutable({ id: task.id, kind: task.kind, input: task.input })
        const output = await execute({ task: publicTask, memory, variant })
        const success = await judge(task, output)
        if (typeof success !== 'boolean') throw Error('judge must return a boolean task success')
        record[`${variant}Success`] = success
      } catch (error) {
        record[`${variant}Error`] = String(error?.message ?? error).slice(0, 200)
      }
    }
    evaluation.records.push(record)
  }
  return evaluation
}
