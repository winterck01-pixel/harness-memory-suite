/**
 * 取流 URL 的签名与校验。
 *
 * 为什么要签名：`/api/media-gallery/raw?path=/任意/路径` 如果只靠路径参数，
 * 就等于把一条"读服务器上任何文件"的通道交给了页面。官方 `/api/file` 确实是这个
 * 口径，但我们没必要再开一条更宽松的（它还能 Range 读大文件）。
 *
 * 这里用 HMAC 把 **路径 + 大小 + mtime + 过期时间** 一起签进去：
 *   - 路径进签名 → 改一个字符签名就失效，无法拿一个 token 枚举别的文件；
 *   - 大小和 mtime 进签名 → 文件被替换后旧 token 自动作废，不会拿旧授权读新内容；
 *   - 过期时间进签名 → 不需要在服务端存任何会话状态。
 *
 * 白名单校验发生在**签发时**（`lib/roots.js` 负责），也就是模型意图被解读的那一处。
 * 校验取流时只需验签，职责单一，也不存在"两处规则不一致"的问题。
 *
 * 密钥每进程随机生成，不落盘 —— 重启即作废旧 URL，符合预期。
 *
 * @module dsh-media-gallery/lib/sign
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** 令牌版本前缀，将来换算法时能干净地区分开。 */
const VERSION = 'v1'

/** 单次进程的签名密钥。 */
const SECRET = randomBytes(32)

/**
 * 生成一个媒体取流令牌。
 * @param {{ path: string, size: number, mtimeMs: number }} target - 被授权读取的文件指纹。
 * @param {number} expiresAt - 过期时间（Unix 毫秒）。
 * @returns {string} URL 安全的令牌。
 */
export function mintToken(target, expiresAt) {
  const payload = `${VERSION}.${Math.floor(expiresAt)}`
  return `${payload}.${sign(payload, target)}`
}

/**
 * 校验令牌是否对该文件指纹有效且未过期。
 *
 * 过期与签名不符都返回 false —— 调用方不需要区分，避免把"这个文件存在"这类
 * 信息泄漏给一个签名不对的请求。
 *
 * @param {string} token - 待校验令牌。
 * @param {{ path: string, size: number, mtimeMs: number }} target - 当前文件指纹。
 * @param {number} now - 当前时间（Unix 毫秒），由调用方传入以便测试。
 * @returns {boolean}
 */
export function verifyToken(token, target, now) {
  if (typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [version, expiresRaw, signature] = parts
  if (version !== VERSION) return false
  const expiresAt = Number(expiresRaw)
  if (!Number.isFinite(expiresAt) || now > expiresAt) return false
  return equalConstantTime(signature, sign(`${version}.${expiresRaw}`, target))
}

/** 对载荷与文件指纹求 HMAC。 */
function sign(payload, target) {
  return createHmac('sha256', SECRET)
    .update(payload)
    .update('\0')
    .update(fingerprint(target))
    .digest('base64url')
}

/**
 * 文件指纹：路径 + 大小 + mtime。
 *
 * 用 `\0` 分隔而不是直接拼接 —— 文件名可以含任意字符，不加分隔符的话
 * `("/a", 1)` 和 `("/a1", ...)` 这类组合会有歧义。
 */
function fingerprint(target) {
  return `${target.path}\0${target.size}\0${target.mtimeMs}`
}

/**
 * 定长恒定时间比较，避免按字节比较泄漏签名前缀。
 * 长度不同直接判否（长度本身不是秘密）。
 */
function equalConstantTime(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
