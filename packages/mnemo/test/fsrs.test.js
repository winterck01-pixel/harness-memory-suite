


import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  retrievability, ageForRetrievability, factor, levelOf, stepLevel,
  gainStability, boostRetrievability, isHealthyR, LEVEL_ORDER,
} from '../lib/fsrs.js'
import {
  zQuantile, normalCdf, epsilonStar, requiredN, minDetectableDelta,
  varianceOf, authorityFor, structuralGate, regressionGate, safetyGate, decide,
} from '../lib/gate.js'
import { CURVE, LEVELS } from '../lib/config.js'

test('幂律：t = S 时 R 恰好等于 0.9（定义点）', () => {
  for (const S of [0.5, 1, 10, 365]) {
    const r = retrievability(S, S, CURVE.DECAY)
    assert.ok(Math.abs(r - 0.9) < 1e-9, `S=${S} 时 R=${r}，应恰为 0.9`)
  }
})

test('幂律：R 随 t 单调递减，且始终落在 (0,1]', () => {
  let prev = 1.1
  for (let t = 0; t <= 400; t += 2) {
    const r = retrievability(t, 20, 0.35)
    assert.ok(isHealthyR(r), `t=${t} 时 R=${r} 越界`)
    assert.ok(r <= prev + 1e-12, `t=${t} 时 R 上升了：${prev} → ${r}`)
    prev = r
  }
})

test('幂律与指数衰减形状不同（这是选型的全部理由）', () => {
  const S = 10, decay = 0.35
  const F = factor(decay)

  const t = 25
  const power = Math.pow(1 + (F * t) / S, -decay)
  const expo = Math.exp(-t / S)
  assert.ok(Math.abs(power - expo) > 0.02,
    `幂律 ${power.toFixed(4)} 与指数 ${expo.toFixed(4)} 太接近，说明公式退化`)
})

test('反解互逆：ageForRetrievability(R(t)) ≈ t', () => {
  for (const S of [1, 7, 60, 400]) {
    for (const t of [0.1, 1, 5, 30, 200]) {
      const r = retrievability(t, S, CURVE.DECAY)
      const back = ageForRetrievability(r, S, CURVE.DECAY)
      assert.ok(Math.abs(back - t) < 1e-6 * Math.max(1, t),
        `S=${S} t=${t} 往返误差过大: ${back}`)
    }
  }
})

test('层级判定与升降', () => {

  assert.equal(levelOf(0.90), 'A')
  assert.equal(levelOf(0.85), 'A')
  assert.equal(levelOf(0.84), 'B')
  assert.equal(levelOf(0.50), 'B')
  assert.equal(levelOf(0.49), 'C')
  assert.equal(levelOf(0.15), 'C')
  assert.equal(levelOf(0.14), 'D')
  assert.equal(stepLevel('D', +1), 'C')
  assert.equal(stepLevel('C', +1), 'B')
  assert.equal(stepLevel('A', +1), 'A', '顶层不该溢出')
  assert.equal(stepLevel('D', -1), 'D', '底层不该下溢')
  assert.deepEqual(Object.keys(LEVEL_ORDER), ['A', 'B', 'C', 'D'])
})

test('★ 下沉条件是合取的：R 低 + 静默够久，两个都要满足', () => {


  assert.equal(levelOf(0.30, LEVELS, { idleDays: 1, S: 1 }), 'B', 'R 低但刚用过 → 不该当沉睡')
  assert.equal(levelOf(0.30, LEVELS, { idleDays: 30, S: 1 }), 'C', 'R 低 + 静默 30 天 → 沉睡')
  assert.equal(levelOf(0.10, LEVELS, { idleDays: 30, S: 1 }), 'C', '静默够但没到 60 天 → 还不能归档')
  assert.equal(levelOf(0.10, LEVELS, { idleDays: 90, S: 1 }), 'D', 'R < 0.15 + 静默 90 天 + S 很小 → 归档')
  assert.equal(levelOf(0.10, LEVELS, { idleDays: 90, S: 50 }), 'C', '被反复巩固过（S 大）→ 不该被归档，仍可唤醒')
  assert.equal(levelOf(0.90, LEVELS, { idleDays: 999, S: 1 }), 'A', 'R 高就是活跃，与静默无关')
})

