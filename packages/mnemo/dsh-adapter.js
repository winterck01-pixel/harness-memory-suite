import {memoryOptOut,silentMemory} from './lib/context-policy.js'
import { selectCaptureText, filterAgentCaptureText, detectUserCorrection } from './lib/capture-policy.js'
import {CaptureRetryQueue} from './lib/capture-retry.js'
import {currentTurnEvents,readCurrentTurnEvents} from './lib/turn-capture.js'
import {humanInputEvidence} from './lib/temporal.js'
import { projectScope } from './lib/reliability.js'


import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'


export function createUserMessage({ content, source }) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze(content.map((block) => Object.freeze(block))),
    source: Object.freeze({ ...source }),
  })
}


export const DEFAULT_EVENT_MAP = {


  sessionStart: ['turn/start'],

  userInput: ['user/message'],

  assistant: ['assistant/message'],

  toolResult: ['tool/result'],

  turnEnd: ['turn/end'],
}


export const INJECT_MODE = { CONTEXT: 'context', MESSAGE: 'message', OFF: 'off' }


export const CONTEXT_NAME = 'mnemo'


export const CONTEXT_ORDER = 200


export const READ_ONLY_MESSAGE = 'read-only: another instance holds the store'


export const SETTLE_EVERY_TURNS = 5
export const SETTLE_MIN_INTERVAL_MIN = 10

export class DshAdapter {


  constructor(engine, {
    eventMap = DEFAULT_EVENT_MAP,
    captureRetryDelays = [500,1000,2000,5000,10000],
    log = () => {},
    injectMode = null,
    now = () => Date.now(),
    contextOrder = CONTEXT_ORDER,
    settleEveryTurns = SETTLE_EVERY_TURNS,
    settleMinIntervalMin = SETTLE_MIN_INTERVAL_MIN,
    readOnly = false,
    readOnlyReason = null,
    autoInject: _autoInjectDeprecated = undefined,
  } = {}) {
    this.engine = engine
    this.eventMap = eventMap
    this._captureRetryOptions = {delays:captureRetryDelays,log,onError:()=>{this.stats.errors++}}
    this.captureRetries = new CaptureRetryQueue(this._captureRetryOptions)
    this.log = log
    this.now = now
    this.contextOrder = contextOrder


    this.settleEveryTurns = settleEveryTurns
    this.settleMinIntervalMin = settleMinIntervalMin


    this.injectMode = injectMode ?? INJECT_MODE.CONTEXT

    this._eventProjection = new Map()
    this._projectionLimit = 512
    this._userText = new Map()

    this._scanThrough = new Map()


    this._claimedInput = new Map()
    this._turnIds = new Map()
    this._completedTurns = new Set()
    this._captureProgress = new Map()

    this._settled = new Set()

    this._contextDispose = null


    this._contextRegistered = false
    this._attached = false
    this.eventHistogram = new Map()
    this.stats = { events: 0, sessionStart: 0, userInput: 0, assistant: 0, toolResult: 0, turnEnd: 0, toolErrors: 0, contextCalls: 0, injected: 0, scopeSwitches: 0, settles: 0, errors: 0, readOnlyDegradations: 0, writeRefusals: 0 }

    this.scopeOrigin = null

    this._lastScope = null

    this._failStreak = new Map()

    this._turnHadToolError = new Map()

    this._settle = { turns: 0, at: 0, last: null }
    this._settleByScope = new Map()

    this.lastSnapshot = null
    this.lastPayload = null

    this.lastInjection = null


    this.readOnly = readOnly === true
    this.readOnlyReason = this.readOnly ? (readOnlyReason ?? READ_ONLY_MESSAGE) : null


    this._feedback = {

      emits: 0,

      idsRecorded: 0,

      outcomes: 0,

      candidates: 0,

      reinforced: 0,
      lastEmitAt: null,
      lastEmitIds: 0,
      lastOutcomeAt: null,
      lastTurn: null,

      signal: 'engine-fallback: 本轮注入过、且轮次正常完成即视为被用到（最弱但诚实）',
    }
  }


