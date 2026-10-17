import {statSync,realpathSync} from 'node:fs'
import {selectedPages,validateImage} from './image-input.js'
import { createHarnessProvider } from "./harness-provider.js"
import { createSources } from "./sources.js"
import { lstat,readFile,realpath } from 'node:fs/promises'
import { extname } from 'node:path'
import { createRag } from './rag.js'
import { createProviders,validateSettings,publicSettings,remoteRequestVersion } from './providers.js'
import { inside } from './access.js'
import { createProcessing } from './processing.js'
const MAX_BYTES=20*1024*1024
export function createRuntime({entries,indexTable,settingsTable,access,fetchImpl,authorizeRequest,getLlm}){
 const searchProofs=new WeakMap();
 let settings=validateSettings(settingsTable.get('settings')||{})
 const harness=createHarnessProvider(getLlm||(()=>undefined));
 const providers=createProviders({fetchImpl,harness})
 async function guardedChat(role,content,signal){const snapshot=settings;if(!snapshot.enabled)throw new Error('REMOTE_PROCESSING_DISABLED');const version=remoteRequestVersion(snapshot);const text=await providers.chat(role,content,snapshot,signal);if(version!==remoteRequestVersion(settings))throw new Error('AUTHORIZATION_CHANGED');return text}
 const processing=createProcessing({ocr:async(options,context)=>{access.assert(context);const snapshot=settings,version=remoteRequestVersion(snapshot);const result=snapshot.models.ocr.protocol==='volc-visual-ocr'?await providers.ocr(options,snapshot,options.signal):{text:await guardedChat('ocr',[{type:'text',text:'Transcribe this document page accurately. Return only its text.'},{type:'image_url',image_url:{url:'data:'+options.mediaType+';base64,'+Buffer.from(options.bytes).toString('base64')}}],options.signal),textMethod:'vision',ocrLanguages:[],confidence:null};if(version!==remoteRequestVersion(settings))throw new Error('AUTHORIZATION_CHANGED');return result},vision:async(options,context)=>{
  access.assert(context);if(options.allowRemote!==true)throw new Error('REMOTE_PROCESSING_REQUIRES_CONSENT')
  const role=options.role==='ocr'&&settings.models.ocr.enabled&&settings.models.ocr.protocol==='openai-chat'?'ocr':'vision';return guardedChat(role,options.content,options.signal)
 }})
 async function sourcePath(e,context){const path=e.assetId.slice(5),canonical=await realpath(path),stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isFile())throw new Error('UNSAFE_SOURCE');if(!context.operator&&!e.sourceGranted&&(!inside(context.projectId,path)||!inside(context.projectId,canonical)))throw new Error('SOURCE_OUTSIDE_PROJECT');if(stat.size>MAX_BYTES)throw new Error('SOURCE_TOO_LARGE');return {path:canonical,stamp:[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':')}}
 const rag=createRag({loadRerankImage:(c,context,signal)=>loadQueryImage({id:c.id,revision:c.e.updatedAt,pageNumber:c.chunk.location.pageNumber},context,signal),entries,indexTable,getSettings:()=>settings,providers,canAccess:access.canAccess,
  async validateSource(e,indexed,context){if(!e.assetId?.startsWith('file:'))return true;try{return (await sourcePath(e,context)).stamp===indexed.sourceStamp}catch{return false}},
  async readSource(e,{id,signal,allowRemote,context,indexImages,pageNumbers,ocrEngine}){if(!e.assetId?.startsWith('file:'))return {pages:[{text:[e.content,e.extractedText].filter(Boolean).join('\n'),textMethod:'text'}]};const entryKey=id,remoteVersion=remoteRequestVersion(settings);const before=await sourcePath(e,context),bytes=await readFile(before.path,{signal});if(bytes.length>MAX_BYTES)throw new Error('SOURCE_TOO_LARGE');const output=await processing.readPages({bytes,filename:before.path,mediaType:extname(before.path),beforeRemote:async()=>{const current=await sourcePath(e,context);const now=entries.get(entryKey);if(!now||now.deletedAt||!access.canAccess(now,context)||now.updatedAt!==e.updatedAt||current.stamp!==before.stamp||remoteVersion!==remoteRequestVersion(settings))throw new Error('AUTHORIZATION_CHANGED');return ()=>{const latest=entries.get(entryKey);if(!latest||latest.deletedAt||latest.updatedAt!==e.updatedAt||!access.canAccess(latest,context)||remoteVersion!==remoteRequestVersion(settings))throw new Error('AUTHORIZATION_CHANGED')}},mode:indexImages&&ocrEngine!=='configured'?'render':ocrEngine==='configured'?'ocr':'auto',ocrEngine,pageNumbers,allowRemote,signal,textBudget:2000000,imageBudget:indexImages?MAX_BYTES:0},context);if(output.truncated||output.pages.some(p=>p.truncated))throw new Error("SOURCE_TEXT_TOO_LARGE");const after=await sourcePath(e,context);if(before.stamp!==after.stamp)throw new Error('SOURCE_CHANGED');return {pages:output.pages,stamp:after.stamp}}
 })
 const sources=createSources({indexTable,getSettings:()=>settings,providers,access});
 async function loadQueryImage(ref,context,signal){if(typeof ref?.revision!=='string'||!ref.revision)throw new Error('SOURCE_REVISION_REQUIRED');if(!ref||typeof ref!=='object'||ref.bytes||ref.url||ref.path)throw new Error('INVALID_QUERY_IMAGE_REFERENCE');if(ref.adapter)return sources.queryImage(ref,context,signal);if(typeof ref.id!=='string')throw new Error('INVALID_QUERY_IMAGE_REFERENCE');selectedPages([ref.pageNumber]);const e=entries.get(ref.id);if(!e||e.deletedAt||!access.canAccess(e,context)||!e.assetId?.startsWith('file:'))throw new Error('KNOWLEDGE_NOT_ACCESSIBLE');if(e.updatedAt!==ref.revision)throw new Error('SOURCE_REVISION_CHANGED');const before=await sourcePath(e,context);const guard=()=>{const now=entries.get(ref.id);if(!now||now.deletedAt||now.updatedAt!==e.updatedAt||now.assetId!==e.assetId||!access.canAccess(now,context))throw new Error('AUTHORIZATION_CHANGED');const st=statSync(before.path);if(realpathSync(e.assetId.slice(5))!==before.path||[st.dev,st.ino,st.size,st.mtimeMs,st.ctimeMs].join(':')!==before.stamp)throw new Error('SOURCE_CHANGED')};guard();const bytes=await readFile(before.path,{signal});guard();const output=await processing.readPages({bytes,filename:before.path,mode:'render',pageNumbers:[ref.pageNumber],imageBudget:MAX_BYTES,allowRemote:false,signal},context);const after=await sourcePath(e,context);guard();if(before.stamp!==after.stamp||output.pages.length!==1)throw new Error('SOURCE_CHANGED');return {image:validateImage({bytes:output.pages[0].imageBytes,mediaType:output.pages[0].mime}),guard}}
 const api={version:1,contextForExecution:access.forExecution,registerSourceAdapter:sources.registerSourceAdapter,indexSource:sources.indexSource,searchSources:sources.searchSources,
  contextForRequest(request){if(!authorizeRequest||!(request instanceof Request)||!authorizeRequest(request))throw new Error('AUTHENTICATED_REQUEST_REQUIRED');return access.operator;},
  async search(args,context){access.assert(context);if(args.queryImage&&(args.allowRemote!==true||args.imageConsent!=='selected-query-image'))throw new Error('QUERY_IMAGE_CONSENT_REQUIRED');const authorization=sources.captureAuthorization(args);const image=args.queryImage?await loadQueryImage(args.queryImage,context,args.signal):null;const assertAuthorization=()=>{authorization();image?.guard()};assertAuthorization();args={...args,rerankImageBudget:{count:0,bytes:0},assertQueryAuthorization:assertAuthorization,...(image?{queryImage:image.image}:{})};const result=await access.run(context,async()=>{const local=await rag.search(args,context),external=await sources.searchSources(args,context);if(image&&local.warnings.includes('IMAGE_INDEX_REQUIRED')&&external.warnings.includes('IMAGE_INDEX_REQUIRED'))throw new Error('IMAGE_INDEX_REQUIRED');return {results:[...local.results,...external.results].sort((a,b)=>b.score-a.score).slice(0,args.limit??8),mode:local.mode==='hybrid'||external.mode==='hybrid'?'hybrid':'keyword',warnings:[...new Set([...local.warnings,...external.warnings])].filter(w=>w!=='IMAGE_INDEX_REQUIRED'),untrustedContent:true}});assertAuthorization();for(const row of result.results){if(row.citation?.adapter)continue;const current=entries.get(row.id);if(!current||current.deletedAt||!access.canAccess(current,context)||current.updatedAt!==row.citation.revision)throw new Error('AUTHORIZATION_CHANGED')}searchProofs.set(result,()=>access.run(context,()=>{assertAuthorization();for(const row of result.results){if(row.citation?.adapter)continue;const current=entries.get(row.id);if(!current||current.deletedAt||!access.canAccess(current,context)||current.updatedAt!==row.citation.revision)throw new Error("AUTHORIZATION_CHANGED")}}));return result;},
  assertSearchResult(result){const verify=searchProofs.get(result);if(verify)verify();else sources.assertSearchResult(result)},
  async index(args,context){access.assert(context);if(args.indexImages||args.ocrEngine==='configured'){if(typeof args.revision!=='string'||!args.revision)throw new Error('SOURCE_REVISION_REQUIRED');if(entries.get(args.id)?.updatedAt!==args.revision)throw new Error('SOURCE_REVISION_CHANGED')}if(args.indexImages){selectedPages(args.pageNumbers);if(args.allowRemote!==true||args.imageConsent!=='selected-pages')throw new Error('SELECTED_IMAGE_CONSENT_REQUIRED')}return access.run(context,()=>rag.index(args,context))},
  status(context){access.assert(context);return access.run(context,()=>rag.status(context))},
  listModels(context){if(!access.assert(context).operator)throw new Error('OPERATOR_REQUIRED');return harness.list()},
  getSettings(context){if(!access.assert(context).operator)throw new Error('OPERATOR_REQUIRED');return publicSettings(settings)},
  async testRerank(context,signal){
   if(!access.assert(context).operator)throw new Error('OPERATOR_REQUIRED');
   const snapshot=settings,version=remoteRequestVersion(snapshot);
   if(!snapshot.enabled)throw new Error('REMOTE_PROCESSING_DISABLED');
   if(!snapshot.models.rerank.enabled)throw new Error('RERANK_NOT_CONFIGURED');
   const guard=()=>{access.assert(context);if(version!==remoteRequestVersion(settings))throw new Error('AUTHORIZATION_CHANGED')};guard();
   const rows=await providers.rerank('Which food is a fruit?',['A wrench is a metal tool.','An apple is a fruit.'],snapshot,signal);guard();
   if(!rows?.length)throw new Error('INVALID_RERANK_RESPONSE');
   return {ok:true,documents:rows.length,topIndex:[...rows].sort((a,b)=>b.relevance_score-a.relevance_score)[0].index};
  },
  async testEmbedding(context,signal){
   if(!access.assert(context).operator)throw new Error('OPERATOR_REQUIRED');
   const snapshot=settings,version=remoteRequestVersion(snapshot);
   if(!snapshot.enabled)throw new Error('REMOTE_PROCESSING_DISABLED');
   const guard=()=>{access.assert(context);if(version!==remoteRequestVersion(settings))throw new Error('AUTHORIZATION_CHANGED')};
   const doc=(await providers.embed(['Public connectivity test: apples are fruit.'],snapshot,signal,{purpose:'document',assertAuthorization:guard}))[0];
   const query=(await providers.embed(['What is a fruit?'],snapshot,signal,{purpose:'query',assertAuthorization:guard}))[0];guard();
   if(!doc?.length||doc.length!==query?.length)throw new Error('EMBEDDING_DIMENSION_MISMATCH');
   return {ok:true,dimensions:doc.length,document:true,query:true};
  },
  async updateSettings(input,context){if(!access.assert(context).operator)throw new Error('OPERATOR_REQUIRED');const next=validateSettings(input,settings);await settingsTable.put('settings',next);settings=next;return publicSettings(settings)},
  async analyzeImage(args,context){access.assert(context);if(args.allowRemote!==true)throw new Error('REMOTE_PROCESSING_REQUIRES_CONSENT');if(!(args.bytes instanceof Uint8Array)||args.bytes.byteLength>20*1024*1024||!['image/png','image/jpeg','image/webp'].includes(args.mediaType))throw new Error('INVALID_IMAGE');if(typeof args.question!=='string'||args.question.length>2000)throw new Error('INVALID_QUERY');const content=[{type:'text',text:args.question},{type:'image_url',image_url:{url:'data:'+args.mediaType+';base64,'+Buffer.from(args.bytes).toString('base64')}}];return {text:await guardedChat('vision',content,args.signal),method:'vision',untrustedContent:true}},
  async processText(args,context){access.assert(context);if(args.allowRemote!==true)throw new Error('REMOTE_PROCESSING_REQUIRES_CONSENT');if(typeof args.text!=='string'||args.text.length>20000)throw new Error('TEXT_TOO_LARGE');return {text:await guardedChat('text',args.text,args.signal),method:'model',untrustedContent:true}},
  readPages(args,context){access.assert(context);return processing.readPages(args,context)},
  convertDocument(args,context){access.assert(context);return processing.convertDocument(args,context)},
  capabilities:()=>processing.capabilities(),
  processingStats:()=>processing.stats(),
  close:()=>{sources.close();processing.close()},
 }

 for(const name of ['search','index','indexSource','searchSources','status','analyzeImage','processText','readPages','convertDocument']){
  const fn=api[name];api[name]=(...args)=>access.run(access.assert(args[name==='status'?0:1]),()=>fn(...args));
 }
 return api
}
