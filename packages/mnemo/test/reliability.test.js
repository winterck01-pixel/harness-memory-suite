import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {EventLog} from '../lib/store.js'
import {MemoryEngine} from '../lib/engine.js'
import {projectScope} from '../lib/reliability.js'
import {acquireLock} from '../lib/lock.js'
import {Maintenance} from '../lib/maintenance.js'
import {modelGenerator} from '../lib/model-client.js'
const fresh=()=>{const dir=mkdtempSync(join(tmpdir(),'mnemo-reliability-'));const e=new MemoryEngine({dir});e.start('s');return {dir,e,cleanup:()=>rmSync(dir,{recursive:true,force:true})}}

test('concurrent loaded stores preserve monotonic sequence and both items',()=>{const {dir,cleanup}=fresh();try{const a=new EventLog(dir),b=new EventLog(dir);a.load();b.load();a.append({kind:'create',id:'a',text:'a'});b.append({kind:'create',id:'b',text:'b'});a.load();assert.equal(a.seq,2);assert.equal(a.items.size,2)}finally{cleanup()}})
test('live writer lock refuses a second engine, release permits reload',()=>{const {dir,cleanup}=fresh();try{const release=acquireLock(dir,'.engine-lock');assert.throws(()=>acquireLock(dir,'.engine-lock'),/in use/);release();acquireLock(dir,'.engine-lock')()}finally{cleanup()}})
test('malformed log fails closed instead of appending past lost history',()=>{const {dir,cleanup}=fresh();try{const a=new EventLog(dir);a.load();a.append({kind:'create',id:'a',text:'a'});writeFileSync(a.path,'{broken','utf8');assert.throws(()=>a.append({kind:'create',id:'b'}),/malformed/);assert.equal(readFileSync(a.path,'utf8'),'{broken')}finally{cleanup()}})
test('same trailing project path does not share identity',()=>{assert.notEqual(projectScope('/one/Projects/demo'),projectScope('/two/Projects/demo'))})
test('session switching preserves independent router and goals',()=>{const {e,cleanup}=fresh();try{e.activateSession('A','a');e.router.route({text:'修复',session:'A'});e.goalCues=['alpha'];e.activateSession('B','b');assert.equal(e.router.mode,'fast');e.goalCues=['beta'];e.activateSession('A','a');assert.equal(e.router.mode,'slow');assert.deepEqual(e.goalCues,['alpha'])}finally{cleanup()}})
test('large memory count cannot grant authority, frozen gate never promotes',()=>{const {e,cleanup}=fresh();try{assert.equal(e.gate({text:'valid',cues:['valid']},{sampleN:99999}).action,'propose');e.safety.frozen=true;assert.equal(e.gate({text:'valid',cues:['valid']},{regression:{N:99999},probeJudged:[{ok:true}]}).action,'propose')}finally{cleanup()}})
test('staging and failed jobs survive reload, no executor never consumes work',async()=>{const {dir,e,cleanup}=fresh();try{e.postTurn({text:'orchard fixture detail',cues:['orchard'],scope:'p',session:'s'});e.backlog.enqueue({kind:'gist-compress',target:'x',payload:{ids:['x']}});e.checkpoint();const restored=new MemoryEngine({dir});restored.start('s2');assert.ok(restored.staging.pending.length+restored.log.items.size>0);await restored.drainBacklog();const again=new MemoryEngine({dir});again.start('s3');assert.equal(again.backlog.items.length,1)}finally{cleanup()}})
test('conflicts and source evidence persist; disputed and expired memories are excluded',()=>{const {dir,e,cleanup}=fresh();try{e.remember({text:'orchard red',scope:'p',factKey:'color',source:'human',evidence:[{sessionId:'a'}]});const newer=e.remember({text:'orchard blue',scope:'p',factKey:'color',source:'agent'});assert.equal(e.log.items.get(newer.id).conflicts.length,1);e.review(newer.id,'disputed',{scope:'p'});e.remember({text:'orchard expired',scope:'p',expiresAt:Date.now()-1});const r=new MemoryEngine({dir});r.start();assert.equal(r.log.alive('p').length,1);assert.equal(r.log.alive('p')[0].evidence[0].sessionId,'a');assert.throws(()=>r.review(newer.id,'confirmed',{scope:'other'}),/Unknown/)}finally{cleanup()}})
test('semantic matching handles paraphrase but rejects fabricated ids',async()=>{const {e,cleanup}=fresh();try{const m=e.remember({text:'只使用离线处理',scope:'p',source:'human'});const worker=new Maintenance(e,async()=>({ids:[m.id]}));const hits=await worker.semanticRecall('网络不可用怎么办',{scope:'p'});assert.equal(hits[0].id,m.id);worker.generate=async()=>({ids:['invented']});assert.ok(!(await worker.semanticRecall('无关',{scope:'p'})).some(x=>x.id==='invented'))}finally{cleanup()}})
test('summary and skill drafts require real quotes and never replace source automatically',async()=>{const {e,cleanup}=fresh();try{const m=e.remember({text:'A verified original source sentence.',scope:'p',source:'human'});const worker=new Maintenance(e,async()=>({text:'Short draft',citations:[{id:m.id,quote:'original source'}]}));for(const kind of ['gist-compress','skill-compile'])await worker.process({id:kind,kind,payload:{ids:[m.id]}},{scope:'p'});assert.equal(e.log.proposals.size,2);assert.equal(e.log.items.get(m.id).text,'A verified original source sentence.');worker.generate=async()=>({text:'bad',citations:[{id:m.id,quote:'invented evidence'}]});await assert.rejects(worker.process({id:'bad',kind:'gist-compress',payload:{ids:[m.id]}},{scope:'p'}),/evidence/);assert.equal(e.log.proposals.size,2)}finally{cleanup()}})
test('safety actually invokes model boundary probes and freezes on failure',async()=>{const {e,cleanup}=fresh();let calls=0;try{const worker=new Maintenance(e,async(_s,input)=>{calls++;assert.equal(input.expected,undefined);return {answer:input.trusted.color??input.trusted.action??'unknown'}});assert.equal((await worker.safety({scope:'p'})).passed,true);assert.equal(calls,3);worker.generate=async()=>({answer:'wrong'});assert.equal((await worker.safety({scope:'p'})).passed,false);assert.equal(e.safety.frozen,true)}finally{cleanup()}})
test('model adapter requires terminal completion and handles block-end without duplicating deltas',async()=>{let options;const llm={async *stream(o){options=o;yield{type:'text-delta',index:0,text:'{"ids":[]}'};yield{type:'block-end',index:0,block:{type:'text',text:'{"ids":[]}'}};yield{type:'finish',reason:{kind:'stop'}}}};const generate=modelGenerator({get:n=>n==='llm'?llm:{currentSelection:()=>({provider:'fixture',model:'fixture'})}});assert.deepEqual(await generate('system',{}),{ids:[]});assert.equal(options.maxTokens,1600);llm.stream=async function*(){yield{type:'text-delta',index:0,text:'{}'}};await assert.rejects(generate('system',{}),/finish normally/)})

