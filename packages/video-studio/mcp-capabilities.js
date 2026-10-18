import {WORKRALLY_ADAPTER,isWorkrallyModel,isWorkrallyProfile,workrallyProfile,assertWorkrallyProfile} from './workrally-capabilities.js';
export {WORKRALLY_ADAPTER,isWorkrallyModel,isWorkrallyProfile} from './workrally-capabilities.js';
// Runtime declarations are the sole model source. No rollout model IDs are assumed.
export const MCP_ADAPTER='klingMcp',MCP_SERVER='Plugin-DeepSeek-kling-ai',MCP_ENDPOINT='https://klingai.com/mcp';
const tools={text_to_image:['image','文生图'],image_to_image:['image','参考图生图'],text_to_video:['video','文生视频'],image_to_video:['video','关键帧'],omni_ref_video:['video','全能参考'],motion_control:['video','动作控制']};
export const isMcpModel=id=>typeof id==='string'&&(id.startsWith('mcp:cn:')||isWorkrallyModel(id));
export const isMcpProfile=p=>(p?.adapter===MCP_ADAPTER||isWorkrallyProfile(p));
export function mcpProfile(spec){if(spec?.adapter===WORKRALLY_ADAPTER)return workrallyProfile(spec);return {adapter:MCP_ADAPTER,baseUrl:MCP_ENDPOINT,serverName:MCP_SERVER,modelName:spec.providerModel,accountId:spec.mcp.accountId,tool:spec.mcp.tool};}
export function assertMcpProfile(profile,spec){
 if(spec?.adapter===WORKRALLY_ADAPTER)return assertWorkrallyProfile(profile,spec);
 if(!spec?.mcp||profile.adapter!==MCP_ADAPTER||profile.baseUrl!==MCP_ENDPOINT||profile.serverName!==MCP_SERVER||profile.modelName!==spec.providerModel||profile.tool!==spec.mcp.tool||typeof profile.accountId!=='string'||!profile.accountId)throw Error('MCP 模型、账号或连接配置不匹配，请重新获取模型');
 return {...mcpProfile(spec),accountId:profile.accountId};
}
export function inputKind(input){const name=input.name||'';if(/video/i.test(name))return 'video';if(/audio|voice/i.test(name))return 'audio';if(/image|frame|^input$|^input_\d+$/.test(name))return 'image';return null;}
export function argumentOf(declaration,names){return (declaration.arguments||[]).find(a=>names.includes(a.name));}
const values=a=>Array.isArray(a?.allowedValues)?a.allowedValues.map(String):a?.default!==undefined?[String(a.default)]:[];
export function modelDeclarations(value){
 if(value===undefined||value===null)return [];
 if(Array.isArray(value))return value;
 if(typeof value!=='object'||Array.isArray(value.models)===false||Object.keys(value).some(key=>!['models','defaultModel'].includes(key))||(value.defaultModel!==undefined&&(typeof value.defaultModel!=='string'||!value.models.some(d=>d?.model===value.defaultModel))))throw Error('MCP 模型声明格式无效');
 return value.models;
}
export function declarationCaps(declaration){
 if(declaration.combinedItemCaps!==undefined&&!Array.isArray(declaration.combinedItemCaps))throw Error('MCP 条件合计声明无效');
 const caps=[...(declaration.combinedItemCap?[declaration.combinedItemCap]:[]),...(declaration.combinedItemCaps??[])];
 if(caps.length>20)throw Error('MCP 合计声明超过上限');
 for(const cap of caps){
  if(!cap||typeof cap!=='object'||!Number.isInteger(cap.maxItems)||cap.maxItems<0||Object.keys(cap).some(k=>!['maxItems','arguments','inputPrefixes','whenAnyInputPrefixes','whenNoneInputPrefixes'].includes(k)))throw Error('MCP 合计数量声明无效');
  for(const key of ['arguments','inputPrefixes','whenAnyInputPrefixes','whenNoneInputPrefixes'])if(cap[key]!==undefined&&(!Array.isArray(cap[key])||cap[key].length>100||cap[key].some(v=>typeof v!=='string'||!v||v.length>100)))throw Error('MCP 合计数量条件无效');
 }
 return caps;
}
export function specsFromIdentity(identity){
 if(typeof identity.user?.userId==='number'&&!Number.isSafeInteger(identity.user.userId))throw Error('MCP 账号标识超过安全整数范围，无法确认账号身份');const accountId=String(identity.user?.userId??'');if(accountId.length>160)throw Error('MCP 账号标识过长');if(!accountId||!identity.availableModels||typeof identity.availableModels!=='object')throw Error('MCP 未返回账号和可用模型声明');
 const output=[];
 for(const [tool,[kind,label]]of Object.entries(tools)){
  const declarations=modelDeclarations(identity.availableModels[tool]);if(declarations.length>100)throw Error('MCP 型号数量超过上限');if(!Array.isArray(declarations))throw Error('MCP 模型声明格式无效');
  for(const declaration of declarations){
   if(!declaration||typeof declaration.model!=='string'||!Array.isArray(declaration.arguments)||!Array.isArray(declaration.inputs))throw Error('MCP 模型声明缺少型号、参数或输入槽位');
   if(declaration.model.length>70||declaration.arguments.length>100||declaration.inputs.length>100)throw Error('MCP 模型声明超过处理上限');
   for(const entries of [declaration.arguments,declaration.inputs])if(entries.some(a=>typeof a.name!=='string'||!a.name||a.name.length>100)||new Set(entries.map(a=>a.name)).size!==entries.length)throw Error('MCP 声明包含无效或重复字段');
   const id='mcp:cn:'+tool+':'+declaration.model;
   const duration=argumentOf(declaration,['duration']),ratio=argumentOf(declaration,['aspect_ratio','aspectRatio']),resolution=argumentOf(declaration,['resolution','video_resolution','img_resolution','image_resolution']);
   const durations=values(duration).filter(v=>/^\d+$/.test(v)).map(Number),ratios=values(ratio),sizes=values(resolution);
   const limits={image:0,video:0,audio:0};for(const input of declaration.inputs){const k=inputKind(input);if(k)limits[k]++;}
   declarationCaps(declaration);
   const required=declaration.inputs.filter(i=>i.required===true).length,cap={limits,minReferences:required,maxReferences:declaration.inputs.length,...(!ratio?{ratioPolicy:'omit'}:{})};
   if(declaration.combinedItemCap?.maxItems!==undefined)cap.maxReferences=Math.min(cap.maxReferences,declaration.combinedItemCap.maxItems);
   if(tool==='motion_control')durations.push(-1);
   const modeCapabilities=tool==='motion_control'?{motion:{...cap,durationPolicy:'omit',requiredKinds:['image']}}:tool==='text_to_video'?{text:cap}:tool==='omni_ref_video'?{reference:cap}:tool==='image_to_video'?{
    ...(limits.image>0&&required<=1&&!declaration.inputs.some(i=>i.required&&/tail|last/i.test(i.name))?{first:{...cap,maxReferences:1,limits:{image:1}}}:{}),
    ...(declaration.inputs.some(i=>/tail|last/i.test(i.name))&&limits.image>=2?{frames:{...cap,minReferences:Math.max(2,required),maxReferences:2,limits:{image:2}}}:{}),
    ...(limits.image>2?{reference:cap}:{})
   }:{};
   const defaults={...(tool==='motion_control'?{duration:-1}:{}),...(duration?.default!==undefined?{duration:Number(duration.default)}:{}),...(ratio?.default!==undefined?{aspectRatio:String(ratio.default)}:{}),...(resolution?.default!==undefined?{resolution:String(resolution.default)}:{})};
   const spec={id,kind,adapter:MCP_ADAPTER,family:'klingMcp',providerModel:declaration.model,displayName:'可灵 MCP · '+(declaration.alias||declaration.model)+' · '+label,ratios,sizes,durations,defaults,fields:{n:{values:[1]},quality:{values:['auto']}},hints:{strict_extra_fields:[]},minRefs:required,maxRefs:limits.image,referenceLimits:limits,referenceKinds:Object.entries(limits).filter(([,n])=>n>0).map(([kind])=>kind),modeCapabilities,generationModes:Object.keys(modeCapabilities),promptOptionalWithMedia:tool==='motion_control'||!argumentOf(declaration,['prompt'])?.required,mcp:{accountId,tool,available:true,declaration:structuredClone(declaration)},notes:['使用可灵个人账号灵感值；提交后仅查询原任务。']};
   spec.hints.strict_extra_fields=[...declaration.arguments.map(a=>a.name),'__mcpInputs'];
   // Modes with unknown input names require a future explicit binding UI.
   if(declaration.inputs.some(i=>!inputKind(i)))continue;
   if(kind==='video'&&(!spec.durations.length||!Object.keys(modeCapabilities).length))continue;
   output.push(spec);
  }
 }
 if(new Set(output.map(s=>s.id)).size!==output.length)throw Error('MCP 返回重复型号');
 return output;
}
export function adoptMcpModels(catalog,ids,specs,kind){
 if(!Array.isArray(specs))return;
 const current=new Set(specs.filter(s=>s.kind===kind&&isMcpModel(s.id)&&s.mcp).map(s=>s.id));
 for(let i=catalog.length-1;i>=0;i--)if(isMcpModel(catalog[i].id)&&catalog[i].kind===kind&&!current.has(catalog[i].id))catalog.splice(i,1);
 for(let i=ids.length-1;i>=0;i--)if(isMcpModel(ids[i])&&!current.has(ids[i]))ids.splice(i,1);
 for(const spec of specs){if(spec.kind!==kind||!isMcpModel(spec.id)||!spec.mcp)continue;const index=catalog.findIndex(s=>s.id===spec.id);if(index<0){catalog.push(spec);ids.push(spec.id);}else catalog[index]=spec;}
}
export function mcpResult(payload,kind,expectedId){
 const id=payload.generationId||payload.generation_id||'';
 if(expectedId&&id&&id!==expectedId)throw Error('MCP 返回的任务编号与原任务不一致');
 const state=String(payload.status||'').toLowerCase(),failed=['failed','error','failure','canceled','cancelled','timeout'].includes(state),done=['completed','partial_completed','succeed','succeeded','success'].includes(state);
 const images=done?(payload.works||[]).filter(w=>w.contentType===kind&&(!w.status||['completed','succeed','succeeded','success'].includes(String(w.status).toLowerCase()))).map(w=>({url:w.url,type:kind==='video'?'video/mp4':'image/png',...(w.assetId?{providerAssetId:w.assetId}:{})})).filter(w=>typeof w.url==='string'&&/^https:\/\//.test(w.url)):[];
 if(done&&!images.length)return {id:id||expectedId,status:'failed',images:[],errorMessage:'MCP 任务已结束但没有可保存的结果；已保留任务编号，可恢复查询原任务'};
 return {id:id||expectedId,status:failed?'failed':done?'completed':'polling',images,...(payload.paused?{paused:true}:{}),...(typeof payload.errorMessage==='string'?{errorMessage:payload.errorMessage}:{}),...(Number.isFinite(payload.creditsConsumed)?{mcpCredits:payload.creditsConsumed}:{})};
}
