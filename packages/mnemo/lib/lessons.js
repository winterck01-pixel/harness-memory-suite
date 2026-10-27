import {createHash,randomUUID} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,statSync,appendFileSync,openSync,closeSync} from 'node:fs'
import {join} from 'node:path'
import {lexicalSimilarity} from './retrieve.js'
import {failureFromEvent,callHint} from './lessons-signature.js'
import {buildEvidence,finalizeEvidence,scrubEvidenceText} from './lessons-evidence.js'
export {buildEvidence} from './lessons-evidence.js'
import {verifyRecordedLesson,verificationMatches} from './lessons-validation.js'

const record=x=>x&&typeof x==='object'&&!Array.isArray(x)
const sha=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex')
const clone=v=>structuredClone(v)
const scrub=scrubEvidenceText
const TYPES=new Set(['pitfall','fix','method'])
const DAY=86400000
const RECONCILE_SYSTEM=`判断新候选经验与已有经验(同一错误签名、同一作用域)的关系,返回 JSON:{"relation":"same"|"complement"|"conflict","targetId":"已有经验id","mergedAdvice":"仅 complement 时:合并后的命令式建议,不超过两句"}。
same=表达同一做法;complement=互相补充;conflict=建议相互矛盾。判断只供人工审查,不会自动修改或暂停已有经验。targetId 必须取自 existing 列表。`
const CORRECTION=/(?:不对|错了|不是这样|重来|还是不行|没用|有问题|\bwrong\b|\bincorrect\b|\bdoesn'?t work\b|\bstill (?:fails|broken)\b)/i
// Advice touching destructive actions, permissions or guards never auto-activates; a human reviews it.
const RISKY=/\b(?:rm\s+-[a-z]*r|sudo|chmod\s+(?:-R\s+)?7[0-7]{2}|--force|force[- ]push|drop\s+(?:table|database)|mkfs|dd\s+if=|curl[^|\n]*\|\s*(?:ba)?sh|--no-verify|disable\s+(?:guard|sandbox|approval))\b|删除|清空|格式化|绕过|提权|免密|授权|(?:禁用|跳过|关闭).{0,6}(?:守卫|沙箱|校验|检查|审批|权限)/i
export const isRisky=text=>RISKY.test(String(text??''))

export const LESSONS_DEFAULTS=Object.freeze({
 enabled:false,maxPerProject:200,maxPerTool:100,maxPerSignature:3,maxQueue:30,queueMaxAgeDays:7,
 idleMs:10*60000,maxCallsPerDay:200,evidenceChars:6000,maxEvidenceFailures:12,
 injectOpening:true,injectOnError:true,openingLimit:3,openingChars:600,errorLimit:2,
 minInjectedForSuspend:5,suspendRecurRate:0.5,minSimilarity:0.28,
 holdoutRate:0.1,refreshMs:30000,expireDays:60,purgeDays:30,logInjections:true,reconcile:true,
})

export const EXTRACTOR_SYSTEM=`你是 Agent 经验提炼器。输入是一次任务回合的证据(用户目标、工具调用窗口、报错、结果、用户后续反馈)。
任务:只提炼"以后遇到类似情况能避免重复犯错或更快成功"的可迁移经验,返回 JSON:{"lessons":[...]}。
每条 lesson 字段:
- type: "pitfall"(踩过的坑/失败原因) | "fix"(失败后被验证有效的修复) | "method"(成功且经过检查的做法)
- signature: 对应的报错签名(从输入 failures[].signature 中原样选取;method 可省略)
- trigger: 适用情境,一句话,包含关键词
- advice: 命令式建议,不超过两句,可直接执行
- scope: "project" 或 "tool"(与具体项目无关、只关于某个工具/宿主行为时用 tool)
- tool: scope 为 tool 时的工具名
- confidence: "low" | "med" | "high"
规则:不要写密钥、账号、个人数据、具体路径或整段日志;没有价值就返回 {"lessons":[]};最多 3 条;不要重复表述同一件事;fix 只有在证据支持同一目标的恢复时才写;fixed 仅是同目标后续成功线索,不是建议已经验证的证明。`

const textOfBlocks=b=>(Array.isArray(b)?b:[]).filter(x=>x?.type==='text').map(x=>String(x.text??'')).join('\n')

export function validLesson(raw,fallback){
 if(!record(raw))return null
 const type=TYPES.has(raw.type)?raw.type:null,str=(v,max)=>typeof v==='string'?scrub(v).trim().slice(0,max):''
 const trigger=str(raw.trigger,200),advice=str(raw.advice,400)
 if(!type||trigger.length<4||advice.length<6||/\[redacted\]/.test(trigger+advice))return null
 const known=new Set(fallback.signatures)
 const signature=typeof raw.signature==='string'&&known.has(raw.signature)?raw.signature:null
 if(type!=='method'&&!signature)return null
 const scope=raw.scope==='tool'&&str(raw.tool,64)?'tool':'project'
 return {type,signature,trigger,advice,scope,tool:scope==='tool'?str(raw.tool,64):null,confidence:['low','med','high'].includes(raw.confidence)?raw.confidence:'low',errorClass:fallback.classes.get(signature)??null}
}

const sleep=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)
const rank=c=>({low:0,med:1,high:2})[c]??0
const weight=l=>l.stats.support*2+rank(l.confidence)-l.stats.recurAfterInject*2+(l.lastSeen/DAY)/10000
const manualRetired=l=>l.state==='retired'&&(l.stateBy==='audit'||l.retiredBy==='audit')
const appendSource=(refs,ref)=>{const all=[...(refs??[]),ref].filter(Boolean),unique=[...new Map(all.map(r=>[JSON.stringify(r),r])).values()];return unique.length<=6?unique:[unique[0],...unique.slice(-5)]}
const OPERATOR_FIELDS=['state','rev','stateAt','stateBy','suspendedBy','retiredAt','retiredBy','promotedBy','review']

