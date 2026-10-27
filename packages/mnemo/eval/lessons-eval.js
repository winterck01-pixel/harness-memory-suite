import {createHash} from 'node:crypto'
import {SimEnv} from './env.js'
import {signatureOf,callHint} from '../lib/lessons-signature.js'
import {LessonStore,LessonsEngine,LESSONS_DEFAULTS,visibleIn} from '../lib/lessons.js'
import {memoryOptOut} from '../lib/context-policy.js'
import {selectCaptureText} from '../lib/capture-policy.js'
import {IRRELEVANT_POOL} from './fixtures.js'

export const SYSTEM=`你在一个模拟环境中完成任务。每一步只输出一个 JSON:{"tool":"read|edit|bash|run_code|activate_tool_group","args":{...}} 或 {"final":"说明"}。
read{path};edit{path,old,new};bash{command}(形如 "write <path> <text>");run_code{code};activate_tool_group{group}。`
export const EVAL_SCOPE='eval-project'
// The live rollout stage 1 injects on error only; pass injectOpening:true to evaluate stage 2.
export function evalConfig(c={}){
 const source=c&&typeof c==='object'&&!Array.isArray(c)?c:{}
 const known=Object.fromEntries(Object.entries(LESSONS_DEFAULTS).filter(([k,v])=>Object.hasOwn(source,k)&&typeof source[k]===typeof v&&(typeof v!=='number'||Number.isFinite(source[k]))).map(([k])=>[k,source[k]]))
 // The arms already define the control. Never mix the production holdout into an arm,
 // write injection logs, capture tasks, or copy arbitrary provider options into results.
 return {...LESSONS_DEFAULTS,enabled:true,injectOpening:false,...known,holdoutRate:0,logInjections:false}
}
const parse=t=>{const m=/\{[\s\S]*\}/.exec(String(t??''));if(!m)return null;try{const v=JSON.parse(m[0]);return v&&typeof v==='object'?v:null}catch{return null}}
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')

