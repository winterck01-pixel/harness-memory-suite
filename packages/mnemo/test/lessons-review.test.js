// Regression tests for the 2026-10-27 review (F01-F14, D01). Each test fails on the pre-fix code.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {apply} from '../index.js'
import {signatureOf,scanFailures} from '../lib/lessons-signature.js'
import {LessonStore,LessonsEngine,buildEvidence} from '../lib/lessons.js'

let seq=0
const ev=(type,data={})=>({type,seq:++seq,time:Date.now(),data})
const mk=()=>mkdtempSync(join(tmpdir(),'lessons-review-'))
const call=(turn,id,name,args={})=>ev('tool/call',{turn,callId:id,name,arguments:JSON.stringify(args)})
const result=(turn,id,text,isError=false)=>ev('tool/result',{turn,message:{role:'tool',toolCallId:id,isError,content:[{type:'text',text}]}})
const sessionOf=(events,id='s1')=>({id,header:{cwd:'/p'},get seq(){return seq+1},snapshotEvents:(a,b)=>events.filter(e=>e.seq>=a&&e.seq<b)})
const feed=(engine,sess,evs,e,opts={scope:'P'})=>{evs.push(e);engine.observe(sess,e,opts);return e}
const lesson=(o={})=>({type:'fix',signature:'sig',trigger:'edit file has not been read',advice:'read the file first then edit',scope:'project',tool:null,confidence:'high',errorClass:null,...o})
const route=n=>({provider:'prov-'+n,model:'model-'+n})
const failingTurn=(engine,sess,evs,turn,{tool='edit',fixTool=tool,text='error: cannot modify "a": file has not been read',read=true}={})=>{
 for(const e of [ev('turn/start',{turn}),call(turn,'a'+turn,tool,{path:'a'}),result(turn,'a'+turn,text,true),...(read?[call(turn,'r'+turn,'read',{path:'a'}),result(turn,'r'+turn,'contents')]:[]),call(turn,'b'+turn,fixTool,{path:'a'}),result(turn,'b'+turn,'ok'),ev('assistant/message',{content:[{type:'text',text:'done'}]}),ev('turn/end',{turn,reason:{kind:'completed'}})])feed(engine,sess,evs,e)
}
const engineWith=(over={},cfg={})=>{
 const dir=mk(),store=new LessonStore({directory:dir}),calls=[]
 const engine=new LessonsEngine({store,generate:async(sys,pack,opts)=>{calls.push({sys,pack,opts});return over.out??{lessons:[]}},routeOf:over.routeOf??(()=>route('A')),isOptOut:over.isOptOut,config:{enabled:true,holdoutRate:0,idleMs:3600000,...cfg}})
 return {dir,store,engine,calls}
}

// ---------- F01 ----------
test('F01: an opt-out message is never sent to the extractor as feedback, but ordinary feedback still is',async()=>{
 for(const [text,expectFed] of [['这次关闭记忆。SYNTHETIC_PRIVATE_MARKER',false],['不对,还是不行 PLAIN_FEEDBACK',true]]){
  seq=0;const evs=[],{dir,engine,calls}=engineWith({isOptOut:t=>/关闭记忆/.test(t),out:{lessons:[]}}),sess=sessionOf(evs)
  try{
   failingTurn(engine,sess,evs,1);feed(engine,sess,evs,ev('turn/start',{turn:2}))
   feed(engine,sess,evs,ev('user/message',{turn:2,content:[{type:'text',text}]}));await engine.idle()
   assert.equal(calls.length,1,'the earlier, already-collected turn is still processed')
   const sent=JSON.stringify(calls[0].pack)
   assert.equal(sent.includes('SYNTHETIC_PRIVATE_MARKER')||sent.includes('PLAIN_FEEDBACK'),expectFed)
   if(!expectFed)assert.equal(calls[0].pack.nextUserMessage,null)
  }finally{engine.dispose();rmSync(dir,{recursive:true,force:true})}
 }
})

