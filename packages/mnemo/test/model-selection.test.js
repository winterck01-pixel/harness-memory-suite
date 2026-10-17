import test from 'node:test'
import assert from 'node:assert/strict'
import {modelGenerator} from '../lib/model-client.js'

test('auxiliary evaluation uses current model selection even before its first new request header',async()=>{
 const calls=[],session={requestHeader:()=>({config:{provider:'deepseek-official',model:'deepseek-flash'}})}
 let next={provider:'text-model-example',model:'text-model-example'}
 const ctx={get:name=>({
  sessionProjections:{stateOf:(actual,key)=>{assert.equal(actual,session);assert.equal(key,'modelSelection');return {pending:next,lastUsed:{provider:'deepseek-official',model:'deepseek-flash'}}}},
  agentDefaultModel:{currentSelection:()=>({provider:'fallback',model:'fallback'})},
  llm:{stream:async function*(request){calls.push(request);yield {type:'text-delta',index:0,text:'{"answer":7}'};yield {type:'finish',reason:{kind:'stop'}}}},
 }[name])}
 const generate=modelGenerator(ctx),agent={id:'parent',session,options:{provider:'deepseek-official',model:'deepseek-flash'}}
 const snapshot=generate.snapshot(agent)
 next={provider:'different',model:'different'}
 await generate('Return JSON',{question:'Return 7'},{agent:snapshot,isolated:true})
 assert.equal(calls[0].provider,'text-model-example')
 assert.equal(calls[0].model,'text-model-example')
 assert.notEqual(calls[0].sessionId,'parent')
 await generate('Return JSON',{question:'Return 7'},{agent,isolated:true})
 assert.equal(calls[1].provider,'different')
})
