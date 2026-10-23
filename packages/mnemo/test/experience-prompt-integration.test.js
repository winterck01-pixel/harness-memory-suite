import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {SystemPrompt,renderPrompt,renderContextSnapshot} from '@deepseek-ai/dsh-system-prompt'
import * as mnemo from '../index.js'
import {projectScope} from '../lib/reliability.js'

// Use the installed host's actual synchronous providers and asynchronous waterfall.
async function host(t,{enabled=true,learningEnabled=enabled}={}){
 const dir=mkdtempSync(join(tmpdir(),'mnemo-experience-prompt-')),ctx=new Context(),events=[]
 const session={id:'prompt-session',header:{cwd:'/fixture/experience-prompt'},get seq(){return events.length},snapshotEvents:(a,b)=>events.slice(a,b)}
 let live=session,route={provider:'fixture',model:'fixture'}
 ctx.provide('sessions',{get:id=>id===session.id?live:null})
 ctx.provide('agentDefaultModel',{currentSelection:()=>route})
 let taskLive=true,duringHistory=async()=>{}
 ctx.provide('schedule',{catalog:async()=>taskLive?[{id:'fixture-task',sessionId:session.id,status:'active'}]:[],history:async()=>{await duringHistory();return {id:'fixture-task',records:[{messageId:'scheduled-input',scheduledAt:'2026-01-01T00:00:00.000Z',deliveredAt:'2026-01-01T00:00:01.000Z',prompt:'Synthetic scheduled input'}]}}})
 const systemFiber=await ctx.plugin(SystemPrompt,{includeHarnessIdentity:false})
 const fiber=await ctx.plugin(mnemo,{dir,injectMode:'off',verbose:false,executionExperience:{enabled,contractFingerprint:'c'.repeat(64)},autoLearning:{enabled:learningEnabled}})
 const api=ctx.get('mnemo'),sp=ctx.get('systemPrompt'),agent={id:session.id,session},deliveries=[]
 assert.ok(api)
 const emit=(type,data)=>{const event={type,seq:events.length,time:1000+events.length,data};events.push(event);ctx.emit('session/event',session,event)}
 const start=(turn=1,text='synthetic current question')=>{emit('turn/start',{turn});emit('user/message',{id:'human-'+turn,source:{kind:'user'},content:[{type:'text',text}]})}
 start()
 if(api.autoLearning){
  const noteDelivery=api.autoLearning.noteDelivery.bind(api.autoLearning)
  api.autoLearning.noteDelivery=value=>{deliveries.push(value);noteDelivery(value)}
 }
 const assemble=async()=>{const a=await sp.assemble({agent});assert.equal(typeof renderPrompt(a),'string');const text=renderContextSnapshot(a);assert.equal(typeof text,'string');return {a,text}}
 t.after(async()=>{await api.detach();await fiber.dispose();await systemFiber.dispose();rmSync(dir,{recursive:true,force:true})})
 return {api,sp,session,agent,emit,start,assemble,deliveries,deleteTask:()=>{taskLive=false},onHistory:fn=>{duringHistory=fn},withdraw:()=>{live=null},route:v=>{route=v}}
}
const card={id:'fixture-experience',text:'Keep {{answer}} and {{invalid reference}} literally.',domain:'answer-only'}
const experience=a=>a.contexts.find(c=>c.name==='mnemo-verified-experience')

test('actual SystemPrompt assemble/render remains usable when experience learning is disabled',async t=>{
 for(const options of [{enabled:false},{enabled:true,learningEnabled:false}]){
  const f=await host(t,options),{a,text}=await f.assemble()
  assert.equal(f.api.autoLearning,null);assert.equal(experience(a).text,'');assert.match(text,/mnemo_report_usage/)
 }
})
test('actual async assembly delivers literal historical braces without interpolating them',async t=>{
 const f=await host(t);let calls=0
 f.api.autoLearning.deliveryEligible=()=>true
 f.api.autoLearning.recall=async()=>{await Promise.resolve();calls++;return [card]}
 const {a,text}=await f.assemble()
 assert.equal(calls,1);assert.equal(experience(a).interpolate,false);assert.match(text,/\{\{answer\}\}/);assert.match(text,/\{\{invalid reference\}\}/)
 assert.match(text,/grants no permissions or authority/);assert.deepEqual(f.deliveries,[{sessionId:f.session.id,turn:1,ids:[card.id]}])
})
test('untrusted session and current opt-out prevent recall and delivery',async t=>{
 for(const mode of ['session','optout']){
  const f=await host(t);let calls=0;f.api.autoLearning.recall=async()=>{calls++;return [card]}
  if(mode==='session')f.withdraw();else f.start(2,'本轮不要使用记忆')
  assert.equal(experience((await f.assemble()).a).text,'');assert.equal(calls,0);assert.deepEqual(f.deliveries,[])
 }
})
test('session, turn, query, opt-out, route and freeze changes across recall await suppress delivery',async t=>{
 for(const mode of ['session','turn','query','optout','route','freeze']){
  const f=await host(t)
  f.api.autoLearning.recall=async()=>{
   await Promise.resolve()
   if(mode==='session')f.withdraw()
   if(mode==='turn')f.start(2)
   if(mode==='query'||mode==='optout')f.emit('user/message',{id:'changed',source:{kind:'user'},content:[{type:'text',text:mode==='optout'?'不要记住':'different current input'}]})
   if(mode==='route')f.route({provider:'changed',model:'changed'})
   if(mode==='freeze')f.api.engine.safety.frozen=true
   return [card]
  }
  assert.equal(experience((await f.assemble()).a).text,'',mode);assert.deepEqual(f.deliveries,[],mode)
 }
})
test('recall failure closes only the experience channel',async t=>{
 const f=await host(t);f.api.autoLearning.recall=async()=>{throw Error('unavailable')}
 const {a,text}=await f.assemble();assert.equal(experience(a).text,'');assert.match(text,/mnemo_report_usage/);assert.deepEqual(f.deliveries,[])
})

