import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorStore} from '../fixed-editor/src/state/editorStore.js';
import {placeGeneratedResults} from '../fixed-editor/src/state/generation-placement.js';
import {createHttpEditorAdapter} from '../fixed-editor/http-adapter.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture({applyGate,readGate,conflict=false}={}){
 const canvas={id:'canvas',projectId:'project',name:'original',revision:1,layerIds:[],width:128,height:128};
 const layer={id:'result-layer',canvasId:'canvas',assetId:'candidate',name:'result',x:0,y:0,width:64,height:64};
 const candidate={id:'candidate',taskId:'task',model:'fixture'};
 const record={batch:{id:'batch',canvasId:'canvas',autoPlace:true},tasks:new Map([['task',{taskId:'task',model:'fixture',status:'completed',candidates:[candidate]}]]),candidates:[candidate]};
 let calls=0,reads=0;const requests=[];
 const adapter={
  async applyCandidate(id,asset,options){calls++;requests.push(options);await applyGate?.promise;if(conflict)throw Object.assign(Error('revision conflict'),{status:409});return {canvas:{...canvas,revision:2,layerIds:[layer.id]},layer};},
  async getCanvas(){reads++;await readGate?.promise;return{canvas:{...canvas,revision:2,layerIds:[layer.id]},layers:[layer],assets:[candidate]};},
  async listBatches(){return{batches:[]};},
  async putCanvas(){throw Error('conflicted draft must not autosave');},
 };
 const store=new EditorStore(adapter);store.activeCanvasId=canvas.id;store.doc.canvases[canvas.id]=structuredClone(canvas);store.lastServerRevision=1;store.batches.set('batch',record);
 return{store,record,requests,get calls(){return calls},get reads(){return reads}};
}
function edit(store){store.doc.canvases.canvas.name='local edit during request';store.pendingCommands.push({id:'keep-command',type:'renameCanvas',payload:{name:'local edit during request'}});return{doc:structuredClone(store.doc),pending:structuredClone(store.pendingCommands)};}
function assertPreserved(f,local){assert.deepEqual(f.store.doc,local.doc);assert.deepEqual(f.store.pendingCommands,local.pending);assert.equal(f.store.externalConflict,true);assert.equal(f.store.saveState,'conflict');assert.deepEqual(f.store.conflictDraft.document,local.doc);assert.deepEqual(f.store.conflictDraft.commands,local.pending);}

test('delayed apply preserves exact local document and pending commands, backs up conflict and never retries',async()=>{
 const applyGate=deferred(),f=fixture({applyGate});try{
  const run=placeGeneratedResults(f.store,f.record);await tick();assert.equal(f.calls,1);assert.equal(f.requests[0].expectedRevision,1);
  const local=edit(f.store);applyGate.resolve();await run;assertPreserved(f,local);assert.equal(f.reads,0);assert.equal(await f.store.save(),false);
  await placeGeneratedResults(f.store,f.record);assert.equal(f.calls,1);assert.equal(f.record.candidates[0].applied,true);
 }finally{f.store.dispose();}
});
test('edit while getCanvas is delayed cannot cross the document replacement boundary',async()=>{
 const readGate=deferred(),f=fixture({readGate});try{
  const run=placeGeneratedResults(f.store,f.record);await tick();assert.equal(f.reads,1);
  const local=edit(f.store);readGate.resolve();await run;assertPreserved(f,local);assert.equal(f.calls,1);
 }finally{f.store.dispose();}
});
test('clean auto placement still loads result, records undo and does not resurrect an undone result',async()=>{
 const f=fixture();try{
  await placeGeneratedResults(f.store,f.record);assert.deepEqual(f.store.doc.canvases.canvas.layerIds,['result-layer']);assert.equal(f.store.lastServerRevision,2);assert.equal(f.store.histories.get('canvas').canUndo,true);
  f.store.undo();assert.deepEqual(f.store.doc.canvases.canvas.layerIds,[]);
  f.record.candidates[0].applied=false;await placeGeneratedResults(f.store,f.record);assert.equal(f.calls,1);assert.deepEqual(f.store.doc.canvases.canvas.layerIds,[]);
 }finally{f.store.dispose();}
});
test('revision rejection preserves edits and stops automatic retries and autosave',async()=>{
 const applyGate=deferred(),f=fixture({applyGate,conflict:true});try{
  const run=placeGeneratedResults(f.store,f.record);await tick();const local=edit(f.store);applyGate.resolve();await run;assertPreserved(f,local);
  await placeGeneratedResults(f.store,f.record);assert.equal(f.calls,1);assert.equal(f.reads,0);assert.equal(await f.store.save(),false);
 }finally{f.store.dispose();}
});
test('HTTP adapter transmits expectedRevision while preserving legacy optionless request schema',async()=>{
 const bodies=[];const adapter=createHttpEditorAdapter({fetchImpl:async(url,options)=>{bodies.push(JSON.parse(options.body));return{ok:true,json:async()=>({})};}});
 await adapter.applyCandidate('batch','candidate',{expectedRevision:0,layout:{x:3}});await adapter.applyCandidate('batch','candidate');
 assert.deepEqual(bodies,[{candidateId:'candidate',layout:{x:3},expectedRevision:0},{candidateId:'candidate'}]);
});
