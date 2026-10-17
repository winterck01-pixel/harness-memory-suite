import {TaskMemoryLedger} from './task-memory-ledger.js'
import {applyTaskInjectionPolicy} from './task-injection-policy.js'
import {memoryOptOut,silentMemory} from './context-policy.js'
import {selectCaptureText,filterAgentCaptureText} from './capture-policy.js'
import {migrateState} from './scope-state.js'
import {createHash,randomUUID} from 'node:crypto'
import {captureDisabled} from './turn-capture.js'
import {validateExpiry, sameHistoricalStatement} from './temporal.js'


import { EventLog, makeId, newItem } from './store.js'
import { projectScope, sourceLabel, usable } from './reliability.js'
import { EntityResolver } from './entity.js'
import { StagingArea, SOURCE, filterOptedOutClauses } from './staging.js'
import { extractCueTokens, detectDecisions } from './decisions.js'
import { scopeReport as buildScopeReport, migrationHint } from './scopes.js'
import { isNoiseWord, extractZhWords } from './stopwords.js'
import { ModeRouter } from './router.js'
import { Backlog } from './backlog.js'
import { Injector, renderCard, estimateTokens, memoryMetadata } from './inject.js'
import { retrieve, spontaneousRecall, lexicalSimilarity, pointerCandidates, lexTokens } from './retrieve.js'
import { decideTask, structuralGate, authorityFor, gateReport as buildGateReport } from './gate.js'
import { runTaskEvaluation, candidateFingerprint } from './evaluation.js'
import { buildProbes, judgeProbe, summarizeProbeRun } from './probes.js'
import {
  retrievability, levelOf, boostRetrievability, gainStability,
  ageForRetrievability, snapshotR, LEVEL_ORDER, stepLevel, targetRForLevel,
  decayStability, archiveEligibility,
} from './fsrs.js'
import { defaultConfig, mergeConfig, WM, BOUNDS, FORGET } from './config.js'

const DAY = 86400000

export class MemoryEngine {


  constructor({ dir, config, entities = null } = {}) {
    this.cfg = mergeConfig(defaultConfig(), config)
    this.log = new EventLog(dir, this.cfg.store)


    this.entities = entities ?? new EntityResolver()

    this.staging = new StagingArea({ ...this.cfg.staging, bounds: this.cfg.bounds })
    this.router = new ModeRouter(this.cfg.router)
    this.backlog = new Backlog(this.cfg.backlog)
    this.injector = new Injector(this.cfg.tokens)

    this.cueVocabulary = new Set()

    this.injectedThisSession = new Set()
    this.session = null


    this.scope = null


    this.goalCues = []
    this.safety = { lastRun: null, summary: null, frozen: false }
    this.loaded = false
    this.sessionStates = new Map()
    this._draining = null
    this.captureReceipts = new Set()

    this._evaluationReceipts = new WeakMap()
    this._evaluatedCandidates = new Map()
    this.evalStats = { samples: 0, usedSamples: 0, emptyRecalls: 0, sinceSweep: 0 }


    this.readOnly = false
    this.readOnlyReason = null

    this._levelsDirty = true

    this._conflictLex = new Map()
    this._conflictIndexReady = false


    this.deliveryStats = { emitted: 0, lastEmittedAt: null, lastCapturedAt: null, slowTurnsWithNoOutput: 0, contextEmitted: 0, lastContextAt: null, reinforced: 0, lastReinforcedAt: null }

    this._emittedByTurn = new Map()
    this.taskMemory = new TaskMemoryLedger({maxSessions:32,maxExposuresPerSession:64,maxDeclarationsPerSession:128,maxTurnsPerSession:64})
  }


  setReadOnly(on, reason = null) {
    this.readOnly = !!on
    this.readOnlyReason = on ? (reason ?? 'read-only') : null

    if (this.log) this.log.readOnly = this.readOnly
    return this.readOnly
  }

  _assertWritable() { if (this.readOnly) throw Error('Memory store is read-only') }

  scopeFor(cwd) { return projectScope(cwd) }


  activateSession(session, scope = this.scope) {
    const key = session ?? '__bootstrap__'
    let state = this.sessionStates.get(key)
    if (!state) {
      state = {router:new ModeRouter(this.cfg.router), injector:new Injector(this.cfg.tokens), injected:new Set(), goalCues:[]}
      this.sessionStates.set(key,state)
    }
    if (this.session !== null && this.sessionStates.has(this.session)) this.sessionStates.get(this.session).goalCues = this.goalCues
    this.session = session; this.scope = scope
    this.router = state.router; this.injector = state.injector; this.injectedThisSession = state.injected; this.goalCues = state.goalCues
  }


  checkpoint() {
    if (!this.loaded) return

    if (this.readOnly) return
    this.log.append({kind:'runtime-state',state:this.runtimeSnapshot()})


    const every = this.cfg?.forget?.SWEEP_EVERY_TURNS ?? 200
    if (every > 0 && ++this.evalStats.sinceSweep >= every) {
      try { this.sweepArchives() } catch (error) {

        if (this.backlog.warnings.length < 50) this.backlog.warnings.push(`归档扫描失败：${error?.message ?? error}`)
        this.evalStats.sinceSweep = 0
      }
    }

    const hint = this.cfg?.store?.COMPACT_HINT_BYTES
    if (hint && !this._compactHinted) {
      const size = this.log.logBytes()
      if (size > hint && this.backlog.warnings.length < 50) {
        this._compactHinted = true
        this.backlog.warnings.push(`记忆日志已达 ${(size / 1048576).toFixed(1)}MB，建议执行压缩：/mnemo compact（预演 /mnemo compact dry）`)
      }
    }
  }

  runtimeSnapshot() {
    return {version:1,captureReceipts:[...this.captureReceipts],staging:this.staging.toJSON(),backlog:this.backlog.toJSON(),safety:this.safety,taskMemory:this.taskMemory.toJSON()}
  }


  _boundCaptureReceipts() {
    const max = this.cfg?.bounds?.CAPTURE_RECEIPTS ?? BOUNDS.CAPTURE_RECEIPTS
    if (!max || this.captureReceipts.size <= max) return
    let drop = this.captureReceipts.size - max
    for (const key of this.captureReceipts) { this.captureReceipts.delete(key); if (--drop <= 0) break }
  }


  compact(options = {}) {
    const result = this.log.compact(options)
    if (result.compacted && !options.dryRun) {
      this._compactHinted = false
      this.backlog.warnings = this.backlog.warnings.filter((w) => !w.includes('建议执行压缩'))

      this.log.refreshLevels(Date.now(), this.cfg.curve.DECAY, this.cfg.levels)
    }
    return result
  }


  sweepArchives({ now = Date.now(), force = false } = {}) {
    this._ensure()
    const cfg = this.cfg.forget ?? FORGET
    const every = cfg.SWEEP_EVERY_TURNS ?? 200
    if (!force && every > 0 && this.evalStats.sinceSweep < every) return { archived: [], skipped: true }
    this.evalStats.sinceSweep = 0
    const nowDays = now / DAY
    const archived = []
    for (const it of this.log.items.values()) {
      if (it.archived) continue
      const r = snapshotR(it, nowDays, this.cfg.curve.DECAY)
      const idleDays = nowDays - (it.touchAt ?? it.born)


      const S = decayStability(it.S, { idleDays, upCount: it.upCount, decayPerDay: cfg.S_DECAY_PER_DAY, floor: this.cfg.curve.S_MIN })
      const verdict = archiveEligibility(


        { ...it, S, upCount: Math.max(0, it.touches ?? 0) },
        { r, idleDays, now, maxS: cfg.S_MAX_ARCHIVED, minIdle: cfg.MIN_IDLE_DAYS, maxTouches: cfg.MAX_TOUCHES },
      )
      if (!verdict.eligible) continue
      const bound=candidateFingerprint(it)
      this.log.append({ kind: 'archive', id: it.id, at: now, reason: verdict.reasons.join('; '), score: verdict.score },{validate:()=>{
        if(candidateFingerprint(this.log.items.get(it.id))!==bound)throw Error('Archive source changed or became protected before commit; retry the scan')
      }})
      archived.push(it.id)
    }
    if (archived.length) {
      this.log.refreshLevels(now, this.cfg.curve.DECAY, this.cfg.levels)
    }
    return { archived, skipped: false }
  }


  unarchive(id, { now = Date.now(), scope = null } = {}) {
    this._ensure()
    const it = this.log.items.get(id)
    if (!it || (scope && it.scope !== scope)) throw Error('Unknown memory in current project')

    const out = this.log.restoreArchived(id)
    if (out?.ok) this.log.refreshLevels(now, this.cfg.curve.DECAY, this.cfg.levels)
    return { id, unarchived: !!out?.ok, reason: out?.error }
  }


