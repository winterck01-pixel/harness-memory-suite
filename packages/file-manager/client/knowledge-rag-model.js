export const RAG_API = '/api/knowledge-rag'
export const ROLES = ['embedding', 'text', 'ocr', 'vision', 'rerank']
export const ROLE_INFO = {
  embedding: {title:'语义向量',hint:'为文档建立与查询语义索引。',protocol:'openai-embeddings'},
  text: {title:'文本处理',hint:'OpenAI chat/completions 协议，用于处理文档文本。',protocol:'openai-chat'},
  ocr: {title:'OCR',hint:'可选择专用 OCR 接口，或支持图像输入的视觉识字模型。',protocol:'openai-chat'},
  vision: {title:'图片与漫画视觉',hint:'OpenAI chat/completions 协议，模型须支持图像输入。',protocol:'openai-chat'},
  rerank: {title:'候选重排',hint:'使用百炼 DashScope、Cohere v2 或 VikingDB 重排候选；百炼 Qwen3-VL 支持图文。',protocol:'cohere-v2'},
}
export const reusable = role => ['text','ocr','vision'].includes(role)
export const PROTOCOLS = {embedding:['openai-embeddings','ark-multimodal'],text:['openai-chat'],ocr:['openai-chat','volc-visual-ocr'],vision:['openai-chat'],rerank:['cohere-v2','vikingdb-rerank','dashscope-rerank']}
export const REASONING = ['','minimal','low','medium','high']
const text = value => typeof value === 'string' ? value : ''
const copy = value => structuredClone(value)
const CREDENTIALS = ['apiKey','accessKey','secretKey']
const CLEAR = {apiKey:'clearCredential',accessKey:'clearAccessKey',secretKey:'clearSecretKey'}
const ROUTE = ['protocol','source','provider','endpoint']
export const sameRoute = (model,baseline) => !!baseline && ROUTE.every(field => model[field] === baseline[field])
export const credentialsFor = model => model.source === 'harness' ? [] : ['vikingdb-rerank','volc-visual-ocr'].includes(model.protocol) ? ['accessKey','secretKey'] : ['apiKey']
const clearDraftKeys = model => {for(const field of CREDENTIALS){model[field]='';model[CLEAR[field]]=false}}


export function publicProviderCatalog(data) {
  const protocols = (Array.isArray(data?.protocols)?data.protocols:[]).flatMap(protocol=>{
    if(typeof protocol.id!=='string')return []
    const roles=(Array.isArray(protocol.roles)?protocol.roles:[]).filter(role=>ROLES.includes(role)&&PROTOCOLS[role].includes(protocol.id))
    if(!roles.length)return []
    return [{id:protocol.id,roles,path:text(protocol.path),endpointKind:protocol.endpointKind==='origin'?'origin':'base-url',credentialFields:(Array.isArray(protocol.credentialFields)?protocol.credentialFields:[]).filter(field=>CREDENTIALS.includes(field)),dimensions:(Array.isArray(protocol.dimensions)?protocol.dimensions:[]).filter(value=>[1024,2048].includes(value)),denseOnly:protocol.denseOnly===true,oneRequestPerChunk:protocol.oneRequestPerChunk===true,instructionModels:(Array.isArray(protocol.instructionModels)?protocol.instructionModels:[]).filter(value=>typeof value==='string'),regionRequired:protocol.regionRequired===true,signingService:text(protocol.signingService),models:(Array.isArray(protocol.models)?protocol.models:[]).filter(value=>typeof value==='string'),ocrMethod:text(protocol.ocrMethod)}]
  })
  const presets=(Array.isArray(data?.presets)?data.presets:[]).flatMap(preset=>{
    const config=preset?.config
    if(typeof preset?.id!=='string'||!config||typeof config.protocol!=='string')return []
    const roles=(Array.isArray(preset.roles)?preset.roles:[]).filter(role=>ROLES.includes(role)&&PROTOCOLS[role].includes(config.protocol))
    if(!roles.length)return []
    const projected={source:config.source==='harness'?'harness':'independent',provider:text(config.provider),protocol:config.protocol,endpoint:text(config.endpoint),model:text(config.model)}
    for(const field of ['queryInstructions','documentInstructions','imageDocumentInstructions','imageQueryInstructions','multimodalQueryInstructions','reasoningEffort','region','instruction'])if(typeof config[field]==='string')projected[field]=config[field]
    if(config.dimensions!==undefined)projected.dimensions=String(config.dimensions)
    if(typeof config.imageEnabled==='boolean')projected.imageEnabled=config.imageEnabled
    return [{id:preset.id,label:text(preset.label)||preset.id,roles,ocrMethod:text(preset.ocrMethod),config:projected}]
  })
  return {version:Number.isInteger(data?.version)?data.version:0,protocols,presets}
}
const inferPreset = (role,model,catalog) => catalog.presets.find(preset=>preset.roles.includes(role)&&Object.entries(preset.config).every(([field,value])=>String(model[field])===String(value)))?.id||'custom'


