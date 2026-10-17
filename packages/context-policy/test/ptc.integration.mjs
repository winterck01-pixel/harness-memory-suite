import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import {SystemPrompt} from '@deepseek-ai/dsh-system-prompt';
import {ToolRuntime} from '@deepseek-ai/dsh-tools';
import {PtcRuntime} from '@deepseek-ai/dsh-ptc-runtime';
import {createScope,scopeTarget} from '@deepseek-ai/dsh-scope';
import * as plugin from '../index.js';
const cwd=await mkdtemp(join(tmpdir(),'context-policy-ptc-'));
let target='read',calls=0,activation={tools:['read']},sequence=0;const bindingAttempts=[];
class BindingRuntime extends PtcRuntime {
 language='typescript';isolation='synthetic';resolve(r){return {...r,cwd};}
 async run(r){bindingAttempts.push(target);try{return {logs:[],value:await r.bindings[0].functions[target](target==='activate_tool_group'?activation:{})};}catch(e){return {logs:[],value:{denied:true,message:e.message}};}}
}
const ctx=new Context();

ctx.provide('workingDirectory',{ensure:async()=>cwd});
const systemFiber=await ctx.plugin(SystemPrompt,{});const bindingFiber=await ctx.plugin(BindingRuntime);const toolsFiber=await ctx.plugin(ToolRuntime,{mode:'ptc'});
const tools=ctx.get('tools'),sp=ctx.get('systemPrompt');
for(const name of ['read','mnemo_recall'])tools.register({name,description:'Synthetic test only',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute:()=>{calls++;return 'SYNTHETIC';}});
const policyFiber=await ctx.plugin(plugin);
const agent={id:'synthetic-ptc-agent',session:{header:{cwd},append(){}}};const scope=createScope(ctx,agent);agent.ctx=scope.ctx;
try {
 const send=(text,turn)=>ctx.emit(scopeTarget(ctx,agent),'agent/inbox/claimed',{agent,turn,message:{source:{kind:'user'},content:[{type:'text',text}]}});
 const run=()=>tools.execute({name:'run_code',arguments:{code:'synthetic binding',description:'synthetic'},callId:`synthetic-${++sequence}`,agent,signal:new AbortController().signal});
 send('读取文件',1);let a=await sp.assemble({agent,scope:agent});assert.deepEqual(a.tools.map(x=>x.name),['run_code']);
 await run();assert.deepEqual(bindingAttempts,['read'],'The real host transport reached the synthetic program runtime');assert.equal(calls,0,'Native read remains unavailable before activation');
 target='activate_tool_group';let r=await run();assert.ok(!r.isError,JSON.stringify(r));
 await sp.assemble({agent,scope:agent});target='read';r=await run();assert.ok(!r.isError,JSON.stringify(r));assert.equal(calls,1,'Explicit activation permits a real nested host read');
 send('本轮不使用记忆',2);await sp.assemble({agent,scope:agent});target='mnemo_recall';await run();assert.equal(calls,1);
 target='activate_tool_group';activation={tools:['mnemo_recall']};await run();await sp.assemble({agent,scope:agent});target='mnemo_recall';await run();assert.equal(calls,1);
 send('请回忆之前的信息',3);await sp.assemble({agent,scope:agent});r=await run();assert.ok(!r.isError,JSON.stringify(r));assert.equal(calls,2);
 const beforeNoTools=bindingAttempts.length;send('不要调用任何工具',4);a=await sp.assemble({agent,scope:agent});assert.equal(a.tools.length,0);target='read';r=await run();assert.equal(r.isError,true);assert.equal(calls,2);assert.equal(bindingAttempts.length,beforeNoTools,'No-tools guard blocks the transport before program execution');
 console.log(JSON.stringify({actualInstalledToolRuntime:true,ptcNestedRead:true,ptcNestedActivation:true,memoryOptOut:true,activationCannotRestoreMemory:true,nextTurnRestore:true,noTools:true}));
} finally {await scope.dispose();await policyFiber.dispose();await toolsFiber.dispose();await bindingFiber.dispose();await systemFiber.dispose();await rm(cwd,{recursive:true,force:true});}
