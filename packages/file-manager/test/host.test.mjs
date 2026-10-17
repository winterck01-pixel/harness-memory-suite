


import assert from 'node:assert/strict'
import vm from 'node:vm'
import {parseSource,functionNode,nodes,unique} from './source-ast.mjs'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { after, before, describe, it } from 'node:test'

import { apply, inject, name as pluginName } from '../index.js'


let handler

let sandbox

let outside

let dispose


const fakeWebServer = {
  register(route) {
    handler = route.handler
    return () => {}
  },
}


function fakeContext() {
  return {
    logger: { info() {}, warn() {} },
    effect(fn) {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    inject(deps, callback) {
      callback({ get: (service) => (service === 'webServer' ? fakeWebServer : undefined) })
      return () => {}
    },
    get() {
      return undefined
    },
  }
}


async function request(method, path, body, headers = {}) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  const req = Readable.from(payload)
  req.method = method
  req.url = path
  req.headers = { host: '127.0.0.1:3080', ...headers }
  const captured = { status: 0, headers: {}, chunks: [] }
  const push = (chunk) => {
    if (chunk === undefined || chunk === null) return
    captured.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'))
  }
  const res = {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    writeHead(status, outHeaders) {
      captured.status = status
      captured.headers = outHeaders ?? {}
      this.headersSent = true
      return this
    },
    end(chunk) {
      push(chunk)
      this.writableEnded = true
      return this
    },
    write(chunk) {
      push(chunk)
      return true
    },
    on() { return this },
    once() { return this },
    off() { return this },
    emit() { return false },
  }
  await handler(req, res)
  const raw = Buffer.concat(captured.chunks)
  let parsed = null
  const text = raw.toString('utf8')
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = text
  }
  return { status: captured.status, headers: captured.headers, body: parsed, raw }
}


const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)


const COUNTER_BYTES = Buffer.from(Array.from({ length: 100 }, (_, index) => index))

