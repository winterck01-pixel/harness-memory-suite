import {projectScope,usable} from './reliability.js'
import {candidateFingerprint} from './evaluation.js'
import {evolutionReadiness} from './evolution-readiness.js'
import {normalizeSourceRevisions,sourceRevisionKey} from './source-revisions.js'

const view=p=>({id:p.id,kind:p.proposalKind,status:p.status,text:p.text,sources:p.sourceRevisions.map(r=>({id:r.id,version:r.seq}))})
export async function evolve({engine,maintenance,ask,claims,args,scope,agent,signal,assertWritable}) {
 signal?.throwIfAborted()
 if(!scope)throw Error('An invoking project is required')
 if(args.action==='status')return evolutionReadiness(engine,{scope,corpusPath:maintenance.corpusPath,id:args.proposalId??null})
 assertWritable();engine.log.refreshFromDisk()
 if(args.action==='prepare') {
  if(!['summary','skill'].includes(args.kind)||!Array.isArray(args.sourceIds)||!args.sourceIds.length||args.sourceIds.length>12||new Set(args.sourceIds).size!==args.sourceIds.length)throw Error('Choose summary or skill and 1-12 unique current-project source IDs')
  const items=[...args.sourceIds].sort().map(id=>engine.log.items.get(id))
  if(items.some(it=>!it||it.scope!==scope||it.archived||!usable(it)))throw Error('Sources unavailable in current project')
  const kind=args.kind==='summary'?'gist-compress':'skill-compile'
  const revisions=normalizeSourceRevisions(items.map(it=>({id:it.id,seq:it.activeSeq,reviewSeq:it.reviewSeq??null})),scope)
  if(!revisions)throw Error('Invalid source revisions')
  const revisionKey=sourceRevisionKey(revisions,scope)
  const key='learning:'+candidateFingerprint({scope,kind,revisions})
  if(claims.has(key))throw Error('This learning request is already running')
  const existing=[...engine.log.proposals.values()].find(p=>p.scope===scope&&p.proposalKind===kind&&sourceRevisionKey(p.sourceRevisions,p.scope)===revisionKey)
  if(existing)return {...view(existing),deduplicated:true}
  claims.add(key)
  try {
   let job=engine.backlog.items.find(j=>j.target===key&&j.payload?.scope===scope)
   if(!job)job=engine.backlog.enqueue({kind,target:key,payload:{ids:items.map(it=>it.id),scope},dedupe:false}).item
   if(!engine.backlog.items.includes(job))throw Error('Maintenance queue is full')
   engine.checkpoint()
   const result=await engine.drainBacklog(j=>maintenance.process(j,{scope,signal,agent}),{limit:1,filter:j=>j.id===job.id})
   if(result.failed.length)throw Error(result.failed[0].error??'Draft generation failed')
   const p=engine.log.proposals.get(job.id)
   if(!p)throw Error('Draft not ready; inspect evolution status')
   return {...view(p),note:'Draft only; no authoritative memory has been changed. Review requires a host user confirmation.'}
  } finally {claims.delete(key)}
 }
 if(args.action!=='review')throw Error('Unsupported evolution action')
 if(!agent?.session)throw Error('Review requires a conversation and human confirmation')
 const p=engine.log.proposals.get(args.proposalId)
 if(!p||p.scope!==scope||p.status!=='pending'||!['gist-compress','skill-compile','retro-plan'].includes(p.proposalKind))throw Error('Unknown pending summary or skill; evaluated revisions use the statistical gate')
 const key='review-learning:'+p.id
 if(claims.has(key))throw Error('This draft is already awaiting review')
 const binding=()=>candidateFingerprint({proposal:engine.log.proposals.get(p.id),sources:p.sourceRevisions.map(r=>{const it=engine.log.items.get(r.id);return it?engine._revisionBinding(it):null})})
 const bound=binding()
 const archived=p.proposalKind==='gist-compress'?p.sourceRevisions.map(r=>engine.log.items.get(r.id)).filter(it=>it&&!it.archived&&!it.pinned&&it.trust!=='confirmed').map(it=>it.id):[]
 const archiveNotice=archived.length?'\n同时将以下原始记录移入可恢复归档（保留历史，可 unarchive 恢复）：'+archived.join('、'):'\n本次不归档原始记录。'

 claims.add(key)
 try {
  const label='采纳这份提炼'
  const answer=await ask({agent,signal,questions:[{id:'learning-review',header:'经验提炼',question:'是否采纳这份经验草稿？',detail:p.text+'\n来源：'+p.sourceRevisions.map(r=>r.id).join('、')+archiveNotice+'\n采纳保留审计记录；不修改模型权重或自动进化权限。',options:[{label,description:'仅采纳当前展示的草稿'},{label:'暂不采纳',description:'保留草稿，不改变记忆'}],intent:{kind:'plan-review',approve:label}}]})
  signal?.throwIfAborted();assertWritable();engine.log.refreshFromDisk()
  if(binding()!==bound)throw Error('Draft or sources changed while awaiting approval')
  const decision=answer?.answers?.find(a=>a.id==='learning-review')
  if(decision?.custom?.trim()||decision?.selected?.length!==1||decision.selected[0]!==label)return {id:p.id,status:'not-approved',applied:false}
  const result=engine.acceptProposal(p.id,{scope});engine.checkpoint()
  return {proposalId:p.id,status:'applied',applied:true,...result}
 } finally {claims.delete(key)}
}
export function registerEvolutionTools(tools,{engine,maintenance,ask,claims,configuredScope,lifetime,assertWritable}) {
 tools.register({name:'mnemo_evolve',description:'Inspect learning readiness for free; prepare a cited summary/skill draft from explicit recalled source IDs; review a draft through real host user confirmation. Never auto-approves, changes model weights, or bypasses evaluation gates. Do not repeat unchanged preparation.',parameters:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['status','prepare','review']},kind:{type:'string',enum:['summary','skill']},sourceIds:{type:'array',items:{type:'string'}},proposalId:{type:'string'}},required:['action']},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute:async(args,exec)=>{const cwd=exec?.agent?.session?.header?.cwd;const scope=cwd?projectScope(cwd):configuredScope;const signal=exec?.signal?AbortSignal.any([exec.signal,lifetime.signal]):lifetime.signal;return JSON.stringify(await evolve({engine,maintenance,ask,claims,args,scope,agent:exec?.agent,signal,assertWritable}))}})
}
