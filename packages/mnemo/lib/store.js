import {migrateState} from './scope-state.js'


import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, openSync, fsyncSync, closeSync, renameSync, readSync, rmSync, readdirSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { acquireLock } from './lock.js'
import { usable } from './reliability.js'
import { STORE, CURVE, LEVELS } from './config.js'
import { levelOf, snapshotR, ageForRetrievability, LEVEL_ORDER } from './fsrs.js'


export function newItem({ id, text, kind = 'episode', scope = 'default', cues = [], entities = [], S = 1, born = 0, pinned = false, source = null }) {
  return {
    id,
    kind,
    scope,
    text,
    gist: null,
    cues: [...cues],
    entities: [...entities],
    S,
    born,
    touchAt: null,
    level: 'C',
    promote: 0,
    promoteUpdatedAt: born,
    touches: 0,
    sessions: [],
    touchLog: [],
    upCount: 0,
    pinned,
    archived: false,
    archivedAt: null,
    source,
    activeSeq: null,
    versions: [],
  }
}

export class EventLog {


  constructor(dir, cfg = STORE) {
    this.dir = dir
    this.cfg = cfg
    this.path = join(dir, cfg.LOG)

    this.items = new Map()
    this.seq = 0
    this.loaded = false
    this.dirty = false
    this._entityDict = null

    this.readOffset = 0


    this._pendingTail = ''

    this.stateLoaded = false

    this._logStateSeq = -1

    this._stateSeq = -1
    this.proposals = new Map()
    this.stagingReceipts = new Map()
    this.cancelledCaptures = new Set()
  }


  get statePath() { return join(this.dir, this.cfg.STATE ?? 'runtime-state.json') }


  load(options = {}) {
    this.items.clear()
    this.proposals.clear()
    this.stagingReceipts.clear()
    this.cancelledCaptures.clear()
    this.runtimeState = undefined
    this._logState = undefined
    this.seq = 0
    this.readOffset = 0
    this._pendingTail = ''
    this._consumedPath = this.path
    this.stateLoaded = false
    this.corrupt = false
    this.corruptState = false
    this._logIdentity = undefined
    this._logStateSeq = -1
    this._stateSeq = -1

    this._ensureLogFile()
    if (!existsSync(this.path)) {

      if (existsSync(this.statePath)) this._loadState()
      this.loaded = true
      return this
    }
    this._consume(options)
    this._loadState()

    this.needsNewline = this._tailByte() !== '\n'
    this._logIdentity = this._identityOf()
    this.loaded = true
    this.refreshLevels()
    return this
  }


  _ensureLogFile() {

    if (this.readOnly) return this
    if (existsSync(this.path) || !existsSync(this.dir)) return this
    const orphan = this._archiveFiles()
    if (orphan.length) {
      throw Error(`Memory log is missing but ${orphan.length} archive(s) exist (newest: ${orphan.at(-1)}); restore it with "mv <archive> ${this.path}" before writing`)
    }
    const fd = openSync(this.path, 'a', 0o600)
    closeSync(fd)
    return this
  }


  _archiveFiles() {
    const prefix = `${this.cfg.LOG}.`
    const shape = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.\d+$/
    let names
    try { names = readdirSync(this.dir) } catch (error) {


      throw Error(`Cannot list memory directory ${this.dir}: ${error.message}`)
    }
    return names
      .filter((name) => name.startsWith(prefix) && shape.test(name.slice(prefix.length)))
      .sort()
      .map((name) => join(this.dir, name))
  }


  _pruneArchives() {
    this._assertWritable()
    const keep = this.cfg.MAX_ARCHIVES ?? 3
    const archives = this._archiveFiles()
    for (const path of archives.slice(0, Math.max(0, archives.length - keep))) {
      try { rmSync(path, { force: true }) } catch {                     }
    }
  }


  _identityOf() {
    try {
      const s = statSync(this.path)
      return `${s.size}:${s.ino}:${s.ctimeMs}`
    } catch { return null }
  }


