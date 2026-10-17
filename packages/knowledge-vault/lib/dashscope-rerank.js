import {validateImage} from './image-input.js'

export async function dashscopeRerank(model,query,documents,signal,request){
 if(!model.apiKey)throw new Error('DASHSCOPE_CREDENTIAL_NOT_CONFIGURED');
 const vl=model.model==='qwen3-vl-rerank';let imageCount=0,imageBytes=0;
 const convert=value=>{if(typeof value==='string'){if(!value.trim())throw new Error('INVALID_RERANK_INPUT');return value}
  if(!vl||!value||Object.keys(value).some(k=>!['bytes','mediaType'].includes(k)))throw new Error('INVALID_RERANK_INPUT');
  const image=validateImage(value);imageCount++;imageBytes+=image.bytes.length;
  return {image:'data:'+image.mediaType+';base64,'+Buffer.from(image.bytes).toString('base64')};};
 if(!Array.isArray(documents)||!documents.length)throw new Error('INVALID_RERANK_INPUT');
 if(documents.length>(vl?100:500))throw new Error('RERANK_BATCH_TOO_LARGE');
 const wireQuery=convert(query),wireDocuments=documents.map(convert);if(vl&&wireDocuments.some(d=>typeof d!=='string'))for(let i=0;i<wireDocuments.length;i++)if(typeof wireDocuments[i]==='string')wireDocuments[i]={text:wireDocuments[i]};

 if(imageCount>4||imageBytes>20*1024*1024)throw new Error('RERANK_IMAGE_BUDGET_EXCEEDED');
 const perDocument=model.model==='qwen3-rerank'?4000:vl?8000:30000;
 const q=typeof query==='string'?Buffer.byteLength(query):0,sizes=documents.map(d=>typeof d==='string'?Buffer.byteLength(d):0);
 if(q>4000||sizes.some(n=>n>perDocument)||q*documents.length+sizes.reduce((a,b)=>a+b,0)>120000)throw new Error('RERANK_INPUT_TOO_LARGE');
 const data=await request(model,'/api/v1/services/rerank/text-rerank/text-rerank',{model:model.model,input:{query:wireQuery,documents:wireDocuments},parameters:{top_n:documents.length}},signal);
 if(data?.code)throw new Error('DASHSCOPE_RERANK_FAILED');
 const rows=data?.output?.results;
 if(!Array.isArray(rows)||rows.length!==documents.length||rows.some(r=>!r||!Number.isInteger(r.index)||r.index<0||r.index>=documents.length||!Number.isFinite(r.relevance_score)||r.relevance_score<0||r.relevance_score>1)||new Set(rows.map(r=>r.index)).size!==documents.length)throw new Error('INVALID_RERANK_RESPONSE');
 return rows.map(({index,relevance_score})=>({index,relevance_score}));
}
