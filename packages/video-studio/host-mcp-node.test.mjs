import {createHostMcpUiOrigin,createHostMcpIntent,beginHostMcpPreparation,closeHostMcpIntent} from './host-mcp-intent.js';
const uploadIntent=()=>{const config={adapter:'workrallyMcp',tool:'canvas_generate_image'},task={id:'fixture-upload',config,referenceIds:['ref']},intent=createHostMcpIntent({origin:createHostMcpUiOrigin('image-studio'),task});beginHostMcpPreparation(intent,{request:task,profile:config,refs:[{id:'ref'}]});return intent;};
import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import {createHostMcpDispatcher} from './host-mcp-dispatch.js';

// No installed Harness configuration, provider connection, credential, port or
// paid call is used. Only a fresh official Node PTC process and synthetic tools.
// Local source checkouts may lack this optional host provider. Release guards
// must use DSH_REQUIRE_NODE_PTC_TESTS=1 and require five passed / zero skipped.
let missingProvider=false;
try{import.meta.resolve('@deepseek-ai/dsh-ptc-runtime-node');}
catch(error){
 if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
 missingProvider=true;
}
if(missingProvider&&process.env.DSH_REQUIRE_NODE_PTC_TESTS==='1'){
 throw Error('Required real Node PTC regression suite cannot run: @deepseek-ai/dsh-ptc-runtime-node is unavailable');
}
const skip=missingProvider?'Optional @deepseek-ai/dsh-ptc-runtime-node is not installed; set DSH_REQUIRE_NODE_PTC_TESTS=1 in release guards':false;
// Missing transitive services or a broken installed provider are failures, not
// optional skips. Import only public package entrypoints, never release paths.
const providers=missingProvider?[]:await Promise.all([
 '@deepseek-ai/dsh-fs-local',
 '@deepseek-ai/dsh-subprocess-local',
 '@deepseek-ai/dsh-sandbox-local',
 '@deepseek-ai/dsh-session-projection',
 '@deepseek-ai/dsh-sandbox-policy',
 '@deepseek-ai/dsh-ptc-runtime-node',
].map(name=>import(name).then(module=>module.default)));
const [Fs,Subprocess,Sandbox,Projections,Policy,NodePtc]=providers;
const TOOL='mcp__workrally__who_am_i';
const PRIVATE_METADATA='fixture-metadata-must-not-enter-ptc';
const output={schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]};
const nodeTest=(name,run)=>test(name,{skip},run);

async function fixture(executionMode='per-call',metadataBody=async()=>({metadata:PRIVATE_METADATA})){
 const host=new Context(),plugins=[];
 try{
  // No active Harness/session is imported. All services belong to this context.
  for(const [plugin,config]of [
   [SystemPrompt],[Fs],[Subprocess],[Sandbox],[Projections],
   [Policy,{mode:'danger-full-access',workspaceRoot:process.cwd()}],
   [NodePtc,{executionMode,timeoutMs:10000,maxTimeoutMs:10000}],
   [ToolRuntime,{mode:'ptc'}],
  ])plugins.push(await host.plugin(plugin,config));
  assert.ok(host.get('ptcRuntime'),'official Node provider must be active');
  const calls=[],observed=[];
  host.on('tools/execute',async(exec,next)=>{calls.push(exec);return next()});
  host.on('tools/result',(exec,result)=>observed.push({name:exec.name,result}));
  let count=0;
  host.tools.register({
   name:TOOL,description:'Synthetic offline metadata only',
   parameters:{type:'object',properties:{},additionalProperties:false},output,
   execute:async(args,exec)=>{count++;return metadataBody(args,exec)},
  });
  const dispatcher=createHostMcpDispatcher(host);
  return {
   host,dispatcher,calls,observed,get count(){return count},
   async close(){dispatcher.close();for(const plugin of plugins.reverse())await plugin.dispose()},
  };
 }catch(error){for(const plugin of plugins.reverse())await plugin.dispose();throw error;}
}
const signal=()=>new AbortController().signal;

