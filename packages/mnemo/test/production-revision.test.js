import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {MemoryEngine} from '../lib/engine.js'
import {Maintenance} from '../lib/maintenance.js'
import {modelGenerator} from '../lib/model-client.js'
import {loadTaskCorpus} from '../lib/production-evaluation.js'
import {apply} from '../index.js'

function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'mnemo-production-revision-'))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const e=new MemoryEngine({dir});e.setScope('A');e.start('audit')
 const item=e.remember({text:'orchard deployment is not yet verified',scope:'A',source:'agent'})
 return {dir,e,item}
}
function harness() {
 const calls=[]
 const ctx={get:name=>name==='agentDefaultModel'?{currentSelection:()=>({provider:'fallback',model:'fallback'})}:name==='llm'?{stream:async function*(request){
  calls.push(request)
  const data=JSON.parse(request.messages[0].content[0].text).data
  const values=Object.values(data.trusted)
  yield {type:'text-delta',index:0,text:JSON.stringify({answer:values[0]??'unknown'})}
  yield {type:'finish',reason:{kind:'stop'}}
 }}:null}
 return {generate:modelGenerator(ctx),calls}
}

test('negative-task candidate work survives restart without model calls on the hot path',t=>{
 const {dir,e,item}=fixture(t)
 const out=e.taskEnd({text:'orchard reported success but the task failed; verify before claiming success',affect:-1,scope:'A',usedItemIds:[item.id]})
 assert.equal(out.revised[0].action,'queued')
 const reopened=new MemoryEngine({dir});reopened.start('again')
 const job=reopened.backlog.items.find(j=>j.kind==='revision-evaluate')
 assert.equal(job.payload.ids[0],item.id)
 assert.match(job.payload.failure,/task failed/)
 assert.equal(reopened.log.items.get(item.id).text,'orchard deployment is not yet verified')
})

test('production maintenance really streams isolated paired tasks and saves insufficient evidence',async t=>{
 const {dir,e,item}=fixture(t), {generate,calls}=harness()
 const m=new Maintenance(e,generate)
 const queued=e.queueRevision(item.id,{scope:'A',text:'orchard deployment requires current verification'})
 const route={options:{provider:'stale',model:'old'},session:{requestHeader:()=>({config:{provider:'live',model:'current'}})},id:'parent'}
 const result=await e.drainBacklog(job=>m.process(job,{scope:'A',agent:route}),{filter:j=>j.id===queued.item.id})
 assert.equal(result.failed.length,0)
 assert.equal(calls.length,8)
 assert.ok(calls.every(r=>r.provider==='live'&&r.model==='current'&&r.tools.length===0&&r.sessionId!=='parent'))
 assert.equal(new Set(calls.map(r=>r.sessionId)).size,8)
 assert.ok(calls.every(r=>!Object.hasOwn(JSON.parse(r.messages[0].content[0].text).data,'expected')))
 const proposal=e.log.proposals.get(queued.item.id)
 assert.equal(proposal.proposalKind,'revision-evaluate')
 assert.equal(proposal.evaluationReport.taskN,0)
 assert.equal(proposal.evaluationReport.verdict.action,'propose')
 assert.match(proposal.evaluationReport.verdict.note,/样本|冻结|未启用/)
 assert.equal(e.evalReport().lastEvaluation.proposalId,proposal.id)
 assert.throws(()=>e.acceptProposal(proposal.id,{scope:'A'}),/statistical|评测/i)
 const replay=new MemoryEngine({dir});replay.start('replay')
 assert.equal(replay.log.proposals.get(proposal.id).evaluationReport.records.length,4)
 assert.equal(replay.log.items.get(item.id).text,'orchard deployment is not yet verified')
})

test('corpus is operator-bound, answer keys are checked locally and task groups need a basis',t=>{
 const {dir,item}=fixture(t),path=join(dir,'corpus.json')
 const corpus={version:1,scope:'A',memoryIds:[item.id],tasks:[
  {id:'real-task',independentId:'group',kind:'task',input:{question:'Return 7.',trusted:{}},expected:{answer:7}},
  {id:'r',independentId:'r',kind:'regression',input:{question:'Return 8.'},expected:{answer:8}},
  {id:'p',independentId:'p',kind:'probe',input:{question:'Return unknown.'},expected:{answer:'unknown'}},
 ]}
 writeFileSync(path,JSON.stringify(corpus))
 assert.throws(()=>loadTaskCorpus(path,{scope:'B',id:item.id}),/bind/)
 assert.throws(()=>loadTaskCorpus(path,{scope:'A',id:item.id}),/independenceBasis/)
 corpus.tasks[0].independenceBasis='Different operator-reviewed task sampled from a separate completed project workflow.'
 writeFileSync(path,JSON.stringify(corpus))
 assert.equal(loadTaskCorpus(path,{scope:'A',id:item.id}).taskN,1)
})

