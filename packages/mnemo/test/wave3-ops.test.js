


import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scopeReachable, scopeReport, migrationHint, scopePath } from '../lib/scopes.js'
import { gateReport, decide, authorityFor, requiredN, minDetectableDelta } from '../lib/gate.js'
import { GATE as GATE_CFG } from '../lib/config.js'


test('D17: project:<不存在路径> 判死，可达 scope 不误报；非 project scope 恒可达', () => {
  const exists = (p) => p === '/workspace/current/default'
  assert.equal(scopeReachable('project:/workspace/current/default', { exists }), true)
  assert.equal(scopeReachable('project:/workspace/legacy/projects/deepseek-harness', { exists }), false)

  assert.equal(scopeReachable('default', { exists: () => false }), true)
  assert.equal(scopeReachable('legacy', { exists: () => false }), true)

  assert.equal(scopeReachable('project:', { exists }), false)
  assert.equal(scopePath('project:/a/b'), '/a/b')
  assert.equal(scopePath('default'), null)
})

test('D17: scopeReport 按 scope 汇总，死条目计入 deadCount 而非被静默吞掉', () => {
  const alive = 'project:/workspace/current/default'
  const dead = 'project:/workspace/legacy/projects/deepseek-harness'
  const exists = (p) => p === '/workspace/current/default'
  const now = 2_000_000_000_000
  const items = [
    { id: 'a1', scope: alive, recordedAt: 1_000 },
    { id: 'a2', scope: alive, archived: true, recordedAt: 5_000 },
    { id: 'd1', scope: dead, recordedAt: 9_000 },
    { id: 'd2', scope: dead },
    { id: 'd3', scope: dead },
    { id: 'n1', scope: 'default' },
  ]
  const r = scopeReport(items, { exists, now })
  assert.equal(r.deadCount, 3, 'dead scope 的 3 条都要被计数')
  assert.equal(r.aliveCount, 3, '可达 scope（含 default）计入 alive')
  assert.deepEqual(r.deadScopes, [dead])
  const meta = r.byScope.find((g) => g.scope === dead)
  assert.equal(meta.total, 3)
  assert.equal(meta.reachable, false)
  assert.equal(meta.archived, 0)
  assert.equal(meta.lastSeenAt, 9_000)
  const live = r.byScope.find((g) => g.scope === alive)
  assert.equal(live.total, 2)
  assert.equal(live.reachable, true)
  assert.equal(live.archived, 1)
  assert.equal(live.lastSeenAt, 5_000)

  assert.ok(r.byScope.every((g) => g.lastSeenAt == null || g.lastSeenAt <= now))
})

test('D17: scopeReport 把未来时钟的 lastSeenAt 夹到 now，缺字段则为 null', () => {
  const exists = () => true
  const r = scopeReport([
    { scope: 'project:/x', recordedAt: 10 * 86_400_000 },
  ], { exists, now: 5_000 })
  assert.equal(r.byScope[0].lastSeenAt, 5_000)
  const r2 = scopeReport([{ scope: 'project:/x' }], { exists, now: 5_000 })
  assert.equal(r2.byScope[0].lastSeenAt, null)
})


test('D17: scopeReport 在 undefined / null / 空数组上安全且形状稳定', () => {
  for (const input of [undefined, null, []]) {
    const r = scopeReport(input)
    assert.deepEqual(r.byScope, [])
    assert.deepEqual(r.deadScopes, [])
    assert.equal(r.deadCount, 0)
    assert.equal(r.aliveCount, 0)
  }
})


test('D17: migrationHint 命中同名末段的 /home 目标；无匹配返回 null', () => {
  const dead = 'project:/workspace/legacy/projects/deepseek-harness'
  const hit = migrationHint(dead, {
    candidates: [
      'default',
      'project:/workspace/current/user/other-project',
      'project:/workspace/current/projects/deepseek-harness',
      'project:/workspace/current/projects/other',
    ],
  })
  assert.equal(hit.from, dead)
  assert.equal(hit.to, 'project:/workspace/current/projects/deepseek-harness')
  assert.equal(typeof hit.reason, 'string')
  assert.ok(hit.reason.length > 0)


  const shallow = migrationHint(dead, { candidates: ['project:/workspace/current/user/deepseek-harness'] })
  assert.equal(shallow.to, 'project:/workspace/current/user/deepseek-harness')


  const tie = migrationHint('project:/workspace/legacy/projects/deepseek-harness', {
    candidates: ['project:/workspace/old/ri/d/deepseek-harness', 'project:/workspace/short/deepseek-harness'],
  })
  assert.equal(tie.to, 'project:/workspace/short/deepseek-harness')


  const miss = migrationHint(dead, { candidates: ['project:/workspace/current/user/other', 'default'] })
  assert.equal(miss.to, null)
  assert.equal(miss.from, dead)
  assert.ok(miss.reason.length > 0)


  assert.equal(migrationHint('default', {}).to, null)
  assert.equal(migrationHint(dead, {}).to, null)
})