/** Lessons visible to a project: active, and tool-level ones only after confirmation. */
export function visibleIn(l,scope){
 if(l?.state!=='active')return false
 if(l.scope!=='tool')return l.scopeHash===scope
 return l.seed===true||l.scopeHash===scope||(l.projects?.length??0)>=2
}
const scoreOf=(l,sim,now)=>{
 const age=(now-l.lastSeen)/DAY,recency=1/(1+age/30)
 return sim*1.0+Math.log(1+l.stats.support)*0.15+recency*0.1-(l.stats.injected?l.stats.recurAfterInject/l.stats.injected:0)*0.5+(l.type==='method'?0:0.05)
}
/** Single recall policy shared by the host and the offline evaluation. Lessons for a failure
 * (exact signature first, then same error class with enough similarity). */
export function selectForError(lessons,err,{scope,config=LESSONS_DEFAULTS,now=Date.now()}={}){
 return lessons.filter(l=>visibleIn(l,scope)&&l.type!=='method').map(l=>{
  if(l.signature===err.signature)return {l,score:10+scoreOf(l,1,now)}
  if(l.errorClass&&l.errorClass===err.errorClass&&(l.scope==='project'||!l.tool||l.tool===err.tool)){
   const sim=lexicalSimilarity(err.normalized??'',l.trigger);return sim>=config.minSimilarity?{l,score:scoreOf(l,sim,now)}:null
  }
  return null
 }).filter(Boolean).sort((a,b)=>b.score-a.score).map(x=>x.l)
}
/** Lessons for the opening request. */
export function selectForOpening(lessons,query,{scope,config=LESSONS_DEFAULTS,now=Date.now()}={}){
 if(!query?.trim())return []
 return lessons.filter(l=>visibleIn(l,scope)).map(l=>{
  const sim=lexicalSimilarity(query,l.trigger+' '+l.advice);return sim>=config.minSimilarity?{l,score:scoreOf(l,sim,now)}:null
 }).filter(Boolean).sort((a,b)=>b.score-a.score).map(x=>x.l)
}

