import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path'
let apply;try{({apply}=await import('../index.js'))}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND'||!/@deepseek-ai\/|package 'zod'/.test(error.message))throw error}
const hasDeps=!!apply
const skip={skip:!hasDeps?'Harness package dependencies unavailable locally':false}


async function setupHarness(){
 const tools=new Map(),services=new Map(),tables=new Map();const sessions=new Map([['a',{header:{cwd:'/projects/a'}}],['b',{header:{cwd:'/projects/b'}}]])
 const ctx={get:key=>key==='sessions'?sessions:services.get(key),provide:(k,v)=>services.set(k,v),effect:()=>{},inject:()=>{},tools:{resultValidationVersion:1,register:tool=>{tools.set(tool.name,tool);return()=>{}}},storageDomain:{async open(spec){for(const [key,s]of Object.entries(spec.tables)){const map=new Map();tables.set(key,{get:id=>map.get(id),entries:()=>map.entries(),put:async(id,v)=>map.set(id,s.valueSchema.parse(v))})}return{table:k=>tables.get(k),close(){}}}}}
 await apply(ctx,{enabled:true,maxRecordChars:20000,maxResults:8});const exec=id=>({agent:{id}})
 const saved=await tools.get('save_knowledge').execute({title:'alpha',content:'project A secret'},exec('a'))
 assert.equal(tables.get('entries').get(saved.id).projectId,'/projects/a');const other=await tools.get('save_knowledge').execute({title:'alpha',content:'project A secret'},exec('b'));assert.notEqual(other.id,saved.id);assert.equal((await tools.get('save_knowledge').execute({title:'alpha',content:'project A secret'},exec('a'))).id,saved.id);await tables.get('entries').put(other.id,{...tables.get('entries').get(other.id),deletedAt:'gone'});
 ctx.tools.resultValidationVersion=0;await assert.rejects(tools.get('get_knowledge').execute({id:saved.id},exec('a')),/HOST_RESULT_VALIDATION_REQUIRED/);ctx.tools.resultValidationVersion=1;
 const mine=await tools.get('get_knowledge').execute({id:saved.id},exec('a'));assert.equal(mine.found,true)
 assert.equal((await tools.get('get_knowledge').execute({id:saved.id},exec('b'))).found,false)
 assert.equal((await tools.get('search_knowledge').execute({query:'secret'},exec('b'))).result.results.length,0)
 assert.equal((await tools.get('list_knowledge').execute({},exec('b'))).result.total,0)

 const historyEnvelope=await tools.get('knowledge_history').execute({id:saved.id},exec('b'));assert.equal(historyEnvelope.error.code,'KNOWLEDGE_READ_FAILED');assert.doesNotMatch(JSON.stringify(historyEnvelope),/project A secret/)
 await assert.rejects(tools.get('get_knowledge').execute({id:saved.id},{}),/TRUSTED_PROJECT_REQUIRED/)
 const vault=services.get('knowledgeVault');const rag=services.get('knowledgeRag');
 assert.throws(()=>vault.get(saved.id),/TRUSTED_CONTEXT_REQUIRED/);
 assert.throws(()=>vault.list(),/TRUSTED_CONTEXT_REQUIRED/);
 const operatorEntry=mine.entry;
 const request=new Request('https://host/api/knowledge-rag',{headers:{'sec-fetch-site':'same-origin'}});

 ctx.get=key=>key==='connection'?{requestRejection:()=>undefined}:key==='sessions'?sessions:services.get(key);
 const operator=rag.contextForRequest(request);
 assert.equal(vault.forRequest(request).get(saved.id).id,saved.id);
 assert.equal(vault.forContext(rag.contextForExecution(exec('a'))).get(saved.id).id,saved.id);
 assert.throws(()=>vault.forContext({operator:true}),/UNTRUSTED_CONTEXT/);
 assert.throws(()=>vault.forRequest(new Request('https://host/')),/AUTHENTICATED_REQUEST_REQUIRED/);await rag.setScope({id:saved.id,updatedAt:operatorEntry.updatedAt,shared:true,projectId:''},operator);
 const shared=await tools.get('get_knowledge').execute({id:saved.id},exec('b'));assert.equal(shared.found,true);
 await tools.get('update_knowledge').execute({id:saved.id,updated_at:shared.entry.updatedAt,content:'shared updated'},exec('a'));
 assert.equal((await tools.get('get_knowledge').execute({id:saved.id},exec('b'))).found,true);
 assert.equal(tables.get('entries').get(saved.id).projectId,'');
 assert.equal(rag.version,1);assert.throws(()=>rag.getSettings(rag.contextForExecution(exec('a'))),/OPERATOR_REQUIRED/)
 return {tools,services,tables,ctx,exec,saved,rag}
}

