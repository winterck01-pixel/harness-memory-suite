


import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryEngine } from '../lib/engine.js'
import { StagingArea } from '../lib/staging.js'
import { extractCueTokens } from '../lib/decisions.js'

const scope = 'project:/tmp/wave1-lead'
const DAY = 86400000
function engine(t, cfg) {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-w1-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const e = new MemoryEngine({ dir, config: cfg })
  e.setScope(scope)
  e.start('s')
  return e
}

test('D2: 规格/数字约束能被抽成线索（旧实现只抽到「永远」）', () => {
  const cues = extractCueTokens('我们只做 1080p/2K，永远不用 4K')
  assert.ok(cues.includes('1080p'), `应抽到 1080p，实际 ${JSON.stringify(cues)}`)
  assert.ok(cues.includes('2k'), '应抽到 2k')
  assert.ok(cues.includes('4k'), '应抽到 4k')

  assert.ok(!extractCueTokens('端口 8443').includes('8443'), '纯数字不该成为线索')
})

test('D2: 无线索的规格句仍能被决策通道捕获并召回', (t) => {
  const e = engine(t)
  const cues = e.extractCues('用 2K，不要 4K')
  e.taskEnd({ text: '用 2K，不要 4K', scope, affect: 0, source: 'human', now: Date.now() })
  e.settleStaging({ scope, now: Date.now() + 1000 })
  assert.equal(e.log.alive(scope).length, 1, `带线索 ${JSON.stringify(cues)} 的规格句应落库`)
  assert.ok(e.recall('2k', { scope }).length >= 1, '应能按 2k 召回')
  assert.ok(e.recall('4k', { scope }).length >= 1, '应能按 4k 召回')
})

test('D1: 通道①只接受人类的重申；agent 自重复不再灌进长期记忆', () => {
  const mk = () => new StagingArea()

  {
    const s = mk(); const t0 = 1_000_000
    s.offer({ text: '我来看看构建', cues: ['构建'], scope, source: 'agent', now: t0 })
    s.settle({ now: t0 + 1000, scope })
    s.offer({ text: '构建还在跑', cues: ['构建'], scope, source: 'agent', now: t0 + DAY })
    assert.equal(s.settle({ now: t0 + DAY + 1000, scope }).captured.length, 0, 'agent 自重复不得入库')
  }

  {
    const s = mk(); const t0 = 1_000_000
    s.offer({ text: '素材只做 2K', cues: ['素材'], scope, source: 'human', now: t0 })
    s.settle({ now: t0 + 1000, scope })
    s.offer({ text: '素材只做 2K', cues: ['素材'], scope, source: 'human', now: t0 + DAY })
    const r = s.settle({ now: t0 + DAY + 1000, scope })
    assert.equal(r.captured.length, 1, '人类重申必须命中')
    assert.equal(r.captured[0].source, 'human')
  }

  {
    const s = mk(); const t0 = 1_000_000
    s.offer({ text: '构建失败的根因是 tsconfig 的 paths 写错了', cues: ['tsconfig'], scope, source: 'agent', affect: -0.8, now: t0 })
    assert.equal(s.settle({ now: t0 + 1000, scope }).captured.length, 1, 'agent 的有据结论仍应入库')
  }
})

test('D1: 同一轮「人 + 回声」不再产出两条记忆', (t) => {
  const e = engine(t)
  const now = Date.now()
  e.taskEnd({ text: '实现登录功能', scope, affect: 0, source: 'human', now })
  e.postTurn({ text: '好的，我来实现登录功能，先看现有代码。', scope, affect: 0, source: 'agent', now: now + 1000 })
  e.settleStaging({ scope, now: now + 2000 })
  const alive = e.log.alive(scope)
  assert.ok(alive.length <= 1, `回声不该单独成条，实际 ${alive.length} 条`)
  if (alive.length) assert.equal(alive[0].source, 'human')
})

