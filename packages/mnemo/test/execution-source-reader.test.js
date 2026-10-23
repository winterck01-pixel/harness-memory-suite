import test from 'node:test'
import assert from 'node:assert/strict'
import {createExecutionSourceReader} from '../lib/execution-source-reader.js'

const cut=(id,revision='r1',text='verified artifact')=>({
 header:Object.freeze({id,cwd:'/fixture/project',createdAt:1}),
 revision,events:Object.freeze([
  Object.freeze({seq:0,type:'turn/start',data:{turn:1}}),
  Object.freeze({seq:1,type:'tool/result',data:{text}}),
  Object.freeze({seq:2,type:'turn/end',data:{reason:'completed'}}),
 ]),
})
function fixture(){
 const stored=new Map([['source',cut('source')]]),live=new Map(),stats=[],reads=[],disposed=[]
 let queryError=false,duringRead=null,duringStat=null
 const persistence={identity:Symbol('persistence'),stat:async id=>{
  stats.push(id);await duringStat?.(id)
  const value=stored.get(id);return value?{header:value.header,revision:value.revision}:undefined
 }}
 const query={observeSession:async(id,options)=>{
  reads.push({id,options});await duringRead?.(id)
  if(queryError)throw Error('read failed')
  const value=stored.get(id);if(!value)throw Error('not found')
  const lease={source:'prepared',...value,cursor:value.events.length-1,[Symbol.dispose]:()=>disposed.push(id)}
  return lease
 }}
 const reader=createExecutionSourceReader({getSessions:()=>({get:id=>live.get(id)}),getSessionQuery:()=>query,getPersistence:()=>persistence})
 return {reader,stored,live,stats,reads,disposed,persistence,query,
  failRead:()=>{queryError=true},onRead:fn=>{duringRead=fn},onStat:fn=>{duringStat=fn}}
}
test('exact live session is returned after each fresh persistence stat without observing or resuming',async()=>{
 const f=fixture(),source={id:'source',header:f.stored.get('source').header,snapshotEvents:()=>[]}
 f.live.set('source',source);assert.equal(f.reader.currentSession('source'),null)
 assert.equal(await f.reader.resolveSession('source'),source);assert.equal(f.reader.currentSession('source'),source)
 assert.equal(await f.reader.resolveSession('source'),source);assert.equal(f.stats.length,2);assert.equal(f.reads.length,0)
 f.reader.dispose();assert.equal(f.reader.currentSession('source'),null)
})
test('official cold observation supplies a stable synchronous read-only event cut',async()=>{
 const f=fixture(),source=await f.reader.resolveSession('source')
 assert.equal(source.id,'source');assert.equal(source.seq,3);assert.ok(Object.isFrozen(source))
 assert.deepEqual(source.snapshotEvents(1,2),[f.stored.get('source').events[1]])
 assert.equal(f.reader.currentSession('source'),source)
 assert.equal(f.reads[0].options.projectionMode,'none')
 assert.equal(await f.reader.resolveSession('source'),source,'unchanged revision preserves origin identity')
 assert.equal(f.reads.length,2);assert.equal(f.stats.length,4)
 assert.equal(f.disposed.length,1,'redundant lease disposed')
 f.reader.dispose();assert.equal(f.disposed.length,2)
})
test('changed revision replaces source and releases previous observation',async()=>{
 const f=fixture(),before=await f.reader.resolveSession('source')
 f.stored.set('source',cut('source','r2','changed output'))
 const after=await f.reader.resolveSession('source')
 assert.notEqual(after,before);assert.equal(after.snapshotEvents(1,2)[0].data.text,'changed output')
 assert.equal(f.disposed.length,1);f.reader.dispose()
})
for(const mode of ['cold','live'])test(`deleted ${mode} source cannot fall back to a pinned or live ghost`,async()=>{
 const f=fixture()
 if(mode==='live')f.live.set('source',{id:'source',header:f.stored.get('source').header,snapshotEvents:()=>[]})
 assert.ok(await f.reader.resolveSession('source'))
 f.stored.delete('source')
 assert.equal(await f.reader.resolveSession('source'),null);assert.equal(f.reader.currentSession('source'),null)
 f.reader.dispose()
})
test('failed query invalidates previous pin instead of serving a stale snapshot',async()=>{
 const f=fixture();await f.reader.resolveSession('source');f.failRead()
 assert.equal(await f.reader.resolveSession('source'),null);assert.equal(f.reader.currentSession('source'),null)
 assert.equal(f.disposed.length,1);f.reader.dispose()
})
test('cold source requires official persistence, while absent-service tests keep exact live identity',async()=>{
 const session={id:'live',header:{id:'live'},snapshotEvents:()=>[]};let observations=0
 const reader=createExecutionSourceReader({getSessions:()=>({get:id=>id==='live'?session:null}),getSessionQuery:()=>({observeSession:async()=>{observations++}})})
 assert.equal(await reader.resolveSession('live'),session);assert.equal(await reader.resolveSession('cold'),null);assert.equal(observations,0)
 reader.dispose()
})
test('changed source during observation is refused and new lease released',async()=>{
 const f=fixture();let count=0
 f.onStat(()=>{if(++count===2)f.stored.delete('source')})
 assert.equal(await f.reader.resolveSession('source'),null);assert.equal(f.reader.currentSession('source'),null)
 assert.equal(f.disposed.length,1);f.reader.dispose()
})
test('live attachment during cold read refuses an obsolete detached cut',async()=>{
 const f=fixture()
 f.onRead(()=>f.live.set('source',{id:'source',header:f.stored.get('source').header,snapshotEvents:()=>[]}))
 assert.equal(await f.reader.resolveSession('source'),null);assert.equal(f.reader.currentSession('source'),null)
 f.reader.dispose()
})
test('invalid observation sequence is refused and disposed',async()=>{
 const f=fixture();f.stored.set('source',{...cut('source'),events:[{seq:1,type:'turn/end',data:{reason:'completed'}}]})
 assert.equal(await f.reader.resolveSession('source'),null);assert.equal(f.disposed.length,1);f.reader.dispose()
})
test('persistence identity changes invalidate a pinned cut synchronously',async()=>{
 const f=fixture();await f.reader.resolveSession('source');f.persistence.identity=Symbol('replacement')
 assert.equal(f.reader.currentSession('source'),null);f.reader.dispose()
})
test('cold lease retention is bounded to eight entries',async()=>{
 const f=fixture()
 for(let i=0;i<9;i++){const id='cold-'+i;f.stored.set(id,cut(id));assert.ok(await f.reader.resolveSession(id))}
 assert.equal(f.reader.currentSession('cold-0'),null);assert.equal(f.disposed.length,1)
 f.reader.dispose();assert.equal(f.disposed.length,9)
})
test('abort during an observation prevents publication and disposes the lease',async()=>{
 const controller=new AbortController();let disposeCount=0
 const value=cut('source')
 const reader=createExecutionSourceReader({signal:controller.signal,getSessions:()=>({get:()=>null}),
  getPersistence:()=>persistence,getSessionQuery:()=>({observeSession:async()=>{
   controller.abort();return {source:'prepared',...value,cursor:2,[Symbol.dispose]:()=>disposeCount++}
  }})})
 const persistence={stat:async()=>({header:value.header,revision:value.revision})}
 assert.equal(await reader.resolveSession('source'),null);assert.equal(reader.currentSession('source'),null);assert.equal(disposeCount,1)
 reader.dispose()
})
