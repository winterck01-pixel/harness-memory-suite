


import { isNoiseWord, extractZhWords } from './stopwords.js'


const MAX_CUES = 16

const MAX_DECISIONS = 32


const LATIN_TOKEN = /[a-z0-9][a-z0-9._+#-]*/g
const EDGE_SEP = /^[._+#-]+|[._+#-]+$/g
const HAS_LETTER = /[a-z]/


export function extractCueTokens(text) {
  if (text == null) return []
  const s = String(text)
  if (!s) return []
  const out = new Set()

  for (const raw of s.toLowerCase().match(LATIN_TOKEN) ?? []) {
    const t = raw.replace(EDGE_SEP, '')
    if (!t || !HAS_LETTER.test(t)) continue
    if (isNoiseWord(t)) continue
    out.add(t)
    if (out.size >= MAX_CUES) break
  }

  if (out.size < MAX_CUES) {
    for (const w of extractZhWords(s)) {
      if (isNoiseWord(w)) continue
      out.add(w)
      if (out.size >= MAX_CUES) break
    }
  }
  return [...out].slice(0, MAX_CUES)
}


const SPEC_ADJACENT = /(?:^|[^a-z0-9])(\d+[a-z][a-z0-9]*|[a-z]\d[a-z0-9]*)(?![a-z0-9])/i

const ASSIGN = /(?:改成|改为|设为|设置为|设定为|调整为|调成|换成|设成|定为)\s*[:：=]?\s*([a-z0-9][a-z0-9._+-]*)/i

const ASSIGN_NOUN = /(?:端口|端口号|\bport\b|版本|\bversion\b|分辨率|\bresolution\b|大小|\bsize\b|上限|\blimit\b|阈值|\bthreshold\b|超时|\btimeout\b)\s*号?\s*[:：=]?\s*([a-z0-9][a-z0-9._+-]*)/i


const NEGATIVE = /(?:不要|永远不用|绝不用|不用|不许|不得|禁止|别用|别碰|无需|不需要|不碰|\bnever\b|\bdo\s+not\b|\bdon't\b|\bavoid\b)\s*([^\s，。；,;.!?！？：:]{0,24})/i


const CONSTRAINT = /(?:只允许|只准|仅限|只能|只做|只支持|只接受|\bonly\s+(?:allow|permit|support|accept|use|run|for)\b|\brequires?\b|\brequired\b)\s*([^\s，。；,;.!?！？：:]{0,24})/i

const IMPERATIVE = /(?:必须|务必|一定要|确保|\balways\b|\bensure\b)\s*([^\s，。；,;.!?！？：:]{0,24})/i


const FOCUS = /(?:优先保证|重点是|首要|\bfocus\b|\bpriority\b)\s*([^\s，。；,;.!?！？：:]{0,24})/i
const CLAUSE_SPLIT = /[，,。.！!？?；;\n]+/

const SPEC_VALUE_KINDS = new Set(['spec', 'negative', 'constraint'])


function normalizeValue(v) {
  if (v == null) return null
  const s = String(v).replace(/[，。；,;.!?！？：:、]+$/g, '').trim().toLowerCase()
  return s || null
}


function specValue(clause) {
  let m = clause.match(ASSIGN)
  if (m) return normalizeValue(m[1])
  m = clause.match(ASSIGN_NOUN)
  if (m) return normalizeValue(m[1])
  m = clause.match(SPEC_ADJACENT)
  if (m) return normalizeValue(m[1])
  return null
}


export function detectDecisions(text, { requireValue = false, minValueLength = 2 } = {}) {
  if (text == null) return []
  const s = String(text)
  if (!s.trim()) return []
  const out = []
  const seen = new Set()
  const push = (kind, value, raw) => {
    const v = normalizeValue(value)


    if (v != null && v.length < minValueLength && !/^\d+$/.test(v)) return


    if (requireValue && !/^\d/.test(String(v ?? '')) && !SPEC_VALUE_KINDS.has(kind)) {
      if (!v || !SPEC_VALUE_KINDS.has(kind)) return
    }
    const key = `${kind}\u0000${v ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ kind, value: v, raw: raw.trim() })
  }
  for (const clause of s.split(CLAUSE_SPLIT)) {
    const c = clause.trim()
    if (!c) continue
    let m = c.match(NEGATIVE)
    if (m) push('negative', specValue(c) ?? m[1], c)
    m = c.match(CONSTRAINT)
    if (m) push('constraint', specValue(c) ?? m[1], c)
    m = c.match(IMPERATIVE)
    if (m) push('imperative', specValue(c) ?? m[1], c)
    const sv = specValue(c)
    if (sv) push('spec', sv, c)
    m = c.match(FOCUS)
    if (m) push('focus', specValue(c) ?? m[1], c)
    if (out.length >= MAX_DECISIONS) break
  }
  return out
}


export function isDecisionText(text, opts = {}) {
  return detectDecisions(text).length > 0
}

export { MAX_CUES }