nodeTest('real Node PTC: direct native call is rejected; public bridge creates the real parent chain',async()=>{
 const f=await fixture();
 try{
  const direct=await f.host.tools.execute({name:TOOL,arguments:{},signal:signal(),callId:'fixture-direct-native'});
  assert.equal(direct.isError,true);assert.equal(f.count,0);
  const raw=await f.dispatcher.dispatch({name:TOOL,arguments:{},signal:signal()});
  assert.equal(raw.value.metadata,PRIVATE_METADATA);assert.equal(f.count,1);
  const outer=f.calls.find(exec=>exec.name==='run_code');
  const helper=f.calls.find(exec=>exec.name.startsWith('workshop_host_mcp_'));
  const inner=f.calls.find(exec=>exec.name===TOOL);
  assert.ok(outer&&helper&&inner);
  assert.equal(helper.parent,outer.token);assert.equal(inner.parent,helper.token);
  assert.equal(inner.agent,undefined);assert.equal(typeof inner.parent,'symbol');
  assert.equal(inner.rootCallId,outer.rootCallId);
  assert.equal(JSON.stringify(f.observed.filter(event=>event.name!==TOOL)).includes(PRIVATE_METADATA),false);
  assert.equal(f.host.tools.get(helper.name,{id:'fixture-agent',session:{id:'fixture-session'}}),undefined);
 }finally{await f.close()}
});

nodeTest('real Node PTC: inner monotonic guard still denies the call without retry',async()=>{
 const f=await fixture();
 try{
  const stop=f.host.tools.guard(exec=>exec.name===TOOL?'Fixture deny':undefined);
  const result=await f.dispatcher.dispatch({name:TOOL,arguments:{},signal:signal()});
  assert.equal(result.isError,true);assert.equal(f.count,0);stop();
  assert.equal((await f.dispatcher.dispatch({name:TOOL,arguments:{},signal:signal()})).isError,false);
  assert.equal(f.count,1);
 }finally{await f.close()}
});

nodeTest('real Node PTC: STS ticket stays private through helper, transport and result observers',async()=>{
 const {createPrivateMcpResultGate}=await import('./private-mcp-result.js');
 const f=await fixture(),gate=createPrivateMcpResultGate(f.host);
 const tokenTool='mcp__workrally__get_upload_token',ticket='fixture-upload-ticket-private';
 try{
  f.host.tools.register({
   name:tokenTool,description:'Synthetic ticket; no upload',
   parameters:{type:'object',properties:{},additionalProperties:false},output,
   execute:async()=>({content:[{type:'text',text:JSON.stringify({tmp_token:ticket})}],structuredContent:{tmp_token:ticket}}),
  });
  const raw=await f.dispatcher.dispatch({hostIntent:uploadIntent(),name:tokenTool,arguments:{},signal:signal(),invoke:async(exec,input)=>{
   const permit=gate.begin({tool:input.name,agent:exec.agent,parent:exec.token,callId:input.callId});
   try{
    const visible=await f.host.tools.execute({...input,callId:permit.callId,parent:exec.token});
    assert.equal(visible.isError,false);
    return gate.take({callId:permit.callId,tool:input.name,agent:exec.agent,parent:exec.token});
   }finally{gate.clear(permit.callId)}
  }});
  assert.equal(raw.value.structuredContent.tmp_token,ticket);
  assert.equal(JSON.stringify(f.observed).includes(ticket),false);
 }finally{gate.close();await f.close()}
});

nodeTest('real Node PTC: persistent-in-memory REPL format uses the same fixed host helper',async()=>{
 const f=await fixture('persistent-in-memory');
 try{
  const raw=await f.dispatcher.dispatch({name:TOOL,arguments:{},signal:signal()});
  assert.equal(raw.value.metadata,PRIVATE_METADATA);assert.equal(f.count,1);
  assert.equal(JSON.stringify(f.observed.filter(event=>event.name!==TOOL)).includes(PRIVATE_METADATA),false);
 }finally{await f.close()}
});

