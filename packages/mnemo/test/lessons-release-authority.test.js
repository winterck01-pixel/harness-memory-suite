import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {LessonStore,LessonsEngine,buildEvidence} from '../lib/lessons.js'

const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
function evidence(){
 const rows=[];let seq=0
 for(const [id,name,text,isError]of [['bad','edit','Error: file has not been read',true],['read','read','mode=dev',false],['ok','edit','edited',false]])rows.push({type:'tool/call',seq:++seq,data:{callId:id,name,arguments:'{"path":"fixture.ini"}'}},{type:'tool/result',seq:++seq,data:{message:{toolCallId:id,isError,content:[{type:'text',text}]}}})
 return buildEvidence(rows)
}
const pack=evidence(),proposal={type:'fix',signature:pack.failures[0].signature,trigger:'edit reports target file has not been read',advice:'Read the current file before editing its content.',scope:'project',confidence:'high'}
const entry=(id='q')=>({id,sid:'source-'+id,scope:'fixture-project',turn:1,at:Date.now(),route:{provider:'fixture',model:'fixture'},failed:true,repeat:true,toolCalls:3,pack})
function setup(generate,{canWrite=()=>true}={}){
 const directory=mkdtempSync(join(tmpdir(),'lessons-authority-')),store=new LessonStore({directory})
 const engine=new LessonsEngine({store,generate,canWrite,config:{enabled:true,holdoutRate:0,idleMs:3600000}})
 return {directory,store,engine,close(){engine.dispose();rmSync(directory,{recursive:true,force:true})}}
}
const disk=s=>readFileSync(s.path,'utf8')

test('closed write authority retains undispatched queue without saving or consuming budget',async()=>{
 let calls=0,writable=false
 const f=setup(async()=>{calls++;return {lessons:[proposal]}},{canWrite:()=>writable})
 try{
  f.store.state.queue.push(entry(),{...entry('unworthy'),failed:false,repeat:false,toolCalls:1});f.store.save()
  const before=disk(f.store);await f.engine._drain(()=>true,null)
  assert.equal(calls,0);assert.equal(disk(f.store),before);assert.equal(f.store.state.queue.length,2);assert.equal(f.store.state.calls.n,0)
 }finally{f.close()}
})

for(const mode of ['authority','dispose','rejection'])test('in-flight extraction '+mode+' preserves dispatched accounting and performs no late writes',async()=>{
 const entered=defer(),release=defer();let writable=true,calls=0,stopped=false,lateWrites=0
 const f=setup(async()=>{calls++;entered.resolve();await release.promise;if(mode==='rejection')throw Error('synthetic provider failure');return {lessons:[proposal]}},{canWrite:()=>writable})
 try{
  f.store.state.queue.push(entry(),entry('later'));f.store.save()
  const write=f.store._write.bind(f.store);f.store._write=()=>{if(stopped)lateWrites++;return write()}
  const pending=f.engine._drain(()=>true,null);await entered.promise
  const reserved=new LessonStore({directory:f.directory})
  assert.equal(reserved.state.calls.n,1,'reservation must reach disk before model dispatch')
  assert.deepEqual(reserved.state.queue.map(x=>x.id),['later'],'only dispatched entry is consumed')
  stopped=true;if(mode==='dispose')f.engine.dispose();else writable=false
  const before=disk(f.store);release.resolve();await pending
  assert.equal(calls,1);assert.equal(lateWrites,0);assert.equal(disk(f.store),before);assert.equal(f.store.list().length,0)
  assert.deepEqual(new LessonStore({directory:f.directory}).state.queue.map(x=>x.id),['later'])
  f.engine.dispose();let replayed=0
  const restart=new LessonsEngine({store:new LessonStore({directory:f.directory}),config:{enabled:true,idleMs:3600000},generate:async()=>{replayed++;return {lessons:[]}}})
  try{await restart._drain(e=>e.id==='q',null);assert.equal(replayed,0)}finally{restart.dispose()}
 }finally{release.resolve();f.close()}
})

test('manual tombstone branch cannot append support after extraction loses authority',async()=>{
 let writable=true
 const f=setup(async()=>{writable=false;return {lessons:[proposal]}},{canWrite:()=>writable})
 try{
  const old=f.store.upsert(proposal,{scopeHash:'fixture-project',sourceRef:{sessionId:'original',turn:1}})
  f.store.setState(old,'retired','audit',{retiredAt:Date.now(),retiredBy:'audit'});f.store.state.queue.push(entry());f.store.save()
  await f.engine._drain(()=>true,null)
  const persisted=new LessonStore({directory:f.directory}),saved=persisted.state.lessons[old.id]
  assert.equal(saved.stats.support,1);assert.equal(saved.stateBy,'audit');assert.deepEqual(saved.sourceRefs,[{sessionId:'original',turn:1}]);assert.equal(persisted.state.calls.n,1)
 }finally{f.close()}
})

