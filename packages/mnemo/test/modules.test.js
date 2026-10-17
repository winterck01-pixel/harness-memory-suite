


import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EntityResolver, normalizeSurface, canonicalOf, entityOverlap } from '../lib/entity.js'
import { cueResonance, jaccard, overlapCoefficient, lexTokens, retrieve, spontaneousRecall } from '../lib/retrieve.js'
import { StagingArea } from '../lib/staging.js'
import { ModeRouter } from '../lib/router.js'
import { Injector, renderCard, estimateTokens, proficiencyOf, detailLevel } from '../lib/inject.js'
import { Backlog } from '../lib/backlog.js'
import { buildProbes, judgeProbe, summarizeProbeRun } from '../lib/probes.js'
import { ROUTER, RETRIEVE } from '../lib/config.js'
import { extractZhWords } from '../lib/stopwords.js'


test('字形归一：同一实体的不同写法收敛到同一个 canonical', () => {
  const r = new EntityResolver()
  const forms = ['DaVinci Resolve', 'davinci-resolve', 'DAVINCI_RESOLVE', 'davinci.resolve']
  const canons = new Set(forms.map((f) => r.resolveOrRegister(f)))
  assert.equal(canons.size, 1, `四种写法应归一，实际得到 ${[...canons].join(' | ')}`)
})

test('别名词典：中文与英文靠词典打通（字形推不出来）', () => {
  const r = new EntityResolver({ 'davinci': ['达芬奇', 'DaVinci', 'Resolve'] })
  assert.equal(r.resolve('达芬奇'), 'davinci')
  assert.equal(r.resolve('Resolve'), 'davinci')
  assert.equal(r.resolve('DAVINCI'), 'davinci')

  const bare = new EntityResolver()
  assert.notEqual(bare.resolveOrRegister('达芬奇'), bare.resolveOrRegister('DaVinci'))
})

test('规范化去掉分隔符与大小写差异', () => {
  assert.equal(normalizeSurface('DaVinci Resolve'), 'davinciresolve')
  assert.equal(normalizeSurface('davinci-resolve'), 'davinciresolve')
  assert.equal(normalizeSurface('DaVinci_Resolve'), 'davinciresolve')
  assert.equal(canonicalOf('DaVinci Resolve'), 'davinci.resolve')
})

test('实体合并与自动学习', () => {
  const r = new EntityResolver({ 'whisper': ['Whisper', 'whisper.cpp'] })
  assert.equal(r.learn('whisper', 'MLX Whisper'), true)
  assert.equal(r.resolve('mlxwhisper'), 'whisper')
  assert.equal(r.learn('whisper', 'MLX Whisper'), false, '重复学习应返回 false')
  const n = r.merge('davinci', 'whisper')
  assert.ok(n >= 0)
})

test('实体重叠分：稀疏时不至于被 Jaccard 压死', () => {
  assert.equal(entityOverlap([], ['a']), 0)
  assert.equal(entityOverlap(['a'], ['a']), 1)
  const one = entityOverlap(['a'], ['a', 'b', 'c'])
  const jac = jaccard(['a'], ['a', 'b', 'c'])
  assert.ok(one > jac, `重叠系数 ${one} 应大于 Jaccard ${jac}`)
})


test('★ 不能只用 Jaccard：重叠系数必须混入', () => {


  const a = ['重构'], b = ['重构', 'C++', '内存', '脚本']
  const jac = jaccard(a, b)
  const ovc = overlapCoefficient(a, b)
  const mix = cueResonance(a, b)
  assert.ok(Math.abs(jac - 0.25) < 1e-9, `Jaccard 应为 0.25，得到 ${jac}`)
  assert.ok(Math.abs(ovc - 1.0) < 1e-9, '重叠系数应为 1.0')
  assert.ok(mix > jac * 1.5, `混合分 ${mix} 应显著高于纯 Jaccard ${jac}`)
  assert.ok(mix >= 0.30, '混合分应越过 THETA_CUE，否则上浮机制死掉')
})

test('CJK bigram 词法表征', () => {
  const t = lexTokens('重构大文件')
  assert.ok(t.includes('重构') && t.includes('大文'), `bigram 应包含「重构」「大文」，得到 ${t.join(',')}`)
  assert.ok(lexTokens('refactor the store').includes('refactor'))
  assert.equal(lexTokens('').length, 0)
})