  _markCorrupt(error) {
    this.corrupt = true
    this._corruptIdentity = this._identityOf()
    return error
  }


  _tailByte() {
    if (!existsSync(this.path)) return '\n'
    const size = statSync(this.path).size
    if (!size) return '\n'
    const fd = openSync(this.path, 'r')
    try {
      const buf = Buffer.allocUnsafe(1)
      return readSync(fd, buf, 0, 1, size - 1) === 1 ? buf.toString('utf8') : ''
    } finally { closeSync(fd) }
  }


  _consume(options = {}) {
    const size = existsSync(this.path) ? statSync(this.path).size : 0
    if (size < this.readOffset) { this._consumedPath = null; return this }
    if (size <= this.readOffset) return this
    const from = this.readOffset


    this.readOffset = size

    const tail = this._pendingTail
    this._pendingTail = ''
    const decoder = new StringDecoder('utf8')
    let carry = tail
    const feed = (text) => {
      const buf = carry + text
      let at = 0
      for (;;) {
        const nl = buf.indexOf('\n', at)
        if (nl < 0) break
        try { this._applyLine(buf.slice(at, nl)) } catch (error) { throw this._markCorrupt(error) }
        at = nl + 1
      }
      carry = at === 0 ? buf : buf.slice(at)
    }

    if (options.read) {

      feed(decoder.write(Buffer.from(options.read(this.path, { start: from, end: size }), 'utf8')))
      feed(decoder.end())
    } else {
      const chunkSize = this.cfg.READ_CHUNK_BYTES ?? (1 << 20)
      const fd = openSync(this.path, 'r')
      const buf = Buffer.allocUnsafe(chunkSize)
      try {
        let pos = from
        while (pos < size) {
          const got = readSync(fd, buf, 0, Math.min(chunkSize, size - pos), pos)
          if (got <= 0) break
          pos += got
          feed(decoder.write(buf.subarray(0, got)))
        }
        feed(decoder.end())
      } finally { closeSync(fd) }
    }
    try {
      if (carry.trim()) this._applyLine(carry)
    } catch (error) {
      throw this._markCorrupt(error)
    }


    this.needsNewline = this._tailByte() !== '\n'
    this._logIdentity = this._identityOf()
    return this
  }


  _applyLine(line) {
    const s = line.trim()
    if (!s) return null
    let ev
    try { ev = JSON.parse(s) } catch { throw Error('Memory log contains malformed data; restore or repair from backup before writing') }
    const seq = ev.seq ?? 0
    this.seq = Math.max(this.seq, seq)
    this._apply(ev)
    return ev
  }


  refreshFromDisk(options = {}) {
    if (!this.loaded) return this.load(options)
    if (this.corrupt) return this._recoverFromCorruption(options)
    if (this._consumedPath !== this.path) return this.load(options)
    const current = this._statNow()
    if (!current) return this.load(options)
    if (this._logIdentity !== undefined && current.identity !== this._logIdentity) return this.load(options)
    this._consume(options)
  }


  _recoverFromCorruption(options = {}) {
    const current = this._statNow()
    if (!current || current.identity === this._corruptIdentity) {
      throw Error('Memory log contains malformed data; restore or repair from backup before writing')
    }
    this.corrupt = false
    return this.load(options)
  }


  _statNow() {
    try {
      const s = statSync(this.path)
      return { size: s.size, identity: `${s.size}:${s.ino}:${s.ctimeMs}` }
    } catch { return null }
  }