test('reconciliation rechecks authority after its model await and retains both charged calls',async()=>{
 const entered=defer(),release=defer();let writable=true,calls=0,old
 const alternate={...proposal,trigger:'Validate checksum before parsing input',advice:'Check the document checksum and report malformed records.'}
 const f=setup(async()=>{if(++calls===1)return {lessons:[alternate]};entered.resolve();await release.promise;return {relation:'complement',targetId:old.id}},{canWrite:()=>writable})
 try{
  old=f.store.upsert(proposal,{scopeHash:'fixture-project',sourceRef:{sessionId:'original',turn:1}})
  const q=entry();q.pack={...pack,window:pack.window.filter(x=>x.failed)};f.store.state.queue.push(q);f.store.save()
  const pending=f.engine._drain(()=>true,null);await entered.promise
  assert.equal(new LessonStore({directory:f.directory}).state.calls.n,2)
  new LessonStore({directory:f.directory}).update((state,s)=>s.setState(state.lessons[old.id],'retired','audit',{retiredAt:Date.now(),retiredBy:'audit'}))
  writable=false;const before=disk(f.store);release.resolve();await pending
  assert.equal(calls,2);assert.equal(disk(f.store),before);assert.equal(new LessonStore({directory:f.directory}).list().length,1)
 }finally{release.resolve();f.close()}
})

test('loss of write authority while acquiring proposal lock prevents commit and finish saves',async()=>{
 let writable=true,armed=false
 const f=setup(async()=>{armed=true;return {lessons:[proposal]}},{canWrite:()=>writable})
 try{
  f.store.state.queue.push(entry());f.store.save()
  const lock=f.store._lock.bind(f.store)
  f.store._lock=()=>{const unlock=lock();if(armed){armed=false;writable=false}return unlock}
  await f.engine._drain(()=>true,null)
  const persisted=new LessonStore({directory:f.directory});assert.equal(persisted.list().length,0);assert.equal(persisted.state.calls.n,1);assert.deepEqual(persisted.state.queue,[])
 }finally{f.close()}
})

test('failed durable reservation does not dispatch inference or discard its pending queue',async()=>{
 let calls=0
 const f=setup(async()=>{calls++;return {lessons:[proposal]}})
 try{
  f.store.state.queue.push(entry());f.store.save();const before=disk(f.store)
  f.store.save=()=>{throw Error('synthetic write failure')}
  await f.engine._drain(()=>true,null)
  assert.equal(calls,0);assert.equal(disk(f.store),before);assert.equal(f.store.state.queue.length,1);assert.equal(f.store.state.calls.n,0)
 }finally{f.close()}
})

test('turn completion cannot flush injection metrics after write authority is revoked',()=>{
 let saves=0;const f=setup(async()=>({lessons:[]}),{canWrite:()=>false})
 try{
  f.store.save=()=>{saves++};f.engine._s('s').injections.push({id:'fixture'})
  f.engine.observe({id:'s'}, {type:'turn/end',data:{reason:{kind:'completed'}}},{scope:'fixture-project'})
  assert.equal(saves,0)
 }finally{f.close()}
})

test('audit CLI establishes a human tombstone even when the record was already retired automatically',()=>{
 const f=setup(async()=>({lessons:[]}))
 try{
  const old=f.store.upsert(proposal,{scopeHash:'fixture-project',sourceRef:{sessionId:'original',turn:1}})
  f.store.setState(old,'retired','expiry',{retiredAt:Date.now()});f.store.save()
  const audit=join(f.directory,'audit.md');writeFileSync(audit,'- [x] retire '+old.id+'\n')
  execFileSync(process.execPath,[fileURLToPath(new URL('../tools/audit-sample.mjs',import.meta.url)),'apply',audit,'--dir',f.directory],{stdio:'pipe'})
  const saved=new LessonStore({directory:f.directory}).state.lessons[old.id]
  assert.equal(saved.stateBy,'audit');assert.equal(saved.retiredBy,'audit');assert.ok(saved.rev>old.rev)
 }finally{f.close()}
})
