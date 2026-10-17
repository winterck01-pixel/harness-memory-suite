import {join} from 'node:path'
import {ActivationShadowCapture} from './lib/activation-shadow.js'
import {selectCaptureText} from './lib/capture-policy.js'
import {memoryOptOut} from './lib/context-policy.js'
import {registerUsageTools} from './lib/usage-tools.js'
import {evolutionReadiness} from './lib/evolution-readiness.js'
import {registerEvolutionTools} from './lib/evolution-tools.js'
import {presentRecall} from './lib/recall-presentation.js'
import { registerMemoryTools, MEMORY_USAGE_GUIDANCE } from './lib/memory-tools.js'
import { Maintenance } from './lib/maintenance.js'
import { modelGenerator } from './lib/model-client.js'
import { acquireLock } from './lib/lock.js'
import { BUILD_ID, projectScope, usable } from './lib/reliability.js'


import { MemoryEngine } from './lib/engine.js'
import { DshAdapter, defaultDataDir } from './dsh-adapter.js'
import { defaultConfig, mergeConfig } from './lib/config.js'
import { runRetro } from './lib/retrospect.js'

export const name = 'dsh-mnemo'


export const inject = []


export async function apply(ctx, config = {}) {
  const verbose = config.verbose !== false


  const logger = (() => { try { return ctx.logger } catch { return null } })()
  const log = typeof config.log === 'function'
    ? config.log
    : (msg) => {
        if (!verbose) return
        try { logger?.info?.(msg) } catch {                    }
      }


  const dataDir = config.dir ?? defaultDataDir()
  let readOnly = false
  let leaseRelease = null
  try {
    leaseRelease = acquireLock(dataDir, '.engine-lock')
  } catch (error) {
    readOnly = true
    log(`[mnemo] 写锁被占用（${error?.message ?? error}）；降级为只读模式：检索/注入可用，写入会被拒绝`)
  }
  const releaseWriter = () => { if (leaseRelease) { leaseRelease(); leaseRelease = null } }
  let initialized = false
  ctx.effect(() => () => { if (!initialized) releaseWriter() }, 'mnemo: release startup lease')
  let closed = false
  const engine = new MemoryEngine({
    dir: dataDir,
    config: pickEngineConfig(config),
  })

  const assertWritable = () => {
    if (!readOnly) return
    throw Error('Memory store is read-only: another harness instance holds the writer lock. Close it, or start this instance with a different config.dir.')
  }


  engine.setReadOnly(readOnly, readOnly ? 'another harness instance holds the writer lock' : null)

  const lifetime = new AbortController()
  const maintenance = new Maintenance(engine, modelGenerator(ctx),{corpusPath:config.evaluationCorpusPath??null})
  const maintenanceClaims = new Set()

  const askUser = async (request) => {
    const uq = ctx.get('userQuestions')
    if (!uq || typeof uq.ask !== 'function') throw Error('userQuestions service unavailable')
    return uq.ask(request)
  }
  // Explicit opt-in. Shadow candidates never enter recall, maintenance,
  // review approval or automatic promotion, regardless of configuration.
  let activationShadow = null
  if (config.activationShadow?.enabled === true) {
    try {
      activationShadow = new ActivationShadowCapture({directory:join(dataDir,'shadow'),enabled:true,
        canWrite:()=>!closed&&!readOnly&&!engine.readOnly,
        contractFingerprint:config.activationShadow.contractFingerprint,
        maxEvents:config.activationShadow.maxEvents,maxSources:config.activationShadow.maxSources,
        maxTotalEvents:config.activationShadow.maxTotalEvents,maxBytes:config.activationShadow.maxBytes})
    } catch (error) {
      log('[mnemo] shadow capture unavailable; main memory continues')
      activationShadow = {capture:()=>({status:'unavailable'}),report:()=>({enabled:true,mode:'shadow-only',productionEligible:false,lastError:'ledger-unavailable'})}
    }
  }
  const adapter = new DshAdapter(engine, {
    activationShadow,

    readOnly,
    readOnlyReason: readOnly ? 'another harness instance holds the writer lock' : null,
    eventMap: config.eventMap,
    log,
    injectMode: config.injectMode,
    contextOrder: config.contextOrder,
    settleEveryTurns: config.settleEveryTurns,
    settleMinIntervalMin: config.settleMinIntervalMin,
    now: config.now,
  })


  let scope = config.scope ?? null
  if (!scope) {
    try { scope = adapter._scopeOf(null, ctx) } catch { scope = 'default' }
  }
  engine.setScope(scope)


  let started = null
  try {
    started = engine.start(null)
    for (const [legacy, cwd] of Object.entries(config.legacyScopes ?? {})) {
      engine.migrateScope(legacy,projectScope(cwd))
    }
    engine.reconcileBacklog()
    log(`[mnemo] 就绪 · 记忆 ${started.stats.total} 条 · ` +
        `层级 A${started.stats.dist.A}/B${started.stats.dist.B}/C${started.stats.dist.C}/D${started.stats.dist.D} · ` +
        `欠账 ${started.backlog.count} 项(成本 ${started.debt}) · 权限 ${started.authority.mode}`)
  } catch (err) {

    releaseWriter()
    throw new Error(`Mnemo startup refused to protect stored data: ${err?.message ?? err}`, {cause:err})
  }


  const detach = adapter.attach(ctx)


  const api = {
    engine,
    adapter,
    activationShadow,

    preTurn: (signal) => engine.preTurn(signal),


    memorySnapshot: (signal) => engine.memorySnapshot(signal),

    postTurn: (signal) => { assertWritable(); return engine.postTurn(signal) },

    taskEnd: (signal) => { assertWritable(); return engine.taskEnd(signal) },

    settleStaging: (opts) => { assertWritable(); return engine.settleStaging(opts) },

    recall: (query, opts) => engine.recall(query, opts),

    remember: (payload) => { assertWritable(); return engine.remember(payload) },

    pinRule: (payload) => { assertWritable(); return engine.pinRule(payload) },

    noteContextEmitted: (ids, opts) => engine.noteContextEmitted(ids, opts),
    noteTurnOutcome: (opts) => { assertWritable(); return engine.noteTurnOutcome(opts) },

    scopeReport: (opts) => engine.scopeReport(opts),

    gateReport: (opts) => engine.gateReport(opts),
    evaluateRevision: (id,opts) => { assertWritable(); return engine.evaluateRevision(id,opts) },
    queueRevision: (id,opts) => { assertWritable(); return engine.queueRevision(id,opts) },
    applyEvaluatedRevision: (id,opts) => { assertWritable(); return engine.applyEvaluatedRevision(id,opts) },

    deliveryReport: (opts) => engine.deliveryReport(opts),

    inspect: (opts) => engine.inspect(opts),
    selfCheck: () => engine.selfCheck(),
    rollback: (id, seq, reason) => { assertWritable(); return engine.rollback(id, seq, reason) },
    unarchive: (id, opts) => { assertWritable(); return engine.unarchive(id, opts) },
    versions: (id) => engine.versions(id),
    runSafetyCheck: (results, opts) => { assertWritable(); return engine.runSafetyCheck(results, opts) },
    drainBacklog: (handler, opts) => { assertWritable(); return engine.drainBacklog(handler, opts) },

    injectNow: (agent, snapshot) => adapter.injectNow(agent, snapshot),

    lastPayload: () => adapter.lastPayload,

    lastSnapshot: () => adapter.lastSnapshot,

    lastInjection: () => adapter.lastInjection,
    report: () => ({ buildId: BUILD_ID, readOnly, engine: engine.inspect(), adapter: adapter.report(), start: started }),
    buildId: BUILD_ID,
    readOnly,
    maintenance,
    detach: () => {
      if(closed)return
      closed=true;lifetime.abort();maintenance.closed=true;detach()
      const finish=()=>{try{if(!readOnly)engine.checkpoint()}finally{releaseWriter()}}
      return engine._draining ? engine._draining.catch(()=>{}).finally(finish) : finish()
    },
    _config: mergeConfig(defaultConfig(), config),
  }
  if (typeof ctx.provide === 'function') ctx.provide('mnemo', api)
  else ctx.mnemo = api


  registerOnService(ctx, 'tools', (tools) => {
    try {
      if (!tools?.register) return
      tools.register({
        name: 'mnemo_recall',
        description:
          'Search your own long-term memory (the mnemo plugin) for things you or the user ' +
          'said or decided earlier — facts, preferences, decisions, constraints. Use it when ' +
          'you are unsure whether something was discussed before, or the user asks "do you ' +
          'remember X". Returns matching memories ranked by relevance, with a lexical relevance score (not a truth-confidence score). ' +
          'Only current-project memories are searched by default. Prefer approved derived conclusions among relevant hits; otherwise return labeled raw excerpts. Use view=raw for full original text. This never raises trust or rewrites memories.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: {
              type: 'string',
              description: 'What to search for — a natural-language phrase or keywords.',
            },
            limit: {
              type: 'number',
              description: 'Max results to return (default 5).',
            },
            view: {type:'string',enum:['conclusions','raw'],description:'Default conclusions: prefer approved summaries and bounded excerpts; raw preserves full source text.'},
            allProjects: {
              type: 'boolean',
              description: 'Search across all projects, not just the current one (default false).',
            },
          },
          required: ['query'],
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              found: { type: 'number', description: 'How many memories matched.' },
              memories: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    text: { type: 'string' },
                    score: { type: 'number', description: 'Relevance 0-1.' },
                  },
                },
              },
            },
          },
          render: (args, value) => {
            const ms = value?.memories ?? []
            const text = !ms.length
              ? '（没有找到相关记忆）'
              : ms.map((m, i) => `${i + 1}. ${m.id ?? ''} [${m.score.toFixed(2)}] ${m.text}`).join('\n')
            return [{ type: 'text', text }]
          },
        },
        execute: async (args, exec) => {
          const query = String(args?.query ?? '').trim()
          if (!query) return { found: 0, memories: [] }
          const limit = Number(args?.limit ?? 5) || 5
          const allProjects = Boolean(args?.allProjects)
          const session = exec?.agent?.session
          const scope = session?.header?.cwd ? projectScope(session.header.cwd) : config.scope

          const usageSession=session?.id ?? exec?.agent?.id
          const usageTurn=adapter._turnIds.get(usageSession)
          const usageText=adapter._currentUserText(session)
          if (memoryOptOut(usageText)) throw new Error('Memory recall disabled for this turn')
          const usageAllowed=!readOnly&&!closed&&!selectCaptureText(usageText).hasOptOut
          if (!scope && !allProjects) throw new Error('Recall requires an invoking session; refusing to guess its project')
          const resultLimit=Math.max(1,Math.min(20,Math.floor(limit)))
          const options = {scope,limit:20,signal:exec?.signal?AbortSignal.any([exec.signal,lifetime.signal]):lifetime.signal,agent:exec?.agent}
          const hits = allProjects || config.semanticRecall === false
            ? engine.recall(query,{...options,allScopes:allProjects})
            : await maintenance.semanticRecall(query,options)
          const currentScope=session?.header?.cwd ? projectScope(session.header.cwd) : config.scope
          const currentText=adapter._currentUserText(session)
          if (memoryOptOut(currentText)) throw new Error('Memory recall disabled for this turn')
          const memories=presentRecall(engine,hits,{scope,allProjects,view:args?.view??'conclusions',limit:resultLimit})
          if(usageAllowed&&!closed&&!lifetime.signal.aborted&&!exec?.signal?.aborted&&!allProjects&&usageSession&&scope&&usageTurn!=null&&adapter._turnIds.get(usageSession)===usageTurn&&currentScope===scope&&!memoryOptOut(currentText)&&!selectCaptureText(currentText).hasOptOut)
            engine.exposeUsageReferences({session:usageSession,scope,turn:usageTurn,ids:memories.map(m=>m.id)})
          return {found:memories.length,memories}
        },
      })
      registerEvolutionTools(tools,{engine,maintenance,ask:askUser,claims:maintenanceClaims,configuredScope:config.scope,lifetime,assertWritable})
      registerMemoryTools(tools,{engine,ask:askUser,configuredScope:config.scope,lifetime,assertWritable})
      registerUsageTools(tools,{engine,assertWritable,lifetime,resolveExecution:exec=>{
        const session=exec?.agent?.session
        const sessionId=session?.id ?? exec?.agent?.id
        const scope=session?.header?.cwd ? projectScope(session.header.cwd) : null
        const turn=adapter._turnIds.get(sessionId)
        const userText=adapter._currentUserText(session)
        if(memoryOptOut(userText)||selectCaptureText(userText).hasOptOut)throw Error('Memory usage recording disabled for this turn')
        if(!exec?.agent?.id||!sessionId||!scope||turn==null)throw Error('Trusted current session, project and turn required')
        return {session:sessionId,scope,turn}
      }})
      log('[mnemo] recall and human-confirmed correction tools registered')
    } catch (err) {
      log(`[mnemo] recall 工具注册跳过: ${err?.message ?? err}`)
    }
  })

  registerOnService(ctx, 'systemPrompt', (sp) => {
    if (!sp?.context) return
    sp.context({name:'knowledge-memory-usage',order:190,text:()=>MEMORY_USAGE_GUIDANCE+' When you adopt a memory, use mnemo_report_usage prepare then declare with its receipt and reason. Declarations are not verified success. Use not_applicable only for an exact memory version unsuitable for this session; do not suppress human rules.'})
  })


  registerOnService(ctx, 'commands', (commands) => {
    try {
      if (!commands?.register) return
      commands.register({
        name: 'mnemo',
        description: '记忆系统：status / evolution [ID] / retry / inspect / check / safety / recall / evaluate / maintain / retro / proposals / scopes / compact / unarchive / accept / confirm / dispute / supersede / forget / rollback',
        input: { hint: 'status / inspect / evaluate <记忆ID> [候选正文] / maintain summary|skill|revisions / safety / scopes / retro / proposals / compact [dry] / unarchive <记忆ID> / accept <草稿ID> / confirm|dispute|forget <记忆ID> / supersede <旧ID> <新ID> / rollback <ID> <版本>' },
        handler: async ({ rawInput = '', agent, signal }) => {
          const callSignal = signal ? AbortSignal.any([signal,lifetime.signal]) : lifetime.signal
          const commandScope = agent?.session?.header?.cwd ? projectScope(agent.session.header.cwd) : config.scope
          if (commandScope) engine.activateSession(agent?.id ?? null, commandScope)
          const [sub = 'status', ...args] = rawInput.trim().split(/\s+/).filter(Boolean)


          const READ_ONLY_SUBS = new Set(['status', 'evolution', 'inspect', 'check', 'safety', 'recall', 'proposals', 'scopes'])
          if (readOnly && !READ_ONLY_SUBS.has(sub)) {
            return { kind: 'error', text: '记忆库处于只读模式（另一个 harness 实例持有写锁），该子命令需要写权限：' + sub }
          }
          let claimedJob = null
          try {
            let value
            if(sub==='evolution') {
              if(args.length>1)throw Error('Usage: evolution [candidate-or-memory-id]')
              value=evolutionReadiness(engine,{scope:commandScope,corpusPath:maintenance.corpusPath,id:args[0]??null})
            } else if (['confirm','dispute','forget','supersede'].includes(sub)) {
              if(!commandScope)throw Error('Review requires a session project')
              if(args.length !== (sub==='supersede'?2:1))throw Error('Usage: '+sub+' <memory-id>'+ (sub==='supersede'?' <replacement-id>':''))
              value=engine.review(args[0], {confirm:'confirmed',dispute:'disputed',forget:'rejected',supersede:'superseded'}[sub], {scope:commandScope,reason:'Explicit /mnemo '+sub,supersededBy:args[1]})
            } else if(sub==='recall') {
              if(!commandScope||!args.length)throw Error('Usage: recall <query>')
              value=await maintenance.semanticRecall(args.join(' '),{scope:commandScope,signal:callSignal,agent})
            } else if(sub==='evaluate'||(sub==='maintain'&&args[0]==='revisions')) {
              if(!commandScope)throw Error('Evaluation requires a session project')
              let filter
              if(sub==='evaluate') {
                if(!args.length)throw Error('Usage: evaluate <memory-id> [candidate text]')
                const proposal=engine.log.proposals.get(args[0])
                let queued
                if(proposal) {
                  if(args.length!==1||proposal.scope!==commandScope||proposal.proposalKind!=='revision-evaluate'||proposal.status!=='pending')throw Error('Unknown pending revision in this project')
                  const sourceId=proposal.sourceRevisions[0].id
                  const current=engine.log.items.get(sourceId)
                  if(!current||engine._revisionBinding(current)!==proposal.sourceBinding)throw Error('Revision source changed; queue a fresh candidate')
                  const existing=engine.backlog.items.find(j=>j.id===proposal.id)
                  if(existing) {
                    if(maintenanceClaims.has(existing.id)||engine.backlog.inflight.has(existing.id))throw Error('This evaluation is already running')
                    existing.payload.force=true
                    queued={item:existing};engine.checkpoint()
                  }
                  else {


                    queued=engine.backlog.enqueue({kind:'revision-evaluate',target:sourceId,payload:{ids:[sourceId],scope:commandScope,sourceBinding:proposal.sourceBinding,candidateText:proposal.text,force:true},dedupe:false})
                    if(!engine.backlog.items.includes(queued.item))throw Error('Revision queue is full')
                    queued.item.id=proposal.id;engine.checkpoint()
                  }
                } else queued=engine.queueRevision(args[0],{scope:commandScope,text:args.length>1?args.slice(1).join(' '):null})
                if(maintenanceClaims.has(queued.item.id)||engine.backlog.inflight.has(queued.item.id))throw Error('This evaluation is already running')
                claimedJob=queued.item.id;maintenanceClaims.add(claimedJob)
                filter=job=>job.id===queued.item.id&&job.payload?.scope===commandScope
              } else {
                if(args.length!==1)throw Error('Usage: maintain revisions')
                filter=job=>job.kind==='revision-evaluate'&&job.payload?.scope===commandScope
              }
              value=await engine.drainBacklog(job=>maintenance.process(job,{scope:commandScope,signal:callSignal,agent}),{limit:sub==='evaluate'?1:engine.cfg.backlog.DRAIN_PER_CALL,filter})
              if(value.failed.length)return {kind:'error',text:JSON.stringify(value,null,2)}
            } else if(sub==='maintain') {
              if(!commandScope)throw Error('Maintenance requires a session project')
              const kind=args[0]??'summary'
              if(!['summary','skill'].includes(kind)||args.length>1)throw Error('Usage: maintain summary|skill')
              const items=engine.log.alive(commandScope).slice(-12)
              if(!items.length)throw Error('No current-project memories')
              const taskKind=kind==='summary'?'gist-compress':'skill-compile'

              engine.reconcileBacklog()
              const payload={ids:items.map(it=>it.id),scope:commandScope}
              const retry=engine.backlog.items.find(job=>job.kind===taskKind && job.payload?.scope===commandScope && !job.payload?.automatic && !maintenanceClaims.has(job.id) && !engine.backlog.inflight.has(job.id))
              let queued
              if(retry) {
                retry.payload=payload;delete retry.error;retry.lastQueued=Date.now();retry.hits++
                queued={item:retry}
              } else queued=engine.backlog.enqueue({kind:taskKind,target:commandScope+':'+kind,payload,dedupe:false})
              claimedJob=queued.item.id;maintenanceClaims.add(claimedJob)
              engine.checkpoint()
              if(!engine.backlog.items.some(job=>job.id===queued.item.id))throw Error('Maintenance queue is full; request was not scheduled')
              value=await engine.drainBacklog(job=>maintenance.process(job,{scope:commandScope,signal:callSignal,agent}),{limit:engine.cfg.backlog.DRAIN_PER_CALL+1,filter:job=>job.payload?.scope===commandScope && job.kind===taskKind && (job.id===queued.item.id || job.payload?.automatic===true || job.error)})
              if(!value.processed.some(job=>job.id===queued.item.id) && !value.failed.some(job=>job.id===queued.item.id)) {
                const own=await engine.drainBacklog(job=>maintenance.process(job,{scope:commandScope,signal:callSignal,agent}),{limit:1,filter:job=>job.id===queued.item.id && job.payload?.scope===commandScope})
                value={processed:[...value.processed,...own.processed],failed:[...value.failed,...own.failed],remaining:own.remaining}
              }
              if(!value.processed.some(job=>job.id===queued.item.id) && !value.failed.some(job=>job.id===queued.item.id))throw Error('Maintenance request was removed before execution; retry when the queue has space')
              if(value.failed.length)return {kind:'error',text:JSON.stringify(value,null,2)}
            } else if(sub==='retro') {


              if(args.length)throw Error('Usage: retro')
              value=await runRetro({engine,maintenance,ask:askUser,scope:commandScope,signal:callSignal,agent,claims:maintenanceClaims})
            } else if(sub==='accept') {
              if(!commandScope||args.length!==1)throw Error('Usage: accept <proposal-id>')
              value=engine.acceptProposal(args[0],{scope:commandScope})
            } else if (sub === 'unarchive') {

              if (!commandScope || args.length !== 1) throw Error('Usage: unarchive <memory-id>')
              value = engine.unarchive(args[0], { scope: commandScope })
            } else if (sub === 'scopes') {

              if (args.length) throw Error('Usage: scopes')
              value = engine.scopeReport()
            } else if (sub === 'compact') {


              if (args.length > 1 || (args[0] && args[0] !== 'dry')) throw Error('Usage: compact [dry]')
              value = engine.compact(args[0] === 'dry' ? { dryRun: true } : {})
            } else if (sub === 'rollback') {
              const [id, seq] = args
              if (args.length !== 2 || !/^\d+$/.test(seq) || !Number.isSafeInteger(Number(seq))) {
                return { kind: 'error', text: '用法：/mnemo rollback <记忆ID> <非负整数版本序号>' }
              }
              if(!commandScope||engine.log.items.get(id)?.scope!==commandScope)throw Error('Unknown memory in this project')
              value = api.rollback(id, Number(seq), 'manual')
            } else {
              if (args.length !== 0) return { kind: 'error', text: `子命令 ${sub} 不接受额外参数。` }
              switch (sub) {
                case 'retry': if(!commandScope)throw Error('Retry requires a session project'); value = adapter.captureRetries.retryFailed(commandScope); break
                case 'status': value = {
                  buildId: BUILD_ID,
                  readOnly: !!api.readOnly,
                  readOnlyReason: api.readOnlyReason ?? null,
                  feedback: adapter.report().feedback,
                  scope: commandScope ?? engine.scope,
                  stats: engine.log.stats(),
                  captureRetries: adapter.captureRetries.report(),
                  activationShadow: activationShadow?.report() ?? {enabled:false},
                  backlog: engine.backlog.report(),
                  safety: engine.safety,

                  delivery: engine.deliveryReport(),
                  eval: engine.evalReport(),
                  evolution:evolutionReadiness(engine,{scope:commandScope,corpusPath:maintenance.corpusPath}),
                  gate: engine.gateReport(),
                  archive: engine.archiveReport({ scope: commandScope }),

                  scopes: (() => { const r = engine.scopeReport(); return { total: r.total, deadCount: r.deadCount, reachableCount: r.reachableCount, deadRatio: r.deadRatio, deadScopes: r.deadScopes, hints: r.hints } })(),
                }; break
                case 'inspect': value = api.inspect({scope:commandScope}); break
                case 'check': value = api.selfCheck(); break
                case 'safety': value = await maintenance.safety({scope:commandScope,signal:callSignal,agent}); break
                case 'proposals': value = [...engine.log.proposals.values()].filter(p=>p.scope===commandScope&&p.status==='pending'); break
                default: return { kind: 'error', text: '未知子命令。可用：status / evolution [ID] / retry / inspect / check / safety / recall / evaluate <ID> [候选正文] / maintain summary|skill|revisions / retro / proposals / scopes / compact / unarchive / accept / confirm / dispute / supersede / forget / rollback' }
              }
            }
            return { kind: 'success', text: JSON.stringify(value ?? null, null, 2) }
          } catch (error) {
            return { kind: 'error', text: error?.message || String(error) }
          } finally { if(claimedJob)maintenanceClaims.delete(claimedJob) }
        },
      })
    } catch (err) {
      log(`[mnemo] 命令注册跳过: ${err?.message ?? err}`)
    }
  })

  ctx.effect(() => () => api.detach(), 'mnemo: flush and release writer')
  initialized = true


}


function registerOnService(ctx, name, setup) {
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject([name], scoped => setup(scoped.get?.(name)))
      return
    }
  } catch {                                      }
  setup(ctx.get?.(name))
}


function pickEngineConfig(config) {
  const out = {}


  for (const k of ['curve', 'levels', 'wake', 'resonance', 'retrieve', 'cues', 'wm', 'tokens', 'router', 'staging', 'gate', 'backlog', 'probe', 'store', 'bounds', 'forget', 'eval', 'taskInjection']) {
    if (config[k]) out[k] = config[k]
  }
  return out
}

export { MemoryEngine, DshAdapter }