// ---------- F02 ----------
test('F02: a queued turn is extracted on its own session route, not on whichever session assembled last',async()=>{
 seq=0;const routes={A:route('A'),B:route('B')},evs=[],{dir,engine,calls}=engineWith({routeOf:sid=>routes[sid],out:{lessons:[]}}),A=sessionOf(evs,'A')
 try{
  failingTurn(engine,A,evs,1);routes.B=route('B2')              // session B keeps assembling with another model
  feed(engine,A,evs,ev('turn/start',{turn:2}));feed(engine,A,evs,ev('user/message',{turn:2,content:[{type:'text',text:'next'}]}));await engine.idle()
  assert.deepEqual(calls[0].opts.route,route('A'))
  // The route is data on the queue entry, so it survives a restart.
  failingTurn(engine,A,evs,3);assert.deepEqual(engine.store.state.queue[0].route,route('A'))
 }finally{engine.dispose();rmSync(dir,{recursive:true,force:true})}
})
test('F02: without any route the turn is skipped explicitly instead of borrowing another route',async()=>{
 seq=0;const evs=[],{dir,engine,calls}=engineWith({routeOf:()=>null}),sess=sessionOf(evs)
 try{failingTurn(engine,sess,evs,1);feed(engine,sess,evs,ev('turn/start',{turn:2}));feed(engine,sess,evs,ev('user/message',{turn:2,content:[{type:'text',text:'x'}]}));await engine.idle();assert.equal(calls.length,0);assert.equal(engine.stats.skipped,1)}
 finally{engine.dispose();rmSync(dir,{recursive:true,force:true})}
})
test('F02: through the real plugin, interleaved sessions with different models keep their own route',async t=>{
 seq=0;const dir=mk(),rows=[],listeners=new Map(),prompts=[]
 const mkSession=id=>({id,header:{cwd:'/fixture/'+id},get seq(){return rows.length},snapshotEvents:(a,b)=>rows.filter(e=>e.seq>=a&&e.seq<b)})
 const sessions={A:mkSession('A'),B:mkSession('B')}
 const llm={stream:async function*(req){prompts.push({provider:req.provider,model:req.model});yield {type:'text-delta',index:0,text:'{"lessons":[]}'};yield {type:'finish',reason:{kind:'stop'}}}}
 const services={sessions:{get:id=>sessions[id]},llm,agentDefaultModel:{currentSelection:()=>({provider:'default',model:'default'})},tools:{register(){}}}
 const ctx={get:n=>services[n],provide:(n,v)=>services[n]=v,effect:f=>f(),on:(n,f)=>{(listeners.get(n)??listeners.set(n,[]).get(n)).push(f);return()=>{}}}
 await apply(ctx,{dir,injectMode:'off',verbose:false,lessons:{enabled:true,holdoutRate:0,idleMs:3600000}})
 const api=services.mnemo;t.after(async()=>{await api.detach();rmSync(dir,{recursive:true,force:true})})
 const emit=(s,type,data)=>{const e={type,seq:rows.length,time:1,data};rows.push(e);for(const fn of listeners.get('session/event')??[])fn(s,e);return e}
 const assemble=async(s,options)=>{for(const fn of listeners.get('system-prompt/assemble')??[])await fn({contexts:[]},{agent:{session:s,options}},async()=>({contexts:[]}))}
 await assemble(sessions.A,{provider:'provA',model:'mA'})
 for(const [type,data] of [['turn/start',{turn:1}],['user/message',{turn:1,content:[{type:'text',text:'go'}]}],['tool/call',{turn:1,callId:'c1',name:'edit',arguments:'{}'}],['tool/result',{turn:1,message:{toolCallId:'c1',isError:true,content:[{type:'text',text:'Error: cannot modify "a": file has not been read'}]}}],['tool/call',{turn:1,callId:'c2',name:'edit',arguments:'{}'}],['tool/result',{turn:1,message:{toolCallId:'c2',isError:false,content:[{type:'text',text:'ok'}]}}],['turn/end',{turn:1,reason:{kind:'completed'}}]])emit(sessions.A,type,data)
 await assemble(sessions.B,{provider:'provB',model:'mB'})       // another session assembles in between
 emit(sessions.A,'turn/start',{turn:2});emit(sessions.A,'user/message',{turn:2,content:[{type:'text',text:'next'}]});await api.lessons.idle()
 assert.deepEqual(prompts,[{provider:'provA',model:'mA'}])
})

