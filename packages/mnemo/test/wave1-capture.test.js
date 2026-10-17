


import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  StagingArea,
  SOURCE,
  STAGING_DEFAULTS,
  filterOptedOutClauses,
  isAutoEntityExempt,
} from '../lib/staging.js'
import {extractCueTokens, detectDecisions, isDecisionText} from '../lib/decisions.js'

const CFG = {
  TTL_HOURS: 24,
  REPEAT_THRESHOLD: 2,
  AFFECT_THRESHOLD: 0.99,
  GOAL_RESONANCE: 0.99,
  FAST_MODE_DEFAULT_DROP: true,
  MAX_POINTERS: 100,
}
const T0 = 1_000_000


test('items: 字母数字规格能被抽成线索（旧实现整类漏掉）', () => {


  const text = '用 2K，不要 4K；端口 8443；代号 DEMO-1000；鉴权用 JWT；文件 sample_module.cpp'
  const cues = extractCueTokens(text)
  for (const wanted of ['2k', '4k', 'demo-1000', 'jwt', 'sample_module.cpp']) {
    assert.ok(cues.includes(wanted), `应抽到 ${wanted}，实际 ${cues.join(', ')}`)
  }
  assert.ok(extractCueTokens('我们只做 1080p/2K').includes('1080p'), '1080p 必须能抽到')

  assert.equal(cues.includes('8443'), false, '纯数字不该进线索表')
  assert.ok(!extractCueTokens('8443').length)

  const many = extractCueTokens(Array.from({length: 40}, (_, i) => `tok${i}name`).join(' '))
  assert.ok(many.length <= 16, `线索数应封顶 16，实际 ${many.length}`)
  assert.equal(new Set(many).size, many.length, '不得重复')
})

test('items: detectDecisions 命中五类决策/约束', () => {
  const neg = detectDecisions('用 2K，不要 4K')
  assert.ok(neg.some((d) => d.kind === 'negative' && d.value === '4k'), JSON.stringify(neg))
  assert.ok(neg.some((d) => d.kind === 'spec' && d.value === '2k'), JSON.stringify(neg))

  const only = detectDecisions('我们只做 1080p/2K，永远不用 4K')
  assert.ok(only.some((d) => d.kind === 'spec' && d.value === '1080p'), JSON.stringify(only))
  assert.ok(only.some((d) => d.kind === 'negative' && d.value === '4k'), JSON.stringify(only))

  const port = detectDecisions('端口改成 8443')
  assert.equal(port.length, 1)
  assert.deepEqual(port[0], {kind: 'spec', value: '8443', raw: '端口改成 8443'})

  const allow = detectDecisions('只允许发生产')
  assert.ok(allow.some((d) => d.kind === 'constraint' || d.kind === 'imperative'), JSON.stringify(allow))

  const focus = detectDecisions('优先保证 2K 画质')
  assert.ok(focus.some((d) => d.kind === 'focus'), JSON.stringify(focus))

  assert.equal(isDecisionText('用 2K，不要 4K'), true)

  assert.equal(isDecisionText('orchard pending project preference'), false)
  assert.equal(isDecisionText('support the build'), false)
  assert.equal(isDecisionText('随便聊聊天气'), false)
})


test('D1: 同一轮「人类原话 + agent 复述」只产生一条持久记忆，回声被标记', () => {
  const s = new StagingArea(CFG)
  s.offer({text: '用 2K，不要 4K', cues: ['2k', '4k'], scope: 'p', source: SOURCE.HUMAN, now: T0})

  s.offer({text: '好的，按 2K 来', cues: ['2k'], scope: 'p', source: SOURCE.AGENT, now: T0 + 500})

  const captured = []
  const r = s.settle({now: T0 + 1000, onCapture: (e) => captured.push(e)})

  assert.equal(captured.length, 1, `只该有一条持久记忆，实际 ${captured.length}`)
  assert.equal(r.captured.length, 1)
  assert.equal(r.captured[0].source, SOURCE.HUMAN, '留下的应该是人类那条')
  assert.equal(r.echo.length, 1, 'agent 复述必须单独归入 echo')
  assert.equal(r.echo[0].echo, true, '回声条目的 echo 标记必须为 true')
  assert.equal(r.echo[0].source, SOURCE.AGENT)
  assert.equal(r.deduped.length, 1, '回声同时也是去重结果')
  assert.equal(s.pending.length, 0, '两条都已被结算消费')
})

