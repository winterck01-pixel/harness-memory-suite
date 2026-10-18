import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTaskHistory} from './task-history.js';
import {createEngine} from './generation.js';
import {defaultProfile} from './model-registry.js';
import {randomUUID} from 'node:crypto';

const fixtureRows=count=>Array.from({length:count},(_,i)=>({id:randomUUID(),createdAt:Date.now()+i,status:'completed',sessionId:i%2?'a':'b',model:'seedance-2-5',config:{...defaultProfile('seedance-2-5'),baseUrl:'https://toapis.com',modelName:'seedance-2-5'},results:[]}));
const withDirectory=async run=>{const directory=await mkdtemp(join(tmpdir(),'video-history-fixture-'));try{await run(directory);}finally{await rm(directory,{recursive:true,force:true});}};

test('resident history is bounded, active rows retained and full canonical history survives reopen',()=>withDirectory(async directory=>{
 const rows=fixtureRows(550);rows[0].status='polling';const history=createTaskHistory({directory,maxResident:20});
 await history.initialize(rows);assert.equal(history.recent().length,21);
 assert.equal(history.page({limit:999}).tasks.length,200);assert.equal(history.page({sessionId:'a'}).total,275);
 assert.equal(history.find(rows[1].id).id,rows[1].id);
 await history.save([{...rows[1],error:'updated archived record'}]);history.close();
 const canonical=JSON.parse(await readFile(join(directory,'tasks.json'),'utf8'));assert.equal(canonical.length,550);assert.equal(canonical.find(t=>t.id===rows[1].id).error,'updated archived record');
 const reopened=createTaskHistory({directory,maxResident:20});await reopened.initialize(canonical);assert.equal(reopened.find(rows[1].id).error,'updated archived record');assert.equal(reopened.page({offset:540}).tasks.length,10);assert.equal(reopened.page({offset:540}).nextOffset,null);reopened.close();
}));

test('failed mirror rename rolls derived updates back and preserves canonical history',()=>withDirectory(async directory=>{
 const rows=fixtureRows(3),mirrorPath=join(directory,'tasks.json');await writeFile(mirrorPath,JSON.stringify(rows));const history=createTaskHistory({directory,mirrorPath});await history.initialize(rows);
 // An existing directory cannot be replaced by the atomic file rename.
 const blockedPath=join(directory,'blocked');await mkdir(blockedPath);const blocked=createTaskHistory({directory:join(directory,'other'),mirrorPath:blockedPath});await blocked.initialize(rows);
 await assert.rejects(blocked.save([{...rows[0],error:'must roll back'}]));assert.equal(blocked.find(rows[0].id).error,undefined);assert.deepEqual(JSON.parse(await readFile(mirrorPath,'utf8')),rows);blocked.close();history.close();
}));

test('engine hydrates archived billing, download retry and request dedup without retaining cold records',()=>withDirectory(async directory=>{
 const rows=fixtureRows(260);rows[3].status='failed';rows[3].remoteId='recover-remote';rows[1].remoteId='billing-remote';rows[2].stage='download_failed';rows[2].pendingResult={status:'completed',images:[{base64:Buffer.from('saved-video').toString('base64'),type:'video/mp4'}]};
 await writeFile(join(directory,'tasks.json'),JSON.stringify(rows));
 const config={baseUrl:'https://toapis.com',generatePath:'/v1/videos/generations',editPath:'/v1/videos/generations',queryPath:'/v1/videos/generations/{id}',enabledModels:['seedance-2-5'],defaultModel:'seedance-2-5',modelProfiles:{'seedance-2-5':{...defaultProfile('seedance-2-5'),baseUrl:'https://toapis.com',modelName:'seedance-2-5'}}};
 let posts=0,saves=0;
 const engine=createEngine({taskHistory:createTaskHistory({directory,maxResident:10}),readTasks:async()=>JSON.parse(await readFile(join(directory,'tasks.json'),'utf8')),writeTasks:async()=>{throw Error('legacy callback should be unused');},getConfig:async()=>config,getKey:async()=> 'fixture-key',getImages:async()=>[],readImage:async()=>{throw Error('unexpected reference read');},saveImage:async bytes=>{saves++;assert.equal(bytes.toString(),'saved-video');return {id:'saved',type:'video/mp4'};},fetchImpl:async(url,options={})=>{if(options.method==='POST')posts++;if(url.endsWith('/recover-remote'))return Response.json({id:'recover-remote',status:'failed',error:{message:'fixture remote failure'}});return Response.json({id:'billing-remote',status:'completed',data:[]});},pollMs:100000});
 await engine.start();try{
  assert.equal(engine.list().length,11);assert.equal((await engine.history()).total,260);assert.equal((await engine.find(rows[0].id)).config,undefined);
  await engine.refreshBilling(rows[1].id);assert.equal(engine.list().length,11);
  await engine.recover(rows[3].id);assert.equal((await engine.find(rows[3].id)).remoteId,'recover-remote');assert.equal((await engine.find(rows[3].id)).status,'failed');assert.equal(posts,0);
  await engine.retryDownload(rows[2].id);assert.equal(saves,1);assert.equal((await engine.find(rows[2].id)).results[0].id,'saved');assert.equal(engine.list().length,10);
  const existing=await engine.submit({requestId:rows[0].id,model:'seedance-2-5',prompt:'fixture',duration:5});assert.equal(existing.id,rows[0].id);assert.equal(posts,0);assert.equal(engine.list().length,10);
 }finally{await engine.stop();}
 const canonical=JSON.parse(await readFile(join(directory,'tasks.json'),'utf8'));assert.equal(canonical.length,260);assert.ok(canonical[1].billingCheckedAt);assert.equal(canonical[2].results[0].id,'saved');
}));


