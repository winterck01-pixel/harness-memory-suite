import { parse } from 'yaml'
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const SKILL_MAX_BYTES = 256 * 1024

export function parseFrontmatter(raw) {
  if (typeof raw !== 'string') return null
  const first = raw.indexOf('\n')
  if (first < 0 || raw.slice(0, first).replace(/\r$/, '') !== '---') return null
  let start = first + 1
  for (let line = start; line <= raw.length;) {
    const end = raw.indexOf('\n', line)
    const stop = end < 0 ? raw.length : end
    if (raw.slice(line, stop).replace(/\r$/, '') === '---') {
      const data = parse(raw.slice(start, line))
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
      return { data, body: raw.slice(end < 0 ? raw.length : end + 1) }
    }
    if (end < 0) return null
    line = end + 1
  }
  return null
}
function boolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined
  const v = data[key]
  if (typeof v === 'boolean') return v
  if (v === 1 || v === '1') return true
  if (v === 0 || v === '0') return false
  if (typeof v === 'string') {
    if (['true', 'yes', 'on'].includes(v.toLowerCase())) return true
    if (['false', 'no', 'off'].includes(v.toLowerCase())) return false
  }
  throw new TypeError(`frontmatter field ${key} must be a boolean`)
}
export function invocationOf(data) {
  for (const [legacy, canonical] of [['disableModelInvocation','disable-model-invocation'],['modelInvocable','disable-model-invocation'],['userInvocable','user-invocable']]) {
    if (Object.hasOwn(data, legacy)) throw new Error(`${legacy} is unsupported; use ${canonical}`)
  }
  return { modelInvocable: boolean(data, 'disable-model-invocation') !== true, userInvocable: boolean(data, 'user-invocable') !== false }
}
export function validateContent(content) {
  const errors = []; let parsed
  try { parsed = parseFrontmatter(content) } catch (e) { errors.push(`YAML错误：${e.message}`) }
  if (!parsed) errors.push('文件须以 --- 开头，包含有效 YAML frontmatter')
  const data = parsed?.data ?? {}
  if (typeof data.name !== 'string' || !SKILL_NAME_RE.test(data.name)) errors.push('name须为小写字母、数字与中划线')
  if (typeof data.description !== 'string' || data.description.length === 0) errors.push('description须为非空字符串')
  try { invocationOf(data) } catch(e) { errors.push(e.message) }
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > SKILL_MAX_BYTES) errors.push('内容超过256KiB UTF-8上限')
  return { ok: errors.length === 0, errors, data, body: parsed?.body ?? '' }
}
export function skillTemplate(name) { return `---\nname: ${name}\ndescription: 描述能力和触发条件\n---\n\n# ${name}\n` }
