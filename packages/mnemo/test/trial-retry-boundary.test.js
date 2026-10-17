import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {MemoryEngine} from '../lib/engine.js'
import {DshAdapter} from '../dsh-adapter.js'
import {TaskMemoryLedger} from '../lib/task-memory-ledger.js'

function fixture(t,{size=1200,reason='error'}={}) {
 const dir=mkdtempSync(join(tmpdir(),'mnemo-trial-retry-'))
 const e=new MemoryEngine({dir});e.setScope('p');e.start('s')
 const a=new DshAdapter(e,{settleEveryTurns:0,settleMinIntervalMin:0});a._turnIds.set('s',1)
 t.after(()=>{a.detach();rmSync(dir,{recursive:true,force:true})})
 const answer='Synthetic orchard response '.padEnd(size,'x')
 const events=[{type:'turn/start',seq:0,data:{turn:1}},
  {type:'user/message',seq:1,time:100,data:{source:{kind:'user'},content:[{type:'text',text:'Synthetic orchard deployment constraint 8443'}]}},
  {type:'assistant/message',seq:2,time:101,data:{turn:1,message:{content:[{type:'reasoning',text:'PRIVATE_REASONING'},{type:'text',text:answer}]}}}]
 const run=()=>a._onTurnEnd('s','p',{data:{turn:1,reason}},events)
 const trials=()=>e.taskMemory.toJSON().sessions.flatMap(s=>s.trials)
 return {e,a,run,trials,answer}
}
function assertCaptured(x,{failed=true}={}) {
 assert.equal(x.e.staging.pending.filter(p=>p.source==='human').length,1)
 assert.equal(x.e.staging.pending.filter(p=>p.source==='agent').length,failed?0:1)
 assert.equal(x.trials().length,failed?1:0)
 assert.equal(JSON.stringify(x.e.taskMemory.toJSON()).includes('PRIVATE_REASONING'),false)
}
for(const size of [100000,100001,250001])test(`failed visible answer of ${size} characters becomes one bounded trial`,t=>{
 const x=fixture(t,{size});x.run();x.run();assertCaptured(x)
 assert.equal(x.trials()[0].text,x.answer.slice(0,1000))
})
test('the host trial boundary bounds strings while the ledger retains strict validation',t=>{
 const x=fixture(t);x.e.noteTaskRuntimeOutcome({session:'s',scope:'p',turn:1,failed:true})
 x.e.recordTaskTrial({session:'s',scope:'p',turn:1,text:'x'.repeat(100001),eventRef:'host'})
 assert.equal(x.trials()[0].text.length,1000)
 assert.throws(()=>x.e.recordTaskTrial({session:'s',scope:'p',turn:1,text:{slice:()=> 'x'},eventRef:'invalid'}))
 const l=new TaskMemoryLedger();l.expose({session:'s',scope:'p',turn:'1',items:[]})
 assert.throws(()=>l.trial({session:'s',scope:'p',turn:'1',text:'x'.repeat(100001),eventRef:'raw'}))
 assert.equal(l.status({session:'s',scope:'p'}).trialCount,0)
})
for(const phase of ['before-write','after-checkpoint'])test(`failed trial retries after ${phase} without losing or duplicating the assistant`,t=>{
 const x=fixture(t);let once=true
 if(phase==='before-write') {
  const original=x.e.taskMemory.trial.bind(x.e.taskMemory)
  x.e.taskMemory.trial=args=>{if(once){once=false;throw Error('temporary trial failure')}return original(args)}
 } else {
  const record=x.e.recordTaskTrial.bind(x.e),checkpoint=x.e.checkpoint.bind(x.e)
  let inTrial=false
  x.e.recordTaskTrial=args=>{inTrial=true;try{return record(args)}finally{inTrial=false}}
  x.e.checkpoint=()=>{const out=checkpoint();if(inTrial&&once){once=false;throw Error('temporary trial failure')}return out}
 }
 assert.throws(x.run,/temporary trial failure/)
 assert.equal(x.a._captureProgress.get(JSON.stringify(['s',1])).assistantSeqs.has(2),false)
 x.run();x.run();assertCaptured(x)
 assert.equal(x.trials()[0].text,x.answer.slice(0,1000))
})
for(const phase of ['before-write','after-checkpoint'])test(`successful assistant retries after ${phase} using its original captureKey`,t=>{
 const x=fixture(t,{reason:'completed'});let once=true
 if(phase==='before-write') {
  const original=x.e.postTurn.bind(x.e)
  x.e.postTurn=args=>{if(once){once=false;throw Error('temporary post failure')}return original(args)}
 } else {
  const post=x.e.postTurn.bind(x.e),checkpoint=x.e.checkpoint.bind(x.e)
  let inPost=false
  x.e.postTurn=args=>{inPost=true;try{return post(args)}finally{inPost=false}}
  x.e.checkpoint=()=>{const out=checkpoint();if(inPost&&once){once=false;throw Error('temporary post failure')}return out}
 }
 assert.throws(x.run,/temporary post failure/)
 assert.equal(x.a._captureProgress.get(JSON.stringify(['s',1])).assistantSeqs.has(2),false)
 x.run();x.run();assertCaptured(x,{failed:false})
 const key=JSON.stringify(['s',1,'assistant',2])
 assert.equal(x.e.captureReceipts.has(key),true)
 assert.equal(x.e.staging.captureKeys.has(key),true)
 assert.equal(x.e.staging.pending.filter(p=>p.text===x.answer).length,1)
})
test('explicitly skipped reasoning-only assistant is marked processed without a trial',t=>{
 const x=fixture(t)
 const events=[{type:'turn/start',seq:0,data:{turn:1}},{type:'user/message',seq:1,data:{source:{kind:'user'},content:[{type:'text',text:'orchard deployment request'}]}},{type:'assistant/message',seq:2,data:{message:{content:[{type:'reasoning',text:'PRIVATE_REASONING'}]}}}]
 x.a._onTurnEnd('s','p',{data:{turn:1,reason:'error'}},events)
 assert.equal(x.trials().length,0);assert.equal(x.e.staging.pending.filter(p=>p.source==='agent').length,0)
 assert.equal(x.e.staging.pending.filter(p=>p.source==='human').length,1)
})
test('real event dispatch retry freezes failure streak when runtime outcome checkpoint throws',t=>{
 const x=fixture(t);x.a.captureRetries.delays=[]
 const session={id:'s',header:{cwd:'/synthetic-project'},seq:0}
 let seq=0
 const emit=(type,data)=>{const event={type,data,seq:seq++};session.seq=seq;return x.a.handleSessionEvent({},session,event)}
 emit('turn/start',{turn:1})
 emit('user/message',{source:{kind:'user'},content:[{type:'text',text:'Synthetic orchard deployment constraint 8443'}]})
 emit('assistant/message',{turn:1,message:{content:[{type:'text',text:x.answer}]}})
 const original=x.e.noteTaskRuntimeOutcome.bind(x.e);let once=true
 x.e.noteTaskRuntimeOutcome=args=>{const out=original(args);if(once){once=false;throw Error('temporary outcome checkpoint failure')}return out}
 const result=emit('turn/end',{turn:1,reason:'error'})
 assert.equal(x.a.captureRetries.report().failed.length,1)
 assert.equal(x.a._failStreak.get('s'),1)
 x.a.captureRetries.retryFailed(result.scope)
 assert.equal(x.a.captureRetries.report().failed.length,0)
 assert.equal(x.a._failStreak.get('s'),1)
 assertCaptured(x)
})
