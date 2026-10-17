


import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  retrieve,
  signalScore,
  sourceWeight,
  pointerCandidates,
  assertPartsInRange,
} from '../lib/retrieve.js'
import { RETRIEVE } from '../lib/config.js'


test('D11: 单路线索命中不再被 prior 白送分顶掉（JWT 反例回归）', () => {
  const jwt = {
    id: 'm-jwt',
    text: '登录接口用 JWT 做鉴权，token 放在 Authorization 头里',
    cues: ['登录', 'jwt', 'token', '接口'],
    entities: [],
    source: 'human',
    trust: 'reported',
    pinned: false,
  }

  const hits = retrieve({
    cues: ['重构', '登录', '模块'],
    entities: [],
    text: '帮我重构一下登录模块',
    candidates: [jwt],
    priorOf: () => 1.0,
    cfg: { ...RETRIEVE },
  })

  assert.equal(hits.length, 1, 'JWT 记忆必须被捞回，不能因 MIN_SCORE 被丢')
  assert.equal(hits[0].item.id, 'm-jwt')

  const p = hits[0].parts

  assert.ok(Math.abs(p.cue - 0.2388) < 0.01, `cue≈0.239，实际 ${p.cue}`)
  assert.equal(p.entity, 0)
  assert.equal(p.prior, 1)


  const oldScore = RETRIEVE.R_CUE * p.cue + RETRIEVE.R_ENTITY * p.entity +
    RETRIEVE.R_LEXICAL * p.lexical + RETRIEVE.R_PRIOR * p.prior
  assert.ok(oldScore < RETRIEVE.MIN_SCORE, `旧总分 ${oldScore} 应低于 MIN_SCORE ${RETRIEVE.MIN_SCORE}`)


  assert.ok(p.signal >= 0.18, `signal=${p.signal} 应 ≥ 0.18`)
})


test('D12: 同等相关的真人陈述压过 agent 自述', () => {
  const base = { text: '部署流程要先跑迁移脚本', cues: ['部署', '迁移', '脚本'], entities: [] }
  const human = { ...base, id: 'h', source: 'human', trust: 'reported' }
  const agent = { ...base, id: 'a', source: 'agent', trust: 'unverified' }

  const hits = retrieve({
    cues: ['部署', '迁移', '脚本'],
    entities: [],
    text: '部署流程要先跑迁移脚本',
    candidates: [agent, human],
    priorOf: () => 0.5,
    cfg: { ...RETRIEVE },
  })

  assert.equal(hits.length, 2, '两条同等相关，都应准入')
  assert.equal(hits[0].item.id, 'h', 'human 应排第一')
  assert.ok(hits[0].score > hits[1].score, 'human 总分应更高')
  assert.ok(hits[0].parts.trust > hits[1].parts.trust, 'trust 分量应体现来源差异')
  assert.equal(hits[0].parts.trust, 1.0)
  assert.equal(hits[1].parts.trust, 0.55)
})


test('pinned rule 恒为 1 分且无条件准入', () => {
  const rule = {
    id: 'r1', text: '永远不要删 .workspace-state', cues: ['规则'], entities: [],
    pinned: true, kind: 'rule', source: 'human', trust: 'confirmed',
  }
  const hits = retrieve({
    cues: ['完全无关的词'], entities: [], text: '随便聊聊',
    candidates: [rule], priorOf: () => 0, cfg: { ...RETRIEVE },
  })
  assert.equal(hits.length, 1, 'pinned 规则必须命中')
  assert.equal(hits[0].score, 1)
  assert.equal(hits[0].parts.pinned, true)
  assert.equal(hits[0].parts.signal, 1)
  assertPartsInRange(hits[0].parts)
})


test('D18: 指针只在真记忆落空时兜底，且永不超过真命中', () => {
  const pointers = [{
    topic: '部署流程要先跑迁移脚本', at: Date.now(), scope: 'p',
    cues: ['部署', '迁移', '脚本'], source: 'agent',
  }]
  const real = {
    id: 'real', text: '部署流程要先跑迁移脚本', cues: ['部署', '迁移', '脚本'],
    entities: [], source: 'agent', trust: 'unverified', scope: 'p',
  }
  const q = { cues: ['部署', '迁移', '脚本'], entities: [], text: '部署流程要先跑迁移脚本', cfg: { ...RETRIEVE, TOP_K: 8 } }

  const hits = retrieve({ ...q, candidates: [real], priorOf: () => 0.5 })
  assert.equal(hits.length, 1, '真记忆应命中')

  const leads = pointerCandidates(pointers, { scope: 'p', ...q })
  assert.equal(leads.length, 1, '指针必须可被检索到（不再是空承诺）')
  assert.equal(leads[0].pointer, true)
  assert.equal(leads[0].parts.pointer, true)
  assert.equal(leads[0].item.trust, 'unverified')
  assert.ok(leads[0].score < hits[0].score,
    `指针 ${leads[0].score} 必须严格低于真记忆 ${hits[0].score}`)


  const recall = (realHits, ptrLeads) => (realHits.length ? realHits : ptrLeads)
  assert.equal(recall(hits, leads)[0].item.id, 'real')
  assert.equal(recall(hits, leads)[0].pointer, undefined)

  const empty = retrieve({ ...q, candidates: [], priorOf: () => 0 })
  assert.equal(empty.length, 0, '没有真记忆时 retrieve 为空')
  assert.equal(recall(empty, leads)[0].pointer, true, '此时指针才作为线索出现')
})

