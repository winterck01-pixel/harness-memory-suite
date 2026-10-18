import {authorizeHostMcpIntentCall,failHostMcpIntent} from './host-mcp-intent.js';
import {randomUUID} from 'node:crypto';

const SHARED=Symbol.for('deepseek.workshop.host-mcp-dispatch.v1');
const WORKRALLY=['who_am_i','canvas_image_model_list','canvas_video_provider_config','get_upload_token','asset_create','asset_detail','canvas_generate_image','canvas_generate_video','canvas_get_task'];
const KLING=['who_am_i','query_tasks','file_upload','query_membership_and_credits','text_to_image','image_to_image','text_to_video','image_to_video','omni_ref_video','motion_control','element_list','element_get','motion_library_list'];
const ALLOWED=new Set([...WORKRALLY.map(n=>'mcp__workrally__'+n),...KLING.map(n=>'mcp__Plugin-DeepSeek-kling-ai__'+n)]);
const READ_ONLY=new Set([...['element_list','element_get','motion_library_list'].map(n=>'mcp__Plugin-DeepSeek-kling-ai__'+n),'mcp__workrally__asset_detail','mcp__workrally__who_am_i','mcp__workrally__canvas_image_model_list','mcp__workrally__canvas_video_provider_config','mcp__workrally__canvas_get_task','mcp__Plugin-DeepSeek-kling-ai__who_am_i','mcp__Plugin-DeepSeek-kling-ai__query_tasks','mcp__Plugin-DeepSeek-kling-ai__query_membership_and_credits']);
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);

// Guard-side verifier only. A model/tool argument cannot issue a permit. Both
// pre-execute and monotonic guard may recheck the exact same execution object.
function createVerifier(ctx,readonlyOnly){
 const root=ctx?.root||ctx;
 return exec=>{
  const shared=root?.[SHARED];if(!shared||!exec||exec.agent!==undefined||exec.signal?.aborted||typeof exec.token!=='symbol')return false;
  const entry=[...shared.pending.values()].find(row=>row.rootCallId===exec.rootCallId);
  if(!entry||!(READ_ONLY.has(entry.name)||!readonlyOnly&&entry.intentAuthorized)||entry.signal.aborted||!shared.leases.has(entry.lease))return false;
  const seen=entry.authorized;
  const once=phase=>{const prior=seen[phase];if(prior&&(prior.exec!==exec||prior.token!==exec.token||prior.signal!==exec.signal))return false;if(!prior)seen[phase]={exec,token:exec.token,signal:exec.signal};return true;};
  if(exec.callId===entry.rootCallId&&exec.name===entry.transport&&exec.parent===undefined&&exec.signal===entry.signal&&canonical(exec.arguments)===entry.transportArguments)return once('outer');
  if(entry.transport==='run_code'&&seen.outer&&typeof exec.parent==='symbol'&&exec.name===shared.name&&exec.parent===seen.outer.token&&exec.arguments?.permit===entry.permit&&Object.keys(exec.arguments).length===1){
   if(seen.helper&&seen.helper.signal!==exec.signal)return false;return once('helper');
  }
  const parent=entry.transport==='run_code'?seen.helper?.token:seen.outer?.token;
  if(parent&&exec.parent===parent&&exec.callId===entry.callId&&exec.name===entry.name&&exec.signal===entry.innerSignal&&canonical(exec.arguments)===entry.argumentFingerprint)return once('inner');
  return false;
 };
}
export const createHostMcpReadonlyVerifier=ctx=>createVerifier(ctx,true);
export const createHostMcpExecutionVerifier=ctx=>createVerifier(ctx,false);
const DIAGNOSTIC_CODES=new Set(['HOST_MCP_DISPATCH_FAILED','HOST_MCP_ENSURE_FAILED','HOST_MCP_RUNTIME_UNAVAILABLE','HOST_MCP_TRANSPORT_DENIED','HOST_MCP_TRANSPORT_FAILED','HOST_MCP_HELPER_UNAVAILABLE','HOST_MCP_INNER_FAILED','HOST_MCP_ABORTED','HOST_MCP_INTENT_REQUIRED']);
export const hostMcpDiagnosticCode=error=>DIAGNOSTIC_CODES.has(error?.code)?error.code:undefined;
const refused=(code='HOST_MCP_DISPATCH_FAILED')=>Object.assign(Error('工坊宿主 MCP 调度不可用；未自动重新提交'),{code:DIAGNOSTIC_CODES.has(code)?code:'HOST_MCP_DISPATCH_FAILED'});
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