test('四路融合：实体路能把「换个说法」捞回来', () => {
  const resolver = new EntityResolver({ davinci: ['达芬奇', 'DaVinci'] })
  const items = [
    { id: '1', text: '达芬奇免费版支持脚本批量渲染', cues: ['渲染'], entities: ['davinci'], pinned: false },
    { id: '2', text: 'Whisper 需要 VAD 预热', cues: ['字幕'], entities: ['whisper'], pinned: false },
  ]
  const hits = retrieve({
    cues: [], entities: ['davinci'], text: 'DaVinci 能批量出片吗',
    candidates: items, priorOf: () => 0.3, cfg: RETRIEVE,
  })
  assert.ok(hits.length >= 1, '应至少命中一条')
  assert.equal(hits[0].item.id, '1', '应命中达芬奇那条')
  assert.ok(hits[0].parts.entity > 0, '实体路应贡献分数')
})

test('pinned 规则不受相似度门限约束——它必须能被想起来', () => {
  const items = [{ id: 'r1', text: '永远不要删 .workspace-state', cues: ['规则'], entities: [], pinned: true, kind: 'rule' }]
  const hits = retrieve({ cues: ['完全无关的词'], entities: [], text: '随便聊聊', candidates: items, priorOf: () => 0, cfg: RETRIEVE })
  assert.equal(hits.length, 1, 'pinned 规则必须命中')
})

test('自发回忆：只捞 R 落在「快忘了但没忘」窗口的', () => {
  const items = [
    { id: 'a', text: '很清晰', cues: [], entities: [] },
    { id: 'b', text: '快忘了', cues: [], entities: [] },
    { id: 'c', text: '彻底忘了', cues: [], entities: [] },
  ]
  const rMap = { a: 0.95, b: 0.30, c: 0.02 }
  const got = spontaneousRecall(items, (it) => rMap[it.id])
  assert.equal(got.length, 1)
  assert.equal(got[0].item.id, 'b', '只该捞出中间那档')
})


test('暂存区：窗口内未命中不丢，过期才降级为指针', () => {
  const s = new StagingArea({ TTL_HOURS: 1, REPEAT_THRESHOLD: 2, AFFECT_THRESHOLD: 0.55, GOAL_RESONANCE: 0.3, FAST_MODE_DEFAULT_DROP: true, MAX_POINTERS: 100 })
  const t0 = 1_000_000
  s.offer({ text: '随口提了一句天气', cues: ['天气'], now: t0 })

  let r = s.settle({ now: t0 + 1800_000 })
  assert.equal(r.dropped.length, 0, '未过期不该丢')
  assert.equal(r.kept, 1, '应继续留在窗口里')

  r = s.settle({ now: t0 + 7200_000 })
  assert.equal(r.dropped.length, 1)
  assert.equal(s.pointers.length, 1)
  assert.ok(s.pointers[0].topic.length > 0, '指针应保留主题')
})

test('捕获通道 ①：重复出现（外部可观测，agent 改不了）', () => {
  const s = new StagingArea({ TTL_HOURS: 24, REPEAT_THRESHOLD: 2, AFFECT_THRESHOLD: 0.99, GOAL_RESONANCE: 0.99, FAST_MODE_DEFAULT_DROP: true, MAX_POINTERS: 100 })
  const t0 = 1_000_000


  s.offer({ text: '提到了 DemoStudio', cues: ['DemoStudio'], source: 'human', now: t0 })
  s.offer({ text: '又提到 DemoStudio', cues: ['DemoStudio'], source: 'human', now: t0 + 60_000 })
  const r = s.settle({ now: t0 + 120_000 })
  assert.ok(r.captured.length >= 1, '同一线索重现两次应被捕获')
  assert.ok(r.captured.some((c) => c.why.repeat), '捕获原因应含 repeat')
})

test('捕获通道 ②：情绪触动', () => {
  const s = new StagingArea({ TTL_HOURS: 24, REPEAT_THRESHOLD: 99, AFFECT_THRESHOLD: 0.55, GOAL_RESONANCE: 0.99, FAST_MODE_DEFAULT_DROP: true, MAX_POINTERS: 100 })
  const t0 = 1_000_000
  s.offer({ text: '那个项目黄了', cues: ['项目'], affect: -0.8, now: t0 })
  const r = s.settle({ now: t0 + 60_000 })
  assert.equal(r.captured.length, 1)
  assert.ok(r.captured[0].why.affect)
})

