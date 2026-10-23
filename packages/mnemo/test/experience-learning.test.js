import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {AutoExperienceLearning,experienceBenefit,loadExperiencePolicy} from '../lib/experience-learning.js'
import {candidateFingerprint as hash} from '../lib/evaluation.js'
const scope='project:fixture-learning',contract='a'.repeat(64)
const tasks=()=>Array.from({length:62},(_,i)=>({id:'case-'+i,independentId:'group-'+i,independenceBasis:'Independent synthetic question with a distinct executed input',kind:i===60?'probe':i===61?'regression':'task',input:{question:'Synthetic answer case '+i,data:{value:i}},expected:{answer:i}}))
const mechanism=()=>({id:'fixture-answer-recipe',domain:'answer-only',risk:'low',scope,contractFingerprint:contract,instruction:'Historical hint for answering synthetic fixture questions. No tool operations.',queryTerms:['synthetic'],match:{tools:['fixture_read'],origin:'schedule',outcome:'completed',minFailures:1},tasks:tasks()})
const rows=(mode='gain')=>tasks().map((t,i)=>({id:t.id,independentId:t.independentId,inputHash:hash(t.input),kind:t.kind,baselineSuccess:i>=60||mode==='tie'||mode==='loss'&&i===0,candidateSuccess:mode!=='loss'||i!==0}))
async function fixture(t,options={}){
 const dir=mkdtempSync(join(tmpdir(),'mnemo-auto-learning-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const path=join(dir,'policy.json');let policy={version:1,mechanisms:[mechanism()]};const save=()=>writeFileSync(path,JSON.stringify(policy));save()
 let valid=true,rejected=false,frozen=false,writable=true,time=Date.now(),calls=0,route={provider:'fixture-provider',model:'fixture-model'}
 const candidate={id:'candidate-fixture',reviewPacketHash:'b'.repeat(64),contractFingerprint:contract,origin:{kind:'schedule'},observation:{runtimeOutcome:'completed',toolFailureCount:1},applicability:{tools:['fixture_read']}}
 const capture={list:()=>[structuredClone(candidate)],validateCandidate:async()=>({status:valid?'verified':'source-conflict'}),isCandidateCurrent:()=>valid,inspect:()=>valid?{sourceValidation:'verified',...structuredClone(candidate),...(rejected?{review:{status:'rejected'}}:{})}:null}
 const base={directory:join(dir,'learning'),capture,policyPath:path,generate:async(_system,input)=>{calls++;return {answer:input.historicalExperience?input.data.value:-1}},routeOf:()=>route,isFrozen:()=>frozen,canWrite:()=>writable,now:()=>time,...options}
 let learning=new AutoExperienceLearning(base)
 return {dir,path,candidate,capture,base,get learning(){return learning},get calls(){return calls},policy:()=>policy,setPolicy:p=>{policy=p;save()},save,expire:()=>{time+=8*86400000},freeze:v=>{frozen=v},writable:v=>{writable=v},withdraw:()=>{valid=false},reject:()=>{rejected=true},setRoute:v=>{route=v},reload:()=>{learning=new AutoExperienceLearning(base);return learning},consider:()=>learning.consider({scope,agent:{}}),recall:(q='synthetic question',s=scope)=>learning.recall({scope:s,query:q,agent:{}})}
}
test('positive benefit is required; zero gain, tiny N, losses, bad guards, duplicate groups and incomplete rows cannot absorb',()=>{
 assert.equal(experienceBenefit(rows()).pass,true)
 assert.equal(experienceBenefit(rows('tie')).reason,'insufficient-benefit')
 assert.equal(experienceBenefit(rows('loss')).reason,'regression')
 const small=rows().filter((r,i)=>i<8||i>=60);assert.equal(experienceBenefit(small).pass,false)
 const bad=rows();bad.at(-1).candidateSuccess=false;assert.equal(experienceBenefit(bad).reason,'regression')
 const duplicate=rows();duplicate[1].independentId=duplicate[0].independentId;assert.equal(experienceBenefit(duplicate).reason,'incomplete-evaluation')
 const incomplete=rows();delete incomplete[0].candidateSuccess;assert.equal(experienceBenefit(incomplete).pass,false)
})
test('trusted execution -> actual evaluator boundary -> verified bank -> scoped recall, with no per-candidate human approval',async t=>{
 const f=await fixture(t);await f.consider();assert.equal(f.calls,124)
 const e=f.learning.report({scope}).entries[0];assert.equal(e.status,'verified');assert.equal(e.verdict.pass,true)
 assert.equal((await f.recall()).length,1);assert.equal((await f.recall('other question')).length,0);assert.equal((await f.recall('synthetic',scope+'-other')).length,0)
 await f.consider();assert.equal(f.calls,124)
 f.reload();assert.equal((await f.recall()).length,1);await f.consider();assert.equal(f.calls,124)
})
test('freeze permits isolated validation but blocks every production recall; no memory engine is required',async t=>{
 const f=await fixture(t);f.freeze(true);await f.consider();assert.equal(f.learning.report({scope}).entries[0].status,'verified');assert.equal((await f.recall()).length,0);assert.equal(f.learning.report({scope}).frozen,true)
 assert.equal(readFileSync(join(f.dir,'learning','auto-experience.json'),'utf8').includes('approved-for-frozen-evaluation'),false)
})
test('unknown mechanisms queue silently without model calls; tool-operation policies cannot masquerade as answer-only validators',async t=>{
 const f=await fixture(t);f.setPolicy({version:1,mechanisms:[]});await f.consider();assert.equal(f.calls,0);assert.equal(f.learning.report({scope}).entries[0].reason,'unregistered-mechanism')
 const m=mechanism();m.domain='tool-procedure';f.setPolicy({version:1,mechanisms:[m]});assert.throws(()=>loadExperiencePolicy(f.path),/Invalid low-risk/);await f.consider();assert.equal(f.calls,0)
})
test('provider failure remains incomplete, retains reservation, and is never retried into a favorable result',async t=>{
 let calls=0;const f=await fixture(t,{generate:async()=>{calls++;throw Error('quota exhausted')}});await f.consider();assert.equal(calls,1)
 const e=f.learning.report({scope}).entries[0];assert.equal(e.status,'needs-review');assert.equal(e.reason,'incomplete-evaluation')
 f.reload();await f.consider();assert.equal(calls,1);assert.equal(f.learning.state.calls[Object.keys(f.learning.state.calls)[0]],124)
})
test('missing budget defers without any model call, and read-only prevents writes',async t=>{
 const f=await fixture(t,{maxCallsPerDay:2});await f.consider();assert.equal(f.calls,0);assert.equal(f.learning.report({scope}).entries[0].reason,'budget-exhausted');assert.equal(f.learning.state.trials,0)
 f.writable(false);const before=readFileSync(f.learning.path,'utf8');await f.consider();assert.equal(readFileSync(f.learning.path,'utf8'),before)
})
test('source withdrawal, rejection, route drift, policy drift, and expiry each immediately prevent recall',async t=>{
 for(const mode of ['withdraw','reject','route','policy','expiry']){
  const f=await fixture(t);await f.consider();assert.equal((await f.recall()).length,1)
  if(mode==='withdraw')f.withdraw();if(mode==='reject')f.reject();if(mode==='route')f.setRoute({provider:'different',model:'different'});if(mode==='policy'){const m=mechanism();m.instruction+=' revised';f.setPolicy({version:1,mechanisms:[m]})}if(mode==='expiry')f.expire()
  assert.equal((await f.recall()).length,0,mode)
 }
})
test('source or environment change during evaluation cannot grant verified status',async t=>{
 let revoke=()=>{};const f=await fixture(t,{generate:async(_s,input)=>{revoke();return {answer:input.historicalExperience?input.data.value:-1}}});revoke=f.withdraw
 await f.consider();assert.equal(f.learning.report({scope}).entries[0].reason,'source-invalid');assert.equal((await f.recall()).length,0)
})
test('a delivered experience is suspended on a subsequent runtime regression; success never counts as causal evidence',async t=>{
 const f=await fixture(t);await f.consider();const id=(await f.recall())[0].id
 f.learning.noteDelivery({sessionId:'fixture',turn:1,ids:[id]});await f.learning.noteOutcome({sessionId:'fixture',turn:1,failed:true})
 assert.equal(f.learning.report({scope}).entries[0].status,'suspended');assert.equal((await f.recall()).length,0)
 await f.consider();assert.equal(f.calls,124)
})
test('operator corpus validation rejects duplicate inputs and missing guard tasks',async t=>{
 const f=await fixture(t),m=mechanism();m.tasks[1].input=m.tasks[0].input;f.setPolicy({version:1,mechanisms:[m]});assert.throws(()=>loadExperiencePolicy(f.path),/duplicate/)
 const noGuards=mechanism();noGuards.tasks=noGuards.tasks.slice(0,60);f.setPolicy({version:1,mechanisms:[noGuards]});assert.throws(()=>loadExperiencePolicy(f.path),/Missing guard/)
})
test('sealed evidence cannot be edited into verified status on restart',async t=>{
 const f=await fixture(t);await f.consider();const s=JSON.parse(readFileSync(f.learning.path));Object.values(s.entries)[0].instruction='modified';writeFileSync(f.learning.path,JSON.stringify(s));assert.throws(()=>f.reload(),/Invalid learning entry/)
})
test('hypothesis and alpha-spending budgets survive restart and policy changes',async t=>{
 const f=await fixture(t,{maxHypotheses:1});await f.consider();assert.equal(f.learning.state.trials,1);assert.equal(f.learning.state.alphaSpent,.05)
 const m=mechanism();m.instruction+=' new candidate';f.setPolicy({version:1,mechanisms:[m]});f.reload();await f.consider();assert.equal(f.calls,124);assert.equal(f.learning.report({scope}).entries.at(-1).reason,'hypothesis-budget-exhausted')
})
test('interrupted persisted evaluation is not silently retried',async t=>{
 const f=await fixture(t);await f.consider();const s=structuredClone(f.learning.state),e=Object.values(s.entries)[0];e.status='evaluating';delete e.seal;e.seal=hash(e);writeFileSync(f.learning.path,JSON.stringify(s));f.reload();await f.consider();assert.equal(f.calls,124);assert.equal(f.learning.report({scope}).entries[0].reason,'interrupted')
})

test('runtime failure disables all delivered cards immediately while another evaluation holds the queue',async t=>{
 const f=await fixture(t);await f.consider();const id=(await f.recall())[0].id
 f.learning.noteDelivery({sessionId:'fixture',turn:9,ids:[id]})
 f.learning.noteDelivery({sessionId:'fixture',turn:9,ids:['other-card']})
 let release,enter;const started=new Promise(r=>enter=r),blocked=new Promise(r=>release=r)
 f.learning._serial(async()=>{enter();await blocked});await started
 const pending=f.learning.noteOutcome({sessionId:'fixture',turn:9,failed:true})
 try{assert.equal((await f.recall()).length,0);assert.equal(f.learning.state.entries[id].status,'suspended')}
 finally{release();await pending;await f.learning.idle()}
})

test('model self-assessments cannot replace exact task execution oracles',async t=>{
 const f=await fixture(t,{generate:async()=>({useful:true,passed:true,score:1})});await f.consider()
 const e=f.learning.report({scope}).entries[0];assert.equal(e.status,'needs-review');assert.equal(e.verdict.pass,false);assert.equal((await f.recall()).length,0)
})

test('production model adapter keeps paired calls isolated, tool-free and judged without revealing expected answers',async t=>{
 const {modelGenerator}=await import('../lib/model-client.js'),requests=[]
 const services={agentDefaultModel:{currentSelection:()=>({provider:'fixture-provider',model:'fixture-model'})},llm:{async *stream(request){
  requests.push(request);const input=JSON.parse(request.messages[0].content[0].text).data
  yield {type:'text-delta',index:0,text:JSON.stringify({answer:input.historicalExperience?input.data.value:-1})}
  yield {type:'finish',reason:{kind:'stop'}}
 }}}
 const generate=modelGenerator({get:k=>services[k]}),f=await fixture(t,{generate})
 await f.consider();assert.equal(f.learning.report({scope}).entries[0].status,'verified');assert.equal(requests.length,124)
 assert.equal(new Set(requests.map(r=>r.sessionId)).size,124)
 for(const r of requests){assert.deepEqual(r.tools,[]);assert.equal(r.provider,'fixture-provider');assert.equal(r.model,'fixture-model');assert.equal(JSON.stringify(r.messages).includes('expected'),false)}
})
test('an evaluation crossing its reserved UTC day stops before further provider dispatch',async t=>{
 let advance=()=>{},calls=0;const f=await fixture(t,{generate:async(_s,input)=>{calls++;advance();return {answer:input.historicalExperience?input.data.value:-1}}});advance=f.expire
 await f.consider();assert.equal(calls,1);assert.equal(f.learning.report({scope}).entries[0].reason,'incomplete-evaluation')
})
test('final synchronous eligibility rejects policy changes and native changes after asynchronous recall',async t=>{
 const f=await fixture(t);await f.consider();const cards=await f.recall();assert.equal(cards.length,1)
 assert.equal(f.learning.deliveryEligible(cards,{scope,query:'synthetic',agent:{}}),true)
 f.capture.isCandidateCurrent=()=>false
 assert.equal(f.learning.deliveryEligible(cards,{scope,query:'synthetic',agent:{}}),false)
})