export class LessonStore{
 constructor({directory,limits=LESSONS_DEFAULTS,now=()=>Date.now()}={}){
  Object.assign(this,{directory,limits:{...LESSONS_DEFAULTS,...limits},now});this.path=directory?join(directory,'lessons.json'):null
  this.state=LessonStore.empty()
  this.stamp='';this.checkedAt=0
  if(this.path&&existsSync(this.path)){
   if(statSync(this.path).size>8*1024*1024)throw Error('Lessons ledger exceeds budget')
   this.state=this._read();this.stamp=this._stamp()
  }
 }
 // Identity of the file on disk (inode, mtime, size): atomic renames always change it, even within one clock tick.
 _stamp(){const st=statSync(this.path);return `${st.ino}:${st.mtimeMs}:${st.size}`}
 static empty(){return {version:1,lessons:{},queue:[],calls:{day:0,n:0},metrics:LessonStore.emptyMetrics()}}
 static emptyMetrics(){return {injected:{exposures:0,recurs:0},holdout:{exposures:0,recurs:0},sessions:{injected:{},holdout:{}}}}
 _read(){
  const loaded=JSON.parse(readFileSync(this.path,'utf8'))
  if(loaded?.version!==1||!record(loaded.lessons))throw Error('Invalid lessons ledger')
  const metrics={...LessonStore.emptyMetrics(),...(loaded.metrics??{})}
  metrics.sessions={...LessonStore.emptyMetrics().sessions,...(metrics.sessions??{})}
  return {...LessonStore.empty(),...loaded,queue:Array.isArray(loaded.queue)?loaded.queue:[],metrics}
 }
 /** Exclusive writer lock (stale after 10s) so tools and the host never interleave a read-modify-write. */
 _lock(){
  if(!this.path)return ()=>{}
  mkdirSync(this.directory,{recursive:true,mode:0o700})
  const lp=this.path+'.lock'
  for(let i=0;i<80;i++){
   try{closeSync(openSync(lp,'wx',0o600));return ()=>{try{unlinkSync(lp)}catch{}}}
   catch(e){if(e.code!=='EEXIST')throw e;try{if(Date.now()-statSync(lp).mtimeMs>10000)unlinkSync(lp)}catch{};sleep(25)}
  }
  throw Error('Lessons ledger is locked by another writer')
 }
 /** Merge what another writer changed on disk: new lessons, and operator state changes
 * (retire / approve) that are newer than ours. Everything else in memory wins. */
 refresh(force=false,strict=false){
  if(!this.path||!existsSync(this.path))return 0
  const t=this.now();if(!force&&t-this.checkedAt<this.limits.refreshMs)return 0;this.checkedAt=t
  let m;try{m=this._stamp()}catch(error){if(strict)throw error;return 0}
  if(m===this.stamp)return 0
  let changed=0
  try{
   const disk=this._read()
   for(const [id,l] of Object.entries(disk.lessons??{})){
    const mem=this.state.lessons[id]
    if(!mem){this.state.lessons[id]=l;changed++;continue}
    // A newer state revision wins; on a tie a human action (audit) beats an automatic one.
    const humanRejection=manualRetired(l)&&mem.stateBy!=='audit'
    const protectsRejection=manualRetired(mem)&&l.stateBy!=='audit'
    const newer=humanRejection||(!protectsRejection&&((l.rev??0)>(mem.rev??0)||((l.rev??0)===(mem.rev??0)&&l.stateBy==='audit'&&mem.stateBy!=='audit')))
    // The state string can agree while the authority differs (expiry vs human rejection).
    if(newer){const rev=Math.max(l.rev??0,mem.rev??0);for(const k of OPERATOR_FIELDS)if(k in l)mem[k]=l[k];else delete mem[k];mem.rev=rev;changed++}
   }
   this.stamp=m
  }catch(error){if(strict)throw error}
  return changed
 }
 _write(){
  const data=JSON.stringify(this.state)+'\n',tmp=this.path+'.'+randomUUID()+'.tmp'
  try{writeFileSync(tmp,data,{mode:0o600,flag:'wx'});renameSync(tmp,this.path);this.stamp=this._stamp()}catch(e){try{unlinkSync(tmp)}catch{};throw e}
 }
 save(canWrite=()=>true){
  if(!canWrite())return false
  if(!this.path)return true
  const unlock=this._lock()
  try{if(!canWrite())return false;this.refresh(true,true);if(!canWrite())return false;this._write();return true}finally{unlock()}
 }
 /** Commit extraction against the latest operator decisions under the existing writer lock.
  * Model calls run outside the lock; both the original proposal and the canonical lesson
  * are checked here so a late rejection cannot be bypassed by a new canonical ID.
  * Merge rather than reload the host state to retain its queue, counters and live references. */
 commitProposal(proposal,lesson,options,canCommit=()=>true){
  const blocked=()=>({lesson:null,rejected:false,blocked:true})
  if(!canCommit())return blocked()
  const unlock=this._lock()
  try{
   if(!canCommit())return blocked()
   this.refresh(true,true)
   if(!canCommit())return blocked()
   const rejected=this.manualRetirement(proposal,options.scopeHash)
   const saved=rejected?this.upsert(proposal,{...options,status:'candidate',review:null,verification:null}):this.upsert(lesson,options)
   if(this.path)this._write()
   return {lesson:saved,rejected:!!rejected||manualRetired(saved??{})}
  }finally{unlock()}
 }
 /** Locked read-modify-write for external tools: re-reads the ledger, applies `fn`, writes. */
 update(fn){
  if(!this.path)throw Error('Lessons directory required')
  const unlock=this._lock()
  try{if(existsSync(this.path)){this.state=this._read()};const out=fn(this.state,this);this._write();return out}finally{unlock()}
 }
 setState(l,state,by,extra={}){
  Object.assign(l,{state,rev:(l.rev??0)+1,stateAt:this.now(),stateBy:by,...extra})
  if(state!=='retired'){delete l.retiredAt}
  return l
 }
 list(){return Object.values(this.state.lessons)}
 manualRetirement(l,scopeHash){
  const id='lesson-'+sha([scopeHash,l.type,l.signature,l.trigger,l.advice]).slice(0,20)
  return this.list().find(x=>manualRetired(x)&&x.scope===l.scope&&x.signature===l.signature&&(l.scope==='tool'?x.tool===l.tool:x.scopeHash===scopeHash)&&(x.id===id||lexicalSimilarity(x.trigger+' '+x.advice,l.trigger+' '+l.advice)>=0.5))??null
 }
 /** Store a proposal or a verified lesson without erasing an operator decision. */
 upsert(l,{scopeHash,sourceRef,status='active',review=null,verification=null}){
  const t=this.now(),id='lesson-'+sha([scopeHash,l.type,l.signature,l.trigger,l.advice]).slice(0,20)
  const compatible=x=>x.type===l.type&&x.scope===l.scope&&(l.signature?x.signature===l.signature:true)&&(l.scope==='tool'?x.tool===l.tool:x.scopeHash===scopeHash)
  const related=this.list().filter(compatible)
  const blocked=this.manualRetirement(l,scopeHash)
  if(blocked){blocked.sourceRefs=appendSource(blocked.sourceRefs,sourceRef);blocked.stats.support++;blocked.lastSeen=t;return blocked}
  const verified=status==='active'&&verificationMatches(l,verification)
  const bucket=related.filter(x=>x.state!=='retired')
  // A new candidate cannot add cross-project confirmation or confidence to a live lesson.
  // A proof for a different instruction cannot promote an approximately similar candidate.
  const same=bucket.find(x=>{
   if((status==='candidate'&&x.state==='active')||(verified&&(x.trigger!==l.trigger||x.advice!==l.advice)))return false
   return lexicalSimilarity(x.trigger+' '+x.advice,l.trigger+' '+l.advice)>=0.5
  })
  if(same){
   same.stats.support++;same.lastSeen=t;same.sourceRefs=appendSource(same.sourceRefs,sourceRef)
   if(same.state==='active'||verified)same.projects=[...new Set([...(same.projects??[]),scopeHash])].slice(0,16)
   if(same.state==='suspended'&&same.suspendedBy==='recurrence')same.stats.supportSinceSuspend=(same.stats.supportSinceSuspend??0)+1
   if(rank(l.confidence)>rank(same.confidence))same.confidence=l.confidence
   if(same.state==='candidate'&&review)same.review={...(same.review??{}),...review,needsHuman:!!same.review?.needsHuman||!!review.needsHuman}
   if(same.state==='candidate'&&verified&&!isRisky(same.advice+' '+same.trigger)){
    same.verification=verification;delete same.review;this.setState(same,'active','auto',{promotedBy:'verified-tool-contract'})
   }
   return same
  }
  // Exact IDs must never be overwritten as a side effect of candidate insertion.
  if(this.state.lessons[id]){
   const existing=this.state.lessons[id];existing.sourceRefs=appendSource(existing.sourceRefs,sourceRef)
   return existing
  }
  if(l.signature&&bucket.length>=this.limits.maxPerSignature){
   const weakest=bucket.filter(x=>!x.seed&&x.state!=='active'&&x.stateBy!=='audit').sort((a,b)=>weight(a)-weight(b))[0]
   if(!weakest||weight(weakest)>=3)return null
   delete this.state.lessons[weakest.id]
  }
  const lesson={id,scopeHash,projects:[scopeHash],type:l.type,signature:l.signature,errorClass:l.errorClass,trigger:l.trigger,advice:l.advice,scope:l.scope,tool:l.tool,confidence:l.confidence,state:status,stateAt:t,stateBy:'auto',stats:{support:1,injected:0,recurAfterInject:0,lastRecurAt:null},createdAt:t,lastSeen:t,lastInjectedAt:null,sourceRefs:[sourceRef],...(review?{review}:{}),...(verified?{verification}: {})}
  this.state.lessons[lesson.id]=lesson;this.trim();return lesson
 }
 trim(){
  const byScope=new Map(),key=l=>l.scope==='tool'?'tool:'+l.tool:l.scopeHash
  for(const l of this.list()){const k=key(l);(byScope.get(k)??byScope.set(k,[]).get(k)).push(l)}
  for(const [k,arr] of byScope){
   const max=k.startsWith('tool:')?this.limits.maxPerTool:this.limits.maxPerProject
   // Operator tombstones remain authoritative, but do not consume the capacity for usable lessons.
   const budgeted=arr.filter(x=>!manualRetired(x))
   if(budgeted.length>max)for(const l of budgeted.filter(x=>!x.seed).sort((a,b)=>weight(a)-weight(b)).slice(0,budgeted.length-max))delete this.state.lessons[l.id]
  }
 }
 /** Time-based retirement: unused, weakly supported, non-seed lessons retire, then are purged. */
 expire(){
  const t=this.now(),day=Math.floor(t/DAY);if(this.state.sweptDay===day)return 0
  this.state.sweptDay=day;let n=0
  const ttl=this.limits.expireDays*DAY,purge=this.limits.purgeDays*DAY
  for(const l of this.list()){
   if(l.seed||manualRetired(l))continue
   const used=Math.max(l.lastSeen??0,l.lastInjectedAt??0)
   if(l.state==='retired'){if(t-(l.retiredAt??t)>purge){delete this.state.lessons[l.id];n++};continue}
   if(t-used>ttl&&l.stats.support<3&&!(l.stats.injected>0&&l.stats.recurAfterInject===0&&t-(l.lastInjectedAt??0)<ttl)){this.setState(l,'retired','expiry',{retiredAt:t});n++}
  }
  return n
 }
 callBudget(){
  const day=Math.floor(this.now()/DAY)
  if(this.state.calls.day!==day)this.state.calls={day,n:0}
  return this.state.calls.n<this.limits.maxCallsPerDay
 }
 /** Count one independent unit (session) for the metrics; bounded to the newest 2000 per group. */
 unit(group,sidHash,field){
  const g=this.state.metrics.sessions[group]??={},u=g[sidHash]??={e:0,r:0}
  if(field)u[field]=1
  const keys=Object.keys(g);if(keys.length>2000)for(const k of keys.slice(0,keys.length-2000))delete g[k]
 }
}

