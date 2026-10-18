import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import {createPrivateMcpResultGate} from './private-mcp-result.js';
import {createWorkrallyRuntime} from './workrally-runtime.js';
import {workrallySpecs,workrallyProfile} from './workrally-capabilities.js';

const tool='mcp__workrally__get_upload_token';
const agent={id:'private-gate-fixture',session:{id:'private-gate-session'}};
const secret={tmp_secret_id:'synthetic-id-secret',tmp_secret_key:'synthetic-key-secret',tmp_token:'synthetic-sts-secret',bucket:'synthetic-bucket-123',region:'ap-guangzhou',key:'private/object.png',is_private:true};
const output={schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]};

async function fixture(execute,fixtureOutput=output){
 const host=new Context(),prompt=await host.plugin(SystemPrompt),plugin=await host.plugin(ToolRuntime,{mode:'native'}),gate=createPrivateMcpResultGate(host),observed=[];
 const stop=host.on('tools/result',(exec,result)=>observed.push({exec,result}));
 host.tools.register({name:tool,description:'Synthetic fixture',parameters:{type:'object',properties:{},additionalProperties:false},output:fixtureOutput,async execute(args,exec){return execute(args,exec)}});
 return {host,plugin,prompt,gate,observed,async close(){stop?.();gate.close();await plugin.dispose();await prompt.dispose();}};
}
const call=(host,callId,signal=new AbortController().signal,caller=agent)=>host.tools.execute({name:tool,arguments:{},agent:caller,signal,callId});
const permit=gate=>gate.begin({tool,agent});

