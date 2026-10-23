import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ExecutionExperienceCapture} from '../lib/execution-experience.js'
import {AutoExperienceLearning,ACTIVATION_INSTRUCTION,loadExperiencePolicy} from '../lib/experience-learning.js'
import {getActivationSandboxContract,evaluateActivationTask} from '../lib/activation-sandbox.js'
import {candidateFingerprint as hash} from '../lib/evaluation.js'
const scope='project:activation-chain-fixture',contract='a'.repeat(64)
const corpus=JSON.parse(readFileSync(new URL('../fixtures/activation-timing-corpus.json',import.meta.url)))
const tasks=corpus.tasks.filter(t=>t.split!=='development')
const rows=()=>[
 ['turn/start',{turn:1}],['user/message',{source:{kind:'user'},content:[{type:'file'}]}],
 ['tool/call',{turn:1,callId:'outer',name:'run_code',arguments:{code:'await tools.activate_tool_group({tools:["fixture_probe"]}); return await tools.fixture_probe({});'}}],
 ['tool/ptc-dispatch-start',{rootCallId:'outer',subCallId:'activate',name:'activate_tool_group',arguments:{tools:['fixture_probe']}}],
 ['tool/ptc-dispatch',{rootCallId:'outer',subCallId:'activate',name:'activate_tool_group',arguments:{tools:['fixture_probe']},isError:false,content:[{type:'text',text:JSON.stringify({availableOnNextStep:true,enabled:['fixture_probe']})}]}],
 ['tool/result',{turn:1,message:{toolCallId:'outer',isError:true,content:[{type:'text',text:'TypeError: tools.fixture_probe is not a function'}]}}],
 ['tool/call',{turn:1,callId:'repair',name:'run_code',arguments:{code:'return await tools.fixture_probe({});'}}],
 ['tool/ptc-dispatch-start',{rootCallId:'repair',subCallId:'target',name:'fixture_probe',arguments:{}}],
 ['tool/ptc-dispatch',{rootCallId:'repair',subCallId:'target',name:'fixture_probe',arguments:{},isError:false,content:[{type:'text',text:'SOURCE_PRIVATE_OUTPUT'}]}],
 ['tool/result',{turn:1,message:{toolCallId:'repair',isError:false,content:[{type:'text',text:'SOURCE_PRIVATE_OUTPUT'}]}}],['turn/end',{turn:1,reason:'completed'}],
].map(([type,data],seq)=>({type,data,seq}))
async function fixture(t,{maxCallsPerDay=128,modify=()=>{},onRequest=()=>{},beforeDispatch=()=>{},frozen=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'activation-auto-chain-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const native=rows();modify(native)
 const session={id:'activation-native',header:{cwd:'/fixture/activation-auto'},get seq(){return native.length},snapshotEvents:(a,b)=>native.filter(e=>e.seq>=a&&e.seq<b)}
 const capture=new ExecutionExperienceCapture({directory:join(dir,'capture'),enabled:true,contractFingerprint:contract,resolveOrigin:()=>({status:'verified',kind:'user',binding:{fixture:true}}),resolveSession:()=>session})
 await capture.capture(session,{scope})
 const fp=(await getActivationSandboxContract()).fingerprint
 const mechanism={id:'activation-v1',domain:'tool-activation-timing',scope:'invoking-project',risk:'low',contractFingerprint:contract,sandboxContractFingerprint:fp,corpusHash:hash(tasks),instruction:ACTIVATION_INSTRUCTION,queryTerms:['tool','激活'],match:{tools:['run_code'],origin:'any',outcome:'completed',minFailures:1},maxSteps:6,evaluationOnly:true,statisticallyIndependentTasksClaimed:false,tasks}
 const path=join(dir,'policy.json');writeFileSync(path,JSON.stringify({version:1,mechanisms:[mechanism]}))
 const counters=new Map();let calls=0
 const generate=Object.assign(async()=>{throw Error('Answer-only inference must not handle tool tasks')},{complete:async({metadata})=>{throw Error('Metadata must be passed through the trusted sandbox adapter')}})
 const complete=async request=>{
  calls++;await onRequest({native,calls,request});const {taskId,arm}=request.metadata,task=tasks.find(t=>t.id===taskId),i=task.input,key=taskId+':'+arm,n=counters.get(key)??0;counters.set(key,n+1)
  const result=answer=>({text:JSON.stringify({type:'final',answer})}),run=code=>({text:JSON.stringify({type:'run_code',code})})
  if(i.denyTarget)return result({status:'permission-denied'})
  if(i.initiallyActive)return n===0?run(`return await tools.${i.targetName}({});`):result(task.expected)
  if(n===0)return run(arm==='baseline'&&i.contractVisibility==='known'?`await tools.activate_tool_group({tools:["${i.targetName}"]}); return await tools.${i.targetName}({});`:`return await tools.activate_tool_group({tools:["${i.targetName}"]});`)
  if(n===1)return run(`return await tools.${i.targetName}({});`)
  return result(task.expected)
 }
 generate.complete=complete
 const learning=new AutoExperienceLearning({directory:join(dir,'learning'),capture,policyPath:path,generate,routeOf:()=>({provider:'fixture',model:'fixture'}),canWrite:()=>true,isFrozen:()=>frozen,maxCallsPerDay,activationSandbox:{contract:getActivationSandboxContract,evaluate:args=>evaluateActivationTask({...args,complete:async request=>{await beforeDispatch({native,capture,path});return args.complete(request)}})}})
 return {dir,native,session,capture,learning,path,mechanism,get calls(){return calls},consider:()=>learning.consider({scope,agent:{}})}
}
test('native activation evidence automatically runs actual sandbox pairs and preserves frozen insufficient-evidence verdict',async t=>{
 const f=await fixture(t);assert.equal(loadExperiencePolicy(f.path).mechanisms[0].domain,'tool-activation-timing')
 const before=f.capture.snapshot();await f.consider();const e=Object.values(f.learning.state.entries)[0]
 assert.equal(e.protocolHash,hash({version:2,domain:'tool-activation-timing',policyHash:e.policyHash,consumerContractFingerprint:e.contractFingerprint,sandboxContractFingerprint:e.sandboxContractFingerprint,corpusHash:e.corpusHash,environmentHash:e.environmentHash,inferenceBudget:{maxTokens:1600,timeoutMs:30000},maxSteps:6,evaluationOnly:true}));assert.equal(e.domain,'tool-activation-timing');assert.equal(e.sourceEvidence.status,'matched');assert.equal(e.sourceEvidence.repair.status,'observed')
 assert.equal(e.executionComplete,true);assert.equal(e.records.length,10);assert.equal(e.progress.recordedArms,20);assert.ok(f.calls>0&&f.calls<=120)
 assert.equal(e.metrics.baseline.successfulArms,10);assert.equal(e.metrics.candidate.successfulArms,10);assert.equal(e.metrics.successDelta,0)
 assert.equal(e.metrics.independentTaskN,0);assert.equal(e.metrics.baseline.timingErrors,7);assert.equal(e.metrics.candidate.timingErrors,0)
 for(const arm of ['baseline','candidate']){
  const totals=Object.fromEntries(['toolErrors','availabilityErrors','activationTimingErrors','repeatedTimingErrors'].map(k=>[k,e.records.reduce((n,r)=>n+(r[arm].observableTimingErrorLowerBound?.[k]??0),0)]))
  assert.deepEqual(e.metrics[arm].observableTimingErrorLowerBound,totals)
 }
 assert.equal(e.reason,'insufficient-benefit');assert.equal(e.verdict.pass,false);assert.equal(e.evaluationOnly,true)
 assert.equal((await f.learning.recall({scope,query:'tool activation',agent:{}})).length,0)
 const serialized=readFileSync(f.learning.path,'utf8');assert.equal(serialized.includes('SOURCE_PRIVATE_OUTPUT'),false)
 assert.deepEqual(f.capture.snapshot(),before)
 const count=f.calls;await f.consider();assert.equal(f.calls,count)
})
test('generic run_code errors do not trigger automatic activation evaluation',async t=>{
 const f=await fixture(t,{modify:r=>{r[5].data.message.content[0].text='Error: ordinary read failure'}});await f.consider()
 assert.equal(f.calls,0);assert.equal(Object.values(f.learning.state.entries)[0].reason,'unregistered-mechanism')
})
test('tool sandbox requires freeze and enough upfront inference budget',async t=>{
 for(const options of [{frozen:false},{maxCallsPerDay:8}]){
  const f=await fixture(t,options);await f.consider();assert.equal(f.calls,0)
  assert.ok(['frozen-evaluation-required','budget-exhausted'].includes(Object.values(f.learning.state.entries)[0].reason))
 }
})


test('source mutation stops at the next request boundary rather than spending the remaining batch',async t=>{
 const f=await fixture(t,{onRequest:({native,calls})=>{if(calls===1)native[1].data.content.push({type:'text',text:'changed source'})}})
 await f.consider();const e=Object.values(f.learning.state.entries)[0]
 assert.equal(f.calls,1);assert.equal(e.executionComplete,false);assert.equal(e.reason,'source-invalid')
})

test('a dispatched but interrupted task is exposed even without an arm result or matching cohort metadata',async t=>{
 const budget={maxTokens:3200,timeoutMs:60000},f=await fixture(t,{maxCallsPerDay:240,onRequest:({request})=>assert.deepEqual(request.inferenceBudget,budget)}),priorTasks=structuredClone(tasks).reverse().map(x=>({...x,id:'old-'+x.id,independentId:'old-'+x.independentId}))
 f.learning._put({id:'prior-interrupted',domain:'tool-activation-timing',status:'evaluating',scope,taskSetHash:hash(priorTasks),progress:{modelRequests:1,active:{taskId:priorTasks.find(x=>x.kind==='task').id,arm:'baseline',step:0}},records:[],frozenEvaluation:{tasks:priorTasks}})
 const policy=JSON.parse(readFileSync(f.path));policy.mechanisms[0].inferenceBudget=budget;policy.mechanisms[0].id='activation-v2-budget';writeFileSync(f.path,JSON.stringify(policy))
 const beforePrior=structuredClone(f.learning.state.entries['prior-interrupted']),day=new Date().toISOString().slice(0,10),reserved=structuredClone(f.learning.state);reserved.calls[day]=120;reserved.trials=1;reserved.alphaSpent=.005;f.learning._save(reserved)
 await f.consider();const e=Object.values(f.learning.state.entries).find(x=>x.id!=='prior-interrupted')
 assert.equal(e.executionComplete,true);assert.ok(f.calls>0);assert.equal(e.metrics.baseline.successfulArms,10);assert.equal(e.metrics.candidate.successfulArms,10);assert.deepEqual(f.learning.state.entries['prior-interrupted'],beforePrior);assert.equal(f.learning.state.calls[day],240);assert.equal(f.learning.state.trials,2);assert.deepEqual(e.frozenEvaluation.inferenceBudget,budget);assert.equal(e.frozenEvaluation.protocolHash,e.protocolHash)
 assert.equal(e.frozenEvaluation.mode,'regression-replay')
 assert.ok(e.exposedInputs.length>0)
})


test('final dispatch gate refuses policy changes after asynchronous sandbox preflight',async t=>{
 let once=false
 const f=await fixture(t,{beforeDispatch:({path})=>{if(!once){once=true;writeFileSync(path,readFileSync(path,'utf8')+' ')}}})
 await f.consider();assert.equal(f.calls,0);assert.equal(Object.values(f.learning.state.entries)[0].executionComplete,false)
})
test('human rejection after preflight blocks the next actual inference dispatch',async t=>{
 let once=false
 const f=await fixture(t,{beforeDispatch:async({capture})=>{if(!once){once=true;const c=capture.list({scope})[0];await capture.recordHumanReview(c.id,{scope,expectedPacketHash:c.reviewPacketHash,decision:'reject',receipt:{id:'fixture-real-host-review'}})}}})
 await f.consider();assert.equal(f.calls,0);assert.equal(Object.values(f.learning.state.entries)[0].reason,'source-invalid')
})

test('a trusted token-cap failure remains false while all twenty arms finish without retry or refund',async t=>{
 const budget={maxTokens:6400,timeoutMs:90000},seen=[]
 const f=await fixture(t,{maxCallsPerDay:360,onRequest:({request})=>{
  assert.deepEqual(request.inferenceBudget,budget);seen.push(request.metadata)
  if(request.metadata.taskId==='heldout-sum'&&request.metadata.arm==='candidate'&&request.metadata.step===0){
   const error=Object.assign(new Error('fixed token ceiling outcome'),{code:'SANDBOX_NON_NORMAL_FINISH'})
   error.inferenceDiagnostics={finishKind:'max-tokens',abortKind:null,failureCode:null,usage:{inputTokens:18,outputTokens:6400},configuredMaxTokens:6400,configuredTimeoutMs:90000};throw error
  }
 }})
 const policy=JSON.parse(readFileSync(f.path));policy.mechanisms[0].inferenceBudget=budget;policy.mechanisms[0].id='activation-r3-budget';writeFileSync(f.path,JSON.stringify(policy))
 const input=tasks[0].input,exposed=hash({operation:input.operation,data:input.data,initiallyActive:input.initiallyActive,denyTarget:input.denyTarget,contractVisibility:input.contractVisibility})
 f.learning._put({id:'r2-incomplete',domain:'tool-activation-timing',status:'needs-review',scope,evaluationOnly:true,reason:'incomplete-evaluation',exposedInputs:[exposed],records:[],progress:{modelRequests:51,active:null},frozenEvaluation:{tasks:structuredClone(tasks)}})
 const old=structuredClone(f.learning.state.entries['r2-incomplete']),day=new Date().toISOString().slice(0,10),reserved=structuredClone(f.learning.state);reserved.calls[day]=240;reserved.trials=2;reserved.alphaSpent=.01;f.learning._save(reserved)
 await f.consider();const e=Object.values(f.learning.state.entries).find(v=>v.id!=='r2-incomplete'),row=e.records.find(v=>v.id==='heldout-sum')
 assert.equal(e.executionComplete,true);assert.equal(e.progress.recordedArms,20);assert.equal(e.progress.plannedArms,20);assert.equal(e.progress.modelRequests,f.calls);assert.equal(e.progress.modelDispatches,f.calls);assert.ok(f.calls<=120)
 assert.equal(row.baselineSuccess,true);assert.equal(row.candidateSuccess,false);assert.equal(row.candidate.status,'model-token-budget-exhausted');assert.equal(row.candidate.error,undefined);assert.equal(row.error,undefined);assert.equal(row.candidate.requests.length,1);assert.equal(row.candidate.requests[0].status,'failed');assert.equal(row.candidate.requests[0].inferenceDiagnostics.finishKind,'max-tokens');assert.equal(row.candidate.receipt.requestsHash,hash(row.candidate.requests))
 assert.equal(seen.filter(v=>v.taskId==='heldout-sum'&&v.arm==='candidate').length,1)
 assert.equal(e.metrics.baseline.successfulArms,10);assert.equal(e.metrics.candidate.successfulArms,9);assert.equal(e.metrics.successDelta,-1/7);assert.equal(e.reason,'regression');assert.equal(e.verdict.pass,false);assert.equal(e.verdict.N,0);assert.equal(e.evaluationOnly,true);assert.equal(e.status,'needs-review');assert.equal(e.frozenEvaluation.mode,'regression-replay');assert.deepEqual(e.frozenEvaluation.inferenceBudget,budget)
 assert.equal(f.learning.state.calls[day],360);assert.deepEqual(f.learning.state.entries['r2-incomplete'],old);assert.equal((await f.learning.recall({scope,query:'tool activation',agent:{}})).length,0)
})