test('D5: opt-out 精确到子句，同轮的「请记住」必须留下', (t) => {
  const e = engine(t)
  e.taskEnd({
    text: '请记住：素材只做 2K。另外不要记录到记忆里，我随便说说。',
    scope, affect: 0, source: 'human', now: Date.now(),
  })
  e.settleStaging({ scope, now: Date.now() + 1000 })
  const alive = e.log.alive(scope)
  assert.equal(alive.length, 1, '被 opt-out 的只是那个子句，不是整轮')
  assert.match(alive[0].text, /请记住/, '保留的应是"请记住"那半句')
})

test('D6: 归档通道真的会忘（旧实现 archived 永为 false）', (t) => {
  const e = engine(t, { forget: { MIN_IDLE_DAYS: 1, S_MAX_ARCHIVED: 2, MAX_TOUCHES: 2, SWEEP_EVERY_TURNS: 0 } })
  const now = Date.now()
  const { id } = e.remember({ text: '临时排查用的口令 abc123', scope, source: 'agent', now })

  e.log.append({ kind: 'touch', id, S: 1, born: now / DAY - 400, touchAt: now / DAY - 400, touches: 0, upCount: 0, at: now })
  const swept = e.sweepArchives({ now, force: true })
  assert.ok(swept.archived.includes(id), `应被归档，实际 ${JSON.stringify(swept.archived)}`)
  assert.equal(e.log.alive(scope).length, 0, '归档后不得再参与检索/注入')
  assert.equal(e.archiveReport({ scope }).archived, 1, '归档应可见，而不是静默消失')

  const out = e.unarchive(id, { scope, now })
  assert.equal(out.unarchived, true, '必须能从回收站恢复')
  assert.equal(e.log.alive(scope).length, 1, '恢复后重新参与检索')
})

test('D6: 人确认和钉住的记忆永久保护，常用记忆延长保护但可在长期静默后归档', (t) => {
  const e = engine(t, { forget: { MIN_IDLE_DAYS: 1, S_MAX_ARCHIVED: 2, MAX_TOUCHES: 2, SWEEP_EVERY_TURNS: 0 } })
  const now = Date.now()
  const old = now / DAY - 3
  const confirmed = e.remember({ text: 'Orchard 的部署口令是 xxx', scope, source: 'human', now }).id
  e.review(confirmed, 'confirmed', { scope, reason: 'human verified' })
  const pinned = e.pinRule({ text: '永远不要动生产库', scope, now }).id
  const used = e.remember({ text: '被反复用到的构建命令', scope, source: 'agent', now }).id
  for (const id of [confirmed, pinned, used]) {
    e.log.append({ kind: 'touch', id, S: 1, born: old, touchAt: old, touches: id === used ? 9 : 0, upCount: 0, at: now })
  }
  const swept = e.sweepArchives({ now, force: true })
  assert.ok(!swept.archived.includes(confirmed), '人确认过的不该被自动忘记')
  assert.ok(!swept.archived.includes(pinned), '钉住的规则不该被自动忘记')
  assert.ok(!swept.archived.includes(used), '用过很多次的不该被当成没用过')
  const later = e.sweepArchives({ now: now + 400 * DAY, force: true })
  assert.ok(later.archived.includes(used), '常用过但长期静默、低稳定性的未确认记忆仍应可归档')
  assert.ok(!later.archived.includes(confirmed), '人确认记录长期静默后仍保护')
  assert.ok(!later.archived.includes(pinned), '钉住记录长期静默后仍保护')
})

test('D7: S 会给长期未用的记忆一条回落的路（旧实现 S 只增不减）', async (t) => {
  const { decayStability } = await import('../lib/fsrs.js')
  const fresh = decayStability(2, { idleDays: 0, upCount: 0 })
  const aged = decayStability(2, { idleDays: 365, upCount: 0 })
  assert.ok(aged < fresh, `长期未用应当回落：${aged} < ${fresh}`)
  const floor = decayStability(2, { idleDays: 100000, upCount: 0, floor: 0.01 })
  assert.ok(floor >= 0.01, '回落不得低于下限')
  const busySlow = decayStability(2, { idleDays: 365, upCount: 20 })
  assert.ok(busySlow > aged, '被反复巩固过的记忆回落得更慢')
})

