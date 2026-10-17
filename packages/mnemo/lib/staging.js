import { selectCaptureText, filterAgentCaptureText, detectUserCorrection, captureClauses, wholeTurnOptOut } from './capture-policy.js'
import {randomUUID} from 'node:crypto'
import {sameHistoricalStatement} from './temporal.js'


import { STAGING, BOUNDS } from './config.js'
import { isNoiseWord } from './stopwords.js'
import { detectDecisions, extractCueTokens } from './decisions.js'


export const SOURCE = { HUMAN: 'human', AGENT: 'agent' }


export const STAGING_DEFAULTS = { ...STAGING, WINDOW_OFFERS: 100 }


export const ECHO_OVERLAP_THRESHOLD = 0.6
export const ECHO_MIN_SHARED_TOKENS = 3


export const ECHO_MIN_NOVEL_TOKENS = 3


export const ECHO_MAX_NOVEL_RATIO = 0.45

export const ECHO_CUE_COVERAGE = 0.6

export const ECHO_MAX_NOVEL_CUES = 1


function bound(cfg, key, fallback) {
  return cfg?.bounds?.[key] ?? cfg?.[key] ?? fallback
}


const SHORT_LATIN = /^[a-z]{1,6}$/i


export function isAutoEntityExempt(surface) {
  if (!surface) return false
  const s = String(surface)
  if (SHORT_LATIN.test(s)) return false
  return true
}


export function filterOptedOutClauses(text) {


 const source=String(text ?? '')
 const clauses=captureClauses(source)
 const dropped=clauses.some(c=>c.excluded)
 if (!dropped) return {text:source,dropped:false,wholeTurn:false}
 if (wholeTurnOptOut(source)) return {text:'',dropped:true,wholeTurn:true}

 return {text:clauses.filter(c=>!c.excluded).map(c=>c.raw).join(''),dropped:true,wholeTurn:false}
}


function boundMap(map, max) {
  if (!map || !max || map.size <= max) return map
  const drop = map.size - max
  let n = 0
  for (const key of map.keys()) { map.delete(key); if (++n >= drop) break }
  return map
}


function boundSet(set, max) {
  if (!set || !max || set.size <= max) return set
  const drop = set.size - max
  let n = 0
  for (const key of set) { set.delete(key); if (++n >= drop) break }
  return set
}


