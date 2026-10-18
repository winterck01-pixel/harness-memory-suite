import {createMediaOperations} from './media-operations.js'
import {directorySize} from './lib/directory-size.js'
import { createKnowledgeFiles } from './lib/knowledge-files.js'
import { knowledgeType } from './lib/file-types.js'
import { mapLimited, mutationQueue, thumbnailCache, revisionOf } from './lib/performance.js'


import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'


export const name = 'dsh-fileman'


export const inject = []


const API_PREFIX = '/dsh-fileman/'
const API_ROUTE = API_PREFIX.replace(/\/+$/u, '')


const MAX_BODY_BYTES = 1024 * 1024


const MAX_PREVIEW_BYTES = 512 * 1024


const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'log', 'csv', 'tsv', 'xml', 'html', 'htm', 'css', 'scss', 'less',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift', 'dart',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'graphql', 'proto', 'diff', 'patch',
])


const IMAGE_TYPES = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['jpe', 'image/jpeg'],
  ['gif', 'image/gif'], ['webp', 'image/webp'], ['avif', 'image/avif'], ['apng', 'image/apng'],
  ['bmp', 'image/bmp'], ['ico', 'image/x-icon'], ['svg', 'image/svg+xml'],
  ['tif', 'image/tiff'], ['tiff', 'image/tiff'], ['heic', 'image/heic'], ['heif', 'image/heif'],
])

const VIDEO_TYPES = new Map([
  ['mp4', 'video/mp4'], ['m4v', 'video/mp4'], ['webm', 'video/webm'], ['ogv', 'video/ogg'],
  ['mov', 'video/quicktime'], ['mkv', 'video/x-matroska'], ['avi', 'video/x-msvideo'],
  ['mpg', 'video/mpeg'], ['mpeg', 'video/mpeg'], ['3gp', 'video/3gpp'], ['m2ts', 'video/mp2t'],
])

const AUDIO_TYPES = new Map([
  ['mp3', 'audio/mpeg'], ['m4a', 'audio/mp4'], ['aac', 'audio/aac'], ['wav', 'audio/wav'],
  ['wave', 'audio/wav'], ['flac', 'audio/flac'], ['ogg', 'audio/ogg'], ['oga', 'audio/ogg'],
  ['opus', 'audio/ogg'], ['weba', 'audio/webm'], ['aif', 'audio/aiff'], ['aiff', 'audio/aiff'],
  ['wma', 'audio/x-ms-wma'], ['mid', 'audio/midi'], ['midi', 'audio/midi'],
])


function extensionOf(name) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}


function mediaKind(name) {
  const extension = extensionOf(name)
  if (IMAGE_TYPES.has(extension)) return 'image'
  if (VIDEO_TYPES.has(extension)) return 'video'
  if (AUDIO_TYPES.has(extension)) return 'audio'
  if (extension === 'pdf') return 'pdf'
  if (TEXT_EXTENSIONS.has(extension)) return 'text'
  return 'file'
}


function isInlineKind(kind) {
  return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf'
}


function inlineType(name) {
  const extension = extensionOf(name)
  return IMAGE_TYPES.get(extension)
    ?? VIDEO_TYPES.get(extension)
    ?? AUDIO_TYPES.get(extension)
    ?? (extension === 'pdf' ? 'application/pdf' : 'application/octet-stream')
}


function parseRange(header, size) {
  if (typeof header !== 'string') return undefined
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim())
  if (match === null) return undefined
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return undefined

  let start
  let end
  if (rawStart === '') {

    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return undefined
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined
  if (start > end || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}


function createRuntime() {
  const mutate = mutationQueue()
  const thumbnails = thumbnailCache()
  let disposed = false
  const activeOperations = new Set()
  let fenceResolved = false
  let fence = null

  return {
    mutate, thumbnails,


    async run(operation) {
      if (disposed) throw new Error('文件管理器正在卸载，请稍后重试')
      const pending = Promise.resolve().then(operation)
      activeOperations.add(pending)
      try {
        return await pending
      } finally {
        activeOperations.delete(pending)
      }
    },


    async shutdown() {
      disposed = true
      await Promise.allSettled([...activeOperations])
    },


    fence(ctx) {
      if (!fenceResolved) {
        const candidate = ctx.get?.('connection')
        if (candidate && typeof candidate.requestRejection === 'function') {
          fence = candidate
          fenceResolved = true
          ctx.logger?.info?.('[dsh-fileman] 连接围栏已启用（Host/Origin + 登录令牌）')
        }
        return fence
      }
      return fence
    },
  }
}


function registerOnService(ctx, serviceName, setup) {
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject([serviceName], (scoped) => setup(scoped.get?.(serviceName)))
      return
    }
  } catch (error) {
    if (!(error instanceof TypeError) || !String(error.message).includes('ctx.inject is not a function')) throw error
  }
  setup(ctx.get?.(serviceName))
}


