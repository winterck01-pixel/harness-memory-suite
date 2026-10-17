import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {apply} from '../index.js'
import {memoryOptOut} from '../lib/context-policy.js'
import {selectCaptureText} from '../lib/capture-policy.js'

const inert=['本轮不要关闭记忆。','本轮无需禁用记忆。','本轮不需要停用记忆。',"Don't disable memory.",'Do not turn off memory.','Never disable memory.','讨论这轮关闭记忆的利弊。','日志里写着“这轮关闭记忆”。']
for(const text of inert)test(`negative or mentioned disable remains inert: ${text}`,()=>{
 assert.equal(memoryOptOut(text),false)
 assert.equal(selectCaptureText(text+' orchard 8443').hasOptOut,false)
})
async function fixture(t,text){
 const dir=mkdtempSync(join(tmpdir(),'mnemo-recall-consent-')),tools=[],services={tools:{register:x=>tools.push(x)},systemPrompt:{context:()=>()=>{},getContextOrder:()=>120}}
 const ctx={baseUrl:import.meta.url,effect:fn=>fn(),on:()=>()=>{},get:n=>services[n],provide:(n,v)=>{services[n]=v;return()=>delete services[n]},inject:(deps,fn)=>{if(deps.every(d=>services[d]))fn(ctx);return()=>{}}}
 let api;t.after(()=>{api?.detach();rmSync(dir,{recursive:true,force:true})})
 await apply(ctx,{dir,scope:'p',verbose:false});api=services.mnemo
 const session={id:'recall-session',header:{}},exec={agent:{id:session.id,session}},a=api.adapter
 a._turnIds.set(session.id,1);a._claimedInput.set(session.id,{turn:1,text})
 const m=api.remember({text:'orchard fixture 8443',scope:'p',cues:['orchard']})
 return {api,session,exec,m,recall:tools.find(t=>t.name==='mnemo_recall'),exposures:()=>api.engine.taskMemory.toJSON().sessions.reduce((n,s)=>n+s.exposures.length,0)}
}
for(const text of ['这轮关闭记忆。','本轮不要读取记忆。','Do not retrieve memory this turn.'])test(`recall refuses before accessing memory: ${text}`,async t=>{
 const {api,exec,recall}=await fixture(t,text)
 let reads=0;api.maintenance.semanticRecall=()=>{reads++;return []};api.engine.recall=()=>{reads++;return []}
 for(const allProjects of [false,true])await assert.rejects(recall.execute({query:'orchard',allProjects},exec),/disabled/)
 assert.equal(reads,0)
})
for(const text of ['orchard query','本轮不要记录。',...inert])test(`allowed recall returns content: ${text}`,async t=>{
 const {api,exec,m,recall,exposures}=await fixture(t,text)
 api.maintenance.semanticRecall=async()=>[{id:m.id,score:1}]
 const result=await recall.execute({query:'orchard'},exec)
 assert.equal(result.found,1);assert.match(result.memories[0].text,/orchard fixture/)
 if(text==='本轮不要记录。')assert.equal(exposures(),0)
})
for(const text of ['这轮关闭记忆。','本轮不要读取记忆。'])test(`late refusal discards recalled content: ${text}`,async t=>{
 const {api,exec,session,m,recall,exposures}=await fixture(t,'orchard query')
 let resolve;api.maintenance.semanticRecall=()=>new Promise(r=>{resolve=r})
 const pending=recall.execute({query:'orchard'},exec)
 api.adapter._claimedInput.set(session.id,{turn:1,text});resolve([{id:m.id,score:1}])
 await assert.rejects(pending,/disabled/);assert.equal(exposures(),0)
})
test('sessionless compatibility recall retains configured scope and query behavior',async t=>{
 const {api,m,recall,exposures}=await fixture(t,'这轮关闭记忆。')
 let options;api.maintenance.semanticRecall=async(q,o)=>{assert.equal(q,'orchard');options=o;return[{id:m.id,score:1}]}
 const result=await recall.execute({query:'orchard'})
 assert.equal(result.found,1);assert.equal(options.scope,'p');assert.equal(exposures(),0)
})
