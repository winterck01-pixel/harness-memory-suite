


import { ROUTER } from './config.js'


export const SLOW_HOLD_TURNS = 6


export const RECALL_INTENT_KEYWORDS = [

  '记得', '记不记得', '回忆', '回顾', '之前', '上次', '上回', '那个', '那个方案',
  '继续', '接着', '刚才', '前面', '还没', '说过', '提过', '定过', '约定',

  'remember', 'recall', 'previous', 'earlier', 'last time', 'we discussed',
  'we decided', 'what did', 'continue', 'where were we',
]


const CJK_RE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}


function compileMatchers(keywords = []) {
  return keywords.map((raw) => {
    const kw = String(raw)
    if (CJK_RE.test(kw)) {
      const needle = kw.toLowerCase()
      return { kw, test: (lower) => lower.includes(needle) }
    }
    const term = kw.trim()

    if (!term || !/\w/.test(term)) {
      const needle = term.toLowerCase()
      return { kw, test: (lower) => lower.includes(needle) }
    }
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i')
    return { kw, test: (_lower, original) => re.test(original) }
  })
}

export class ModeRouter {
  constructor(cfg = ROUTER) {
    this.cfg = cfg
    this.mode = 'fast'
    this.positiveStreak = 0
    this.sessionSticky = false
    this.session = null
    this.history = []
    this.lastTurn = undefined

    this.noTriggerStreak = 0
    this.matchers = compileMatchers(cfg.SLOW_KEYWORDS)


    this.recallMatchers = compileMatchers(
      cfg.RECALL_INTENT_KEYWORDS ?? cfg.RECALL_INTENT ?? RECALL_INTENT_KEYWORDS,
    )
  }


  reset(session = null) {
    this.session = session
    this.sessionSticky = false
    this.positiveStreak = 0
    this.noTriggerStreak = 0
    this.lastTurn = undefined
    this.mode = 'fast'
    return this
  }


  route(s = {}) {
    if (s.session && s.session !== this.session) {
      this.lastTurn = undefined
      this.session = s.session


      this.sessionSticky = false
      this.mode = 'fast'
      this.positiveStreak = 0
      this.noTriggerStreak = 0
    }

    const newTurn = s.turn == null || s.turn !== this.lastTurn
    this.lastTurn = s.turn
    const triggers = []
    const reasons = []


    const text = String(s.text ?? '')
    const lower = text.toLowerCase()
    for (const m of this.matchers) {
      if (m.test(lower, text)) { triggers.push(`keyword:${m.kw}`); break }
    }
    if (triggers.length) reasons.push('命中关键词')


    for (const m of this.recallMatchers) {
      if (m.test(lower, text)) { triggers.push(`recall_intent:${m.kw}`); break }
    }
    if (triggers.some((t) => t.startsWith('recall_intent:'))) reasons.push('召回意图')


    if (typeof s.affect === 'number' && s.affect < 0) {
      const strength = Math.abs(s.affect)

      triggers.push(`affect:${s.affect.toFixed(2)}`)
      reasons.push(strength >= 0.4 ? '负性情绪（强）' : '负性情绪')
    }
    if (typeof s.confidence === 'number' && s.confidence < 0.4) {
      triggers.push(`low_confidence:${s.confidence.toFixed(2)}`)
      reasons.push('把握不足')
    }
    if (s.toolError) { triggers.push('tool_error'); reasons.push('工具报错') }
    if (s.userCorrect) { triggers.push('user_correct'); reasons.push('用户纠正') }


    const kc = s.knownCues ?? 0
    const ke = s.knownEntities ?? 0
    if (kc + ke >= (this.cfg.KNOWN_MIN ?? 1)) {
      triggers.push(`known:${kc}c${ke}e`)
      reasons.push(`提到了记得的东西（线索 ${kc} · 实体 ${ke}）`)
    }


    const SURPRISE_PREFIX = ['affect:', 'low_confidence:', 'tool_error', 'user_correct']
    const surpriseHit = triggers.some((t) => SURPRISE_PREFIX.some((p) => t.startsWith(p)))
    const shouldSlow = triggers.length > 0

    let switched = false
    if (shouldSlow) {
      if (this.mode !== 'slow') { switched = true }
      this.mode = 'slow'
      this.positiveStreak = 0

      this.noTriggerStreak = 0
      if (this.cfg.STICKY_WITHIN_SESSION) this.sessionSticky = true
    } else if (this.mode === 'slow') {
      if (this.sessionSticky) {


        const hold = this.cfg.SLOW_HOLD_TURNS ?? SLOW_HOLD_TURNS
        if (newTurn) this.noTriggerStreak++
        if (this.noTriggerStreak > hold) {
          this.mode = 'fast'
          this.sessionSticky = false
          this.noTriggerStreak = 0
          switched = true
          reasons.push(`连续 ${hold} 轮无召回需求，回落快模式`)
        } else {
          reasons.push(`会话内粘滞，保持慢模式（无召回需求 ${this.noTriggerStreak}/${hold}）`)
        }
      } else {

        const isPositive = (typeof s.affect !== 'number' || s.affect >= 0) && !s.toolError && !s.userCorrect
        if (isPositive && newTurn) this.positiveStreak++
        else if (isPositive) {                                          }
        else this.positiveStreak = 0
        if (this.positiveStreak >= this.cfg.SLOW_EXIT_PATIENCE) {
          this.mode = 'fast'
          this.positiveStreak = 0
          switched = true
          reasons.push(`连续 ${this.cfg.SLOW_EXIT_PATIENCE} 轮正性，回落快模式`)
        } else {
          reasons.push(`保持慢模式（正性 ${this.positiveStreak}/${this.cfg.SLOW_EXIT_PATIENCE}）`)
        }
      }
    }

    const entry = { at: Date.now(), mode: this.mode, triggers, switched, surpriseHit }
    this.history.push(entry)
    if (this.history.length > 200) this.history.shift()

    return {
      mode: this.mode,
      switched,
      reason: reasons.join(' · ') || '无信号，快模式',
      triggers,
      surpriseHit,
    }
  }


  shouldInject() {
    return this.mode === 'slow'
  }


  shouldUseHeavyRetrieval() {
    return this.mode === 'slow'
  }


  shouldDecompose(signal) {
    return this.mode === 'slow' && typeof signal?.affect === 'number' && signal.affect < 0
  }

  stats() {
    const slow = this.history.filter((h) => h.mode === 'slow').length
    return {
      mode: this.mode,
      sessionSticky: this.sessionSticky,
      positiveStreak: this.positiveStreak,
      noTriggerStreak: this.noTriggerStreak,
      slowRatio: this.history.length ? slow / this.history.length : 0,
      historySize: this.history.length,
    }
  }
}