test('valid final JSON without newline is safely delimited before append',()=>{const {dir,cleanup}=fresh();try{const log=new EventLog(dir);log.append({kind:'create',id:'a',text:'a'});writeFileSync(log.path,readFileSync(log.path,'utf8').trimEnd());const loaded=new EventLog(dir);loaded.load();loaded.append({kind:'create',id:'b',text:'b'});loaded.load();assert.equal(loaded.items.size,2)}finally{cleanup()}})
test('recall cannot return a memory withdrawn while model is running',async()=>{const {e,cleanup}=fresh();try{const m=e.remember({text:'original source',scope:'p'});const worker=new Maintenance(e,async()=>{e.review(m.id,'disputed',{scope:'p'});return {ids:[m.id]}});assert.deepEqual(await worker.semanticRecall('original',{scope:'p'}),[])}finally{cleanup()}})
test('draft generation rejects source review changes during await',async()=>{const {e,cleanup}=fresh();try{const m=e.remember({text:'original source',scope:'p'});const worker=new Maintenance(e,async()=>{e.review(m.id,'disputed',{scope:'p'});return {text:'draft',citations:[{id:m.id,quote:'original'}]}});await assert.rejects(worker.process({id:'j',kind:'gist-compress',payload:{ids:[m.id]}},{scope:'p'}),/Source changed/)}finally{cleanup()}})
test('project maintenance drain does not consume another project job',async()=>{const {e,cleanup}=fresh();try{e.backlog.enqueue({kind:'skill-compile',target:'a',payload:{scope:'a'}});e.backlog.enqueue({kind:'gist-compress',target:'b',payload:{scope:'b'}});const result=await e.drainBacklog(async()=>({done:true}),{limit:1,filter:j=>j.payload.scope==='b'});assert.equal(result.processed[0].target,'b');assert.equal(e.backlog.items[0].target,'a')}finally{cleanup()}})


test('startup captures restored staging once and persists the drained queue', () => {
  const {dir,e,cleanup}=fresh()
  try {
    e.postTurn({text:'Persist this important orchard decision',cues:['orchard'],affect:1,scope:'p',session:'s'})
    assert.ok(e.staging.pending.length > 0)
    e.checkpoint()
    const restored=new MemoryEngine({dir})
    assert.doesNotThrow(()=>restored.start('restart'))
    assert.equal(restored.log.alive('p').length,1)
    assert.equal(restored.staging.pending.length,0)
    const again=new MemoryEngine({dir})
    again.start('restart-again')
    assert.equal(again.log.alive('p').length,1)
    assert.equal(again.staging.pending.length,0)
    assert.equal(again.log.alive('p')[0].text,'Persist this important orchard decision')
  } finally {cleanup()}
})
