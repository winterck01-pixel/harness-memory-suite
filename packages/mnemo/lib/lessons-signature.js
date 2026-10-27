import {createHash} from 'node:crypto'

const record=x=>x&&typeof x==='object'&&!Array.isArray(x)
const sha=s=>createHash('sha256').update(s).digest('hex')
const ERROR_LINE=/(?:error|exception|traceback|enoent|eacces|eperm|econn|etimedout|not found|no such|denied|forbidden|unauthori[sz]ed|invalid|failed|failure|cannot|can't|unable|refused|timeout|timed out|exit(?:ed)? (?:with )?code|syntaxerror|typeerror|keyerror|报错|错误|失败|不存在|拒绝|超时)/i
const EXIT_CODE=/(?:process exited with code|exit[_ ]?code\s*[:=]?)\s*([1-9]\d*)/i
const SHELL_TOOLS=new Set(['bash','pwsh'])
// Regular and persistent host shell renderers append these exact final-line markers.
// Persistent shells may have no output prefix; other tools return data, not status.
const failedShellStatus=(name,text)=>SHELL_TOOLS.has(name)&&(
 /(?:^|\n)\[exit code: [1-9]\d*\]$/.test(text)||
 (name==='bash'&&/(?:^|\n)\[Command finished with exit code [1-9]\d*\]$/.test(text))
)

/** Reduce an error message to a stable, content-free skeleton so that the same
 * failure with different paths, ids or numbers maps to one signature. */
export function normalizeError(text){
 if(typeof text!=='string')return ''
 const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean)
 if(!lines.length)return ''
 const pick=lines.find(l=>ERROR_LINE.test(l))??lines[0]
 return pick.toLowerCase()
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,'<id>')
  .replace(/\b[0-9a-f]{16,}\b/g,'<hex>')
  .replace(/(?:[a-z]:)?(?:\/|\\)[^\s'"`:,;()]+/g,'<path>')
  .replace(/"[^"]*"|'[^']*'|`[^`]*`/g,'<s>')
  .replace(/\d+(?:\.\d+)*/g,'<n>')
  .replace(/\s+/g,' ')
  .slice(0,120)
}

export function errorClass(text){
 const t=String(text??'')
 const map=[[/enoent|no such file|not found|不存在/i,'not-found'],[/eacces|eperm|permission denied|denied|forbidden|拒绝/i,'permission'],[/syntaxerror|unexpected token|parse error/i,'syntax'],[/timeout|timed out|etimedout|超时/i,'timeout'],[/econn|refused|network|dns/i,'network'],[/typeerror|referenceerror|keyerror|attributeerror|nameerror/i,'runtime-type'],[/unauthori[sz]ed|401|403|credential|token/i,'auth'],[/invalid|schema|validation|argument|参数/i,'bad-args'],[EXIT_CODE,'exit-code']]
 for(const [re,name] of map)if(re.test(t))return name
 return 'other'
}

export function signatureOf(tool,text,hint=''){
 let norm=normalizeError(text)
 if(!norm)return null
 // A bare exit code carries no meaning; the command head disambiguates it.
 if(/^\[?exit[_ ]?code:? ?<n>\]?$/.test(norm)&&hint)norm+=' @'+hint
 return {signature:sha(`${tool??'?'}:${norm}`).slice(0,24),tool:tool??null,normalized:norm,errorClass:errorClass(text)}
}

const textOf=content=>typeof content==='string'?content:Array.isArray(content)?content.map(b=>b?.type==='text'?String(b.text??''):b?.type==='tool-result'?(typeof b.content==='string'?b.content:JSON.stringify(b.content??'')):'').join('\n'):''

/** Extract a failure from one tool/result (or ptc-dispatch) event, or null. */
export function callHint(name,args){
 if(name!=='bash')return ''
 try{const c=String((typeof args==='string'?JSON.parse(args):args)?.command??'').trim().split(/\s+/)[0]??'';return c.replace(/^.*\//,'').slice(0,24)}catch{return ''}
}
const asArgs=args=>{try{const value=typeof args==='string'?JSON.parse(args):args;return record(value)?value:null}catch{return null}}
const argsText=args=>{try{return typeof args==='string'?args:args==null?'':JSON.stringify(args)}catch{return ''}}
const targetOf=args=>{
 const obj=asArgs(args);if(!obj)return null
 const paths=['path','filePath','file_path'].filter(k=>typeof obj[k]==='string'&&obj[k].trim()).map(k=>obj[k])
 if(!paths.length||new Set(paths).size!==1)return null
 // Exact target equality only. Do not infer paths from command text, error strings or filenames.
 return sha('file:'+paths[0]).slice(0,32)
}
function resultData(event){
 const d=event?.data??{}
 if(event?.type==='tool/ptc-dispatch')return {id:d.subCallId??null,name:d.name??null,args:d.arguments??d.args,content:d.content,isError:d.isError===true}
 if(event?.type!=='tool/result')return null
 const m=d.message??{},r=Array.isArray(m.content)?m.content.find(x=>x?.type==='tool-result'):null
 return {id:m.toolCallId??m.source?.callId??r?.callId??null,name:null,args:undefined,content:m.content,isError:m.isError===true||r?.isError===true}
}
export function failureFromEvent(event,toolNameOf=()=>null){
 if(!record(event))return null
 const r=resultData(event);if(!r)return null
 const text=textOf(r.content)
 const info=toolNameOf(r.id),name=r.name??(typeof info==='string'?info:info?.name)??null
 if(!r.isError&&!failedShellStatus(name,text))return null
 const sig=signatureOf(name,text,info?.hint??callHint(name,r.args))
 return sig&&{...sig,callId:r.id,seq:event.seq,snippet:text.slice(0,300)}
}

/** One normalized result stream for direct calls and programmatic tool subcalls.
 * Target identity is computed before argument truncation and never reveals the path. */
export function collectToolResults(events){
 const direct=new Map(),ptc=new Map(),out=[]
 for(const e of events??[]){
  const d=e?.data??{}
  if(e?.type==='tool/call'&&d.callId)direct.set(d.callId,{name:d.name,args:d.arguments??d.args})
  if(e?.type==='tool/ptc-dispatch-start'&&d.subCallId)ptc.set(d.subCallId,{name:d.name,args:d.arguments??d.args})
  const r=resultData(e);if(!r)continue
  const calls=e.type==='tool/ptc-dispatch'?ptc:direct,call=calls.get(r.id)
  const tool=r.name??call?.name??null,args=call?.args??r.args
  const info={name:tool,hint:callHint(tool,args)},failure=failureFromEvent(e,()=>info),result=textOf(r.content)
  out.push({seq:e.seq,callId:r.id,tool,args:argsText(args),targetKey:targetOf(args),result,failed:r.isError||failedShellStatus(tool,result),failure})
 }
 return out
}

/** Walk an event list and return failures plus recovery evidence.
 * `fixed` requires an explicit matching target and tool, and the final outcome for that
 * target/tool must be successful. It is supporting evidence, never a lesson validation. */
export function scanFailures(events){
 const rows=collectToolResults(events),out=rows.filter(r=>r.failure).map(r=>({...r.failure,targetKey:r.targetKey}))
 for(const f of out){
  const later=f.targetKey?rows.filter(r=>r.seq>f.seq&&r.tool===f.tool&&r.targetKey===f.targetKey):[]
  const last=later.at(-1);f.fixed=!!last&&!last.failed
  if(f.fixed)f.recoverySeq=last.seq
 }
 const lastFail=out.length?Math.max(...out.map(f=>f.seq)):-1
 const successAfter=out.length>0&&rows.some(r=>r.seq>lastFail&&!r.failed)
 return {failures:out,successAfter}
}
