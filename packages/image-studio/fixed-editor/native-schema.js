// Live declarations remain authoritative; capability-only fields never become submitted extra.
const core=new Set(['prompt','aspect_ratio','aspectRatio','image_size','resolution','quality','n','imageCount','image_count','max_reference_images','min_reference_images']);
const seedream5=s=>['doubao-seedream-5-0','doubao-seedream-5-0-pro'].includes(s.id);
function targetKey(key,s){if(key==='seedream_layer_decomposition')return'layer_decomposition';if(key==='seedream_optimize_prompt_mode')return'metadata';if(seedream5(s)&&['watermark','sequential_image_generation','sequential_image_generation_options'].includes(key))return'metadata';return key;}
function permitted(key,s){if(core.has(key))return false;if(seedream5(s)&&key==='seedream_optimize_prompt_mode')return false;const allowed=s.hints?.strict_extra_fields;return!Array.isArray(allowed)||allowed.includes(targetKey(key,s));}
export function nativeParameterSchema(spec){
 const properties={};
 for(const[key,f]of Object.entries(spec.fields||{})){if(!permitted(key,spec))continue;properties[key]={title:f.label||key,description:f.description,...(f.values?{enum:f.values}:{}),type:f.type?.includes('int')?'integer':f.type==='bool'?'boolean':f.type?.includes('float')?'number':'string',...(f.default_value!==undefined?{default:f.default_value}:{})};}
 for(const f of spec.mcp?.declaration?.arguments||[]){if(core.has(f.name))continue;properties[f.name]={title:f.name,type:({int:'integer',float:'number',bool:'boolean'})[f.type]||'string',...(f.allowedValues?{enum:f.allowedValues}:{}),...(f.default!==undefined?{default:f.default}:{})};}
 if(!Array.isArray(spec.hints?.strict_extra_fields)||spec.hints.strict_extra_fields.includes('metadata'))properties.metadata={title:'metadata（原生高级参数）',type:'object'};
 if(spec.mcp)properties.__mcpInputs={title:'参考槽位映射',type:'object'};
 return{type:'object',properties};
}
export function normalizeNativeDraft(request,spec){
 const x=structuredClone(request),extra=x.extra||{};x.extra=extra;
 if(Object.hasOwn(extra,'seedream_layer_decomposition')){extra.layer_decomposition=extra.seedream_layer_decomposition;delete extra.seedream_layer_decomposition;}
 if(Object.hasOwn(extra,'seedream_optimize_prompt_mode')){extra.metadata={...extra.metadata,optimize_prompt_options:{...extra.metadata?.optimize_prompt_options,mode:extra.seedream_optimize_prompt_mode}};delete extra.seedream_optimize_prompt_mode;}
 if(seedream5(spec))for(const key of ['watermark','sequential_image_generation','sequential_image_generation_options'])if(Object.hasOwn(extra,key)){extra.metadata={...extra.metadata,[key]:extra[key]};delete extra[key];}
 for(const key of ['max_reference_images','min_reference_images'])if(Object.hasOwn(extra,key))throw Error('参考数量是模型能力，不是生成参数');
 return x;
}
