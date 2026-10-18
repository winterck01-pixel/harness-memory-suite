/**
 * 媒体类型识别 —— 一律以**文件内容的 magic bytes** 为准，不信任扩展名。
 *
 * 为什么不用扩展名：agent 生成的产物经常是 `frame_001` / `out.tmp` / `clip.final.mp4`
 * 这类名字，而且扩展名可以随便改。一旦 MIME 报错，浏览器要么直接不显示图片，
 * 要么 `<video>` 静默不播——排查起来很费劲。所以这里只认字节。
 *
 * 只依赖 node: 内置模块，零外部依赖。
 *
 * @module dsh-media-gallery/lib/mime
 */

import { open } from 'node:fs/promises'

/** 浏览器 `<img>` 能直接渲染的图片类型。 */
const IMAGE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif', 'image/svg+xml',
])

/** 浏览器 `<video>` 能放的类型（matroska 不在其中，浏览器基本不支持）。 */
const PLAYABLE_VIDEO_TYPES = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/ogg',
])

/** 我们承认是视频、但浏览器多半放不了的类型，仍然给出下载入口。 */
const VIDEO_TYPES = new Set([...PLAYABLE_VIDEO_TYPES, 'video/x-matroska', 'video/x-msvideo', 'video/mp2t', 'video/x-flv'])

/**
 * HEIF 家族的 ftyp brand：苹果默认拍照格式，浏览器不支持解码。
 * 认出来是为了给出明确的"不支持"提示，而不是丢一个破图。
 */
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'heim'])

/** 一次最多读入多少字节做嗅探；SVG 是文本，需要扫得稍长一些。 */
const SNIFF_BYTES = 4096

/**
 * 按字节魔数判定媒体类型。
 * @param {Buffer} buf - 文件起始字节。
 * @returns {{ mediaType: string, kind: 'image' | 'video', playable: boolean } | null}
 *   无法识别时返回 null。
 */
export function sniffBuffer(buf) {
  if (buf.length < 2) return null

  // PNG：8 字节签名，高置信度。
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504E47 && buf.readUInt32BE(4) === 0x0D0A1A0A) {
    return image('image/png')
  }
  // JPEG：SOI 后跟任意标记。
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf.length >= 3 && buf[2] === 0xFF) return image('image/jpeg')
  // GIF87a / GIF89a。
  if (buf.length >= 6 && buf.toString('latin1', 0, 4) === 'GIF8') return image('image/gif')
  // BMP。
  if (buf[0] === 0x42 && buf[1] === 0x4D) return image('image/bmp')

  // RIFF 容器：WebP / AVI 共用，靠第 8-12 字节的 form type 区分。
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF') {
    const form = buf.toString('latin1', 8, 12)
    if (form === 'WEBP') return image('image/webp')
    if (form === 'AVI ') return video('video/x-msvideo', false)
    return null
  }

  // ISO BMFF（mp4 / mov / avif / heif）：ftyp box 在第 4 字节。
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12).trimEnd()
    if (brand === 'avif' || brand === 'avis') return image('image/avif')
    if (HEIF_BRANDS.has(brand)) return null
    if (brand === 'qt') return video('video/quicktime', true)
    return video('video/mp4', true)
  }

  // EBML：WebM 与 Matroska 共用容器头，靠 DocType 字符串区分。
  if (buf.length >= 4 && buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) {
    const head = buf.toString('latin1', 0, Math.min(buf.length, 256))
    return head.includes('webm') ? video('video/webm', true) : video('video/x-matroska', false)
  }

  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'OggS') return video('video/ogg', true)
  if (buf.length >= 3 && buf.toString('latin1', 0, 3) === 'FLV') return video('video/x-flv', false)

  // MPEG-TS：每 188 字节一个同步字节 0x47。
  if (buf.length >= 377 && buf[0] === 0x47 && buf[188] === 0x47 && buf[376] === 0x47) {
    return video('video/mp2t', false)
  }

  // SVG 是文本格式，没有魔数，只能看开头。放在最后判定，避免误伤二进制。
  const text = buf.toString('utf8', 0, Math.min(buf.length, SNIFF_BYTES))
  if (/<svg[\s>]/i.test(text) && /^\s*(<\?xml|<!--|<!DOCTYPE|<svg)/i.test(text)) return image('image/svg+xml')

  return null
}

