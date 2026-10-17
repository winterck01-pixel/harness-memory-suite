import {loadTaskCorpus} from './production-evaluation.js'
import {usable} from './reliability.js'
import {candidateFingerprint} from './evaluation.js'


export function matchingEvaluationReport(engine,job,corpus,{scope}={}) {
 const proposal=engine.log.proposals.get(job.id),item=engine.log.items.get(job.payload?.ids?.[0])
 const report=proposal?.evaluationReport
 if(!corpus||!report||!item||item.scope!==scope||proposal.scope!==scope||proposal.status!=='pending'||proposal.proposalKind!=='revision-evaluate')return null
 const binding=engine._revisionBinding(item)
 const candidate={text:proposal.text,cues:[...item.cues],kind:item.kind,source:item.source}
 if(report.proposalId!==proposal.id||report.sourceId!==item.id||report.scope!==scope||report.sourceBinding!==binding||proposal.sourceBinding!==binding||report.candidateHash!==candidateFingerprint(candidate)||report.corpusHash!==corpus.hash||report.taskN!==corpus.taskN||report.diagnosticOnly!==corpus.diagnosticOnly)return null
 if(!Array.isArray(report.records)||report.records.length!==corpus.tasks.length)return null
 if(report.records.some((r,i)=>{const task=corpus.tasks[i];return r.taskId!==task.id||r.independentId!==task.independentId||r.kind!==task.kind||r.taskHash!==candidateFingerprint({kind:task.kind,input:task.input})||typeof r.baselineSuccess!=='boolean'||typeof r.candidateSuccess!=='boolean'||r.baselineError||r.candidateError}))return null
 return report
}


export function revisionPreflight(engine,job,{scope,corpusPath=null}={}) {
 const id=job.payload?.ids?.[0],item=engine.log.items.get(id),proposal=engine.log.proposals.get(job.id)
 const blockers=[]
 const minSamples=Number.isInteger(engine.cfg.eval.MIN_SAMPLES)&&engine.cfg.eval.MIN_SAMPLES>=60?engine.cfg.eval.MIN_SAMPLES:60
 if(!scope||job.payload?.scope!==scope||!item||item.scope!==scope)blockers.push('source-unavailable')
 else if(item.archived||item.pinned||item.kind==='rule'||item.trust==='confirmed'||item.source==='human'||!usable(item))blockers.push('source-protected-or-unusable')
 else if(engine._revisionBinding(item)!==job.payload.sourceBinding)blockers.push('source-changed')
 if(proposal&&(proposal.scope!==scope||proposal.proposalKind!=='revision-evaluate'||proposal.status!=='pending'||proposal.sourceBinding!==job.payload.sourceBinding||(job.payload.candidateText!=null&&job.payload.candidateText!==proposal.text)))blockers.push('proposal-changed-or-closed')
 if(engine.cfg.eval.ENABLED===false)blockers.push('evaluation-disabled')
 let corpus=null


 if(!blockers.some(x=>x==='source-unavailable')){
  try {corpus=loadTaskCorpus(corpusPath,{scope,id})}
  catch {blockers.push('corpus-invalid-or-unbound')}
 }
 const ready=blockers.length===0
 const existingReport=ready?matchingEvaluationReport(engine,job,corpus,{scope}):null
 const promotionBlockers=[]
 if(engine.safety.frozen)promotionBlockers.push('safety-frozen')
 if(!engine.cfg.eval.AUTO_PROMOTE)promotionBlockers.push('automatic-promotion-disabled')
 if(corpus?.diagnosticOnly)promotionBlockers.push('diagnostic-corpus')
 if(corpus&&corpus.taskN<minSamples)promotionBlockers.push('insufficient-task-cases')
 promotionBlockers.push('candidate-paired-verdict-required')
 const repeat=job.payload?.force===true
 const willExecute=ready&&(!existingReport||repeat)
 return {corpus,existingReport,readiness:{id:job.id,sourceId:item?.scope===scope?id:null,kind:'revision-evaluate',state:existingReport&&!repeat?'evaluated-pending-evidence':ready?'ready-to-evaluate':'blocked-evidence',blockers,taskN:corpus?.taskN??0,minSamples,caseCount:corpus?.tasks.length??0,estimatedModelCallsUpperBound:willExecute?2*corpus.tasks.length+(!proposal&&job.payload.candidateText==null?1:0):0,promotionBlockers,evaluationRoute:existingReport?.route??null,routePolicy:'Changing model route does not automatically repeat paid evaluation; inspect prior report first.',nextAction:existingReport&&!repeat?'review-evidence-report':ready?'evaluate-candidate':'prepare-valid-project-task-corpus'}}
}


export function evolutionReadiness(engine,{scope,corpusPath=null,id=null}={}) {
 const items=[],seen=new Set()
 const matches=(key,sourceIds)=>!id||id===key||sourceIds.includes(id)
 if(!scope)return {scope:null,items:[],blockers:['project-required'],estimatedModelCallsUpperBound:0}
 for(const job of engine.backlog.items){
  if(job.payload?.scope!==scope||!matches(job.id,job.payload?.ids??[]))continue
  seen.add(job.id)
  if(job.kind==='revision-evaluate')items.push(revisionPreflight(engine,job,{scope,corpusPath}).readiness)
  else {
   const sourceIds=job.payload?.ids??[]
   const validKinds=['gist-compress','skill-compile','retro-plan']
   const blockers=[]
   if(!validKinds.includes(job.kind))blockers.push('unsupported-maintenance-kind')
   if(!sourceIds.length||sourceIds.some(key=>{const source=engine.log.items.get(key);return !source||source.scope!==scope||source.archived||!usable(source)}))blockers.push('source-unavailable-or-withdrawn')
   items.push({id:job.id,kind:job.kind,state:blockers.length?'blocked-evidence':'ready-to-generate',blockers,estimatedModelCallsUpperBound:blockers.length?0:1,nextAction:blockers.length?'review-source-evidence':'explicit-maintenance-then-review'})
  }
 }
 for(const proposal of engine.log.proposals.values()){
  if(proposal.scope!==scope||seen.has(proposal.id)||!matches(proposal.id,(proposal.sourceRevisions??[]).map(r=>r.id)))continue
  if(proposal.proposalKind==='revision-evaluate'&&proposal.status==='pending'){
   const job={id:proposal.id,payload:{scope,ids:(proposal.sourceRevisions??[]).map(r=>r.id),sourceBinding:proposal.sourceBinding,candidateText:proposal.text}}
   const view=revisionPreflight(engine,job,{scope,corpusPath}).readiness
   items.push({...view,hasEvaluationReport:!!proposal.evaluationReport})
  } else items.push({id:proposal.id,kind:proposal.proposalKind,state:proposal.status==='accepted'?'applied':proposal.status==='pending'?'pending-review':'withdrawn',blockers:[],estimatedModelCallsUpperBound:0,nextAction:proposal.status==='pending'?'review-proposal':'none'})
 }
 return {scope,items,blockers:id&&!items.length?['candidate-not-found-in-project']:[],estimatedModelCallsUpperBound:items.reduce((n,item)=>n+item.estimatedModelCallsUpperBound,0)}
}
