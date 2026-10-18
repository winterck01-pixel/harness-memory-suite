import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorStore} from '../fixed-editor/src/state/editorStore.js';
import {generationFrames} from '../fixed-editor/src/state/generation-placement.js';
const target={x:110,y:70,width:320,height:180};
function fixture(status='polling',applied=false){
 let state=status,placed=applied,applies=0;
 const canvas=id=>({id,projectId:'project-'+id,revision:placed&&id==='A'?2:1,layerIds:placed&&id==='A'?['result']:[],width:1280,height:720});
 const layer={id:'result',canvasId:'A',assetId:'asset',matrix:[.15625,0,0,.17578125,110,70]};
 const batch=()=>({id:'batch',canvasId:'A',createdAt:1,targetRect:target,autoPlace:true,prompt:'frozen original',params:{model:{resolution:'2K',extra:{seed:42}}},models:['model']});
 const materialize=()=>{const asset={id:'asset',model:'model',taskId:'task',width:2048,height:1024,applied:placed,...placed?{appliedLayerId:'result'}:{}};return {...batch(),tasks:[{taskId:'task',model:'model',status:state,candidates:state==='completed'?[asset]:[]}],candidates:state==='completed'?[asset]:[]}};
 const adapter={async getCanvas(id){return{canvas:canvas(id),layers:placed&&id==='A'?[layer]:[],assets:[]}},async listBatches(id){return{batches:id==='A'?[materialize()]:[]}},async getBatch(){return materialize()},async getTask(){return materialize().tasks[0]},async applyCandidate(){applies++;placed=true;return{canvas:canvas('A'),layer}},async regenerate(){throw Error('must never submit in audit')}};
 const store=new EditorStore(adapter),scheduled=[];store.pollBatch=id=>scheduled.push(id);
 return {store,adapter,setState:s=>state=s,get applies(){return applies},get materialize(){return materialize()}};
}
function frame(store){return generationFrames(store.getSnapshot().generationBatches)}
async function runPoll(store,id){const callbacks=[];const nativeSet=globalThis.setTimeout;globalThis.setTimeout=(fn)=>{callbacks.push(fn);return {unref(){}}};try{EditorStore.prototype.pollBatch.call(store,id);await callbacks.shift()();}finally{globalThis.setTimeout=nativeSet;for(const r of store.batches.values())r.pollTimer=null}}

test('fresh store restores running placeholder and frozen target plus replay source data',async()=>{const f=fixture();try{await f.store.switchCanvas('A');assert.deepEqual(frame(f.store)[0].rect,target);assert.equal(frame(f.store)[0].status,'polling');assert.equal(f.store.batches.get('batch').batch.params.model.resolution,'2K');assert.equal(f.store.batches.get('batch').batch.prompt,'frozen original')}finally{f.store.dispose()}});
test('completion while viewing another project never writes that project; returning places original target',async()=>{const f=fixture();try{await f.store.switchCanvas('A');await f.store.switchCanvas('B');f.setState('completed');await runPoll(f.store,'batch');assert.equal(f.applies,0);assert.deepEqual(f.store.doc.canvases.B.layerIds,[]);await f.store.switchCanvas('A');await runPoll(f.store,'batch');assert.equal(f.applies,1);assert.deepEqual(f.store.doc.canvases.A.layerIds,['result']);assert.deepEqual(f.store.doc.layers.result.matrix,[.15625,0,0,.17578125,110,70]);}finally{f.store.dispose()}});
test('fresh reload completed-before-applied automatically lands at original rectangle',async()=>{const f=fixture('completed');try{await f.store.switchCanvas('A');await runPoll(f.store,'batch');assert.equal(f.applies,1);assert.deepEqual(f.store.doc.canvases.A.layerIds,['result']);assert.deepEqual(frame(f.store),[])}finally{f.store.dispose()}});
test('fresh reload applied result restores provenance without duplicate placement',async()=>{const f=fixture('completed',true);try{await f.store.switchCanvas('A');await runPoll(f.store,'batch');assert.equal(f.applies,0);assert.equal(f.store.batches.get('batch').tasks.get('task').candidates[0].appliedLayerId,'result');assert.deepEqual(frame(f.store),[])}finally{f.store.dispose()}});
test('restored unknown result has visible frozen region but fails closed on retry',async()=>{const f=fixture('uncertain');try{await f.store.switchCanvas('A');await runPoll(f.store,'batch');assert.equal(frame(f.store)[0].status,'uncertain');assert.deepEqual(frame(f.store)[0].rect,target);assert.equal(await f.store.regenerateTask('batch','model'),false);assert.match(f.store.notice,/未知/)}finally{f.store.dispose()}});
test('late first A read cannot erase newer A result after A to B to A',async()=>{
 let release,readsA=0;const held=new Promise(r=>release=r);const f=fixture('completed',true);
 const native=f.adapter.getCanvas;f.adapter.getCanvas=async id=>{if(id==='A'&&++readsA===1){await held;return{canvas:{id:'A',projectId:'project-A',revision:1,layerIds:[],width:1280,height:720},layers:[],assets:[]}}return native(id)};
 try{const first=f.store.switchCanvas('A');await new Promise(r=>setImmediate(r));await f.store.switchCanvas('B');await f.store.switchCanvas('A');assert.deepEqual(f.store.doc.canvases.A.layerIds,['result']);release();await first;assert.deepEqual(f.store.doc.canvases.A.layerIds,['result'],'obsolete first response must not replace new result');assert.equal(f.store.lastServerRevision,2)}finally{f.store.dispose()}
});