  attach(ctx) {
    if (this._attached) return
    if (this.captureRetries.closed) this.captureRetries = new CaptureRetryQueue(this._captureRetryOptions)
    this._attached = true
    const attachment = {}
    this._attachment = attachment
    this._eventDisposers = []
    this.ctx = ctx
    try {


      const o = this._scopeOriginOf(null, ctx)
      this._noteScope(o.scope, o.source, { provisional: true })
      this.engine.setScope(o.scope)
    } catch {                 }

    this._eventDisposers.push(toDisposer(ctx.on('session/event', (session, event) => {
      if (!this._attached || this._attachment !== attachment) return
      try { this.handleSessionEvent(ctx, session, event) } catch (err) {
        this.stats.errors++
        this.log(`[mnemo] session/event 处理失败: ${err?.message ?? err}`)
      }
    })))


    this._eventDisposers.push(toDisposer(ctx.on('agent/inbox/claimed', (payload) => {
      if (!this._attached || this._attachment !== attachment) return
      try { this._noteClaimed(payload) } catch {                   }
    }, { global: true })))

    if (this.injectMode === INJECT_MODE.CONTEXT) {

      if (typeof ctx.inject === 'function') {
        const watcher = ctx.inject(['systemPrompt'], (scoped) => {
          if (!this._attached) return
          this._registerContext(scoped)
          const dispose = this._contextDispose
          scoped.effect(() => () => {
            try { dispose?.() } catch {                  }
            if (this._contextDispose === dispose) {
              this._contextDispose = null
              this._contextRegistered = false
            }
          })
        })
        this._contextWatcherDispose = toDisposer(watcher)
      } else {
        this._registerContext(ctx)
      }
    }
    return () => this.detach()
  }


  _beginTurn(sid, turn) {
    if (turn == null || this._turnIds.get(sid) === turn) return
    this._turnIds.set(sid, turn)
    this._claimedInput.delete(sid)
    this._userText.delete(sid)
    this._scanThrough.delete(sid)
    this._turnHadToolError.delete(sid)
  }

  _noteClaimed(payload) {
    const agent = payload?.agent ?? null
    const sid = String(agent?.session?.id ?? agent?.id ?? 'unknown')
    const msg = payload?.message
    this._beginTurn(sid, payload?.turn)
    if (!msg || msg?.source?.kind !== 'user') return
    const t = textOf(msg)
    if (!t) return
    const turn = payload?.turn ?? 0
    const prev = this._claimedInput.get(sid)
    this._claimedInput.set(sid, prev && prev.turn === turn
      ? { ...prev, turn, text: `${prev.text}\n${t}` }
      : { turn, text: t, at: this.now(), timeZone: msg.source.clientTimeZone })
  }


  _registerContext(ctx) {
    if (this.injectMode !== INJECT_MODE.CONTEXT) return
    const sp = safeGet(ctx, 'systemPrompt')
    if (!sp || typeof sp.context !== 'function') {

      this.log('[mnemo] 无 systemPrompt 服务，动态上下文注入降级为「只产出不投递」')
      return
    }
    try {
      const handle = sp.context({
        name: CONTEXT_NAME,
        order: this.contextOrder,

        text: (asm) => this._contextText(asm),
      })

      this._contextRegistered = true
      this._contextDispose = toDisposer(handle)
      if (!this._contextDispose) {


        this.log(`[mnemo] 动态上下文已注册，但服务未返回可调用的注销句柄` +
                 `（拿到的是 ${typeof handle}）。卸载时可能残留贡献者，热重载请重启进程。`)
      }
    } catch (err) {
      this.stats.errors++
      this.log(`[mnemo] 动态上下文注册失败: ${err?.message ?? err}`)
    }
  }


