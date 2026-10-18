/**
 * 允许被取流的目录白名单。
 *
 * 默认范围 = 插件媒体目录 + 配置里显式列出的根 + **当前会话自己的工作区**。
 * 最后一项是关键：agent 生成图片视频基本都写在它自己的会话工作区里，
 * 而会话工作区每次新建都可能不同，所以不能只靠静态配置。
 *
 * 校验一律走 `realpath`：不做这一步的话，工作区里一个指向 `/etc` 的符号链接
 * 就能把白名单绕过去。
 *
 * @module dsh-media-gallery/lib/roots
 */

import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve, sep } from 'node:path'

/**
 * 建一个目录策略实例。
 * @param {{ roots?: string[], allowAnyPath?: boolean, mediaDir?: string }} config - 插件配置。
 * @returns {{
 *   rememberCwd: (cwd: unknown) => void,
 *   rememberSession: (session: unknown) => void,
 *   resolveAllowed: (absPath: string) => Promise<{ ok: true, realPath: string } | { ok: false, reason: string }>,
 *   roots: () => string[],
 * }}
 */
export function createRootPolicy(config) {
  /** 静态根：配置项 + 媒体目录。 */
  const staticRoots = new Set()
  for (const root of config.roots ?? []) {
    const normalized = normalizeRoot(root)
    if (normalized !== null) staticRoots.add(normalized)
  }
  if (typeof config.mediaDir === 'string') {
    const normalized = normalizeRoot(config.mediaDir)
    if (normalized !== null) staticRoots.add(normalized)
  }

  /** 从会话观察到的 cwd。会话工作区是动态的，所以单独存。 */
  const sessionRoots = new Set()
  /** realpath 结果缓存；根目录基本不变，避免每次取流都打一串系统调用。 */
  const realRootCache = new Map()

  /** 对根目录做一次 realpath 并缓存；根不存在时返回 null。 */
  const realRoot = async (root) => {
    if (realRootCache.has(root)) return realRootCache.get(root)
    let resolved = null
    try {
      resolved = await realpath(root)
    } catch {
      // 根目录还没被创建（比如媒体目录是懒创建的）——记为 null，下次有机会再试。
      resolved = null
    }
    realRootCache.set(root, resolved)
    return resolved
  }

  return {
    /** 记录一个会话工作区（来自 session/created 或 session/event）。 */
    rememberCwd(cwd) {
      if (typeof cwd !== 'string' || cwd === '') return
      const normalized = normalizeRoot(cwd)
      if (normalized !== null) sessionRoots.add(normalized)
    },

    /**
     * 从会话对象上抓 cwd。字段名做过兼容处理：`header.cwd` 是已验证的形状，
     * 另外顺手认一下裸 `cwd`，因为不同版本/session 来源可能不一致。
     * 整体 try/catch：这是观察者回调，不能因为一个意外形状把整条链路打挂。
     */
    rememberSession(session) {
      try {
        const header = session?.header
        this.rememberCwd(header?.cwd)
        this.rememberCwd(session?.cwd)
      } catch {
        // 观察失败不影响任何主流程。
      }
    },

    /**
     * 判断一个绝对路径是否落在白名单内。
     * @param {string} absPath - 待校验的绝对路径。
     * @returns {Promise<{ ok: true, realPath: string } | { ok: false, reason: string }>}
     *   通过时返回 realpath，调用方应直接用它去做后续 stat/读取，避免校验收缩窗口（TOCTOU）。
     */
    async resolveAllowed(absPath) {
      if (typeof absPath !== 'string' || absPath === '' || absPath.includes('\0')) {
        return { ok: false, reason: '路径为空或含有非法字符' }
      }
      if (!isAbsolute(absPath)) {
        return { ok: false, reason: '需要绝对路径' }
      }
      if (config.allowAnyPath === true) {
        return resolveReal(absPath, 'allowAnyPath 已开启')
      }

      let realPath
      try {
        realPath = await realpath(absPath)
      } catch (error) {
        return { ok: false, reason: describeFsError(error, absPath) }
      }

      const roots = [...staticRoots, ...sessionRoots]
      for (const root of roots) {
        // 注意别把这个局部变量也叫 realRoot —— 会和上面的同名闭包形成遮蔽，
        // 在 const 的暂时性死区里直接抛 ReferenceError。
        const resolvedRoot = await realRoot(root)
        if (resolvedRoot === null) continue
        if (realPath === resolvedRoot || realPath.startsWith(resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep)) {
          return { ok: true, realPath }
        }
      }

      if (roots.length === 0) {
        return {
          ok: false,
          reason: '当前没有任何允许的目录（既没有配置 roots，也还没观察到会话工作区）。'
            + '请把文件写到会话工作区，或在插件配置里用 roots 显式放行。',
        }
      }
      return {
        ok: false,
        reason: `该路径不在允许的目录内。当前允许：${roots.slice(0, 6).join('、')}`
          + (roots.length > 6 ? ` 等 ${String(roots.length)} 个` : '')
          + '。请把文件写到会话工作区，或在插件配置里用 roots 放行该目录。',
      }
    },

    /** 当前允许的根目录，用于诊断输出。 */
    roots() {
      return [...staticRoots, ...sessionRoots]
    },
  }
}

/** 把 realpath 的结果包成成功形态。 */
async function resolveReal(absPath, bypassReason) {
  try {
    return { ok: true, realPath: await realpath(absPath) }
  } catch (error) {
    return { ok: false, reason: describeFsError(error, absPath) }
  }
}

/**
 * 规范化一个根目录：展开 `~`、转绝对值。
 * @param {string} input - 配置里写的路径。
 * @returns {string | null} 规范化结果，空值返回 null。
 */
function normalizeRoot(input) {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (trimmed === '') return null
  const expanded = trimmed === '~'
    ? homedir()
    : trimmed.startsWith('~/') ? resolve(homedir(), trimmed.slice(2)) : trimmed
  return isAbsolute(expanded) ? resolve(expanded) : null
}

/** 把 fs 错误翻译成给模型看的一句话。 */
function describeFsError(error, absPath) {
  const code = error?.code
  if (code === 'ENOENT') return `文件不存在：${absPath}`
  if (code === 'EACCES' || code === 'EPERM') return `没有读取权限：${absPath}`
  if (code === 'ENOTDIR') return `路径的中间某一段不是目录：${absPath}`
  if (code === 'ELOOP') return `符号链接成环：${absPath}`
  return `无法解析路径 ${absPath}（${typeof code === 'string' ? code : '未知错误'}）`
}

export { normalizeRoot }
