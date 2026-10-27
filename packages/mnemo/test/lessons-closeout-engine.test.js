import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import {LessonStore,LessonsEngine,buildEvidence} from '../lib/lessons.js'
import {signatureOf} from '../lib/lessons-signature.js'

const ERR='Error: cannot modify "a": file has not been read'
const SIG=signatureOf('edit',ERR).signature
const base={type:'fix',signature:SIG,trigger:'edit file has not been read',advice:'Read the target file before editing it.',scope:'project',tool:null,confidence:'high',errorClass:'other'}
function events({target='A.txt',readTarget=target,successTarget=target,read=true,failAgain=false,error=ERR}={}){
 let seq=0;const out=[],event=(type,data)=>out.push({type,seq:++seq,data})
 const step=(id,tool,path,text,isError=false)=>{event('tool/call',{callId:id,name:tool,arguments:JSON.stringify({path})});event('tool/result',{message:{toolCallId:id,isError,content:[{type:'text',text}]}})}
 step('bad','edit',target,error,true)
 if(read)step('read','read',readTarget,'current file content')
 step('ok','edit',successTarget,'edited successfully')
 if(failAgain)step('again','edit',target,ERR,true)
 return out
}
async function extract(store,rows,proposal={...base,advice:'Retry the edit without reading the file first.'},merge){
 let modelCalls=0
 const engine=new LessonsEngine({store,config:{enabled:true,holdoutRate:0},generate:async(_sys,pack)=>{modelCalls++;return pack.existing?merge:{lessons:[proposal]}}})
 store.state.queue.push({id:'q',sid:'S',scope:'P',turn:1,at:Date.now(),route:{provider:'mock',model:'mock'},failed:true,repeat:true,toolCalls:rows.length/2,pack:buildEvidence(rows)})
 await engine._drain(()=>true,null);engine.dispose()
 return {engine,modelCalls}
}