  detach() {
    this._attached = false
    this._attachment = null
    for (const dispose of this._eventDisposers ?? []) {
      try { dispose?.() } catch {                                                             }
    }
    this._eventDisposers = []
    try { this._contextWatcherDispose?.() } catch {              }
    this._contextWatcherDispose = null
    try { this._contextDispose?.() } catch {              }
    this._contextDispose = null
    this._contextRegistered = false
    this._settleByScope.clear()
    this._claimedInput.clear()
    this._turnIds.clear()
    this._completedTurns.clear()
    this.captureRetries.close()
    this._captureProgress.clear()
    this._eventProjection.clear()
    this._userText.clear()
    this._scanThrough.clear()
    this._failStreak.clear()
    this._turnHadToolError.clear()
    this._attached = false
  }


  degradeToReadOnly(reason = null) {
    if (this.readOnly) return { readOnly: true, reason: this.readOnlyReason, changed: false }
    this.readOnly = true
    this.readOnlyReason = reason ?? READ_ONLY_MESSAGE
    this.stats.readOnlyDegradations++
    this.log(`[mnemo] ${this.readOnlyReason} —— 降级为只读：检索与注入照常，写入被拒绝`)
    return { readOnly: true, reason: this.readOnlyReason, changed: true }
  }


  _writeRefusal() {
    if (!this.readOnly) return null
    this.stats.writeRefusals++
    return { skipped: 'read-only', error: this.readOnlyReason ?? READ_ONLY_MESSAGE, readOnly: true }
  }


  _contextText(asm) {
    this.stats.contextCalls++
    const agent = asm?.agent ?? null
    const session = agent?.session ?? null
    const text = this._currentUserText(session)
    if(memoryOptOut(text)){const out=silentMemory('user-disabled');this.lastSnapshot=out;this.lastPayload=out;return ''}

    const o = this._scopeOriginOf(session, this.ctx)
    const scope = o.scope
    this._noteScope(scope, o.source)
    this.engine.activateSession(session?.id ?? null, scope)

    const sessionId = session?.id ?? null
    const turn = sessionId != null ? (this._turnIds.get(sessionId) ?? null) : null
    const out = this.engine.memorySnapshot({
      text,
      scope,
      session: sessionId,
      turn,
      toolError: this._turnHadToolError.get(session?.id) === true,
      userCorrect: detectUserCorrection(text),
      now: this.now(),
    })
    this.lastSnapshot = out
    this.lastPayload = out
    if (out.mode === 'slow' && out.text) this.stats.injected++


    this._noteContextEmitted(this._emittedIds(out), sessionId, turn, !selectCaptureText(text).hasOptOut)


    return out.text ? sanitizeForPrompt(out.text) : ''
  }


  _emittedIds(out) {
    const blocks = Array.isArray(out?.blocks) ? out.blocks : []
    const ids = []
    for (const b of blocks) if (b && typeof b.id === 'string' && b.id) ids.push(b.id)
    return [...new Set(ids)]
  }


  _noteContextEmitted(ids, sessionId = null, turn = null, recordUsage = true) {
    const fn = this.engine?.noteContextEmitted
    if (typeof fn !== 'function') return null
    const now = this.now()
    try {
      const rec = fn.call(this.engine, ids, { session: sessionId, turn, now, recordUsage })
      this._feedback.emits++
      this._feedback.lastEmitIds = ids.length
      this._feedback.idsRecorded += Number.isFinite(rec?.recorded) ? rec.recorded : ids.length
      this._feedback.lastEmitAt = now
      this._feedback.lastTurn = turn
      return rec
    } catch (err) {

      this.stats.errors++
      this.log(`[mnemo] noteContextEmitted 失败: ${err?.message ?? err}`)
      return null
    }
  }