// ---------- F03 ----------
test('F03: project advice cannot be merged into a tool lesson or another project, seeds are never rewritten',async()=>{
 const {dir,store,engine,calls}=engineWith()
 try{
  const tool=store.upsert(lesson({scope:'tool',tool:'edit',trigger:'tool level trigger words',advice:'tool level advice text here'}),{scopeHash:'A',sourceRef:{}})
  const projB=store.upsert(lesson({signature:'sig2',trigger:'project b trigger words',advice:'project b advice text here'}),{scopeHash:'B',sourceRef:{}})
  const seed=store.upsert(lesson({signature:'sig3',scope:'tool',tool:'edit',trigger:'seed trigger words one',advice:'seed advice text number one'}),{scopeHash:'A',sourceRef:{}});seed.seed=true
  const complement=id=>({relation:'complement',targetId:id,mergedAdvice:'merged advice from the candidate'})
  engine.generate=async()=>complement(tool.id)
  assert.equal(await engine._reconcile(lesson({scope:'project',trigger:'b only trigger',advice:'b only advice text here'}),'B',{}),null,'project candidate never merges into a tool lesson')
  assert.equal(tool.advice,'tool level advice text here')
  engine.generate=async()=>complement(projB.id)
  assert.equal(await engine._reconcile(lesson({signature:'sig2',trigger:'other project trig',advice:'other project advice text'}),'C',{}),null,'nor into another project')
  assert.equal(projB.advice,'project b advice text here')
  assert.equal((await engine._reconcile(lesson({signature:'sig2',trigger:'same project trig',advice:'same project different advice'}),'B',{})).needsHuman,true,'same project comparisons are review proposals, never unchecked edits')
  assert.equal(projB.advice,'project b advice text here')
  engine.generate=async()=>complement(seed.id)
  assert.equal(await engine._reconcile(lesson({signature:'sig3',scope:'tool',tool:'edit',trigger:'seed attempt trig',advice:'attempt to rewrite the seed'}),'A',{}),null);assert.equal(seed.advice,'seed advice text number one')
  engine.generate=async()=>({relation:'conflict',targetId:'not-in-list'})
  assert.equal(await engine._reconcile(lesson({scope:'tool',tool:'edit',trigger:'zzz unrelated trig',advice:'zzz unrelated advice text'}),'A',{}),null);assert.equal(tool.state,'active','an invented targetId is ignored')
  assert.ok(calls.length===0)
 }finally{engine.dispose();rmSync(dir,{recursive:true,force:true})}
})

// ---------- F04 ----------
test('F04: after a similar-error recall, the actual error recurring is counted (injected and holdout)',()=>{
 for(const holdout of [false,true]){
  seq=0;const evs=[],{dir,store,engine}=engineWith({},{holdoutRate:holdout?1:0}),sess=sessionOf(evs)
  try{
   const old=signatureOf('read','Error: no such file or directory, open "/x"')
   store.upsert(lesson({signature:old.signature,errorClass:'not-found',trigger:'read 报 no such file or directory',advice:'check the path exists first'}),{scopeHash:'P',sourceRef:{}})
   const now=signatureOf('read','ENOENT: no such file or directory, open "/y"');assert.notEqual(now.signature,old.signature)
   for(const e of [ev('turn/start',{turn:1}),call(1,'a','read'),result(1,'a','ENOENT: no such file or directory, open "/y"',true)])feed(engine,sess,evs,e)
   assert.equal(engine.recallOnError('s1','P').length,holdout?0:1)
   for(const e of [call(1,'b','read'),result(1,'b','ENOENT: no such file or directory, open "/z"',true)])feed(engine,sess,evs,e)
   const g=store.state.metrics[holdout?'holdout':'injected']
   assert.equal(g.exposures,1);assert.equal(g.recurs,1)
   if(!holdout)assert.equal(store.list()[0].stats.recurAfterInject,1)
   // an unrelated error does not count
   for(const e of [call(1,'c','bash'),result(1,'c','Error: Action guard: not-approved',true)])feed(engine,sess,evs,e)
   assert.equal(g.recurs,1)
  }finally{engine.dispose();rmSync(dir,{recursive:true,force:true})}
 }
})
test('F10: several lessons for one failure are one exposure, and sessions are the reported unit',()=>{
 seq=0;const evs=[],{dir,store,engine}=engineWith(),sess=sessionOf(evs)
 try{
  const s=signatureOf('edit','error: cannot modify "a": file has not been read')
  for(const [trig,adv] of [['edit 报 file has not been read','先读取目标文件再执行修改'],['unread document write rejected','always open the document before saving changes']]) store.upsert(lesson({signature:s.signature,errorClass:s.errorClass,trigger:trig,advice:adv}),{scopeHash:'P',sourceRef:{}})
  for(const e of [ev('turn/start',{turn:1}),call(1,'a','edit'),result(1,'a','error: cannot modify "a": file has not been read',true)])feed(engine,sess,evs,e)
  assert.equal(engine.recallOnError('s1','P').length,2)
  for(const e of [call(1,'b','edit'),result(1,'b','error: cannot modify "q": file has not been read',true),call(1,'c','edit'),result(1,'c','error: cannot modify "r": file has not been read',true)])feed(engine,sess,evs,e)
  const r=engine.report().metrics.injected
  assert.equal(r.exposures,1);assert.equal(r.recurs,1);assert.equal(r.sessions,1);assert.equal(r.sessionsWithRecurrence,1)
  assert.deepEqual(store.list().map(l=>l.stats.recurAfterInject),[1,1],'per-lesson counters still advance')
 }finally{engine.dispose();rmSync(dir,{recursive:true,force:true})}
})

