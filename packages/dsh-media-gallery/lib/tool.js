/**
 * `media_show` 工具 —— 把已经生成好的图片/视频放到聊天界面里展示。
 *
 * 契约要点（都在 0.2.0-rc.2 的 dsh-tools 类型上核对过）：
 *
 *   - `parameters` 与 `output.schema` 必须是**受支持的 JSON Schema 子集**：
 *     只有 type / oneOf / properties / required / additionalProperties / items /
 *     enum / const，外加 description / title / default / examples 注解。
 *     `additionalProperties` 只接受 boolean，`type` 不接受数组。用错关键字注册时直接抛。
 *   - `execute` 返回的是**规范化 JSON 值**，模型看到的不是它，而是 `output.render(args, value)`
 *     产出。所以结构化载荷放返回值，给人/模型看的摘要放 render，两者分得很干净。
 *   - `output.presentationMeta(args, value)` 的结果会**随 `tool/result` 落盘**，前端从
 *     `block.meta` 读。这点很关键：刷新页面、回放历史会话时，卡片仍然能还原成
 *     完整的画廊，而不是只剩一行文字。它是纯函数，且只在顶层调用时计算。
 *
 * 授权（目录白名单）在**签发链接时**做，见 `lib/roots.js` 与 `lib/sign.js`。
 *
 * @module dsh-media-gallery/lib/tool
 */

import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, resolve } from 'node:path'
import { probeMedia } from './mime.js'
import { ROUTE_PATH } from './route.js'
import { mintToken } from './sign.js'

/** 工具名。前端按这个名字命中 `tool.call.toolview`，改这里要同步改 client.js。 */
export const TOOL_NAME = 'media_show'

/** 载荷版本。前端据此判断结构，将来改结构时可以并存。 */
export const PAYLOAD_VERSION = 1

/** 单个 item 的参数定义。 */
const MEDIA_ITEM = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: '图片或视频的路径。本地文件用绝对路径（相对路径会按会话工作区解析），也可以直接给 http(s) 链接。',
    },
    caption: { type: 'string', description: '显示在媒体下方的说明文字，可省略。' },
    alt: { type: 'string', description: '图片的无障碍替代文本，可省略。' },
    poster: { type: 'string', description: '视频封面图的绝对路径，可省略。' },
    kind: {
      type: 'string',
      enum: ['auto', 'image', 'video'],
      description: '媒体类型提示。本地文件会按文件内容自动判定，这里只在给 http(s) 链接时才有意义。默认 auto。',
    },
  },
  required: ['path'],
  additionalProperties: false,
}

/** 工具参数 schema。 */
const PARAMETERS = {
  type: 'object',
  properties: {
    media: {
      type: 'array',
      description: '要展示的媒体列表，按展示顺序排列。',
      items: MEDIA_ITEM,
    },
    title: { type: 'string', description: '画廊标题，可省略。' },
    layout: {
      type: 'string',
      enum: ['grid', 'column'],
      description: 'grid（默认）自适应多列；column 单列纵向排列，适合竖版长图。',
    },
  },
  required: ['media'],
  additionalProperties: false,
}

/** 单个输出条目的 schema。 */
const OUTPUT_ITEM = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['image', 'video'] },
    name: { type: 'string' },
    path: { type: 'string' },
    mediaType: { type: 'string' },
    url: { type: 'string' },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    duration: { type: 'number' },
    caption: { type: 'string' },
    alt: { type: 'string' },
    posterUrl: { type: 'string' },
    remote: { type: 'boolean' },
    playable: { type: 'boolean' },
  },
  required: ['kind', 'name', 'path', 'mediaType', 'url', 'remote', 'playable'],
  additionalProperties: false,
}

/** 工具输出 schema。 */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    v: { type: 'integer', description: '载荷版本。' },
    title: { type: 'string' },
    layout: { type: 'string', enum: ['grid', 'column'] },
    items: { type: 'array', items: OUTPUT_ITEM },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['path', 'message'],
        additionalProperties: false,
      },
    },
  },
  required: ['v', 'items', 'errors'],
  additionalProperties: false,
}