  _noteTurnOutcome(sessionId, turn, context = null, completed = true) {
    const fn = this.engine?.noteTurnOutcome
    if (typeof fn !== 'function') return null
    const now = context?.now ?? this.now()
    try {
      const rec = fn.call(this.engine, { session: sessionId, turn, now, ...(completed ? {} : {usedItemIds:[]}) })
      this._feedback.outcomes++
      this._feedback.candidates += Number.isFinite(rec?.candidates) ? rec.candidates : 0
      this._feedback.reinforced += Array.isArray(rec?.reinforced) ? rec.reinforced.length : 0
      this._feedback.lastOutcomeAt = now
      return rec
    } catch (err) {
      this.stats.errors++
      this.log(`[mnemo] noteTurnOutcome 失败: ${err?.message ?? err}`)
      throw err
    }
  }


  handleSessionEvent(ctx, session, event) {
    const type = event?.type ?? event?.kind ?? 'unknown'
    this.stats.events++
    this.eventHistogram.set(type, (this.eventHistogram.get(type) ?? 0) + 1)
    const sessionId = String(session?.id ?? session ?? 'unknown')


    const o = this._scopeOriginOf(session, ctx)
    const scope = o.scope
    this._noteScope(scope, o.source)
    this.engine.activateSession(session?.id ?? null, scope)

    const projection = this._eventProjection.get(sessionId) ?? []
    projection.push(event)
    if (projection.length > this._projectionLimit) projection.splice(0, projection.length - this._projectionLimit)
    this._eventProjection.set(sessionId, projection)

    const hooks = this._classify(type)
    if (!hooks.length) return { ignored: true, type, scope }

    if (type === 'turn/start') this._beginTurn(sessionId, event?.data?.turn)
    const results = { type, scope }


    if (type === 'user/message') {
      const src = event?.data?.source
      if (src?.kind === 'mnemo' || (src?.kind === 'runtime-context' && src.sections?.some(s=>s.name==='mnemo' && s.text))) this.engine.noteDeliveryProjected?.({now:event.time ?? this.now(),channel:'runtime-context'})
    }
    const isHuman = type === 'user/message' && event?.data?.source?.kind === 'user'
    const isToolError = type === 'tool/result' && detectToolError(event?.data)

    if (isToolError) this._turnHadToolError.set(sessionId, true)

    for (const hook of hooks) {
      if (hook === 'sessionStart') results.sessionStart = this._onSessionStart(sessionId, scope)
      if (hook === 'userInput') {
        if (isHuman) {
          this.stats.userInput++
          const t = textOf(event.data)
          if (t) {
            this._userText.set(sessionId, t)
            this._scanThrough.set(sessionId, safeSeq(session) )
          }
          results.userInput = { chars: t.length }
        } else results.userInput = { skipped: '非人类输入（注入/工具结果）' }
      }
      if (hook === 'assistant') results.assistant = this._onAssistant(sessionId, scope, event)
      if (hook === 'toolResult') {
        this.stats.toolResult++
        if (isToolError) { this.stats.toolErrors++; results.toolResult = { error: true } }
      }
      if (hook === 'turnEnd') {
        const turn=event?.data?.turn ?? this._turnIds.get(sessionId)
        const key=JSON.stringify([sessionId,turn ?? event.seq])
        const originalClaim=this._claimedInput.get(sessionId)
        const claimed=originalClaim?.turn===turn ? structuredClone(originalClaim) : null
        const projection = this._eventProjection.get(sessionId) ?? []
        const projectedEvents = currentTurnEvents(projection, turn)
        const events = projectedEvents.some(e => e?.type === 'user/message' || e?.type === 'assistant/message' || e?.type === 'tool/result')
          ? projectedEvents
          : readCurrentTurnEvents(session, turn)
        const context={claimed,streakBase:this._failStreak.get(sessionId) ?? 0,now:this.now(),toolError:this._turnHadToolError.get(sessionId)===true}
        this.captureRetries.run(key,scope,()=>{
          this.engine.activateSession(sessionId,scope)
          results.turnEnd=this._onTurnEnd(sessionId,scope,event,events,context)
        })
      }
    }
    results.toolError = isToolError
    return results
  }