test('provider failure retains a durable candidate and retry job, never creates success evidence',async t=>{
 const {e,item}=fixture(t)
 const m=new Maintenance(e,async()=>{throw Error('provider unavailable')})
 const queued=e.queueRevision(item.id,{scope:'A',text:'orchard verify before reporting deployment'})
 const result=await e.drainBacklog(job=>m.process(job,{scope:'A'}),{filter:j=>j.id===queued.item.id})
 assert.equal(result.failed.length,1)
 assert.equal(e.backlog.items[0].id,queued.item.id)
 e.reconcileBacklog()
 assert.equal(e.backlog.items[0]?.id,queued.item.id,'partial evaluation must not be treated as a durable completion receipt')
 assert.ok(e.log.proposals.get(queued.item.id).evaluationReport.records.every(r=>r.baselineError&&r.candidateError))
 assert.equal(e.log.items.get(item.id).versions.length,1)
})

test('failure capture skips sources which became protected or archived',t=>{
 const {e,item}=fixture(t)
 e.log.append({kind:'archive',id:item.id})
 const rule=e.remember({text:'orchard legacy unpinned agent rule',scope:'A',source:'agent',kind:'rule'})
 assert.doesNotThrow(()=>e.taskEnd({text:'orchard operation failed',affect:-1,scope:'A',usedItemIds:[item.id,rule.id]}))
 assert.equal(e.backlog.items.filter(j=>j.kind==='revision-evaluate').length,0)
})

test('changing checker metadata or ignored input fields cannot inflate real task samples',t=>{
 const {dir,item}=fixture(t),path=join(dir,'duplicates.json')
 const tasks=Array.from({length:3},(_,i)=>({id:'t'+i,independentId:'i'+i,independenceBasis:'Unique reviewer description number '+i,
  kind:'task',input:{question:'Return exact trusted value.',trusted:{value:7}},expected:{answer:7}}))
 const corpus={version:1,scope:'A',memoryIds:[item.id],tasks}
 writeFileSync(path,JSON.stringify(corpus))
 assert.throws(()=>loadTaskCorpus(path,{scope:'A',id:item.id}),/Duplicate executed task/)
 tasks.forEach((task,i)=>{task.input.nonce=i})
 writeFileSync(path,JSON.stringify(corpus))
 assert.throws(()=>loadTaskCorpus(path,{scope:'A',id:item.id}),/Unknown task input/)
})

test('withdrawn proposal cannot be revived by an in-flight evaluation report',async t=>{
 const {e,item}=fixture(t), {generate}=harness()
 let job,first=true
 const m=new Maintenance(e,async(...args)=>{
   if(first){first=false;e.log.append({kind:'proposal-reviewed',id:job.id,status:'rejected'})}
   return generate(...args)
 })
 job=e.queueRevision(item.id,{scope:'A',text:'orchard state requires verification'}).item
 const result=await e.drainBacklog(j=>m.process(j,{scope:'A'}),{filter:j=>j.id===job.id})
 assert.equal(result.failed.length,1)
 assert.equal(e.log.proposals.get(job.id).status,'rejected')
 assert.equal(e.log.proposals.get(job.id).evaluationReport,undefined)
 assert.equal(e.log.items.get(item.id).versions.length,1)
})

test('registered evaluate command reaches production model service and can retry its durable proposal',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-eval-command-')), {calls}=harness()
 let command
 const provided={},services={commands:{register:c=>{command=c}},sandboxPolicy:{workspaceRoot:'/tmp/mnemo-eval-command'},agentDefaultModel:{currentSelection:()=>({provider:'p',model:'m'})},
 llm:{stream:async function*(request){
   calls.push(request)
   const data=JSON.parse(request.messages[0].content[0].text).data
   yield {type:'text-delta',index:0,text:JSON.stringify({answer:Object.values(data.trusted)[0]??'unknown'})}
   yield {type:'finish',reason:{kind:'stop'}}
 }}}
 await apply({get:n=>provided[n]??services[n],provide:(n,v)=>provided[n]=v,effect:f=>f(),on:()=>()=>{},logger:{info(){}}},{dir,verbose:false,injectMode:'off'})
 t.after(async()=>{try{await provided.mnemo.detach()}finally{rmSync(dir,{recursive:true,force:true})}})
 const scope='project:/tmp/mnemo-eval-command',e=provided.mnemo.engine
 const source=e.remember({text:'orchard verification pending',scope,source:'agent'})
 const agent={id:'command-parent',session:{id:'command-parent',header:{cwd:'/tmp/mnemo-eval-command'}}}
 const result=await command.handler({rawInput:'evaluate '+source.id+' orchard verification remains pending',agent})
 assert.equal(result.kind,'success',result.text)
 const proposal=JSON.parse(result.text).processed[0].outcome.proposalId
 assert.equal(calls.length,8)
 const again=await command.handler({rawInput:'evaluate '+proposal,agent})
 assert.equal(again.kind,'success',again.text)
 assert.equal(calls.length,16)
 assert.equal(e.log.items.get(source.id).versions.length,1)
})
