import {usable} from './reliability.js'


const RETRO_QUESTION_ID = 'retro'
const SKILL_QUESTION_ID = 'skill'

function buildQuestions(retroProposal, skillProposal) {
  const retroDetail = [
    retroProposal.text,
    '依据：' + (retroProposal.citations ?? []).map((c) => c.id).join('、'),
  ].join('\n')
  const skillDetail = [
    skillProposal.text,
    '依据：' + (skillProposal.citations ?? []).map((c) => c.id).join('、'),
  ].join('\n')
  return [
    {
      id: RETRO_QUESTION_ID,
      header: '任务复盘',
      question: '是否按此方案写入任务复盘记录？',
      detail: retroDetail,
      options: [
        { label: '按方案写入复盘', description: '复盘结论将作为已确认记忆写入当前项目' },
        { label: '跳过复盘', description: '不写入任何复盘记录' },
      ],
      intent: { kind: 'plan-review', approve: '按方案写入复盘' },
    },
    {
      id: SKILL_QUESTION_ID,
      header: '技能提炼',
      question: '是否按此方案提炼新技能？',
      detail: skillDetail,
      options: [
        { label: '按方案提炼技能', description: '技能草稿将作为已确认技能记忆写入当前项目' },
        { label: '跳过技能', description: '不写入任何技能' },
      ],
      intent: { kind: 'plan-review', approve: '按方案提炼技能' },
    },
  ]
}


function readDecision(answer, questionId) {
  const item = (answer?.answers ?? []).find((a) => a?.id === questionId)
  if (!item) return { approve: false }
  const selected = item.selected ?? []
  if (selected.some((label) => label.includes('跳过'))) return { approve: false }

  if (item.custom && item.custom.trim()) return { approve: true, revision: item.custom.trim() }
  if (selected.some((label) => label.includes('按方案'))) return { approve: true, revision: null }
  return { approve: false }
}


export function commitProposal(engine, proposalId, { scope, revision = null, now = Date.now() } = {}) {
  const proposal = engine.log.proposals.get(proposalId)
  if (!proposal || proposal.scope !== scope) throw Error('Unknown proposal in this project')
  if (!['pending', 'accepted'].includes(proposal.status)) throw Error('Proposal is not open for approval')
  const revisionText = revision ? proposal.text + '\n\n## 讨论修订（人工）\n' + revision : null
  if (!revisionText) return { ...engine.acceptProposal(proposalId, { scope, now }), revised: false }

  if (proposal.status !== 'pending') throw Error('Proposal is not open for a revised approval')
  if (proposal.sourceRevisions.some((r) => {
    const it = engine.log.items.get(r.id)
    return !it || it.scope !== scope || it.archived || it.activeSeq !== r.seq || (it.reviewSeq ?? null) !== (r.reviewSeq ?? null) || !usable(it, now)
  })) throw Error('Sources changed; regenerate the draft')
  const kind = proposal.proposalKind === 'skill-compile' ? 'skill' : 'episode'
  const evidence = proposal.citations.flatMap((c) => {
    const it = engine.log.items.get(c.id)
    const refs = it.evidence?.filter((e) => typeof e.at === 'number' && e.source !== 'human-review') ?? []
    return (refs.length ? refs : [{ at: it.recordedAt, source: it.source, referenceBasis: 'recorded-fallback' }]).map((e) => ({ ...e, ...c, proposalId: proposalId }))
  })
  const expiresAt = proposal.sourceRevisions.map((r) => engine.log.items.get(r.id)?.expiresAt).filter((t) => typeof t === 'number').sort((a, b) => a - b)[0] ?? null
  const create = engine._createMemoryEvent({ text: revisionText, kind, scope, source: 'agent', evidence, expiresAt, now })
  const approvalReason = 'Human revised and approved proposal ' + proposalId
  const operations = [create, { kind: 'review', id: create.id, trust: 'confirmed', reason: approvalReason }, { kind: 'proposal-reviewed', id: proposalId, status: 'accepted' }]
  engine.log.append({ kind: 'approval', id: proposalId, operations, at: now })
  engine._indexMemory(create.id, now)
  return { id: create.id, revised: true }
}


