import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {LessonStore,LessonsEngine,buildEvidence} from '../lib/lessons.js'
import {signatureOf} from '../lib/lessons-signature.js'

const DAY=86400000,ERR='Error: cannot modify "a": file has not been read'
const base={type:'fix',signature:signatureOf('edit',ERR).signature,trigger:'edit file has not been read',advice:'Read the target file before editing it.',scope:'project',tool:null,confidence:'high',errorClass:'other'}
const put=store=>store.upsert(base,{scopeHash:'P',sourceRef:{sessionId:'original',turn:1}})
const retire=(directory,id,now=Date.now())=>new LessonStore({directory,now:()=>now}).update((state,s)=>s.setState(state.lessons[id],'retired','audit',{retiredAt:now,retiredBy:'audit'}))
function recovery(){
 let seq=0;const rows=[]
 for(const [id,name,text,isError] of [['bad','edit',ERR,true],['read','read','file content',false],['ok','edit','edited',false]]){
  rows.push({type:'tool/call',seq:++seq,data:{callId:id,name,arguments:JSON.stringify({path:'A.txt'})}},{type:'tool/result',seq:++seq,data:{message:{toolCallId:id,isError,content:[{type:'text',text}]}}})
 }
 return rows
}

test('same-state refresh preserves human retirement through later expiry and purge',()=>{
 const directory=mkdtempSync(join(tmpdir(),'lessons-audit-race-'));let now=1700000000000
 try{
  const store=new LessonStore({directory,now:()=>now,limits:{expireDays:1,purgeDays:1}}),old=put(store);store.save()
  now+=2*DAY;store.expire();assert.equal(old.stateBy,'expiry')
  retire(directory,old.id,now);store.save()
  assert.equal(new LessonStore({directory}).state.lessons[old.id].stateBy,'audit')
  now+=3*DAY;store.expire();store.save()
  assert.equal(new LessonStore({directory}).state.lessons[old.id].stateBy,'audit')
 }finally{rmSync(directory,{recursive:true,force:true})}
})

test('a persisted human rejection also wins against newer unsaved automatic revisions',()=>{
 const directory=mkdtempSync(join(tmpdir(),'lessons-audit-rev-'))
 try{
  const store=new LessonStore({directory}),old=put(store);store.save()
  store.setState(old,'suspended','recurrence');store.setState(old,'retired','expiry',{retiredAt:Date.now()})
  retire(directory,old.id);store.save()
  const restored=new LessonStore({directory}).state.lessons[old.id]
  assert.equal(restored.stateBy,'audit');assert.equal(restored.retiredBy,'audit')
 }finally{rmSync(directory,{recursive:true,force:true})}
})

test('retirement during extraction blocks canonical replacement and keeps host counters and queue',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'lessons-audit-extract-'));let engine
 try{
  const store=new LessonStore({directory}),old=put(store);store.save()
  store.state.metrics.injected.exposures=7
  engine=new LessonsEngine({store,config:{enabled:true,holdoutRate:0},generate:async()=>{retire(directory,old.id);return {lessons:[base]}}})
  store.state.queue.push({id:'q',sid:'S',scope:'P',turn:1,at:Date.now(),route:{provider:'mock',model:'mock'},failed:true,repeat:true,toolCalls:3,pack:buildEvidence(recovery())})
  await engine._drain(()=>true,null)
  const disk=new LessonStore({directory})
  assert.equal(disk.list().length,1);assert.equal(disk.list()[0].state,'retired');assert.equal(disk.list()[0].stateBy,'audit')
  assert.ok(disk.list()[0].sourceRefs.some(r=>r.sessionId==='S'))
  assert.equal(disk.state.metrics.injected.exposures,7);assert.equal(disk.state.calls.n,1);assert.deepEqual(disk.state.queue,[])
 }finally{engine?.dispose();rmSync(directory,{recursive:true,force:true})}
})

