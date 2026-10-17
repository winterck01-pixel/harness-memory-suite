


import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import {
  DshAdapter, textOf, detectToolError, sanitizeForPrompt, safeGet,
  createUserMessage, DEFAULT_EVENT_MAP, INJECT_MODE, CONTEXT_NAME, CONTEXT_ORDER,
  affectFromTurn,
} from '../dsh-adapter.js'
import { MemoryEngine } from '../lib/engine.js'
import * as plugin from '../index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = join(HERE, '..')
const CWD_A = '/workspace/examples/proj-a'
const CWD_B = '/workspace/examples/proj-b'


function fakeSystemPrompt() {
  const registrations = []
  return {
    registrations,
    context(entry) {
      if (registrations.some((r) => r.name === entry.name)) throw new Error(`prompt context "${entry.name}" is already registered`)
      registrations.push(entry)
      return () => { const i = registrations.indexOf(entry); if (i >= 0) registrations.splice(i, 1) }
    },
    getContextOrder() { return 120 },
  }
}


const CTX_PASSTHROUGH = new Set(['then', 'toJSON', 'inspect', 'constructor', 'prototype', 'valueOf'])

function fakeCtx({ cwd = CWD_A, session = null, agent = null, services = {} } = {}) {
  const listeners = new Map()
  const sp = fakeSystemPrompt()
  const provided = Object.create(null)

  const waiting = []
  const svc = {
    systemPrompt: sp,


    sandboxPolicy: { workspaceRoot: cwd },
    ...(agent ? { agents: { list: () => [agent] } } : {}),
    ...services,
  }
  const raw = {
    logger: { info() {}, warn() {}, error() {} },

    baseUrl: '',
    effect(setup) { return setup() },
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, [])
      listeners.get(ev).push(fn)
      return () => { const a = listeners.get(ev); const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1) }
    },


    provide(name, value) {
      if (name in provided) throw new Error(`service "${name}" has been registered`)
      provided[name] = value
      return () => { delete provided[name] }
    },
    get: (n) => (n in provided ? provided[n] : svc[n]),


    inject(deps, callback) {
      const run = () => {
        if (!deps.every((d) => provided[d] != null || svc[d] != null)) return

        const i = waiting.indexOf(run)
        if (i >= 0) waiting.splice(i, 1)
        callback(proxy)
      }
      waiting.push(run)
      run()
      return () => { const i = waiting.indexOf(run); if (i >= 0) waiting.splice(i, 1) }
    },


    _provideService(name, value) {
      provided[name] = value
      for (const run of [...waiting]) run()
      return value
    },
    emit(ev, ...args) { for (const fn of listeners.get(ev) ?? []) fn(...args) },
    _sp: sp,
    _svc: svc,
    _cwd: cwd,

    assembleFor(a) {
      const entry = sp.registrations[0]
      if (!entry) return ''
      const text = typeof entry.text === 'function' ? entry.text({ agent: a, scope: a, signal: undefined }) : entry.text
      assert.equal(typeof text, 'string', '动态上下文提供者必须同步返回字符串——loop 里是直接 text(context) 调的')
      return text
    },
  }
  const proxy = new Proxy(raw, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (prop in provided) return provided[prop]
      if (typeof prop === 'symbol' || CTX_PASSTHROUGH.has(String(prop))) return undefined
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
    set(target, prop, value) {


      if (prop in target || prop in provided) { target[prop] = value; return true }
      throw new Error(`cannot set property "${String(prop)}" without provide`)
    },
  })
  return proxy
}


function fakeSession(id, { cwd = CWD_A } = {}) {
  const events = []
  return {
    id,
    header: { cwd },
    get seq() { return events.length },
    snapshotEvents(from = 0, to = events.length) { return events.slice(from, to) },
    eventAt(n) { return events[n] },

    _append(type, data) {
      const e = { type, seq: events.length, time: 1758200000000 + events.length, data }
      events.push(e)
      return e
    },
    _events: events,
  }
}


function fakeAgent(session) {
  return {
    id: session.id,
    session,
    injected: [],
    inject(msg) { this.injected.push(msg) },
  }
}


