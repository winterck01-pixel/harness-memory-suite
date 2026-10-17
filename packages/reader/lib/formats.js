import { Worker } from 'node:worker_threads'
import { ReaderError, reject } from './validate.js'


export function parseDocument(bytes, filename, config) {
  if (!Buffer.isBuffer(bytes) || bytes.length > config.maxDocumentBytes) reject(413,'DOCUMENT_TOO_LARGE')
  return new Promise((resolve,rejectPromise)=>{
    const worker=new Worker(new URL('./format-worker.js',import.meta.url),{workerData:{bytes,filename,limits:{maxParts:config.maxParts,maxTextBytes:config.maxTextBytes,maxDocumentBytes:config.maxDocumentBytes}},resourceLimits:{maxOldGenerationSizeMb:384,maxYoungGenerationSizeMb:32},execArgv:[]})
    let settled=false
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();error?rejectPromise(error):resolve(result)}
    const timer=setTimeout(()=>finish(new ReaderError(422,'DOCUMENT_PARSE_TIMEOUT')),30000)
    worker.once('message',message=>message.error?finish(new ReaderError(message.status||422,message.error)):finish(null,message.result))
    worker.once('error',()=>finish(new ReaderError(422,'DOCUMENT_PARSE_FAILED')))
    worker.once('exit',()=>{if(!settled)finish(new ReaderError(422,'DOCUMENT_PARSE_FAILED'))})
  })
}
