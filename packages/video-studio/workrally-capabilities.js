// WorkRally catalogs are runtime declarations, never inferred vendor aliases.
export const WORKRALLY_ADAPTER='workrallyMcp',WORKRALLY_SERVER='workrally',WORKRALLY_ENDPOINT='https://workrally.qq.com/zenstudio/api/mcp';
export const isWorkrallyModel=id=>typeof id==='string'&&id.startsWith('mcp:workrally:');
export const isWorkrallyProfile=p=>p?.adapter===WORKRALLY_ADAPTER;
export function workrallyIdentity(value){
 const uid=value?.userInfo?.profile?.uid,corpId=value?.userInfo?.corp?.id;
 if(typeof uid!=='string'||!uid||typeof corpId!=='string'||typeof value.isEnterprise!=='boolean')throw Error('WorkRally 未返回可确认的用户及企业身份');
 if(uid.length>160||corpId.length>160)throw Error('WorkRally 身份标识无效');
 return {accountId:uid,corpId,isEnterprise:value.isEnterprise};
}
export function workrallyProfile(spec){return {adapter:WORKRALLY_ADAPTER,baseUrl:WORKRALLY_ENDPOINT,serverName:WORKRALLY_SERVER,modelName:spec.providerModel,tool:spec.kind==='image'?'canvas_generate_image':'canvas_generate_video',...spec.workrally.identity,mode:spec.workrally.mode};}
export function assertWorkrallyProfile(profile,spec){
 const expected=workrallyProfile(spec);
 for(const k of ['adapter','baseUrl','serverName','modelName','tool','accountId','corpId','isEnterprise','mode'])if(profile[k]!==expected[k])throw Error('WorkRally 模型、账号或企业身份不匹配，请重新获取模型');
 const clean={...expected};for(const k of ['canvasProjectId','shortSeriesProjectId'])if(profile[k]!==undefined){if(typeof profile[k]!=='string'||profile[k].length>160||/[\x00-\x1f]/.test(profile[k]))throw Error('WorkRally 项目标识无效');clean[k]=profile[k];}return clean;
}
const list=(v,name)=>{if(!Array.isArray(v)||v.length>200)throw Error('WorkRally 模型声明缺少 '+name);return v;};
const ratios=(row,fallback)=>list(row.aspect_ratios||fallback,'aspect_ratios').filter(x=>typeof x==='string'&&/^\d+:\d+$/.test(x));
const resolutions=row=>list(row.resolution_options||[],'resolution_options').map(x=>({value:Number(x.value),label:String(x.label)})).filter(x=>Number.isInteger(x.value)&&x.value>=1&&x.value<=8);
const positive=x=>Number.isInteger(x)&&x>=0&&x<=200?x:0;
function base(row,id,kind,identity,mode,raw,fallback){
 const options=resolutions(row),sizes=options.map(x=>String(x.value)),r=ratios(row,fallback);
 return {id,kind,adapter:WORKRALLY_ADAPTER,family:WORKRALLY_ADAPTER,providerModel:row.model_id||row.provider,displayName:'WorkRally · '+([row.name,row.label,row.display_name,row.displayName,row.alias].find(v=>typeof v==='string'&&v.trim()&&v!==String(row.model_id||row.provider))||'上游未提供名称（型号 ID：'+(row.model_id||row.provider)+'）'),ratios:r,sizes,durations:[],defaults:{aspectRatio:r[0]||'16:9',...(sizes.length?{resolution:sizes[0]}:{})},fields:{n:{values:[1]},quality:{values:['auto']}},hints:{strict_extra_fields:['enable_sound','canvasProjectId','shortSeriesProjectId']},minRefs:0,maxRefs:0,referenceKinds:[],referenceLimits:{image:0,video:0,audio:0},modeCapabilities:{},generationModes:[],mcp:{accountId:identity.accountId,tool:kind==='image'?'canvas_generate_image':'canvas_generate_video',available:true},workrally:{identity:{...identity},mode,resolutionOptions:options,declaration:structuredClone(raw),unsupportedCapabilities:[]},notes:['WorkRally 账号计费；提交前费用未知；每次仅生成1项，未知提交不会自动重试。']};
}
export function workrallySpecs({identity,image,video}){
 if(!identity?.accountId||!identity.corpId&&identity.isEnterprise)throw Error('WorkRally 目录缺少身份');const out=[];
 for(const row of list(image.models,'image.models')){
  if(typeof row.model_id!=='string'||!row.model_id)throw Error('WorkRally 图片型号无效');
  const s=base(row,'mcp:workrally:image:'+row.model_id,'image',identity,'image',row,image.aspect_ratios),max=positive(row.kontext_config?.max_input_images);
  s.hints.strict_extra_fields=['canvasProjectId','shortSeriesProjectId'];s.maxRefs=max;s.referenceLimits.image=max;s.referenceKinds=max?['image']:[];s.fields.quality.values=['auto',...list(row.infer_quality_options||[],'infer_quality_options').map(x=>x.value)];out.push(s);
 }
 const groups=[['text_providers','Text','文本/单图'],['first_last_frame_providers','FirstLastFrame','首尾帧'],['subject_to_video_providers','SubjectToVideo','全能参考']];
 for(const [key,mode,label]of groups)for(const row of list(video[key]||[],key)){
  if(typeof row.provider!=='string'||!row.provider)throw Error('WorkRally 视频型号无效');
  const s=base(row,'mcp:workrally:video:'+mode+':'+row.provider,'video',identity,mode,row,video.aspect_ratios||[]);s.displayName+=' · '+label;
  s.durations=list(row.duration_options,'duration_options').filter(x=>Number.isInteger(x)&&x>0&&x<=600);if(!s.durations.length)continue;s.defaults.duration=s.durations[0];
  const declared={image:row.can_upload_image?positive(row.max_image_count):0,video:row.can_upload_video?positive(row.max_video_count):0,audio:row.can_upload_audio?positive(row.max_audio_count):0};
  const limits=mode==='Text'?{image:Math.min(1,declared.image),video:0,audio:0}:mode==='FirstLastFrame'?{image:Math.min(2,declared.image),video:0,audio:0}:declared;
  const cap={limits,minReferences:mode==='SubjectToVideo'?1:0,maxReferences:mode==='SubjectToVideo'?Math.min(Object.values(limits).reduce((a,b)=>a+b,0),positive(row.max_file_count)||200):mode==='FirstLastFrame'?2:1};
  if(mode==='Text'){s.modeCapabilities.text={...cap,maxReferences:0,limits:{image:0,video:0,audio:0}};if(limits.image)s.modeCapabilities.first={...cap,minReferences:1,maxReferences:1};}
  else if(mode==='FirstLastFrame'){if(limits.image)s.modeCapabilities.first={...cap,minReferences:1,maxReferences:1};if(limits.image>=2)s.modeCapabilities.frames={...cap,minReferences:2,maxReferences:2};if(!limits.image){s.mcp.available=false;s.workrally.unsupportedCapabilities.push({capability:'FirstLastFrame',reason:'当前目录的图片输入开关或数量与首尾帧分组声明矛盾，暂不启用'});}}else s.modeCapabilities.reference=cap;
  for(const kind of ['video','audio'])if(limits[kind]){cap.mediaRules??={};const max=Number(row['max_'+kind+'_duration']);if(max>0)cap.mediaRules[kind]={maxDuration:max,totalDuration:max};}
  s.maxRefs=limits.image;s.minRefs=Object.keys(s.modeCapabilities).length?Math.min(...Object.values(s.modeCapabilities).map(x=>x.minReferences)):0;s.referenceLimits=limits;s.referenceKinds=Object.keys(limits).filter(k=>limits[k]);s.generationModes=Object.keys(s.modeCapabilities);s.advancedFields={...(row.support_audio?{enable_sound:{type:'boolean'}}:{}),canvasProjectId:{type:'string'},shortSeriesProjectId:{type:'string'}};
  s.workrally.unsupportedCapabilities.push(...(row.support_draft?[{capability:'draft',reason:'样片转正需原样片素材ID和参数继承；当前工坊尚未提供该流程'}]:[]),...(row.extend_duration_range?[{capability:'ExtendVideo',reason:'延长需源视频资产与独立时长范围，当前工坊尚未提供该流程'}]:[]));out.push(s);
 }
 for(const row of list(video.smart_edit_providers||[],'smart_edit_providers')){
  if(typeof row.provider!=='string'||!row.provider)throw Error('WorkRally 编辑型号无效');
  const s=base(row,'mcp:workrally:video:SmartEdit:'+row.provider,'video',identity,'SmartEdit',row,video.aspect_ratios||[]);
  const limits=Object.fromEntries(['image','video','audio'].map(kind=>[kind,row['can_upload_'+kind]?positive(row['max_'+kind+'_count']):0]));
  s.displayName+=' · 智能编辑';s.durations=[-1];s.defaults.duration=-1;s.promptOptionalWithMedia=true;
  s.modeCapabilities.edit={limits:{...limits,video:Math.max(1,limits.video+1)},minReferences:1,maxReferences:(positive(row.max_file_count)||200)+1,durationPolicy:'omit',requiredKinds:['video']};
  s.generationModes=['edit'];s.referenceLimits={...limits,video:limits.video+1};s.referenceKinds=Object.keys(s.referenceLimits).filter(k=>s.referenceLimits[k]);s.minRefs=1;s.maxRefs=limits.image;
  s.advancedFields={canvasProjectId:{type:'string'},shortSeriesProjectId:{type:'string'},sourceVideoId:{type:'string'},...(row.support_audio?{enable_sound:{type:'boolean'}}:{}),...(row.support_erase_subtitles?{enable_erase_subtitles:{type:'boolean',label:'抹除原视频字幕',modes:['edit']}}:{})};
  s.hints.strict_extra_fields=Object.keys(s.advancedFields);out.push(s);
 }
 // VideoEdit is a separate origin_video protocol, not an alias for SmartEdit.
 for(const row of video.video_edit_providers||[]){const s=base(row,'mcp:workrally:unsupported:video_edit_providers:'+row.provider,'video',identity,'video_edit_providers',row,video.aspect_ratios||[]);s.mcp.available=false;s.workrally.unsupportedCapabilities=[{capability:'video_edit_providers',reason:'当前模式需要独立原视频资产协议，尚未启用'}];out.push(s);}
 if(new Set(out.map(x=>x.id)).size!==out.length)throw Error('WorkRally 返回重复模型');return out;
}
