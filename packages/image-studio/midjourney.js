// ToAPIs unified asynchronous Midjourney protocol. Legacy /mj remains explicit.
export const MJ_ACTIONS=['imagine','edits','blend','describe','upscale','variation','high-variation','low-variation','reroll','zoom','pan','remix-strong','remix-subtle','inpaint','modal'];
export const MJ_PARENT_ACTIONS=MJ_ACTIONS.slice(4);
export const MJ_ACTION_FIELDS={imagine:['style','seed','stylize','chaos','weird','negative_prompt','quality'],edits:['style','seed','stylize','chaos','weird','negative_prompt','quality'],blend:['dimensions','metadata'],describe:[],upscale:['index','custom_id'],variation:['index','custom_id'],'high-variation':['index','custom_id'],'low-variation':['index','custom_id'],reroll:['custom_id','nsfw_check'],zoom:['zoom_ratio'],pan:['direction'],'remix-strong':['index'],'remix-subtle':['index'],inpaint:[],modal:[]};
// Native parameter bounds and version compatibility: Midjourney official Version,
// Stylize, Chaos, Weird, Seeds and Raw documentation. Unknown relay defaults
// deliberately do not imply a native version or a supported quality override.
export const MJ_ADVANCED_CAPABILITIES=Object.freeze({
 numericRanges:Object.freeze({stylize:Object.freeze({min:0,max:1000,defaultValue:100}),chaos:Object.freeze({min:0,max:100,defaultValue:0}),weird:Object.freeze({min:0,max:3000,defaultValue:0}),seed:Object.freeze({min:0,max:4294967295,integer:true})}),
 styleValues:Object.freeze(['raw']),
 qualityByVersion:Object.freeze({'v6.1':Object.freeze([0.5,1,2]),v7:Object.freeze([1,2,4]),'v8.1':Object.freeze([]),'v8.2':Object.freeze([])})
});
export function midjourneyAdvancedCapabilities(version){
 const isV8=['v8.1','v8.2'].includes(version);
 return {...MJ_ADVANCED_CAPABILITIES,qualityValues:MJ_ADVANCED_CAPABILITIES.qualityByVersion[version]||[],speedValues:isV8?['relax','fast']:['relax','fast','turbo'],qualityReason:isV8?'此版本不支持质量参数':version?'':'请先选择支持质量参数的版本'};
}
export function midjourneyButtonAction(button){
 const supported=['upscale','variation','high-variation','low-variation','reroll'];
 for(const value of [button?.action,button?.type])if(supported.includes(value))return value;
 if(/^U[1-4]$/i.test(button?.label||''))return 'upscale';
 if(/^V[1-4]$/i.test(button?.label||''))return 'variation';
 return '';
}
export function validateMidjourney(x,refCount=0){
 const e=x.extra||{},action=e.action||'imagine';
 if(!MJ_ACTIONS.includes(action))throw Error('不支持此 Midjourney 图片操作');
 const allowed=new Set(['action','speed','version',...MJ_ACTION_FIELDS[action]]);for(const key of Object.keys(e))if(!allowed.has(key))throw Error('此 Midjourney 操作不支持参数：'+key);
 if(e.dimensions!==undefined&&(typeof e.dimensions!=='string'||!e.dimensions.trim()||e.dimensions.length>100))throw Error('Blend dimensions须为非空文本');
 if(e.metadata!==undefined&&(!e.metadata||typeof e.metadata!=='object'||Array.isArray(e.metadata)))throw Error('Blend metadata须为JSON对象');
 if(e.nsfw_check!==undefined&&typeof e.nsfw_check!=='boolean')throw Error('Reroll nsfw_check须为布尔值');
 if(!midjourneyAdvancedCapabilities(e.version).speedValues.includes(e.speed||'relax'))throw Error('Midjourney 速度无效');
 if(e.version&&!['v8.2','v8.1','v7','v6.1'].includes(e.version))throw Error('Midjourney 版本无效');
 if(['imagine','edits'].includes(action)&&!x.prompt?.trim())throw Error('请填写提示词');
 if(['edits','describe'].includes(action)&&refCount<1)throw Error('该操作至少需要一张参考图');
 if(action==='blend'&&(refCount<2||refCount>4))throw Error('混图需要2到4张图片');
 if(MJ_PARENT_ACTIONS.includes(action)){
  if(!x.sourceTaskId)throw Error('请选择来源任务');
  if(action==='modal'&&!x.maskReferenceId)throw Error('请选择蒙版图片');
  if(refCount&&action!=='modal')throw Error('后续图片操作使用父任务，不接受额外参考图');
  if(['upscale','variation','high-variation','low-variation','remix-strong','remix-subtle'].includes(action)&&!e.custom_id&&(!Number.isInteger(e.index)||e.index<1||e.index>4))throw Error('请选择1到4的图片序号');
  if(action.startsWith('remix-')&&(!Number.isInteger(e.index)||e.index<1||e.index>4))throw Error('Remix 需要1到4的图片序号');
  if(action==='pan'&&!['left','right','up','down'].includes(e.direction))throw Error('请选择扩图方向');
 }
 for(const key of ['seed','stylize','chaos','weird','quality','zoom_ratio'])if(e[key]!==undefined&&(typeof e[key]!=='number'||!Number.isFinite(e[key])))throw Error('Midjourney 数字参数无效：'+key);
 for(const [key,range]of Object.entries(MJ_ADVANCED_CAPABILITIES.numericRanges))if(e[key]!==undefined&&(e[key]<range.min||e[key]>range.max||(range.integer&&!Number.isInteger(e[key]))))throw Error('Midjourney '+key+' 需为'+range.min+'到'+range.max+(range.integer?'的整数':'之间的数值'));
 if(e.quality!==undefined&&!midjourneyAdvancedCapabilities(e.version).qualityValues.includes(e.quality))throw Error(e.version?'当前 Midjourney 版本不支持此质量值':'设置质量值前请先选择支持的 Midjourney 版本');
 if(e.style!==undefined&&!MJ_ADVANCED_CAPABILITIES.styleValues.includes(e.style))throw Error('Midjourney 风格只支持 raw 或服务商默认');
 for(const key of ['style','negative_prompt'])if(e[key]!==undefined&&(typeof e[key]!=='string'||e[key].length>8000))throw Error('Midjourney 文本参数无效：'+key);
 if(e.custom_id!==undefined&&(typeof e.custom_id!=='string'||e.custom_id.length>1000))throw Error('图片操作按钮无效');
 for(const key of ['task_id','image_urls','mask_url','base64Array','notifyHook'])if(Object.hasOwn(e,key))throw Error('Midjourney 参数必须由任务与素材绑定：'+key);
 return action;
}
export function midjourneyPlan(x,profile,urls){
 const action=validateMidjourney(x,urls.length),e=x.extra||{},body={model:'midjourney',speed:e.speed||'relax'};
 if(x.prompt?.trim())body.prompt=x.prompt.trim();
 if(action==='modal'){if(urls.length!==1)throw Error('需要一张蒙版图片');body.mask_url=urls[0];}else if(urls.length)body.image_urls=urls;
 if(x.parentRemoteId)body.task_id=x.parentRemoteId;
 if(x.aspectRatio&&x.aspectRatio!=='auto')body.size=x.aspectRatio;
 const keys=['version',...MJ_ACTION_FIELDS[action].filter(k=>k!=='action')];
 for(const k of keys)if(e[k]!==undefined)body[k]=e[k];
 const base=profile.generatePath.replace(/\/(?:imagine|edits|blend|describe)$/,'').replace(/\/$/,'');
 return {path:base+'/'+action,options:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}};
}
export function parseMidjourney(payload){
 const p=payload?.data&&!Array.isArray(payload.data)&&typeof payload.data==='object'?payload.data:payload||{};
 const status=String(p.status||p.state||'').toLowerCase();
 const url=x=>typeof x==='string'&&/^https?:\/\//.test(x);
 const images=[];const seen=new Set();
 const add=(value,role,index)=>{const u=typeof value==='string'?value:value?.url;if(url(u)&&!seen.has(u)){seen.add(u);images.push({url:u,resultRole:role,providerIndex:index});}};
 // The unified image query exposes completed Midjourney outputs as result.data.
 // The dedicated MJ/task aliases can omit media even when status is completed.
 if(p.result?.type==='image'&&Array.isArray(p.result.data))p.result.data.forEach((u,i)=>add(u,'image',i+1));
 if(Array.isArray(p.image_urls))p.image_urls.forEach((u,i)=>add(u,'image',i+1));
 if(p.grid_image_url)add(p.grid_image_url,'grid',0);
 if(!images.length&&p.imageUrl)add(p.imageUrl,'image',1);
 const failed=['failure','failed','error','cancelled','canceled'].includes(status)||Boolean(p.error);
 const complete=['success','completed','succeeded'].includes(status);
 const buttons=Array.isArray(p.buttons)?p.buttons.filter(b=>b&&typeof b==='object').map(b=>({custom_id:String(b.custom_id||b.customId||''),label:String(b.label||''),...(b.type?{type:String(b.type)}:{}),...(b.action?{action:String(b.action)}:{})})):[];
 return {id:String(p.id||p.task_id||p.taskId||payload?.id||''),status:failed?'failed':status==='modal'?'awaiting_input':complete?'completed':status,images:complete?images:[],errorMessage:String(p.error?.message||p.failReason||p.message||'').slice(0,500),midjourney:{status,gridImageUrl:url(p.grid_image_url)?p.grid_image_url:'',buttons,description:p.description??'',progress:p.progress??null}};
}