function readConfig(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  const root = typeof raw.root === 'string' && raw.root.trim().length > 0 ? raw.root.trim() : homedir()
  return {
    root: resolve(root),
    trash: raw.trash !== false,
    writable: raw.writable !== false,

    media: raw.media !== false,

    thumbnails: raw.thumbnails !== false,
  }
}


function sendJson(response, status, payload) {
  if (response.destroyed || response.writableEnded) return
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}


function readBody(request) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        rejectPromise(Object.assign(new Error('请求体过大'), { status: 413 }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    request.on('error', rejectPromise)
  })
}


async function readJson(request) {
  const text = await readBody(request)
  if (text.trim().length === 0) return {}
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('不是对象')
    return parsed
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON 对象'), { status: 400 })
  }
}


function insideRoot(base, child) {
  const rel = relative(base, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}


async function deepestExisting(target) {
  let current = target
  for (;;) {
    try {
      await lstat(current)
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return current
      current = parent
    }
  }
}


async function resolveInside(root, input) {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\u0000')) return undefined
  const lexically = normalize(isAbsolute(input) ? input : join(root, input))
  if (!insideRoot(root, lexically)) return undefined
  const anchor = await deepestExisting(lexically)
  let real
  try {
    real = await realpath(anchor)
  } catch {
    return undefined
  }
  return insideRoot(root, real) ? lexically : undefined
}


function safeName(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 255) return undefined
  if (trimmed === '.' || trimmed === '..') return undefined
  if (/[/\\\u0000-\u001f]/u.test(trimmed)) return undefined
  return trimmed
}


async function exists(target) {
  try {
    await lstat(target)
    return true
  } catch {
    return false
  }
}


async function describeEntry(dir, dirent, record = null) {
  const full = join(dir, dirent.name)
  let info
  try {
    info = await lstat(full)
  } catch {
    return undefined
  }
  const isLink = info.isSymbolicLink()
  let target = null
  if (isLink) {
    try {
      target = await stat(full)
    } catch {
      target = null
    }
  }
  const effective = target ?? info
  const isDir = effective.isDirectory()
  return {
    name: dirent.name,
    path: full,
    dir: isDir,

    kind: isDir ? 'dir' : mediaKind(dirent.name),
    size: isDir ? 0 : effective.size,
    mtime: Math.floor(effective.mtimeMs),
    mode: (effective.mode & 0o777).toString(8).padStart(3, '0'),
    link: isLink,
    broken: isLink && target === null,
    hidden: dirent.name.startsWith('.'),

    original: record?.original ?? null,
    deletedAt: record?.deletedAt ?? null,
  }
}


function trashDirs(config) {
  const base = config.root === resolve(homedir())
    ? join(homedir(), '.local', 'share', 'Trash')
    : join(config.root, '.dsh-trash')
  return { files: join(base, 'files'), info: join(base, 'info') }
}


async function readTrashInfo(name, config) {
  const { files, info } = trashDirs(config)
  let text
  try {
    text = await readFile(join(info, `${name}.trashinfo`), 'utf8')
  } catch {
    return null
  }
  const fields = {}
  for (const line of text.split('\n')) {
    const cut = line.indexOf('=')
    if (cut <= 0) continue
    fields[line.slice(0, cut).trim()] = line.slice(cut + 1).trim()
  }
  let original = null
  if (typeof fields.Path === 'string' && fields.Path.length > 0) {
    try {
      original = decodeURIComponent(fields.Path)
    } catch {
      original = null
    }
    if (original !== null && !isAbsolute(original)) original = resolve(dirname(files), original)
  }
  return { original, deletedAt: typeof fields.DeletionDate === 'string' ? fields.DeletionDate : null }
}


