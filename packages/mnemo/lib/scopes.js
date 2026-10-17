


import { existsSync } from 'node:fs'

const PROJECT_PREFIX = 'project:'
const DAY_MS = 86_400_000


function defaultExists(path) {
  try { return existsSync(path) } catch { return false }
}


export function scopePath(scope) {
  if (typeof scope !== 'string' || !scope.startsWith(PROJECT_PREFIX)) return null
  return scope.slice(PROJECT_PREFIX.length)
}


export function scopeReachable(scope, { exists = defaultExists } = {}) {
  const path = scopePath(scope)
  if (path === null) return true
  if (!path) return false
  return !!exists(path)
}


function positiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}


function lastSeenAt(item) {
  if (!item || typeof item !== 'object') return null
  let best = null
  const bump = (v) => { if (v != null && (best == null || v > best)) best = v }
  bump(positiveNumber(item.recordedAt))
  bump(positiveNumber(item.archivedAt))
  const days = [item.born, item.touchAt, item.promoteUpdatedAt]
  for (const d of days) { const n = positiveNumber(d); if (n != null) bump(n * DAY_MS) }
  if (Array.isArray(item.touchLog) && item.touchLog.length) bump(positiveNumber(item.touchLog[item.touchLog.length - 1]))
  return best
}


export function scopeReport(items, { exists = defaultExists, now = Date.now() } = {}) {
  const list = items == null ? [] : (Array.isArray(items) ? items : [...items])
  const groups = new Map()
  for (const it of list) {
    const scope = (it && typeof it.scope === 'string' && it.scope) ? it.scope : 'default'
    let g = groups.get(scope)
    if (!g) {
      g = { scope, total: 0, reachable: scopeReachable(scope, { exists }), archived: 0, lastSeenAt: null }
      groups.set(scope, g)
    }
    g.total++
    if (it && it.archived) g.archived++
    const t = lastSeenAt(it)
    if (t != null && (g.lastSeenAt == null || t > g.lastSeenAt)) g.lastSeenAt = t
  }
  const clamp = (t) => {
    if (t == null) return null
    return typeof now === 'number' && Number.isFinite(now) && t > now ? now : t
  }
  const byScope = [...groups.values()]
    .map((g) => ({ ...g, lastSeenAt: clamp(g.lastSeenAt) }))
    .sort((a, b) => (b.total - a.total) || (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0))
  let deadCount = 0
  const deadScopes = []
  for (const g of byScope) {
    if (g.reachable) continue
    deadScopes.push(g.scope)
    deadCount += g.total
  }
  const total = byScope.reduce((s, g) => s + g.total, 0)


  const reachableCount = total - deadCount
  return { byScope, deadScopes, deadCount, reachableCount, total, aliveCount: reachableCount }
}


function segments(path) {
  return String(path).split('/').filter(Boolean)
}


export function migrationHint(deadScope, { candidates = [] } = {}) {
  const from = deadScope
  const deadPath = scopePath(deadScope)
  if (deadPath === null) {
    return { from, to: null, reason: '不是 project:<path> 形式的 scope，无需也无法按路径迁移' }
  }
  if (!deadPath) {
    return { from, to: null, reason: 'project scope 缺少路径，无法做路径后缀匹配' }
  }
  const deadSegs = segments(deadPath)
  const deadBase = deadSegs[deadSegs.length - 1] ?? ''
  const list = Array.isArray(candidates) ? candidates : []
  let best = null
  for (const cand of list) {
    if (typeof cand !== 'string' || cand === deadScope) continue
    const p = scopePath(cand)
    if (p === null || !p) continue
    const segs = segments(p)
    if ((segs[segs.length - 1] ?? '') !== deadBase) continue
    let shared = 0
    while (
      shared < segs.length && shared < deadSegs.length &&
      segs[segs.length - 1 - shared] === deadSegs[deadSegs.length - 1 - shared]
    ) shared++
    const extraPrefix = segs.length - shared
    if (
      !best || shared > best.shared ||
      (shared === best.shared && extraPrefix < best.extraPrefix) ||
      (shared === best.shared && extraPrefix === best.extraPrefix && cand < best.to)
    ) best = { to: cand, shared, extraPrefix }
  }
  if (!best) {
    return { from, to: null, reason: `候选里没有末段同为「${deadBase}」的可达 scope，需要人工指定目标` }
  }
  const stalePrefix = deadSegs.length - best.shared
  return {
    from,
    to: best.to,
    reason: `路径末 ${best.shared} 段匹配「${deadSegs.slice(deadSegs.length - best.shared).join('/')}」；原路径有 ${stalePrefix} 段前缀已失效，人工确认后可用 migrateScope 迁移`,
  }
}
