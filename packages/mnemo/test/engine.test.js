


import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryEngine } from '../lib/engine.js'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CURVE, WAKE } from '../lib/config.js'
import { snapshotR } from '../lib/fsrs.js'

const DAY = 86400000
const T0 = Date.now()

function freshEngine(config) {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-t-'))
  const e = new MemoryEngine({ dir, config })
  return { e, dir, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }) } catch {} } }
}


function oldMemory(e, { text, cues, daysOld = 30, scope = 'default' } = {}) {
  return e.remember({ text, cues, scope, born: T0 / DAY - daysOld, now: T0 })
}


test('端到端：start → remember → preTurn → postTurn → taskEnd', () => {
  const { e, cleanup } = freshEngine()
  const s = e.start('sess-1')
  assert.equal(s.stats.total, 0)
  assert.equal(s.authority.mode, 'propose-only', '冷启动应为 propose-only')

  const a = oldMemory(e, { text: '把 sample_module.cpp 拆成独立模块的流程', cues: ['重构', 'C++'], daysOld: 3, scope: 'sample-project' })
  const pre = e.preTurn({ text: '帮我重构一下 C++ 那个大文件', scope: 'sample-project', affect: 0, session: 'sess-1' })
  assert.equal(pre.mode, 'slow', '命中关键词应走慢模式')
  assert.ok(pre.hits.length >= 1, '应命中刚投递的记忆')
  assert.ok(pre.tokens > 0)


  const best = Math.min(pre.latencyMs, e.preTurn({ text: '帮我重构一下 C++ 那个大文件', scope: 'sample-project', affect: 0, session: 'sess-1' }).latencyMs, e.preTurn({ text: '帮我重构一下 C++ 那个大文件', scope: 'sample-project', affect: 0, session: 'sess-1' }).latencyMs)
  assert.ok(best < 20, `热路径应 < 20ms，实际 ${best.toFixed(1)}ms`)

  const post = e.postTurn({ text: '正在重构 C++ 模块', scope: 'sample-project', session: 'sess-1', usedItemIds: [a.id] })
  assert.equal(post.touched.length, 1, '被用到的条目应被触及')

  const end = e.taskEnd({ text: '重构完成', cues: ['重构'], scope: 'sample-project', affect: 0.6, usedItemIds: [a.id], session: 'sess-1' })
  assert.ok(Array.isArray(end.consolidated))
  assert.ok(end.backlog.count >= 1, '正性情绪应排入技能编译欠账')

  const chk = e.selfCheck()
  assert.equal(chk.ok, true, `自检失败：${chk.problems.join('; ')}`)
  cleanup()
})

test('快模式不注入工作记忆，慢模式才注入', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  oldMemory(e, { text: '达芬奇的渲染脚本', cues: ['达芬奇'], daysOld: 2, scope: 'v' })

  const fast = e.preTurn({ text: '在吗', affect: 0.1, scope: 'v', session: 's1' })
  assert.equal(fast.mode, 'fast')
  assert.equal(fast.hits.length, 0, '快模式不该做检索')

  const slow = e.preTurn({ text: '帮我用达芬奇渲染一下', scope: 'v', session: 's1' })
  assert.equal(slow.mode, 'slow')
  cleanup()
})

test('负性情绪触发慢模式并进入拆解路径', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const m = oldMemory(e, { text: '引用顺序处理方案', cues: ['重构'], daysOld: 5 })

  const pre = e.preTurn({ text: '随便聊聊', affect: -0.7, session: 's1' })
  assert.equal(pre.mode, 'slow', '负性情绪应升慢模式')

  const end = e.taskEnd({ text: '这次没搞定', cues: ['重构'], affect: -0.7, usedItemIds: [m.id], session: 's1' })
  assert.ok(end.revised.length >= 1, '负性情绪应为被用到的条目生成修订')
  const v = e.versions(m.id)
  assert.ok(v.length >= 1)
  cleanup()
})


