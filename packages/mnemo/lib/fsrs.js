


import { CURVE, FORGET } from './config.js'


export function factor(decay) {
  return Math.pow(0.9, -1 / decay) - 1
}


export function retrievability(ageDays, stability, decay = CURVE.DECAY) {
  const t = Math.max(0, ageDays)
  const S = Math.max(CURVE.S_MIN, stability)
  const F = factor(decay)
  return Math.pow(1 + (F * t) / S, -decay)
}


export function ageForRetrievability(r, stability, decay = CURVE.DECAY) {
  const target = Math.min(0.999999, Math.max(1e-6, r))
  const S = Math.max(CURVE.S_MIN, stability)
  const F = factor(decay)

  return (S / F) * (Math.pow(target, -1 / decay) - 1)
}


export function levelOf(r, levels = null, ctx = {}) {
  const L = levels ?? { R_A_ACTIVE: 0.85, R_B_LATENT: 0.5, R_C_DORMANT: 0.15 }
  if (r >= L.R_A_ACTIVE) return 'A'
  if (L.DAYS_D_ARCHIVED != null) {
    const idle = ctx.idleDays ?? 0
    const S = ctx.S ?? Infinity
    if (r < L.R_C_DORMANT && idle >= L.DAYS_D_ARCHIVED && S <= (L.S_D_ARCHIVED ?? Infinity)) return 'D'
    if (r < L.R_B_LATENT && idle >= (L.DAYS_C_DORMANT ?? 0)) return 'C'
    return 'B'
  }

  if (r >= L.R_B_LATENT) return 'B'
  if (r >= L.R_C_DORMANT) return 'C'
  return 'D'
}


export const LEVEL_ORDER = { A: 3, B: 2, C: 1, D: 0 }


export const LEVEL_BOUNDS = { D: [0, 0.15], C: [0.15, 0.50], B: [0.50, 0.85], A: [0.85, 1.0] }


export function targetRForLevel(nextLevel, rAfter) {
  const b = LEVEL_BOUNDS[nextLevel]
  if (!b) return Math.min(0.99, rAfter)
  const lo = b[0] + (b[1] - b[0]) * 0.08
  const hi = b[1] - (b[1] - b[0]) * 0.04
  return Math.min(hi, Math.max(lo, rAfter))
}


export function stepLevel(level, delta) {
  const order = LEVEL_ORDER[level] ?? 0
  const next = Math.min(3, Math.max(0, order + delta))
  return ['D', 'C', 'B', 'A'][next]
}


export function gainStability(S, rBefore, boost, eta, ceil = CURVE.S_CEIL) {
  const r = Math.min(1, Math.max(0, rBefore))
  const b = Math.min(1, Math.max(0, boost))
  const grew = S * (1 + eta * b * (1 - r))
  return Math.min(ceil, CURVE.S_MAX, Math.max(CURVE.S_MIN, grew))
}


function clamp01(x) {
  if (!Number.isFinite(x)) return 0
  return Math.min(1, Math.max(0, x))
}


export function decayStability(S, options = {}) {
  const {
    idleDays = 0,
    upCount = 0,
    decayPerDay = FORGET?.S_DECAY_PER_DAY ?? 0.002,
    floor = CURVE.S_MIN,
  } = options ?? {}


  const lo = Math.max(CURVE.S_MIN, Number.isFinite(floor) ? floor : CURVE.S_MIN)
  const s0 = Math.max(lo, Number.isFinite(S) ? S : lo)
  const idle = Math.max(0, Number.isFinite(idleDays) ? idleDays : 0)
  const used = Math.max(0, Number.isFinite(upCount) ? upCount : 0)
  const resistance = 1 / (1 + used)
  const rate = Math.min(0.999, Math.max(0, (Number.isFinite(decayPerDay) ? decayPerDay : 0) * resistance))
  return Math.max(lo, s0 * Math.pow(1 - rate, idle))
}


export function archiveEligibility(item, options = {}) {
  const opts = options ?? {}
  const maxS = opts.maxS ?? opts.maxStability ?? FORGET?.S_MAX_ARCHIVED ?? 2.0
  const minIdle = opts.minIdle ?? opts.minIdleDays ?? FORGET?.MIN_IDLE_DAYS ?? 60
  const maxTouches = opts.maxTouches ?? opts.maxUpCount ?? FORGET?.MAX_TOUCHES ?? 2

  const touchAt = item?.touchAt ?? item?.born ?? 0
  const nowDays = Number.isFinite(opts.nowDays) ? opts.nowDays : (Number.isFinite(opts.now) ? opts.now : null)
  const idleDays = Number.isFinite(opts.idleDays)
    ? Math.max(0, opts.idleDays)
    : Math.max(0, (nowDays ?? 0) - touchAt)


  const pinned = item?.pinned === true
  const confirmed = item?.trust === 'confirmed'
  const archived = item?.archived === true
  const upCount = Math.max(0, Number.isFinite(item?.upCount) ? item.upCount : 0)
  const extraUse = Math.max(0, upCount - maxTouches)
  const protectedIdle = minIdle * (1 + extraUse)
  const S = Number.isFinite(item?.S) ? item.S : (Number.isFinite(opts.S) ? opts.S : CURVE.S_MIN)

  const reasons = []
  if (archived) reasons.push('already-archived')
  if (pinned) reasons.push('pinned')
  if (confirmed) reasons.push('human-confirmed')
  if (extraUse > 0 && idleDays < protectedIdle) reasons.push('too-many-consolidations')
  if (idleDays < minIdle) reasons.push('not-idle-enough')
  if (S > maxS) reasons.push('stability-too-high')


  let score = 0
  if (!archived && !pinned && !confirmed) {
    const sScore = maxS > 0 ? clamp01(maxS / Math.max(S, 1e-9)) : 0
    const iScore = protectedIdle > 0 ? clamp01(idleDays / protectedIdle) : 1
    const uScore = 1 / (1 + upCount)
    const rScore = Number.isFinite(opts.r) ? clamp01(1 - opts.r) : 1
    score = Math.round((0.3 * sScore + 0.3 * iScore + 0.2 * uScore + 0.1 * rScore + 0.1) * 1e4) / 1e4
  }

  return { eligible: reasons.length === 0, reasons, score }
}


export function boostRetrievability(rBefore, boost, kBoost) {
  const r = Math.min(1, Math.max(0, rBefore))
  const b = Math.min(1, Math.max(0, boost))
  const boosted = r + b * kBoost * (1 - r)


  return Math.max(r, Math.min(0.999999, boosted))
}


export function ageForTargetR(targetR, S, decay = CURVE.DECAY) {
  return ageForRetrievability(targetR, S, decay)
}


export function snapshotR(item, nowDays, decay = CURVE.DECAY) {
  return retrievability(nowDays - item.born, item.S, decay)
}


export function ageOf(item, nowDays) {
  return nowDays - item.born
}


export function idleDaysOf(item, nowDays) {
  return nowDays - (item.touchAt ?? item.born)
}


export function isHealthyR(r) {
  return Number.isFinite(r) && r >= 0 && r <= 1
}
