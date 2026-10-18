/**
 * dsh-media-gallery —— DeepSeek Harness 的图片/视频展示插件。
 *
 * 解决的问题：Harness 自带的聊天界面里，图片只有一条很窄的路（助手正文里写绝对
 * 路径，前端把它改写成 `/api/file?path=...`），有 20MB 上限、点了没反应；视频则
 * 完全没有渲染路径——markdown 渲染器只会产出 `<img>`。
 *
 * 本插件给出一条完整链路：
 *   - 宿主侧：`media_show` 工具 + 一条支持 Range 的分块流式取流路由；
 *   - 浏览器侧：为 `media_show` 注册专属的 `tool.call.toolview`，渲染成画廊。
 *
 * ── 两条硬约束（踩过坑，违反即挂载失败）──
 *
 * ① 零依赖纯 ESM：绝不 `import '@deepseek-ai/*'`。以符号链接方式安装的插件会被
 *    Node 解析到真实路径，parent-walk 找不到 dsh 安装目录里的包，运行期直接报
 *    MODULE_NOT_FOUND。需要用到的东西一律就地实现或从 ctx 上惰性取。
 *
 * ② `inject` 保持为空：写进 inject 的服务名如果在进程内不存在，插件会挂载失败，
 *    连带把 Web 端口拖死。注册类动作（工具、路由）走 `ctx.inject(deps, cb)`
 *    延迟注册——既不会因缺服务挂载失败，服务就绪后也一定会注册上。
 *
 * @module dsh-media-gallery
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRootPolicy } from './lib/roots.js'
import { createMediaRoute } from './lib/route.js'
import { createMediaShowTool } from './lib/tool.js'

/** Cordis 插件名。 */
export const name = 'dsh-media-gallery'

/** 刻意留空：见文件头硬约束 ②。 */
export const inject = []

/** 默认取流链接有效期：12 小时。 */
const DEFAULT_TTL_HOURS = 12

/** 默认单文件上限：8GiB。视频很容易上到几百 MB，官方 `/api/file` 的 20MB 根本不够。 */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024 * 1024

/** 默认数据目录。 */
const DEFAULT_MEDIA_DIR = '~/.dsh/media-gallery'

/**
 * 装配插件。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {object} [config] - 插件配置。
 * @param {string[]} [config.roots] - 额外放行的根目录（支持 `~`）。
 * @param {string} [config.mediaDir] - 插件自己的媒体目录，默认 `~/.dsh/media-gallery`。
 * @param {boolean} [config.allowAnyPath] - 关掉白名单，放行任意绝对路径。默认 false。
 * @param {number} [config.ttlHours] - 取流链接有效期（小时），默认 12。
 * @param {number} [config.maxBytes] - 单文件上限（字节），默认 8GiB。
 * @param {boolean} [config.verbose] - 是否打印启动摘要，默认 true。
 */
export function apply(ctx, config = {}) {
  const log = createLogger(ctx, config.verbose !== false)

  const ttlMs = positiveOr(config.ttlHours, DEFAULT_TTL_HOURS) * 60 * 60 * 1000
  const maxBytes = positiveOr(config.maxBytes, DEFAULT_MAX_BYTES)
  const mediaDir = expandHome(typeof config.mediaDir === 'string' ? config.mediaDir : DEFAULT_MEDIA_DIR)

  // 默认放行 DSH 自己托管的工作区根：渠道型会话（微信/飞书等）的工作区都创建在这里。
  const defaultRoots = [join(homedir(), '.dsh', 'workspaces')]
  const extraRoots = Array.isArray(config.roots) ? config.roots.filter(r => typeof r === 'string') : []
  const policy = createRootPolicy({
    roots: [...defaultRoots, ...extraRoots],
    mediaDir,
    allowAnyPath: config.allowAnyPath === true,
  })

  // ── 会话工作区观察 ──
  // 会话工作区是每个会话各自建的，不能只靠静态配置，只能从会话上观察。
  // 观察回调必须整体 try/catch：这是旁路逻辑，一次意外形状绝不能把主链路打挂。
  const watchSession = (session) => {
    try {
      policy.rememberSession(session)
    } catch {
      // 忽略：观察失败只是少一个白名单根目录。
    }
  }
  ctx.on('session/created', watchSession)
  ctx.on('session/event', watchSession)

  // 启动时把已经活着的会话补进来。
  try {
    const sessions = ctx.get('sessions')
    if (sessions !== undefined && typeof sessions.list === 'function') {
      for (const session of sessions.list()) watchSession(session)
    }
  } catch {
    // 会话服务不在（headless 组装）——不影响插件挂载，运行时靠事件补。
  }

  // ── 注册取流路由 ──
  const route = createMediaRoute({ maxBytes, log })
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(
      () => connectionCtx.connection.fetch.register(route),
      `dsh-media-gallery: ${route.path}`,
    )
    log(`已注册取流路由 ${route.path}（单文件上限 ${formatBytes(maxBytes)}）`)
  })

  // ── 注册工具 ──
  const tool = createMediaShowTool({
    policy,
    getContext: () => ctx,
    ttlMs,
    probeMaxBytes: maxBytes,
    log,
  })
  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(
      () => toolsCtx.tools.register(tool),
      `dsh-media-gallery: tool ${tool.name}`,
    )
    log(`已注册工具 ${tool.name}`)
  })

  if (config.verbose !== false) {
    log(
      `启动完成。允许的目录：${policy.roots().join('、')}`
      + `；取流链接有效期 ${String(Math.round(ttlMs / 3600000))} 小时`
      + `${config.allowAnyPath === true ? '；⚠ allowAnyPath 已开启，任意绝对路径都可被读取' : ''}`,
    )
  }

  // 返回的 disposer 由 cordis 收集（fiber 卸载时调用）。路由与工具的注销已经各自
  // 挂在 ctx.effect 上，这里不需要额外动作——显式返回一个空清理函数，避免将来有人
  // 往 apply 里加了持有资源的逻辑却忘了接上卸载路径。
  return () => {
    log('已卸载。')
  }
}

/** 建一个日志函数：取不到 ctx.logger 就退化成静默，绝不因为日志失败影响主流程。 */
function createLogger(ctx, verbose) {
  const logger = (() => {
    try {
      return ctx.logger
    } catch {
      return undefined
    }
  })()
  return (message) => {
    if (!verbose) return
    try {
      logger?.info?.(`[dsh-media-gallery] ${message}`)
    } catch {
      // 日志失败不该影响任何东西。
    }
  }
}

/** 展开开头的 `~`。 */
function expandHome(input) {
  if (input === '~') return homedir()
  return input.startsWith('~/') ? resolve(homedir(), input.slice(2)) : resolve(input)
}

/** 只接受正的有限数，否则用默认值。 */
function positiveOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** 人类可读的字节数，仅用于启动摘要。 */
function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? String(Math.round(value)) : value.toFixed(1)} ${units[unit]}`
}
