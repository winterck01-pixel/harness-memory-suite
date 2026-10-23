import {randomUUID} from 'node:crypto'
import {projectScope} from './reliability.js'
import {readCurrentTurnEvents} from './turn-capture.js'

const texts={type:'array',minItems:1,maxItems:8,items:{type:'string',minLength:2,maxLength:400}}
const successEvidence={type:'object',additionalProperties:false,properties:{
 actionSeqs:{type:'array',minItems:1,maxItems:8,items:{type:'integer',minimum:0}},
 checkSeq:{type:'integer',minimum:0},
 expected:{type:'string',minLength:16,maxLength:1000,description:'A substantive fragment of the real subsequent verification output, copied from recent_evidence. Bare success/true/ok is not outcome evidence.'},
 summary:{type:'string',minLength:8,maxLength:600,description:'What was actually checked, including the artifact or measurable result and limits of the check.'},
},required:['actionSeqs','checkSeq','expected','summary']}
const successDraft={type:'object',additionalProperties:false,description:'Keep title, cues, conditions, method and limits together within 2600 characters. Store transferable methods, not private data or whole logs.',properties:{
 title:{type:'string',minLength:4,maxLength:160},cues:{...texts,items:{type:'string',minLength:2,maxLength:80}},conditions:texts,method:{anyOf:[texts,{type:'string',minLength:2,maxLength:400}],description:'Reusable steps as a short array, or one concise method paragraph. Whole method record must be concise.'},limits:texts,evidence:successEvidence,
},required:['title','cues','conditions','method','limits','evidence']}
const successActions=new Set(['success_status','recent_evidence','record_success','recall_success','inspect_success','use_success','outcome_success','fail_success'])

