


import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DshAdapter, READ_ONLY_MESSAGE } from '../dsh-adapter.js'
import { MemoryEngine } from '../lib/engine.js'

const CWD_A = '/workspace/examples/proj-a'
const SCOPE_A = 'project:' + CWD_A


const CTX_PASSTHROUGH = new Set(['then', 'toJSON', 'inspect', 'constructor', 'prototype', 'valueOf'])


function fakeSystemPrompt() {
  const registrations = []
  return {
    registrations,
    context(entry) {
      registrations.push(entry)
      return () => { const i = registrations.indexOf(entry); if (i >= 0) registrations.splice(i, 1) }
    },
    getContextOrder() { return 120 },
  }
}


function fakeCtx({ cwd = CWD_A, agent = null, services = {} } = {}) {
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
    provide(name, value) { provided[name] = value; return () => { delete provided[name] } },
    get: (n) => (n in provided ? provided[n] : svc[n]),
    inject(deps, callback) {
      const run = () => {
        if (!deps.every((d) => provided[d] != null || svc[d] != null)) return
        const i = waiting.indexOf(run)
        if (i >= 0) waiting.splice(i, 1)
        callback(proxy)
      }
      waiting.push(run); run()
      return () => { const i = waiting.indexOf(run); if (i >= 0) waiting.splice(i, 1) }
    },
    emit(ev, ...args) { for (const fn of listeners.get(ev) ?? []) fn(...args) },
    _sp: sp,

    assembleFor(a) {
      const entry = sp.registrations[0]
      if (!entry) return ''
      const text = typeof entry.text === 'function' ? entry.text({ agent: a, scope: a, signal: undefined }) : entry.text
      assert.equal(typeof text, 'string', '动态上下文提供者必须同步返回字符串')
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
  return { id: session.id, session, injected: [], inject(msg) { this.injected.push(msg) } }
}

function humanMessage(text) {
  return { id: `m${Math.random().toString(36).slice(2, 8)}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function newEngine() {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-w3-'))
  return { engine: new MemoryEngine({ dir }), dir }
}


function seedMemory(engine, session) {
  engine.setScope(SCOPE_A)
  engine.start(session)
  const born = Date.now() / 86400000 - 1
  const { id } = engine.remember({
    text: '素材规格：只做 2K，不碰 4K；渲染农场代号 DEMO-1001',
    cues: ['素材规格'],
    born,
    now: Date.now(),
  })
  return id
}


test('★ D8: 完成一轮后，曝光被如实记录、但不强化（R1-01 显式-only 契约）', () => {
  const { engine, dir } = newEngine()
  try {
    const session = fakeSession('s1')
    const id = seedMemory(engine, 's1')
    const item = engine.log.items.get(id)
    assert.equal(item.touches, 0, '前置：新记忆初始 touches 必须是 0')
    assert.deepEqual(item.sessions, [], '前置：新记忆初始 sessions 必须为空')

    const agent = fakeAgent(session)
    const ctx = fakeCtx({ agent })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)
    const emit = (type, data) => adapter.handleSessionEvent(ctx, session, session._append(type, data))

    emit('turn/start', { turn: 1 })
    emit('user/message', humanMessage('继续搞素材规格，2K 还是 4K？'))
    const injected = ctx.assembleFor(agent)
    assert.ok(injected.includes('DEMO-1001'), '前置：慢模式必须真的把这条记忆注入进上下文')

    const afterEmit = adapter.report().feedback
    assert.ok(afterEmit.emits > 0, 'noteContextEmitted 必须被调用（emits 为 0 就是没接线）')
    assert.ok(afterEmit.idsRecorded >= 1, `应记录至少 1 个发射 id，实际 ${afterEmit.idsRecorded}`)
    assert.ok(afterEmit.lastEmitAt != null, '必须记下最后一次发射时间')

    assert.equal(item.touches, 0, '装配阶段绝不能提前强化——强化只发生在轮末')

    emit('turn/end', { turn: 1, reason: 'success' })

    assert.equal(item.touches, 0, `完成一轮（无显式使用信号）touches 必须仍为 0，实际 ${item.touches}`)
    assert.deepEqual(item.sessions, [], '曝光不记入 sessions（无使用证据）')

    const rep = adapter.report()
    assert.equal(rep.feedback.outcomes, 1, '每轮只应报一次结局')
    assert.equal(rep.feedback.reinforced, 0, `无显式使用信号 → reinforced 必须为 0，实际 ${rep.feedback.reinforced}`)
    assert.ok(rep.feedback.lastOutcomeAt != null, '必须记下结局时间')

    assert.ok(rep.feedback.engine.contextEmitted >= 1, 'engine.deliveryStats.contextEmitted 应 > 0（曝光≠使用）')
    assert.equal(rep.feedback.engine.reinforced, 0, 'engine.deliveryStats.reinforced 必须为 0（无显式使用证据）')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('★ D8: 同一轮内多次 assemble 曝光去重、且不强化（R1-01）', () => {
  const { engine, dir } = newEngine()
  try {
    const session = fakeSession('s1')
    const id = seedMemory(engine, 's1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ agent })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)
    const emit = (type, data) => adapter.handleSessionEvent(ctx, session, session._append(type, data))

    emit('turn/start', { turn: 1 })
    emit('user/message', humanMessage('继续搞素材规格，2K 还是 4K？'))

    ctx.assembleFor(agent)
    ctx.assembleFor(agent)
    ctx.assembleFor(agent)

    const mid = adapter.report().feedback
    assert.equal(mid.emits, 3, '三次装配应各记一次发射调用')
    assert.equal(engine.log.items.get(id).touches, 0, '装配阶段不得强化')
    assert.deepEqual(engine.contextCandidates({ session: 's1', turn: 1 }), [id],
      '3 次装配的去重曝光候选集只应含该 id 一次')

    emit('turn/end', { turn: 1, reason: 'success' })

    assert.equal(engine.log.items.get(id).touches, 0,
      `无显式使用信号 → 3 次装配也不得强化，实际 ${engine.log.items.get(id).touches}`)
    assert.equal(engine.log.items.get(id).sessions.length, 0)
    assert.equal(adapter.report().feedback.outcomes, 1)
    assert.equal(adapter.report().feedback.reinforced, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('★ D8: 没有可注入 id 的轮次（快模式/空库）不崩，计数如实为 0', () => {
  const { engine, dir } = newEngine()
  try {
    engine.setScope(SCOPE_A)
    engine.start('s1')
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ agent })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)
    const emit = (type, data) => adapter.handleSessionEvent(ctx, session, session._append(type, data))

    emit('turn/start', { turn: 1 })
    emit('user/message', humanMessage('今天天气不错，随便聊聊'))
    assert.doesNotThrow(() => ctx.assembleFor(agent), '快模式/空库下 memorySnapshot 不得抛')
    assert.doesNotThrow(() => emit('turn/end', { turn: 1, reason: 'success' }), '轮末不得抛')

    const fb = adapter.report().feedback
    assert.ok(fb.emits >= 1, '接线本身必须生效（emits > 0）')
    assert.equal(fb.idsRecorded, 0, '这一轮确实没有任何 id 进入上下文 → idsRecorded 必须是 0')
    assert.equal(fb.reinforced, 0, '没有注入就没有可强化的对象')
    assert.equal(fb.outcomes, 1, '结局照报一次，候选为空')
    assert.equal(adapter.report().readOnly, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('★ D8: 轮末重复投递（重试/重复 turn/end）不会二次强化', () => {
  const { engine, dir } = newEngine()
  try {
    const session = fakeSession('s1')
    const id = seedMemory(engine, 's1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ agent })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)
    const emit = (type, data) => adapter.handleSessionEvent(ctx, session, session._append(type, data))

    emit('turn/start', { turn: 1 })
    emit('user/message', humanMessage('继续搞素材规格，2K 还是 4K？'))
    ctx.assembleFor(agent)
    emit('turn/end', { turn: 1, reason: 'success' })
    emit('turn/end', { turn: 1, reason: 'success' })

    assert.equal(engine.log.items.get(id).touches, 0,
      `无显式使用信号 → 重复 turn/end 也不得强化，实际 ${engine.log.items.get(id).touches}`)
    assert.equal(adapter.report().feedback.outcomes, 1, '重复轮末由 _completedTurns 去重')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})


test('★ D19: 锁被占用时降级为只读——挂载不抛、检索仍可用、写入被明确拒绝', () => {
  const { engine, dir } = newEngine()
  try {

    const id = seedMemory(engine, 's1')
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ agent })
    const adapter = new DshAdapter(engine, {
      log: () => {},
      readOnly: true,
      readOnlyReason: READ_ONLY_MESSAGE,
    })

    assert.doesNotThrow(() => adapter.attach(ctx), '锁冲突绝不能在挂载期抛错（那会拖死 boot）')

    const rep = adapter.report()
    assert.equal(rep.readOnly, true, '降级状态必须暴露在 report() 里')
    assert.equal(rep.readOnlyReason, READ_ONLY_MESSAGE)
    assert.ok(rep.readOnlyReason.includes('another instance holds the store'))

    const emit = (type, data) => adapter.handleSessionEvent(ctx, session, session._append(type, data))


    emit('turn/start', { turn: 1 })
    emit('user/message', humanMessage('继续搞素材规格，2K 还是 4K？'))
    const injected = ctx.assembleFor(agent)
    assert.ok(injected.includes('DEMO-1001'), '只读模式下检索/注入必须照常工作')
    assert.ok(adapter.report().feedback.emits > 0, '只读并不等于停止观测发射')


    const before = engine.log.items.get(id).touches
    const r = emit('turn/end', { turn: 1, reason: 'success' })
    assert.equal(r.turnEnd?.skipped, 'read-only', '轮末写路径必须返回 read-only 拒绝')
    assert.equal(r.turnEnd?.error, READ_ONLY_MESSAGE, '拒绝文案要能让人看懂为什么')
    assert.equal(engine.log.items.get(id).touches, before, '只读模式绝不能 touch')
    assert.equal(engine.staging.pending.filter((p) => p.source === 'human').length, 0,
      '只读模式绝不能把人类输入落进暂存区')
    assert.ok(adapter.report().writeRefusals >= 1, '拒绝次数必须可观测')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('★ D19: degradeToReadOnly() 可在运行期降级，且幂等', () => {
  const { engine, dir } = newEngine()
  try {
    seedMemory(engine, 's1')
    const session = fakeSession('s1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ agent })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)
    assert.equal(adapter.report().readOnly, false, '默认不是只读')

    const first = adapter.degradeToReadOnly('Memory store is already in use by another writer')
    assert.deepEqual(first, { readOnly: true, reason: 'Memory store is already in use by another writer', changed: true })
    const second = adapter.degradeToReadOnly('其它原因')
    assert.equal(second.changed, false, '重复降级不得覆盖已记录的原因')
    assert.equal(second.reason, 'Memory store is already in use by another writer')

    const rep = adapter.report()
    assert.equal(rep.readOnly, true)
    assert.equal(rep.readOnlyDegradations, 1)


    const emit = (type, data) => adapter.handleSessionEvent(ctx, session, session._append(type, data))
    emit('turn/start', { turn: 1 })
    emit('user/message', humanMessage('继续搞素材规格，2K 还是 4K？'))
    const r = emit('turn/end', { turn: 1, reason: 'success' })
    assert.equal(r.turnEnd?.skipped, 'read-only')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('★ D19: 默认（拿到租约）不是只读，写路径照常', () => {
  const { engine, dir } = newEngine()
  try {
    const session = fakeSession('s1')
    const id = seedMemory(engine, 's1')
    const agent = fakeAgent(session)
    const ctx = fakeCtx({ agent })
    const adapter = new DshAdapter(engine, { log: () => {} })
    adapter.attach(ctx)
    const emit = (type, data) => adapter.handleSessionEvent(ctx, session, session._append(type, data))
    emit('turn/start', { turn: 1 })
    emit('user/message', humanMessage('继续搞素材规格，2K 还是 4K？'))
    ctx.assembleFor(agent)
    emit('turn/end', { turn: 1, reason: 'success' })

    const rep = adapter.report()
    assert.equal(rep.readOnly, false)
    assert.equal(rep.readOnlyReason, null)
    assert.equal(rep.writeRefusals, 0)

    assert.ok(engine.staging.pending.filter((p) => p.source === 'human').length >= 1,
      '人类输入应落进暂存区（写路径照常）')
    assert.equal(engine.log.items.get(id).touches, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
