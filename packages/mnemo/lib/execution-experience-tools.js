import {randomUUID} from 'node:crypto'
import {projectScope} from './reliability.js'

// This tool can inspect shadow evidence and ask the human to review one exact
// packet. It cannot insert a memory, approve itself, unfreeze or register skills.
export function registerExecutionExperienceTools(tools,{capture,ask,assertWritable,lifetime,getSessions,allowInvocation=()=>true}) {
 const claims=new Set()
 tools.register({name:'mnemo_experience',description:'Inspect sourced execution-experience candidates for the invoking project. review asks the real user to approve one exact packet ONLY for frozen sandbox evaluation; no long-term memory writes, recall injection, promotion or model calls. Source validation and human review are separate.',parameters:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['status','list','inspect','review']},id:{type:'string'},packetHash:{type:'string'},limit:{type:'integer'}},required:['action']},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute:async(args,exec)=>{
  const session=exec?.agent?.session
  if(!session?.id||!session.header?.cwd||await getSessions()?.get?.(session.id)!==session)throw Error('Trusted invoking project session required')
  const scope=projectScope(session.header.cwd),signal=exec?.signal?AbortSignal.any([exec.signal,lifetime.signal]):lifetime.signal
  signal.throwIfAborted()
  if(!await allowInvocation(session))throw Error('Memory experience inspection is disabled or source is unverified for this turn')
  if(args.action==='status')return JSON.stringify({enabled:!!capture,mode:'shadow-only',productionEligible:false,frozenOnly:true,candidateCount:capture?.list({scope,limit:1000}).length??0})
  if(!capture)throw Error('Execution experience capture is unavailable or disabled')
  if(args.action==='list'){
   const limit=Math.max(1,Math.min(20,Number.isSafeInteger(args.limit)?args.limit:10)),rows=capture.list({scope,limit}),out=[]
   for(const row of rows){signal.throwIfAborted();const validation=await capture.validateCandidate(row.id,{scope});const current=capture.inspect(row.id,{scope});if(current)out.push({...current,sourceValidation:validation.status})}
   return JSON.stringify({mode:'shadow-only',productionEligible:false,candidates:out})
  }
  if(!['inspect','review'].includes(args.action)||typeof args.id!=='string')throw Error('Choose a current-project candidate ID')
  const validation=await capture.validateCandidate(args.id,{scope}),candidate=capture.inspect(args.id,{scope})
  if(!candidate)throw Error('Candidate not found in invoking project')
  const packet={...candidate,sourceValidation:validation.status,sourceReference:capture.sourceReference(args.id,{scope})}
  if(args.action==='inspect')return JSON.stringify(packet)
  assertWritable();signal.throwIfAborted()
  if(validation.status!=='verified')throw Error('Source must be revalidated before human review')
  if(typeof args.packetHash!=='string'||args.packetHash!==candidate.reviewPacketHash)throw Error('Inspect the current packet before requesting review')
  const claim=args.id;if(claims.has(claim))throw Error('This candidate is already awaiting human review')
  const expectedPacketHash=candidate.reviewPacketHash,approve='仅批准冻结沙箱评估',reject='拒绝该候选'
  claims.add(claim)
  try{
   const answer=await ask({agent:exec.agent,signal,questions:[{id:'execution-experience-review',header:'执行经验候选',question:'是否批准这份候选仅用于冻结沙箱评估？',detail:JSON.stringify(packet,null,2)+'\n工具失败和后续成功是观察，不证明因果或经验有效。批准不会写入长期记忆、注入提示或解除冻结。',options:[{label:approve,description:'只审查当前来源、条件和证据指纹'},{label:reject,description:'拒绝该候选，保留审查记录'},{label:'暂不处理',description:'保持待审'}],intent:{kind:'plan-review',approve}}]})
   signal.throwIfAborted();assertWritable()
   if(!await allowInvocation(session)||await getSessions()?.get?.(session.id)!==session||projectScope(session.header.cwd)!==scope)throw Error('Invoking session changed during review')
   signal.throwIfAborted();assertWritable()
   const decision=answer?.answers?.find(row=>row.id==='execution-experience-review')
   if(decision?.custom?.trim()||decision?.selected?.length!==1||![approve,reject].includes(decision.selected[0]))return JSON.stringify({id:args.id,status:'not-reviewed',productionEligible:false})
   return JSON.stringify(await capture.recordHumanReview(args.id,{scope,expectedPacketHash,signal,decision:decision.selected[0]===approve?'approve-frozen-evaluation':'reject',receipt:{id:randomUUID(),kind:'host-user-question',question:'execution-experience-review',packetHash:expectedPacketHash}}))
  } finally {claims.delete(claim)}
 }})
}
