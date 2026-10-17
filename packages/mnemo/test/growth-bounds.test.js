


import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, existsSync, writeFileSync, readFileSync, readdirSync, appendFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventLog } from '../lib/store.js'
import { MemoryEngine } from '../lib/engine.js'
import { StagingArea } from '../lib/staging.js'
import { apply } from '../index.js'

const scope = 'project:/tmp/mnemo-growth'
function fresh(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-growth-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function engine(t, cfg) {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir, config: cfg })
  e.setScope(scope)
  e.start('s')
  return e
}
const logSize = (e) => (existsSync(e.log.path) ? statSync(e.log.path).size : 0)

test('G01: checkpoint 不写 append-only 日志，只写 sidecar 状态文件', (t) => {
  const e = engine(t)
  e.remember({ text: 'orchard baseline', scope, source: 'human' })
  const logBefore = logSize(e)
  for (let i = 0; i < 50; i++) e.checkpoint()
  assert.equal(logSize(e), logBefore, 'checkpoint 不该给日志增加一个字节')
  assert.ok(existsSync(e.log.statePath), '瞬时状态应落到 sidecar 状态文件')
  const onDisk = readFileSync(e.log.path, 'utf8')
  assert.ok(!onDisk.includes('runtime-state'), '日志里不允许再出现 runtime-state 事件')
})

test('G02: 捕获凭据增长不再导致日志平方膨胀（关键回归）', (t) => {
  const e = engine(t)
  e.remember({ text: 'orchard anchor', scope, source: 'human' })
  const logBefore = logSize(e)
  let prevState = 0

  for (let i = 0; i < 400; i++) {
    e.captureReceipts.add('receipt-' + i)
    e.staging._countScope(scope, ['cue' + i], [], 1)
    e.checkpoint()
    prevState = statSync(e.log.statePath).size
  }

  assert.equal(logSize(e), logBefore, '状态变化不该进入 append-only 日志')

  assert.ok(prevState < 200 * 1024, `状态文件应保持有界，实际 ${prevState} 字节`)
})

test('G03: 捕获凭据 / 线索计数表都被封顶', (t) => {
  const e = engine(t, { bounds: { CAPTURE_RECEIPTS: 10 } })
  for (let i = 0; i < 50; i++) e.captureReceipts.add('k' + i)
  e._boundCaptureReceipts()
  assert.equal(e.captureReceipts.size, 10, '引擎级凭据必须封顶')
  assert.ok(e.captureReceipts.has('k49'), '封顶时保留最近的')
  assert.ok(!e.captureReceipts.has('k0'), '封顶时淘汰最旧的')

  const s = new StagingArea({ PENDING_ENTRIES: 5, CUE_KEYS_PER_SCOPE: 8, CUE_PROTECTED: 8, SCOPE_STATS: 2, TTL_HOURS: 24, REPEAT_THRESHOLD: 2, AFFECT_THRESHOLD: 0.55, GOAL_RESONANCE: 0.3, FAST_MODE_DEFAULT_DROP: true, MAX_POINTERS: 10 })
  for (let i = 0; i < 40; i++) s.offer({ text: 't' + i, cues: ['c' + i], scope: 'p', captureKey: 'key' + i })
  assert.ok(s.cueCount.size <= 8, `线索计数表必须封顶，实际 ${s.cueCount.size}`)
  assert.ok(s.cueDoc.size <= 8, '文档频率表必须封顶')
  assert.ok(s.cueLastOffer.size <= 8, '最近 offer 表必须封顶')
  assert.ok(s.captureKeys.size <= 5000, 'captureKeys 必须封顶')
  for (const key of ['a', 'b', 'c', 'd']) s.offer({ text: 'x', cues: ['q'], scope: key })
  assert.ok(s.scopeStats.size <= 2, `scopeStats 必须封顶，实际 ${s.scopeStats.size}`)
})