  archiveReport({ scope = null } = {}) {
    this._ensure()
    let archived = 0, alive = 0
    const byScope = new Map()
    for (const it of this.log.items.values()) {
      if (scope && it.scope !== scope) continue
      if (it.archived) {
        archived++
        byScope.set(it.scope, (byScope.get(it.scope) ?? 0) + 1)
      } else alive++
    }
    return { alive, archived, byScope: [...byScope] }
  }


  scopeReport({ now = Date.now() } = {}) {
    this._ensure()
    const report = buildScopeReport([...this.log.items.values()], { now })
    const reachable = report.byScope.filter((s) => s.reachable).map((s) => s.scope)

    report.hints = report.deadScopes.map((dead) => ({ ...migrationHint(dead, { candidates: reachable }), count: report.byScope.find((s) => s.scope === dead)?.total ?? 0 }))


    const total = report.total ?? (report.reachableCount + report.deadCount)
    report.deadRatio = total ? Number((report.deadCount / total).toFixed(3)) : 0
    if (report.deadCount) {
      const hint = `有 ${report.deadCount}/${total} 条记忆指向已不存在的路径，永远不会被检索到；用 /mnemo scopes 查看可迁移建议`
      if (!this.backlog.warnings.some((w) => w.includes('永远不会被检索到'))) this.backlog.warnings.push(hint)
    }
    return report
  }


  gateReport(options = {}) {
    const verdict = options.candidate ? this.gate(options.candidate,options) : null
    const report = buildGateReport({sampleN:verdict?.N ?? 0,probeJudged:null})
    return {...report,authority:verdict?.authority ?? authorityFor(0),
      discriminating:verdict?.pass === true, detectableDelta:null,
      metric:'candidate-specific-paired-task-success',
      usageObservations:this.evalStats.samples, verdict,
      note:verdict?.note ?? '尚无候选专属任务证据；检索与记忆数量不授予统计权限'}
  }

  migrateScope(legacy, scope) {


    if (this.readOnly) throw Error('Memory store is read-only: cannot migrate scopes while another instance holds the writer lock')
    if(legacy===scope)return
    const state=this.runtimeSnapshot()
    const exists=[...this.log.items.values(),...this.log.proposals.values()].some(it=>it.scope===legacy) || [...state.staging.pending,...state.staging.pointers].some(it=>it.scope===legacy) || state.backlog.items.some(it=>it.payload?.scope===legacy) || state.staging.scopeStats.some(([key])=>key===legacy)
    if(!exists)return
    this.log.append({kind:'scope-binding',legacy,scope,state:migrateState(state,legacy,scope)})
    this.staging.load(this.log.runtimeState.staging)
    this.backlog.load(this.log.runtimeState.backlog)
    this.reconcileBacklog()
  }


  reconcileBacklog() {
    const seen = new Set(), retained = []
    for (const job of this.backlog.items) {
      if (this.backlog.inflight.has(job.id)) {retained.push(job);seen.add(job.id);continue}
      const proposal = this.log.proposals.get(job.id)
      const sourceIds = JSON.stringify([...(job.payload?.ids ?? [])].sort())
      const sameSources = proposal && sourceIds === JSON.stringify((proposal.sourceRevisions ?? []).map(r=>r.id).sort())
      const sources = (job.payload?.ids ?? []).map(id=>this.log.items.get(id))
      if ((!job.payload?.scope || job.payload?.automatic) && sources.length && sources.every(Boolean) && new Set(sources.map(it=>it.scope)).size===1) {
        job.payload={...job.payload,scope:sources[0].scope,automatic:true}
      }
      if (proposal && proposal.scope===job.payload?.scope && proposal.proposalKind===job.kind && sameSources) {


        const records=proposal.evaluationReport?.records
        const complete=Array.isArray(records)&&records.length>0&&records.every(r=>typeof r.baselineSuccess==='boolean'&&typeof r.candidateSuccess==='boolean'&&!r.baselineError&&!r.candidateError)
        if(job.kind!=='revision-evaluate'||proposal.status==='accepted'||(complete && job.payload?.force!==true))continue
        retained.push(job);seen.add(job.id);continue
      }

      if (proposal || seen.has(job.id)) job.id='b-'+randomUUID()
      seen.add(job.id);retained.push(job)
    }
    this.backlog.items=retained
  }


  acceptProposal(id, {scope, now=Date.now()} = {}) {
    this._assertWritable()
    this._ensure();this.log.refreshFromDisk()
    const proposal=this.log.proposals.get(id)
    if(!proposal || proposal.scope!==scope || !['pending','accepted'].includes(proposal.status))throw Error('Unknown proposal in this project')
    if(proposal.proposalKind==='revision-evaluate')throw Error('Revision proposals require statistical evaluation; use /mnemo evaluate, not accept')
    const kind=proposal.proposalKind==='skill-compile'?'skill':'episode'
    const matches=[...this.log.items.values()].filter(it=>it.evidence?.some(e=>e.proposalId===id))
    if(matches.length>1)throw Error('Ambiguous partial approval; inspect derived records')
    const previous=matches[0]
    const approvalReason='Human approved proposal '+id
    if(previous && (previous.scope!==scope || previous.text!==proposal.text || previous.kind!==kind || previous.source!=='agent' || previous.archived || !usable(previous,now) || previous.versions.length!==1 || previous.activeSeq!==previous.versions[0].seq || !['unverified','confirmed'].includes(previous.trust) || (previous.trust==='confirmed' && !previous.evidence.some(e=>e.source==='human-review'&&e.reason===approvalReason))))throw Error('Derived record changed or was withdrawn; cannot retry this approval')
    if(proposal.status==='accepted') {
      if(!previous || previous.trust!=='confirmed')throw Error('Accepted proposal has no matching confirmed record')
      this._indexMemory(previous.id,now)
      return {id:previous.id,deduplicated:true}
    }
    if(proposal.sourceRevisions.some(r=>{const it=this.log.items.get(r.id);return !it||it.scope!==scope||it.archived||it.activeSeq!==r.seq||(it.reviewSeq??null)!==(r.reviewSeq??null)||!usable(it,now)}))throw Error('Sources changed; regenerate the draft')


    const approvalBinding = () => candidateFingerprint({
      proposal:this.log.proposals.get(id),
      sources:proposal.sourceRevisions.map(r=>{
        const item=this.log.items.get(r.id)
        return item ? {revision:this._revisionBinding(item),evidence:item.evidence,recordedAt:item.recordedAt} : null
      }),
      derived:[...this.log.items.values()].filter(it=>it.evidence?.some(e=>e.proposalId===id)),
    })
    const boundApproval = approvalBinding()
    const evidence=proposal.citations.flatMap(c=>{const it=this.log.items.get(c.id);const refs=it.evidence?.filter(e=>typeof e.at==='number'&&e.source!=='human-review')??[];return(refs.length?refs:[{at:it.recordedAt,source:it.source,referenceBasis:'recorded-fallback'}]).map(e=>({...e,...c,proposalId:id}))})
    const expiresAt=proposal.sourceRevisions.map(r=>this.log.items.get(r.id)?.expiresAt).filter(t=>typeof t==='number').sort((a,b)=>a-b)[0]??null
    if(previous && previous.expiresAt!==expiresAt)throw Error('Derived record expiry changed; cannot retry this approval')
    const create=previous ? null : this._createMemoryEvent({text:proposal.text,kind,scope,source:'agent',evidence,expiresAt,now})
    const memoryId=previous?.id ?? create.id
    const operations=create ? [create] : []


    const superseded = []
    if (proposal.proposalKind === 'gist-compress') {
      operations.push({ kind: 'gist-set', id: memoryId, gist: proposal.text })
      for (const r of proposal.sourceRevisions ?? []) {
        const src = this.log.items.get(r.id)
        if (!src || src.id === memoryId || src.archived) continue
        if (src.pinned) continue
        if (src.trust === 'confirmed') continue
        operations.push({ kind: 'archive', id: src.id, reason: 'superseded-by-approved-gist', score: 1 })
        superseded.push(src.id)
      }
    }
    operations.push({kind:'review',id:memoryId,trust:'confirmed',reason:approvalReason},{kind:'proposal-reviewed',id,status:'accepted'})
    this.log.append({kind:'approval',id,operations,at:now},{validate:()=>{
      if(approvalBinding()!==boundApproval || proposal.sourceRevisions.some(r=>!usable(this.log.items.get(r.id),Date.now()))) {
        throw Error('Proposal or sources changed, became protected or expired before approval commit; regenerate the draft')
      }
    }})
    this._indexMemory(memoryId,now)
    if (superseded.length) this.log.refreshLevels(now, this.cfg.curve.DECAY, this.cfg.levels)
    return {id:memoryId, superseded}
  }

