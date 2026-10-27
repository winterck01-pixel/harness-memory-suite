import {collectToolResults,scanFailures} from './lessons-signature.js'

const secretToken=/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)|\b(?:sk|ark)-[a-zA-Z0-9_-]{16,}|\bBearer\s+[a-zA-Z0-9._~+\/-]{12,}/ig
const sensitiveKeys=String.raw`(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|(?:proxy[-_ ]?)?authorization)`
// Quote-aware values keep spaces, escaped quotes and newlines inside the same secret.
// Plain values stop at field/line boundaries; match whole keys and explicit CLI flags.
const sensitiveField=new RegExp(String.raw`(?<![\w-])((?:--?${sensitiveKeys}(?:\s*=\s*|\s+)|(?:"${sensitiveKeys}"|'${sensitiveKeys}'|${sensitiveKeys})\s*[:=]\s*))("(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|\u0000mnemo-literal-+\d+\u0000|\[redacted\]|[^\s"'\r\n,;}\]][^"'\r\n,;}\]]*)`,'gi')
const jsonString=/"(?:\\[\s\S]|[^"\\])*"/g
const sensitiveKey=new RegExp('^'+sensitiveKeys+'$','i')
function scrub(value,depth=0){
 const input=String(value??'')
 if(depth>=8)return /password|secret|authorization|api[_ -]?key|(?:access|refresh)[_ -]?token/i.test(input)?'[redacted]':input.replace(secretToken,'[redacted]')
 // Parse complete JSON first. Each decoded string is scrubbed once, then encoded once;
 // scanning the encoded string again would mistake escaped quotes for value boundaries.
 try{
  const parsed=JSON.parse(input)
  const clean=value=>{
   if(typeof value==='string')return scrub(value,depth+1)
   if(Array.isArray(value))return value.map(clean)
   if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sensitiveKey.test(key)?'[redacted]':clean(item)]))
   return value
  }
  const cleaned=clean(parsed)
  return JSON.stringify(cleaned)===JSON.stringify(parsed)?input:JSON.stringify(cleaned)
 }catch{}
 // Logs may embed JSON literals without being valid JSON themselves (for example `1| {...}`).
 // Keep decoded value tokens opaque during the outer plaintext scan, but retain field names.
 const tokens=[];let marker='\u0000mnemo-literal-'
 while(input.includes(marker))marker+='-'
 let text=input.replace(jsonString,(token,offset)=>{
  if(/^\s*[:=]/.test(input.slice(offset+token.length)))return token
  try{
   const decoded=JSON.parse(token),cleaned=scrub(decoded,depth+1),id=marker+tokens.length+'\u0000'
   tokens.push(cleaned===decoded?token:JSON.stringify(cleaned))
   return id
  }catch{return token}
 })
 text=text.replace(secretToken,'[redacted]')
 text=text.replace(sensitiveField,(match,prefix,value)=>{
  if(value==='[redacted]'||value==='"[redacted]"'||value==="'[redacted]'")return match
  const quote=value.startsWith(marker)||value[0]==='"'?'"':value[0]==="'"?"'":''
  return prefix+quote+'[redacted]'+quote
 })
 for(let i=0;i<tokens.length;i++)text=text.split(marker+i+'\u0000').join(tokens[i])
 return text
}
export const scrubEvidenceText=scrub
export const containsEvidenceSecret=s=>scrub(s)!==String(s??'')
const textOfBlocks=b=>(Array.isArray(b)?b:[]).filter(x=>x?.type==='text').map(x=>String(x.text??'')).join('\n')
const TRIGGERS=new Set(['failure-fix','repeat','correction','method'])
const positive=(n,fallback)=>Number.isFinite(n)&&n>=0?Math.floor(n):fallback
const clone=x=>structuredClone(x)

/** Recompute citations and recovery only from evidence that remains in the transmitted pack. */
function cite(pack,allFailures,maxFailures){
 const kept=pack.window.filter(w=>w.failed),bySig=new Map()
 for(const f of allFailures){
  const matching=kept.filter(w=>w.signature===f.signature||(!w.signature&&w.seq===f.seq))
  const row=matching.at(-1);if(!row||bySig.has(f.signature))continue
  const later=row.targetKey?pack.window.filter(w=>w.seq>row.seq&&w.tool===row.tool&&w.targetKey===row.targetKey):[]
  const last=later.at(-1),fixed=!!last&&!last.failed
  bySig.set(f.signature,{signature:f.signature,tool:row.tool,errorClass:f.errorClass??null,seq:row.seq,count:f.count??1,fixed,...(row.targetKey?{targetKey:row.targetKey}:{}),...(fixed?{recoverySeq:last.seq}:{})})
 }
 pack.failures=[...bySig.values()].slice(0,maxFailures)
}

/** Bound the actual JSON sent to the extractor, including feedback and trigger reasons.
 * Does not mutate queue entries. Omitted feedback preserves the queued value; explicit null
 * withholds it. Missing recovery rows invalidate fixed, and missing error rows invalidate citations. */
