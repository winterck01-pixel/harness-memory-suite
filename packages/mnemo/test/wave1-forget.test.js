


import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decayStability, archiveEligibility, retrievability } from '../lib/fsrs.js'
import { EventLog } from '../lib/store.js'
import { CURVE, FORGET } from '../lib/config.js'

const freshDir = () => mkdtempSync(join(tmpdir(), 'mnemo-wave1-forget-'))


test('decayStability：静默越久 S 越小，且单调不增', () => {
  const S0 = 100
  assert.equal(decayStability(S0, { idleDays: 0, upCount: 0 }), S0, 'idle=0 不该改变 S')
  let prev = decayStability(S0, { idleDays: 10, upCount: 0 })
  for (const idleDays of [30, 90, 365, 1000, 3650]) {
    const next = decayStability(S0, { idleDays, upCount: 0 })
    assert.ok(next < prev, `idleDays=${idleDays} 后 S 应继续下降（${next} 应 < ${prev}）`)
    assert.ok(next >= CURVE.S_MIN, 'S 绝不低于 CURVE.S_MIN')
    prev = next
  }
})

test('decayStability：复利回落，0.002/天 ≈ 一年回落到 48%（与 config.FORGET 注释一致）', () => {
  const ratio = decayStability(100, { idleDays: 365, upCount: 0 }) / 100
  assert.ok(Math.abs(ratio - 0.482) < 0.01, `一年后应剩约 48%，实际 ${(ratio * 100).toFixed(1)}%`)
})

test('decayStability：无限静默也只会停在下限，不会归零或为负', () => {
  assert.equal(decayStability(100, { idleDays: 1e9, upCount: 0 }), CURVE.S_MIN)
  assert.equal(decayStability(100, { idleDays: 1e9, upCount: 0, floor: 0.05 }), 0.05)

  assert.ok(decayStability(100, { idleDays: 1e9, floor: 0.0001 }) >= CURVE.S_MIN)
  assert.ok(decayStability(0.001, { idleDays: 5 }) >= CURVE.S_MIN, '低于下限的输入必须被抬到下限')
})

test('decayStability：巩固次数越多越抗遗忘（upCount 抑制回落）', () => {
  const base = decayStability(100, { idleDays: 365, upCount: 0 })
  const consolidated = decayStability(100, { idleDays: 365, upCount: 10 })
  assert.ok(consolidated > base, '被反复巩固过的记忆应比从未巩固的回落得慢')
  assert.ok(consolidated <= 100)
})


const stale = () => ({
  id: 'm-stale', S: 1, born: 0, touchAt: 0, upCount: 0,
  pinned: false, trust: 'unverified', archived: false,
})

test('archiveEligibility：长期未用、未巩固、未被人确认的条目可归档', () => {
  const verdict = archiveEligibility(stale(), {
    idleDays: 90, r: 0.05,
    maxS: FORGET.S_MAX_ARCHIVED, minIdle: FORGET.MIN_IDLE_DAYS, maxTouches: FORGET.MAX_TOUCHES,
  })
  assert.equal(verdict.eligible, true)
  assert.deepEqual(verdict.reasons, [], '可归档时不应有失败原因')
  assert.ok(verdict.score > 0 && verdict.score <= 1, `score 应落在 (0,1]，实际 ${verdict.score}`)
})

test('archiveEligibility：最近用过的条目被拒（静默不足）', () => {
  const v = archiveEligibility({ ...stale(), touchAt: 99.5 }, { idleDays: 0.5 })
  assert.equal(v.eligible, false)
  assert.ok(v.reasons.includes('not-idle-enough'), `应给出 not-idle-enough，实际 ${v.reasons}`)
})

test('archiveEligibility：钉住的、人确认过的条目被拒', () => {
  const pinned = archiveEligibility({ ...stale(), pinned: true, trust: 'confirmed' }, { idleDays: 90 })
  assert.equal(pinned.eligible, false)
  assert.ok(pinned.reasons.includes('pinned'), `应给出 pinned，实际 ${pinned.reasons}`)
  assert.ok(pinned.reasons.includes('human-confirmed'), `应给出 human-confirmed，实际 ${pinned.reasons}`)

  const confirmed = archiveEligibility({ ...stale(), trust: 'confirmed' }, { idleDays: 90 })
  assert.equal(confirmed.eligible, false)
  assert.ok(confirmed.reasons.includes('human-confirmed'))

  assert.equal(archiveEligibility({ ...stale(), pinned: true }, { idleDays: 90 }).eligible, false)
})

test('archiveEligibility：S 太大、巩固太多、已归档都分别被拒', () => {
  const highS = archiveEligibility({ ...stale(), S: 50 }, { idleDays: 4000 })
  assert.equal(highS.eligible, false)
  assert.ok(highS.reasons.includes('stability-too-high'))

  const used = archiveEligibility({ ...stale(), upCount: FORGET.MAX_TOUCHES + 1 }, { idleDays: 90 })
  assert.equal(used.eligible, false)
  assert.ok(used.reasons.includes('too-many-consolidations'))

  const already = archiveEligibility({ ...stale(), archived: true }, { idleDays: 90 })
  assert.equal(already.eligible, false)
  assert.ok(already.reasons.includes('already-archived'))
  assert.equal(already.score, 0, '硬性排除的条目 score 必须为 0')
})

test('archiveEligibility：谓词是纯的——不修改入参，可重复调用', () => {
  const item = stale()
  const before = JSON.stringify(item)
  const a = archiveEligibility(item, { idleDays: 90 })
  const b = archiveEligibility(item, { idleDays: 90 })
  assert.equal(JSON.stringify(item), before, '谓词绝不能写入 item')
  assert.deepEqual(a, b, '同样输入必须得到同样结果')
})

