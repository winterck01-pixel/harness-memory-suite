import { homedir } from 'node:os'
import { resolve, isAbsolute } from 'node:path'


export class ReaderError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code }
}
export function reject(status, code) { throw new ReaderError(status, code) }
export function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject(400, 'INVALID_OBJECT')
  return value
}
export function text(value, max, required = false) {
  if (typeof value !== 'string' || value.includes('\0') || value.length > max || (required && !value.trim())) reject(400, 'INVALID_TEXT')
  return value
}
export function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) reject(400, 'INVALID_ID')
  return value
}
export function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) reject(400, 'INVALID_INTEGER')
  return value
}
export function requestId(value) { return id(value) }
export function settings(value) {
  object(value)
  if (!['light', 'warm', 'dark'].includes(value.theme) || !['scroll', 'page'].includes(value.comicMode)) reject(400, 'INVALID_SETTINGS')
  integer(value.fontSize, 16, 30)
  if (![1.65, 1.95, 2.3].includes(value.lineHeight)) reject(400, 'INVALID_SETTINGS')
  return { theme: value.theme, fontSize: value.fontSize, lineHeight: value.lineHeight, comicMode: value.comicMode }
}

export function readConfig(raw = {}) {
  object(raw)
  const limit = (key, fallback, min, max) => raw[key] === undefined ? fallback : integer(raw[key], min, max)
  if (raw.sourceRoots !== undefined && (!Array.isArray(raw.sourceRoots) || raw.sourceRoots.length > 24)) reject(400, 'INVALID_SOURCE_ROOTS')
  const sourceRoots = (raw.sourceRoots || []).map(p => {
    text(p, 4096, true)
    if (!isAbsolute(p)) reject(400, 'SOURCE_ROOT_MUST_BE_ABSOLUTE')
    return resolve(p)
  })
  if (raw.storageDir !== undefined && !isAbsolute(text(raw.storageDir, 4096, true))) reject(400, 'STORAGE_ROOT_MUST_BE_ABSOLUTE')
  return {
    storageDir: resolve(raw.storageDir || resolve(homedir(), '.dsh/reader')),
    sourceRoots,
    maxBooks: limit('maxBooks', 1000, 1, 10000),
    maxParts: limit('maxParts', 5000, 1, 5000),
    maxTextBytes: limit('maxTextBytes', 16 * 1024 ** 2, 1024, 64 * 1024 ** 2),
    maxImageBytes: limit('maxImageBytes', 16 * 1024 ** 2, 1024, 64 * 1024 ** 2),
    maxImagePixels: limit('maxImagePixels', 8_000_000, 1024, 32_000_000),
    maxDocumentBytes: limit('maxDocumentBytes', 32 * 1024 ** 2, 1024, 48 * 1024 ** 2),
    maxStorageBytes: limit('maxStorageBytes', 512 * 1024 ** 2, 1024 ** 2, 4 * 1024 ** 3),
    maxRequestBytes: limit('maxRequestBytes', 46 * 1024 ** 2, 1024, 66 * 1024 ** 2),
    maxIndexBytes: limit('maxIndexBytes', 32 * 1024 ** 2, 1024, 128 * 1024 ** 2),
  }
}