test('obsolete batch response cannot replace newer restored provenance or parameter snapshot',async()=>{
 let release,readsA=0;const held=new Promise(r=>release=r);const f=fixture('completed',true);
 const native=f.adapter.listBatches;f.adapter.listBatches=async id=>{if(id==='A'&&++readsA===1){await held;return{batches:[{...f.materialize,prompt:'obsolete prompt',params:{model:{resolution:'1K'}},candidates:[],tasks:[]}]}}return native(id)};
 try{const first=f.store.switchCanvas('A');await new Promise(r=>setImmediate(r));await f.store.switchCanvas('B');await f.store.switchCanvas('A');release();await first;const batch=f.store.batches.get('batch');assert.equal(batch.batch.prompt,'frozen original');assert.equal(batch.batch.params.model.resolution,'2K');assert.equal(batch.tasks.get('task').candidates[0].appliedLayerId,'result');assert.equal(f.store.lastServerRevision,2)}finally{f.store.dispose()}
});
test('a late getCanvas cannot overwrite an edit made after opening a canvas',async()=>{
 let release;const held=new Promise(r=>release=r);const f=fixture('completed',true);const native=f.adapter.getCanvas;f.adapter.getCanvas=async id=>{await held;return native(id)};
 try{const load=f.store.switchCanvas('A');await new Promise(r=>setImmediate(r));f.store.doc={...f.store.doc,canvases:{A:{id:'A',revision:7,layerIds:['local']}}};f.store.pendingCommands.push({id:'local-command'});release();await load;assert.deepEqual(f.store.doc.canvases.A.layerIds,['local']);assert.equal(f.store.pendingCommands.length,1);assert.equal(f.store.batches.size,0)}finally{f.store.dispose()}
});
for(const boundary of ['close','dispose'])test(`pending batch restoration is invalidated by ${boundary}`,async()=>{
 let release;const held=new Promise(r=>release=r);const f=fixture();f.adapter.listBatches=async()=>{await held;return{batches:[f.materialize]}};f.adapter.listProjects=async()=>({projects:[]});
 try{const load=f.store.switchCanvas('A');await new Promise(r=>setImmediate(r));if(boundary==='close')await f.store.closeProject();else f.store.dispose();release();await load;assert.equal(f.store.batches.size,0);assert.equal(f.store.activeBatchId,null);if(boundary==='close')assert.equal(f.store.activeCanvasId,null)}finally{f.store.dispose()}
});
test('obsolete batch failure after navigation cannot replace current page notice',async()=>{
 let reject;const held=new Promise((_,r)=>reject=r);const f=fixture();const native=f.adapter.listBatches;f.adapter.listBatches=id=>id==='A'?held:native(id);
 try{const first=f.store.switchCanvas('A');await new Promise(r=>setImmediate(r));await f.store.switchCanvas('B');f.store.setNotice('current page');reject(Error('obsolete network failure'));await first;assert.equal(f.store.notice,'current page')}finally{f.store.dispose()}
});

test('a later same-canvas refresh wins over an earlier delayed read without navigation',async()=>{
 let release,reads=0;const held=new Promise(r=>release=r);const f=fixture('completed',true);const native=f.adapter.getCanvas;
 f.adapter.getCanvas=async id=>{if(++reads===1){await held;return{canvas:{id:'A',revision:1,layerIds:[]},layers:[],assets:[]}}return native(id)};
 try{const first=f.store.switchCanvas('A');await new Promise(r=>setImmediate(r));await f.store.loadCanvasFull('A');release();await first;assert.deepEqual(f.store.doc.canvases.A.layerIds,['result']);assert.equal(f.store.lastServerRevision,2)}finally{f.store.dispose()}
});
test('batch restoration cannot mutate document assets after a new local edit',async()=>{
 let release;const held=new Promise(r=>release=r);const f=fixture('completed',true);f.adapter.listBatches=async()=>{await held;return{batches:[f.materialize]}};
 try{const load=f.store.switchCanvas('A');await new Promise(r=>setImmediate(r));f.store.pendingCommands.push({id:'local-command'});const original=structuredClone(f.store.doc);release();await load;assert.deepEqual(f.store.doc,original);assert.equal(f.store.batches.size,0);assert.equal(f.store.pendingCommands[0].id,'local-command')}finally{f.store.dispose()}
});

for(const boundary of ['getCanvas','listBatches'])test(`another canvas background poll cannot invalidate A ${boundary} restoration`,async()=>{
 let release;const held=new Promise(r=>release=r);const f=fixture('completed',true);const native=f.adapter[boundary];
 f.store.doc.canvases.A={id:'A',revision:1,layerIds:[]};f.store.lastServerRevision=1;
 f.adapter[boundary]=async id=>{if(id==='A')await held;return native(id)};
 const candidate={id:'background-asset',model:'background',taskId:'background-task'};
 f.store.batches.set('background-batch',{batch:{id:'background-batch',canvasId:'B',autoPlace:true},tasks:new Map(),candidates:[],pollTimer:null});
 f.adapter.getBatch=async()=>({id:'background-batch',canvasId:'B',autoPlace:true,tasks:[{taskId:'background-task',model:'background',status:'completed',candidates:[candidate]}],candidates:[candidate]});
 try{const load=f.store.switchCanvas('A');await new Promise(r=>setImmediate(r));await runPoll(f.store,'background-batch');assert.equal(f.store.doc.assets[candidate.id].id,candidate.id);release();await load;assert.deepEqual(f.store.doc.canvases.A.layerIds,['result']);assert.equal(f.store.lastServerRevision,2);assert.equal(f.store.batches.get('batch').batch.params.model.resolution,'2K');assert.equal(f.store.doc.assets[candidate.id].id,candidate.id)}finally{f.store.dispose()}
});