test('archiveEligibility：item.S 优先，缺失时退回 options.S', () => {
  assert.equal(archiveEligibility({ born: 0, touchAt: 0, upCount: 0 }, { idleDays: 90, S: 1 }).eligible, true)

  const v = archiveEligibility({ S: 50, born: 0, touchAt: 0, upCount: 0 }, { idleDays: 4000, S: 0.5 })
  assert.equal(v.eligible, false)
  assert.ok(v.reasons.includes('stability-too-high'))
})

test('D7 可达性：S 被触碰推高后，长期静默能把它压回归档门槛以下', () => {

  const idleDays = 365 * 15
  const decayed = decayStability(100, { idleDays, upCount: 0, decayPerDay: FORGET.S_DECAY_PER_DAY })
  const v = archiveEligibility({ ...stale(), S: decayed }, { idleDays })
  assert.ok(decayed <= FORGET.S_MAX_ARCHIVED, `衰减 ${idleDays} 天后 S=${decayed} 应 ≤ ${FORGET.S_MAX_ARCHIVED}`)
  assert.equal(v.eligible, true, '回落之后归档必须真的可达，而不是永远被 S 门槛挡住')
})


test('archive：条目从 alive() 消失、进回收站、整份日志重放后仍然归档', () => {
  const dir = freshDir()
  try {
    const log = new EventLog(dir)
    log.load()
    const id = 'm-archive-1'
    log.append({ kind: 'create', id, text: 'stale orchard note', scope: 'p', born: 0, S: 1 })
    assert.equal(log.alive('p').length, 1)

    const at = Date.now()
    log.append({ kind: 'archive', id, at, reason: 'stale', score: 0.9 })

    assert.equal(log.alive('p').length, 0, 'archived 条目必须被 alive() 排除')
    assert.equal(log.alive().length, 0)
    const bin = log.archivedItems('p')
    assert.equal(bin.length, 1)
    assert.equal(bin[0].archived, true)
    assert.equal(bin[0].level, 'D')
    assert.equal(bin[0].archivedAt, at, 'archivedAt 必须被重放')
    assert.equal(log.archivedItems('other-scope').length, 0, '回收站按 scope 过滤')


    const replayed = new EventLog(dir)
    replayed.load()
    assert.equal(replayed.items.get(id).archived, true)
    assert.equal(replayed.items.get(id).level, 'D')
    assert.equal(replayed.alive('p').length, 0, '重放后仍然从 alive() 排除')
    assert.equal(replayed.archivedItems().length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unarchive：恢复后重新出现在 alive()，并可再次归档；重放仍一致', () => {
  const dir = freshDir()
  try {
    const log = new EventLog(dir)
    log.load()
    const id = 'm-restore-1'
    log.append({ kind: 'create', id, text: 'restorable note', scope: 'p', born: 0, S: 1 })
    log.append({ kind: 'archive', id, at: Date.now() })
    assert.equal(log.alive('p').length, 0)

    const r = log.restoreArchived(id)
    assert.equal(r.ok, true)
    assert.equal(log.items.get(id).archived, false)
    assert.equal(log.items.get(id).archivedAt, null)
    assert.equal(log.alive('p').length, 1, 'unarchive 后应重新可见')
    assert.equal(log.archivedItems().length, 0)


    assert.deepEqual(log.restoreArchived(id), { ok: false, error: 'not archived' })
    assert.deepEqual(log.restoreArchived('nope'), { ok: false, error: 'unknown item' })


    const replayed = new EventLog(dir)
    replayed.load()
    assert.equal(replayed.items.get(id).archived, false)
    assert.equal(replayed.items.get(id).archivedAt, null)
    assert.equal(replayed.alive('p').length, 1)
    assert.equal(replayed.archivedItems().length, 0)


    replayed.append({ kind: 'archive', id })
    assert.equal(replayed.alive('p').length, 0)
    const replayed2 = new EventLog(dir)
    replayed2.load()
    assert.equal(replayed2.alive('p').length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('D6 闭环：refreshLevels 判 D 的条目仍可见，只有真正写 archive 事件才不可检索', () => {
  const dir = freshDir()
  try {
    const log = new EventLog(dir)
    log.load()
    const id = 'm-leveld-1'

    log.append({ kind: 'create', id, text: 'ancient note', scope: 'p', born: 0, S: 1 })
    log.refreshLevels()
    assert.equal(log.items.get(id).level, 'D', '陈旧条目应按曲线判为 D 级')
    assert.equal(log.items.get(id).archived, false)
    assert.equal(log.alive('p').length, 1, '仅 level=D 不构成遗忘；遗忘要靠 archive 事件')

    log.append({ kind: 'archive', id })
    assert.equal(log.alive('p').length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('alive() 排除归档，但不误伤 R 很低仍未归档的记忆（回归守卫）', () => {
  const dir = freshDir()
  try {
    const log = new EventLog(dir)
    log.load()
    const keep = 'm-keep'
    log.append({ kind: 'create', id: keep, text: 'low R but not archived', scope: 'p', born: 0, S: 1 })
    const r = retrievability(20000, 1, CURVE.DECAY)
    assert.ok(r < 0.15, `前置条件：R 应 < 0.15，实际 ${r}`)
    assert.ok(log.alive('p').some((it) => it.id === keep), '未归档的低 R 条目仍在 alive() 中（归档才是遗忘机制）')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
