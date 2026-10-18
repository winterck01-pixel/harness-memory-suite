import {modelSpec,LEGACY_MODELS,gpt25PixelSize,GPT25_RATIO_SIZE,GPT25_RATIO_COVERAGE_MODELS} from './model-registry.js';
export const IMAGE2_RATIOS=['auto','1:1','3:2','2:3','16:9','9:16'];
export const IMAGE25_RATIOS=['auto','1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9'];
export const ratiosFor=model=>{if(LEGACY_MODELS.includes(model))return model.includes('2.5')?IMAGE25_RATIOS:IMAGE2_RATIOS;const spec=modelSpec(model),ratio=spec.mcp?.declaration?.arguments?.find(a=>['aspect_ratio','aspectRatio'].includes(a.name));return [...(spec.mcp&&ratio?.required?[]:['auto']),...spec.ratios.filter(x=>x!=='auto')];};
// Runtime declarations determine MCP defaults; ordinary image drafts retain their existing semantics.
export function normalizeImageMcpDraft(draft,spec){
 if(!spec){try{spec=modelSpec(draft.model)}catch{return draft}}
 if(!spec.mcp)return draft;
 if(spec.workrally){const aspectRatio=spec.ratios.includes(draft.aspectRatio)?draft.aspectRatio:spec.defaults?.aspectRatio||spec.ratios[0],resolution=spec.sizes.includes(draft.resolution)?draft.resolution:spec.defaults?.resolution||spec.sizes[0]||'';return {...draft,aspectRatio,resolution,size:'auto'};}
 const args=spec.mcp.declaration.arguments,pick=(names,current,values,fallback)=>{const field=args.find(a=>names.includes(a.name));if(values.includes(current))return current;if(field?.default!==undefined)return String(field.default);if(current==='auto'&&!field?.required)return current;return field?.required?values[0]??fallback:fallback;};
 const aspectRatio=pick(['aspect_ratio','aspectRatio'],draft.aspectRatio,spec.ratios,'auto'),resolution=pick(['resolution','video_resolution','img_resolution','image_resolution'],draft.resolution,spec.sizes,'');
 if(draft.aspectRatio===aspectRatio&&draft.resolution===resolution&&draft.size==='auto')return draft;
 return {...draft,aspectRatio,resolution,size:'auto'};
}
export function sizeForRatio(model,ratio='auto',resolution=''){
 if(modelSpec(model).mcp)return 'auto';
 if(ratio==='match_input_image')return 'auto';
 if(ratio==='auto'&&!resolution)return 'auto';
 if(ratio==='auto')ratio='1:1';
 if(!ratiosFor(model).includes(ratio))throw Error('图片比例不支持');
 if(GPT25_RATIO_COVERAGE_MODELS.includes(model)){
  if(resolution){if(!modelSpec(model).sizes.includes(resolution))throw Error('该模型不支持此像素尺寸');return resolution;}
  return GPT25_RATIO_SIZE[ratio];
 }
 const [x,y]=ratio.split(':').map(Number);let scale=Math.floor(({'512':512,'1K':1024,'2K':2048,'3K':3072,'4K':3840}[resolution]||1024)/Math.max(x,y)/16)*16;
 if(model.includes('2.5')){while(x*y*scale*scale>8294400)scale-=16;}if(model.includes('2.5'))while(x*y*scale*scale<655360)scale+=16;
 return `${x*scale}x${y*scale}`;
}

// Repair legacy saved VIP drafts without changing prompts, references or extra fields.
export function normalizeVipDraft(draft){
 if(!GPT25_RATIO_COVERAGE_MODELS.includes(draft.model))return draft;
 const spec=modelSpec(draft.model),aliases={'汽车':'auto','低的':'low','中等的':'medium','高的':'high','最大限度':'max'};
 const candidateQuality=aliases[draft.quality]||draft.quality;
 const quality=spec.fields.quality.values.includes(candidateQuality)?candidateQuality:spec.fields.quality.default_value;
 const aspectRatio=spec.ratios.includes(draft.aspectRatio)?draft.aspectRatio:'auto';
 const resolution=spec.sizes.includes(draft.resolution)?draft.resolution:'';
 const next={...draft,quality,aspectRatio,resolution,n:1,size:gpt25PixelSize({aspectRatio,resolution})};
 return ['quality','aspectRatio','resolution','n','size'].some(k=>next[k]!==draft[k])?next:draft;
}
