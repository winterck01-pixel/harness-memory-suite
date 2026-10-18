import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {specsFromIdentity,mcpProfile} from './mcp-capabilities.js';
import {createMcpRuntime,readMcpCatalog,writeMcpCatalog} from './mcp-runtime.js';
const identity=JSON.parse(await readFile(new URL('./fixtures/kling-current-identity.json',import.meta.url),'utf8'));
const flat=structuredClone(identity);for(const tool of Object.keys(flat.availableModels))flat.availableModels[tool]=flat.availableModels[tool].models;
test('current real-world container and legacy arrays produce identical 27 isolated model specs',()=>{
 const specs=specsFromIdentity(identity);assert.equal(specs.length,27);assert.equal(specs.filter(s=>s.kind==='image').length,8);assert.equal(specs.filter(s=>s.kind==='video').length,19);assert.deepEqual(specs,specsFromIdentity(flat));assert.ok(specs.every(s=>s.id.startsWith('mcp:cn:')&&s.adapter==='klingMcp'));
});
test('malformed containers and duplicate declarations remain rejected',()=>{
 for(const value of [{models:{}},{models:[],defaultModel:'missing'},{models:[],extra:true},'wrong']){const bad=structuredClone(identity);bad.availableModels.text_to_image=value;assert.throws(()=>specsFromIdentity(bad))}
 const bad=structuredClone(identity);bad.availableModels.text_to_image.models.push(bad.availableModels.text_to_image.models[0]);assert.throws(()=>specsFromIdentity(bad),/重复/);
});
test('new identity survives cache write and read without changing model semantics',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kling-catalog-'));try{await writeMcpCatalog(dir,identity);assert.deepEqual(await readMcpCatalog(dir),specsFromIdentity(identity))}finally{await rm(dir,{recursive:true,force:true})}
});
function fixture(){let uploads=0;const calls=[];return {calls,get uploads(){return uploads},runtime:createMcpRuntime({getTools:()=>({get:()=>({parameters:{}}),async execute(call){calls.push(call.name);return {structuredContent:call.name.endsWith('who_am_i')?identity:call.name.endsWith('file_upload')?{ticket:'synthetic',uploadUrl:'https://fixture.invalid/upload'}:call.name.endsWith('query_tasks')?{generationId:'synthetic-task',status:'failed'}:{generationId:'synthetic-task',status:'queued'}}}}),fetchUpload:async()=>{uploads++;return Response.json({url:'https://fixture.invalid/reference'})}})}}
for(const spec of specsFromIdentity(identity))test('actual declaration mock prepare/submit/query: '+spec.id,async()=>{
 const f=fixture(),profile=mcpProfile(spec),refs=spec.mcp.declaration.inputs.filter(i=>i.required).map((i,n)=>({id:'fixture-'+n,name:'fixture',type:(i.name.includes('video')?'video/mp4':i.name.includes('audio')?'audio/wav':'image/png')}));
 const prepared=await f.runtime.prepare({requestId:randomUUID(),prompt:'Synthetic only',...(spec.kind==='video'?{duration:spec.defaults.duration||spec.durations[0],aspectRatio:spec.ratios.find(r=>r!=='auto')||'16:9'}:{}),extra:spec.mcp.tool==='motion_control'?{motionId:'12345',motionDirection:'motion_direction'}:{}},profile,refs,async()=>Buffer.from('synthetic'));
 assert.equal(prepared.payload.model,spec.providerModel);if(!spec.mcp.declaration.arguments.some(a=>['aspect_ratio','aspectRatio'].includes(a.name)))assert.equal(prepared.payload.arguments.some(a=>['aspect_ratio','aspectRatio'].includes(a.name)),false);if(spec.mcp.declaration.arguments.some(a=>a.name==='imageCount'))assert.equal(prepared.payload.arguments.find(a=>a.name==='imageCount')?.value,'1');await f.runtime.submit(prepared);await f.runtime.query({config:profile,remoteId:'synthetic-task'});assert.ok(f.calls.every(n=>n.startsWith('mcp__Plugin-DeepSeek-kling-ai__')));
});
for(const model of ['kling-video-o1','kling-video-v3_0_omni'])test('conditional reference cap rejects five images plus video before any mock upload: '+model,async()=>{
 const spec=specsFromIdentity(identity).find(s=>s.mcp.tool==='omni_ref_video'&&s.providerModel===model),f=fixture();
 const refs=[...Array.from({length:5},(_,n)=>({id:'image-'+n,name:'fixture',type:'image/png'})),{id:'video',name:'fixture',type:'video/mp4'}];
 await assert.rejects(f.runtime.prepare({requestId:randomUUID(),prompt:'Synthetic only',duration:5,aspectRatio:'16:9',extra:{}},mcpProfile(spec),refs,async()=>Buffer.from('synthetic')),/合计/);assert.equal(f.uploads,0);assert.ok(f.calls.every(n=>n.endsWith('who_am_i')));
});

for(const model of ['kling-video-o1','kling-video-v3_0_omni'])test('conditional reference cap accepts four images plus video and rejects seven images plus element: '+model,async()=>{
 const spec=specsFromIdentity(identity).find(s=>s.mcp.tool==='omni_ref_video'&&s.providerModel===model),f=fixture();
 const request={requestId:randomUUID(),prompt:'Synthetic only',duration:5,aspectRatio:'16:9',extra:{}};
 const images=n=>Array.from({length:n},(_,i)=>({id:'image-'+i,name:'fixture',type:'image/png'}));
 const accepted=await f.runtime.prepare(request,mcpProfile(spec),[...images(4),{id:'video',name:'fixture',type:'video/mp4'}],async()=>Buffer.from('synthetic'));assert.equal(accepted.payload.inputs.length,5);
 const blocked=fixture();await assert.rejects(blocked.runtime.prepare({...request,extra:{elements:[{id:'12345',bindName:'fixture'}]}},mcpProfile(spec),images(7),async()=>Buffer.from('synthetic')),/合计/);assert.equal(blocked.uploads,0);
});