function planView(p) {
  return { id: p.id, kind: p.proposalKind, text: p.text, citations: p.citations }
}


export async function runRetro({ engine, maintenance, ask, scope, signal, agent, claims = new Set(), now = Date.now() }) {
  if (!scope) throw Error('Retro requires a session project')
  if (typeof ask !== 'function') throw Error('userQuestions service unavailable; retro needs an interactive session')

  engine.reconcileBacklog()
  const items = engine.log.alive(scope).slice(-12)
  if (!items.length) throw Error('No current-project memories to review')
  const payload = { ids: items.map((it) => it.id), scope }
  const retry = engine.backlog.items.find((job) => job.kind === 'retro-plan' && job.payload?.scope === scope && !job.payload?.automatic && !claims.has(job.id) && !engine.backlog.inflight.has(job.id))
  let queued
  if (retry) {
    retry.payload = payload; delete retry.error; retry.lastQueued = Date.now(); retry.hits++
    queued = { item: retry }
  } else queued = engine.backlog.enqueue({ kind: 'retro-plan', target: scope + ':retro', payload, dedupe: false })
  const jobId = queued.item.id
  claims.add(jobId)
  engine.checkpoint()
  if (!engine.backlog.items.some((job) => job.id === jobId)) throw Error('Maintenance queue is full; request was not scheduled')
  try {
    const process = (job) => maintenance.process(job, { scope, signal, agent })
    let value = await engine.drainBacklog(process, { limit: engine.cfg.backlog.DRAIN_PER_CALL + 1, filter: (job) => job.kind === 'retro-plan' && job.payload?.scope === scope && (job.id === jobId || job.payload?.automatic === true || job.error) })
    const touched = (v) => v.processed.some((j) => j.id === jobId) || v.failed.some((j) => j.id === jobId)
    if (!touched(value)) {
      const own = await engine.drainBacklog(process, { limit: 1, filter: (job) => job.id === jobId && job.payload?.scope === scope })
      value = { processed: [...value.processed, ...own.processed], failed: [...value.failed, ...own.failed], remaining: own.remaining }
    }
    if (!touched(value)) throw Error('Maintenance request was removed before execution; retry when the queue has space')
    const failed = value.failed.find((j) => j.id === jobId)
    if (failed) throw Error(failed.error ?? 'Retro plan generation failed')
    const outcome = value.processed.find((j) => j.id === jobId)?.outcome
    const retroProposal = engine.log.proposals.get(outcome?.proposalId)
    const skillProposal = engine.log.proposals.get(outcome?.skillProposalId)
    if (!retroProposal || !skillProposal) throw Error('Retro plan proposals missing after generation')


    let answer = null, askError = null
    try {
      answer = await ask({ questions: buildQuestions(retroProposal, skillProposal), agent, signal })
    } catch (err) {
      if (signal?.aborted) throw Error('Retro cancelled while asking the user')
      askError = err?.message ?? String(err)
    }
    if (!answer) {

      return { status: 'plan-only', retro: planView(retroProposal), skill: planView(skillProposal), askError, hint: '交互问询不可用或被取消，未写入任何记录。可用 /mnemo proposals 查看，/mnemo accept <提案ID> 手动接受。' }
    }


    const rd = readDecision(answer, RETRO_QUESTION_ID)
    const sd = readDecision(answer, SKILL_QUESTION_ID)
    const result = { status: 'committed', retro: null, skill: null, skipped: [] }
    if (rd.approve) result.retro = { ...commitProposal(engine, retroProposal.id, { scope, revision: rd.revision, now }), proposalId: retroProposal.id }
    else result.skipped.push(retroProposal.id)
    if (sd.approve) result.skill = { ...commitProposal(engine, skillProposal.id, { scope, revision: sd.revision, now }), proposalId: skillProposal.id }
    else result.skipped.push(skillProposal.id)
    engine.checkpoint()
    return result
  } finally { claims.delete(jobId) }
}