test('real Harness defineTool/domain schemas: per-session save/list/search/read isolation (native mode)', skip,async()=>{
 const {tools,services,tables,ctx,exec,saved,rag}=await setupHarness()
 const [{Context},{default:ToolRuntime},{default:SystemPrompt}]=await Promise.all([import('@deepseek-ai/cordis'),import(process.env.KNOWLEDGE_TOOLS_MODULE||'@deepseek-ai/dsh-tools'),import('@deepseek-ai/dsh-system-prompt')]);
 const host=new Context();await host.plugin(SystemPrompt);const hostFiber=await host.plugin(ToolRuntime,{mode:"native"});assert.equal(host.tools.resultValidationVersion,1,'patched host with canonical result validation required');for(const name of ['search_knowledge','get_knowledge','list_knowledge','knowledge_history','read_knowledge_file'])host.tools.register(tools.get(name));
 const actual=await host.tools.execute({name:'search_knowledge',arguments:{query:'shared'},agent:{id:'a'},callId:'proof-live',signal:new AbortController().signal});
 assert.equal(actual.isError,false,JSON.stringify(actual));assert.match(actual.content[0].text,/shared updated/);assert.doesNotMatch(actual.content[0].text,/_knowledgeProof/);
 const revoke=host.on('tools/post-execute',async(_exec,result,next)=>{await Promise.resolve();await tables.get('entries').put(saved.id,{...tables.get('entries').get(saved.id),projectId:'/projects/b',shared:false,updatedAt:'revoked'});return next()});
 const revoked=await host.tools.execute({name:'search_knowledge',arguments:{query:'shared'},agent:{id:'a'},callId:'proof-revoke',signal:new AbortController().signal});assert.equal(revoked.isError,true);assert.equal('value' in revoked,false);assert.match(revoked.content[0].text,/TOOL_RESULT_REJECTED|rejected/i);assert.doesNotMatch(revoked.content[0].text,/shared updated/);revoke();
 const tamper=host.on('tools/post-execute',async()=>({kind:'accept',content:[{type:'text',text:'injected'}]}));
 const changed=await host.tools.execute({name:'search_knowledge',arguments:{query:'shared'},agent:{id:'a'},callId:'proof-tamper',signal:new AbortController().signal});assert.equal(changed.isError,true);assert.equal('value' in changed,false);tamper();const swap=host.on('tools/post-execute',async()=>({kind:'accept',value:{result:{results:[],warnings:['forged']}}}));const swapped=await host.tools.execute({name:'search_knowledge',arguments:{query:'shared'},agent:{id:'a'},callId:'proof-swap',signal:new AbortController().signal});assert.equal(swapped.isError,true);assert.equal('value' in swapped,false);swap();
 for(const [name,args]of [['get_knowledge',{id:saved.id}],['list_knowledge',{}],['knowledge_history',{id:saved.id}]]){
  await tables.get('entries').put(saved.id,{...tables.get('entries').get(saved.id),projectId:'/projects/a',updatedAt:`before-${name}`});
  const stop=host.on('tools/post-execute',async()=>{await Promise.resolve();await tables.get('entries').put(saved.id,{...tables.get('entries').get(saved.id),projectId:'/projects/b',updatedAt:`after-${name}`});return {kind:'accept'}});
  const final=await host.tools.execute({name,arguments:args,agent:{id:'a'},callId:name,signal:new AbortController().signal});assert.equal(final.isError,true,name);assert.equal('value' in final,false,name);stop();
 }
 const dir=await mkdtemp(join(tmpdir(),'knowledge-source-'));try{const path=join(dir,'book.txt');await writeFile(path,'private file');await tables.get('entries').put(saved.id,{...tables.get('entries').get(saved.id),projectId:'/projects/a',sourceGranted:true,assetId:`file:${path}`,updatedAt:'file-source'});services.set('knowledgeFiles',{read:async()=>({text:await readFile(path,'utf8')})});const changeFile=host.on('tools/post-execute',async()=>{await writeFile(path,'replacement');return {kind:'accept'}});const file=await host.tools.execute({name:'read_knowledge_file',arguments:{id:saved.id},agent:{id:'a'},callId:'file-revise',signal:new AbortController().signal});assert.equal(file.isError,true);assert.equal('value' in file,false);changeFile()}finally{await rm(dir,{recursive:true,force:true})}
 const cancelledController=new AbortController();const cancel=host.on('tools/post-execute',async()=>{await Promise.resolve();cancelledController.abort();return {kind:'accept'}});const cancelled=await host.tools.execute({name:'search_knowledge',arguments:{query:'shared'},agent:{id:'a'},callId:'cancel-proof',signal:cancelledController.signal});assert.equal(cancelled.isError,true);assert.equal('value' in cancelled,false);cancel();
 await hostFiber.dispose();
 const parsed=await rag.readPages({bytes:Buffer.from('line one\nline two'),filename:'a.txt',textBudget:100},rag.contextForExecution(exec('a')));assert.equal(parsed.pages[0].text,'line one\nline two')
})

