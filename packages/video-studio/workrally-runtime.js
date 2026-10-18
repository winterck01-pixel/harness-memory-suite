import {workrallySource,workrallyEditProblem} from './workrally-edit.js';
import {beginHostMcpPreparation,sealHostMcpPreparation} from './host-mcp-intent.js';
import {hostMcpDiagnosticCode} from './host-mcp-dispatch.js';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {createResultDownloader} from './result-download.js';
import {WORKRALLY_ADAPTER,WORKRALLY_SERVER,WORKRALLY_ENDPOINT,isWorkrallyProfile,workrallyIdentity,workrallySpecs} from './workrally-capabilities.js';
const prefix='mcp__'+WORKRALLY_SERVER+'__';
const allowed=new Set(['who_am_i','canvas_image_model_list','canvas_video_provider_config','get_upload_token','asset_create','asset_detail','canvas_generate_image','canvas_generate_video','canvas_get_task']);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\x00-\x1f\x7f]/.test(value)?value:undefined;
const failed=p=>p?.ok===false||p?.success===false||!!p?.error;
export function unpackWorkrally(result,{catalog=false,taskQuery=false}={}){
 const value=result?.value??result,rows=(value?.content||[]).filter(c=>c.type==='text').map(c=>{try{return JSON.parse(c.text)}catch{return null}}).filter(x=>x&&typeof x==='object'&&!Array.isArray(x));
 const structured=value?.structuredContent,payload=rows.length===1?rows[0]:!catalog&&structured&&structured.kind!=='model_form'?structured:null;
 const remoteId=id(payload?.task_id)||((payload?.task_ids?.length===1)?id(payload.task_ids[0]):undefined);
 if(result?.isError||value?.isError||!payload||(!taskQuery||![5,6].includes(Number(payload?.state)))&&(failed(payload)||failed(payload?.data)))throw Object.assign(Error('WorkRally 调用未返回有效成功结果；未自动重新提交'),{code:'WORKRALLY_CALL_FAILED',...(remoteId?{remoteId}:{})});
 if(catalog&&structured?.kind==='model_form'&&Array.isArray(structured.aspect_ratios)&&!payload.aspect_ratios)payload.aspect_ratios=structured.aspect_ratios;
 return payload;
}
function accountMatches(a,b){return ['accountId','corpId','isEnterprise'].every(k=>a[k]===b[k]);}
const identityKey=p=>JSON.stringify([p.accountId,p.corpId,p.isEnterprise]);
const safeUrl=value=>{let u;try{u=new URL(value)}catch{}if(!u||u.protocol!=='https:'||u.username||u.password)throw Error('WorkRally 未返回有效 HTTPS 素材地址');return u.href;};
// Tencent COS Request Signature: https://www.tencentcloud.com/document/product/436/7778
// STS keys are consumed transiently and never attached to tasks, errors or logs.
export function cosPutRequest(ticket,bytes,type,now=Date.now()){
 for(const k of ['tmp_secret_id','tmp_secret_key','tmp_token','bucket','region','key'])if(typeof ticket[k]!=='string'||!ticket[k]||/[\r\n]/.test(ticket[k]))throw Error('WorkRally COS 上传凭证无效');
 if(!/^[a-z0-9-]+-\d+$/.test(ticket.bucket)||!/^[-a-z0-9]+$/.test(ticket.region)||ticket.key.startsWith('/')||ticket.key.split('/').some(x=>x==='.'||x==='..'))throw Error('WorkRally COS 上传路径无效');
 const host=ticket.bucket+'.cos.'+ticket.region+'.myqcloud.com',pathname='/'+ticket.key.split('/').map(encodeURIComponent).join('/'),keyTime=Math.floor(now/1000-30)+';'+Math.floor(now/1000+300),encode=x=>encodeURIComponent(x).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 const headers={'content-type':type,host,'x-cos-security-token':ticket.tmp_token},keys=Object.keys(headers).sort(),headerString=keys.map(k=>encode(k)+'='+encode(headers[k])).join('&');
 const httpString='put\n'+'/'+ticket.key+'\n\n'+headerString+'\n',signKey=createHmac('sha1',ticket.tmp_secret_key).update(keyTime).digest('hex'),stringToSign='sha1\n'+keyTime+'\n'+createHash('sha1').update(httpString).digest('hex')+'\n',signature=createHmac('sha1',signKey).update(stringToSign).digest('hex');
 return {url:'https://'+host+pathname,options:{method:'PUT',body:bytes,redirect:'error',headers:{...headers,Authorization:'q-sign-algorithm=sha1&q-ak='+encode(ticket.tmp_secret_id)+'&q-sign-time='+keyTime+'&q-key-time='+keyTime+'&q-header-list='+keys.join(';')+'&q-url-param-list=&q-signature='+signature}}};
}
export function createWorkrallyRuntime({getTools,hostMcpDispatcher,privateMcpResultGate,fetchUpload=createResultDownloader({proxy:process.env.HTTPS_PROXY,method:'PUT'})}){
 async function call(name,args,signal,execution,options,hostIntent){
  if(!allowed.has(name)||!getTools()?.get(prefix+name))throw Object.assign(Error('WorkRally MCP 尚未连接或缺少所需工具'),{httpStatus:503});
  if(name==='get_upload_token'&&!privateMcpResultGate)throw Error('WorkRally 私有上传授权隔离不可用；参考素材上传已拒绝');
  const deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(60000)]);
  const tool=prefix+name;
  const invoke=async(activeExecution,dispatchedArgs=args,hostInput)=>{
   const callSignal=hostInput?.signal||(activeExecution?.signal?AbortSignal.any([deadline,activeExecution.signal]):deadline);
   if(name==='get_upload_token'){
    if(!privateMcpResultGate)throw Error('WorkRally 私有上传授权隔离不可用；参考素材上传已拒绝');
    const agent=activeExecution?.agent,parent=activeExecution?.token,permit=privateMcpResultGate.begin({tool,agent,parent,callId:hostInput?.callId});
    try{
     const publicResult=await getTools().execute({name:tool,arguments:dispatchedArgs,signal:callSignal,callId:permit.callId,...(activeExecution?{agent,parent,rootCallId:activeExecution.rootCallId}:{})});
     if(publicResult?.isError)throw Error('WorkRally 私有上传授权调用失败');
     const raw=privateMcpResultGate.take({callId:permit.callId,tool,agent,parent});
     if(!raw||raw.isError)throw Error('WorkRally 私有上传授权结果不可用');return raw;
    }catch{throw Error('WorkRally 私有上传授权调用失败；参考素材上传已拒绝');}
    finally{privateMcpResultGate.clear(permit.callId);}
   }
   return getTools().execute({name:tool,arguments:dispatchedArgs,signal:callSignal,callId:hostInput?.callId||'workshop-workrally-'+randomUUID(),...(activeExecution?{agent:activeExecution.agent,parent:activeExecution.token,rootCallId:activeExecution.rootCallId}:{})});
  };
  let result;
  try{result=!execution&&hostMcpDispatcher?await hostMcpDispatcher.dispatch({name:tool,arguments:args,signal:deadline,hostIntent,invoke:(hostExecution,input)=>invoke(hostExecution,input.arguments,input)}):await invoke(execution);}
  catch(error){const code=hostMcpDiagnosticCode(error);throw Object.assign(Error(name==='get_upload_token'?'WorkRally 私有上传授权调用失败；参考素材上传已拒绝':'WorkRally 工具调用中断；已提交请求不会自动重试'),code?{code}:{});}
  return unpackWorkrally(result,options);
 }
 async function identity(signal,execution){return workrallyIdentity(await call('who_am_i',{},signal,execution));}
 async function account(profile,signal,execution){const who=await identity(signal,execution);if(!accountMatches(who,profile))throw Object.assign(Error('WorkRally 账号或企业已切换；旧任务不会发送到其他身份'),{httpStatus:422});return who;}
 async function discover(signal,execution){const who=await identity(signal,execution),image=await call('canvas_image_model_list',{},signal,execution,{catalog:true}),video=await call('canvas_video_provider_config',{},signal,execution,{catalog:true});await account(who,signal,execution);return {identity:who,image,video};}
 async function upload(ref,read,profile,signal,execution,hostIntent){
  const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/quicktime':'mov','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/mp4':'mp4'}[ref.type];if(!ext)throw Error('WorkRally 不支持此参考素材格式');
  const bytes=Buffer.from(await read(ref));if(!bytes.length||bytes.length>50*1024*1024)throw Error('WorkRally 参考素材须小于50 MB');
  let ticket=await call('get_upload_token',{file_ext:ext,upload_type:ref.type.startsWith('image/')?200:210},signal,execution,undefined,hostIntent),plan=cosPutRequest(ticket,bytes,ref.type);const sourceUrl=plan.url,isPrivate=ticket.is_private;ticket=null;
  if(isPrivate&&!profile.shortSeriesProjectId)throw Error('私有参考素材需要明确的 WorkRally 短番项目ID；尚未上传');
  let response;try{response=await fetchUpload(plan.url,{...plan.options,signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(60000)])});}catch{throw Error('WorkRally 参考素材上传中断，生成尚未提交');}finally{plan=null;}
  const ok=response.ok;await response.body?.cancel();if(!ok)throw Error('WorkRally 参考素材上传失败，生成尚未提交');
  // asset_create can sign private media and supplies the asset ID required by video/audio references.
  const url=safeUrl(sourceUrl);if(!isPrivate&&ref.type.startsWith('image/'))return {url};
  if(!profile.shortSeriesProjectId)throw Error('远程媒资入库需要 WorkRally 短番项目ID；生成尚未提交');
  const created=await call('asset_create',{asset_url:url,asset_type:ref.type.split('/')[0],name:ref.name||'参考素材',project_id:profile.shortSeriesProjectId,...(ref.width?{width:ref.width}:{}),...(ref.height?{height:ref.height}:{}),...(ref.duration?{duration:ref.duration*1000}:{}),format:ext,file_size:bytes.length},signal,execution,undefined,hostIntent);
  const assetId=id(created.asset_id)||id(created.id)||id(created.asset?.id);if(!assetId)throw Error('WorkRally 参考素材未返回可确认的媒资ID；生成尚未提交');
  const mediaUrl=created.asset_details?.url||created.url;
  if(ref.type.startsWith('image/')&&!mediaUrl)throw Error('WorkRally 未返回可用私有图片地址；生成尚未提交');
  return {asset_id:assetId,...(mediaUrl?{url:safeUrl(mediaUrl)}:{})};
 }
 async function prepare(request,profile,refs,read,signal,execution,hostIntent){
  const host=!execution&&hostMcpDispatcher;if(host)beginHostMcpPreparation(hostIntent,{request,profile,refs});
  await account(profile,signal,execution);if((request.n??1)!==1)throw Error('WorkRally 每次仅生成1项');
  const isImage=profile.tool==='canvas_generate_image',catalog=await call(isImage?'canvas_image_model_list':'canvas_video_provider_config',{},signal,execution,{catalog:true});
  const rows=isImage?catalog.models:catalog[{Text:'text_providers',FirstLastFrame:'first_last_frame_providers',SubjectToVideo:'subject_to_video_providers',SmartEdit:'smart_edit_providers'}[profile.mode]];
  const row=rows?.find(x=>(x.model_id||x.provider)===profile.modelName);if(!row)throw Error('WorkRally 当前身份已不再开放该型号或模式，请重新获取模型');
  const smart=profile.mode==='SmartEdit',allRefs=refs;
  const extra=request.extra||{},allowedExtra=new Set([...(smart?['sourceVideoId','enable_erase_subtitles']:[]),...(isImage?[]:['enable_sound']),'canvasProjectId','shortSeriesProjectId']);if(Object.keys(extra).some(k=>!allowedExtra.has(k)))throw Error('WorkRally 未声明该高级参数');
  const projects={canvasProjectId:extra.canvasProjectId??profile.canvasProjectId,shortSeriesProjectId:extra.shortSeriesProjectId??profile.shortSeriesProjectId};for(const v of Object.values(projects))if(v!==undefined&&(typeof v!=='string'||v.length>160||/[\x00-\x1f]/.test(v)))throw Error('WorkRally 项目标识无效');
  let source;if(smart){const error=workrallyEditProblem({workrally:{declaration:row}},refs,request);if(error)throw Error(error);source=workrallySource(refs,extra);refs=refs.filter(r=>r!==source);}
  if(allRefs.some(r=>!r.type?.startsWith('image/'))&&!projects.shortSeriesProjectId)throw Error('音视频参考需明确设置 WorkRally 短番项目ID，以便关联远程媒资');
  const limits=isImage?{image:positive(row.kontext_config?.max_input_images),video:0,audio:0}:{image:profile.mode==='Text'?Math.min(1,row.can_upload_image?positive(row.max_image_count):0):profile.mode==='FirstLastFrame'?Math.min(2,row.can_upload_image?positive(row.max_image_count):0):row.can_upload_image?positive(row.max_image_count):0,video:['SubjectToVideo','SmartEdit'].includes(profile.mode)&&row.can_upload_video?positive(row.max_video_count):0,audio:['SubjectToVideo','SmartEdit'].includes(profile.mode)&&row.can_upload_audio?positive(row.max_audio_count):0};
  const counts={image:0,video:0,audio:0},durations={video:0,audio:0};for(const r of refs){const k=r.type?.split('/')[0];if(!(k in counts)||++counts[k]>limits[k])throw Error('WorkRally 参考素材超出当前模型类型或数量限制');if(k!=='image'&&(!Number.isFinite(r.duration)||r.duration<=0||row['max_'+k+'_duration']>0&&r.duration>row['max_'+k+'_duration']))throw Error('WorkRally 参考音视频时长无效');if(k!=='image')durations[k]+=r.duration;}for(const k of ['video','audio'])if(row['max_'+k+'_duration']>0&&durations[k]>row['max_'+k+'_duration']+0.001)throw Error('WorkRally 参考音视频总时长超限');
  if(!isImage&&refs.length>(row.max_file_count||200))throw Error('WorkRally 参考素材合计超过模型限制');if(profile.mode==='FirstLastFrame'&&refs.length!==(request.generationMode==='first'?1:2)||profile.mode==='SubjectToVideo'&&!refs.length)throw Error('WorkRally 当前模式缺少参考素材');
  const resolution=request.resolution?Number(request.resolution):undefined;if(resolution!==undefined&&!row.resolution_options?.some(x=>Number(x.value)===resolution))throw Error('WorkRally 清晰度已不再可用');if(isImage&&request.quality&&request.quality!=='auto'&&!row.infer_quality_options?.some(x=>x.value===request.quality))throw Error('WorkRally 推理质量已不再可用');if(!isImage&&!smart&&!row.duration_options?.includes(request.duration))throw Error('WorkRally 时长已不再可用');
  if(!isImage&&extra.enable_sound!==undefined&&(!row.support_audio||typeof extra.enable_sound!=='boolean'))throw Error('WorkRally 当前模型不支持该声音设置');if(!smart&&!request.prompt?.trim())throw Error('请填写 WorkRally 生成提示词');
  const allowedRatios=row.aspect_ratios||catalog.aspect_ratios;
  if(request.aspectRatio&&request.aspectRatio!=='auto'&&(!Array.isArray(allowedRatios)||!allowedRatios.includes(request.aspectRatio)))throw Error('WorkRally 当前模型不支持该画面比例');
  const sourceInput=smart?await upload(source,read,{...profile,...projects},signal,execution,hostIntent):null;
  const input=[];for(const ref of refs)input.push({...await upload(ref,read,{...profile,...projects},signal,execution,hostIntent),type:ref.type.split('/')[0],name:ref.name||'参考素材',...(ref.duration?{duration:ref.duration*1000}:{})});
  if((isImage||profile.mode==='FirstLastFrame'||profile.mode==='Text')&&input.some(x=>typeof x.url!=='string'))throw Error('WorkRally 缺少可用参考素材地址；生成尚未提交');
  const payload={model:profile.modelName,prompt:request.prompt||'',count:1,...(request.aspectRatio&&request.aspectRatio!=='auto'?{aspect_ratio:request.aspectRatio}:{}),...(resolution?{resolution}:{}),...(projects.canvasProjectId?{project_id:projects.canvasProjectId}:{}),...(projects.shortSeriesProjectId?{short_series_project_id:projects.shortSeriesProjectId}:{})};
  if(isImage){if(input.length)payload.input_images=input.map(x=>x.url);if(request.quality&&request.quality!=='auto')payload.quality=request.quality;}
  else{payload.mode=profile.mode;if(!smart)payload.duration=request.duration;if(row.support_audio)payload.enable_sound=extra.enable_sound??true;if(profile.mode==='Text'&&input[0])payload.single_image_url=input[0].url;if(profile.mode==='FirstLastFrame'){payload.first_frame_url=input[0].url;if(input[1])payload.last_frame_url=input[1].url;}if(['SubjectToVideo','SmartEdit'].includes(profile.mode)&&input.length)payload.reference_assets=input;if(smart){if(!sourceInput.asset_id)throw Error('编辑源视频未返回媒资 ID；生成尚未提交');payload.source_video={asset_id:sourceInput.asset_id,width:source.width,height:source.height,duration:source.duration*1000};if(extra.enable_erase_subtitles===true)payload.enable_erase_subtitles=true;}}
  if(host)sealHostMcpPreparation(hostIntent,{profile,tool:prefix+profile.tool,payload});
  return {hostIntent,adapter:WORKRALLY_ADAPTER,profile:{...profile,...projects},tool:profile.tool,payload,execution};
 }
 async function submit(prepared,signal){await account(prepared.profile,signal,prepared.execution);const p=await call(prepared.tool,prepared.payload,signal,prepared.execution,undefined,prepared.hostIntent);const ids=p.task_ids;if(!Array.isArray(ids)||ids.length!==1||!id(ids[0]))throw Object.assign(Error('WorkRally 提交未返回唯一任务ID；请核查原任务，未自动重新提交'),{code:'WORKRALLY_RECEIPT_UNKNOWN'});return {generationId:ids[0],status:'queued',works:[]};}
 async function query(task,signal){await account(task.config,signal);const project=task.extra?.shortSeriesProjectId??task.config.shortSeriesProjectId;const p=await call('canvas_get_task',{task_id:task.remoteId,...(project?{project_id:project}:{})},signal,undefined,{taskQuery:true});const taskId=id(p.task_id);if(taskId&&taskId!==task.remoteId)throw Error('WorkRally 返回了不同任务编号');const state=Number(p.state),kind=task.config.tool==='canvas_generate_image'?'image':'video';if(![1,2,3,4,5,6].includes(state))throw Error('WorkRally 未返回有效任务状态');let assets=p.output_assets||[];if(!Array.isArray(assets))throw Error('WorkRally 任务结果素材列表无效');if(state===4&&assets.length){const assetIds=assets.map(a=>id(a.asset_id)||id(a.id)).filter(Boolean);if(assetIds.length){const detail=await call('asset_detail',{asset_ids:assetIds},signal);const detailed=Array.isArray(detail.assets)?detail.assets:Array.isArray(detail.asset_list)?detail.asset_list:Array.isArray(detail.list)?detail.list:[];if(detailed.length)assets=assets.map(a=>{const full=detailed.find(d=>(d.asset_id||d.id)===(a.asset_id||a.id));return full?{...a,...full}:a;});}}
  return {generationId:task.remoteId,status:state===4?'completed':state===5?'failed':state===6?'cancelled':'polling',works:state===4?assets.map(a=>({contentType:kind,status:'completed',url:a.asset_details?.download_url||a.download_url||a.asset_details?.url||a.url,assetId:a.asset_id||a.id})).filter(a=>typeof a.url==='string'&&a.url.startsWith('https://')):[],...(state===3?{paused:true}:{}),...(state===5?{errorMessage:'WorkRally 任务失败，请查看原任务；未自动重新提交'}:{})};
 }
 return {status:()=>({installed:!!getTools()?.get(prefix+'canvas_image_model_list')&&!!getTools()?.get(prefix+'canvas_video_provider_config'),serverName:WORKRALLY_SERVER,endpoint:WORKRALLY_ENDPOINT}),identity,discover,prepare,submit,query,balance:async profile=>{await account(profile);return {account:{status:'unavailable',scope:'workrally',identity:'workrally:'+identityKey(profile),reason:'WorkRally MCP 未提供余额查询，余额未知'}};}};
}
const positive=x=>Number.isInteger(x)&&x>=0&&x<=200?x:0;
export async function readWorkrallyCatalog(root){try{const raw=await readFile(join(root,'workrally-models.json'),'utf8');if(raw.length>4*1024*1024)throw Error('WorkRally 模型缓存过大');const value=JSON.parse(raw);const fresh=workrallySpecs(value);return [...fresh,...(value.retired||[]).filter(s=>!(s.workrally?.mode==='smart_edit_providers'&&fresh.some(f=>f.workrally?.mode==='SmartEdit'&&f.providerModel===s.providerModel))).map(s=>({...s,mcp:{...s.mcp,available:false}}))];}catch(e){if(e.code==='ENOENT')return [];throw e;}}
export async function writeWorkrallyCatalog(root,value){const fresh=workrallySpecs(value),old=await readWorkrallyCatalog(root),retired=old.filter(s=>!fresh.some(f=>f.id===s.id));const json=JSON.stringify({...value,retired});if(Buffer.byteLength(json)>4*1024*1024)throw Error('WorkRally 模型缓存过大');await mkdir(root,{recursive:true,mode:0o700});const file=join(root,'workrally-models.json'),tmp=file+'.'+randomUUID();await writeFile(tmp,json,{mode:0o600});await rename(tmp,file);}
