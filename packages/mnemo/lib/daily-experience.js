import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync,statSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {candidateFingerprint as digest} from './evaluation.js'
import {identifyActivationTiming} from './activation-evidence.js'
import {getActivationSandboxContract,createActivationSandbox} from './activation-sandbox.js'
import {ACTIVATION_INSTRUCTION} from './experience-learning.js'

const HASH=/^[a-f0-9]{64}$/,clone=v=>structuredClone(v)
const MECHANISM='tool-activation-timing'
const exactValue=host=>host.events.some(e=>e.type==='result'&&e.tool==='daily_probe'&&e.result?.isError===false&&e.result?.value?.value===42)
const deliveryKey=(sessionId,turnId)=>digest([String(sessionId),String(turnId)])
const conditions=q=>q?.permission==='allowed'&&q?.initiallyActive===false&&HASH.test(q?.contractFingerprint??'')
const task=(mode)=>({id:'daily-'+mode,independentId:'daily-fixed-'+mode,independenceBasis:'Operator-authored deterministic local runtime contract check',kind:'probe',input:{question:'Read the isolated fixture value.',targetName:'daily_probe',initiallyActive:mode==='active',denyTarget:mode==='denied',contractVisibility:mode==='unknown'?'withheld':'known',operation:'sum',data:[19,23]},expected:mode==='denied'?{status:'permission-denied'}:42})

// There is deliberately no model, external judge, source-code execution or
// caller-supplied probe. These programs exercise only the existing safe sandbox.
async function verifyContract(options,contract){
 const receipts=[]
 for(const mode of ['fresh','active','denied','unknown']){
  const host=await createActivationSandbox({...options,task:task(mode)})
  try{
   if(host.manifest.fingerprint!==contract.fingerprint)throw Error('DailyContractMismatch')
   if(mode==='fresh'){
    const negative=await host.run('await tools.activate_tool_group({tools:["daily_probe"]});return await tools.daily_probe({});')
    if(negative?.isError!==true||host.calls!==0||!host.events.some(e=>e.type==='result'&&e.tool==='run_code'&&e.result?.isError===true&&String(e.result.error?.message??'').includes('tools.daily_probe is not a function')))throw Error('DailyNegativeCheckFailed')
    await host.assemble()
    const positive=await host.run('return await tools.daily_probe({});')
    if(positive?.isError!==false||host.calls!==1||!exactValue(host))throw Error('DailyRepairCheckFailed')
   }else if(mode==='active'){
    const positive=await host.run('return await tools.daily_probe({});')
    if(positive?.isError!==false||host.calls!==1||!exactValue(host))throw Error('DailyActiveCheckFailed')
   }else if(mode==='denied'){
    await host.run('return await tools.activate_tool_group({tools:["daily_probe"]});');await host.assemble()
    const denied=await host.run('return await tools.daily_probe({});')
    if(denied?.isError!==true||host.calls!==0||!host.events.some(e=>e.type==='result'&&e.tool==='daily_probe'&&e.result?.isError===true&&JSON.stringify(e.result).includes('FIXTURE_PERMISSION_DENIED')))throw Error('DailyDeniedCheckFailed')
   }else{
    const unavailable=await host.run('return await tools.daily_probe({});')
    if(unavailable?.isError!==true||host.calls!==0||conditions({permission:'allowed',initiallyActive:false}))throw Error('DailyUnknownCheckFailed')
   }
   receipts.push({mode,taskHash:digest(task(mode)),executionHash:digest(host.events),actualTargetCalls:host.calls})
  }finally{await host.close()}
 }
 const after=await getActivationSandboxContract(options)
 if(after.fingerprint!==contract.fingerprint)throw Error('DailyContractMismatch')
 return {version:1,kind:'deterministic-official-tool-runtime',mechanism:MECHANISM,sandboxFingerprint:contract.fingerprint,sourceHashesHash:digest(contract.sourceHashes),probes:receipts,modelCalls:0,productionWrites:false}
}

