import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DshAdapter} from '../dsh-adapter.js'
import {currentTurnEvents,captureDisabled} from '../lib/turn-capture.js'
const user=(text,seq=1)=>({type:'user/message',seq,time:100,data:{source:{kind:'user'},content:[{type:'text',text}]}})
const assistant={type:'assistant/message',seq:2,time:101,data:{turn:1,message:{content:[{type:'text',text:'response private'}]}}}
function setup(events){const posts=[],ends=[];const engine={postTurn:p=>posts.push(p),taskEnd(p){ends.push(p);return {}}};const a=new DshAdapter(engine,{settleEveryTurns:0,settleMinIntervalMin:0});return {a,posts,ends,session:{id:'s',seq:events.length,snapshotEvents:(f,t)=>events.slice(f,t)}}}
test('background turn cannot recapture a previous claimed human input',()=>{
 const x=setup([{type:'turn/start',data:{turn:2}}]);x.a._noteClaimed({agent:{id:'s'},turn:1,message:user('old request').data});x.a._onTurnEnd('s','p',{data:{turn:2,reason:'completed'}},x.session);assert.equal(x.ends.length,0);assert.equal(x.posts.length,0)
})
test('late turn opt-out suppresses both user and earlier assistant capture',()=>{
 const x=setup([{type:'turn/start',data:{turn:1}},user('hello'),assistant,user('本轮不要写入记忆',3)]);x.a._onAssistant('s','p',assistant);assert.equal(x.posts.length,0);x.a._onTurnEnd('s','p',{data:{turn:1,reason:'completed'}},x.session);assert.equal(x.ends.length,0);assert.equal(x.posts.length,0)
})
test('ordinary turn captures user and assistant once at completion',()=>{
 const x=setup([{type:'turn/start',data:{turn:1}},user('remember orchard'),assistant]);x.a._onAssistant('s','p',assistant);x.a._onTurnEnd('s','p',{data:{turn:1,reason:'completed'}},x.session);assert.equal(x.ends.length,1);assert.equal(x.posts.length,1);assert.equal(x.ends[0].text,'remember orchard')
})
test('reader stops at turn boundary in a long session',()=>{
 const calls=[];const session={seq:100000,snapshotEvents(f,t){calls.push([f,t]);return Array.from({length:t-f},(_,i)=>({seq:f+i,type:f+i===99990?'turn/start':'tool/result',data:{turn:4}}))}}
 assert.equal(currentTurnEvents(session,4).length,10);assert.equal(calls.length,1);assert.equal(calls[0][0],99872)
})
test('opt-out phrases are explicit and scoped to capture',()=>{
 for(const t of ['本轮不要写入记忆','不要保存到长期记忆','Do not write to memory','Don\'t remember this'])assert.equal(captureDisabled(t),true)
 assert.equal(captureDisabled('帮我回忆 orchard'),false)
})
test('claimed opt-out blocks capture even if rejected before log publication',()=>{
 const x=setup([{type:'turn/start',data:{turn:1}},user('initial request'),assistant]);x.a._noteClaimed({agent:{id:'s'},turn:1,message:user('本轮不要写入记忆').data});x.a._onTurnEnd('s','p',{data:{turn:1,reason:'error'}},x.session);assert.equal(x.ends.length,0);assert.equal(x.posts.length,0)
})
test('capture resumes next turn and duplicate end does not capture twice',()=>{
 const x=setup([{type:'turn/start',data:{turn:1}},user('本轮不要写入记忆')]);x.a._onTurnEnd('s','p',{data:{turn:1}},x.session)
 const next=setup([{type:'turn/start',data:{turn:2}},user('next ordinary request'),assistant]).session
 x.a._onTurnEnd('s','p',{data:{turn:2}},next);x.a._onTurnEnd('s','p',{data:{turn:2}},next)
 assert.equal(x.ends.length,1);assert.equal(x.posts.length,1)
})
test('chunked reader retains current-turn event order over several chunks',()=>{
 const all=Array.from({length:1000},(_,i)=>({seq:i,type:i===600?'turn/start':'tool/result',data:{turn:3}}));const ranges=[]
 const ev=currentTurnEvents({seq:1000,snapshotEvents(f,t){ranges.push([f,t]);return all.slice(f,t)}},3)
 assert.equal(ev.length,400);assert.equal(ev[0].seq,600);assert.equal(ev.at(-1).seq,999);assert.equal(ranges.length,4)
})
test('non-human claim of a new turn clears previous input',()=>{
 const x=setup([]);x.a._noteClaimed({agent:{id:'s'},turn:1,message:user('previous').data});x.a._noteClaimed({agent:{id:'s'},turn:2,message:{source:{kind:'plugin'}}});assert.equal(x.a._currentUserText(x.session),'')
})
test('failed human capture can retry without repeating successful assistant capture',()=>{
 const x=setup([{type:'turn/start',data:{turn:1}},user('ordinary request'),assistant]);const original=x.a.engine.taskEnd;let fail=true
 x.a.engine.taskEnd=p=>{if(fail){fail=false;throw Error('transient write failure')}return original(p)}
 assert.throws(()=>x.a._onTurnEnd('s','p',{data:{turn:1}},x.session),/transient/);x.a._onTurnEnd('s','p',{data:{turn:1}},x.session)
 assert.equal(x.ends.length,1);assert.equal(x.posts.length,1)
})
test('resumed current turn needs no in-process claimed cache',()=>{
 const x=setup([{type:'turn/start',data:{turn:3}},user('resumed request'),assistant]);x.a._onTurnEnd('s','p',{data:{reason:'completed'}},x.session);x.a._onTurnEnd('s','p',{data:{reason:'completed'}},x.session);assert.equal(x.ends.length,1);assert.equal(x.posts.length,1)
})
test('live projection capture never calls deprecated Session history reads',()=>{
 const posts=[],ends=[];const engine={postTurn:p=>posts.push(p),taskEnd(p){ends.push(p);return {}},activateSession(){}};const a=new DshAdapter(engine,{settleEveryTurns:0,settleMinIntervalMin:0});const events=[]
 const session={id:'projection-only',seq:0,snapshotEvents(){throw new Error('snapshotEvents must not run for live projection')}}
 const emit=(type,data={})=>{const event={type,seq:events.length,data};events.push(event);session.seq=events.length;a.handleSessionEvent({},session,event)}
 emit('turn/start',{turn:1});emit('user/message',{source:{kind:'user'},content:[{type:'text',text:'projection request'}]});emit('assistant/message',{turn:1,message:{content:[{type:'text',text:'projection response'}]}});emit('turn/end',{turn:1,reason:'completed'})
 assert.equal(ends.length,1);assert.equal(ends[0].text,'projection request')
})
test('real engine stores neither side of opted-out turn and resumes ordinary capture',async()=>{
 const {MemoryEngine}=await import('../lib/engine.js');const {mkdtempSync,rmSync,readFileSync,existsSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path')
 const dir=mkdtempSync(join(tmpdir(),'mnemo-capture-integration-'))
 try {const e=new MemoryEngine({dir});e.start('s');const a=new DshAdapter(e,{settleEveryTurns:0,settleMinIntervalMin:0});const run=(turn,text,reply)=>{const events=[{type:'turn/start',seq:0,data:{turn}},user(text),{...assistant,data:{turn,message:{content:[{type:'text',text:reply}]}}}];a._onTurnEnd('s','p',{data:{turn,reason:'completed'}},{id:'s',seq:events.length,snapshotEvents:(f,t)=>events.slice(f,t)})};run(1,'本轮不要写入记忆 PRIVATE_USER','PRIVATE_ASSISTANT');assert.equal(e.staging.pending.length,0);assert.ok(!existsSync(join(dir,'events.jsonl'))||!readFileSync(join(dir,'events.jsonl'),'utf8').includes('PRIVATE_'));run(2,'orchard normal user','orchard normal assistant');assert.ok(e.staging.pending.some(p=>p.text==='orchard normal user'));assert.ok(e.staging.pending.some(p=>p.text==='orchard normal assistant'))} finally {rmSync(dir,{recursive:true,force:true})}
})
