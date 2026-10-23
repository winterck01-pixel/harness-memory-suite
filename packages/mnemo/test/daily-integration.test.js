import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {SystemPrompt,renderPrompt,renderContextSnapshot,renderContextSections} from '@deepseek-ai/dsh-system-prompt'
import * as mnemo from '../index.js'
import {projectScope} from '../lib/reliability.js'

// Use the installed host's actual synchronous providers and asynchronous waterfall.
async function host(t,{enabled=true,learningEnabled=false,dailyEnabled=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'mnemo-experience-prompt-')),ctx=new Context(),events=[]
 const session={id:'prompt-session',header:{cwd:'/fixture/experience-prompt'},get seq(){return events.length},snapshotEvents:(a,b)=>events.slice(a,b)}
 let live=session,route={provider:'fixture',model:'fixture'}
 ctx.provide('sessions',{get:id=>id===session.id?live:null})
 ctx.provide('agentDefaultModel',{currentSelection:()=>route})
 let taskLive=true,duringHistory=async()=>{}
 ctx.provide('schedule',{catalog:async()=>taskLive?[{id:'fixture-task',sessionId:session.id,status:'active'}]:[],history:async()=>{await duringHistory();return {id:'fixture-task',records:[{messageId:'scheduled-input',scheduledAt:'2026-01-01T00:00:00.000Z',deliveredAt:'2026-01-01T00:00:01.000Z',prompt:'Synthetic scheduled input'}]}}})
 const systemFiber=await ctx.plugin(SystemPrompt,{includeHarnessIdentity:false})
 const fiber=await ctx.plugin(mnemo,{dir,injectMode:'off',verbose:false,executionExperience:{enabled,contractFingerprint:'c'.repeat(64)},autoLearning:{enabled:learningEnabled},dailyLearning:{enabled:dailyEnabled}})
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

const recovery=a=>a.contexts.find(c=>c.name==='mnemo-daily-recovery')??{text:''}
const daily=a=>a.contexts.find(c=>c.name==='mnemo-daily-experience')??{text:''}
const failure=f=>{f.emit('tool/call',{callId:'failed-read',name:'run_code',arguments:{code:'return missing()'}});f.emit('tool/result',{message:{toolCallId:'failed-read',isError:true,content:[]}})}
const card={id:'daily-fixture',instruction:'Conditional operator template {{literal}}',conditional:true,targetTool:'mnemo_experience'}
test('daily recovery is event-driven and ordinary successful turns get no recovery context',async t=>{
 const f=await host(t);f.api.dailyLearning.recall=async()=>({cards:[]})
 assert.equal(recovery((await f.assemble()).a).text,'');failure(f)
 assert.match(recovery((await f.assemble()).a).text,/recovery_plan/)
 const state=f.api.dailyRecovery.snapshot({sessionId:f.session.id,turn:1,scope:projectScope(f.session.header.cwd),events:f.session.snapshotEvents(0,f.session.seq)})
 const plan=f.api.dailyRecovery.plan(state,{steps:['Check the exact failed call','Use a corrected read and verify its output'],change:'Inspect the contract before changing the call'})
 assert.equal(plan.verifiedSuccess,false);assert.match(recovery((await f.assemble()).a).text,/corrected read/)
 f.start(2);assert.equal(recovery((await f.assemble()).a).text,'')
})
test('explicit daily narrow lane remains separate from legacy freeze and records delivery',async t=>{
 const f=await host(t);f.api.engine.safety.frozen=true;f.start(2,'Activate a tool using run_code')
 f.api.dailyLearning.recall=async()=>({cards:[card]});const receipts=[]
 f.api.dailyLearning.noteDelivery=async(scope,r)=>{receipts.push(r);return {status:'recorded'}}
 const {a,text}=await f.assemble();assert.match(daily(a).text,/use_daily/);assert.match(text,/\{\{literal\}\}/);assert.equal(daily(a).interpolate,false)
 assert.equal(receipts.length,1);assert.equal(receipts[0].turnId,2);assert.equal(f.api.engine.safety.frozen,true);assert.equal(f.api.autoLearning,null)
})
test('unrelated user query does not retrieve daily cards and opt-out suppresses recovery',async t=>{
 const f=await host(t);let calls=0;f.api.dailyLearning.recall=async()=>{calls++;return {cards:[]}}
 await f.assemble();assert.equal(calls,0);f.start(2,'本轮不要使用记忆');failure(f)
 const {a}=await f.assemble();assert.equal(calls,0);assert.equal(recovery(a).text,'');assert.equal(daily(a).text,'')
})
test('current source or turn change across asynchronous recall cannot publish a daily card',async t=>{
 for(const mode of ['session','turn','query']){
  const f=await host(t);f.start(2,'Activate a tool');failure(f);f.api.dailyLearning.noteDelivery=async()=>({status:'recorded'})
  f.api.dailyLearning.recall=async()=>{if(mode==='session')f.withdraw();if(mode==='turn')f.start(3);if(mode==='query')f.emit('user/message',{id:'changed',source:{kind:'user'},content:[{type:'text',text:'new task'}]});return {cards:[card]}}
  const {a}=await f.assemble();assert.equal(daily(a).text,'');assert.equal(recovery(a).text,'')
 }
})
test('source withdrawal and turn changes during noteDelivery cannot publish either context',async t=>{
 for(const mode of ['session','turn','schedule']){
  const f=await host(t);f.start(2,'Activate a tool');failure(f)
  if(mode==='schedule')f.emit('user/message',{id:'scheduled-input',source:{kind:'schedule'},content:[{type:'text',text:'[SCHEDULE REMINDER]\nThis is a scheduled message from the user\nschedule_id_json: "fixture-task"\noccurrence_at: 2026-01-01T00:00:00.000Z\nreminder_prompt_json: "Synthetic scheduled input"'}]})
  f.api.dailyLearning.recall=async()=>({cards:[card]})
  f.api.dailyLearning.noteDelivery=async()=>{await Promise.resolve();if(mode==='session')f.withdraw();if(mode==='turn')f.start(3);if(mode==='schedule')f.deleteTask();return {status:'recorded'}}
  const {a}=await f.assemble();assert.equal(daily(a).text,'',mode);assert.equal(recovery(a).text,'',mode)
 }
})

test('daily accepted contexts survive actual request-admission refresh and consumer rendering',async t=>{
 const f=await host(t);f.start(2,'Activate a tool using run_code');failure(f)
 f.api.dailyLearning.recall=async()=>({cards:[card]})
 f.api.dailyLearning.noteDelivery=async()=>({status:'recorded'})
 const {a}=await f.assemble(),admitted=f.sp.refreshContext(a,{agent:f.agent}),sections=renderContextSections(admitted)
 assert.match(sections.find(c=>c.name==='mnemo-daily-recovery')?.text??'',/recovery_plan/)
 assert.match(sections.find(c=>c.name==='mnemo-daily-experience')?.text??'',/use_daily/)
 assert.match(sections.find(c=>c.name==='mnemo-daily-experience')?.text??'',/\{\{literal\}\}/)
 const providers=f.sp.layers.merge(undefined,layer=>layer.contexts)
 assert.equal(providers.has('mnemo-daily-recovery'),false)
 assert.equal(providers.has('mnemo-daily-experience'),false)
 assert.equal(providers.has('mnemo-verified-experience'),true)
 assert.equal(admitted.contexts.find(c=>c.name==='mnemo-daily-experience').interpolate,false)
})