async function movePath(from, to) {
  try {
    await rename(from, to)
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
    await copyPath(from, to)
    await rm(from, { recursive: true, force: true })
  }
}


async function copyPath(from, to) {
  const info = await lstat(from)
  if (info.isSymbolicLink()) {
    const { readlink, symlink } = await import('node:fs/promises')
    await symlink(await readlink(from), to)
    return
  }
  if (!info.isDirectory()) {
    await copyFile(from, to)
    return
  }
  await mkdir(to, { recursive: true, mode: info.mode })
  const entries = await readdir(from, { withFileTypes: true })
  for (const dirent of entries) await copyPath(join(from, dirent.name), join(to, dirent.name))
}


async function moveToTrash(abs, config) {
  const { files, info } = trashDirs(config)
  await mkdir(files, { recursive: true })
  await mkdir(info, { recursive: true })
  const original = basename(abs)
  let name = original
  let attempt = 1
  while (await exists(join(files, name))) {
    attempt += 1
    name = `${original}.${attempt}`
    if (attempt > 9999) throw new Error('废纸篓重名过多，无法继续')
  }
  const target = join(files, name)
  await movePath(abs, target)
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
  await writeFile(
    join(info, `${name}.trashinfo`),
    `[Trash Info]\nPath=${encodeURIComponent(abs)}\nDeletionDate=${stamp}\n`,
    'utf8',
  )
  return name
}


async function uniqueIn(dir, desired) {
  let name = desired
  let attempt = 1
  while (await exists(join(dir, name))) {
    attempt += 1
    const dot = desired.lastIndexOf('.')
    const stem = dot > 0 ? desired.slice(0, dot) : desired
    const ext = dot > 0 ? desired.slice(dot) : ''
    name = `${stem} ${attempt}${ext}`
    if (attempt > 9999) throw new Error('目标目录重名过多，无法继续')
  }
  return name
}


async function describePath(abs) {
  const info = await lstat(abs)
  const name = basename(abs)
  const isDir = info.isDirectory()
  return {
    name,
    path: abs,
    dir: isDir,
    kind: isDir ? 'dir' : mediaKind(name),
    size: isDir ? 0 : info.size,
    mtime: Math.floor(info.mtimeMs),
    mode: (info.mode & 0o777).toString(8).padStart(3, '0'),
    link: info.isSymbolicLink(),
    broken: false,
    hidden: name.startsWith('.'),

    original: null,
    deletedAt: null,
  }
}


async function locations(config) {
  const root = config.root
  const home = homedir()
  const trashFiles = trashDirs(config).files
  const candidates = [
    { name: '主目录', path: home, kind: 'home' },
    { name: '桌面', path: join(home, 'Desktop'), kind: 'desktop' },
    { name: '文档', path: join(home, 'Documents'), kind: 'document' },
    { name: '下载', path: join(home, 'Downloads'), kind: 'download' },
    { name: '图片', path: join(home, 'Pictures'), kind: 'picture' },
    { name: '音乐', path: join(home, 'Music'), kind: 'music' },
    { name: '影片', path: join(home, 'Videos'), kind: 'video' },
    { name: '公共', path: join(home, 'Public'), kind: 'public' },

    { name: '废纸篓', path: trashFiles, kind: 'trash', always: true },
    { name: '根目录', path: '/', kind: 'root' },
  ]
  const out = []
  for (const entry of candidates) {
    if (!insideRoot(root, entry.path)) continue

    if (entry.kind === 'trash' && !config.trash) continue
    if (entry.always !== true && !(await exists(entry.path))) continue
    out.push({ path: entry.path, kind: entry.kind })
  }


  return {
    root,
    home,
    locations: out,
    capabilities: {
      writable: config.writable,
      trash: config.trash,
      media: config.media,
      thumbnails: config.thumbnails,
    },
  }
}


async function pipeFile(target, response, range) {
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = range === undefined
      ? createReadStream(target)
      : createReadStream(target, { start: range.start, end: range.end })
    const onClose = () => stream.destroy()
    stream.on('error', rejectPromise)
    stream.on('end', () => {
      response.off?.('close', onClose)
      resolvePromise()
    })
    response.on('close', onClose)
    stream.pipe(response)
  })
}