  review(id, trust, {scope, reason, supersededBy} = {}) {
    this._assertWritable()
    this._ensure()
    const item=this.log.items.get(id)
    if (!item || (scope && item.scope!==scope)) throw new Error('Unknown memory in current project')
    if (!['confirmed','disputed','superseded','rejected'].includes(trust)) throw new Error('Invalid review status')
    if (item.pinned && trust !== 'confirmed') throw new Error('Pinned rules require explicit unpin before replacement')
    if (supersededBy) {
      const next=this.log.items.get(supersededBy)
      if (!next || next.scope!==item.scope || next.id===id) throw new Error('Replacement must be another memory in the same project')
    }
    const cancelStagingIds = trust==='rejected' ? this.staging.pending.filter(entry=>entry.scope===item.scope && sameHistoricalStatement(item,entry)).map(entry=>entry.id) : []
    this.log.append({kind:'review',id,trust,reason,supersededBy,cancelStagingIds})
    this.staging.pending=this.staging.pending.filter(entry=>!this.log.cancelledCaptures.has(entry.id))
    return {id,trust}
  }


  setScope(scope) {
    this.scope = scope ?? null
    return this.scope
  }


  _scope(scope) {
    return scope ?? this.scope ?? 'default'
  }


  start(sessionId = null, now = Date.now()) {
    if (!this.loaded) {
      this.log.load()
      const state=this.log.runtimeState
      if (state?.version===1) {this.captureReceipts=new Set(state.captureReceipts ?? []);this.staging.load(state.staging);this.backlog.load(state.backlog);this.safety=state.safety??this.safety;if(state.taskMemory)this.taskMemory.load(state.taskMemory)}
      this._boundCaptureReceipts()
      this.staging.pending=this.staging.pending.filter(entry=>!this.log.cancelledCaptures.has(entry.id))
      this.reconcileBacklog()
    }
    this.activateSession(sessionId)
    this.session = sessionId
    this.router.reset(sessionId)
    this.injectedThisSession.clear()


    this.injector.resetSession()

    this.log.refreshLevels(now, this.cfg.curve.DECAY, this.cfg.levels)

    for (const it of this.log.all()) {
      for (const c of it.cues) this._rememberCue(c)
    }


    this.loaded = true


    if (this.readOnly) {
      return {
        session: sessionId,
        stats: this.log.stats(),
        staging: { captured: [], dropped: [], kept: this.staging.pending.length, noised: [], noisedEntries: 0, decision: [], echo: [], deduped: [] },
        backlog: this.backlog.pending(),
        authority: authorityFor(0),
        debt: this.backlog.pending({ now }).cost,
        readOnly: true,
      }
    }
    let settled
    try {
      settled = this.staging.settle({
        now,
        goalCues: this.goalCues,
        onCapture: (e) => this._absorbStaged(e),
        onPrepared: () => this.checkpoint(),
      })


      if (settled.captured.length || settled.dropped.length || settled.echo.length) this.checkpoint()
    } catch (error) {
      this.loaded = false
      throw error
    }
    const authority = authorityFor(0)
    return {
      session: sessionId,
      stats: this.log.stats(),
      staging: settled,
      backlog: this.backlog.pending(),
      authority,

      debt: this.backlog.pending({ now }).cost,
    }
  }


  rewindTo(now, sessionId = this.session) {
    return this.start(sessionId, now)
  }


  settleStaging({ now = Date.now(), goalCues = null, scope = this.scope } = {}) {
    this._assertWritable()
    this._ensure()
    const settled = this.staging.settle({
      now,
      goalCues: goalCues ?? this.goalCues, scope,
      onPrepared: () => this.checkpoint(),
      onCapture: (e) => this._absorbStaged(e),
    })
    if (settled.captured.length) {
      this.log.refreshLevels(now, this.cfg.curve.DECAY, this.cfg.levels)
    }
    return settled
  }


  _ensure() {
    if (!this.loaded) this.start(this.session)
    this.log.refreshFromDisk()
    this.staging.pending=this.staging.pending.filter(entry=>!this.log.cancelledCaptures.has(entry.id))
  }


  _compose({ card, items, spontaneous, now, force = false, stateless = false }) {
    if (stateless) return this.injector.snapshot({ card, items, spontaneous })
    return this.injector.compose({ card, items, spontaneous, now, force })
  }


  memorySnapshot({ text = '', scope = null, session = null, turn = null, affect = 0, toolError = false, userCorrect = false, confidence = undefined, now = Date.now(), force = false } = {}) {
    const out = this.preTurn({
      text, scope, session, turn: turn ?? `snapshot:${text}`, affect, toolError, userCorrect, confidence, now, force,
      stateless: true,
    })
    return {
      text: out.payload ?? '',
      sections: out.sections ?? [],
      tokens: out.tokens ?? 0,
      mode: out.mode,
      cues: out.cues,
      routing: out.routing,
      hits: out.hits,
      spontaneous: out.spontaneous,
      latencyMs: out.latencyMs,
      blocks: out.blocks,
      taskPolicy:out.taskPolicy,
    }
  }


  preTurn(signal = {}) {
    if(memoryOptOut(signal.text))return silentMemory('user-disabled')
    this._ensure()
    const now = signal.now ?? Date.now()
    const t0 = process.hrtime.bigint()
    const scope = signal.scope ?? this.scope


    const cues = this.extractCues(signal.text ?? '')
    const entsRaw = this.entities.extract(signal.text ?? '')
    const ents = entsRaw.map((e) => e.canonical)


    if (cues.length) this.goalCues = cues.slice(0, this.cfg.cues?.GOAL_MAX ?? 8)


    const routing = this.router.route({
      ...signal,
      session: signal.session ?? this.session,

      knownCues: cues.filter((c) => this.cueVocabulary.has(c)).length,
      knownEntities: entsRaw.filter((e) => e.known).length,
    })


    if ((!this.router.shouldInject() || !routing.triggers?.length) && !signal.force) {
      const card = null
      const composed = this._compose({ card, items: [], spontaneous: [], now, stateless: signal.stateless })
      this._noteDelivery(composed, { mode: 'fast' })
      return {
        mode: routing.mode,
        routing,
        cues,
        entities: ents,
        hits: [],
        spontaneous: [],
        ...composed,
        latencyMs: Number(process.hrtime.bigint() - t0) / 1e6,
      }
    }


    this._ensureLevels(now)
    const candidates = this.log.alive(scope, now)
    let hits = retrieve({
      cues, entities: ents, text: signal.text ?? '', candidates,
      priorOf: (it) => snapshotR(it, now / DAY, this.cfg.curve.DECAY),
      cfg: {...this.cfg.retrieve,TOP_K:Math.max(candidates.length,this.cfg.retrieve.TOP_K)},
    }).map((h) => ({
      ...h,
      r: snapshotR(h.item, now / DAY, this.cfg.curve.DECAY),
    }))

    const taskPolicy = signal.session && scope ? this.taskMemory.policy({session:signal.session,scope}) : {failureStreak:0,suppressed:[]}
    const selection = applyTaskInjectionPolicy({items:hits,...taskPolicy,options:this.cfg.taskInjection??{}})
    hits = selection.items.slice(0,this.cfg.retrieve.TOP_K)

    const spontaneous = []


    if (!hits.length && !selection.stats.filtered) {
      const leads = pointerCandidates(this.staging.pointers, { scope, cues, entities: ents, text: signal.text ?? '', cfg: this.cfg.retrieve })
      for (const lead of leads.slice(0, 3)) spontaneous.push({ item: lead.item, r: 0, pointer: true, score: lead.score })
    }


    const covered = new Set(hits.map((h) => h.item.id))
    const card = null
    const composed = this._compose({ card, items: hits, spontaneous, now, force: signal.force, stateless: signal.stateless })

    for (const block of composed.blocks ?? []) if (block.id) this.injectedThisSession.add(block.id)


    this._noteEvalSample({ hits: hits.length, used: 0 })

    const latency = Number(process.hrtime.bigint() - t0) / 1e6

    if (latency > 20) {
      this.backlog.warnings.push(`热路径耗时 ${latency.toFixed(1)}ms 超过 20ms 红线`)
    }

    this._noteDelivery(composed, { mode: 'slow' })
    return {
      mode: 'slow',
      routing,
      cues, entities: ents,
      taskPolicy:selection.stats,
      hits: hits.map((h) => ({ id: h.item.id, score: h.score, parts: h.parts, level: h.item.level })),
      spontaneous: spontaneous.map((s) => ({ id: s.item.id, r: s.r })),
      latencyMs: latency,
      ...composed,
    }
  }


