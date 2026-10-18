import {randomUUID} from 'node:crypto';

const TOKEN_TOOL='mcp__workrally__get_upload_token';
const privateText='WorkRally private upload authorization acquired.';
const SHARED_GATE=Symbol.for('deepseek.video-studio.private-mcp-result-gate.v1');

// Keep the raw MCP ticket only between the around-dispatch hook and its single
// authorized adapter consumer. Public result values retain their shape, but all
// strings are replaced before ToolRuntime normalizes/renders/notifies them.
export function createPrivateMcpResultGate(ctx){
 if(!ctx||typeof ctx.on!=='function')throw new TypeError('Private MCP result gate requires a Cordis context');
 const root=ctx.root||ctx;let shared=root[SHARED_GATE];
 if(!shared){
  shared={leases:new Set(),pending:new Map(),dispose:null};
  Object.defineProperty(root,SHARED_GATE,{value:shared,configurable:true});
  // Own the shared listener at the root fiber so unloading whichever Studio
  // created the first lease cannot remove protection while another lease lives.
  shared.dispose=root.on('tools/execute',async(exec,next)=>{
  if(exec.name!==TOKEN_TOOL)return next();
  const entry=shared.pending.get(exec.callId);
  if(!entry||entry.claimed||entry.tool!==exec.name||entry.agent!==exec.agent||entry.agent===undefined&&entry.parent!==exec.parent)return {isError:true,error:{message:'Private WorkRally operation is not authorized'},content:[{type:'text',text:'Private WorkRally operation is not authorized.'}]};
  entry.claimed=true;
  let result;
  try{result=await next();}catch{return {isError:true,error:{message:'Private WorkRally operation failed'},content:[{type:'text',text:'Private WorkRally operation failed.'}]};}
  if(result?.isError){return {isError:true,error:{message:'Private WorkRally operation failed'},content:[{type:'text',text:'Private WorkRally operation failed.'}]};}
  entry.result=result;
  return {isError:false,value:scrub(result?.value),content:[{type:'text',text:privateText}]};
  });
 }
 const lease={};shared.leases.add(lease);let closed=false;
 function begin({tool,agent,parent,callId:boundCallId}){
  if(tool!==TOKEN_TOOL||!(agent&&typeof agent==='object'||agent===undefined&&typeof parent==='symbol'))throw Error('Private WorkRally upload authorization is unavailable');
  if(closed)throw Error('Private WorkRally upload authorization is unavailable');
  const callId=agent===undefined&&typeof boundCallId==='string'&&boundCallId?boundCallId:'workshop-private-'+randomUUID();if(shared.pending.has(callId))throw Error('Private WorkRally upload authorization is unavailable');shared.pending.set(callId,{tool,agent,...(agent===undefined?{parent}:{}),lease});return {callId};
 }
 function take({callId,tool,agent,parent}){
  const entry=shared.pending.get(callId);
  if(!entry||entry.lease!==lease||entry.tool!==tool||entry.agent!==agent||entry.agent===undefined&&entry.parent!==parent||!entry.result)return undefined;
  const result=entry.result;delete entry.result;return result;
 }
 function clear(callId){const entry=shared.pending.get(callId);if(entry?.lease===lease)shared.pending.delete(callId);}
 function close(){
  if(closed)return;closed=true;
  for(const [callId,entry]of shared.pending)if(entry.lease===lease)shared.pending.delete(callId);
  shared.leases.delete(lease);
  if(!shared.leases.size){shared.pending.clear();shared.dispose?.();if(root[SHARED_GATE]===shared)delete root[SHARED_GATE];}
 }
 return {begin,take,clear,close};
}

function scrub(value){
 if(typeof value==='string')return '[private]';
 if(Array.isArray(value))return value.map(scrub);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,scrub(item)]));
 return value;
}