/** 工具描述。写清楚"什么时候该用"，模型才会在合适的时候调。 */
const DESCRIPTION = [
  '把图片或视频展示在聊天界面里。用户要"看"图片/视频时就用这个工具——包括你自己刚生成的、工作区里已有的、或者一个 http(s) 链接。',
  '',
  '效果：图片会在对话中铺开显示，用户点击可以全屏放大；视频会带播放器内嵌在对话里，可以直接播放和拖动进度条。',
  '这比在回复里写 markdown 图片语法更好：markdown 只支持图片、点不开、还有 20MB 上限，视频则完全放不出来。',
  '',
  '用法：把 path 写成绝对路径（相对路径会按会话工作区解析），一次可以给多个，会按顺序展示成画廊。',
  '无法识别的文件、以及当前不允许访问的目录会在结果里逐条列出原因，不要因此重试同样的路径。',
].join('\n')

/**
 * 造一个 `media_show` 工具定义。
 * @param {object} options - 依赖注入。
 * @param {ReturnType<import('./roots.js').createRootPolicy>} options.policy - 目录白名单策略。
 * @param {() => unknown} options.getContext - 取 cordis Context（用于读会话工作区）。
 * @param {number} options.ttlMs - 取流链接有效期（毫秒）。
 * @param {number} options.probeMaxBytes - 超过这个大小的文件不做探测（避免读超大文件头）。
 * @param {(msg: string) => void} options.log - 日志。
 * @returns {object} 可直接交给 `ctx.tools.register` 的工具定义。
 */
export function createMediaShowTool({ policy, getContext, ttlMs, probeMaxBytes, log }) {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: renderForModel,
      presentationMeta: presentationMetaOf,
    },
    execute: (args, exec) => execute({ policy, getContext, ttlMs, probeMaxBytes, log }, args, exec),
  }
}

/** 工具的 execute 实现。 */
async function execute(deps, args, exec) {
  const { policy, ttlMs, probeMaxBytes, log, getContext } = deps
  const requested = Array.isArray(args?.media) ? args.media : []
  const layout = normalizeLayout(args?.layout)
  const title = typeof args?.title === 'string' && args.title.trim() !== '' ? args.title.trim() : undefined

  // 会话工作区是动态的，调用时顺手记一笔，让白名单跟上。
  const sessionCwd = readSessionCwd(getContext(), exec)
  if (sessionCwd !== undefined) policy.rememberCwd(sessionCwd)

  /** @type {object[]} */
  const items = []
  /** @type {{ path: string, message: string }[]} */
  const errors = []

  for (const entry of requested) {
    const raw = typeof entry?.path === 'string' ? entry.path.trim() : ''
    if (raw === '') {
      errors.push({ path: '', message: 'path 为空' })
      continue
    }
    try {
      const item = await resolveOne({ policy, ttlMs, probeMaxBytes, log }, raw, entry, sessionCwd)
      items.push(item)
    } catch (error) {
      errors.push({ path: raw, message: error instanceof Error ? error.message : String(error) })
    }
  }

  if (items.length === 0) {
    // 全部失败时抛错，比回一个空画廊清楚得多——模型能直接看到每条的原因并改路径。
    const detail = errors.map(e => `${e.path === '' ? '(空路径)' : e.path}：${e.message}`).join('；')
    throw new Error(`没有任何媒体可以展示。${detail}`)
  }

  return {
    v: PAYLOAD_VERSION,
    ...(title === undefined ? {} : { title }),
    layout,
    items,
    errors,
  }
}

