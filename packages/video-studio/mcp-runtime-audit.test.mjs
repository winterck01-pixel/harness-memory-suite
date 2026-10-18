// Local synthetic fixtures only: no host, account authorization, or real generation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtemp,mkdir,readFile,writeFile,realpath,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createMcpRuntime,unpackMcp,createHostMcpUiOrigin} from './mcp-runtime.js';
import {beginHostMcpPreparation} from './host-mcp-intent.js';
import {specsFromIdentity,mcpProfile} from './mcp-capabilities.js';
import {createEngine as videoEngine} from './generation.js';
async function imagePackageEntry(importer){
 const sibling=new URL('../image-studio/package.json',importer);
 let manifest;
 try{manifest=JSON.parse(await readFile(sibling,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(manifest?.name==='dsh-image-studio')return new URL('./index.js',sibling);
 return pathToFileURL(createRequire(importer).resolve('dsh-image-studio'));
}
const imageEntry=await imagePackageEntry(import.meta.url);
const {createEngine:imageEngine}=await import(new URL('./generation.js',imageEntry));
import {registerMcpModels as videoModels,modelSpec as videoSpec} from './model-registry.js';
const {registerMcpModels:imageModels,modelSpec:imageSpec}=await import(new URL('./model-registry.js',imageEntry));
const wrap=body=>({structuredContent:body});
function fixture(kind='video',inputs=[],argumentsExtra=[]){
 const tool=kind==='video'?'text_to_video':'text_to_image';
 const identity={user:{userId:'audit-account'},availableModels:{[tool]:[{model:'audit-'+kind,arguments:[{name:'prompt',required:true},{name:'duration',default:'5',allowedValues:['5']},...argumentsExtra],inputs}]}};
 const spec=specsFromIdentity(identity)[0],profile=mcpProfile(spec);
 return {identity,spec,profile,config:{baseUrl:'https://unconfigured.invalid',generatePath:'/generate',editPath:'/edit',queryPath:'/tasks/{id}',enabledModels:[spec.id],defaultModel:spec.id,modelProfiles:{[spec.id]:profile}}};
}
function runtime(f,{uploadBody={url:'https://assets.invalid/reference'}}={}){
 const calls=[],tools={get:()=>({parameters:{}}),execute:async call=>{calls.push(call);return wrap(call.name.endsWith('who_am_i')?f.identity:{ticket:'synthetic',uploadUrl:'https://upload.invalid'});}};
 return {calls,mcp:createMcpRuntime({getTools:()=>tools,fetchUpload:async()=>Response.json(uploadBody)})};
}
const request={requestId:randomUUID(),prompt:'synthetic',extra:{}};
const ref={id:'ref',name:'fixture.png',type:'image/png'};
test('required declaration defaults are serialized and explicit values override them',async()=>{
 const f=fixture('image',[],[{name:'camera',required:true,default:'fixed',allowedValues:['fixed','moving']},{name:'options',required:true,default:{strength:1}}]),{mcp}=runtime(f);
 const plan=await mcp.prepare(request,f.profile,[],async()=>Buffer.from('fixture'));
 assert.equal(plan.payload.arguments.find(a=>a.name==='camera').value,'fixed');
 assert.equal(plan.payload.arguments.find(a=>a.name==='options').value,'{"strength":1}');
 const explicit=await mcp.prepare({...request,extra:{camera:'moving'}},f.profile,[],async()=>Buffer.from('fixture'));
 assert.equal(explicit.payload.arguments.find(a=>a.name==='camera').value,'moving');
});
test('HTTP 200 upload business failure carrying a URL is rejected',async()=>{
 const f=fixture('image',[{name:'image_1',required:true}]),{mcp,calls}=runtime(f,{uploadBody:{ok:false,error:'rejected',url:'https://assets.invalid/invalid'}});
 await assert.rejects(mcp.prepare(request,f.profile,[ref],async()=>Buffer.from('fixture')),/上传.*失败/);
 assert.equal(calls.filter(c=>c.name.endsWith(f.profile.tool)).length,0);
});
test('slot binding rejects removed refs and missing required slots before uploading',async()=>{
 const f=fixture('image',[{name:'image_1',required:true}]),{mcp,calls}=runtime(f);
 await assert.rejects(mcp.prepare(request,f.profile,[],async()=>Buffer.from('fixture')),/必填参考槽位/);
 await assert.rejects(mcp.prepare({...request,extra:{__mcpInputs:{removed:'image_1'}}},f.profile,[ref],async()=>Buffer.from('fixture')),/已移除/);
 assert.equal(calls.filter(c=>c.name.endsWith('file_upload')).length,0);
 const plan=await mcp.prepare({...request,extra:{__mcpInputs:{ref:'image_1'}}},f.profile,[ref],async()=>Buffer.from('fixture'));
 assert.deepEqual(plan.payload.inputs,[{name:'image_1',inputType:'URL',url:'https://assets.invalid/reference'}]);
});
test('ordinary failed query status remains available to the terminal result parser',()=>{assert.deepEqual(unpackMcp(wrap({generationId:'original-id',status:'failed'})),{generationId:'original-id',status:'failed'});});
test('business failure keeps only a bounded safe original generation ID',()=>{
 for(const payload of [{ok:false,generationId:'original-id'},{ok:false,body:{generation_id:'original-id'}},{error:{generationId:'original-id'}}])assert.throws(()=>unpackMcp(wrap(payload)),e=>e.remoteId==='original-id');
 for(const id of ['bad\nID','x'.repeat(4097),123])assert.throws(()=>unpackMcp(wrap({ok:false,generationId:id})),e=>!e.remoteId);
});
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function waitFor(check){for(let i=0;i<200;i++){if(check())return;await tick();}assert.fail('local engine did not reach expected state');}
for(const [kind,createEngine,register,modelSpec]of [['image',imageEngine,imageModels,imageSpec],['video',videoEngine,videoModels,videoSpec]]){
 function harness(f,initial=[],overrides={}){register([f.spec]);let persisted=[],queries=[],submits=0;const mcp={prepare:async(...args)=>{if(overrides.prepare)return overrides.prepare(...args);return {}},submit:async(...args)=>{submits++;return overrides.submit?overrides.submit(...args):{generationId:'original-id',status:'processing'};},query:async task=>{queries.push(task.remoteId);return unpackMcp(wrap({generationId:task.remoteId,status:'FAILED',works:[]}));}};const engine=createEngine({readTasks:async()=>structuredClone(initial),writeTasks:async tasks=>{persisted=structuredClone(tasks)},getConfig:async()=>f.config,getKey:async()=>{throw Error('must not request API key')},getImages:async()=>[],readImage:async()=>Buffer.from('fixture'),saveImage:async()=>{throw Error('must not download')},mcp,pollMs:10});return {engine,queries,get persisted(){return persisted},get submits(){return submits}};}
 test(kind+' start preserves the registered catalog and current declaration over historical snapshots',async()=>{
  const f=fixture(kind),old=structuredClone(f.spec);old.displayName='obsolete snapshot';
  const h=harness(f,[{id:randomUUID(),model:f.spec.id,mcpCapability:old,status:'completed',config:f.profile}]);
  try{await h.engine.start();assert.equal(modelSpec(f.spec.id).displayName,f.spec.displayName);}finally{await h.engine.stop();}
  const empty=harness(f);try{await empty.engine.start();assert.equal(modelSpec(f.spec.id).providerModel,f.spec.providerModel);}finally{await empty.engine.stop();}
 });
 test(kind+' failed material preparation never submits and remains safe to retry',async()=>{
  const f=fixture(kind),h=harness(f,[],{prepare:()=>{throw Error('MCP 素材上传业务失败，生成尚未提交')}});
  try{await h.engine.start();await h.engine.submit({...request,requestId:randomUUID(),model:f.spec.id,duration:5,generationMode:'text',extra:{}});await waitFor(()=>h.engine.list()[0]?.status==='failed');assert.equal(h.submits,0);assert.equal(h.queries.length,0);assert.equal(h.persisted[0].generationRequestStarted,false);assert.equal(h.persisted[0].stage,'prepare_failed');}finally{await h.engine.stop();}
 });
 test(kind+' trusted UI origin creates an ephemeral host intent; agent execution stays unchanged',async()=>{
  const f=fixture(kind),origin=createHostMcpUiOrigin(kind==='image'?'image-studio':'video-studio');let prepared;
  const h=harness(f,[],{prepare:(...args)=>{prepared=args;return {};}});
  const input={...request,requestId:randomUUID(),model:f.spec.id,duration:5,generationMode:'text',extra:{}};
  try{
   await h.engine.start();await h.engine.submit(input,undefined,origin);await waitFor(()=>h.submits===1&&prepared);
   assert.equal(prepared[5],undefined);assert.ok(prepared[6]);
   assert.equal(h.persisted.some(row=>Object.keys(row).some(key=>/origin|intent/i.test(key))),false);
   await new Promise(resolve=>setTimeout(resolve,20));
   assert.throws(()=>beginHostMcpPreparation(prepared[6],{request:prepared[0],profile:prepared[1],refs:prepared[2]}),/有效的界面业务意图/);
  }finally{await h.engine.stop();}
  const agent={agent:{session:{id:'agent-session'}},token:{id:'parent'},rootCallId:'root'};let agentArgs;
  const h2=harness(f,[],{prepare:(...args)=>{agentArgs=args;return {};}});
  try{await h2.engine.start();await h2.engine.submit({...input,requestId:randomUUID(),sessionId:'agent-session'},agent,origin);await waitFor(()=>h2.submits===1&&agentArgs);assert.equal(agentArgs[5],agent);assert.equal(agentArgs[6],undefined);}finally{await h2.engine.stop();}
 });
 test(kind+' restart resumes submitting task with an original ID and never submits again',async()=>{
  const f=fixture(kind),task={id:randomUUID(),model:f.spec.id,config:f.profile,mcpCapability:f.spec,status:'submitting',stage:'submitting',generationRequestStarted:true,remoteId:'original-id',createdAt:Date.now(),results:[]};const h=harness(f,[task]);
  try{await h.engine.start();await waitFor(()=>h.queries.length===1);assert.deepEqual(h.queries,['original-id']);assert.equal(h.submits,0);assert.equal(h.persisted[0].remoteId,'original-id');}finally{await h.engine.stop();}
 });
 test(kind+' restart without ID stays uncertain and preparation-only task fails safely',async()=>{
  const f=fixture(kind),base={model:f.spec.id,config:f.profile,mcpCapability:f.spec,status:'submitting',createdAt:Date.now(),results:[]};const h=harness(f,[{...base,id:randomUUID(),generationRequestStarted:true},{...base,id:randomUUID(),generationRequestStarted:false}]);
  try{await h.engine.start();assert.deepEqual(h.engine.list().map(t=>t.status),['uncertain','failed']);assert.equal(h.queries.length,0);assert.equal(h.submits,0);}finally{await h.engine.stop();}
 });
 test(kind+' stop retains a late submit error ID so the next start only queries it',async()=>{
  const f=fixture(kind);let rejectSubmission;const pending=new Promise((resolve,reject)=>{rejectSubmission=reject});
  const h=harness(f,[],{submit:()=>pending});
  await h.engine.start();await h.engine.submit({...request,requestId:randomUUID(),model:f.spec.id,duration:5,generationMode:'text',extra:{}});await waitFor(()=>h.submits===1);
  const stopped=h.engine.stop();let error;try{unpackMcp(wrap({ok:false,generationId:'late-original-id'}))}catch(e){error=e}rejectSubmission(error);await stopped;
  assert.equal(h.persisted[0].remoteId,'late-original-id');assert.equal(h.queries.length,0);
  const restarted=harness(f,h.persisted);try{await restarted.engine.start();await waitFor(()=>restarted.queries.length===1);assert.deepEqual(restarted.queries,['late-original-id']);assert.equal(restarted.submits,0);}finally{await restarted.engine.stop();}
 });
 test(kind+' submit business error persists its original ID for recovery, with one submit only',async()=>{
  const f=fixture(kind),h=harness(f,[],{submit:()=>unpackMcp(wrap({ok:false,generationId:'original-id'}))});
  try{await h.engine.start();const task=await h.engine.submit({...request,requestId:randomUUID(),model:f.spec.id,duration:5,generationMode:'text',aspectRatio:'auto',extra:{}});await waitFor(()=>h.engine.list()[0]?.status==='failed');assert.equal(task.remoteId,'original-id');assert.equal(h.persisted[0].remoteId,'original-id');assert.equal(h.submits,1);await assert.rejects(h.engine.recover(task.id,'different-id'),/更换原任务/);assert.deepEqual(h.queries,['original-id']);await h.engine.recover(task.id);assert.deepEqual(h.queries,['original-id','original-id']);assert.equal(h.submits,1);}finally{await h.engine.stop();}
 });
}

test('image audit resolves sibling sources before external dependencies and falls back for installed packages',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'image-audit-resolution-')));
 try{
  const candidate=join(root,'candidate'),external=join(root,'external','node_modules'),installed=join(external,'dsh-image-studio'),sibling=join(candidate,'image-studio');
  await mkdir(join(candidate,'video-studio'),{recursive:true});await mkdir(installed,{recursive:true});await mkdir(sibling,{recursive:true});
  await symlink(external,join(candidate,'node_modules'),'dir');
  for(const [directory,marker]of [[installed,'installed'],[sibling,'sibling']]){
   await writeFile(join(directory,'package.json'),JSON.stringify({name:'dsh-image-studio',type:'module',main:'index.js'}));
   await writeFile(join(directory,'index.js'),'export {};');
   for(const name of ['generation.js','model-registry.js'])await writeFile(join(directory,name),`export const source=${JSON.stringify(marker)};`);
  }
  const importer=pathToFileURL(join(candidate,'video-studio','audit.test.mjs'));
  const assertSource=async expected=>{
   const entry=await imagePackageEntry(importer);
   assert.equal(entry.href,pathToFileURL(join(expected==='sibling'?sibling:installed,'index.js')).href);
   for(const name of ['generation.js','model-registry.js'])assert.equal((await import(new URL('./'+name,entry))).source,expected);
  };
  await assertSource('sibling');
  await writeFile(join(sibling,'package.json'),JSON.stringify({name:'unrelated-package'}));
  await assertSource('installed');
  await rm(sibling,{recursive:true,force:true});
  await assertSource('installed');
 }finally{await rm(root,{recursive:true,force:true});}
});