test('all unresolved statuses and pending downloads stay resident; corrupt cache rebuilds from canonical rows',()=>withDirectory(async directory=>{
 const rows=fixtureRows(20),states=['queued','waiting','dispatching','uncertain','timed_out'];
 states.forEach((status,i)=>rows[i].status=status);rows[5].pendingResult={images:[{url:'https://fixture.invalid/result'}]};
 await mkdir(join(directory,'.task-history'));await writeFile(join(directory,'.task-history','index.sqlite'),'corrupt derived cache');
 const history=createTaskHistory({directory,maxResident:2});await history.initialize(rows);
 assert.equal(history.recent().length,8);assert.deepEqual(new Set(history.recent().slice(2).map(row=>row.id)),new Set(rows.slice(0,6).map(row=>row.id)));
 await history.save([]);history.close();assert.equal(JSON.parse(await readFile(join(directory,'tasks.json'),'utf8')).length,20);
}));


test('an archived seven-day draft remains usable for a final generation',()=>withDirectory(async directory=>{
 const rows=fixtureRows(8),draft=rows[0];draft.draft=true;draft.remoteId='archived-draft';
 const config={baseUrl:'https://toapis.com',generatePath:'/v1/videos/generations',editPath:'/v1/videos/generations',queryPath:'/v1/videos/generations/{id}',enabledModels:['seedance-2-5'],defaultModel:'seedance-2-5',modelProfiles:{'seedance-2-5':{...defaultProfile('seedance-2-5'),baseUrl:'https://toapis.com',modelName:'seedance-2-5'}}};
 let submitted;
 const engine=createEngine({taskHistory:createTaskHistory({directory,maxResident:2}),readTasks:async()=>rows,getConfig:async()=>config,getKey:async()=> 'fixture',getImages:async()=>[],fetchImpl:async(url,options)=>{submitted=JSON.parse(options.body);return Response.json({id:'final-draft-result',status:'failed'});},pollMs:100000});
 await engine.start();try{
  assert.equal(engine.list().some(row=>row.id===draft.id),false);
  const task=await engine.submit({requestId:randomUUID(),model:'seedance-2-5',draftTaskId:draft.remoteId,resolution:'1080p',duration:5});
  for(let i=0;i<100&&task.status==='submitting';i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(task.status,'failed');assert.equal(submitted.draft_task_id,draft.remoteId);assert.equal((await engine.history()).total,9);
 }finally{await engine.stop();}
}));

test('many archived duplicate submits and rejected retry validations release hydrated records without a save',()=>withDirectory(async directory=>{
 const rows=fixtureRows(40),config={enabledModels:['seedance-2-5'],defaultModel:'seedance-2-5'};
 let providerCalls=0;
 const engine=createEngine({taskHistory:createTaskHistory({directory,maxResident:2}),readTasks:async()=>rows,getConfig:async()=>config,fetchImpl:async()=>{providerCalls++;throw Error('unexpected provider call');},pollMs:100000});
 await engine.start();try{
  for(const row of rows.slice(0,30)){
   const task=await engine.submit({requestId:row.id,model:'seedance-2-5',prompt:'existing request',duration:5});
   assert.equal(task.id,row.id);assert.equal(engine.list().length,2);
   await assert.rejects(engine.submit({requestId:randomUUID(),retryTaskId:row.id,model:'seedance-2-5',prompt:'',duration:5}),/提示词/);
   assert.equal(engine.list().length,2);
  }
  assert.equal(providerCalls,0);assert.equal((await engine.history()).total,40);
 }finally{await engine.stop();}
 assert.equal(JSON.parse(await readFile(join(directory,'tasks.json'),'utf8')).length,40);
}));
