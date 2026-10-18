import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createEngine,validateConfig} from '../../generation.js';
import {defaultProfile} from '../../model-registry.js';
import {createNativeImageStudioEditor} from '../native-host.js';
import {createWorkshopAuthority} from '../../workshop-agent-authority.js';

test('workshop MJ source and native mask traverse real host/adapter/engine with native validation and durable dedupe',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'workshop-mj-followup-')),profile={...defaultProfile('midjourney'),baseUrl:'https://midjourney.fixture.invalid'};
 const config=validateConfig({baseUrl:profile.baseUrl,generatePath:profile.generatePath,editPath:profile.editPath,queryPath:profile.queryPath,enabledModels:['midjourney'],defaultModel:'midjourney',modelProfiles:{midjourney:profile}});
 const sessionId='fixture-session',execution={agent:{session:{id:sessionId}},signal:new AbortController().signal};
 const parent=(id,status,action)=>({id,sessionId,model:'midjourney',prompt:'Synthetic source',extra:{action},config:{...config,...profile},remoteId:'remote-'+id,status,results:[],createdAt:Date.now()});
 let disk=[parent('fixture-grid','completed','imagine'),parent('fixture-mask-source','awaiting_input','inpaint')],assembly;const posts=[],executions=[];
 const masks=[{id:'fixture-native-mask',name:'mask.png',type:'image/png'}];
 const engine=createEngine({readTasks:async()=>disk,writeTasks:async value=>{disk=structuredClone(value)},getConfig:async()=>config,getKey:async()=> 'fixture-key',getImages:async()=>masks,readImage:async()=>Buffer.from('synthetic mask'),saveImage:async()=>{throw Error('no download expected')},fetchResult:async()=>{throw Error('no download expected')},fetchImpl:async(url,options)=>{
  assert.ok(url.startsWith(profile.baseUrl));
  if(options.method==='POST'){if(url.endsWith('/uploads/images'))return Response.json({data:{url:'https://assets.fixture.invalid/mask.png'}});const body=JSON.parse(options.body);posts.push({url,body});return Response.json({data:{id:'derived-'+posts.length,status:'pending'}})}
  return Response.json({data:{id:'derived-pending',status:'pending'}});
 },pollMs:100000});
 try{
  await engine.start();
  assembly=await createNativeImageStudioEditor({studioDir:fileURLToPath(new URL('../../',import.meta.url)),rootDir:dir,engine,submit:async(request,context)=>{executions.push(context);return engine.submit(request,context)},config:async()=>config,references:async()=>masks,saveResult:async()=>{throw Error('no references expected')},costs:{preview:async()=>({estimate:{status:'unknown'}})},authorize:async()=>true});
  let tool;const ctx={inject(_deps,fn){fn({tools:{register(value){tool=value;return()=>{}}},effect:fn=>fn()})}};
  let approvals=0;const authority=createWorkshopAuthority({get:()=>({async ask(request){approvals++;return {answers:request.questions.map(q=>({id:q.id,selected:['确认本次生成']}))}}})});
  assembly.registerAgentTools(ctx,{authorizeAgent:authority});
  const call=(action,input)=>tool.execute({action,input},execution),created=await call('create_project',{name:'Synthetic',width:128,height:128});
  assert.equal(approvals,0,'nonpaid project creation must not ask for paid confirmation');
  for(const [action,sourceTaskId,extra,maskReferenceId]of [['upscale','fixture-grid',{action:'upscale',index:1},undefined],['modal','fixture-mask-source',{action:'modal'},'fixture-native-mask']]){
   const input={requestId:'fixture-'+action,canvasId:created.canvas.id,sourceRevision:created.canvas.revision,prompt:'Synthetic followup',models:['midjourney'],sourceTaskId,...(maskReferenceId?{maskReferenceId}:{}),params:{midjourney:{extra}}};
   const first=await call('generate',input),second=await call('generate',input);assert.equal(first.batch.id,second.batch.id);
   const submitted=engine.list().find(t=>t.id===first.submitted[0].taskId);assert.equal(submitted.sourceTaskId,sourceTaskId);if(maskReferenceId)assert.equal(submitted.maskReferenceId,maskReferenceId);
   await assert.rejects(call('generate',{...input,sourceTaskId:'different'}),e=>e.code==='REQUEST_CONFLICT');
  }
  for(let i=0;i<100&&posts.length<2;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(posts.length,2);assert.ok(posts[0].url.endsWith('/upscale'));assert.equal(posts[0].body.task_id,'remote-fixture-grid');assert.equal(posts[0].body.index,1);
  assert.ok(posts[1].url.endsWith('/modal'));assert.equal(posts[1].body.task_id,'remote-fixture-mask-source');assert.equal(posts[1].body.mask_url,'https://assets.fixture.invalid/mask.png');
  assert.equal(executions.length,2);assert.ok(executions.every(value=>value===execution));
  const before=posts.length;await assert.rejects(call('generate',{requestId:'invalid-native-source',canvasId:created.canvas.id,sourceRevision:0,prompt:'Synthetic',models:['midjourney'],sourceTaskId:'missing',params:{midjourney:{extra:{action:'upscale',index:1}}}}));assert.equal(posts.length,before,'native invalid parent must never submit');
 }finally{await engine.stop();await assembly?.dispose();await rm(dir,{recursive:true,force:true})}
});
