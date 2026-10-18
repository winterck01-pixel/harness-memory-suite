import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile,lstat,mkdir,writeFile,rename} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {authorizationUrl} from './kling-auth-core.js';
import {projectKlingConnector} from './kling-settings.js';
const ENTRY='include:kling-ai-remote';
function runAuthorization(entry,onChild){
 return new Promise((resolve,reject)=>{
  const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','MCP_REMOTE_CONFIG_DIR','TMPDIR','NODE_EXTRA_CA_CERTS','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
  const child=spawn(process.execPath,[entry.options.config.args[0]],{env:{...env,...entry.options.config.env,KLING_AUTH_ONLY:'1'},stdio:['pipe','ignore','ignore']});onChild(child);
  const timer=setTimeout(()=>child.kill('SIGKILL'),184000);
  child.once('error',()=>{clearTimeout(timer);reject(Error('AUTH_START_FAILED'))});
  child.once('exit',code=>{clearTimeout(timer);child.stdin?.destroy();code===0?resolve():reject(Error('AUTH_NOT_COMPLETED'))});
 });
}
export function createKlingAuth(ctx,{dir=join(homedir(),'.dsh','kling-auth'),now=Date.now,launch=runAuthorization,alive=pid=>{try{process.kill(pid,0);return true}catch{return false}}}={}){
 const path=join(dir,'status.json');let job=false,phase='',lastError='',startingFrom='',authChild,disposed=false;
 async function record(){try{const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)||st.size>32768)return null;return JSON.parse(await readFile(path,'utf8'))}catch{return null}}
 async function status(){
  const runtime=projectKlingConnector(ctx),r=await record();
  if(job&&phase==='connecting'&&(!r||r.id===startingFrom||r.status==='authorized'))return {status:'connecting'};
  if(job&&phase==='cancelling')return {status:phase};
  if(job&&phase==='starting'&&(!r||r.id===startingFrom))return {status:'starting'};
  if(runtime.runtimePhase==='active'&&runtime.toolReady&&!job)return {status:'connected'};
  if(lastError)return {status:'failed',error:lastError};
  if(r&&['expired','cancelled','denied','failed','disconnected'].includes(r.status))return {status:r.status};
  if(!runtime.enabled&&!job)return {status:'disabled'};
  if(!r||!Number.isSafeInteger(r.pid)||r.pid<=1||!alive(r.pid))return {status:'disconnected'};
  if(r.status==='waiting'&&r.expiresAt>now()){try{authorizationUrl(r.authorizationUrl);return {status:'waiting',expiresAt:r.expiresAt,authorizePath:'/api/remote-links/kling-auth/open'}}catch{return {status:'failed'}}}
  if(['connecting','connected'].includes(r.status))return {status:r.expiresAt>now()?'connecting':'expired'};
  return {status:['expired','cancelled','denied','failed','disconnected'].includes(r.status)?r.status:'expired'};
 }
 function manager(){const value=ctx.get?.('pluginManager');if(!value?.setPluginEnabled)throw Error('MANAGER_UNAVAILABLE');return value}
 async function cancelSignal(){const r=await record();if(r?.id){await mkdir(dir,{recursive:true,mode:0o700});const p=join(dir,'cancel.json');const tmp=p+'.'+randomUUID();await writeFile(tmp,JSON.stringify({id:r.id}),{mode:0o600});await rename(tmp,p)}}
 async function begin(action){
  if(disposed)throw Error('AUTH_DISPOSED');
  if(!['start','cancel'].includes(action))throw Error('INVALID_ACTION');
  const entry=[...ctx.loader.entries()].find(x=>x.id===ENTRY);
  if(!entry||entry.options.name!=='@deepseek-ai/dsh-mcp-client'||!entry.options.config?.args?.some(x=>typeof x==='string'&&x.endsWith('/kling-auth-bridge.mjs')))throw Error('BRIDGE_NOT_CONFIGURED');
  const m=manager();if(action==='cancel'){authChild?.kill('SIGTERM');await cancelSignal();if(job){phase='cancelling';const end=now()+181000;const t=setInterval(()=>{if(!job||now()>end){clearInterval(t);return}void cancelSignal().catch(()=>{})},250);t.unref?.();return {accepted:true}}}
  if(job)return {accepted:true};
  if(action==='start'&&(await status()).status==='waiting')return {accepted:true};
  startingFrom=(await record())?.id||'';job=true;phase=action==='start'?'starting':'cancelling';lastError='';
  void(async()=>{try{
   await cancelSignal();const off=await m.setPluginEnabled(ENTRY,false);if(off?.ok===false||[...ctx.loader.entries()].find(x=>x.id===ENTRY)?.disabled!==true)throw Error('DISABLE_FAILED');
   if(disposed||phase==='cancelling'||action==='cancel')return;
   await launch(entry,child=>{authChild=child});authChild=undefined;
   if(disposed||phase==='cancelling')return;phase='connecting';
   const on=await m.setPluginEnabled(ENTRY,true);if(on?.ok===false)throw Error('ENABLE_FAILED');
  }catch{const r=await record();lastError=phase==='cancelling'||['expired','cancelled','denied'].includes(r?.status)?'':'CONNECTION_FAILED'}finally{
   if(phase==='cancelling'&&[...ctx.loader.entries()].find(x=>x.id===ENTRY)?.disabled!==true){try{await m.setPluginEnabled(ENTRY,false);if([...ctx.loader.entries()].find(x=>x.id===ENTRY)?.disabled!==true)throw Error()}catch{lastError='CANCEL_FAILED'}}
   job=false;phase=''}})();
  return {accepted:true};
 }
 async function open(){if((await status()).status!=='waiting')throw Error('AUTH_NOT_WAITING');const r=await record();if(!r||r.expiresAt<=now())throw Error('AUTH_EXPIRED');return authorizationUrl(r.authorizationUrl).toString()}
 let operations=Promise.resolve();const action=value=>{const result=operations.catch(()=>{}).then(()=>begin(value));operations=result;return result};
 ctx.effect?.(()=>()=>{disposed=true;phase='cancelling';authChild?.kill('SIGTERM')});
 return {status,action,open};
}
export function klingAuthRoutes(service,connection){return ['status','start','cancel','open'].map(action=>({path:'/api/remote-links/kling-auth/'+action,methods:[['start','cancel'].includes(action)?'POST':'GET'],requestBody:'buffered',async fetch(req){
 const headers={'cache-control':'no-store','referrer-policy':'no-referrer'};
 try{
  const reject=connection.requestRejection({headers:Object.fromEntries(req.headers)});if(reject!==undefined)return Response.json({error:'ACCESS_DENIED'},{status:reject,headers});
  const site=req.headers.get('sec-fetch-site');if(site&&site!=='same-origin'&&site!=='none')return Response.json({error:'ORIGIN_REQUIRED'},{status:403,headers});
  const origin=req.headers.get('origin'),host=req.headers.get('host')||new URL(req.url).host;
  if(req.method==='POST'&&(!origin||new URL(origin).host!==host))return Response.json({error:'ORIGIN_REQUIRED'},{status:403,headers});
  if(action==='open')return new Response(null,{status:302,headers:{...headers,location:await service.open()}});
  return Response.json(action==='status'?await service.status():await service.action(action),{status:action==='status'?200:202,headers});
 }catch{return Response.json({error:'AUTH_UNAVAILABLE'},{status:409,headers})}
}}))}
