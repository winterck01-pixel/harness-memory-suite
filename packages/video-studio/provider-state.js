import {AsyncLocalStorage} from 'node:async_hooks';
import {access,open,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
const symbol=Symbol.for('dsh.media.provider-state.v1');
const shared=globalThis[symbol]??= {tail:Promise.resolve(),context:new AsyncLocalStorage()};
export function withProviderLock(operation){
 if(shared.context.getStore()===shared)return operation();
 const job=shared.tail.then(()=>shared.context.run(shared,operation));
 shared.tail=job.catch(()=>{});return job;
}
export async function syncProviderPath(path){const file=await open(path,'r');try{await file.sync()}finally{await file.close()}}
function blocked(){const error=Error('媒体配置与凭据更新未完成，已停止服务请求；请先恢复一致的配置与凭据');error.httpStatus=422;return error}
export function createProviderState({rootDir,studio,getConfig,persistConfig,credentials}){
 const marker=join(rootDir,studio,'provider-update.pending');
 const clearMarker=async()=>{await unlink(marker);await syncProviderPath(dirname(marker))};
 const assertClean=async()=>{for(const name of ['image-studio','video-studio']){
  try{await access(join(rootDir,name,'provider-update.pending'))}catch(error){if(error.code==='ENOENT')continue;throw error}
  throw blocked();
 }};
 const read=operation=>withProviderLock(async()=>{await assertClean();return operation()});
 const transaction=operation=>withProviderLock(async()=>{
  await assertClean();const original=await getConfig();const keys=new Map();let configTouched=false;
  // Persist before changing either store. A process crash leaves requests fail-closed.
  const file=await open(marker,'wx',0o600);try{await file.writeFile('pending\n');await file.sync()}finally{await file.close()}
  await syncProviderPath(dirname(marker));
  try{
   const result=await operation({
    setKey:async(ref,value)=>{if(!keys.has(ref))keys.set(ref,(await credentials.resolve(ref))?.value);await credentials.set(ref,value)},
    persist:async saved=>{configTouched=true;await persistConfig(saved)},
   });
   await clearMarker();return result;
  }catch(error){
   let restored=true;
   for(const [ref,value]of keys){try{if(value!==undefined)await credentials.set(ref,value);else if(credentials.unset)await credentials.unset(ref);else restored=false}catch{restored=false}}
   if(configTouched){try{await persistConfig(original)}catch{restored=false}}
   if(restored)await clearMarker().catch(()=>{});
   // Credential backends may include secrets in their errors; never propagate them.
   throw blocked();
  }
 });
 return {read,transaction};
}