  _classify(eventType) {
    const out = []
    for (const [hook, types] of Object.entries(this.eventMap)) {
      if (types.includes(eventType)) out.push(hook)
    }
    return out
  }


  _onSessionStart(sessionId, scope) {
    if (this._settled.has(sessionId)) return { skipped: 'already-settled' }
    this._settled.add(sessionId)
    this.stats.sessionStart++


    const refused = this._writeRefusal()
    if (refused) return { session: sessionId, ...refused }
    try {
      const out = this.engine.start(sessionId, this.now())
      return { session: sessionId, stats: out.stats, debt: out.debt, authority: out.authority.mode }
    } catch (err) {
      this.stats.errors++
      this.log(`[mnemo] 会话补结算失败: ${err?.message ?? err}`)
      return { session: sessionId, error: String(err?.message ?? err) }
    }
  }


  _onAssistant(sessionId, scope, event) {
    this.stats.assistant++

    return { deferred: true }

  }


  _onTurnEnd(sessionId, scope, event, session, context = null) {
    this.stats.turnEnd++
    const reason = event?.data?.reason
    let turn = event?.data?.turn ?? this._turnIds.get(sessionId)
    const events = currentTurnEvents(session, turn)
    turn ??= events[0]?.data?.turn
    const turnKey=JSON.stringify([sessionId,turn])
    if (turn != null && this._completedTurns.has(turnKey)) return {skipped:'already-captured'}
    const humans = events.filter(e=>e.type==='user/message' && e.data?.source?.kind==='user')
    const claimed = context ? context.claimed : this._claimedInput.get(sessionId)
    const currentClaim = turn != null && claimed?.turn === turn ? claimed : null
    const text = humans.length ? humans.map(e=>textOf(e.data)).filter(Boolean).join('\n') : currentClaim?.text ?? ''
    const selection=selectCaptureText(text)
    const claimedSelection=selectCaptureText(currentClaim?.text)
    const hasExclusion=selection.hasOptOut || claimedSelection.hasOptOut
    const captureText=(selection.wholeTurn || claimedSelection.wholeTurn) ? '' : claimedSelection.hasOptOut ? claimedSelection.text : selection.text
    const finish = () => {
      if (turn != null) this._completedTurns.add(turnKey)
      if(this._turnIds.get(sessionId)===turn || !this._turnIds.has(sessionId)) {
        this._claimedInput.delete(sessionId)
        this._userText.delete(sessionId)
        this._scanThrough.delete(sessionId)
      }
      this._captureProgress.delete(turnKey)
    }

    const refused = this._writeRefusal()
    if (refused) { finish(); return { ...refused, turn } }


    let progress = this._captureProgress.get(turnKey)
    if (!progress || progress.turn !== turn) {
      progress = {turn,assistantSeqs:new Set()}
      this._captureProgress.set(turnKey,progress)
    }
    const completionKind = typeof reason === 'string' ? reason : reason?.kind
    const completed = (completionKind === 'completed' || completionKind === 'success') && !hasExclusion
    if (!progress.outcome) progress.outcome = this._noteTurnOutcome(sessionId,turn,context,completed) ?? {reinforced:[]}
    const outcome = progress.outcome

    if (!text) { finish(); return {skipped:'no-current-human-input', reinforced: outcome?.reinforced ?? []} }
    if (!captureText.trim()) { finish(); return {skipped:'capture-disabled-for-turn'} }


    if(progress.affect===undefined){
      const kind = typeof reason === 'string' ? reason : reason?.kind
      const failed = !!kind && kind !== 'completed' && kind !== 'success'
      const streak = failed ? (context?.streakBase ?? this._failStreak.get(sessionId) ?? 0) + 1 : 0
      if (this._turnIds.get(sessionId)===turn || !this._turnIds.has(sessionId)) this._failStreak.set(sessionId, streak)
      const toolError = context?.toolError ?? this._turnHadToolError.get(sessionId) === true
      progress.runtimeFailed = failed || toolError
      progress.runtimeTracked = turn!=null && (!this._turnIds.has(sessionId)||this._turnIds.get(sessionId)===turn||this.engine.hasTaskTurn?.({session:sessionId,scope,turn}))
      if(progress.runtimeTracked && typeof this.engine.noteTaskRuntimeOutcome==='function')this.engine.noteTaskRuntimeOutcome({session:sessionId,scope,turn,failed,toolError:!!toolError})
      if (this._turnIds.get(sessionId)===turn || !this._turnIds.has(sessionId)) this._turnHadToolError.set(sessionId, false)
      progress.affect = affectFromTurn({failed,streak,toolError})
      progress.now = context?.now ?? this.now()
    }
    const affect=progress.affect

    let evidence = humanInputEvidence(events)
    if (!evidence.length && currentClaim?.at != null) evidence = [{source:'human',at:currentClaim.at,timeZone:currentClaim.timeZone}]
    evidence = evidence.map(e => ({...e,sessionId}))
    for (const e of events) {
      if (e.type !== 'assistant/message' || progress.assistantSeqs.has(e.seq)) continue
      const answer = hasExclusion ? '' : filterAgentCaptureText(textOf(e.data?.message ?? e.data))
      if(progress.runtimeFailed){
        if(answer && progress.runtimeTracked && typeof this.engine.recordTaskTrial==='function')this.engine.recordTaskTrial({session:sessionId,scope,turn,text:answer,eventRef:JSON.stringify([sessionId,turn,e.seq??null])})
      } else if (answer) this.engine.postTurn({text:answer,scope,session:sessionId,source:'agent',affect:0,fastMode:false,now:e.time ?? progress.now,captureKey:JSON.stringify([sessionId,turn,'assistant',e.seq])})


      progress.assistantSeqs.add(e.seq)
    }
    const out = this.engine.taskEnd({
      text: captureText, cues: [], scope, affect,
      session: sessionId,
      evidence,


      usedItemIds: outcome?.reinforced ?? [],
      captureKey:JSON.stringify([sessionId,turn,'human']),
      now: progress.now,
    })

    finish()

    const settled = this._maybeSettle(scope)
    if (settled) out.stagingSettled = { captured: settled.captured.length, dropped: settled.dropped.length, kept: settled.kept, noised: settled.noised }
    out.affect = affect
    return out
  }


