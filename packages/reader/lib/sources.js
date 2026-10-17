import { constants, lstatSync, realpathSync } from 'node:fs'
import { open, realpath, lstat } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep, dirname, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { id, object, reject, text } from './validate.js'

export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export function within(root, path) {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

async function noLinks(path, root) {
  let cursor = path
  while (within(root, cursor)) {
    const info = await lstat(cursor)
    if (info.isSymbolicLink()) reject(403, 'SOURCE_SYMLINK_FORBIDDEN')
    if (cursor === root) break
    cursor = dirname(cursor)
  }
}
export function createSources(config, getVault) {
  const identities = new WeakMap()
  let nextIdentity = 0
  function identity(value) {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return null
    if (!identities.has(value)) identities.set(value, ++nextIdentity)
    return identities.get(value)
  }


  function pathAuthority(path) {
    try {
      const declared = config.sourceRoots.find(root => within(root, path))
      if (!declared || within(config.storageDir, path)) return ['outside']
      const root = realpathSync(declared), rootInfo = lstatSync(declared)
      let ancestor = path
      while (true) {
        try { lstatSync(ancestor); break } catch (error) {
          if (error.code !== 'ENOENT' || ancestor === declared) throw error
          ancestor = dirname(ancestor)
        }
      }
      for (let cursor = ancestor; within(declared, cursor); cursor = dirname(cursor)) {
        if (lstatSync(cursor).isSymbolicLink()) return ['symlink', cursor]
        if (cursor === declared) break
      }
      if (!within(root, realpathSync(ancestor))) return ['outside']
      return ['allowed', declared, root, rootInfo.dev, rootInfo.ino, rootInfo.mode]
    } catch (error) { return ['unavailable', error.code || 'SOURCE_AUTHORITY_UNAVAILABLE'] }
  }
  function authority(refs) {
    const paths = new Set(), knowledge = new Set()
    for (const ref of refs) { if (ref.path) paths.add(ref.path); if (ref.knowledgeId) knowledge.add(ref.knowledgeId) }
    const vault = knowledge.size ? getVault() : undefined
    const records = [...knowledge].sort().map(knowledgeId => {
      let entry
      try { entry = vault?.get(knowledgeId) } catch { return [knowledgeId, 'unavailable'] }
      if (entry && typeof entry.then === 'function') reject(503, 'SOURCE_AUTHORITY_UNAVAILABLE')
      return [knowledgeId, !!entry, entry?.deletedAt || '', entry?.shared === true, entry?.projectId || '', entry?.assetId || '']
    })
    return [config.sourceRoots, identity(vault), identity(vault?.get), records, [...paths].sort().map(path => [path, pathAuthority(path)])]
  }

  async function locate(input, cwd) {
    text(input, 4096, true)
    if (!isAbsolute(input) && !cwd) reject(400, 'RELATIVE_SOURCE_REQUIRES_WORKSPACE')
    const path = resolve(cwd || '/', input)
    const declared = config.sourceRoots.find(root => within(root, path))
    if (!declared || within(config.storageDir, path)) reject(403, 'SOURCE_OUTSIDE_ALLOWED_ROOTS')
    const root = await realpath(declared)

    let ancestor = path
    while (true) {
      try { await lstat(ancestor); break } catch (error) {
        if (error.code !== 'ENOENT') throw error
        if (ancestor === declared) reject(403, 'SOURCE_ROOT_UNAVAILABLE')
        ancestor = dirname(ancestor)
      }
    }
    await noLinks(ancestor, declared)
    const actual = await realpath(ancestor)
    if (!within(root, actual)) reject(403, 'SOURCE_OUTSIDE_ALLOWED_ROOTS')
    return path
  }
  async function source(ref, cwd) {
    object(ref)
    if (ref.path !== undefined && ref.knowledgeId !== undefined) reject(400, 'AMBIGUOUS_SOURCE')
    if (ref.path !== undefined) return { type: 'file', path: await locate(ref.path, cwd) }
    const knowledgeId = id(ref.knowledgeId)
    const vault = getVault()
    if (!vault) reject(503, 'KNOWLEDGE_UNAVAILABLE')
    const entry = vault.get(knowledgeId)
    if (entry.deletedAt) reject(403, 'SOURCE_REVOKED')
    if (entry.assetId?.startsWith('file:')) return { type: 'knowledge-file', knowledgeId, path: await locate(entry.assetId.slice(5), cwd) }
    return { type: 'knowledge-text', knowledgeId, sourceVersion: entry.updatedAt }
  }
  async function check(ref) {
    if (!ref) return
    if (ref.path) await locate(ref.path)
    if (ref.knowledgeId) {
      const vault = getVault()
      if (!vault) reject(503, 'KNOWLEDGE_UNAVAILABLE')
      let entry
      try { entry = vault.get(ref.knowledgeId) } catch { reject(403, 'SOURCE_REVOKED') }
      if (entry.deletedAt) reject(403, 'SOURCE_REVOKED')
      const currentPath = entry.assetId?.startsWith('file:') ? entry.assetId.slice(5) : null
      if ((currentPath || ref.path) && currentPath !== ref.path) reject(403, 'SOURCE_REFERENCE_CHANGED')
    }
  }
  async function read(ref, kind) {
    await check(ref)
    if (ref.type === 'knowledge-text') {
      if (kind !== 'text') reject(415, 'SOURCE_IS_NOT_IMAGE')
      return Buffer.from(getVault().get(ref.knowledgeId).content, 'utf8')
    }
    if (kind === 'text' && !['.md', '.txt', '.markdown'].includes(extname(ref.path).toLowerCase())) reject(415, 'UNSUPPORTED_TEXT_FORMAT')
    const before = await lstat(ref.path)
    const max = kind === 'text' ? config.maxTextBytes : kind === 'document' ? config.maxDocumentBytes : config.maxImageBytes
    if (!before.isFile() || before.isSymbolicLink()) reject(403, 'SOURCE_NOT_REGULAR_FILE')
    if (before.size > max) reject(413, 'SOURCE_TOO_LARGE')
    const f = await open(ref.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const opened = await f.stat()
      if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) reject(409, 'SOURCE_CHANGED')
      const bytes = await f.readFile()
      const after = await f.stat()
      await locate(ref.path)
      if (opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || bytes.length !== after.size) reject(409, 'SOURCE_CHANGED')
      return bytes
    } finally { await f.close() }
  }
  return { source, check, read, authority }
}