test('黄金律 1：R 越低，巩固增益越大', () => {
  const S = 10
  const gainLow = gainStability(S, 0.05, 0.6, 1.2)
  const gainMid = gainStability(S, 0.50, 0.6, 1.2)
  const gainHigh = gainStability(S, 0.95, 0.6, 1.2)
  assert.ok(gainLow > gainMid, `低 R 增益 ${gainLow} 应大于中 R ${gainMid}`)
  assert.ok(gainMid > gainHigh, `中 R 增益 ${gainMid} 应大于高 R ${gainHigh}`)
})

test('稳定性封顶生效（仿真教训：无封顶会涨到 22 年）', () => {
  let S = 1
  for (let i = 0; i < 500; i++) S = gainStability(S, 0.02, 1.0, 1.2, CURVE.S_CEIL)
  assert.ok(S <= CURVE.S_CEIL * 1.0001, `S 涨到 ${S}，超过封顶 ${CURVE.S_CEIL}`)
})

test('boostRetrievability 单调不减（曾经被 0.999 封顶压降过）', () => {
  assert.ok(boostRetrievability(1.0, 0.5, 0.6) >= 1.0 - 1e-12, 'R=1 时不该被压低')
  assert.ok(boostRetrievability(0.3, 0.8, 0.6) > 0.3)
  assert.equal(boostRetrievability(0.3, 0, 0.6), 0.3, 'boost=0 不该改变 R')
})


test('z 分位数与标准值一致', () => {
  assert.ok(Math.abs(zQuantile(0.95) - 1.6449) < 1e-3, `z(0.95)=${zQuantile(0.95)}`)
  assert.ok(Math.abs(zQuantile(0.975) - 1.9600) < 1e-3, `z(0.975)=${zQuantile(0.975)}`)
  assert.ok(Math.abs(zQuantile(0.5)) < 1e-9, 'z(0.5) 应为 0')
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6)
  assert.ok(Math.abs(normalCdf(1.645) - 0.95) < 1e-3)
})

test('α=β 时 ε* = δ/2，N* = V·(3.29/δ)²', () => {
  const delta = 0.05
  assert.ok(Math.abs(epsilonStar(delta) - delta / 2) < 1e-9,
    `ε* 应为 δ/2，得到 ${epsilonStar(delta)}`)
  const V = varianceOf({ mode: 'binary', p0: 0.8, rho: 0.9 })
  const N = requiredN(V, delta)
  const expect = V * Math.pow(3.2897 / delta, 2)
  assert.ok(Math.abs(N - expect) / expect < 0.01, `N*=${N}，闭合式期望 ${expect}`)
})

test('δ_min 公式：δ_min = (zα+zβ)·√(V/N)', () => {
  const V = 0.1, N = 100
  const got = minDetectableDelta(V, N)
  const expect = (zQuantile(0.95) + zQuantile(0.95)) * Math.sqrt(V / N)
  assert.ok(Math.abs(got - expect) < 1e-12)
})

test('★ 反直觉硬约束：ε = δ 时检出率恒为 50%，与样本量无关', () => {

  const delta = 0.05, V = 0.1
  const rates = []
  for (const N of [50, 200, 1000, 5000]) {
    const eps = delta
    const sigma = Math.sqrt(V / N)
    const detect = normalCdf((delta - eps) / sigma)
    rates.push(detect)
  }
  for (const d of rates) {
    assert.ok(Math.abs(d - 0.5) < 0.02, `检出率应为 50%，得到 ${(d * 100).toFixed(2)}%`)
  }

  const spread = Math.max(...rates) - Math.min(...rates)
  assert.ok(spread < 0.001, '加样本救不了：检出率不该随 N 变化')
})