  _maybeSettle(scope) {

    if (this.readOnly) return null
    const everyTurns = Number(this.settleEveryTurns ?? SETTLE_EVERY_TURNS)
    const minMs = Number(this.settleMinIntervalMin ?? SETTLE_MIN_INTERVAL_MIN) * 60000
    if (!(everyTurns > 0) && !(minMs > 0)) return null
    const now = this.now()
    const state=this._settleByScope.get(scope) ?? {turns:0,at:0,dueSince:now,last:null}
    this._settleByScope.set(scope,state)
    state.turns++
    const dueByTurns = everyTurns > 0 && state.turns >= everyTurns
    const dueByTime = minMs > 0 && (now - state.dueSince) >= minMs
    if (!dueByTurns && !dueByTime) return null
    try {
      const settled = this.engine.settleStaging({ now, scope })
      state.turns=0;state.at=now;state.dueSince=now
      this.stats.settles++
      state.last = { at: now, scope, ...{ captured: settled.captured.length, dropped: settled.dropped.length, kept: settled.kept } }
      this._settle={...state}
      return settled
    } catch (err) {
      this.stats.errors++
      this.log(`[mnemo] 暂存区补结算失败: ${err?.message ?? err}`)
      return null
    }
  }


  injectNow(agent, snapshot) {
    if(memoryOptOut(this._currentUserText(agent?.session)))return {ok:false,reason:"user-disabled"}
    const text = snapshot?.text ?? ''
    if (!text) return { ok: false, reason: 'empty' }
    if (typeof agent?.inject !== 'function') return { ok: false, reason: 'agent.inject 不可用' }
    try {
      agent.inject(createUserMessage({
        content: [{ type: 'text', text: sanitizeForPrompt(text) }],


        source: {
          kind: 'mnemo',
          form: 'snapshot',
          sections: snapshot.sections ?? [],
        },
      }))
      const sessionId = agent.session?.id
      if (sessionId) this._noteContextEmitted(this._emittedIds(snapshot),sessionId,this._turnIds.get(sessionId),!selectCaptureText(this._currentUserText(agent.session)).hasOptOut)
      this.engine.noteDeliveryQueued?.({now:this.now()})
      this.stats.injected++
      this.lastInjection = { channel: 'agent.inject', tokens: snapshot.tokens, at: this.now() }
      return { ok: true, channel: 'agent.inject', tokens: snapshot.tokens }
    } catch (err) {
      this.stats.errors++
      return { ok: false, reason: String(err?.message ?? err) }
    }
  }


