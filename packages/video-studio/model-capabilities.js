import {workrallyEditProblem} from './workrally-edit.js';
export {referenceMaxBytes} from './kling-reference-contract.js';
import {klingReferenceProblem} from './kling-reference-contract.js';
// Pure capability resolver shared by the browser, chat tools, store and adapters.
export const VIDEO_MODE_NAMES={text:'文生视频',first:'首帧',frames:'首尾帧',reference:'参考生成',edit:'视频编辑',extend:'视频延长',motion:'动作控制'};
export function modesForSpec(spec){return Object.keys(spec?.modeCapabilities||{});}
export function requestMode(request,refs=[]){
 if(request.generationMode)return request.generationMode;
 if(!refs.length&&!request.referenceIds?.length)return 'text';
 if(request.referenceMode==='reference')return 'reference';
 return (refs.length||request.referenceIds?.length)>1?'frames':'first';
}
export function modeCapability(spec,mode){return spec?.modeCapabilities?.[mode];}
export function referenceKindsFor(spec,mode){return Object.entries(modeCapability(spec,mode)?.limits||{}).filter(([,n])=>n>0).map(([kind])=>kind);}
export function ratiosForMode(spec,mode){return modeCapability(spec,mode)?.ratios||spec?.ratios||[];}
export function videoDefaults(spec){const mode=modesForSpec(spec)[0]||'text';return {model:spec.id,generationMode:mode,referenceMode:mode==='reference'?'reference':'frames',duration:spec.defaults?.duration??spec.durations[0],aspectRatio:spec.defaults?.aspectRatio||spec.ratios[0],resolution:spec.defaults?.resolution||'',n:1,quality:'auto',extra:{}};}
export function modeLabelFor(spec,mode){if(spec?.mcp?.tool==='image_to_video'&&mode==='reference')return '多关键帧';return mode==='reference'&&referenceKindsFor(spec,mode).some(k=>k!=='image')?'全能参考':VIDEO_MODE_NAMES[mode]||mode;}
export function durationIsAutomatic(spec,mode,refs=[]){return modeCapability(spec,mode)?.durationPolicy==='omit'||modeCapability(spec,mode)?.durationPolicy==='omitWithVideo'&&refs.some(r=>r?.type?.startsWith('video/'));}
export function normalizedVideoOptions(spec,request,refs=[]){
 const generationMode=requestMode(request,refs),cap=modeCapability(spec,generationMode);
 return {
  generationMode,referenceMode:['text','first','frames'].includes(generationMode)?'frames':'reference',
  duration:durationIsAutomatic(spec,generationMode,refs)?null:request.duration??spec.defaults?.duration??spec.durations[0],
  resolution:request.draft?'480p':request.draftTaskId?'1080p':request.resolution||spec.defaults?.resolution||'',
  aspectRatio:cap?.ratioPolicy==='omit'?null:cap?.ratioPolicy==='input'?'adaptive':request.aspectRatio&&request.aspectRatio!=='auto'?request.aspectRatio:cap?.defaultRatio||spec.defaults?.aspectRatio||spec.ratios[0]
 };
}
export function mediaRule(spec,mode,kind){return {...spec?.mediaRules?.[kind],...modeCapability(spec,mode)?.mediaRules?.[kind]};}
export function referenceProblem(spec,mode,refs,request={}){
 if(spec?.workrally?.mode==='SmartEdit')return workrallyEditProblem(spec,refs,request);
 const problem=klingReferenceProblem(spec,refs,request.extra||{});if(problem)return problem;
 const cap=modeCapability(spec,mode);if(!cap)return '当前模型不支持此生成模式';
 if(!Array.isArray(refs))return '参考素材列表无效';
 const counts={image:0,video:0,audio:0},durations={image:0,video:0,audio:0};
 const media=request.extra?.metadata?.media,hasMetadataReference=cap.allowMetadataReference&&Array.isArray(media)&&media.length===1&&['file','link'].includes(media[0]?.type)&&typeof media[0]?.url==='string'&&/^https?:\/\//.test(media[0].url);
 if(refs.length+(hasMetadataReference?1:0)<(cap.minReferences||0))return mode==='first'?'首帧模式需要1张图片':mode==='frames'?'首尾帧模式需要2张图片':'请添加此模式需要的参考素材';
 if(cap.maxReferences&&refs.length>cap.maxReferences)return '参考素材合计最多'+cap.maxReferences+'项';
 for(const ref of refs){
  if(!ref)return '参考素材不存在或已删除';
  const kind=ref.type?.split('/')[0];if(!(kind in counts)||!(cap.limits[kind]>0))return '当前模型或模式不支持此参考素材类型';
  counts[kind]++;const rule=mediaRule(spec,mode,kind);
  if(rule.types&&!rule.types.includes(ref.type))return '此模型不支持该参考素材格式：'+ref.type;
  if(rule.codecs&&ref.audioCodec&&!rule.codecs.includes(ref.audioCodec))return '参考音频编码不支持';if(rule.videoCodecs&&ref.videoCodec&&!rule.videoCodecs.includes(ref.videoCodec))return '参考视频编码不支持';if(rule.audioCodecs&&ref.audioCodec&&!rule.audioCodecs.includes(ref.audioCodec))return '参考视频音轨编码不支持';
  const bytes=ref.bytes?.length??ref.size;if(rule.maxBytes&&Number.isFinite(bytes)&&bytes>rule.maxBytes)return '参考素材超过模型单文件限制';
  if(rule.minDuration!==undefined||rule.maxDuration!==undefined||rule.totalDuration!==undefined){
   if(!Number.isFinite(ref.duration)||ref.duration<=0)return '参考音视频必须先读取实际时长';
   if(rule.minDuration!==undefined&&ref.duration<rule.minDuration||rule.maxDuration!==undefined&&ref.duration>rule.maxDuration)return '参考'+(kind==='audio'?'音频':'视频')+'时长不支持';
   durations[kind]+=ref.duration;
  }
  if(Number.isFinite(ref.width)&&Number.isFinite(ref.height)){
   if(rule.minDimension&&(ref.width<rule.minDimension||ref.height<rule.minDimension)||rule.maxDimension&&(ref.width>rule.maxDimension||ref.height>rule.maxDimension))return '参考图片尺寸不支持';
   const ratio=ref.width/ref.height;if(rule.minRatio&&ratio<rule.minRatio||rule.maxRatio&&ratio>rule.maxRatio)return '参考图片比例不支持';
  }
 }
 for(const [kind,n]of Object.entries(counts))if(n>(cap.limits[kind]||0))return '参考素材数量超出模式限制：'+kind;
 if(cap.imageCounts&&!cap.imageCounts.includes(counts.image))return '当前模式参考图片数量须为'+cap.imageCounts.join('或')+'张';
 if(cap.requiredKinds?.some(kind=>!counts[kind]))return '此模式必须提供'+cap.requiredKinds.map(k=>({image:'图片',video:'视频',audio:'音频'}[k])).join('、');
 if(cap.requiresVisual&&counts.audio&&!counts.image&&!counts.video)return '参考音频须同时提供参考图片或视频';
 if(cap.exclusiveKinds&&Object.values(counts).filter(Boolean).length>1)return '此模式不能混用图片与视频';
 for(const kind of ['video','audio']){const rule=mediaRule(spec,mode,kind);if(rule.totalDuration&&durations[kind]>rule.totalDuration+0.001)return '参考'+(kind==='video'?'视频':'音频')+'总时长不能超过'+rule.totalDuration+'秒';}
 return '';
}
