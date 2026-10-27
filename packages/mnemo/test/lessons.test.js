import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {normalizeError,signatureOf,scanFailures} from '../lib/lessons-signature.js'
import {LessonStore,LessonsEngine,buildEvidence,buildQuery} from '../lib/lessons.js'

const mk=()=>mkdtempSync(join(tmpdir(),'lessons-'))
let seq=0
const ev=(type,data={})=>({type,seq:++seq,time:Date.now(),data})
function session(events){return {id:'s1',header:{cwd:'/p'},get seq(){return seq},snapshotEvents:(a,b)=>events.filter(e=>e.seq>=a&&e.seq<=b)}}
const call=(turn,id,name,args)=>ev('tool/call',{turn,callId:id,name,arguments:JSON.stringify(args)})
const result=(turn,id,text,isError=false)=>ev('tool/result',{turn,message:{role:'tool',toolCallId:id,isError,content:[{type:'text',text}]}})

test('normalizeError maps variants to one skeleton',()=>{
 assert.equal(normalizeError('Error: cannot open /workspace/a/x.txt (line 12)'),normalizeError('Error: cannot open /srv/b/y.txt (line 99)'))
 assert.notEqual(normalizeError('TypeError: x is not a function'),normalizeError('ENOENT: no such file'))
 assert.equal(signatureOf('edit','a')?.signature.length,24)
 assert.equal(signatureOf('edit',''),null)
})

test('bash bare exit code is disambiguated by command head',()=>{
 const a=signatureOf('bash','[exit code: 1]','grep'),b=signatureOf('bash','[exit code: 2]','ls')
 assert.notEqual(a.signature,b.signature)
 assert.equal(a.errorClass,'exit-code')
})

test('scanFailures finds failure and later success',()=>{
 seq=0;const t=1,evs=[ev('turn/start',{turn:t}),call(t,'a','edit',{}),result(t,'a','error: cannot modify "x": file has not been read',true),call(t,'b','read',{}),result(t,'b','ok'),call(t,'c','edit',{}),result(t,'c','done')]
 const r=scanFailures(evs)
 assert.equal(r.failures.length,1);assert.equal(r.failures[0].tool,'edit');assert.equal(r.successAfter,true)
})

test('buildEvidence is bounded and scrubs secrets',()=>{
 seq=0;const t=1,evs=[ev('turn/start',{turn:t}),ev('user/message',{content:[{type:'text',text:'do it api_key=sk-abcdefghijklmnop1234'}]})]
 for(let i=0;i<30;i++){evs.push(call(t,'c'+i,'bash',{command:'ls '+i}),result(t,'c'+i,'x'.repeat(2000),i===15))}
 const pack=buildEvidence(evs,{maxChars:3000}),text=JSON.stringify(pack)
 assert.ok(text.length<=3200);assert.ok(!text.includes('sk-abcdefghijklmnop'));assert.ok(pack.failures.length===1)
})

function setup(generate,cfg={}){
 const dir=mk(),store=new LessonStore({directory:dir}),engine=new LessonsEngine({store,generate,routeOf:()=>({provider:'p',model:'m'}),config:{enabled:true,holdoutRate:0,idleMs:60000,...cfg}})
 return {dir,store,engine}
}
function failingTurn(evs,t,errText='error: cannot modify "x": file has not been read'){
 evs.push(ev('turn/start',{turn:t}),call(t,'a'+t,'edit',{path:'x'}),result(t,'a'+t,errText,true),call(t,'b'+t,'read',{path:'x'}),result(t,'b'+t,'ok'),call(t,'c'+t,'edit',{path:'x'}),result(t,'c'+t,'done'),ev('assistant/message',{content:[{type:'text',text:'done'}]}))
}

