import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createLegacyAgentUi,createWorkspaceAgentUi} from '../agent-ui.js';
import {createHttpEditorAdapter} from '../fixed-editor/http-adapter.js';
import {createWorkshopSurface,actionSpec} from '../../image-studio/fixed-editor/agent-surface.js';

async function fixture(){
 const raw=await readFile(new URL('../client.jsx',import.meta.url),'utf8');
 const state={active:true,images:[{id:'asset',name:'Synthetic'}],tasks:[{id:'task',prompt:'keep exact prompt',model:'synthetic-model',referenceIds:['asset'],extra:{seed:42}}],selectedId:null,selectedTaskId:'',detailTaskId:'',tab:'library',search:'',modal:false,zoom:false,seed:{referenceIds:[]},formKey:0,dirty:false,busy:false,initialized:true,configStale:false};
 let mounted=true,commits=true;const env={editEpoch:{current:0},model:'default-model'};
 const setters={setSelectedId:'selectedId',setSelectedTaskId:'selectedTaskId',setZoom:'zoom',setDetailTaskId:'detailTaskId',setDetailResultId:'detailResultId',setFormDirty:'dirty',setSeed:'seed',setModel:'model',setFormKey:'formKey'};
 for(const [name,key]of Object.entries(setters))env[name]=value=>{if(!commits)return;state[key]=typeof value==='function'?value(state[key]):value;if(key==='formKey')state.formDraft={...state.seed,prompt:state.seed.prompt||'',referenceIds:[...(state.seed.referenceIds||[])]};};
 // Run the production handlers, rather than implementing alternative compose/selection semantics.
 const functions=['chooseImage','openTask','chooseTask','compose'].map(name=>raw.split('\n').find(line=>line.trimStart().startsWith('function '+name+'('))).join('\n');
 const actions=vm.runInNewContext(functions+'\n({chooseImage,openTask,chooseTask,compose})',env);
 const handle=createLegacyAgentUi({snapshot:()=>({...state}),alive:()=>mounted,workspace:async()=> 'applied',actions:{...actions,search:value=>{if(commits)state.search=value},tab:value=>{if(commits)state.tab=value},preview:value=>{if(commits){state.modal=value;if(!value)state.detailTaskId=''}},zoom:env.setZoom}});
 return {state,handle,unmount:()=>{mounted=false},stall:()=>{commits=false}};
}
test('legacy uses actual compose/selection actions for navigation, preview and original task parameters without submitting',async()=>{
 const f=await fixture(),call=(command,value)=>f.handle({command,value});
 for(const [command,value]of [['search','Synthetic'],['show_panel','history'],['select_asset','asset'],['preview','open'],['zoom',2],['fit'],['preview','close'],['select_task','task'],['compose_task','task']])assert.equal(await call(command,value),'applied',command);
 assert.equal(f.state.search,'Synthetic');assert.equal(f.state.tab,'history');assert.equal(f.state.detailTaskId,'');assert.equal(f.state.seed.prompt,'keep exact prompt');assert.equal(f.state.seed.extra.seed,42);assert.equal(f.state.formDraft.prompt,'keep exact prompt');
 assert.equal(await call('use_reference','asset'),'applied');assert.deepEqual(Array.from(f.state.seed.referenceIds),['asset']);assert.equal(f.state.formDraft.prompt,'');
 assert.equal(await call('select_asset','missing'),'failed');assert.equal(await call('select_task','missing'),'failed');assert.equal(await call('show_panel','unknown'),'unsupported');assert.equal(await call('zoom',3),'failed');assert.equal(await call('script','alert(1)'),'unsupported');
});
test('legacy dirty/busy drafts prevent compose and reference changes, inactive surfaces never claim applied',async()=>{
 const f=await fixture();f.state.dirty=true;const original=JSON.stringify(f.state.seed);assert.equal(await f.handle({command:'compose_task',value:'task'}),'blocked_dirty');assert.equal(await f.handle({command:'use_reference',value:'asset'}),'blocked_dirty');assert.equal(JSON.stringify(f.state.seed),original);f.state.dirty=false;f.state.busy=true;assert.equal(await f.handle({command:'compose_task',value:'task'}),'blocked_dirty');f.state.active=false;assert.equal(await f.handle({command:'search',value:'x'}),'unsupported');
});
test('legacy waits for applied UI state and fails closed after unmount or ignored render update',async()=>{
 const f=await fixture();f.stall();assert.equal(await f.handle({command:'search',value:'never committed'}),'failed');f.unmount();assert.equal(await f.handle({command:'select_asset',value:'asset'}),'failed');
});
test('workspace switch preserves dirty drafts and reports success only once the target workspace is ready',async()=>{
 const state={mode:'legacy',mounted:true,ready:true};let dirty=true;
 const switchWorkspace=createWorkspaceAgentUi({snapshot:()=>state,dirty:()=>dirty,change:value=>{queueMicrotask(()=>{state.mode=value;state.ready=true})}});
 assert.equal(await switchWorkspace('editor'),'blocked_dirty');assert.equal(state.mode,'legacy');dirty=false;assert.equal(await switchWorkspace('editor'),'applied');assert.equal(state.mode,'editor');assert.equal(await switchWorkspace('legacy'),'applied');assert.equal(await switchWorkspace('script'),'unsupported');
});
test('actual HTTP adapter SSE and authenticated presence identify client roles and carry bound acknowledgement capabilities',async()=>{
 const previous=globalThis.EventSource;const readers=[],connections=[];let active=true;
 const surface=createWorkshopSurface({name:'image_workshop',description:'fixture',actions:{ui_clients:actionSpec(null),ui_status:actionSpec(null,['operationId'],['operationId'])},invoke:()=>({})});
 class EventSourceFixture{constructor(url){const req=new Request(new URL(url,'http://local'));const reader=surface.stream(req).body.getReader();this.reader=reader;this.closed=false;readers.push(reader);connections.push(this)}addEventListener(_name,receive){this.pump=(async()=>{while(!this.closed){const {done,value}=await this.reader.read();if(done)break;receive({data:new TextDecoder().decode(value).split('data: ')[1]});}})()}close(){this.closed=true;void this.reader.cancel()}}
 globalThis.EventSource=EventSourceFixture;
 const requests=[],adapter=createHttpEditorAdapter({fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body);requests.push(body);try{return Response.json(surface.acknowledge(body))}catch(e){return Response.json({error:e.message},{status:e.status||400})}}});
 const wait=async check=>{for(let i=0;i<100;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('fixture timeout')};
 const stop=adapter.subscribeChanges(async(event,clientId)=>{if(event.kind==='ui-command')await adapter.acknowledgeUi({clientId,operationId:event.operationId,capability:event.capability,status:'applied'})},{role:'image-legacy',active:()=>active,workspace:()=> 'legacy'});
 const execution={agent:{session:{id:'fixture'}}},call=(action,input)=>surface.definition.execute({action,input},execution);
 try{
  await wait(()=>requests.some(r=>r.kind==='presence'));let clients=await call('ui_clients');assert.equal(clients.connections[0].role,'image-legacy');assert.equal(clients.connections[0].active,true);assert.equal(clients.clients[0],clients.connections[0].clientId);assert.ok(!JSON.stringify(clients).includes(requests[0].capability));
  const receipt=surface.ui({clientId:clients.clients[0],command:'search',value:'Synthetic'});await wait(async()=> (await call('ui_status',{operationId:receipt.operationId})).applied);assert.equal(requests.find(r=>r.operationId===receipt.operationId).capability,requests[0].capability);
  active=false;await stop.reportPresence();clients=await call('ui_clients');assert.equal(clients.connections[0].active,false);assert.throws(()=>surface.acknowledge({kind:'presence',clientId:clients.clients[0],capability:'forged',role:'image-legacy',active:true}));
 }finally{stop();await Promise.all(connections.map(c=>c.pump));surface.dispose();globalThis.EventSource=previous}
});
