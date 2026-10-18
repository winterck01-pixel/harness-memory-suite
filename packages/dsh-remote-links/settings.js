import {homedir} from 'node:os';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export const CONFIG_PATH=process.env.DSH_REMOTE_CONNECTIONS_PATH||join(homedir(),'.dsh','remote-connections.json');
const MODULE='@deepseek-ai/dsh-mcp-client';
const IDS={workrally:'include:workrally-mcp',baidu:'include:mcp-baidu-netdisk',upload:'include:mcp-baidu-netdisk-upload'};
const fingerprint=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const problem=(code,status=400)=>Object.assign(new Error(code),{code,status});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function exact(v,keys){if(!object(v)||Object.keys(v).some(k=>!keys.includes(k)))throw problem('INVALID_BODY');}
function text(v,max=8192){if(typeof v!=='string'||v.length>max)throw problem('INVALID_BODY');return v.trim();}
function endpoint(value,host,path){let url;try{url=new URL(value)}catch{throw problem('INVALID_URL')}
 if(url.protocol!=='https:'||url.hostname!==host||url.username||url.password||url.port||url.hash||(path&&url.pathname!==path))throw problem('INVALID_URL');
 return url;
}
function validateBaidu(value){const url=endpoint(value,'mcp-pan.baidu.com','/sse');if(!url.searchParams.get('access_token'))throw problem('TOKEN_REQUIRED');}
function currentEntry(ctx,id,serverName){const e=[...ctx.loader.entries()].find(e=>e.id===id);if(!e||e.options.name!==MODULE||e.options.config?.serverName!==serverName)throw problem('ENTRY_UNAVAILABLE',409);return e;}
function baiduEntry(ctx,upload=false){const e=currentEntry(ctx,upload?IDS.upload:IDS.baidu,upload?'baidu-netdisk-upload':'baidu-netdisk');if(e.options.config.transport!=='stdio'||e.options.config.command!==(upload?join(homedir(),'.dsh','mcp','baidu-netdisk-upload.py'):join(homedir(),'.dsh','mcp','baidu-netdisk-guarded-bridge.py')))throw problem('ENTRY_UNAVAILABLE',409);return e;}
function dynamicHeaders(c){return object(c.headers)&&Object.hasOwn(c.headers,'__jsExpr');}
function active(e){return !e.disabled&&e.fiber?.state===2;}
function editable(ctx,e){return active(e)&&!!ctx.configEditor;}
function safeHeaders(config){return Object.keys(dynamicHeaders(config)?{}:config.headers??{}).map(name=>({name,configured:true}));}
const PHASES={0:'pending',1:'loading',2:'active',3:'failed',4:'disposed',5:'unloading'};
export function projectBaiduConnector(ctx,c){
 try{const entries=[baiduEntry(ctx),...(c.upload?.enabled?[baiduEntry(ctx,true)]:[])];const runtimePhase=!c.enabled||entries.some(e=>e.disabled)?'disabled':entries.every(active)?'active':PHASES[entries.find(e=>!active(e))?.fiber?.state]||'pending';return {enabled:c.enabled===true&&entries.every(e=>!e.disabled),runtimePhase};}
 catch{return {enabled:false,runtimePhase:'mismatch'};}
}
export function createSettings(ctx,{path=CONFIG_PATH,writeFileAtomic,withFileLock}={}) {
 let tail=Promise.resolve();
 const serial=fn=>{const job=tail.catch(()=>{}).then(fn);tail=job;return job;};
 const doc=async()=>JSON.parse(await readFile(path,'utf8'));
 const baidu=async()=>{const value=await doc(),c=value.connections?.['baidu-netdisk'];if(!c)throw problem('CONFIG_UNAVAILABLE',503);return {value,c};};
 const wrRevision=e=>fingerprint({config:e.options.config,disabled:e.disabled});
 async function describe(id){
  if(id==='baidu-netdisk'){
   const {c}=await baidu(),runtime=projectBaiduConnector(ctx,c),ready=runtime.runtimePhase==='active';
   return {id,revision:fingerprint(c),credentialConfigured:!!c.endpoint?.sseUrl,endpointHost:'mcp-pan.baidu.com',editable:ready&&c.enabled===true,...runtime,uploadEnabled:c.upload?.enabled===true};
  }
  if(id==='workrally'){
   const e=currentEntry(ctx,IDS.workrally,'workrally'),c=e.options.config;
   return {id,revision:wrRevision(e),credentialConfigured:!!c.url,endpointHost:'workrally.qq.com',headers:safeHeaders(c),editable:editable(ctx,e)&&c.transport==='streamable-http',headersDynamic:dynamicHeaders(c),urlManaged:typeof c.url!=='string',enabled:!e.disabled};
  }
  throw problem('UNKNOWN_CONNECTOR',404);
 }
 async function saveBaidu(body){
  exact(body,['revision','authorizationUrl']);const value=text(body.authorizationUrl);if(value)validateBaidu(value);
  let changed=false,applyStatus='unchanged';
  const run=()=>withFileLock(path,async()=>{
   const {value:document,c}=await baidu();if(body.revision!==fingerprint(c))throw problem('CONFIG_CHANGED',409);
   if(!value||value===c.endpoint?.sseUrl)return;
   const targets=[baiduEntry(ctx),...(c.upload?.enabled?[baiduEntry(ctx,true)]:[])];
   if(!c.enabled||targets.some(e=>!active(e)))throw problem('ENTRY_INACTIVE',409);
   const next=structuredClone(document);next.connections['baidu-netdisk'].endpoint={...c.endpoint,sseUrl:value};next.updatedAt=new Date().toISOString();
   // Preserve all unrelated providers and make a private recovery copy before replacing credentials.
   await writeFileAtomic(path+'.before-settings.json',JSON.stringify(document,null,2)+'\n',{mode:0o600});
   await writeFileAtomic(path,JSON.stringify(next,null,2)+'\n',{mode:0o600});changed=true;
   applyStatus='applied';
   for(const e of targets){try{await e.fiber.restart();if(!active(e))applyStatus='pending'}catch{applyStatus='pending'}}
  });
  const hmr=ctx.get?.('hmr');await (hmr?hmr.runExclusive(run):run());
  return {saved:true,changed,applyStatus,settings:await describe('baidu-netdisk')};
 }
 async function saveWorkrally(body){
  exact(body,['revision','url','headers','replaceHeaders']);if(body.replaceHeaders!==undefined&&typeof body.replaceHeaders!=='boolean')throw problem('INVALID_BODY');const url=text(body.url);if(url)endpoint(url,'workrally.qq.com');
  if(!Array.isArray(body.headers)||body.headers.length>24)throw problem('INVALID_HEADERS');
  const seen=new Set();const edits=body.headers.map(item=>{
   exact(item,['name','value','remove']);const name=text(item.name,128),value=text(item.value);if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)||/[\r\n]/.test(item.value)||typeof item.remove!=='boolean')throw problem('INVALID_HEADERS');
   const key=name.toLowerCase();if(seen.has(key)||(value&&!item.remove&&['host','content-length','connection','transfer-encoding','cookie','__proto__','constructor','prototype'].includes(key)))throw problem('INVALID_HEADERS');seen.add(key);return {name,value,remove:item.remove};
  });
  const entry=currentEntry(ctx,IDS.workrally,'workrally');if(!editable(ctx,entry))throw problem('ENTRY_INACTIVE',409);
  if(body.revision!==wrRevision(entry))throw problem('CONFIG_CHANGED',409);
  let changed=false;
  const update=current=>{
   if(fingerprint({config:current,disabled:entry.disabled})!==body.revision)throw problem('CONFIG_CHANGED',409);
   if(dynamicHeaders(current)&&!body.replaceHeaders&&edits.some(e=>e.value||e.remove))throw problem('ADVANCED_HEADERS',409);
   if(current.transport!=='streamable-http')throw problem('ENTRY_UNAVAILABLE',409);
   const next=structuredClone(current);if(url)next.url=url;if(body.replaceHeaders)next.headers={};
   for(const edit of edits){
    const key=Object.keys(next.headers??{}).find(k=>k.toLowerCase()===edit.name.toLowerCase());
    if(edit.remove){if(key)delete next.headers[key];continue;}
    if(!edit.value)continue; // Empty inputs always preserve credentials, never persist a mask.
    next.headers??={};if(key&&key!==edit.name)delete next.headers[key];next.headers[edit.name]=edit.value;
   }
   changed=!isDeepStrictEqual(current,next);return next;
  };
  // Avoid a no-op profile write or reconnection. Recheck inside the editor's locked callback.
  update(structuredClone(entry.options.config));
  if(changed)await ctx.configEditor.edit(entry,update);
  return {saved:true,changed,applyStatus:changed?(active(currentEntry(ctx,IDS.workrally,'workrally'))?'applied':'pending'):'unchanged',settings:await describe('workrally')};
 }
 return {describe,save:(id,body)=>serial(()=>id==='baidu-netdisk'?saveBaidu(body):id==='workrally'?saveWorkrally(body):Promise.reject(problem('UNKNOWN_CONNECTOR',404)))};
}
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
async function requestJson(request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw problem('JSON_REQUIRED',415);
 const reader=request.body?.getReader();if(!reader)throw problem('INVALID_BODY');let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw problem('BODY_TOO_LARGE',413)}chunks.push(value)}}finally{reader.releaseLock()}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw problem('INVALID_BODY')}
}
export function settingsRoutes(service,connection){return ['baidu-netdisk','workrally'].flatMap(id=>['GET','POST'].map(method=>({path:'/api/remote-links/settings/'+id+(method==='POST'?'/save':''),methods:[method],requestBody:method==='GET'?'buffered':'streaming',async fetch(request){
 try{
  const rejection=connection.requestRejection({headers:Object.fromEntries(request.headers)});if(rejection!==undefined)return json({error:'ACCESS_DENIED'},rejection);
  const site=request.headers.get('sec-fetch-site');if(site&&site!=='same-origin'&&site!=='none')throw problem('ORIGIN_REQUIRED',403);
  if(request.method==='GET')return json(await service.describe(id));
  const origin=request.headers.get('origin');if(!origin||new URL(origin).host!==(request.headers.get('host')||new URL(request.url).host))throw problem('ORIGIN_REQUIRED',403);
  return json(await service.save(id,await requestJson(request)));
 }catch(e){const codes=['ADVANCED_HEADERS','INVALID_BODY','INVALID_URL','TOKEN_REQUIRED','CONFIG_CHANGED','ENTRY_INACTIVE','ENTRY_UNAVAILABLE','INVALID_HEADERS','UNKNOWN_CONNECTOR','CONFIG_UNAVAILABLE','ORIGIN_REQUIRED','JSON_REQUIRED','BODY_TOO_LARGE'];return json({error:codes.includes(e.code)?e.code:'SAVE_FAILED'},codes.includes(e.code)?(e.status||400):503)}
}})));}
