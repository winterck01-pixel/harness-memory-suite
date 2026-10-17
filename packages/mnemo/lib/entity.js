


export function normalizeSurface(s) {
  if (!s) return ''
  return String(s)
    .normalize('NFKC')
    .toLowerCase()

    .replace(/[\s\-_./·、,，。:：;；'"“”‘’()（）\[\]【】]+/g, '')
    .trim()
}


export function canonicalOf(s) {
  return String(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_]+/g, '.')
    .replace(/[^a-z0-9\u4e00-\u9fff.]+/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.|\.$/g, '')
}


function aliasSearchText(text) {
  const raw = String(text).normalize('NFKC').toLowerCase()
  const positions = []
  let normalized = ''
  for (let i = 0; i < raw.length; i++) {
    if (/[\s\-_./·、,，。:：;；'"“”‘’()（）\[\]【】]/.test(raw[i])) continue
    positions.push(i)
    normalized += raw[i]
  }
  return (key) => {
    let from = 0
    while (from <= normalized.length - key.length) {
      const at = normalized.indexOf(key, from)
      if (at < 0) return false
      const before = raw[positions[at] - 1] ?? ''
      const after = raw[positions[at + key.length - 1] + 1] ?? ''
      if ((!/^[a-z0-9]/.test(key) || !/[a-z0-9_]/.test(before)) &&
          (!/[a-z0-9]$/.test(key) || !/[a-z0-9_]/.test(after))) return true
      from = at + 1
    }
    return false
  }
}

export class EntityResolver {


  constructor(dictionary = {}) {

    this.aliasIndex = new Map()

    this.canonical = new Map()
    for (const [c, aliases] of Object.entries(dictionary)) {
      const canon = canonicalOf(c)
      this.canonical.set(canon, new Set(aliases))
      this.aliasIndex.set(normalizeSurface(canon), canon)
      this.aliasIndex.set(normalizeSurface(c), canon)
      for (const a of aliases) this.aliasIndex.set(normalizeSurface(a), canon)
    }
  }


  resolve(surface) {
    if (!surface) return null
    const key = normalizeSurface(surface)
    if (!key) return null
    return this.aliasIndex.get(key) ?? null
  }


  resolveOrRegister(surface) {
    const hit = this.resolve(surface)
    if (hit) return hit
    const canon = canonicalOf(surface)
    if (!canon) return ''

    if (this.aliasIndex.has(normalizeSurface(canon))) {
      return this.aliasIndex.get(normalizeSurface(canon))
    }
    const set = this.canonical.get(canon) ?? new Set()
    set.add(surface)
    this.canonical.set(canon, set)
    this.aliasIndex.set(normalizeSurface(canon), canon)
    this.aliasIndex.set(normalizeSurface(surface), canon)
    return canon
  }


  learn(canonical, alias) {
    const canon = this.resolve(canonical) ?? canonicalOf(canonical)
    if (!canon || !alias) return false
    const key = normalizeSurface(alias)
    if (!key) return false
    const existing = this.aliasIndex.get(key)
    if (existing === canon) return false

    if (existing && existing !== canon) return false
    this.aliasIndex.set(key, canon)
    const set = this.canonical.get(canon) ?? new Set()
    set.add(alias)
    this.canonical.set(canon, set)
    return true
  }


  merge(from, to) {
    const src = this.resolve(from) ?? canonicalOf(from)
    const dst = this.resolve(to) ?? canonicalOf(to)
    if (!src || !dst || src === dst) return 0
    const srcAliases = this.canonical.get(src) ?? new Set()
    const dstAliases = this.canonical.get(dst) ?? new Set()
    let moved = 0
    for (const a of srcAliases) {
      const k = normalizeSurface(a)
      if (k && this.aliasIndex.get(k) === src) {
        this.aliasIndex.set(k, dst)
        dstAliases.add(a)
        moved++
      }
    }
    this.aliasIndex.set(normalizeSurface(src), dst)
    dstAliases.add(src)
    this.canonical.delete(src)
    this.canonical.set(dst, dstAliases)
    return moved
  }


  extract(text) {
    if (!text) return []
    const out = []
    const seen = new Set()
    const push = (surface, known) => {
      const canon = known ? this.resolve(surface) : this.resolveOrRegister(surface)
      if (!canon || seen.has(canon)) return
      seen.add(canon)
      out.push({ canonical: canon, surface, known: !!known })
    }


    const containsAlias = aliasSearchText(text)
    for (const [key, canon] of this.aliasIndex) {
      if (!key) continue
      if (containsAlias(key)) {
        const surface = key
        if (!seen.has(canon)) {
          seen.add(canon)
          out.push({ canonical: canon, surface, known: true })
        }
      }
    }


    const latin = text.match(/[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*/g) ?? []
    for (const w of latin) {
      if (w.length < 3) continue
      const isCamel = /[a-z][A-Z]/.test(w)
      const isCap = /^[A-Z]/.test(w)
      if (isCamel || isCap) push(w, false)
    }


    const quoted = text.match(/[「『"“]([^」』"”]{2,24})[」』"”]/g) ?? []
    for (const q of quoted) {
      const inner = q.replace(/^[「『"“]|[」』"」]$/g, '')
      if (inner) push(inner, false)
    }

    return out
  }


  toJSON() {
    const dict = {}
    for (const [canon, aliases] of this.canonical) {
      dict[canon] = [...aliases]
    }
    return dict
  }

  get size() { return this.canonical.size }
}


export function entityOverlap(a, b) {
  const A = Array.isArray(a) ? a : []
  const B = Array.isArray(b) ? b : []
  if (!A.length || !B.length) return 0
  const setB = new Set(B)
  let inter = 0
  for (const x of A) if (setB.has(x)) inter++
  if (!inter) return 0
  const jac = inter / (A.length + B.length - inter)
  const ovc = inter / Math.min(A.length, B.length)
  return 0.4 * jac + 0.6 * ovc
}
