import {createHash} from 'node:crypto'
import {reject} from './validate.js'

export function createReaderSourceAdapter(store,processing){
 async function resolve({sourceId,partId,revision,signal},context){
  signal?.throwIfAborted();await store.assertSourceAccess(sourceId,partId,context)
  const book=await store.get(sourceId);if(revision!==undefined&&String(book.revision)!==String(revision))reject(409,'SOURCE_REVISION_CHANGED');const part=book.parts.find(p=>p.id===partId);if(!part)reject(404,'CHAPTER_NOT_FOUND')
  await store.assertSourceAccess(sourceId,partId,context,book.revision)
  const sourceFingerprint=createHash('sha256').update(JSON.stringify({bookId:sourceId,revision:book.revision,part})).digest('hex')
  return {sourceId,partId,revision:String(book.revision),title:`${book.title} · ${part.title}`,sourceFingerprint}
 }
 async function readPages(input,context){
  const before=await resolve(input,context);if(before.revision!==String(input.revision))reject(409,'SOURCE_REFERENCE_CHANGED')
  const book=await store.get(input.sourceId,Number(input.revision)),part=book.parts.find(p=>p.id===input.partId),pages=[]
  if(['pdf','comic'].includes(book.kind)){
   const physical=book.parts.indexOf(part)+1
   if(input.pageNumbers!==undefined&&(!Array.isArray(input.pageNumbers)||input.pageNumbers.length!==1||input.pageNumbers[0]!==physical))reject(400,'INVALID_BUDGET')
   if(input.indexImages&&input.pageNumbers===undefined)reject(400,'INVALID_BUDGET')
   const queryRender=input.mode==='render'&&input.allowRemote===false
   if(input.indexImages&&!queryRender&&input.allowRemote!==true)reject(403,'REMOTE_PROCESSING_REQUIRES_CONSENT')
   if(input.allowRemote===true&&(input.consent!=='selected-document'||input.indexImages&&input.imageConsent!=='selected-pages'))reject(403,'REMOTE_PROCESSING_REQUIRES_CONSENT')
   const beforeRemote=async()=>{
    input.signal?.throwIfAborted()
    const epoch=store.authorizationEpoch()
    const current=await resolve({...input,revision:before.revision},context)
    if(current.sourceFingerprint!==before.sourceFingerprint)reject(409,'SOURCE_REFERENCE_CHANGED')
    let verify;if(input.beforeRemote!==undefined){if(typeof input.beforeRemote!=='function')reject(400,'INVALID_BUDGET');verify=await input.beforeRemote()}
    return ()=>{input.signal?.throwIfAborted();verify?.();if(store.authorizationEpoch()!==epoch)reject(403,'SOURCE_ACCESS_DENIED')}
   }
   const result=await processing.readPages({bookId:input.sourceId,revision:book.revision,startPage:physical,count:1,textOffset:0,textLimit:2000000,fullText:true,includeImages:input.indexImages===true,
    mode:queryRender?'render':input.ocrEngine==='configured'?'ocr':input.indexImages?'render':'auto',ocrEngine:queryRender?'local':input.ocrEngine??'auto',allowRemote:queryRender?false:input.allowRemote===true,beforeRemote,signal:input.signal},context)
   const page=result.pages[0];if(!page||page.nextTextOffset!==null)reject(413,'DOCUMENT_TOO_LARGE')
   pages.push({...page,section:part.title,textOffset:0})
  }else{
   let total=0
   for(let index=0;index<part.chunks.length;index++){
    input.signal?.throwIfAborted();const chunk=await store.chunk(input.sourceId,book.revision,part.id,index)
    for(const block of chunk.blocks){total+=Array.from(block.text).length;if(total>2000000||pages.length>=500)reject(413,'DOCUMENT_TOO_LARGE');pages.push({text:block.text,textMethod:'text',section:part.title,blockId:block.id,chunkIndex:index})}
   }
  }
  const after=await resolve(input,context);if(after.revision!==before.revision||after.sourceFingerprint!==before.sourceFingerprint)reject(409,'SOURCE_REFERENCE_CHANGED')
  return {pages,sourceFingerprint:before.sourceFingerprint,truncated:false}
 }
 return {resolve,readPages,authorizationEpoch:()=>store.authorizationEpoch()}
}