test('G04: 落盘的旧版超大快照在恢复时同样被封顶', (t) => {
  const dir = fresh(t)
  const log = new EventLog(dir)
  log.load()

  writeFileSync(log.statePath, JSON.stringify({
    version: 1,
    captureReceipts: Array.from({ length: 100 }, (_, i) => 'r' + i),
    staging: {
      pending: Array.from({ length: 50 }, (_, i) => ({ id: 's' + i, text: 't', cues: [], scope: 'p', repeats: 1, firstSeen: 1, lastSeen: 1 })),
      cueCount: Array.from({ length: 100 }, (_, i) => ['c' + i, i]),
      cueDoc: Array.from({ length: 100 }, (_, i) => ['c' + i, i]),
      cueLastOffer: Array.from({ length: 100 }, (_, i) => ['c' + i, i]),
      cueProtected: Array.from({ length: 100 }, (_, i) => 'p' + i),
      captureKeys: Array.from({ length: 100 }, (_, i) => 'k' + i),
      scopeStats: Array.from({ length: 10 }, (_, i) => ['scope' + i, { offers: i, count: [['c', 1]], doc: [['c', 1]], protected: [] }]),
    },
    backlog: { items: [] },
    safety: {},
  }))
  const e = new MemoryEngine({ dir, config: { bounds: { CAPTURE_RECEIPTS: 10, CUE_KEYS_PER_SCOPE: 8, PENDING_ENTRIES: 5, SCOPE_STATS: 2 } } })
  e.setScope(scope)
  e.start('s')
  assert.equal(e.captureReceipts.size, 10, '恢复时也要封顶引擎级凭据')
  assert.ok(e.staging.pending.length <= 5, '恢复时也要封顶暂存区')
  assert.ok(e.staging.cueCount.size <= 8, '恢复时也要封顶线索表')
  assert.ok(e.staging.scopeStats.size <= 2, '恢复时也要封顶 scopeStats')
})

test('G05: compact 只丢被覆盖的瞬时快照，记忆事件一条不少', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir })
  e.setScope(scope)
  e.start('s')
  const a = e.remember({ text: 'orchard alpha', scope, source: 'human' })
  const b = e.remember({ text: 'orchard beta', scope, source: 'agent' })
  e.touch(a.id, { reson: 0.9, now: Date.now() })
  e.review(b.id, 'confirmed', { scope, reason: 'human said so' })
  for (let i = 0; i < 20; i++) e.checkpoint()


  const legacyStates = 25
  let rawLines = ''
  for (let i = 0; i < legacyStates; i++) {
    rawLines += JSON.stringify({
      kind: 'runtime-state', seq: 100000 + i, at: Date.now(),
      state: { version: 1, captureReceipts: Array.from({ length: i }, (_, k) => 'r' + k), staging: { pending: [], cueCount: [], cueDoc: [], cueLastOffer: [], cueProtected: [], captureKeys: [], scopeStats: [] }, backlog: { items: [] }, safety: {} },
    }) + '\n'
  }
  appendFileSync(e.log.path, rawLines)
  const before = logSize(e)
  const itemsBefore = JSON.stringify([...e.log.items.values()].map((i) => [i.id, i.text, i.touches, i.trust, i.activeSeq]))
  const proposalsBefore = JSON.stringify([...e.log.proposals.values()])

  const result = e.compact()
  assert.equal(result.compacted, true)
  assert.equal(result.droppedState, legacyStates, '应精确丢掉那些被覆盖的瞬时快照')
  assert.ok(result.archive && existsSync(result.archive), '原始日志必须归档保留，而不是删除')
  assert.ok(result.afterBytes < before, '压缩后应变小')

  const replayed = new MemoryEngine({ dir })
  replayed.setScope(scope)
  replayed.start('r')
  assert.equal(JSON.stringify([...replayed.log.items.values()].map((i) => [i.id, i.text, i.touches, i.trust, i.activeSeq])), itemsBefore, '重放后条目必须完全等价')
  assert.equal(JSON.stringify([...replayed.log.proposals.values()]), proposalsBefore, '重放后提案必须完全等价')
  assert.equal(replayed.versions(a.id).length, e.versions(a.id).length, '版本链必须保留（回滚目标不能丢）')
})