test('D15: 统计门被真实样本驱动，且默认不会自动写库', (t) => {
  const e = engine(t)
  assert.equal(e.evalStats.samples, 0)
  assert.equal(e.effectiveAuthority().mode, 'propose-only', '零样本时必须是 propose-only')
  const before = e.effectiveAuthority().mode

  for (let i = 0; i < 80; i++) e.recall('anything ' + i, { scope })
  assert.ok(e.evalStats.samples >= 80, `检索应当累积样本，实际 ${e.evalStats.samples}`)
  const report = e.evalReport()
  assert.equal(report.samples, 0)
  assert.equal(report.usageObservations,e.evalStats.samples)
  assert.equal(report.detectDelta,null, '检索次数不具备任务评测判别力')

  assert.equal(e.effectiveAuthority().mode, 'propose-only')
  assert.equal(e.gate({ text: '候选', cues: ['x'], kind: 'episode' }).action, 'propose',
    '自动晋升默认关闭：门会算，但不自己写记忆')
  void before
})


test('D9: 回忆意图句真的会检索（以前恰好是静默的）', (t) => {
  const e = engine(t)
  for (const q of ['我们之前定过的那个方案是什么来着', 'do you remember what we decided earlier', '继续搞那个引用顺序']) {
    assert.equal(e.memorySnapshot({ text: q, scope, session: 's', turn: 1 }).mode, 'slow', `应走慢模式：${q}`)
  }


  const fresh = engine(t)
  assert.equal(fresh.memorySnapshot({ text: '今天天气不错', scope, session: 'other', turn: 1 }).mode, 'fast')
})

test('D13: 注入元数据显著变短，但载荷性的时间提示必须留下', async () => {
  const { compactMetadata, estimateTokens, memoryMetadata } = await import('../lib/inject.js')
  const normal = { id: 'm-1', source: 'human', trust: 'reported', scope: 's', text: '素材只做 2K', recordedAt: Date.now() }
  const compact = compactMetadata(normal)
  assert.ok(estimateTokens(compact) < estimateTokens(memoryMetadata(normal)), '压缩形式必须更短')
  assert.match(compact, /id=m-1/, 'id 必须保留（recall 要用）')
  assert.match(compact, /human\/reported/, '来源/信任必须保留（证据边界要用）')

  assert.match(compactMetadata({ ...normal, text: '下周三上线新版本' }), /@verify/)

  assert.doesNotMatch(compactMetadata({ ...normal, expiresAt: null }), /@expired/)
  assert.doesNotMatch(compactMetadata(normal), /@expired/)
  assert.match(compactMetadata({ ...normal, expiresAt: 1000 }), /@expired/)
})

test('D18: 真实命中优先；只有无命中时指针才作为线索兜底', async (t) => {
  const e = engine(t)
  const now = Date.now()

  e.remember({ text: '渲染农场规格：只做 2K', cues: ['渲染农场'], scope, source: 'human', now })

  e.staging.pointers.push({ topic: '渲染农场｜之前聊过的旧规格', scope, cues: ['渲染农场'], source: 'human', at: now })
  const hits = e.recall('渲染农场', { scope })
  assert.equal(hits[0].kind, 'episode', `真实记忆必须排在指针前面，实际 ${JSON.stringify(hits.map((h) => h.kind))}`)
  assert.ok(hits.slice(1).every((h) => h.pointer), '其余才可能是指针')


  const only = e.recall('完全没存过的检索词 xyzzy', { scope })
  assert.equal(only.length, 0, '毫无关联时不该硬凑指针')
})

