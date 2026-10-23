import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {registerExecutionExperienceTools} from '../lib/execution-experience-tools.js'
import {DailyExperience} from '../lib/daily-experience.js'
import {DailyRecovery} from '../lib/daily-recovery.js'
import {dailyCardOutcome} from '../dsh-adapter.js'
import {candidateFingerprint as digest} from '../lib/evaluation.js'
const sandboxOptions=JSON.parse(process.env.MNEMO_TEST_SANDBOX_OPTIONS??'{}')
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
function toolFixture({allowInvocation=async()=>true,noteUse=async()=>({status:'recorded'})}={}){
 let tool,turn=1,plans=0
 const events=[{seq:0,type:'turn/start',data:{turn}},{seq:1,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'Inspect the input and verify the output'}]}}]
 const session={id:'daily-tools',header:{cwd:'/daily-tools'},get seq(){return events.length},snapshotEvents:(a,b)=>events.slice(a,b)},agent={session},controller=new AbortController()
 registerExecutionExperienceTools({register:v=>tool=v},{capture:null,dailyLearning:{noteUse},dailyRecovery:{plan:()=>{plans++;return {status:'plan-recorded'}}},recoveryState:()=>({turn,active:true}),allowInvocation,getSessions:()=>({get:()=>session}),assertWritable(){},lifetime:new AbortController()})
 const append=(type,data)=>events.push({seq:events.length,type,data})
 return {session,agent,controller,append,nextTurn:()=>{turn++},get plans(){return plans},call:action=>tool.execute({action,id:'card',steps:['Inspect input','Verify output'],change:'Inspect exact contract'},{agent,signal:controller.signal})}
}
const prohibitMemory=f=>f.append('user/message',{source:{kind:'user'},content:[{type:'text',text:'本轮不要读取或写入记忆'}]})
for(const action of ['use_daily','recovery_plan'])test(`${action} rejects same-turn consent change during final authorization`,async()=>{
 const entered=deferred(),release=deferred();let checks=0,uses=0,allowed=true
 const f=toolFixture({allowInvocation:async()=>{
  const granted=allowed
  if(++checks===2){entered.resolve();await release.promise}
  return granted
 },noteUse:async()=>{uses++;return {status:'recorded'}}})
 const pending=f.call(action);await entered.promise;allowed=false;prohibitMemory(f);release.resolve()
 await assert.rejects(pending,/changed/)
 assert.equal(checks,2);assert.equal(uses,0);assert.equal(f.plans,0)
})
test('actual daily adoption rejects stale same-turn permission at its final commit guard',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'daily-consent-commit-')),entered=deferred(),release=deferred()
 let checks=0,writes=0,allowed=true
 try{
  const capture={hasPendingWork:()=>false,isCandidateCurrent:()=>true}
  const daily=new DailyExperience({directory,sandboxOptions,enabled:true,capture,consumerFingerprint:'a'.repeat(64)})
  const f=toolFixture({allowInvocation:async()=>{
   const granted=allowed
   if(++checks===3){entered.resolve();await release.promise}
   return granted
  },noteUse:daily.noteUse.bind(daily)})
  const scope='project:/daily-tools',key=digest([f.session.id,'1'])
  const delivery={sessionHash:digest(f.session.id),turnHash:digest('1'),receiptHash:'b'.repeat(64)}
  daily.state.cards.card={state:'limited-use',scopeHash:digest(scope),receiptHash:delivery.receiptHash,candidateId:'fixture-source',deliveries:{[key]:delivery}}
  daily._current=async()=>null;daily._save=()=>{writes++;return true}
  const pending=f.call('use_daily');await entered.promise;allowed=false;prohibitMemory(f);release.resolve()
  const result=JSON.parse(await pending)
  assert.equal(checks,3);assert.notEqual(result.status,'recorded')
  assert.notEqual(delivery.used,true);assert.equal(writes,0)
 }finally{rmSync(directory,{recursive:true,force:true})}
})
test('ordinary tool progress during recovery authorization does not change human consent',async()=>{
 const entered=deferred(),release=deferred();let checks=0
 const f=toolFixture({allowInvocation:async()=>{if(++checks===2){entered.resolve();await release.promise}return true}})
 const pending=f.call('recovery_plan');await entered.promise
 f.append('tool/result',{message:{toolCallId:'fixture-progress',isError:false,content:[{type:'text',text:'Synthetic input inspection completed'}]}})
 release.resolve()
 assert.equal(JSON.parse(await pending).status,'plan-recorded');assert.equal(f.plans,1)
})
for(const action of ['use_daily','recovery_plan'])test(`${action} pins the turn before initial authorization await`,async()=>{
 const entered=deferred(),release=deferred();let uses=0
 const f=toolFixture({allowInvocation:async()=>{entered.resolve();await release.promise;return true},noteUse:async()=>{uses++;return {status:'recorded'}}})
 const pending=f.call(action);await entered.promise;f.nextTurn();release.resolve()
 await assert.rejects(pending,/changed/);assert.equal(uses,0);assert.equal(f.plans,0)
})
test('daily recovery rechecks cancellation after final authorization await',async()=>{
 const entered=deferred(),release=deferred();let calls=0
 const f=toolFixture({allowInvocation:async()=>{if(++calls===2){entered.resolve();await release.promise}return true}})
 const pending=f.call('recovery_plan');await entered.promise;f.controller.abort();release.resolve()
 await assert.rejects(pending,{name:'AbortError'});assert.equal(f.plans,0)
})
for(const mode of ['turn','cancel','withdraw'])test(`actual noteUse refuses ${mode} during its source verification await`,async()=>{
 const directory=mkdtempSync(join(tmpdir(),'daily-boundary-')),entered=deferred(),release=deferred();let allowed=true,writes=0
 try{
  const daily=new DailyExperience({directory,sandboxOptions,enabled:true,capture:{},consumerFingerprint:'a'.repeat(64)})
  const f=toolFixture({allowInvocation:async()=>allowed,noteUse:daily.noteUse.bind(daily)}),scope='project:/daily-tools',key=digest([f.session.id,'1'])
  const delivery={sessionHash:digest(f.session.id),turnHash:digest('1'),receiptHash:'b'.repeat(64)}
  daily.state.cards.card={state:'limited-use',scopeHash:digest(scope),receiptHash:'b'.repeat(64),deliveries:{[key]:delivery}}
  daily._current=async()=>{entered.resolve();await release.promise;return null}
  daily._save=()=>{writes++;return true}
  const pending=f.call('use_daily');await entered.promise
  if(mode==='turn')f.nextTurn();if(mode==='cancel')f.controller.abort();if(mode==='withdraw')allowed=false
  release.resolve();const result=JSON.parse(await pending)
  assert.notEqual(result.status,'recorded');assert.notEqual(delivery.used,true);assert.equal(writes,0)
 }finally{rmSync(directory,{recursive:true,force:true})}
})
const event=(seq,type,data)=>({seq,type,data})
const use=(seq=2)=>[
 event(seq,'tool/call',{name:'mnemo_experience',callId:'adopt',arguments:{action:'use_daily',id:'card'}}),
 event(seq+1,'tool/result',{message:{toolCallId:'adopt',isError:false,content:[{type:'text',text:'{"status":"recorded"}'}]}}),
]
const target=(seq,isError=false)=>[
 event(seq,'tool/ptc-dispatch-start',{name:'target',rootCallId:'invoke',subCallId:'target-call'}),
 event(seq+1,'tool/ptc-dispatch',{name:'target',rootCallId:'invoke',subCallId:'target-call',isError}),
]
test('native attribution ignores pre-adoption failure and only reads later actual target outcomes',()=>{
 const events=[...target(0,true),...use(2),...target(4,false)]
 assert.deepEqual(dailyCardOutcome(events,'card','target'),{related:true,failed:false})
 assert.deepEqual(dailyCardOutcome([...events,...target(6,true)],'card','target'),{related:true,failed:true})
 assert.deepEqual(dailyCardOutcome(events,'other-card','target'),{related:false,failed:false})
 const failedUse=use();failedUse[1].data.message.content[0].text='{"status":"unavailable"}'
 assert.deepEqual(dailyCardOutcome([...failedUse,...target(4,true)],'card','target'),{related:false,failed:false})
})
test('missing target failure requires matching later run_code invocation and exact native error text',()=>{
 const error=[event(4,'tool/call',{name:'run_code',callId:'outer',arguments:{code:'return await tools.target({});'}}),event(5,'tool/result',{message:{toolCallId:'outer',isError:true,content:[{type:'text',text:'TypeError: tools.target is not a function'}]}})]
 assert.deepEqual(dailyCardOutcome([...use(),...error],'card','target'),{related:true,failed:true})
 for(const mutate of [
  r=>{r[0].data.name='unrelated'},
  r=>{r[0].data.arguments.code='return console.log("tools.target is not a function");'},
  r=>{r[1].data.message.toolCallId='different'},
  r=>{r[1].data.message.content[0].text='Unrelated failure mentioning tools.target is not a function'},
  r=>{r[1].data.message.content[0]={type:'image',text:'TypeError: tools.target is not a function'}},
 ]){const changed=structuredClone(error);mutate(changed);assert.deepEqual(dailyCardOutcome([...use(),...changed],'card','target'),{related:false,failed:false})}
})
test('PTC adoption requires matching successful dispatch result and exact recorded status',()=>{
 const native=[event(0,'tool/ptc-dispatch-start',{name:'mnemo_experience',rootCallId:'r',subCallId:'adopt',arguments:{action:'use_daily',id:'card'}}),event(1,'tool/ptc-dispatch',{name:'mnemo_experience',rootCallId:'r',subCallId:'adopt',isError:false,content:[{type:'text',text:'{"status":"recorded"}'}]}),...target(2,true)]
 assert.deepEqual(dailyCardOutcome(native,'card','target'),{related:true,failed:true});native[1].data.rootCallId='wrong'
 assert.deepEqual(dailyCardOutcome(native,'card','target'),{related:false,failed:false})
})
test('plan normalization prevents whitespace from bypassing a required changed approach',()=>{
 const r=new DailyRecovery({enabled:true}),state={key:'task',active:true,failures:2,plan:{change:' Inspect contract '}}
 assert.throws(()=>r.plan(state,{steps:['inspect input','verify output'],change:'Inspect contract   '}),/different approach/)
 const changed=r.plan(state,{steps:[' inspect input ',' verify output '],change:' Reduce to a minimal probe '})
 assert.equal(changed.change,'Reduce to a minimal probe');assert.equal(changed.steps[0],'inspect input')
})
test('ordinary successful observations stay out of the daily review queue',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'daily-no-experience-')),scope='project:/successful'
 try{
  const candidates=[{id:'ordinary-success',observation:{toolFailureCount:0}},{id:'actual-error',observation:{toolFailureCount:1}}]
  const capture={hasPendingWork:()=>false,list:()=>candidates,validateCandidate:async()=>({status:'source-unavailable'})}
  const daily=new DailyExperience({directory,sandboxOptions,enabled:true,capture,consumerFingerprint:'a'.repeat(64)})
  const result=await daily.consider(scope)
  assert.equal(result.results[0].status,'not-experience');assert.equal(result.results[1].status,'needs-review')
  const status=daily.status({scope});assert.equal(status.needsReviewCount,1);assert.equal(status.limitedUseCount,0)
 }finally{rmSync(directory,{recursive:true,force:true})}
})
for(const mode of ['pending','invalidated'])test(`noteUse rechecks original candidate ${mode} after invocation guard`,async()=>{
 const directory=mkdtempSync(join(tmpdir(),'daily-source-commit-')),entered=deferred(),release=deferred();let pending=false,current=true,writes=0
 try{
  const scope='project:/source-commit',capture={hasPendingWork:()=>pending,isCandidateCurrent:()=>current}
  const daily=new DailyExperience({directory,sandboxOptions,enabled:true,capture,consumerFingerprint:'a'.repeat(64)}),key=digest(['invoking-other-session','1'])
  const d={sessionHash:digest('invoking-other-session'),turnHash:digest('1'),receiptHash:'b'.repeat(64)}
  daily.state.cards.card={state:'limited-use',scopeHash:digest(scope),receiptHash:d.receiptHash,candidateId:'original-different-session',deliveries:{[key]:d}}
  daily._current=async()=>null;daily._save=()=>{writes++}
  const guard=async()=>{entered.resolve();await release.promise;return true};guard.current=()=>true
  const result=daily.noteUse(scope,{cardId:'card',sessionId:'invoking-other-session',turnId:1,guard})
  await entered.promise;if(mode==='pending')pending=true;else current=false;release.resolve()
  assert.equal((await result).status,'source-changed');assert.notEqual(d.used,true);assert.equal(writes,0)
 }finally{rmSync(directory,{recursive:true,force:true})}
})
test('delivery rollback is token-bound and preserves prior same-turn accepted delivery and use',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'daily-delivery-rollback-')),scope='project:/delivery',capture={hasPendingWork:()=>false,isCandidateCurrent:()=>true}
 try{
  const daily=new DailyExperience({directory,sandboxOptions,enabled:true,capture,consumerFingerprint:'a'.repeat(64)}),key=digest(['session','1'])
  daily.state.cards.card={state:'limited-use',scopeHash:digest(scope),receiptHash:'b'.repeat(64),deliveries:{}}
  daily._current=async()=>null
  const args={cardId:'card',sessionId:'session',turnId:1}
  const first=await daily.noteDelivery(scope,args);assert.equal(first.status,'recorded');assert.equal(first.previous,null)
  assert.equal((await daily.noteUse(scope,args)).status,'recorded')
  const second=await daily.noteDelivery(scope,args);assert.equal(daily.state.cards.card.deliveries[key].used,true)
  assert.equal((await daily.revokeDelivery(scope,{...args,deliveryId:first.deliveryId})).status,'not-found')
  assert.equal((await daily.revokeDelivery(scope,{...args,...second})).status,'revoked')
  assert.equal(daily.state.cards.card.deliveries[key].deliveryId,first.deliveryId);assert.equal(daily.state.cards.card.deliveries[key].used,true)
  const fresh={...args,turnId:2},receipt=await daily.noteDelivery(scope,fresh)
  assert.equal((await daily.revokeDelivery(scope,{...fresh,...receipt})).status,'revoked');assert.equal(daily.state.cards.card.deliveries[digest(['session','2'])],undefined)
 }finally{rmSync(directory,{recursive:true,force:true})}
})
