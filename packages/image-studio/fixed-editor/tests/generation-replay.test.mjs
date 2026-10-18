import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServerAssembly} from '../server-assembly.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createGenerationAdapter} from '../core/generation-adapter/adapter.js';
import {createGenerationReplay,modelBindings} from '../generation-replay.js';
const fingerprint=key=>createHash('sha256').update(key).digest('hex');
function fixture(){
 let credential='synthetic-key-A';
 let batches=[];const disk=new Map(),sent=[],tasks=[],referenceContext=new AsyncLocalStorage();
 const asset={id:'frozen-asset',hash:'frozen-hash',width:128,height:128};
 const runtime={resolveSelectedModel:(_c,m)=>m,ratiosFor:()=>['16:9'],sizeForRatio:(_m,_r,res)=>res,validateParameters:()=>{}};
 const generation=createGenerationAdapter({engine:{submit:async r=>{sent.push(structuredClone(r));const t={id:'task-'+sent.length,model:r.model,status:'completed',results:[]};tasks.push(t);return t},list:()=>tasks},config:async()=>({enabledModels:['A','B']}),assets:{},modelRuntime:runtime,batchStore:{load:async()=>structuredClone(batches),save:async x=>batches=structuredClone(x)},canvasExists:async()=>true,layerAsset:async id=>referenceContext.getStore()?.get(id)});
 const storage={read:async(k,d)=>structuredClone(disk.has(k)?disk.get(k):d),write:async(k,v)=>disk.set(k,structuredClone(v))};
 const materialize=async b=>({...b,...await storage.read('batch-meta/'+b.id+'.json',{}),tasks:b.models.map(model=>({model,status:b.modelStatus[model].taskId?'completed':b.modelStatus[model].status}))});
 const replay=createGenerationReplay({generation,storage,referenceContext,assets:{get:async id=>id===asset.id?asset:null},projects:{getCanvas:async()=>({canvas:{id:'canvas',width:1280,height:720,revision:7},layers:[]})},materialize,getConfig:async()=>({}),getCredentialBinding:async()=>fingerprint(credential),fail:(code,message,status)=>Object.assign(Error(message),{code,status})});
 return {generation,replay,referenceContext,asset,sent,tasks,storage,setCredential:value=>{credential=value},get batches(){return batches}};
}
test('explicit replay uses frozen references and full per-model settings after original layers changed; duplicate request submits once',async()=>{
 const f=fixture(),request={model:'A',prompt:'@image1 synthetic',aspectRatio:'16:9',resolution:'4K',quality:'high',n:1,extra:{seed:123,metadata:{mode:'fixture'}}};
 const source=await f.referenceContext.run(new Map([['removed-original-layer',f.asset]]),()=>f.generation.createBatch({canvasId:'canvas',sourceRevision:1,targetRect:{x:100,y:200,width:320,height:180},referenceLayerIds:['removed-original-layer'],request}));
 await f.storage.write('batch-meta/'+source.id+'.json',{modelBindings:modelBindings({},['A','B']),credentialBindings:{A:fingerprint('synthetic-key-A'),B:fingerprint('synthetic-key-A')}});
 await f.generation.submitBatch(source.id,{models:['A','B'],requestsByModel:{A:request,B:{...request,model:'B',resolution:'2K',quality:'standard',extra:{seed:456}}}});
 const original=structuredClone(f.batches[0]);const body={model:'B',requestId:'fixture-replay-request-0001'};
 const results=await Promise.all([f.replay(source.id,body),f.replay(source.id,body)]);await f.replay(source.id,body);
 assert.equal(results[0].id,results[1].id);assert.equal(f.sent.length,3);const retried=f.sent[2];assert.equal(retried.resolution,'2K');assert.equal(retried.quality,'standard');assert.deepEqual(retried.extra,{seed:456});assert.equal(retried.prompt,request.prompt);assert.deepEqual(retried.referenceIds,['frozen-asset']);assert.notEqual(retried.requestId,f.sent[1].requestId);assert.deepEqual(f.batches[1].targetRect,original.targetRect);assert.deepEqual(f.batches[0],original);
});
test('uncertain original task cannot be replayed under a new request',async()=>{
 const f=fixture(),b=await f.generation.createBatch({canvasId:'canvas',sourceRevision:1,targetRect:{x:0,y:0,width:100,height:100},request:{model:'A',prompt:'x',aspectRatio:'16:9'}});await f.generation.submitBatch(b.id,{models:['A']});
 // materialized native status remains the authority.
 f.tasks[0].status='uncertain';const state=await f.generation.getBatch(b.id);const replay=createGenerationReplay({generation:f.generation,storage:f.storage,materialize:async()=>({tasks:[{model:'A',status:'uncertain'}]}),fail:(c,m)=>Object.assign(Error(m),{code:c})});
 await assert.rejects(replay(b.id,{model:'A',requestId:'uncertain-replay-attempt-01'}),/结果未知/);assert.equal(f.sent.length,1);assert.equal(state.models[0],'A');
});
test('failed multi-model submissions retain the exact request for each model',async()=>{
 let rows=[];const {createGenerationAdapter:factory}=await import('../core/generation-adapter/adapter.js');
 const g=factory({engine:{submit:async()=>{throw Error('fixture uncertain')}},config:async()=>({}),modelRuntime:{resolveSelectedModel:(_c,m)=>m,ratiosFor:()=>['16:9'],sizeForRatio:()=> 'auto',validateParameters:()=>{}},batchStore:{load:async()=>rows,save:async r=>rows=r}});
 const b=await g.createBatch({canvasId:'canvas',sourceRevision:0,targetRect:{x:0,y:0,width:100,height:100},request:{model:'A',prompt:'x',aspectRatio:'16:9'}});
 await assert.rejects(g.submitBatch(b.id,{models:['A','B'],requestsByModel:{A:{resolution:'1K',extra:{seed:1}},B:{resolution:'4K',extra:{seed:2}}}}));
 assert.equal(rows[0].requestsByModel.B.resolution,'4K');assert.equal(rows[0].modelStatus.B.effectiveParams.resolution,'4K');assert.equal(rows[0].modelStatus.B.effectiveParams.extra.seed,2);
});

