import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {tasks} from './tasks.mjs';
import {SYSTEM,digest,parseAction,classifyTimingErrors} from '../evaluation/runner.mjs';
import {validateFixtureCode} from '../evaluation/safe-code.mjs';

const ownFiles=['runner.mjs','tasks.mjs','PROTOCOL.zh-CN.md','../evaluation/runner.mjs','../evaluation/tasks.mjs','../evaluation/safe-code.mjs'].map(p=>fileURLToPath(new URL(p,import.meta.url)));
async function hashes(paths){return Object.fromEntries(await Promise.all(paths.map(async path=>[path,digest(await readFile(path))])));}
function shuffled(seed){let value=seed>>>0;return tasks.flatMap(t=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return (value/2**32<.5?['baseline','candidate']:['candidate','baseline']).map(arm=>({taskId:t.id,arm}));});}
function hasCatch(code){try{const ast=parse(code,{ecmaVersion:'latest',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true});let caught=false;const walk=n=>{if(!n||typeof n!=='object')return;if(n.type==='CatchClause')caught=true;for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else walk(v);};walk(ast);return caught;}catch{return true;}}
function assertCandidateDecisions(candidateDecisions,reviewReceipt){
 const humanApproved=reviewReceipt?.humanApproved===true
  && reviewReceipt.decision==='accept'
  && reviewReceipt.authority==='observed-user-four-step-approval'
  && reviewReceipt.scope==='fresh-frozen-sandbox-only';
 if(!humanApproved||reviewReceipt.evaluationOnly!==true
  ||typeof reviewReceipt.candidateId!=='string'||!reviewReceipt.candidateId.trim()
  ||!Number.isSafeInteger(reviewReceipt.candidateVersion)||reviewReceipt.candidateVersion<1
  ||typeof reviewReceipt.candidateHash!=='string'||!reviewReceipt.candidateHash.trim())throw Error('REVIEW_SCOPE_REQUIRED');
 for(const task of tasks){
  const decision=candidateDecisions[task.id];
  if(!decision||!Array.isArray(decision.cards)||!Array.isArray(decision.decisions))throw Error('RETRIEVAL_DECISIONS_REQUIRED');
  if(task.family==='matching'&&decision.cards.length!==1)throw Error('MATCHING_REQUIRES_EXACTLY_ONE_CARD');
  if(task.family!=='matching'&&decision.cards.length!==0)throw Error('BOUNDARY_INJECTION');
  for(const card of decision.cards){
   if(card?.contentHash!==reviewReceipt.candidateHash||card.candidateId!==reviewReceipt.candidateId||card.version!==reviewReceipt.candidateVersion)throw Error('REVIEW_CANDIDATE_MISMATCH');
   if(card.humanApproved!==humanApproved||card.evaluationOnly!==reviewReceipt.evaluationOnly)throw Error('CARD_REVIEW_SCOPE_MISMATCH');
   if(typeof card.instruction!=='string'||!card.instruction.trim())throw Error('CARD_INSTRUCTION_REQUIRED');
  }
 }
}
export async function assertFrozen(freeze){
 assertCandidateDecisions(freeze.candidateDecisions,freeze.reviewReceipt);
 if(freeze.protocolVersion!==1||freeze.taskHash!==digest(tasks)||freeze.systemHash!==digest(SYSTEM))throw Error('FREEZE_PROTOCOL_DRIFT');
 if(digest(await hashes(Object.keys(freeze.executionHashes)))!==digest(freeze.executionHashes))throw Error('FREEZE_EXECUTION_DRIFT');
 if(freeze.contentHash!==digest(Object.fromEntries(Object.entries(freeze).filter(([key])=>key!=='contentHash'))))throw Error('FREEZE_CONTENT_DRIFT');
}
/** No network. Caller must supply a full execution manifest, not just this runner. */
export async function prepareConfirmation({directory,providerIdentityHash,fullExecutionFiles,candidateFor,reviewReceipt,verifyReviewReceipt,contractFingerprint,maxSteps=6,seed=271828}){
 if(typeof providerIdentityHash!=='string'||!providerIdentityHash||typeof contractFingerprint!=='string'||!contractFingerprint)throw Error('IDENTITY_REQUIRED');
 if(!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>6)throw Error('INVALID_BUDGET');
 if(!Array.isArray(fullExecutionFiles)||!fullExecutionFiles.length)throw Error('FULL_EXECUTION_MANIFEST_REQUIRED');
 if(typeof verifyReviewReceipt!=='function'||await verifyReviewReceipt(reviewReceipt)!==true)throw Error('TRUSTED_REVIEW_REQUIRED');
 const candidateDecisions=Object.fromEntries(await Promise.all(tasks.map(async task=>[task.id,await candidateFor(task)])));
 assertCandidateDecisions(candidateDecisions,reviewReceipt);
 const freeze={protocolVersion:1,frozen:true,promotionEligible:false,contractFingerprint,providerIdentityHash,reviewReceipt,maxSteps,maxRequests:tasks.length*2*maxSteps,seed,taskHash:digest(tasks),systemHash:digest(SYSTEM),tasks,order:shuffled(seed),candidateDecisions,executionHashes:await hashes([...new Set([...ownFiles,...fullExecutionFiles.map(p=>resolve(p))])])};
 freeze.contentHash=digest(freeze);await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'freeze.private.json'),JSON.stringify(freeze,null,2),{flag:'wx',mode:0o600});return freeze;
}
/** Isolated host/provider injected by a private entry point included in the frozen manifest. */
export async function executeConfirmation({directory,freeze,complete,createHost,verifyReviewReceipt}){
 if(typeof verifyReviewReceipt!=='function'||await verifyReviewReceipt(freeze.reviewReceipt)!==true)throw Error('TRUSTED_REVIEW_REQUIRED');
 await assertFrozen(freeze);
 // Refuse overwriting any prior attempt, including one with provider failure.
 await writeFile(resolve(directory,'started.private.json'),JSON.stringify({freezeHash:freeze.contentHash}),{flag:'wx',mode:0o600});
 const rows=[];let abort=null,requests=0;
 const persist=()=>writeFile(resolve(directory,'results.private.json'),JSON.stringify(rows,null,2),{mode:0o600});
 for(const job of freeze.order){
  const task=freeze.tasks.find(t=>t.id===job.taskId);const row={...job,family:task.family,status:'not-started',goalCorrect:false,missing:true,requests:[],actions:[],modelAlias:'configured-model'};rows.push(row);
  if(abort){row.abortReason=abort;continue;}
  let host;
  try{
   await assertFrozen(freeze);
   const card=job.arm==='candidate'?freeze.candidateDecisions[task.id].cards[0]:null;
   row.cardHash=card?.contentHash??null;
   host=await createHost({...task,taskId:`confirmation-${task.id}-${job.arm}`,sourceId:`confirmation-${task.id}-${job.arm}`,userText:task.prompt});
   if(host.manifest.fingerprint!==freeze.contractFingerprint)throw Error('HOST_CONTRACT_DRIFT');
   const initialCount=host.events.length;
   const messages=[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify({task:task.prompt,tool:task.targetName,initiallyActive:task.initiallyActive,...(card?{historicalReference:card.instruction}:{})})}];
   row.missing=false;row.status='budget-exhausted';
   for(let step=0;step<freeze.maxSteps;step++){
    await assertFrozen(freeze);
    const assembly=await host.assemble();messages.push({role:'user',content:JSON.stringify({hostPrompt:assembly.prompt})});
    if(requests>=freeze.maxRequests)throw Error('GLOBAL_BUDGET_EXHAUSTED');
    requests++;let call;try{call=await complete({messages:structuredClone(messages),metadata:{...job,step,mode:'confirmation'}});}catch(error){row.status='provider-failure';row.error=String(error.message);abort='provider-failure';break;}
    row.requests.push({step,usage:call.usage??null,requestId:call.requestId??null,responseHash:digest(call.text??'')});
    if(call.fatalError){row.status='provider-failure';row.error=call.fatalError;abort='provider-failure';break;}
    messages.push({role:'assistant',content:call.text??''});let action;
    try{action=parseAction(call.text??'');}catch{row.actions.push({step,parseError:true});messages.push({role:'user',content:'InvalidAction: 请只输出约定的JSON对象。'});continue;}
    row.actions.push({step,...action});
    if(action.type==='final'){row.answer=action.answer;row.status='completed';break;}
    try{validateFixtureCode(action.code,task.targetName);}catch(error){row.status='unsafe-code-rejected';row.error=error.message;break;}
    const result=await host.runCode(action.code);messages.push({role:'user',content:JSON.stringify({toolResult:result})});
   }
   row.verification=await host.verify();row.events=host.events.slice(initialCount);row.targetCalls=host.calls;
   row.observableErrorLowerBound=classifyTimingErrors(row.events,task.targetName);
   row.errorObservability=row.actions.some(a=>a.type==='run_code'&&hasCatch(a.code))?'unknown-caught-errors':'uncaught-errors-observable';
   row.activationTimingErrors=row.errorObservability==='unknown-caught-errors'||row.status==='provider-failure'?null:row.observableErrorLowerBound.activationTimingErrors;
   row.permissionGuardObserved=row.events.some(e=>e.type==='result'&&e.tool===task.targetName&&e.payload.ok===false&&JSON.stringify(e.payload).includes('FIXTURE_PERMISSION_DENIED'));
   row.goalCorrect=task.denyTarget?host.calls===0&&row.status==='completed'&&/权限|禁止|不允许|permission|denied/i.test(row.answer??''):host.calls>0&&row.status==='completed'&&(row.answer??'').includes(task.expected);
   row.transcript=messages;
  }catch(error){row.status='execution-failure';row.error=String(error.message);row.goalCorrect=false;abort='execution-failure';}
  finally{if(host)try{await host.close();}catch(error){row.cleanupError=String(error.message);abort='cleanup-failure';}await persist();}
 }
 await persist();
 const summary={frozen:true,promotionEligible:false,mechanismCount:1,plannedArms:freeze.order.length,recordedArms:rows.length,totalRequests:requests,maxRequests:freeze.maxRequests,abort,rows:rows.map(({events,transcript,actions,requests,...r})=>({...r,requests:requests.length}))};
 await writeFile(resolve(directory,'summary.private.json'),JSON.stringify(summary,null,2),{mode:0o600});return summary;
}