  append(event, { validate } = {}) {
    this._assertWritable()
    if (validate !== undefined && typeof validate !== 'function') throw Error('Append validation must be a synchronous function')
    if (event.kind === 'runtime-state') return this._appendState(event, { validate })
    const release = acquireLock(this.dir)
    try {
      this.refreshFromDisk()
      this._validateAppend(validate)
      if (event.kind === 'proposal' && this.proposals.has(event.id)) throw Error('Proposal identity already exists')
      const ev = { ...structuredClone(event), seq: this.seq + 1, at: event.at ?? Date.now() }
      const line = (this.needsNewline ? '\n' : '') + JSON.stringify(ev) + '\n'
      const fd = openSync(this.path, 'a', 0o600)


      try { writeFileSync(fd, line); fsyncSync(fd) } finally { closeSync(fd) }
      this.needsNewline = false
      this.seq = ev.seq
      this.readOffset = existsSync(this.path) ? statSync(this.path).size : this.readOffset
      this._logIdentity = this._identityOf()
      this._pendingTail = ''


      try { this._apply(ev) } catch (error) { throw this._markCorrupt(error) }


      if (ev.state !== undefined && this.runtimeState !== undefined) this.persistState(this.runtimeState)
      this.dirty = true
      return ev
    } finally { release() }
  }


  _validateAppend(validate) {
    if (!validate) return
    if (validate.constructor?.name === 'AsyncFunction') throw Error('Append validation must be synchronous')
    const result = validate(this)
    if (result && typeof result.then === 'function') {


      Promise.resolve(result).catch(() => {})
      throw Error('Append validation must be synchronous')
    }
    if (result === false) throw Error('Append validation rejected the event')
  }


  appendMany(events) {
    this._assertWritable()
    const list = Array.isArray(events) ? events.filter(Boolean) : []
    if (!list.length) return []
    const release = acquireLock(this.dir)
    try {
      this.refreshFromDisk()
      const written = []
      const lines = []
      let seq = this.seq
      for (const event of list) {
        if (event.kind === 'runtime-state') continue
        if (event.kind === 'proposal' && this.proposals.has(event.id)) throw Error('Proposal identity already exists')
        const ev = { ...structuredClone(event), seq: ++seq, at: event.at ?? Date.now() }
        lines.push((this.needsNewline && !lines.length ? '\n' : '') + JSON.stringify(ev) + '\n')
        this.needsNewline = false
        written.push(ev)
      }
      if (!lines.length) return []
      const fd = openSync(this.path, 'a', 0o600)
      try { writeFileSync(fd, lines.join('')); fsyncSync(fd) } finally { closeSync(fd) }
      this.seq = seq
      this.readOffset = existsSync(this.path) ? statSync(this.path).size : this.readOffset
      this._logIdentity = this._identityOf()
      this._pendingTail = ''
      for (const ev of written) {
        try { this._apply(ev) } catch (error) { throw this._markCorrupt(error) }
        if (ev.state !== undefined && this.runtimeState !== undefined) this.persistState(this.runtimeState)
      }
      this.dirty = true
      return written
    } finally { release() }
  }


  _appendState(event, { validate } = {}) {
    this._assertWritable()
    const release = acquireLock(this.dir)
    try {
      this.refreshFromDisk()
      this._validateAppend(validate)
      const ev = { ...structuredClone(event), seq: this.seq, at: event.at ?? Date.now() }
      this.persistState(ev.state)
      this._logState = undefined
      this.seq = Math.max(this.seq, ev.seq)
      this.dirty = true
      return ev
    } finally { release() }
  }


  persistState(state, seq = this.seq) {
    this._assertWritable()


    const body = JSON.stringify({ ...state, stateSeq: seq })
    this._stateSeq = seq
    if (existsSync(this.statePath)) {
      try { if (readFileSync(this.statePath, 'utf8') === body) { this.runtimeState = state; this.stateLoaded = true; return false } }
      catch {                       }
    }
    this._writeState(body)
    this.runtimeState = state
    this.stateLoaded = true
    return true
  }