test('final proposal rejection check and save share the writer lock',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'lessons-audit-commit-'));let engine
 try{
  const store=new LessonStore({directory}),old=put(store);store.save()
  let armed=false,checkedUnderLock=false
  const lock=store._lock.bind(store),check=store.manualRetirement.bind(store)
  store._lock=()=>{if(armed){armed=false;retire(directory,old.id)}return lock()}
  store.manualRetirement=(...args)=>{if(existsSync(store.path+'.lock'))checkedUnderLock=true;return check(...args)}
  engine=new LessonsEngine({store,config:{enabled:true,holdoutRate:0},generate:async()=>{armed=true;return {lessons:[base]}}})
  store.state.queue.push({id:'q',sid:'S',scope:'P',turn:1,at:Date.now(),route:{provider:'mock',model:'mock'},failed:true,repeat:true,toolCalls:3,pack:buildEvidence(recovery())})
  await engine._drain(()=>true,null)
  assert.equal(checkedUnderLock,true);assert.equal(new LessonStore({directory}).list().filter(l=>l.state==='active').length,0)
 }finally{engine?.dispose();rmSync(directory,{recursive:true,force:true})}
})

async function successful({ptc=false,count=5,start=true,duplicate=false,nested=false}={}){
 const store=new LessonStore(),rows=[],packs=[]
 const engine=new LessonsEngine({store,routeOf:()=>({provider:'mock',model:'mock'}),config:{enabled:true,idleMs:3600000,holdoutRate:0},generate:async(_s,pack)=>{packs.push(pack);return {lessons:[{type:'method',trigger:'检查多份独立报表',advice:'先逐份检查报表，再汇总共同的结构和异常。',scope:'project',confidence:'high'}]}}})
 const session={id:'success-fixture',get seq(){return rows.length},snapshotEvents:(a,b)=>rows.filter(e=>e.seq>=a&&e.seq<b)}
 const emit=(type,data)=>{const e={type,data,seq:rows.length};rows.push(e);engine.observe(session,e,{scope:'P'})}
 emit('turn/start',{turn:1});emit('user/message',{turn:1,content:[{type:'text',text:'检查多份报表'}]})
 if(ptc)emit('tool/call',{callId:'root',name:'run_code',arguments:'{}'})
 if(ptc&&nested)emit('tool/ptc-dispatch-start',{rootCallId:'root',parentCallId:'root',subCallId:'nested',name:'run_code',arguments:{}})
 for(let i=0;i<count;i++){
  const args={path:'report'+i+'.txt'},id='sub'+i
  if(ptc){
   const data={rootCallId:'root',parentCallId:nested?'nested':'root',subCallId:id,name:'read',arguments:args}
   if(start)emit('tool/ptc-dispatch-start',data)
   const result={...data,isError:false,content:[{type:'text',text:'valid report'}]};emit('tool/ptc-dispatch',result)
   if(duplicate){if(start)emit('tool/ptc-dispatch-start',data);emit('tool/ptc-dispatch',result)}
  }else{
   emit('tool/call',{callId:id,name:'read',arguments:JSON.stringify(args)})
   if(duplicate)emit('tool/call',{callId:id,name:'read',arguments:JSON.stringify(args)})
   emit('tool/result',{message:{toolCallId:id,isError:false,content:[{type:'text',text:'valid report'}]}})
  }
 }
 if(ptc&&nested)emit('tool/ptc-dispatch',{rootCallId:'root',parentCallId:'root',subCallId:'nested',name:'run_code',arguments:{},isError:false,content:[{type:'text',text:'done'}]})
 if(ptc)emit('tool/result',{message:{toolCallId:'root',isError:false,content:[{type:'text',text:'done'}]}})
 emit('turn/end',{turn:1,reason:{kind:'completed'}})
 const queued=store.state.queue.length,toolCalls=store.state.queue[0]?.toolCalls
 await engine._drain(()=>true,null);engine.dispose()
 return {queued,toolCalls,packs,store}
}

