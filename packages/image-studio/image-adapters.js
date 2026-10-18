import {isSeedream5,seedream5Body} from './seedream5.js';
import {midjourneyPlan} from './midjourney.js';
import {gpt25PixelSize,modelSpec,usesGptEditRoute,validateParameters} from './model-registry.js';
import {sizeForRatio} from './image-parameters.js';
export function referenceFilename(ref){const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'}[ref.type];const name=(ref.name||'reference').replace(/[\/\\\r\n]/g,'_');return ext&&!new RegExp('\\.(?:'+(ext==='jpg'?'jpe?g':ext)+')$','i').test(name)?name+'.'+ext:name;}
const json=(path,body,headers={})=>({path,options:{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}});
export async function buildImageSubmission(x,profile,refs,readImage,upload){
 const spec=validateParameters(x,refs.length,profile),adapter=profile.adapter,model=profile.modelName||x.model,ratio=x.aspectRatio&&x.aspectRatio!=='auto'?x.aspectRatio:spec.hints.default_aspect_ratio||'auto',resolution=x.resolution||spec.sizes[0]||'',n=x.n||1,extra=x.extra||{};
 if(['gemini_image','gemini_chat','midjourney'].includes(adapter)&&(x.n||1)!==1)throw Error('该协议每次只支持一个生成请求');
 const data=await Promise.all(refs.map(async r=>({...r,bytes:Buffer.from(await readImage(r))})));
 const dataUrls=data.map(r=>'data:'+r.type+';base64,'+r.bytes.toString('base64'));
 let urls=dataUrls;if(profile.referenceTransport==='upload'||adapter==='toApisUnifiedImage'||adapter==='toApisMidjourney')urls=await Promise.all(data.map(r=>upload(r)));
 if(adapter==='toApisMidjourney')return midjourneyPlan(x,profile,urls);
 if(isSeedream5(x.model)&&adapter==='toApisUnifiedImage'){const body=seedream5Body(x,urls);body.model=model;return json((urls.length?profile.editPath:profile.generatePath),body);}
 const path=(refs.length&&!(adapter==='toApisUnifiedImage'&&/^gpt-image-2(?:\.5-(?:flare|sunburst))?$/.test(model))?profile.editPath:profile.generatePath).replace('{model}',encodeURIComponent(model));
 if(adapter==='gpt_image'){
  let body={model,prompt:x.prompt.trim(),n,size:x.resolution?sizeForRatio(x.model,ratio,x.resolution):x.size&&x.size!=='auto'?x.size:sizeForRatio(x.model,ratio),quality:x.quality||'auto',...extra};if(x.model.startsWith('dall-e-')){body.size=resolution||({'1:1':'1024x1024','16:9':'1792x1024','9:16':'1024x1792'}[ratio]||'1024x1024');if(x.model==='dall-e-2')delete body.quality;else if(body.quality==='auto')body.quality='standard';}if(x.model==='gpt-image-2-all')body={model,prompt:(ratio!=='auto'?'请按画幅比例 '+ratio+' 生成。\n':'')+(resolution?'清晰度 '+resolution+'。\n':'')+x.prompt.trim()};if(x.model==='gpt-image-2'){delete body.quality;if(body.size==='auto')delete body.size;}
  if(!refs.length)return json(path,body);const form=new FormData();for(const [key,val]of Object.entries(body))if(val!==undefined)form.append(key,typeof val==='object'?JSON.stringify(val):String(val));for(const r of data)form.append('image',new Blob([r.bytes],{type:r.type}),referenceFilename(r));return {path,options:{method:'POST',body:form}};
 }
 if(adapter==='gemini_image'){const parts=[{text:x.prompt},...data.map(r=>({inline_data:{mime_type:r.type,data:r.bytes.toString('base64')}}))];const imageConfig={...(ratio!=='auto'?{aspectRatio:ratio}:{}),...(resolution?{imageSize:resolution}:{})};return json(path,{contents:[{role:'user',parts}],generationConfig:{responseModalities:['TEXT','IMAGE'],imageConfig,...extra}})}
 if(adapter==='gemini_chat')return json(path,{model,messages:[{role:'user',content:[{type:'text',text:x.prompt},...urls.map(url=>({type:'image_url',image_url:{url}}))]}],...extra});
 if(adapter==='toApisUnifiedImage'&&spec.hints.toapis_gpt_official_family){
  const gpt25=spec.hints.toapis_gpt_official_family==='gpt25';
  const size=gpt25?gpt25PixelSize({...x,aspectRatio:ratio}):(ratio==='auto'?'1:1':ratio);
  const quality=gpt25?(x.quality||'high'):(!x.quality||x.quality==='auto'?'high':x.quality);
  if(gpt25&&path.endsWith('/v1/images/edits')&&urls.length){
   for(const u of urls){let url;try{url=new URL(u)}catch{}if(!url||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('参考图编辑路由需要可公开访问的 http(s) 链接，请先完成上传');}
   const form=new FormData();
   for(const [key,val] of Object.entries({model,prompt:x.prompt,n,size,quality}))if(val!==undefined&&String(val)!=='')form.append(key,String(val));
   if(typeof extra.background==='string'&&extra.background!=='')form.append('background',extra.background);
   for(const u of urls)form.append('image',u);
   return {path,options:{method:'POST',body:form}};
  }
  const jsonExtra=usesGptEditRoute(x.model)&&!path.endsWith('/v1/images/edits')&&extra.background===''?Object.fromEntries(Object.entries(extra).filter(([k])=>k!=='background')):extra;
  return json(path,{model,prompt:x.prompt,n,size,quality,...(!gpt25?{resolution:resolution.toLowerCase()}:{}),...(urls.length?{image_urls:urls}:{}),...jsonExtra});
 }
 if(adapter==='toApisUnifiedImage'||adapter==='toApisImageEdit'){
  const top=spec.hints.top_level_resolution===true||['openai_image','qwen_image'].includes(spec.family);const metadata={...(resolution&&!top?{resolution}:{}),...(spec.hints.toapis_gemini_standard&&ratio!=='auto'?{orientation:(()=>{const [w,h]=ratio.split(':').map(Number);return w>h?'landscape':w<h?'portrait':'square'})()}:{}),...(extra.metadata||{})};const body={model,prompt:x.prompt,n,...(spec.family==='openai_image'?{response_format:'url'}:{}),...(ratio!=='auto'?{size:ratio}:{}),...(urls.length?{[spec.family==='openai_image'?'reference_images':'image_urls']:profile.imageUrlsObjects===true?urls.map(url=>({url})):urls}:{}),...(resolution&&top?{resolution:spec.hints.top_level_resolution===true?resolution:resolution.toLowerCase()}:{}),...(Object.keys(metadata).length?{metadata}:{}),...extra};if(spec.hints.toapis_gemini_official&&Object.keys(metadata).length)body.metadata=metadata;if(adapter==='toApisUnifiedImage'&&/^gpt-image-2\.5-(flare|sunburst)$/.test(model)){if(n!==1)throw Error('ToAPIs GPT 2.5普通版每次只支持一张图片');body.quality='high';body.n=1;}if(extra.layer_decomposition===true){if(!spec.hints.seedream_layer_decomposition)throw Error('该模型不支持图层拆分');if(!['1K','2K'].includes(resolution))throw Error('图层拆分需要1K或2K');body.size=resolution;delete body.resolution;if(body.metadata){delete body.metadata.resolution;if(!Object.keys(body.metadata).length)delete body.metadata;}}return json(path,body);
 }
 if(adapter==='qwen_dashscope'||adapter==='wan_image'){
  let size=resolution.includes('*')?resolution:sizeForRatio(x.model,ratio,resolution).replace('x','*');if(size==='auto')size='1024*1024';const parameters={n,watermark:false,size,...extra};if(adapter==='wan_image'&&urls.length&&resolution==='4K')parameters.size=sizeForRatio(x.model,ratio,'2K').replace('x','*');if(adapter==='wan_image'&&!urls.length)parameters.thinking_mode=true;if(x.model==='qwen-image-edit')delete parameters.size;
  return json(path,{model,input:{messages:[{role:'user',content:[...urls.map(image=>({image})),{text:x.prompt}]}]},parameters});
 }
 if(adapter==='specialized_one_api')return json(path,{model,prompt:x.prompt,n,size:x.resolution?sizeForRatio(x.model,ratio,x.resolution):x.size&&x.size!=='auto'?x.size:sizeForRatio(x.model,ratio),...(urls.length?{image:urls.length===1?urls[0]:urls}:{}),...extra});
 if(adapter==='kling_image'){
  const images=data.map(r=>r.bytes.toString('base64')),omni=spec.hints.kling_image_payload_family==='omni_image';const multi=!omni&&images.length>1&&spec.hints.supports_kling_multi_image2image;if(images.length>1&&!omni&&!multi)throw Error('该Kling型号不支持多参考图');const body={model_name:model,prompt:x.prompt,...(ratio!=='auto'?{aspect_ratio:ratio}:{}),...(resolution?{resolution}:{}),...(!omni?{n}:{}),...extra};if(omni&&images.length)body.image_list=images.map(image=>({image}));else if(multi)body.subject_image_list=images.map(subject_image=>({subject_image}));else if(images.length)body.image=images[0];return json(multi?'/v1/images/multi-image2image':path,body);
 }
 if(adapter==='midjourney'){let prompt=x.prompt;if(ratio!=='auto')prompt+=' --ar '+ratio;if(extra.model_preset&&extra.model_preset!=='default')prompt+=' --niji '+extra.model_preset.replace('niji','');return json(path,{prompt,base64Array:dataUrls,...(extra.notifyHook?{notifyHook:extra.notifyHook}:{})})}
 throw Error('图片协议适配器不支持');
}