test('触及：R 上升、S 增长，且都受约束', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const m = oldMemory(e, { text: '外置 USB4 SSD 必备', cues: ['Mac', '渲染'], daysOld: 20 })
  const before = snapshotR(e.log.items.get(m.id), T0 / DAY, CURVE.DECAY)

  const t = e.touch(m.id, { reson: 0.8, session: 's1', now: T0 })
  assert.equal(t.ok, true)
  assert.ok(t.rAfter > t.rBefore, `R 应上升：${t.rBefore} → ${t.rAfter}`)
  assert.ok(t.SAfter > t.SBefore, `S 应增长：${t.SBefore} → ${t.SAfter}`)
  assert.ok(t.SAfter <= CURVE.S_CEIL, 'S 不该突破封顶')
  assert.ok(t.rAfter <= 1)
  assert.ok(before < t.rAfter, '触及后应比触及前清晰')
  cleanup()
})

test('★ 黄金律 1 的行为验证：快忘掉的记忆，一次触及涨得更多', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')

  const fresh = e.remember({ text: '刚发生的事', cues: ['测试'], born: T0 / DAY - 0.5, now: T0 })
  const stale = e.remember({ text: '很久以前的事', cues: ['测试'], born: T0 / DAY - 40, now: T0 })

  const tf = e.touch(fresh.id, { reson: 0.6, session: 's1', now: T0 })
  const ts = e.touch(stale.id, { reson: 0.6, session: 's1', now: T0 })

  assert.ok(ts.gain > tf.gain,
    `快忘掉的增益 ${ts.gain.toFixed(3)} 应大于还很清晰的 ${tf.gain.toFixed(3)}——这是"越接近遗忘越好唤醒"的数学来源`)
  cleanup()
})

test('★ PROMOTE_DECAY 敏感性：错误值会让「上浮」静默失效', () => {


  const run = (promoteDecay) => {
    const { e, cleanup } = freshEngine({ wake: { ...WAKE, PROMOTE_DECAY: promoteDecay } })
    e.start('s1')
    const m = oldMemory(e, { text: '需要被唤醒的旧知识', cues: ['测试'], daysOld: 30 })
    let last

    for (let i = 1; i <= 5; i++) {
      last = e.touch(m.id, { reson: 0.6, session: 's1', now: T0 + i * 3 * DAY })
      assert.equal(last.ok, true)
    }
    const out = { upCount: last.upCount, promote: last.promote, level: last.levelAfter, S: last.SAfter }
    cleanup()
    return out
  }

  const good = run(0.008)
  const bad = run(0.05)

  assert.ok(good.upCount >= 1,
    `正确参数下应发生上浮，实际 upCount=${good.upCount}。若为 0，说明 PROMOTE_DECAY 又调大了。`)
  assert.equal(bad.upCount, 0,
    `错误参数（0.05）下不该发生上浮（复现 §12.1），实际 upCount=${bad.upCount}`)


  assert.ok(good.S >= bad.S,
    `正确参数的终态 S=${good.S.toFixed(2)} 应不低于错误的 ${bad.S.toFixed(2)}`)
})

test('单次触及最多升一级（保证「慢慢挪」而不是跳级）', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const m = oldMemory(e, { text: '慢慢挪的记忆', cues: ['测试'], daysOld: 30 })
  const rank = (lv) => ['D', 'C', 'B', 'A'].indexOf(lv)


  const t0 = e.touch(m.id, { reson: 0.4, session: 's1', now: T0 })
  assert.equal(t0.upCount, 0, '第一次触及进度条只到 0.2，不该升')
  let prev = t0.levelAfter

  let jumps = 0
  for (let i = 0; i < 12; i++) {
    const r = e.touch(m.id, { reson: 0.4, session: 's1', now: T0 + (i + 1) * 1000 })
    const diff = rank(r.levelAfter) - rank(prev)
    assert.ok(diff <= 1, `单次触及不该跳级：${prev} → ${r.levelAfter}`)
    if (diff === 1) jumps++
    prev = r.levelAfter
  }
  assert.ok(jumps >= 1, `12 次触及至少应上浮一级，实际 ${jumps}`)
  cleanup()
})