/** Host-driven experience loop: observe events, extract lessons after the turn,
 * recall them on error or at task start, and score them by recurrence. */
export class LessonsEngine{
 #sessions=new Map();#timers=new Map();#chain=Promise.resolve();#closed=false
 constructor({store,generate,config={},now=()=>Date.now(),log=()=>{},canWrite=()=>true,routeOf=()=>null,isOptOut=()=>false}={}){
  Object.assign(this,{store,generate,now,log,canWrite,routeOf,isOptOut});this.config={...LESSONS_DEFAULTS,...config};this.stats={observed:0,queued:0,extracted:0,injected:0,errors:0,skipped:0,deferred:0}
  if(this.config.enabled)this._resume()
 }
 _s(sid){let s=this.#sessions.get(sid);if(!s){s={turn:null,failures:[],toolCalls:0,callIds:new Set(),dispatchParents:new Set(),pendingError:null,injections:[],episodes:[],opening:false,openingLessons:[],errorLessons:[]};this.#sessions.set(sid,s)}return s}
 idle(){return this.#chain}
 dispose(){this.#closed=true;for(const t of this.#timers.values())clearTimeout(t);this.#timers.clear()}
 _writable(){try{return !this.#closed&&this.config.enabled&&this.canWrite()===true}catch{return false}}

 /** Feed every host session event. Cheap and synchronous apart from queue writes. */
 observe(session,event,{scope,userText='',optOut=false}={}){
  if(this.#closed||!this.config.enabled||!event||!session?.id)return
  const sid=String(session.id),s=this._s(sid),turn=event.data?.turn
  if(Number.isSafeInteger(event.seq))s.lastSeq=event.seq
  if(event.type==='turn/start'&&turn!==s.turn){Object.assign(s,{turn,failures:[],toolCalls:0,callIds:new Set(),dispatchParents:new Set(),pendingError:null,injections:[],episodes:[],opening:false,openingLessons:[],errorLessons:[]});return}
  if(event.type==='user/message'){
   const blocks=Array.isArray(event.data?.content)?event.data.content:event.data?.message?.content??[]
   const text=blocks.filter(b=>b?.type==='text').map(b=>String(b.text??'')).join('\n')||String(userText||'')
   // The previous turn was collected before this message; an opt-out message is never used as its feedback.
   let withheld=false;try{withheld=!!text.trim()&&this.isOptOut(text)===true}catch{withheld=true}
   if(text.trim())this._drain(e=>e.sid===sid&&String(e.turn)!==String(s.turn),withheld?null:text).catch(()=>{})
   return
  }
  if(event.type==='tool/call'||event.type==='tool/ptc-dispatch-start'||event.type==='tool/ptc-dispatch'){
   const d=event.data??{},direct=event.type==='tool/call',id=direct?d.callId:d.subCallId
   if(!direct){
    // A dispatcher is a container, not an extra operation. Also handles nested run_code.
    for(const parent of [d.rootCallId,d.parentCallId])if(parent){s.dispatchParents.add(String(parent));s.callIds.delete('direct:'+parent);s.callIds.delete('ptc:'+parent)}
   }
   if(id&&!s.dispatchParents.has(String(id)))s.callIds.add((direct?'direct:':'ptc:')+id)
   else if(direct&&!id&&Number.isSafeInteger(event.seq))s.callIds.add('event:'+event.seq)
   s.toolCalls=s.callIds.size
   if(event.type!=='tool/ptc-dispatch')return
  }
  if(event.type==='tool/result'||event.type==='tool/ptc-dispatch'){
   this.stats.observed++
   const names=new Map(),calls=session.snapshotEvents?.(Math.max(0,(session.seq??0)-64),session.seq??0)??[]
   for(const c of calls){
    if(c?.type==='tool/call'&&c.data?.callId)names.set(c.data.callId,{name:c.data.name,hint:callHint(c.data.name,c.data.arguments)})
    if(c?.type==='tool/ptc-dispatch-start'&&c.data?.subCallId)names.set(c.data.subCallId,{name:c.data.name,hint:callHint(c.data.name,c.data.arguments??c.data.args)})
   }
   const f=failureFromEvent(event,id=>names.get(id)??null)
   if(!f)return
   s.failures.push({signature:f.signature,seq:f.seq})
   const m=this.store.state.metrics,sh=sha(sid).slice(0,12)
   // Per-lesson recurrence: the failure repeats a signature the lesson was injected for.
   for(const inj of s.injections)if(!inj.recurred&&inj.keys.has(f.signature)&&f.seq>inj.seq){
    inj.recurred=true
    const l=this.store.state.lessons[inj.id];if(l){l.stats.recurAfterInject++;l.stats.lastRecurAt=this.now();this._maybeSuspend(l)}
   }
   // Per-episode recurrence (one exposure = one session/turn/signature, however many lessons it showed).
   for(const ep of s.episodes)if(!ep.recurred&&ep.keys.has(f.signature)&&f.seq>ep.seq){
    ep.recurred=true;m[ep.group].recurs++;this.store.unit(ep.group,sh,'r')
   }
   s.pendingError={signature:f.signature,tool:f.tool,errorClass:f.errorClass,normalized:f.normalized}
   return
  }
  if(event.type==='turn/end'&&!optOut){
   const reason=typeof event.data?.reason==='string'?event.data.reason:event.data?.reason?.kind
   if(s.injections.length&&this._writable())try{this.store.save(()=>this._writable())}catch{}
   if(!['completed','success'].includes(reason))return
   if(!s.failures.length&&s.toolCalls<2)return
   this._enqueue(sid,scope,turn,session,s)
  }
 }

 _enqueue(sid,scope,turn,session,s){
  if(!scope||!this._writable())return
  const events=this._turnEvents(session,turn);if(!events.length)return
  let route=null;try{route=this.routeOf(sid)??null}catch{}
  const entry={id:randomUUID(),sid,scope,turn,at:this.now(),route,failed:s.failures.length>0,toolCalls:s.toolCalls,repeat:new Set(s.failures.map(f=>f.signature)).size<s.failures.length,pack:buildEvidence(events,{maxChars:this.config.evidenceChars,maxFailures:this.config.maxEvidenceFailures})}
  const q=this.store.state.queue;q.push(entry);while(q.length>this.config.maxQueue)q.shift()
  this.stats.queued++;try{this.store.save(()=>this._writable())}catch{}
  this._schedule(entry,this.config.idleMs)
 }
 _schedule(entry,delay){
  if(this.#closed)return
  clearTimeout(this.#timers.get(entry.id))
  const t=setTimeout(()=>{this.#timers.delete(entry.id);this._drain(e=>e.id===entry.id,null).catch(()=>{})},Math.max(0,delay));t.unref?.();this.#timers.set(entry.id,t)
 }
 /** After a restart, re-arm the idle timer of every persisted entry (overdue ones run at once). */
 _resume(){
  const q=this.store.state.queue,t=this.now(),maxAge=this.config.queueMaxAgeDays*DAY
  for(const entry of [...q]){
   if(!entry?.id||t-(entry.at??0)>maxAge){q.splice(q.indexOf(entry),1);this.stats.skipped++;continue}
   this._schedule(entry,(entry.at??t)+this.config.idleMs-t)
  }
 }
 _turnEvents(session,turn){
  try{
   const end=session.seq??0,evs=session.snapshotEvents?.(Math.max(0,end-2048),end)??[]
   for(let i=evs.length-1;i>=0;i--)if(evs[i]?.type==='turn/start')return String(evs[i].data?.turn)===String(turn)?evs.slice(i):[]
  }catch{}
  return []
 }

 /** Extract lessons for queued turns matching `pick`; serial and failure-tolerant. */
 _drain(pick,nextUser){
  this.#chain=this.#chain.catch(()=>{}).then(async()=>{
   const q=this.store.state.queue,take=q.filter(pick)
   for(const entry of take){
    const i=q.indexOf(entry);if(i<0)continue
    // A lost writer lease or disposal must not consume undispatched work.
    if(!this._writable()){this.stats.deferred++;break}
    const correction=!!nextUser&&CORRECTION.test(nextUser)
    const reasons=[entry.failed&&entry.pack.recovered&&'failure-fix',entry.repeat&&'repeat',correction&&'correction',entry.toolCalls>=5&&!entry.failed&&'method'].filter(Boolean)
    if(!reasons.length||(!entry.failed&&!correction&&entry.toolCalls<5)){this._done(entry);this.stats.skipped++;continue}
    if(!this.store.callBudget()){
     // Keep the entry for the next budget window instead of losing it.
     this.stats.deferred++;this._schedule(entry,3600000);break
    }
    let dispatched=false
    try{
     const route=this.config.extractor?.provider&&this.config.extractor?.model?null:entry.route
     if(!route&&!(this.config.extractor?.provider&&this.config.extractor?.model)){this.stats.skipped++;this.log('[mnemo] lessons extraction skipped: no extractor route for this session');this._done(entry);continue}
     const pack=finalizeEvidence(entry.pack,{maxChars:this.config.evidenceChars,maxFailures:this.config.maxEvidenceFailures,nextUserMessage:nextUser||null,triggerReasons:reasons})
     // Persist the consumed entry and charged call before dispatch. A late
     // shutdown cannot write results, but restart must not replay this call.
     if(!this._reserveCall(entry))break
     dispatched=true
     const out=await this.generate(EXTRACTOR_SYSTEM,pack,{draft:true,route})
     if(!this._writable())break
     const classes=new Map(pack.failures.map(f=>[f.signature,f.errorClass])),fb={signatures:pack.failures.map(f=>f.signature),classes}
     const raws=Array.isArray(out?.lessons)?out.lessons.slice(0,3):[]
     for(const raw of raws){
      if(!this._writable())break
      const proposal=validLesson(raw,fb);if(!proposal)continue
      const sourceRef={sessionId:entry.sid,turn:entry.turn}
      // Template canonicalisation must not disguise a previously rejected proposal as a new ID.
      if(this.store.manualRetirement(proposal,entry.scope)){
       const committed=this.store.commitProposal(proposal,proposal,{scopeHash:entry.scope,sourceRef,status:'candidate'},()=>this._writable())
       if(committed.blocked)break
       this.stats.skipped++;continue
      }
      const c=this._classify(proposal,pack),l=c.lesson??proposal
      // New model-generated merged prose has no verification; it never edits live advice.
      const relation=c.status==='candidate'&&l.signature&&this.config.reconcile&&this.store.callBudget()?await this._reconcile(l,entry.scope,sourceRef,route):null
      if(!this._writable())break
      const committed=this.store.commitProposal(proposal,l,{scopeHash:entry.scope,sourceRef,status:c.status,review:relation??c.review,verification:c.verification},()=>this._writable())
      if(committed.blocked)break
      if(committed.rejected)this.stats.skipped++;else if(committed.lesson)this.stats.extracted++
     }
    }catch(error){this.stats.errors++;this.log('[mnemo] lessons extraction failed: '+String(error?.message??error).slice(0,120));if(!dispatched)break}
    if(!this._writable())break
    this._done(entry)
   }
  })
  return this.#chain
 }
 /** Reserve under the writer lock before the asynchronous model boundary. */
 _reserveCall(entry=null){
  if(!this._writable()||!this.store.callBudget())return false
  const q=this.store.state.queue,index=entry?q.indexOf(entry):-1,calls={...this.store.state.calls}
  if(entry&&index<0)return false
  if(entry)this._done(entry,false)
  this.store.state.calls.n++
  const restore=()=>{this.store.state.calls=calls;if(entry&&!q.includes(entry))q.splice(index,0,entry)}
  try{if(this.store.save(()=>this._writable())===false){restore();return false}}
  catch(error){restore();throw error}
  return this._writable()
 }
 _done(entry,save=true){
  if(!this._writable())return false
  const q=this.store.state.queue,i=q.indexOf(entry);if(i>=0)q.splice(i,1)
  clearTimeout(this.#timers.get(entry.id));this.#timers.delete(entry.id)
  if(save)try{return this.store.save(()=>this._writable())}catch{}
 }
 /** Host-verified contract templates are usable; model prose and repetition are not proof. */
 _classify(l,pack){
  if(isRisky(l.advice+' '+l.trigger))return {status:'candidate',review:{needsHuman:true,reason:'risky-advice'}}
  const verified=verifyRecordedLesson(l,pack)
  if(verified)return {status:'active',review:null,...verified}
  return {status:'candidate',review:{needsHuman:true,reason:l.type==='method'?'unverified-method':'no-verified-recovery'}}
 }

 /** Comparison is advisory only. A model relation cannot modify, suspend, or lend
 * verification to a live lesson. Candidate evidence is retained for later review. */
 async _reconcile(l,scope,sourceRef,route){
  if(!this._writable())return null
  const existing=this.store.list().filter(x=>x.state==='active'&&x.signature===l.signature&&x.scope===l.scope&&(l.scope==='tool'?x.tool===l.tool:x.scopeHash===scope))
  if(!existing.length||existing.some(x=>lexicalSimilarity(x.trigger+' '+x.advice,l.trigger+' '+l.advice)>=0.5))return null
  try{
   if(!this._reserveCall())return null
   const out=await this.generate(RECONCILE_SYSTEM,{existing:existing.map(x=>({id:x.id,trigger:x.trigger,advice:x.advice})),candidate:{trigger:l.trigger,advice:l.advice}},{route})
   if(!this._writable())return null
   const target=existing.find(x=>x.id===out?.targetId)
   if(!target||target.seed||!['same','complement','conflict'].includes(out?.relation))return null
   return {needsHuman:true,reason:'unverified-reconciliation',relation:out.relation,relatedId:target.id}
  }catch(error){this.stats.errors++;this.log('[mnemo] lessons reconcile failed: '+String(error?.message??error).slice(0,120))}
  return null
 }

 _maybeSuspend(l){
  const c=this.config
  if(l.state==='active'&&l.stats.injected>=c.minInjectedForSuspend&&l.stats.recurAfterInject/l.stats.injected>=c.suspendRecurRate)this.store.setState(l,'suspended','recurrence',{suspendedBy:'recurrence'})
 }
 _visible(l,scope){return visibleIn(l,scope)}
 _live(l,scope){return this.store.state.lessons[l.id]===l&&visibleIn(l,scope)}

 /** Lessons for the failure just observed, if any. Marks them injected once per turn. */
 recallOnError(sid,scope){
  if(!this.config.enabled||!this.config.injectOnError)return []
  const s=this._s(sid),err=s.pendingError;if(!err)return []
  s.pendingError=null
  const ranked=selectForError(this.store.list(),err,{scope,config:this.config,now:this.now()})
  const got=this._take(sid,s,ranked,this.config.errorLimit,err.signature,Infinity,'error')
  if(got.length)s.errorLessons=got
  return got
 }
 /** Lessons relevant to the opening request (query + recent context). Once per turn. */
 recallOpening(sid,scope,query){
  if(!this.config.enabled||!this.config.injectOpening||!query?.trim())return []
  const s=this._s(sid);if(s.opening)return [];s.opening=true
  const ranked=selectForOpening(this.store.list(),query,{scope,config:this.config,now:this.now()})
  const got=this._take(sid,s,ranked,this.config.openingLimit,null,this.config.openingChars,'opening')
  s.openingLessons=got
  return got
 }
 /** Context text for one prompt assembly. Providers only live for a single assembly, so lessons
 * chosen earlier in the turn are re-rendered each step, after re-checking that each is still
 * live (not suspended, retired, deleted or out of scope). */
 contextFor(sid,scope,query){
  if(this.#closed||!this.config.enabled)return ''
  try{this.store.refresh();this.store.expire()}catch{}
  this.recallOpening(sid,scope,query);this.recallOnError(sid,scope)
  const s=this._s(sid)
  s.openingLessons=s.openingLessons.filter(l=>this._live(l,scope))
  s.errorLessons=s.errorLessons.filter(l=>this._live(l,scope))
  return [LessonsEngine.formatOpening(s.openingLessons),LessonsEngine.formatError(s.errorLessons)].filter(Boolean).join('\n\n')
 }
 _holdout(sid){const r=this.config.holdoutRate;return r>0&&parseInt(sha(String(sid)).slice(0,6),16)%1000<r*1000}
 _take(sid,s,ranked,limit,sig,chars,kind='opening'){
  const out=[],holdout=this._holdout(sid),group=holdout?'holdout':'injected',m=this.store.state.metrics,sh=sha(String(sid)).slice(0,12);let used=0
  for(const l of ranked){
   if(out.length>=limit)break
   if(s.injections.some(i=>i.id===l.id)||s.episodes.some(e=>e.lessonIds?.includes(l.id)))continue
   const len=l.trigger.length+l.advice.length+12;if(used+len>chars)continue
   used+=len;out.push(l)
   // The watched keys are the lesson's own signature and, after an error, the error actually
   // being intervened on (they differ for a similar-error recall).
   const keys=new Set([l.signature,sig].filter(Boolean)),seq=this._seq(sid)
   if(keys.size){
    const ep=s.episodes.find(e=>!e.recurred&&e.group===group&&[...keys].some(k=>e.keys.has(k)))
    if(ep){keys.forEach(k=>ep.keys.add(k));ep.lessonIds.push(l.id)}
    else{s.episodes.push({group,keys:new Set(keys),seq,recurred:false,lessonIds:[l.id]});m[group].exposures++;this.store.unit(group,sh,'e')}
   }
   if(holdout)continue
   s.injections.push({id:l.id,keys,seq,recurred:false})
   l.stats.injected++;l.lastInjectedAt=this.now();this.stats.injected++
  }
  this._log({kind,sid,turn:s.turn,ids:out.map(l=>l.id),holdout})
  return holdout?[]:out
 }
 _log(row){
  if(!this._writable()||!this.config.logInjections||!row.ids.length||!this.store.directory)return
  try{
   const p=join(this.store.directory,'injections.jsonl')
   if(existsSync(p)&&statSync(p).size>5*1024*1024)return
   mkdirSync(this.store.directory,{recursive:true,mode:0o700})
   appendFileSync(p,JSON.stringify({t:this.now(),sid:sha(String(row.sid)).slice(0,12),turn:row.turn,kind:row.kind,ids:row.ids,holdout:row.holdout})+'\n',{mode:0o600})
  }catch{}
 }
 _seq(sid){return this.#sessions.get(sid)?.lastSeq??0}
 noteSeq(sid,seq){if(Number.isSafeInteger(seq))this._s(sid).lastSeq=seq}

 static formatError(lessons){
  if(!lessons.length)return ''
  return '[经验提示] 你刚遇到的错误以前出现过:\n'+lessons.map(l=>`- 情境:${l.trigger}\n  建议:${l.advice}`).join('\n')+'\n(仅供参考;与当前指令冲突时以当前指令为准)'
 }
 static formatOpening(lessons){
  if(!lessons.length)return ''
  return '[过往经验] 做类似任务时注意:\n'+lessons.map(l=>`- ${l.trigger} → ${l.advice}`).join('\n')+'\n(仅供参考;与当前指令冲突时以当前指令为准)'
 }
 report(){
  const ls=this.store.list(),by=k=>ls.reduce((m,l)=>(m[l[k]]=(m[l[k]]??0)+1,m),{})
  const units=g=>{const v=Object.values(this.store.state.metrics.sessions[g]??{});return {sessions:v.filter(u=>u.e).length,sessionsWithRecurrence:v.filter(u=>u.r).length}}
  return {enabled:this.config.enabled,lessons:ls.length,byState:by('state'),byType:by('type'),needsHuman:ls.filter(l=>l.state==='candidate'&&l.review?.needsHuman).length,queue:this.store.state.queue.length,stats:{...this.stats},callsToday:this.store.state.calls,holdoutRate:this.config.holdoutRate,metrics:{injected:{...this.store.state.metrics.injected,...units('injected')},holdout:{...this.store.state.metrics.holdout,...units('holdout')}}}
 }
}

/** Query for opening recall: the user text plus session title, the previous turn's closing
 * answer and the latest tool names, so short messages like "继续" still find context. */
export function buildQuery(session,userText=''){
 const parts=[String(userText??'')]
 try{
  const end=session?.seq??0,evs=session?.snapshotEvents?.(Math.max(0,end-400),end)??[]
  let title='',lastAssistant='',tools=[]
  for(const e of evs){
   if(e?.type==='session/title'&&typeof e.data?.title==='string')title=e.data.title
   if(e?.type==='assistant/message'){const t=textOfBlocks(Array.isArray(e.data?.content)?e.data.content:e.data?.message?.content).replace(/\n/g,' ');if(t)lastAssistant=t}
   if(e?.type==='tool/call'&&e.data?.name&&!/^mnemo(?:_|\.)/i.test(e.data.name))tools.push(e.data.name)
  }
  // Only a short user message needs the extra context; long ones already carry it.
  if(String(userText).trim().length<40){if(title)parts.push(title);if(lastAssistant)parts.push(scrub(lastAssistant).slice(0,200))}
  parts.push([...new Set(tools.slice(-3))].join(' '))
 }catch{}
 return parts.filter(Boolean).join(' ').trim()
}