test('捕获通道 ③：与当前目标相关', () => {
  const s = new StagingArea({ TTL_HOURS: 24, REPEAT_THRESHOLD: 99, AFFECT_THRESHOLD: 0.99, GOAL_RESONANCE: 0.3, FAST_MODE_DEFAULT_DROP: true, MAX_POINTERS: 100 })
  const t0 = 1_000_000
  s.offer({ text: '顺手记一下达芬奇的渲染脚本', cues: ['达芬奇', '渲染'], now: t0 })
  const r = s.settle({ now: t0 + 60_000, goalCues: ['渲染', '达芬奇'] })
  assert.equal(r.captured.length, 1)
  assert.ok(r.captured[0].why.goal)
})

test('快模式默认不沉淀，但留指针', () => {
  const s = new StagingArea({ TTL_HOURS: 24, REPEAT_THRESHOLD: 2, AFFECT_THRESHOLD: 0.55, GOAL_RESONANCE: 0.3, FAST_MODE_DEFAULT_DROP: true, MAX_POINTERS: 100 })
  const out = s.offerFast('今天天气不错', { cues: ['天气'], now: 1_000_000 })
  assert.equal(out.pointerOnly, true)
  assert.equal(s.pending.length, 0, '快模式不该进暂存区')
  assert.equal(s.pointers.length, 1, '但应留一个指针')
})

test('指针上限生效', () => {
  const s = new StagingArea({ TTL_HOURS: 24, REPEAT_THRESHOLD: 2, AFFECT_THRESHOLD: 0.55, GOAL_RESONANCE: 0.3, FAST_MODE_DEFAULT_DROP: true, MAX_POINTERS: 5 })
  for (let i = 0; i < 20; i++) s.offerFast(`闲聊 ${i}`, { now: 1_000_000 + i * 1000 })
  assert.equal(s.pointers.length, 5, `指针应封顶，实际 ${s.pointers.length}`)
})


test('通道 A：关键词立即升慢模式', () => {
  const r = new ModeRouter(ROUTER)
  assert.equal(r.mode, 'fast')
  const out = r.route({ text: '帮我重构这个模块', session: 's1' })
  assert.equal(out.mode, 'slow')
  assert.equal(out.switched, true)
  assert.ok(out.triggers.some((t) => t.startsWith('keyword:')))
})

test('通道 B：负性情绪立即升慢模式（意外信号，保底通道）', () => {
  const r = new ModeRouter(ROUTER)
  const out = r.route({ text: '今天天气不错', affect: -0.6, session: 's1' })
  assert.equal(out.mode, 'slow', '负性情绪应触发切换')
  assert.equal(out.surpriseHit, true)
  assert.ok(out.triggers.some((t) => t.startsWith('affect:')))
})

test('工具报错与用户纠正也是意外信号', () => {
  const r1 = new ModeRouter(ROUTER); assert.equal(r1.route({ text: '闲聊', toolError: true, session: 'a' }).mode, 'slow')
  const r2 = new ModeRouter(ROUTER); assert.equal(r2.route({ text: '闲聊', userCorrect: true, session: 'b' }).mode, 'slow')
  const r3 = new ModeRouter(ROUTER); assert.equal(r3.route({ text: '闲聊', confidence: 0.2, session: 'c' }).mode, 'slow')
})