test('real Harness defineTool/domain schemas: per-session save/list/search/read isolation (ptc bridge)', skip,async()=>{
 const {tools,tables,saved,services}=await setupHarness()
 const [{Context},{default:ToolRuntime},{default:SystemPrompt}]=await Promise.all([import('@deepseek-ai/cordis'),import(process.env.KNOWLEDGE_TOOLS_MODULE||'@deepseek-ai/dsh-tools'),import('@deepseek-ai/dsh-system-prompt')]);
 const host=new Context();await host.plugin(SystemPrompt);const hostFiber=await host.plugin(ToolRuntime,{mode:"ptc"});assert.equal(host.tools.resultValidationVersion,1,'patched host with canonical result validation required');for(const name of ['search_knowledge','get_knowledge','list_knowledge','knowledge_history','read_knowledge_file'])host.tools.register(tools.get(name));

 const cwdByAgent=new Map([['a','/projects/a'],['b','/projects/b']]);
 host.provide('workingDirectory',{ensure:async agent=>{assert.equal(agent.session.header.cwd,cwdByAgent.get(agent.id));return cwdByAgent.get(agent.id)},set:async(agent,path)=>{cwdByAgent.set(agent.id,path);return path}});
 const {PtcRuntime}=await import('@deepseek-ai/dsh-ptc-runtime');
 let enteredA,enteredB,releaseA,releaseB;
 const aEntered=new Promise(r=>{enteredA=r}),bEntered=new Promise(r=>{enteredB=r});
 const aRelease=new Promise(r=>{releaseA=r}),bRelease=new Promise(r=>{releaseB=r});
 const seenCwds=[],insideReadEvents=[],isolationIds=new Map();
 const vault=services.get('knowledgeVault');
 class BindingRuntime extends PtcRuntime {language='typescript';isolation='test-binding';resolve(r){seenCwds.push(r.cwd);return r}async run(r){try{
   const result=r.program.startsWith('interleave-')
     ?await r.bindings[0].functions.read_knowledge_file({id:isolationIds.get(r.program)})
     :await r.bindings[0].functions.search_knowledge({query:'shared'})
   return {logs:[],value:{cwd:r.cwd,result}}
 }catch(e){return {logs:[],value:{denied:true,message:e.message}}}}}

 const bridge=await host.plugin(BindingRuntime);await tables.get('entries').put(saved.id,{...tables.get('entries').get(saved.id),projectId:'/projects/a',assetId:'',updatedAt:'ptc-visible'});
 const ptcAgent={id:'a',session:{header:{cwd:'/projects/a'},append(){}}};
 const normalPtc=await host.tools.execute({name:'run_code',arguments:{code:'binding fixture',description:'test shared core bridge'},agent:ptcAgent,callId:'ptc-normal',signal:new AbortController().signal});assert.equal(normalPtc.isError,false);assert.match(JSON.stringify(normalPtc.value),/shared updated/);


 const savedA=await tools.get('save_knowledge').execute({title:'isolation A',content:'isolation A private'},{agent:{id:'a'}});
 const savedB=await tools.get('save_knowledge').execute({title:'isolation B',content:'isolation B private'},{agent:{id:'b'}});
 isolationIds.set('interleave-a',savedA.id);isolationIds.set('interleave-b',savedB.id);
 services.set('knowledgeFiles',{async read(id){
   const own=id===savedA.id?'A':'B',other=own==='A'?'B':'A';
   const inspect=phase=>{
     const entry=vault.get(id),listed=JSON.stringify(vault.list('isolation'));
     assert.equal(entry.projectId,own==='A'?'/projects/a':'/projects/b');
     assert.equal(entry.content,'isolation '+own+' private');
     assert.match(listed,new RegExp('isolation '+own));assert.doesNotMatch(listed,new RegExp('isolation '+other));
     insideReadEvents.push(phase+':'+own+':'+entry.projectId);
     return entry;
   };
   inspect('entered');
   if(own==='A'){enteredA();await aRelease}else{enteredB();await bRelease}
   const entry=inspect('resumed');
   return {text:entry.content};
 }});
 const agentB={id:'b',session:{header:{cwd:'/projects/b'},append(){}}};
 const call=(agent,code)=>host.tools.execute({name:'run_code',arguments:{code,description:'scope barrier regression'},agent,callId:code,signal:new AbortController().signal});
 const pendingA=call(ptcAgent,'interleave-a');await aEntered;
 const pendingB=call(agentB,'interleave-b');await bEntered;
 releaseB();const resultB=await pendingB;releaseA();const resultA=await pendingA;
 for(const [result,own,other,cwd]of [[resultA,'A','B','/projects/a'],[resultB,'B','A','/projects/b']]){
  assert.equal(result.isError,false,JSON.stringify(result));assert.match(JSON.stringify(result.value),new RegExp('isolation '+own+' private'));assert.doesNotMatch(JSON.stringify(result),new RegExp('isolation '+other+' private'));assert.match(JSON.stringify(result.value),new RegExp(cwd));
 }
 assert.deepEqual(seenCwds.slice(-2),['/projects/a','/projects/b']);
 assert.deepEqual(insideReadEvents,['entered:A:/projects/a','entered:B:/projects/b','resumed:B:/projects/b','resumed:A:/projects/a']);
 assert.throws(()=>vault.list(),/TRUSTED_CONTEXT_REQUIRED/);
 const errorBlock=host.on('tools/post-execute',async(exec,result)=>{if(exec.name==='search_knowledge'){await tables.get('entries').put(saved.id,{...tables.get('entries').get(saved.id),projectId:'/projects/b',updatedAt:'error-revoked'});return {kind:'block',feedback:result.content,additionalContexts:[{role:'user',content:result.content}]}}return {kind:'accept'}});const errorLeaked=await host.tools.execute({name:'search_knowledge',arguments:{query:'shared'},agent:ptcAgent,callId:'error-leak',signal:new AbortController().signal});assert.equal(errorLeaked.isError,true);assert.doesNotMatch(JSON.stringify(errorLeaked),/shared updated/);errorBlock();await tables.get('entries').put(saved.id,{...tables.get('entries').get(saved.id),projectId:'/projects/a',updatedAt:'ptc-again'});
 const revokePtc=host.on('tools/post-execute',async(exec)=>{if(exec.name==='search_knowledge'){await Promise.resolve();await tables.get('entries').put(saved.id,{...tables.get('entries').get(saved.id),projectId:'/projects/b',updatedAt:'ptc-revoked'})}return {kind:'accept'}});
 const blockedPtc=await host.tools.execute({name:'run_code',arguments:{code:'binding fixture',description:'test revoked core bridge'},agent:ptcAgent,callId:'ptc-revoke',signal:new AbortController().signal});assert.equal(blockedPtc.isError,false);assert.match(JSON.stringify(blockedPtc.value),/denied/);assert.doesNotMatch(JSON.stringify(blockedPtc),/shared updated/);revokePtc();await bridge.dispose();
 await hostFiber.dispose();
})


