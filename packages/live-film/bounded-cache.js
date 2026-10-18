// Settled values use LRU/TTL eviction; unfinished work stays deduplicated until
// settlement and has its own admission limit. No pending promise is evicted.
export class BoundedAsyncCache {
 constructor({maxEntries=256,maxPending=64,ttl=300000,now=Date.now}={}){
  this.maxEntries=maxEntries;this.maxPending=maxPending;this.ttl=ttl;this.now=now;
  this.values=new Map();this.pending=new Map();
 }
 get(key,load,{signal}={}){
  const reason=()=>signal?.reason||new DOMException('请求已取消','AbortError');
  if(signal?.aborted)return Promise.reject(reason());
  const time=this.now();
  for(const [id,row]of this.values)if(row.expires<=time)this.values.delete(id);
  const cached=this.values.get(key);
  if(cached){this.values.delete(key);this.values.set(key,cached);return Promise.resolve(cached.value)}
  let entry=this.pending.get(key);
  if(!entry){
   if(this.pending.size>=this.maxPending){const error=new Error('媒体处理繁忙，请稍后重试');error.status=503;return Promise.reject(error)}
   entry={controller:new AbortController(),users:0};this.pending.set(key,entry);
   entry.promise=Promise.resolve().then(()=>load(entry.controller.signal)).then(value=>{
    if(!entry.controller.signal.aborted&&this.maxEntries>0){
     this.values.set(key,{value,expires:this.now()+this.ttl});
     while(this.values.size>this.maxEntries)this.values.delete(this.values.keys().next().value);
    }
    return value;
   }).finally(()=>{if(this.pending.get(key)===entry)this.pending.delete(key)});
  }
  entry.users++;
  return new Promise((resolve,reject)=>{
   let finished=false;
   const finish=(callback,value)=>{if(finished)return;finished=true;signal?.removeEventListener('abort',abort);entry.users--;callback(value)};
   const abort=()=>{finish(reject,reason());if(entry.users===0)entry.controller.abort(reason())};
   signal?.addEventListener('abort',abort,{once:true});
   entry.promise.then(value=>finish(resolve,value),error=>finish(reject,error));
   if(signal?.aborted)abort();
  });
 }
}