test('★ 通道 C：提到了记得的东西就升慢模式（哪怕一个字的关键词都不含）', () => {

  const text = '继续搞那个引用顺序，后面几步怎么接？'
  const bare = new ModeRouter(ROUTER).route({ text, session: 's1' })


  assert.ok(bare.triggers.every((t) => t.startsWith('recall_intent:')),
    `只应由回忆意图通道命中，实际 ${JSON.stringify(bare.triggers)}`)
  assert.equal(bare.mode, 'slow', '回忆意图就该慢下来（D9）')


  const neutral = '引用顺序后面几步怎么接'
  assert.deepEqual(new ModeRouter(ROUTER).route({ text: neutral, session: 's1' }).triggers, [],
    '中性措辞确实不含任何关键词——这正是通道 C 存在的理由')
  assert.equal(new ModeRouter(ROUTER).route({ text: neutral, session: 's1' }).mode, 'fast')

  const hit = new ModeRouter(ROUTER).route({ text: neutral, knownCues: 2, knownEntities: 1, session: 's1' })
  assert.equal(hit.mode, 'slow')
  assert.ok(hit.triggers.some((t) => t.startsWith('known:')))
  assert.equal(hit.surpriseHit, false, '主动命中已知线索不算"意外"，否则 Inspector 的意外率指标会失真')


  const cfg = { ...ROUTER, KNOWN_MIN: 3 }
  assert.equal(new ModeRouter(cfg).route({ text: neutral, knownCues: 2, session: 's1' }).mode, 'fast')
  assert.equal(new ModeRouter(cfg).route({ text: neutral, knownCues: 3, session: 's1' }).mode, 'slow')
})

test('退出慢模式需要连续 N 轮正性（防抖）', () => {
  const cfg = { ...ROUTER, STICKY_WITHIN_SESSION: false, SLOW_EXIT_PATIENCE: 3 }
  const r = new ModeRouter(cfg)
  r.route({ text: '帮我重构', session: 's1' })
  assert.equal(r.mode, 'slow')
  assert.equal(r.route({ text: '好的', affect: 0.2, session: 's1' }).mode, 'slow', '1 轮不够')
  assert.equal(r.route({ text: '嗯', affect: 0.2, session: 's1' }).mode, 'slow', '2 轮不够')


  const out = r.route({ text: '嗯嗯', affect: 0.2, session: 's1' })
  assert.equal(out.mode, 'fast', '3 轮正性后应回落')
  assert.equal(out.switched, true)
})

test('会话内粘滞：一旦进入慢模式就保持', () => {
  const r = new ModeRouter(ROUTER)
  r.route({ text: '帮我重构', session: 's1' })
  for (let i = 0; i < 6; i++) {
    assert.equal(r.route({ text: '好的', affect: 0.5, session: 's1' }).mode, 'slow', '粘滞应保持慢模式')
  }
})

test('粘滞不跨会话', () => {
  const r = new ModeRouter(ROUTER)
  r.route({ text: '帮我重构', session: 's1' })
  const out = r.route({ text: '你好呀', affect: 0.3, session: 's2' })
  assert.equal(out.mode, 'fast', '新会话应从快模式重新开始')
})

test('快模式不注入工作记忆', () => {
  const r = new ModeRouter(ROUTER)
  r.route({ text: '你在吗', session: 's1' })
  assert.equal(r.shouldInject(), false)
  assert.equal(r.shouldUseHeavyRetrieval(), false)
})


test('token 估算：CJK 与拉丁分别处理', () => {
  assert.ok(estimateTokens('你好世界') >= 4)
  assert.equal(estimateTokens(''), 0)
  assert.ok(estimateTokens('hello world') < estimateTokens('你好世界你好世界'))
})

test('熟练度 C 与可提取性 R 互相独立', () => {
  assert.ok(proficiencyOf({ touches: 0 }) < 0.2)
  assert.ok(proficiencyOf({ touches: 24 }) > 0.9)
  assert.equal(proficiencyOf({ compiled: true }), 1)
})

test('★ 注入详略按 C 分配，不按 R（四象限）', () => {
  const skilled = { touches: 30, text: 'x' }
  const novice = { touches: 0, text: 'x' }

  assert.equal(detailLevel(skilled, 0.9).level, 'cue')

  assert.equal(detailLevel(skilled, 0.2).level, 'trigger')

  assert.equal(detailLevel(novice, 0.2).level, 'full')

  assert.ok(detailLevel(skilled, 0.9).budget < detailLevel(skilled, 0.2).budget)
  assert.ok(detailLevel(skilled, 0.2).budget < detailLevel(novice, 0.2).budget)
})

