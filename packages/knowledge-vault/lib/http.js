import {providerCatalog} from './provider-catalog.js'
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers})
export function routes(rag,access,connection){const registered=[{path:'/api/knowledge-rag/ui',methods:['GET'],requestBody:'buffered',async fetch(request){const rejected=connection.requestRejection({headers:Object.fromEntries(request.headers)});if(rejected!==undefined)return json({error:'ACCESS_DENIED'},rejected);return new Response(null,{status:303,headers:{Location:'/?settings=knowledge-rag','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}},{path:'/api/knowledge-rag',methods:['GET','POST'],requestBody:'streaming',async fetch(request){
 try{
  const rejected=connection.requestRejection({headers:Object.fromEntries(request.headers)});if(rejected!==undefined)return json({error:'ACCESS_DENIED'},rejected)
  if(request.method==='GET')return json({version:1,providerCatalog,settings:rag.getSettings(access.operator),modelCatalog:rag.listModels?await rag.listModels(access.operator):{providers:[]},status:rag.status(access.operator),capabilities:await rag.capabilities()})
  if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405)
  const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');if(site&&site!=='same-origin')return json({error:'ORIGIN_REQUIRED'},403)
  if(origin){const expected=request.headers.get('host')||new URL(request.url).host;if(new URL(origin).host!==expected)return json({error:'ORIGIN_REQUIRED'},403)}else if(site!=='same-origin')return json({error:'ORIGIN_REQUIRED'},403)
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON_REQUIRED'},415)
  const reader=request.body?.getReader();if(!reader)return json({error:'BODY_REQUIRED'},400);const pieces=[];let size=0
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return json({error:'BODY_TOO_LARGE'},413)}pieces.push(value)}}finally{reader.releaseLock()}
  const body=JSON.parse(Buffer.concat(pieces).toString());let output
  if(body.action==='scope')output=await rag.setScope(body,access.operator)
  else if(body.action==='testRerank'){if(body.consent!=='synthetic-test')return json({error:'SYNTHETIC_TEST_CONSENT_REQUIRED'},400);output=await rag.testRerank(access.operator,request.signal)}
  else if(body.action==='testEmbedding'){if(body.consent!=='synthetic-test')return json({error:'SYNTHETIC_TEST_CONSENT_REQUIRED'},400);output=await rag.testEmbedding(access.operator,request.signal)}
  else if(body.action==='settings')output=await rag.updateSettings(body.settings,access.operator)
  else if(body.action==='index'||body.action==='indexSource'){if(body.allowRemote===true&&body.consent!=='selected-document')return json({error:'SELECTED_DOCUMENT_CONSENT_REQUIRED'},400);output=await rag[body.action]({id:body.id,revision:body.revision,adapter:body.adapter,sourceId:body.sourceId,partId:body.partId,indexImages:body.indexImages===true,pageNumbers:body.pageNumbers,ocrEngine:body.ocrEngine,imageConsent:body.imageConsent,allowRemote:body.allowRemote===true,signal:request.signal},access.operator)}
  else if(body.action==='search'){if(body.allowRemote===true&&body.consent!=='query-and-candidates')return json({error:'QUERY_CONSENT_REQUIRED'},400);output=await rag.search({query:body.query,rerankImageConsent:body.rerankImageConsent,queryImage:body.queryImage,imageConsent:body.imageConsent,limit:body.limit??8,allowRemote:body.allowRemote===true,signal:request.signal},access.operator)}
  else return json({error:'INVALID_ACTION'},400)
  if(body.action==='search')rag.assertSearchResult(output);
  return json(output)
 }catch(error){return json({error:/^[A-Z0-9_]+$/.test(error.code||'')?error.code:/^[A-Z0-9_]+$/.test(error.message)?error.message:'KNOWLEDGE_REQUEST_FAILED',...(/^[A-Z0-9_]+$/.test(error.capability||'')?{capability:error.capability}:{})},400)}
 }}];return [registered[0],{...registered[1],methods:['GET'],requestBody:'buffered'},{...registered[1],path:'/api/knowledge-rag/action',methods:['POST']}]}