const routes = {
  'GET operation-status': async ({url,runtime}) => ({status:200,payload:runtime.mutate.status(url.searchParams.get('requestId'))}),

  'GET directory-size': async ({url,config,runtime,response}) => {
    if(runtime.sizeBusy) return {status:429,payload:{error:'正在计算其他文件夹，请稍后再试'}}
    runtime.sizeBusy=true
    try {
    const target=await resolveInside(config.root,url.searchParams.get('path'))
    if(!target) return {status:403,payload:{error:'路径超出允许范围'}}
    const info=await lstat(target)
    if(!info.isDirectory()||info.isSymbolicLink()) return {status:400,payload:{error:'请选择普通文件夹；不统计符号链接'}}
    return {status:200,payload:await directorySize(config.root,target,{cancelled:()=>response.destroyed===true})}
    }
    finally {runtime.sizeBusy=false}
  },

  'GET locations': async ({ config }) => ({ status: 200, payload: await locations(config) }),

  'GET list': async ({ url, config }) => {
    const target = await resolveInside(config.root, url.searchParams.get('path') ?? config.root)
    if (target === undefined) return { status: 403, payload: { error: '路径超出允许范围' } }


    const trashFiles = trashDirs(config).files
    const inTrash = target === trashFiles
    let info
    try {
      info = await stat(target)
    } catch {
      if (!inTrash) return { status: 404, payload: { error: '目录不存在' } }

      await mkdir(target, { recursive: true })
      info = await stat(target)
    }
    if (!info.isDirectory()) return { status: 400, payload: { error: '不是目录' } }
    const dirents = await readdir(target, { withFileTypes: true })
    const records = inTrash
      ? await mapLimited(dirents, 16, (dirent) => readTrashInfo(dirent.name, config))
      : dirents.map(() => null)
    const entries = await mapLimited(dirents, 16, (dirent,index) => describeEntry(target, dirent, records[index]))
    const parent = dirname(target)
    return {
      status: 200,
      payload: {
        path: target,
        parent: inTrash || !insideRoot(config.root, parent) ? null : parent,

        trash: inTrash,
        entries: entries.filter((entry) => entry !== undefined),
      },
    }
  },

  'GET read': async ({ url, config }) => {
    const target = await resolveInside(config.root, url.searchParams.get('path'))
    if (target === undefined) return { status: 403, payload: { error: '路径超出允许范围' } }
    let info
    try {
      info = await stat(target)
    } catch {
      return { status: 404, payload: { error: '文件不存在' } }
    }
    if (info.isDirectory()) return { status: 400, payload: { error: '这是一个目录' } }
    const extension = basename(target).includes('.') ? basename(target).split('.').pop().toLowerCase() : ''
    if (!TEXT_EXTENSIONS.has(extension)) return { status: 415, payload: { error: '该类型不支持文本预览', size: info.size } }
    if (info.size > MAX_PREVIEW_BYTES) return { status: 413, payload: { error: '文件过大，无法预览', size: info.size } }
    const content = await readFile(target, 'utf8')
    return { status: 200, payload: { path: target, size: info.size, content, revision: revisionOf(content) } }
  },

  'GET thumbnail': async ({url,config,response,runtime}) => {
    if(!config.media || !config.thumbnails) return {status:403,payload:{error:'缩略图已关闭'}};
    const target=await resolveInside(config.root,url.searchParams.get('path'));
    if(!target) return {status:403,payload:{error:'路径超出允许范围'}};
    const info=await stat(target),kind=mediaKind(basename(target));
    if(!info.isFile() || !['image','video'].includes(kind) || info.size>256*1024*1024) return {status:415,payload:{error:'此文件使用类型图标'}};

    if(!['png','jpg','jpeg','webp','gif','bmp','avif','mp4','mov','m4v','webm','mkv'].includes(extensionOf(target))) return {status:415,payload:{error:'此格式使用类型图标'}};
    const {buffer,key}=await runtime.thumbnails.get(target,info,kind);
    response.writeHead(200,{'content-type':'image/jpeg','cache-control':'private, no-cache','etag':'"'+key+'"','x-content-type-options':'nosniff','content-length':buffer.length});response.end(buffer);
    return {status:0};
  },

  'GET download': async ({ url, config, request, response }) => {
    const target = await resolveInside(config.root, url.searchParams.get('path'))
    if (target === undefined) return { status: 403, payload: { error: '路径超出允许范围' } }
    let info
    try {
      info = await stat(target)
    } catch {
      return { status: 404, payload: { error: '文件不存在' } }
    }
    if (info.isDirectory()) return { status: 400, payload: { error: '目录不支持直接下载' } }


    const kind = mediaKind(basename(target))
    const wantsInline = url.searchParams.get('inline') === '1'
    if (wantsInline && !config.media) return { status: 403, payload: { error: '当前已关闭媒体预览' } }
    const inline = wantsInline && isInlineKind(kind)

    const headers = {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',

      'accept-ranges': 'bytes',
    }
    if (inline) {
      headers['content-type'] = inlineType(basename(target))


      if (kind === 'image' && extensionOf(basename(target)) === 'svg') {
        headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
      }
    } else {
      headers['content-type'] = 'application/octet-stream'
      headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(basename(target))}`
    }

    const range = parseRange(request.headers.range, info.size)
    if (range === null) {
      response.writeHead(416, { ...headers, 'content-range': `bytes */${info.size}` })
      response.end()
      return { status: 0, payload: undefined }
    }
    if (range !== undefined) {
      headers['content-range'] = `bytes ${range.start}-${range.end}/${info.size}`
      headers['content-length'] = range.end - range.start + 1
      response.writeHead(206, headers)
      await pipeFile(target, response, range)
    } else {
      headers['content-length'] = info.size
      response.writeHead(200, headers)
      await pipeFile(target, response, undefined)
    }
    return { status: 0, payload: undefined }
  },

  'POST mkdir': async ({ body, config }) => {
    if (!config.writable) return { status: 403, payload: { error: '当前为只读模式' } }
    const dir = await resolveInside(config.root, body.dir)
    const name = safeName(body.name)
    if (dir === undefined) return { status: 403, payload: { error: '路径超出允许范围' } }
    if (name === undefined) return { status: 400, payload: { error: '文件夹名不合法' } }
    const target = join(dir, name)
    if (await exists(target)) return { status: 409, payload: { error: '同名项目已存在' } }
    await mkdir(target)
    return { status: 200, payload: { entry: await describePath(target) } }
  },

  'POST rename': async ({ body, config }) => {
    if (!config.writable) return { status: 403, payload: { error: '当前为只读模式' } }
    const source = await resolveInside(config.root, body.path)
    const name = safeName(body.name)
    if (source === undefined) return { status: 403, payload: { error: '路径超出允许范围' } }
    if (name === undefined) return { status: 400, payload: { error: '名称不合法' } }
    if (source === config.root) return { status: 400, payload: { error: '不能重命名根目录' } }


    if (dirname(source) === trashDirs(config).files) {
      return { status: 400, payload: { error: '废纸篓中的项目不能重命名，可先放回原处再改' } }
    }
    const target = join(dirname(source), name)
    if (target !== source && (await exists(target))) return { status: 409, payload: { error: '同名项目已存在' } }
    await rename(source, target)
    return { status: 200, payload: { entry: await describePath(target) } }
  },

  'POST trash': async ({ body, config }) => {
    if (body.requireTrash === true && !config.trash) return { status: 409, payload: { error: '废纸篓未启用，操作已取消' } }
    if (!config.writable) return { status: 403, payload: { error: '当前为只读模式' } }
    const { files: trashFiles } = trashDirs(config)
    const list = Array.isArray(body.paths) ? body.paths : []
    if (list.length === 0) return { status: 400, payload: { error: '没有选中任何项目' } }
    const done = []
    for (const item of list) {
      const target = await resolveInside(config.root, item)
      if (target === undefined || target === config.root) {
        done.push({ path: String(item), ok: false, error: '路径不允许删除' })
        continue
      }

      if (dirname(target) === trashFiles) {
        done.push({ path: target, ok: false, error: '该项目已在废纸篓中，请使用「彻底删除」' })
        continue
      }
      try {
        if (config.trash) {
          done.push({ path: target, ok: true, restored: await moveToTrash(target, config) })
        } else {
          await rm(target, { recursive: true, force: false })
          done.push({ path: target, ok: true })
        }
      } catch (error) {
        done.push({ path: target, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return { status: 200, payload: { results: done } }
  },


  'POST restore': async ({ body, config }) => {
    if (!config.writable) return { status: 403, payload: { error: '当前为只读模式' } }
    const { files: trashFiles, info: trashInfo } = trashDirs(config)
    const list = Array.isArray(body.paths) ? body.paths : []
    if (list.length === 0) return { status: 400, payload: { error: '没有选中任何项目' } }
    const results = []
    for (const item of list) {
      const source = await resolveInside(config.root, item)
      if (source === undefined || dirname(source) !== trashFiles) {
        results.push({ path: String(item), ok: false, error: '只能还原废纸篓中的项目' })
        continue
      }
      const name = basename(source)
      const record = await readTrashInfo(name, config)
      if (record === null || record.original === null) {
        results.push({ path: source, ok: false, error: '缺少废纸篓记录，无法确定原位置' })
        continue
      }
      const destination = await resolveInside(config.root, record.original)
      if (destination === undefined || destination === config.root) {
        results.push({ path: source, ok: false, error: '原位置已超出允许范围' })
        continue
      }
      try {
        const home = dirname(destination)
        await mkdir(home, { recursive: true })
        const final = join(home, await uniqueIn(home, basename(destination)))
        await movePath(source, final)
        await rm(join(trashInfo, `${name}.trashinfo`), { force: true })
        results.push({ path: source, ok: true, restored: final })
      } catch (error) {
        results.push({ path: source, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return { status: 200, payload: { results } }
  },


  'POST purge': async ({ body, config }) => {
    if (!config.writable) return { status: 403, payload: { error: '当前为只读模式' } }
    const { files: trashFiles, info: trashInfo } = trashDirs(config)
    const list = Array.isArray(body.paths) ? body.paths : []
    if (list.length === 0) return { status: 400, payload: { error: '没有选中任何项目' } }
    const results = []
    for (const item of list) {
      const target = await resolveInside(config.root, item)
      if (target === undefined || dirname(target) !== trashFiles) {
        results.push({ path: String(item), ok: false, error: '只能彻底删除废纸篓中的项目' })
        continue
      }
      const name = basename(target)
      try {
        await rm(target, { recursive: true, force: false })
        await rm(join(trashInfo, `${name}.trashinfo`), { force: true })
        results.push({ path: target, ok: true })
      } catch (error) {
        results.push({ path: target, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return { status: 200, payload: { results } }
  },


  'POST trash-empty': async ({ config }) => {
    if (!config.writable) return { status: 403, payload: { error: '当前为只读模式' } }
    const { files: trashFiles, info: trashInfo } = trashDirs(config)
    let removed = 0
    let entries = []
    try {
      entries = await readdir(trashFiles)
    } catch {
      return { status: 200, payload: { removed: 0 } }
    }
    for (const name of entries) {
      try {
        await rm(join(trashFiles, name), { recursive: true, force: true })
        removed += 1
      } catch {

      }
    }
    let records = []
    try {
      records = await readdir(trashInfo)
    } catch {
      records = []
    }
    for (const file of records) {
      if (!file.endsWith('.trashinfo')) continue
      try {
        await rm(join(trashInfo, file), { force: true })
      } catch {

      }
    }
    return { status: 200, payload: { removed } }
  },

  'POST move': async ({ body, config }) => {
    if (!config.writable) return { status: 403, payload: { error: '当前为只读模式' } }
    const dest = await resolveInside(config.root, body.dest)
    const list = Array.isArray(body.paths) ? body.paths : []
    if (dest === undefined) return { status: 403, payload: { error: '目标超出允许范围' } }
    if (!(await stat(dest)).isDirectory()) return { status: 400, payload: { error: '目标不是目录' } }
    const results = []
    for (const item of list) {
      const source = await resolveInside(config.root, item)
      if (source === undefined || source === config.root) {
        results.push({ path: String(item), ok: false, error: '路径不允许移动' })
        continue
      }

      if (dirname(source) === trashDirs(config).files) {
        results.push({ path: source, ok: false, error: '废纸篓中的项目请使用「放回原处」' })
        continue
      }
      if (dest === source || insideRoot(source, dest)) {
        results.push({ path: source, ok: false, error: '不能移动到自身或其子目录' })
        continue
      }
      if (dirname(source) === dest) {
        try { await lstat(source); results.push({path:source,ok:true,unchanged:true}) }
        catch(error) { results.push({path:source,ok:false,error:error.message}) }
        continue
      }
      try {
        const target = join(dest, await uniqueIn(dest, basename(source)))
        await movePath(source, target)
        results.push({ path: target, ok: true })
      } catch (error) {
        results.push({ path: source, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return { status: 200, payload: { results } }
  },

  'POST copy': async ({ body, config }) => {
    if (!config.writable) return { status: 403, payload: { error: '当前为只读模式' } }
    const dest = await resolveInside(config.root, body.dest)
    const list = Array.isArray(body.paths) ? body.paths : []
    if (dest === undefined) return { status: 403, payload: { error: '目标超出允许范围' } }
    if (!(await stat(dest)).isDirectory()) return { status: 400, payload: { error: '目标不是目录' } }
    const results = []
    for (const item of list) {
      const source = await resolveInside(config.root, item)
      if (source === undefined) {
        results.push({ path: String(item), ok: false, error: '路径不允许复制' })
        continue
      }
      if (dest === source || insideRoot(source, dest)) {
        results.push({ path: source, ok: false, error: '不能复制到自身或其子目录' })
        continue
      }
      try {
        const target = join(dest, await uniqueIn(dest, basename(source)))
        await copyPath(source, target)
        results.push({ path: target, ok: true })
      } catch (error) {
        results.push({ path: source, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return { status: 200, payload: { results } }
  },

  'POST write': async ({ body, config }) => {
    if (!config.writable) return { status: 403, payload: { error: '当前为只读模式' } }
    const target = await resolveInside(config.root, body.path)
    if (target === undefined) return { status: 403, payload: { error: '路径超出允许范围' } }
    if (typeof body.content !== 'string') return { status: 400, payload: { error: '缺少内容' } }
    if(typeof body.revision === 'string') {
      if((await stat(target)).size>MAX_PREVIEW_BYTES) return {status:409,payload:{error:'文件已变大，未覆盖，请重新检查原文件'}};
      const current=await readFile(target,'utf8');
      if(revisionOf(current)!==body.revision) return {status:409,payload:{error:'文件已被其他操作修改，未覆盖。请重新读取并对比草稿。'}};
    }
    await writeFile(target, body.content, 'utf8')
    return { status: 200, payload: { entry: await describePath(target) } }
  },
}


async function handleRequest(ctx, config, runtime, request, response) {


  const guard = runtime.fence(ctx)
  if (guard !== null) {
    try {
      const rejection = guard.requestRejection({ headers: request.headers })
      if (rejection !== undefined) {
        sendJson(response, rejection, { error: rejection === 401 ? '未认证' : '来源不被信任' })
        return
      }
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-fileman] 连接围栏异常：${error instanceof Error ? error.message : String(error)}`)
      sendJson(response, 403, { error: '来源校验失败' })
      return
    }
  }

  const url = new URL(request.url ?? '/', 'http://localhost')
  const route = url.pathname.slice(API_PREFIX.length).replace(/\/+$/u, '')
  const key = `${request.method} ${route}`
  const handler = route.startsWith('knowledge/') ? async ({body,url}) => {
    const vault = ctx.get?.('knowledgeVault');
    if (!vault) return {status:503,payload:{error:'知识库插件未启用'}};
    if (request.method === 'POST' && !config.writable) return {status:403,payload:{error:'当前为只读模式'}};
    if(key === 'GET knowledge/deletion-requests')return {status:200,payload:{items:vault.pendingDeletions()}};
    if(key === 'POST knowledge/resolve-deletion')return {status:200,payload:await vault.resolveDeletion(body.id,body.approve===true)};
    if(key === 'GET knowledge/collections')return {status:200,payload:{items:vault.collections()}};
    if(key === 'GET knowledge/history')return {status:200,payload:{items:vault.history(url.searchParams.get('id'))}};
    if(key === 'POST knowledge/restore')return {status:200,payload:await vault.restore(body.id,body.updatedAt,'user',body.version)};
    if(key === 'POST knowledge/import')return {status:200,payload:await runtime.knowledgeFiles.importPath(body.path)};
    if(key === 'POST knowledge/upload')return {status:200,payload:await runtime.knowledgeFiles.upload(body)};
    if(key === 'POST knowledge/cancel-upload')return {status:200,payload:await runtime.knowledgeFiles.cancel(body.uploadId)};
    if(key === 'GET knowledge/list') return {status:200,payload:vault.list(url.searchParams.get('query') || '',Number(url.searchParams.get('offset') || 0),{classify:knowledgeType,type:url.searchParams.get('type') || 'all',collectionId:url.searchParams.get('collectionId')||'',parent:url.searchParams.has('parent')?url.searchParams.get('parent'):undefined,trash:url.searchParams.get('trash')==='true'})};
    if(key === 'GET knowledge/get') {
      const entry=vault.get(url.searchParams.get('id'));
      let file=null;
      if(entry.assetId.startsWith('file:')) {
        const path=await resolveInside(config.root,entry.assetId.slice(5));
        if(path) { try {file=await describePath(path)} catch {                                          } }
      }
      return {status:200,payload:{entry:{...entry,type:knowledgeType(entry)},file}};
    }
    if(key === 'POST knowledge/save') {
      if(body.assetId?.startsWith('file:') && !body.id) {
        const path=await resolveInside(config.root,body.assetId.slice(5));
        if(!path || !(await stat(path)).isFile()) return {status:400,payload:{error:'只能关联允许范围内的现有文件'}};
        body.assetId='file:'+path;
      }
      return {status:200,payload:await vault.save(body)};
    }
    if(key === 'POST knowledge/remove') return {status:200,payload:await vault.remove(body.id,body.updatedAt)};
    return {status:404,payload:{error:'未知知识库接口'}};
  } : routes[key]
  if (handler === undefined) {
    sendJson(response, 404, { error: `未知接口：${key}` })
    return
  }

  try {
    const body = request.method === 'POST' ? await readJson(request) : {}
    const work=()=>{
      const invoke=()=>handler({ url, request, body, config, response, runtime });
      if(!route.startsWith('knowledge/'))return invoke();
      const vault=ctx.get?.('knowledgeVault');
      if(!vault)return invoke();
      if(typeof vault.runForRequest!=='function')throw new Error('AUTHENTICATED_KNOWLEDGE_SERVICE_REQUIRED');
      const headers=new Headers();for(const [name,value] of Object.entries(request.headers)){if(Array.isArray(value))for(const part of value)headers.append(name,part);else if(value!==undefined)headers.set(name,value);}
      return vault.runForRequest(new Request(url,{headers}),invoke);
    };
    const result = await runtime.run(() => request.method === 'POST'
      ? runtime.mutate(typeof body.requestId === 'string' && body.requestId.length<=128 ? body.requestId : null, JSON.stringify([key,body]), work)
      : work());
    if (result.status !== 0) sendJson(response, result.status, result.payload)
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : error?.code === 'ENOENT' ? 404 : error?.code === 'KNOWLEDGE_VAULT_REJECTED' ? 400 : 500
    sendJson(response, status, { error: error instanceof Error ? error.message : String(error) })
  }
}