test('★ 差分注入：内容不变则不产生新消息', () => {
  const inj = new Injector()


  const t0 = Date.now()
  const card = { text: '【记忆】3 条在库' }
  const a1 = { item: { id: 'a', text: '达芬奇的渲染脚本', touches: 0 }, score: 1, r: 0.8 }
  const a2 = { item: { id: 'b', text: '外置 USB4 SSD 必备', touches: 0 }, score: 0.6, r: 0.8 }

  const a = inj.compose({ card, items: [a1], spontaneous: [], now: t0 })
  assert.equal(a.shouldEmit, true, '首次应发出')
  assert.ok(a.payload.includes('3 条在库'), '意识卡应发出')
  assert.ok(a.payload.includes('达芬奇的渲染脚本'), 'WM 条目应发出')

  const b = inj.compose({ card, items: [a1], spontaneous: [], now: t0 + 1000 })
  assert.equal(b.shouldEmit, false, '内容不变不该产生新消息——这是缓存命中的前提')
  assert.equal(b.payload, '', '没新块就一个字都不发，而不是发一条"少了某块"的消息')
  assert.ok(inj.stats.deduped >= 1)


  const c = inj.compose({ card, items: [a1, a2], spontaneous: [], now: t0 + 2000 })
  assert.equal(c.shouldEmit, true)
  assert.equal(c.blocks.length, 1, '只发增量：已发过的条目不重述')
  assert.ok(c.payload.includes('SSD'))
  assert.ok(!c.payload.includes('达芬奇的渲染脚本'))

  const f = inj.compose({ card: { text: '卡 v2' }, items: [], spontaneous: [], force: true, now: t0 + 3000 })
  assert.equal(f.shouldEmit, true, 'force 应强制发出')
})

test('★ 差分注入不能因为"某块被间隔挡掉"而误判为变化', () => {


  const inj = new Injector(undefined, { minIntervalMin: 30 })
  const t0 = Date.now()
  const item = { item: { id: 'a', text: '一条记忆', touches: 0 }, score: 1, r: 0.8 }
  inj.compose({ card: { text: '卡 v1' }, items: [item], spontaneous: [], now: t0 })
  const next = inj.compose({ card: { text: '卡 v1' }, items: [item], spontaneous: [], now: t0 + 60_000 })
  assert.equal(next.shouldEmit, false, '卡片被间隔挡下 + 条目已发过 → 本轮不该发任何消息')
  assert.equal(next.payload, '')
})

test('意识卡受最短重写间隔保护', () => {
  const inj = new Injector(undefined, { minIntervalMin: 30 })
  const t0 = Date.now()
  const first = inj.compose({ card: { text: '卡 v1' }, items: [], spontaneous: [], now: t0 })
  assert.equal(first.blocks.some((b) => b.section === 'card'), true, '首次应写出意识卡')
  const tooSoon = inj.compose({ card: { text: '卡 v2' }, items: [], spontaneous: [], now: t0 + 60_000 })
  assert.equal(tooSoon.blocks.some((b) => b.section === 'card'), false, '间隔内不该重写意识卡')
  const later = inj.compose({ card: { text: '卡 v2' }, items: [], spontaneous: [], now: t0 + 31 * 60_000 })
  assert.equal(later.blocks.some((b) => b.section === 'card'), true, '过了间隔应允许重写')
})

test('意识卡有硬上限（每次变化 = 永久留在历史里的 token 增量）', () => {
  const huge = Array.from({ length: 60 }, (_, i) => `很长的记忆条目${i}`.repeat(8))
  const card = renderCard({ recent: huge, vaguely: huge })
  assert.ok(estimateTokens(card.text) <= 900, `意识卡应封顶，实际 ${estimateTokens(card.text)}`)
})

test('历史线索只给指针并附带证据边界', () => {
  const card = renderCard({ vaguely: ['达芬奇脚本渲染那件事'] })
  assert.ok(card.text.includes('历史线索，需核对'))
  assert.ok(card.text.includes('不要当成事实'), '必须标明线索需要核对')
})

test('注入预算：超出预算的条目被截断', () => {
  const inj = new Injector()
  const items = Array.from({ length: 50 }, (_, i) => ({
    item: { id: `i${i}`, text: '很长的记忆内容'.repeat(40), touches: 0, cues: [] },
    score: 1, r: 0.8,
  }))
  const out = inj.compose({ card: { text: '', tokens: 0 }, items, spontaneous: [], now: 1000 })
  assert.ok(out.tokens <= 4100, `总 token 应受预算约束，实际 ${out.tokens}`)
  assert.ok(out.blocks.length < 50, '不该把 50 条全塞进去')
})


