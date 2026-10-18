import {mkdir,readFile,writeFile,rename,rm,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const queues = globalThis[Symbol.for('dsh.shared-media-delivery.queues')] ??= new Map();
export const mediaTargetKey = t => JSON.stringify(['channelId','accountId','conversationId','conversationType','threadId'].map(k=>t[k]??null));
async function readJson(path,fallback) {try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function atomic(path,value) {const tmp=path+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(value),{mode:0o600});await rename(tmp,path);}finally{await rm(tmp,{force:true});}}
function result(row) {return {delivered:row.status==='sent',deliveryStatus:row.status==='sent'?'sent':row.status==='failed'?'failed':'uncertain',...(row.messageId?{messageId:row.messageId}:{}),deduplicated:true,...(row.reason?{deliveryReason:row.reason}:{})};}
async function legacyReceipt({dir,sessionId,target,path,fileVersion,rowId,assetId}) {
 const dirs=[...new Set([dir,join(dirname(dir),'image-studio'),join(dirname(dir),'video-studio')])];
 let uncertain;
 for(const root of dirs){
  const rows=await readJson(join(root,'deliveries.json'),[]),tasks=await readJson(join(root,'tasks.json'),[]);
  for(const row of rows){
   if(row.sessionId!==sessionId||mediaTargetKey(row.target??{})!==mediaTargetKey(target))continue;
   const assets=row.asset?[row.asset]:tasks.find(t=>t.id===row.id)?.results??[];
   for(const item of row.items??[]){
    if(root===dir&&row.id===rowId&&item.id===assetId)continue;
    if(item.sharedDelivery||!['sent','sending','uncertain'].includes(item.status)||(item.fileVersion&&item.fileVersion!==fileVersion))continue;
    const asset=assets.find(a=>a.id===item.id);if(!asset?.path)continue;
    if(await realpath(asset.path).catch(()=>null)!==path)continue;
    const hit={status:item.fileVersion&&item.status==='sent'?'sent':'uncertain',...(!item.fileVersion?{reason:'历史投递缺少文件版本，需人工核对后再发送'}:{}),...(item.messageId?{messageId:item.messageId}:{}),legacy:true};
    if(hit.status==='sent')return hit;uncertain=hit;
   }
  }
 }
 return uncertain;
}
export async function sendSharedMedia(options,send) {
 const path=await realpath(options.path),dir=join(dirname(options.dir),'media-delivery');
 const key=createHash('sha256').update(JSON.stringify([options.sessionId,mediaTargetKey(options.target),path,options.fileVersion])).digest('hex');
 await mkdir(dir,{recursive:true,mode:0o700});
 const receipt=join(dir,key+'.json'),lock=join(dir,key+'.lock');
 const previous=queues.get(receipt)??Promise.resolve();
 const job=previous.catch(()=>{}).then(async()=>{
  let locked=false;
  try{
   try{await mkdir(lock,{mode:0o700});locked=true;}catch(e){if(e.code!=='EEXIST')throw e;return result(await readJson(receipt,{status:'uncertain'}));}
   const existing=await readJson(receipt,null);
   if(existing&&existing.status!=='failed')return result(existing);
   const legacy=await legacyReceipt({...options,path});
   if(legacy){await atomic(receipt,{...legacy,updatedAt:Date.now()});return result(legacy);}
   // Persist intent before any external send. A crash/timeout must never auto-resend.
   await atomic(receipt,{status:'sending',updatedAt:Date.now()});
   let sent;
   try{sent=await send();}catch{await atomic(receipt,{status:'uncertain',updatedAt:Date.now()});return {delivered:false,deliveryStatus:'uncertain'};}
   const row={status:sent?.delivered===true?'sent':sent?.delivered===false?'failed':'uncertain',...(sent?.messageId?{messageId:sent.messageId}:{}),updatedAt:Date.now()};
   await atomic(receipt,row);return {...sent,deliveryStatus:row.status};
  }finally{if(locked)await rm(lock,{recursive:true,force:true});}
 });
 queues.set(receipt,job);
 try{return await job;}finally{if(queues.get(receipt)===job)queues.delete(receipt);}
}