// Only authenticated Studio routes/owned engines receive this in-process object.
// No code, endpoint, agent identity, parent token or MCP result is an argument
// or result of the helper. The public transport creates all execution tokens.
export function createHostMcpDispatcher(ctx){
 const root=ctx?.root||ctx;if(!root||typeof root.get!=='function')throw new TypeError('Host MCP dispatcher requires a Cordis context');
 let shared=root[SHARED];
 if(!shared){shared={leases:new Set(),pending:new Map(),tools:null,disposers:[],name:'workshop_host_mcp_'+randomUUID().replaceAll('-','')};Object.defineProperty(root,SHARED,{value:shared,configurable:true});}
 const lease={};shared.leases.add(lease);let closed=false;
 function ensure(){
  const tools=root.get('tools');if(!tools||typeof tools.execute!=='function'||typeof tools.register!=='function'||typeof tools.filterAvailability!=='function')throw refused();
  if(shared.tools===tools)return tools;
  for(const dispose of shared.disposers.splice(0))dispose();shared.tools=tools;
  const definition={name:shared.name,description:'Internal one-shot workshop host MCP transport',parameters:{type:'object',properties:{permit:{type:'string'}},required:['permit'],additionalProperties:false},output:{schema:{type:'object',properties:{completed:{type:'boolean'}},required:['completed'],additionalProperties:false},render:(_args,value)=>[{type:'text',text:value.completed?'completed':'failed'}]},async execute(args,execution){
   const entry=shared.pending.get(args.permit);
   if(!entry||entry.claimed||!shared.leases.has(entry.lease)||entry.signal.aborted||execution.signal.aborted||execution.agent!==undefined||execution.rootCallId!==entry.rootCallId||typeof execution.token!=='symbol')return {completed:false};
   entry.claimed=true;
   const signal=AbortSignal.any([entry.signal,execution.signal]);
   try{
    entry.innerSignal=signal;
    const input={name:entry.name,arguments:entry.arguments,signal,callId:entry.callId,parent:execution.token,rootCallId:execution.rootCallId};
    const result=entry.invoke?await entry.invoke({...execution,signal},input):await tools.execute(input);
    if(signal.aborted||shared.pending.get(args.permit)!==entry||!shared.leases.has(entry.lease))return {completed:false};
    entry.result=result;entry.hasResult=true;return {completed:true};
   }catch{entry.failed=true;return {completed:false};}
  }};
  // Read through root-owned contextual services: helper lifetime is independent
  // of which Studio created the first lease; neither Studio can replace policy.
  shared.disposers.push(tools.filterAvailability((name,_definition,agent)=>name!==shared.name||agent===undefined));
  try{shared.disposers.push(tools.register(definition));}catch(error){for(const dispose of shared.disposers.splice(0))dispose();shared.tools=null;throw error;}
  return tools;
 }
 async function dispatch({name,arguments:args,signal,callId='workshop-host-inner-'+randomUUID(),invoke,hostIntent}={}){
  if(closed||!ALLOWED.has(name)||!signal||typeof signal.throwIfAborted!=='function'||invoke!==undefined&&typeof invoke!=='function')throw refused();
  if(signal.aborted)throw refused('HOST_MCP_ABORTED');let tools;try{tools=ensure()}catch{throw refused('HOST_MCP_ENSURE_FAILED')}const rootCallId='workshop-host-'+randomUUID(),permit=randomUUID(),controller=new AbortController(),boundSignal=AbortSignal.any([signal,controller.signal]);
  const snapshot=freeze(JSON.parse(JSON.stringify(args??{})));const intentAuthorized=!READ_ONLY.has(name)&&authorizeHostMcpIntentCall(hostIntent,{name,arguments:snapshot});if(!READ_ONLY.has(name)&&!intentAuthorized)throw refused('HOST_MCP_INTENT_REQUIRED');const entry={lease,name,intentAuthorized,arguments:snapshot,argumentFingerprint:canonical(snapshot),signal:boundSignal,controller,callId,rootCallId,permit,authorized:{},invoke,claimed:false,hasResult:false};shared.pending.set(permit,entry);
  try{
   const mode=tools.modeFor(),transport=mode==='native'?shared.name:'run_code';let arguments_={permit};
   if(mode!=='native'){
    const runtime=root.get('ptcRuntime');if(!runtime||!['typescript','python'].includes(runtime.language))throw refused('HOST_MCP_RUNTIME_UNAVAILABLE');
    const call='tools.'+shared.name+'('+JSON.stringify({permit})+')';
    arguments_={description:'Dispatch one authorized workshop MCP operation',code:runtime.language==='python'?'await '+call:runtime.programFormat==='repl'?'await '+call:'return await '+call};
   }
   entry.transport=transport;entry.transportArguments=canonical(arguments_);
   let result;try{result=await tools.execute({name:transport,arguments:arguments_,signal:boundSignal,callId:rootCallId,rootCallId})}catch{throw refused(boundSignal.aborted?'HOST_MCP_ABORTED':'HOST_MCP_TRANSPORT_FAILED')}
   if(boundSignal.aborted)throw refused('HOST_MCP_ABORTED');
   if(entry.failed)throw refused('HOST_MCP_INNER_FAILED');
   if(result?.isError)throw refused('HOST_MCP_TRANSPORT_DENIED');
   if(!entry.claimed||!entry.hasResult)throw refused('HOST_MCP_HELPER_UNAVAILABLE');
   const raw=entry.result;delete entry.result;entry.hasResult=false;return raw;
  }catch(error){if(intentAuthorized)failHostMcpIntent(hostIntent);throw error;}finally{controller.abort('Host MCP dispatch settled');delete entry.result;shared.pending.delete(permit);}
 }
 function close(){if(closed)return;closed=true;for(const [key,entry]of shared.pending)if(entry.lease===lease){entry.controller.abort('Host MCP dispatcher closed');delete entry.result;shared.pending.delete(key);}shared.leases.delete(lease);if(!shared.leases.size){for(const dispose of shared.disposers.splice(0))dispose();shared.tools=null;if(root[SHARED]===shared)delete root[SHARED];}}
 return {dispatch,close};
}