test('manual retirement survives repeated extraction, refresh, expiry and capacity trim',()=>{
 const dir=mkdtempSync(join(tmpdir(),'lessons-closeout-'));let now=1_700_000_000_000
 try{
  const store=new LessonStore({directory:dir,now:()=>now,limits:{maxPerProject:1,expireDays:1,purgeDays:1}})
  const old=store.upsert(base,{scopeHash:'P',sourceRef:{sessionId:'original',turn:1}});store.save()
  const audit=new LessonStore({directory:dir,now:()=>now})
  audit.update((state,s)=>s.setState(state.lessons[old.id],'retired','audit',{retiredAt:now,retiredBy:'audit'}));store.save()
  const repeated=store.upsert(base,{scopeHash:'P',sourceRef:{sessionId:'again',turn:2},status:'active'})
  assert.equal(repeated.state,'retired');assert.equal(repeated.stateBy,'audit')
  assert.ok(repeated.sourceRefs.some(x=>x.sessionId==='original'));assert.ok(repeated.sourceRefs.some(x=>x.sessionId==='again'))
  now+=10*86400000;store.expire();const fresh=store.upsert({...base,signature:'different',trigger:'other trigger',advice:'other advice text'},{scopeHash:'P',sourceRef:{}});store.trim();store.save()
  const reloaded=new LessonStore({directory:dir});assert.equal(reloaded.state.lessons[old.id].state,'retired')
  assert.equal(reloaded.state.lessons[fresh.id].state,'active','operator tombstones do not consume usable lesson capacity')
  reloaded.setState(reloaded.state.lessons[old.id],'active','audit',{promotedBy:'human'});reloaded.save()
  assert.equal(new LessonStore({directory:dir}).state.lessons[old.id].state,'active','explicit human correction remains possible')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('unverified candidate cannot mutate an active lesson through reconciliation',async()=>{
 const store=new LessonStore(),old=store.upsert(base,{scopeHash:'P',sourceRef:{sessionId:'old',turn:1}})
 const proposal={...base,confidence:'low',trigger:'unrelated parser adaptation',advice:'Switch the parser encoding to latin one for this job.'}
 await extract(store,events({read:false}),proposal,{relation:'complement',targetId:old.id,mergedAdvice:proposal.advice})
 assert.equal(old.advice,base.advice);assert.equal(old.state,'active')
 assert.ok(store.list().some(l=>l.state==='candidate'&&l.advice===proposal.advice))
})

test('a different target success and repeated unverified sources never establish verification',async()=>{
 const store=new LessonStore()
 await extract(store,events({read:false,successTarget:'B.txt'}))
 const candidate=store.list()[0];assert.equal(candidate.state,'candidate')
 const proposal={...base,confidence:'low'}
 const other=new LessonStore(),first=other.upsert(proposal,{scopeHash:'P',sourceRef:{sessionId:'a',turn:1},status:'candidate'})
 other.upsert(proposal,{scopeHash:'P',sourceRef:{sessionId:'b',turn:2},status:'candidate'})
 assert.equal(first.state,'candidate');assert.notEqual(first.promotedBy,'repeat')
})

test('verified read-before-edit uses a checked template, never the model free-form advice',async()=>{
 const store=new LessonStore();await extract(store,events())
 const learned=store.list()[0]
 assert.equal(learned.state,'active');assert.equal(learned.verification?.kind,'tool-contract')
 assert.match(learned.advice,/先 read/);assert.doesNotMatch(learned.advice,/without reading/)
 assert.equal(learned.verification.proposal.advice,'Retry the edit without reading the file first.')
 assert.deepEqual(learned.verification.sequences,[2,4,6])
})

test('wrong-target reads, missing reads, and a later repeated failure remain candidates',async()=>{
 for(const opts of [{readTarget:'B.txt'},{read:false},{failAgain:true}]){
  const store=new LessonStore();await extract(store,events(opts));assert.equal(store.list()[0].state,'candidate',JSON.stringify(opts))
 }
})

test('LLM reconciliation outputs cannot rewrite or suspend an active experience',async()=>{
 for(const relation of ['complement','conflict']){
  const store=new LessonStore(),old=store.upsert({...base,trigger:'other matching failure',advice:'Known earlier reviewed advice.'},{scopeHash:'P',sourceRef:{}})
  const engine=new LessonsEngine({store,config:{enabled:true},generate:async()=>({relation,targetId:old.id,mergedAdvice:'Unverified generated change.'})})
  await engine._reconcile({...base,trigger:'new separate trigger',advice:'Unverified proposed change.'},'P',{sessionId:'candidate',turn:2})
  engine.dispose();assert.equal(old.advice,'Known earlier reviewed advice.');assert.equal(old.state,'active')
 }
})

test('stale-edit recovery is verified only after re-reading the same target',async()=>{
 const error='Error: cannot edit "A.txt": file changed since it was read — re-read the file, then retry'
 const proposal={...base,signature:signatureOf('edit',error).signature,advice:'Retry with the old matching text.'}
 const store=new LessonStore();await extract(store,events({error}),proposal)
 const learned=store.list()[0];assert.equal(learned.state,'active')
 assert.equal(learned.verification.contract,'edit-reread-stale-v1');assert.match(learned.advice,/重新读取/)
 const rejected=new LessonStore();await extract(rejected,events({error,read:false}),proposal)
 assert.equal(rejected.list()[0].state,'candidate')
})

test('PTC result events use the same verification and runtime signature association',async()=>{
 const rows=events().map(e=>e.type==='tool/call'
  ?{...e,type:'tool/ptc-dispatch-start',data:{subCallId:e.data.callId,name:e.data.name,arguments:JSON.parse(e.data.arguments)}}
  :{...e,type:'tool/ptc-dispatch',data:{subCallId:e.data.message.toolCallId,isError:e.data.message.isError,content:e.data.message.content}})
 const store=new LessonStore();await extract(store,rows)
 const learned=store.list()[0];assert.equal(learned.state,'active');assert.equal(learned.verification.kind,'tool-contract')
 const engine=new LessonsEngine({store,config:{enabled:true,holdoutRate:0,injectOpening:false},generate:async()=>({})})
 const session={id:'ptc-runtime',seq:rows.length+1,snapshotEvents:(a,b)=>rows.filter(e=>e.seq>=a&&e.seq<b)}
 engine.observe(session,rows[0],{scope:'P'});engine.observe(session,rows[1],{scope:'P'})
 assert.equal(engine.recallOnError(session.id,'P').length,1)
 engine.dispose()
})

test('unverified proposals appear in the existing human review list and can be approved explicitly',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'lessons-review-closeout-'))
 try{
  const store=new LessonStore({directory:dir});await extract(store,events({read:false,successTarget:'B.txt'}))
  const candidate=store.list()[0];assert.equal(candidate.state,'candidate');assert.equal(candidate.review.needsHuman,true)
  const root=join(dirname(fileURLToPath(import.meta.url)),'..'),audit=join(dir,'audit.md')
  const command=args=>execFileSync(process.execPath,['tools/audit-sample.mjs',...args],{cwd:root,encoding:'utf8'})
  command(['sample','--n','0','--out',audit,'--dir',dir])
  const report=readFileSync(audit,'utf8');assert.match(report,/需人工审核的候选\(1 条/);assert.ok(report.includes(`- [ ] approve ${candidate.id}`))
  writeFileSync(audit,report.replace(`- [ ] approve ${candidate.id}`,`- [x] approve ${candidate.id}`))
  command(['apply',audit,'--dir',dir])
  const approved=new LessonStore({directory:dir}).state.lessons[candidate.id]
  assert.equal(approved.state,'active');assert.equal(approved.stateBy,'audit');assert.equal(approved.review.needsHuman,false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('canonical validation cannot disguise a human-rejected proposal as a new active ID',async()=>{
 const store=new LessonStore(),rejected=store.upsert(base,{scopeHash:'P',sourceRef:{sessionId:'human-source',turn:1}})
 store.setState(rejected,'retired','audit',{retiredAt:Date.now(),retiredBy:'audit'})
 await extract(store,events(),base)
 assert.equal(store.list().length,1);assert.equal(rejected.state,'retired')
 assert.ok(rejected.sourceRefs.some(r=>r.sessionId==='human-source'));assert.ok(rejected.sourceRefs.some(r=>r.sessionId==='S'))
})

test('changing a rejected lesson from pitfall to fix cannot evade the human decision',()=>{
 const store=new LessonStore(),engine=new LessonsEngine({store,config:{enabled:true},generate:async()=>({})})
 const classified=engine._classify(base,buildEvidence(events()))
 assert.equal(classified.status,'active')
 const rejected=store.upsert({...classified.lesson,type:'pitfall'},{scopeHash:'P',sourceRef:{sessionId:'human-source',turn:1}})
 store.setState(rejected,'retired','audit',{retiredAt:Date.now(),retiredBy:'audit'})
 const next=store.upsert(classified.lesson,{scopeHash:'P',sourceRef:{sessionId:'next',turn:2},status:'active',verification:classified.verification})
 assert.equal(next,rejected);assert.equal(next.state,'retired');assert.equal(store.list().length,1)
 engine.dispose()
})