test('MCP-shaped values stay private through output rendering, post-policy and result publication',async()=>{
 const raw={content:[{type:'text',text:JSON.stringify(secret)}],structuredContent:{...secret}};
 // Match the MCP bridge's canonical value schema and text extraction path.
 const mcpOutput={schema:{type:'object',properties:{content:{type:'array',items:{}},structuredContent:{}},required:['content'],additionalProperties:false},render:(_args,value)=>[{type:'text',text:value.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')}]};
 const f=await fixture(async()=>structuredClone(raw),mcpOutput),post=[];
 const stop=f.host.on('tools/post-execute',(_exec,result,next)=>{post.push(result);return next(result)});
 try{
  const p=permit(f.gate),result=await call(f.host,p.callId);
  assert.equal(result.isError,false);assert.equal(post.length,1);
  const published=JSON.stringify({result,post,observed:f.observed});
  for(const key of ['tmp_secret_id','tmp_secret_key','tmp_token'])assert.equal(published.includes(secret[key]),false,key+' must remain private');
  assert.equal(f.gate.take({callId:p.callId,tool,agent}).value.structuredContent.tmp_token,secret.tmp_token);
  assert.equal(f.gate.take({callId:p.callId,tool,agent}),undefined);f.gate.clear(p.callId);
 }finally{stop?.();await f.close();}
});

test('RC2 result observers see scrubbed value/content while the authorized single consumer gets the raw ticket',async()=>{
 const f=await fixture(async()=>structuredClone(secret));
 try{
  const p=permit(f.gate),result=await call(f.host,p.callId);
  assert.equal(result.isError,false);assert.equal(f.observed.length,1);
  assert.equal(JSON.stringify(result).includes('synthetic-sts-secret'),false);
  assert.equal(JSON.stringify(f.observed[0].result).includes('synthetic-key-secret'),false);
  assert.equal(JSON.stringify(f.observed[0].result).includes('synthetic-id-secret'),false);
  const captured=f.gate.take({callId:p.callId,tool,agent});assert.equal(captured.value.tmp_token,secret.tmp_token);
  assert.equal(f.gate.take({callId:p.callId,tool,agent}),undefined);
  f.gate.clear(p.callId);
 }finally{await f.close();}
});

test('policy denial and thrown tool errors cannot return raw STS data',async()=>{
 const f=await fixture(async()=>{throw Error(secret.tmp_token)});
 try{
  const denied=f.gate.begin({tool,agent});const unguard=f.host.tools.guard(exec=>exec.callId===denied.callId?'Synthetic permission denied':undefined);
  const rejection=await call(f.host,denied.callId);unguard();
  assert.equal(rejection.isError,true);assert.equal(JSON.stringify(rejection).includes(secret.tmp_token),false);
  assert.equal(JSON.stringify(f.observed.at(-1).result).includes(secret.tmp_token),false);f.gate.clear(denied.callId);
  const thrown=f.gate.begin({tool,agent}),failed=await call(f.host,thrown.callId);
  assert.equal(failed.isError,true);assert.equal(JSON.stringify(f.observed.at(-1).result).includes(secret.tmp_token),false);
  assert.equal(f.gate.take({callId:thrown.callId,tool,agent}),undefined);f.gate.clear(thrown.callId);
 }finally{await f.close();}
});

test('unissued or wrong-agent token calls are denied inside the around-dispatch gate',async()=>{
 const f=await fixture(async()=>structuredClone(secret));
 try{
  const denied=await call(f.host,'unissued-private-call');assert.equal(denied.isError,true);assert.equal(JSON.stringify(denied).includes(secret.tmp_token),false);
  const p=permit(f.gate),wrong=await call(f.host,p.callId,new AbortController().signal,{id:'other-agent'});
  assert.equal(wrong.isError,true);assert.equal(JSON.stringify(f.observed.at(-1).result).includes(secret.tmp_secret_key),false);f.gate.clear(p.callId);
 }finally{await f.close();}
});

test('caller cancellation after dispatch drains privately and publishes only the cancellation result',async()=>{
 let started;const ready=new Promise(resolve=>started=resolve);let release;
 const f=await fixture(async()=>{started();await new Promise(resolve=>release=resolve);return structuredClone(secret)});
 try{
  const p=permit(f.gate),controller=new AbortController(),pending=call(f.host,p.callId,controller.signal);await ready;controller.abort();release();const result=await pending;
  assert.equal(result.isError,true);assert.equal(JSON.stringify(f.observed.at(-1).result).includes(secret.tmp_token),false);
  assert.equal(f.gate.take({callId:p.callId,tool,agent}),undefined);f.gate.clear(p.callId);
 }finally{await f.close();}
});

test('concurrent private calls retain per-call capture and clear independently',async()=>{
 const barriers=new Map(),f=await fixture(async(args,exec)=>{await new Promise(resolve=>barriers.set(exec.callId,resolve));return {...secret,tmp_token:exec.callId+'-private-token'};});
 try{
  const a=permit(f.gate),b=permit(f.gate),pa=call(f.host,a.callId),pb=call(f.host,b.callId);
  while(barriers.size<2)await new Promise(resolve=>setTimeout(resolve,0));barriers.get(b.callId)();barriers.get(a.callId)();
  const [ra,rb]=await Promise.all([pa,pb]);assert.equal(ra.isError,false);assert.equal(rb.isError,false);
  assert.equal(f.gate.take({callId:a.callId,tool,agent}).value.tmp_token,a.callId+'-private-token');
  assert.equal(f.gate.take({callId:b.callId,tool,agent}).value.tmp_token,b.callId+'-private-token');
  assert.equal(JSON.stringify(f.observed).includes('private-token'),false);f.gate.clear(a.callId);f.gate.clear(b.callId);
 }finally{await f.close();}
});

test('two Studio plugin contexts share one gate listener with isolated leases and ref-counted cleanup',async()=>{
 const host=new Context(),prompt=await host.plugin(SystemPrompt),runtime=await host.plugin(ToolRuntime,{mode:'native'});
 const before=host.events._hooks['tools/execute']?.length||0;
 let gateA,gateB,ctxA,ctxB;const pluginA=await host.plugin(ctx=>{ctxA=ctx;gateA=createPrivateMcpResultGate(ctx);});
 const pluginB=await host.plugin(ctx=>{ctxB=ctx;gateB=createPrivateMcpResultGate(ctx);});
 const observed=[];
 const stop=host.on('tools/result',(_exec,result)=>observed.push(result));
 host.tools.register({name:tool,description:'Synthetic fixture',parameters:{type:'object',properties:{},additionalProperties:false},output,async execute(_args,exec){return {...secret,tmp_token:exec.callId+'-ticket'}}});
 try{
  assert.notEqual(ctxA,ctxB);assert.equal(ctxA.root,ctxB.root);assert.equal(host.events._hooks['tools/execute'].length,before+1);
  const a=gateA.begin({tool,agent}),b=gateB.begin({tool,agent});
  assert.equal(gateA.take({callId:b.callId,tool,agent}),undefined);gateA.clear(b.callId);
  const [ra,rb]=await Promise.all([call(host,a.callId),call(host,b.callId)]);
  assert.equal(ra.isError,false);assert.equal(rb.isError,false);
  assert.equal(gateA.take({callId:a.callId,tool,agent}).value.tmp_token,a.callId+'-ticket');
  assert.equal(gateB.take({callId:b.callId,tool,agent}).value.tmp_token,b.callId+'-ticket');
  gateA.clear(a.callId);gateB.clear(b.callId);
  const orphanA=gateA.begin({tool,agent});gateA.close();
  assert.equal(gateB.take({callId:orphanA.callId,tool,agent}),undefined);
  const stillOwned=gateB.begin({tool,agent}),safe=await call(host,stillOwned.callId);
  assert.equal(safe.isError,false);assert.equal(gateB.take({callId:stillOwned.callId,tool,agent}).value.tmp_token,stillOwned.callId+'-ticket');gateB.clear(stillOwned.callId);
  assert.equal(JSON.stringify(observed).includes('-ticket'),false);
  assert.equal(host.events._hooks['tools/execute'].length,before+1);
  gateB.close();assert.equal(host.events._hooks['tools/execute']?.length||0,before);
  assert.equal(host.root[Symbol.for('deepseek.video-studio.private-mcp-result-gate.v1')],undefined);
 }finally{gateA?.close();gateB?.close();stop?.();await pluginB.dispose();await pluginA.dispose();await runtime.dispose();await prompt.dispose();}
});

test('WorkRally refuses STS-dependent upload when the gate is absent',async()=>{
 const calls=[],who={isEnterprise:false,userInfo:{profile:{uid:'u'},corp:{id:'c'}}},image={models:[{model_id:'im',kontext_config:{max_input_images:1},resolution_options:[],aspect_ratios:['1:1']}]};
 const runtime=createWorkrallyRuntime({getTools:()=>({get:()=>({}),execute:async call=>{calls.push(call.name);const payload=call.name.endsWith('who_am_i')?who:call.name.endsWith('canvas_image_model_list')?image:ticket;return {content:[{type:'text',text:JSON.stringify(payload)}]};}})});
 const profile=workrallyProfile(workrallySpecs({identity:{accountId:'u',corpId:'c',isEnterprise:false},image,video:{}})[0]);
 await assert.rejects(runtime.prepare({prompt:'fixture'},profile,[{id:'image',type:'image/png'}],()=>Buffer.from('x'),undefined,{agent}),/隔离不可用/);
 assert.equal(calls.some(name=>name.endsWith('get_upload_token')),false);
});

test('host permits require a helper token and bind both dispatch and one-time consumption to that parent',async()=>{
 const f=await fixture(async()=>structuredClone(secret));let acquired;
 try{
  assert.throws(()=>f.gate.begin({tool}),/unavailable/);
  assert.throws(()=>f.gate.begin({tool,parent:'invented-token'}),/unavailable/);
  f.host.tools.register({name:'private_host_fixture',description:'Synthetic helper',parameters:{type:'object'},output,async execute(_args,exec){
   const p=f.gate.begin({tool,parent:exec.token});
   try{
    const wrong=await f.host.tools.execute({name:tool,arguments:{},callId:p.callId,parent:Symbol('wrong-parent'),signal:exec.signal});
    assert.equal(wrong.isError,true);
    const safe=await f.host.tools.execute({name:tool,arguments:{},callId:p.callId,parent:exec.token,signal:exec.signal});
    assert.equal(safe.isError,false);
    assert.equal(f.gate.take({callId:p.callId,tool,parent:Symbol('wrong-parent')}),undefined);
    acquired=f.gate.take({callId:p.callId,tool,parent:exec.token});
    assert.equal(f.gate.take({callId:p.callId,tool,parent:exec.token}),undefined);
    const replay=await f.host.tools.execute({name:tool,arguments:{},callId:p.callId,parent:exec.token,signal:exec.signal});
    assert.equal(replay.isError,true);
    return {completed:true};
   }finally{f.gate.clear(p.callId)}
  }});
  const result=await f.host.tools.execute({name:'private_host_fixture',arguments:{},callId:'host-fixture',signal:new AbortController().signal});
  assert.equal(result.isError,false);assert.equal(acquired.value.tmp_token,secret.tmp_token);
  assert.equal(JSON.stringify(f.observed).includes(secret.tmp_token),false);
 }finally{await f.close()}
});

test('host cancellation drains the real helper child without retaining or publishing a ticket',async()=>{
 let started,release;const ready=new Promise(resolve=>started=resolve);
 const f=await fixture(async()=>{started();await new Promise(resolve=>release=resolve);return structuredClone(secret)});let leftover;
 try{
  f.host.tools.register({name:'private_host_cancel_fixture',description:'Synthetic helper',parameters:{type:'object'},output,async execute(_args,exec){
   const p=f.gate.begin({tool,parent:exec.token});
   try{
    const result=await f.host.tools.execute({name:tool,arguments:{},callId:p.callId,parent:exec.token,signal:exec.signal});
    assert.equal(result.isError,true);leftover=f.gate.take({callId:p.callId,tool,parent:exec.token});return {completed:false};
   }finally{f.gate.clear(p.callId)}
  }});
  const controller=new AbortController(),pending=f.host.tools.execute({name:'private_host_cancel_fixture',arguments:{},callId:'host-cancel-fixture',signal:controller.signal});
  await ready;controller.abort();release();assert.equal((await pending).isError,true);
  assert.equal(leftover,undefined);assert.equal(JSON.stringify(f.observed).includes(secret.tmp_token),false);
 }finally{await f.close()}
});

test('concurrent host helper parents retain lease-isolated single-consumer tickets',async()=>{
 const f=await fixture(async(_args,exec)=>({...secret,tmp_token:exec.callId+'-private-ticket'})),other=createPrivateMcpResultGate(f.host),captured=[];
 try{
  for(const [name,gate,foreign]of [['host_lease_a',f.gate,other],['host_lease_b',other,f.gate]])f.host.tools.register({name,description:'Synthetic host helper',parameters:{type:'object'},output,async execute(_args,exec){
   const p=gate.begin({tool,parent:exec.token});
   try{
    const result=await f.host.tools.execute({name:tool,arguments:{},callId:p.callId,parent:exec.token,signal:exec.signal});assert.equal(result.isError,false);
    assert.equal(foreign.take({callId:p.callId,tool,parent:exec.token}),undefined);foreign.clear(p.callId);
    const ticket=gate.take({callId:p.callId,tool,parent:exec.token});assert.equal(ticket.value.tmp_token,p.callId+'-private-ticket');captured.push(name);
    return {completed:true};
   }finally{gate.clear(p.callId)}
  }});
  const results=await Promise.all(['host_lease_a','host_lease_b'].map(name=>f.host.tools.execute({name,arguments:{},callId:name,signal:new AbortController().signal})));
  assert.ok(results.every(result=>!result.isError));assert.equal(captured.length,2);
  assert.equal(JSON.stringify(f.observed).includes('-private-ticket'),false);
 }finally{other.close();await f.close()}
});
