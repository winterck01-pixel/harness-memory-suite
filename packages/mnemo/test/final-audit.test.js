import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {captureDisabled} from '../lib/turn-capture.js'
import {MemoryEngine} from '../lib/engine.js'

test('quoted opt-out instructions are distinguished from examples',()=>{
 for (const text of ['本轮请遵守：“不要写入记忆”。','请按“不要写入记忆”执行。','“本轮不要写入记忆”','Please follow: "do not save to memory"','本轮请“不要写入记忆”。','本轮要求：「不要写入记忆」。']) {
  assert.equal(captureDisabled(text),true,text)
 }
 for (const text of ['解释一下“不要写入记忆”的意思','请翻译“本轮请遵守：不要写入记忆”','示例：“不要写入记忆”。','不要忘记把这个偏好保存到长期记忆']) {
  assert.equal(captureDisabled(text),false,text)
 }
})

test('failed maintenance work remains retryable after a simultaneous checkpoint failure',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-double-failure-'))
 try {
  const engine=new MemoryEngine({dir});engine.start('audit')
  const checkpoint=engine.checkpoint.bind(engine)
  engine.backlog.enqueue({kind:'gist-compress',target:'retained'})
  engine.checkpoint=()=>{throw Error('disk unavailable')}
  await assert.rejects(engine.drainBacklog(async()=>{throw Error('provider unavailable')}),/disk unavailable/)
  assert.equal(engine.backlog.items.length,1);assert.equal(engine._draining,null)
  engine.checkpoint=checkpoint
  const result=await engine.drainBacklog(async()=>({ok:true}))
  assert.equal(result.processed.length,1);assert.equal(engine.backlog.items.length,0)
 } finally {rmSync(dir,{recursive:true,force:true})}
})

test('maintenance releases its in-flight guard even when final persistence fails',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-drain-recovery-'))
 try {
  const engine=new MemoryEngine({dir});engine.start('audit')
  const checkpoint=engine.checkpoint.bind(engine);let calls=0
  engine.backlog.enqueue({kind:'gist-compress',target:'first'})
  engine.checkpoint=()=>{throw Error('disk unavailable')}
  const first=engine.drainBacklog(async()=>{calls++;return {ok:true}})
  await assert.rejects(first,/disk unavailable/)
  assert.equal(engine._draining,null)
  engine.checkpoint=checkpoint
  engine.backlog.enqueue({kind:'gist-compress',target:'second'})
  await engine.drainBacklog(async()=>{calls++;return {ok:true}})
  assert.equal(calls,2);assert.equal(engine.backlog.items.length,0)
 } finally {rmSync(dir,{recursive:true,force:true})}
})
