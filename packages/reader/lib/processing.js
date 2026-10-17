import {integer,reject} from './validate.js'
import {raster} from './sources.js'

export function createProcessingReader(store,getRag,config){
 async function readPages(input,context){
  const rag=getRag();if(rag?.version!==1||typeof rag.readPages!=='function')reject(503,'PROCESSING_UNAVAILABLE')
  const engine=input.ocrEngine??'auto'
  if(!['auto','local','configured'].includes(engine))reject(400,'INVALID_BUDGET')
  if(engine==='configured'&&input.allowRemote!==true)reject(403,'REMOTE_PROCESSING_REQUIRES_CONSENT')
  const before=await store.get(input.bookId,input.revision)
  if(!['pdf','comic'].includes(before.kind))reject(400,'UNSUPPORTED_FORMAT')
  const start=input.pageNumber??input.startPage??1,count=input.pageNumber?1:input.count??1,limit=input.textLimit??8000,offset=input.textOffset??0
  integer(start,1,before.parts.length);integer(count,1,3);integer(limit,1,input.fullText===true?2000000:8000);integer(offset,0,2000000)
  const selected=before.parts.slice(start-1,start-1+count),pages=[]
  if(input.region){for(const part of selected)if(store.assertSourceAccess)await store.assertSourceAccess(input.bookId,part.id,context,before.revision);throw Object.assign(Error('PROCESSING_UNAVAILABLE: REGION_CROP'),{code:'PROCESSING_UNAVAILABLE',capability:'REGION_CROP'})}
  if(input.signal?.aborted)throw input.signal.reason??Error('ABORT_ERR')
  let remaining=limit,imageRemaining=Math.min(config.maxImageBytes,20*1024*1024)
  for(let i=0;i<selected.length;i++){
   const part=selected[i];if(store.assertSourceAccess)await store.assertSourceAccess(input.bookId,part.id,context,before.revision)
   const asset=await store.asset(input.bookId,before.revision,before.kind==='pdf'?'document':part.id)
   const result=await rag.readPages({bytes:asset.bytes,filename:before.kind==='pdf'?'reader.pdf':`reader.${asset.mime==='image/jpeg'?'jpg':asset.mime==='image/webp'?'webp':'png'}`,mediaType:asset.mime,pageNumbers:[before.kind==='pdf'?start+i:1],mode:input.mode??(engine==='configured'?'ocr':'auto'),ocrEngine:engine,textBudget:2000000,imageBudget:input.includeImages?imageRemaining:0,signal:input.signal,allowRemote:input.allowRemote===true,beforeRemote:async()=>{
    input.signal?.throwIfAborted()
    const epoch=store.authorizationEpoch?.();let verify
    if(input.beforeRemote!==undefined){if(typeof input.beforeRemote!=='function')reject(400,'INVALID_BUDGET');verify=await input.beforeRemote()}
    await store.get(input.bookId,before.revision)
    if(store.assertSourceAccess)await store.assertSourceAccess(input.bookId,part.id,context,before.revision)
    const current=await store.asset(input.bookId,before.revision,before.kind==='pdf'?'document':part.id)
    if(current.hash!==asset.hash)reject(409,'SOURCE_REFERENCE_CHANGED')
    return ()=>{input.signal?.throwIfAborted();verify?.();if(epoch!==store.authorizationEpoch?.())reject(403,'SOURCE_ACCESS_DENIED')}
   }},context)
   await store.get(input.bookId,before.revision)
   if(result.truncated||result.pages?.some(p=>p.truncated))reject(413,'DOCUMENT_TOO_LARGE')
   if(result.sourceFingerprint!==asset.hash)reject(409,'SOURCE_REFERENCE_CHANGED')
   if(!Array.isArray(result.pages)||result.pages.length!==1)reject(409,'SOURCE_REFERENCE_CHANGED')
   const page=result.pages?.find(p=>p.pageNumber===(before.kind==='pdf'?start+i:1));if(!page)reject(503,'PROCESSING_UNAVAILABLE')
   const pageOffset=i===0?offset:0,chars=Array.from(page.text??''),text=chars.slice(pageOffset,pageOffset+remaining).join('');remaining-=Array.from(text).length
   if(page.imageBytes&&page.imageBytes.byteLength>imageRemaining)reject(413,'DOCUMENT_TOO_LARGE')
   if(store.assertSourceAccess)await store.assertSourceAccess(input.bookId,part.id,context,before.revision)
   if(input.includeImages){
    if(!(page.imageBytes instanceof Uint8Array)||!page.imageBytes.byteLength)reject(503,'IMAGE_PAGE_UNAVAILABLE')
    if(page.imageBytes.byteLength>=10*1024*1024)reject(413,'DOCUMENT_TOO_LARGE')
    const dimensions=raster(Buffer.from(page.imageBytes),36_000_000-1)
    if(!['image/png','image/jpeg'].includes(dimensions.mime)||dimensions.width<=14||dimensions.height<=14||page.mime!==dimensions.mime||page.width!==dimensions.width||page.height!==dimensions.height)reject(415,'INVALID_OR_OVERSIZED_RASTER')
    imageRemaining-=page.imageBytes.byteLength
   }
   pages.push({pageNumber:start+i,partId:part.id,title:part.title,text,textMethod:page.textMethod,...(input.fullText===true&&page.blocks?{blocks:page.blocks.map(({text,box,polygon,confidence})=>({text,...(box?{box}:{}),...(polygon?{polygon}:{}),...(confidence!==undefined?{confidence}:{})}))}:{}),offsetUnit:'unicode-codepoints',textOffset:pageOffset,nextTextOffset:pageOffset+Array.from(text).length<chars.length?pageOffset+Array.from(text).length:null,...(input.includeImages&&page.imageBytes?{imageBytes:page.imageBytes,mime:page.mime,width:page.width,height:page.height}:{}),citation:{bookId:input.bookId,revision:before.revision,partId:part.id,pageNumber:start+i,sourceFingerprint:result.sourceFingerprint,textMethod:page.textMethod}})
   if(remaining<=0)break
  }
  if(input.signal?.aborted)throw input.signal.reason??Error('ABORT_ERR')
  await store.get(input.bookId,before.revision)
  for(const part of selected)if(store.assertSourceAccess)await store.assertSourceAccess(input.bookId,part.id,context,before.revision)
  const last=pages.at(-1),nextRead=last?.nextTextOffset!==null&&last?.nextTextOffset!==undefined?{startPage:last.pageNumber,textOffset:last.nextTextOffset}:start+pages.length<=before.parts.length?{startPage:start+pages.length,textOffset:0}:null
  return {bookId:input.bookId,revision:before.revision,pages,nextPage:nextRead?.startPage??null,nextRead}
 }
 return {readPages,readPageImage:readPages,authorizationEpoch:()=>store.authorizationEpoch(),revalidate:async(bookId,revision,context,partIds=[])=>{await store.get(bookId,revision);for(const partId of partIds)await store.assertSourceAccess(bookId,partId,context,revision)}}
}