// ---------- F05 ----------
test('F05: a human retire is not overwritten by the running engine, and nothing else is lost',()=>{
 const dir=mk(),engineStore=new LessonStore({directory:dir,limits:{refreshMs:0}})
 try{
  const keep=engineStore.upsert(lesson({signature:'k',trigger:'keep trigger words one',advice:'keep advice text number'}),{scopeHash:'P',sourceRef:{}})
  const target=engineStore.upsert(lesson({signature:'t',trigger:'target trigger words',advice:'target advice text number'}),{scopeHash:'P',sourceRef:{}});engineStore.save()
  const tool=new LessonStore({directory:dir})
  tool.update((state,s)=>s.setState(state.lessons[target.id],'retired','audit',{retiredAt:s.now(),retiredBy:'audit'}))
  const added=engineStore.upsert(lesson({signature:'n',trigger:'new trigger words here',advice:'new advice text number'}),{scopeHash:'P',sourceRef:{}})
  keep.stats.injected=3                                         // engine-side statistics keep flowing
  engineStore.save()                                            // refresh -> adopt retire -> write
  assert.equal(engineStore.state.lessons[target.id].state,'retired')
  const reloaded=new LessonStore({directory:dir})
  assert.equal(reloaded.state.lessons[target.id].state,'retired');assert.ok(reloaded.state.lessons[added.id]);assert.equal(reloaded.state.lessons[keep.id].stats.injected,3)
  assert.equal(existsSync(join(dir,'lessons.json.lock')),false,'lock released')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

// ---------- F06 ----------
test('F06: a lesson suspended mid-turn disappears from the next assembly',()=>{
 const {dir,store,engine}=engineWith({},{openingChars:600})
 try{
  store.upsert(lesson({signature:'s1',trigger:'CSV 合并 join 外键',advice:'先查重外键再合并'}),{scopeHash:'P',sourceRef:{}})
  const first=engine.contextFor('s','P','请帮我做 CSV 合并 join 外键');assert.match(first,/先查重外键/)
  const l=store.list()[0];l.stats.injected=5;l.stats.recurAfterInject=4;engine._maybeSuspend(l);assert.equal(l.state,'suspended')
  assert.equal(engine.contextFor('s','P','请帮我做 CSV 合并 join 外键'),'')
  const other=engineWith({},{});other.store.upsert(lesson({trigger:'CSV 合并 join 外键',advice:'先查重外键再合并'}),{scopeHash:'P',sourceRef:{}});other.engine.contextFor('s','P','请帮我做 CSV 合并 join 外键')
  other.store.list()[0].state='retired'
  assert.equal(other.engine.contextFor('s','P','请帮我做 CSV 合并 join 外键'),'');other.engine.dispose();rmSync(other.dir,{recursive:true,force:true})
  assert.equal(engine.contextFor('s','Q','请帮我做 CSV 合并 join 外键'),'','a different project never sees it')
 }finally{engine.dispose();rmSync(dir,{recursive:true,force:true})}
})

// ---------- F07 ----------
test('F07: persisted queue entries are re-armed after a restart (due now, not yet due, stale, budget exhausted)',async()=>{
 const dir=mk(),calls=[];let clock=1_700_000_000_000
 const build=(cfg={})=>{const store=new LessonStore({directory:dir,now:()=>clock,limits:cfg});return {store,engine:new LessonsEngine({store,now:()=>clock,generate:async(s,p,o)=>{calls.push(o.route);return {lessons:[]}},config:{enabled:true,holdoutRate:0,...cfg}})}}
 const pack={goal:'g',window:[],failures:[{signature:'s',tool:'edit',errorClass:'x',seq:1,fixed:true}],recovered:true,finalAnswer:'',nextUserMessage:null,truncated:{window:0,failures:0}}
 const entry=(id,ageMs)=>({id,sid:'S',scope:'P',turn:1,at:clock-ageMs,route:route('Q'),failed:true,toolCalls:2,repeat:false,pack})
 try{
  const seed=new LessonStore({directory:dir,now:()=>clock});seed.state.queue=[entry('due',700000),entry('later',100000),entry('stale',9*86400000)];seed.save()
  const {store,engine}=build({idleMs:600000,maxCallsPerDay:5})
  assert.ok(!store.state.queue.some(e=>e.id==='stale'),'stale entry dropped');assert.equal(store.state.queue.length,2)
  await new Promise(r=>setTimeout(r,60));await engine.idle()
  assert.equal(calls.length,1,'only the overdue entry ran');assert.deepEqual(calls[0],route('Q'));assert.deepEqual(store.state.queue.map(e=>e.id),['later'])
  engine.dispose()
  // budget exhausted: the entry is kept, not lost
  const exhausted=new LessonStore({directory:dir,now:()=>clock});exhausted.state.queue=[entry('b1',900000)];exhausted.state.calls={day:Math.floor(clock/86400000),n:5};exhausted.save()
  const e2=build({idleMs:600000,maxCallsPerDay:5});await new Promise(r=>setTimeout(r,60));await e2.engine.idle()
  assert.equal(calls.length,1);assert.equal(e2.store.state.queue.length,1);assert.equal(e2.engine.stats.deferred,1);e2.engine.dispose()
 }finally{rmSync(dir,{recursive:true,force:true})}
})

// ---------- F14 ----------
test('F14: the serialized evidence respects its budget even with many failures and long inputs',()=>{
 seq=0;const evs=[ev('turn/start',{turn:1}),ev('user/message',{content:[{type:'text',text:'G'.repeat(5000)}]})]
 for(let i=0;i<100;i++)evs.push(call(1,'c'+i,'tool'+(i%40),{i}),result(1,'c'+i,`Error: distinct failure number ${i} `+'x'.repeat(300+i),true))
 evs.push(ev('assistant/message',{content:[{type:'text',text:'F'.repeat(3000)}]}))
 for(const maxChars of [6000,2500,1200]){
  const pack=buildEvidence(evs,{maxChars,nextUser:'N'.repeat(2000)})
  assert.ok(JSON.stringify(pack).length<=maxChars,`budget ${maxChars}`)
  assert.ok(pack.failures.length<=12);assert.ok(pack.truncated.failures>0||pack.failures.length<=12)
  assert.ok(pack.failures.every(f=>pack.window.some(w=>w.failed&&w.tool===f.tool)||pack.window.length===0),'cited signatures are backed by retained rows')
 }
})

// ---------- D01 ----------
test('D01: only verified same-target tool contracts become usable; the rest wait as candidates',async()=>{
 const cases=[
  {name:'verified low-risk fix',tool:'edit',fixTool:'edit',out:l=>l,state:'active'},
  {name:'recovery by a different tool does not verify',tool:'edit',fixTool:'read',out:l=>l,state:'candidate',reason:'no-verified-recovery'},
  {name:'low confidence without a verified read',tool:'edit',fixTool:'edit',read:false,out:l=>({...l,confidence:'low'}),state:'candidate',reason:'no-verified-recovery'},
  {name:'method',tool:'edit',fixTool:'edit',out:l=>({...l,type:'method',signature:undefined}),state:'candidate',reason:'unverified-method'},
  {name:'risky advice',tool:'edit',fixTool:'edit',out:l=>({...l,advice:'先 sudo rm -rf 目标目录再重试'}),state:'candidate',reason:'risky-advice',human:true},
 ]
 for(const c of cases){
  seq=0;const evs=[],sess=sessionOf(evs),dir=mk(),store=new LessonStore({directory:dir}),text='error: cannot modify "a": file has not been read'
  const sig=signatureOf(c.tool,text).signature
  const engine=new LessonsEngine({store,routeOf:()=>route('A'),generate:async()=>({lessons:[c.out({type:'fix',signature:sig,trigger:'edit 报 file has not been read',advice:'先 read 再 edit',scope:'project',confidence:'high'})]}),config:{enabled:true,holdoutRate:0,reconcile:false,idleMs:3600000}})
  try{
   failingTurn(engine,sess,evs,1,{tool:c.tool,fixTool:c.fixTool,text,read:c.read!==false});feed(engine,sess,evs,ev('turn/start',{turn:2}));feed(engine,sess,evs,ev('user/message',{turn:2,content:[{type:'text',text:'next'}]}));await engine.idle()
   const l=store.list()[0];assert.ok(l,c.name);assert.equal(l.state,c.state,c.name)
   if(c.reason)assert.equal(l.review.reason,c.reason,c.name)
   if(c.human)assert.equal(l.review.needsHuman,true)
   if(c.state==='candidate')assert.equal(engine.contextFor('s1','P','edit file has not been read'),'','candidates are never injected')
  }finally{engine.dispose();rmSync(dir,{recursive:true,force:true})}
 }
})
test('D01: repeated candidates remain unverified; human approval is a separate operation',()=>{
 const dir=mk(),store=new LessonStore({directory:dir})
 try{
  const base=lesson({signature:'s1',trigger:'edit file has not been read',advice:'read the file first then edit'})
  const c=store.upsert(base,{scopeHash:'P',sourceRef:{sessionId:'a',turn:1},status:'candidate',review:{needsHuman:false,reason:'x'}})
  store.upsert(base,{scopeHash:'P',sourceRef:{sessionId:'a',turn:1},status:'candidate'});assert.equal(c.state,'candidate','the same source twice is not independent')
  store.upsert(base,{scopeHash:'P',sourceRef:{sessionId:'b',turn:4},status:'candidate'});assert.equal(c.state,'candidate');assert.equal(c.promotedBy,undefined)
  const risky=lesson({signature:'s2',trigger:'cleanup trigger words',advice:'sudo rm -rf the cache dir'})
  const r=store.upsert(risky,{scopeHash:'P',sourceRef:{sessionId:'a',turn:1},status:'candidate',review:{needsHuman:true}})
  for(const sid of ['b','c','d'])store.upsert(risky,{scopeHash:'P',sourceRef:{sessionId:sid,turn:2},status:'candidate'})
  assert.equal(r.state,'candidate','risky advice waits for a human')
  store.save();const audit=join(dir,'audit.md');writeFileSync(audit,`- [x] approve ${r.id}\n`)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('D01: scanFailures records same-target same-tool recovery as supporting evidence',()=>{
 seq=0;const evs=[ev('turn/start',{turn:1}),call(1,'a','edit',{path:'a'}),result(1,'a','error: cannot modify "a": file has not been read',true),call(1,'b','read',{path:'a'}),result(1,'b','ok')]
 const r=scanFailures(evs);assert.equal(r.successAfter,true);assert.equal(r.failures[0].fixed,false,'a read success does not prove the edit was fixed')
 evs.push(call(1,'c','edit',{path:'a'}),result(1,'c','ok'));assert.equal(scanFailures(evs).failures[0].fixed,true)
})