  _writeState(payload) {
    this._assertWritable()
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
    const tmp = `${this.statePath}.tmp-${process.pid}-${randomUUID()}`
    try {
      writeFileSync(tmp, payload, { mode: 0o600 })
      const fd = openSync(tmp, 'r')
      try { fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(tmp, this.statePath)
    } catch (error) {
      try { rmSync(tmp, { force: true }) } catch {                        }
      throw error
    }
  }


  _loadState() {
    this.stateLoaded = false
    this._stateSeq = -1
    let state
    if (existsSync(this.statePath)) {
      try {
        state = JSON.parse(readFileSync(this.statePath, 'utf8'))
        if (state) { this._stateSeq = typeof state.stateSeq === 'number' ? state.stateSeq : -1; delete state.stateSeq }
      } catch {


        state = undefined
        this.stateLoaded = false
        this.corruptState = true
      }
    }


    const sidecarWins = state !== undefined && (this._logState === undefined || this._stateSeq >= this._logStateSeq)
    const logWins = this._logState !== undefined && !sidecarWins
    const chosen = sidecarWins ? state : (logWins ? this._logState : state)
    if (chosen !== undefined) { this.runtimeState = chosen; this.stateLoaded = true }
    return this.runtimeState
  }


  _apply(ev) {
    switch (ev.kind) {
      case 'approval': {
        for (const operation of ev.operations) this._apply({...operation,seq:ev.seq,at:ev.at})
        break
      }
      case 'create': {
        const it = newItem({
          id: ev.id,
          text: ev.text,
          kind: ev.itemKind ?? 'episode',
          scope: ev.scope ?? 'default',
          cues: ev.cues ?? [],
          entities: ev.entities ?? [],
          S: ev.S ?? 1,
          born: ev.born ?? ev.at / 86400000,
          pinned: ev.pinned ?? false,
          source: ev.source ?? null,
        })
        if (ev.gist) it.gist = ev.gist
        it.versions = [{ seq: ev.seq, at: ev.at, kind: 'create', text: ev.text }]
        it.activeSeq = ev.seq
        it.trust = ev.trust ?? (it.source === 'human' ? 'reported' : 'unverified')
        it.evidence = ev.evidence ?? []
        it.factKey = ev.factKey ?? null
        it.expiresAt = ev.expiresAt ?? null
        it.recordedAt = ev.at
        it.conflicts = ev.conflicts ?? []
        this.items.set(ev.id, it)
        if (ev.stagingCaptureKey) this.stagingReceipts.set(ev.stagingCaptureKey, ev.id)
        for (const id of it.conflicts) { const other=this.items.get(id); if(other)other.conflicts=[...new Set([...(other.conflicts??[]),it.id])] }
        break
      }
      case 'proposal': { if (!this.proposals.has(ev.id)) this.proposals.set(ev.id, {...ev}); break }
      case 'proposal-reviewed': { const proposal=this.proposals.get(ev.id); if(proposal){proposal.status=ev.status;if(ev.evaluationReport!==undefined)proposal.evaluationReport=structuredClone(ev.evaluationReport)} break }
      case 'review': {
        for(const id of ev.cancelStagingIds ?? [])this.cancelledCaptures.add(id)
        const it = this.items.get(ev.id); if (!it) break
        it.trust = ev.trust
        it.reviewSeq = ev.seq
        it.evidence = [...(it.evidence ?? []), { source: 'human-review', at: ev.at, reason: ev.reason ?? null }]
        if (ev.supersededBy) it.supersededBy = ev.supersededBy
        break
      }
      case 'scope-binding': {
        for (const it of this.items.values()) if (it.scope === ev.legacy) it.scope = ev.scope
        for (const proposal of this.proposals.values()) if (proposal.scope === ev.legacy) proposal.scope = ev.scope
        this._setRuntimeState(ev.state ?? migrateState(this._logState, ev.legacy, ev.scope), ev.seq ?? 0)
        break
      }
      case 'runtime-state': {

        this._setRuntimeState(ev.state, ev.seq ?? 0)
        break
      }
      case 'touch': {
        const it = this.items.get(ev.id); if (!it) break
        it.S = ev.S ?? it.S
        it.born = ev.born ?? it.born
        it.touchAt = ev.touchAt ?? it.touchAt
        it.promote = ev.promote ?? it.promote
        it.promoteUpdatedAt = ev.at / 86400000
        it.touches = ev.touches ?? it.touches + 1
        if (ev.upCount !== undefined) it.upCount = ev.upCount
        if (ev.session && !it.sessions.includes(ev.session)) it.sessions.push(ev.session)
        if (ev.stagingCaptureKey) this.stagingReceipts.set(ev.stagingCaptureKey, ev.id)
        if (ev.captureSource === 'human') {
          it.source = 'human'
          if (it.trust === 'unverified') it.trust = 'reported'
        }
        for (const evidence of ev.captureEvidence ?? []) {
          if (!it.evidence.some(old => JSON.stringify(old) === JSON.stringify(evidence))) it.evidence.push(evidence)
        }
        it.touchLog.push(ev.at)
        if (it.touchLog.length > 200) it.touchLog.shift()
        break
      }
      case 'decay-progress': {
        const it = this.items.get(ev.id); if (!it) break
        it.promote = ev.promote ?? it.promote
        it.promoteUpdatedAt = ev.at / 86400000
        break
      }
      case 'level': {
        const it = this.items.get(ev.id); if (!it) break
        it.level = ev.to
        if (ev.upCount !== undefined) it.upCount = ev.upCount
        break
      }
      case 'revise': {
        const it = this.items.get(ev.id); if (!it) break
        it.versions.push({ seq: ev.seq, at: ev.at, kind: 'revise', text: ev.text, reason: ev.reason ?? null })
        it.text = ev.text
        it.gist = ev.gist ?? null
        it.gistAt = null
        it.gistSeq = null
        it.activeSeq = ev.seq
        break
      }
      case 'gist-set': {


        const it = this.items.get(ev.id); if (!it) break
        it.gist = ev.gist ?? null
        it.gistAt = ev.at
        it.gistSeq = ev.seq
        break
      }
      case 'revert': {
        const it = this.items.get(ev.id); if (!it) break
        const target = it.versions.find((v) => v.seq === ev.toSeq)
        if (!target) break
        it.versions.push({ seq: ev.seq, at: ev.at, kind: 'revert', text: target.text, toSeq: ev.toSeq, reason: ev.reason ?? null })
        it.text = target.text

        it.gist = null
        it.gistAt = null
        it.gistSeq = null
        it.activeSeq = ev.seq
        break
      }
      case 'pin': {
        const it = this.items.get(ev.id); if (!it) break
        it.pinned = !!ev.on
        break
      }
      case 'archive': {
        const it = this.items.get(ev.id); if (!it) break
        it.archived = true
        it.archivedAt = ev.at
        it.level = 'D'
        break
      }
      case 'unarchive': {
        const it = this.items.get(ev.id); if (!it) break
        it.archived = false
        it.archivedAt = null
        break
      }
      case 'merge-into': {

        const src = this.items.get(ev.id)
        const dst = this.items.get(ev.into)
        if (!src || !dst) break
        for (const c of src.cues) if (!dst.cues.includes(c)) dst.cues.push(c)
        for (const e of src.entities) if (!dst.entities.includes(e)) dst.entities.push(e)
        src.archived = true
        src.archivedAt = ev.at
        src.level = 'D'
        break
      }
      default:
        break
    }
  }


  _setRuntimeState(state, seq = 0) {
    this._logState = state
    this.runtimeState = state
    this._logStateSeq = seq
    return state
  }


  refreshItemLevel(id, nowMs = Date.now(), decay = CURVE.DECAY, levels = LEVELS) {
    const it = this.items.get(id)
    if (!it) return null
    if (it.archived) { it.level = 'D'; return it.level }
    const nowDays = nowMs / 86400000
    const r = snapshotR(it, nowDays, decay)
    const idleDays = nowDays - (it.touchAt ?? it.born)
    it.level = levelOf(r, levels, { idleDays, S: it.S })
    return it.level
  }


  refreshLevels(nowMs = Date.now(), decay = CURVE.DECAY, levels = LEVELS) {
    const nowDays = nowMs / 86400000
    for (const it of this.items.values()) {
      if (it.archived) { it.level = 'D'; continue }
      const r = snapshotR(it, nowDays, decay)

      const idleDays = nowDays - (it.touchAt ?? it.born)
      it.level = levelOf(r, levels, { idleDays, S: it.S })
    }
    return this
  }


  snapshot(id, nowMs = Date.now(), decay = CURVE.DECAY) {
    const it = this.items.get(id)
    if (!it) return null
    const nowDays = nowMs / 86400000
    return { ...it, R: snapshotR(it, nowDays, decay), ageDays: nowDays - (it.touchAt ?? it.born) }
  }


  versionsOf(id) {
    const it = this.items.get(id)
    if (!it) return []
    return it.versions.map((v) => ({ ...v, active: v.seq === it.activeSeq }))
  }


  rollback(id, toSeq, reason = 'gate-reject') {
    this._assertWritable()
    const it = this.items.get(id)
    if (!it) return { ok: false, error: 'unknown item' }
    const target = it.versions.find((v) => v.seq === toSeq)
    if (!target) return { ok: false, error: 'unknown version' }
    const from = it.activeSeq
    const ev = this.append({ kind: 'revert', id, toSeq, reason })
    return { ok: true, seq: ev.seq, text: target.text, from }
  }


  alive(scope = null, now = Date.now()) {
    const out = []
    for (const it of this.items.values()) {
      if (it.archived || !usable(it, now)) continue
      if (scope && it.scope !== scope) continue
      out.push(it)
    }
    return out
  }


  archivedItems(scope = null) {
    const out = []
    for (const it of this.items.values()) {
      if (!it.archived) continue
      if (scope && it.scope !== scope) continue
      out.push(it)
    }
    return out
  }


  restoreArchived(id) {
    this._assertWritable()
    const it = this.items.get(id)
    if (!it) return { ok: false, error: 'unknown item' }
    if (!it.archived) return { ok: false, error: 'not archived' }
    const ev = this.append({ kind: 'unarchive', id })


    const nowDays = Date.now() / 86400000
    this.append({ kind: 'touch', id, touchAt: nowDays, born: nowDays, S: Math.max(Number(it.S) || 1, CURVE.S_MIN * 2), touches: it.touches ?? 0, upCount: it.upCount ?? 0, reason: 'restored-from-archive' })


    this.refreshLevels()
    return { ok: true, seq: ev.seq }
  }

  byKind(kind, scope = null) {
    return this.alive(scope).filter((it) => it.kind === kind)
  }


  stats() {
    const dist = { A: 0, B: 0, C: 0, D: 0 }
    let archived = 0
    let pinned = 0
    for (const it of this.items.values()) {
      if (it.archived) { archived++; continue }
      dist[it.level] = (dist[it.level] ?? 0) + 1
      if (it.pinned) pinned++
    }
    return { total: this.items.size, archived, pinned, dist, events: this.seq, corrupt: !!this.corrupt, corruptState: !!this.corruptState }
  }


  logBytes() {
    return existsSync(this.path) ? statSync(this.path).size : 0
  }


  _compactLine(line, counters) {
    const s = line.trim()
    if (!s) return undefined
    let ev
    try { ev = JSON.parse(s) } catch { counters.badLines++; return undefined }
    if (ev.kind === 'runtime-state') { counters.droppedState++; return null }
    if (ev.kind === 'scope-binding' && ev.state !== undefined) {
      const { state, ...rest } = ev
      counters.strippedState++
      return JSON.stringify(rest)
    }
    return JSON.stringify(ev)
  }


  compact(options = {}) {
    if (!options.dryRun) this._assertWritable()
    if (!existsSync(this.path)) return this._compactResult(0, 0, null, 'no log to compact', options)

    const release = this.readOnly ? () => {} : acquireLock(this.dir)
    try {

      this.refreshFromDisk()
      const state = this.runtimeState
      const before = statSync(this.path).size
      const counters = { droppedState: 0, strippedState: 0, badLines: 0 }


      if (options.dryRun) {


        let keptCount = 0
        this._eachRawLine(this.path, (line) => {
          if (this._compactLine(line, counters)) keptCount++
        }, options)
        if (counters.badLines) throw Error(`Memory log contains ${counters.badLines} malformed line(s); refusing to compact (no data was removed)`)
        return { events: this.seq, kept: keptCount, droppedState: counters.droppedState, strippedState: counters.strippedState, before, after: null, compacted: false, dryRun: true }
      }

      const archive = this._nextArchivePath()
      const tmp = `${this.path}.tmp-${process.pid}-${randomUUID()}`
      const tmpFd = openSync(tmp, 'w', 0o600)
      try {
        this._eachRawLine(this.path, (line) => {
          const out = this._compactLine(line, counters)
          if (out) writeFileSync(tmpFd, out + '\n')
        }, options)
        if (counters.badLines) throw Error(`Memory log contains ${counters.badLines} malformed line(s); refusing to compact (no data was removed)`)
        fsyncSync(tmpFd)
      } finally { closeSync(tmpFd) }


      if (!counters.droppedState && !counters.strippedState) {
        try { rmSync(tmp, { force: true }) } catch {                     }
        return this._compactResult(0, 0, null, 'nothing to compact', options, before, before)
      }


      if (state !== undefined) {
        try { this.persistState(state, this._logStateSeq) }
        catch (error) { try { rmSync(tmp, { force: true }) } catch {                   } throw error }
      }
      renameSync(this.path, archive)
      try { renameSync(tmp, this.path) }
      catch (error) {

        try { renameSync(archive, this.path) } catch {                       }
        try { rmSync(tmp, { force: true }) } catch {                   }
        throw error
      }

      const size = statSync(this.path).size
      this._consumedPath = this.path
      this.readOffset = size
      this._pendingTail = ''
      this._logIdentity = this._identityOf()
      this.needsNewline = this._tailByte() !== '\n'
      this._pruneArchives()
      return this._compactResult(counters.droppedState, counters.strippedState, archive, null, options, before, size)
    } finally { release() }
  }

  _assertWritable() {
    if (this.readOnly) throw Error('Memory store is read-only; writing is disabled')
  }


  _eachRawLine(path, onLine, options = {}) {
    if (options.read) {
      for (const line of String(options.read(path, { start: 0, end: statSync(path).size })).split('\n')) onLine(line)
      return this
    }
    const chunkSize = this.cfg.READ_CHUNK_BYTES ?? (1 << 20)
    const fd = openSync(path, 'r')
    const buf = Buffer.allocUnsafe(chunkSize)
    const decoder = new StringDecoder('utf8')
    let carry = ''
    try {
      for (;;) {
        const got = readSync(fd, buf, 0, chunkSize, null)
        if (got <= 0) break
        const text = carry + decoder.write(buf.subarray(0, got))
        let at = 0
        for (;;) {
          const nl = text.indexOf('\n', at)
          if (nl < 0) break
          onLine(text.slice(at, nl))
          at = nl + 1
        }
        carry = at === 0 ? text : text.slice(at)
      }
      carry += decoder.end()
      if (carry.trim()) onLine(carry)
    } finally { closeSync(fd) }
    return this
  }

  _compactResult(droppedState, strippedState, archive, reason, options = {}, before = null, after = null) {
    return { events: this.seq, compacted: !reason, reason: reason ?? null, droppedState, strippedState, archive, beforeBytes: before, afterBytes: after, dryRun: !!options.dryRun }
  }

  _nextArchivePath(at = Date.now()) {
    const stamp = new Date(at).toISOString().replace(/[:.]/g, '-')
    let candidate = `${this.path}.${stamp}.1`
    let n = 1
    while (existsSync(candidate)) candidate = `${this.path}.${stamp}.${++n}`
    return candidate
  }


  *all(scope = null) {
    for (const it of this.items.values()) {
      if (scope && it.scope !== scope) continue
      yield it
    }
  }
}


let _idCounter = 0
export function makeId(prefix = 'm') {
  _idCounter = (_idCounter + 1) % 1e6
  return `${prefix}-${randomUUID()}`
}

export { LEVEL_ORDER }