/** Give a hand-written or distilled lesson the fields the production policy expects. */
export function evalLesson(l,scope=EVAL_SCOPE,evaluationAt=Date.now()){
 const normalized={state:'active',type:'fix',confidence:'med',scope:'project',scopeHash:l.scope==='tool'?null:scope,projects:[],lastSeen:evaluationAt,
  ...l,stats:{support:1,injected:0,recurAfterInject:0,...(l.stats??{})}}
 return {...normalized,id:typeof l.id==='string'&&l.id?l.id:'eval-'+sha({...l,scope:normalized.scope,scopeHash:normalized.scopeHash}).slice(0,16)}
}
/** Same-length text that carries no information about the task (the "irrelevant" control). */
export function filler(len){
 if(len<=0)return ''
 let s='';for(let i=0;s.length<len;i++)s+=IRRELEVANT_POOL[i%IRRELEVANT_POOL.length]+' '
 return s.slice(0,len)
}
// mulberry32: small seeded PRNG so condition order is reproducible and balanced across repeats.
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
const shuffle=(arr,r)=>{const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

/** Tokens are known only from a valid total or a complete input/output pair. */
export function usageTokens(usage){
 const count=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0
 if(!usage||typeof usage!=='object')return null
 const components=[],knownParts=[]
 for(const [a,b] of [['prompt_tokens','completion_tokens'],['input_tokens','output_tokens'],['promptTokens','completionTokens'],['inputTokens','outputTokens']]){
  if(count(usage[a])||count(usage[b]))knownParts.push((count(usage[a])?usage[a]:0)+(count(usage[b])?usage[b]:0))
  if(count(usage[a])&&count(usage[b])&&count(usage[a]+usage[b]))components.push(usage[a]+usage[b])
 }
 const sums=[...new Set(components)],totals=[...new Set(['total_tokens','totalTokens'].map(k=>usage[k]).filter(count))]
 if(sums.length>1)return null // Conflicting aliases cannot establish one total.
 const summed=sums[0]??null
 if(totals.length===1){
  // A reported zero (or smaller total) cannot contradict known nonzero components.
  return totals[0]>=Math.max(0,...knownParts)?totals[0]:summed
 }
 return summed
}

/** Exercise the host's actual per-turn injection lifecycle in a private in-memory store.
 * No turn/end is emitted, so this evaluator never enqueues extraction or modifies the input library. */
function evaluationStore(library,scope,config,evaluationAt){
 const store=new LessonStore({limits:config,now:()=>evaluationAt})
 for(const raw of library){const l=evalLesson(structuredClone(raw),scope,evaluationAt);store.state.lessons[l.id]=l}
 store.expire()
 return store
}
function policyFor(task,library,scope,config,evaluationAt){
 const store=evaluationStore(library,scope,config,evaluationAt)
 const engine=new LessonsEngine({store,config,now:()=>evaluationAt,generate:async()=>{throw Error('Evaluation must not extract lessons')}})
 const rows=[],session={id:'eval-session',get seq(){return rows.length},snapshotEvents:(a,b)=>rows.filter(e=>e.seq>=a&&e.seq<b)}
 const emit=(type,data)=>{const event={seq:rows.length,type,data:{turn:1,...data}};rows.push(event);engine.observe(session,event,{scope})}
 emit('turn/start',{});emit('user/message',{content:[{type:'text',text:task.prompt}]})
 const withheld=memoryOptOut(task.prompt)||selectCaptureText(task.prompt).hasOptOut
 return {emit,context:()=>withheld?'':engine.contextFor(session.id,scope,task.prompt),selected:()=>engine.stats.injected,dispose:()=>engine.dispose()}
}

export async function runTask(task,{complete,condition,library=[],scope=EVAL_SCOPE,config,maxSteps=8,seed=0,rep=0,evaluationAt=Date.now()}){
 const cfg=evalConfig(config),env=new SimEnv(task.files,{mutateAfterRead:task.mutateAfterRead}),failures=[]
 const policy=condition==='baseline'?null:policyFor(task,library,scope,cfg,evaluationAt)
 const messages=[{role:'system',content:SYSTEM},{role:'user',content:task.prompt}]
 const size=()=>messages.reduce((n,m)=>n+m.content.length,0)
 let steps=0,requestChars=0,explicitFinal=false,protocolErrors=0,usage=null,usageKnown=true
 try{
 while(steps<maxSteps){
  const real=policy?.context()??'',hint=condition==='irrelevant'?filler(real.length):real
  // Host contexts are assembled for each request, rather than permanently appended to a tool result.
  messages[0].content=SYSTEM+(hint?'\n\n'+hint:'')
  requestChars+=size()
  const raw=await complete(messages,{task:task.id,condition,seed,rep,step:steps});steps++
  const reply=typeof raw==='string'?raw:String(raw?.text??'')
  const tokens=usageTokens(raw&&typeof raw==='object'?raw.usage:null)
  if(tokens===null)usageKnown=false;else usage=(usage??0)+tokens
  requestChars+=reply.length
  messages.push({role:'assistant',content:reply})
  const action=parse(reply)
  if(!action||(action.final===undefined&&typeof action.tool!=='string')){
   // An unparseable or empty response is a protocol error, not a normal ending.
   protocolErrors++;const text='Error: 响应必须是单个 JSON 动作({"tool":…} 或 {"final":…})';messages.push({role:'user',content:text});continue
  }
  if(action.final!==undefined){explicitFinal=true;break}
  const args=JSON.stringify(action.args??{}),callId='call-'+steps
  policy?.emit('tool/call',{callId,name:action.tool,arguments:args})
  const r=env.exec(action),text=r.text
  policy?.emit('tool/result',{message:{toolCallId:callId,isError:!r.ok,content:[{type:'text',text}]}})
  if(!r.ok){
   const sig=signatureOf(action.tool,text,callHint(action.tool,args));failures.push({signature:sig.signature,tool:action.tool,normalized:sig.normalized,errorClass:sig.errorClass,text})
  }
  messages.push({role:'user',content:text})
 }
 }finally{policy?.dispose()}
 const counts=new Map();for(const f of failures)counts.set(f.signature,(counts.get(f.signature)??0)+1)
 const goal=!!task.check(env.fs),success=goal&&explicitFinal
 const outcome=success?'success':goal?'goal-without-final':explicitFinal?'abandoned':protocolErrors?'protocol-error':'max-steps'
 const selectedLessons=policy?.selected()??0,injectedLessons=condition==='lessons'?selectedLessons:0
 return {task:task.id,family:task.family,mechanism:task.mechanism??task.family,split:task.split,condition,rep,outcome,success,goal,explicitFinal,protocolErrors,steps,errors:failures.length,repeatedErrors:[...counts.values()].filter(n=>n>1).length,dialogChars:size(),requestChars,tokens:usageKnown?usage:null,selectedLessons,injectedLessons,failures}
}

const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0
export function summarize(rows){
 const by={};for(const r of rows)(by[r.condition]??=[]).push(r)
 const out={}
 for(const [c,rs] of Object.entries(by)){
  const ok=rs.filter(r=>r.success)
  out[c]={runs:rs.length,tasks:new Set(rs.map(r=>r.task)).size,successRate:mean(rs.map(r=>+r.success)),abandonRate:mean(rs.map(r=>+(r.outcome==='abandoned'))),protocolErrorRate:mean(rs.map(r=>+(r.protocolErrors>0))),
   meanErrors:mean(rs.map(r=>r.errors)),meanErrorsOnSuccess:ok.length?mean(ok.map(r=>r.errors)):null,repeatRate:mean(rs.map(r=>+(r.repeatedErrors>0))),meanSteps:mean(rs.map(r=>r.steps)),
   // Dialogue text added to the conversation vs. everything actually sent and received (history is resent each step).
   meanDialogChars:mean(rs.map(r=>r.dialogChars)),meanRequestChars:mean(rs.map(r=>r.requestChars)),
   meanTokens:rs.every(r=>r.tokens!=null)?mean(rs.map(r=>r.tokens)):null,
   lessonInjections:rs.reduce((n,r)=>n+(r.injectedLessons??0),0),runsWithLessonInjection:rs.filter(r=>r.injectedLessons>0).length}
 }
 return out
}
/** Exact two-sided sign test (ties dropped). */
export function signTest(a,b){
 let w=0,l=0;a.forEach((x,i)=>{if(x>b[i])w++;else if(x<b[i])l++})
 const n=w+l;if(!n)return {wins:0,losses:0,p:1}
 const k=Math.min(w,l);let p=0,c=1;for(let i=0;i<=k;i++){p+=c;c=c*(n-i)/(i+1)};p=Math.min(1,2*p/2**n)
 return {wins:w,losses:l,p}
}
/** Repeats of one task are not independent evidence: average them per task first, then compare tasks. */
export function pairedByTask(rows,a,b,metric,{lowerIsBetter=true,onlyComparable=false,minTasks=10}={}){
 const group=(cond)=>{const m=new Map();for(const r of rows)if(r.condition===cond)(m.get(r.task)??m.set(r.task,[]).get(r.task)).push(r);return m}
 const A=group(a),B=group(b)
 let ids=[...A.keys()].filter(k=>B.has(k))
 if(onlyComparable)ids=ids.filter(k=>A.get(k).every(r=>r.success)&&B.get(k).every(r=>r.success))
 const x=ids.map(k=>mean(A.get(k).map(metric))),y=ids.map(k=>mean(B.get(k).map(metric)))
 const better=lowerIsBetter?y.map((v,i)=>x[i]-v):y.map((v,i)=>v-x[i])
 const t=signTest(better,better.map(()=>0))
 const out={independentTasks:ids.length,repeatsPerTask:ids.length?Math.round(mean(ids.map(k=>A.get(k).length))*10)/10:0,meanImprovement:mean(better),wins:t.wins,losses:t.losses,ties:ids.length-t.wins-t.losses}
 return ids.length>=minTasks?{...out,p:t.p}:{...out,p:null,note:`descriptive only: ${ids.length} independent tasks (<${minTasks}); repeats of a task do not add independent evidence`}
}
/** Improvement counts only if the agent still completes the work: fewer errors from giving up,
 * wrong finals or broken protocol are failures, not wins. */
export function judge(summary,rows){
 const b=summary.baseline,l=summary.lessons,reasons=[]
 if(!b||!l)return {valid:false,reasons:['missing baseline or lessons condition']}
 if(l.successRate+1e-9<b.successRate)reasons.push(`task success fell: ${l.successRate.toFixed(2)} < ${b.successRate.toFixed(2)}`)
 if(l.abandonRate>b.abandonRate+1e-9)reasons.push(`abandon rate rose: ${l.abandonRate.toFixed(2)} > ${b.abandonRate.toFixed(2)}`)
 if(l.protocolErrorRate>b.protocolErrorRate+1e-9)reasons.push('protocol error rate rose')
 const success=pairedByTask(rows,'baseline','lessons',r=>+r.success,{lowerIsBetter:false})
 if(success.losses>success.wins)reasons.push(`more tasks regressed (${success.losses}) than improved (${success.wins}) on success`)
 return {valid:reasons.length===0,reasons,success}
}
// Preserve array order: the source order can resolve ties in production recall ranking.
// Hash every supplied field, including scope, trigger, state, statistics and evidence metadata;
// only the digest is exposed, never the private source references themselves.
export function libraryVersion(library){return sha(library).slice(0,16)}

/** Static comparison on one split; condition order is shuffled per task and repeat from `seed`. */
export async function runExperiment({tasks,complete,library,conditions=['baseline','lessons','irrelevant'],repeats=3,split='test',scope=EVAL_SCOPE,config,seed=1,evaluationAt=Date.now()}){
 const rows=[],r=rng(seed),chosen=tasks.filter(t=>!split||t.split===split),effectiveConfig=evalConfig(config)
 for(const task of chosen)for(let rep=0;rep<repeats;rep++)for(const condition of shuffle(conditions,r))rows.push(await runTask(task,{complete,condition,library,scope,config:effectiveConfig,seed,rep,evaluationAt}))
 const summary=summarize(rows),verdict=judge(summary,rows)
 // Production scope values may contain absolute paths. Persist only a controlled label and
 // fingerprint, while matching the original value inside the isolated policy.
 const eligibleLessons=evaluationStore(library,scope,effectiveConfig,evaluationAt).list().filter(l=>visibleIn(l,scope)).length
 return {meta:{seed,repeats,split,scope:scope===EVAL_SCOPE?EVAL_SCOPE:'selected-project',scopeVersion:sha(scope).slice(0,16),evaluationAt,injectOpening:effectiveConfig.injectOpening,effectiveConfig,configVersion:sha(effectiveConfig).slice(0,16),libraryVersion:libraryVersion(library),effectiveLibraryVersion:libraryVersion(library.map(l=>evalLesson(l,scope,evaluationAt))),libraryLessons:library.length,eligibleLessons,independentTasks:chosen.length,note:'repeats of a task are averaged before comparison; holdout disabled within controlled arms; no extraction; eligibleLessons counts active unexpired scope-visible records before relevance and injection switches; injectedLessons counts unique experience exposures per run, excluding irrelevant filler'},
  summary,verdict,
  comparisons:{errorsOnComparableTasks:{vsBaseline:pairedByTask(rows,'baseline','lessons',r=>r.errors,{onlyComparable:true}),vsIrrelevant:pairedByTask(rows,'irrelevant','lessons',r=>r.errors,{onlyComparable:true})},
   success:{vsBaseline:pairedByTask(rows,'baseline','lessons',r=>+r.success,{lowerIsBetter:false}),vsIrrelevant:pairedByTask(rows,'irrelevant','lessons',r=>+r.success,{lowerIsBetter:false})}},
  rows}
}

/** Online learning with a held-out measure. The library learns from `trainTasks` only; after each
 * round the frozen library is evaluated on `heldoutTasks` (other scenarios of the same mechanisms).
 * A gain here is same-mechanism reuse, not generalisation to new failure types. */
export async function runLearningCurve({trainTasks,heldoutTasks,complete,distill,rounds=2,scope=EVAL_SCOPE,config,seed=1,evaluationAt=Date.now()}){
 const library=[],points=[]
 const measure=async(round)=>{
  const rows=[];for(const task of heldoutTasks)rows.push(await runTask(task,{complete,condition:'lessons',library:[...library],scope,config,seed,evaluationAt}))
  const s=summarize(rows).lessons;points.push({round,libraryLessons:library.length,heldoutTasks:heldoutTasks.length,heldoutSuccessRate:s.successRate,heldoutMeanErrors:s.meanErrors,heldoutRepeatRate:s.repeatRate})
 }
 await measure(0)
 for(let r=1;r<=rounds;r++){
  for(const task of trainTasks){
   const run=await runTask(task,{complete,condition:'lessons',library:[...library],scope,config,seed,evaluationAt})
   for(const l of await distill(run,task)??[])if(!library.some(x=>x.signature===l.signature&&x.advice===l.advice))library.push(evalLesson(l,scope,evaluationAt))
  }
  await measure(r)
 }
 return {kind:'same-mechanism-scenario-holdout',evaluationAt,note:'frozen library measured on held-out scenarios; not generalisation to unseen failure types',points,library}
}
