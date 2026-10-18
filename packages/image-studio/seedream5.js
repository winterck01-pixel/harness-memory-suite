// ToAPIs wire contract, deliberately separate from the broader Ark native API.
export const SEEDREAM5_IDS=['doubao-seedream-5-0','doubao-seedream-5-0-pro'];
export const isSeedream5=id=>SEEDREAM5_IDS.includes(id);
export function seedream5Parameters(x,refCount=0){
 if(!isSeedream5(x.model))return null;
 const pro=x.model.endsWith('-pro'),max=pro?10:15,n=x.n??1,extra=x.extra??{};
 if(!extra||typeof extra!=='object'||Array.isArray(extra))throw Error('Seedream 高级参数须为对象');
 for(const k of Object.keys(extra))if(!['metadata','layer_decomposition'].includes(k))throw Error('此 Seedream 渠道未确认该高级字段：'+k);
 const m=extra.metadata??{};
 if(!m||typeof m!=='object'||Array.isArray(m))throw Error('Seedream metadata 须为对象');
 for(const k of Object.keys(m))if(!['resolution','sequential_image_generation','sequential_image_generation_options','watermark'].includes(k))throw Error('此 Seedream 渠道未确认该 metadata 字段：'+k);
 const resolution=x.resolution||m.resolution||'2K';
 if(x.resolution&&m.resolution&&x.resolution!==m.resolution)throw Error('清晰度与 metadata.resolution 冲突');
 if(!(pro?['1K','2K']:['2K','3K']).includes(resolution))throw Error('Seedream 清晰度不支持');
 if(!Number.isInteger(n)||n<1||n>max||n+refCount>15)throw Error('Seedream 输出数量或参考图与输出总数超限');
 const sequential=m.sequential_image_generation??(n>1?'auto':'disabled');
 if(!['disabled','auto'].includes(sequential))throw Error('Seedream 顺序生图模式无效');
 if(n>1&&sequential==='disabled')throw Error('多张输出不能同时禁用顺序生图');
 const options=m.sequential_image_generation_options;
 if(options!==undefined){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='max_images'))throw Error('Seedream 顺序生成选项无效');
  if(!Number.isInteger(options.max_images)||options.max_images!==n)throw Error('max_images 必须与请求张数一致，防止超出所选数量');
  if(sequential!=='auto')throw Error('max_images 需要启用顺序生图');
 }
 if(m.watermark!==undefined&&typeof m.watermark!=='boolean')throw Error('Seedream 水印须为布尔值');
 if(extra.layer_decomposition!==undefined&&typeof extra.layer_decomposition!=='boolean')throw Error('图层拆分须为布尔值');
 const layers=extra.layer_decomposition===true;
 if(layers&&(!pro||refCount!==1||n!==1||sequential!=='disabled'))throw Error('Seedream Pro 图层拆分需要一张参考图、张数1，且不使用顺序生图');
 return {resolution,layers,metadata:{resolution,sequential_image_generation:sequential,...(sequential==='auto'?{sequential_image_generation_options:{max_images:n}}:{}),watermark:m.watermark??false}};
}
export function seedream5Body(x,urls){
 const p=seedream5Parameters(x,urls.length);
 if(!p)return null;
 const metadata={...p.metadata};
 if(p.layers)delete metadata.resolution;
 return {model:x.model,prompt:x.prompt.trim(),n:x.n??1,size:p.layers?p.resolution:(x.aspectRatio&&x.aspectRatio!=='auto'?x.aspectRatio:'1:1'),...(urls.length?{image_urls:urls}:{}),metadata,...(p.layers?{layer_decomposition:true}:{})};
}