test('G06: compact 遇到坏行拒绝执行，且一个字节都不删', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir })
  e.setScope(scope)
  e.start('s')
  e.remember({ text: 'orchard gamma', scope, source: 'human' })
  e.checkpoint()
  const original = readFileSync(e.log.path, 'utf8')
  writeFileSync(e.log.path, original + '{broken\n')
  const sizeBefore = logSize(e)
  assert.throws(() => e.compact(), /malformed/)
  assert.equal(logSize(e), sizeBefore, '拒绝压缩时必须保持原文件不变')
})

test('G07: 增量同步——外部追加的真实事件会被重放，损坏的日志拒绝追加', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir })
  e.setScope(scope)
  e.start('s')
  const m = e.remember({ text: 'orchard delta', scope, source: 'human' })
  const seq = e.log.seq

  const external = { kind: 'create', id: 'm-external-1', text: 'orchard external', itemKind: 'episode', scope, cues: [], entities: [], S: 1, born: Date.now() / 86400000, source: 'human', trust: 'reported', at: Date.now(), seq: seq + 1 }
  writeFileSync(e.log.path, readFileSync(e.log.path, 'utf8') + JSON.stringify(external) + '\n')
  e.log.refreshFromDisk()
  assert.ok(e.log.items.has('m-external-1'), '外部追加的事件必须被增量重放')


  writeFileSync(e.log.path, '{broken')
  assert.throws(() => e.remember({ text: 'must not append', scope }), /malformed/)
  assert.equal(readFileSync(e.log.path, 'utf8'), '{broken', '坏日志不能被追加污染')
})

test('G08: scope 迁移后的状态必须落进 sidecar，重启不回退', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir })
  e.start()
  e.taskEnd({ text: 'orchard pending preference', scope: 'legacy' })
  assert.equal(e.staging.pending[0].scope, 'legacy')
  e.migrateScope('legacy', scope)
  assert.equal(e.staging.pending[0].scope, scope)

  const restored = new MemoryEngine({ dir })
  restored.setScope(scope)
  restored.start('r')
  assert.equal(restored.staging.pending[0]?.scope, scope, '重启后不能被 sidecar 里的旧状态盖回去')
  restored.settleStaging({ scope, goalCues: ['orchard'] })
  assert.equal(restored.log.alive(scope).length, 1)
})

test('G09: 引擎级的 checkpoint 仍然可以被故障注入拦住（持久性契约不变）', (t) => {
  const e = engine(t)
  for (const text of ['orchard first', 'orchard second']) e.staging.offer({ text, cues: ['orchard'], scope, source: 'human' })
  e.checkpoint()
  const append = e.log.append.bind(e.log)
  let allow = false
  e.log.append = (ev) => {
    if (ev.kind === 'runtime-state' && !allow) throw Error('plan disk failure')
    return append(ev)
  }

  assert.throws(() => e.settleStaging({ scope }), /plan disk failure/)
  assert.equal(e.log.items.size, 0, '计划没落盘就不许写记忆')
  allow = true
  e.settleStaging({ scope })
  assert.equal(e.log.items.size, 2)
})

test('G10: 空日志目录不会在构造/启动时被创建（零常驻不变）', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'mnemo-zero-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const dir = join(base, 'not-yet')
  const e = new MemoryEngine({ dir })
  assert.equal(existsSync(dir), false, '构造不该落盘')
  e.start('s')
  assert.equal(existsSync(dir), false, '启动且无写入时也不该落盘')
  e.remember({ text: 'x', cues: ['t'] })
  assert.equal(existsSync(dir), true)
  assert.ok(readdirSync(dir).length >= 1)
})


test('G11: 日志缺失但存在归档时必须拒绝启动，绝不静默建空日志', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir }); e.setScope(scope); e.start('s')
  e.remember({ text: 'orchard alpha', scope, source: 'human' })

  appendFileSync(e.log.path, JSON.stringify({ kind: 'runtime-state', seq: 77, at: Date.now(), state: { version: 1 } }) + '\n')
  const r = e.compact()
  assert.ok(r.archive && existsSync(r.archive), '前置条件：压缩应产出真实归档')


  rmSync(e.log.path)
  assert.throws(() => new EventLog(dir).load(), /archive\(s\) exist|restore/i, '日志缺失 + 有归档必须拒绝，而不是建空日志')
  assert.throws(() => new MemoryEngine({ dir }).start('s'), /archive\(s\) exist|restore/i)

  assert.throws(() => new MemoryEngine({ dir }).start('s'), /archive\(s\) exist|restore/i, '拒绝必须在每次重试时都成立')
})

