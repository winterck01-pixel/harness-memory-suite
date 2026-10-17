import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {MemoryEngine} from '../lib/engine.js'
import {Maintenance} from '../lib/maintenance.js'

test('a failed checkpoint does not block later callers or clear a queued tail',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-queue-failure-'))
 try {
  const e=new MemoryEngine({dir});e.start('audit')
  for(const scope of ['A','B','C'])e.backlog.enqueue({kind:'gist-compress',target:scope,payload:{scope}})
  const checkpoint=e.checkpoint.bind(e);let saves=0
  e.checkpoint=()=>{if(++saves===1)throw Error('temporary disk failure');return checkpoint()}
  let release;const gate=new Promise(resolve=>release=resolve)
  const a=e.drainBacklog(async()=> 'A',{filter:j=>j.payload.scope==='A'})
  const b=e.drainBacklog(async()=>{await gate;return 'B'},{filter:j=>j.payload.scope==='B'})
  const c=e.drainBacklog(async()=> 'C',{filter:j=>j.payload.scope==='C'})
  await assert.rejects(a,/temporary disk failure/)
  assert.equal(e._draining,c,'teardown must wait for the entire queued tail')
  release();const [rb,rc]=await Promise.all([b,c])
  assert.equal(rb.processed[0].outcome,'B');assert.equal(rc.processed[0].outcome,'C')
  assert.equal(e._draining,null);assert.equal(e.backlog.items.length,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('cancelled queued maintenance does not call the provider',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-queue-cancel-'))
 try {
  const e=new MemoryEngine({dir});e.start('audit');let calls=0
  const m=new Maintenance(e,async()=>{calls++})
  await assert.rejects(m.process({kind:'gist-compress'},{scope:'A',signal:AbortSignal.abort()}),/cancelled/)
  assert.equal(calls,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('overlapping project maintenance calls run serially and receive their own results',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-projects-'))
 try {
  const e=new MemoryEngine({dir});e.start('audit')
  for(const scope of ['A','B'])e.backlog.enqueue({kind:'gist-compress',target:scope,payload:{scope}})
  let release;const gate=new Promise(resolve=>release=resolve);const calls=[]
  const a=e.drainBacklog(async()=>{calls.push('A');await gate;return 'A draft'},{filter:j=>j.payload.scope==='A'})
  const b=e.drainBacklog(async()=>{calls.push('B');return 'B draft'},{filter:j=>j.payload.scope==='B'})
  assert.deepEqual(calls,['A']);release()
  const [ra,rb]=await Promise.all([a,b])
  assert.deepEqual(calls,['A','B'])
  assert.equal(ra.processed[0].outcome,'A draft');assert.equal(rb.processed[0].outcome,'B draft')
  assert.equal(rb.processed[0].payload.scope,'B');assert.equal(e.backlog.items.length,0);assert.equal(e._draining,null)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('a source archived while generation is pending cannot produce a proposal',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-archive-race-'))
 try {
  const e=new MemoryEngine({dir});e.start('audit')
  const item=e.remember({text:'synthetic orchard fact',scope:'A',source:'human'})
  let release;const gate=new Promise(resolve=>release=resolve)
  const m=new Maintenance(e,async()=>{await gate;return {text:'draft',citations:[{id:item.id,quote:'orchard fact'}]}})
  const result=m.process({id:'archive-test',kind:'gist-compress',payload:{ids:[item.id]}},{scope:'A'})
  e.log.append({kind:'archive',id:item.id});release()
  await assert.rejects(result,/Source changed/)
  assert.equal(e.log.proposals.size,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
