import {VIDU_Q4,buildViduSubmission} from './vidu-q4.js';
import {validateReferences,requestMode,modeCapability,durationIsAutomatic} from './model-registry.js';
export function referenceFilename(r){const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/mp4':'m4a'}[r.type];return (r.name||'reference').replace(/[\/\\\r\n]/g,'_')+(ext&&!new RegExp('\\.'+ext+'$','i').test(r.name||'')?'.'+ext:'');}
export async function buildImageSubmission(x,p,refs,read,upload){
 const s=validateReferences(x,refs),mode=requestMode(x,refs),cap=modeCapability(s,mode);
 if(x.model===VIDU_Q4)return buildViduSubmission({...x,referenceMode:mode==='reference'?'reference':'frames'},p,refs,read);
 if(x.draftTaskId)return {path:p.generatePath,options:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:p.modelName||s.providerModel||x.model,draft_task_id:x.draftTaskId,resolution:'1080p'})}};
 const media={image:[],video:[],audio:[]};for(const ref of refs){const kind=ref.type.split('/')[0];media[kind].push(await upload({...ref,bytes:Buffer.from(await read(ref))}));}
 let ratio=x.aspectRatio&&x.aspectRatio!=='auto'?x.aspectRatio:cap.defaultRatio||s.defaults?.aspectRatio||'16:9';
 if(cap.ratioPolicy==='input')ratio='adaptive';
 const duration=x.duration??s.defaults?.duration??s.durations[0],resolution=x.draft?'480p':x.resolution||s.defaults?.resolution||s.sizes[0];
 const body={...(x.extra||{}),model:p.modelName||s.providerModel||x.model,prompt:x.prompt?.trim()||'',duration,aspect_ratio:ratio};
 if(durationIsAutomatic(s,mode,refs))delete body.duration;
 if(cap.ratioPolicy==='omit')delete body.aspect_ratio;
 const roles=media.image.map((url,i)=>({url,role:mode==='reference'?'reference_image':i?'last_frame':'first_frame'}));
 if(['seedance2','seedance25','minimaxH3'].includes(s.family)){
  if(roles.length)body.image_with_roles=roles;
  if(media.video.length)body.video_with_roles=media.video.map(url=>({url,role:'reference_video'}));
  if(media.audio.length)body.audio_with_roles=media.audio.map(url=>({url,role:'reference_audio'}));
  if(resolution)body.resolution=resolution;if(x.draft)body.draft=true;
 }else if(s.family==='viduq4ToApis'){
  body.image_urls=media.image;if(resolution)body.resolution=resolution;
  if(mode==='reference'){body.video_generation_mode='reference_images_to_video';if(media.audio.length)body.metadata={...(body.metadata||{}),sounds:media.audio};}
  else delete body.aspect_ratio;
 }else if(s.family==='wan3'){
  if(mode==='first'||mode==='frames')body.image_with_roles=roles;else if(media.image.length)body.reference_images=media.image;
  if(media.video.length)body.video_list=media.video.map(video_url=>({video_url}));
  if(media.audio.length)body.audio_with_roles=media.audio.map(url=>({url,role:'reference_audio'}));
  body.ratio=ratio;delete body.aspect_ratio;if(resolution)body.resolution=resolution;
 }else if(s.family==='omni11'||s.family==='omni11vip'){
  if(media.image.length)body.image_urls=media.image;if(resolution)body.resolution=resolution;
  if(s.family==='omni11vip'){
   if(media.image.length)body.generation_type=mode==='first'?'frame':'reference';
   if(media.video.length)body.video_urls=media.video;
  }
 }else if(s.family==='omni11official'){
  if(media.image.length)body.image_urls=media.image;
  if(media.video.length)body.video_list=media.video.map(video_url=>({video_url}));
  body.metadata={task:{text:'text_to_video',first:'image_to_video',reference:'reference_to_video',edit:'edit',extend:'extend'}[mode]};if(resolution)body.resolution=resolution;
 }else{
  if(media.image.length)body.image_urls=media.image;
  if(s.family==='veo'||s.family==='seedance15')body.metadata={...(body.metadata||{}),...(resolution?{resolution}:{}),...(s.family==='veo'&&media.image.length?{generation_type:mode==='reference'?'reference':'frame'}:{})};
 }
 return {path:p.generatePath,options:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}};
}