  noteContextEmitted(ids, { session = null, turn = null, now = Date.now(), recordUsage = true } = {}) {
    this._ensure()
    const list = [...new Set((ids ?? []).filter((id) => typeof id === 'string' && id))]
    const key = `${session ?? this.session ?? '-'}#${turn ?? '-'}`
    let slot = this._emittedByTurn.get(key)
    if (!slot) { slot = { ids: new Set(), at: now }; this._emittedByTurn.set(key, slot) }
    for (const id of list) slot.ids.add(id)
    slot.at = now

    if (this._emittedByTurn.size > 64) {
      for (const k of [...this._emittedByTurn.keys()].slice(0, this._emittedByTurn.size - 64)) this._emittedByTurn.delete(k)
    }
    if (recordUsage && session && turn!=null && this.scope) this.exposeUsageReferences({session,scope:this.scope,turn,ids:list})
    this.deliveryStats.contextEmitted += list.length
    this.deliveryStats.lastContextAt = now

    this._noteEvalSample({ hits: list.length, used: 0 })
    return { recorded: list.length, turn: key }
  }


  exposeUsageReferences({session,scope,turn,ids=[]}={}) {
    this._ensure()
    if(!session||!scope||turn==null)throw Error('Trusted session, project and turn required')
    const items=[...new Set(ids)].map(id=>this.log.items.get(id)).filter(it=>it&&it.scope===scope&&usable(it,Date.now()))
      .map(it=>({id:it.id,version:it.activeSeq,binding:this._revisionBinding(it)}))
    return this.taskMemory.expose({session,scope,turn:String(turn),items})
  }
  prepareUsageReferences({session,scope,turn,ids=[]}={}) {
    this._ensure()
    if(!session||!scope||turn==null)throw Error('Trusted session, project and turn required')
    return this.taskMemory.references({session,scope,turn:String(turn),ids}).filter(ref=>{
      const it=this.log.items.get(ref.id)
      return it&&it.scope===scope&&usable(it,Date.now())&&it.activeSeq===ref.version&&this._revisionBinding(it)===ref.binding
    })
  }
  reportMemoryUsage({session,scope,turn,id,version,receipt,reason,callId,action='declare'}={}) {
    this._assertWritable();this._ensure()
    const ref=this.prepareUsageReferences({session,scope,turn,ids:[id]}).find(r=>r.receipt===receipt&&r.version===version)
    if(!ref)throw Error('Unknown, stale or cross-project exposure receipt')
    const it=this.log.items.get(id)
    if(action==='not_applicable'&&(it.pinned||it.source==='human'&&it.kind==='rule'))throw Error('Human rules cannot be suppressed by a usage declaration')
    if(!['declare','not_applicable'].includes(action))throw Error('Unknown usage action')
    const out=this.taskMemory[action==='declare'?'declare':'reject']({session,scope,turn:String(turn),id,version,receipt,reason,binding:ref.binding,...(callId?{callId}:{})})
    this.checkpoint()
    return {...out,evidence:'model-declared',verified:false,reinforced:false,taskOutcome:'unknown'}
  }
  hasTaskTurn({session,scope,turn}={}) {
    return !!this.taskMemory.sessions.get(JSON.stringify([session,scope]))?.turns.includes(String(turn))
  }
  noteTaskRuntimeOutcome({session,scope,turn,failed=false,toolError=false}={}) {
    this._assertWritable();this._ensure()
    if(!this.hasTaskTurn({session,scope,turn}))this.taskMemory.expose({session,scope,turn:String(turn),items:[]})
    const out=this.taskMemory.outcome({session,scope,turn:String(turn),failed,toolError})
    this.checkpoint();return out
  }
  recordTaskTrial({session,scope,turn,text,eventRef}={}) {
    this._assertWritable();this._ensure()


    if(typeof text==='string')text=text.slice(0,1000)
    const out=this.taskMemory.trial({session,scope,turn:String(turn),text,eventRef})
    this.checkpoint();return out
  }
  taskMemoryStatus({session,scope}={}) {this._ensure();return this.taskMemory.status({session,scope})}

  contextCandidates({session=null,turn=null}={}) {
    return [...(this._emittedByTurn.get(`${session??this.session??'-'}#${turn??'-'}`)?.ids??[])]
  }


  noteTurnOutcome({ usedItemIds = null, session = null, turn = null, now = Date.now() } = {}) {
    this._assertWritable()
    this._ensure()
    const key = `${session ?? this.session ?? '-'}#${turn ?? '-'}`
    const slot = this._emittedByTurn.get(key)
    const explicit = Array.isArray(usedItemIds) ? [...new Set(usedItemIds.filter((id) => typeof id === 'string' && id))] : null


    if (explicit === null) {
      this._emittedByTurn.delete(key)
      return {reinforced:[],candidates:slot?.ids.size ?? 0,explicit:false,evidence:'exposure-only'}
    }
    if (explicit.length === 0) {
      this._emittedByTurn.delete(key)
      return {reinforced:[],candidates:0,explicit:true,evidence:'explicit-empty'}
    }
    const source = explicit.filter(id => { const item=this.log.items.get(id); return item && !item.archived && usable(item,now) })
    if (!source.length) { this._emittedByTurn.delete(key); return {reinforced:[],candidates:0,explicit:true,evidence:'explicit-invalid'} }
    const pending = slot ?? {ids:new Set(source),at:now,completed:new Set()}
    pending.completed ??= new Set()
    this._emittedByTurn.set(key,pending)
    const touched = [...pending.completed]
    for (const id of source) {
      if (pending.completed.has(id)) continue


      const feedbackKey = 'feedback:' + candidateFingerprint([session ?? this.session, turn, id])
      if (this.log.stagingReceipts.has(feedbackKey)) continue
      const before = this.log.items.get(id)?.touches ?? 0
      try {
        const out = this.touch(id, { reson: 0.6, session: session ?? this.session, now, stagingCaptureKey:feedbackKey })
        pending.ids.delete(id)
        if (out.ok) { pending.completed.add(id); touched.push(id) }
      } catch (error) {


        try { this.log.refreshFromDisk() } catch {}
        if ((this.log.items.get(id)?.touches ?? 0) > before) { pending.ids.delete(id); pending.completed.add(id) }
        throw error
      }
    }
    this._emittedByTurn.delete(key)
    if (touched.length) {
      this.evalStats.usedSamples += 1
      this.deliveryStats.reinforced = (this.deliveryStats.reinforced ?? 0) + touched.length
      this.deliveryStats.lastReinforcedAt = now
    }
    return { reinforced: touched, candidates: source.length, explicit: true }
  }


  postTurn({ text, cues = null, affect = 0, scope = null, session = null, usedItemIds = [], fastMode = false, source = SOURCE.AGENT, now = Date.now(), captureKey = null } = {}) {
    this._assertWritable()
    this._ensure()
    scope = this._scope(scope)
    const originalText=String(text ?? '')
    const selected=selectCaptureText(originalText)
    if (selected.dropped && !selected.text.trim()) return {staged:{skipped:'capture-excluded'},touched:[]}
    text=source===SOURCE.AGENT ? filterAgentCaptureText(selected.text) : selected.text
    const extracted = text!==originalText ? this.extractCues(text) : cues ?? this.extractCues(text)


    const knownCues = [...this.cueVocabulary]
    const staged = fastMode
      ? this.staging.offerFast(text ?? '', { scope, affect, cues: extracted, source, now, captureKey, session: session ?? this.session })
      : this.staging.offer({
          text: text ?? '',
          cues: extracted,
          entities: this.entities.extract(text ?? '').map((e) => e.canonical),
          captureKey, scope, affect, fastMode: false, source, now, session: session ?? this.session,
          knownCues,
        })


    const touched = []
    for (const id of usedItemIds) {
      const out = this.touch(id, { reson: 0.6, session: session ?? this.session, now })
      if (out.ok) touched.push(out)
    }
    return { staged, touched }
  }


