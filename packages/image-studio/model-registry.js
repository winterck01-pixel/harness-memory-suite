import {isSeedream5,seedream5Parameters} from './seedream5.js';
import {validateMidjourney} from './midjourney.js';
import {adoptMcpModels,mcpProfile,isMcpModel,MCP_ADAPTER,WORKRALLY_ADAPTER} from 'dsh-video-studio/mcp-capabilities.js';
import catalog from './model-catalog.json' with {type:'json'};
export const MODEL_CATALOG=catalog;
export const MODEL_IDS=catalog.map(x=>x.id);
export function registerMcpModels(specs){adoptMcpModels(MODEL_CATALOG,MODEL_IDS,specs,'image');}
export function modelSpec(id){const spec=catalog.find(x=>x.id===id);if(!spec)throw Error('请选择支持的图片模型');return spec;}
export const LEGACY_MODELS=['gpt-image-2','gpt-image-2-all','gpt-image-2.5-sunburst','gpt-image-2.5-flare'];
export const PROTOCOLS=[MCP_ADAPTER,WORKRALLY_ADAPTER,'gpt_image','toApisUnifiedImage','toApisImageEdit','gemini_image','gemini_chat','qwen_dashscope','wan_image','specialized_one_api','kling_image','midjourney','toApisMidjourney'];
export const TOAPIS_GPT_EDIT_ROUTE_MODELS=['gpt-image-2.5-flare-vip'];
export function usesGptEditRoute(id){return TOAPIS_GPT_EDIT_ROUTE_MODELS.includes(id);}
// These are the entries this release republishes with the full documented ratio set; the older *-official entries keep their previously published narrower lists and are deliberately out of scope.
export const GPT25_RATIO_COVERAGE_MODELS=['gpt-image-2.5-flare-vip'];
export function assertGptEditRouteAlignment(){for(const id of MODEL_IDS){const routed=defaultProfile(id).editPath==='/v1/images/edits',listed=usesGptEditRoute(id);if((listed&&!routed)||(!listed&&routed&&modelSpec(id).adapter==='toApisUnifiedImage'))throw Error('编辑路由与目录声明不一致：'+id);}return true;}
export const GPT25_RATIO_SIZE={"1:1":"1024x1024","16:9":"1536x864","9:16":"864x1536","4:3":"1280x960","3:4":"960x1280","3:2":"1536x1024","2:3":"1024x1536","5:4":"1280x1024","4:5":"1024x1280","21:9":"1792x768"};
export function gpt25PixelSize(x){return x.resolution||GPT25_RATIO_SIZE[x.aspectRatio]||'1024x1024';}
export function assertGpt25RatioCoverage(){const keys=Object.keys(GPT25_RATIO_SIZE).sort(),sizes=[...new Set(Object.values(GPT25_RATIO_SIZE))].sort();const sameList=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>v===b[i]);for(const id of GPT25_RATIO_COVERAGE_MODELS){const s=modelSpec(id);if(s.hints.toapis_gpt_official_family!=='gpt25')throw Error('比例与像素尺寸声明不一致：'+id);const ratios=s.ratios.filter(r=>r!=='auto');if(!sameList([...ratios].sort(),keys)||!sameList([...s.sizes].sort(),sizes)||!sameList(s.fields?.aspect_ratio?.values,s.ratios)||!sameList(s.fields?.image_size?.values,s.sizes))throw Error('比例与像素尺寸声明不一致：'+id);}return true;}
export function defaultProfile(id){if(isMcpModel(id))return mcpProfile(modelSpec(id));const s=modelSpec(id),adapter=s.adapter,h=s.hints;const create=adapter==='gemini_image'?'/v1beta/models/{model}:generateContent':adapter==='qwen_dashscope'||adapter==='wan_image'?'/api/v1/services/aigc/multimodal-generation/generation':adapter==='kling_image'?h.official_create_path:adapter==='toApisMidjourney'?'/v1/midjourney/generations':adapter==='midjourney'?'/mj/submit/imagine':'/v1/images/generations';const query=adapter==='toApisMidjourney'?'/v1/images/generations/{id}':adapter.startsWith('toApis')?'/v1/images/generations/{id}':adapter==='kling_image'?create+'/{id}':adapter==='midjourney'?'/mj/task/{id}':adapter==='qwen_dashscope'||adapter==='wan_image'?'/api/v1/tasks/{id}':'/v1/images/generations/{id}';return {adapter,generatePath:create,editPath:(usesGptEditRoute(id)||adapter==='toApisImageEdit'||adapter==='gpt_image')?'/v1/images/edits':create,queryPath:query,uploadPath:'/v1/uploads/images',referenceTransport:adapter.startsWith('toApis')?'upload':'data_uri',modelName:h.official_model_name||id};}
export function validateParameters(x,refCount=0,profile){const spec=modelSpec(x.model);if(isSeedream5(x.model)&&profile?.adapter==='toApisUnifiedImage')seedream5Parameters(x,refCount);if(spec.hints.toapis_gpt_official_family)validateToApisGptOfficial(x,spec,refCount);if(spec.hints.toapis_gemini_official)validateToApisGeminiMetadata(x.extra?.metadata,spec);if(x.model==='midjourney')validateMidjourney(x,refCount);if(refCount>(spec.maxRefs??16))throw Error('该模型最多支持'+spec.maxRefs+'张参考图');if(refCount<spec.minRefs)throw Error('该模型至少需要'+spec.minRefs+'张参考图');const ratio=x.aspectRatio||'auto';if(ratio!=='auto'&&!spec.ratios.includes(ratio))throw Error('该模型不支持此图片比例');const n=x.n??1;if(!Number.isInteger(n)||!(spec.fields.n?.values||[1]).includes(n))throw Error('生成数量不支持');if(x.extra!==undefined&&(!x.extra||typeof x.extra!=='object'||Array.isArray(x.extra)))throw Error('高级参数须为JSON对象');if(Array.isArray(spec.hints.strict_extra_fields))for(const key of Object.keys(x.extra||{}))if(!spec.hints.strict_extra_fields.includes(key))throw Error('该模型未公开支持高级参数：'+key);for(const key of ['model','model_name','prompt','image','image_urls','n'])if(Object.hasOwn(x.extra||{},key))throw Error('高级参数不能覆盖'+key);const quality=x.quality||'auto';if(!(spec.fields.quality?.values||['auto','low','medium','high']).includes(quality))throw Error('质量参数不支持');const resolution=x.resolution||'';if(resolution&&!spec.sizes.includes(resolution))throw Error('该模型不支持此清晰度');const limit=spec.hints.max_reference_and_output_images;if(limit&&refCount+n>limit)throw Error('参考图与生成图片总数不能超过'+limit);return spec;}

