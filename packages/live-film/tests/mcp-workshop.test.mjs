// Synthetic MCP declaration and bridge; real Store files and Queue transitions only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,mutate,validateShot} from '../store.js';
import {Queue} from '../queue.js';
import {registerMcpModels} from 'dsh-video-studio/model-registry.js';
import {specsFromIdentity} from 'dsh-video-studio/mcp-capabilities.js';
async function fixture(){
 const spec=specsFromIdentity({user:{userId:'synthetic-film-account'},availableModels:{omni_ref_video:[{model:'synthetic-film-video',arguments:[{name:'prompt',required:true},{name:'duration',allowedValues:['5','10'],default:'5'},{name:'aspect_ratio',allowedValues:['9:16','16:9'],default:'9:16'},{name:'resolution',allowedValues:['720p','1080p'],default:'1080p'},{name:'camera',allowedValues:['fixed','moving'],default:'fixed'}],inputs:[{name:'image_1',required:true},{name:'image_2',required:true}]}]}})[0];
 registerMcpModels([spec]);
 const dir=await mkdtemp(join(tmpdir(),'mcp-film-audit-')),store=await new Store(dir).open();
 const project=await mutate(store,{op:'createProjectWithShot',projectName:'Synthetic MCP film',name:'Synthetic shot',duration:4,generationDuration:5,model:spec.id});
 const shot=project.shots[0],assets=[{id:'synthetic-ref-a',type:'image/png'},{id:'synthetic-ref-b',type:'image/png'}];
 const extra={camera:'moving',__mcpInputs:{'synthetic-ref-a':'image_2','synthetic-ref-b':'image_1'}};
 await mutate(store,{op:'editShot',projectId:project.id,shotId:shot.id,patch:{prompt:'Synthetic scene',generationMode:'reference',aspectRatio:'9:16',resolution:'1080p',extra,refs:assets.map(a=>({id:a.id,role:'reference'}))}});
 const calls=[],remote=[],bridge={models:async()=>[spec],assets:async()=>assets,tasks:async()=>structuredClone(remote),submit:async request=>{calls.push(structuredClone(request));const task={id:request.requestId,status:'polling',remoteId:'synthetic-original-id',results:[]};remote.push(task);return task;}};
 const queue=new Queue(store,bridge);
 return {dir,store,queue,bridge,project,shot,spec,assets,extra,calls,remote,body:{projectId:project.id,shotIds:[shot.id],confirmCost:true}};
}
test('MCP film queue freezes exact parameters, slot bindings and references on disk before dispatch',async()=>{
 const f=await fixture();try{
  const p=f.store.read().projects[0],expected=validateShot(p,p.shots[0],[f.spec],f.assets);
  const added=await f.queue.enqueue(f.body);
  const disk=await new Store(f.dir).open();assert.deepEqual(disk.read().tasks[0].snapshot,expected);
  await mutate(f.store,{op:'editShot',projectId:p.id,shotId:f.shot.id,patch:{prompt:'Next draft',aspectRatio:'16:9',resolution:'720p',generationDuration:10,extra:{camera:'fixed'}}});
  await f.queue.tick();assert.equal(f.calls.length,1);
  assert.deepEqual(f.calls[0],{...expected,requestId:added.added[0]});
  assert.equal(f.calls[0].duration,5);assert.equal(f.calls[0].aspectRatio,'9:16');assert.equal(f.calls[0].resolution,'1080p');
  assert.deepEqual(f.calls[0].extra,f.extra);assert.deepEqual(f.calls[0].referenceIds,f.assets.map(a=>a.id));
 }finally{f.queue.stop();await rm(f.dir,{recursive:true,force:true})}
});
test('reopening dispatching MCP film task synchronizes original bridge ID and candidate without another submit',async()=>{
 const f=await fixture();let resumed;try{
  await f.queue.enqueue(f.body);await f.queue.tick();assert.equal(f.calls.length,1);
  const id=f.store.read().tasks[0].id;
  // Crash after bridge accepted the request, before local dispatch acknowledgement.
  await f.store.tx(s=>{s.tasks[0].status='dispatching';delete s.tasks[0].remoteId});f.queue.stop();
  const reopened=await new Store(f.dir).open();resumed=new Queue(reopened,f.bridge);await resumed.start();
  assert.equal(reopened.read().tasks[0].status,'polling');assert.equal(reopened.read().tasks[0].remoteId,'synthetic-original-id');assert.equal(f.calls.length,1);
  f.remote[0]={...f.remote[0],status:'completed',results:[{id:'synthetic-video-asset',duration:5}]};await resumed.tick();await resumed.tick();
  const disk=await new Store(f.dir).open(),state=disk.read(),candidate=state.projects[0].shots[0].candidates[0];
  assert.equal(state.tasks[0].status,'completed');assert.equal(state.tasks[0].id,id);assert.equal(state.tasks[0].remoteId,'synthetic-original-id');assert.equal(f.calls.length,1);
  assert.equal(state.projects[0].shots[0].candidates.length,1);assert.equal(candidate.taskId,id);assert.equal(candidate.assetId,'synthetic-video-asset');assert.equal(candidate.duration,5);assert.deepEqual(candidate.snapshot.extra,f.extra);
 }finally{resumed?.stop();f.queue.stop();await rm(f.dir,{recursive:true,force:true})}
});
