/** Host-only read bridge for live and persisted execution evidence.
 * Never resumes an Agent, enters a Session, opens a writer or trusts tool input.
 * Cold observations use the Host's revision-checked, bounded read cache.
 */
export function createExecutionSourceReader({getSessions,getSessionQuery,getPersistence,signal,maxSources=8}={}){
 if(!Number.isSafeInteger(maxSources)||maxSources<1||maxSources>8)throw TypeError('Invalid source cache bound')
 const pins=new Map(),pending=new Map();let closed=false
 const identity=p=>p?.identity??p
 const release=entry=>{try{entry?.lease?.[Symbol.dispose]?.()}catch{}}
 const clear=id=>{release(pins.get(id));pins.delete(id)}
 const allowed=()=>!closed&&!signal?.aborted
 const compatible=(a,b)=>a?.id===b?.id&&a?.cwd===b?.cwd&&a?.createdAt===b?.createdAt&&a?.parentSession===b?.parentSession&&a?.isSeeded===b?.isSeeded
 const currentSession=id=>{
  if(!allowed())return null
  const entry=pins.get(id);if(!entry)return null
  try{
   if(identity(getPersistence?.())!==entry.persistence)return null
   const live=getSessions?.()?.get?.(id)
   return entry.live?(live===entry.session?live:null):live?null:entry.session
  }catch{return null}
 }
 const commit=(id,entry)=>{
  clear(id);pins.set(id,entry)
  while(pins.size>maxSources)clear(pins.keys().next().value)
  return entry.session
 }
 const resolveSession=async id=>{
  if(!allowed()||typeof id!=='string'||!id)return null
  const token=Symbol(id);pending.set(id,token);let lease=null
  const fresh=()=>allowed()&&pending.get(id)===token
  try{
   const persistence=getPersistence?.(),persistenceId=identity(persistence)
   let before=null
   if(persistence){
    if(typeof persistence.stat!=='function')throw Error('Persistence stat unavailable')
    before=await persistence.stat(id,signal?{signal}:undefined)
    if(!fresh())return null
    if(!before||before.header?.id!==id)throw Error('Source missing')
    if(identity(getPersistence?.())!==persistenceId)throw Error('Persistence changed')
   }
   const live=getSessions?.()?.get?.(id)
   if(live){
    if(live.id!==id||typeof live.snapshotEvents!=='function'||before&&!compatible(before.header,live.header))throw Error('Live source changed')
    return commit(id,{session:live,live:true,persistence:persistenceId})
   }
   // Without the official persistence service only exact live identity is usable.
   if(!persistence)throw Error('Persistence unavailable')
   const query=getSessionQuery?.()
   if(typeof query?.observeSession!=='function')throw Error('Session observation unavailable')
   lease=await query.observeSession(id,{projectionMode:'none',...(signal?{signal}:{})})
   if(!fresh())return null
   if(lease?.source!=='prepared'||lease.header?.id!==id||!Number.isSafeInteger(lease.cursor)||lease.cursor< -1||typeof lease.revision!=='string'||typeof lease[Symbol.dispose]!=='function')throw Error('Untrusted source observation')
   const events=lease.events
   if(!Array.isArray(events)||events.length!==lease.cursor+1||events.some((event,index)=>event?.seq!==index))throw Error('Invalid source event cut')
   // Recheck after the asynchronous read, including deletion during a cache hit.
   const after=await persistence.stat(id,signal?{signal}:undefined)
   if(!fresh())return null
   if(identity(getPersistence?.())!==persistenceId||!after||after.revision!==lease.revision||!compatible(after.header,lease.header)||getSessions?.()?.get?.(id))throw Error('Observed source changed')
   const previous=pins.get(id)
   if(previous&&!previous.live&&previous.persistence===persistenceId&&previous.revision===lease.revision&&compatible(previous.session.header,lease.header)){
    // Keep stable identity for source-origin verification within one evidence cut.
    pins.delete(id);pins.set(id,previous)
    return previous.session
   }
   const seq=lease.cursor+1,header=lease.header
   const session=Object.freeze({id:header.id,header,seq,snapshotEvents:(start=0,end=seq)=>{
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start)throw TypeError('Invalid source event range')
    return events.slice(Math.min(start,seq),Math.min(end,seq))
   }})
   const retained=lease;lease=null
   return commit(id,{session,live:false,lease:retained,persistence:persistenceId,revision:retained.revision})
  }catch{
   if(pending.get(id)===token)clear(id)
   return null
  }finally{
   release({lease})
   if(pending.get(id)===token)pending.delete(id)
  }
 }
 const dispose=()=>{if(closed)return;closed=true;pending.clear();for(const id of pins.keys())clear(id)}
 signal?.addEventListener('abort',dispose,{once:true})
 return {resolveSession,currentSession,dispose:()=>{signal?.removeEventListener('abort',dispose);dispose()}}
}
