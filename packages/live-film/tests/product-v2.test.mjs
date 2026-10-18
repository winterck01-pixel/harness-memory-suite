import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Store,mutate} from '../store.js';import {modelSpec} from 'dsh-video-studio/model-registry.js';
const model=structuredClone(modelSpec('seedance-2-5'));
async function setup(){const dir=await mkdtemp(join(tmpdir(),'film-v2-'));const store=await new Store(dir).open();let p=await mutate(store,{op:'createProject',name:'片名'});for(let i=0;i<3;i++)p=await mutate(store,{op:'addShot',projectId:p.id,name:'镜头'+i,duration:4,generationDuration:8,model:model.id});return {dir,store,p}}
test('duplicate creates a fresh production slot without adopted video or task',async()=>{const {dir,store,p}=await setup();try{await store.tx(s=>Object.assign(s.projects[0].shots[0],{prompt:'原提示词',refs:[{id:'a',role:'person'}],selected:'v',candidates:[{id:'v',assetId:'file',duration:8}],trimIn:2}));const next=await mutate(store,{op:'duplicateShot',projectId:p.id,shotId:p.shots[0].id});assert.equal(next.shots.length,4);const c=next.shots[1];assert.notEqual(c.id,next.shots[0].id);assert.equal(c.prompt,'原提示词');assert.deepEqual(c.refs,next.shots[0].refs);assert.equal(c.selected,null);assert.equal(c.trimIn,0);assert.deepEqual(c.candidates,[]);assert.equal(store.read().tasks.length,0)}finally{await rm(dir,{recursive:true,force:true})}});
test('delete and undo persist across restart and preserve adopted candidate',async()=>{const {dir,store,p}=await setup();try{await store.tx(s=>Object.assign(s.projects[0].shots[1],{selected:'v',candidates:[{id:'v',duration:8}],trimIn:1}));await mutate(store,{op:'deleteShot',projectId:p.id,shotId:p.shots[1].id});const reopened=await new Store(dir).open();const restored=await mutate(reopened,{op:'restoreShot',projectId:p.id});assert.deepEqual(restored.shots.map(s=>s.id),p.shots.map(s=>s.id));assert.equal(restored.shots[1].selected,'v');assert.equal(restored.shots[1].trimIn,1);assert.equal(restored.deletedShots.length,0);await assert.rejects(mutate(reopened,{op:'restoreShot',projectId:p.id}),/没有可撤销/)}finally{await rm(dir,{recursive:true,force:true})}});
test('batch parameters are atomic and preserve prompt, adopted cut, and unselected slots',async()=>{
 const {dir,store,p}=await setup(),caps={models:[model],assets:[]};
 try{
  await store.tx(s=>Object.assign(s.projects[0].shots[0],{prompt:'原提示词',selected:'adopted',candidates:[{id:'adopted',duration:8}],trimIn:1}));
  const original=store.read().projects[0];
  const next=await mutate(store,{op:'batchSettings',projectId:p.id,shotIds:p.shots.slice(0,2).map(s=>s.id),patch:{generationDuration:4}},caps);
  assert.deepEqual(next.shots.map(s=>s.generationDuration),[4,4,8]);
  assert.deepEqual(next.shots[0],{...original.shots[0],generationDuration:4});
  assert.deepEqual(next.shots[2],original.shots[2]);
  await mutate(store,{op:'editShot',projectId:p.id,shotId:p.shots[1].id,patch:{duration:8,prompt:'保留'}});
  const before=store.read();
  await assert.rejects(mutate(store,{op:'batchSettings',projectId:p.id,shotIds:p.shots.map(s=>s.id),patch:{generationDuration:4}},caps),/镜头1.*短于/);
  assert.deepEqual(store.read(),before);
  await assert.rejects(mutate(store,{op:'batchSettings',projectId:p.id,shotIds:[p.shots[0].id],patch:{prompt:'不能覆盖'}},caps),/参数无效/);
  assert.deepEqual(store.read(),before);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('first shot and project are atomic; invalid input leaves no empty project',async()=>{const dir=await mkdtemp(join(tmpdir(),'film-first-')),store=await new Store(dir).open();try{await assert.rejects(mutate(store,{op:'createProjectWithShot',projectName:'失败影片',name:'片段',duration:0,generationDuration:4,model:model.id}),/时长/);assert.equal(store.read().projects.length,0);const p=await mutate(store,{op:'createProjectWithShot',projectName:'新影片',name:'第一段',duration:4,generationDuration:8,model:model.id});assert.equal(p.name,'新影片');assert.equal(p.shots[0].name,'第一段');assert.equal((await new Store(dir).open()).read().projects[0].shots.length,1)}finally{await rm(dir,{recursive:true,force:true})}});