/** Separate, narrow reusable-experience channel. Legacy candidates and ordinary
 * long-term memory remain untouched. All constructor options are operator-owned.
 */
export class DailyExperience{
 #queue=Promise.resolve();#proofs=new Map();#canWrite
 constructor({directory,capture,enabled=false,consumerFingerprint=null,legacyFrozen=true,ttlMs=86400000,maxCards=32,canWrite=()=>true,sandboxOptions={}}={}){
  if(!Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>604800000||!Number.isSafeInteger(maxCards)||maxCards<1||maxCards>128)throw Error('InvalidDailyBudget')
  this.enabled=enabled===true;this.capture=capture;this.consumerFingerprint=consumerFingerprint;this.legacyFrozen=legacyFrozen;this.ttlMs=ttlMs;this.maxCards=maxCards;this.directory=directory;this.sandboxOptions={...sandboxOptions};this.#canWrite=canWrite
  this.path=directory?join(directory,'daily-experience.json'):null;this.state={version:1,cards:{}};this.lastError=null
  if(this.enabled&&this.path&&existsSync(this.path)){
   if(statSync(this.path).size>262144)throw Error('DailyLedgerBudget')
   const s=JSON.parse(readFileSync(this.path,'utf8'))
   if(s.version!==1||!s.cards||Array.isArray(s.cards)||Object.keys(s.cards).length>maxCards)throw Error('InvalidDailyLedger')
   for(const [id,c] of Object.entries(s.cards))if(c.id!==id||!this._valid(c))throw Error('InvalidDailyCard')
   this.state=s
  }
  this.committed=clone(this.state)
 }
 _valid(c){return c&&c.mechanism===MECHANISM&&c.instruction===ACTIVATION_INSTRUCTION&&['limited-use','suspended','expired'].includes(c.state)&&['scopeHash','consumerFingerprint','sandboxFingerprint','sourceFingerprint','receiptHash','sourceContractFingerprint'].every(k=>HASH.test(c[k]??''))&&typeof c.candidateId==='string'&&Number.isSafeInteger(c.expiresAt)&&Number.isSafeInteger(c.createdAt)&&c.expiresAt>c.createdAt&&c.expiresAt-c.createdAt<=604800000&&/^[A-Za-z_$][\w$]{0,127}$/.test(c.targetTool)&&c.receiptHash===digest(c.receipt??null)&&this._validReceipt(c)&&c.bindingHash===digest(this._binding(c))}
 _validReceipt(c){const r=c.receipt,p=r?.proof;return r?.sourceFingerprint===c.sourceFingerprint&&r?.consumerFingerprint===c.consumerFingerprint&&r?.scopeHash===c.scopeHash&&p?.version===1&&p?.kind==='deterministic-official-tool-runtime'&&p?.mechanism===MECHANISM&&p?.sandboxFingerprint===c.sandboxFingerprint&&HASH.test(p?.sourceHashesHash??'')&&p?.modelCalls===0&&p?.productionWrites===false&&Array.isArray(p?.probes)&&p.probes.length===4&&p.probes.every((v,i)=>v.mode===['fresh','active','denied','unknown'][i]&&v.taskHash===digest(task(v.mode))&&HASH.test(v.executionHash??'')&&v.actualTargetCalls===(i<2?1:0))}
 _binding(c){return {mechanism:c.mechanism,instruction:c.instruction,scopeHash:c.scopeHash,consumerFingerprint:c.consumerFingerprint,sandboxFingerprint:c.sandboxFingerprint,sourceFingerprint:c.sourceFingerprint,sourceContractFingerprint:c.sourceContractFingerprint,candidateId:c.candidateId,targetTool:c.targetTool,receiptHash:c.receiptHash,createdAt:c.createdAt,expiresAt:c.expiresAt}}
 _base(){if(!this.enabled)return 'disabled';try{if(this.#canWrite()!==true)return 'read-only'}catch{return 'read-only'}if(!HASH.test(this.consumerFingerprint??'')||!this.capture)return 'unbound';return null}
 _serial(fn){const p=this.#queue.catch(()=>{}).then(async()=>{try{return await fn()}catch(error){this.lastError=String(error.message).slice(0,100);return {status:'unavailable',reason:this.lastError}}});this.#queue=p;return p}
 _save(){
  const tmp=this.path?this.path+'.'+randomUUID()+'.tmp':null
  try{
   const refusal=this._base();if(refusal)throw Error('DailyWriteRefused:'+refusal)
   const data=JSON.stringify(this.state)+'\n'
   if(Buffer.byteLength(data)>262144)throw Error('DailyLedgerBudget')
   if(!this.path)throw Error('DailyDirectoryRequired')
   mkdirSync(this.directory,{recursive:true,mode:0o700});writeFileSync(tmp,data,{mode:0o600,flag:'wx'});renameSync(tmp,this.path);this.committed=clone(this.state);return true
  }catch(error){this.state=clone(this.committed);if(tmp)try{unlinkSync(tmp)}catch{}throw error}
 }

 _suspend(c,reason){c.state='suspended';c.reason=reason;c.deliveries={};this._save()}
 async _current(c,scope,contract){
  if(!this._valid(c)||c.scopeHash!==digest(scope)||c.consumerFingerprint!==this.consumerFingerprint||c.sandboxFingerprint!==contract.fingerprint)return 'binding-changed'
  if(Date.now()>=c.expiresAt)return 'expired'
  // A capture callback may already hold its queue. Never wait on that queue.
  if(this.capture.hasPendingWork())return 'source-busy'
  const check=await this.capture.validateCandidate(c.candidateId,{scope})
  if(check.status!=='verified'||check.candidate?.sourceFingerprint!==c.sourceFingerprint||check.candidate?.contractFingerprint!==c.sourceContractFingerprint||!this.capture.isCandidateCurrent(c.candidateId,{scope}))return 'source-invalid'
  return null
 }
 consider(scope){return this._serial(async()=>{
  const refusal=this._base();if(refusal)return {status:refusal};if(typeof scope!=='string'||!scope)return {status:'invalid-scope'};if(this.capture.hasPendingWork())return {status:'source-busy'}
  const contract=await getActivationSandboxContract(this.sandboxOptions),results=[]
  for(const candidate of this.capture.list({scope,limit:1000})){
   if(!(candidate.observation?.toolFailureCount>0)){results.push({candidateId:candidate.id,status:'not-experience'});continue}
   const old=Object.values(this.state.cards).find(c=>c.candidateId===candidate.id&&c.scopeHash===digest(scope))
   if(old){const reason=await this._current(old,scope,contract);if(reason&&reason!=='source-busy')this._suspend(old,reason);results.push({candidateId:candidate.id,status:reason??old.state});continue}
   if(this.capture.hasPendingWork())return {status:'source-busy',results}
   const checked=await this.capture.validateCandidate(candidate.id,{scope});if(checked.status!=='verified'){results.push({candidateId:candidate.id,status:'needs-review',reason:checked.status});continue}
   const evidence=await this.capture.readValidatedEvidence(candidate.id,{scope})
   const match=evidence.status==='verified'?identifyActivationTiming(evidence.events):null
   if(match?.status!=='matched'||match.repair?.status!=='observed'||candidate.kind!=='execution-experience-hypothesis'){results.push({candidateId:candidate.id,status:'needs-review',reason:'unregistered-or-unverified-mechanism'});continue}
   if(Object.keys(this.state.cards).length>=this.maxCards){results.push({candidateId:candidate.id,status:'needs-review',reason:'card-budget'});continue}
   let proof=this.#proofs.get(contract.fingerprint)
   if(!proof){proof=await verifyContract(this.sandboxOptions,contract);this.#proofs.set(contract.fingerprint,proof)}
   if(this.capture.hasPendingWork()){results.push({candidateId:candidate.id,status:'needs-review',reason:'source-busy'});continue}
   const after=await this.capture.validateCandidate(candidate.id,{scope})
   if(after.status!=='verified'||after.candidate?.sourceFingerprint!==candidate.sourceFingerprint||after.candidate?.contractFingerprint!==candidate.contractFingerprint||!this.capture.isCandidateCurrent(candidate.id,{scope})){results.push({candidateId:candidate.id,status:'needs-review',reason:'source-changed'});continue}
   const createdAt=Date.now(),receipt={proof,sourceFingerprint:candidate.sourceFingerprint,consumerFingerprint:this.consumerFingerprint,scopeHash:digest(scope)},c={id:'daily-'+digest([scope,candidate.id,contract.fingerprint,this.consumerFingerprint]).slice(0,24),mechanism:MECHANISM,state:'limited-use',instruction:ACTIVATION_INSTRUCTION,scopeHash:digest(scope),consumerFingerprint:this.consumerFingerprint,sandboxFingerprint:contract.fingerprint,sourceContractFingerprint:candidate.contractFingerprint,sourceFingerprint:candidate.sourceFingerprint,candidateId:candidate.id,targetTool:match.targetTool,receipt,receiptHash:digest(receipt),createdAt,expiresAt:createdAt+this.ttlMs,deliveries:{}}
   c.bindingHash=digest(this._binding(c));this.state.cards[c.id]=c;this._save();results.push({candidateId:candidate.id,cardId:c.id,status:c.state,receiptHash:c.receiptHash})
  }
  return {status:'considered',results}
 })}
 recall(scope,query={}){return this._serial(async()=>{
  const refusal=this._base();if(refusal)return {status:refusal,cards:[]};if(typeof scope!=='string'||!scope)return {status:'invalid-scope',cards:[]};if(this.capture.hasPendingWork())return {status:'source-busy',cards:[]}
  const contract=await getActivationSandboxContract(this.sandboxOptions)
  if(query.permission==='denied'||query.initiallyActive===true||query.contractFingerprint&&query.contractFingerprint!==contract.fingerprint)return {status:'not-applicable',cards:[]}
  const ready=conditions(query)&&query.contractFingerprint===contract.fingerprint
  for(const c of Object.values(this.state.cards).filter(c=>c.scopeHash===digest(scope)&&c.state==='limited-use')){
   const reason=await this._current(c,scope,contract)
   if(reason){if(reason!=='source-busy')this._suspend(c,reason);continue}
   if(query.targetTool&&query.targetTool!==c.targetTool)continue
   return {status:ready?'applicable':'conditional',cards:[{id:c.id,mechanism:c.mechanism,instruction:c.instruction,conditional:!ready,targetTool:c.targetTool,receiptHash:c.receiptHash,sandboxFingerprint:c.sandboxFingerprint,expiresAt:c.expiresAt}]}
  }
  return {status:'no-card',cards:[]}
 })}
 noteDelivery(scope,{cardId,sessionId,turnId}={}){return this._serial(async()=>{
  const refusal=this._base();if(refusal)return {status:refusal};const c=this.state.cards[cardId]
  if(!c||c.state!=='limited-use'||c.scopeHash!==digest(scope)||!sessionId||turnId==null)return {status:'not-found'}
  const contract=await getActivationSandboxContract(this.sandboxOptions),reason=await this._current(c,scope,contract)
  if(reason){if(reason!=='source-busy')this._suspend(c,reason);return {status:reason}}
  c.deliveries??={};const key=deliveryKey(sessionId,turnId);if(!c.deliveries[key]&&Object.keys(c.deliveries).length>=16)return {status:'delivery-budget'};const previous=c.deliveries[key]?clone(c.deliveries[key]):null,deliveryId=randomUUID();c.deliveries[key]={sessionHash:digest(String(sessionId)),turnHash:digest(String(turnId)),receiptHash:c.receiptHash,deliveryId,...(previous?.used===true?{used:true}:{})};this._save();return {status:'recorded',deliveryId,previous}
 })}
 // Host-only rollback of an assembly that failed its final origin check.
 // Exact delivery ownership prevents it from erasing another assembly's receipt.
 revokeDelivery(scope,{cardId,sessionId,turnId,deliveryId,previous=null}={}){return this._serial(async()=>{
  const refusal=this._base();if(refusal)return {status:refusal};const c=this.state.cards[cardId],key=deliveryKey(sessionId,turnId),d=c?.deliveries?.[key]
  if(!deliveryId||!c||c.scopeHash!==digest(scope)||d?.deliveryId!==deliveryId)return {status:'not-found'}
  if(previous&&previous.sessionHash===d.sessionHash&&previous.turnHash===d.turnHash&&previous.receiptHash===c.receiptHash)c.deliveries[key]=clone(previous)
  else delete c.deliveries[key]
  this._save();return {status:'revoked'}
 })}
 noteUse(scope,{cardId,sessionId,turnId,guard,signal}={}){return this._serial(async()=>{
  const refusal=this._base();if(refusal)return {status:refusal};const c=this.state.cards[cardId],d=c?.deliveries?.[deliveryKey(sessionId,turnId)]
  if(!c||c.state!=='limited-use'||c.scopeHash!==digest(scope)||!d||d.sessionHash!==digest(String(sessionId))||d.turnHash!==digest(String(turnId))||d.receiptHash!==c.receiptHash)return {status:'unattributed'}
  const contract=await getActivationSandboxContract(this.sandboxOptions),reason=await this._current(c,scope,contract)
  if(reason){if(reason!=='source-busy')this._suspend(c,reason);return {status:reason}}
  signal?.throwIfAborted()
  if(guard!==undefined&&(typeof guard!=='function'||await guard()!==true||typeof guard.current!=='function'||guard.current()!==true))return {status:'invocation-changed'}
  signal?.throwIfAborted()
  if(this.capture.hasPendingWork()||!this.capture.isCandidateCurrent(c.candidateId,{scope}))return {status:'source-changed'}
  d.used=true;this._save();return {status:'recorded'}
 })}
 noteOutcome(scope,{cardId,sessionId,turnId,related=false,targetTool,failed=false}={}){return this._serial(async()=>{
  const refusal=this._base();if(refusal)return {status:refusal};const c=this.state.cards[cardId],d=c?.deliveries?.[deliveryKey(sessionId,turnId)]
  if(!c||c.scopeHash!==digest(scope)||!d||d.sessionHash!==digest(String(sessionId))||d.turnHash!==digest(String(turnId))||d.receiptHash!==c.receiptHash||d.used!==true||related!==true||targetTool!==c.targetTool)return {status:'unattributed'}
  if(failed===true){this._suspend(c,'related-failure-after-use');return {status:'suspended'}}
  delete c.deliveries[deliveryKey(sessionId,turnId)];this._save();return {status:'observed',promotion:false}
 })}
 status({scope}={}){
  const cards=Object.values(this.state.cards).filter(c=>!scope||c.scopeHash===digest(scope))
  const sources=typeof scope==='string'&&scope?this.capture?.list({scope,limit:1000})??[]:[]
  return {enabled:this.enabled,legacyFrozen:typeof this.legacyFrozen==='function'?this.legacyFrozen()===true:this.legacyFrozen===true,dailyLimitedUse:this.enabled===true,mechanisms:[MECHANISM],ordinaryLongTermMemoryWrites:false,lastError:this.lastError,limitedUseCount:cards.filter(c=>c.state==='limited-use'&&c.expiresAt>Date.now()).length,needsReviewCount:sources.filter(s=>s.observation?.toolFailureCount>0&&!cards.some(c=>c.candidateId===s.id)).length,cards:cards.map(c=>({id:c.id,candidateId:c.candidateId,state:c.state,reason:c.reason??null,receiptHash:c.receiptHash,expiresAt:c.expiresAt}))}
 }

 idle(){return this.#queue.catch(()=>{})}
}