/** @returns {{ mediaType: string, kind: 'image', playable: boolean }} */
function image(mediaType) {
  return { mediaType, kind: 'image', playable: true }
}

/** @returns {{ mediaType: string, kind: 'video', playable: boolean }} */
function video(mediaType, playable) {
  return { mediaType, kind: 'video', playable }
}

/**
 * 从已读入的头部字节里取出像素尺寸。取不到就返回空对象。
 * 只覆盖最常见的几种，够卡片做占位、避免图片加载时的布局抖动。
 * @param {Buffer} buf - 文件起始字节。
 * @param {string} mediaType - 已判定的媒体类型。
 * @returns {{ width?: number, height?: number }}
 */
export function readImageSize(buf, mediaType) {
  try {
    switch (mediaType) {
      case 'image/png':
        if (buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
        return {}
      case 'image/gif':
        if (buf.length >= 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
        return {}
      case 'image/bmp':
        if (buf.length >= 26) {
          return { width: Math.abs(buf.readInt32LE(18)), height: Math.abs(buf.readInt32LE(22)) }
        }
        return {}
      case 'image/webp':
        return readWebpSize(buf)
      case 'image/jpeg':
        return readJpegSize(buf)
      default:
        return {}
    }
  } catch {
    // 尺寸只是锦上添花，解析失败绝不该影响这次调用。
    return {}
  }
}

/** WebP 三种子格式的尺寸位置各不相同（VP8 / VP8L / VP8X）。 */
function readWebpSize(buf) {
  const chunk = buf.length >= 16 ? buf.toString('latin1', 12, 16) : ''
  if (chunk === 'VP8 ' && buf.length >= 30) {
    return { width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF }
  }
  if (chunk === 'VP8L' && buf.length >= 25) {
    const bits = buf.readUInt32LE(21)
    return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 }
  }
  if (chunk === 'VP8X' && buf.length >= 30) {
    return { width: readUInt24LE(buf, 24) + 1, height: readUInt24LE(buf, 27) + 1 }
  }
  return {}
}

/** @returns {number} 小端 24 位整数。 */
function readUInt24LE(buf, offset) {
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16)
}

/** JPEG 需要跳过各段找 SOFn 帧头，尺寸藏在帧头里。 */
function readJpegSize(buf) {
  let offset = 2
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xFF) return {}
    const marker = buf[offset + 1]
    // 填充字节 0xFF 可以连续出现。
    if (marker === 0xFF) {
      offset += 1
      continue
    }
    // SOI/EOI/RSTn/TEM 没有长度字段。
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
      offset += 2
      continue
    }
    const length = buf.readUInt16BE(offset + 2)
    // SOF0-SOF15，排除 DHT(C4)/JPG(C8)/DAC(CC)。
    const isFrameHeader = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC
    if (isFrameHeader) {
      return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) }
    }
    if (length < 2) return {}
    offset += 2 + length
  }
  return {}
}

/**
 * 读取一个媒体的完整信息：类型、尺寸、视频时长。
 *
 * 只读文件头部若干字节；只有 ISO BMFF 视频需要再走一遍 box 树取时长，
 * 而那个遍历是按 box 头跳的，不会把整个文件读进来。
 *
 * @param {string} absPath - 已解析的绝对路径。
 * @param {number} size - 文件字节数（调用方已 stat 过，避免重复系统调用）。
 * @returns {Promise<{ mediaType: string, kind: 'image' | 'video', playable: boolean,
 *   width?: number, height?: number, duration?: number } | null>}
 */
export async function probeMedia(absPath, size) {
  const handle = await open(absPath, 'r')
  try {
    const head = Buffer.alloc(Math.min(SNIFF_BYTES, size))
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    const sniffed = sniffBuffer(head.subarray(0, bytesRead))
    if (sniffed === null) return null

    if (sniffed.kind === 'image') {
      const { width, height } = readImageSize(head.subarray(0, bytesRead), sniffed.mediaType)
      return {
        ...sniffed,
        ...(isPositive(width) ? { width } : {}),
        ...(isPositive(height) ? { height } : {}),
      }
    }

    const duration = sniffed.mediaType === 'video/mp4' || sniffed.mediaType === 'video/quicktime'
      ? await readIsoDuration(handle, size)
      : undefined
    return {
      ...sniffed,
      ...(duration !== undefined && Number.isFinite(duration) && duration > 0 ? { duration } : {}),
    }
  } finally {
    await handle.close()
  }
}