function informativeTokens(entry) {
  const out = new Set()
  for (const c of entry?.cues ?? []) {
    if (c && !isNoiseWord(c)) out.add(String(c).toLowerCase())
  }
  for (const d of entry?.decisions ?? []) {
    if (d?.value != null) out.add(String(d.value).toLowerCase())
  }
  const text = String(entry?.text ?? '').toLowerCase()
  for (const t of text.match(/[\p{Script=Han}]{2,}|[a-z][a-z0-9_+.#-]{1,}/gu) ?? []) {
    if (!isNoiseWord(t)) out.add(t)
  }
  return out
}


function agentHasNovelSubstance(entry, humanEntries) {
  let best = null
  for (const h of humanEntries) {
    if (!h.tokens.size) continue
    let inter = 0
    for (const t of h.tokens) if (informativeTokens(entry).has(t)) inter++
    const cov = inter / h.tokens.size
    if (!best || cov > best.cov) best = { cov, tokens: h.tokens }
  }
  if (!best) return false
  const tokens = informativeTokens(entry)
  let novel = 0
  for (const t of tokens) if (!best.tokens.has(t)) novel++
  return novel >= ECHO_MIN_NOVEL_TOKENS
}


function isContentSubset(b, a) {
  if (!b.size) return false
  for (const t of b) if (!a.has(t)) return false
  return true
}


function contentSkeleton(text) {
  return String(text ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}


function containsHumanSpan(agentText, humanText) {
  const agent = contentSkeleton(agentText)
  if (!agent) return false
  const spans = String(humanText ?? '').toLowerCase().match(/[\p{Script=Han}]{3,}|[a-z][a-z0-9_+.#-]{3,}/gu) ?? []
  for (const span of spans) {
    if (isNoiseWord(span)) continue
    if (agent.includes(span)) return true
  }
  return false
}

export class StagingArea {


  constructor(cfg = STAGING_DEFAULTS) {
    this.cfg = cfg

    this.pending = []

    this.pointers = []

    this.cueCount = new Map()


    this.cueDoc = new Map()

    this.cueLastOffer = new Map()

    this.cueProtected = new Set()

    this.offerSeq = 0
    this.captureKeys = new Set()
    this.scopeStats = new Map()


    this._lastOfferNow = 0
  }


  offer({ text, cues = [], entities = [], scope = 'default', affect = 0, fastMode = false, source = SOURCE.AGENT, now = Date.now(), session = null, evidence = [], captureKey = null, decisions = null, knownCues = [] }) {
    if (captureKey && this.captureKeys.has(captureKey)) {

      this.captureKeys.delete(captureKey)
      this.captureKeys.add(captureKey)
      return {duplicate:true,captureKey}
    }
    const originalText=String(text ?? '')
    const selected=selectCaptureText(originalText)
    text=source===SOURCE.AGENT ? filterAgentCaptureText(selected.text) : selected.text
    if (!String(text).trim()) return {skipped:selected.dropped ? 'capture-excluded' : 'agent-process-only'}
    if (text!==originalText) {


      if(!Array.isArray(cues)||!cues.length)cues=extractCueTokens(text)
      entities=[]
      decisions=null
    }

    if (Number.isFinite(now) && now <= this._lastOfferNow) now = this._lastOfferNow + 1
    if (Number.isFinite(now)) this._lastOfferNow = now


    const decisionList = (Array.isArray(decisions) && decisions.length
      ? decisions
      : detectDecisions(text, { requireValue: source !== SOURCE.HUMAN })
    ).slice(0, 32)
    if (source===SOURCE.HUMAN && detectUserCorrection(text) && decisionList.length<32) {
      decisionList.push({kind:'correction',value:null,clause:text})
    }

    if (captureKey) this.captureKeys.add(captureKey)
    if (captureKey) boundSet(this.captureKeys, bound(this.cfg, 'STAGING_CAPTURE_KEYS', BOUNDS.STAGING_CAPTURE_KEYS))


    const windowOffers = bound(this.cfg, 'WINDOW_OFFERS', STAGING_DEFAULTS.WINDOW_OFFERS)
    if (windowOffers > 0 && this.offerSeq >= windowOffers) this._resetWindow()
    this.offerSeq++
    this._countScope(scope, cues, entities, 1, knownCues)
    for (const c of cues) {


      const owned = this.cueCount.get(c)
      this.cueCount.delete(c)
      this.cueCount.set(c, (owned ?? 0) + 1)
      if (this.cueLastOffer.get(c) !== this.offerSeq) {
        const doc = (this.cueDoc.get(c) ?? 0) + 1
        this.cueDoc.delete(c)
        this.cueDoc.set(c, doc)
        this.cueLastOffer.delete(c)
        this.cueLastOffer.set(c, this.offerSeq)
      } else {
        const last = this.cueLastOffer.get(c)
        this.cueLastOffer.delete(c)
        this.cueLastOffer.set(c, last)
      }
    }


    for (const e of entities) {
      if (!e || !isAutoEntityExempt(e)) continue
      this.cueProtected.delete(e)
      this.cueProtected.add(e)
    }
    for (const k of knownCues) {
      if (!k) continue
      this.cueProtected.delete(k)
      this.cueProtected.add(k)
    }


    boundMap(this.cueCount, bound(this.cfg, 'CUE_KEYS_PER_SCOPE', BOUNDS.CUE_KEYS_PER_SCOPE))
    boundMap(this.cueDoc, bound(this.cfg, 'CUE_KEYS_PER_SCOPE', BOUNDS.CUE_KEYS_PER_SCOPE))
    boundMap(this.cueLastOffer, bound(this.cfg, 'CUE_KEYS_PER_SCOPE', BOUNDS.CUE_KEYS_PER_SCOPE))
    boundSet(this.cueProtected, bound(this.cfg, 'CUE_PROTECTED', BOUNDS.CUE_PROTECTED))


    boundSet(this.captureKeys, bound(this.cfg, 'STAGING_CAPTURE_KEYS', BOUNDS.STAGING_CAPTURE_KEYS))


    const dup = this.pending.find((p) => p.scope === scope && sameHistoricalStatement(p, {text,evidence,firstSeen:now}))
    if (dup) {
      dup.repeats++
      dup.lastSeen = now
      for (const c of cues) if (!dup.cues.includes(c)) dup.cues.push(c)
      if (decisionList.length) {
        dup.decisions ??= []
        for (const d of decisionList) {
          if (dup.decisions.length >= 32) break
          if (!dup.decisions.some((old) => old.kind === d.kind && (old.value ?? null) === (d.value ?? null))) dup.decisions.push(d)
        }
      }
      dup.affect = Math.abs(affect) > Math.abs(dup.affect) ? affect : dup.affect


      if (source === SOURCE.HUMAN) dup.source = SOURCE.HUMAN
      for (const ev of evidence) if (!dup.evidence?.some(old=>JSON.stringify(old)===JSON.stringify(ev))) (dup.evidence ??= []).push(ev)
      return { merged: true, entry: dup }
    }
    const entry = {
      id: `s-${randomUUID()}`,
      text, cues: [...cues], entities: [...entities], scope, evidence,
      affect, fastMode, source, session,
      decisions: [...decisionList],
      firstSeen: now, lastSeen: now, repeats: 1,
      captured: false,

      channel: null,

      echo: false,
    }
    this.pending.push(entry)

    this._enforcePendingBound()
    return { merged: false, entry }
  }


  _resetWindow() {
    this.offerSeq = 0
    this.cueCount.clear()
    this.cueDoc.clear()
    this.cueLastOffer.clear()
    for (const stats of this.scopeStats.values()) {
      stats.offers = 0
      stats.count.clear()
      stats.doc.clear()
    }
  }


  _countScope(scope, cues, entities, repeats = 1, knownCues = []) {
    const stats = this.scopeStats.get(scope) ?? {offers:0, count:new Map(), doc:new Map(), protected:new Set()}
    stats.offers += repeats


    for (const cue of cues) {
      const n = stats.count.get(cue) ?? 0
      stats.count.delete(cue)
      stats.count.set(cue, n + repeats)
    }
    for (const cue of new Set(cues)) {
      const n = stats.doc.get(cue) ?? 0
      stats.doc.delete(cue)
      stats.doc.set(cue, n + repeats)
    }

    for (const entity of entities) {
      if (!entity || !isAutoEntityExempt(entity)) continue
      stats.protected.delete(entity)
      stats.protected.add(entity)
    }
    for (const known of knownCues) {
      if (!known) continue
      stats.protected.delete(known)
      stats.protected.add(known)
    }

    const perScope = bound(this.cfg, 'CUE_KEYS_PER_SCOPE', BOUNDS.CUE_KEYS_PER_SCOPE)
    boundMap(stats.count, perScope)
    boundMap(stats.doc, perScope)
    boundSet(stats.protected, bound(this.cfg, 'CUE_PROTECTED', BOUNDS.CUE_PROTECTED))

    this.scopeStats.delete(scope)
    this.scopeStats.set(scope, stats)
    const maxScopes = bound(this.cfg, 'SCOPE_STATS', BOUNDS.SCOPE_STATS)
    if (this.scopeStats.size > maxScopes) {
      for (const key of [...this.scopeStats.keys()].slice(0, this.scopeStats.size - maxScopes)) this.scopeStats.delete(key)
    }
  }


  _touchMap(map, key) {
    if (!map || !map.has(key)) return map
    const value = map.get(key)
    map.delete(key)
    map.set(key, value)
    return map
  }

  isBackgroundNoise(cue, scope = null) {
    const stats = scope == null ? null : this.scopeStats.get(scope)
    if (scope != null && !stats) return false
    if (!cue || (stats?.protected ?? this.cueProtected).has(cue)) return false
    const minOffers = this.cfg.NOISE_MIN_OFFERS ?? 4
    const dfMax = this.cfg.NOISE_DF ?? 0.30
    const countMap = stats?.count ?? this.cueCount
    const docMap = stats?.doc ?? this.cueDoc
    const count = countMap.get(cue) ?? 0


    this._touchMap(countMap, cue)
    this._touchMap(docMap, cue)
    if (count < minOffers) return false
    const offers = Math.max(1, stats?.offers ?? this.offerSeq)
    const df = (docMap.get(cue) ?? 0) / offers
    return df >= dfMax
  }


  _pointerFor(entry) {
    return {
      topic: summarizeTopic(entry),
      at: entry.lastSeen,
      affect: entry.affect,
      scope: entry.scope,
      cues: (entry.cues ?? []).slice(0, 4),
      source: entry.source,
      session: entry.session,
    }
  }


  _enforcePendingBound() {
    const cap = bound(this.cfg, 'PENDING_ENTRIES', BOUNDS.PENDING_ENTRIES)
    if (!cap || this.pending.length <= cap) return this.pending
    let excess = this.pending.length - cap
    const keep = []
    for (const entry of this.pending) {
      if (excess > 0 && !entry.captureIntent) {
        this.pointers.push(this._pointerFor(entry))
        excess--
        continue
      }
      keep.push(entry)
    }
    this.pending = keep
    if (this.pointers.length > this.cfg.MAX_POINTERS) this.pointers = this.pointers.slice(-this.cfg.MAX_POINTERS)
    return this.pending
  }


  isInformative(entry) {
    if (!entry) return false
    if ((entry.cues ?? []).some((c) => !this.isBackgroundNoise(c, entry.scope))) return true


    const tokens = String(entry.text ?? '').toLowerCase().match(/[\p{Script=Han}]+|[a-z][a-z0-9_+.#-]*/gu) ?? []
    return tokens.some((t) => !isNoiseWord(t))
  }


  settle({ now = Date.now(), goalCues = [], scope = null, onCapture = null, resonate = null, onPrepared = null, prepareOnly = false } = {}) {
    if(!prepareOnly) {
      const plan=this.settle({now,goalCues,scope,resonate,prepareOnly:true})
      if(plan.planned && onPrepared)onPrepared()
    }
    let changed=false, planned=0
    const ttlMs = this.cfg.TTL_HOURS * 3600 * 1000
    const captured = []
    const dropped = []
    const keep = []
    const echo = []
    const decision = []
    const deduped = []
    const noised = new Set()
    let noisedEntries = 0


    const original = [...this.pending]


    const humanEntries = original
      .filter((e) => (!scope || e.scope === scope) && e.source === SOURCE.HUMAN)
      .map((entry) => ({ entry, tokens: informativeTokens(entry) }))
    const repeatThreshold = Math.max(1, Number(this.cfg.REPEAT_THRESHOLD ?? 2))
    const echoSourceOf = (e) => {
      if (e.source !== SOURCE.AGENT) return null
      const tokens = informativeTokens(e)
      if (!tokens.size) return null
      for (const h of humanEntries) {
        if (h.entry === e || !h.tokens.size) continue


        if (isContentSubset(tokens, h.tokens)) return h.entry


        let inter = 0
        for (const t of tokens) if (h.tokens.has(t)) inter++
        let novel = 0
        for (const t of tokens) if (!h.tokens.has(t)) novel++
        const novelRatio = novel / Math.max(1, tokens.size)


        const hCues = new Set((h.entry.cues ?? []).map((c) => String(c).toLowerCase()).filter(Boolean))
        const eCues = new Set((e.cues ?? []).map((c) => String(c).toLowerCase()).filter(Boolean))
        let sharedCues = 0
        for (const c of hCues) if (eCues.has(c)) sharedCues++
        const cuesCovered = hCues.size > 0 && sharedCues >= Math.max(1, Math.ceil(hCues.size * ECHO_CUE_COVERAGE))
        if (cuesCovered) {


          let novelCues = 0
          for (const c of eCues) if (!hCues.has(c)) novelCues++
          if (novelCues <= ECHO_MAX_NOVEL_CUES) return h.entry
          continue
        }
        if (containsHumanSpan(e.text, h.entry.text)) {
          if (novelRatio <= ECHO_MAX_NOVEL_RATIO) return h.entry
          continue
        }
        if (inter >= 2 && novelRatio <= ECHO_MAX_NOVEL_RATIO && inter / Math.min(tokens.size, h.tokens.size) >= ECHO_OVERLAP_THRESHOLD) return h.entry
        if (inter >= ECHO_MIN_SHARED_TOKENS && novelRatio <= 0.2) return h.entry
      }
      return null
    }

    for (const e of original) {
      const goal = (goalCues ?? []).filter((c) => !this.isBackgroundNoise(c, e.scope) && !isNoiseWord(c))
      if (scope && e.scope !== scope) { keep.push(e); continue }
      const age = now - e.lastSeen
      const expired = age >= ttlMs


      const live = []
      for (const c of e.cues) {
        if (this.isBackgroundNoise(c, e.scope)) { noised.add(c); continue }
        live.push(c)
      }
      const rep = e.repeats >= repeatThreshold && this.isInformative(e)
      let docHit = false
      if (live.length) {
        for (const c of live) {
          let docs = 1
          for (const other of original) {
            if (other === e) continue
            if (other.scope !== e.scope) continue
            if (!other.cues.includes(c)) continue
            if (other.firstSeen !== e.firstSeen || other.source !== e.source) docs++
          }
          if (docs >= repeatThreshold) { docHit = true; break }
        }
      }
      const repeatHit = rep || docHit
      const repeatNoised = !repeatHit && e.cues.some((c) => this.isBackgroundNoise(c, e.scope))
      if (repeatNoised) noisedEntries++


      let repeatHitEffective = rep || docHit
      if (repeatHitEffective && e.source !== SOURCE.HUMAN) repeatHitEffective = agentHasNovelSubstance(e, humanEntries)


      const affectHit = Math.abs(e.affect) >= this.cfg.AFFECT_THRESHOLD


      let goalHit = false
      if (goal.length && live.length) {
        const score = resonate ? resonate(live, goal) : naiveResonance(live, goal)
        goalHit = score >= this.cfg.GOAL_RESONANCE
      }


      const decisionHit = (e.decisions?.length ?? 0) > 0

      const hit = e.captureIntent || e.why?.repeat || e.why?.affect || e.why?.goal || e.why?.decision || repeatHitEffective || affectHit || goalHit || decisionHit


      const echoed = echoSourceOf(e)
      if (echoed) {
        e.echo = true
        e.channel = primaryChannel({ repeatHit, affectHit, goalHit, decisionHit }) ?? 'repeat'
        if (!prepareOnly) {
          this.pending = this.pending.filter((other) => other !== e)
          echo.push(e)
          deduped.push(e)
        }
        continue
      }

      if(prepareOnly) {
        if(hit)planned++
        if(hit && !e.captureIntent) {e.captureIntent=true;e.why={repeat:repeatHitEffective,affect:affectHit,goal:goalHit,decision:decisionHit,repeatNoised};changed=true}
        continue
      }

      if (hit) {
        e.why = { repeat: repeatHit, affect: affectHit, goal: goalHit, decision: decisionHit, repeatNoised }
        e.channel = primaryChannel({ repeatHit, affectHit, goalHit, decisionHit })
        if (e.channel === 'decision') decision.push(e)
        if (onCapture) onCapture(e)
        e.captured = true
        captured.push(e)
        this.pending = this.pending.filter(other => other !== e)
        continue
      }

      if (expired) {

        dropped.push(e)
        this.pending = this.pending.filter(other => other !== e)
        this.pointers.push({
          topic: summarizeTopic(e),
          at: e.lastSeen,
          affect: e.affect,
          scope: e.scope,
          cues: e.cues.slice(0, 4),
          source: e.source,
          session: e.session,
        })
        continue
      }


      keep.push(e)
    }

    if(prepareOnly)return {changed,planned}
    this.pending = keep
    if (this.pointers.length > this.cfg.MAX_POINTERS) {
      this.pointers = this.pointers.slice(-this.cfg.MAX_POINTERS)
    }

    const cueCap = bound(this.cfg, 'CUE_KEYS_PER_SCOPE', BOUNDS.CUE_KEYS_PER_SCOPE)
    if (this.cueCount.size > cueCap * 2) {
      this.cueCount.clear()
      this.cueDoc.clear()
      this.cueLastOffer.clear()
      this.cueProtected.clear()
    }
    return { captured, dropped, kept: keep.length, decision, echo, deduped, noised: [...noised].slice(0, 12), noisedEntries }
  }


  offerFast(text, { scope = 'default', affect = 0, cues = [], source = SOURCE.AGENT, now = Date.now(), session = null, captureKey = null } = {}) {
    if (!this.cfg.FAST_MODE_DEFAULT_DROP) {
      return this.offer({ text, cues, scope, affect, fastMode: true, source, now, session, captureKey })
    }
    if (captureKey && this.captureKeys.has(captureKey)) {

      this.captureKeys.delete(captureKey)
      this.captureKeys.add(captureKey)
      return {duplicate:true,captureKey}
    }
    if (captureKey) {
      this.captureKeys.add(captureKey)
      boundSet(this.captureKeys, bound(this.cfg, 'STAGING_CAPTURE_KEYS', BOUNDS.STAGING_CAPTURE_KEYS))
    }

    this.pointers.push({
      topic: summarizeTopic({ text, cues }),
      at: now, affect, scope, cues: cues.slice(0, 4), source, session, fast: true,
    })
    if (this.pointers.length > this.cfg.MAX_POINTERS) {
      this.pointers = this.pointers.slice(-this.cfg.MAX_POINTERS)
    }
    return { pointerOnly: true, pointers: this.pointers.length }
  }


  recentPointers({ limit = 6, scope = null, now = Date.now() } = {}) {
    return this.pointers
      .filter((p) => !scope || p.scope === scope)
      .map((p) => ({ ...p, ageHours: (now - p.at) / 3600000, salience: Math.abs(p.affect) }))
      .sort((a, b) => (b.salience - a.salience) || (a.ageHours - b.ageHours))
      .slice(0, limit)
  }


  topCues(n = 8) {
    const offers = Math.max(1, this.offerSeq)
    return [...this.cueCount]
      .map(([cue, count]) => ({
        cue,
        count,
        offers: this.cueDoc.get(cue) ?? 0,
        df: Number(((this.cueDoc.get(cue) ?? 0) / offers).toFixed(2)),
        noise: this.isBackgroundNoise(cue),
      }))
      .sort((a, b) => (b.offers - a.offers) || (b.count - a.count))
      .slice(0, n)
  }


  toJSON() {
    return {
      pending: this.pending,
      pointers: this.pointers,
      cueCount: [...this.cueCount],
      cueDoc: [...this.cueDoc],
      cueLastOffer: [...this.cueLastOffer],
      cueProtected: [...this.cueProtected],
      offerSeq: this.offerSeq,
      captureKeys: [...this.captureKeys],
      scopeStats: [...this.scopeStats].map(([scope, s]) => [scope, {offers:s.offers, count:[...s.count], doc:[...s.doc], protected:[...s.protected]}]),
    }
  }

  load(obj) {
    if (!obj) return this
    this.pending = obj.pending ?? []
    this.pointers = obj.pointers ?? []
    this.cueCount = new Map(obj.cueCount ?? [])

    this.cueDoc = new Map(obj.cueDoc ?? [])
    this.cueLastOffer = new Map(obj.cueLastOffer ?? [])
    this.cueProtected = new Set(obj.cueProtected ?? [])
    this.offerSeq = obj.offerSeq ?? 0
    this.captureKeys = new Set(obj.captureKeys ?? [])
    this.scopeStats = new Map((obj.scopeStats ?? []).map(([scope, s]) => [scope, {offers:s.offers, count:new Map(s.count), doc:new Map(s.doc), protected:new Set(s.protected)}]))
    if (!obj.scopeStats) for (const entry of this.pending) this._countScope(entry.scope, entry.cues ?? [], entry.entities ?? [], entry.repeats ?? 1)

    const cueCap = bound(this.cfg, 'CUE_KEYS_PER_SCOPE', BOUNDS.CUE_KEYS_PER_SCOPE)
    boundMap(this.cueCount, cueCap)
    boundMap(this.cueDoc, cueCap)
    boundMap(this.cueLastOffer, cueCap)
    boundSet(this.cueProtected, bound(this.cfg, 'CUE_PROTECTED', BOUNDS.CUE_PROTECTED))
    boundSet(this.captureKeys, bound(this.cfg, 'STAGING_CAPTURE_KEYS', BOUNDS.STAGING_CAPTURE_KEYS))
    this._enforcePendingBound()
    for (const s of this.scopeStats.values()) {
      boundMap(s.count, cueCap)
      boundMap(s.doc, cueCap)
      boundSet(s.protected, bound(this.cfg, 'CUE_PROTECTED', BOUNDS.CUE_PROTECTED))
    }
    const maxScopes = bound(this.cfg, 'SCOPE_STATS', BOUNDS.SCOPE_STATS)
    if (this.scopeStats.size > maxScopes) {
      for (const key of [...this.scopeStats.keys()].slice(0, this.scopeStats.size - maxScopes)) this.scopeStats.delete(key)
    }
    return this
  }

  stats() {
    return {
      pending: this.pending.length,
      pointers: this.pointers.length,
      cueKeys: this.cueCount.size,
      offers: this.offerSeq,

      humanPending: this.pending.filter((e) => e.source === SOURCE.HUMAN).length,
      noiseCues: [...this.cueCount.keys()].filter((c) => this.isBackgroundNoise(c)).length,
    }
  }
}


function primaryChannel({ repeatHit, affectHit, goalHit, decisionHit }) {
  if (decisionHit) return 'decision'
  if (repeatHit) return 'repeat'
  if (affectHit) return 'affect'
  if (goalHit) return 'goal'
  return null
}


function naiveResonance(a, b) {
  const sb = new Set(b)
  let inter = 0
  for (const x of a) if (sb.has(x)) inter++
  if (!inter) return 0
  const jac = inter / (a.length + b.length - inter)
  const ovc = inter / Math.min(a.length, b.length)
  return 0.45 * jac + 0.55 * ovc
}


function summarizeTopic({ text, cues = [] }) {
  const head = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)
  const cuePart = cues.slice(0, 3).join('/')
  return cuePart ? `${cuePart}｜${head}` : head
}

export { naiveResonance }
