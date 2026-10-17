import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,renameSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {apply} from '../index.js'
import {MemoryEngine} from '../lib/engine.js'
import {Maintenance} from '../lib/maintenance.js'
import {Backlog} from '../lib/backlog.js'
import {StagingArea} from '../lib/staging.js'
import {DshAdapter} from '../dsh-adapter.js'
import {acquireLock} from '../lib/lock.js'
import {Injector,estimateTokens} from '../lib/inject.js'

const scope='project:/tmp/mnemo-audit-A'
const hosts = new Map()
function temporary(t) {const dir=mkdtempSync(join(tmpdir(),'mnemo-all-fixes-'));t.after(async()=>{try{await hosts.get(dir)?.detach()}finally{hosts.delete(dir);rmSync(dir,{recursive:true,force:true})}});return dir}
function engine(t,config) {const e=new MemoryEngine({dir:temporary(t),config});e.setScope(scope);e.start('test');return e}
function gate() {let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
async function host(dir, config = {}) {
 let command;const provided={}, services={commands:{register(c){command=c}},sandboxPolicy:{workspaceRoot:'/tmp/mnemo-audit-A'}}
 await apply({get:n=>provided[n]??services[n],provide(n,v){provided[n]=v},effect:f=>f(),on:()=>()=>{},logger:{info(){}}},{dir,verbose:false,injectMode:'off',...config})
 const api=provided.mnemo;hosts.set(dir,api)
 return {api,run:(rawInput,extra={})=>command.handler({rawInput,agent:{id:'audit',session:{id:'audit',header:{cwd:'/tmp/mnemo-audit-A'}}},...extra})}
}
const draft=memories=>({text:'Derived orchard summary',citations:[{id:memories[0].id,quote:memories[0].text.slice(0,20)}]})

test('F01: in-flight same-target enqueue retains newer payload and independent identity',async()=>{
 const q=new Backlog(),g=gate();const a=q.enqueue({kind:'gist-compress',target:'a',payload:{scope,ids:['old']}}).item
 const run=q.drain({handler:async j=>{await g.promise;return j.payload.ids}})
 const b=q.enqueue({kind:'gist-compress',target:'a',payload:{scope,ids:['new']}}).item
 assert.notEqual(a.id,b.id);g.resolve();assert.deepEqual((await run).processed[0].outcome,['old'])
 assert.deepEqual(q.items.map(j=>j.payload.ids),[['new']])
 const c=q.enqueue({kind:'gist-compress',target:'a',payload:{scope,ids:['latest']}})
 assert.equal(c.merged,true);assert.deepEqual(q.items[0].payload.ids,['latest'])
})

test('F03: dequeue and same-millisecond enqueue cannot collide or remove another job',async()=>{
 const q=new Backlog();q.enqueue({kind:'gist-compress',target:'a',now:1});q.enqueue({kind:'gist-compress',target:'b',now:1})
 await q.drain({handler:()=>{},limit:1});q.enqueue({kind:'gist-compress',target:'c',now:1})
 assert.equal(new Set(q.items.map(j=>j.id)).size,2)
 await q.drain({handler:()=>{},limit:1});assert.equal(q.items.length,1);assert.equal(q.items[0].target,'c')
})

test('F01/F02/F07: actual maintain commands select requested kind and retain overlapping calls',async t=>{
 const h=await host(temporary(t));const e=h.api.engine
 const original=e.remember({text:'orchard source original words',scope,source:'human'})
 const skill=e.backlog.enqueue({kind:'skill-compile',target:'old-skill',payload:{scope,ids:[original.id],automatic:true}}).item
 const legacy=e.backlog.enqueue({kind:'gist-compress',target:'old-gist',payload:{ids:[original.id]}}).item
 const g=gate(),entered=gate();let calls=0
 h.api.maintenance.generate=async(_,{memories})=>{if(++calls===1){entered.resolve();await g.promise}return draft(memories)}
 const first=h.run('maintain summary');await entered.promise
 const next=e.remember({text:'orchard later source words',scope,source:'human'})
 const second=h.run('maintain summary');g.resolve()
 const results=await Promise.all([first,second]);assert.ok(results.every(r=>r.kind==='success'),JSON.stringify(results))
 assert.ok(e.backlog.items.some(j=>j.id===skill.id));assert.ok(e.log.proposals.has(legacy.id))
 assert.ok([...e.log.proposals.values()].some(p=>p.sourceRevisions.some(r=>r.id===next.id)))
 assert.ok([...e.log.proposals.values()].every(p=>p.proposalKind==='gist-compress'))
 const out=await h.run('maintain skill');assert.equal(out.kind,'success',out.text);assert.ok(e.log.proposals.has(skill.id))
})

test('F04: semantic failure and success return the post-await source and trust',async t=>{
 for(const fails of [true,false]) {
  const e=engine(t),source=e.remember({text:'orchard OLD source',scope,source:'agent'}),g=gate()
  const m=new Maintenance(e,async()=>{await g.promise;if(fails)throw Error('provider unavailable');return {ids:[source.id]}})
  const pending=m.semanticRecall('orchard',{scope})
  e.log.append({kind:'revise',id:source.id,text:'orchard NEW source'})
  e.review(source.id,'confirmed',{scope});g.resolve()
  const out=await pending;assert.equal(out[0].rawText,'orchard NEW source');assert.equal(out[0].trust,'confirmed');assert.ok(!out[0].text.includes('OLD'))
 }
})

test('F05: failed final checkpoint, approval and restart preserve immutable accepted proposal',async t=>{
 const dir=temporary(t);let h=await host(dir);
 h.api.engine.remember({text:'orchard source original words',scope,source:'human'})
 h.api.maintenance.generate=async(_,{memories})=>draft(memories)
 const checkpoint=h.api.engine.checkpoint.bind(h.api.engine);let writes=0
 h.api.engine.checkpoint=()=>{if(++writes>1)throw Error('disk full after proposal');return checkpoint()}
 assert.equal((await h.run('maintain summary')).kind,'error')
 const id=[...h.api.engine.log.proposals.keys()][0];assert.ok(id)
 assert.equal((await h.run('accept '+id)).kind,'success')
 try {await h.api.detach()}catch{}
 h=await host(dir);const e=h.api.engine
 assert.ok(!e.backlog.items.some(j=>j.id===id));assert.equal(e.log.proposals.get(id).status,'accepted')
 let calls=0;h.api.maintenance.generate=async()=>{calls++;throw Error('must not regenerate')}
 const result=await h.api.maintenance.process({id,kind:'gist-compress',payload:{ids:[]}},{scope})
 assert.equal(result.status,'accepted');assert.equal(calls,0)
 assert.throws(()=>e.log.append({...e.log.proposals.get(id),text:'OVERWRITE'}),/identity already exists/)
 assert.equal(e.log.proposals.get(id).text,'Derived orchard summary')
 assert.equal(e.log.alive(scope).filter(it=>it.evidence.some(ev=>ev.proposalId===id)).length,1)
})

test('F06: old project cannot approve a migrated proposal',async t=>{
 const h=await host(temporary(t));const e=h.api.engine
 e.remember({text:'orchard source original words',scope,source:'human'})
 h.api.maintenance.generate=async(_,{memories})=>draft(memories)
 assert.equal((await h.run('maintain summary')).kind,'success')
 const p=[...e.log.proposals.values()][0]
 e.log.append({kind:'scope-binding',legacy:scope,scope:'project:/tmp/other'})
 const out=await h.run('accept '+p.id);assert.equal(out.kind,'error');assert.match(out.text,/Unknown proposal in this project/);assert.equal(e.log.alive(scope).length,0)
 assert.equal(e.log.proposals.get(p.id).scope,'project:/tmp/other')
})

test('F08/F09: partial staging failure and stale checkpoint never duplicate touches and retain human provenance',t=>{
 const e=engine(t),now=Date.now();const existing=e.remember({text:'orchard original source',scope,source:'agent',now})
 const evidence=[{source:'human',at:now,sessionId:'human-turn'}]
 e.staging.offer({text:'orchard original source',scope,source:'human',affect:1,evidence,now})
 e.staging.offer({text:'second capture fails',scope,source:'human',affect:1,now})
 e.checkpoint();const append=e.log.append.bind(e.log)
 e.log.append=ev=>{if((ev.kind==='runtime-state'&&e.log.stagingReceipts.size>0)||ev.kind==='create')throw Error('disk failure');return append(ev)}
 assert.throws(()=>e.settleStaging({scope}),/disk failure/)
 const before=e.log.items.get(existing.id);assert.equal(before.touches,1);assert.equal(before.source,'human');assert.equal(before.trust,'reported');assert.deepEqual(before.evidence,evidence)
 const restarted=new MemoryEngine({dir:e.log.dir});restarted.setScope(scope);restarted.start('restart')
 const after=restarted.log.items.get(existing.id);assert.equal(after.touches,1);assert.equal(after.source,'human');assert.deepEqual(after.evidence,evidence)
 assert.equal(restarted.log.alive(scope).length,2);assert.equal(restarted.staging.pending.length,0)
})

test('F08: capture create receipt also survives stale pending checkpoint on restart',t=>{
 const e=engine(t),now=Date.now()
 for(const text of ['first synthetic capture','second synthetic capture'])e.staging.offer({text,scope,source:'human',affect:1,now})
 e.checkpoint();const append=e.log.append.bind(e.log)
 e.log.append=ev=>{if((ev.kind==='runtime-state'&&e.log.stagingReceipts.size>0)||(ev.kind==='create'&&ev.text.startsWith('second')))throw Error('disk failure');return append(ev)}
 assert.throws(()=>e.settleStaging({scope}),/disk failure/)
 const first=[...e.log.items.values()][0];assert.equal(first.touches,0)
 const restart=new MemoryEngine({dir:e.log.dir});restart.setScope(scope);restart.start('again')
 assert.equal(restart.log.items.get(first.id).touches,0);assert.equal(restart.log.items.size,2)
})

test('F10: noise suppression is project-local across serialization and legacy migration',()=>{
 const s=new StagingArea()

 for(const [scope,text] of [['A','alpha'],['A','beta'],['B','gamma'],['B','delta']])s.offer({scope,text,cues:['render'],source:'human',now:1})
 for(const legacy of [false,true]) {
  const json=structuredClone(s.toJSON());if(legacy)delete json.scopeStats
  const loaded=new StagingArea().load(json)
  assert.equal(loaded.settle({scope:'A',now:2}).captured.length,2)
 }
})

test('F11: real adapter propagates a tool failure into subsequent context assembly',t=>{
 const e=engine(t),a=new DshAdapter(e),events=[];t.after(()=>a.detach())
 const s={id:'adapter-session',header:{cwd:'/tmp/mnemo-audit-A'},get seq(){return events.length},snapshotEvents:(f,t)=>events.slice(f,t)}
 const push=(type,data)=>{const ev={type,data,seq:events.length,time:Date.now()};events.push(ev);a.handleSessionEvent({get:()=>null},s,ev)}
 push('turn/start',{turn:1});push('user/message',{source:{kind:'user'},content:[{type:'text',text:'hi'}]})
 a._contextText({agent:{session:s}});assert.equal(a.lastSnapshot.mode,'fast')
 push('tool/result',{turn:1,step:1,error:{name:'Error',code:'ENOENT'},message:{content:[{type:'tool-result',isError:true,content:'file missing'}]}})
 a._contextText({agent:{session:s}});assert.equal(a.lastSnapshot.mode,'slow');assert.ok(a.lastSnapshot.routing.triggers.includes('tool_error'))
})

test('F12: old oversized hit gets bounded evidence instead of disappearing and only admitted items count',t=>{
 const now=Date.now(),e=engine(t)
 const {id}=e.remember({text:'orchard reference '.repeat(1000),cues:['orchard'],scope,source:'human',now,born:now/86400000-1000,S:1})
 const out=e.memorySnapshot({text:'orchard',scope,now})
 assert.ok(out.hits.some(h=>h.id===id));assert.ok(out.blocks.some(b=>b.id===id));assert.ok(out.text.includes(id));assert.ok(out.text.includes('…'));assert.ok(out.text.includes(Injector.DISCLAIMER))
 assert.equal(out.tokens,estimateTokens(out.text));assert.ok(out.tokens<=e.cfg.tokens.CARD+e.cfg.tokens.WM+e.cfg.tokens.RECALL)
 const tiny=engine(t,{tokens:{CARD:0,WM:0,RECALL:0}});const m=tiny.remember({text:'orchard ref',scope,cues:['orchard']})
 assert.equal(tiny.memorySnapshot({text:'orchard',scope}).text,'');assert.equal(tiny.injectedThisSession.has(m.id),false)
})

test('F13: rollback returns previous active sequence and survives replay',t=>{
 const e=engine(t),m=e.remember({text:'old',scope}),original=e.log.items.get(m.id).activeSeq
 e.log.append({kind:'revise',id:m.id,text:'new'});const previous=e.log.items.get(m.id).activeSeq
 const out=e.rollback(m.id,original);assert.equal(out.from,previous);assert.notEqual(out.seq,out.from)
 e.log.load();assert.equal(e.log.items.get(m.id).text,'old')
})

test('F14: repeated same-turn assembly cannot consume positive-turn patience',t=>{
 const e=engine(t,{router:{STICKY_WITHIN_SESSION:false,SLOW_EXIT_PATIENCE:3}})
 e.memorySnapshot({text:'debug',session:'routing',turn:0})
 for(let n=0;n<4;n++)assert.equal(e.memorySnapshot({text:'hi',session:'routing',turn:1}).mode,'slow')
 assert.equal(e.router.positiveStreak,1)
 assert.equal(e.memorySnapshot({text:'hi',session:'routing',turn:2}).mode,'slow')
 assert.equal(e.memorySnapshot({text:'hi',session:'routing',turn:3}).mode,'fast')
 e.memorySnapshot({text:'debug',session:'routing'})
 assert.deepEqual(Array.from({length:4},()=>e.memorySnapshot({text:'hi',session:'routing'}).mode),['slow','slow','slow','slow'])
})

const lockURL=new URL('../lib/lock.js',import.meta.url).href
function killedLease(dir,phase) {
 const script=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
 const write=fs.writeFileSync,rename=fs.renameSync;
 fs.writeFileSync=(...args)=>{const out=write(...args);if(${JSON.stringify(phase)}==='candidate'&&String(args[0]).includes('.candidate-'))process.kill(process.pid,'SIGKILL');return out};
 fs.renameSync=(...args)=>{const out=rename(...args);if((${JSON.stringify(phase)}==='published'&&args[1].endsWith('.writer-lock'))||(${JSON.stringify(phase)}==='retired'&&args[1].includes('.retired-')))process.kill(process.pid,'SIGKILL');return out};
 syncBuiltinESMExports();const {acquireLock}=await import(${JSON.stringify(lockURL)});acquireLock(${JSON.stringify(dir)});`
 const out=spawnSync(process.execPath,['--input-type=module','-e',script]);assert.equal(out.signal,'SIGKILL',out.stderr.toString())
}

test('F15: SIGKILL before publication, after publication and during recovery all permit a safe new lease',t=>{
 for(const phase of ['candidate','published','retired']) {
  const dir=temporary(t)
  if(phase==='retired')killedLease(dir,'published')
  killedLease(dir,phase)
  const release=acquireLock(dir);assert.throws(()=>acquireLock(dir),/already in use/);release()
  assert.equal(existsSync(join(dir,'.writer-lock')),false)
  if(phase!=='candidate')assert.ok(readdirSync(dir).some(n=>n.includes('.retired-')))
 }
})

test('F15: legacy ownerless lease is refused without replacing or deleting it',t=>{
 const dir=temporary(t),lock=join(dir,'.writer-lock');mkdirSync(lock)
 assert.throws(()=>acquireLock(dir),/incomplete legacy/);assert.deepEqual(readdirSync(lock),[])
})

test('F01/F02: full queue cannot evict active work or report an unexecuted command as success',async t=>{
 const h=await host(temporary(t),{backlog:{MAX_ITEMS:1}}),e=h.api.engine
 const {id}=e.remember({text:'orchard source original words',scope,source:'human'})
 e.backlog.enqueue({kind:'skill-compile',payload:{scope,ids:[id]}})
 let calls=0;h.api.maintenance.generate=async()=>{calls++;throw Error('not expected')}
 const out=await h.run('maintain summary');assert.equal(out.kind,'error');assert.match(out.text,/queue is full/);assert.equal(calls,0)
 const q=new Backlog({MAX_ITEMS:1,DRAIN_PER_CALL:1,STALE_HOURS:24}),g=gate()
 const active=q.enqueue({kind:'gist-compress',target:'active'}).item
 const drain=q.drain({handler:()=>g.promise});q.enqueue({kind:'skill-compile',target:'later'})
 assert.equal(q.items[0].id,active.id);g.resolve();await drain
})

test('F03/F05: legacy colliding job IDs are repaired without dropping foreign pending work',t=>{
 const e=engine(t),a=e.remember({text:'A orchard source',scope:'A'}),b=e.remember({text:'B orchard source',scope:'B'})
 e.log.append({kind:'proposal',id:'legacy-id',scope:'A',proposalKind:'gist-compress',sourceRevisions:[{id:a.id}],status:'accepted'})
 e.backlog.enqueue({kind:'gist-compress',payload:{scope:'B',ids:[b.id]}}).item.id='legacy-id'
 e.backlog.enqueue({kind:'gist-compress',target:'duplicate',payload:{scope:'B',ids:[b.id]},dedupe:false}).item.id='legacy-id'
 e.checkpoint();const restart=new MemoryEngine({dir:e.log.dir});restart.start('again')
 assert.equal(restart.backlog.items.length,2);assert.equal(new Set(restart.backlog.items.map(j=>j.id)).size,2)
 assert.ok(restart.backlog.items.every(j=>j.id!=='legacy-id'&&j.payload.scope==='B'))
})

test('F07: legacy automatic jobs follow explicit project migration and execute via the command',async t=>{
 const dir=temporary(t),e=new MemoryEngine({dir});e.start()
 const {id}=e.remember({text:'legacy orchard source words',scope:'old-project',source:'human'})
 const job=e.backlog.enqueue({kind:'gist-compress',target:'legacy-auto',payload:{ids:[id]}}).item;e.checkpoint()
 const h=await host(dir,{legacyScopes:{'old-project':'/tmp/mnemo-audit-A'}})
 assert.equal(h.api.engine.backlog.items[0].payload.scope,scope)
 h.api.maintenance.generate=async(_,{memories})=>draft(memories)
 const out=await h.run('maintain summary');assert.equal(out.kind,'success',out.text);assert.ok(h.api.engine.log.proposals.has(job.id))
})

test('F07: real taskEnd automatic gist and skill jobs carry executable project scope',async t=>{
 const e=engine(t),now=Date.now(),day=86400000
 const {id}=e.remember({text:'orchard source original words',scope,source:'human',now:now-50*day})
 for(let n=0;n<3;n++)e.touch(id,{reson:0.6,session:'past-'+n,now:now-(45-n)*day})
 e.log.refreshLevels(now,e.cfg.curve.DECAY,e.cfg.levels)
 const out=e.taskEnd({text:'',scope,session:'today',affect:1,usedItemIds:[id],now})
 assert.ok(out.consolidated.includes(id))
 assert.ok(e.backlog.items.some(j=>j.kind==='gist-compress'))
 assert.ok(e.backlog.items.some(j=>j.kind==='skill-compile'))
 assert.ok(e.backlog.items.every(j=>j.payload.scope===scope&&j.payload.automatic))
 const m=new Maintenance(e,async(_,{memories})=>draft(memories))
 const run=await e.drainBacklog(j=>m.process(j,{scope}),{limit:2});assert.equal(run.processed.length,2);assert.equal(run.failed.length,0)
})

test('F08/F09: new human input merged after durable capture has its own receipt revision',t=>{
 const e=engine(t);e.postTurn({text:'工程默认使用蓝色',scope,affect:1,captureKey:'agent1'})
 const append=e.log.append.bind(e.log);let once=true
 e.log.append=ev=>{const result=append(ev);if(once&&ev.kind==='create'){once=false;throw Error('fault after durable create')}return result}
 assert.throws(()=>e.settleStaging({scope}),/fault after durable/)
 e.taskEnd({text:'工程默认使用蓝色',scope,affect:1,evidence:[{source:'human',at:Date.now(),sessionId:'human2'}],captureKey:'human2'})
 e.settleStaging({scope});e.log.load()
 const items=[...e.log.items.values()];assert.equal(items.length,1);assert.equal(items[0].source,'human');assert.equal(items[0].trust,'reported')
 assert.ok(items[0].evidence.some(ev=>ev.sessionId==='human2'));assert.equal(items[0].touches,1)
})

test('F15: a late recovery cannot retire the current lease into a retained nonempty tombstone',t=>{
 const dir=temporary(t);killedLease(dir,'published');const release=acquireLock(dir)
 const retired=readdirSync(dir).find(n=>n.includes('.retired-'));assert.ok(retired)
 const owner=readFileSync(join(dir,'.writer-lock','owner.json'),'utf8')
 assert.throws(()=>renameSync(join(dir,'.writer-lock'),join(dir,retired)),e=>['EEXIST','ENOTEMPTY'].includes(e.code))
 assert.equal(readFileSync(join(dir,'.writer-lock','owner.json'),'utf8'),owner);release()
})

test('F01/F02: temporary provider failures remain retryable even with a one-slot queue',async t=>{
 const h=await host(temporary(t),{backlog:{MAX_ITEMS:1}}),e=h.api.engine
 e.remember({text:'orchard source original words',scope,source:'human'})
 let calls=0;h.api.maintenance.generate=async()=>{calls++;throw Error('temporary outage')}
 for(let n=0;n<3;n++)assert.equal((await h.run('maintain summary')).kind,'error')
 assert.equal(calls,3);assert.equal(e.backlog.items.length,1)
 const id=e.backlog.items[0].id
 h.api.maintenance.generate=async(_,{memories})=>{calls++;return draft(memories)}
 const out=await h.run('maintain summary');assert.equal(out.kind,'success',out.text)
 assert.equal(calls,4);assert.equal(e.backlog.items.length,0);assert.ok(e.log.proposals.has(id))
})

test('F08: durable bytes before in-memory apply are replayed before retrying capture',t=>{
 const e=engine(t),now=Date.now()
 const entry=e.staging.offer({text:'orchard crash boundary',scope,source:'human',affect:1,now}).entry
 e.checkpoint()
 const append=e.log.append.bind(e.log);let once=true
 e.log.append=ev=>{
  if(once&&ev.kind==='create') {
   once=false

   writeFileSync(e.log.path,readFileSync(e.log.path,'utf8')+JSON.stringify({...ev,seq:e.log.seq+1,at:now})+'\n')
   throw Error('fsync error after bytes written')
  }
  return append(ev)
 }
 assert.throws(()=>e._absorbStaged(entry),/fsync error/);assert.equal(e.log.items.size,0)
 e._absorbStaged(entry);assert.equal(e.log.items.size,1)
 const item=[...e.log.items.values()][0];assert.equal(item.touches,0)
 e.log.load();assert.equal(e.log.items.size,1);assert.equal(e.log.items.get(item.id).touches,0)
})

test('F01/F05: restored unfinished manual request can retry even when its failure checkpoint was lost',async t=>{
 const dir=temporary(t);let h=await host(dir,{backlog:{MAX_ITEMS:1}})
 h.api.engine.remember({text:'orchard source original words',scope,source:'human'})
 const checkpoint=h.api.engine.checkpoint.bind(h.api.engine);let calls=0
 h.api.engine.checkpoint=()=>{if(++calls>1)throw Error('failed checkpoint');return checkpoint()}
 h.api.maintenance.generate=async()=>{throw Error('provider outage')}
 assert.equal((await h.run('maintain summary')).kind,'error')
 try {await h.api.detach()}catch{}
 h=await host(dir,{backlog:{MAX_ITEMS:1}})
 assert.equal(h.api.engine.backlog.items.length,1)
 assert.equal(h.api.engine.backlog.items[0].error,undefined)
 h.api.maintenance.generate=async(_,{memories})=>draft(memories)
 const out=await h.run('maintain summary');assert.equal(out.kind,'success',out.text);assert.equal(h.api.engine.backlog.items.length,0)
})