/** @returns {boolean} 是否是可用于展示的正整数。 */
function isPositive(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** ISO BMFF box 头的最小长度。 */
const BOX_HEADER_BYTES = 8

/**
 * 沿顶层 box 链找到 moov，再从中取 mvhd 的时长。
 *
 * 用 box 长度做 seek 而不是顺序读，所以即使 moov 在文件末尾（非 faststart 的
 * 文件很常见）也只读几个 16 字节的头部。
 *
 * @param {import('node:fs/promises').FileHandle} handle - 已打开的文件句柄。
 * @param {number} size - 文件总字节数，作为跳过链表的边界。
 * @returns {Promise<number | undefined>} 秒数；任何异常/结构不符都返回 undefined。
 */
async function readIsoDuration(handle, size) {
  try {
    let offset = 0
    while (offset + BOX_HEADER_BYTES <= size) {
      const header = Buffer.alloc(16)
      const { bytesRead } = await handle.read(header, 0, 16, offset)
      if (bytesRead < BOX_HEADER_BYTES) return undefined
      const resolved = resolveBoxLength(header, bytesRead, size, offset)
      if (resolved === null) return undefined
      if (header.toString('latin1', 4, 8) === 'moov') {
        return readMvhd(handle, offset + resolved.headerBytes, resolved.length - resolved.headerBytes)
      }
      offset += resolved.length
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 解出 box 的总长度与头长度。`size` 字段为 1 表示用 64 位长度，为 0 表示延伸到父容器末尾。
 * @returns {{ length: number, headerBytes: number } | null} 长度不合法时返回 null。
 */
function resolveBoxLength(header, bytesRead, containerEnd, boxStart) {
  const raw = header.readUInt32BE(0)
  let length = raw
  let headerBytes = BOX_HEADER_BYTES
  if (raw === 1) {
    if (bytesRead < 16) return null
    const wide = header.readBigUInt64BE(8)
    if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return null
    length = Number(wide)
    headerBytes = 16
  } else if (raw === 0) {
    length = containerEnd - boxStart
  }
  if (!Number.isFinite(length) || length < headerBytes) return null
  return { length, headerBytes }
}

/** 在 moov 的子 box 里取 mvhd 的 timescale 与 duration，换算成秒。 */
async function readMvhd(handle, start, length) {
  let offset = start
  const end = start + length
  while (offset + BOX_HEADER_BYTES <= end) {
    const header = Buffer.alloc(16)
    const { bytesRead } = await handle.read(header, 0, 16, offset)
    if (bytesRead < BOX_HEADER_BYTES) return undefined
    const resolved = resolveBoxLength(header, bytesRead, end, offset)
    if (resolved === null) return undefined
    if (header.toString('latin1', 4, 8) === 'mvhd') {
      const body = Buffer.alloc(32)
      const read = await handle.read(body, 0, 32, offset + resolved.headerBytes)
      if (read.bytesRead < 20) return undefined
      // v0：creation(4) modification(4) timescale(4) duration(4)，从 version+flags 之后起算。
      // v1：creation(8) modification(8) timescale(4) duration(8)。
      const version = body[0]
      if (version === 1) {
        if (read.bytesRead < 32) return undefined
        const timescale = body.readUInt32BE(20)
        const duration = body.readBigUInt64BE(24)
        if (timescale === 0 || duration > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
        return Number(duration) / timescale
      }
      const timescale = body.readUInt32BE(12)
      const duration = body.readUInt32BE(16)
      if (timescale === 0) return undefined
      return duration / timescale
    }
    offset += resolved.length
  }
  return undefined
}

export { IMAGE_TYPES, VIDEO_TYPES, PLAYABLE_VIDEO_TYPES }