test('D16: 批准 gist 摘要会真的写入 gist 并归档被取代的源（压缩不再是净增）', (t) => {
  const e = engine(t)
  const now = Date.now()
  const a = e.remember({ text: '第一天做了 X 事，细节很多很多很多', scope, source: 'agent', now })
  const b = e.remember({ text: '第二天做了 Y 事，细节同样很长', scope, source: 'agent', now: now + 1 })

  e.log.append({
    kind: 'proposal', id: 'p-gist', scope, proposalKind: 'gist-compress',
    text: '压缩后的要点',
    citations: [{ id: a.id, quote: 'X 事' }, { id: b.id, quote: 'Y 事' }],
    sourceRevisions: [
      { id: a.id, seq: e.log.items.get(a.id).activeSeq, reviewSeq: null },
      { id: b.id, seq: e.log.items.get(b.id).activeSeq, reviewSeq: null },
    ],
    status: 'pending',
  })
  const out = e.acceptProposal('p-gist', { scope, now: now + 2 })
  assert.equal(e.log.items.get(out.id).gist, '压缩后的要点', 'gist 必须真的被写入（旧实现全库无写入者）')
  assert.ok(out.superseded.includes(a.id) && out.superseded.includes(b.id), '被取代的源应进回收站')
  assert.ok(!e.log.alive(scope).some((it) => it.id === a.id), '归档后源不再参与检索')

  assert.equal(e.unarchive(a.id, { scope, now }).unarchived, true)
})


test('D8: 注入 → 轮末反馈 必须真的强化记忆（旧实现 touches 恒为 0）', (t) => {
  const e = engine(t)
  const now = Date.now()
  const a = e.remember({ text: 'Orchard 部署先构建再灰度', cues: ['orchard'], scope, source: 'human', now })
  const b = e.remember({ text: 'DemoStudio 素材只做 2K', cues: ['demostudio'], scope, source: 'human', now })
  assert.equal(e.log.items.get(a.id).touches, 0, '前置：初始未被触及')
  assert.equal(e.log.items.get(b.id).touches, 0)

  e.noteContextEmitted([a.id, b.id], { session: 's', turn: 1, now })

  e.noteContextEmitted([a.id, b.id], { session: 's', turn: 1, now })
  const out = e.noteTurnOutcome({ usedItemIds: [b.id], session: 's', turn: 1, now })
  assert.deepEqual(out.reinforced, [b.id], '只应强化真正被用上的那条')
  assert.equal(e.log.items.get(b.id).touches, 1)
  assert.deepEqual(e.log.items.get(b.id).sessions, ['s'], '跨会话判据需要有会话记录')
  assert.equal(e.log.items.get(a.id).touches, 0, '没被用上的不该涨')
})

test('D8: 没有显式使用信号时，只记录曝光、不强化（R1-01 显式-only 契约）', (t) => {
  const e = engine(t)
  const now = Date.now()
  const a = e.remember({ text: '某条被注入的记忆', cues: ['注入'], scope, source: 'human', now })
  e.noteContextEmitted([a.id], { session: 's', turn: 2, now })
  const out = e.noteTurnOutcome({ session: 's', turn: 2, now })
  assert.equal(out.explicit, false, '应标记为曝光（非显式使用）')
  assert.equal(out.evidence, 'exposure-only')
  assert.deepEqual(out.reinforced, [], '曝光绝不能强化')
  assert.equal(e.log.items.get(a.id).touches, 0, '曝光不推进 touches')
  assert.equal(out.candidates, 1, '曝光规模仍应如实记录（candidates）')
})

test('D8: 显式空数组表示明确无使用，零强化（不回落曝光）', (t) => {
  const e = engine(t)
  const now = Date.now()
  const a = e.remember({ text: '某条被注入的记忆', cues: ['注入空'], scope, source: 'human', now })
  e.noteContextEmitted([a.id], { session: 's', turn: 3, now })
  const out = e.noteTurnOutcome({ usedItemIds: [], session: 's', turn: 3, now })
  assert.equal(out.explicit, true)
  assert.equal(out.evidence, 'explicit-empty')
  assert.deepEqual(out.reinforced, [], '显式空数组 = 明确无使用，不得回落曝光集')
  assert.equal(e.log.items.get(a.id).touches, 0)
  assert.equal(out.candidates, 0)
})

