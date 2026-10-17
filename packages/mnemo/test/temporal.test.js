import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Maintenance} from '../lib/maintenance.js'
import {MemoryEngine} from '../lib/engine.js'
import {memoryMetadata} from '../lib/inject.js'
import {humanInputEvidence} from '../lib/temporal.js'
import {sourceLabel} from '../lib/reliability.js'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const base=Date.parse('2026-09-21T15:59:00Z')
function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'mnemo-time-'));try{fn(new MemoryEngine({dir}),dir)}finally{rmSync(dir,{recursive:true,force:true})}}
test('relative history keeps original evidence time after delayed capture and touch',()=>fixture((e)=>{
 const {id}=e.remember({text:'明天发布 orchard',scope:'p',source:'human',evidence:[{source:'human',at:base,timeZone:'Asia/Shanghai'}],now:base+86400000})
 e.touch(id,{now:base+172800000})
 for(const label of [memoryMetadata(e.log.items.get(id)),sourceLabel(e.log.items.get(id))]){
  assert.ok(label.includes('2026-09-21T15:59:00.000Z'))
  assert.ok(label.includes('Asia/Shanghai'))
  assert.ok(label.includes('verify-current'))
 }
}))
test('explicit expiry follows supplied query time, pinned records included, without deletion',()=>fixture((e)=>{
 const {id}=e.remember({text:'orchard temporary approval',cues:['orchard'],scope:'p',pinned:true,source:'human',expiresAt:base+1000,now:base})
 assert.equal(e.recall('orchard',{scope:'p',now:base,limit:5}).length,1)
 assert.equal(e.recall('orchard',{scope:'p',now:base+1000,limit:5}).length,0)
 assert.equal(e.log.items.has(id),true)
}))
test('invalid explicit expiry is rejected',()=>fixture((e)=>{
 for(const expiresAt of ['tomorrow',NaN,Infinity,-1])assert.throws(()=>e.remember({text:'bad',expiresAt}))
}))
test('unknown relative date is labelled unknown rather than fabricated',()=>{
 const label=memoryMetadata({id:'old',text:'下周处理',source:'human'})
 assert.ok(label.includes('referenceTime=unknown'))
 assert.ok(label.includes('verify-current'))
})

test('expired pinned memory is absent from card and snapshot at the specified time',()=>fixture(e=>{
 const {id}=e.remember({text:'orchard expires',cues:['orchard'],scope:'p',pinned:true,source:'human',expiresAt:base+1000,now:base})
 assert.ok(!e._renderCard({scope:'p',now:base+1000}).text.includes(id))
 assert.ok(!e.memorySnapshot({text:'orchard',scope:'p',now:base+1000}).text.includes(id))
}))
test('identical relative statements on different days remain distinct',()=>fixture(e=>{
 const a=e.staging.offer({text:'明天发布 orchard',scope:'p',source:'human',now:base,evidence:[{source:'human',at:base}]})
 const b=e.staging.offer({text:'明天发布 orchard',scope:'p',source:'human',now:base+86400000,evidence:[{source:'human',at:base+86400000}]})
 assert.equal(b.merged,false)
 assert.notEqual(e._absorbStaged(a.entry),e._absorbStaged(b.entry))
}))

test('time evidence uses human input event and excludes plugin snapshots and earlier turns',()=>{
 const events=[{type:'user/message',seq:1,time:base-1,data:{source:{kind:'user'}}},{type:'turn/start'},
 {type:'user/message',seq:3,time:base,data:{source:{kind:'user',clientTimeZone:'Asia/Shanghai'}}},
 {type:'user/message',seq:4,time:base+1,data:{source:{kind:'plugin',plugin:'time-context'}}},{type:'turn/end',time:base+86400000}]
 assert.deepEqual(humanInputEvidence(events),[{eventSeq:3,source:'human',at:base,timeZone:'Asia/Shanghai'}])
})
test('historical time and expiry survive store replay',()=>fixture((e,dir)=>{
 const {id}=e.remember({text:'tomorrow orchard',scope:'p',source:'human',expiresAt:base+86400000,evidence:[{at:base,source:'human',timeZone:'UTC'}],now:base})
 const restored=new MemoryEngine({dir});restored._ensure()
 assert.equal(memoryMetadata(restored.log.items.get(id)),memoryMetadata(e.log.items.get(id)))
}))
test('recapture does not revive or reuse expired records',()=>fixture(e=>{
 const old=e.remember({text:'orchard code',scope:'p',expiresAt:base+1,now:base})
 const id=e._absorbStaged({text:'orchard code',scope:'p',source:'human',firstSeen:base+2,lastSeen:base+2,evidence:[{source:'human',at:base+2}]})
 assert.notEqual(id,old.id)
 assert.equal(e.log.items.get(old.id).expiresAt,base+1)
}))
test('multiple source times are explicitly ambiguous, never collapsed to the first time',()=>{
 const label=memoryMetadata({text:'明天发布；明天再检查',source:'human',evidence:[{source:'human',at:base},{source:'human',at:base+86400000}]})
 assert.ok(label.includes('referenceTime=multiple'));assert.ok(label.includes('referenceBasis=multiple-inputs'))
 assert.ok(label.includes('2026-09-22T15:59:00.000Z'))
})
test('legacy records disclose that recording time is only a fallback',()=>{
 assert.ok(memoryMetadata({text:'tomorrow',recordedAt:base}).includes('referenceBasis=recorded-fallback'))
})

test('semantic matching and draft generation receive historical time context',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-time-model-'))
 try {
  const e=new MemoryEngine({dir});const now=Date.now()
  const {id}=e.remember({text:'tomorrow orchard release',scope:'p',source:'human',evidence:[{source:'human',at:base,timeZone:'Asia/Shanghai'}],expiresAt:now+60000})
  let calls=0
  const worker=new Maintenance(e,async(_prompt,input)=>{
   calls++;const it=(input.candidates ?? input.memories)[0]
   assert.ok(it.timeContext.includes('2026-09-21T15:59:00.000Z'));assert.ok(it.timeContext.includes('expiresAt='));assert.ok(it.timeContext.includes('verify-current'))
   return input.candidates?{ids:[id]}:{text:'historical draft',citations:[{id,quote:'orchard release'}]}
  })
  await worker.semanticRecall('orchard',{scope:'p'})
  await worker.process({id:'draft',kind:'gist-compress',payload:{ids:[id]}},{scope:'p'})
  assert.equal(calls,2)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('derived memories retain time evidence across human and agent sources',()=>{
 const label=memoryMetadata({source:'agent',text:'tomorrow orchard',evidence:[{source:'human',at:base,proposalId:'derived'},{source:'agent',at:base+86400000,proposalId:'derived'}]})
 assert.ok(label.includes('referenceTime=multiple'))
 assert.ok(label.includes('2026-09-21T15:59:00.000Z'))
 assert.ok(label.includes('2026-09-22T15:59:00.000Z'))
})
test('epoch zero is an expired deadline rather than missing expiry',()=>fixture(e=>{
 const {id}=e.remember({text:'orchard epoch',scope:'p',expiresAt:0,now:0})
 assert.equal(e.recall('orchard',{scope:'p',now:0}).length,0)
 assert.equal(e.log.items.get(id).expiresAt,0)
}))