  _currentUserText(session) {
    if (!session) return ''
    const id = String(session.id ?? 'unknown')

    const turn = this._turnIds.get(id)
    const claimed = this._claimedInput.get(id)
    if (claimed?.text && (turn == null || claimed.turn === turn)) return claimed.text
    const projection = this._eventProjection.get(id) ?? []
    const projectedEvents = currentTurnEvents(projection, turn)
    const events = projectedEvents.some(e => e?.type === 'user/message' || e?.type === 'assistant/message' || e?.type === 'tool/result')
      ? projectedEvents
      : readCurrentTurnEvents(session, turn)
    return events.filter(e=>e.type==='user/message' && e.data?.source?.kind==='user').map(e=>textOf(e.data)).filter(Boolean).join('\n')

  }


  _agentOf(ctx, session) {
    try {
      const agents = ctx?.get?.('agents')
      if (!agents || typeof agents.list !== 'function') return null
      const sid = String(session?.id ?? session ?? '')
      for (const a of agents.list() ?? []) {
        if (a?.session === session || String(a?.id) === sid) return a
      }
    } catch {                            }
    return null
  }


  _scopeOf(session, ctx) {
    return this._scopeOriginOf(session, ctx).scope
  }


  _scopeOriginOf(session, ctx) {
    const cwd = session?.header?.cwd
    if (cwd) return { scope: scopeLabel(cwd), source: 'session.header.cwd' }
    const ws = safeGet(ctx, 'sandboxPolicy')?.workspaceRoot
    if (ws) return { scope: scopeLabel(ws), source: 'sandboxPolicy.workspaceRoot' }
    return { scope: scopeLabel(process.cwd()), source: 'process.cwd' }
  }


  _noteScope(scope, source, { provisional = false } = {}) {
    if (!this.scopeOrigin) {
      this.scopeOrigin = {
        scope, source,

        provisional: provisional || source !== 'session.header.cwd',
      }
      this._lastScope = scope
      return
    }

    if (scope === this._lastScope) {

      if (this.scopeOrigin.provisional && source === 'session.header.cwd') {
        this.scopeOrigin = { ...this.scopeOrigin, provisional: false, adoptedAt: Date.now() }
      }
      return
    }
    const from = { scope: this._lastScope, source: this.scopeOrigin.source }
    const wasProvisional = this.scopeOrigin.provisional === true
    this._lastScope = scope
    this.stats.scopeSwitches++

    if (wasProvisional && source === 'session.header.cwd') {
      this.scopeOrigin = { ...this.scopeOrigin, provisional: false, firstSessionScope: scope }
    }

    if (this.stats.scopeSwitches === 1) {
      this.log(`[mnemo] 作用域切换：${from.scope}（${from.source}）→ ${scope}（${source}）。` +
               `跨作用域的记忆互相检索不到，若这不是预期行为请检查 cwd 推导。` +
               (wasProvisional
                 ? `（注意：原基准是挂载时的推测值——那时还没有会话，尚未写入任何记忆，故不构成失忆。）`
                 : ''))
    }
  }


