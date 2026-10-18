import test from 'node:test';
import assert from 'node:assert/strict';
import {generationFrames,placeGeneratedResults,regenerateCanvasTask} from '../fixed-editor/src/state/generation-placement.js';
const rect={x:120,y:60,width:320,height:180};
const record=(status='polling')=>({batch:{id:'batch',canvasId:'canvas',createdAt:1,targetRect:rect,autoPlace:true},tasks:new Map([['task',{taskId:'task',model:'fixture',status}]]),candidates:[]});
test('pending and failed frames use frozen canvas pixels, never output resolution',()=>{
 for(const resolution of ['1K','2K','4K','720p','1080p']){const r=record();r.batch.effectiveParams={resolution};const rows=[{...r,tasks:[...r.tasks.values()]}];assert.deepEqual(generationFrames(rows)[0].rect,rect);r.tasks.get('task').status='failed';assert.equal(generationFrames([{...r,tasks:[...r.tasks.values()]}])[0].status,'failed');}
});
test('auto placement is limited to opted-in new batches and is idempotent per result',async()=>{
 const r=record('completed');r.tasks.get('task').candidates=[{id:'asset',model:'fixture'}];let calls=0;const store={activeCanvasId:'canvas',emit(){},applyCandidate:async(id,asset)=>{calls++;assert.equal(id,'batch');assert.equal(asset,'asset');return {layer:{id:'layer'}}}};
 await placeGeneratedResults(store,r);await placeGeneratedResults(store,r);assert.equal(calls,1);assert.equal(r.tasks.get('task').candidates[0].appliedLayerId,'layer');
 const old=record('completed');delete old.batch.autoPlace;old.tasks.get('task').candidates=[{id:'old'}];await placeGeneratedResults(store,old);assert.equal(calls,1);
});
test('regenerate deduplicates double-click and only sends source identifiers, never current composer fields',async()=>{
 const r=record('failed');let release,calls=0;const pending=new Promise(resolve=>release=resolve);const store={activeCanvasId:'canvas',batches:new Map([['batch',r]]),save:async()=>true,emit(){},pollBatch(){},setNotice(){},adapter:{regenerate:async(id,b)=>{calls++;assert.equal(id,'batch');assert.deepEqual(Object.keys(b).sort(),['model','requestId']);await pending;return {id:'new',canvasId:'canvas',targetRect:rect,tasks:[{taskId:'new-task',model:'fixture',status:'polling'}]}}}};
 const a=regenerateCanvasTask(store,'batch','fixture'),b=regenerateCanvasTask(store,'batch','fixture');await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.ok([...store.batches.values()].some(r=>r.batch.local));release();await Promise.all([a,b]);assert.equal(store.activeBatchId,'new');assert.equal(store.batches.get('batch').batch.replayedModels.fixture,'new');
});
