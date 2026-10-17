


import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ModeRouter, SLOW_HOLD_TURNS, RECALL_INTENT_KEYWORDS } from '../lib/router.js'
import { ROUTER } from '../lib/config.js'
import {
  Injector, renderItem, compactMetadata, memoryMetadata, estimateTokens,
} from '../lib/inject.js'


test('D9: 明确要求回忆的输入升慢模式（关键词通道原本完全漏掉）', () => {

  const queries = [
    '我们之前定过的那个方案是什么来着',
    'do you remember what we decided earlier',
    '继续搞那个引用顺序，递归引用怎么排？',
  ]
  for (const text of queries) {
    const out = new ModeRouter(ROUTER).route({ text, session: 's1' })
    assert.equal(out.mode, 'slow', `应升慢模式：${text}`)
    assert.ok(
      out.triggers.some((t) => t.startsWith('recall_intent:')),
      `应由召回意图通道触发：${text} → ${JSON.stringify(out.triggers)}`,
    )

    assert.equal(out.surpriseHit, false, `召回意图不算意外：${text}`)
  }
})

test('D9: 召回意图关键词表包含中英两侧的核心说法', () => {
  for (const kw of ['记得', '之前', '上次', '继续', '定过', '约定了']) {

    assert.ok(RECALL_INTENT_KEYWORDS.some((k) => kw.includes(k)), `缺少中文关键词：${kw}`)
  }
  for (const kw of ['remember', 'recall', 'earlier', 'we decided', 'continue']) {
    assert.ok(RECALL_INTENT_KEYWORDS.includes(kw), `缺少英文关键词：${kw}`)
  }
})


test('D10(b): 拉丁关键词按词边界——preview 不命中 review，review 命中', () => {
  const preview = new ModeRouter(ROUTER).route({ text: 'can you preview the file', session: 'a' })
  assert.ok(
    !preview.triggers.some((t) => t === 'keyword:review'),
    `preview 不该命中 review：${JSON.stringify(preview.triggers)}`,
  )
  assert.equal(preview.mode, 'fast')

  const review = new ModeRouter(ROUTER).route({ text: 'can you review the file', session: 'b' })
  assert.ok(
    review.triggers.some((t) => t === 'keyword:review'),
    `review 应命中：${JSON.stringify(review.triggers)}`,
  )
  assert.equal(review.mode, 'slow')
})

test('D10(b): rendering 不命中 render，optimistic 不命中 optimi', () => {
  const rendering = new ModeRouter(ROUTER).route({ text: 'rendering pipeline tuning', session: 'a' })
  assert.ok(!rendering.triggers.some((t) => t.startsWith('keyword:')), `rendering 不该命中：${JSON.stringify(rendering.triggers)}`)
  const optimistic = new ModeRouter(ROUTER).route({ text: 'optimistic cache policy', session: 'b' })
  assert.ok(!optimistic.triggers.some((t) => t.startsWith('keyword:')), `optimistic 不该命中：${JSON.stringify(optimistic.triggers)}`)
})

test('D10(a): 粘滞有界——连续 SLOW_HOLD_TURNS 轮无召回需求后回落快模式', () => {
  const r = new ModeRouter(ROUTER)
  assert.equal(r.cfg.STICKY_WITHIN_SESSION, true, '本用例针对默认的会话内粘滞')


  assert.equal(r.route({ text: '帮我重构这个模块', session: 's1' }).mode, 'slow')


  for (let i = 0; i < SLOW_HOLD_TURNS; i++) {
    const out = r.route({ text: '好的，收到', affect: 0.5, session: 's1' })
    assert.equal(out.mode, 'slow', `第 ${i + 1} 轮仍在粘滞窗口内`)
    assert.equal(out.switched, false)
  }


  const out = r.route({ text: '好的，收到', affect: 0.5, session: 's1' })
  assert.equal(out.mode, 'fast', '粘滞必须有界，否则一次命中把整段闲聊都拖慢')
  assert.equal(out.switched, true)
  assert.equal(r.shouldInject(), false)
  assert.equal(r.sessionSticky, false)
})

