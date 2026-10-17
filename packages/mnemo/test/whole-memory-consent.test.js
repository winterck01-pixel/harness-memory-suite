import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {memoryOptOut} from '../lib/context-policy.js'
import {selectCaptureText,wholeTurnOptOut} from '../lib/capture-policy.js'
import {MemoryEngine} from '../lib/engine.js'
import {DshAdapter} from '../dsh-adapter.js'
import {apply} from '../index.js'
const disabled=['这轮关闭记忆。','本轮禁用记忆。','这次停用 MNEMO。','Disable memory for this turn.','Turn off the memory.','Please disable MNEMO.','遵守：“这轮关闭记忆”。','Follow: "disable memory".']
const inert=['解释一下“这轮关闭记忆”的含义。','讨论这轮关闭记忆的利弊。','Explain disable memory for this turn.','Translate "turn off memory".','日志里写着“这轮关闭记忆”。','`disable memory`','```\ndisable memory\n```']
for(const text of disabled)test(`whole-memory consent: ${text}`,()=>{
 assert.equal(memoryOptOut(text),true)
 assert.equal(wholeTurnOptOut(text),true)
 assert.deepEqual(selectCaptureText(text+' orchard 8443'),{text:'',dropped:true,hasOptOut:true,wholeTurn:true})
})
for(const text of inert)test(`quoted/discussed consent stays inert: ${text}`,()=>{
 assert.equal(memoryOptOut(text),false)
 assert.equal(selectCaptureText(text).hasOptOut,false)
})
for(const text of ['本轮不要读取记忆。','Do not retrieve memory this turn.'])test(`read-only refusal still permits capture: ${text}`,()=>{
 assert.equal(memoryOptOut(text),true)
 assert.equal(selectCaptureText(text+' orchard 8443').hasOptOut,false)
})
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'mnemo-whole-consent-'));const e=new MemoryEngine({dir});const a=new DshAdapter(e,{settleEveryTurns:0,settleMinIntervalMin:0,log:()=>{}});t.after(()=>{a.detach();rmSync(dir,{recursive:true,force:true})});return {e,a,dir}}
function event(type,seq,data){return{type,seq,time:Date.now()+seq,data}}
for(const late of [false,true])test(`actual adapter blocks capture and ledger, late=${late}`,t=>{
 const {e,a,dir}=fixture(t),s={id:'consent-session',header:{cwd:'/synthetic/orchard'}}
 const es=[event('turn/start',0,{turn:1}),event('user/message',1,{source:{kind:'user'},content:[{type:'text',text:late?'orchard deployment constraint 8443':'这轮关闭记忆。orchard deployment constraint 8443'}]}),event('assistant/message',2,{turn:1,message:{content:[{type:'text',text:'Orchard timeout is 90 seconds.'}]}})]
 for(const ev of es)a.handleSessionEvent({},s,ev)
 assert.equal(e.staging.pending.length,0,'assistant capture must wait until turn end')
 if(late)a.handleSessionEvent({},s,event('user/message',3,{source:{kind:'user'},content:[{type:'text',text:'这轮关闭记忆。'}]}))
 assert.equal(a._contextText({agent:{session:s}}),'')
 a.handleSessionEvent({},s,event('turn/end',4,{turn:1,reason:{kind:'completed'}}))
 e.checkpoint();const restored=new MemoryEngine({dir});restored._ensure()
 assert.deepEqual(restored.staging.pending,[])
 assert.equal(restored.taskMemory.toJSON().sessions.length,0)
})
test('actual adapter retains capture under read-only refusal',t=>{
 const {e,a}=fixture(t),s={id:'read-only',header:{cwd:'/synthetic/orchard'}}
 for(const ev of [event('turn/start',0,{turn:1}),event('user/message',1,{source:{kind:'user'},content:[{type:'text',text:'本轮不要读取记忆。orchard deployment constraint 8443'}]}),event('assistant/message',2,{turn:1,message:{content:[{type:'text',text:'Orchard timeout is 90 seconds.'}]}}),event('turn/end',3,{turn:1,reason:{kind:'completed'}})])a.handleSessionEvent({},s,ev)
 assert.ok(e.staging.pending.some(p=>p.source==='human'))
 assert.ok(e.staging.pending.some(p=>p.source==='agent'))
})
for(const late of [false,true])test(`real plugin usage/recall exposure guard, late=${late}`,async t=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-plugin-consent-')),tools=[],services={tools:{register:x=>tools.push(x)},systemPrompt:{context:()=>()=>{},getContextOrder:()=>120}}
 const ctx={baseUrl:import.meta.url,effect:fn=>fn(),on:()=>()=>{},get:n=>services[n],provide:(n,v)=>{services[n]=v;return()=>delete services[n]},inject:(deps,fn)=>{if(deps.every(d=>services[d]))fn(ctx);return()=>{}}}
 let api;t.after(()=>{api?.detach();rmSync(dir,{recursive:true,force:true})})
 await apply(ctx,{dir,scope:'p',verbose:false});api=services.mnemo
 const s={id:'plugin-session',header:{}},exec={agent:{id:s.id,session:s}},a=api.adapter
 a._turnIds.set(s.id,1);a._claimedInput.set(s.id,{turn:1,text:late?'orchard query':'这轮关闭记忆。orchard query'})
 const m=api.remember({text:'orchard fixture 8443',scope:'p',cues:['orchard']})
 let resolve;api.maintenance.semanticRecall=()=>new Promise(r=>{resolve=r})
 const pending=tools.find(t=>t.name==='mnemo_recall').execute({query:'orchard'},exec)
 const rejection=assert.rejects(pending,/disabled/)
 if(late){a._claimedInput.set(s.id,{turn:1,text:'Turn off memory.'});resolve([{id:m.id,score:1}])}
 else assert.equal(resolve,undefined,'whole-memory refusal must prevent recall invocation')
 await rejection
 assert.equal(api.engine.taskMemory.toJSON().sessions.reduce((n,s)=>n+s.exposures.length,0),0)
 assert.throws(()=>tools.find(t=>t.name==='mnemo_report_usage').execute({action:'status'},exec),/disabled/)
})
for(const text of ['本轮不要关闭记忆。','本轮无需禁用记忆。',"Don't disable memory.",'Do not turn off memory.'])test(`actual adapter keeps normal capture under negated shutdown: ${text}`,t=>{
 const {e,a}=fixture(t),s={id:'continued-consent',header:{cwd:'/synthetic/orchard'}}
 for(const ev of [event('turn/start',0,{turn:1}),event('user/message',1,{source:{kind:'user'},content:[{type:'text',text:text+' orchard deployment constraint 8443'}]}),event('assistant/message',2,{turn:1,message:{content:[{type:'text',text:'Orchard timeout is 90 seconds.'}]}}),event('turn/end',3,{turn:1,reason:{kind:'completed'}})])a.handleSessionEvent({},s,ev)
 assert.ok(e.staging.pending.some(p=>p.source==='human'))
 assert.ok(e.staging.pending.some(p=>p.source==='agent'))
})
