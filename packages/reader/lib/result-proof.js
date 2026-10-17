import {createHash} from 'node:crypto'

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')


export function createResultProofs({ttlMs=300000,maxEntries=2048,maxBytes=8*1024*1024,now=Date.now}={}){
 const entries=new Map();let bytes=0
 const remove=token=>{const entry=entries.get(token);if(entry)bytes-=entry.bytes;entries.delete(token)}
 function bind(result,verify,exec){
  verify();const text=JSON.stringify(result),snapshot=JSON.parse(text);verify()
  const size=Buffer.byteLength(text)+256
  if(size>maxBytes)throw Object.assign(Error('READER_RESULT_PROOF_TOO_LARGE'),{code:'READER_RESULT_PROOF_TOO_LARGE',status:413})
  const token=exec?.token
  if(typeof token!=='symbol')return snapshot
  remove(token);const time=now()
  for(const[key,entry]of entries)if(entry.expires<=time)remove(key)
  while(entries.size>=maxEntries||bytes+size>maxBytes)remove(entries.keys().next().value)
  entries.set(token,{verify,digest:digest(snapshot),expires:time+ttlMs,bytes:size});bytes+=size
  return snapshot
 }
 function validate(exec,result){
  let token
  try{
   token=exec?.token;const entry=entries.get(token)
   if(result?.isError)return false
   if(typeof token!=='symbol'||!entry)return false
   if(entry.expires<=now())return false
   entry.verify();const value=JSON.parse(JSON.stringify(result.value));entry.verify()
   if(digest(value)!==entry.digest)return false
   return true
  }catch{
   return false
  }finally{remove(token)}
 }
 return {bind,validate}
}
