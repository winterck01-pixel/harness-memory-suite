


import { BACKLOG } from './config.js'
import {randomUUID} from 'node:crypto'

export const BACKLOG_KINDS = {
  'revision-evaluate': {cost:8,priority:6,label:'候选修订真实任务评测'},
  'gist-compress':  { cost: 1, priority: 3, label: 'gist 压缩' },
  'skill-compile':  { cost: 5, priority: 5, label: '技能编译' },
  'retro-plan':     { cost: 2, priority: 5, label: '复盘与技能提炼' },
  'card-rewrite':   { cost: 2, priority: 2, label: '意识卡重写' },
  'entity-merge':   { cost: 1, priority: 4, label: '实体合并提议' },
  'dedupe':         { cost: 2, priority: 1, label: '去重合并' },
  'probe-run':      { cost: 1, priority: 6, label: '安全体检' },
}

export class Backlog {
  constructor(cfg = BACKLOG) {
    this.cfg = cfg

    this.items = []
    this.inflight = new Set()
    this.dropped = 0
    this.warnings = []
  }


  enqueue({ kind, target = null, payload = null, now = Date.now(), dedupe = true }) {
    const meta = BACKLOG_KINDS[kind]
    if (!meta) throw new Error(`未知欠账类型: ${kind}`)
    if (dedupe) {
      const dup = this.items.find((i) => !this.inflight.has(i.id) && i.kind === kind && i.target === target && i.payload?.scope === payload?.scope)
      if (dup) { dup.payload = structuredClone(payload); dup.lastQueued = now; dup.hits++; return { merged: true, item: dup } }
    }
    const item = {
      id: `b-${randomUUID()}`,
      kind, target, payload: structuredClone(payload),
      priority: meta.priority,
      cost: meta.cost,
      queuedAt: now,
      lastQueued: now,
      hits: 1,
      degraded: false,
    }
    this.items.push(item)
    this._enforceLimit()
    return { merged: false, item }
  }

  _enforceLimit() {
    if (this.items.length <= this.cfg.MAX_ITEMS) return

    this.items.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt)
    const removed = []
    for(let n=this.items.length-1; n>=0 && this.items.length>this.cfg.MAX_ITEMS; n--) {
      if(!this.inflight.has(this.items[n].id))removed.push(...this.items.splice(n,1))
    }
    this.dropped += removed.length
    this.warnings.push(`欠账超上限，丢弃 ${removed.length} 条低优先级项：${removed.map((r) => r.kind).join(',')}`)
    if (this.warnings.length > 50) this.warnings.shift()
  }


  markStale(now = Date.now()) {
    const ms = this.cfg.STALE_HOURS * 3600 * 1000
    let n = 0
    for (const it of this.items) {
      if (!it.degraded && now - it.queuedAt >= ms) { it.degraded = true; n++ }
    }
    return n
  }


  pending({ now = Date.now() } = {}) {
    const ms = this.cfg.STALE_HOURS * 3600 * 1000
    const stale = this.items.filter((i) => now - i.queuedAt >= ms).length
    const cost = this.items.reduce((a, i) => a + (i.degraded ? 1 : i.cost), 0)
    return { count: this.items.length, cost, stale, dropped: this.dropped }
  }


  async drain({ handler, limit = this.cfg.DRAIN_PER_CALL, now = Date.now(), filter = () => true } = {}) {
    this.markStale(now)

    this.items.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt)


    const batch = this.items.filter(it=>!this.inflight.has(it.id) && filter(it))
    const budget = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
    const processed = []
    const failed = []
    const blocked = []
    for (const it of batch) {
      if (processed.length + failed.length >= budget) break

      if (this.inflight.has(it.id) || !this.items.includes(it) || !filter(it)) continue
      this.inflight.add(it.id)
      try {
        const out = await handler(it)
        if (out?.blocked === true) { blocked.push({...it,outcome:out}); continue }
        if (out?.deferred) { failed.push({...it,error:'Deferred: no executor available'}); continue }
        this.items = this.items.filter(candidate => candidate.id !== it.id)
        processed.push({ ...it, outcome: out ?? null })
      } catch (err) {

        it.hits++
        it.error = String(err?.message ?? err)
        failed.push(it)
      } finally {
        this.inflight.delete(it.id)
      }
    }
    this.items.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt)
    return { processed, failed, blocked, remaining: this.items.length }
  }


  peek({ limit = 10, now = Date.now() } = {}) {
    const ms = this.cfg.STALE_HOURS * 3600 * 1000
    return [...this.items]
      .sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt)
      .slice(0, limit)
      .map((i) => ({
        kind: i.kind, target: i.target, priority: i.priority,
        degraded: !!i.degraded, hits: i.hits ?? 0,
        ageHours: (now - i.queuedAt) / 3600000,
        stale: now - i.queuedAt >= ms,
      }))
  }


  report() {
    const byKind = {}
    for (const it of this.items) {
      byKind[it.kind] = byKind[it.kind] ?? { n: 0, degraded: 0 }
      byKind[it.kind].n++
      if (it.degraded) byKind[it.kind].degraded++
    }
    return { ...this.pending(), byKind, warnings: this.warnings.slice(-3) }
  }

  toJSON() { return { items: this.items, dropped: this.dropped, warnings: this.warnings } }
  load(o) {
    if (!o) return this
    this.items = o.items ?? []
    this.inflight.clear()
    this.dropped = o.dropped ?? 0
    this.warnings = o.warnings ?? []
    return this
  }
}
