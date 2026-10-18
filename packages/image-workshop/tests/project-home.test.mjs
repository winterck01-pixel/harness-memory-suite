import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorStore} from '../fixed-editor/src/state/editorStore.js';
function fixture(putCanvas){
 const project={id:'project',name:'Synthetic project',updatedAt:1,canvasIds:['canvas']},canvas={id:'canvas',projectId:'project',name:'Canvas',revision:1,layerIds:[],width:128,height:128};
 const order=[],store=new EditorStore({putCanvas:async(...args)=>{order.push('save');return putCanvas(...args)},listProjects:async()=>{order.push('projects');return {projects:[project]}}});
 store.doc.projects.project=project;store.doc.canvases.canvas=canvas;store.activeProjectId='project';store.activeCanvasId='canvas';store.pendingCommands.push({id:'unsaved-command'});store.selection.add('layer');store.emit();
 return {store,order};
}
test('returning home awaits save and keeps the project document for reopening',async()=>{
 let release;const pending=new Promise(r=>release=r),{store,order}=fixture(async()=>{await pending;return {newRevision:2}});
 try{const doc=structuredClone(store.doc),closing=store.closeProject();assert.equal(store.activeProjectId,'project');assert.equal(store.activeCanvasId,'canvas');assert.deepEqual(order,['save']);release();await closing;assert.deepEqual(order,['save','projects']);assert.equal(store.getSnapshot().project,null);assert.equal(store.getSnapshot().canvas,null);assert.deepEqual(store.doc,doc);assert.equal(store.selection.size,0);assert.equal(store.projects.length,1);}finally{store.dispose()}
});
test('save failure prevents return home and preserves unsaved changes',async()=>{
 const {store,order}=fixture(async()=>{throw Error('Synthetic offline')});try{assert.equal(await store.closeProject(),false);assert.equal(store.activeProjectId,'project');assert.equal(store.activeCanvasId,'canvas');assert.equal(store.pendingCommands[0].id,'unsaved-command');assert.equal(store.selection.has('layer'),true);assert.deepEqual(order,['save']);assert.equal(store.saveState,'error');}finally{store.dispose()}
});