test('pointerCandidates: null / 空 / 脏输入安全', () => {
  assert.deepEqual(pointerCandidates(null), [])
  assert.deepEqual(pointerCandidates(undefined), [])
  assert.deepEqual(pointerCandidates([]), [])
  assert.deepEqual(pointerCandidates([null, 0, 'x', {}]), [])
})

test('pointerCandidates: 伪条目形状正确，scope 过滤生效', () => {
  const out = pointerCandidates(
    [
      { topic: 'T', cues: ['t'], scope: 's', source: 'human', at: 123 },
      { topic: '别的作用域', cues: ['t'], scope: 'other', at: 124 },
    ],
    { scope: 's', cues: ['t'], entities: [], text: 't', cfg: { ...RETRIEVE } },
  )
  assert.equal(out.length, 1, 'scope 不匹配的指针应被过滤')
  assert.equal(out[0].item.id, 'pointer:123:0')
  assert.equal(out[0].item.text, 'T')
  assert.equal(out[0].item.trust, 'unverified')
  assert.equal(out[0].item.pointer, true)
  assert.equal(out[0].parts.pointer, true)
})


test('parts.signal ∈ [0,1]，六路分量齐全且 prior 被夹紧', () => {
  const items = [
    { id: 'x', text: '甲', cues: ['登录'], entities: ['e'], source: 'human', trust: 'confirmed' },
    { id: 'y', text: '乙', cues: [], entities: [], source: 'agent', trust: 'unverified' },
    { id: 'z', text: '丙', cues: ['登录', '登录'], entities: [], pinned: true, kind: 'rule' },
  ]
  const hits = retrieve({
    cues: ['登录', '登录', '登录'], entities: ['e'], text: '丙甲',
    candidates: items, priorOf: () => 2,
    cfg: { ...RETRIEVE },
  })
  assert.ok(hits.length >= 1)
  for (const h of hits) {
    for (const k of ['cue', 'entity', 'lexical', 'trust', 'prior', 'signal']) {
      assert.ok(k in h.parts, `parts 缺 ${k}`)
      assert.ok(h.parts[k] >= 0 && h.parts[k] <= 1, `${k}=${h.parts[k]} 越界`)
    }
    assertPartsInRange(h.parts)
  }
  const pinned = hits.find((h) => h.item.id === 'z')
  assert.ok(pinned, 'pinned 应命中')
  assert.equal(pinned.parts.prior, 1, '越界 prior 应夹紧到 1')

  const leads = pointerCandidates(
    [{ topic: '丙', cues: ['登录'], scope: 's', source: 'agent', at: 1 }],
    { scope: 's', cues: ['登录'], entities: [], text: '丙', cfg: { ...RETRIEVE } },
  )
  for (const l of leads) assertPartsInRange(l.parts)
})


test('sourceWeight: 来源/可信度映射，且永不返回 0', () => {
  assert.equal(sourceWeight({ source: 'human', trust: 'reported' }), 1.0)
  assert.equal(sourceWeight({ source: 'human', trust: 'confirmed' }), 1.0)
  assert.equal(sourceWeight({ source: 'human', trust: 'unverified' }), 0.85)
  assert.equal(sourceWeight({ source: 'agent', trust: 'confirmed' }), 0.95)
  assert.equal(sourceWeight({ source: 'agent', trust: 'reported' }), 0.8)
  assert.equal(sourceWeight({ source: 'agent', trust: 'unverified' }), 0.55)
  assert.equal(sourceWeight({}), 0.55)
  assert.ok(sourceWeight({ source: 'alien', trust: 'nonsense' }) >= 0.5)
  assert.ok(sourceWeight(null) >= 0.5)
  for (const item of [{}, null, { source: 'x' }, { trust: 'y' }]) {
    const w = sourceWeight(item)
    assert.ok(w >= 0.5 && w <= 1, `sourceWeight 越界: ${w}`)
  }
})

test('R_TRUST 缺省为 0.10（config 未定义该键时也生效）', () => {
  const item = { text: 'A', cues: ['a'], source: 'human', trust: 'reported' }
  const q = { cues: ['a'], entities: [], text: 'A', item }
  const implicit = signalScore(q)
  const explicit = signalScore({ ...q, cfg: { ...RETRIEVE, R_TRUST: 0.10 } })
  assert.ok(Math.abs(implicit.parts.signal - explicit.parts.signal) < 1e-12,
    '缺省 R_TRUST 的行为必须等于显式 0.10')
  const noTrust = signalScore({ ...q, cfg: { ...RETRIEVE, R_TRUST: 0 } })
  assert.equal(noTrust.parts.signal, implicit.parts.signal, 'trust 只影响排序，不能改变相关性准入')
  assert.ok(noTrust.score < implicit.score, 'trust 分量应真实影响排序')
  assert.equal(implicit.parts.trust, 1.0)
})
