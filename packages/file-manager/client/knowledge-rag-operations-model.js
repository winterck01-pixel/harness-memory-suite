import {RAG_API} from './knowledge-rag-model.js'
const text=value=>typeof value==='string'?value:''
const count=value=>Number.isSafeInteger(value)&&value>=0?value:0
const revision=value=>typeof value==='string'||Number.isSafeInteger(value)?value:null
const errors={RERANK_IMAGE_CONSENT_REQUIRED:'已跳过图文重排：需要本次候选图片外发授权。',RERANK_IMAGE_UNSUPPORTED:'当前重排模型不支持图片，本次保留原检索排序。',RERANK_IMAGE_BUDGET_EXCEEDED:'图文重排超过 3 张候选图片或 20 MB 总预算，已保留原排序。',RERANK_IMAGE_UNAVAILABLE:'无法加载已索引候选图片，已保留原排序。',RERANK_IMAGE_CHANGED:'候选图片与索引不一致，请重新索引；本次未外发图片。',DASHSCOPE_CREDENTIAL_NOT_CONFIGURED:'请在候选重排中保存百炼 API Key。',DASHSCOPE_RERANK_FAILED:'百炼未成功重排，请核对模型开通状态、地域和凭据。',RERANK_NOT_CONFIGURED:'请先保存并启用候选重排。',INVALID_RERANK_RESPONSE:'重排服务返回的评分或索引不完整。',RERANK_INPUT_TOO_LARGE:'重排输入超过保守安全预算，请缩小查询、分块或候选数量；检索保留原排序。',RERANK_BATCH_TOO_LARGE:'候选数量超过该重排模型限制。',RERANK_FAILED_HYBRID_FALLBACK:'本次重排失败，结果使用原检索排序。',VIKING_CREDENTIAL_NOT_CONFIGURED:'请配置重排 AK/SK。',EMBEDDING_INDEX_REQUIRED:'部分资料尚无当前配置的向量索引。请选中资料并授权远程处理后重建；保存模型配置不会自动发送资料。',EMBEDDING_REBUILD_REQUIRED:'向量配置已改变，请重新建立所选资料的向量索引。',SEMANTIC_FAILED_KEYWORD_FALLBACK:'查询向量生成失败，本次仅使用关键词检索。',EMBEDDING_NOT_CONFIGURED:'请先保存并启用向量模型。',PROVIDER_HTTP_401:'模型服务拒绝凭据（401），请检查 API Key。',PROVIDER_HTTP_403:'模型服务拒绝访问（403），请检查模型开通状态和权限。',PROVIDER_HTTP_404:'接口或模型不存在（404），请检查地址和模型 ID。',PROVIDER_HTTP_429:'模型服务限流或额度不足（429），请检查配额。',PROVIDER_NETWORK_FAILED:'无法连接模型服务，请稍后重试。',INVALID_EMBEDDING_RESPONSE:'向量返回格式或维度不符合配置。',SOURCE_REVISION_REQUIRED:'请刷新后重新选择资料版本与授权。',IMAGE_INDEX_REQUIRED:'尚无可用图片向量索引，请先明确选择页范围建立索引。',REMOTE_PROCESSING_REQUIRES_CONSENT:'此处理需要本次明确外发授权。',REMOTE_PROCESSING_DISABLED:'远程处理已关闭，请检查已保存设置。',ARK_CREDENTIAL_NOT_CONFIGURED:'当前向量路由尚未配置凭据。',INVALID_OCR_RESPONSE:'OCR 服务未返回有效文字。',SOURCE_TOO_LARGE:'源文件超过处理预算。',SOURCE_TEXT_TOO_LARGE:'所选文字超过处理预算，请缩小范围。',UNSUPPORTED_FORMAT:'当前处理不支持此文件格式。',DOCUMENT_TOO_LARGE:'文档超过处理预算。',AUTHORIZATION_CHANGED:'访问权限或处理配置已改变，请刷新后重新选择并授权。',REVISION_CHANGED:'条目已修改，请刷新后重试。',SOURCE_REVISION_CHANGED:'资料版本已改变，请刷新后重新选择资料与授权。',SOURCE_CHANGED:'源文件已改变，请刷新后重新选择。',INDEX_SOURCE_CHANGED:'索引期间源或配置已改变，请刷新后重试。',AMBIGUOUS_SCOPE:'项目归属与全部项目共享不能同时设置。',INVALID_PROJECT_SCOPE:'项目路径不符合要求。',INVALID_QUERY:'查询不能为空，且最多 1000 个字符。',KNOWLEDGE_NOT_ACCESSIBLE:'所选资料不可访问或不含可读取的源文件。',PROCESSING_UNAVAILABLE:'本机缺少处理此文件所需的能力。',IMAGE_PAGE_SELECTION_REQUIRED:'请选择 1–3 个不同页码，页码为 1–500 的整数。',SELECTED_IMAGE_CONSENT_REQUIRED:'图片索引需要所选页范围及本次外发授权。',QUERY_IMAGE_CONSENT_REQUIRED:'图片查询需要所选查询图片与本次外发授权。',IMAGE_PAGES_UNAVAILABLE:'所选页无法提供完整图片，请重新选择。',IMAGE_BUDGET_EXCEEDED:'所选图片总量超过处理预算，请缩小范围。',INVALID_IMAGE_EMBEDDING_INPUT:'图片格式、尺寸或大小不符合向量服务限制。',IMAGE_INDEX_REQUIRES_REMOTE_CONFIGURATION:'请先保存并启用远程处理、向量角色及直接图片向量能力。',IMAGE_QUERY_REQUIRES_REMOTE_CONFIGURATION:'请先保存并启用远程处理及直接图片向量能力。',IMAGE_EMBEDDING_NOT_CONFIGURED:'图片向量能力尚未配置。',INVALID_QUERY_IMAGE_REFERENCE:'请选择知识库内的可信来源与有效页码，不能使用 URL 或路径。',OCR_CONFIGURED_REQUIRES_REMOTE:'使用已配置 OCR 必须确认本次外发。',OCR_NOT_CONFIGURED:'OCR 角色尚未启用或配置。',VISUAL_OCR_CREDENTIAL_NOT_CONFIGURED:'专用 OCR 当前路由尚未配置 AK/SK。',OCR_INPUT_TOO_LARGE:'专用 OCR 编码后请求超出预算，请缩小所选范围。',VISUAL_OCR_FAILED:'专用 OCR 请求未成功，请检查服务配置。',INVALID_OCR_ENGINE:'请选择支持的 OCR 引擎。',SOURCE_CHANGED_REINDEX_REQUIRED:'源文件已修改，请重新索引。'}
const failure=status=>status===401?'登录已失效，请重新登录。':status===403?'当前账号无权执行此操作。':status===404?'知识库核心未加载。':'操作未完成，请重试。'
export function parsePages(value){
  const parts=typeof value==='string'?value.split(/[，,\s]+/).filter(Boolean):[]
  if(!parts.length||parts.length>3||parts.some(value=>!/^\d+$/.test(value)))return null
  const pages=parts.map(Number)
  return new Set(pages).size===pages.length&&pages.every(value=>Number.isSafeInteger(value)&&value>=1&&value<=500)?pages:null
}
const validPages=pages=>Array.isArray(pages)&&pages.length>0&&pages.length<=3&&new Set(pages).size===pages.length&&pages.every(value=>Number.isSafeInteger(value)&&value>=1&&value<=500)
function citation(value){
  if(!value||typeof value!=='object')return null
  const location=value.location&&typeof value.location==='object'?value.location:{}
  return {entryId:text(value.entryId),adapter:text(value.adapter),sourceId:text(value.sourceId),partId:text(value.partId),revision:revision(value.revision),chunkId:text(value.chunkId),imageHash:text(value.imageHash),sourceFingerprint:text(value.sourceFingerprint),location:{pageNumber:Number.isSafeInteger(location.pageNumber)?location.pageNumber:null,section:text(location.section),blockId:text(location.blockId),chunkIndex:Number.isSafeInteger(location.chunkIndex)?location.chunkIndex:null}}
}
export class RagOperationsController {
  constructor(fetchImpl=(...args)=>fetch(...args)){this.fetch=fetchImpl;this.listeners=new Set();this.epoch=0;this.disposed=false;this.abort=null;this.state={busy:false,loading:true,error:'',message:'',records:[],capabilities:[],results:[],warnings:[],remote:{enabled:false,imageReady:false,ocrReady:false,ocrProtocol:''}}}
  activate=()=>{this.disposed=false}
  subscribe=listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener)}
  snapshot=()=>this.state
  publish(){if(!this.disposed)for(const listener of this.listeners)listener(this.state)}
  live(epoch){return !this.disposed&&epoch===this.epoch}
  invalidate=()=>{if(this.disposed)return;this.epoch++;this.abort?.abort();this.state={...this.state,busy:false,error:'',message:'',results:[],warnings:[]};this.publish()}
  reject(message){if(!this.disposed&&!this.state.busy){this.state={...this.state,error:message,message:'',results:[],warnings:[]};this.publish()}return Promise.resolve()}
  async request(body,epoch){
    const response=await this.fetch(body?`${RAG_API}/action`:RAG_API,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:this.abort.signal,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})})
    if(!this.live(epoch))return null
    if(!(response.headers.get('content-type')||'').includes('json'))throw {status:response.status}
    const data=await response.json();if(!this.live(epoch))return null
    if(!response.ok)throw {status:response.status,code:Object.hasOwn(errors,data?.error)?data.error:''}
    return data
  }
  accept(data){
    const settings=data?.settings||{},embedding=settings.models?.embedding||{},ocr=settings.models?.ocr||{}
    this.state={...this.state,remote:{enabled:settings.enabled===true,imageReady:settings.enabled===true&&embedding.enabled===true&&embedding.imageEnabled===true&&embedding.protocol==='ark-multimodal',ocrReady:settings.enabled===true&&ocr.enabled===true&&['openai-chat','volc-visual-ocr'].includes(ocr.protocol),ocrProtocol:text(ocr.protocol)},records:(Array.isArray(data?.status)?data.status:[]).map(row=>({id:text(row.id),title:text(row.title)||text(row.id),revision:revision(row.revision),projectId:text(row.projectId),shared:row.shared===true,needsRebuild:row.needsRebuild===true,needsSemanticIndex:row.needsSemanticIndex===true,embeddingError:errors[row.embeddingError]||(row.embeddingError?'上次向量生成失败，请测试连接后重试。':''),semantic:row.semantic===true,textChunks:count(row.textChunks),imageChunks:count(row.imageChunks),hasImageIndex:row.hasImageIndex===true,pageNumbers:validPages(row.pageNumbers)?[...row.pageNumbers]:null})),capabilities:Object.entries(data?.capabilities||{}).filter(([,value])=>typeof value==='boolean').map(([name,available])=>({name,available}))}
  }
  async run(body){
    if(this.disposed||this.state.busy&&body)return
    this.abort?.abort();this.abort=new AbortController();const epoch=++this.epoch
    this.state={...this.state,busy:true,error:'',message:'',results:[],warnings:[]};this.publish();let accepted=false
    try{
      const data=await this.request(body,epoch);if(!this.live(epoch))return
      if(!body)this.accept(data)
      else if(body.action==='testRerank'){this.state={...this.state,message:`重排接口通过：返回 ${count(data.documents)} 条有效评分。语义样例${data.topIndex===1?'符合预期':'排序未符合预期，请检查模型'}。`}}
      else if(body.action==='testEmbedding'){this.state={...this.state,message:`向量连接通过：文档与查询均返回 ${count(data.dimensions)} 维向量。资料索引仍需单独建立。`}}
      else if(body.action==='search'){
        const image=!!body.queryImage
        this.state={...this.state,results:(Array.isArray(data.results)?data.results:[]).map(row=>({id:text(row.id),title:text(row.title),summary:row.modality==='image'?'':text(row.summary),modality:row.modality==='image'?'image':'text',textMethod:text(row.textMethod),score:Number.isFinite(row.score)?row.score:null,citation:citation(row.citation)})),warnings:(Array.isArray(data.warnings)?data.warnings:[]).filter(value=>typeof value==='string'&&Object.hasOwn(errors,value)).map(value=>errors[value]),message:image?`检索完成（图片向量召回${body.query.trim()?' + 文字关键词':''}）。`:`检索完成（${data.mode==='hybrid'?'混合检索':'关键词检索'}）。`}
      }else{
        accepted=true
        this.state.message=body.action==='scope'?'访问范围已更新。':`索引完成：${count(data.chunks)} 个片段，${data.semantic?'语义索引':'关键词索引'}。${body.pageNumbers?'已替换为本次所选页的索引。':''}${data.degraded?'远程向量未完成：'+(errors[data.degraded]||'请测试连接后重试。')+'已保留关键词索引。':''}`
        const refreshed=await this.request(null,epoch);if(!this.live(epoch))return;this.accept(refreshed)
      }
    }catch(error){
      if(!this.live(epoch))return
      const revoked=[401,403,404].includes(error.status)
      this.state={...this.state,error:accepted?'操作已提交，读取确认失败。请刷新状态，不要重复提交。':errors[error.code]||failure(error.status),...(revoked?{records:[],results:[],capabilities:[]}:{})}
    }finally{if(this.live(epoch)){this.state={...this.state,busy:false,loading:false};this.publish()}}
  }
  testRerank=()=>this.run({action:'testRerank',consent:'synthetic-test'})
  testEmbedding=()=>this.run({action:'testEmbedding',consent:'synthetic-test'})
  load=()=>this.run(null)
  index=(id,allowRemote=false,options={})=>{
    const body={action:'index',id,allowRemote:allowRemote===true,consent:'selected-document'}
    if(!id)return this.reject('请先选择知识条目。')
    if(options.ocrEngine!==undefined){if(!['auto','local','configured'].includes(options.ocrEngine))return this.reject(errors.INVALID_OCR_ENGINE);body.ocrEngine=options.ocrEngine}
    if(options.indexImages===true){if(!allowRemote)return this.reject(errors.SELECTED_IMAGE_CONSENT_REQUIRED);if(!this.state.remote.imageReady)return this.reject(errors.IMAGE_INDEX_REQUIRES_REMOTE_CONFIGURATION);body.indexImages=true;body.imageConsent='selected-pages'}
    if(options.pageNumbers!==undefined){if(!validPages(options.pageNumbers))return this.reject(errors.IMAGE_PAGE_SELECTION_REQUIRED);body.pageNumbers=[...options.pageNumbers]}
    if(options.indexImages===true&&!body.pageNumbers)return this.reject(errors.IMAGE_PAGE_SELECTION_REQUIRED)
    if(options.ocrEngine==='configured'){if(!allowRemote)return this.reject(errors.OCR_CONFIGURED_REQUIRES_REMOTE);if(!this.state.remote.ocrReady)return this.reject(errors.OCR_NOT_CONFIGURED)}
    if(options.indexImages===true||options.ocrEngine==='configured'){
      const row=this.state.records.find(row=>row.id===id)
      if(!row||typeof options.revision!=='string'||!options.revision||row.revision!==options.revision)return this.reject(errors.SOURCE_REVISION_CHANGED)
      body.revision=options.revision
    }
    return this.run(body)
  }
  search=(query,allowRemote=false,options={})=>{
    const image=options.queryImage
    if(typeof query!=='string'||query.length>1000||!query.trim()&&!image)return this.reject(errors.INVALID_QUERY)
    const body={action:'search',query,allowRemote:allowRemote===true,consent:'query-and-candidates',...(allowRemote&&options.rerankImages===true?{rerankImageConsent:'retrieved-images'}:{})}
    if(image){
      if(!allowRemote)return this.reject(errors.QUERY_IMAGE_CONSENT_REQUIRED)
      if(!this.state.remote.imageReady)return this.reject(errors.IMAGE_QUERY_REQUIRES_REMOTE_CONFIGURATION)
      const row=this.state.records.find(row=>row.id===image.id)
      if(!row||Object.keys(image).some(key=>!['id','pageNumber','revision'].includes(key))||!validPages([image.pageNumber]))return this.reject(errors.INVALID_QUERY_IMAGE_REFERENCE)
      if(typeof image.revision!=='string'||!image.revision||row.revision!==image.revision)return this.reject(errors.SOURCE_REVISION_CHANGED)
      body.queryImage={id:row.id,pageNumber:image.pageNumber,revision:image.revision};body.imageConsent='selected-query-image'
    }
    return this.run(body)
  }
  scope=(row,projectId,shared)=>row?this.run({action:'scope',id:row.id,updatedAt:row.revision,projectId,shared:shared===true}):Promise.resolve()
  dispose=()=>{this.disposed=true;this.epoch++;this.abort?.abort();this.state={...this.state,busy:false,loading:true,error:'',message:'',records:[],capabilities:[],results:[],warnings:[]};this.listeners.clear()}
}
