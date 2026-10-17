import { ReaderError, reject, integer, object } from './validate.js'
import { readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const jsonHeaders = { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'self'" }
export const json = (value,status=200) => new Response(JSON.stringify(value),{status,headers:jsonHeaders})
const number = (v,optional=false) => v===null&&optional ? undefined : v!==null&&/^\d+$/.test(v) ? Number(v) : reject(400,'INVALID_INTEGER')


export function createApi(store,config,connection,getProcessingContext,getProcessor) {
  async function body(request) {
    const origin=request.headers.get('origin'), fetchSite=request.headers.get('sec-fetch-site')
    if(fetchSite&&fetchSite!=='same-origin')reject(403,'WRITE_ORIGIN_REQUIRED')
    if(origin){
      try{
        const source=new URL(origin),host=request.headers.get('host')||new URL(request.url).host
        const expected=new URL(`${source.protocol}//${host}`)
        if(!['http:','https:'].includes(source.protocol)||source.username||source.password||source.pathname!=='/'||source.search||source.hash||expected.username||expected.password||expected.pathname!=='/'||expected.search||expected.hash||source.origin!==expected.origin)reject(403,'WRITE_ORIGIN_REQUIRED')
      }catch{reject(403,'WRITE_ORIGIN_REQUIRED')}
    }else if(fetchSite!=='same-origin')reject(403,'WRITE_ORIGIN_REQUIRED')
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))reject(415,'JSON_REQUIRED')
    const reader=request.body?.getReader();let size=0;const parts=[]
    if(!reader)reject(400,'INVALID_OBJECT')
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>config.maxRequestBytes){await reader.cancel();reject(413,'REQUEST_TOO_LARGE')}parts.push(value)}}finally{reader.releaseLock()}
    try{return object(JSON.parse(Buffer.concat(parts).toString('utf8')))}catch(error){if(error instanceof ReaderError)throw error;reject(400,'INVALID_JSON')}
  }
  async function guard(request) {
    const headers=Object.fromEntries(request.headers)
    const result=connection.requestRejection({headers})
    if(result!==undefined)reject(result,result===401?'UNAUTHENTICATED':'UNTRUSTED_ORIGIN')
  }
  const handlers={
    books:async(r,u)=>r.method==='GET'?store.list({query:u.searchParams.get('q')||'',kind:u.searchParams.get('kind')||'all',offset:number(u.searchParams.get('offset')||'0'),trash:u.searchParams.get('trash')==='true'}):store.create(await body(r)),
    book:async(r,u)=>r.method==='GET'?store.get(u.searchParams.get('id'),number(u.searchParams.get('revision'),true)):store.update(await body(r)),
    parts:async(_r,u)=>store.listParts({bookId:u.searchParams.get('id'),revision:number(u.searchParams.get('revision'),true),offset:number(u.searchParams.get('offset')||'0'),limit:number(u.searchParams.get('limit')||'40'),query:u.searchParams.get('q')||''}),
    access:async(r,u)=>r.method==='GET'?store.getAgentAccess(u.searchParams.get('id')):store.saveAgentAccess(await body(r)),
    history:async(_r,u)=>store.history(u.searchParams.get('id')),
    restore:async(r)=>store.restore(await body(r)),
    trash:async(r)=>store.trash(await body(r)),
    chunk:async(_r,u)=>store.chunk(u.searchParams.get('id'),number(u.searchParams.get('revision')),u.searchParams.get('part'),number(u.searchParams.get('chunk'))),
    reading:async(r,u)=>r.method==='GET'?store.reading(u.searchParams.get('id')):store.saveReading(await body(r)),
    bookmark:async(r)=>store.bookmark(await body(r)),
    settings:async(r)=>r.method==='GET'?store.getSettings():store.saveSettings(await body(r)),
    import:async(r)=>{const input=await body(r);return store.importDocument(input,undefined,getProcessingContext?await getProcessingContext(r):undefined)},
    process:async(r)=>{
      const input=await body(r)
      if(Object.keys(input).some(k=>!['bookId','partId','revision','ocrEngine','allowRemote','consent'].includes(k)))reject(400,'INVALID_OBJECT')
      if(input.allowRemote!==undefined&&typeof input.allowRemote!=='boolean')reject(400,'INVALID_OBJECT')
      integer(Number(input.revision),1,Number.MAX_SAFE_INTEGER)
      const context=getProcessingContext?await getProcessingContext(r):undefined,processor=getProcessor?.()
      if(!processor)reject(503,'PROCESSING_UNAVAILABLE')
      const book=await store.get(input.bookId)
      if(String(book.revision)!==String(input.revision))reject(409,'SOURCE_REVISION_CHANGED')
      const part=book.parts.find(p=>p.id===input.partId);if(!part)reject(404,'CHAPTER_NOT_FOUND')
      if(!['auto','local','configured'].includes(input.ocrEngine))reject(400,'INVALID_BUDGET')
      if(input.allowRemote===true&&input.consent!=='selected-document')reject(403,'REMOTE_PROCESSING_REQUIRES_CONSENT')
      const beforeRemote=async()=>{const epoch=store.authorizationEpoch();const current=await store.get(input.bookId);if(current.revision!==book.revision)reject(409,'SOURCE_REVISION_CHANGED');await store.assertSourceAccess(input.bookId,part.id,context,book.revision);return ()=>{if(store.authorizationEpoch()!==epoch)reject(403,'SOURCE_ACCESS_DENIED')}}
      const result=await processor.readPages({bookId:input.bookId,revision:book.revision,startPage:book.parts.indexOf(part)+1,count:1,textLimit:2000000,fullText:true,includeImages:false,ocrEngine:input.ocrEngine,mode:input.ocrEngine==='configured'?'ocr':'auto',allowRemote:input.allowRemote===true,beforeRemote,signal:r.signal},context)
      const verify=await beforeRemote();verify?.()
      return json({bookId:result.bookId,revision:result.revision,pages:result.pages.map(({imageBytes,...page})=>page)})
    },
    health:async()=>({ready:true,scope:'operator',formats:['md','txt','docx','epub','pdf','structured','png','jpeg','webp'],maxDocumentBytes:config.maxDocumentBytes}),
  }
  const methods={books:['GET'],'books/write':['POST'],book:['GET'],'book/write':['POST'],access:['GET'],'access/write':['POST'],parts:['GET'],history:['GET'],restore:['POST'],trash:['POST'],chunk:['GET'],reading:['GET'],'reading/write':['POST'],bookmark:['POST'],settings:['GET'],'settings/write':['POST'],health:['GET'],asset:['GET','HEAD'],import:['POST'],process:['POST']}
  const routes=Object.entries(methods).map(([name,verbs])=>({
    path:`/api/reader/${name}`,methods:verbs,requestBody:verbs.includes('POST')?'streaming':'buffered',
    async fetch(request){
      try{
        await guard(request)
        if(!verbs.includes(request.method))return json({error:'METHOD_NOT_ALLOWED'},405)
        const url=new URL(request.url)
        if(name==='asset'){
          const asset=await store.asset(url.searchParams.get('id'),number(url.searchParams.get('revision')),url.searchParams.get('part'))
          return new Response(request.method==='HEAD'?null:asset.bytes,{headers:{'Content-Type':asset.mime,'Content-Length':String(asset.bytes.length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer'}})
        }
        const output=await handlers[name.replace(/\/write$/,'')](request,url)
        return output instanceof Response?output:json(output)
      }catch(error){
        const processingStatus={PROCESSING_UNAVAILABLE:503,UNSUPPORTED_FORMAT:415,DOCUMENT_PARSE_ERROR:422,DOCUMENT_ENCRYPTED:415,DOCUMENT_TOO_LARGE:413,INVALID_BUDGET:400,ABORT_ERR:499,REMOTE_PROCESSING_REQUIRES_CONSENT:403,OCR_NOT_CONFIGURED:503,OCR_INPUT_TOO_LARGE:413,INVALID_OCR_RESPONSE:502}[error?.code]
        if(processingStatus)return json({error:error.code,...(error.capability?{capability:error.capability}:{})},processingStatus)
        if(error instanceof ReaderError)return json({error:error.code},error.status)
        if(error?.code==='ENOENT')return json({error:'SOURCE_UNAVAILABLE'},404)
        return json({error:'READER_UNAVAILABLE'},500)
      }
    },
  }))

  const base=new URL('../vendor/pdfjs/',import.meta.url).pathname
  const files=['pdf.min.mjs','pdf.worker.min.mjs',...['cmaps','standard_fonts','wasm'].flatMap(dir=>readdirSync(join(base,dir)).filter(name=>/\.(?:bcmap|pfb|ttf|wasm|js)$/.test(name)&&!name.startsWith('quickjs')).map(name=>`${dir}/${name}`))]
  for(const file of files)routes.push({path:`/api/reader/runtime/${file}`,methods:['GET'],requestBody:'buffered',async fetch(request){try{await guard(request);if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405);const bytes=await readFile(join(base,file));return new Response(bytes,{headers:{'Content-Type':/\.(mjs|js)$/.test(file)?'text/javascript; charset=utf-8':file.endsWith('.wasm')?'application/wasm':'application/octet-stream','Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'"}})}catch(error){return json({error:error instanceof ReaderError?error.code:'READER_UNAVAILABLE'},error.status||500)}}})
  return routes
}