test('晋升进度条不被浮点误差卡死（阈值比较必须带 epsilon）', () => {


  const { e, cleanup } = freshEngine()
  e.start('s1')
  const m = oldMemory(e, { text: '浮点测试', cues: ['测试'], daysOld: 30 })
  const r1 = e.touch(m.id, { reson: 1.0, session: 's1', now: T0 })
  assert.equal(r1.upCount, 0, '第一次只攒到 0.5，不该升')
  assert.ok(Math.abs(r1.promote - 0.5) < 1e-9, `进度应恰为 0.5，实际 ${r1.promote}`)
  const r2 = e.touch(m.id, { reson: 1.0, session: 's1', now: T0 + 1 })
  assert.equal(r2.upCount, 1,
    `进度条应攒满并晋升，实际 upCount=${r2.upCount}（若为 0 说明 epsilon 又被去掉了）`)
  cleanup()
})

test('顶层（A 级）不再囤积晋升进度（防止 S 被反复乘 1.6 涨到 22 年）', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const m = e.remember({ text: '很新的记忆', cues: ['测试'], born: T0 / DAY, now: T0 })
  assert.equal(e.log.items.get(m.id).level, 'A', '刚创建应为 A 级')
  for (let i = 0; i < 40; i++) {
    e.touch(m.id, { reson: 1.0, session: 's1', now: T0 + i * 1000 })
  }
  const it = e.log.items.get(m.id)
  assert.equal(it.promote, 0, '顶层不该累积进度条')
  assert.ok(it.S <= CURVE.S_CEIL * 1.0001, `S 涨到 ${it.S}，超过封顶`)
})

test('共振低于阈值不算「想起来」', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const m = oldMemory(e, { text: 'x', cues: ['测试'], daysOld: 10 })
  const t = e.touch(m.id, { reson: 0.1, session: 's1', now: T0 })
  assert.equal(t.ok, false)
  assert.equal(t.error, 'below-theta')
  cleanup()
})


test('★ 跳时求值：停摆 60 天后一次算到位，不需要补算中间每天', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const m = e.remember({ text: '一条会遗忘的记忆', cues: ['测试'], born: T0 / DAY, now: T0 })

  const rNow = snapshotR(e.log.items.get(m.id), T0 / DAY, CURVE.DECAY)
  const r60 = snapshotR(e.log.items.get(m.id), (T0 + 60 * DAY) / DAY, CURVE.DECAY)
  assert.ok(r60 < rNow, 'R 应随时间下降')
  assert.ok(Math.abs(rNow - 1) < 1e-9, '刚创建时 R 应为 1')


  e.log.refreshLevels(T0 + 60 * DAY, CURVE.DECAY)
  assert.notEqual(e.log.items.get(m.id).level, 'A', '60 天后不该还在 A 级')


  let r = rNow
  for (let d = 1; d <= 60; d++) r = snapshotR(e.log.items.get(m.id), (T0 + d * DAY) / DAY, CURVE.DECAY)
  assert.ok(Math.abs(r - r60) < 1e-12, '跳时求值应与逐步求值完全一致')
  cleanup()
})


test('版本链：每次修订都是一个版本，active 指针指向最新', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const m = e.remember({ text: '原始内容 v1', cues: ['测试'], now: T0 })
  e.log.append({ kind: 'revise', id: m.id, text: '修订内容 v2', reason: 'decompose' })
  const vs = e.versions(m.id)
  assert.equal(vs.length, 2)
  assert.equal(vs.filter((v) => v.active).length, 1, '同时只能有一个 active')
  assert.equal(vs.at(-1).text, '修订内容 v2')
  cleanup()
})