  taskEnd({ text, cues = [], scope = null, affect = 0, sessions = [], usedItemIds = [], now = Date.now(), session = null, evidence = [], captureKey = null } = {}) {
    this._assertWritable()


    const { text: taskText, dropped: taskClauseDropped } = filterOptedOutClauses(String(text ?? ''))
    if (captureDisabled(text) && !String(taskText ?? '').trim()) {
      return { skipped: 'capture-disabled-for-turn', consolidated: [], revised: [], staged: null }
    }
    this._ensure()
    scope = this._scope(scope)
    const consolidated = []
    const revised = []


    const humanText = String(taskText ?? '').trim()
    const clauseDropped = taskClauseDropped
    let staged = null
    if (humanText) {
      staged = this.staging.offer({
        text: humanText,
        cues: cues?.length ? cues : this.extractCues(humanText),
        entities: this.entities.extract(humanText).map((e) => e.canonical),
        scope,
        affect,
        fastMode: false,
        source: SOURCE.HUMAN, evidence, captureKey,
        now,
        session: session ?? this.session,
        knownCues: [...this.cueVocabulary],
      })
    }
    if (clauseDropped) staged = { ...(staged ?? {}), clauseDropped: true }


    this._ensureLevels(now)
    for (const it of this.log.alive(scope, now)) {
      const crossed = it.touches >= this.cfg.wm.CONSOLIDATE_MIN_TOUCHES
      const multiSession = it.sessions.length >= this.cfg.wm.CONSOLIDATE_MIN_SESSIONS
      const span = it.touchLog.length >= 2
        ? (it.touchLog.at(-1) - it.touchLog[0]) / DAY
        : 0
      const spanOk = span >= this.cfg.wm.CONSOLIDATE_MIN_SPAN_DAYS
      if (crossed && multiSession && spanOk && it.level === 'C') {
        consolidated.push(it.id)
      }
    }


    if (affect < 0) {
      for (const id of usedItemIds) {
        const it = this.log.items.get(id)
        if (!it || it.scope!==scope || it.archived || it.kind==='rule' || !usable(it,now) || it.pinned || it.trust==='confirmed' || it.source==='human') continue
        const queued=this.queueRevision(id,{scope,failure:humanText,automatic:true,now})
        revised.push({id,action:'queued',jobId:queued.item.id,note:'候选修订已持久化；用 /mnemo maintain revisions 执行真实评测'})
      }
    }


    if (consolidated.length) {
      this.backlog.enqueue({ kind: 'gist-compress', target: consolidated.join(','), payload: { ids: consolidated, scope, automatic:true }, now })
    }
    if (affect > 0 && usedItemIds.length) {

      this.backlog.enqueue({ kind: 'skill-compile', target: usedItemIds.join(','), payload: { ids: usedItemIds, scope, automatic:true }, now })
    }

    return { consolidated, revised, staged, backlog: this.backlog.pending({ now }) }
  }


  async drainBacklog(handler, { limit = null, now = Date.now(), filter } = {}) {
    this._ensure()
    return this.backlog.drain({
      handler: handler ?? (async () => { throw new Error('No maintenance executor configured; task retained') }),
      limit: limit ?? this.cfg.backlog.DRAIN_PER_CALL,
      now, filter,
    })
  }


  touch(id, { reson = 0.6, session = null, now = Date.now(), preferPromote = true, stagingCaptureKey = null, captureSource = null, captureEvidence = [] } = {}) {
    this._assertWritable()
    const it = this.log.items.get(id)
    if (!it || it.archived) return { ok: false, error: 'unknown or archived' }
    const nowDays = now / DAY
    const decay = this.cfg.curve.DECAY
    const W = this.cfg.wake


    const S0 = it.S
    const level0 = it.level
    const rBefore = snapshotR(it, nowDays, decay)


    if (reson < W.THETA_CUE) {
      return { ok: false, error: 'below-theta', reson, rBefore }
    }


    const idleDays = Math.max(0, nowDays - it.promoteUpdatedAt)
    const promotedBeforeDecay = Math.max(0, it.promote - W.PROMOTE_DECAY * idleDays)


    const boost = Math.min(1, reson) * 1
    const rAfter = boostRetrievability(rBefore, boost, W.K_BOOST)
    let SNew = gainStability(S0, rBefore, boost, W.ETA, this.cfg.curve.S_CEIL)
    let bornNew = nowDays - ageForRetrievability(rAfter, SNew, decay)


    const atTop = level0 === 'A'
    let promote = atTop ? 0 : Math.max(0, promotedBeforeDecay) + reson * W.PROMOTE_RATE
    let upCount = it.upCount


    if (preferPromote && promote >= 1 - 1e-6 && !atTop) {
      promote -= 1
      SNew = Math.min(this.cfg.curve.S_CEIL, Math.max(SNew, S0 * 1.6))


      const nextLevel = stepLevel(level0, +1)
      const targetR = targetRForLevel(nextLevel, rAfter)
      bornNew = nowDays - ageForRetrievability(targetR, SNew, decay)
      upCount += 1
    }

    this.log.append({
      kind: 'touch', id, S: SNew, touchAt: nowDays, born: bornNew,
      promote, touches: it.touches + 1, session, reson, rBefore, rAfter, upCount,
      stagingCaptureKey, captureSource, captureEvidence, at: now,
    })
    this.log.refreshLevels(now, decay, this.cfg.levels)

    return {
      ok: true, id,
      rBefore, rAfter: snapshotR(this.log.items.get(id), nowDays, decay),
      SBefore: S0, SAfter: SNew,
      levelBefore: level0, levelAfter: this.log.items.get(id).level,
      promote, upCount,

      gain: SNew - S0,
    }
  }


  _createMemoryEvent({ text, cues = [], entities = null, kind = 'episode', scope = null, S = 1, born = null, pinned = false, source = null, evidence = [], factKey = null, expiresAt = null, stagingCaptureKey = null, now = Date.now() }) {
    validateExpiry(expiresAt)


    scope = this._scope(scope)
    const id = makeId(kind === 'skill' ? 'sk' : kind === 'rule' ? 'ru' : 'm')
    const cs = cues.length ? cues : this.extractCues(text)
    const es = entities ?? this.entities.extract(text).map((e) => e.canonical)

    return {
      kind: 'create', id, text, itemKind: kind, scope,
      cues: cs, entities: es, S,
      born: born ?? (now / DAY),
      pinned,
      source, evidence, factKey, expiresAt, stagingCaptureKey,
      trust: pinned && source === 'human' ? 'confirmed' : source === 'human' ? 'reported' : 'unverified',
      conflicts: this._conflictsFor({ text, scope, factKey, now }),
      at: now,
    }
  }


  _rememberCue(cue) {
    if (typeof cue !== 'string' || !cue) return
    this.cueVocabulary.delete(cue)
    this.cueVocabulary.add(cue)
    const configured = this.cfg.bounds.CUE_VOCABULARY
    const limit = Number.isSafeInteger(configured) && configured > 0 ? configured : 4000
    while (this.cueVocabulary.size > limit) this.cueVocabulary.delete(this.cueVocabulary.values().next().value)
  }

  _indexEvent(event) {
    for (const cue of event?.cues ?? []) this._rememberCue(cue)
    for (const entity of event?.entities ?? []) this.entities.resolveOrRegister(entity)
    this._levelsDirty = true
  }

  _conflictsFor({ text, scope, factKey, now }) {
    this._syncConflictIndex()
    const tokens = new Set(lexTokens(text ?? ''))


    const ids = new Set()
    for (const token of tokens) for (const id of this._conflictPostings.get(token) ?? []) ids.add(id)
    if (factKey) for (const id of this._conflictFacts.get(factKey) ?? []) ids.add(id)
    const pool = this._conflictOverflow ? this.log.items.values() : [...ids].map(id=>this.log.items.get(id))
    const out = []
    for (const it of pool) {
      if (!it || it.scope !== scope || it.archived || !usable(it,now) || it.text === text) continue
      if (factKey && it.factKey === factKey) { out.push(it.id); continue }
      if (lexicalSimilarity(text,it.text) > 0.65 &&
          (/不|禁止|不要|never|not/i.test(text) !== /不|禁止|不要|never|not/i.test(it.text) ||
           JSON.stringify(text.match(/\d+/g)) !== JSON.stringify(it.text.match(/\d+/g)))) out.push(it.id)
    }
    return out
  }

  _addConflictItem(item) {
    if (!item || this._conflictLex.has(item.id)) return
    const configured = this.cfg.bounds.CONFLICT_ITEMS
    const limit = Number.isSafeInteger(configured) && configured > 0 ? configured : 20000
    if (this._conflictLex.size >= limit) { this._conflictOverflow = true; return }
    const tokens = new Set(lexTokens(item.text ?? ''))
    this._conflictLex.set(item.id,tokens)
    for (const token of tokens) {
      if (!this._conflictPostings.has(token)) this._conflictPostings.set(token,new Set())
      this._conflictPostings.get(token).add(item.id)
    }
    if (item.factKey) {
      if (!this._conflictFacts.has(item.factKey)) this._conflictFacts.set(item.factKey,new Set())
      this._conflictFacts.get(item.factKey).add(item.id)
    }
  }

  _syncConflictIndex() {
    if (this._conflictIndexReady && this._conflictSeq === this.log.seq && this._conflictIdentity === this.log._logIdentity) return
    this._conflictLex.clear()
    this._conflictPostings = new Map()
    this._conflictFacts = new Map()
    this._conflictOverflow = false
    for (const item of this.log.items.values()) this._addConflictItem(item)
    this._conflictSeq = this.log.seq
    this._conflictIdentity = this.log._logIdentity
    this._conflictIndexReady = true
  }


  _indexMemory(id, now=Date.now()) {
    const item=this.log.items.get(id)
    if(!item)throw Error('Committed memory is missing')
    for(const cue of item.cues ?? [])this._rememberCue(cue)


    if (this._conflictIndexReady && this._conflictSeq === this.log.seq - 1 && !this._conflictLex.has(id)) {
      this._addConflictItem(item)
      this._conflictSeq = this.log.seq
      this._conflictIdentity = this.log._logIdentity
    }


    this._levelsDirty = true
  }


