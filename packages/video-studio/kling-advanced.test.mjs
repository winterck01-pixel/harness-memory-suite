import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {specsFromIdentity} from './mcp-capabilities.js';
const identity=JSON.parse(await readFile(new URL('./fixtures/kling-current-identity.json',import.meta.url)));
test('both actual motion declarations are discoverable with automatic duration',()=>{
 const specs=specsFromIdentity(identity).filter(s=>s.mcp.tool==='motion_control');
 assert.equal(specs.length,2);for(const s of specs){assert.deepEqual(s.generationModes,['motion']);assert.deepEqual(s.durations,[-1]);}
});
import {createMcpRuntime} from './mcp-runtime.js';
import {mcpProfile} from './mcp-capabilities.js';
import {klingReferenceProblem,parseElements} from './kling-reference-contract.js';
import {videoDefaults,normalizedVideoOptions,referenceProblem} from './model-capabilities.js';
import {registerKlingLibraryRoutes} from './kling-library-routes.js';
const specs=specsFromIdentity(identity),find=(tool,model)=>specs.find(s=>s.mcp.tool===tool&&(!model||s.providerModel===model));
const image={id:'i',type:'image/png',name:'synthetic'},video={id:'v',type:'video/mp4',duration:5,name:'synthetic'};
function fixture(actualType='image'){
 const calls=[];let uploads=0;const runtime=createMcpRuntime({getTools:()=>({get:()=>({parameters:{}}),execute:async c=>{calls.push(c);const tool=c.name.split('__').at(-1);return {structuredContent:tool==='who_am_i'?identity:tool==='element_get'?{id:c.arguments.id,resource:actualType==='video'?{video:'https://fixture.invalid/v'}:{cover:'https://fixture.invalid/i'}}:tool==='element_list'?{elements:[{id:'12345',name:'synthetic'}]}:tool==='motion_library_list'?{motions:[{id:'67890',name:'synthetic'}]}:tool==='file_upload'?{ticket:'synthetic',uploadUrl:'https://fixture.invalid/upload'}:tool==='query_tasks'?{generationId:'task-original',status:'failed'}:{generationId:'task-original',status:'queued'}}}}),fetchUpload:async()=>{uploads++;return Response.json({url:'https://fixture.invalid/asset'})}});return {runtime,calls,get uploads(){return uploads}};
}
const request=extra=>({requestId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',prompt:'synthetic',extra});
for(const spec of specs.filter(s=>s.mcp.tool==='motion_control'))for(const source of ['id','video'])test(spec.id+' motion '+source+' mock prepare-submit-query',async()=>{
 const f=fixture(),extra={motionDirection:'motion_direction',...(source==='id'?{motionId:'90071992547409931234'}:{})},refs=source==='id'?[image]:[image,video];
 assert.equal(referenceProblem(spec,'motion',refs,{extra}),'');assert.equal(normalizedVideoOptions(spec,videoDefaults(spec),refs).duration,null);
 const prepared=await f.runtime.prepare({...request(extra),prompt:'',duration:-1,generationMode:'motion'},mcpProfile(spec),refs,async()=>Buffer.from('synthetic'));
 assert.equal(prepared.tool,'motion_control');assert.equal(prepared.payload.arguments.find(a=>a.name==='prompt').value,'');assert.equal(prepared.payload.arguments.some(a=>a.name==='duration'),false);
 await f.runtime.submit(prepared);await f.runtime.query({config:mcpProfile(spec),remoteId:'task-original'});assert.equal(f.calls.at(-1).arguments.generationId,'task-original');
});
for(const [label,refs,extra] of [['neither',[image],{motionDirection:'image_direction'}],['both',[image,video],{motionId:'1',motionDirection:'image_direction'}],['no direction',[image,video],{}],['bad id',[image],{motionId:123,motionDirection:'image_direction'}],['long video',[image,{...video,duration:11}],{motionDirection:'image_direction'}]])test('motion rejects '+label+' before upload',async()=>{
 const f=fixture();await assert.rejects(f.runtime.prepare(request(extra),mcpProfile(find('motion_control')),refs,async()=>Buffer.from('synthetic')));assert.equal(f.uploads,0);
});
for(const spec of specs.filter(s=>s.mcp.declaration.arguments.some(a=>a.name==='elements')))test(spec.id+' accepts current-account reusable image subject',async()=>{
 const f=fixture(),extra={elements:[{id:'12345',bindName:'Fixture',type:'image'}],...(spec.mcp.tool==='motion_control'?{motionId:'67890',motionDirection:'image_direction'}:{})};
 const refs=spec.mcp.declaration.inputs.filter(i=>i.required).map((i,n)=>({...image,id:'r'+n}));
 const p=await f.runtime.prepare(request(extra),mcpProfile(spec),refs,async()=>Buffer.from('synthetic'));
 const value=JSON.parse(p.payload.arguments.find(a=>a.name==='elements').value);assert.equal(value[0].id,'12345');assert.ok(f.calls.some(c=>c.name.endsWith('__element_get')));
});
test('element structure, duplicate IDs and unsafe number IDs are rejected',()=>{
 for(const x of [[{id:9007199254740992,bindName:'x'}],[{id:'1',bindName:'x'},{id:'1',bindName:'y'}],[{id:'1',bindName:'x',url:'file:///private'}],{}])assert.throws(()=>parseElements(x));
 assert.equal(parseElements('[{"id":"90071992547409931234","bindName":"x"}]')[0].id,'90071992547409931234');
});
for(const [model,type,count,videoInput,images] of [['kling-video-o1','video',1,false,0],['kling-video-v4_0','video',4,false,0],['kling-video-v4_0','image',8,false,0],['kling-video-v3_0_omni','video',2,true,0],['kling-video-v3_0_omni','video',1,true,1]])test('element constraints reject '+[model,type,count,videoInput,images].join('/'),()=>{
 const s=find('omni_ref_video',model),refs=[...(videoInput?[video]:[]),...Array.from({length:images},()=>image)];assert.ok(klingReferenceProblem(s,refs,{elements:Array.from({length:count},(_,n)=>({id:String(n+1),bindName:'x',type}))}));
});
for(const model of ['kling-video-v4_0','kling-video-v3_0_omni'])test('video subject accepted and transported with type '+model,async()=>{
 const f=fixture('video'),s=find('omni_ref_video',model),p=await f.runtime.prepare(request({elements:[{id:'12345',bindName:'video',type:'video'}]}),mcpProfile(s),[],async()=>Buffer.from('synthetic'));assert.equal(JSON.parse(p.payload.arguments.find(a=>a.name==='elements').value)[0].type,'video');
});
test('server verifies subject actual type before upload',async()=>{
 const f=fixture('video');await assert.rejects(f.runtime.prepare(request({elements:[{id:'12345',bindName:'x',type:'image'}]}),mcpProfile(find('image_to_image')), [image],async()=>Buffer.from('synthetic')),/实际类型/);assert.equal(f.uploads,0);
});
test('library routes use current account and allow only read operations',async()=>{
 const f=fixture(),routes=[];registerKlingLibraryRoutes({route:(name,methods,handle)=>routes.push({name,methods,handle}),mcp:f.runtime});
 for(const tool of ['element_list','element_get','motion_library_list']){const r=await routes[0].handle(new Request('http://fixture/mcp/library?tool='+tool+'&id=12345&accountId=synthetic-current-account'));assert.equal(r.ok,true)}
 await assert.rejects(routes[0].handle(new Request('http://fixture/mcp/library?tool=element_delete&accountId=synthetic-current-account')));
 await assert.rejects(f.runtime.library('element_list',null,'another-account'),/账号已切换/);
 assert.equal(f.uploads,0);
});

test('reference video resolves audio defaults, rejects sound conflicts and resolves auto ratio without visual input',async()=>{
 const s=find('omni_ref_video','kling-video-v3_0_omni'),f=fixture();
 const p=await f.runtime.prepare(request({}),mcpProfile(s),[video],async()=>Buffer.from('synthetic'));
 assert.equal(p.payload.arguments.find(a=>a.name==='enable_audio').value,'false');
 const bad=fixture();await assert.rejects(bad.runtime.prepare(request({enable_audio:true}),mcpProfile(s),[video],async()=>Buffer.from('synthetic')),/关闭生成新声音/);assert.equal(bad.uploads,0);
 await assert.rejects(bad.runtime.prepare(request({enable_audio:true,keepOriginalSound:true}),mcpProfile(find('omni_ref_video','kling-video-v4_0')),[],async()=>Buffer.from('synthetic')),/不能同时/);
 const plain=await f.runtime.prepare(request({}),mcpProfile(s),[],async()=>Buffer.from('synthetic'));assert.notEqual(plain.payload.arguments.find(a=>a.name==='aspect_ratio').value,'auto');
});
test('optional UUIDv7 trace is omitted instead of leaking an invalid v4-derived trace',async()=>{
 const calls=[],runtime=createMcpRuntime({getTools:()=>({get:()=>({parameters:{properties:{taskTraceId:{type:'string'}}}}),execute:async c=>{calls.push(c);return {structuredContent:identity}}})});
 const p=await runtime.prepare(request({}),mcpProfile(find('text_to_image')),[],async()=>{throw Error('no upload')});assert.equal(p.payload.taskTraceId,undefined);
});

import {referenceMaxBytes} from './kling-reference-contract.js';
test('reference intake and runtime share image20/video300/audio50 MB limits',()=>{assert.equal(referenceMaxBytes('video/mp4'),300*1024*1024);assert.equal(referenceMaxBytes('image/png'),20*1024*1024);assert.equal(referenceMaxBytes('audio/mpeg'),50*1024*1024)});