test('D1: 同一 turn + 同一来源的两条不构成「重现」（自身不再自满足）', () => {
  const s = new StagingArea(CFG)

  s.load({
    pending: [
      {id: 'a', text: 'alpha one', cues: ['zzc'], scope: 'p', source: 'human', affect: 0, repeats: 1, firstSeen: T0, lastSeen: T0, decisions: []},
      {id: 'b', text: 'alpha two', cues: ['zzc'], scope: 'p', source: 'human', affect: 0, repeats: 1, firstSeen: T0, lastSeen: T0, decisions: []},
    ],
    pointers: [], cueCount: [], cueDoc: [], cueLastOffer: [], cueProtected: [],
    offerSeq: 2, captureKeys: [], scopeStats: [['p', {offers: 2, count: [], doc: [], protected: []}]],
  })
  const r = s.settle({now: T0 + 1000})
  assert.equal(r.captured.length, 0, '同一 turn/来源的两条不能互相凑成「重现」')
  assert.equal(r.kept, 2)
})

test('D1: 跨 turn 的重现仍然照常命中', () => {
  const s = new StagingArea(CFG)
  s.offer({text: 'orchard first', cues: ['orchard'], scope: 'p', source: SOURCE.HUMAN, now: T0})
  s.offer({text: 'orchard second', cues: ['orchard'], scope: 'p', source: SOURCE.HUMAN, now: T0 + 60_000})
  const r = s.settle({now: T0 + 120_000})
  assert.equal(r.captured.length, 2, '跨 offer 重现应让两条都命中')
  assert.ok(r.captured.every((e) => e.why.repeat))
})

test('D1: agent 说出人类没说的新内容时不误判成回声', () => {
  const s = new StagingArea(CFG)
  s.offer({text: '用 2K', cues: ['2k'], scope: 'p', source: SOURCE.HUMAN, now: T0})
  s.offer({text: '另外端口改成 8443，别用 5000', cues: [], scope: 'p', source: SOURCE.AGENT, now: T0 + 500})
  const r = s.settle({now: T0 + 1000})
  assert.equal(r.echo.length, 0, 'agent 补充了新规格，不是回声')
  assert.ok(r.captured.some((e) => e.source === SOURCE.AGENT), 'agent 的新规格应被捕获')
})


test('D2: `用 2K，不要 4K` 抽不出线索，但经决策通道被捕获', () => {
  const s = new StagingArea(CFG)

  const {entry} = s.offer({text: '用 2K，不要 4K', cues: [], scope: 'p', source: SOURCE.HUMAN, now: T0})
  assert.ok(entry.decisions.length >= 2, '条目必须带上决策列表（spec + negative）')
  const r = s.settle({now: T0 + 1000})
  assert.equal(r.captured.length, 1, '规格/否定语句必须能被捕获')
  assert.equal(r.captured[0].channel, 'decision')
  assert.equal(r.decision.length, 1)
  assert.equal(r.captured[0].why.decision, true)
})


test('D3: 噪声判定是滚动窗口，不再被项目生命周期稀释', () => {
  assert.equal(STAGING_DEFAULTS.WINDOW_OFFERS, 100, 'WINDOW_OFFERS 默认值必须存在')
  const s = new StagingArea(CFG)

  for (let i = 0; i < 4; i++) s.offer({text: `a the ${i}`, cues: ['the'], scope: 'p', now: T0 + i * 1000})
  assert.equal(s.isBackgroundNoise('the', 'p'), true, '4/4 必须是噪声')


  for (let i = 0; i < 100; i++) s.offer({text: `x ${i}`, cues: ['c' + i], scope: 'p', now: T0 + 10_000 + i * 1000})
  assert.equal(s.isBackgroundNoise('the', 'p'), false, '窗口滚过后旧统计必须清空')


  for (let i = 0; i < 4; i++) s.offer({text: `b the ${i}`, cues: ['the'], scope: 'p', now: T0 + 200_000 + i * 1000})
  assert.equal(s.isBackgroundNoise('the', 'p'), true, '新鲜窗口里 4/4 仍应判噪声')
})


