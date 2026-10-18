import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {join} from 'node:path';
import {uid,FilmError} from './store.js';
const aborted=signal=>signal?.reason||new DOMException('媒体请求已取消','AbortError');
function runProcess(program,args,{timeout=120000,signal}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(aborted(signal));return}
  const child=spawn(program,args,{stdio:['ignore','pipe','pipe']});let out='',err='',failure;
  const stop=error=>{failure??=error;child.kill('SIGKILL')};
  const abort=()=>stop(aborted(signal));
  const timer=setTimeout(()=>stop(new Error('媒体处理超时')),timeout);
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',b=>{out=(out+b).slice(0,100000)});
  child.stderr.on('data',b=>{err=(err+b).slice(-2000)});
  child.on('error',error=>{failure??=error});
  child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);failure?reject(failure):code===0?resolve(out):reject(new Error('媒体处理失败 '+err.slice(-300)))});
  if(signal?.aborted)abort();
 });
}
// Reserve a slot until the child has actually exited, including timeout/abort kills.
let workers=0;const waiting=[];const MAX_WAITING=64;
export async function run(program,args,options={}){
 const {signal}=options;if(signal?.aborted)throw aborted(signal);
 if(workers>=2){
  if(waiting.length>=MAX_WAITING)throw new FilmError('媒体处理繁忙，请稍后重试',503);
  await new Promise((resolve,reject)=>{
   const entry={resolve:()=>{signal?.removeEventListener('abort',abort);resolve()}};
   const abort=()=>{const i=waiting.indexOf(entry);if(i>=0){waiting.splice(i,1);reject(aborted(signal))}};
   waiting.push(entry);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
 }else workers++;
 try{return await runProcess(program,args,options)}finally{const next=waiting.shift();if(next)next.resolve();else workers--}
}
export async function probe(path){const s=JSON.parse(await run('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',path]));const duration=Number(s.format?.duration);if(!Number.isFinite(duration)||duration<=0)throw new FilmError('媒体文件无法读取有效时长');const video=s.streams?.find(x=>x.codec_type==='video');return {duration,...(video?{width:video.width,height:video.height}:{}),hasVideo:s.streams?.some(x=>x.codec_type==='video'),hasAudio:s.streams?.some(x=>x.codec_type==='audio')}}
export async function serveFile(req,path,type){
 let file;try{file=await open(path,'r')}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')return new Response('Not found',{status:404});throw error}
 let closePromise,done=false,controller;
 const close=()=>closePromise??=(file.close());
 const cleanup=()=>{req.signal?.removeEventListener('abort',abort);return close()};
 const abort=()=>{if(done)return;done=true;void cleanup().catch(()=>{});controller?.error(aborted(req.signal))};
 try{
  const info=await file.stat();if(!info.isFile()){await close();return new Response('Not found',{status:404})}
  const size=info.size,headers={'Content-Type':type,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'};
  let start=0,end=size-1,status=200;const range=req.headers.get('range');
  if(range){
   const m=/^bytes=(\d*)-(\d*)$/.exec(range),a=m&&m[1]!==''?Number(m[1]):null,b=m&&m[2]!==''?Number(m[2]):null;
   if(!m||(a===null&&b===null)||(a!==null&&(!Number.isSafeInteger(a)||a>=size))||(b!==null&&!Number.isSafeInteger(b))||(a!==null&&b!==null&&a>b)||(a===null&&b===0)||size===0){await close();return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${size}`}})}
   start=a===null?Math.max(0,size-b):a;end=a===null||b===null?size-1:Math.min(b,size-1);status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length']=String(Math.max(0,end-start+1));
  if(req.method==='HEAD'||size===0){await close();return new Response(null,{status,headers})}
  let position=start;
  const body=new ReadableStream({
   start(c){controller=c;req.signal?.addEventListener('abort',abort,{once:true});if(req.signal?.aborted)abort()},
   async pull(c){
    try{
     if(done)return;
     const bytes=Buffer.allocUnsafe(Math.min(65536,end-position+1));
     const {bytesRead}=await file.read(bytes,0,bytes.length,position);
     if(done)return;
     if(!bytesRead)throw new Error('媒体文件读取中断');
     position+=bytesRead;c.enqueue(bytes.subarray(0,bytesRead));
     if(position>end){done=true;await cleanup().catch(()=>{});c.close()}
    }catch(error){if(done)return;done=true;await cleanup().catch(()=>{});c.error(error)}
   },
   async cancel(){done=true;await cleanup()}
  },{highWaterMark:0});
  return new Response(body,{status,headers});
 }catch(error){await cleanup().catch(()=>{});throw error}
}
export async function renderMovie(project,assets,dir){if(!project.shots.length)throw new FilmError('没有片段');await mkdir(dir,{recursive:true});const files=[];for(const [i,s]of project.shots.entries()){
 const c=s.candidates.find(c=>c.id===s.selected),a=assets.find(a=>a.id===c?.assetId);if(!a)throw new FilmError('请为每段采用一个有效视频');const info=await probe(a.path);if(!info.hasVideo||s.trimIn+s.duration>info.duration+0.08)throw new FilmError(s.name+' 的视频长度不足');const path=join(dir,`part-${i}.mp4`),filter='scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24';
 const args=['-y','-v','error','-threads','2','-ss',String(s.trimIn),'-i',a.path];if(s.muted||!info.hasAudio)args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');args.push('-t',String(s.duration),'-map','0:v:0','-map',s.muted||!info.hasAudio?'1:a:0':'0:a:0','-vf',filter,'-c:v','libx264','-threads','2','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2',path);await run('ffmpeg',args,{timeout:300000});files.push(path)}
 const list=join(dir,'concat.txt');await writeFile(list,files.map((_,i)=>`file 'part-${i}.mp4'`).join('\n'));const output=join(dir,'movie.mp4'),base=project.audio?.assetId?join(dir,'base.mp4'):output;await run('ffmpeg',['-y','-v','error','-f','concat','-safe','1','-i',list,'-c','copy','-movflags','+faststart',base],{timeout:300000});
 if(project.audio?.assetId){const a=assets.find(a=>a.id===project.audio.assetId);if(!a)throw new FilmError('背景音文件已丢失');await run('ffmpeg',['-y','-v','error','-i',base,'-stream_loop','-1','-i',a.path,'-filter_complex',`[1:a]volume=${project.audio.volume??0.5}[bg];[0:a][bg]amix=inputs=2:duration=first:normalize=0[a]`,'-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-shortest','-movflags','+faststart',output],{timeout:300000})}
 return output;
}