test('G12: 坏日志的失败是粘性的——重试不得绕过 fail-closed', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir }); e.setScope(scope); e.start('s')
  e.remember({ text: 'orchard alpha', scope, source: 'human' })
  writeFileSync(e.log.path, readFileSync(e.log.path, 'utf8') + '{broken-partial')
  assert.throws(() => e.log.refreshFromDisk(), /malformed/)
  assert.throws(() => e.log.refreshFromDisk(), /malformed/, '第二次重试也必须抛')
  assert.throws(() => e.remember({ text: 'must not append', scope }), /malformed/, '坏日志上不允许再追加')
})

test('G13: 外部追加「无尾换行的完整事件」后，下一条追加不能并成一行', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir }); e.setScope(scope); e.start('s')
  e.remember({ text: 'orchard alpha', scope, source: 'human' })
  const ext = { kind: 'create', id: 'm-ext-no-nl', text: 'external', itemKind: 'episode', scope, cues: [], entities: [], S: 1, born: Date.now() / 86400000, source: 'human', trust: 'reported', seq: 99, at: Date.now() }
  writeFileSync(e.log.path, readFileSync(e.log.path, 'utf8') + JSON.stringify(ext))
  e.log.refreshFromDisk()
  e.remember({ text: 'orchard beta', scope, source: 'human' })
  const lines = readFileSync(e.log.path, 'utf8').split('\n').filter(Boolean)
  for (const line of lines) JSON.parse(line)
  assert.ok(e.log.items.has('m-ext-no-nl'))

  assert.equal(lines.length, 3)
})

test('G14: 同尺寸原地改写会被发现并整文件重放', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir }); e.setScope(scope); e.start('s')
  e.remember({ text: 'AAA', scope, source: 'human' })
  const before = readFileSync(e.log.path, 'utf8')
  writeFileSync(e.log.path, before.replace('AAA', 'BBB'))
  e.log.refreshFromDisk()
  const texts = [...e.log.items.values()].map((i) => i.text)
  assert.deepEqual(texts, ['BBB'], '同尺寸改写必须被识别，不能沿用旧内存状态')
})

test('G15: compact 先同步未消费的外部事件，且 seq 不回退', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir }); e.setScope(scope); e.start('s')
  e.remember({ text: 'orchard alpha', scope, source: 'human' })
  const ext = { kind: 'create', id: 'm-ext-far', text: 'external far', itemKind: 'episode', scope, cues: [], entities: [], S: 1, born: Date.now() / 86400000, source: 'human', trust: 'reported', seq: 99, at: Date.now() }
  appendFileSync(e.log.path, JSON.stringify(ext) + '\n')
  e.compact()
  assert.ok(e.log.items.has('m-ext-far'), '压缩前必须先把外部事件同步进内存')
  const next = e.remember({ text: 'orchard beta', scope, source: 'human' })
  assert.ok(e.log.items.get(next.id), '压缩后仍可继续写入')
  const replayed = new EventLog(e.log.dir); replayed.load()
  assert.ok(replayed.seq >= 99, 'seq 不得回退')
})

test('G16: compact 不丢唯一的运行时状态（没有 sidecar 的旧日志）', (t) => {
  const dir = fresh(t)
  const log = new EventLog(dir); log.load()
  log.append({ kind: 'create', id: 'm-a', text: 'a' })

  appendFileSync(log.path, JSON.stringify({
    kind: 'runtime-state', seq: 50, at: Date.now(),
    state: { version: 1, captureReceipts: ['receipt-1'], staging: { pending: [], cueCount: [], cueDoc: [], cueLastOffer: [], cueProtected: [], captureKeys: [], scopeStats: [] }, backlog: { items: [] }, safety: {} },
  }) + '\n')
  const before = new EventLog(dir); before.load()
  assert.deepEqual(before.runtimeState.captureReceipts, ['receipt-1'], '前置条件：日志里有状态')
  assert.equal(existsSync(before.statePath), false, '前置条件：还没有 sidecar')
  before.compact()
  const after = new EventLog(dir); after.load()
  assert.deepEqual(after.runtimeState?.captureReceipts, ['receipt-1'], '压缩必须把唯一的运行时状态转存到 sidecar')
})