/** 解析并校验一个条目。 */
async function resolveOne(deps, raw, entry, sessionCwd) {
  const { policy, ttlMs, probeMaxBytes, log } = deps
  const hint = normalizeKind(entry?.kind)

  if (isRemoteUrl(raw)) return remoteItem(raw, entry, hint)

  const absolute = toAbsolute(raw, sessionCwd)
  const allowed = await policy.resolveAllowed(absolute)
  if (!allowed.ok) throw new Error(allowed.reason)

  let info
  try {
    info = await stat(allowed.realPath)
  } catch (error) {
    throw new Error(`无法读取文件状态（${String(error?.code ?? '未知错误')}）`)
  }
  if (!info.isFile()) throw new Error('不是普通文件')

  // 实在太大就不探测了，避免为了一个 200GB 的文件去读头（虽然只读 4KB，但也没必要冒险）。
  if (info.size > probeMaxBytes) {
    throw new Error(`文件过大（${formatBytes(info.size)}），超过探测上限 ${formatBytes(probeMaxBytes)}`)
  }

  const probe = await probeMedia(allowed.realPath, info.size)
  if (probe === null) {
    throw new Error('无法识别的媒体类型——只支持常见的图片（png/jpeg/gif/webp/bmp/avif/svg）与视频（mp4/mov/webm/ogg）')
  }
  if (hint !== undefined && hint !== probe.kind) {
    // 以字节嗅探为准：扩展名和模型判断都可能不准，文件内容不会骗人。
    log(`media_show：${allowed.realPath} 的 kind 提示为 ${hint}，实际按内容判定为 ${probe.kind}`)
  }

  const fingerprint = { path: allowed.realPath, size: info.size, mtimeMs: info.mtimeMs }
  const item = {
    kind: probe.kind,
    name: basename(allowed.realPath),
    path: allowed.realPath,
    mediaType: probe.mediaType,
    url: signedUrl(fingerprint, ttlMs),
    bytes: info.size,
    remote: false,
    playable: probe.playable,
    ...(isPositive(probe.width) ? { width: probe.width } : {}),
    ...(isPositive(probe.height) ? { height: probe.height } : {}),
    ...(isPositiveNumber(probe.duration) ? { duration: Math.round(probe.duration * 1000) / 1000 } : {}),
    ...(typeof entry?.caption === 'string' && entry.caption !== '' ? { caption: entry.caption } : {}),
    ...(typeof entry?.alt === 'string' && entry.alt !== '' ? { alt: entry.alt } : {}),
  }

  if (typeof entry?.poster === 'string' && entry.poster.trim() !== '') {
    const posterUrl = await resolvePoster(deps, entry.poster.trim(), sessionCwd)
    if (posterUrl !== undefined) item.posterUrl = posterUrl
  }
  return item
}

/** 视频封面：同样要过白名单，失败只是没有封面，不影响视频本身。 */
async function resolvePoster({ policy, ttlMs }, raw, sessionCwd) {
  if (isRemoteUrl(raw)) return raw
  const allowed = await policy.resolveAllowed(toAbsolute(raw, sessionCwd))
  if (!allowed.ok) return undefined
  try {
    const info = await stat(allowed.realPath)
    if (!info.isFile()) return undefined
    return signedUrl({ path: allowed.realPath, size: info.size, mtimeMs: info.mtimeMs }, ttlMs)
  } catch {
    return undefined
  }
}

/** 远端链接：不嗅探、不签名，直接用原始 URL。 */
function remoteItem(raw, entry, hint) {
  return {
    kind: hint ?? guessRemoteKind(raw),
    name: basename(new URL(raw).pathname) || raw,
    path: raw,
    mediaType: hint === 'video' ? 'video/*' : hint === 'image' ? 'image/*' : 'application/octet-stream',
    url: raw,
    remote: true,
    // 远端链接无法验证，交给浏览器去试；放不了时前端会给出下载入口。
    playable: true,
    ...(typeof entry?.caption === 'string' && entry.caption !== '' ? { caption: entry.caption } : {}),
    ...(typeof entry?.alt === 'string' && entry.alt !== '' ? { alt: entry.alt } : {}),
  }
}

/** 签发取流链接。用相对 URL，前端直接拼当前 origin 即可。 */
function signedUrl(fingerprint, ttlMs) {
  const token = mintToken(fingerprint, Date.now() + ttlMs)
  return `${ROUTE_PATH}?path=${encodeURIComponent(fingerprint.path)}&t=${encodeURIComponent(token)}`
}

/**
 * 生成给模型看的摘要。
 *
 * 模型看不到结构化返回值，只看到这里产出的内容，所以必须把"已经展示了什么"
 * 讲清楚：否则模型可能以为需要再写一遍 markdown，或者重复调用。
 */