test('five successful PTC operations reach extraction and remain human-review candidates',async()=>{
 for(const mode of [{},{ptc:true},{ptc:true,start:false},{ptc:true,nested:true}]){
  const r=await successful(mode)
  assert.equal(r.queued,1,JSON.stringify(mode));assert.equal(r.toolCalls,5,JSON.stringify(mode));assert.equal(r.packs.length,1)
  assert.deepEqual(r.packs[0].triggerReasons,['method']);assert.equal(r.store.list()[0].state,'candidate');assert.equal(r.store.list()[0].review.needsHuman,true)
 }
})

test('PTC containers and duplicate dispatches do not manufacture a fifth operation',async()=>{
 for(const mode of [{duplicate:true},{ptc:true,duplicate:true},{ptc:true,start:false,duplicate:true},{ptc:true,nested:true,duplicate:true}]){
  const r=await successful({...mode,count:4})
  assert.equal(r.toolCalls,4,JSON.stringify(mode));assert.equal(r.packs.length,0,JSON.stringify(mode))
 }
})


test('locked writes fail closed on unreadable or invalid audit state and recover after repair',()=>{
 const directory=mkdtempSync(join(tmpdir(),'lessons-audit-read-'))
 try{
  const store=new LessonStore({directory}),old=put(store);store.save()
  const original=readFileSync(store.path,'utf8'),stamp=store._stamp.bind(store)
  store._stamp=()=>{throw Error('synthetic stat failure')}
  old.stats.support=9
  assert.throws(()=>store.save(),/synthetic stat failure/)
  assert.equal(readFileSync(store.path,'utf8'),original,'failed metadata read must precede any write')
  store._stamp=stamp
  for(const bad of ['{broken json',JSON.stringify({version:999,lessons:{}})]){
   writeFileSync(store.path,bad)
   assert.throws(()=>store.save())
   assert.equal(readFileSync(store.path,'utf8'),bad,'invalid operator state must not be overwritten')
  }
  writeFileSync(store.path,original);retire(directory,old.id);store.save()
  const repaired=new LessonStore({directory})
  assert.equal(repaired.state.lessons[old.id].stateBy,'audit');assert.equal(repaired.state.lessons[old.id].stats.support,9)
  assert.equal(existsSync(store.path+'.lock'),false)
 }finally{rmSync(directory,{recursive:true,force:true})}
})

test('retirement during advisory reconciliation is checked again before commit',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'lessons-audit-reconcile-'));let engine
 try{
  const store=new LessonStore({directory})
  const proposal=store.upsert(base,{scopeHash:'P',sourceRef:{sessionId:'original',turn:1},status:'candidate'})
  const other=store.upsert({...base,trigger:'Unrelated parser configuration issue',advice:'Switch parser mode to match the document format.'},{scopeHash:'P',sourceRef:{sessionId:'reviewed',turn:1}})
  store.save();let reconciled=false
  engine=new LessonsEngine({store,config:{enabled:true,holdoutRate:0},generate:async(_s,pack)=>{
   if(pack.existing){reconciled=true;retire(directory,proposal.id);return {relation:'conflict',targetId:other.id}}
   return {lessons:[base]}
  }})
  const rows=recovery().filter(e=>e.data?.name!=='read'&&e.data?.message?.toolCallId!=='read')
  store.state.queue.push({id:'q',sid:'S',scope:'P',turn:1,at:Date.now(),route:{provider:'mock',model:'mock'},failed:true,repeat:true,toolCalls:2,pack:buildEvidence(rows)})
  await engine._drain(()=>true,null)
  const disk=new LessonStore({directory})
  assert.equal(reconciled,true);assert.equal(disk.state.lessons[proposal.id].stateBy,'audit')
  assert.equal(disk.state.lessons[proposal.id].state,'retired');assert.equal(disk.state.lessons[other.id].state,'active')
  assert.equal(engine.stats.extracted,0);assert.equal(engine.stats.skipped,1);assert.equal(disk.state.calls.n,2)
 }finally{engine?.dispose();rmSync(directory,{recursive:true,force:true})}
})