test('API replay rejects rotated keys and legacy absent fingerprints before any new submit',async()=>{
 const f=fixture(),request={model:'A',prompt:'Synthetic',aspectRatio:'16:9'};
 const source=await f.generation.createBatch({canvasId:'canvas',sourceRevision:1,targetRect:{x:0,y:0,width:100,height:100},request});
 await f.generation.submitBatch(source.id,{models:['A'],requestsByModel:{A:request}});
 const meta={modelBindings:modelBindings({},['A'])};
 await f.storage.write('batch-meta/'+source.id+'.json',meta);
 await assert.rejects(f.replay(source.id,{model:'A',requestId:'missing-credential-fixture'}),/缺少原 API 凭据绑定/);
 await f.storage.write('batch-meta/'+source.id+'.json',{...meta,credentialBindings:{A:fingerprint('synthetic-key-A')}});
 f.setCredential('synthetic-key-B');
 await assert.rejects(f.replay(source.id,{model:'A',requestId:'rotated-credential-fixture'}),/凭据已变化/);
 assert.equal(f.sent.length,1);assert.equal(f.batches.length,1);
 f.setCredential('synthetic-key-A');const replay=await f.replay(source.id,{model:'A',requestId:'original-credential-fixture'});
 assert.equal(f.sent.length,2);assert.deepEqual((await f.storage.read('batch-meta/'+replay.id+'.json')).credentialBindings,{A:fingerprint('synthetic-key-A')});
});
test('initial API binding persists privately and batch materialization never returns binding hashes',async()=>{
 const rootDir=await mkdtemp(join(tmpdir(),'image-private-binding-')),tasks=[],credential=fingerprint('synthetic-private-key');
 const engine={list:()=>tasks,submit:async request=>{const task={id:'synthetic-task',model:request.model,status:'completed',results:[]};tasks.push(task);return task}};
 const modelRuntime={resolveSelectedModel:(_config,model)=>model,ratiosFor:()=>['auto'],sizeForRatio:()=> '128x128',validateParameters(){}};
 const assembly=createServerAssembly({rootDir,engine,modelRuntime,authorize:async()=>true,config:async()=>({enabledModels:['A']}),getCredentialBinding:async()=>credential});
 const call=async(path,body)=>{const response=await assembly.handle(new Request('http://local/api/image-studio/'+path,{method:body?'POST':'GET',...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})}));assert.equal(response.status,200);return response.json()};
 try{
  await assembly.ready;const created=await call('projects',{name:'Synthetic private binding',width:128,height:128});
  const result=await call('editor/batches',{canvasId:created.canvas.id,prompt:'Synthetic',models:['A']});
  const meta=JSON.parse(await readFile(join(rootDir,'batch-meta',result.batch.id+'.json'),'utf8'));
  assert.equal(meta.credentialBindings.A,credential);assert.equal(typeof meta.modelBindings.A,'string');
  for(const output of [result,await call('editor/batches/'+result.batch.id),await call('editor/batches')]){
   const json=JSON.stringify(output);for(const secret of ['synthetic-private-key',credential,meta.modelBindings.A,'credentialBindings','modelBindings'])assert.ok(!json.includes(secret),secret+' must stay private');
  }
 }finally{await assembly.dispose();await rm(rootDir,{recursive:true,force:true})}
});