test('★ 回滚：不是撤销历史，而是追加一次 revert（所以回滚本身也可被回滚）', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const m = e.remember({ text: 'v1', cues: ['测试'], now: T0 })
  e.log.append({ kind: 'revise', id: m.id, text: 'v2', reason: 'test' })
  const v1seq = e.versions(m.id)[0].seq

  const rb = e.rollback(m.id, v1seq, 'gate-reject')
  assert.equal(rb.ok, true)
  assert.equal(e.log.items.get(m.id).text, 'v1', '应回到 v1')

  const vs = e.versions(m.id)
  assert.equal(vs.length, 3, '回滚本身也是一个版本')
  assert.equal(vs.at(-1).kind, 'revert')
  assert.equal(vs.filter((v) => v.active).length, 1)


  const v2seq = vs.find((v) => v.text === 'v2').seq
  e.rollback(m.id, v2seq, 'undo-rollback')
  assert.equal(e.log.items.get(m.id).text, 'v2', '回滚本身也可被回滚')
  cleanup()
})

test('回滚到不存在的版本应失败而不是静默', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const m = e.remember({ text: 'x', cues: ['t'], now: T0 })
  const r = e.rollback(m.id, 999999, 'test')
  assert.equal(r.ok, false)
  assert.match(r.error, /unknown version/)
  cleanup()
})


test('★ 检索结果不受「本会话已提过」影响（注入负载只取决于内容，不取决于发过几次）', () => {


  const { e, cleanup } = freshEngine()
  e.start('s1')
  e.remember({ text: '引用顺序处理方案', cues: ['引用顺序'], scope: 'v', born: T0 / DAY - 1, now: T0 })

  const a = e.preTurn({ text: '引用顺序的事', scope: 'v', session: 's1', now: T0 })
  const b = e.preTurn({ text: '引用顺序的事', scope: 'v', session: 's1', now: T0 + 1000 })
  assert.deepEqual(b.hits.map((h) => h.id), a.hits.map((h) => h.id), '同一输入应得到同一批命中')
  assert.equal(a.shouldEmit, true, '首次应发出')
  assert.equal(b.shouldEmit, false, '内容没变就不该再发——差分注入的前提')
  assert.equal(e.inspect({ scope: 'v' }).mentionedThisSession, a.hits.length, '已提及集合只作记录')
  cleanup()
})

test('★ 通道 C 落到引擎层：不含关键词但提到记得的东西 → 走慢模式并检索', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  e.remember({ text: '引用顺序必须先拓扑排序', cues: ['引用顺序'], scope: 'v', born: T0 / DAY - 1, now: T0 })

  const slow = e.preTurn({ text: '继续搞那个引用顺序，后面几步怎么接？', scope: 'v', session: 's1', now: T0 })
  assert.equal(slow.mode, 'slow')
  assert.ok(slow.routing.triggers.some((t) => t.startsWith('known:')), '应由通道 C 触发')
  assert.ok(slow.hits.length >= 1, '升慢模式后必须真的把记忆取出来')

  const fast = e.preTurn({ text: '今天天气不错', scope: 'v', session: 's1b', now: T0 + 1000 })
  assert.equal(fast.mode, 'fast', '不认识的内容仍走快模式，别把快模式废掉')
  cleanup()
})


test('★ scope 隔离：多项目并行时不互相污染', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  e.remember({ text: '示例项目的重构方案', cues: ['重构'], scope: 'sample-project', born: T0 / DAY - 1, now: T0 })
  e.remember({ text: '视频项目的剪辑流程', cues: ['剪辑'], scope: 'video', born: T0 / DAY - 1, now: T0 })

  const sampleProject = e.recall('重构', { scope: 'sample-project' })
  assert.ok(sampleProject.length >= 1, '应查到本项目的')
  assert.ok(sampleProject.every((k) => k.scope === 'sample-project'), '不该带出别的项目')

  const insp = e.inspect({ scope: 'video' })
  assert.equal(insp.items.length, 1)
  assert.equal(insp.items[0].scope, 'video')
  cleanup()
})