// Sourced successful methods are conditional historical data, separate from
// ordinary facts and frozen optimization candidates. No action grants authority.
export function registerExecutionExperienceTools(tools,{capture,learning,dailyLearning=null,successfulExperiences=null,dailyRecovery=null,recoveryState=()=>null,ask,assertWritable,lifetime,getSessions,allowInvocation=()=>true}) {
 const claims=new Set()
 tools.register({name:'mnemo_experience',description:'Project-scoped experience. For a useful successful method: independently check the actual result first, recent_evidence returns current-turn result seqs, then record_success with draft {title,cues,conditions,method,limits,evidence:{actionSeqs,checkSeq,expected,summary}}. Evidence references result seqs; check must follow actions and be a separate real tool check. It becomes conditional historical data only after turn-end source validation, never a system rule or proof of superiority. recall_success(query) finds methods; use_success(id,conditionCheck) declares actual use after checking every condition; outcome_success(id,evidence) links a subsequent actual result check; fail_success(id,reason) suspends an adopted unsuitable method. success_status/inspect_success show success methods and pending review. Existing status/list/inspect/review retain frozen execution-candidate semantics; review authorizes frozen sandbox only. recovery_plan records 2-4 steps after error; daily_status/use_daily retain the fixed activation method. No policy changes, ordinary fact-memory writes, skill installation, or unfreezing.',parameters:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['status','list','inspect','review','learning_status','daily_status','recovery_plan','use_daily',...successActions]},id:{type:'string'},packetHash:{type:'string'},limit:{type:'integer'},steps:{type:'array',items:{type:'string'}},change:{type:'string'},query:{type:'string',maxLength:2000},draft:successDraft,evidence:successEvidence,conditionCheck:{type:'string',minLength:8,maxLength:1200},reason:{type:'string',minLength:8,maxLength:600}},required:['action']},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute:async(args,exec)=>{
  const session=exec?.agent?.session
  if(!session?.id||!session.header?.cwd)throw Error('Trusted invoking project session required')
  const scope=projectScope(session.header.cwd),signal=exec?.signal?AbortSignal.any([exec.signal,lifetime.signal]):lifetime.signal
  // Pin before the first await: an authorization lookup can outlive this turn.
  const dailyAction=['use_daily','recovery_plan'].includes(args.action)||successActions.has(args.action),turn=dailyAction?recoveryState(session)?.turn:null
  const invocationInput=()=>JSON.stringify(readCurrentTurnEvents(session,turn).filter(e=>e.type==='user/message'))
  const initialInput=dailyAction?invocationInput():null
  const current=()=>exec?.agent?.session===session&&projectScope(session.header?.cwd)===scope&&(!dailyAction||turn!=null&&recoveryState(session)?.turn===turn)&&
    (initialInput===null||invocationInput()===initialInput)
  const guard=async()=>{
    signal.throwIfAborted();assertWritable()
    if(!current()||await getSessions()?.get?.(session.id)!==session)throw Error('Trusted invoking project session required')
    signal.throwIfAborted();if(!current())throw Error('Invoking session changed during daily experience action')
    if(!await allowInvocation(session))throw Error('Memory experience inspection is disabled or source is unverified for this turn')
    signal.throwIfAborted();assertWritable()
    if(!current()||getSessions()?.get?.(session.id)!==session)throw Error('Invoking session changed during daily experience action')
    return true
  }
  guard.current=()=>{signal.throwIfAborted();assertWritable();return current()&&getSessions()?.get?.(session.id)===session}
  signal.throwIfAborted()
  if(await getSessions()?.get?.(session.id)!==session)throw Error('Trusted invoking project session required')
  signal.throwIfAborted();if(!current())throw Error('Invoking session changed during daily experience action')
  if(successActions.has(args.action)){
    if(!successfulExperiences)throw Error('Successful methods are disabled')
    await guard()
    const context={session,turn,sessionId:session.id,turnId:turn,guard,signal}
    let result
    switch(args.action){
      case 'success_status':result=successfulExperiences.status({scope});break
      case 'recent_evidence':result=successfulExperiences.recentEvidence(session,turn);break
      case 'record_success':result=await successfulExperiences.stage(scope,{...context,draft:args.draft});break
      case 'inspect_success':result=successfulExperiences.inspect(scope,args.id);break
      case 'recall_success':{
        if(!args.query?.trim())throw Error('A concrete current-task query is required')
        result=await successfulExperiences.recall(scope,{...context,query:args.query,limit:args.limit})
        try{await guard()}catch(error){
          for(const receipt of result.deliveries??[])await successfulExperiences.revokeDelivery(scope,receipt)
          throw error
        }
        break
      }
      case 'use_success':result=await successfulExperiences.noteUse(scope,{...context,id:args.id,conditionCheck:args.conditionCheck});break
      case 'outcome_success':result=await successfulExperiences.stageOutcome(scope,{...context,id:args.id,evidence:args.evidence});break
      case 'fail_success':result=await successfulExperiences.noteFailure(scope,{...context,id:args.id,reason:args.reason});break
    }
    signal.throwIfAborted();if(!guard.current())throw Error('Invoking session changed during successful method action')
    return JSON.stringify(result)
  }
  if(!await allowInvocation(session))throw Error('Memory experience inspection is disabled or source is unverified for this turn')
  signal.throwIfAborted();if(!current())throw Error('Invoking session changed during daily experience action')
  if(args.action==='daily_status')return JSON.stringify({daily:dailyLearning?.status({scope})??{enabled:false},recovery:recoveryState(session)})
  if(args.action==='recovery_plan'){
    assertWritable();signal.throwIfAborted()
    if(!dailyLearning||!dailyRecovery)throw Error('Daily recovery is disabled')
    await guard();if(!guard.current())throw Error('Invoking session changed during daily experience action')
    return JSON.stringify(dailyRecovery.plan(recoveryState(session),{steps:args.steps,change:args.change}))
  }
  if(args.action==='use_daily'){
    assertWritable();signal.throwIfAborted()
    if(!dailyLearning)throw Error('Daily experience is disabled')
    await guard()
    return JSON.stringify(await dailyLearning.noteUse(scope,{cardId:args.id,sessionId:session.id,turnId:turn,guard,signal}))
  }
  if(args.action==='learning_status')return JSON.stringify(learning?.report({scope})??{mode:'disabled'})
  if(args.action==='status')return JSON.stringify({enabled:!!capture,mode:'shadow-only',productionEligible:false,frozenOnly:true,candidateCount:capture?.list({scope,limit:1000}).length??0,daily:dailyLearning?.status({scope})??{enabled:false},successfulMethods:successfulExperiences?.status({scope})??{enabled:false}})
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