test('D8: 反馈闭环让巩固不再是不可能（touches 能攒到阈值）', (t) => {
  const e = engine(t)
  const base = Date.now()
  const { id } = e.remember({ text: '会被反复用到的构建命令', cues: ['构建'], scope, source: 'human', now: base })
  for (let turn = 1; turn <= 3; turn++) {
    const now = base + turn * 60000
    e.noteContextEmitted([id], { session: 's' + turn, turn, now })
    e.noteTurnOutcome({ usedItemIds: [id], session: 's' + turn, turn, now })
  }
  const it = e.log.items.get(id)
  assert.equal(it.touches, 3, '三次使用应累积三次触及')
  assert.equal(new Set(it.sessions).size, 3, '三次不同会话——这正是跨会话巩固的前提')
  assert.ok(it.S > 1, `被反复用到，S 应上升（实际 ${it.S}）`)
})

test('D15: 注入/反馈都在累积评测样本（门随真实用量解锁）', (t) => {
  const e = engine(t)
  const now = Date.now()
  const { id } = e.remember({ text: 'x', cues: ['x'], scope, source: 'human', now })
  assert.equal(e.evalStats.samples, 0)
  e.noteContextEmitted([id], { session: 's', turn: 1, now })
  e.noteContextEmitted([id], { session: 's', turn: 2, now })
  assert.equal(e.evalStats.samples, 2, '每次装配 = 一次评测观测')
  e.noteTurnOutcome({ usedItemIds: [id], session: 's', turn: 1, now })
  assert.equal(e.evalStats.usedSamples, 1, '有真实使用信号的轮次单独计数')
})


test('D17: 作用域体检必须找出"永远不会被检索到"的记忆，并给出迁移建议', (t) => {
  const e = engine(t)
  const now = Date.now()


  const liveDir = mkdtempSync(join(tmpdir(), 'mnemo-live-scope-'))
  t.after(() => rmSync(liveDir, { recursive: true, force: true }))
  const liveScope = 'project:' + liveDir
  e.remember({ text: '可达项目里的记忆', scope: liveScope, source: 'human', now })
  e.remember({ text: '遗留路径里的记忆 A', scope: 'project:/workspace/legacy/projects/deepseek-harness', source: 'human', now })
  e.remember({ text: '遗留路径里的记忆 B', scope: 'project:/workspace/legacy/projects/deepseek-harness', source: 'human', now })
  const r = e.scopeReport()
  assert.equal(r.total, 3, '应统计全部条目')
  assert.equal(r.deadCount, 2, '两条遗留 scope 记忆应被判为不可达')
  assert.equal(r.reachableCount, 1)

  assert.ok(Math.abs(r.deadRatio - 2 / 3) < 1e-3, `比例分母必须是总数，实际 ${r.deadRatio}`)
  assert.ok(r.deadRatio <= 1, '比例不可能超过 1（曾经把可达数当分母算成 306%）')
  assert.deepEqual(r.deadScopes, ['project:/workspace/legacy/projects/deepseek-harness'])

  const hint = r.hints.find((h) => h.from === 'project:/workspace/legacy/projects/deepseek-harness')
  assert.ok(hint, '应给出迁移建议条目')
  assert.equal(hint.count, 2)


  const targetDir = mkdtempSync(join(tmpdir(), 'mnemo-target-deepseek-harness-'))
  t.after(() => rmSync(targetDir, { recursive: true, force: true }))
  const targetScope = 'project:' + join(targetDir, 'deepseek-harness')
  mkdirSync(targetScope.slice('project:'.length), { recursive: true })
  t.after(() => rmSync(targetScope.slice('project:'.length), { recursive: true, force: true }))
  e.remember({ text: '目标 scope', scope: targetScope, source: 'human', now })
  const r2 = e.scopeReport()
  const hint2 = r2.hints.find((h) => h.from === 'project:/workspace/legacy/projects/deepseek-harness')
  assert.equal(hint2.to, targetScope, '末段相同的可达 scope 应被推荐')
})