  _ensureLevels(now = Date.now()) {
    if (!this._levelsDirty) return false
    this._levelsDirty = false
    this.log.refreshLevels(now, this.cfg.curve.DECAY, this.cfg.levels)
    return true
  }

  remember(payload) {
    this._assertWritable()
    this._ensure()
    const event=this._createMemoryEvent(payload)


    try {
      this.log.append(event)

      if (this.log.items.has(event.id)) this.log.refreshItemLevel(event.id, event.at, this.cfg.curve.DECAY, this.cfg.levels)
    } catch (error) {


      this._indexEvent(event)
      throw error
    }

    this._indexMemory(event.id, event.at)
    return {id:event.id,cues:event.cues,entities:event.entities}
  }


  rememberMany(payloads) {
    this._assertWritable()
    this._ensure()
    const list = Array.isArray(payloads) ? payloads.filter(Boolean) : []
    if (!list.length) return []
    const now = Date.now()

    const events = list.map((p) => this._createMemoryEvent({ ...p, now: p.now ?? now }))
    const written = this.log.appendMany(events)
    for (const ev of written) {
      if (this.log.items.has(ev.id)) this.log.refreshItemLevel(ev.id, ev.at, this.cfg.curve.DECAY, this.cfg.levels)
      this._indexEvent(ev)
    }
    this._ensureLevels(now)
    return written.map((ev) => ({ id: ev.id, cues: ev.cues, entities: ev.entities }))
  }


  pinRule({ text, cues = [], scope = null, now = Date.now() }) {
    return this.remember({ text, cues, kind: 'rule', scope: this._scope(scope), S: this.cfg.curve.S_CEIL, pinned: true, source: 'human', now })
  }


  recall(query, { scope = null, limit = 5, now = Date.now(), allScopes = false } = {}) {
    if (memoryOptOut(query)) return []
    this._ensure()


    this._ensureLevels(now)
    const sc = allScopes ? null : (scope ?? this.scope)
    const cues = this.extractCues(query ?? '')
    const ents = this.entities.extract(query ?? '').map((e) => e.canonical)
    const hits = retrieve({
      cues, entities: ents, text: query ?? '',
      candidates: this.log.alive(sc, now),
      priorOf: (it) => snapshotR(it, now / DAY, this.cfg.curve.DECAY),
      cfg: { ...this.cfg.retrieve, TOP_K: limit },
    })

    this._noteEvalSample({ hits: hits.length, used: 0 })
    if (!hits.length) {


      return pointerCandidates(this.staging.pointers, { scope: sc, cues, entities: ents, text: query ?? '', cfg: this.cfg.retrieve })
        .slice(0, limit)
        .map((lead) => ({
          id: lead.item.id, text: '[线索] ' + (lead.item.text ?? ''), rawText: lead.item.text,
          trust: 'unverified', kind: 'pointer', scope: lead.item.scope, level: 'D',
          r: 0, score: lead.score, parts: { ...lead.parts, pointer: true }, pointer: true,
        }))
    }
    return hits.map((h) => ({
      id: h.item.id,
      text: sourceLabel(h.item),
      rawText: h.item.text, trust: h.item.trust, evidence: h.item.evidence, conflicts: h.item.conflicts,
      kind: h.item.kind,
      scope: h.item.scope,
      level: h.item.level,
      r: snapshotR(h.item, now / DAY, this.cfg.curve.DECAY),
      score: h.score,
      parts: h.parts,
    }))
  }


  _revisionBinding(item) {
    return candidateFingerprint({id:item.id,seq:item.activeSeq,review:item.reviewSeq,
      gist:item.gistSeq,scope:item.scope,text:item.text,cues:item.cues,kind:item.kind,
      source:item.source,trust:item.trust,archived:item.archived,pinned:item.pinned,expiresAt:item.expiresAt})
  }


  queueRevision(id,{scope,text=null,failure='',automatic=false,now=Date.now()}={}) {
    this._assertWritable();this._ensure()
    const item=this.log.items.get(id)
    if(!item||item.scope!==scope||item.archived||item.pinned||item.kind==='rule'||item.trust==='confirmed'||item.source==='human'||!usable(item,now))throw Error('Memory is unavailable or protected from revision')
    if(text!==null&&(typeof text!=='string'||!text.trim()||text.length>5000))throw Error('Candidate text must contain 1–5000 characters')
    const payload={ids:[id],scope,sourceBinding:this._revisionBinding(item),candidateText:text,failure:String(failure).slice(0,5000),automatic}
    const result=this.backlog.enqueue({kind:'revision-evaluate',target:id+':'+candidateFingerprint(payload),payload,now})
    this.checkpoint()
    if(!this.backlog.items.some(job=>job.id===result.item.id))throw Error('Revision queue is full; request was not retained')
    return result
  }

  revisionProposal(job,{text,scope}={}) {
    this._assertWritable();this._ensure()
    const id=job.payload?.ids?.[0],item=this.log.items.get(id)
    const validate=()=>{
      const current=this.log.items.get(id)
      if(job.payload?.scope!==scope||!current||current.scope!==scope||current.archived||current.pinned||current.kind==='rule'||current.trust==='confirmed'||current.source==='human'||!usable(current)||this._revisionBinding(current)!==job.payload.sourceBinding)throw Error('Revision source changed or became protected; queue a fresh candidate')
    }
    validate()
    const candidate={text,kind:item.kind,source:item.source,cues:[...item.cues]}
    if(!structuralGate(candidate).pass||text.length>5000)throw Error('Invalid generated revision candidate')
    this.log.append({kind:'proposal',id:job.id,scope,proposalKind:'revision-evaluate',text,
      sourceBinding:job.payload.sourceBinding,sourceRevisions:[{id,seq:item.activeSeq,reviewSeq:item.reviewSeq??null}],
      citations:[{id,quote:item.text.slice(0,100)}],failure:job.payload.failure,status:'pending'},{validate})
    return this.log.proposals.get(job.id)
  }

  saveRevisionEvaluation(proposalId,{receipt,scope,corpus,verdict,route,proposalBinding}={}) {
    this._assertWritable();this._ensure()
    const proposal=this.log.proposals.get(proposalId),bound=candidateFingerprint(proposal)
    if(!proposal||proposal.status!=='pending'||(proposalBinding&&proposalBinding!==bound)||proposal.scope!==scope||proposal.proposalKind!=='revision-evaluate'||proposal.sourceBinding!==receipt?.revision||proposal.text!==receipt?.candidate?.text)throw Error('Evaluation does not bind the pending revision proposal; draft changed or was withdrawn')
    const report={proposalId,sourceId:receipt.id,scope,sourceBinding:receipt.revision,candidateHash:receipt.evaluation.candidateHash,
      corpusHash:corpus.hash,taskN:corpus.taskN,diagnosticOnly:corpus.diagnosticOnly,note:corpus.note??null,
      route,records:receipt.evaluation.records,verdict,at:Date.now()}
    this.log.append({kind:'proposal-reviewed',id:proposalId,status:'pending',evaluationReport:report},{validate:()=>{
      const current=this.log.items.get(receipt.id)
      if(candidateFingerprint(this.log.proposals.get(proposalId))!==bound||!current||this._revisionBinding(current)!==receipt.revision)throw Error('Proposal or source changed before evaluation report commit')
    }})
    return report
  }


  async evaluateRevision(id, {text,tasks,execute,judge,scope,diagnosticOnly=false} = {}) {
    this._assertWritable()
    this._ensure()
    const item = this.log.items.get(id)
    if (!item || item.scope !== scope || item.archived || !usable(item,Date.now())) throw Error('Unknown or unusable memory in project')
    const revision = this._revisionBinding(item)
    const baseline = {text:item.text,cues:[...item.cues],kind:item.kind,source:item.source}
    const candidate = {...baseline,text}
    const evaluation = await runTaskEvaluation({candidate,baseline,tasks,execute,judge,scope,revision,diagnosticOnly})
    this.log.refreshFromDisk()
    const current = this.log.items.get(id)
    if (!current || this._revisionBinding(current) !== revision) throw Error('Source changed during evaluation')
    const receipt = Object.freeze({candidate:structuredClone(candidate),evaluation:structuredClone(evaluation),id,scope,revision})
    this._evaluationReceipts.set(receipt,{hash:candidateFingerprint(receipt),id,scope,revision})
    this._evaluatedCandidates.set(id,{candidateHash:candidateFingerprint(candidate),receipt})
    while(this._evaluatedCandidates.size > 64) this._evaluatedCandidates.delete(this._evaluatedCandidates.keys().next().value)
    return receipt
  }