test('end-to-end: failure turn -> extraction on next user message -> recall on error',async()=>{
 seq=0;const evs=[],sess=session(evs);let calls=0
 const sig=signatureOf('edit','error: cannot modify "x": file has not been read').signature
 const {dir,store,engine}=setup(async(system,pack)=>{calls++;return {lessons:[{type:'fix',signature:pack.failures[0].signature,trigger:'edit 报 file has not been read',advice:'先 read 目标文件再 edit',scope:'tool',tool:'edit',confidence:'high'},{type:'fix',signature:'bogus',trigger:'bad bad bad',advice:'should be dropped'}]}})
 try{
  failingTurn(evs,1);for(const e of evs)engine.observe(sess,e,{scope:'P'})
  evs.push(ev('turn/end',{turn:1,reason:{kind:'completed'}}));engine.observe(sess,evs.at(-1),{scope:'P'})
  assert.equal(store.state.queue.length,1)
  const next=ev('turn/start',{turn:2});evs.push(next);engine.observe(sess,next,{scope:'P'})
  const um=ev('user/message',{content:[{type:'text',text:'继续下一个任务'}]});evs.push(um);engine.observe(sess,um,{scope:'P'})
  await engine.idle()
  assert.equal(calls,1);assert.equal(store.list().length,1);assert.equal(store.list()[0].signature,sig)
  // New turn: same error occurs -> lesson recalled
  const t=3;evs.push(ev('turn/start',{turn:t}),call(t,'z','edit',{}));engine.observe(sess,evs.at(-2),{scope:'P'});engine.observe(sess,evs.at(-1),{scope:'P'})
  const r=result(t,'z','error: cannot modify "y": file has not been read',true);evs.push(r);engine.observe(sess,r,{scope:'P'})
  const got=engine.recallOnError('s1','P');assert.equal(got.length,1)
  assert.match(LessonsEngine.formatError(got),/先 read/)
  assert.equal(engine.recallOnError('s1','P').length,0,'error consumed once')
  // Recurrence after injection is counted
  const c2=call(t,'z2','edit',{});evs.push(c2);engine.observe(sess,c2,{scope:'P'});const r2=result(t,'z2','error: cannot modify "q": file has not been read',true);evs.push(r2);engine.observe(sess,r2,{scope:'P'})
  assert.equal(store.list()[0].stats.recurAfterInject,1);assert.equal(store.list()[0].stats.injected,1)
 }finally{engine.dispose();rmSync(dir,{recursive:true,force:true})}
})

test('no extraction without trigger reasons, optOut, or when disabled',async()=>{
 seq=0;const evs=[],sess=session(evs);let calls=0
 const {dir,store,engine}=setup(async()=>{calls++;return {lessons:[]}})
 try{
  // Clean turn with 2 tool calls and no failure/correction -> skipped at drain
  const t=1;evs.push(ev('turn/start',{turn:t}),call(t,'a','read',{}),result(t,'a','ok'),call(t,'b','read',{}),result(t,'b','ok'));for(const e of evs)engine.observe(sess,e,{scope:'P'})
  evs.push(ev('turn/end',{turn:t,reason:{kind:'completed'}}));engine.observe(sess,evs.at(-1),{scope:'P'})
  for(const e of [ev('turn/start',{turn:2}),ev('user/message',{content:[{type:'text',text:'thanks'}]})]){evs.push(e);engine.observe(sess,e,{scope:'P'})}
  await engine.idle();assert.equal(calls,0)
  // optOut
  const t3=3;failingTurn(evs,t3);for(const e of evs.filter(e=>e.data.turn===t3))engine.observe(sess,e,{scope:'P'})
  const end=ev('turn/end',{turn:t3,reason:{kind:'completed'}});evs.push(end);engine.observe(sess,end,{scope:'P',optOut:true})
  assert.equal(store.state.queue.length,0)
 }finally{engine.dispose();rmSync(dir,{recursive:true,force:true})}
 const off=setup(async()=>({lessons:[]}),{enabled:false});off.engine.observe(sess,ev('turn/end',{turn:9,reason:{kind:'completed'}}),{scope:'P'})
 assert.equal(off.store.state.queue.length,0);rmSync(off.dir,{recursive:true,force:true})
})