test('D15: gateReport 必须诚实说明"这道门现在有多灵"', (t) => {
  const e = engine(t)
  const r0 = e.gateReport()
  assert.equal(r0.authority.mode, 'propose-only', '零样本只能是 propose-only')
  assert.ok(r0.samplesNeeded > 0, '应给出还差多少样本')
  assert.equal(r0.detectableDelta, null, '样本不足时必须显式 null，不能给 Infinity')
  assert.equal(r0.discriminating, false, '样本不足时明确"无判别力"')

  const now = Date.now()
  const { id } = e.remember({ text: 'x', cues: ['x'], scope, source: 'human', now })
  for (let i = 0; i < 200; i++) e.noteContextEmitted([id], { session: 's', turn: i, now })
  const r1 = e.gateReport()
  assert.equal(e.evalStats.samples, 200)
  assert.equal(r1.detectableDelta,null, '投递次数不具备候选任务评测判别力')
})

test('D19: 第二个实例降级为只读而不是挂载失败（真正的端到端）', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-ro-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { apply } = await import('../index.js')
  const mount = async () => {
    const provided = {}
    const services = { commands: { register() {} }, sandboxPolicy: { workspaceRoot: '/tmp/x' } }
    await apply(
      { get: (n) => provided[n] ?? services[n], provide: (n, v) => { provided[n] = v }, effect: (f) => f(), on: () => () => {}, logger: { info() {} } },
      { dir, verbose: false, injectMode: 'off' },
    )
    return provided.mnemo
  }
  const first = await mount()
  assert.equal(first.readOnly, false, '第一个实例应拿到写权限')
  const second = await mount()
  assert.equal(second.readOnly, true, '第二个实例必须降级只读')
  assert.ok(Array.isArray(second.recall('anything', {})), '只读下检索仍可用')
  assert.throws(() => second.remember({ text: '不该写进去', scope }), /read-only/i, '只读下写入必须被明确拒绝')
  await second.detach()
  await first.detach()
})

test('D19: 只读实例做大量读操作后，共享存储必须一个字节都没变', async (t) => {
  const { statSync, readdirSync } = await import('node:fs')
  const { apply } = await import('../index.js')
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-ro-strict-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const snap = () => ({ size: statSync(join(dir, 'events.jsonl')).size, files: readdirSync(dir).sort().join(',') })
  const mount = async () => {
    const provided = {}
    const services = { commands: { register(c) { provided.cmd = c } }, sandboxPolicy: { workspaceRoot: '/tmp/x' } }
    await apply(
      { get: (n) => provided[n] ?? services[n], provide: (n, v) => { provided[n] = v }, effect: (f) => f(), on: () => () => {}, logger: { info() {} } },
      { dir, verbose: false, injectMode: 'off' },
    )
    return provided
  }

  const A = await mount()
  A.mnemo.remember({ text: '只读保护目标', cues: ['只读'], source: 'human' })
  const before = snap()
  const B = await mount()
  assert.equal(B.mnemo.readOnly, true, '第一个实例存活时，第二个必须只读')

  for (let i = 0; i < 5; i++) {
    B.mnemo.recall('只读', {})
    B.mnemo.memorySnapshot({ text: '只读测试', scope: 'default', session: 's', turn: i })
  }
  B.mnemo.scopeReport(); B.mnemo.gateReport(); B.mnemo.deliveryReport()
  const after = snap()
  assert.equal(after.size, before.size, '只读实例的读路径绝不能写库（旧实现会写 runtime-state 与结算暂存区）')
  assert.equal(after.files, before.files)
  assert.throws(() => B.mnemo.remember({ text: '不该写', source: 'human' }), /read-only/i)

  const denied = await B.cmd.handler({ rawInput: 'compact', agent: { id: 'a', session: { header: { cwd: '/tmp/x' } } } })
  assert.equal(denied.kind, 'error', '只读下 compact 必须被拒')
  const allowed = await B.cmd.handler({ rawInput: 'status', agent: { id: 'a', session: { header: { cwd: '/tmp/x' } } } })
  assert.equal(allowed.kind, 'success', '只读下 status 必须可用')
  await B.mnemo.detach()
  assert.equal(snap().size, after.size, '只读实例 detach 也不得写库')
  await A.mnemo.detach()
})