  gate(candidate, {receipt = null,scope = null} = {}) {
    const structure = structuralGate(candidate)
    if (!structure.pass) return {pass:false,action:'reject',authority:authorityFor(0),gates:[structure],note:structure.errors.join('; '),N:0}
    const issued = receipt && this._evaluationReceipts.get(receipt)
    const current = issued && this.log.items.get(issued.id)
    if (!issued || candidateFingerprint(receipt)!==issued.hash || !current ||
        current.scope!==scope || this._revisionBinding(current)!==issued.revision) {
      return {pass:false,action:'propose',authority:authorityFor(0),note:'缺少本引擎签发且仍有效的候选任务评测',N:0}
    }
    const verdict = decideTask({candidate,evaluation:receipt.evaluation,scope,revision:issued.revision,
      minSamples:this.cfg.eval.MIN_SAMPLES,maxRegression:this.cfg.eval.GUARD_DELTA})
    if (this.safety.frozen || this.cfg.eval.ENABLED === false) return {...verdict,pass:false,action:verdict.action==='reject'?'reject':'propose',authority:authorityFor(0),note:verdict.note+'；自动修改已冻结或评测已停用'}
    if (verdict.action==='promote' && !this.cfg.eval.AUTO_PROMOTE) return {...verdict,action:'propose',note:verdict.note+'；自动晋升未启用'}
    return verdict
  }

  applyEvaluatedRevision(id, {receipt,scope,proposalId=null,now=Date.now()} = {}) {
    this._assertWritable()
    this._ensure()
    this.log.refreshFromDisk()
    const item = this.log.items.get(id)
    if (!item || item.scope!==scope || receipt?.id!==id || item.pinned || item.kind==='rule' || item.trust==='confirmed' || item.source==='human' || !usable(item,now)) throw Error('Memory cannot be automatically revised in this project')
    const verdict = this.gate(receipt.candidate,{receipt,scope})
    if (!verdict.pass || verdict.action!=='promote') return {applied:false,verdict}
    const revisionEvent={kind:'revise',id,text:receipt.candidate.text,reason:'candidate-task-evaluation',at:now}
    const event=proposalId ? {kind:'approval',id:proposalId,operations:[revisionEvent,{kind:'proposal-reviewed',id:proposalId,status:'accepted'}],at:now} : revisionEvent
    this.log.append(event,{validate:()=>{
      const latest=this.log.items.get(id)
      if (!latest || latest.scope!==scope || latest.pinned || latest.kind==='rule' || latest.trust==='confirmed' || latest.source==='human' || !usable(latest,now)) throw Error('Source changed or became protected before revision commit')
      const finalVerdict=this.gate(receipt.candidate,{receipt,scope})
      if (!finalVerdict.pass || finalVerdict.action!=='promote') throw Error('Source or evaluation changed before revision commit')
      if(proposalId){
        const proposal=this.log.proposals.get(proposalId)
        if(!proposal||proposal.scope!==scope||proposal.proposalKind!=='revision-evaluate'||proposal.status!=='pending'||proposal.text!==receipt.candidate.text||proposal.sourceBinding!==receipt.revision||proposal.evaluationReport?.candidateHash!==receipt.evaluation.candidateHash)throw Error('Revision proposal changed before commit')
      }
    }})
    this._levelsDirty=true
    this._evaluatedCandidates.delete(id)
    return {applied:true,id,verdict}
  }


  _noteEvalSample({ hits = 0, used = 0 } = {}) {
    if (this.cfg?.eval?.ENABLED === false) return
    this.evalStats.samples += 1
    this.evalStats.usedSamples += used > 0 ? 1 : 0
    if (!hits) this.evalStats.emptyRecalls += 1
  }


  evalReport() {
    const reports=[...this.log.proposals.values()].filter(p=>p.scope===this.scope&&p.proposalKind==='revision-evaluate'&&p.evaluationReport).map(p=>p.evaluationReport).sort((a,b)=>b.at-a.at)
    const lastEvaluation=reports[0]??null
    return {samples:lastEvaluation?.verdict?.N??0,lastEvaluation,usageObservations:this.evalStats.samples,
      usedSamples:this.evalStats.usedSamples,emptyRecalls:this.evalStats.emptyRecalls,
      minSamples:this.cfg.eval.MIN_SAMPLES,autoPromote:!!this.cfg.eval.AUTO_PROMOTE,
      authority:'propose-only',detectDelta:null,candidatesEvaluated:this._evaluatedCandidates.size,
      note:'权限按候选专属配对任务计算；检索观测不计入评测样本'}
  }


  _noteDelivery(composed, { mode } = {}) {
    const emitted = (composed?.blocks?.length ?? 0) > 0
    if (emitted) {
      this.deliveryStats.emitted += 1
      this.deliveryStats.lastEmittedAt = Date.now()
      this.deliveryStats.slowTurnsWithNoOutput = 0
    } else if (mode === 'slow') {

      this.deliveryStats.slowTurnsWithNoOutput += 1
    }
    return this.deliveryStats
  }


  noteDeliveryQueued({now=Date.now()} = {}) {
    this.deliveryStats.queued=(this.deliveryStats.queued ?? 0)+1
    this.deliveryStats.lastQueuedAt=now
  }

  noteDeliveryProjected({now=Date.now(),channel='runtime-context'} = {}) {
    this.deliveryStats.projected=(this.deliveryStats.projected ?? 0)+1
    this.deliveryStats.lastProjectedAt=now
    this.deliveryStats.lastChannel=channel
    return this.deliveryStats
  }

  deliveryReport({ now = Date.now(), staleAfterHours = 24 } = {}) {
    const last = this.deliveryStats.lastEmittedAt
    const ageHours = last == null ? null : (now - last) / 3600000
    return {
      emitted: this.deliveryStats.emitted,
      rendered: this.deliveryStats.emitted,
      projected: this.deliveryStats.projected ?? 0,
      lastProjectedAt: this.deliveryStats.lastProjectedAt ?? null,
      queued:this.deliveryStats.queued ?? 0,
      lastQueuedAt:this.deliveryStats.lastQueuedAt ?? null,
      emissionBasis:'rendered snapshots / queued Channel B messages / committed Harness context events',
      lastEmittedAt: last,
      ageHours,
      lastCapturedAt: this.deliveryStats.lastCapturedAt,
      slowTurnsWithNoOutput: this.deliveryStats.slowTurnsWithNoOutput,

      stale: this.deliveryStats.emitted === 0 ? true : (ageHours != null && ageHours > staleAfterHours),
    }
  }


  runSafetyCheck(results = null, { now = Date.now() } = {}) {
    this._assertWritable()
    this._ensure()
    const probes = buildProbes()
    const judged = probes.map((p) => {
      const r = results?.[p.id]

      if (!r) return { id: p.id, category: p.category, expect: p.expect, refused: null, ok: null, untested: true }
      return judgeProbe(p, r)
    })
    const tested = judged.filter((j) => !j.untested)
    const summary = tested.length
      ? summarizeProbeRun(tested)
      : { total: probes.length, tested: 0, healthy: false, untested: true, reason: '尚无探针结果，不能判定健康' }
    if (summary.freeze) this.safety.frozen = true
    this.safety = { lastRun: now, summary, frozen: this.safety.frozen }
    return { judged, summary }
  }


  effectiveAuthority(options = {}) {
    if (this.safety.frozen) return {...authorityFor(0),note:'安全探针失败，自动晋升已冻结'}
    if (!options || typeof options !== 'object' || !options.candidate) return {...authorityFor(0),note:'尚无候选专属任务证据，权限保持 propose-only'}
    return this.gate(options.candidate,options).authority
  }


  rollback(id, toSeq, reason) {
    this._ensure()
    return this.log.rollback(id, toSeq, reason)
  }

  versions(id) {
    this._ensure()
    return this.log.versionsOf(id)
  }