test('D15/D17: gateReport 零样本时报 propose-only、samplesNeeded>0 且明说无判别力', () => {
  const r = gateReport({ sampleN: 0, V: 0.032, delta: 0.10 })
  assert.equal(r.authority.mode, 'propose-only')
  assert.ok(r.samplesNeeded > 0, 'propose-only 阶段还差样本才解锁')
  assert.equal(r.nextTierAt, 60)
  assert.ok(r.requiredN > 0 && Number.isFinite(r.requiredN))
  assert.equal(r.detectableDelta, null, '无判别力时不用 Infinity 假装有数')
  assert.equal(r.discriminating, false)
  assert.equal(r.probes.ran, false)
  assert.equal(r.probes.pass, null)
  assert.match(r.note, /无判别力/)
  assert.deepEqual(r.tiers, GATE_CFG.TIERS)
})

test('D15/D17: gateReport 样本足够时报有限 detectableDelta，不再有下一档', () => {
  const r = gateReport({ sampleN: 200, V: 0.032, delta: 0.10 })
  assert.equal(r.discriminating, true)
  assert.equal(typeof r.detectableDelta, 'number')
  assert.ok(Number.isFinite(r.detectableDelta) && r.detectableDelta > 0)
  assert.equal(r.detectableDelta, minDetectableDelta(0.032, 200))
  assert.equal(r.nextTierAt, null)
  assert.equal(r.samplesNeeded, 0)
  assert.equal(r.authority.mode, 'auto')
  assert.match(r.note, /能检出/)


  const mid = gateReport({ sampleN: Math.ceil(requiredN(0.032, 0.10)), V: 0.032, delta: 0.10 })
  assert.equal(mid.discriminating, true)
  assert.equal(mid.authority.mode, 'propose-only', '此时权限仍只够提议')
  assert.ok(Number.isFinite(mid.detectableDelta))
})

test('D15: gateReport 如实报告探针是否真的跑过、是否通过', () => {
  const judged = [
    { id: 'p1', category: 'c', expect: 'refuse', refused: true, ok: true },
    { id: 'p2', category: 'c', expect: 'refuse', refused: true, ok: true },
    { id: 'p3', category: 'c', expect: 'refuse', refused: true, ok: true },
  ]
  const ok = gateReport({ sampleN: 10, V: 0.032, delta: 0.10, probeJudged: judged })
  assert.deepEqual(ok.probes, { ran: true, pass: true })
  const bad = gateReport({
    sampleN: 10, V: 0.032, delta: 0.10,
    probeJudged: [{ id: 'p1', category: 'c', expect: 'refuse', refused: false, ok: false }],
  })
  assert.deepEqual(bad.probes, { ran: true, pass: false })

  const noStats = gateReport({ sampleN: 100, probeJudged: judged })
  assert.equal(noStats.requiredN, null)
  assert.equal(noStats.detectableDelta, null)
  assert.equal(noStats.discriminating, false)
})


function passingEvidence() {
  return {
    probeJudged: [
      { id: 'p1', category: 'c', expect: 'refuse', refused: true, ok: true },
      { id: 'p2', category: 'c', expect: 'refuse', refused: true, ok: true },
      { id: 'p3', category: 'c', expect: 'refuse', refused: true, ok: true },
    ],
    regression: { observedDelta: 0, V: 0.032, N: 100, delta: 0.10 },
  }
}
const candidate = { text: '把登录模块的 JWT 校验抽成中间件', cues: ['登录', 'jwt'], kind: 'episode' }

test('D15: decide 缺探针证据或回归证据时仍 fail-safe 拒绝为 propose', () => {
  const base = passingEvidence()
  const missingProbe = decide({ candidate, probeJudged: null, regression: base.regression, sampleN: 500 })
  assert.equal(missingProbe.pass, false)
  assert.equal(missingProbe.action, 'propose')
  const emptyProbe = decide({ candidate, probeJudged: [], regression: base.regression, sampleN: 500 })
  assert.equal(emptyProbe.pass, false)
  assert.equal(emptyProbe.action, 'propose')
  const missingRegression = decide({ candidate, probeJudged: base.probeJudged, regression: null, sampleN: 500 })
  assert.equal(missingRegression.pass, false)
  assert.equal(missingRegression.action, 'propose')
  const nothing = decide({ candidate })
  assert.equal(nothing.pass, false)
  assert.equal(nothing.action, 'propose')
})

test('D15: decide 尊重传入的 sampleN —— 证据齐全时 propose-only 只能提议，够样本才晋升', () => {
  const ev = passingEvidence()
  const low = decide({ candidate, ...ev, sampleN: 0 })
  assert.equal(low.pass, true, '证据齐全时门本身通过')
  assert.equal(low.authority.mode, 'propose-only')
  assert.equal(low.action, 'propose')

  const high = decide({ candidate, ...ev, sampleN: 500 })
  assert.equal(high.pass, true)
  assert.equal(high.authority.mode, 'auto')
  assert.equal(high.action, 'promote')


  assert.notDeepEqual(low.authority, high.authority)
  assert.deepEqual(low.authority, authorityFor(0))
  assert.deepEqual(high.authority, authorityFor(500))
  assert.equal(GATE_CFG.FAIL_MODE, 'closed')
})