test('inside-KV-await regression detects a synchronous ambient-context mutant',async()=>{


 const source=await readFile(new URL('../lib/access.js',import.meta.url),'utf8');
 assert.ok(source.includes('local=new AsyncLocalStorage()'));
 const mutant=source.replace('local=new AsyncLocalStorage()',`local={value:undefined,getStore(){return this.value},run(context,fn){const previous=this.value;this.value=context;try{return fn()}finally{this.value=previous}}}`);
 const {createAccess}=await import('data:text/javascript,'+encodeURIComponent(mutant));
 const access=createAccess(id=>({header:{cwd:'/projects/'+id}}));
 const a=access.forExecution({agent:{id:'a'}}),b=access.forExecution({agent:{id:'b'}});

 await Promise.resolve();assert.equal(access.run(a,()=>access.current().projectId),'/projects/a');
 await Promise.resolve();assert.equal(access.run(b,()=>access.current().projectId),'/projects/b');
 let enteredA,enteredB,releaseA,releaseB;
 const aEntered=new Promise(r=>{enteredA=r}),bEntered=new Promise(r=>{enteredB=r});
 const aRelease=new Promise(r=>{releaseA=r}),bRelease=new Promise(r=>{releaseB=r});
 const read=async(context,entered,release)=>access.run(context,async()=>{
   assert.equal(access.current().projectId,context.projectId);entered();await release;
   assert.equal(access.current().projectId,context.projectId);
 });
 const pendingA=read(a,enteredA,aRelease);await aEntered;
 const pendingB=read(b,enteredB,bRelease);await bEntered;
 const rejectedA=assert.rejects(pendingA,/TRUSTED_CONTEXT_REQUIRED/);
 const rejectedB=assert.rejects(pendingB,/TRUSTED_CONTEXT_REQUIRED/);
 releaseB();await rejectedB;releaseA();await rejectedA;
})
