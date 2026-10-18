// Q4 Preview only. Public contract captured 2026-10-08; no paid acceptance run.
export const VIDU_Q4='viduq4-preview';
export const VIDU_ADAPTER='viduQ4Official';
export const viduProfile=()=>({adapter:VIDU_ADAPTER,modelName:VIDU_Q4,baseUrl:'https://api.vidu.com',generatePath:'/ent/v2/img2video',editPath:'/ent/v2/reference2video',queryPath:'/ent/v2/tasks/{id}/creations',uploadPath:'/unsupported',videoUploadPath:'/unsupported',audioUploadPath:'/unsupported',referenceTransport:'data_uri',useDefaultKey:false,queryAuthSchemes:{frames:'Token',reference:'Bearer'}});
export function queryAuthSchemeFor(p,mode){return p.queryAuthSchemes?.[mode==='reference'?'reference':'frames']||p.queryAuthScheme||(mode==='reference'?'Bearer':'Token');}
export function validateViduProfile(p){
 if(p.adapter!==VIDU_ADAPTER||p.modelName!==VIDU_Q4)throw Error('Q4 Preview 必须使用官方协议和原始型号 viduq4-preview');
 if(p.baseUrl!=='https://api.vidu.com'||p.useDefaultKey===true)throw Error('Q4 Preview 需要独立 Vidu 官方地址和密钥，不能复用公共服务凭据');
 if(p.generatePath!=='/ent/v2/img2video'||p.editPath!=='/ent/v2/reference2video'||p.queryPath!=='/ent/v2/tasks/{id}/creations'||p.referenceTransport!=='data_uri')throw Error('Q4 Preview 路径或参考传输与官方契约不一致');
 const schemes=p.queryAuthSchemes??{frames:p.queryAuthScheme??'Token',reference:p.queryAuthScheme??'Bearer'};
 if(!schemes||typeof schemes!=='object'||Array.isArray(schemes)||!['Token','Bearer'].includes(schemes.frames)||!['Token','Bearer'].includes(schemes.reference))throw Error('Vidu 查询认证方案无效');
 return p;
}
export function validateViduRequest(x,refs){
 if(x.model!==VIDU_Q4)throw Error('仅支持 viduq4-preview');
 if(typeof x.prompt!=='string'||!x.prompt.trim()||[...x.prompt].length>20000)throw Error('Q4 Preview 提示词须为1–20000字符');
 if(!Number.isInteger(x.duration??5)||(x.duration??5)<3||(x.duration??5)>16)throw Error('Q4 Preview 时长须为3–16秒');
 if(!['540p','720p','1080p','2K','4K'].includes(x.resolution||'720p'))throw Error('Q4 Preview 清晰度不支持');
 if(!['frames','reference'].includes(x.referenceMode||'frames'))throw Error('Q4 Preview 仅支持首帧或参考生成');
 if((x.n??1)!==1||x.draft||x.draftTaskId)throw Error('Q4 Preview 不支持多结果或样片');
 if(x.extra!==undefined&&(!x.extra||typeof x.extra!=='object'||Array.isArray(x.extra)))throw Error('高级参数须为JSON对象');
 const extra=x.extra||{};for(const k of Object.keys(extra))if(!['audio','seed','is_rec'].includes(k))throw Error('Q4 Preview 不支持此高级字段：'+k);
 for(const k of ['audio','is_rec'])if(extra[k]!==undefined&&typeof extra[k]!=='boolean')throw Error(k+' 须为布尔值');
 if(extra.seed!==undefined&&(!Number.isSafeInteger(extra.seed)||extra.seed<0))throw Error('seed 须为非负安全整数');
 if(x.referenceMode==='reference'&&extra.is_rec!==undefined)throw Error('参考生成未提供 is_rec 字段');
 if(x.referenceMode==='reference'&&!['16:9','9:16','1:1','3:4','4:3'].includes(x.aspectRatio||'16:9'))throw Error('Q4 Preview 参考生成比例不支持');
 if(!refs)return;
 const images=refs.filter(r=>r.type?.startsWith('image/')),sounds=refs.filter(r=>r.type?.startsWith('audio/'));
 if(images.length+sounds.length!==refs.length||images.some(r=>!['image/png','image/jpeg','image/webp'].includes(r.type)))throw Error('Q4 Preview 仅接受PNG/JPEG/WebP图片和MP3音频');
 if(x.referenceMode==='reference'){
  if(images.length<1||images.length>15||sounds.length>3)throw Error('Q4 Preview 参考生成需要1–15张图片，最多3段MP3');
 }else if(images.length!==1||sounds.length)throw Error('Q4 Preview 首帧生成需要且仅接受1张图片；无纯文生或首尾帧支持');
 for(const r of sounds)if(r.type!=='audio/mpeg'||!Number.isFinite(r.duration)||r.duration<3||r.duration>12)throw Error('Q4 Preview 音频必须为已读取时长的MP3，每段3–12秒');
 if(sounds.length&&extra.audio===false)throw Error('使用参考音频时必须启用声音输出');
}
export async function buildViduSubmission(x,p,refs,read){
 validateViduProfile(p);validateViduRequest(x,refs);
 const body={model:VIDU_Q4,prompt:x.prompt.trim(),images:[],duration:x.duration??5,resolution:x.resolution||'720p',audio:x.extra?.audio??true,seed:x.extra?.seed??0};
 if(x.referenceMode==='reference'){body.aspect_ratio=x.aspectRatio||'16:9';body.sounds=[];}else body.is_rec=x.extra?.is_rec??false;
 let encodedSize=0;
 for(const r of refs){const bytes=Buffer.from(await read(r));if(!bytes.length||bytes.length>50_000_000)throw Error('Vidu 参考素材须为1字节至50 MB');encodedSize+=4*Math.ceil(bytes.length/3);if(encodedSize>19_900_000)throw Error('Vidu 内联参考请求超过20 MB，请缩小参考素材');const audio=r.type==='audio/mpeg';(audio?body.sounds:body.images).push('data:'+(audio?'video/mp3':r.type)+';base64,'+bytes.toString('base64'));}
 // The unusual video/mp3 MIME is the exact Q4 sounds example; remains unverified live.
 const json=JSON.stringify(body);if(Buffer.byteLength(json)>20_000_000)throw Error('Vidu 内联参考请求超过20 MB，请缩小参考素材');
 return {path:x.referenceMode==='reference'?p.editPath:p.generatePath,options:{method:'POST',headers:{'Content-Type':'application/json'},body:json}};
}
export function parseViduResult(p){
 if(!p||typeof p!=='object'||!['created','queueing','processing','success','failed'].includes(p.state))throw Error('Vidu 返回未知任务状态');
 const images=p.state==='success'&&Array.isArray(p.creations)?p.creations.filter(r=>typeof r.url==='string').slice(0,1).map(r=>({url:r.url,type:'video/mp4'})):[];
 if(p.state==='success'&&!images.length)throw Error('Vidu 成功任务缺少视频结果');
 return {providerCredits:Number.isFinite(p.credits)&&p.credits>=0?p.credits:undefined,id:p.task_id||p.id||'',status:p.state==='failed'?'failed':p.state==='success'?'completed':'queued',errorMessage:typeof p.err_code==='string'?p.err_code.slice(0,200):'',images};
}