test('★ 巩固必须跨会话：同一会话狂提 3 次 ≠ 跨 3 天各提 1 次', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const m = oldMemory(e, { text: '需要巩固的知识', cues: ['测试'], daysOld: 10 })


  for (let i = 0; i < 6; i++) e.touch(m.id, { reson: 0.8, session: 's-same', now: T0 + i * 1000 })
  const it = e.log.items.get(m.id)
  assert.equal(it.touches, 6)
  assert.equal(it.sessions.length, 1, '只触及过一个会话')
  assert.equal(it.touchLog.at(-1) - it.touchLog[0], 5000, '使用事件提供的五秒跨度，不使用测试执行耗时')

  const end = e.taskEnd({ text: 'x', scope: 'default', affect: 0, session: 's-same' })
  assert.equal(end.consolidated.length, 0,
    '同一会话内的密集触及不该满足巩固条件——这正是「间隔效应」的工程化')
  cleanup()
})


test('持久化：重开后状态一致（事件溯源重放）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-p-'))
  try {
    const e1 = new MemoryEngine({ dir })
    e1.start('s1')
    const m = e1.remember({ text: '要活过重启的记忆', cues: ['重启'], born: T0 / DAY - 5, now: T0 })
    e1.touch(m.id, { reson: 0.9, session: 's1', now: T0 })
    e1.pinRule({ text: '永远不要删 .workspace-state 目录', cues: ['规则'], now: T0 })
    const before = { stats: e1.log.stats(), r: snapshotR(e1.log.items.get(m.id), T0 / DAY, CURVE.DECAY) }


    const e2 = new MemoryEngine({ dir })
    const s2 = e2.start('s2')
    assert.equal(s2.stats.total, before.stats.total, '条目数应一致')
    const r2 = snapshotR(e2.log.items.get(m.id), T0 / DAY, CURVE.DECAY)
    assert.ok(Math.abs(r2 - before.r) < 1e-12, `R 应完全一致：${before.r} vs ${r2}`)

    const rules = e2.log.byKind('rule')
    assert.equal(rules.length, 1)
    assert.equal(rules[0].pinned, true)
    cleanupDir(dir)
  } catch (err) { cleanupDir(dir); throw err }
})

test('人类手写规则：pinned 且永不被自动归档/覆盖', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const r = e.pinRule({ text: '不要动 .workspace-state', cues: ['规则'], now: T0 })
  const it = e.log.items.get(r.id)
  assert.equal(it.pinned, true)
  assert.equal(it.kind, 'rule')
  assert.ok(it.S >= CURVE.S_CEIL, '规则应被赋予极高稳定性')
  cleanup()
})


test('安全体检：没有真实结果时不粉饰为「健康」', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const r = e.runSafetyCheck(null)
  assert.equal(r.summary.untested, true)
  assert.equal(r.summary.healthy, false, '未测不该报健康——这是诚实性要求')
  cleanup()
})

test('安全体检：给结果后能算拒绝率并触发冻结', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const results = {}
  for (let i = 1; i <= 20; i++) {
    results[`p${String(i).padStart(2, '0')}`] = { refused: i > 3 }
  }
  for (let i = 1; i <= 3; i++) results[`c0${i}`] = { refused: false }

  const r = e.runSafetyCheck(results)
  assert.equal(r.summary.freeze, true, '3 条危险探针未拒绝应触发冻结')
  const auth = e.effectiveAuthority(999)
  assert.equal(auth.mode, 'propose-only', '冻结后应强制退回 propose-only')
  assert.match(auth.note, /冻结/)
  cleanup()
})

test('门：候选不合法时拒绝，样本不足时只提议', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const bad = e.gate({ text: '', cues: [] }, { sampleN: 999 })
  assert.equal(bad.pass, false)
  assert.equal(bad.action, 'reject')

  const good = e.gate({ text: '把大文件拆成模块的流程', cues: ['重构'] }, { sampleN: 10 })
  assert.equal(good.pass, false)
  assert.equal(good.action, 'propose')

  const mature = e.gate({ text: '把大文件拆成模块的流程', cues: ['重构'] }, { sampleN: 999 })
  assert.equal(mature.action, 'propose')
  cleanup()
})


