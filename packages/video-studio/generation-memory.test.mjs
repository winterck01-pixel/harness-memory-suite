import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from './generation.js';

const until=async predicate=>{for(let i=0;i<200&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(predicate(),'task settled');};
const config={adapter:'toApisUnifiedVideo',baseUrl:'https://fixture.invalid',modelName:'fixture',queryPath:'/tasks/{id}'};

function fixture(rows,options={}){
 return createEngine({readTasks:async()=>structuredClone(rows),writeTasks:async tasks=>{rows.splice(0,rows.length,...structuredClone(tasks));},getConfig:async()=>config,getKey:async()=> 'fixture',getImages:async()=>[],readImage:async()=>{throw Error('unexpected reference read');},fetchImpl:async()=>{throw Error('unexpected provider call');},pollMs:5,maxDownloadAttempts:1,...options});
}

test('saved inline result payload is released while unsaved result survives failure and restart',async()=>{
 const first=Buffer.alloc(100_000,1).toString('base64'),second=Buffer.alloc(100_000,2).toString('base64');
 const rows=[{id:'memory-fixture',createdAt:Date.now(),status:'polling',stage:'downloading',model:'fixture',config,n:2,results:[],pendingResult:{status:'completed',images:[{base64:first,type:'video/mp4'},{base64:second,type:'video/mp4'}]}}];
 let saves=0;
 const engine=fixture(rows,{saveImage:async bytes=>{saves++;if(saves===2)throw Error('fixture storage failure');assert.equal(bytes[0],1);return {id:'first',type:'video/mp4'};}});
 await engine.start();
 try{
  await until(()=>rows[0].stage==='download_failed');
  assert.deepEqual(rows[0].pendingResult.images[0],{type:'video/mp4'});
  assert.equal(rows[0].pendingResult.images[1].base64,second);
  assert.equal(rows[0].results[0].id,'first');
 }finally{await engine.stop();}
 let restoredSaves=0;
 const restored=fixture(rows,{saveImage:async bytes=>{restoredSaves++;assert.equal(bytes[0],2);return {id:'second',type:'video/mp4'};}});
 await restored.start();
 try{
  await restored.retryDownload('memory-fixture');
  assert.equal(restoredSaves,1);
  assert.deepEqual(rows[0].results.map(row=>row.id),['first','second']);
  assert.equal(rows[0].status,'completed');
  assert.equal(rows[0].pendingResult,undefined);
 }finally{await restored.stop();}
});

test('failed asset persistence retains its inline payload for retry',async()=>{
 const payload=Buffer.from('fixture').toString('base64');
 const rows=[{id:'failed-fixture',createdAt:Date.now(),status:'polling',stage:'downloading',model:'fixture',config,results:[],pendingResult:{status:'completed',images:[{base64:payload,type:'video/mp4'}]}}];
 const engine=fixture(rows,{saveImage:async()=>{throw Error('fixture storage failure');}});
 await engine.start();
 try{
  await until(()=>rows[0].stage==='download_failed');
  assert.equal(rows[0].pendingResult.images[0].base64,payload);
  assert.deepEqual(rows[0].results,[]);
 }finally{await engine.stop();}
});
