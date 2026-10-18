import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {apply} from '../index.js'
import {projectScope} from '../lib/reliability.js'
async function host(t){
 const dir=mkdtempSync(join(tmpdir(),'mnemo-execution-integration-')),rows=[],listeners=new Map(),tools=new Map(),receipts=[]
 const session={id:'fixture-scheduled-session',header:{cwd:'/fixture/scheduled-experience'},get seq(){return rows.length},snapshotEvents:(a,b)=>rows.filter(e=>e.seq>=a&&e.seq<b)}
 let deleted=false,answer='仅批准冻结沙箱评估',asks=0,duringAsk=()=>{}
 const services={sessions:{get:id=>id===session.id?session:null},schedule:{catalog:async()=>deleted?[]:[{id:'fixture-task',sessionId:session.id,status:'active'}],history:async()=>({id:'fixture-task',records:receipts})},tools:{register:tool=>tools.set(tool.name,tool)},userQuestions:{ask:async()=>{asks++;await duringAsk();return {answers:[{id:'execution-experience-review',selected:[answer]}]}}}}
 const ctx={get:name=>services[name],provide:(name,value)=>services[name]=value,effect:fn=>fn(),on:(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);return()=>{listeners.set(name,listeners.get(name).filter(x=>x!==fn))}}}
 await apply(ctx,{dir,injectMode:'off',verbose:false,executionExperience:{enabled:true,contractFingerprint:'c'.repeat(64)}})
 const api=services.mnemo;t.after(async()=>{await api.detach();rmSync(dir,{recursive:true,force:true})})
 const emit=(type,data)=>{const e={type,seq:rows.length,time:1000+rows.length,data};rows.push(e);for(const fn of listeners.get('session/event')??[])fn(session,e);return e}
 const addReceipt=()=>receipts.push({messageId:'fixture-delivery',scheduledAt:'2026-01-01T00:00:00.000Z',deliveredAt:'2026-01-01T00:00:01.000Z',prompt:'Inspect the synthetic fixture'})
 const scheduled=async({delayReceipt=false}={})=>{
  emit('turn/start',{turn:1});emit('user/message',{id:'fixture-delivery',source:{kind:'schedule'},content:[{type:'text',text:'[SCHEDULE REMINDER]\nThis is a scheduled message from the user\nschedule_id_json: "fixture-task"\noccurrence_at: 2026-01-01T00:00:00.000Z\nreminder_prompt_json: "Inspect the synthetic fixture"'}]});
  await api.executionExperience.idle();assert.equal(api.executionExperience.list({scope:projectScope(session.header.cwd)}).length,0)
  if(!delayReceipt)addReceipt()
  emit('tool/call',{turn:1,callId:'failed-call',name:'fixture_probe',arguments:{secret:'fixture-private-argument'}})
  emit('tool/result',{turn:1,message:{toolCallId:'failed-call',isError:true,content:[{type:'text',text:'fixture-private-error-body'}]}})
  emit('tool/call',{turn:1,callId:'success-call',name:'fixture_probe',arguments:{mode:'corrected'}})
  emit('tool/result',{turn:1,message:{toolCallId:'success-call',isError:false,content:[{type:'text',text:'fixture-private-success-body'}]}})
  emit('assistant/message',{turn:1,message:{content:[{type:'reasoning',text:'fixture-private-reasoning'},{type:'text',text:'The operation completed; the cause is still unverified.'}]}})
  emit('turn/end',{turn:1,reason:{kind:'completed'}});await api.executionExperience.idle()
 }
 const call=args=>tools.get('mnemo_experience').execute(args,{agent:{id:session.id,session}})
 return {dir,api,session,services,scheduled,addReceipt,emit,call,get asks(){return asks},deleteTask:()=>{deleted=true},onAsk:fn=>{duringAsk=fn},setAnswer:v=>{answer=v},changed:async()=>{for(const fn of listeners.get('schedule/changed')??[])fn({});await api.executionExperience.idle()}}
}
test('real plugin schedule receipt → candidate → human frozen review, with no long-term writes',async t=>{
 const f=await host(t),scope=projectScope(f.session.header.cwd)
 f.api.remember({text:'Synthetic durable baseline',scope,source:'human'})
 f.api.engine.safety.frozen=true;f.api.engine.checkpoint()
 const before=readFileSync(f.api.engine.log.path,'utf8'),safety=structuredClone(f.api.engine.safety)
 await f.scheduled();const rows=JSON.parse(await f.call({action:'list'})).candidates;assert.equal(rows.length,1)
 const c=rows[0];assert.equal(c.origin.kind,'schedule');assert.equal(c.observation.toolFailureCount,1);assert.equal(c.observation.subsequentSameToolSuccess,'observed');assert.equal(c.observation.verification,'unobserved');assert.equal(c.applicability.permission,'unknown');assert.equal(c.applicability.originKind,'schedule');assert.equal(c.applicability.taskHashes.length,1);assert.equal(c.applicability.taskPromptHashes.length,1);assert.match(c.applicability.taskHashes[0],/^[a-f0-9]{64}$/);assert.equal(c.productionEligible,false);assert.equal(c.instruction,null)
 const persisted=JSON.stringify(f.api.executionExperience.snapshot());for(const secret of ['fixture-private-argument','fixture-private-error-body','fixture-private-success-body','fixture-private-reasoning','Inspect the synthetic fixture'])assert.equal(persisted.includes(secret),false)
 const approved=JSON.parse(await f.call({action:'review',id:c.id,packetHash:c.reviewPacketHash}));assert.equal(approved.status,'approved-for-frozen-evaluation');assert.equal(f.asks,1)
 assert.equal(readFileSync(f.api.engine.log.path,'utf8'),before);assert.deepEqual(f.api.engine.safety,safety);assert.equal(f.api.engine.log.items.size,1)
 assert.equal(f.api.engine.recall('fixture-private-error-body',{scope}).length,0)
 f.deleteTask();await f.changed();assert.equal(f.api.executionExperience.list({scope}).length,0)
})
test('source withdrawal while human question is open invalidates that review',async t=>{const f=await host(t);await f.scheduled();const c=JSON.parse(await f.call({action:'list'})).candidates[0];f.onAsk(()=>f.deleteTask());await assert.rejects(f.call({action:'review',id:c.id,packetHash:c.reviewPacketHash}),/changed during review/);await f.changed();assert.equal(f.api.executionExperience.list({scope:projectScope(f.session.header.cwd)}).length,0)})
test('invoking turn memory optout also blocks inspection of existing candidates',async t=>{const f=await host(t);await f.scheduled();f.emit('turn/start',{turn:2});f.emit('user/message',{id:'fixture-no-memory',source:{kind:'user'},content:[{type:'text',text:'本轮不要使用记忆'}]});await assert.rejects(f.call({action:'list'}),/disabled/);assert.equal(f.asks,0)})

test('receipt committed after the entire native turn is retried on schedule change without duplicate candidates',async t=>{
 const f=await host(t),scope=projectScope(f.session.header.cwd)
 await f.scheduled({delayReceipt:true});assert.equal(f.api.executionExperience.list({scope}).length,0)
 f.addReceipt();await f.changed();assert.equal(f.api.executionExperience.list({scope}).length,1)
 const first=f.api.executionExperience.list({scope})[0];assert.equal(first.origin.kind,'schedule');assert.equal(first.observation.toolFailureCount,1)
 await f.changed();assert.equal(f.api.executionExperience.list({scope}).length,1);assert.equal(f.api.executionExperience.list({scope})[0].id,first.id)
})
