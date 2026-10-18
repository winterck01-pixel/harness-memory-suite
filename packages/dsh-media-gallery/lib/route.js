/**
 * 媒体取流路由：`/api/media-gallery/raw`
 *
 * 官方 `/api/file` 能显示小图，但做视频有两个硬伤，所以这里必须自己开一条：
 *
 *   1. 它有字节上限（默认 20MB，取的是 attachments.imageLimits.maxImageBytes），
 *      视频基本必挂 413；
 *   2. 它一次性把整个文件读成 Buffer 返回，没有 `Accept-Ranges`、不认 Range 请求。
 *      `<video>` 拖动进度条时靠的就是 206 分段响应，没有它就只能从头下完。
 *
 * 这条路走的还是官方连接服务的注册面（`ctx.connection.fetch.register`），所以：
 *   - 请求先过 Host/Origin 信任围栏与浏览器鉴权，再进到我们的 handler；
 *   - 响应体由 http-bridge 分块写出并带背压，大文件不会撑内存；
 *   - 路由必须是 `/api/...` 前缀，精确匹配 pathname（查询串不进匹配）。
 *
 * 授权模型见 `lib/sign.js` 的说明：白名单在**签发时**校验，这里只验签。
 *
 * @module dsh-media-gallery/lib/route
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { basename } from 'node:path'
import { probeMedia } from './mime.js'
import { verifyToken } from './sign.js'

/** 路由路径。官方要求 `/api` 前缀 + 精确匹配。 */
export const ROUTE_PATH = '/api/media-gallery/raw'

/** 探测结果缓存的条目上限：一次取流只读 4KB，但视频拖动会打出几十个请求。 */
const PROBE_CACHE_LIMIT = 64

/**
 * 建一个取流路由注册对象。
 * @param {{ maxBytes: number, log: (msg: string) => void }} options - 配额与日志。
 * @returns {{ path: string, methods: string[], requestBody: 'buffered', fetch: (request: Request) => Promise<Response> }}
 *   直接交给 `ctx.connection.fetch.register` 的注册对象。
 */
export function createMediaRoute({ maxBytes, log }) {
  /** path → { key, value }，键里带上 size+mtime，文件一变缓存自动失效。 */
  const probeCache = new Map()

  return {
    path: ROUTE_PATH,
    methods: ['GET', 'HEAD'],
    // GET/HEAD 没有请求体；'buffered' 是官方文档里的默认档，语义最清晰。
    requestBody: 'buffered',

    /**
     * 处理一次取流请求。
     * @param {Request} request - 已通过鉴权的请求。
     * @returns {Promise<Response>}
     */
    async fetch(request) {
      try {
        return await serve(request, { maxBytes, probeCache, log })
      } catch (error) {
        // handler 抛出会冒到连接服务；这里兜住并转成一个普通 500，避免污染上层日志。
        log(`取流失败：${error instanceof Error ? error.message : String(error)}`)
        return new Response('internal error', { status: 500, headers: baseHeaders() })
      }
    },
  }
}

