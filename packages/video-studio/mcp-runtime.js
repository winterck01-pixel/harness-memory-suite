import {parseElements,klingReferenceProblem,referenceMaxBytes} from './kling-reference-contract.js';
export {createHostMcpUiOrigin,createHostMcpIntent,closeHostMcpIntent} from './host-mcp-intent.js';
import {beginHostMcpPreparation,sealHostMcpPreparation} from './host-mcp-intent.js';
export {createHostMcpDispatcher} from './host-mcp-dispatch.js';
export {registerKlingLibraryRoutes} from './kling-library-routes.js';
export {registerWorkrallyRoutes} from './workrally-routes.js';
import {createWorkrallyRuntime,readWorkrallyCatalog,writeWorkrallyCatalog} from './workrally-runtime.js';
import {isWorkrallyProfile} from './workrally-capabilities.js';
export {readWorkrallyCatalog,writeWorkrallyCatalog} from './workrally-runtime.js';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {safeError} from './resilience.js';
import {randomUUID} from 'node:crypto';
import {createResultDownloader} from './result-download.js';
import {MCP_SERVER,MCP_ENDPOINT,argumentOf,inputKind,specsFromIdentity,declarationCaps} from './mcp-capabilities.js';
export {createPrivateMcpResultGate} from './private-mcp-result.js';
const prefix='mcp__'+MCP_SERVER+'__',allowed=new Set(['who_am_i','query_tasks','file_upload','query_membership_and_credits','text_to_image','image_to_image','text_to_video','image_to_video','omni_ref_video','motion_control','element_list','element_get','motion_library_list']);
// Carry only the task identifier across an error boundary, never the provider payload.
export function safeMcpGenerationId(value){return typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\x00-\x1f\x7f]/.test(value)?value:undefined;}
function failure(message,payload,code='MCP_BUSINESS_FAILED'){
 const candidates=[payload,payload?.body,payload?.data,payload?.error].flatMap(row=>[row?.generationId,row?.generation_id]).map(safeMcpGenerationId).filter(Boolean);
 const ids=[...new Set(candidates)];return Object.assign(Error(message),{code,...(ids.length===1?{remoteId:ids[0]}:{})});
}
const businessFailed=payload=>payload?.ok===false||payload?.success===false||!!payload?.error;
export function unpackMcp(result){
 const value=result?.value??result;
 let payload=value?.structuredContent;
 if(!payload){const rows=(value?.content||[]).filter(c=>c.type==='text').map(c=>{try{return JSON.parse(c.text)}catch{return null}}).filter(x=>x&&typeof x==='object');if(rows.length===1)payload=rows[0];}
 if(result?.isError||value?.isError)throw failure('可灵 MCP 调用失败：'+safeError({message:(value?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join(' ').slice(0,1000)||'请检查连接和授权；未自动重提'}),payload,'MCP_CALL_FAILED');
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('MCP 未返回唯一的结构化结果');
 if(businessFailed(payload)||businessFailed(payload.body))throw failure('可灵 MCP 返回业务失败；请核查原任务，未自动重提',payload);
 if(payload.ok===true&&payload.body)payload=payload.body;
 return payload;
}
let callTail=Promise.resolve(),lastCallAt=0;
function createKlingMcpRuntime({getTools,hostMcpDispatcher,fetchUpload=createResultDownloader({proxy:process.env.HTTPS_PROXY,method:'POST'})}){
 const status=()=>({installed:!!getTools()?.get(prefix+'who_am_i'),endpoint:MCP_ENDPOINT,serverName:MCP_SERVER});
 async function call(tool,args,signal,execution,hostIntent){
  if(!allowed.has(tool))throw Error('不支持的工坊 MCP 工具');
  const tools=getTools();if(!tools?.get(prefix+tool))throw Object.assign(Error('可灵 MCP 尚未连接，请先启用连接并完成账号授权'),{httpStatus:503});
  // Host calls use the public policy pipeline, never ToolDefinition.execute directly.
  const deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(60000)]);
  const invoke=callTail.catch(()=>{}).then(async()=>{const wait=Math.max(0,lastCallAt+260-Date.now());if(wait)await new Promise(resolve=>setTimeout(resolve,wait));deadline.throwIfAborted();lastCallAt=Date.now();return !execution&&hostMcpDispatcher?hostMcpDispatcher.dispatch({name:prefix+tool,arguments:args,signal:deadline,hostIntent}):tools.execute({name:prefix+tool,arguments:args,signal:deadline,callId:'workshop-mcp-'+randomUUID(),...(execution?{agent:execution.agent,parent:execution.token,rootCallId:execution.rootCallId}: {})});});
  callTail=invoke.then(()=>{},()=>{});const result=await invoke;
  return unpackMcp(result);
 }
 async function identity(signal,execution){const value=await call('who_am_i',{},signal,execution);specsFromIdentity(value);return value;}
 async function account(profile,signal,execution){const value=await identity(signal,execution);if(String(value.user.userId)!==profile.accountId)throw Object.assign(Error('可灵账号已切换；请恢复原账号，旧任务不会发往其他账号'),{httpStatus:422});return value;}
 async function upload(ref,read,signal,execution,hostIntent){
  signal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(60000)]);
  const bytes=Buffer.from(await read(ref));if(bytes.length>referenceMaxBytes(ref.type))throw Error('MCP 参考素材超过本地大小上限');
  const ticket=await call('file_upload',{filename:(ref.name||'reference').replace(/[\/\\\r\n]/g,'_'),contentType:ref.type,size:bytes.length},signal,execution,hostIntent);
  if(typeof ticket.ticket!=='string'||typeof ticket.uploadUrl!=='string'||!ticket.uploadUrl.startsWith('https://'))throw Error('MCP 未返回有效上传票据');
  const form=new FormData();form.append('ticket',ticket.ticket);form.append('file',new Blob([bytes],{type:ref.type}),ref.name||'reference');
  const response=await fetchUpload(ticket.uploadUrl,{body:form,signal});if(!response.ok){await response.body?.cancel();throw Error('MCP 素材上传失败，生成尚未提交');}
  const reader=response.body.getReader();let length=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1024*1024){await reader.cancel();throw Error('MCP 上传响应过大');}chunks.push(Buffer.from(value));}const text=Buffer.concat(chunks).toString('utf8');let body;try{body=JSON.parse(text)}catch{throw Error('MCP 上传未返回 JSON');}
  if(businessFailed(body)||businessFailed(body?.data)||['failed','failure','error','rejected'].includes(String(body?.status||body?.data?.status||'').toLowerCase()))throw Error('MCP 素材上传业务失败，生成尚未提交');
  const url=body.url||body.data?.url;if(typeof url!=='string'||!url.startsWith('https://'))throw Error('MCP 上传未返回公开素材地址');return url;
 }
 async function prepare(request,profile,refs,read,signal,execution,hostIntent){
  const host=!execution&&hostMcpDispatcher;if(host)beginHostMcpPreparation(hostIntent,{request,profile,refs});
  const who=await account(profile,signal,execution),spec=specsFromIdentity(who).find(s=>s.providerModel===profile.modelName&&s.mcp.tool===profile.tool);
  if(!spec)throw Object.assign(Error('当前可灵账号已不再开放该模型或生成方式，请重新获取模型'),{httpStatus:422});
  const declaration=spec.mcp.declaration,args=new Map(),set=(names,value)=>{if(value===undefined||value===null||value===''||value==='auto'||value==='adaptive')return;const a=argumentOf(declaration,names);if(!a)throw Error('当前 MCP 模型未声明参数：'+names[0]);args.set(a.name,String(value));};
  if(profile.tool==='motion_control')args.set('prompt',request.prompt??'');else set(['prompt'],request.prompt);if(argumentOf(declaration,['duration']))set(['duration'],request.duration);if(argumentOf(declaration,['aspect_ratio','aspectRatio']))set(['aspect_ratio','aspectRatio'],request.aspectRatio);set(['resolution','video_resolution','img_resolution','image_resolution'],request.resolution);
  const count=argumentOf(declaration,['imageCount','image_count','n']);if(count)args.set(count.name,'1');
  for(const [name,value]of Object.entries(request.extra||{})){if(name==='__mcpInputs'||name==='elements'&&value==='')continue;if(args.has(name)||['prompt','duration','aspect_ratio','aspectRatio','resolution','video_resolution','img_resolution','image_resolution','imageCount','image_count','n'].includes(name))throw Error('MCP 高级参数不能覆盖生成控件：'+name);if(!declaration.arguments.some(a=>a.name===name))throw Error('MCP 未声明高级参数：'+name);args.set(name,typeof value==='object'?JSON.stringify(value):String(value));}
  for(const a of declaration.arguments){if(!args.has(a.name)&&a.default!==undefined&&a.default!==null)args.set(a.name,typeof a.default==='object'?JSON.stringify(a.default):String(a.default));const value=args.get(a.name);if(a.required&&value===undefined)throw Error('请填写 MCP 必填参数：'+a.name);if(value!==undefined&&Array.isArray(a.allowedValues)&&!a.allowedValues.map(String).includes(value))throw Error('MCP 参数不在当前账号允许范围：'+a.name);}
  if(request.extra?.__mcpInputs!==undefined&&(!request.extra.__mcpInputs||typeof request.extra.__mcpInputs!=='object'||Array.isArray(request.extra.__mcpInputs)))throw Error('MCP 参考槽位绑定无效');
  const available=[...declaration.inputs],bindings=[];
  for(let index=0;index<refs.length;index++){
   const ref=refs[index],kind=ref.type?.split('/')[0];let input;
   if(request.extra?.__mcpInputs?.[ref.id])input=available.find(i=>i.name===request.extra.__mcpInputs[ref.id]);
   else if(request.generationMode==='frames')input=available.find(i=>index===0?/first/i.test(i.name):/tail|last/i.test(i.name));
   else if(request.generationMode==='first')input=available.find(i=>/first/i.test(i.name))||available.find(i=>inputKind(i)===kind&&!/tail|last/i.test(i.name));
   else input=available.find(i=>inputKind(i)===kind);
   if(!input||inputKind(input)!==kind)throw Error('MCP 缺少对应参考素材槽位，请检查生成方式和素材数量');
   available.splice(available.indexOf(input),1);bindings.push({ref,input});
  }
  if(available.some(i=>i.required))throw Error('MCP 必填参考槽位未绑定：'+available.filter(i=>i.required).map(i=>i.name).join('、'));
  for(const key of Object.keys(request.extra?.__mcpInputs||{}))if(!refs.some(r=>r.id===key))throw Error('MCP 槽位绑定包含已移除的参考素材');
  for(const cap of declarationCaps(declaration)){const matches=prefixes=>bindings.some(b=>prefixes.some(p=>b.input.name.startsWith(p)));if(cap.whenAnyInputPrefixes&&!matches(cap.whenAnyInputPrefixes))continue;if(cap.whenNoneInputPrefixes&&matches(cap.whenNoneInputPrefixes))continue;let total=bindings.filter(b=>(cap.inputPrefixes||[]).some(p=>b.input.name.startsWith(p))).length;for(const name of cap.arguments||[]){const value=args.get(name)??declaration.arguments.find(a=>a.name===name)?.default;if(value!==undefined){let list;try{list=typeof value==='string'?JSON.parse(value):value}catch{throw Error('MCP 合计限制参数须为 JSON 数组：'+name);}if(!Array.isArray(list))throw Error('MCP 合计限制参数须为数组：'+name);total+=list.length;}}if(total>cap.maxItems)throw Error('MCP 参考素材合计超过当前模型上限');}
  const hasVideo=bindings.some(b=>inputKind(b.input)==='video'),hasVisual=bindings.some(b=>['image','video'].includes(inputKind(b.input)));
  if(profile.tool==='omni_ref_video'&&profile.modelName==='kling-video-v3_0_omni'&&hasVideo){if(request.extra?.enable_audio!==undefined&&String(request.extra.enable_audio)==='true')throw Error('此模型有参考视频时须关闭生成新声音');args.set('enable_audio','false');}
  if(args.get('enable_audio')==='true'&&args.get('keepOriginalSound')==='true')throw Error('生成新声音与保留原声不能同时开启');
  const ratio=argumentOf(declaration,['aspect_ratio','aspectRatio']);if(ratio&&args.get(ratio.name)==='auto'&&!hasVisual){const concrete=ratio.allowedValues?.find(v=>v!=='auto');if(concrete)args.set(ratio.name,concrete);}
  const problem=klingReferenceProblem(spec,refs,request.extra||{});if(problem)throw Error(problem);
  const elements=parseElements(request.extra?.elements);
  for(const element of elements){
   const detail=await call('element_get',{id:element.id},signal,execution);
   const row=detail.element||detail.data||detail,resource=row.resource;
   if(String(row.id??'')!==element.id||!resource||!resource.video&&!resource.cover)throw Error('无法确认当前账号主体的类型，请重新选择主体');
   const type=resource.video?'video':'image';if(element.type&&element.type!==type)throw Error('主体实际类型与所选类型不一致');element.type=type;
  }
  if(elements.length){const confirmed={...request.extra,elements};const error=klingReferenceProblem(spec,refs,confirmed);if(error)throw Error(error);args.set('elements',JSON.stringify(elements.map(e=>declaration.elementSupport?e:{id:e.id,bindName:e.bindName})));}
  const inputs=[];for(const {ref,input}of bindings)inputs.push({name:input.name,inputType:'URL',url:await upload(ref,read,signal,execution,hostIntent)});
  const payload={model:profile.modelName,arguments:[...args].map(([name,value])=>({name,value})),inputs};
  // taskTraceId is optional and requires UUIDv7; do not repurpose a v4 idempotency key.
  if(host)sealHostMcpPreparation(hostIntent,{profile,tool:prefix+profile.tool,payload});
  return {tool:profile.tool,payload,accountId:profile.accountId,execution,hostIntent};
 }
 return {status,identity,library:async(tool,id,accountId,signal)=>{if(!['element_list','element_get','motion_library_list'].includes(tool))throw Error('不支持的参考库操作');await account({accountId},signal);if(tool==='element_get'&&(typeof id!=='string'||!/^\d{1,160}$/.test(id)))throw Error('主体 ID 无效');return call(tool,tool==='element_get'?{id}:{},signal)},prepare,submit:async(prepared,signal)=>{await account({accountId:prepared.accountId},signal,prepared.execution);return call(prepared.tool,prepared.payload,signal,prepared.execution,prepared.hostIntent)},query:async(task,signal)=>{await account(task.config,signal);return call('query_tasks',{generationId:task.remoteId},signal)},balance:async(profile,signal)=>{await account(profile,signal);const b=await call('query_membership_and_credits',{},signal);return {account:{status:Number.isFinite(b.availableRemainCredits)?'available':'unavailable',scope:'kling',identity:'kling-cn:'+profile.accountId,remainCredits:b.availableRemainCredits,reason:'可灵个人账号灵感值；不适用 ToAPIs 积分换算'}}}};
}
export async function readMcpCatalog(root){
 try{
  const raw=await readFile(join(root,'mcp-models.json'),'utf8');if(raw.length>2*1024*1024)throw Error('MCP 模型缓存过大');const value=JSON.parse(raw),fresh=specsFromIdentity(value.identity);
  const retired=(value.retired||[]).flatMap(old=>specsFromIdentity({user:{userId:old.mcp.accountId},availableModels:{[old.mcp.tool]:[old.mcp.declaration]}})).map(spec=>({...spec,mcp:{...spec.mcp,available:false}}));
  return [...retired.filter(s=>!fresh.some(f=>f.id===s.id)),...fresh];
 }catch(e){if(e.code==='ENOENT')return [];throw e;}
}
export async function writeMcpCatalog(root,identity){
 const fresh=specsFromIdentity(identity),old=await readMcpCatalog(root),retired=old.filter(s=>!fresh.some(f=>f.id===s.id));
 const data=JSON.stringify({identity:{user:{userId:identity.user.userId},availableModels:identity.availableModels},retired});if(Buffer.byteLength(data)>2*1024*1024)throw Error('MCP 模型声明超过缓存上限');
 await mkdir(root,{recursive:true,mode:0o700});const path=join(root,'mcp-models.json'),tmp=path+'.'+randomUUID();await writeFile(tmp,data,{mode:0o600});await rename(tmp,path);
}

// Route only by the immutable adapter snapshot; never fall through to another MCP provider.
export function createMcpRuntime(options){
 const kling=createKlingMcpRuntime(options),workrally=createWorkrallyRuntime(options);
 return {...kling,workrally,prepare:(request,profile,...args)=>isWorkrallyProfile(profile)?workrally.prepare(request,profile,...args):kling.prepare(request,profile,...args),submit:(prepared,...args)=>prepared.adapter==='workrallyMcp'?workrally.submit(prepared,...args):kling.submit(prepared,...args),query:(task,...args)=>isWorkrallyProfile(task.config)?workrally.query(task,...args):kling.query(task,...args),balance:(profile,...args)=>isWorkrallyProfile(profile)?workrally.balance(profile,...args):kling.balance(profile,...args)};
}
