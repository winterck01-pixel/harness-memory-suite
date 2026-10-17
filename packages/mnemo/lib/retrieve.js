


import { RESONANCE, RETRIEVE } from './config.js'
import { entityOverlap } from './entity.js'
import { fieldRelevance, relevanceCorpus } from './relevance.js'


const R_TRUST_DEFAULT = 0.10
const MIN_SIGNAL_DEFAULT = 0.18

const SOURCE_WEIGHT_FLOOR = 0.5

const num = (v, d) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v))
const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(Number(v)) ? Number(v) : 0))


export function jaccard(a, b) {
  if (!a?.length || !b?.length) return 0
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  const uni = sa.size + sb.size - inter
  return uni ? inter / uni : 0
}

export function overlapCoefficient(a, b) {
  if (!a?.length || !b?.length) return 0
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  return inter / Math.min(sa.size, sb.size)
}


export function cueResonance(aCues, bCues, entities = null) {
  const sa = new Set(aCues ?? [])
  const sb = new Set(bCues ?? [])
  const jac = jaccard(aCues, bCues)
  const ovc = overlapCoefficient(aCues, bCues)
  const denom = Math.sqrt(Math.max(1, sa.size) * Math.max(1, sb.size))
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  const cos = inter / denom
  const R = RESONANCE
  const ent = entities ? entityOverlap(entities.a, entities.b) : 0
  const wSum = R.W_JAC + R.W_OVC + R.W_COS + (entities ? R.W_ENT : 0)
  return (R.W_JAC * jac + R.W_OVC * ovc + R.W_COS * cos + (entities ? R.W_ENT * ent : 0)) / wSum
}


export function lexTokens(text) {
  if (!text) return []
  const s = String(text).toLowerCase()
  const out = new Set()

  for (const w of s.match(/[a-z0-9]{2,}/g) ?? []) out.add(w)

  const cjk = s.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const run of cjk) {
    if (run.length === 1) { out.add(run); continue }
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2))
  }
  return [...out]
}


export function lexicalSimilarity(textA, textB) {
  return cueResonance(lexTokens(textA), lexTokens(textB))
}


export function sourceWeight(item) {
  const source = item?.source
  const trust = item?.trust ?? (source === 'human' ? 'reported' : 'unverified')
  let w
  if (source === 'human' && trust !== 'unverified') w = 1.0
  else if (trust === 'confirmed') w = 0.95
  else if (source === 'human') w = 0.85
  else if (trust === 'reported') w = 0.8
  else w = 0.55
  return Math.max(SOURCE_WEIGHT_FLOOR, Math.min(1, w))
}


const weights = (cfg) => ({
  cue: num(cfg?.R_CUE, RETRIEVE.R_CUE),
  entity: num(cfg?.R_ENTITY, RETRIEVE.R_ENTITY),
  lexical: num(cfg?.R_LEXICAL, RETRIEVE.R_LEXICAL),
  trust: num(cfg?.R_TRUST, RETRIEVE.R_TRUST ?? R_TRUST_DEFAULT),
  prior: num(cfg?.R_PRIOR, RETRIEVE.R_PRIOR),
})


export function signalScore({ cues = [], entities = [], text = '', item = {}, cfg = RETRIEVE, priorOf = null, corpus = null } = {}) {
  const w = weights(cfg)


  const cue = clamp01(cueResonance(cues, item?.cues, { a: entities, b: item?.entities }))
  const entity = clamp01(entityOverlap(entities, item?.entities))
  const lexical = clamp01(cueResonance(lexTokens(text), lexTokens(item?.text)))
  const trust = clamp01(sourceWeight(item))
  const prior = typeof priorOf === 'function' ? clamp01(priorOf(item)) : 0
  const field = fieldRelevance({ text, cues, entities, item, corpus })
  const signal = clamp01(field.relevance)

  const score = (w.cue + w.entity + w.lexical) * signal + w.trust * trust + w.prior * prior
  return { score, parts: { cue, entity, lexical, trust, prior, signal,
    anchor: clamp01(field.anchor), topic: clamp01(field.topic), identifier: clamp01(field.identifier) } }
}


function admits(item, parts, cfg) {
  if (item?.pinned) return true
  const minSignal = num(cfg?.MIN_SIGNAL, RETRIEVE.MIN_SIGNAL ?? MIN_SIGNAL_DEFAULT)
  return parts.signal >= minSignal
}


export function rankCandidates({ cues = [], entities = [], text = '', candidates = [], priorOf = () => 0, cfg = RETRIEVE }) {
  const scored = []
  const corpus = relevanceCorpus(candidates ?? [], text)
  for (const it of candidates ?? []) {
    if (it.pinned && it.kind === 'rule') {

      scored.push({
        item: it,
        score: 1,
        parts: {
          cue: 1, entity: 1, lexical: 1,
          trust: sourceWeight(it),
          prior: clamp01(priorOf(it)),
          signal: 1,
          pinned: true,
        },
      })
      continue
    }
    const { score, parts } = signalScore({ cues, entities, text, item: it, cfg, priorOf, corpus })
    scored.push({ item: it, score, parts })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored
}


export function retrieve(options = {}) {
  const cfg = options.cfg ?? RETRIEVE
  return rankCandidates(options)
    .filter((s) => admits(s.item, s.parts, cfg))
    .slice(0, num(cfg?.TOP_K, RETRIEVE.TOP_K))
}


export function pointerCandidates(pointers, { scope = null, cues = [], entities = [], text = '', cfg = RETRIEVE } = {}) {
  if (!Array.isArray(pointers) || pointers.length === 0) return []
  const out = []
  for (let i = 0; i < pointers.length; i++) {
    const p = pointers[i]
    if (!p || typeof p !== 'object') continue
    if (scope != null && p.scope != null && p.scope !== scope) continue
    const item = {
      id: 'pointer:' + (p.id ?? `${p.at ?? 'na'}:${i}`),
      text: p.topic ?? p.text ?? '',
      cues: Array.isArray(p.cues) ? p.cues : [],
      entities: Array.isArray(p.entities) ? p.entities : [],
      scope: p.scope ?? scope ?? null,
      source: p.source ?? 'agent',
      trust: 'unverified',
      pointer: true,
    }
    const { score, parts } = signalScore({ cues, entities, text, item, cfg })
    if (!admits(item, parts, cfg)) continue
    out.push({ item, score: score * 0.5, parts: { ...parts, pointer: true }, pointer: true })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}


export function spontaneousRecall(candidates, priorOf, { lo = 0.15, hi = 0.5, max = 6 } = {}) {
  const inBand = []
  for (const it of candidates) {
    if (it.pinned) continue
    const r = priorOf(it)
    if (r > lo && r < hi) inBand.push({ item: it, r })
  }
  inBand.sort((a, b) => a.r - b.r)
  return inBand.slice(0, max)
}


export function assertPartsInRange(parts) {
  for (const [k, v] of Object.entries(parts)) {
    if (typeof v !== 'number') continue
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      throw new Error(`检索分量越界: ${k}=${v}`)
    }
  }
}
