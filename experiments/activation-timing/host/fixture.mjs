import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Context} from '@deepseek-ai/cordis';
import {SystemPrompt} from '@deepseek-ai/dsh-system-prompt';
import {ToolRuntime} from '@deepseek-ai/dsh-tools';
import {createScope,scopeTarget} from '@deepseek-ai/dsh-scope';
import {NodePtcRuntime} from './.local/node_modules/@deepseek-ai/dsh-ptc-runtime-node/lib/index.js';
import LocalSubprocess from './.local/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js';
import LocalFileSystem from './.local/node_modules/@deepseek-ai/dsh-fs-local/lib/index.js';
import LocalSandbox from './.local/node_modules/@deepseek-ai/dsh-sandbox-local/lib/index.js';
import * as policy from '../../../packages/context-policy/index.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
export async function contractManifest(){
 const paths={tools:new URL('../../../node_modules/@deepseek-ai/dsh-tools/lib/index.js',import.meta.url),policy:new URL('../../../packages/context-policy/policy.js',import.meta.url),policyAdapter:new URL('../../../packages/context-policy/index.js',import.meta.url),nodeRuntime:new URL('./.local/node_modules/@deepseek-ai/dsh-ptc-runtime-node/lib/index.js',import.meta.url)};
 const hashes=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([k,p])=>[k,hash(await readFile(p))])));
 return {hostVersion:'0.2.1-alpha.2',activationMode:'next-step',bindingMode:'per-run-snapshot',readiness:'assemble-then-new-run_code',sourceHashes:hashes,fingerprint:hash(JSON.stringify(hashes))};
}
export async function createHostFixture({targetName='fixture_probe',denyTarget=false,initiallyActive=false,userText='Complete the harmless fixture task.',taskId='fixture-task',sourceId=taskId,onEvent}={}){
 if(onEvent!==undefined&&typeof onEvent!=='function')throw Error('INVALID_EVENT_CALLBACK');
 if(!/^[a-z][a-z0-9_]{0,60}$/.test(targetName))throw Error('INVALID_FIXTURE_NAME');
 const cwd=await mkdtemp(join(tmpdir(),'activation-fixture-'));const ctx=new Context();const events=[];let captureFailure=null;let seq=0,step=0,calls=0,call=0,lastTargetCallId=null;const manifest=await contractManifest();
 const captureReady=()=>{if(captureFailure)throw captureFailure;};
 const emit=(type,fields={},payload={})=>{captureReady();const event={sourceId,seq:++seq,taskId,type,callId:fields.callId??`step-${step}`,step,tool:fields.tool??'run_code',contractFingerprint:manifest.fingerprint,payload};events.push(event);if(onEvent)try{const returned=onEvent(structuredClone(event));if(returned&&typeof returned.then==='function')throw Error('EVENT_CALLBACK_MUST_BE_SYNCHRONOUS');}catch(error){captureFailure=error instanceof Error?error:new Error(String(error));throw captureFailure;}return event;};
 const fibers=[];ctx.provide('workingDirectory',{ensure:async()=>cwd});
 // Explicit fixture deployment authority, separate from activation/availability.
 ctx.provide('sandboxPolicy',{defaultMode:'danger-full-access',resolve:()=>({mode:'danger-full-access',workspaceRoot:cwd})});
 fibers.push(await ctx.plugin(LocalFileSystem),await ctx.plugin(LocalSubprocess),await ctx.plugin(LocalSandbox,{runnerCommand:[],runnerFailureSignatures:[],probeTimeoutMs:1000}));
 class ObservedRuntime extends NodePtcRuntime {async run(spec){emit('binding-snapshot',{callId:`program-${call}`}, {names:Object.keys(spec.bindings[0].functions),isolation:this.isolation});return super.run(spec);}}
 fibers.push(await ctx.plugin(SystemPrompt,{}),await ctx.plugin(ObservedRuntime,{launch:{kind:'node-script',executable:process.execPath},timeoutMs:10000,maxTimeoutMs:10000,maxOutputBytes:65536,maxOldGenerationSizeMb:128,maxMessageBytes:1048576,maxPendingCalls:16,graceMs:300}),await ctx.plugin(ToolRuntime,{mode:'ptc'}));
 const tools=ctx.get('tools'),sp=ctx.get('systemPrompt');
 tools.register({name:targetName,description:'Return a fixed harmless fixture marker.',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute:()=>{calls++;return 'FIXTURE_OK';}});
 if(denyTarget)tools.guard(exec=>exec.name===targetName?'FIXTURE_PERMISSION_DENIED':undefined);
 fibers.push(await ctx.plugin(policy));
 const agent={id:taskId,session:{header:{cwd},append(){}}};const scope=createScope(ctx,agent);agent.ctx=scope.ctx;
 ctx.on('tools/execute',async(exec,next)=>{emit('action',{callId:exec.callId,tool:exec.name},{operation:exec.name==='activate_tool_group'?'activate':exec.name==='run_code'?'program':'invoke',arguments:exec.arguments,activationMode:'next-step'});return next();},{global:true});
 ctx.on('tools/result',(exec,result)=>{if(exec.name===targetName)lastTargetCallId=exec.callId;emit('result',{callId:exec.callId,tool:exec.name},{ok:!result.isError,result});},{global:true});
 ctx.emit(scopeTarget(ctx,agent),'agent/inbox/claimed',{agent,turn:1,message:{source:{kind:'user'},content:[{type:'text',text:userText}]}});
 async function assemble(){captureReady();step++;const a=await sp.assemble({agent,scope:agent});emit('assembly',{}, {transportNames:a.tools.map(t=>t.name)});const prompt=JSON.parse(JSON.stringify(a).replaceAll(cwd,'<FIXTURE_WORKSPACE>'));return {step,transportNames:a.tools.map(t=>t.name),contract:manifest,prompt};}
 async function run(code){captureReady();try{return await tools.execute({name:'run_code',arguments:{code,description:'Harmless activation contract fixture'},callId:`program-${++call}`,agent,signal:new AbortController().signal});}finally{captureReady();}}
 async function verify(){const passed=denyTarget?calls===0:calls>0;const value={passed,calls,claim:denyTarget?'permission-preserved':'fixture-marker-executed'};emit('verification',{callId:lastTargetCallId??`program-${call}`,tool:targetName},value);return value;}
 async function close(){await scope.dispose();for(const f of fibers.reverse())await f.dispose();await rm(cwd,{recursive:true,force:true});}
 try{await assemble();
 if(initiallyActive){await run(`return await tools.activate_tool_group({tools:[${JSON.stringify(targetName)}]});`);await assemble();}}catch(error){await close();throw error;}
 return {targetName,manifest,events,assemble,run,runCode:run,verify,get calls(){return calls;},close};
}