export function publicDocument(data,catalog=publicProviderCatalog(data?.providerCatalog)) {
  if(!data?.settings?.models)throw new Error('INVALID_RESPONSE')
  const settings=data.settings
  return {enabled:settings.enabled===true,chunkSize:String(settings.chunkSize??1200),overlap:String(settings.overlap??160),models:Object.fromEntries(ROLES.map(role=>{
    const value=settings.models[role]||{},defaults=catalog.presets.find(preset=>preset.roles.includes(role)&&preset.config.protocol===value.protocol)?.config||{}
    const model={enabled:value.enabled===true,source:reusable(role)&&value.source==='harness'?'harness':'independent',protocol:value.protocol===undefined?ROLE_INFO[role].protocol:text(value.protocol),provider:text(value.provider),endpoint:text(value.endpoint),model:text(value.model),imageEnabled:value.imageEnabled===true,imageFieldsKnown:Object.hasOwn(value,'imageEnabled')||Object.hasOwn(defaults,'imageEnabled'),imageDocumentInstructions:text(value.imageDocumentInstructions??defaults.imageDocumentInstructions),imageQueryInstructions:text(value.imageQueryInstructions??defaults.imageQueryInstructions),multimodalQueryInstructions:text(value.multimodalQueryInstructions??defaults.multimodalQueryInstructions),dimensions:String(value.dimensions===undefined?1024:value.dimensions),queryInstructions:text(value.queryInstructions),documentInstructions:text(value.documentInstructions),reasoningEffort:text(value.reasoningEffort),region:value.region===undefined?text(defaults.region)||'cn-beijing':text(value.region),instruction:text(value.instruction),credentialSet:value.credentialSet===true,accessKeySet:value.accessKeySet===true,secretKeySet:value.secretKeySet===true,apiKey:'',accessKey:'',secretKey:'',clearCredential:false,clearAccessKey:false,clearSecretKey:false}
    return [role,{...model,preset:inferPreset(role,model,catalog)}]
  }))}
}
function publicCatalog(data) {
  return {providers:(Array.isArray(data?.providers)?data.providers:[]).filter(provider=>typeof provider.id==='string').map(provider=>({id:provider.id,name:text(provider.name)||provider.id,unavailable:provider.unavailable===true,models:(Array.isArray(provider.models)?provider.models:[]).filter(model=>typeof model.id==='string').map(model=>({id:model.id,name:text(model.name)||model.id,inputModalities:Array.isArray(model.inputModalities)?model.inputModalities.filter(x=>x==='text'||x==='image'):[]}))})),unavailable:data?.unavailable===true}
}
export function modelsFor(catalog,providerId,role) {
  const provider=catalog.providers.find(p=>p.id===providerId&&!p.unavailable)
  return (provider?.models||[]).filter(model=>!['ocr','vision'].includes(role)||!model.inputModalities.length||model.inputModalities.includes('image'))
}
export function validateDraft(draft,catalog) {
  const errors={},chunk=Number(draft.chunkSize),overlap=Number(draft.overlap)
  if(!/^\d+$/.test(draft.chunkSize)||!Number.isInteger(chunk)||chunk<200||chunk>4000)errors.chunkSize='请输入 200–4000 的整数。'
  if(!/^\d+$/.test(draft.overlap)||!Number.isInteger(overlap)||overlap<0||overlap>=chunk/2)errors.overlap='请输入非负整数，且小于分块字符数的一半。'
  for(const role of ROLES){
    const value=draft.models[role],key=field=>`${role}.${field}`
    if(!PROTOCOLS[role].includes(value.protocol))errors[key('protocol')]='当前接口协议不受支持，请选择此角色支持的协议后保存。'
    if(value.provider.length>240)errors[key('provider')]='服务商标识最多 240 个字符。'
    if(value.model.length>8192||value.enabled&&!value.model.trim())errors[key('model')]='请输入模型 ID。'
    if(role==='embedding'&&value.protocol==='ark-multimodal'){
      if(!['1024','2048'].includes(value.dimensions))errors[key('dimensions')]='请选择 1024 或 2048 维。'
      for(const field of ['queryInstructions','documentInstructions',...(value.imageFieldsKnown||value.imageEnabled?['imageDocumentInstructions','imageQueryInstructions','multimodalQueryInstructions']:[])])if(!value[field].trim()||value[field].length>4000)errors[key(field)]='请输入非空指令，最多 4000 个字符。'
    }
    if(value.protocol==='volc-visual-ocr'){
      if(value.source!=='independent')errors[key('source')]='专用 OCR 只支持独立接口与 AK/SK。'
      if(value.region!=='cn-north-1')errors[key('region')]='此 OCR 服务要求 cn-north-1。'
      if(value.model!=='OCRNormal')errors[key('model')]='此 OCR 接口操作名必须是 OCRNormal。'
    }
    if(value.protocol==='openai-chat'&&reusable(role)&&!REASONING.includes(value.reasoningEffort))errors[key('reasoningEffort')]='请选择支持的推理强度。'
    if(value.protocol==='dashscope-rerank'&&value.model&&!['qwen3.7-text-rerank','qwen3-rerank','qwen3-vl-rerank','gte-rerank-v2'].includes(value.model))errors[key('model')]='请选择百炼支持的重排模型。';
    if(value.protocol==='vikingdb-rerank'){
      if(!/^[a-z0-9-]{1,40}$/.test(value.region))errors[key('region')]='Region 为 1–40 个小写字母、数字或连字符。'
      if(value.instruction.length>1024)errors[key('instruction')]='重排指令最多 1024 个字符。'
      if(value.model&&!['doubao-seed-rerank','base-multilingual-rerank'].includes(value.model))errors[key('model')]='请选择 VikingDB 支持的重排模型。'
      if(value.model==='base-multilingual-rerank'&&value.instruction)errors[key('instruction')]='base-multilingual-rerank 不支持重排指令，请清空。'
    }
    if(value.source==='harness'){
      if(value.enabled&&!catalog.providers.some(p=>p.id===value.provider&&!p.unavailable))errors[key('provider')]='请选择可用的 Harness 服务商。'
      if(value.enabled&&!modelsFor(catalog,value.provider,role).some(m=>m.id===value.model))errors[key('model')]='请选择此服务商下可用的模型。'
    }else{
      if(value.enabled&&!value.endpoint)errors[key('endpoint')]='请输入 API 基础地址。'
      if(value.endpoint){try{const url=new URL(value.endpoint);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||value.endpoint.length>8192)throw new Error();if(['vikingdb-rerank','volc-visual-ocr','dashscope-rerank'].includes(value.protocol)&&(url.pathname!=='/'||/[{}<>]/.test(value.endpoint)))errors[key('endpoint')]='此接口地址只能包含 HTTPS origin，不包含请求路径。'}catch{errors[key('endpoint')]='请输入不含用户名、密码、查询或片段的 HTTPS 地址。'}}
      for(const field of credentialsFor(value)){
        const secret=value[field]
        if(secret&&(!/^[\x21-\x7e]+$/.test(secret.trim())||/^[A-Z][A-Z0-9_]*=[^=]/.test(secret.trim())||/^(["'`]).*\1$/.test(secret.trim())||secret.length>8192))errors[key(field)]='请输入凭据本身，不要粘贴环境变量赋值、引号或空白。'
      }
    }
  }
  return errors
}
export function writeSettings(draft) {
  return {enabled:draft.enabled,chunkSize:Number(draft.chunkSize),overlap:Number(draft.overlap),models:Object.fromEntries(ROLES.map(role=>{
    const value=draft.models[role],out={enabled:value.enabled,source:value.source,protocol:value.protocol,provider:value.provider.trim(),endpoint:value.endpoint.trim(),model:value.model.trim()}
    if(role==='embedding'&&value.protocol==='ark-multimodal'){
      Object.assign(out,{dimensions:Number(value.dimensions),queryInstructions:value.queryInstructions,documentInstructions:value.documentInstructions,imageEnabled:value.imageEnabled})
      for(const field of ['imageDocumentInstructions','imageQueryInstructions','multimodalQueryInstructions'])if(value.imageFieldsKnown||value.imageEnabled||value[field])out[field]=value[field]
    }
    if(reusable(role)&&value.protocol==='openai-chat')out.reasoningEffort=value.reasoningEffort
    if(value.protocol==='vikingdb-rerank')Object.assign(out,{region:value.region,instruction:value.instruction})
    if(value.protocol==='volc-visual-ocr')out.region=value.region
    for(const field of credentialsFor(value)){if(value[CLEAR[field]])out[field]='';else if(value[field]!=='')out[field]=value[field].trim()}
    return [role,out]
  }))}
}
const signature = draft => draft?JSON.stringify(writeSettings(draft)):''
const statusMessage = status => status===401?'登录已失效，请重新登录后重试。':status===403?'当前账号无权访问知识库配置。':status===404?'知识库核心未加载。':'知识库核心暂不可用，请重试。'
const safeCodes={DASHSCOPE_ENDPOINT_ORIGIN_REQUIRED:'百炼地址只能填写实际业务空间 HTTPS origin，请勿包含 API 路径或占位符。',UNSUPPORTED_DASHSCOPE_RERANK_MODEL:'请选择百炼支持的重排模型。',INVALID_CHUNK_SETTINGS:'分块设置不符合要求。',HTTPS_ENDPOINT_REQUIRED:'API 地址必须是有效的 HTTPS 基础地址。',INVALID_PROVIDER:'服务商标识不符合要求。',UNSUPPORTED_MODEL_SOURCE:'此角色不支持所选配置来源。',INVALID_EMBEDDING_DIMENSIONS:'向量维度不符合要求。',INVALID_EMBEDDING_INSTRUCTIONS:'向量指令必须非空，且不超过 4000 字符。',INVALID_VISUAL_OCR_SETTING:'专用 OCR 必须使用独立 AK/SK、cn-north-1 与 OCRNormal HTTPS origin。',INVALID_REASONING_EFFORT:'推理强度不符合要求。',INVALID_VIKING_SETTING:'VikingDB region 或重排指令不符合要求。',VIKING_ENDPOINT_ORIGIN_REQUIRED:'VikingDB 地址必须是 HTTPS origin。',UNSUPPORTED_VIKING_MODEL:'VikingDB 重排模型不受支持。',RERANK_INSTRUCTION_UNSUPPORTED_MODEL:'此重排模型不支持指令。'}

export class RagSettingsController {
  constructor(fetchImpl=(...args)=>fetch(...args)) {
    this.fetch=fetchImpl;this.listeners=new Set();this.epoch=0;this.disposed=false;this.abort=null;this.baseline=null
    this.state={phase:'loading',draft:null,catalog:{providers:[]},providerCatalog:{version:0,protocols:[],presets:[]},error:'',saved:false,saving:false,failed:false}
  }
  activate=()=>{this.disposed=false}
  subscribe=listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener)}
  snapshot=()=>{const errors=this.state.draft?validateDraft(this.state.draft,this.state.catalog):{};return {...this.state,errors,shell:{available:!!this.state.draft,writable:this.state.phase==='ready',dirty:!!this.state.draft&&signature(this.state.draft)!==signature(this.baseline),invalid:!!Object.keys(errors).length||this.state.phase!=='ready',saving:this.state.saving,failed:this.state.failed}}}
  publish(){if(!this.disposed)for(const listener of this.listeners)listener(this.snapshot())}
  live(epoch){return !this.disposed&&epoch===this.epoch}
  begin(){this.abort?.abort();this.abort=new AbortController();return ++this.epoch}
  async request(action,epoch){
    const response=await this.fetch(action?`${RAG_API}/action`:RAG_API,{method:action?'POST':'GET',cache:'no-store',credentials:'same-origin',signal:this.abort.signal,...(action?{headers:{'content-type':'application/json'},body:JSON.stringify(action)}:{})})
    if(!this.live(epoch))return null
    if(!(response.headers.get('content-type')||'').includes('json'))throw {status:response.status}
    const data=await response.json();if(!this.live(epoch))return null
    if(!response.ok)throw {status:response.status,code:Object.hasOwn(safeCodes,data?.error)?data.error:''}
    return data
  }
  accept(data){const providerCatalog=publicProviderCatalog(data.providerCatalog);this.baseline=publicDocument(data,providerCatalog);this.state={...this.state,draft:copy(this.baseline),catalog:publicCatalog(data.modelCatalog),providerCatalog,phase:'ready',error:'',failed:false}}
  load=async()=>{
    if(this.disposed||this.state.saving)return
    const epoch=this.begin();this.state={...this.state,phase:'loading',error:'',saved:false};this.publish()
    try{const data=await this.request(null,epoch);if(!this.live(epoch))return;this.accept(data)}catch(error){if(!this.live(epoch))return;this.baseline=null;this.state={...this.state,phase:'error',draft:null,error:statusMessage(error?.status)}}
    if(this.live(epoch))this.publish()
  }
  edit=(role,field,value)=>{
    if(!this.state.draft||this.state.saving||this.state.phase!=='ready')return
    const draft=copy(this.state.draft)
    if(role){
      const model=draft.models[role],oldRoute=ROUTE.map(key=>model[key])
      model[field]=value
      if(field==='protocol'&&value==='volc-visual-ocr')model.source='independent'
      if(['imageEnabled','imageDocumentInstructions','imageQueryInstructions','multimodalQueryInstructions'].includes(field))model.imageFieldsKnown=true
      if(ROUTE.some((key,index)=>model[key]!==oldRoute[index])){clearDraftKeys(model);model.preset='custom'}
      if(field==='provider'&&model.source==='harness')model.model=''
      if(field==='model'&&model.protocol==='vikingdb-rerank'&&value==='base-multilingual-rerank')model.instruction=''
      for(const secret of CREDENTIALS){if(field===CLEAR[secret]&&value)model[secret]='';if(field===secret&&value)model[CLEAR[secret]]=false}
    }else draft[field]=value
    this.state={...this.state,draft,error:'',saved:false,failed:false};this.publish()
  }
  preset=(role,id)=>{
    if(!this.state.draft||this.state.saving||this.state.phase!=='ready'||!ROLES.includes(role))return
    const preset=this.state.providerCatalog.presets.find(value=>value.id===id&&value.roles.includes(role))
    if(id!=='custom'&&!preset)return
    const draft=copy(this.state.draft),model=draft.models[role]
    clearDraftKeys(model)
    if(preset){Object.assign(model,{reasoningEffort:'',dimensions:'1024',queryInstructions:'',documentInstructions:'',imageEnabled:false,imageFieldsKnown:Object.hasOwn(preset.config,'imageEnabled'),imageDocumentInstructions:'',imageQueryInstructions:'',multimodalQueryInstructions:'',region:'cn-beijing',instruction:''});for(const [field,value]of Object.entries(preset.config))model[field]=value}
    model.preset=id
    this.state={...this.state,draft,error:'',saved:false,failed:false};this.publish()
  }
  reset=(role,field)=>{if(this.baseline)this.edit(role,field,role?this.baseline.models[role][field]:this.baseline[field])}
  discard=()=>{if(this.disposed)return;this.begin();this.state={...this.state,draft:this.baseline?copy(this.baseline):null,saving:false,phase:this.baseline?'ready':this.state.phase,error:this.baseline?'':this.state.error,saved:false,failed:this.baseline?false:this.state.failed};this.publish()}
  save=async()=>{
    const shell=this.snapshot().shell;if(this.disposed||!shell.dirty||shell.invalid||shell.saving)return
    const epoch=this.begin();this.state={...this.state,saving:true,failed:false,error:'',saved:false};this.publish();let accepted=false
    try{
      await this.request({action:'settings',settings:writeSettings(this.state.draft)},epoch);if(!this.live(epoch))return;accepted=true
      for(const role of ROLES)clearDraftKeys(this.state.draft.models[role]);this.publish()
      const data=await this.request(null,epoch);if(!this.live(epoch))return;this.accept(data);this.state.saved=true
    }catch(error){
      if(!this.live(epoch))return
      const revoked=[401,403,404].includes(error?.status)
      if(accepted||revoked){this.baseline=null;this.state.draft=null}
      this.state={...this.state,phase:accepted||revoked?'error':'ready',failed:true,error:accepted?'设置已提交，读取确认失败。请重试读取设置。':safeCodes[error?.code]||statusMessage(error?.status)}
    }finally{if(this.live(epoch)){this.state.saving=false;this.publish()}}
  }
  dispose=()=>{this.disposed=true;this.epoch++;this.abort?.abort();this.baseline=null;this.state={...this.state,draft:null,saving:false,phase:'loading',error:'',saved:false,failed:false};this.listeners.clear()}
}