function humanMessage(text) {
  return { id: `m${Math.random().toString(36).slice(2, 8)}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function newEngine() {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-ad-'))
  return { engine: new MemoryEngine({ dir }), dir }
}


test('★ 适配层与整个插件包都不 import 任何 @deepseek-ai/*（符号链接安装后 parent-walk 找不到）', () => {
  const files = [join(PKG, 'index.js'), join(PKG, 'dsh-adapter.js')]
  for (const f of readdirSync(join(PKG, 'lib'))) if (f.endsWith('.js')) files.push(join(PKG, 'lib', f))
  const offenders = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8')

    for (const m of src.matchAll(/^\s*import\s[^\n]*?from\s+['"]([^'"]+)['"]/gm)) {
      if (m[1].startsWith('@deepseek-ai/')) offenders.push(`${f} → ${m[1]}`)
    }
  }
  assert.deepEqual(offenders, [], '零依赖是硬约束：符号链接会把插件解析到真实路径')
})


test('textOf 能从真实事件载荷里抠出文本（信封是 event.data，不是 event.content）', () => {

  assert.equal(textOf(humanMessage('帮我渲染')), '帮我渲染')

  assert.equal(textOf({ turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '好的' }] } }), '好的')

  assert.equal(textOf({ turn: 1, step: 1, message: { content: [{ type: 'tool-result', content: 'exit 0' }] } }), 'exit 0')

  assert.equal(textOf({ turn: 1, step: 1, message: { content: [{ type: 'text', text: '系统提示' }] } }), '系统提示')

  assert.equal(textOf('裸串'), '裸串')
  assert.equal(textOf(null), '')
  assert.equal(textOf({}), '')
})

test('★ dsh 里没有 tool/error 事件，失败要认得出 tool/result 上的两种标记', () => {

  assert.equal(detectToolError({ turn: 1, step: 2, error: { name: 'BashError', code: 'E_EXIT' } }), true)

  assert.equal(detectToolError({ message: { content: [{ type: 'tool-result', content: 'boom', isError: true }] } }), true)

  assert.equal(detectToolError({ message: { content: [{ type: 'tool-result', content: 'ok' }] } }), false)
  assert.equal(detectToolError(undefined), false)
})

test('★ `{{` 必须转义——否则会打挂 assemble 的插值器（未知变量直接抛错）', () => {
  const raw = '模板写成 {{name}} 和 {{cwd}} 两处'
  const safe = sanitizeForPrompt(raw)
  assert.equal(safe.includes('{{'), false, '出站文本里不能留下裸的 {{')

  assert.equal(safe.replace(/\u200b/g, ''), raw)
})


test('attach 会按真实契约注册动态上下文（名字 + 排序位）', () => {
  const { engine, dir } = newEngine()
  try {
    engine.setScope('project:/workspace/examples/proj-a'); engine.start('s1')
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ session, agent })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)

    assert.equal(ctx._sp.registrations.length, 1)
    assert.equal(ctx._sp.registrations[0].name, CONTEXT_NAME)
    assert.equal(ctx._sp.registrations[0].order, CONTEXT_ORDER)
    assert.equal(typeof ctx._sp.registrations[0].text, 'function')
    assert.equal(adapter.report().contextRegistered, true)
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('没有 systemPrompt 服务时优雅降级，不抛、不影响挂载', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const ctx = fakeCtx({ services: { systemPrompt: undefined } })
    const adapter = new DshAdapter(engine, { log: () => {} })
    assert.doesNotThrow(() => adapter.attach(ctx))
    assert.equal(adapter.report().contextRegistered, false)

    const session = fakeSession('s1')
    ctx.emit('session/event', session, session._append('turn/start', { turn: 1 }))
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('两个同名 context 重复注册会抛——所以 attach 必须幂等（重复挂载不重复注册）', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const ctx = fakeCtx()
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)
    adapter.attach(ctx)
    assert.equal(ctx._sp.registrations.length, 1)
    adapter.detach()
    assert.equal(ctx._sp.registrations.length, 0)
    adapter.attach(ctx)
    assert.equal(ctx._sp.registrations.length, 1)
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})


test('★ 慢模式给记忆全文；快模式只给"有存货"这个事实，绝不泄露记忆内容', () => {
  const { engine, dir } = newEngine()
  try {
    engine.setScope('project:/workspace/examples/proj-a'); engine.start('s1')
    engine.remember({ text: '引用顺序处理：递归引用要先拓扑排序', cues: ['引用顺序'], born: Date.now() / 86400000 - 1, now: Date.now() })


    const sSlow = fakeSession('s-slow')
    const aSlow = fakeAgent(sSlow)
    const ctxSlow = fakeCtx({ session: sSlow, agent: aSlow })
    new DshAdapter(engine, { log: () => {} }).attach(ctxSlow)
    sSlow._append('turn/start', {turn:1})
    sSlow._append('user/message', humanMessage('继续搞那个引用顺序，递归引用怎么排？'))
    const slow = ctxSlow.assembleFor(aSlow)
    assert.ok(slow.length > 0, '慢模式应产出记忆文本')
    assert.ok(slow.includes('引用顺序'), '应包含召回的那条记忆')
    assert.ok(slow.includes('不是当前用户指令'), '必须带免责句')


    const sFast = fakeSession('s-fast')
    const aFast = fakeAgent(sFast)
    const ctxFast = fakeCtx({ session: sFast, agent: aFast })
    new DshAdapter(engine, { log: () => {} }).attach(ctxFast)
    sFast._append('turn/start', {turn:1})
    sFast._append('user/message', humanMessage('今天天气不错'))
    const fast = ctxFast.assembleFor(aFast)
    assert.equal(fast.includes('引用顺序'), false, '快模式绝不能把库存记忆抖出来')
    assert.equal(fast.includes('拓扑排序'), false)
    assert.ok(fast.length < 200, `快模式负载必须极短，实际 ${fast.length} 字符`)
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('★ 空库时快模式返回空串——空串才是「这轮没有动态上下文」的信号', () => {
  const { engine, dir } = newEngine()
  try {
    engine.setScope('project:/workspace/examples/proj-a'); engine.start('s1')
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ session, agent })
    new DshAdapter(engine, { log: () => {} }).attach(ctx)
    session._append('user/message', humanMessage('随便聊聊'))
    assert.equal(ctx.assembleFor(agent), '', '没有内容可注入时必须返回空串，否则会白发一条没信息的消息')
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('★★ 提供者必须幂等：同样输入连调两次必须给同样的字符串（差分靠这个）', () => {
  const { engine, dir } = newEngine()
  try {
    engine.setScope('project:/workspace/examples/proj-a'); engine.start('s1')
    engine.remember({ text: 'alpha deployment uses staged verification', cues: ['alpha','deployment'], source:'human', born: Date.now() / 86400000 - 1, now: Date.now() })
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ session, agent })
    new DshAdapter(engine, { log: () => {} }).attach(ctx)

    session._append('turn/start', {turn:1})
    session._append('user/message', humanMessage('继续 alpha deployment 的方案'))
    const a = ctx.assembleFor(agent)
    const b = ctx.assembleFor(agent)
    const c = ctx.assembleFor(agent)
    assert.ok(a.length > 0)
    assert.equal(a, b, '连调第二次必须一致——不一致会让 loop 每步都落一条新消息')
    assert.equal(b, c, '第三次也一样')
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('★ 不是人类输入就不算"当前输入"（注入内容与工具结果是同一种事件类型，靠 source 区分）', () => {
  const { engine, dir } = newEngine()
  try {
    engine.setScope('project:/workspace/examples/proj-a'); engine.start('s1')
    engine.remember({ text: '达芬奇免费版没有语音转文字', cues: ['达芬奇'], born: Date.now() / 86400000 - 1, now: Date.now() })
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ session, agent })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)


    session._append('turn/start', {turn:1})
    session._append('user/message', humanMessage('达芬奇那边怎么办'))
    ctx.emit('session/event', session, session._events[session._events.length - 1])
    assert.ok(ctx.assembleFor(agent).includes('达芬奇'))


    session._append('user/message', { id: 'inj1', role: 'user', content: [{ type: 'text', text: '无关的注入内容' }], source: { kind: 'plugin', plugin: 'other' } })
    ctx.emit('session/event', session, session._events[session._events.length - 1])
    assert.ok(ctx.assembleFor(agent).includes('达芬奇'), '注入内容不该顶掉人类输入')
    assert.equal(adapter.report().userInput, 1, '只有人类那条算 userInput')
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})


test('★ 补结算每个会话只做一次（sessionStart 映射到 turn/start，而它每轮都发）', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const session = fakeSession('s1')
    const ctx = fakeCtx({ session })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)

    for (let turn = 1; turn <= 4; turn++) ctx.emit('session/event', session, session._append('turn/start', { turn }))
    assert.equal(adapter.report().sessionStart, 1, '每轮都 start() 会每轮重读整个事件日志，把热路径拖垮')
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('不同会话各自补结算一次', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const ctx = fakeCtx({ session: fakeSession('s1') })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)
    const a = fakeSession('s1'); const b = fakeSession('s2')
    ctx.emit('session/event', a, a._append('turn/start', { turn: 1 }))
    ctx.emit('session/event', b, b._append('turn/start', { turn: 1 }))
    ctx.emit('session/event', a, a._append('turn/start', { turn: 2 }))
    assert.equal(adapter.report().sessionStart, 2)
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})


test('★★ 作用域取 session.header.cwd（每会话），不是 ctx 级 cwd——多项目并行才不会串味', () => {
  const { engine, dir } = newEngine()
  try {
    const sessionA = fakeSession('sA', { cwd: CWD_A })
    const sessionB = fakeSession('sB', { cwd: CWD_B })
    const ctx = fakeCtx({ session: sessionA })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)

    ctx.emit('session/event', sessionA, sessionA._append('turn/start', { turn: 1 }))
    assert.equal(engine.scope, 'project:/workspace/examples/proj-a')
    engine.remember({ text: 'A 项目的渲染参数', cues: ['渲染'], scope: 'project:/workspace/examples/proj-a' })

    ctx.emit('session/event', sessionB, sessionB._append('turn/start', { turn: 1 }))
    assert.equal(engine.scope, 'project:/workspace/examples/proj-b', '切到另一个会话，作用域要跟着走')
    assert.equal(engine.recall('渲染', { scope: 'project:/workspace/examples/proj-b' }).length, 0, 'B 会话看不见 A 项目的记忆')
    assert.equal(engine.recall('渲染', { scope: 'project:/workspace/examples/proj-a' }).length, 1)
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('推不出 header.cwd 时回落到 sandboxPolicy.workspaceRoot / process.cwd()', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const ctx = fakeCtx({ services: { sandboxPolicy: { workspaceRoot: '/workspace/examples/fallback-proj' } } })
    const adapter = new DshAdapter(engine, { log: () => {} })
    assert.equal(adapter._scopeOf(null, ctx), 'project:/workspace/examples/fallback-proj')
    assert.equal(adapter._scopeOf(null, fakeCtx()), 'project:/workspace/examples/proj-a')
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('★★ 绝不能读未声明的 ctx 属性——cordis 会抛错，而 apply 里抛错 = 插件挂载失败', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const ctx = fakeCtx()

    assert.throws(() => ctx.cwd, /without inject/)

    const adapter = new DshAdapter(engine, { log: () => {} })
    assert.doesNotThrow(() => adapter.attach(ctx))
    const session = fakeSession('s1')
    assert.doesNotThrow(() => adapter.handleSessionEvent(ctx, session, session._append('turn/start', { turn: 1 })))
    assert.doesNotThrow(() => ctx.assembleFor(fakeAgent(session)))
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('safeGet 是唯一允许的服务访问方式（服务缺失只返回 undefined，不抛）', () => {
  assert.equal(safeGet(fakeCtx(), 'systemPrompt')?.context !== undefined, true)
  assert.equal(safeGet(fakeCtx(), '不存在的服务'), undefined)
  assert.equal(safeGet(null, 'anything'), undefined)


  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/([^:'"\\])\/\/[^\n]*/g, '$1')


  const ALLOWED = ['on', 'off', 'get', 'set', 'provide', 'emit', 'logger', 'fiber', 'baseUrl', 'inject', 'effect', 'mnemo']
  const offenders = []
  for (const f of [join(PKG, 'index.js'), join(PKG, 'dsh-adapter.js')]) {
    const src = stripComments(readFileSync(f, 'utf8'))
    for (const m of src.matchAll(/\bctx\.([a-zA-Z_$][\w$]*)/g)) {
      if (ALLOWED.includes(m[1])) continue
      offenders.push(`${f.split('/').pop()} → ctx.${m[1]}`)
    }
  }
  assert.deepEqual(offenders, [], '读未声明的 ctx 服务会抛错并让插件挂载失败，一律改用 safeGet(ctx, name)')
})


test('★★ 本轮输入取自 agent/inbox/claimed（否则永远慢一轮：首轮空、之后是上一轮的问题）', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ session, agent })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)


    session._append('user/message', humanMessage('上一轮的问题：素材规格'))

    ctx.emit('agent/inbox/claimed', { agent, turn: 2, message: humanMessage('本轮的问题：FFI 线程怎么拆') })

    assert.equal(adapter._currentUserText(session), '本轮的问题：FFI 线程怎么拆',
      '★ 必须用本轮 claim 到的输入——只用日志会读到上一轮的问题，召回全错位')
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('非人类 claim（注入快照 / 工具结果）不参与检索线索', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ session, agent })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)

    ctx.emit('agent/inbox/claimed', {
      agent, turn: 1,
      message: { id: 'inj', role: 'user', content: [{ type: 'text', text: '【记忆】注入的快照' }], source: { kind: 'mnemo', form: 'snapshot' } },
    })
    assert.equal(adapter._currentUserText(session), '', '注入内容不是检索线索，必须被忽略')

    ctx.emit('agent/inbox/claimed', { agent, turn: 2, message: humanMessage('真正的问题') })
    assert.equal(adapter._currentUserText(session), '真正的问题')
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('同一轮多条人类消息拼接；换轮则重置', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ session, agent })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)

    ctx.emit('agent/inbox/claimed', { agent, turn: 3, message: humanMessage('第一句') })
    ctx.emit('agent/inbox/claimed', { agent, turn: 3, message: humanMessage('第二句') })
    assert.equal(adapter._currentUserText(session), '第一句\n第二句')
    ctx.emit('agent/inbox/claimed', { agent, turn: 4, message: humanMessage('新的一轮') })
    assert.equal(adapter._currentUserText(session), '新的一轮', '换轮必须重置，不能把上一轮的问题带进来')
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('没有本轮 claim 时回落读日志——覆盖 resume / fork 的历史输入', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const session = fakeSession('s1')
    const ctx = fakeCtx({ session })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)

    session._append('turn/start', {turn:1})
  session._append('user/message', humanMessage('历史里的问题'))
    assert.equal(adapter._currentUserText(session), '历史里的问题')
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})


test('★ 通道 B 走 agent.inject 并带官方认可的 source 形状（kind + form:snapshot）', () => {
  const { engine, dir } = newEngine()
  try {
    engine.setScope('project:/workspace/examples/proj-a'); engine.start('s1')
    engine.remember({ text: '外置 USB4 SSD 必备', cues: ['SSD'], born: Date.now() / 86400000 - 1, now: Date.now() })
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const adapter = new DshAdapter(engine, { log: () => {} })

    const snap = engine.memorySnapshot({ text: 'SSD 该怎么配', scope: engine.scope, session: 's1', force: true })
    const r = adapter.injectNow(agent, snap)

    assert.equal(r.ok, true)
    assert.equal(agent.injected.length, 1)
    const msg = agent.injected[0]
    assert.equal(msg.role, 'user', '必须走 user 身份——system 身份会把缓存前缀打碎')
    assert.equal(msg.source.kind, 'mnemo')
    assert.equal(msg.source.form, 'snapshot', "form:'snapshot' 的语义正是「同源的后一个快照取代前一个」")
    assert.ok(Array.isArray(msg.source.sections), 'sections 让界面能把每段归因到贡献者')
    assert.equal(typeof msg.content[0].text, 'string')
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('通道 B：空快照与缺失 agent.inject 都要安全返回，不抛', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const adapter = new DshAdapter(engine, { log: () => {} })
    assert.equal(adapter.injectNow({ inject() {} }, { text: '' }).ok, false)
    assert.equal(adapter.injectNow({}, { text: 'x' }).ok, false)
    assert.equal(adapter.injectNow(null, { text: 'x' }).ok, false)
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('createUserMessage 的内联实现与真实语义一致（id 唯一 / user 身份 / 冻结）', () => {
  const a = createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } })
  const b = createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } })
  assert.notEqual(a.id, b.id)
  assert.equal(a.role, 'user')
  assert.ok(Object.isFrozen(a))
  assert.ok(Object.isFrozen(a.content))
})


test('真实事件序列（turn/start → user/message → assistant/message → tool/result → turn/end）全程不崩', () => {
  const { engine, dir } = newEngine()
  try {
    engine.setScope('project:/workspace/examples/proj-a'); engine.start('s1')
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ session, agent })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)

    const emit = (type, data) => ctx.emit('session/event', session, session._append(type, data))
    emit('turn/start', { turn: 1 })
    emit('user/message', humanMessage('帮我把渲染脚本跑一下'))
    emit('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '先看看脚本在哪' }] }, stream: [] })
    emit('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'Bash', arguments: '{}' })
    emit('tool/result', { turn: 1, step: 1, message: { content: [{ type: 'tool-result', content: 'done' }] } })
    emit('turn/end', { turn: 1, reason: 'success' })

    const rep = adapter.report()
    assert.equal(rep.events, 6)
    assert.equal(rep.sessionStart, 1)
    assert.equal(rep.userInput, 1)
    assert.equal(rep.assistant, 1)
    assert.equal(rep.toolResult, 1)
    assert.equal(rep.turnEnd, 1)
    assert.equal(rep.toolErrors, 0)
    assert.equal(rep.errors, 0)

    assert.equal(rep.eventHistogram['tool/call'], 1)
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('★ tool/result 带 error 时记为意外信号（不是靠不存在的 tool/error 事件）', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const session = fakeSession('s1')
    const ctx = fakeCtx({ session })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)
    ctx.emit('session/event', session, session._append('tool/result', { turn: 1, step: 1, error: { name: 'BashError', code: 'E_EXIT' }, message: { content: [] } }))
    assert.equal(adapter.report().toolErrors, 1)
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('不认识的事件类型只记直方图，不触发任何钩子（为 dsh 加新事件留余量）', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const session = fakeSession('s1')
    const ctx = fakeCtx({ session })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)
    const before = adapter.report()
    const r = adapter.handleSessionEvent(ctx, session, session._append('compaction/start', { reason: 'auto' }))
    assert.equal(r.ignored, true)
    assert.equal(adapter.report().turnEnd, before.turnEnd ?? 0)
    assert.equal(adapter.report().eventHistogram['compaction/start'], 1)
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('事件处理器抛错被兜住，计入 errors 而不是掀翻整个 agent loop', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const session = fakeSession('s1')
    const ctx = fakeCtx({ session })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)
    session._append('turn/start', {turn:1})
    session._append('user/message', humanMessage('test orchard'))

    engine.taskEnd = () => { throw new Error('boom') }
    assert.doesNotThrow(() => ctx.emit('session/event', session, session._append('turn/end', { turn: 1, reason: 'success' })))
    assert.equal(adapter.report().errors, 1)
    assert.equal(adapter.report().captureRetries.pending, 1)
    adapter.detach()
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('事件映射表用的是真实类型名（回归守卫：别再猜 session/start 或 tool/error）', () => {
  const all = Object.values(DEFAULT_EVENT_MAP).flat()
  assert.ok(all.includes('turn/start'))
  assert.ok(all.includes('user/message'))
  assert.ok(all.includes('assistant/message'))
  assert.ok(all.includes('tool/result'))
  assert.ok(all.includes('turn/end'))
  assert.equal(all.includes('session/start'), false, 'dsh 没有 session/start 会话事件')
  assert.equal(all.includes('tool/error'), false, 'dsh 没有 tool/error 事件，失败挂在 tool/result 上')
  assert.equal(all.includes('session/idle'), false, 'dsh 没有 session/idle 事件')
})


test('插件入口形态正确（Cordis 契约：name / inject / apply）', () => {
  assert.equal(plugin.name, 'dsh-mnemo')
  assert.deepEqual(plugin.inject, [], 'inject 写错服务名 = 插件挂载失败，所以一律留空、用 ctx.get 惰性取')
  assert.equal(typeof plugin.apply, 'function')
})

test('★ 对外暴露必须走 ctx.provide（往 ctx 上直挂属性 = cordis 抛错 = 插件挂载失败）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-provide-'))
  try {
    const ctx = fakeCtx({ services: { systemPrompt: undefined } })

    assert.throws(() => { ctx.mnemo = {} }, /without provide/)

    await plugin.apply(ctx, { dir, verbose: false })
    assert.ok(ctx.mnemo, 'provide 之后 ctx.mnemo 读得到')
    assert.equal(ctx.get('mnemo'), ctx.mnemo, 'get(name) 与 ctx.<name> 读到的应是同一个服务')


    const src = readFileSync(join(PKG, 'index.js'), 'utf8')
    assert.ok(/ctx\.provide\(\s*'mnemo'/.test(src), '暴露服务要用 ctx.provide(\'mnemo\', …)')
    assert.ok(!/^\s*ctx\.mnemo\s*=/m.test(src), '不准直接 ctx.mnemo = …（cordis 会抛 without provide）')

    ctx.mnemo.detach()
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('apply 能挂上一个只有最小服务集的 ctx（无 systemPrompt 也不能崩）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-apply-'))
  try {
    const ctx = fakeCtx({ services: { systemPrompt: undefined } })
    ctx.baseUrl = import.meta.url

    const out = await plugin.apply(ctx, { dir, verbose: false })
    assert.equal(out, undefined, 'apply 必须返回 undefined（cordis 的 effect 契约）')
    assert.ok(ctx.mnemo, 'ctx.mnemo 应被挂上')
    assert.ok(ctx.mnemo.engine && ctx.mnemo.adapter, '引擎与适配层挂在 ctx.mnemo 上')
    assert.equal(typeof ctx.mnemo.memorySnapshot, 'function')
    assert.equal(typeof ctx.mnemo.injectNow, 'function')
    ctx.mnemo.detach()
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('apply 走完整流程：会话建立 → 投记忆 → 装配上下文 → 记忆真的出现在里面', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-e2e-'))
  try {
    const session = fakeSession('s-e2e', { cwd: '/workspace/examples/demo-studio' })
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ session, agent })
    ctx.baseUrl = import.meta.url
    await plugin.apply(ctx, { dir, verbose: false })


    ctx.emit('session/event', session, session._append('turn/start', { turn: 1 }))
    assert.equal(ctx.mnemo.engine.scope, 'project:/workspace/examples/demo-studio')

    ctx.mnemo.remember({ text: 'DemoStudio 的 FFI 调用必须在 UI 线程外做', cues: ['FFI'], born: Date.now() / 86400000 - 1, now: Date.now() })
    session._append('user/message', humanMessage('FFI 那块怎么改？'))

    const text = ctx.assembleFor(agent)
    assert.ok(text.includes('FFI'), '应召回刚投的记忆')
    assert.equal(ctx.mnemo.report().adapter.contextRegistered, true)
    ctx.mnemo.detach()
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('★★ 作用域来源不一致必须可见（静默失忆是本系统最阴的故障）', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const logs = []

    const session = fakeSession('s1', { cwd: '/workspace/examples/other-project' })
    const ctx = fakeCtx({ cwd: '/workspace/examples/initial-project', session })
    const adapter = new DshAdapter(engine, { log: (m) => logs.push(m) })
    adapter.attach(ctx)
    ctx.emit('session/event', session, session._append('turn/start', { turn: 1 }))

    const rep = adapter.report()
    assert.equal(rep.scopeSwitches, 1, '切换要被记下来')
    assert.equal(rep.scopeOrigin.scope, 'project:/workspace/examples/initial-project', '保留首次来源，便于定位分歧')
    assert.ok(logs.some((l) => l.includes('作用域切换')), '必须打日志——不能悄悄发生')
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('injectMode: off 时不注册上下文（只产出不投递）', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const ctx = fakeCtx()
    const adapter = new DshAdapter(engine, { log: () => {}, injectMode: INJECT_MODE.OFF })
    adapter.attach(ctx)
    assert.equal(ctx._sp.registrations.length, 0)
    assert.equal(adapter.report().contextRegistered, false)
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})


test('★ 思维链必须被丢掉（ReasoningBlock 与 TextBlock 形状一样，只判 b.text 必然抓错）', () => {
  const msg = {
    role: 'assistant',
    content: [
      { type: 'reasoning', text: 'The user asks about specs. Let me check the workspace first.' },
      { type: 'text', text: '你的素材只做 1080p / 2K 就够了。' },
      { type: 'reasoning', text: 'Now I should answer concisely.' },
    ],
  }

  assert.equal(textOf(msg), '你的素材只做 1080p / 2K 就够了。')
  assert.equal(textOf({ turn: 1, step: 1, message: msg }), '你的素材只做 1080p / 2K 就够了。')
  assert.equal(textOf({ turn: 1, step: 1, message: msg, stream: [] }), '你的素材只做 1080p / 2K 就够了。')

  assert.ok(textOf(msg, { includeReasoning: true }).includes('Let me check the workspace'))

  assert.equal(textOf({ content: [{ type: 'reasoning', text: 'hmm' }] }), '')
})

test('★ 情绪效价映射：单次失败不该跨阈值，反复失败/工具报错才该（通道② 曾被算死）', () => {
  assert.equal(affectFromTurn({ failed: false }), 0)
  assert.ok(Math.abs(affectFromTurn({ failed: true, streak: 1 })) < 0.55,
    '单次失败必须低于通道② 阈值——否则每失败一次就把窗口里全部候选一次性捕获')
  assert.ok(Math.abs(affectFromTurn({ failed: true, streak: 2 })) >= 0.55, '连续失败应跨过阈值')
  assert.ok(Math.abs(affectFromTurn({ failed: true, streak: 1, toolError: true })) >= 0.55,
    '失败且工具报错应跨阈值')
})

test('★ 人类输入进暂存区（source=human），模型思维链被挡在外面', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ session, agent })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)
    const emit = (type, data) => ctx.emit('session/event', session, session._append(type, data))

    emit('turn/start', { turn: 1 })
    emit('user/message', humanMessage('渲染农场代号 DEMO-1002，别记错'))
    ctx.assembleFor(agent)
    emit('assistant/message', {
      turn: 1, step: 1, stream: [],
      message: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Let me check the workspace first.' },


          { type: 'text', text: '确认：渲染农场代号是 DEMO-1002，已记下。' },
        ],
      },
    })
    emit('turn/end', { turn: 1, reason: 'success' })

    const pending = engine.staging.pending
    const human = pending.find((p) => p.source === 'human')
    assert.ok(human, `人类输入必须进暂存区；实际 pending：${JSON.stringify(pending.map((p) => [p.source, p.text.slice(0, 16)]))}`)
    assert.ok(human.text.includes('DEMO-1002'))
    const agentEntry = pending.find((p) => p.source === 'agent')
    assert.ok(agentEntry, '模型产出照旧进暂存区')
    assert.equal(agentEntry.text, '确认：渲染农场代号是 DEMO-1002，已记下。', '只取可见正文——思维链不能当"这轮发生了什么"存下来')
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('★ scopeSwitches 只记录作用域的实际变化', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ cwd: CWD_A, session, agent })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)
    const emit = (type, data) => ctx.emit('session/event', session, session._append(type, data))

    for (let turn = 1; turn <= 3; turn++) {
      emit('turn/start', { turn })
      emit('user/message', humanMessage('帮我把渲染脚本跑一下'))
      ctx.assembleFor(agent)
      emit('assistant/message', { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '好的' }] }, stream: [] })
      ctx.assembleFor(agent)
      emit('turn/end', { turn, reason: 'success' })
    }

    const rep = adapter.report()
    assert.equal(rep.scopeSwitches, 0,
      `ctx 与 session 的 cwd 一致时不该有任何切换，实际 ${rep.scopeSwitches} 次（修复前会随调用次数线性增长）`)
    assert.equal(rep.lastScope, 'project:/workspace/examples/proj-a')
    assert.equal(rep.scopeOrigin.provisional, false, '拿到会话级权威作用域后应撤掉"推测值"标记')
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('★ contextRegistered 独立于注销句柄类型报告注册成功', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const ctx = fakeCtx()
    const logs = []

    ctx._sp.context = (entry) => { ctx._sp.registrations.push(entry); return undefined }
    const adapter = new DshAdapter(engine, { log: (m) => logs.push(m) })
    adapter.attach(ctx)

    const rep = adapter.report()
    assert.equal(rep.contextRegistered, true, '注册成功就该读成 true——这是「注入是否生效」的读数')
    assert.equal(rep.contextDisposeAvailable, false, '拿不到注销句柄要单独记，别和"注册成功"混为一谈')
    assert.ok(logs.some((l) => l.includes('注销句柄')), '必须留一条可见警告——卸载残留只能靠它排查')
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('★ 长会话里的暂存区补结算（修复前只在下一个会话开始时才结算）', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ session, agent })
    const adapter = new DshAdapter(engine, { log: () => {}, settleEveryTurns: 2, settleMinIntervalMin: 0 })
    adapter.attach(ctx)
    const emit = (type, data) => ctx.emit('session/event', session, session._append(type, data))
    for (let turn = 1; turn <= 4; turn++) {
      emit('turn/start', { turn })
      emit('user/message', humanMessage('继续'))
      emit('turn/end', { turn, reason: 'success' })
    }
    const rep = adapter.report()
    assert.equal(rep.settles, 2, `4 轮 / 每 2 轮一次 → 应结算 2 次，实际 ${rep.settles}`)
    assert.ok(rep.settle.last, '应留下最近一次结算的结果，便于排查')

    assert.equal(engine.staging.pending.filter((p) => p.captured).length, 0)
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})


test('★ recall 工具被注册且能查到记忆（意识卡里承诺的 recall 不再落空）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-recall-'))
  try {
    const registered = []
    const fakeTools = {
      register(tool) { registered.push(tool) },
    }
    const ctx = fakeCtx({ services: { tools: fakeTools } })
    ctx.baseUrl = import.meta.url
    await plugin.apply(ctx, { dir, verbose: false })


    assert.equal(registered.length, 5, '应注册 5 个工具')
    assert.deepEqual(registered.map((t) => t.name),
      ['mnemo_recall', 'mnemo_evolve', 'mnemo_inspect_memory', 'mnemo_correct_memory', 'mnemo_report_usage'],
      '注册面应稳定为这五个工具，防再漂移')
    const tool = registered[0]
    assert.equal(tool.name, 'mnemo_recall')
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output.render, 'function')


    const scope = ctx.mnemo.engine.scope
    ctx.mnemo.remember({
      text: '渲染农场只有 3 台机器，代号 DEMO-1003',
      cues: ['渲染农场', '代号'],
      scope,
      born: Date.now() / 86400000,
      now: Date.now(),
    })
    const result = await tool.execute({ query: '渲染农场的代号' }, {agent:{session:{header:{cwd:CWD_A}}}})
    assert.equal(result.found, 1, `应命中 1 条，实际 ${result.found}`)
    assert.ok(result.memories[0].text.includes('DEMO-1003'), '命中的应是含代号那条')
    assert.equal(typeof result.memories[0].score, 'number')


    const rendered = tool.output.render({ query: 'x' }, result)
    assert.deepEqual(rendered, [{ type: 'text', text: rendered[0]?.text }])
    assert.ok(rendered[0].text.includes('DEMO-1003'), 'render 输出应包含代号')
    assert.deepEqual(tool.output.render({}, { found: 0, memories: [] }), [{ type: 'text', text: '（没有找到相关记忆）' }])
    ctx.mnemo.detach()
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('★★ 服务晚于 apply 就绪时，工具与命令仍会补注册（实机两次启动结果不同）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-recall-late-'))
  try {
    const registered = []
    const commands = []


    const ctx = fakeCtx()
    ctx.baseUrl = import.meta.url
    await plugin.apply(ctx, { dir, verbose: false })

    assert.equal(registered.length, 0, '服务没就绪时不该有注册动作')
    assert.equal(commands.length, 0, '服务没就绪时不该有注册动作')


    ctx._provideService('tools', { register(tool) { registered.push(tool) } })
    ctx._provideService('commands', { register(cmd) { commands.push(cmd) } })


    assert.equal(registered.length, 5, '★ tools 就绪后必须补注册全部 5 个工具')
    assert.deepEqual(registered.map((t) => t.name),
      ['mnemo_recall', 'mnemo_evolve', 'mnemo_inspect_memory', 'mnemo_correct_memory', 'mnemo_report_usage'])
    assert.equal(registered[0].name, 'mnemo_recall')
    assert.equal(commands.length, 1, '★ commands 就绪后必须补注册 /mnemo')
    assert.equal(commands[0].name, 'mnemo')

    ctx.mnemo.detach()
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('历史卡不注入运行计数，保留来源', () => {
  const { engine, dir } = newEngine()
  try {
    engine.start('s1')
    engine.remember({
      text: '我们只做 1080p 和 2K，永远不用 4K',
      cues: ['素材规格'],
      scope: 'p',
      source: 'human',
      born: Date.now() / 86400000,
      now: Date.now(),
    })
    const card = engine._renderCard({ scope: 'p', now: Date.now() })
    assert.ok(card.text.includes('source=human'))
    assert.ok(!card.text.includes('条长期记忆'))
    assert.ok(!card.text.includes('暂存区待捕获'))
    rmSync(dir, { recursive: true, force: true })
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})


test('官方 completed 事件不应记为失败，真实 error 仍累计失败', () => {
  const {engine, dir} = newEngine()
  try {
    const adapter = new DshAdapter(engine, {settleEveryTurns: 0, settleMinIntervalMin: 0})
    let turn=0
    const end = kind => {turn++;const session=fakeSession('s');session._append('turn/start',{turn});session._append('user/message',humanMessage('orchard'));return adapter._onTurnEnd('s', 'p', {data: {turn,reason: {kind}}},session)}
    assert.equal(end('completed').affect, 0)
    assert.equal(end('completed').affect, 0)
    assert.equal(end('error').affect, -0.3)
    assert.equal(end('error').affect, -0.6)
    assert.equal(end('completed').affect, 0)
    assert.equal(end('error').affect, -0.3)
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('晚到的 systemPrompt 必须注册，detach 后不得再次注册', () => {
  const {engine, dir} = newEngine()
  try {
    const ctx = fakeCtx({services: {systemPrompt: undefined}})
    const adapter = new DshAdapter(engine)
    adapter.attach(ctx)
    const sp = fakeSystemPrompt()
    ctx._provideService('systemPrompt', sp)
    assert.equal(sp.registrations.length, 1)
    adapter.detach()
    assert.equal(sp.registrations.length, 0)
    const ctx2 = fakeCtx({services: {systemPrompt: undefined}})
    adapter.attach(ctx2)
    adapter.detach()
    const late = fakeSystemPrompt()
    ctx2._provideService('systemPrompt', late)
    assert.equal(late.registrations.length, 0)
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('/mnemo follows CommandInvocation and CommandResult contracts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-command-'))
  const commands = []
  const ctx = fakeCtx({ services: { commands: { register(cmd) { commands.push(cmd) } } } })
  try {
    await plugin.apply(ctx, { dir, verbose: false })
    const command = commands[0]
    assert.ok(command.input?.hint, 'menu must advertise free-form subcommand input')
    for (const rawInput of ['', 'status', 'inspect', 'check']) {
      const result = await command.handler({ rawInput, attachments: [], signal: new AbortController().signal })
      assert.equal(result.kind, 'success', rawInput)
      assert.equal(typeof result.text, 'string')
      JSON.parse(result.text)
    }
    const expected = ctx.mnemo.inspect()
    assert.deepEqual(JSON.parse((await command.handler({ rawInput: ' inspect ' })).text), expected)
    for (const rawInput of ['unknown', 'rollback', 'rollback abc NaN', 'rollback abc -1', 'rollback abc 1 extra']) {
      const result = await command.handler({ rawInput })
      assert.equal(result.kind, 'error', rawInput)
      assert.ok(result.text.length)
    }
  } finally { ctx.mnemo?.detach(); rmSync(dir, { recursive: true, force: true }) }
})


test('event retry retains old turn input and scope while a new turn is active', async () => {
 const {engine,dir}=newEngine();let adapter
 try {
 engine.start('s1')
 const session=fakeSession('s1'),ctx=fakeCtx({session})
 adapter=new DshAdapter(engine,{captureRetryDelays:[5],settleEveryTurns:0,settleMinIntervalMin:0})
 adapter.attach(ctx)
 const emit=(type,data)=>ctx.emit('session/event',session,session._append(type,data))
 const original=engine.taskEnd.bind(engine);let fail=true
 engine.taskEnd=p=>{if(fail){fail=false;throw Error('temporary capture failure')}return original(p)}
 emit('turn/start',{turn:1});emit('user/message',humanMessage('orchard original human'))
 emit('assistant/message',{message:{role:'assistant',content:[{type:'text',text:'orchard original answer'}]}})
 emit('turn/end',{turn:1,reason:'success'})
 assert.equal(adapter.report().captureRetries.pending,1)
 emit('turn/start',{turn:2});emit('user/message',humanMessage('vineyard next human'))
 await new Promise(resolve=>setTimeout(resolve,30))
 assert.equal(adapter.report().captureRetries.pending,0)
 assert.ok(engine.staging.pending.some(p=>p.text==='orchard original human'))
 assert.ok(!engine.staging.pending.some(p=>p.text==='vineyard next human'))
 assert.equal(engine.staging.pending.find(p=>p.text==='orchard original answer').repeats,1)
 emit('turn/end',{turn:2,reason:'success'})
 assert.ok(engine.staging.pending.some(p=>p.text==='vineyard next human'))
 }finally{adapter?.detach();rmSync(dir,{recursive:true,force:true})}
})

test('adapter detach and reattach can capture again',()=>{
 const {engine,dir}=newEngine();let adapter
 try{
 engine.start('s1');const session=fakeSession('s1'),ctx=fakeCtx({session})
 adapter=new DshAdapter(engine,{captureRetryDelays:[],settleEveryTurns:0,settleMinIntervalMin:0})
 adapter.attach(ctx);adapter.detach()
 const before=adapter.stats.events
 ctx.emit('session/event',session,{type:'turn/start',data:{turn:0}})
 assert.equal(adapter.stats.events,before,'detached listeners must not run')
 adapter.attach(ctx)
 for(const [type,data] of [['turn/start',{turn:1}],['user/message',humanMessage('orchard reattached')],['turn/end',{turn:1,reason:'success'}]])ctx.emit('session/event',session,session._append(type,data))
 assert.ok(engine.staging.pending.some(p=>p.text==='orchard reattached'))
 assert.equal(adapter.stats.events-before,3,'reattach must register only one listener')
 }finally{adapter?.detach();rmSync(dir,{recursive:true,force:true})}
})

for(const scenario of ['advanced-turn','changed-project','opt-out','cancelled','detached']){
 test(`recall exposure refuses a ${scenario} continuation`,async()=>{
  const dir=mkdtempSync(join(tmpdir(),'mnemo-recall-lifecycle-'));let api
  try{
   const registered=[],ctx=fakeCtx({services:{tools:{register:t=>registered.push(t)}}});ctx.baseUrl=import.meta.url
   await plugin.apply(ctx,{dir,verbose:false});api=ctx.mnemo
   const session={id:'recall-session',header:{cwd:CWD_A}},controller=new AbortController(),scope=api.engine.scope
   api.adapter._turnIds.set(session.id,1)
   api.adapter._claimedInput.set(session.id,{turn:1,text:scenario==='opt-out'?'本轮不要记录。查询orchard部署':'查询orchard部署'})
   const m=api.remember({text:'orchard fixture port 8443',scope,cues:['orchard']})
   let resolve;api.maintenance.semanticRecall=()=>new Promise(r=>{resolve=r})
   const pending=registered.find(t=>t.name==='mnemo_recall').execute({query:'orchard'},{agent:{id:session.id,session},signal:controller.signal})
   assert.equal(typeof resolve,'function')
   if(scenario==='advanced-turn')api.adapter._turnIds.set(session.id,2)
   if(scenario==='changed-project')session.header.cwd=CWD_B
   if(scenario==='cancelled')controller.abort()
   if(scenario==='detached')api.detach()
   resolve([{id:m.id,score:1}]);await pending
   const state=api.engine.taskMemory.toJSON()
   assert.equal(state.sessions.reduce((n,s)=>n+s.exposures.length,0),0,'must not mint a receipt for stale, opted-out or closed execution')
  }finally{api?.detach();rmSync(dir,{recursive:true,force:true})}
 })
}