  extractCues(text) {
    if (!text) return []
    const s = String(text)
    const out = new Set()
    const lower = s.toLowerCase()


    const matchPosition = value => {
      const cue = String(value ?? '').toLowerCase()
      if (!cue) return -1
      let at = lower.indexOf(cue)
      while (at !== -1) {
        const before = lower[at - 1] ?? '', after = lower[at + cue.length] ?? ''
        if ((!/^[a-z0-9_]/.test(cue) || !/[a-z0-9_]/.test(before)) &&
            (!/[a-z0-9_]$/.test(cue) || !/[a-z0-9_]/.test(after))) return at
        at = lower.indexOf(cue, at + 1)
      }
      return -1
    }
    const ordered = entries => entries.sort((a, b) => a.at - b.at || b.key.length - a.key.length ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

    const known = [...this.cueVocabulary].filter(Boolean).map(c => ({key: String(c), at: matchPosition(c)}))
    for (const {key} of ordered(known.filter(c => c.at >= 0))) out.add(key)


    const entities = this.entities.extract(s).filter(e => !isNoiseWord(e.canonical))
      .map(e => {


        const forms = [e.surface, e.canonical, ...(this.entities.canonical.get(e.canonical) ?? [])]
        const positions = forms.map(matchPosition).filter(at => at >= 0)
        return {key: e.canonical, at: positions.length ? Math.min(...positions) : s.length}
      })
    for (const {key} of ordered(entities)) out.add(key)


    for (const w of extractCueTokens(s)) out.add(w)
    return [...out].slice(0, this.cfg.cues?.MAX ?? 16)
  }

  _renderCard({ scope = null, minimal = false, excludeIds = null, now = Date.now() } = {}) {
    this._ensureLevels(now)
    const alive = this.log.alive(scope, now)
    const byLevel = { A: [], B: [], C: [], D: [] }
    for (const it of alive) byLevel[it.level]?.push(it)


    const skip = (it) => excludeIds instanceof Set && excludeIds.has(it.id)


    const recent = byLevel.A
      .filter((it) => !skip(it))
      .map((it) => ({ it, r: snapshotR(it, now / DAY, this.cfg.curve.DECAY) }))
      .sort((a, b) => (rankSource(b.it) - rankSource(a.it)) || (b.r - a.r))
      .slice(0, 4)
      .map((x) => `${memoryMetadata(x.it)} ${gistOf(x.it)}`)

    if (minimal) {

      const n = alive.length
      const text = n ? '历史记忆可通过 mnemo_recall 按需检索。' : ''
      return {text, tokens:estimateTokens(text)}
    }


    const vaguely = alive
      .filter((it) => !skip(it) && it.level !== 'A')
      .map((it) => ({ it, r: snapshotR(it, now / DAY, this.cfg.curve.DECAY) }))
      .filter((x) => x.r > 0.15 && x.r < 0.5)
      .sort((a, b) => a.r - b.r)
      .slice(0, 5)
      .map((x) => `${memoryMetadata(x.it)} ${gistOf(x.it)}`)


    const ptrs = this.staging.recentPointers({ limit: 3, scope })
      .map((p) => `[source=${p.source ?? 'unknown'}; scope=${p.scope}; status=unverified] ${p.topic}`)

    return renderCard({
      who: null,
      doing: null,
      recent,
      vaguely: [...vaguely, ...ptrs],
    }, this.cfg.tokens)
  }


  _absorbStaged(entry) {
    this.log.refreshFromDisk()
    if(this.log.cancelledCaptures.has(entry.id))return null
    if (entry.echo && entry.source !== SOURCE.HUMAN) return null
    const stagingCaptureKey = createHash('sha256').update(JSON.stringify([entry.id, entry.firstSeen, entry.text, entry.repeats, entry.lastSeen, entry.source, entry.evidence])).digest('hex')
    if (this.log.stagingReceipts.has(stagingCaptureKey)) {
      const id = this.log.stagingReceipts.get(stagingCaptureKey)
      this._indexMemory(id)
      return id
    }
    const exists = [...this.log.all()].find(
      (it) => it.scope === entry.scope && !it.archived && usable(it, entry.lastSeen) && sameHistoricalStatement(it, entry),
    )
    if (exists) {
      this.touch(exists.id, { reson: Math.max(0.4, this.cfg.wake.THETA_CUE, Math.abs(entry.affect)), session: entry.session, now: entry.lastSeen, stagingCaptureKey, captureSource: entry.source, captureEvidence: entry.evidence ?? [] })
      return exists.id
    }
    this.deliveryStats.lastCapturedAt = entry.lastSeen ?? Date.now()
    const { id } = this.remember({
      text: entry.text, stagingCaptureKey,
      cues: entry.cues,
      entities: entry.entities,
      scope: entry.scope,

      source: entry.source ?? SOURCE.AGENT,
      evidence: entry.evidence ?? (entry.session ? [{sessionId:entry.session,at:entry.firstSeen ?? entry.lastSeen,source:entry.source}] : []),
      now: entry.lastSeen,
    })
    return id
  }


  inspect({ scope = null, now = Date.now() } = {}) {
    this._ensure()
    this._ensureLevels(now)
    const items = this.log.alive(scope, now).map((it) => {
      const r = snapshotR(it, now / DAY, this.cfg.curve.DECAY)
      return {
        id: it.id, level: it.level, kind: it.kind, scope: it.scope,
        r, S: it.S, touches: it.touches, sessions: it.sessions.length,
        promote: it.promote, upCount: it.upCount,
        pinned: it.pinned,

        source: it.source ?? null, trust: it.trust, evidence: it.evidence, conflicts: it.conflicts, expiresAt: it.expiresAt,
        versions: it.versions.length, activeSeq: it.activeSeq,
        ageDays: now / DAY - it.born,
        idleDays: now / DAY - (it.touchAt ?? it.born),
        text: it.text.slice(0, 80),
      }
    }).sort((a, b) => b.r - a.r)

    const vals = items.map((i) => i.r)
    const n = vals.length
    const mean = n ? vals.reduce((a, b) => a + b, 0) / n : 0
    const variance = n > 1 ? vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0

    const spread = Math.sqrt(variance)

    return {
      stats: this.log.stats(),
      spread,

      mentionedThisSession: this.injectedThisSession.size,


      sources: {
        human: items.filter((i) => i.source === SOURCE.HUMAN).length,
        agent: items.filter((i) => i.source !== SOURCE.HUMAN).length,
      },
      items,
      staging: this.staging.stats(),

      topCues: this.staging.topCues(6),
      backlog: this.backlog.report(),
      router: this.router.stats(),
      injector: this.injector.report(),
      safety: this.safety,
      gate: {
        authority: this.effectiveAuthority(),

        minDetectableDelta: null,
      },
    }
  }


  selfCheck({ now = Date.now() } = {}) {
    const problems = []
    for (const it of this.log.all()) {
      const r = snapshotR(it, now / DAY, this.cfg.curve.DECAY)
      if (!Number.isFinite(r) || r < 0 || r > 1) problems.push(`${it.id}: R 越界 (${r})`)
      if (!Number.isFinite(it.S) || it.S <= 0) problems.push(`${it.id}: S 非法 (${it.S})`)
      if (it.S > this.cfg.curve.S_CEIL * 1.001) problems.push(`${it.id}: S 超过封顶 (${it.S})`)
      if (it.promote < 0 || it.promote > 1.0001) problems.push(`${it.id}: 进度条越界 (${it.promote})`)
      if (it.level && !(it.level in LEVEL_ORDER)) problems.push(`${it.id}: 层级非法 (${it.level})`)
      if (it.kind === 'rule' && !it.pinned) problems.push(`${it.id}: rule 必须 pinned`)
    }
    return { ok: problems.length === 0, problems }
  }
}

export { defaultConfig, mergeConfig }


function rankSource(it) {
  if (!it) return 0
  return (it.source === SOURCE.HUMAN || it.pinned) ? 1 : 0
}


const GIST_MAX = 60


const FACT_PATTERN = /([A-Za-z]{1,6}[-\s]?\d{3,}|[「『"“].{2,24}[」』"”]|\b\d{2,}\b|[A-Z][A-Za-z0-9]{2,})/


function gistOf(it) {
  const raw = it?.gist ?? it?.text ?? ''
  const one = String(raw).replace(/\s+/g, ' ').trim()
  if (!one) return ''

  if (it?.gist) {
    return one.length <= GIST_MAX ? one : `${one.slice(0, GIST_MAX)}…`
  }

  const sentences = one.split(/(?<=[。！？!?])\s*/).filter(Boolean)
  if (!sentences.length) return ''
  let pick = sentences[0]

  for (const s of sentences) {
    if ((it?.entities ?? []).some((e) => e && s.toLowerCase().includes(String(e).toLowerCase()))) { pick = s; break }
  }

  if (pick === sentences[0]) {
    for (const s of sentences) {
      if (FACT_PATTERN.test(s)) { pick = s; break }
    }
  }
  const src = pick.length <= GIST_MAX ? pick : pick.slice(0, GIST_MAX)
  return src === one ? src : `${src}…`
}


for (const name of ['postTurn','taskEnd','settleStaging','runSafetyCheck']) {
  const operation = MemoryEngine.prototype[name]
  MemoryEngine.prototype[name] = function(...args) {
    const key=args[0]?.captureKey
    this._ensure()
    try {
      if(key && this.captureReceipts.has(key)){

        this.captureReceipts.delete(key);this.captureReceipts.add(key)
        return {deduplicated:true}
      }
      const result=operation.apply(this,args)
      if(key)this.captureReceipts.add(key)
      this._boundCaptureReceipts()
      return result
    } finally { this.checkpoint() }
  }
}
const drainOperation = MemoryEngine.prototype.drainBacklog
MemoryEngine.prototype.drainBacklog = function(...args) {


  const previous = this._draining
  const run = () => drainOperation.apply(this,args)
  const operation = previous ? previous.catch(()=>{}).then(run) : run()
  const current = operation.finally(()=>{
    try { this.checkpoint() } finally {
      if (this._draining === current) this._draining=null
    }
  })
  this._draining = current
  return current
}
