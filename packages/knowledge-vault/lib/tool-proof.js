import {createHash} from 'node:crypto';
export function createToolProof({ttlMs=120000,maxEntries=128,maxBytes=8*1024*1024,now=Date.now}={}){
 const records=new Map();let bytes=0,closed=false;
 const remove=k=>{const r=records.get(k);if(r){bytes-=r.size;records.delete(k)}};
 const prune=()=>{for(const [k,r]of records)if(r.expires<=now())remove(k)};
 const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const render=value=>[{type:'text',text:JSON.stringify(value)}];
 return {
  seal(exec,payload,verify){verify();prune();if(closed||typeof exec?.token!=='symbol')return payload;const size=Buffer.byteLength(JSON.stringify(payload));if(size>maxBytes)return payload;remove(exec.token);while(records.size>=maxEntries||bytes+size>maxBytes)remove(records.keys().next().value);records.set(exec.token,{verify,digest:digest(payload),contentDigest:digest(render(payload)),size,expires:now()+ttlMs});bytes+=size;return payload},
  render,
  validate(exec,result){try{prune();const r=records.get(exec.token);remove(exec.token);if(result.isError||result.meta!==undefined||result.additionalContexts!==undefined)return false;if(closed||!r)return false;if(digest(result.value)!==r.digest||digest(result.content)!==r.contentDigest)return false;r.verify();return true}catch{return false}},
  close(){closed=true;records.clear();bytes=0}
 };
}