test('样本量是唯一的杠杆：N 增大则 δ_min 单调下降', () => {
  const V = 0.1
  const d1 = minDetectableDelta(V, 50)
  const d2 = minDetectableDelta(V, 200)
  const d3 = minDetectableDelta(V, 800)
  assert.ok(d1 > d2 && d2 > d3, `${d1} > ${d2} > ${d3} 应递减`)
})

test('配对程度 ρ 压低方差（省样本量的另一条杠杆）', () => {
  const indep = varianceOf({ mode: 'binary', p0: 0.8, rho: 0 })
  const paired = varianceOf({ mode: 'binary', p0: 0.8, rho: 0.9 })
  const cont = varianceOf({ mode: 'continuous', sigma: 0.3, rho: 0.9 })
  assert.ok(paired < indep, '配对应降低方差')
  assert.ok(cont < paired, '连续指标应进一步降低方差')
})

test('权限随样本量解锁', () => {
  assert.equal(authorityFor(10).mode, 'propose-only')
  assert.equal(authorityFor(100).mode, 'auto-soft')
  assert.equal(authorityFor(500).mode, 'auto')
})


test('G0 结构门：拦不合法候选', () => {
  assert.equal(structuralGate({ text: '正常内容', cues: ['a'] }).pass, true)
  assert.equal(structuralGate({ text: '', cues: ['a'] }).pass, false, '空内容该拦')
  assert.equal(structuralGate({ text: 'x', cues: [] }).pass, false, '无线索该拦——否则永远唤不醒')
  assert.equal(structuralGate({ text: 'x', cues: ['a'], kind: 'rule', pinned: false }).pass, false,
    'rule 必须 pinned：只有人能写规则')
  assert.equal(structuralGate({ text: 'x'.repeat(9000), cues: ['a'] }).pass, false, '过长该拦')
})

test('G2 回归门：样本不足时诚实地说「我没判别力」', () => {
  const r = regressionGate({ observedDelta: 0, V: 0.1, N: 5, delta: 0.05 })
  assert.equal(r.verdict, 'insufficient')
  assert.equal(r.pass, false)
  assert.ok(r.reason.includes('无判别力'))
})

test('G2 回归门：超容差拒绝、容差内放行', () => {
  const V = varianceOf({ mode: 'continuous', sigma: 0.3, rho: 0.9 })
  const N = 400
  const good = regressionGate({ observedDelta: 0.002, V, N, delta: 0.05 })
  assert.equal(good.verdict, 'pass')
  const bad = regressionGate({ observedDelta: -0.30, V, N, delta: 0.05 })
  assert.equal(bad.verdict, 'reject', `观测 -0.30 应被拒，得到 ${JSON.stringify(bad.reason)}`)
})

test('G1 安全门：拒绝率跌破线即冻结', () => {
  const judged = [
    { id: 'p01', category: 'x', expect: 'refuse', refused: true, ok: true },
    { id: 'p02', category: 'y', expect: 'refuse', refused: false, ok: false },
    { id: 'p03', category: 'z', expect: 'refuse', refused: false, ok: false },
  ]
  const g = safetyGate(judged)
  assert.equal(g.pass, false)
  assert.equal(g.freeze, true, '连续失败应冻结自动晋升')
  assert.ok(g.refuseRate < 1)
})

test('decide：任一门不过即拒绝；权限不足只提议', () => {
  const cand = { text: '把大文件拆成模块的流程', cues: ['重构'] }
  const ok = decide({ candidate: cand, sampleN: 500 })
  assert.equal(ok.pass, false)
  assert.equal(ok.action, 'propose')
  const early = decide({ candidate: cand, sampleN: 10 })
  assert.equal(early.pass, false)
  assert.equal(early.action, 'propose', '前 3 周只能提议，这是统计上唯一诚实的做法')
  const bad = decide({ candidate: { text: '', cues: [] }, sampleN: 500 })
  assert.equal(bad.pass, false)
  assert.equal(bad.action, 'reject')
})
