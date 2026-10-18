export const referenceMaxBytes=type=>(type?.startsWith('image/')?20:type?.startsWith('video/')?300:50)*1024*1024;
// Shared, pure reference contract: browser guidance and server pre-upload validation.
export function parseElements(value){
 if(value===undefined||value==='')return [];
 let rows=value;if(typeof rows==='string'){try{rows=JSON.parse(rows)}catch{throw Error('可灵主体须为 JSON 数组')}}
 if(!Array.isArray(rows)||rows.length>20)throw Error('可灵主体列表无效');
 const seen=new Set();return rows.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['id','bindName','type'].includes(k))||typeof row.id!=='string'||!/^\d{1,160}$/.test(row.id)||!/[1-9]/.test(row.id)||seen.has(row.id)||typeof row.bindName!=='string'||!row.bindName.trim()||row.bindName.length>100||row.type!==undefined&&!['image','video'].includes(row.type))throw Error('可灵主体须包含不重复的正整数文本 ID、名称及有效类型');
  seen.add(row.id);return {...row,bindName:row.bindName.trim()};
 });
}
export function elementPolicy(spec){
 const d=spec?.mcp?.declaration,a=d?.arguments?.find(a=>a.name==='elements');if(!a)return null;
 // Legacy tool contracts allow video subjects only on these declared video tools.
 const video=d.elementSupport?.videoElements??(spec.mcp.tool==='image_to_video'&&['kling-video-v3_0','kling-video-v3_0_omni'].includes(spec.providerModel));
 return {imageElements:true,videoElements:video,maxTotalElements:a.maxItems??10,...d.elementSupport};
}
export function klingReferenceProblem(spec,refs=[],extra={}){
 if(spec?.adapter!=='klingMcp')return '';
 try{
  const elements=parseElements(extra.elements),policy=elementPolicy(spec),images=refs.filter(r=>r?.type?.startsWith('image/')),videos=refs.filter(r=>r?.type?.startsWith('video/'));
  if(elements.length&&!policy)throw Error('当前可灵型号不支持主体参考');
  if(policy){const counts={image:0,video:0};for(const e of elements){const type=e.type||'image';if(!policy[type+'Elements'])throw Error('当前可灵型号不支持'+(type==='video'?'视频':'图片')+'主体');counts[type]++;}
   if(elements.length>policy.maxTotalElements||counts.image>(policy.maxImageElements??policy.maxTotalElements)||counts.video>(policy.maxVideoElements??policy.maxTotalElements))throw Error('可灵主体数量超过模型上限');
   if(videos.length&&policy.maxVideoElementsWithVideoInput!==undefined&&(counts.video>policy.maxVideoElementsWithVideoInput||counts.video&&(images.length||counts.image)))throw Error('有参考视频时，视频主体不能与图片或图片主体混用，且数量须符合上限');
  }
  if(spec.mcp.tool==='motion_control'){
   if(images.length!==1||videos.length>1||Boolean(extra.motionId)===Boolean(videos.length))throw Error('动作控制需要一张主体图片，并在动作视频与动作 ID 中二选一');
   if(extra.motionId!==undefined&&(typeof extra.motionId!=='string'||!/^\d{1,160}$/.test(extra.motionId)||!/[1-9]/.test(extra.motionId)))throw Error('动作 ID 须为正整数文本');
   if(!['image_direction','motion_direction'].includes(extra.motionDirection))throw Error('请选择动作控制方向');
   if(videos.length){const max=extra.motionDirection==='image_direction'?10:30,d=videos[0].duration;if(!Number.isFinite(d)||d<3||d>max)throw Error('动作视频时长须为3–'+max+'秒');}
  }
  return '';
 }catch(e){return e.message}
}