test('G17: 日志里更新的 scope 迁移必须能纠正过期的 sidecar', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir }); e.start()
  e.taskEnd({ text: 'orchard pending preference', scope: 'legacy' })
  e.checkpoint()
  e.migrateScope('legacy', scope)
  const r = new MemoryEngine({ dir }); r.setScope(scope); r.start('r')
  assert.equal(r.staging.pending[0]?.scope, scope, '不能被过期 sidecar 盖回去')
})

test('G18: captureKeys 在热路径封顶；淘汰按「最近最久未用」', (t) => {
  const s = new StagingArea({ STAGING_CAPTURE_KEYS: 10, PENDING_ENTRIES: 100, CUE_KEYS_PER_SCOPE: 4, CUE_PROTECTED: 100, SCOPE_STATS: 10, TTL_HOURS: 24, REPEAT_THRESHOLD: 2, AFFECT_THRESHOLD: 0.55, GOAL_RESONANCE: 0.3, FAST_MODE_DEFAULT_DROP: true, MAX_POINTERS: 10 })
  for (let i = 0; i < 50; i++) s.offer({ text: 't' + i, cues: ['c' + i], scope: 'p', captureKey: 'k' + i })
  assert.ok(s.captureKeys.size <= 10, `captureKeys 必须在 offer 里就封顶，实际 ${s.captureKeys.size}`)


  const t2 = new StagingArea({ CUE_KEYS_PER_SCOPE: 4, CUE_PROTECTED: 100, PENDING_ENTRIES: 100, SCOPE_STATS: 10, TTL_HOURS: 24, REPEAT_THRESHOLD: 2, AFFECT_THRESHOLD: 0.55, GOAL_RESONANCE: 0.3, FAST_MODE_DEFAULT_DROP: true, MAX_POINTERS: 10 })
  for (let i = 0; i < 21; i++) t2.offer({ text: 'hot', cues: ['hot'], scope: 'p' })
  t2.offer({ text: 'cold', cues: ['cold'], scope: 'p' })
  assert.ok(t2.cueCount.has('hot'), '最常用的线索不该被淘汰')
})

test('G19: 插件级 bounds 配置必须真的透传到引擎', async (t) => {
  const dir = fresh(t)
  const provided = {}
  const services = { commands: { register() {} }, sandboxPolicy: { workspaceRoot: '/tmp/x' } }
  await apply(
    { get: (n) => provided[n] ?? services[n], provide: (n, v) => { provided[n] = v }, effect: (f) => f(), on: () => () => {}, logger: { info() {} } },
    { dir, verbose: false, injectMode: 'off', bounds: { CAPTURE_RECEIPTS: 7 } },
  )
  const engine = provided.mnemo.engine
  for (let i = 0; i < 30; i++) engine.captureReceipts.add('r' + i)
  engine._boundCaptureReceipts()
  assert.equal(engine.captureReceipts.size, 7, 'bounds 没透传的话这里会是 30')
  await provided.mnemo.detach()
})

test('G20: 坏 sidecar 不该砖化启动（状态可重建）', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir }); e.setScope(scope); e.start('s')
  e.remember({ text: 'orchard alpha', scope, source: 'human' })
  writeFileSync(e.log.statePath, '{broken-sidecar')
  const r = new MemoryEngine({ dir }); r.setScope(scope); r.start('r')
  assert.equal(r.log.items.size, 1, '日志完好就不能因为 sidecar 坏掉而打不开')
  assert.equal(r.log.corruptState, true, '应记录 sidecar 损坏这件事')
})

