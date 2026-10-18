import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createServerAssembly} from '../server-assembly.js';
test('real routes freeze reference pixels, replay original parameters, bind credentials and place 2K at target canvas pixels',async()=>{
 const root=await mkdtemp(join(tmpdir(),'generation-ux-chain-')),tasks=[],requests=[],origin=Symbol('fixture-ui');let binding='a'.repeat(64),assembly;
 const image=await sharp({create:{width:2048,height:1152,channels:4,background:'#478ac8'}}).png().toBuffer();
 const config=async()=>({enabledModels:['fixture'],modelProfiles:{fixture:{adapter:'fixture',baseUrl:'https://provider.example.invalid',modelName:'fixture-image'}}});
 const engine={submit:async(request,_execution,uiOrigin)=>{assert.equal(uiOrigin,origin);requests.push(structuredClone(request));const t={id:randomUUID(),model:'fixture',status:'completed',createdAt:Date.now(),results:[{id:randomUUID(),name:'Synthetic 2K',type:'image/png'}]};tasks.push(t);return t;},list:()=>tasks,readResultBytes:async()=>image};
 try{
  assembly=createServerAssembly({rootDir:root,authorize:async()=>true,uiOrigin:origin,engine,config,getCredentialBinding:async()=>binding,modelRuntime:{resolveSelectedModel:(_c,m)=>m,ratiosFor:()=>['16:9'],sizeForRatio:(_m,_r,res)=>res,validateParameters:()=>{}}});await assembly.ready;
  const call=async(path,body,method=body?'POST':'GET')=>{const r=await assembly.handle(new Request('http://fixture.invalid/api/image-studio/'+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),origin);const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
  const p=await call('projects',{name:'Synthetic project',width:1280,height:720}),canvasId=p.canvas.id;
  const reference=await call('upload',{name:'Synthetic source',data:(await sharp({create:{width:32,height:32,channels:4,background:'#ff9900'}}).png().toBuffer()).toString('base64')});
  const layerId=randomUUID(),command=(type,payload,revision)=>({id:randomUUID(),canvasId,baseRevision:revision,type,payload,createdAt:Date.now()});
  await assembly.projects.submitCommands(canvasId,{expectedRevision:0,commands:[command('addLayer',{layer:{id:layerId,assetId:reference.id,kind:'image',name:'Reference',visible:true,locked:false,opacity:.5,matrix:[2,0,0,2,10,10]}},0)]});
  const targetRect={x:100,y:200,width:320,height:180},params={fixture:{aspectRatio:'16:9',resolution:'2K',quality:'high',n:1,extra:{seed:42,metadata:{fixture:true}}}};
  const first=await call('editor/batches',{canvasId,sourceRevision:1,prompt:'Synthetic frozen reference',models:['fixture'],params,referenceLayerIds:[layerId],referenceInputMode:'separate',targetRect});
  const firstState=await call('editor/batches/'+first.batch.id);assert.equal(firstState.autoPlace,true);assert.ok(!JSON.stringify(firstState).includes(binding));assert.equal(firstState.credentialBindings,undefined);assert.equal(firstState.modelBindings,undefined);
  await assembly.projects.submitCommands(canvasId,{expectedRevision:1,commands:[command('removeLayer',{layerId},1)]});
  const requestId=randomUUID(),again=await call('editor/batches/'+first.batch.id+'/regenerate',{model:'fixture',requestId});await call('editor/batches/'+first.batch.id+'/regenerate',{model:'fixture',requestId});
  assert.equal(requests.length,2);assert.deepEqual(requests[1].referenceIds,requests[0].referenceIds);assert.equal(requests[1].resolution,'2K');assert.equal(requests[1].quality,'high');assert.deepEqual(requests[1].extra,params.fixture.extra);assert.equal(requests[1].prompt,requests[0].prompt);assert.notEqual(requests[1].requestId,requests[0].requestId);assert.deepEqual(again.targetRect,targetRect);
  const placed=await call('editor/batches/'+again.id+'/apply',{candidateId:again.candidates[0].id,expectedRevision:2});const [a,, ,d,x,y]=placed.layer.matrix;assert.equal(x,100);assert.equal(y,200);assert.equal(a*2048,320);assert.equal(d*1152,180);
  binding='b'.repeat(64);const rejected=await assembly.handle(new Request('http://fixture.invalid/api/image-studio/editor/batches/'+first.batch.id+'/regenerate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'fixture',requestId:randomUUID()})}),origin);assert.equal(rejected.status,400);assert.equal(requests.length,2);
 }finally{await assembly?.dispose();await rm(root,{recursive:true,force:true})}
});
