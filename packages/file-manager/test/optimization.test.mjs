import {stat} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'


import assert from 'node:assert/strict'
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


describe('优化回归',()=>{
 before(async()=>{sandbox=await realpath(await mkdtemp(join(tmpdir(),'dfm-opt-')));dispose=apply(fakeContext(),{root:sandbox,trash:true,writable:true});await writeFile(join(sandbox,'edit.txt'),'base');execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=1024x768','-frames:v','1',join(sandbox,'image.png')])});
 after(async()=>{await dispose();await rm(sandbox,{recursive:true,force:true})});
 it('旧版本保存被拒绝，原文件保持外部更改',async()=>{
  const first=await request('GET','/dsh-fileman/read?path='+encodeURIComponent(join(sandbox,'edit.txt')));
  await writeFile(join(sandbox,'edit.txt'),'external');
  const result=await request('POST','/dsh-fileman/write',{path:join(sandbox,'edit.txt'),content:'mine',revision:first.body.revision,requestId:'conflict'});
  assert.equal(result.status,409);assert.equal(await readFile(join(sandbox,'edit.txt'),'utf8'),'external');
 });
 it('并发相同请求仅复制一次，结果可查询，编号不能用于不同操作',async()=>{
  const body={paths:[join(sandbox,'edit.txt')],dest:sandbox,requestId:'copy-proof'};
  const [a,b]=await Promise.all([request('POST','/dsh-fileman/copy',body),request('POST','/dsh-fileman/copy',body)]);
  assert.deepEqual(a.body,b.body);assert.equal(a.body.results[0].ok,true);
  const names=await readdir(sandbox);assert.equal(names.filter(n=>n.startsWith('edit')).length,2);
  const status=await request('GET','/dsh-fileman/operation-status?requestId=copy-proof');assert.equal(status.body.state,'completed');assert.deepEqual(status.body.result.payload,a.body);
  assert.equal((await request('POST','/dsh-fileman/copy',{...body,dest:'/other'})).status,409);
  assert.equal((await request('GET','/dsh-fileman/operation-status?requestId=unknown')).body.state,'unknown');
 });
 it('新鲜修订可以保存，批量操作保留每项结果',async()=>{
  const p=join(sandbox,'edit.txt');const read=await request('GET','/dsh-fileman/read?path='+encodeURIComponent(p));
  assert.equal((await request('POST','/dsh-fileman/write',{path:p,content:'saved',revision:read.body.revision,requestId:'save-proof'})).status,200);
  const result=await request('POST','/dsh-fileman/copy',{paths:[p,join(sandbox,'missing')],dest:sandbox,requestId:'partial'});
  assert.equal(result.body.results.length,2);assert.equal(result.body.results.filter(r=>r.ok).length,1);
 });
 it('缩略图是小尺寸 JPEG，重复请求复用缓存；越界、禁用与不支持格式被拒绝',async()=>{
  const img=join(sandbox,'image.png');const url='/dsh-fileman/thumbnail?path='+encodeURIComponent(img);
  const a=await request('GET',url);assert.equal(a.status,200,JSON.stringify(a.body));assert.equal(a.headers['content-type'],'image/jpeg');assert.equal(a.raw[0],255);
  const b=await request('GET',url);assert.deepEqual(a.raw,b.raw);assert.equal(a.headers.etag,b.headers.etag);
  assert.equal((await request('GET','/dsh-fileman/thumbnail?path=/etc/passwd')).status,403);
  assert.equal((await request('GET','/dsh-fileman/thumbnail?path='+encodeURIComponent(join(sandbox,'edit.txt')))).status,415);
 });
 it('图片和视频缩略图缓存按文件版本失效，禁用时不生成',async()=>{
  const {thumbnailCache}=await import('../lib/performance.js');const cache=thumbnailCache(),path=join(sandbox,'image.png');
  const info=await stat(path),a=await cache.get(path,info,'image'),b=await cache.get(path,info,'image');assert.equal(a.buffer,b.buffer);
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=1024x768','-frames:v','1',path]);
  const changed=await cache.get(path,await stat(path),'image');assert.notEqual(changed.key,a.key);
  const video=join(sandbox,'clip.mp4');execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=green:s=320x240:d=0.1','-c:v','mpeg4',video]);
  assert.equal((await request('GET','/dsh-fileman/thumbnail?path='+encodeURIComponent(video))).status,200);
  const stop=apply(fakeContext(),{root:sandbox,thumbnails:false});assert.equal((await request('GET','/dsh-fileman/thumbnail?path='+encodeURIComponent(path))).status,403);await stop();
 });
 it('目录信息读取限制并发且保持条目顺序',async()=>{
  const {mapLimited}=await import('../lib/performance.js');let active=0,max=0;const result=await mapLimited(Array.from({length:100},(_,i)=>i),16,async i=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));active--;return i});assert.equal(max,16);assert.deepEqual(result,Array.from({length:100},(_,i)=>i));
 });
});
