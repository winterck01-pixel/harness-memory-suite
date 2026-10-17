import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {SystemPrompt} from '@deepseek-ai/dsh-system-prompt';
import {ToolRuntime} from '@deepseek-ai/dsh-tools';
import {createScope,scopeTarget} from '@deepseek-ai/dsh-scope';
import {catalog} from './fixtures/catalog.mjs';
import * as plugin from '../index.js';
const ctx=new Context();const systemFiber=await ctx.plugin(SystemPrompt,{});const toolsFiber=await ctx.plugin(ToolRuntime,{});
const tools=ctx.get('tools'),sp=ctx.get('systemPrompt');let calls=0;

for(const t of catalog.filter(t=>!['search_experience','read_knowledge_fragment'].includes(t.name)))tools.register({...t,output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute:()=>{calls++;return 'SYNTHETIC_TOOL_OK';}});
const policyFiber=await ctx.plugin(plugin);
const agent={id:'synthetic-native-agent',session:{id:'synthetic-policy-test'}};
const scope=createScope(ctx,agent);agent.ctx=scope.ctx;
try {
 const send=(text,turn=1)=>ctx.emit(scopeTarget(ctx,agent),'agent/inbox/claimed',{agent,turn,message:{source:{kind:'user'},content:[{type:'text',text}]}});
 const signal=new AbortController().signal;
 const execute=(name,args={})=>tools.execute({name,arguments:args,callId:`synthetic-${name}-${calls}`,agent,signal});
 send('你好');let a=await sp.assemble({agent,scope:agent});assert.ok(a.tools.some(t=>t.name==='activate_tool_group'));assert.ok(!a.tools.some(t=>t.name==='bash'));
 const first=a.tools.length;
 let r=await execute('bash',{command:'synthetic'});assert.equal(r.isError,true,JSON.stringify(r));assert.equal(calls,0);
 r=await execute('activate_tool_group',{group:'developer'});assert.ok(!r.isError,JSON.stringify(r));
 a=await sp.assemble({agent,scope:agent});assert.ok(a.tools.some(t=>t.name==='bash'));
 r=await execute('bash',{command:'synthetic'});assert.ok(!r.isError,JSON.stringify(r));assert.equal(calls,1);
 send('不要调用任何工具',2);a=await sp.assemble({agent,scope:agent});assert.equal(a.tools.length,0);
 r=await execute('bash',{command:'synthetic'});assert.equal(r.isError,true,JSON.stringify(r));assert.equal(calls,1);
 const msg=text=>({source:{kind:'user'},content:[{type:'text',text}]});
 const events=[{type:'turn/start',data:{turn:8}},{type:'user/message',data:msg('本轮不使用记忆')}];
 const resumed={id:'synthetic-resumed-agent',session:{get seq(){return events.length},snapshotEvents(a,b){return events.slice(a,b)}}};
 const rs=createScope(ctx,resumed);resumed.ctx=rs.ctx;
 try {
  a=await sp.assemble({agent:resumed,scope:resumed});assert.ok(!a.tools.some(t=>t.name.startsWith('mnemo_')));
  r=await tools.execute({name:'mnemo_recall',arguments:{},callId:'resume-block',agent:resumed,signal});assert.equal(r.isError,true);
  events.push({type:'turn/end',data:{turn:8}},{type:'turn/start',data:{turn:9}});
  a=await sp.assemble({agent:resumed,scope:resumed});assert.ok(a.tools.some(t=>t.name==='mnemo_recall'));
  r=await tools.execute({name:'mnemo_recall',arguments:{},callId:'resume-restored',agent:resumed,signal});assert.ok(!r.isError,JSON.stringify(r));assert.equal(calls,2);
 } finally {await rs.dispose();}
 console.log(JSON.stringify({actualHostRuntime:true,ordinaryTools:first,explicitActivation:true,enabledExecution:true,noToolsGuard:true,restartMemoryGuard:true,endedTurnRestores:true}));
} finally {await scope.dispose();await policyFiber.dispose();await toolsFiber.dispose();await systemFiber.dispose();}