nodeTest('real Node PTC: WorkRally discover/prepare and Kling metadata run agentless with mocked uploads',async()=>{
 const {createMcpRuntime}=await import('./mcp-runtime.js');
 const {createPrivateMcpResultGate}=await import('./private-mcp-result.js');
 const {workrallySpecs,workrallyProfile}=await import('./workrally-capabilities.js');
 const identity={accountId:'fixture-user',corpId:'fixture-corp',isEnterprise:true};
 const who={isEnterprise:true,userInfo:{profile:{uid:identity.accountId},corp:{id:identity.corpId}}};
 const wrap=body=>({content:[{type:'text',text:JSON.stringify(body)}]});
 const image={models:[{model_id:'fixture-img',name:'Fixture',aspect_ratios:['16:9'],resolution_options:[{value:4,label:'1K'}],kontext_config:{max_input_images:1},infer_quality_options:[]}],aspect_ratios:['16:9']};
 const video={text_providers:[],first_last_frame_providers:[],subject_to_video_providers:[],video_edit_providers:[],smart_edit_providers:[],aspect_ratios:['16:9']};
 const ticket={tmp_secret_id:'fixture-id-PRIVATE',tmp_secret_key:'fixture-key-PRIVATE',tmp_token:'fixture-token-PRIVATE',bucket:'fixture-123456',region:'ap-guangzhou',key:'fixture/image.png',is_private:false};
 const f=await fixture('per-call',async()=>wrap(who)),gate=createPrivateMcpResultGate(f.host),uploads=[];
 try{
  for(const [name,body]of [
   ['mcp__workrally__canvas_image_model_list',image],
   ['mcp__workrally__canvas_video_provider_config',video],
   ['mcp__workrally__get_upload_token',ticket],
   ['mcp__Plugin-DeepSeek-kling-ai__who_am_i',{user:{userId:'fixture-kling'},availableModels:{text_to_image:[]}}],
  ])f.host.tools.register({
   name,description:'Synthetic offline MCP fixture',
   parameters:{type:'object',properties:{file_ext:{type:'string'},upload_type:{type:'number'}},additionalProperties:false},output,
   execute:async()=>wrap(body),
  });
  const runtime=createMcpRuntime({
   getTools:()=>f.host.tools,hostMcpDispatcher:f.dispatcher,privateMcpResultGate:gate,
   fetchUpload:async(url,options)=>{uploads.push({url,options});return new Response(null,{status:200})},
  });
  assert.equal((await runtime.workrally.discover()).image.models[0].model_id,'fixture-img');
  const profile=workrallyProfile(workrallySpecs({identity,image,video})[0]);
  const request={requestId:'fixture-prepare',prompt:'fixture',n:1,resolution:'4',aspectRatio:'16:9',extra:{},referenceIds:['ref']};
  await assert.rejects(runtime.workrally.prepare(request,profile,[{id:'ref'}],async()=>Buffer.from('fixture')),/业务意图/);
  const intent=createHostMcpIntent({origin:createHostMcpUiOrigin('image-studio'),task:{...request,id:request.requestId,config:profile}});
  const plan=await runtime.workrally.prepare(
   request,profile,
   [{id:'ref',type:'image/png',name:'fixture.png'}],async()=>Buffer.from('fixture bytes'),undefined,undefined,intent,
  );
  closeHostMcpIntent(intent);
  assert.equal(plan.payload.input_images.length,1);assert.equal(uploads.length,1);
  assert.equal(uploads[0].options.headers['x-cos-security-token'],ticket.tmp_token);
  assert.equal((await runtime.identity()).user.userId,'fixture-kling');
  assert.ok(!f.calls.some(exec=>exec.name.includes('generate_')));
  assert.ok(f.calls.filter(exec=>exec.name.startsWith('mcp__')).every(exec=>exec.agent===undefined&&typeof exec.parent==='symbol'));
  for(const key of ['tmp_secret_id','tmp_secret_key','tmp_token'])assert.equal(JSON.stringify(f.observed).includes(ticket[key]),false);
  assert.equal(JSON.stringify(plan).includes(ticket.tmp_token),false);
 }finally{gate.close();await f.close()}
});
