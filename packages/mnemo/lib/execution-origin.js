import {createHash} from 'node:crypto'
import {isAbsolute} from 'node:path'
import {projectScope} from './reliability.js'
import {selectCaptureText} from './capture-policy.js'
import {memoryOptOut} from './context-policy.js'

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const text=message=>(message?.content??[]).filter(block=>block?.type==='text').map(block=>block.text??'').join('\n')
const disabled=value=>selectCaptureText(value).hasOptOut||memoryOptOut(value)
const result=(status,reason,kind=null,optOut=false)=>({status,reason,kind,optOut})
const framing='This is a scheduled message from the user'
function payloadOf(message){
 const lines=text(message).split('\n')
 try{
  if(lines[0]==='[SCHEDULE REMINDER]'&&lines[1]===framing&&lines.length===5&&lines[2].startsWith('schedule_id_json: ')&&lines[3].startsWith('occurrence_at: ')&&lines[4].startsWith('reminder_prompt_json: '))return [{schedule_id:JSON.parse(lines[2].slice(18)),occurrence_at:lines[3].slice(15),reminder_prompt:JSON.parse(lines[4].slice(22))}]
  if(lines[0]==='[SCHEDULE REMINDER BATCH]'&&lines[1]===framing&&lines.length===3&&lines[2].startsWith('reminders_json: '))return JSON.parse(lines[2].slice(16))
 }catch{}
 return null
}

/** Resolve only native session events against the Host's persisted delivery receipts.
 * Returned bindings contain identities/hashes, never prompts, titles, or paths.
 * A verified origin authorizes shadow candidate capture, never memory promotion.
 */