test('D10(a): 粘滞窗口内再次出现召回需求会重新计数', () => {
  const r = new ModeRouter(ROUTER)
  r.route({ text: '帮我重构', session: 's1' })
  r.route({ text: '好的', affect: 0.5, session: 's1' })
  r.route({ text: '好的', affect: 0.5, session: 's1' })
  assert.equal(r.noTriggerStreak, 2)

  const back = r.route({ text: '上次那个方案呢', session: 's1' })
  assert.equal(back.mode, 'slow')
  assert.equal(r.noTriggerStreak, 0)

  for (let i = 0; i < SLOW_HOLD_TURNS; i++) r.route({ text: '好的', affect: 0.5, session: 's1' })
  assert.equal(r.route({ text: '好的', affect: 0.5, session: 's1' }).mode, 'fast')
})

test('D10(a): 粘滞仍然不跨会话', () => {
  const r = new ModeRouter(ROUTER)
  r.route({ text: '帮我重构', session: 's1' })
  assert.equal(r.route({ text: '你好呀', affect: 0.3, session: 's2' }).mode, 'fast')
})


const SPEC_ITEM = {
  id: 'm-36beebc3-7038-4f1e-8cae-68d297f3783f',
  source: 'human',
  trust: 'reported',
  scope: 'project:/workspace/current/default',
  touches: 24,
  text: '素材规格：只做 1080p 和 2K；交付容器固定 mp4。关键：DEMO-1000 编码器永远不要用，它会毁掉 2K 素材。',
  recordedAt: Date.now() - 86400000,
  evidence: [{ source: 'human', at: Date.now() - 86400000, timeZone: 'Asia/Shanghai' }],
}

test('D13(a): 注入路径用紧凑元数据，明显小于完整形式', () => {
  const full = estimateTokens(memoryMetadata(SPEC_ITEM))
  const compact = estimateTokens(compactMetadata(SPEC_ITEM))
  assert.ok(compact < full, `紧凑元数据应更小：${compact} vs ${full}`)
  assert.ok(compact <= full * 0.6, `应「materially smaller」：${compact} vs ${full}`)


  const meta = compactMetadata(SPEC_ITEM)
  assert.match(meta, /id=m-36beebc3/)
  assert.match(meta, /human\/reported/)
  assert.match(meta, /scope=project:\/workspace\/current\/default/)

  assert.ok(!meta.includes('referenceTime'))
  assert.ok(memoryMetadata(SPEC_ITEM).includes('referenceTime'))
})

test('D13(b): 规格记忆的关键代号 DEMO-1000 活着进注入文本（旧实现只剩残句）', () => {

  const qxAt = SPEC_ITEM.text.indexOf('DEMO-1000')
  assert.ok(qxAt > 28, `前置条件：代号在旧上限之后，实际 ${qxAt}`)

  const out = renderItem(SPEC_ITEM, 0.9)
  assert.equal(out.level, 'cue')
  assert.ok(out.text.includes('DEMO-1000'), `代号必须幸存：${out.text}`)
  assert.ok(out.text.includes('素材规格'), '正文片段仍在')

  assert.equal(out.tokens, estimateTokens(out.text))
  assert.equal(out.tokens, estimateTokens(out.text))
})

test('D13(c): 快照路径同样注入紧凑元数据，且代号幸存', () => {
  const inj = new Injector()
  const snap = inj.snapshot({ items: [{ item: SPEC_ITEM, r: 0.9 }] })
  assert.ok(snap.text.includes('DEMO-1000'), `快照应含代号：${snap.text}`)
  assert.ok(snap.text.includes('human/reported'), '紧凑元数据应保留来源/信任')

  assert.ok(!snap.text.includes('referenceBasis='), '时间证据不该出现在注入路径')
  assert.equal(snap.tokens, estimateTokens(snap.text))

  const composed = new Injector().compose({ items: [{ item: SPEC_ITEM, r: 0.9 }], force: true })
  assert.ok(composed.payload.includes('DEMO-1000'), 'compose 路径同样保留代号')
  assert.equal(composed.tokens, estimateTokens(composed.payload))
})

test('D13: 预算抬升不破坏详略排序', () => {

  const cue = renderItem({ ...SPEC_ITEM }, 0.9)
  const trigger = renderItem({ ...SPEC_ITEM }, 0.2)
  assert.equal(cue.level, 'cue')
  assert.equal(trigger.level, 'trigger')
  assert.ok(cue.tokens <= trigger.tokens, 'cue 条目不应比 trigger 条目更贵')
})
