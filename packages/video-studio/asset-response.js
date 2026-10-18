import {open} from 'node:fs/promises';
// Read at most one bounded chunk per pull; the same descriptor is used for stat/read.
export async function assetResponse(request,asset){
 let file;try{file=await open(asset.path,'r')}catch(error){if(error.code==='ENOENT')return new Response('Not found',{status:404});throw error}
 let closed=false;const close=async()=>{if(!closed){closed=true;await file.close()}};
 try{
  const info=await file.stat();if(!info.isFile()){await close();return new Response('Not found',{status:404})}
  const size=info.size,headers={'Content-Type':asset.type,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'};
  let start=0,end=size-1,status=200;const range=request.headers.get('range');
  if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);const a=m&&m[1]!==''?Number(m[1]):null,b=m&&m[2]!==''?Number(m[2]):null;
   const invalid=!m||(a===null&&b===null)||(a!==null&&(!Number.isSafeInteger(a)||a>=size))||(b!==null&&!Number.isSafeInteger(b))||(a!==null&&b!==null&&a>b)||(a===null&&b===0)||size===0;
   if(invalid){await close();return new Response(null,{status:416,headers:{...headers,'Content-Range':'bytes */'+size}})}
   start=a===null?Math.max(0,size-b):a;end=a===null||b===null?size-1:Math.min(b,size-1);status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length']=String(Math.max(0,end-start+1));
  if(request.method==='HEAD'||size===0){await close();return new Response(null,{status,headers})}
  let position=start;let controller;const abort=()=>{void close().catch(()=>{});try{controller?.error(new Error('播放请求已取消'))}catch{}};
  const body=new ReadableStream({start(c){controller=c;request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort()},async pull(c){try{if(closed)return;const bytes=Buffer.allocUnsafe(Math.min(64*1024,end-position+1));const {bytesRead}=await file.read(bytes,0,bytes.length,position);if(!bytesRead)throw Error('媒体文件读取中断');position+=bytesRead;c.enqueue(bytes.subarray(0,bytesRead));if(position>end){request.signal.removeEventListener('abort',abort);await close();c.close()}}catch(error){request.signal.removeEventListener('abort',abort);await close().catch(()=>{});c.error(error)}},async cancel(){request.signal.removeEventListener('abort',abort);await close()}},{highWaterMark:0});
  return new Response(body,{status,headers});
 }catch(error){await close().catch(()=>{});throw error}
}
