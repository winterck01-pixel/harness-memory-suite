import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
export const revisionOf = content => createHash('sha256').update(content).digest('hex')
export async function mapLimited(items, limit, fn) {
  const result = new Array(items.length); let cursor = 0
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{for(;;){const i=cursor++;if(i>=items.length)return;result[i]=await fn(items[i],i)}}))
  return result
}
export function mutationQueue() {
  let tail=Promise.resolve(); const receipts=new Map()
  const execute = (key,signature,work)=>{
    const now=Date.now()
    for(const [id,r] of receipts)if(r.done && now-r.time>600000)receipts.delete(id)
    if(key && receipts.has(key)){
      const r=receipts.get(key)
      if(r.signature!==signature)throw Object.assign(new Error('操作编号已用于另一项请求'),{status:409})
      return r.promise
    }
    if(receipts.size>=512) {for(const [id,r] of receipts){if(r.done){receipts.delete(id);break}}}
    if(receipts.size>=512)throw Object.assign(new Error('操作队列繁忙，请稍后再试'),{status:429})
    const promise=tail.catch(()=>{}).then(work);tail=promise
    if(key){const r={signature,promise,time:now,done:false};receipts.set(key,r);promise.then(result=>{r.result=result;r.done=true;r.time=Date.now()},error=>{r.error=String(error.message);r.done=true;r.time=Date.now()})}
    return promise
  }
  execute.status = key => {const r=receipts.get(key);return !r?{state:'unknown'}:!r.done?{state:'pending'}:r.error?{state:'failed',error:r.error}:{state:'completed',result:r.result}}
  return execute
}

export function thumbnailCache() {
  const cache=new Map(),pending=new Map(),waiters=[];let bytes=0,active=0
  async function slot(fn){if(active>=2){if(waiters.length>=64)throw Object.assign(new Error('缩略图队列繁忙'),{status:429});await new Promise(r=>waiters.push(r))}else active++
    try{return await fn()}finally{const next=waiters.shift();if(next)next();else active--}}
  return { async get(path,info,kind) {
    const key=revisionOf(JSON.stringify([path,info.ino,info.size,info.mtimeMs,info.ctimeMs]))
    if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return {buffer:value,key}}
    if(pending.has(key))return pending.get(key)
    const job=slot(async()=>{

      const image=kind==='image'
      const args=['-hide_banner','-loglevel','error','-nostdin','-max_alloc','67108864','-threads','1','-filter_threads','1','-protocol_whitelist','file,pipe','-f',image?'image2':(/\.(webm|mkv)$/i.test(path)?'matroska':'mov'),...(image?['-pattern_type','none']:[]),'-i',path,'-map','0:v:0','-frames:v','1','-vf',"scale=256:256:force_original_aspect_ratio=decrease",'-threads','1','-f','image2pipe','-vcodec','mjpeg','-pix_fmt','yuvj420p','pipe:1']
      const {stdout}=await exec('ffmpeg',args,{encoding:'buffer',timeout:8000,maxBuffer:2*1024*1024,windowsHide:true})
      if(!stdout.length)throw new Error('无法生成缩略图')
      cache.set(key,stdout);bytes+=stdout.length
      while(bytes>24*1024*1024 || cache.size>512){const oldest=cache.keys().next().value;bytes-=cache.get(oldest).length;cache.delete(oldest)}
      return {buffer:stdout,key}
    });pending.set(key,job)
    try{return await job}finally{pending.delete(key)}
  }}
}