test('F2: 决策通道不得把"闲聊"当成规格（agent 独白洪水不能再被打开）', async (t) => {
  const { detectDecisions } = await import('../lib/decisions.js')

  for (const chatter of ['别急，我马上看看', '不用了，谢谢', '优先处理哪个？', 'I must check the logs before continuing.', 'We prefer the simpler approach here.']) {
    assert.equal(detectDecisions(chatter).length, 0, `不该当成决策：${chatter}`)
  }

  assert.ok(detectDecisions('用 2K，不要 4K').length > 0)
  assert.ok(detectDecisions('端口改成 8443').length > 0)
  assert.ok(detectDecisions('我们只做 1080p/2K，永远不用 4K').some((d) => d.kind === 'negative'))

  assert.equal(detectDecisions('这段代码必须重构', { requireValue: true }).length, 0, 'agent 的裸"必须"不是规格')
  assert.ok(detectDecisions('不要 4K', { requireValue: true }).length > 0, 'agent 的强否定带取值应保留')
})

test('F3: 回声判定不得丢掉 agent 带新信息的汇报，也不能放过纯复述', () => {
  const scope = 'p'
  const run = (steps) => {
    const s = new StagingArea()
    let t0 = 1_000_000
    for (const st of steps) { s.offer({ text: st.t, cues: st.c, scope, source: st.s, now: t0 }); t0 += 1000 }
    return s.settle({ now: t0 + 1000, scope })
  }

  const echo = run([
    { t: '帮我实现登录功能', c: ['实现登录功'], s: 'human' },
    { t: '好的，我来实现登录功能，先看现有代码。', c: ['实现登录功', '代码'], s: 'agent' },
  ])
  assert.equal(echo.captured.length, 1, '复述不该单独成条')
  assert.equal(echo.captured[0].source, 'human')

  const novel = run([
    { t: '我们用的是 PostgreSQL 数据库', c: ['postgresql', '数据库'], s: 'human' },
    { t: 'PostgreSQL 数据库我升级到 16 版本，连接串改成连接池了', c: ['postgresql', '数据库', '升级', '连接池'], s: 'agent' },
  ])
  assert.equal(novel.captured.length, 2, '带新信息的汇报必须入库')
  assert.ok(novel.captured.some((x) => x.source === 'agent'))

  const selfRepeat = run([
    { t: '我来看看构建', c: ['构建'], s: 'agent' },
    { t: '构建还在跑', c: ['构建'], s: 'agent' },
  ])
  assert.equal(selfRepeat.captured.length, 0, 'agent 自重复不得入库')
})

test('F5: 从回收站恢复必须是持久的（不能被下一轮扫描立刻重新归档）', (t) => {
  const e = engine(t, { forget: { MIN_IDLE_DAYS: 1, S_MAX_ARCHIVED: 2, MAX_TOUCHES: 2, SWEEP_EVERY_TURNS: 0 } })
  const now = Date.now()
  const { id } = e.remember({ text: '一条旧的临时记忆', scope, source: 'agent', now })
  e.log.append({ kind: 'touch', id, S: 1, born: now / 86400000 - 400, touchAt: now / 86400000 - 400, touches: 0, upCount: 0, at: now })
  assert.ok(e.sweepArchives({ now, force: true }).archived.includes(id), '前置：先被归档')
  assert.equal(e.unarchive(id, { scope, now }).unarchived, true)

  const again = e.sweepArchives({ now: now + 1000, force: true })
  assert.ok(!again.archived.includes(id), '恢复后不该被立刻重新归档')
  assert.equal(e.log.alive(scope).length, 1)
})

