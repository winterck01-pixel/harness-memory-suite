import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {MemoryEngine} from '../lib/engine.js'
import {EventLog} from '../lib/store.js'

function fixture(t,{confirmed=false}={}) {
  const dir=mkdtempSync(join(tmpdir(),'mnemo-approval-atomic-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const e=new MemoryEngine({dir}); e.setScope('A'); e.start('audit')
  const source=e.remember({text:'orchard timeout=30',scope:'A',source:'agent'})
  if(confirmed)e.review(source.id,'confirmed',{scope:'A',reason:'human verified'})
  const current=e.log.items.get(source.id)
  e.log.append({kind:'proposal',id:'p',scope:'A',proposalKind:'gist-compress',text:'orchard summary',
    citations:[{id:source.id,quote:'orchard'}],sourceRevisions:[{id:source.id,seq:current.activeSeq,reviewSeq:current.reviewSeq??null}],status:'pending'})
  return {e,dir,source}
}

for(const action of ['revise','pin','review','scope','proposal','evidence']) {
  test('approval rejects concurrent '+action+' before any approval bytes',t=>{
    const {e,dir,source}=fixture(t), other=new EventLog(dir), append=e.log.append.bind(e.log)
    let bytes
    e.log.append=(event,options)=>{
      if(event.kind==='approval') {
        const change={
          revise:{kind:'revise',id:source.id,text:'orchard timeout=90'},
          pin:{kind:'pin',id:source.id,on:true},
          review:{kind:'review',id:source.id,trust:'confirmed'},
          scope:{kind:'scope-binding',legacy:'A',scope:'B'},
          proposal:{kind:'proposal-reviewed',id:'p',status:'rejected'},
          evidence:{kind:'touch',id:source.id,at:Date.now(),captureSource:'agent',captureEvidence:[{source:'agent',at:Date.now(),note:'new evidence at commit'}]},
        }[action]
        other.append(change); bytes=readFileSync(e.log.path,'utf8')
      }
      return append(event,options)
    }
    assert.throws(()=>e.acceptProposal('p',{scope:'A'}),/changed|protected|expired/i)
    assert.equal(readFileSync(e.log.path,'utf8'),bytes)
    const replay=new EventLog(dir); replay.load()
    assert.equal(replay.items.get(source.id).archived,false)
    assert.equal(replay.items.size,1)
    assert.equal(replay.proposals.get('p').status,action==='proposal'?'rejected':'pending')
  })
}

test('approval preserves all human-confirmed sources including agent-origin records',t=>{
  const {e,source}=fixture(t,{confirmed:true})
  const result=e.acceptProposal('p',{scope:'A'})
  assert.deepEqual(result.superseded,[])
  assert.equal(e.log.items.get(source.id).archived,false)
  assert.equal(e.log.items.get(result.id).trust,'confirmed')
  assert.equal(e.acceptProposal('p',{scope:'A'}).deduplicated,true)
})

test('unchanged ordinary approval still archives source and is idempotent',t=>{
  const {e,source}=fixture(t)
  const result=e.acceptProposal('p',{scope:'A'})
  assert.deepEqual(result.superseded,[source.id])
  assert.equal(e.log.items.get(source.id).archived,true)
  assert.equal(e.log.items.get(result.id).gist,'orchard summary')
  assert.equal(e.acceptProposal('p',{scope:'A'}).id,result.id)
})

for(const action of ['pin','review','touch'])test('automatic archive rejects concurrent '+action+' before bytes',t=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-archive-atomic-'))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const e=new MemoryEngine({dir,config:{forget:{MIN_IDLE_DAYS:1,S_MAX_ARCHIVED:5,MAX_TOUCHES:2}}})
 e.setScope('A');e.start('audit');const now=Date.now()
 const source=e.remember({text:'orchard old agent note',scope:'A',source:'agent',now:now-500*86400000})
 const append=e.log.append.bind(e.log),other=new EventLog(dir)
 let bytes
 e.log.append=(event,options)=>{
  if(event.kind==='archive'){
   other.append({pin:{kind:'pin',id:source.id,on:true},review:{kind:'review',id:source.id,trust:'confirmed'},touch:{kind:'touch',id:source.id,at:now,S:3,touchAt:now/86400000}}[action])
   bytes=readFileSync(e.log.path,'utf8')
  }
  return append(event,options)
 }
 assert.throws(()=>e.sweepArchives({force:true,now}),/changed|protected/i)
 assert.equal(readFileSync(e.log.path,'utf8'),bytes)
 assert.equal(e.log.items.get(source.id).archived,false)
})