test('G21: 外部改动整文件重放；自己写入走增量', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir }); e.setScope(scope); e.start('s')
  e.remember({ text: 'orchard alpha', scope, source: 'human' })
  let reloads = 0
  const realLoad = e.log.load.bind(e.log)
  e.log.load = () => { reloads++; return realLoad() }
  const ext = { kind: 'create', id: 'm-ext-inc', text: 'external incremental', itemKind: 'episode', scope, cues: [], entities: [], S: 1, born: Date.now() / 86400000, source: 'human', trust: 'reported', seq: 900, at: Date.now() }
  appendFileSync(e.log.path, JSON.stringify(ext) + '\n')
  e.log.refreshFromDisk()
  assert.ok(e.log.items.has('m-ext-inc'))


  assert.equal(reloads, 1, '外部改动必须整文件重放（安全性优先于外部写入的开销）')
})


test('G22: 外部「改写已消费前缀 + 顺便变长」必须整文件重放（不能只看变大就增量）', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir }); e.setScope(scope); e.start('s')
  e.remember({ text: 'AAA', scope, source: 'human' })
  const consumed = readFileSync(e.log.path, 'utf8')
  e.log.refreshFromDisk()

  writeFileSync(e.log.path, consumed.replace('"AAA"', '"BBB"') + JSON.stringify({ kind: 'create', id: 'm-new', text: 'NEW', itemKind: 'episode', scope, cues: [], entities: [], S: 1, born: 1, source: 'human', trust: 'reported', seq: 500, at: Date.now() }) + '\n')
  e.log.refreshFromDisk()
  assert.equal([...e.log.items.values()].find((i) => i.text === 'AAA'), undefined, '被改写掉的旧文本不能还留在内存里')
  assert.ok([...e.log.items.values()].some((i) => i.text === 'BBB'), '必须看到磁盘上的新文本')
  assert.ok(e.log.items.has('m-new'))
})

test('G23: append 的 _apply 抛错也必须粘性标记（事件已落盘但内存没吃进去）', (t) => {
  const dir = fresh(t)
  const log = new EventLog(dir); log.load()
  log.append({ kind: 'create', id: 'm-a', text: 'a' })
  assert.throws(() => log.append({ kind: 'approval', id: 'ap-broken' }), /operations|iterable|undefined/i)
  assert.equal(log.corrupt, true, '事件已落盘却没进内存，必须标记损坏')
  assert.throws(() => log.refreshFromDisk(), /malformed/, '不能带着「磁盘有、内存没有」的状态继续跑')
})

test('G24: 外部把日志修好后必须能恢复，不必重启进程', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir }); e.setScope(scope); e.start('s')
  e.remember({ text: 'orchard alpha', scope, source: 'human' })
  const good = readFileSync(e.log.path, 'utf8')
  writeFileSync(e.log.path, good + '{broken')
  assert.throws(() => e.log.refreshFromDisk(), /malformed/)
  writeFileSync(e.log.path, good)
  e.log.refreshFromDisk()
  assert.equal(e.log.corrupt, false, '外部修好后应恢复可用')
  assert.equal(e.log.items.size, 1)
})

test('G25: 压缩「换入前」就把状态写进 sidecar（消灭换入后崩溃的丢状态窗口）', (t) => {
  const dir = fresh(t)
  const log = new EventLog(dir); log.load()
  log.append({ kind: 'create', id: 'm-a', text: 'a' })
  appendFileSync(log.path, JSON.stringify({ kind: 'runtime-state', seq: 10, at: Date.now(), state: { version: 1, captureReceipts: ['R1'], staging: { pending: [], cueCount: [], cueDoc: [], cueLastOffer: [], cueProtected: [], captureKeys: [], scopeStats: [] }, backlog: { items: [] }, safety: {} } }) + '\n')
  const l2 = new EventLog(dir); l2.load()
  const r = l2.compact()
  assert.equal(r.compacted, true)
  const written = JSON.parse(readFileSync(l2.statePath, 'utf8'))
  assert.deepEqual(written.captureReceipts, ['R1'], '压缩后状态必须已经在 sidecar 里（顺序上先于日志换入）')
})

