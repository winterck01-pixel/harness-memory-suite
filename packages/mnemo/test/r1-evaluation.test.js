import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {MemoryEngine} from '../lib/engine.js'
import {Maintenance} from '../lib/maintenance.js'
import {revisionPreflight} from '../lib/evolution-readiness.js'
import {BOUNDARY_CASES,loadTaskCorpus} from '../lib/production-evaluation.js'
import {runTaskEvaluation} from '../lib/evaluation.js'
import {decideTask} from '../lib/gate.js'

function fixture(t,{n=0,diagnosticOnly=false,generated=false}={}) {
 t.mock.method(globalThis,'fetch',()=>{throw Error('Network forbidden in deterministic regression')})
 const dir=mkdtempSync(join(tmpdir(),'mnemo-r1-eval-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const e=new MemoryEngine({dir});e.setScope('A');e.start('r1')
 const item=e.remember({text:'orchard deployment remains unverified',scope:'A',source:'agent'})
 const tasks=[...structuredClone(BOUNDARY_CASES),...Array.from({length:n},(_,i)=>({id:'task-'+i,independentId:'sample-'+i,kind:'task',independenceBasis:'Operator-reviewed distinct workflow '+i,input:{question:'Return trusted answer '+i,trusted:{answer:i}},expected:{answer:i}}))]
 let corpusPath=null
 if(n||diagnosticOnly){corpusPath=join(dir,'corpus.json');writeFileSync(corpusPath,JSON.stringify({version:1,scope:'A',memoryIds:[item.id],diagnosticOnly,tasks}))}
 const job=e.queueRevision(item.id,{scope:'A',text:generated?null:'orchard deployment requires verification'}).item
 let calls=0
 const generate=async(_prompt,data,options)=>{calls++;assert.equal(options.isolated,true);assert.equal(Object.hasOwn(data,'expected'),false);return data.trusted?{answer:Object.values(data.trusted)[0]??'unknown'}:{text:'orchard deployment requires verification'}}
 const m=new Maintenance(e,generate,{corpusPath})
 return {e,item,job,m,tasks,corpusPath,get calls(){return calls}}
}

test('R1 force re-evaluation reports its full call budget; ordinary replay is free',async t=>{
 const f=fixture(t)
 assert.equal(revisionPreflight(f.e,f.job,{scope:'A'}).readiness.estimatedModelCallsUpperBound,8)
 await f.m.process(f.job,{scope:'A'})
 assert.equal(f.calls,8)
 const replay=await f.m.process(f.job,{scope:'A'})
 assert.equal(replay.deduplicated,true);assert.equal(f.calls,8)
 assert.equal(revisionPreflight(f.e,f.job,{scope:'A'}).readiness.estimatedModelCallsUpperBound,0)
 f.job.payload.force=true
 assert.equal(revisionPreflight(f.e,f.job,{scope:'A'}).readiness.estimatedModelCallsUpperBound,8)
 await f.m.process(f.job,{scope:'A'});assert.equal(f.calls,16)
})

test('R1 absent candidate budgets drafting plus paired calls',async t=>{
 const f=fixture(t,{generated:true})
 assert.equal(revisionPreflight(f.e,f.job,{scope:'A'}).readiness.estimatedModelCallsUpperBound,9)
 await f.m.process(f.job,{scope:'A'});assert.equal(f.calls,9)
})

for(const n of [0,1,59])test('R1 '+n+' task samples can evaluate but never apply',async t=>{
 const f=fixture(t,{n});f.e.cfg.eval.AUTO_PROMOTE=true;f.e.safety.frozen=false
 const pre=revisionPreflight(f.e,f.job,{scope:'A',corpusPath:f.corpusPath}).readiness
 assert.equal(pre.blockers.length,0)
 assert.ok(pre.promotionBlockers.includes(n===0?'diagnostic-corpus':'insufficient-task-cases'))
 const result=await f.m.process(f.job,{scope:'A'})
 assert.equal(f.calls,2*(n+4));assert.equal(result.report.verdict.action,'propose')
 assert.equal(f.e.log.items.get(f.item.id).versions.length,1)
})

test('R1 configured diagnosticOnly corpus retains marker and cannot promote with 610 successes',async t=>{
 const f=fixture(t,{n:610,diagnosticOnly:true});f.e.cfg.eval.AUTO_PROMOTE=true;f.e.safety.frozen=false
 assert.equal(loadTaskCorpus(f.corpusPath,{scope:'A',id:f.item.id}).diagnosticOnly,true)
 const result=await f.m.process(f.job,{scope:'A'})
 assert.equal(result.report.diagnosticOnly,true);assert.equal(result.report.verdict.action,'propose')
 assert.equal(f.e.log.items.get(f.item.id).versions.length,1)
})

test('R1 task evaluator rejects duplicate case content with fresh identities',async()=>{
 const tasks=structuredClone(BOUNDARY_CASES.slice(0,2));tasks[1].input=structuredClone(tasks[0].input);tasks[1].kind=tasks[0].kind
 await assert.rejects(runTaskEvaluation({candidate:{text:'a'},baseline:{text:'b'},tasks,execute:()=>{throw Error('must not execute')},judge:()=>true,scope:'A',revision:'v1'}),/duplicate/i)
})

test('R1 diagnostic marker independently prevents statistical gate promotion',async()=>{
 const candidate={text:'orchard verification required',cues:['orchard'],kind:'fact',source:'agent'},baseline={...candidate,text:'baseline'}
 const tasks=[...structuredClone(BOUNDARY_CASES),...Array.from({length:610},(_,i)=>({id:'t'+i,independentId:'i'+i,kind:'task',input:{question:'task '+i}}))]
 const evaluation=await runTaskEvaluation({candidate,baseline,tasks,execute:()=>({answer:1}),judge:()=>true,scope:'A',revision:'v1',diagnosticOnly:true})
 assert.equal(evaluation.diagnosticOnly,true)
 assert.equal(decideTask({candidate,evaluation,scope:'A',revision:'v1'}).action,'propose')
 assert.equal(decideTask({candidate,evaluation:{...evaluation,diagnosticOnly:false},scope:'A',revision:'v1'}).action,'promote')
})

for(const mutation of ['reject-proposal','edit-proposal','archive-source','confirm-source','dispute-source','revise-source','freeze','disable-auto','cancel','close'])test('R1 in-flight '+mutation+' never applies',async t=>{
 const f=fixture(t,{n:610});f.e.cfg.eval.AUTO_PROMOTE=true;f.e.safety.frozen=false
 const original=f.m.generate;let changed=false
 const controller=new AbortController()
 f.m.generate=async(...args)=>{
  if(!changed){changed=true
   if(mutation==='reject-proposal')f.e.log.append({kind:'proposal-reviewed',id:f.job.id,status:'rejected'})
   if(mutation==='edit-proposal')f.e.log.proposals.get(f.job.id).text='changed candidate'
   if(mutation==='archive-source')f.e.log.append({kind:'archive',id:f.item.id})
   if(mutation==='confirm-source')f.e.review(f.item.id,'confirmed',{scope:'A'})
   if(mutation==='dispute-source')f.e.review(f.item.id,'disputed',{scope:'A'})
   if(mutation==='revise-source')f.e.log.append({kind:'revise',id:f.item.id,text:'new source evidence'})
   if(mutation==='freeze')f.e.safety.frozen=true
   if(mutation==='disable-auto')f.e.cfg.eval.AUTO_PROMOTE=false
   if(mutation==='cancel')controller.abort()
   if(mutation==='close')f.m.closed=true
  }
  return original(...args)
 }
 let result
 try{result=await f.m.process(f.job,{scope:'A',signal:controller.signal})}catch(error){assert.match(error.message,/changed|withdrawn|bind|cancel|protected/i)}
 assert.notEqual(result?.status,'applied')
 assert.equal(f.e.log.items.get(f.item.id).versions.length,mutation==='revise-source'?2:1)
 if(['reject-proposal','edit-proposal','archive-source','confirm-source','dispute-source','revise-source','cancel','close'].includes(mutation))assert.equal(f.e.log.proposals.get(f.job.id).evaluationReport,undefined)
})


test('R1 direct engine diagnostic receipt cannot apply despite sufficient statistical samples',async t=>{
 const f=fixture(t,{n:610});f.e.cfg.eval.AUTO_PROMOTE=true;f.e.safety.frozen=false
 const receipt=await f.e.evaluateRevision(f.item.id,{text:'orchard verification required',tasks:f.tasks,execute:()=>({answer:1}),judge:()=>true,scope:'A',diagnosticOnly:true})
 assert.equal(receipt.evaluation.diagnosticOnly,true)
 assert.equal(f.e.gate(receipt.candidate,{receipt,scope:'A'}).action,'propose')
 assert.equal(f.e.applyEvaluatedRevision(f.item.id,{receipt,scope:'A'}).applied,false)
 assert.equal(f.e.log.items.get(f.item.id).versions.length,1)
})

test('R1 invalid or withdrawn sources are blocked with a zero paid-call estimate',async t=>{
 const f=fixture(t)
 f.e.review(f.item.id,'disputed',{scope:'A'})
 const pre=revisionPreflight(f.e,f.job,{scope:'A'}).readiness
 assert.ok(pre.blockers.length>0);assert.equal(pre.estimatedModelCallsUpperBound,0)
 await assert.rejects(f.m.process(f.job,{scope:'A'}),/source changed/i)
 assert.equal(f.calls,0)
})

test('R1 force is an explicit boolean and survives reconciliation until executed',async t=>{
 const f=fixture(t)
 await f.m.process(f.job,{scope:'A'})
 f.job.payload.force='false'
 assert.equal(revisionPreflight(f.e,f.job,{scope:'A'}).readiness.estimatedModelCallsUpperBound,0)
 assert.equal((await f.m.process(f.job,{scope:'A'})).deduplicated,true)
 assert.equal(f.calls,8)
 f.job.payload.force=true
 f.e.reconcileBacklog()
 assert.ok(f.e.backlog.items.some(job=>job.id===f.job.id))
 const outcome=await f.e.drainBacklog(job=>f.m.process(job,{scope:'A'}),{filter:job=>job.id===f.job.id})
 assert.equal(outcome.processed.length,1);assert.equal(f.calls,16)
 assert.equal(f.e.backlog.items.some(job=>job.id===f.job.id),false)
})