export function apply(ctx, rawConfig) {
  const config = readConfig(rawConfig)
  const runtime = createRuntime()
  ctx.provide?.('filemanMedia',createMediaOperations({config,runtime,trash:routes['POST trash']}))
  runtime.knowledgeFiles=createKnowledgeFiles({config,vault:()=>ctx.get?.("knowledgeVault"),resolveInside});
  ctx.provide?.("knowledgeFiles",runtime.knowledgeFiles);
  ctx.effect(()=>()=>runtime.knowledgeFiles.close());
  ctx.logger?.info?.(
    `[dsh-fileman] 沙箱根=${config.root} 废纸篓=${config.trash ? trashDirs(config).files : '关闭'} `
    + `可写=${config.writable} 媒体预览=${config.media} 缩略图=${config.thumbnails}`,
  )

  registerOnService(ctx, 'webServer', (webServer) => {
    if (typeof webServer?.register !== 'function') {
      ctx.logger?.warn?.('[dsh-fileman] webServer 服务不可用，面板将无法读写文件')
      return
    }
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: API_ROUTE,
      handler: (request, response) => handleRequest(ctx, config, runtime, request, response),
    }), 'dsh-fileman: filesystem routes')
    ctx.logger?.info?.('[dsh-fileman] 文件系统路由已注册')
  })


  return () => runtime.shutdown()
}
