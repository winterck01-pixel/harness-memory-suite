
export const TASK_INJECTION_DEFAULTS = Object.freeze({
  mode: 'enforce', failureStreakThreshold: 2, unverifiedAgentLimit: 2,
})

const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const integer = (value, fallback, minimum) => Number.isSafeInteger(value) && value >= minimum ? value : fallback
function equal(a, b) {
  if (Object.is(a, b)) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]))
  if (!plain(a) || !plain(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && equal(a[key], b[key]))
}
function applicability(item, features) {
  if (!plain(item.applicability) || !Object.keys(item.applicability).length) return 'unknown'
  if (!plain(features)) return 'unchecked'
  return Object.keys(item.applicability).every(key => own(features, key) && equal(item.applicability[key], features[key])) ? 'match' : 'mismatch'
}


export function applyTaskInjectionPolicy({ items = [], failureStreak = 0, suppressed = [], taskFeatures, options = {} } = {}) {
  const input = Array.isArray(items) ? items : []
  const cfg = plain(options) ? options : {}
  const mode = cfg.mode === 'shadow' ? 'shadow' : 'enforce'
  const threshold = integer(cfg.failureStreakThreshold, TASK_INJECTION_DEFAULTS.failureStreakThreshold, 1)
  const limit = integer(cfg.unverifiedAgentLimit, TASK_INJECTION_DEFAULTS.unverifiedAgentLimit, 0)
  const failures = integer(failureStreak, 0, 0)
  const suppression = Array.isArray(suppressed) ? suppressed : []
  const output = [], decisions = []
  let admittedUnverified = 0
  const stats = { mode, input: input.length, output: 0, wouldFilter: 0, filtered: 0, protectedSuppressionConflicts: 0, reasons: {} }
  for (const entry of input) {
    const item = entry?.item ?? entry
    const valid = plain(item)
    const version = valid && (typeof item.activeSeq === 'string' || Number.isSafeInteger(item.activeSeq)) ? item.activeSeq : null
    const id = valid && (typeof item.id === 'string' || Number.isSafeInteger(item.id)) ? item.id : null
    const protectedRule = valid && item.kind === 'rule' && (item.source === 'human' || item.pinned === true)
    const suppressedHere = valid && id !== null && version !== null && suppression.some(s => s && s.id === id && s.version === version)
    const structure = valid ? applicability(item, taskFeatures) : 'unknown'
    const confirmed = valid && item.trust === 'confirmed'
    const trial = valid && (item.source === 'task-trial' || item.evidence?.source === 'task-trial' || Array.isArray(item.evidence) && item.evidence.some(e=>e?.source==='task-trial') || item.experienceState === 'trial')
    const agentUnverified = valid && item.source === 'agent' && (item.trust ?? 'unverified') === 'unverified'
    let reason = 'eligible', exclude = false
    if (!valid) { reason = 'invalid-item'; exclude = true }
    else if (protectedRule) {
      reason = suppressedHere ? 'protected-rule-suppression-conflict' : 'protected-rule'
      if (suppressedHere) stats.protectedSuppressionConflicts++
    } else if (suppressedHere) { reason = 'task-suppressed-version'; exclude = true }
    else if (trial && !confirmed) { reason = 'trial-not-confirmed'; exclude = true }
    else if (agentUnverified && item.kind === 'skill') { reason = 'unverified-agent-skill'; exclude = true }
    else if (structure === 'mismatch') { reason = 'applicability-mismatch'; exclude = true }
    else if (agentUnverified && failures >= threshold && admittedUnverified >= limit) { reason = 'runtime-failure-agent-limit'; exclude = true }
    else if (agentUnverified) admittedUnverified++
    if (exclude) stats.wouldFilter++
    stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1
    const action = exclude ? (mode === 'shadow' ? 'would-filter' : 'filter') : 'keep'
    decisions.push({ id, version, action, reason, applicability: structure })
    if (!exclude || mode === 'shadow') output.push(entry)
  }
  stats.output = output.length
  stats.filtered = input.length - output.length
  return { items: output, stats, decisions }
}