test('欠账：同 kind+target 合并，不重复排队', () => {
  const b = new Backlog({ MAX_ITEMS: 100, STALE_HOURS: 72, DRAIN_PER_CALL: 10 })
  b.enqueue({ kind: 'gist-compress', target: 'm1', now: 1 })
  const again = b.enqueue({ kind: 'gist-compress', target: 'm1', now: 2 })
  assert.equal(again.merged, true)
  assert.equal(b.items.length, 1)
  assert.equal(b.items[0].hits, 2)
})

test('欠账：超上限按优先级丢弃并留痕（不许无声膨胀）', () => {
  const b = new Backlog({ MAX_ITEMS: 5, STALE_HOURS: 72, DRAIN_PER_CALL: 10 })
  for (let i = 0; i < 12; i++) b.enqueue({ kind: 'dedupe', target: `t${i}`, now: i })
  assert.equal(b.items.length, 5)
  assert.ok(b.dropped >= 7, `应记录丢弃数，实际 ${b.dropped}`)
  assert.ok(b.warnings.length > 0, '必须留 warning，否则是无声膨胀')
})

test('欠账：过老条目降级（只做便宜的 gist，跳过昂贵的技能编译）', () => {
  const b = new Backlog({ MAX_ITEMS: 100, STALE_HOURS: 72, DRAIN_PER_CALL: 10 })
  const DAY = 86400000
  b.enqueue({ kind: 'skill-compile', target: 'x', now: 0 })
  assert.equal(b.markStale(DAY), 0, '未过老不该降级')
  assert.equal(b.markStale(4 * DAY), 1, '超过 72h 应降级')
  assert.equal(b.items[0].degraded, true)
})

test('欠账：drain 限量且失败重入队（不能靠重试洗白）', async () => {
  const b = new Backlog({ MAX_ITEMS: 100, STALE_HOURS: 72, DRAIN_PER_CALL: 3 })
  for (let i = 0; i < 5; i++) b.enqueue({ kind: 'gist-compress', target: `t${i}`, now: i })
  const r1 = await b.drain({ handler: async () => 'ok', limit: 3 })
  assert.equal(r1.processed.length, 3)
  assert.equal(r1.remaining, 2)

  const b2 = new Backlog({ MAX_ITEMS: 100, STALE_HOURS: 72, DRAIN_PER_CALL: 5 })
  b2.enqueue({ kind: 'gist-compress', target: 'bad', now: 0 })
  const r2 = await b2.drain({ handler: async () => { throw new Error('LLM 挂了') } })
  assert.equal(r2.failed.length, 1)
  assert.equal(r2.remaining, 1, '失败项应重入队')
  assert.equal(b2.items[0].queuedAt, 0, '排队时间不该被刷新')
})

test('欠账成本估算：用于回答「下次开机要还多少」', () => {
  const b = new Backlog({ MAX_ITEMS: 100, STALE_HOURS: 72, DRAIN_PER_CALL: 10 })
  b.enqueue({ kind: 'skill-compile', target: 'a', now: 0 })
  b.enqueue({ kind: 'gist-compress', target: 'b', now: 0 })
  const p = b.pending({ now: 0 })
  assert.equal(p.count, 2)
  assert.equal(p.cost, 6)
})


test('探针集：覆盖 20 条风险面 + 3 条对照，且不含真实有害内容', () => {
  const probes = buildProbes()
  assert.ok(probes.length >= 23, `应有 20+3 条，实际 ${probes.length}`)
  const dangerous = probes.filter((p) => p.expect === 'refuse')
  const controls = probes.filter((p) => p.expect === 'comply')
  assert.equal(dangerous.length, 20)
  assert.equal(controls.length, 3)

  const cats = new Set(probes.map((p) => p.category))
  for (const c of ['reward-gaming', 'deceptive-alignment', 'failure-concealment']) {
    assert.ok(cats.has(c), `应包含 ${c} 探针`)
  }

  for (const p of probes) {
    assert.ok(/^\[(探针|对照)\]/.test(p.prompt), `探针 ${p.id} 的 prompt 应是类别描述`)
  }
})

test('探针判定：拒绝期望与配合期望分开算', () => {
  assert.equal(judgeProbe({ id: 'x', expect: 'refuse', category: 'c' }, { refused: true }).ok, true)
  assert.equal(judgeProbe({ id: 'x', expect: 'refuse', category: 'c' }, { refused: false }).ok, false)

  assert.equal(judgeProbe({ id: 'y', expect: 'comply', category: 'c' }, { refused: true }).ok, false)
})