test('Inspector：给出调参所需的全部观测（没有它你查不到「为什么没想起来」）', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  for (let i = 0; i < 12; i++) {
    e.remember({ text: `记忆 ${i}`, cues: ['测试', `k${i}`], born: T0 / DAY - i * 2, now: T0 })
  }
  const insp = e.inspect()
  assert.equal(insp.items.length, 12)
  assert.ok(insp.spread > 0, '区分度应可观测')
  assert.ok(insp.items[0].r >= insp.items.at(-1).r, '应按 R 降序')
  assert.ok('minDetectableDelta' in insp.gate, '应给出当前样本量下的判别力')
  assert.ok(insp.backlog && insp.router && insp.injector && insp.staging)
  cleanup()
})

test('自检能抓出数值异常', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  const m = e.remember({ text: 'x', cues: ['t'], now: T0 })
  assert.equal(e.selfCheck().ok, true)

  e.log.items.get(m.id).S = Number.NaN
  const chk = e.selfCheck()
  assert.equal(chk.ok, false)
  assert.ok(chk.problems.some((p) => p.includes('S 非法')))
  cleanup()
})

function cleanupDir(dir) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }

test('数据目录在构造时不会凭空创建（零常驻的证据之一）', () => {
  const base = mkdtempSync(join(tmpdir(), 'mnemo-nc-'))
  const dir = join(base, 'not-yet')
  const e = new MemoryEngine({ dir })
  assert.equal(existsSync(dir), false, '仅构造不该落盘')
  e.start('s1')
  assert.equal(existsSync(dir), false, 'start 且无写入时也不该落盘')
  e.remember({ text: 'x', cues: ['t'], now: T0 })
  assert.equal(existsSync(dir), true, '有写入才落盘')
  cleanupDir(base)
})


test('★ 停用词过滤：虚词不能作为线索', () => {
  const { e, cleanup } = freshEngine()
  const cues = e.extractCues(
    'The user is asking about it. Let me also check this and use that. DemoStudio 的 FFI 调用',
  )

  for (const bad of ['the', 'is', 'about', 'it', 'let', 'me', 'also', 'check', 'this', 'and', 'use', 'that']) {
    assert.equal(cues.includes(bad), false, `${bad} 不该成为线索；实际线索：${cues.join(', ')}`)
  }
  assert.ok(cues.some((c) => c.toLowerCase().includes('demo')),
    `有区分力的词必须留下；实际线索：${cues.join(', ')}`)
  cleanup()
})

test('★ 人类输入进入暂存区并能被 recall 召回', () => {
  const { e, cleanup } = freshEngine()
  e.start('sess-1')
  e.setScope('proj-a')
  const secret = 'DEMO-1000'

  const out = e.taskEnd({
    text: `渲染农场的代号是 ${secret}，只在这台机器上用`,
    scope: 'proj-a', affect: 0, session: 'sess-1', now: T0,
  })
  assert.ok(out.staged, 'taskEnd 必须把人类输入投进暂存区')
  assert.equal(out.staged.entry.source, 'human', '来源必须标成 human（否则意识卡无法优先它）')
  assert.equal(e.staging.stats().humanPending, 1)


  e.taskEnd({ text: `再确认一次 ${secret}，别写错`, scope: 'proj-a', session: 'sess-1', now: T0 + 60_000 })
  const settled = e.settleStaging({ now: T0 + 120_000 })
  assert.ok(settled.captured.length >= 1, '同一暗号跨两次人类输入重现，应被捕获')

  const hits = e.recall(secret, { scope: 'proj-a', now: T0 + 120_000 })
  assert.ok(hits.length >= 1, `人类说过的暗号必须能被 recall 到`)
  assert.ok(hits[0].text.includes(secret))

  const insp = e.inspect({ scope: 'proj-a', now: T0 + 120_000 })
  assert.ok(insp.sources.human >= 1, 'Inspector 的来源分布应能看到 human 条目')
  cleanup()
})

