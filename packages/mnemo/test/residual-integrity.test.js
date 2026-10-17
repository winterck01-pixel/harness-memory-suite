import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { filterOptedOutClauses } from '../lib/staging.js'
import { compactMetadata } from '../lib/inject.js'
import { archiveEligibility } from '../lib/fsrs.js'
import { EventLog } from '../lib/store.js'

test('opt-out matching does not rewrite retained original wording', () => {
  for (const text of ['不要忘记把这个偏好保存到长期记忆', "Don't forget this deployment preference."]) {
    assert.deepEqual(filterOptedOutClauses(text), { text, dropped: false, wholeTurn: false })
  }
})

test('revision and revert invalidate summaries of a different active text, including replay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-residual-'))
  try {
    const log = new EventLog(dir); log.load()
    const initial = log.append({ kind: 'create', id: 'versioned', text: 'Use port 3000', gist: 'port 3000' })
    log.append({ kind: 'revise', id: 'versioned', text: 'Use port 8443' })
    assert.equal(log.items.get('versioned').gist, null)
    log.append({ kind: 'gist-set', id: 'versioned', gist: 'port 8443' })
    log.append({ kind: 'revert', id: 'versioned', toSeq: initial.seq })
    assert.equal(log.items.get('versioned').text, 'Use port 3000')
    assert.equal(log.items.get('versioned').gist, null)
    const replay = new EventLog(dir); replay.load()
    assert.equal(replay.items.get('versioned').gist, null)
    assert.equal(replay.items.get('versioned').versions.length, 3)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('relative injected records include usable historical reference and zone', () => {
  const metadata = compactMetadata({ id: 'dated', text: '明天上线', source: 'human', evidence: [{ source: 'human', at: Date.UTC(2026, 8, 29), timeZone: 'Asia/Shanghai' }] })
  assert.match(metadata, /referenceTime=2026-09-29T00:00:00.000Z/)
  assert.match(metadata, /timeZone=Asia\/Shanghai/)
  assert.match(metadata, /referenceBasis=evidence/)
  assert.match(compactMetadata({ text: '目前使用旧端口' }), /referenceTime=unknown/)
  assert.match(compactMetadata({ text: '3天后交付' }), /referenceTime=unknown/)
})

test('past frequent use extends idle protection but cannot make stale low-trust memories immortal', () => {
  const item = { S: 1, upCount: 10, source: 'agent', trust: 'unverified' }
  assert.equal(archiveEligibility(item, { idleDays: 90 }).eligible, false)
  assert.equal(archiveEligibility(item, { idleDays: 2000 }).eligible, true)
  assert.equal(archiveEligibility({ ...item, pinned: true }, { idleDays: 2000 }).eligible, false)
  assert.equal(archiveEligibility({ ...item, trust: 'confirmed' }, { idleDays: 2000 }).eligible, false)
})

test('read-only store rejects every disk mutation before creating a directory or lock', () => {
  const root = mkdtempSync(join(tmpdir(), 'mnemo-readonly-'))
  const dir = join(root, 'absent')
  try {
    const log = new EventLog(dir); log.readOnly = true; log.load()
    for (const mutate of [
      () => log.append({ kind: 'create', id: 'blocked', text: 'blocked' }),
      () => log.appendMany([{ kind: 'create', id: 'blocked', text: 'blocked' }]),
      () => log._appendState({ state: { sentinel: true } }),
      () => log.persistState({ sentinel: true }),
      () => log._writeState('{}'),
      () => log.compact(),
      () => log.rollback('blocked', 1),
      () => log.restoreArchived('blocked'),
    ]) {
      assert.throws(mutate, /read-only/i)
      assert.equal(existsSync(dir), false)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('read-only compaction dry run reads without locks, and mutations preserve original bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-readonly-existing-'))
  try {
    const log = new EventLog(dir); log.load()
    log.append({ kind: 'create', id: 'original', text: 'original' })
    const before = readFileSync(log.path)
    const files = readdirSync(dir).sort()
    log.readOnly = true
    assert.equal(log.compact({ dryRun: true }).dryRun, true)
    assert.throws(() => log.append({ kind: 'revise', id: 'original', text: 'changed' }), /read-only/i)
    assert.throws(() => log.compact(), /read-only/i)
    assert.deepEqual(readFileSync(log.path), before)
    assert.deepEqual(readdirSync(dir).sort(), files)
    assert.equal(log.items.get('original').text, 'original')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