describe('dsh-fileman 宿主半', () => {
  before(async () => {
    sandbox = await realpath(await mkdtemp(join(tmpdir(), 'dfm-sandbox-')))
    outside = await realpath(await mkdtemp(join(tmpdir(), 'dfm-outside-')))
    await mkdir(join(sandbox, 'docs'))
    await mkdir(join(sandbox, 'docs', 'nested'))
    await writeFile(join(sandbox, 'docs', 'note.txt'), '你好 fileman\n', 'utf8')
    await writeFile(join(sandbox, 'docs', 'blob.bin'), Buffer.alloc(32, 7))
    await writeFile(join(sandbox, '.hidden'), 'secret', 'utf8')

    await symlink(outside, join(sandbox, 'escape'))


    await mkdir(join(sandbox, 'media'))
    await mkdir(join(sandbox, 'media', 'sub'))
    await writeFile(join(sandbox, 'media', 'pixel.png'), PNG_1X1)
    await writeFile(join(sandbox, 'media', 'clip.mp4'), Buffer.from('000000186674797069736f6d', 'hex'))
    await writeFile(join(sandbox, 'media', 'tone.wav'), Buffer.from('524946462400000057415645', 'hex'))
    await writeFile(join(sandbox, 'media', 'sheet.pdf'), '%PDF-1.4\n%%EOF\n', 'utf8')
    await writeFile(join(sandbox, 'media', 'note.txt'), 'plain\n', 'utf8')
    await writeFile(join(sandbox, 'media', 'bytes.dat'), COUNTER_BYTES)
    await writeFile(join(sandbox, 'media', 'page.html'), '<script>alert(1)</script>\n', 'utf8')
    await writeFile(join(sandbox, 'media', 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n', 'utf8')
    await writeFile(join(sandbox, 'media', 'Movie.MP4'), Buffer.from('000000186674797069736f6d', 'hex'))

    dispose = apply(fakeContext(), { root: sandbox, trash: false, writable: true })
  })

  after(async () => {
    if (typeof dispose === 'function') await dispose()
    await rm(sandbox, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('导出符合 cordis 函数插件契约', () => {
    assert.equal(typeof apply, 'function')
    assert.equal(pluginName, 'dsh-fileman')
    assert.deepEqual(inject, [])
  })

  it('locations 只列出根内存在的位置', async () => {
    const { status, body } = await request('GET', '/dsh-fileman/locations')
    assert.equal(status, 200)
    assert.equal(body.root, sandbox)
    for (const location of body.locations) {
      assert.ok(location.path === sandbox || location.path.startsWith(`${sandbox}/`) || location.path === '/')
    }

    assert.ok(!body.locations.some((location) => location.kind === 'trash'))
    assert.equal(body.capabilities.trash, false)
  })

  it('list 返回目录条目与父目录', async () => {
    const { status, body } = await request('GET', `/dsh-fileman/list?path=${encodeURIComponent(join(sandbox, 'docs'))}`)
    assert.equal(status, 200)
    assert.equal(body.parent, sandbox)
    const names = body.entries.map((entry) => entry.name).sort()
    assert.deepEqual(names, ['blob.bin', 'nested', 'note.txt'])
    const nested = body.entries.find((entry) => entry.name === 'nested')
    assert.equal(nested.dir, true)
    assert.equal(nested.size, 0)
  })

  it('read 返回文本内容，二进制类型被拒', async () => {
    const text = await request('GET', `/dsh-fileman/read?path=${encodeURIComponent(join(sandbox, 'docs/note.txt'))}`)
    assert.equal(text.status, 200)
    assert.match(text.body.content, /fileman/u)

    const binary = await request('GET', `/dsh-fileman/read?path=${encodeURIComponent(join(sandbox, 'docs/blob.bin'))}`)
    assert.equal(binary.status, 415)
  })

  it('拒绝越过沙箱根的路径', async () => {
    const cases = [
      '/etc/passwd',
      join(sandbox, '..', 'etc', 'passwd'),
      `${sandbox}/../../etc/passwd`,
    ]
    for (const target of cases) {
      const { status } = await request('GET', `/dsh-fileman/list?path=${encodeURIComponent(target)}`)
      assert.equal(status, 403, `应当拒绝 ${target}`)
    }
  })

  it('拒绝经软链逃逸到根外的路径', async () => {
    const { status } = await request('GET', `/dsh-fileman/list?path=${encodeURIComponent(join(sandbox, 'escape'))}`)
    assert.equal(status, 403)
  })

  it('拒绝含 NUL 字节的路径', async () => {
    const { status } = await request('GET', `/dsh-fileman/list?path=${encodeURIComponent(`${sandbox}/docs\u0000.txt`)}`)
    assert.equal(status, 403)
  })

  it('mkdir 建目录并拒绝非法名称', async () => {
    const created = await request('POST', '/dsh-fileman/mkdir', { dir: sandbox, name: '新建文件夹' })
    assert.equal(created.status, 200)
    assert.equal(created.body.entry.dir, true)

    const duplicate = await request('POST', '/dsh-fileman/mkdir', { dir: sandbox, name: '新建文件夹' })
    assert.equal(duplicate.status, 409)

    for (const bad of ['..', '.', 'a/b', 'a\\b', '', '  ']) {
      const { status } = await request('POST', '/dsh-fileman/mkdir', { dir: sandbox, name: bad })
      assert.equal(status, 400, `名称 ${JSON.stringify(bad)} 应当被拒`)
    }
  })

  it('write 落盘，read 能读回', async () => {
    const written = await request('POST', '/dsh-fileman/write', { path: join(sandbox, 'docs/draft.md'), content: '# 标题\n' })
    assert.equal(written.status, 200)
    const back = await request('GET', `/dsh-fileman/read?path=${encodeURIComponent(join(sandbox, 'docs/draft.md'))}`)
    assert.equal(back.body.content, '# 标题\n')
  })

  it('rename 改名并拒绝与自身同名的空操作干扰', async () => {
    const renamed = await request('POST', '/dsh-fileman/rename', { path: join(sandbox, 'docs/draft.md'), name: 'final.md' })
    assert.equal(renamed.status, 200)
    const listing = await request('GET', `/dsh-fileman/list?path=${encodeURIComponent(join(sandbox, 'docs'))}`)
    assert.ok(listing.body.entries.some((entry) => entry.name === 'final.md'))

    const conflict = await request('POST', '/dsh-fileman/rename', { path: join(sandbox, 'docs/final.md'), name: 'note.txt' })
    assert.equal(conflict.status, 409)
  })

  it('moving into the current directory preserves the original name', async () => {
    const source=join(sandbox,'same-place.txt')
    await writeFile(source,'preserve')
    const result=await request('POST','/dsh-fileman/move',{paths:[source],dest:sandbox})
    assert.equal(result.body.results[0].ok,true)
    assert.equal(result.body.results[0].path,source)
    assert.equal(await readFile(source,'utf8'),'preserve')
  })

  it('copy 与 move 在沙箱内生效，且拒绝移入自身子目录', async () => {
    const copied = await request('POST', '/dsh-fileman/copy', { paths: [join(sandbox, 'docs/note.txt')], dest: join(sandbox, 'docs/nested') })
    assert.equal(copied.status, 200)
    assert.equal(copied.body.results[0].ok, true)

    const moved = await request('POST', '/dsh-fileman/move', { paths: [join(sandbox, 'docs/final.md')], dest: join(sandbox, 'docs/nested') })
    assert.equal(moved.status, 200)
    assert.equal(moved.body.results[0].ok, true)

    const cycle = await request('POST', '/dsh-fileman/move', { paths: [join(sandbox, 'docs')], dest: join(sandbox, 'docs/nested') })
    assert.equal(cycle.body.results[0].ok, false)
    assert.match(cycle.body.results[0].error, /自身|子目录/u)
  })

  it('trash 删除并拒绝根目录', async () => {
    await writeFile(join(sandbox, 'docs/temp.log'), 'x', 'utf8')
    const trashed = await request('POST', '/dsh-fileman/trash', { paths: [join(sandbox, 'docs/temp.log')] })
    assert.equal(trashed.status, 200)
    assert.equal(trashed.body.results[0].ok, true)

    const guarded = await request('POST', '/dsh-fileman/trash', { paths: [sandbox] })
    assert.equal(guarded.body.results[0].ok, false)

    const remaining = await readdir(join(sandbox, 'docs'))
    assert.ok(!remaining.includes('temp.log'))
  })

  it('只读模式拒绝所有写操作', async () => {
    let readOnlyHandler
    const saved = handler
    const readOnlyServer = {
      register(route) {
        readOnlyHandler = route.handler
        return () => {}
      },
    }
    const ctx = fakeContext()
    ctx.inject = (deps, callback) => {
      callback({ get: () => readOnlyServer })
      return () => {}
    }
    const disposeReadOnly = apply(ctx, { root: sandbox, writable: false, trash: false })
    handler = readOnlyHandler

    const mkdirAttempt = await request('POST', '/dsh-fileman/mkdir', { dir: sandbox, name: 'nope' })
    const writeAttempt = await request('POST', '/dsh-fileman/write', { path: join(sandbox, 'nope.txt'), content: 'x' })
    assert.equal(mkdirAttempt.status, 403)
    assert.equal(writeAttempt.status, 403)

    handler = saved
    if (typeof disposeReadOnly === 'function') await disposeReadOnly()
  })

  it('卸载旧实例不会误伤新实例（热重载次序安全）', async () => {


    const make = () => {
      const box = {}
      const server = { register(route) { box.handler = route.handler; return () => {} } }
      const ctx = fakeContext()
      ctx.inject = (deps, callback) => { callback({ get: () => server }); return () => {} }
      return { box, dispose: apply(ctx, { root: sandbox, trash: false, writable: true }) }
    }
    const older = make()
    const newer = make()
    const saved = handler

    handler = older.box.handler
    await older.dispose()
    const afterOld = await request('GET', `/dsh-fileman/list?path=${encodeURIComponent(sandbox)}`)
    assert.equal(afterOld.status, 500, '旧实例卸载后自己应当拒绝服务')

    handler = newer.box.handler
    const afterNew = await request('GET', `/dsh-fileman/list?path=${encodeURIComponent(sandbox)}`)
    assert.equal(afterNew.status, 200, '新实例不该被旧实例的卸载带死')
    assert.ok(Array.isArray(afterNew.body.entries))

    handler = saved
    await newer.dispose()
  })

  it('未知接口返回 404，非法 JSON 返回 400', async () => {
    const missing = await request('GET', '/dsh-fileman/nope')
    assert.equal(missing.status, 404)

    const req = Readable.from([Buffer.from('{ not json', 'utf8')])
    req.method = 'POST'
    req.url = '/dsh-fileman/mkdir'
    req.headers = {}
    const captured = { status: 0 }
    const res = {
      destroyed: false,
      writableEnded: false,
      writeHead(status) { captured.status = status; return this },
      end() { this.writableEnded = true; return this },
      on() { return this },
      emit() { return false },
    }
    await handler(req, res)
    assert.equal(captured.status, 400)
  })

  it('list 给每个条目下发 kind，浏览器半不必靠扩展名猜', async () => {
    const { status, body } = await request('GET', `/dsh-fileman/list?path=${encodeURIComponent(join(sandbox, 'media'))}`)
    assert.equal(status, 200)
    const kindOf = Object.fromEntries(body.entries.map((entry) => [entry.name, entry.kind]))
    assert.equal(kindOf['pixel.png'], 'image')
    assert.equal(kindOf['clip.mp4'], 'video')
    assert.equal(kindOf['Movie.MP4'], 'video', '扩展名判断应当大小写无关')
    assert.equal(kindOf['tone.wav'], 'audio')
    assert.equal(kindOf['sheet.pdf'], 'pdf')
    assert.equal(kindOf['note.txt'], 'text')
    assert.equal(kindOf['page.html'], 'text')
    assert.equal(kindOf['bytes.dat'], 'file')
    assert.equal(kindOf['sub'], 'dir')
  })

  it('locations 一并下发能力位', async () => {
    const { body } = await request('GET', '/dsh-fileman/locations')
    assert.deepEqual(body.capabilities, { writable: true, trash: false, media: true, thumbnails: true })
  })

  it('inline=1 对媒体回内联类型并宣告支持区间', async () => {
    const whole = await request('GET', `/dsh-fileman/download?inline=1&path=${encodeURIComponent(join(sandbox, 'media/pixel.png'))}`)
    assert.equal(whole.status, 200)
    assert.equal(whole.headers['content-type'], 'image/png')
    assert.equal(whole.headers['accept-ranges'], 'bytes')
    assert.equal(whole.headers['x-content-type-options'], 'nosniff')
    assert.equal(whole.headers['content-disposition'], undefined, '内联响应不应带 attachment')
    assert.equal(whole.raw.length, PNG_1X1.length)
  })

  it('Range 请求回 206 与精确的字节切片', async () => {
    const target = join(sandbox, 'media/bytes.dat')
    const url = `/dsh-fileman/download?inline=1&path=${encodeURIComponent(target)}`

    const closed = await request('GET', url, undefined, { range: 'bytes=10-19' })
    assert.equal(closed.status, 206)
    assert.equal(closed.headers['content-range'], 'bytes 10-19/100')
    assert.equal(closed.headers['content-length'], 10)
    assert.deepEqual([...closed.raw], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19])


    const open = await request('GET', url, undefined, { range: 'bytes=95-' })
    assert.equal(open.status, 206)
    assert.equal(open.headers['content-range'], 'bytes 95-99/100')
    assert.deepEqual([...open.raw], [95, 96, 97, 98, 99])


    const suffix = await request('GET', url, undefined, { range: 'bytes=-4' })
    assert.equal(suffix.status, 206)
    assert.equal(suffix.headers['content-range'], 'bytes 96-99/100')


    const clamped = await request('GET', url, undefined, { range: 'bytes=90-500' })
    assert.equal(clamped.headers['content-range'], 'bytes 90-99/100')
    assert.equal(clamped.raw.length, 10)


    const multi = await request('GET', url, undefined, { range: 'bytes=0-1,5-6' })
    assert.equal(multi.status, 200)
    assert.equal(multi.raw.length, 100)
    assert.equal(multi.headers['content-range'], undefined)
  })

  it('越界 Range 回 416 并带上总长度', async () => {
    const { status, headers, raw } = await request(
      'GET',
      `/dsh-fileman/download?path=${encodeURIComponent(join(sandbox, 'media/bytes.dat'))}`,
      undefined,
      { range: 'bytes=500-600' },
    )
    assert.equal(status, 416)
    assert.equal(headers['content-range'], 'bytes */100')
    assert.equal(raw.length, 0)
  })

  it('非媒体类型即便带 inline=1 也只能下载（同源 XSS 防线）', async () => {
    const html = await request('GET', `/dsh-fileman/download?inline=1&path=${encodeURIComponent(join(sandbox, 'media/page.html'))}`)
    assert.equal(html.status, 200)
    assert.equal(html.headers['content-type'], 'application/octet-stream')
    assert.match(String(html.headers['content-disposition']), /^attachment;/u)


    const png = await request('GET', `/dsh-fileman/download?path=${encodeURIComponent(join(sandbox, 'media/pixel.png'))}`)
    assert.equal(png.headers['content-type'], 'application/octet-stream')
    assert.match(String(png.headers['content-disposition']), /^attachment;/u)
  })

  it('svg 内联时补 CSP sandbox', async () => {
    const svg = await request('GET', `/dsh-fileman/download?inline=1&path=${encodeURIComponent(join(sandbox, 'media/vector.svg'))}`)
    assert.equal(svg.headers['content-type'], 'image/svg+xml')
    assert.match(String(svg.headers['content-security-policy']), /sandbox/u)


    const png = await request('GET', `/dsh-fileman/download?inline=1&path=${encodeURIComponent(join(sandbox, 'media/pixel.png'))}`)
    assert.equal(png.headers['content-security-policy'], undefined)
  })

  it('video/pdf 内联走对应 MIME', async () => {
    const video = await request('GET', `/dsh-fileman/download?inline=1&path=${encodeURIComponent(join(sandbox, 'media/clip.mp4'))}`)
    assert.equal(video.headers['content-type'], 'video/mp4')
    const audio = await request('GET', `/dsh-fileman/download?inline=1&path=${encodeURIComponent(join(sandbox, 'media/tone.wav'))}`)
    assert.equal(audio.headers['content-type'], 'audio/wav')
    const pdf = await request('GET', `/dsh-fileman/download?inline=1&path=${encodeURIComponent(join(sandbox, 'media/sheet.pdf'))}`)
    assert.equal(pdf.headers['content-type'], 'application/pdf')
  })

  it('路径围栏在流式路由上同样生效', async () => {
    const escaped = await request('GET', `/dsh-fileman/download?inline=1&path=${encodeURIComponent('/etc/passwd')}`)
    assert.equal(escaped.status, 403)
    const viaLink = await request('GET', `/dsh-fileman/download?inline=1&path=${encodeURIComponent(join(sandbox, 'escape/x'))}`)
    assert.equal(viaLink.status, 403)
  })

  it('media=false 时拒绝内联，但下载不受影响', async () => {
    let mediaHandler
    const server = { register(route) { mediaHandler = route.handler; return () => {} } }
    const ctx = fakeContext()
    ctx.inject = (deps, callback) => { callback({ get: () => server }); return () => {} }
    const saved = handler
    const disposeMedia = apply(ctx, { root: sandbox, trash: false, writable: true, media: false, thumbnails: false })
    handler = mediaHandler

    const blocked = await request('GET', `/dsh-fileman/download?inline=1&path=${encodeURIComponent(join(sandbox, 'media/pixel.png'))}`)
    assert.equal(blocked.status, 403)

    const download = await request('GET', `/dsh-fileman/download?path=${encodeURIComponent(join(sandbox, 'media/pixel.png'))}`)
    assert.equal(download.status, 200)

    const caps = await request('GET', '/dsh-fileman/locations')
    assert.equal(caps.body.capabilities.media, false)
    assert.equal(caps.body.capabilities.thumbnails, false)

    handler = saved
    if (typeof disposeMedia === 'function') await disposeMedia()
  })

  it('卸载后拒绝新操作', async () => {
    const server = { register(route) { handler = route.handler; return () => {} } }
    const ctx = fakeContext()
    ctx.inject = (deps, callback) => {
      callback({ get: () => server })
      return () => {}
    }
    const localDispose = apply(ctx, { root: sandbox, trash: false, writable: true })
    await localDispose()
    const afterDispose = await request('GET', `/dsh-fileman/list?path=${encodeURIComponent(sandbox)}`)
    assert.equal(afterDispose.status, 500)
    assert.match(String(afterDispose.body.error), /卸载/u)
  })
})


describe('dsh-fileman 废纸篓', () => {
  let boxRoot
  let bin
  let infoDir
  let boxDispose

  const work = () => join(boxRoot, 'work')
  const dropPath = () => join(work(), 'drop.txt')
  const keepPath = () => join(work(), 'keep.txt')


  async function removeToBin(target) {
    const { body } = await request('POST', '/dsh-fileman/trash', { paths: [target] })
    assert.equal(body.results[0].ok, true, `删除 ${target} 应当成功：${JSON.stringify(body.results)}`)
    return body.results[0].restored
  }

  before(async () => {
    boxRoot = await realpath(await mkdtemp(join(tmpdir(), 'dfm-bin-')))
    await mkdir(work())
    await writeFile(keepPath(), 'keep\n', 'utf8')
    await writeFile(dropPath(), 'drop\n', 'utf8')
    await mkdir(join(work(), 'box'))
    await writeFile(join(work(), 'box', 'deep.txt'), 'deep\n', 'utf8')
    boxDispose = apply(fakeContext(), { root: boxRoot, trash: true, writable: true })
    bin = join(boxRoot, '.dsh-trash', 'files')
    infoDir = join(boxRoot, '.dsh-trash', 'info')
  })

  after(async () => {
    if (typeof boxDispose === 'function') await boxDispose()
    await rm(boxRoot, { recursive: true, force: true })
  })

  it('列出废纸篓位置，空废纸篓可进入并自动建目录', async () => {
    const { status, body } = await request('GET', '/dsh-fileman/locations')
    assert.equal(status, 200)
    const entry = body.locations.find((item) => item.kind === 'trash')
    assert.ok(entry !== undefined, '应列出废纸篓位置')
    assert.equal(entry.path, bin)
    assert.equal(body.capabilities.trash, true)


    const empty = await request('GET', `/dsh-fileman/list?path=${encodeURIComponent(bin)}`)
    assert.equal(empty.status, 200)
    assert.equal(empty.body.trash, true)
    assert.equal(empty.body.parent, null, '废纸篓不给上级，免得走进记录区')
    assert.deepEqual(empty.body.entries, [])
  })

  it('删除进废纸篓，条目带原位置与删除时间', async () => {
    assert.equal(await removeToBin(dropPath()), 'drop.txt')
    await assert.rejects(readFile(dropPath()), '原位置不应再有该文件')

    const { body } = await request('GET', `/dsh-fileman/list?path=${encodeURIComponent(bin)}`)
    assert.equal(body.trash, true)
    const entry = body.entries.find((item) => item.name === 'drop.txt')
    assert.ok(entry !== undefined)
    assert.equal(entry.original, dropPath())
    assert.match(String(entry.deletedAt), /^\d{4}-\d{2}-\d{2} /u)
  })

  it('restore 放回原位置并清掉记录', async () => {
    const { body } = await request('POST', '/dsh-fileman/restore', { paths: [join(bin, 'drop.txt')] })
    assert.equal(body.results[0].ok, true, JSON.stringify(body.results))
    assert.equal(body.results[0].restored, dropPath())
    assert.equal(await readFile(dropPath(), 'utf8'), 'drop\n')
    assert.deepEqual(await readdir(bin), [])
    assert.deepEqual(await readdir(infoDir), [], '记录也应一并清掉，否则会错配给后来的同名条目')
  })

  it('原位置被占用时另取名字，绝不覆盖', async () => {
    await removeToBin(dropPath())
    await writeFile(dropPath(), 'newer\n', 'utf8')
    const { body } = await request('POST', '/dsh-fileman/restore', { paths: [join(bin, 'drop.txt')] })
    assert.equal(body.results[0].ok, true)
    assert.equal(body.results[0].restored, join(work(), 'drop 2.txt'))
    assert.equal(await readFile(dropPath(), 'utf8'), 'newer\n', '原位置上的文件必须原样保留')
    assert.equal(await readFile(join(work(), 'drop 2.txt'), 'utf8'), 'drop\n')
  })

  it('restore 还原目录整棵树', async () => {
    await removeToBin(join(work(), 'box'))
    await assert.rejects(readdir(join(work(), 'box')))
    const { body } = await request('POST', '/dsh-fileman/restore', { paths: [join(bin, 'box')] })
    assert.equal(body.results[0].ok, true, JSON.stringify(body.results))
    assert.equal(await readFile(join(work(), 'box', 'deep.txt'), 'utf8'), 'deep\n')
  })

  it('purge 彻底删除并清掉记录', async () => {
    await removeToBin(join(work(), 'box'))
    const { body } = await request('POST', '/dsh-fileman/purge', { paths: [join(bin, 'box')] })
    assert.equal(body.results[0].ok, true, JSON.stringify(body.results))
    assert.deepEqual(await readdir(bin), [])
    assert.deepEqual(await readdir(infoDir), [])
  })

  it('还原与彻底删除都拒绝废纸篓之外的路径', async () => {

    const restored = await request('POST', '/dsh-fileman/restore', { paths: [keepPath()] })
    assert.equal(restored.body.results[0].ok, false)
    const purged = await request('POST', '/dsh-fileman/purge', { paths: [keepPath()] })
    assert.equal(purged.body.results[0].ok, false)

    const outsidePath = await request('POST', '/dsh-fileman/purge', { paths: ['/etc/passwd'] })
    assert.equal(outsidePath.body.results[0].ok, false)

    assert.equal(await readFile(keepPath(), 'utf8'), 'keep\n', '被拒的路径必须原封不动')
  })

  it('原位置越界的记录会被拒绝还原', async () => {
    await mkdir(bin, { recursive: true })
    await mkdir(infoDir, { recursive: true })
    await writeFile(join(bin, 'rogue.txt'), 'rogue\n', 'utf8')

    await writeFile(
      join(infoDir, 'rogue.txt.trashinfo'),
      '[Trash Info]\nPath=..%2F..%2F..%2F..%2F..%2Fetc%2Fpasswd\nDeletionDate=2026-01-01 00:00:00\n',
      'utf8',
    )
    const { body } = await request('POST', '/dsh-fileman/restore', { paths: [join(bin, 'rogue.txt')] })
    assert.equal(body.results[0].ok, false)
    assert.match(String(body.results[0].error), /超出允许范围/u)
    assert.equal(await readFile(join(bin, 'rogue.txt'), 'utf8'), 'rogue\n', '拒绝后条目应留在废纸篓里')
  })

  it('对废纸篓里的条目再删一次会被拒绝（防套娃）', async () => {
    await removeToBin(dropPath())
    const again = await request('POST', '/dsh-fileman/trash', { paths: [join(bin, 'drop.txt')] })
    assert.equal(again.body.results[0].ok, false)
    assert.match(String(again.body.results[0].error), /彻底删除/u)
    assert.equal(await readFile(join(bin, 'drop.txt'), 'utf8'), 'newer\n')
  })

  it('废纸篓条目不能重命名或移动（会弄丢还原记录）', async () => {
    const renamed = await request('POST', '/dsh-fileman/rename', { path: join(bin, 'drop.txt'), name: 'other.txt' })
    assert.equal(renamed.status, 400)
    assert.match(String(renamed.body.error), /放回原处/u)

    const moved = await request('POST', '/dsh-fileman/move', { paths: [join(bin, 'drop.txt')], dest: work() })
    assert.equal(moved.body.results[0].ok, false)
    assert.equal(await readFile(join(bin, 'drop.txt'), 'utf8'), 'newer\n', '两个操作都应被完整拒绝')
  })

  it('trash-empty 清空废纸篓与全部记录', async () => {
    await removeToBin(keepPath())
    await writeFile(keepPath(), 'again\n', 'utf8')
    await removeToBin(keepPath())

    const before = await request('GET', `/dsh-fileman/list?path=${encodeURIComponent(bin)}`)
    assert.ok(before.body.entries.length >= 3, '此时废纸篓里应不止一项')
    const { body } = await request('POST', '/dsh-fileman/trash-empty', {})
    assert.equal(body.removed, before.body.entries.length)
    assert.deepEqual(await readdir(bin), [])
    assert.deepEqual(await readdir(infoDir), [])
  })
})

describe('dsh-fileman 客户端产物', () => {
  it('client.js 是模块表格式且不含 ESM 语法', async () => {
    const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
    assert.match(source, /window\.__ModuleLoader__\.load\(/u)
    assert.match(source, /id: "dsh-fileman"/u)
    assert.ok(!/^\s*import\s/m.test(source), '不应残留 ESM import')
    assert.match(source, /require\("react\/jsx-runtime"\)/u)
    assert.match(source, /require\("react"\)/u, 'hooks 需要 react')
    assert.match(source, /require\("react-dom"\)/u, 'createPortal 需要 react-dom')
    assert.match(source, /require\("@deepseek-ai\/dsh-client-ui-primitives"\)/u)
  })

  it('产物带上了媒体查看器与缩略图的样式', async () => {
    const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
    for (const marker of ['.dfm-viewer-stage', '.dfm-viewer-nav', '.dfm-thumb-box', '.dfm-audio-card', '.dfm-stage-video']) {
      assert.ok(source.includes(marker), `产物理应包含样式 ${marker}`)
    }

    assert.match(source, /inline/u)
  })

  it('通过生命周期管理的 launchpad 注册 fileman，并保留知识库设置入口', async () => {
    const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
    const ast=parseSource(source)
    const declaration=name=>unique(nodes(ast,n=>n.type==='VariableDeclarator' && n.id?.name===name),`bundle constant ${name}`)
    const panel=declaration('PANEL_ID').init
    assert.equal(panel.type,'Literal');assert.equal(panel.value,'fileman')
    const ns=declaration('NS').init
    assert.equal(ns.type,'Literal');assert.equal(ns.value,'dsh-fileman')
    const applyNode=functionNode(ast,'apply'),bridgeNode=functionNode(ast,'registerLaunchpadApp')
    const apps=[],injections=[],slots=[],sections=[],navigation=[],disposed=[]
    const cleanups=[]
    const panelComponent=()=>{},icon=()=>{},settingsComponent=()=>{}
    const effect=fn=>{const cleanup=fn();if(typeof cleanup==='function')cleanups.push(cleanup);return cleanup}
    const ctx={
      effect,
      locale:{register(namespace){assert.equal(namespace,'dsh-fileman');return()=>disposed.push('locale')},bind:()=>key=>`translated:${key}`},
      slots:{inject(slot,callback){slots.push(slot);callback()},register(descriptor,component){sections.push({descriptor,component})}},
      inject(deps,callback){injections.push([...deps]);callback({effect,get(service){assert.equal(service,'dshLaunchpad');return {registerApp(descriptor){apps.push(descriptor);return()=>disposed.push('app')}}}})},
    }
    const context={ctx,NS:ns.value,PANEL_ID:panel.value,zh:{},en:{},FilemanPanel:panelComponent,FilemanPanelIcon:icon,
      KnowledgeRagSettingsSection:settingsComponent,confirmKnowledgeRagSection:component=>component,
      registerKnowledgeSettingsNavigation:(...args)=>navigation.push(args)}
    vm.runInNewContext(source.slice(bridgeNode.start,bridgeNode.end)+'\n'+source.slice(applyNode.start,applyNode.end)+'\napply(ctx)',context)
    assert.deepEqual(injections,[['dshLaunchpad']])
    assert.equal(apps.length,1)
    assert.equal(apps[0].id,'fileman');assert.equal(apps[0].name,'translated:panel')
    assert.equal(apps[0].order,10);assert.equal(apps[0].icon,icon);assert.ok(apps[0].description.length>0)
    assert.deepEqual(slots,['settings.section'])
    assert.equal(sections.length,1);assert.equal(sections[0].descriptor.id,'knowledge-rag');assert.equal(sections[0].component,settingsComponent)
    assert.equal(navigation.length,1);assert.deepEqual(navigation[0],[ctx,panelComponent,'fileman'])
    assert.equal(cleanups.length,2);assert.deepEqual(disposed,[])
    for(const cleanup of cleanups.reverse())cleanup()
    assert.deepEqual(disposed,['app','locale'])
  })
})