test('★ 通道③ 不再是死路：goalCues 会被填上并传给 settle（修复前恒为空数组）', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  e.setScope('proj-a')

  e.preTurn({ text: 'please render the davinci script', scope: 'proj-a', session: 's1', now: T0 })
  assert.ok(e.goalCues.length > 0,
    '目标线索必须被填上——修复前它永远是 []，通道③ 在数学上不可能命中')


  e.staging.offer({
    text: '渲染脚本里用的是 ffmpeg',
    cues: e.goalCues.slice(0, 2),
    scope: 'proj-a', now: T0,
  })
  const settled = e.settleStaging({ now: T0 + 60_000 })
  assert.ok(settled.captured.some((c) => c.why.goal), '与目标共振的候选应经通道③ 命中')
  cleanup()
})

test('★ 目标线索是"任务级"的：抽不出线索的一句话不该把它清空', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  e.preTurn({ text: 'please render the davinci script', scope: 'p', session: 's1', now: T0 })
  const first = [...e.goalCues]
  assert.ok(first.length > 0, '前提：第一句能抽出线索')


  const chitchat = '好的，继续'
  assert.equal(e.extractCues(chitchat).length, 0, '前提：这句话抽不出线索')
  e.preTurn({ text: chitchat, scope: 'p', session: 's1', now: T0 + 1000 })
  assert.deepEqual(e.goalCues, first, '抽不到线索时应沿用上一次的目标，而不是清空')
  cleanup()
})

test('★ 意识卡只出 gist 且人类来源优先（修复前注入回去的是模型自己的独白原文）', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  e.setScope('proj-a')
  e.remember({
    text: '我下个月要结婚了，拍摄档期先避开那两周',
    cues: ['结婚'], scope: 'proj-a', S: 200, source: 'human', now: T0,
  })
  e.remember({
    text: 'Sandbox issue with bash. Let me use glob/read tools instead of calling bash, then verify the output.',
    cues: ['sandbox', 'bash'], scope: 'proj-a', S: 200, now: T0,
  })

  const card = e._renderCard({ scope: 'proj-a', now: T0 })
  assert.ok(card.text.includes('source=human'), '人类来源应被标出来——它决定模型该不该把这句话当事实')
  const line = card.text.split('\n').find((l) => l.includes('Sandbox'))
  assert.ok(line, '模型来源的条目仍应在卡里（只是被压缩）')
  assert.ok(line.split('] ').slice(1).join('] ').length < 90, `长独白必须被压成短 gist，实际 ${line.length} 字符：${line}`)
  assert.ok(card.text.indexOf('结婚') < card.text.indexOf('Sandbox'),
    '人类说的排在前——意识卡只有 4 个位置，该给意图而不是过程')
  cleanup()
})

test('★ gist 不能把含关键事实的句子截掉（代号/数字在第二句时也必须保得住）', () => {
  const { e, cleanup } = freshEngine()
  e.start('s1')
  e.setScope('proj-a')
  e.remember({
    text: '帮我看看素材规格：我们只做 1080p 和 2K，永远不用 4K。另外记一下，我们的渲染农场只有 3 台机器，代号 DEMO-1003。这个约束有什么影响？',
    cues: ['素材规格', '渲染农场'], scope: 'proj-a', S: 200, source: 'human', now: T0,
  })

  const card = e._renderCard({ scope: 'proj-a', now: T0 })
  const line = card.text.split('\n').find((l) => l.includes('source=human'))
  assert.ok(line, '人类来源应被标出来')

  assert.ok(line.includes('DEMO-1003'),
    `gist 必须保留含代号的事实句，实际被截成了：${line}`)
  assert.ok(line.split('] ').slice(1).join('] ').length < 90, `gist 仍然要短，实际 ${line.length} 字符`)
  cleanup()
})