export function profileForService(id,source){const profile=defaultProfile(id);if(source?.adapter==='toApisUnifiedImage'&&modelSpec(id).family==='openai_image')return {...profile,adapter:'toApisUnifiedImage',generatePath:'/v1/images/generations',editPath:usesGptEditRoute(id)?'/v1/images/edits':'/v1/images/generations',referenceTransport:'upload'};return profile;}

function validateToApisGeminiMetadata(metadata,spec){
 if(metadata===undefined)return;
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw Error('Gemini metadata须为JSON对象');
 const allowed=['temperature','topP',...(spec.hints.supports_thinking_budget?['thinkingConfig']:[])];
 for(const key of Object.keys(metadata))if(!allowed.includes(key))throw Error('该模型未公开支持metadata参数：'+key);
 for(const key of ['temperature','topP'])if(metadata[key]!==undefined&&(typeof metadata[key]!=='number'||!Number.isFinite(metadata[key])))throw Error(key+'须为有限数字');
 if(metadata.thinkingConfig!==undefined){const c=metadata.thinkingConfig;if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>k!=='thinkingBudget')||!Number.isInteger(c.thinkingBudget))throw Error('thinkingConfig只支持整数thinkingBudget');}
}

function validateToApisGptOfficial(x,spec,refCount){
 const extra=x.extra||{},gpt25=spec.hints.toapis_gpt_official_family==='gpt25';
 if(extra.background!==undefined&&!(gpt25?['','transparent']:['auto','opaque','transparent']).includes(extra.background))throw Error('该型号不支持此背景参数');
 if(extra.output_format!==undefined&&!['png','jpeg'].includes(extra.output_format))throw Error('该型号只支持PNG或JPEG输出');
 if(extra.output_compression!==undefined&&(!Number.isInteger(extra.output_compression)||extra.output_compression<0||extra.output_compression>100))throw Error('压缩参数须为0至100的整数');
 if(extra.mask_url!==undefined){if(!refCount)throw Error('遮罩需要参考图');let url;try{url=new URL(extra.mask_url)}catch{}if(!url||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('遮罩须为公开图片URL');}
 if(gpt25&&x.resolution&&x.aspectRatio&&x.aspectRatio!=='auto'){const ratio=Object.fromEntries(Object.entries(GPT25_RATIO_SIZE).map(([r,s])=>[s,r]))[x.resolution];if(ratio&&ratio!==x.aspectRatio)throw Error('像素尺寸与图片比例不一致');}
}
