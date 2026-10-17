import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryOptOut} from '../lib/context-policy.js'
import {MemoryEngine} from '../lib/engine.js'
import {Maintenance} from '../lib/maintenance.js'

test('a general question can explicitly exclude personal project context',async()=>{
 for(const text of ['解释一下缓存原理。不用联系任何具体项目。','无需结合我的历史，给一般答案。',"Don't relate this to personal projects."]){
  assert.equal(memoryOptOut(text),true,text)
  const e=new MemoryEngine({dir:'/unused-r3-optout'})
  assert.deepEqual(e.recall(text),[])
  const m=new Maintenance(e,async()=>{throw Error('must not call model')})
  assert.deepEqual(await m.semanticRecall(text,{scope:'p'}),[])
 }
 for(const text of ['请解释“不要参考我的历史”这句话。','这个项目无需登录。','项目如何关联历史记录？'])assert.equal(memoryOptOut(text),false,text)
})
