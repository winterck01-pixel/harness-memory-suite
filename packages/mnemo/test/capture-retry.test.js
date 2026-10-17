import {test} from 'node:test'
import assert from 'node:assert/strict'
import {captureDisabled} from '../lib/turn-capture.js'
import {MemoryEngine} from '../lib/engine.js'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
test('quoted discussion and do-not-forget requests do not disable capture',()=>{
 for(const text of ['不要忘记把这个偏好保存到长期记忆','解释一下“不要写入记忆”这句话是什么意思','Please do not forget to save this to memory','解释一下不要写入记忆是什么意思'])assert.equal(captureDisabled(text),false,text)
 assert.equal(captureDisabled('解释“不要写入记忆”；本轮不要写入记忆。'),true)
 assert.equal(captureDisabled('解释一下这句话，另外本轮不要写入记忆。'),true)
})
test('retry after checkpoint failure does not count the same source twice',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-retry-'));try{
 const e=new MemoryEngine({dir});e.start('s');const cp=e.checkpoint.bind(e);let fail=true;e.checkpoint=()=>{if(fail){fail=false;throw Error('disk')}return cp()}
 const p={text:'orchard answer',scope:'p',session:'s',captureKey:'s:1:assistant:2'}
 assert.throws(()=>e.postTurn(p),/disk/);e.postTurn(p)
 assert.equal(e.staging.pending[0].repeats,1);assert.equal(e.staging.offerSeq,1)
 const restored=new MemoryEngine({dir});restored._ensure();restored.postTurn(p);assert.equal(restored.staging.offerSeq,1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

import {CaptureRetryQueue} from '../lib/capture-retry.js'
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
test('automatic retry recovers a transient failure and stops after success',async()=>{
 let calls=0,errors=0
 const q=new CaptureRetryQueue({delays:[1,1],onError:()=>errors++})
 try {q.run('turn','p',()=>{if(++calls===1)throw Error('temporary')})
 assert.equal(q.report().pending,1)
 await sleep(30)
 assert.equal(calls,2);assert.equal(errors,1);assert.deepEqual(q.report(),{pending:0,failed:[]})
 await sleep(10);assert.equal(calls,2)
 }finally{q.close()}
})
test('exhausted retries remain visible and manual retry is project scoped',()=>{
 const q=new CaptureRetryQueue({delays:[]});let fail=true
 for(const scope of ['p','other'])q.run(scope,scope,()=>{if(fail)throw Error('disk')})
 assert.equal(q.report().failed.length,2);fail=false
 q.retryFailed('p');assert.equal(q.report().failed.length,1);assert.equal(q.report().failed[0].scope,'other');q.close()
})
test('close cancels delayed writes',async()=>{
 let calls=0;const q=new CaptureRetryQueue({delays:[5]})
 q.run('t','p',()=>{calls++;throw Error('disk')});q.close();await sleep(20);assert.equal(calls,1)
})
test('receipt survives a successful checkpoint followed by an error and staging settlement',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mnemo-receipt-'))
 try {
 const e=new MemoryEngine({dir});e.start('s');const cp=e.checkpoint.bind(e);let fail=true
 e.checkpoint=()=>{const result=cp();if(fail){fail=false;throw Error('after commit')}return result}
 const p={text:'my favourite orchard',scope:'p',session:'s',captureKey:'s:2:human'}
 assert.throws(()=>e.taskEnd(p),/after commit/)
 const restored=new MemoryEngine({dir});restored._ensure()
 const seq=restored.staging.offerSeq
 restored.staging.pending=[];restored.checkpoint();restored.taskEnd(p)
 assert.equal(restored.staging.pending.length,0);assert.equal(restored.staging.offerSeq,seq)
 } finally{rmSync(dir,{recursive:true,force:true})}
})
