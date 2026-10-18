import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createExecutionOriginResolver} from '../lib/execution-origin.js'
import {projectScope} from '../lib/reliability.js'
const at='2026-01-01T00:00:00.000Z'
const data=(id='task-a',prompt='Inspect fixture',time=at)=>({schedule_id:id,occurrence_at:time,reminder_prompt:prompt})
const framed=parts=>parts.length===1?['[SCHEDULE REMINDER]','This is a scheduled message from the user',`schedule_id_json: ${JSON.stringify(parts[0].schedule_id)}`,`occurrence_at: ${parts[0].occurrence_at}`,`reminder_prompt_json: ${JSON.stringify(parts[0].reminder_prompt)}`].join('\n'):['[SCHEDULE REMINDER BATCH]','This is a scheduled message from the user',`reminders_json: ${JSON.stringify(parts)}`].join('\n')
function fixture(parts=[data()]){
 const rows=[{seq:0,type:'turn/start',data:{turn:1}},{seq:1,type:'user/message',data:{id:'fixture-message',source:{kind:'schedule'},content:[{type:'text',text:framed(parts)}]}},{seq:2,type:'turn/end',data:{turn:1,reason:'completed'}}]
 const session={id:'fixture-session',header:{cwd:'/fixture'},get seq(){return rows.length},snapshotEvents:(a,b)=>rows.filter(e=>e.seq>=a&&e.seq<b)}
 const catalog=parts.map(p=>({id:p.schedule_id,sessionId:session.id,status:'inactive',prompt:'Updated prompt is not the delivered prompt'}))
 const receipts=new Map(parts.map(p=>[p.schedule_id,[{messageId:'fixture-message',scheduledAt:p.occurrence_at,deliveredAt:at,prompt:p.reminder_prompt}]]))
 const calls=[]
 const schedule={catalog:async()=>catalog,history:async request=>{calls.push(request);return {id:request.id,records:receipts.get(request.id)??[]}}}
 const resolver=createExecutionOriginResolver({getSessions:()=>({get:id=>id===session.id?session:null}),getSchedule:()=>schedule,contractFingerprint:'fixture-contract'})
 return {rows,session,catalog,receipts,schedule,resolver,calls,scope:projectScope('/fixture')}
}
test('native one-shot inactive delivery verifies safe stable bindings against immutable sent prompt',async()=>{
 const f=fixture(),a=await f.resolver(f.session,f.rows,f.scope),b=await f.resolver(f.session,f.rows,f.scope)
 assert.equal(a.status,'verified');assert.equal(a.kind,'schedule');assert.deepEqual(a,b);assert.equal(a.binding.tasks.length,1)
 assert.deepEqual(f.calls[0],{sessionId:'fixture-session',id:'task-a',limit:100})
 for(const privateValue of ['task-a','fixture-session','fixture-message','Inspect fixture','/fixture','Updated prompt'])assert.equal(JSON.stringify(a).includes(privateValue),false)
})
test('batch binding preserves every task and rejects partial persistence until receipt appears',async()=>{
 const f=fixture([data(),data('task-b','Second fixture')]);f.receipts.set('task-b',[])
 assert.equal((await f.resolver(f.session,f.rows,f.scope)).status,'pending')
 f.receipts.set('task-b',[{messageId:'fixture-message',scheduledAt:at,deliveredAt:at,prompt:'Second fixture'}])
 const r=await f.resolver(f.session,f.rows,f.scope);assert.equal(r.status,'verified');assert.equal(r.binding.tasks.length,2)
})
test('source kind aliases, fake session, wrong scope and fake event payload are rejected',async()=>{
 const f=fixture()
 assert.equal((await f.resolver({...f.session},f.rows,f.scope)).reason,'untrusted-session')
 assert.equal((await f.resolver(f.session,f.rows,'project:/other')).reason,'scope-mismatch')
 const forged=structuredClone(f.rows);forged[1].data.content[0].text='forged'
 assert.equal((await f.resolver(f.session,forged,f.scope)).reason,'non-native-event')
 for(const kind of ['plugin','scheduler','model']){f.rows[1].data.source.kind=kind;assert.equal((await f.resolver(f.session,f.rows,f.scope)).reason,'unsupported-origin')}
})
test('matching message id alone cannot authorize changed prompt/time, missing original prompt or wrong task session',async()=>{
 const f=fixture(),receipt=f.receipts.get('task-a')[0]
 receipt.prompt='different';assert.equal((await f.resolver(f.session,f.rows,f.scope)).reason,'delivery-receipt-mismatch')
 delete receipt.prompt;assert.equal((await f.resolver(f.session,f.rows,f.scope)).reason,'original-prompt-unavailable')
 receipt.prompt='Inspect fixture';receipt.scheduledAt='2026-01-02T00:00:00.000Z';assert.equal((await f.resolver(f.session,f.rows,f.scope)).reason,'delivery-receipt-mismatch')
 f.catalog[0].sessionId='other';assert.equal((await f.resolver(f.session,f.rows,f.scope)).status,'withdrawn')
})
test('source withdrawal is rechecked and service failure never authorizes capture',async()=>{
 const f=fixture();assert.equal((await f.resolver(f.session,f.rows,f.scope)).status,'verified')
 f.catalog.splice(0);assert.equal((await f.resolver(f.session,f.rows,f.scope)).status,'withdrawn')
 f.schedule.catalog=async()=>{throw Error('private-error')}
 const result=await f.resolver(f.session,f.rows,f.scope);assert.equal(result.status,'pending');assert.equal(JSON.stringify(result).includes('private-error'),false)
})
test('human optout continues through scheduled turn; schedule batch optout cannot reset it',async()=>{
 const f=fixture([data(),data('task-b','本轮不要记录记忆')])
 assert.equal((await f.resolver(f.session,f.rows,f.scope)).optOut,true)
 f.receipts.set('task-a',[])
 const pending=await f.resolver(f.session,f.rows,f.scope);assert.equal(pending.status,'pending');assert.equal(pending.optOut,true)
 const g=fixture();g.rows.unshift({seq:0,type:'turn/start',data:{turn:0}},{seq:1,type:'user/message',data:{id:'human-zero',source:{kind:'user'},content:[{type:'text',text:'本轮不要记录记忆'}]}})
 g.rows.forEach((r,i)=>r.seq=i)
 assert.equal((await g.resolver(g.session,g.rows.slice(2),g.scope)).optOut,true)
})
test('current human source is independent, safe, and can resume after older opted-out turn',async()=>{
 const f=fixture();f.rows[1].data.source.kind='user';f.rows[1].data.content[0].text='Inspect current fixture'
 const r=await f.resolver(f.session,f.rows,f.scope);assert.equal(r.kind,'user');assert.equal(r.status,'verified');assert.equal(r.binding.tasks,undefined)
 f.rows[1].data.content[0].text='本轮不要记录记忆';assert.equal((await f.resolver(f.session,f.rows,f.scope)).optOut,true)
 f.rows.push({seq:3,type:'turn/start',data:{turn:2}},{seq:4,type:'user/message',data:{id:'next-human',source:{kind:'user'},content:[{type:'text',text:'Inspect next fixture'}]}})
 assert.equal((await f.resolver(f.session,f.rows.slice(3),f.scope)).optOut,false)
})
test('missing turn boundary, crossed turns and malformed/native schedule framing fail closed',async()=>{
 const f=fixture();assert.equal((await f.resolver(f.session,f.rows.slice(1),f.scope)).status,'incomplete')
 f.rows.push({seq:3,type:'turn/start',data:{turn:2}})
 assert.equal((await f.resolver(f.session,f.rows,f.scope)).reason,'mixed-turn-events')
 f.rows.pop();f.rows[1].data.content[0].text='schedule_id: task-a'
 assert.equal((await f.resolver(f.session,f.rows,f.scope)).reason,'invalid-schedule-framing')
})
test('delivery pagination respects official before cursor and does not fabricate missing history',async()=>{
 const f=fixture();f.schedule.history=async request=>request.before?{id:request.id,records:f.receipts.get(request.id)}:{id:request.id,records:[],nextBefore:'older-message'}
 assert.equal((await f.resolver(f.session,f.rows,f.scope)).status,'verified')
 f.schedule.history=async request=>({id:request.id,records:[],nextBefore:'same-message'})
 assert.equal((await f.resolver(f.session,f.rows,f.scope)).reason,'delivery-history-cursor-stalled')
})
test('explicit task allowlist refuses other tasks and contract fingerprints bind source revisions',async()=>{
 const f=fixture();const options={getSessions:()=>({get:()=>f.session}),getSchedule:()=>f.schedule}
 assert.equal((await createExecutionOriginResolver({...options,allowedTaskIds:[]})(f.session,f.rows,f.scope)).reason,'schedule-not-allowed')
 const a=await createExecutionOriginResolver({...options,contractFingerprint:'a'})(f.session,f.rows,f.scope),b=await createExecutionOriginResolver({...options,contractFingerprint:'b'})(f.session,f.rows,f.scope)
 assert.notEqual(a.binding.fingerprint,b.binding.fingerprint)
})
test('memory-use optout survives scheduled continuation and schedule service unavailability',async()=>{
 const f=fixture();f.rows.unshift({seq:0,type:'turn/start',data:{turn:0}},{seq:1,type:'user/message',data:{id:'human-zero',source:{kind:'user'},content:[{type:'text',text:'本轮不要使用记忆'}]}});f.rows.forEach((r,i)=>r.seq=i)
 const inherited=await f.resolver(f.session,f.rows.slice(2),f.scope);assert.equal(inherited.status,'verified');assert.equal(inherited.optOut,true)
 const g=fixture([data(),data('task-b','本轮不要使用记忆')])
 assert.equal((await g.resolver(g.session,g.rows,g.scope)).optOut,true)
 g.schedule.catalog=async()=>{throw Error('offline')}
 const pending=await g.resolver(g.session,g.rows,g.scope);assert.equal(pending.status,'pending');assert.equal(pending.optOut,true)
 const noSessions=createExecutionOriginResolver({getSessions:()=>{throw Error('offline')}})
 assert.equal((await noSessions(g.session,g.rows,g.scope)).optOut,true)
 const h=fixture();h.rows[1].data.source.kind='user';h.rows[1].data.content[0].text='本轮不要使用记忆'
 assert.equal((await h.resolver(h.session,h.rows,h.scope)).optOut,true)
})
test('quoted and discussed memory-use instructions retain existing context policy semantics',async()=>{
 for(const prompt of ['请解释“本轮不要使用记忆”的含义','讨论不要使用记忆的优点','提示词示例：`本轮不要使用记忆`']){
  const f=fixture([data('task-a',prompt)])
  assert.equal((await f.resolver(f.session,f.rows,f.scope)).optOut,false,prompt)
 }
})