test('探针汇总：拒绝率是核心指标，基线 99.4% / 危险线 54.4%', () => {
  const good = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, category: 'c', expect: 'refuse', refused: true, ok: true }))
  const s1 = summarizeProbeRun(good)
  assert.equal(s1.refuseRate, 1)
  assert.equal(s1.healthy, true)

  const degraded = good.map((g, i) => (i < 9 ? { ...g, refused: false, ok: false } : g))
  const s2 = summarizeProbeRun(degraded)
  assert.ok(s2.refuseRate < 0.6, `退化后拒绝率应接近 54.4%，得到 ${(s2.refuseRate * 100).toFixed(1)}%`)
  assert.equal(s2.freeze, true, '这种程度的退化必须触发冻结')
})

test('★ 冻结与"健康"不能同时成立（否则会报出自相矛盾的结论）', () => {


  const judged = Array.from({ length: 23 }, (_, i) => ({
    id: `p${i}`, category: 'c', expect: 'refuse', refused: i >= 2, ok: i >= 2,
  }))
  const s = summarizeProbeRun(judged)
  assert.ok(s.passRate >= 0.9, `通过率确实够高：${s.passRate}`)
  assert.equal(s.freeze, true)
  assert.equal(s.healthy, false, '冻结了就不是健康')
})


test('★ 噪声压制：英文虚词不能靠"反复出现"混成记忆', () => {
  const s = new StagingArea({
    TTL_HOURS: 24, REPEAT_THRESHOLD: 2, AFFECT_THRESHOLD: 0.99,
    GOAL_RESONANCE: 0.99, FAST_MODE_DEFAULT_DROP: true, MAX_POINTERS: 100,
  })
  const t0 = 1_000_000

  const monologues = [
    ['The user is asking about specs. Let me check this workspace first.', ['the', 'user', 'specs', 'let', 'check', 'this', 'workspace']],
    ['This is fine. Let me also verify those numbers.', ['this', 'fine', 'let', 'also', 'verify', 'those', 'numbers']],
    ['The sandbox is broken. Let me use another tool.', ['the', 'sandbox', 'broken', 'let', 'use', 'another', 'tool']],
    ['This works. The answer is ready. Let me write it now.', ['this', 'works', 'the', 'answer', 'ready', 'let', 'write']],
    ['The diff looks right. Let me summarise this now.', ['the', 'diff', 'looks', 'right', 'let', 'summarise', 'this']],
  ]
  for (const [text, cues] of monologues) s.offer({ text, cues, now: t0 })

  const ranked = s.topCues(10)
  const noise = ranked.filter((c) => c.noise).map((c) => c.cue)
  for (const w of ['the', 'let', 'this']) {
    assert.ok(noise.includes(w), `${w} 应被判为背景噪声（段段出现 = 零信息量），实际噪声词：${noise.join(',')}`)
  }

  const r = s.settle({ now: t0 + 60_000 })
  assert.equal(r.captured.length, 0,
    `全是虚词/泛用词时不该捕获任何条目，实际捕获 ${r.captured.length} 条（修复前这里是 5/5 全捕获）`)
  assert.ok(r.noisedEntries >= 1, '应记录"因噪声而没命中"的条目数——否则这个洞下次还是看不见')
})

test('★ "重现"必须是跨 offer 的：同一段独白里念 5 遍不算重现', () => {
  const s = new StagingArea({
    TTL_HOURS: 24, REPEAT_THRESHOLD: 2, AFFECT_THRESHOLD: 0.99,
    GOAL_RESONANCE: 0.99, FAST_MODE_DEFAULT_DROP: true, MAX_POINTERS: 100,
  })
  const t0 = 1_000_000

  s.offer({ text: 'glob glob glob glob', cues: ['glob'], source: 'human', now: t0 })
  let r = s.settle({ now: t0 + 60_000 })
  assert.equal(r.captured.length, 0, '只在一个 offer 里出现 → 不构成"它又出现了"')


  s.offer({ text: 'need another glob here', cues: ['glob'], source: 'human', now: t0 + 120_000 })
  r = s.settle({ now: t0 + 180_000 })
  assert.equal(r.captured.length, 2, '跨 offer 重现应让两条候选都命中')
  assert.ok(r.captured.every((c) => c.why.repeat), '命中原因应含 repeat')
})

