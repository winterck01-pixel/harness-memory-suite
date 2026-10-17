import {readerExecutionContext} from './lib/context.js'
import {createSearchTools} from './lib/search-tools.js'
import {createReaderSourceAdapter} from './lib/source-adapter.js'
import {createMediaTools} from './lib/media-tools.js'
import {createProcessingReader} from './lib/processing.js'
import { createReaderStore } from './lib/store.js'
import { readConfig, reject } from './lib/validate.js'
import { createApi } from './lib/api.js'
import { createTools } from './lib/tools.js'

export const name='dsh-reader'
export const inject=['connection','tools']


export async function apply(ctx,raw={}){
  if((ctx.get('tools')??ctx.tools)?.resultValidationVersion!==1)reject(503,'READER_HOST_UPGRADE_REQUIRED')
  const config=readConfig(raw),store=createReaderStore(config,()=>ctx.get('knowledgeVault'),()=>ctx.get('knowledgeRag'))
  await store.initialize()
  ctx.effect(()=>()=>store.close(),'dsh-reader: storage lifecycle')
  const getCwd=exec=>{
    const session=exec?.agent?.id&&ctx.get('sessions')?.get(exec.agent.id)
    return session?.header?.cwd||session?.cwd
  }
  const media=createProcessingReader(store,()=>ctx.get('knowledgeRag'),config)
  const register=inner=>{const rag=inner.get('knowledgeRag');if(rag?.version===1&&typeof rag.registerSourceAdapter==='function')inner.effect(()=>rag.registerSourceAdapter('reader',createReaderSourceAdapter(store,media)),'dsh-reader: shared knowledge source adapter')}
  if(typeof ctx.inject==='function')ctx.inject(['knowledgeRag'],register);else register(ctx)
  const trustedContext=exec=>{const rag=ctx.get('knowledgeRag');if(rag?.version!==1||typeof rag.contextForExecution!=='function')throw Object.assign(Error('PROCESSING_UNAVAILABLE'),{code:'PROCESSING_UNAVAILABLE'});return rag.contextForExecution(exec)}
  for(const tool of [...createTools(store,getCwd,exec=>ctx.get('knowledgeRag')?.version===1?trustedContext(exec):undefined,exec=>readerExecutionContext(ctx,exec)),...createMediaTools(media,()=>ctx,trustedContext),...createSearchTools(()=>ctx.get('knowledgeRag'),trustedContext,store)])ctx.effect(()=>ctx.tools.register({...tool,...(tool.validateResult?{validateResult:(execution,result)=>{try{const vault=ctx.get('knowledgeVault');return vault?vault.runForExecution(execution,()=>tool.validateResult(execution,result)):tool.validateResult(execution,result)}catch{return false}}}:{}),execute:(args,execution)=>{const vault=ctx.get('knowledgeVault');return vault?vault.runForExecution(execution,()=>tool.execute(args,execution)):tool.execute(args,execution)}}),`dsh-reader: ${tool.name}`)
  for(const route of createApi(store,config,ctx.connection,request=>{const rag=ctx.get('knowledgeRag');if(rag?.version!==1)return undefined;if(typeof rag.contextForRequest!=='function')throw Object.assign(Error('PROCESSING_UNAVAILABLE'),{code:'PROCESSING_UNAVAILABLE'});return rag.contextForRequest(request)},()=>media))ctx.effect(()=>ctx.connection.fetch.register({...route,async fetch(request){
    try{const vault=ctx.get('knowledgeVault');return await (vault?vault.runForRequest(request,()=>route.fetch(request)):route.fetch(request))}
    catch{return new Response(JSON.stringify({error:'AUTHENTICATED_KNOWLEDGE_CONTEXT_REQUIRED'}),{status:403,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
  }}),`dsh-reader: ${route.path}`)
  ctx.provide('dshReader',{get:store.get,list:store.list})
}