/** 实际的处理逻辑。 */
async function serve(request, { maxBytes, probeCache, log }) {
  const url = new URL(request.url)
  const path = url.searchParams.get('path')
  const token = url.searchParams.get('t')
  if (path === null || path === '') return fail(400, '缺少 path 参数')
  if (path.includes('\0')) return fail(400, 'path 含非法字符')

  let info
  try {
    info = await stat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return fail(404, '文件不存在')
    if (error?.code === 'EACCES' || error?.code === 'EPERM') return fail(403, '没有读取权限')
    return fail(500, `无法读取文件状态（${String(error?.code ?? '未知错误')}）`)
  }
  if (!info.isFile()) return fail(403, '不是普通文件')
  if (info.size > maxBytes) {
    return fail(413, `文件 ${formatGiB(info.size)} 超过上限 ${formatGiB(maxBytes)}`)
  }

  // 文件指纹必须与签发 token 时一致：路径 + 大小 + mtime。
  const expired = !verifyToken(token, { path, size: info.size, mtimeMs: info.mtimeMs }, Date.now())
  if (expired) {
    return fail(403, '取流链接无效或已过期（文件可能已被覆盖）——请重新调用 media_show 获取新链接')
  }

  const probe = await probeCached(probeCache, path, info, log)
  const mediaType = probe?.mediaType ?? 'application/octet-stream'

  const headers = {
    ...baseHeaders(),
    'Content-Type': mediaType,
    'Accept-Ranges': 'bytes',
    // 带 token 的 URL 本身就有时效，缓存是安全的；但按 token 剩余寿命设上限更严谨。
    'Cache-Control': 'private, max-age=3600',
    'Content-Disposition': contentDisposition(path),
  }

  // HEAD 只回元信息，不建流。
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(info.size) } })
  }

  const range = parseRange(request.headers.get('range'), info.size)
  if (range === 'unsatisfiable') {
    return new Response('range not satisfiable', {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${String(info.size)}` },
    })
  }

  if (range === null) {
    return new Response(fileStream(path, 0, info.size - 1, request.signal), {
      status: 200,
      headers: { ...headers, 'Content-Length': String(info.size) },
    })
  }

  const { start, end } = range
  return new Response(fileStream(path, start, end, request.signal), {
    status: 206,
    headers: {
      ...headers,
      'Content-Range': `bytes ${String(start)}-${String(end)}/${String(info.size)}`,
      'Content-Length': String(end - start + 1),
    },
  })
}

/** 各类响应共用的安全头。 */
function baseHeaders() {
  return {
    // 官方 /api/file 用的是同一套：文件不适合被当成文档直接打开。
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'X-Content-Type-Options': 'nosniff',
  }
}

/** 造一个标准错误响应。 */
function fail(status, text) {
  return new Response(text, { status, headers: baseHeaders() })
}

/**
 * 用 `fs.createReadStream` 造响应体，并把它接到请求的取消信号上。
 *
 * 这里用官方的 `Readable.toWeb` 而不是手写 `ReadableStream`：它自带正确的背压
 * 传递，大视频配慢客户端时不会在内存里越堆越多。
 */
function fileStream(path, start, end, signal) {
  const node = createReadStream(path, { start, end })
  const onAbort = () => {
    node.destroy()
  }
  if (signal !== undefined) {
    if (signal.aborted) node.destroy()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  node.on('close', () => {
    signal?.removeEventListener('abort', onAbort)
  })
  // 读盘中途出错（文件被截断/删除）时，让连接干脆断掉即可；补一个监听避免
  // Node 把 'error' 当成未处理异常。
  node.on('error', () => {
    node.destroy()
  })
  return Readable.toWeb(node)
}

/**
 * 解析 `Range` 头。
 *
 * 只支持单段。多段（`bytes=0-1,5-9`）按 RFC 9110 允许服务端忽略，这里选择忽略，
 * 也就是回整个文件——`<video>` 不会发多段请求，实际用不到。
 *
 * @param {string | null} header - 原始 Range 头。
 * @param {number} size - 文件总字节数。
 * @returns {{ start: number, end: number } | null | 'unsatisfiable'} null 表示整文件。
 */
function parseRange(header, size) {
  if (header === null) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  if (rawStart === '') {
    // 后缀式：最后 N 个字节。
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable'
    if (size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= size) return 'unsatisfiable'
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (!Number.isFinite(end) || end < start) return 'unsatisfiable'
  return { start, end }
}

/**
 * 取（并缓存）媒体探测结果。
 *
 * 视频拖动进度条时浏览器会连发几十个 Range 请求，每个都去嗅探一次 4KB + 走 box 树
 * 是浪费；键里带 size+mtime，所以文件被覆盖后缓存自然失效。
 */
async function probeCached(cache, path, info, log) {
  const key = `${path}\0${String(info.size)}\0${String(info.mtimeMs)}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit.value
  let value = null
  try {
    value = await probeMedia(path, info.size)
  } catch (error) {
    // 探测失败不该阻断取流：退化成 application/octet-stream，浏览器还是能下载。
    log(`媒体探测失败（${path}）：${error instanceof Error ? error.message : String(error)}`)
  }
  if (cache.size >= PROBE_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { value })
  return value
}

/** 给响应补一个文件名，便于用户"另存为"时有意义的名字。 */
function contentDisposition(path) {
  const name = basename(path).replaceAll(/["\\\r\n]/g, '_')
  return `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** 把字节数格式化成 GiB，用于 413 文案。 */
function formatGiB(bytes) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GiB`
}