test('merge, per-signature cap and suspension on recurrence',()=>{
 const dir=mk(),store=new LessonStore({directory:dir})
 try{
  const base={type:'fix',signature:'sigA',trigger:'edit file has not been read',advice:'read file before edit',scope:'project',tool:null,confidence:'med',errorClass:null}
  const a=store.upsert(base,{scopeHash:'P',sourceRef:{}});const b=store.upsert({...base},{scopeHash:'P',sourceRef:{}})
  assert.equal(a.id,b.id);assert.equal(a.stats.support,2)
  for(const adv of ['totally different thing one alpha','second different thing beta gamma','third unrelated delta epsilon zeta']){store.upsert({...base,trigger:adv+' trig',advice:adv},{scopeHash:'P',sourceRef:{}})}
  assert.ok(store.list().filter(x=>x.signature==='sigA').length<=3)
  const engine=new LessonsEngine({store,generate:async()=>({}),config:{enabled:true,holdoutRate:0}})
  a.stats.injected=6;a.stats.recurAfterInject=4;engine._maybeSuspend(a);assert.equal(a.state,'suspended')
  assert.equal(engine._visible(a,'P'),false)
  store.save();assert.equal(new LessonStore({directory:dir}).list().length,store.list().length)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('opening recall is scoped, once per turn, and budgeted',()=>{
 const dir=mk(),store=new LessonStore({directory:dir})
 try{
  store.upsert({type:'pitfall',signature:'s1',trigger:'CSV 合并 join 外键',advice:'先查重外键再合并',scope:'project',tool:null,confidence:'high',errorClass:null},{scopeHash:'P',sourceRef:{}})
  store.upsert({type:'pitfall',signature:'s2',trigger:'CSV 合并 join 外键 其他项目',advice:'不应出现',scope:'project',tool:null,confidence:'high',errorClass:null},{scopeHash:'Q',sourceRef:{}})
  const engine=new LessonsEngine({store,generate:async()=>({}),config:{enabled:true,holdoutRate:0}})
  const got=engine.recallOpening('s','P','请帮我做 CSV 合并 join 外键');assert.equal(got.length,1);assert.equal(got[0].signature,'s1')
  assert.equal(engine.recallOpening('s','P','请帮我做 CSV 合并 join 外键').length,0)
  assert.match(LessonsEngine.formatOpening(got),/先查重外键/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('contextFor re-renders lessons across assemblies within a turn',()=>{
 const dir=mk(),store=new LessonStore({directory:dir})
 try{
  store.upsert({type:'pitfall',signature:'s1',trigger:'CSV 合并 join 外键',advice:'先查重外键再合并',scope:'project',tool:null,confidence:'high',errorClass:null},{scopeHash:'P',sourceRef:{}})
  const engine=new LessonsEngine({store,generate:async()=>({}),config:{enabled:true,holdoutRate:0}})
  const a=engine.contextFor('s','P','请帮我做 CSV 合并 join 外键'),b=engine.contextFor('s','P','请帮我做 CSV 合并 join 外键')
  assert.match(a,/先查重外键/);assert.equal(a,b);assert.equal(store.list()[0].stats.injected,1)
  engine.observe({id:'s',snapshotEvents:()=>[]},ev('turn/start',{turn:99}),{scope:'P'})
  assert.equal(engine.contextFor('s','P','无关内容'),'')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('holdout sessions get no injection but shadow recurrence is measured',()=>{
 seq=0;const dir=mk(),store=new LessonStore({directory:dir})
 try{
  const sig=signatureOf('edit','error: cannot modify "x": file has not been read').signature
  store.upsert({type:'fix',signature:sig,trigger:'edit file has not been read',advice:'read first then edit',scope:'project',tool:null,confidence:'high',errorClass:'other'},{scopeHash:'P',sourceRef:{}})
  const engine=new LessonsEngine({store,generate:async()=>({}),config:{enabled:true,holdoutRate:1}})
  const evs=[],sess=session(evs);const t=1
  for(const e of [ev('turn/start',{turn:t}),call(t,'a','edit',{}),result(t,'a','error: cannot modify "p": file has not been read',true)]){evs.push(e);engine.observe(sess,e,{scope:'P'})}
  assert.equal(engine.recallOnError('s1','P').length,0)
  assert.equal(store.list()[0].stats.injected,0);assert.equal(store.state.metrics.holdout.exposures,1)
  for(const e of [call(t,'b','edit',{}),result(t,'b','error: cannot modify "q": file has not been read',true)]){evs.push(e);engine.observe(sess,e,{scope:'P'})}
  assert.equal(store.state.metrics.holdout.recurs,1);assert.equal(store.state.metrics.injected.exposures,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('tool-level lessons need two projects (or a seed) before crossing projects',()=>{
 const dir=mk(),store=new LessonStore({directory:dir})
 try{
  const base={type:'pitfall',signature:'sigT',trigger:'run_code require is not defined',advice:'use await import instead of require',scope:'tool',tool:'run_code',confidence:'med',errorClass:null}
  const l=store.upsert(base,{scopeHash:'P',sourceRef:{}})
  const engine=new LessonsEngine({store,generate:async()=>({}),config:{enabled:true,holdoutRate:0}})
  assert.equal(engine._visible(l,'P'),true);assert.equal(engine._visible(l,'Q'),false)
  store.upsert({...base},{scopeHash:'Q',sourceRef:{}})
  assert.equal(engine._visible(l,'Q'),true);assert.equal(engine._visible(l,'Z'),true)
  const seed=store.upsert({...base,signature:'sigS',trigger:'seeded one two',advice:'seed advice text'},{scopeHash:'P',sourceRef:{seed:true}});seed.seed=true
  assert.equal(engine._visible(seed,'Z'),true)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('store.refresh merges lessons written to disk by another writer',()=>{
 const dir=mk(),a=new LessonStore({directory:dir,limits:{refreshMs:0}})
 try{
  a.upsert({type:'pitfall',signature:'s1',trigger:'first lesson trigger',advice:'first advice text',scope:'project',tool:null,confidence:'low',errorClass:null},{scopeHash:'P',sourceRef:{}});a.save()
  const b=new LessonStore({directory:dir,limits:{refreshMs:0}})
  b.state.lessons['imported-example']={id:'imported-example',state:'active',seed:true,scope:'tool',tool:'x',trigger:'t seed',advice:'a seed advice',type:'pitfall',signature:'sX',stats:{support:3,injected:0,recurAfterInject:0},confidence:'high',lastSeen:1,sourceRefs:[],projects:[]};b.save()
  assert.equal(a.refresh(true),1);assert.ok(a.state.lessons['imported-example']);assert.equal(a.list().length,2)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('reconcile: generated conflicts and complements become review proposals without changing live advice',async()=>{
 const dir=mk(),store=new LessonStore({directory:dir})
 try{
  const old=store.upsert({type:'fix',signature:'sigC',trigger:'tool fails on parse',advice:'retry the same call twice',scope:'project',tool:null,confidence:'low',errorClass:null},{scopeHash:'P',sourceRef:{}})
  const engine=new LessonsEngine({store,generate:async()=>({relation:'conflict',targetId:old.id}),config:{enabled:true,holdoutRate:0}})
  const verdict=await engine._reconcile({signature:'sigC',trigger:'parse failure from tool',advice:'validate the input schema before calling',scope:'project'},'P')
  assert.equal(verdict.relation,'conflict');assert.equal(verdict.needsHuman,true);assert.equal(old.state,'active')
  const merge=new LessonsEngine({store,generate:async()=>({relation:'complement',targetId:old.id,mergedAdvice:'validate input then call'}),config:{enabled:true,holdoutRate:0}})
  old.state='active'
  assert.equal((await merge._reconcile({signature:'sigC',trigger:'other words entirely',advice:'something quite different here',scope:'project'},'P')).relation,'complement')
  assert.equal(old.advice,'retry the same call twice')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('injections are logged without lesson text',()=>{
 const dir=mk(),store=new LessonStore({directory:dir})
 try{
  store.upsert({type:'pitfall',signature:'s1',trigger:'CSV 合并 join 外键',advice:'先查重外键再合并',scope:'project',tool:null,confidence:'high',errorClass:null},{scopeHash:'P',sourceRef:{}})
  const engine=new LessonsEngine({store,generate:async()=>({}),config:{enabled:true,holdoutRate:0}})
  engine.contextFor('s','P','请帮我做 CSV 合并 join 外键')
  const lines=readFileSync(join(dir,'injections.jsonl'),'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(lines.length,1);assert.equal(lines[0].kind,'opening');assert.ok(!JSON.stringify(lines[0]).includes('先查重'))
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('expiry retires unused weak lessons, keeps seeds and well-supported ones, then purges',()=>{
 const dir=mk();let clock=1_000_000_000_000
 const store=new LessonStore({directory:dir,now:()=>clock,limits:{expireDays:60,purgeDays:30}})
 try{
  const mk1=(sig,adv)=>store.upsert({type:'pitfall',signature:sig,trigger:'trigger '+sig+' words',advice:adv,scope:'project',tool:null,confidence:'low',errorClass:null},{scopeHash:'P',sourceRef:{}})
  const weak=mk1('w','weak advice alpha'),strong=mk1('s','strong advice beta');strong.stats.support=5
  const seed=mk1('d','seed advice gamma');seed.seed=true
  clock+=61*86400000;assert.equal(store.expire(),1);assert.equal(weak.state,'retired');assert.equal(strong.state,'active');assert.equal(seed.state,'active')
  clock+=86400000;assert.equal(store.expire(),0,'only sweeps once per day')
  clock+=31*86400000;store.expire();assert.equal(store.state.lessons[weak.id],undefined)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('buildQuery adds title and last answer only for short user messages',()=>{
 seq=0;const evs=[ev('session/title',{title:'CSV 合并'}),ev('assistant/message',{content:[{type:'text',text:'已完成 join 并输出 unmatched'}]}),call(1,'a','bash',{}),ev('turn/start',{turn:2})]
 const sess=session(evs)
 const short=buildQuery(sess,'继续'),long=buildQuery(sess,'请详细说明接下来需要如何处理这两份数据文件并给出完整的步骤、风险评估、回滚方案以及后续验证的注意事项和检查清单')
 assert.match(short,/CSV 合并/);assert.match(short,/unmatched/);assert.match(short,/bash/)
 assert.ok(!long.includes('unmatched'))
})