test('G26: 无可压缩内容时不产出归档、不重写日志', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir }); e.setScope(scope); e.start('s')
  e.remember({ text: 'orchard alpha', scope, source: 'human' })
  const before = readFileSync(e.log.path, 'utf8')
  const r = e.compact()
  assert.equal(r.compacted, false)
  assert.equal(r.archive, null, '没有可丢的瞬时快照就不该产出归档')
  assert.equal(readFileSync(e.log.path, 'utf8'), before, '日志必须逐字节不变')
})

test('G27: 归档识别必须严格匹配自己的命名，不会把无关文件当归档', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir }); e.setScope(scope); e.start('s')
  e.remember({ text: 'orchard alpha', scope, source: 'human' })
  rmSync(e.log.path)

  writeFileSync(join(dir, 'events.jsonl.backup.1'), 'unrelated')
  const r = new MemoryEngine({ dir }); r.setScope(scope); r.start('r')
  assert.equal(r.log.items.size, 0, '无关文件不该被当成归档')
})

test('G28: 暂存区超限必须留指针，且已提交 captureIntent 的条目不淘汰', (t) => {
  const cfg = { PENDING_ENTRIES: 2, CUE_KEYS_PER_SCOPE: 100, CUE_PROTECTED: 100, SCOPE_STATS: 10, TTL_HOURS: 24, REPEAT_THRESHOLD: 2, AFFECT_THRESHOLD: 0.55, GOAL_RESONANCE: 0.3, FAST_MODE_DEFAULT_DROP: true, MAX_POINTERS: 50 }
  const s = new StagingArea(cfg)
  for (const text of ['alpha', 'beta', 'gamma', 'delta']) s.offer({ text, cues: [text], scope: 'p', source: 'human' })
  assert.equal(s.pending.length, 2)
  assert.equal(s.pointers.length, 2, '被淘汰的内容必须降级成指针（与 TTL 到期同一条契约）')

  const s2 = new StagingArea({ ...cfg, PENDING_ENTRIES: 1 })
  s2.offer({ text: 'committed', cues: ['x'], scope: 'p', source: 'human' })
  s2.pending[0].captureIntent = true
  s2.offer({ text: 'newcomer', cues: ['y'], scope: 'p', source: 'human' })
  assert.ok(s2.pending.some((e) => e.text === 'committed'), '已 checkpoint 的待捕获条目不能被上限丢掉')
})

test('G29: 压缩的坏行拒绝不留临时文件', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir }); e.setScope(scope); e.start('s')
  e.remember({ text: 'orchard alpha', scope, source: 'human' })
  appendFileSync(e.log.path, '{broken\n')
  assert.throws(() => e.compact(), /malformed/)
  const leftovers = readdirSync(dir).filter((n) => n.includes('.tmp-'))
  assert.deepEqual(leftovers, [], `不该留下临时文件，实际 ${leftovers.join(',')}`)
})

test('G30: 预演（dryRun）不留临时文件、不改变日志与状态文件', (t) => {
  const dir = fresh(t)
  const e = new MemoryEngine({ dir }); e.setScope(scope); e.start('s')
  e.remember({ text: 'orchard alpha', scope, source: 'human' })
  appendFileSync(e.log.path, JSON.stringify({ kind: 'runtime-state', seq: 99, at: Date.now(), state: { version: 1 } }) + '\n')
  const logBefore = readFileSync(e.log.path, 'utf8')
  const stateBefore = existsSync(e.log.statePath) ? readFileSync(e.log.statePath, 'utf8') : null
  const r = e.compact({ dryRun: true })
  assert.equal(r.compacted, false)
  assert.equal(r.dryRun, true)
  assert.ok(r.droppedState >= 1, '预演也要给出真实统计')
  assert.equal(readFileSync(e.log.path, 'utf8'), logBefore, '预演不得改动日志')
  assert.equal(existsSync(e.log.statePath) ? readFileSync(e.log.statePath, 'utf8') : null, stateBefore, '预演不得改动状态文件')
  assert.deepEqual(readdirSync(dir).filter((n) => n.includes('.tmp-')), [], '预演不得留临时文件')
  assert.deepEqual(readdirSync(dir).filter((n) => n.includes('events.jsonl.')), [], '预演不得产出归档')
})