test('D4: 已知词表（knownCues）里的中文项目词豁免噪声判定', () => {
  const cue = '渲染农场'
  const s = new StagingArea(CFG)
  for (let i = 0; i < 10; i++) {
    s.offer({text: `${cue} 的第 ${i} 个改动`, cues: [cue], knownCues: [cue], scope: 'p', now: T0 + i * 1000})
  }
  assert.equal(s.isBackgroundNoise(cue, 'p'), false, '显式 known cue 必须豁免')


  const s2 = new StagingArea(CFG)
  for (let i = 0; i < 10; i++) {
    s2.offer({text: `${cue} 的第 ${i} 个改动`, cues: [cue], scope: 'p', now: T0 + i * 1000})
  }
  assert.equal(s2.isBackgroundNoise(cue, 'p'), true, '没有显式词表时中文项目词会被判噪声')
})

test('D4: 句首大写拉丁词不再被当成永久豁免的实体', () => {
  assert.equal(isAutoEntityExempt('bash'), false)
  assert.equal(isAutoEntityExempt('read'), false)
  assert.equal(isAutoEntityExempt('now'), false)
  assert.equal(isAutoEntityExempt('DemoStudio'), true)
  assert.equal(isAutoEntityExempt('DEMO-1000'), true)
  assert.equal(isAutoEntityExempt('渲染农场'), true)

  const s = new StagingArea(CFG)
  for (let i = 0; i < 5; i++) {
    s.offer({text: `Bash step ${i}`, cues: ['bash'], entities: ['Bash'], scope: 'p', now: T0 + i * 1000})
  }
  assert.equal(s.isBackgroundNoise('bash', 'p'), true, '短拉丁实体不再自动豁免')
})


test('D5: 整轮禁记整轮丢弃；局部排除只丢被排除的子句（R1-02）', () => {

  const r = filterOptedOutClauses('我们把端口改成 8443，本轮不要写入记忆。')
  assert.equal(r.dropped, true)
  assert.equal(r.wholeTurn, true, '应识别为整轮禁记')
  assert.equal(r.text, '', `整轮禁记必须整轮丢弃，实际 ${JSON.stringify(r.text)}`)


  const partial = filterOptedOutClauses('请记住素材只做 2K。另外不要记录到记忆里。')
  assert.equal(partial.dropped, true)
  assert.equal(partial.wholeTurn, false, '非整轮词 → 局部排除')
  assert.ok(partial.text.includes('2K'), `save 子句必须保留，实际 ${JSON.stringify(partial.text)}`)
  assert.ok(!partial.text.includes('不要记录'), 'opt-out 子句应被丢掉')


  const keep = filterOptedOutClauses('解释一下“不要写入记忆”这句话是什么意思')
  assert.equal(keep.dropped, false)
  assert.equal(keep.wholeTurn, false)
  assert.equal(keep.text, '解释一下“不要写入记忆”这句话是什么意思')


  const remember = filterOptedOutClauses('不要忘记把这个偏好保存到长期记忆')
  assert.equal(remember.dropped, false)
  assert.equal(remember.wholeTurn, false)


  assert.deepEqual(filterOptedOutClauses(undefined), {text: '', dropped: false, wholeTurn: false})
  assert.deepEqual(filterOptedOutClauses(null), {text: '', dropped: false, wholeTurn: false})
  assert.deepEqual(filterOptedOutClauses(''), {text: '', dropped: false, wholeTurn: false})
})


test('settle 保留旧字段并新增 decision/echo/deduped，条目带 channel 与 echo', () => {
  const s = new StagingArea(CFG)
  s.offer({text: 'orchard kept', cues: ['orchard'], scope: 'p', source: SOURCE.HUMAN, now: T0})
  const r = s.settle({now: T0 + 1000})
  for (const key of ['captured', 'dropped', 'kept', 'noised', 'noisedEntries', 'decision', 'echo', 'deduped']) {
    assert.ok(key in r, `settle 返回值必须含 ${key}`)
  }
  assert.ok(Array.isArray(r.decision) && Array.isArray(r.echo) && Array.isArray(r.deduped))
  const keptEntry = s.pending[0]
  assert.ok('channel' in keptEntry, '条目必须带 channel 字段')
  assert.ok('echo' in keptEntry, '条目必须带 echo 字段')
  assert.equal(keptEntry.echo, false)
})