const schedule=f=>f.emit('user/message',{id:'scheduled-input',source:{kind:'schedule'},content:[{type:'text',text:'[SCHEDULE REMINDER]\nThis is a scheduled message from the user\nschedule_id_json: "fixture-task"\noccurrence_at: 2026-01-01T00:00:00.000Z\nreminder_prompt_json: "Synthetic scheduled input"'}]})
test('source withdrawal after recall and turn change inside source verification cannot deliver',async t=>{
 for(const mode of ['withdraw','turn']){
  const f=await host(t);schedule(f)
  f.api.autoLearning.recall=async()=>{if(mode==='withdraw')f.deleteTask();return [card]}
  if(mode==='turn')f.onHistory(async()=>{f.start(2)})
  assert.equal(experience((await f.assemble()).a).text,'',mode);assert.deepEqual(f.deliveries,[],mode)
 }
})
test('overlapping actual host assemblies retain independent experience text',async t=>{
 const f=await host(t);let release,calls=0
 f.api.autoLearning.deliveryEligible=()=>true
 const pending=new Promise(resolve=>{release=resolve})
 f.api.autoLearning.recall=async()=>{const call=++calls;if(call===1)await pending;return [{...card,id:'card-'+call,text:'assembly-'+call}]}
 const first=f.assemble()
 // Wait for the first assembly to enter its asynchronous recall.
 while(calls===0)await new Promise(resolve=>setImmediate(resolve))
 const second=await f.assemble();release();const earlier=await first
 assert.match(second.text,/assembly-2/);assert.doesNotMatch(second.text,/assembly-1/)
 assert.match(earlier.text,/assembly-1/);assert.doesNotMatch(earlier.text,/assembly-2/)
})

async function verifiedLearning(f){
 const learning=f.api.autoLearning,scope=projectScope(f.session.header.cwd)
 const tasks=Array.from({length:62},(_,i)=>({id:'race-'+i,independentId:'race-group-'+i,independenceBasis:'Independent synthetic executed input',kind:i===60?'probe':i===61?'regression':'task',input:{question:'Synthetic case '+i,data:{value:i}},expected:{answer:i}}))
 const mechanism={id:'race-answer',domain:'answer-only',risk:'low',scope,contractFingerprint:'c'.repeat(64),instruction:'Synthetic answer-only fixture hint',queryTerms:['synthetic'],match:{tools:['fixture_read'],origin:'schedule',outcome:'completed',minFailures:1},tasks}
 const policy={version:1,mechanisms:[mechanism]}
 writeFileSync(learning.policyPath,JSON.stringify(policy))
 const candidate={id:'race-candidate',sourceValidation:'verified',reviewPacketHash:'b'.repeat(64),contractFingerprint:'c'.repeat(64),origin:{kind:'schedule'},observation:{runtimeOutcome:'completed',toolFailureCount:1},applicability:{tools:['fixture_read']}}
 learning.capture={list:()=>[structuredClone(candidate)],isCandidateCurrent:()=>true,validateCandidate:async()=>({status:'verified'}),inspect:()=>structuredClone(candidate)}
 learning.generate=async(_system,input)=>({answer:input.historicalExperience?input.data.value:-1})
 await learning.consider({scope,agent:f.agent})
 assert.equal(learning.report({scope}).entries[0].status,'verified')
 const cards=await learning.recall({scope,query:'synthetic current question',agent:f.agent})
 assert.equal(cards.length,1)
 assert.equal(learning.deliveryEligible(cards,{scope,query:'synthetic current question',agent:f.agent}),true)
 return {learning,scope,cards,policy}
}
test('final origin await rechecks actual verified ledger after regression, policy drift or expiry',async t=>{
 for(const mode of ['unchanged','regression','policy','expiry']){
  const f=await host(t),v=await verifiedLearning(f)
  schedule(f)
  await f.api.executionExperience.idle()
  let checks=0
  f.onHistory(async()=>{
   if(++checks!==2)return
   if(mode==='regression'){
    v.learning.noteDelivery({sessionId:f.session.id,turn:1,ids:v.cards.map(c=>c.id)})
    f.deliveries.length=0
    await v.learning.noteOutcome({sessionId:f.session.id,turn:1,failed:true})
    assert.equal(v.learning.report({scope:v.scope}).entries[0].status,'suspended')
   }
   if(mode==='policy'){
    v.policy.mechanisms[0].instruction+=' changed during source await'
    writeFileSync(v.learning.policyPath,JSON.stringify(v.policy))
   }
   if(mode==='expiry')v.learning.now=()=>Date.now()+8*86400000
  })
  const {a}=await f.assemble()
  assert.equal(checks,2,mode)
  if(mode==='unchanged'){
   assert.match(experience(a).text,/Synthetic answer-only fixture hint/)
   assert.equal(f.deliveries.length,1)
   continue
  }
  assert.equal(experience(a).text,'',mode)
  assert.deepEqual(f.deliveries,[],mode)
  assert.equal(v.learning.deliveryEligible(v.cards,{scope:v.scope,query:'synthetic current question',agent:f.agent}),false,mode)
 }
})