test('F6: 只读实例不得创建日志文件（创建文件也是写）', async (t) => {
  const { existsSync, readdirSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-ro-nofile-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const e = new MemoryEngine({ dir })
  e.setReadOnly(true, 'test')
  e.setScope(scope)
  e.start('s')
  assert.equal(existsSync(join(dir, 'events.jsonl')), false, '只读实例不该创建 events.jsonl')
  assert.deepEqual(readdirSync(dir), [], '只读实例不该在数据目录留下任何文件')
})

test('F4: 只读实例不得通过 migrateScope 写库', (t) => {
  const e = engine(t)
  e.setReadOnly(true, 'test')
  assert.throws(() => e.migrateScope('legacy', scope), /read-only/i, '迁移会 append 事件，必须被拒')
})


test('D20: rememberMany 与逐条 remember 结果等价，且冲突检测仍然有效', (t) => {
  const many = engine(t)
  const one = engine(t)
  const now = Date.now()
  const payloads = [
    { text: 'Orchard 超时设为 30 秒，先按这个来', cues: ['orchard'], scope, source: 'human', now },
    { text: 'DemoStudio 素材只做 2K', cues: ['demostudio'], scope, source: 'human', now: now + 1 },
    { text: '渲染农场代号 DEMO-1000 已下线', cues: ['demo-1000'], scope, source: 'agent', now: now + 2 },
  ]
  const bulk = many.rememberMany(payloads)
  const single = payloads.map((p) => one.remember(p))
  assert.equal(bulk.length, 3, '批量写入应全部落盘')
  assert.equal(many.log.items.size, one.log.items.size, '条目数应一致')

  const shape = (e) => [...e.log.items.values()].map((i) => [i.text, i.source, i.scope, i.activeSeq])
  assert.deepEqual(shape(many).sort(), shape(one).sort(), '批量与逐条的条目语义必须一致')
  assert.equal(many.log.seq, one.log.seq, '事件序号应一致（顺序分配，不间断）')

  assert.ok(many.cueVocabulary.has('orchard'))
  assert.ok(many.log.items.get(bulk[0].id))
  assert.equal(many.recall('orchard', { scope }).length >= 1, true, '批量写入的条目必须可召回')
})

test('D20: 批量写入的条目能被后续单条写入正确做冲突检测', (t) => {
  const e = engine(t)
  const now = Date.now()
  const [first] = e.rememberMany([
    { text: 'Orchard 请求超时设置为 30 秒', cues: ['orchard'], scope, source: 'human', now },
  ])

  const second = e.remember({ text: 'Orchard 请求超时不要设置为 30 秒', cues: ['orchard'], scope, source: 'human', now: now + 1000 })
  const a = e.log.items.get(first.id), b = e.log.items.get(second.id)
  assert.ok((a.conflicts ?? []).includes(b.id) || (b.conflicts ?? []).includes(a.id),
    `批量写入的条目必须参与后续冲突检测：a.conflicts=${JSON.stringify(a.conflicts)} b.conflicts=${JSON.stringify(b.conflicts)}`)
})

test('D20: 批量写入后重放日志必须与逐条写入等价', (t) => {
  const { MemoryEngine: ME } = { MemoryEngine: null }
  const e = engine(t)
  const now = Date.now()
  e.rememberMany(Array.from({ length: 25 }, (_, i) => ({
    text: '批量条目 ' + i + ' 关于部署的取舍', cues: ['部署'], scope, source: 'agent', now: now + i,
  })))
  const before = [...e.log.items.values()].map((i) => [i.id, i.text, i.scope, i.touches])
  const dir = e.log.dir
  const r = new (Object.getPrototypeOf(e).constructor)({ dir })
  r.setScope(scope)
  r.start('s2')
  const after = [...r.log.items.values()].map((i) => [i.id, i.text, i.scope, i.touches])
  assert.deepEqual(after.sort(), before.sort(), '重放结果必须完全一致')
  void ME
})
