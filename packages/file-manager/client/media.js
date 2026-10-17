


const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'jpe', 'gif', 'webp', 'avif', 'apng', 'bmp', 'ico',
  'svg', 'tif', 'tiff', 'heic', 'heif',
])


const VIDEO_EXTENSIONS = new Set([
  'mp4', 'm4v', 'webm', 'ogv', 'mov', 'mkv', 'avi', 'mpg', 'mpeg', '3gp', 'm2ts',
])


const AUDIO_EXTENSIONS = new Set([
  'mp3', 'm4a', 'aac', 'wav', 'wave', 'flac', 'ogg', 'oga', 'opus', 'weba',
  'aif', 'aiff', 'wma', 'mid', 'midi',
])


export function extensionOf(name) {
  if (typeof name !== 'string') return ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}


export function kindFromName(name) {
  const extension = extensionOf(name)
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  return 'file'
}


export function mediaKindOf(entry) {
  if (entry === null || typeof entry !== 'object') return 'file'
  if (entry.dir === true) return 'dir'
  if (typeof entry.kind === 'string' && entry.kind.length > 0) return entry.kind
  return kindFromName(entry.name)
}


export function isPlayableKind(kind) {
  return kind === 'video' || kind === 'audio'
}


export function isViewerKind(kind) {
  return kind === 'image' || kind === 'video' || kind === 'audio'
}


export function isThumbnailableKind(kind) {
  return kind === 'image' || kind === 'video'
}


export function viewerItemsOf(entries) {
  if (!Array.isArray(entries)) return []
  return entries.filter((entry) => isViewerKind(mediaKindOf(entry)))
}


export function formatClock(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  const pad = (value) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(remainder)}` : `${minutes}:${pad(remainder)}`
}
