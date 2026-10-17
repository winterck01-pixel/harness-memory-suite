import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {MemoryEngine} from '../lib/engine.js'
import {Maintenance} from '../lib/maintenance.js'

test('semantic candidate selection can reach older relevant memories beyond the latest forty',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-r3-semantic-'))
 try{
  const e=new MemoryEngine({dir});e.start('s')
  const old=e.remember({text:'Atlas backups require checksum verification.',scope:'p'})
  for(let i=0;i<45;i++)e.remember({text:`Unrelated invoice currency note ${i}`,scope:'p'})
  const worker=new Maintenance(e,async(_,{candidates})=>{assert.ok(candidates.some(x=>x.id===old.id));return {ids:[old.id]}})
  assert.ok((await worker.semanticRecall('Atlas backup checksum',{scope:'p'})).some(x=>x.id===old.id))
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('semantic approval of an old revision cannot select an unrelated new revision',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-r3-semantic-change-'))
 try{
  const e=new MemoryEngine({dir});e.start('s')
  const old=e.remember({text:'Atlas backup checksum',scope:'p'})
  const worker=new Maintenance(e,async()=>{e.log.append({kind:'revise',id:old.id,text:'Unrelated invoice currency'});return {ids:[old.id]}})
  assert.deepEqual(await worker.semanticRecall('Atlas backup checksum',{scope:'p'}),[])
 }finally{rmSync(dir,{recursive:true,force:true})}
})