export function raster(bytes, maxPixels) {
  let width, height, mime
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); mime = 'image/png'
    for(let pos=8;pos+12<=bytes.length;){
      const length=bytes.readUInt32BE(pos),kind=bytes.toString('ascii',pos+4,pos+8)
      if(kind==='acTL')reject(415,'ANIMATED_IMAGE_FORBIDDEN')
      if(pos+12+length>bytes.length)reject(415,'INVALID_RASTER')
      pos+=12+length
    }
  } else if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) {

    reject(415, 'GIF_NOT_SUPPORTED')
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let pos = 2
    while (pos + 4 <= bytes.length) {
      if (bytes[pos++] !== 255) reject(415, 'INVALID_RASTER')
      while (bytes[pos] === 255) pos++
      const marker = bytes[pos++]
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (pos + 2 > bytes.length) break
      const len = bytes.readUInt16BE(pos)
      if (len < 2 || pos + len > bytes.length) reject(415, 'INVALID_RASTER')
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && len >= 8) {
        height = bytes.readUInt16BE(pos + 3); width = bytes.readUInt16BE(pos + 5); mime = 'image/jpeg'; break
      }
      pos += len
    }
  } else if (bytes.length >= 30 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') {
    const kind = bytes.toString('ascii',12,16)
    if (kind === 'VP8X') {
      if (bytes[20] & 2) reject(415, 'ANIMATED_IMAGE_FORBIDDEN')
      width = bytes.readUIntLE(24,3) + 1; height = bytes.readUIntLE(27,3) + 1
    } else if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = bytes.readUInt16LE(26) & 16383; height = bytes.readUInt16LE(28) & 16383
    } else if (kind === 'VP8L' && bytes[20] === 47) {
      const bits = bytes.readUInt32LE(21); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1
    }
    mime = 'image/webp'
  }
  if (!mime || !width || !height || width * height > maxPixels || width > 32768 || height > 32768) reject(415, 'INVALID_OR_OVERSIZED_RASTER')
  return { mime, width, height }
}