  report() {
    return {
      ...this.stats,
      scope: this.engine.scope,
      scopeOrigin: this.scopeOrigin,

      lastScope: this._lastScope,
      injectMode: this.injectMode,


      contextRegistered: this._contextRegistered === true,

      contextDisposeAvailable: typeof this._contextDispose === 'function',
      eventHistogram: Object.fromEntries([...this.eventHistogram].sort((a, b) => b[1] - a[1])),
      eventMap: this.eventMap,
      captureRetries: this.captureRetries.report(),
      sessions: [...this._userText.keys()],

      claimedInput: Object.fromEntries([...this._claimedInput].map(([k, v]) => [k, { turn: v.turn, text: String(v.text).slice(0, 120) }])),
      lastInjection: this.lastInjection,

      staging: this.engine.staging.stats(),
      topCues: this.engine.staging.topCues(6),

      settle: { ...this._settle },

      goalCues: this.engine.goalCues,


      readOnly: this.readOnly === true,
      readOnlyReason: this.readOnlyReason,


      feedback: { ...this._feedback, engine: this._engineFeedback() },
    }
  }


  _engineFeedback() {
    const d = this.engine?.deliveryStats
    if (!d) return null
    return {
      contextEmitted: d.contextEmitted ?? 0,
      lastContextAt: d.lastContextAt ?? null,
      reinforced: d.reinforced ?? 0,
      lastReinforcedAt: d.lastReinforcedAt ?? null,
    }
  }
}


export function safeGet(ctx, name) {
  try { return ctx?.get?.(name) ?? undefined } catch { return undefined }
}


function scopeLabel(p) { return projectScope(p) }


function toDisposer(handle) {
  if (typeof handle === 'function') return handle
  if (handle && typeof handle.dispose === 'function') return () => handle.dispose()
  if (handle && typeof handle[Symbol.dispose] === 'function') return () => handle[Symbol.dispose]()
  return null
}


export function affectFromTurn({ failed, streak = 0, toolError = false } = {}) {
  if (!failed) return 0
  if (streak >= 2 || toolError) return -0.6
  return -0.3
}


export function sanitizeForPrompt(text) {
  return String(text ?? '').replace(/\{(?=\{)/g, '{\u200b')
}


export function textOf(input, { includeReasoning = false } = {}) {
  if (!input) return ''
  if (typeof input === 'string') return input
  const node = input.message ?? input.data ?? input
  const content = node?.content ?? input.content
  if (Array.isArray(content)) return textOfBlocks(content, { includeReasoning })
  if (typeof content === 'string') return content
  if (typeof input.text === 'string') return input.text
  if (typeof node?.text === 'string') return node.text
  return ''
}


function textOfBlocks(content, { includeReasoning = false } = {}) {
  return content
    .map((b) => {
      if (!b) return ''
      if (typeof b === 'string') return b

      if (b.type === 'reasoning' || b.type === 'thinking' || b.type === 'redacted_thinking') {
        return includeReasoning && typeof b.text === 'string' ? b.text : ''
      }

      if (b.type === 'tool-result') return typeof b.content === 'string' ? b.content : ''
      if (typeof b.text === 'string') return b.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
}


export function detectToolError(data) {
  if (!data) return false
  if (data.error !== undefined) return true
  const content = data.message?.content ?? data.content
  if (Array.isArray(content)) return content.some((b) => b?.isError === true)
  return false
}


function safeSeq(session) {
  try {
    const n = Number(session?.seq)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch { return 0 }
}


export function defaultDataDir() {
  return join(homedir(), '.dsh', 'mnemo')
}
