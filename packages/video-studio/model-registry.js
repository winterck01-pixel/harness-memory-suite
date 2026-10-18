import {VIDU_Q4,VIDU_ADAPTER,viduProfile,validateViduRequest} from './vidu-q4.js';
import {adoptMcpModels,mcpProfile,isMcpModel,MCP_ADAPTER,WORKRALLY_ADAPTER} from './mcp-capabilities.js';
import catalog from './model-catalog.json' with {type:'json'};
import {requestMode,modeCapability,ratiosForMode,referenceProblem} from './model-capabilities.js';
export {requestMode,modeCapability,ratiosForMode,referenceProblem,videoDefaults,durationIsAutomatic,referenceKindsFor,modesForSpec,modeLabelFor,mediaRule,normalizedVideoOptions} from './model-capabilities.js';
export const MODEL_CATALOG=catalog,MODEL_IDS=catalog.map(x=>x.id),LEGACY_MODELS=[],PROTOCOLS=[MCP_ADAPTER,WORKRALLY_ADAPTER,'toApisUnifiedVideo',VIDU_ADAPTER];
export function registerMcpModels(specs){adoptMcpModels(MODEL_CATALOG,MODEL_IDS,specs,'video');}
export function modelSpec(id){const s=catalog.find(x=>x.id===id);if(!s)throw Error('请选择支持的视频模型');return s;}
export function defaultProfile(id){if(isMcpModel(id))return mcpProfile(modelSpec(id));const spec=modelSpec(id);if(id===VIDU_Q4)return viduProfile();return {adapter:'toApisUnifiedVideo',modelName:spec.providerModel||id,generatePath:'/v1/videos/generations',editPath:'/v1/videos/generations',queryPath:'/v1/videos/generations/{id}',uploadPath:'/v1/uploads/images',videoUploadPath:'/v1/uploads/videos',audioUploadPath:'/v1/uploads/audios',referenceTransport:'upload',...spec.endpointPaths};}
export const profileForService=id=>defaultProfile(id);
const reserved=['model','prompt','image_urls','image_with_roles','video_with_roles','audio_with_roles','video_urls','video_list','sounds','duration','seconds','aspect_ratio','ratio','resolution','n','client_business_id','reference_images','output_format','enable_gif','draft','draft_task_id','generation_type','video_generation_mode'];
export function validateParameters(x,refCount=0){
 const s=modelSpec(x.model);if(x.model===VIDU_Q4){validateViduRequest({...x,referenceMode:requestMode(x,Array(refCount).fill({}))==='reference'?'reference':'frames'});return s;}
 const mode=requestMode(x,Array(refCount).fill({})),cap=modeCapability(s,mode);if(!cap)throw Error('该模型不支持此生成模式');
 if(x.aspectRatio&&x.aspectRatio!=='auto'&&cap.ratioPolicy!=='input'&&cap.ratioPolicy!=='omit'&&!ratiosForMode(s,mode).includes(x.aspectRatio))throw Error('视频比例不支持');
 if(x.resolution&&!s.sizes.includes(x.resolution))throw Error('视频清晰度不支持');
 if(x.duration!==undefined&&x.duration!==null&&!s.durations.includes(x.duration))throw Error('视频时长不支持');
 if((x.n??1)!==1)throw Error('每次生成一个视频');
 if(x.extra!==undefined&&(!x.extra||typeof x.extra!=='object'||Array.isArray(x.extra)))throw Error('高级参数须为JSON对象');
 const extra=x.extra||{};for(const k of reserved)if(Object.hasOwn(extra,k))throw Error('高级参数不能覆盖'+k);
 if(s.advancedFields){for(const [k,v]of Object.entries(extra)){const field=s.advancedFields[k];if(!field||field.modes&&!field.modes.includes(mode))throw Error('当前模型或模式不支持高级字段：'+k);if(field.type==='object'?(!v||typeof v!=='object'||Array.isArray(v)):field.type==='integer'?(!Number.isSafeInteger(v)||v<0):typeof v!==field.type)throw Error('高级字段格式无效：'+k);}}
 if(extra.metadata!==undefined){if(!extra.metadata||typeof extra.metadata!=='object'||Array.isArray(extra.metadata))throw Error('metadata须为JSON对象');const permitted=s.family==='viduq4ToApis'?['is_rec','wm_position','wm_url','meta_data']:s.family==='wan3'?['media']:null;if(permitted&&Object.keys(extra.metadata).some(k=>!permitted.includes(k)))throw Error('metadata包含未声明或由素材绑定管理的字段');}
 if(s.family==='viduq4ToApis'&&extra.metadata){const m=extra.metadata;if(m.is_rec!==undefined&&typeof m.is_rec!=='boolean')throw Error('提示词优化参数须为布尔值');if(m.wm_position!==undefined&&(!Number.isInteger(m.wm_position)||m.wm_position<1||m.wm_position>4))throw Error('水印位置须为1–4');for(const k of ['wm_url','meta_data'])if(m[k]!==undefined&&typeof m[k]!=='string')throw Error('水印或元数据格式无效');}
 if(s.family==='wan3'&&extra.metadata?.media){const media=extra.metadata.media;if(!Array.isArray(media)||media.length!==1||!['file','link'].includes(media[0]?.type)||typeof media[0]?.url!=='string'||!/^https?:\/\//.test(media[0].url))throw Error('文件或网页参考须为单个公开URL');if(['first','frames'].includes(mode))throw Error('首尾帧不能与文件或网页参考混用');}
 if(s.family==='seedance25'){const op=extra.video_operation;if(op!==undefined&&op!=='generate')throw Error('当前片段工作流仅支持生成，不支持编辑或延长');const tools=extra.tools;if(tools!==undefined&&(!Array.isArray(tools)||tools.some(t=>!t||t.type!=='web_search'||Object.keys(t).some(k=>k!=='type'))))throw Error('视频搜索工具参数无效');if(tools?.length&&refCount)throw Error('视频搜索工具只支持纯文生视频，不能与参考素材混用');}
 if(x.draft!==undefined&&typeof x.draft!=='boolean')throw Error('样片参数无效');if((x.draft||x.draftTaskId)&&!s.supportsDraft)throw Error('该模型不支持样片');if(x.draft&&x.draftTaskId)throw Error('样片和成稿不能同时提交');if(x.draft&&x.resolution&&x.resolution!=='480p')throw Error('样片固定480p');if(x.draftTaskId&&(refCount||x.prompt||x.resolution&&x.resolution!=='1080p'))throw Error('成稿仅使用样片任务且固定1080p');
 return s;
}
export function validateReferences(x,refs){
 const s=validateParameters(x,refs.length);if(x.model===VIDU_Q4){const mode=requestMode(x,refs);if(!modeCapability(s,mode))throw Error('Q4 Preview不支持此模式');validateViduRequest({...x,referenceMode:mode==='reference'?'reference':'frames'},refs);if(x.referenceIds&&new Set(x.referenceIds).size!==x.referenceIds.length)throw Error('参考素材不能重复');return s;}
 const problem=referenceProblem(s,requestMode(x,refs),refs,x);if(problem)throw Error(problem);
 if(x.referenceIds&&new Set(x.referenceIds).size!==x.referenceIds.length)throw Error('参考素材不能重复');
 if(s.family==='viduq4ToApis'&&refs.some(r=>r.type?.startsWith('audio/'))&&x.extra?.audio===false)throw Error('使用参考音频时须启用声音输出');return s;
}