export function createExecutionOriginResolver({getSessions,getSchedule,allowedTaskIds,contractFingerprint=null}={}){
 const allowed=allowedTaskIds==null?null:new Set(allowedTaskIds)
 return async function resolveOrigin(session,events,scope){
  // Opt-out only suppresses capture, so honor it even while source services are
  // unavailable. Never treat this preliminary scan as authorization.
  let optOut=Array.isArray(events)&&events.some(event=>{
   if(event?.type!=='user/message')return false
   if(event.data?.source?.kind==='user')return disabled(text(event.data))
   if(event.data?.source?.kind!=='schedule')return false
   const payload=payloadOf(event.data)
   return Array.isArray(payload)&&payload.some(part=>typeof part?.reminder_prompt==='string'&&disabled(part.reminder_prompt))
  })
  let sessions
  try{sessions=await getSessions?.()}catch{return result('pending','session-service-unavailable',null,optOut)}
  let liveSession
  try{liveSession=sessions?.get?.(session?.id)}catch{return result('pending','session-service-unavailable',null,optOut)}
  if(!session?.id||liveSession!==session||!isAbsolute(session.header?.cwd??''))return result('denied','untrusted-session',null,optOut)
  if(projectScope(session.header.cwd)!==scope)return result('denied','scope-mismatch',null,optOut)
  if(!Array.isArray(events)||!events.length||events[0]?.type!=='turn/start'||typeof session.snapshotEvents!=='function'||!Number.isSafeInteger(session.seq))return result('incomplete','missing-turn-boundary',null,optOut)
  const turn=events[0].data?.turn
  if(turn==null||events.slice(1).some(e=>e.type==='turn/start'||e.data?.turn!=null&&e.data.turn!==turn))return result('denied','mixed-turn-events',null,optOut)
  let previous=-1
  try{
   for(const event of events){
    if(!Number.isSafeInteger(event.seq)||event.seq<0||event.seq>=session.seq||event.seq<=previous)return result('denied','invalid-event-sequence',null,optOut)
    const native=session.snapshotEvents(event.seq,event.seq+1)
    if(native?.length!==1||hash(native[0])!==hash(event))return result('denied','non-native-event',null,optOut)
    previous=event.seq
   }
  }catch{return result('incomplete','native-events-unavailable',null,optOut)}
  // Inspect bounded preceding native history for the latest human directive. A
  // schedule must never reset a real user's continuing no-memory restriction.
  let preceding
  try{preceding=session.snapshotEvents(Math.max(0,events[0].seq-10000),previous+1)}catch{return result('incomplete','directive-history-unavailable',null,optOut)}
  if(!Array.isArray(preceding))return result('incomplete','directive-history-unavailable',null,optOut)
  const humans=preceding.filter(e=>e.type==='user/message'&&e.data?.source?.kind==='user')
  const latestHuman=humans.at(-1)
  const currentHumans=events.filter(e=>e.type==='user/message'&&e.data?.source?.kind==='user')
  optOut ||= currentHumans.some(e=>disabled(text(e.data)))||!!latestHuman&&disabled(text(latestHuman.data))
  const messages=events.filter(e=>e.type==='user/message'&&['user','schedule'].includes(e.data?.source?.kind))
  const kind=currentHumans.length?'user':messages.some(e=>e.data?.source?.kind==='schedule')?'schedule':null
  if(!kind)return result('denied','unsupported-origin',null,optOut)
  if(!latestHuman&&events[0].seq>10000)return result('incomplete','directive-history-truncated',kind,optOut)
  const binding={version:1,kind,contractFingerprint:typeof contractFingerprint==='string'?contractFingerprint:null,scopeHash:hash(scope),sessionHash:hash(session.id),turn,messageRefs:messages.map(e=>({seq:e.seq,hash:hash(e),messageHash:hash(e.data?.id??null)}))}
  const schedules=messages.filter(e=>e.data?.source?.kind==='schedule')
  if(schedules.length){
   let schedule,catalog
   try{schedule=await getSchedule?.();if(typeof schedule?.catalog!=='function'||typeof schedule?.history!=='function')return result('pending','schedule-service-unavailable',kind,optOut);catalog=await schedule.catalog()}catch{return result('pending','schedule-service-unavailable',kind,optOut)}
   if(!Array.isArray(catalog))return result('incomplete','invalid-schedule-catalog',kind,optOut)
   binding.tasks=[]
   for(const event of schedules){
    const payload=payloadOf(event.data)
    if(!event.data?.id||!Array.isArray(payload)||!payload.length||payload.length>100||new Set(payload.map(p=>p?.schedule_id)).size!==payload.length)return result('denied','invalid-schedule-framing',kind,optOut)
    // Evaluate the complete delivered batch before any receipt lookup can return.
    optOut ||= payload.some(part=>typeof part?.reminder_prompt==='string'&&disabled(part.reminder_prompt))
    for(const part of payload){
     if(typeof part?.schedule_id!=='string'||typeof part.reminder_prompt!=='string'||typeof part.occurrence_at!=='string'||!Number.isFinite(Date.parse(part.occurrence_at)))return result('denied','invalid-schedule-framing',kind,optOut)
     optOut ||= disabled(part.reminder_prompt)
     if(allowed&&!allowed.has(part.schedule_id))return result('denied','schedule-not-allowed',kind,optOut)
     const tasks=catalog.filter(t=>t.id===part.schedule_id&&t.sessionId===session.id)
     if(tasks.length!==1)return result('withdrawn','schedule-source-missing',kind,optOut)
     let receipt,before,foundMessage=false
     try{
      for(let page=0;page<10;page++){
       const response=await schedule.history({sessionId:session.id,id:part.schedule_id,limit:100,...before?{before}:{}})
       if(response?.code==='schedule_not_found')return result('withdrawn','schedule-source-missing',kind,optOut)
       if(response?.id!==part.schedule_id||!Array.isArray(response.records))return result('incomplete','invalid-delivery-history',kind,optOut)
       const matches=response.records.filter(r=>r.messageId===event.data.id)
       if(matches.length>1)return result('denied','conflicting-delivery-receipts',kind,optOut)
       if(matches.length){receipt=matches[0];foundMessage=true;break}
       if(!response.nextBefore)break
       if(response.nextBefore===before)return result('incomplete','delivery-history-cursor-stalled',kind,optOut)
       before=response.nextBefore
      }
     }catch{return result('pending','delivery-history-unavailable',kind,optOut)}
     if(!foundMessage)return result('pending','delivery-receipt-unavailable',kind,optOut)
     if(typeof receipt.prompt!=='string')return result('incomplete','original-prompt-unavailable',kind,optOut)
     optOut ||= disabled(receipt.prompt)
     if(receipt.prompt!==part.reminder_prompt||receipt.scheduledAt!==part.occurrence_at||!Number.isFinite(Date.parse(receipt.deliveredAt)))return result('denied','delivery-receipt-mismatch',kind,optOut)
     binding.tasks.push({taskHash:hash(part.schedule_id),messageHash:hash(event.data.id),scheduledAt:receipt.scheduledAt,promptHash:hash(receipt.prompt),receiptHash:hash(receipt)})
    }
   }
   binding.tasks.sort((a,b)=>hash(a).localeCompare(hash(b)))
  }
  binding.fingerprint=hash(binding)
  return {status:'verified',kind,binding,optOut}
 }
}