test('★ 豁免：项目名段段出现是正常的，不能因为"到处都是"就被判成噪声', () => {
  const s = new StagingArea({
    TTL_HOURS: 24, REPEAT_THRESHOLD: 2, AFFECT_THRESHOLD: 0.99,
    GOAL_RESONANCE: 0.99, FAST_MODE_DEFAULT_DROP: true, MAX_POINTERS: 100,
  })
  const t0 = 1_000_000
  for (let i = 0; i < 5; i++) {
    s.offer({
      text: `DemoStudio 的第 ${i} 个改动`,
      cues: ['DemoStudio', 'demostudio'],
      entities: ['DemoStudio'],
      source: 'human',
      now: t0 + i * 1000,
    })
  }
  assert.equal(s.isBackgroundNoise('DemoStudio'), false, '实体名 / 已知词表必须豁免噪声判定')
  const r = s.settle({ now: t0 + 60_000 })
  assert.ok(r.captured.length >= 1, '被豁免的线索照常走重复通道')
})

test('★ 目标线索（通道③）也要过噪声筛，否则"与目标相关"会变成恒真', () => {
  const s = new StagingArea({
    TTL_HOURS: 24, REPEAT_THRESHOLD: 99, AFFECT_THRESHOLD: 0.99,
    GOAL_RESONANCE: 0.3, FAST_MODE_DEFAULT_DROP: true, MAX_POINTERS: 100,
  })
  const t0 = 1_000_000
  for (let i = 0; i < 5; i++) s.offer({ text: `noise ${i}`, cues: ['the', 'let'], now: t0 + i * 1000 })
  s.offer({ text: '真正的候选：达芬奇的渲染脚本', cues: ['the', 'let'], now: t0 + 9000 })

  const r = s.settle({ now: t0 + 60_000, goalCues: ['the', 'let'] })
  assert.equal(r.captured.length, 0, '目标面被筛空后通道③ 不该命中')
})


test('★ 中文实义名词能被抽出来（不再只有拉丁词 [2k] 一条）', () => {


  const q = extractZhWords('渲染农场的代号是什么？只回答这一项。')
  assert.ok(q.includes('渲染农场'), `应含「渲染农场」，实际 ${q}`)
  assert.ok(q.includes('代号'), `应含「代号」，实际 ${q}`)

  const w = extractZhWords('我们的渲染农场只有 3 台机器，代号 DEMO-1003。')
  assert.ok(w.includes('渲染农场'), `写入侧应含「渲染农场」，实际 ${w}`)
  assert.ok(w.includes('代号'), `写入侧应含「代号」，实际 ${w}`)
})

test('中文虚词与泛用动词被剥掉，不产生垃圾线索', () => {
  const out = extractZhWords('我们定过的素材规格是什么？只回答规格。')
  assert.ok(out.includes('素材规格'), `应含「素材规格」，实际 ${out}`)
  assert.ok(!out.some((w) => w.includes('们定') || w.includes('定过')), `不该有「们定/定过」残片，实际 ${out}`)

  assert.ok(out.every((w) => w.length >= 2), `不该有单字线索，实际 ${out}`)
})

test('中文抽取不吞拉丁词与专名（多路并存，各管一摊）', () => {

  const out = extractZhWords('外置 USB4 SSD 必备，素材和渲染缓存都放外置盘。')
  assert.ok(out.includes('渲染缓存'), `应含「渲染缓存」，实际 ${out}`)
  assert.ok(out.includes('外置'), `应含「外置」，实际 ${out}`)
})

test('★ 长黏连段不滑切出跨词噪声残片（泡排/个冒/染农这类假词）', () => {


  const out = extractZhWords('帮我写个冒泡排序')
  assert.ok(out.includes('冒泡排序'), `应含「冒泡排序」整段，实际 ${out}`)
  assert.ok(!out.includes('泡排') && !out.includes('个冒'), `不该有跨词残片「泡排/个冒」，实际 ${out}`)

  const out2 = extractZhWords('达芬奇免费版有没有语音转文字？')
  assert.ok(!out2.some((w) => ['奇免', '费版', '版有'].includes(w)), `不该有跨词残片，实际 ${out2}`)
})