export function finalizeEvidence(evidence,{maxChars=6000,maxFailures=12,nextUserMessage,triggerReasons}={}){
 maxChars=positive(maxChars,6000);maxFailures=positive(maxFailures,12)
 if(maxChars<256)throw new RangeError('Evidence budget must be at least 256 characters')
 const source=clone(evidence??{}),rows=Array.isArray(source.window)?source.window:[],allFailures=Array.isArray(source.failures)?source.failures:[]
 const initialFailures=positive(source.truncated?.failures,0)+allFailures.length,initialRows=positive(source.truncated?.window,0)+rows.length
 const pack={goal:scrub(source.goal).slice(0,800),window:rows.map(w=>({seq:w.seq,tool:typeof w.tool==='string'?w.tool.slice(0,128):null,args:scrub(w.args).slice(0,240),failed:w.failed===true,result:scrub(w.result).slice(0,w.failed?700:300),...(typeof w.targetKey==='string'?{targetKey:w.targetKey}:{}),...(typeof w.signature==='string'?{signature:w.signature}: {})})),failures:[],recovered:source.recovered===true,finalAnswer:scrub(source.finalAnswer).slice(0,500),nextUserMessage:null,truncated:{window:0,failures:0}}
 const feedback=nextUserMessage===undefined?source.nextUserMessage:nextUserMessage
 pack.nextUserMessage=feedback==null?null:scrub(feedback).slice(0,400)
 const reasons=triggerReasons??source.triggerReasons
 if(Array.isArray(reasons))pack.triggerReasons=[...new Set(reasons.filter(x=>TRIGGERS.has(x)))]
 const refresh=()=>{
  cite(pack,allFailures,maxFailures)
  pack.truncated={window:initialRows-pack.window.length,failures:Math.max(0,initialFailures-pack.failures.length)}
 }
 const size=()=>JSON.stringify(pack).length
 refresh()
 // Prefer retaining failure rows plus the same-target read/retry chain over arbitrary neighbours.
 const protectedSeqs=()=>{
  const keys=new Set(pack.window.filter(w=>w.failed&&w.targetKey).map(w=>w.targetKey))
  return new Set(pack.window.filter(w=>w.failed||(w.targetKey&&keys.has(w.targetKey))).map(w=>w.seq))
 }
 let shrunk=false
 while(size()>maxChars){
  const protectedRows=protectedSeqs(),i=pack.window.findIndex(w=>!protectedRows.has(w.seq))
  if(i>=0){pack.window.splice(i,1);refresh();continue}
  if(!shrunk){shrunk=true;for(const w of pack.window){w.result=w.result.slice(0,120);w.args=w.args.slice(0,80)};refresh();continue}
  const key=['goal','finalAnswer','nextUserMessage'].find(k=>typeof pack[k]==='string'&&pack[k].length>0)
  if(key){pack[key]=pack[key].slice(0,Math.max(0,Math.floor(pack[key].length/2)));continue}
  if(pack.window.length){pack.window.shift();refresh();continue}
  if(pack.triggerReasons?.length){pack.triggerReasons.pop();continue}
  // The empty metadata object is below the supported minimum. Fail closed if its schema grows.
  throw new RangeError('Evidence metadata exceeds configured budget')
 }
 return pack
}

/** Build one citation-preserving evidence pack from direct and PTC result events. */
export function buildEvidence(events,{maxChars=6000,nextUser=null,maxFailures=12}={}){
 const allRows=collectToolResults(events),pairs=allRows.filter(p=>p.tool&&!/^mnemo(?:_|\.)/i.test(p.tool)),scan=scanFailures(events)
 const keep=new Set()
 pairs.forEach((p,i)=>{if(p.failed)for(let k=Math.max(0,i-2);k<=Math.min(pairs.length-1,i+2);k++)keep.add(k)})
 // A read/retry may be further away than the neighbouring window. Retain its target chain;
 // the final budget still bounds it and the validator requires all necessary rows to survive.
 const failedTargets=new Set(pairs.filter(p=>p.failed&&p.targetKey).map(p=>p.targetKey))
 pairs.forEach((p,i)=>{if(p.targetKey&&failedTargets.has(p.targetKey))keep.add(i)})
 if(!keep.size)pairs.forEach((_,i)=>{if(i<2||i>=pairs.length-3)keep.add(i)})
 const first=(events??[]).find(e=>e?.type==='user/message'),last=[...(events??[])].reverse().find(e=>e?.type==='assistant/message')
 const window=[...keep].sort((a,b)=>a-b).map(i=>pairs[i]).map(p=>({seq:p.seq,tool:p.tool,args:p.args,failed:p.failed,result:p.result,...(p.targetKey?{targetKey:p.targetKey}:{}),...(p.failure?{signature:p.failure.signature}:{})}))
 const bySig=new Map()
 for(const f of scan.failures){const old=bySig.get(f.signature);if(old)old.count++;else bySig.set(f.signature,{signature:f.signature,tool:f.tool,errorClass:f.errorClass,seq:f.seq,count:1,fixed:f.fixed===true})}
 return finalizeEvidence({goal:first?textOfBlocks(first.data?.content??first.data?.message?.content):'',window,failures:[...bySig.values()],recovered:scan.successAfter,finalAnswer:last?textOfBlocks(last.data?.content??last.data?.message?.content):'',nextUserMessage:nextUser,truncated:{window:pairs.length-window.length,failures:0}},{maxChars,maxFailures})
}
