import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkshopAuthority} from './workshop-agent-authority.js';

const context=()=>({sessionId:'synthetic-session',execution:{agent:{session:{id:'synthetic-session'}},signal:new AbortController().signal},action:'generate',paid:true,input:{canvasId:'synthetic-canvas',models:['synthetic-model'],requestId:'synthetic-request'}});
test('model flags cannot authorize paid generation and missing human answerer fails closed',async()=>{
 const value=context();value.input.confirmCost=true;
 await assert.rejects(createWorkshopAuthority({get:()=>undefined})(value),{code:'AUTHORIZATION_REQUIRED'});
 assert.equal(await createWorkshopAuthority({get:()=>{throw Error('must not ask')}})({...value,paid:false}),true);
 assert.equal(await createWorkshopAuthority({get:()=>undefined})({...value,sessionId:'different'}),false);
});
test('only the exact host human answer authorizes the unchanged request',async()=>{
 for(const choice of ['approve','cancel','custom','wrong-id','mutate']){
  const value=context();
  const authority=createWorkshopAuthority({get:()=>({async ask(request){
   assert.equal(request.agent,value.execution.agent);assert.equal(request.signal,value.execution.signal);
   assert.match(request.questions[0].detail,/未知/);
   if(choice==='mutate')value.input.models=['different-model'];
   return {answers:[{id:choice==='wrong-id'?'wrong':request.questions[0].id,selected:[choice==='cancel'?'取消':'确认本次生成'],...(choice==='custom'?{custom:'yes'}:{})}]};
  }})});
  if(choice==='approve')assert.equal(await authority(value),true);
  else await assert.rejects(authority(value),{code:'AUTHORIZATION_REQUIRED'});
 }
});