function renderForModel(_args, value) {
  const items = Array.isArray(value?.items) ? value.items : []
  const errors = Array.isArray(value?.errors) ? value.errors : []
  const images = items.filter(item => item.kind === 'image').length
  const videos = items.length - images

  const lines = [
    `已在聊天界面展示 ${String(items.length)} 项媒体（图片 ${String(images)}，视频 ${String(videos)}）：`
    + '图片可点击全屏放大，视频可直接播放。无需再用 markdown 重复引用。',
  ]
  for (const [index, item] of items.entries()) {
    lines.push(`${String(index + 1)}. ${describeItem(item)}`)
  }
  if (errors.length > 0) {
    lines.push(`未展示 ${String(errors.length)} 项：`)
    for (const failure of errors) {
      lines.push(`- ${failure.path === '' ? '(空路径)' : failure.path}：${failure.message}`)
    }
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

/** 单条媒体的文字描述。 */
function describeItem(item) {
  const size = isPositive(item.bytes) ? ` · ${formatBytes(item.bytes)}` : ''
  const dimensions = isPositive(item.width) && isPositive(item.height)
    ? ` · ${String(item.width)}×${String(item.height)}`
    : ''
  const duration = isPositiveNumber(item.duration) ? ` · ${formatDuration(item.duration)}` : ''
  const label = item.kind === 'image' ? '图片' : item.playable ? '视频' : '视频（浏览器可能无法播放）'
  const caption = typeof item.caption === 'string' ? ` · ${item.caption}` : ''
  return `[${label}] ${item.name}${dimensions}${duration}${size} · ${item.path}${caption}`
}

/**
 * 落盘给前端读的结构化载荷。
 *
 * 直接返回整个规范化值：内容都很小，而且"前端看到的就是工具返回的"这条规则最简单，
 * 不会出现两边字段名对不上的情况。
 */
function presentationMetaOf(_args, value) {
  return value
}

/** 读调用方会话的工作区。任何一步拿不到都返回 undefined，绝不让它影响工具可用性。 */
function readSessionCwd(ctx, exec) {
  try {
    const id = exec?.agent?.id
    if (id === undefined || ctx === undefined || ctx === null) return undefined
    const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
    if (sessions === undefined || typeof sessions.get !== 'function') return undefined
    const session = sessions.get(id)
    const cwd = session?.header?.cwd ?? session?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  } catch {
    return undefined
  }
}

/** 判断是否远端链接。 */
function isRemoteUrl(value) {
  return /^https?:\/\//i.test(value)
}

/** 相对路径按会话工作区解析；没有工作区信息时退回进程 cwd。 */
function toAbsolute(raw, sessionCwd) {
  const expanded = raw === '~'
    ? homedir()
    : raw.startsWith('~/') ? resolve(homedir(), raw.slice(2)) : raw
  if (isAbsolute(expanded)) return resolve(expanded)
  return resolve(sessionCwd ?? process.cwd(), expanded)
}

/** 把 kind 提示收窄成 'image' | 'video' | undefined。 */
function normalizeKind(value) {
  return value === 'image' || value === 'video' ? value : undefined
}

/** 远端链接按扩展名猜类型，只为给个初值。 */
function guessRemoteKind(url) {
  let pathname = url
  try {
    pathname = new URL(url).pathname
  } catch {
    // 非法 URL 就按原串判断。
  }
  return /\.(mp4|m4v|mov|webm|ogv|ogg|avi|mkv|flv|ts)$/i.test(pathname) ? 'video' : 'image'
}

/** 收窄 layout。 */
function normalizeLayout(value) {
  return value === 'column' ? 'column' : 'grid'
}

/** @returns {boolean} 正整数。 */
function isPositive(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** @returns {boolean} 正有限数。 */
function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** 人类可读的字节数。 */
function formatBytes(bytes) {
  if (!isPositive(bytes)) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? String(Math.round(value)) : value.toFixed(1)} ${units[unit]}`
}

/** 人类可读的时长。 */
function formatDuration(seconds) {
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}
