import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync,statSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {candidateFingerprint as digest} from './evaluation.js'
import {lexicalSimilarity,lexTokens} from './retrieve.js'
import {projectScope} from './reliability.js'

const clone=v=>structuredClone(v),record=v=>v&&typeof v==='object'&&!Array.isArray(v)
const HASH=/^[a-f0-9]{64}$/,MAX_BYTES=2097152,MAX_PENDING=128,MAX_SOURCES=8,MAX_DELIVERIES=32
const STRENGTH='source-linked-checked-observation'
const secret=/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|ark)-[a-zA-Z0-9_-]{16,}|\bBearer\s+[a-zA-Z0-9._~+\/-]{12,}|(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\s*[:=]\s*["']?[^\s"',}]{6,}/i
const clean=(v,name,max=500)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw Error('Invalid '+name);const s=v.trim();if(secret.test(s))throw Error('Sensitive material is not reusable experience');return s}
const list=(v,name,{maxItems=8,maxLength=300}={})=>{if(!Array.isArray(v)||!v.length||v.length>maxItems)throw Error('Invalid '+name);const values=[...new Set(v.map(x=>clean(x,name,maxLength)))];if(values.some(x=>x.length<2))throw Error('Invalid '+name);return values}
const resultKey=(sessionId,turn)=>digest([String(sessionId),String(turn)])
const ref=e=>({seq:e.seq,eventHash:digest(e)})
const complete=e=>['completed','success'].includes(typeof e?.data?.reason==='string'?e.data.reason:e?.data?.reason?.kind)
function domainFailure(value,depth=0){
 if(depth>5||value==null)return false
 if(typeof value==='string'){if(/(?:process exited with code|exit[_ ]?code\s*[:=])\s*[1-9]\d*/i.test(value))return true;try{return domainFailure(JSON.parse(value),depth+1)}catch{return false}}
 if(Array.isArray(value))return value.slice(0,32).some(v=>domainFailure(v,depth+1))
 if(!record(value))return false
 if(value.isError===true||value.success===false||value.ok===false||['failed','failure','error','cancelled','canceled','rejected'].includes(String(value.status??'').toLowerCase()))return true
 if(['exitCode','exit_code','returnCode','returncode'].some(k=>Object.hasOwn(value,k)&&Number.isFinite(Number(value[k]))&&Number(value[k])!==0))return true
 return ['result','data','value','output','content','text'].some(k=>Object.hasOwn(value,k)&&domainFailure(value[k],depth+1))
}
const envelopeText=blocks=>typeof blocks==='string'?blocks:Array.isArray(blocks)?blocks.map(b=>b?.type==='text'?String(b.text??''):b?.type==='tool-result'?typeof b.content==='string'?b.content:JSON.stringify(b.content??''):'').join('\n'):''

// Read a bounded current turn only. Evidence references cannot select other turns.
function currentEvents(session,turn){
 if(!session?.id||!session.header?.cwd||!Number.isSafeInteger(session.seq)||typeof session.snapshotEvents!=='function'||turn==null)return []
 const events=session.snapshotEvents(Math.max(0,session.seq-2048),session.seq)
 if(!Array.isArray(events))return []
 let start=-1;for(let i=events.length-1;i>=0;i--)if(events[i]?.type==='turn/start'){start=i;break}
 if(start<0||String(events[start].data?.turn)!==String(turn))return []
 const rows=events.slice(start)
 if(rows.some((e,i)=>!Number.isSafeInteger(e.seq)||e.seq<0||i&&e.seq!==rows[i-1].seq+1||e.data?.turn!=null&&String(e.data.turn)!==String(turn)))return []
 return rows
}
const memoryTool=name=>/^mnemo(?:_|\.)/i.test(String(name??''))
function excludedEvidenceTool(name,callId,events){
 if(memoryTool(name))return 'memory-self-report-is-not-evidence'
 if(name==='activate_tool_group')return 'tool-activation-is-not-task-evidence'
 if(name!=='run_code')return null
 // Trust native dispatch metadata rather than interpreting model-authored code.
 // Any memory child contaminates the outer aggregate, even when it also runs a
 // real check. The caller can cite a separate business-tool result instead.
 const children=events.filter(e=>['tool/ptc-dispatch-start','tool/ptc-dispatch'].includes(e.type)&&e.data?.rootCallId===callId).map(e=>e.data?.name).filter(Boolean)
 if(children.some(memoryTool))return 'memory-self-report-is-not-evidence'
 if(children.length&&children.every(n=>n==='activate_tool_group'))return 'tool-activation-is-not-task-evidence'
 return null
}
function pairs(events){
 const out=[]
 for(const e of events){
  let callId,name,error,output,calls
  if(e.type==='tool/result'){
   const m=e.data?.message??{},r=Array.isArray(m.content)?m.content.find(x=>x?.type==='tool-result'):null
   callId=m.toolCallId??m.source?.callId??r?.callId;error=m.isError===true||r?.isError===true;output=envelopeText(m.content)
   calls=events.filter(c=>c.type==='tool/call'&&c.data?.callId===callId&&c.seq<e.seq);name=calls[0]?.data?.name
  }else if(e.type==='tool/ptc-dispatch'){
   const d=e.data??{};callId=d.subCallId;name=d.name;error=d.isError!==false;output=envelopeText(d.content)
   calls=events.filter(c=>c.type==='tool/ptc-dispatch-start'&&c.data?.subCallId===callId&&c.data?.rootCallId===d.rootCallId&&c.data?.name===name&&c.seq<e.seq)
  }else continue
  if(typeof callId!=='string'||!callId||calls.length!==1||typeof name!=='string'||!name)continue
  // An ambiguous duplicate result cannot serve as an evidence receipt.
  if(out.some(p=>p.callSeq===calls[0].seq))return []
  out.push({seq:e.seq,callSeq:calls[0].seq,name,excludedReason:excludedEvidenceTool(name,callId,events),isError:error||domainFailure(output)||domainFailure(e.data?.message?.content??e.data?.content),output,call:calls[0],result:e})
 }
 return out
}
function evidenceSpec(v){
 if(!record(v)||!Array.isArray(v.actionSeqs)||!v.actionSeqs.length||v.actionSeqs.length>8||v.actionSeqs.some(n=>!Number.isSafeInteger(n)||n<0)||new Set(v.actionSeqs).size!==v.actionSeqs.length||!Number.isSafeInteger(v.checkSeq)||v.checkSeq<0)throw Error('Invalid evidence references')
 const result={actionSeqs:[...v.actionSeqs].sort((a,b)=>a-b),checkSeq:v.checkSeq,expected:clean(v.expected,'expected check output',1000),summary:clean(v.summary,'evidence summary',600)}
 if(result.expected.length<16||result.summary.length<8)throw Error('Expected check output or summary is too short')
 return result
}
function recipe(v){
 if(!record(v))throw Error('Invalid successful method')
 const result={title:clean(v.title,'title',160),cues:list(v.cues,'cues',{maxItems:8,maxLength:80}),conditions:list(v.conditions,'conditions',{maxLength:400}),method:list(typeof v.method==='string'?[v.method]:v.method,'method',{maxItems:8,maxLength:400}),limits:list(v.limits,'limits',{maxLength:400}),evidence:evidenceSpec(v.evidence)}
 if(result.title.length<4)throw Error('Title is too short')
 const {evidence,...body}=result;if(JSON.stringify(body).length>2600)throw Error('Successful method exceeds 2600 character context budget')
 return result
}
function checkedEvidence(events,spec){
 const available=pairs(events),check=available.find(p=>p.seq===spec.checkSeq),actions=spec.actionSeqs.map(seq=>available.find(p=>p.seq===seq))
 if(!check||actions.some(p=>!p))return {status:'needs-review',reason:'evidence-unavailable'}
 if(check.isError||actions.some(p=>p.isError))return {status:'needs-review',reason:'selected-tool-result-failed'}
 const excluded=[check,...actions].find(p=>p.excludedReason)
 if(excluded)return {status:'needs-review',reason:excluded.excludedReason}
 if(actions.some(p=>p.seq>=check.callSeq)||actions.some(p=>p.callSeq===check.callSeq))return {status:'needs-review',reason:'distinct-later-check-required'}
 // Substantive matching output is a source-linked observation, not an independent
 // quality oracle. The exact checking call remains available through provenance.
 if(spec.expected.length<16||lexTokens(spec.expected).length<2||/^(?:\s|true|false|ok|success|passed|done|成功|完成|通过|检查|验证|[:：=,.!。！])+$/.test(spec.expected.toLowerCase()))return {status:'needs-review',reason:'substantive-check-output-required'}
 if(!check.output.includes(spec.expected))return {status:'needs-review',reason:'check-output-mismatch'}
 const evidence={actionRefs:actions.map(p=>({call:ref(p.call),result:ref(p.result),name:p.name,outputHash:digest(p.output)})),checkRef:{call:ref(check.call),result:ref(check.result),name:check.name,outputHash:digest(check.output)},expected:spec.expected,summary:spec.summary,evidenceStrength:STRENGTH,independentQualityVerified:false,causalBenefit:false}
 return {status:'checked',evidence,evidenceHash:digest(evidence)}
}
function scoped(scope,session){return typeof scope==='string'&&!!scope&&session?.header?.cwd&&projectScope(session.header.cwd)===scope}

/** Conditional historical data, never executable policy, a permission grant, or
 * a claim of causal improvement. This ledger never writes ordinary memories or
 * changes legacy learning/freeze state. All evidence is linked to host capture. */
export class SuccessfulExperiences{
 #queue=Promise.resolve();#canWrite
 constructor({directory,capture,enabled=false,consumerFingerprint=null,canWrite=()=>true,maxCards=128,ttlMs=30*86400000}={}){
  if(!Number.isSafeInteger(maxCards)||maxCards<1||maxCards>1024||!Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>90*86400000)throw Error('Invalid successful experience budget')
  Object.assign(this,{directory,capture,enabled:enabled===true,consumerFingerprint,maxCards,ttlMs});this.#canWrite=canWrite;this.lastError=null
  this.path=directory?join(directory,'successful-experiences.json'):null;this.state={version:1,cards:{},pending:{}}
  if(this.enabled&&this.path&&existsSync(this.path)){
   if(statSync(this.path).size>MAX_BYTES)throw Error('Successful experience ledger exceeds budget')
   const loaded=JSON.parse(readFileSync(this.path,'utf8')),{seal,...state}=loaded
   if(seal!==digest(state)||state.version!==1||!record(state.cards)||!record(state.pending)||Object.keys(state.cards).length>maxCards||Object.keys(state.pending).length>MAX_PENDING)throw Error('Invalid successful experience ledger')
   for(const [id,c]of Object.entries(state.cards))if(c.id!==id||!this._validCard(c))throw Error('Invalid successful experience card')
   for(const [id,p]of Object.entries(state.pending))if(p.id!==id||!['method','outcome'].includes(p.type)||!['pending','needs-review','finalized'].includes(p.status)||!HASH.test(p.scopeHash??'')||!HASH.test(p.consumerFingerprint??'')||typeof p.sessionId!=='string'||p.turn==null||!record(p.draft))throw Error('Invalid successful experience draft')
   this.state=state
  }
 }
 _validCard(c){return record(c)&&c.kind==='successful-method'&&['conditional','suspended'].includes(c.state)&&HASH.test(c.scopeHash??'')&&HASH.test(c.consumerFingerprint??'')&&Array.isArray(c.sources)&&c.sources.length>0&&c.sources.length<=MAX_SOURCES&&c.sources.every(s=>typeof s.candidateId==='string'&&HASH.test(s.sourceFingerprint??'')&&HASH.test(s.contractFingerprint??'')&&HASH.test(s.evidenceHash??'')&&s.evidenceHash===digest(s.evidence))&&Array.isArray(c.cues)&&Array.isArray(c.conditions)&&Array.isArray(c.method)&&Array.isArray(c.limits)&&record(c.deliveries)&&Object.keys(c.deliveries).length<=MAX_DELIVERIES&&record(c.stats)&&Array.isArray(c.failures)&&c.failures.length<=16&&Number.isSafeInteger(c.createdAt)&&Number.isSafeInteger(c.expiresAt)&&c.expiresAt>c.createdAt}
 _base(){if(!this.enabled)return 'disabled';try{if(this.#canWrite()!==true)return 'read-only'}catch{return 'read-only'}if(!this.capture||!HASH.test(this.consumerFingerprint??''))return 'unbound';return null}
 _serial(fn){const promise=this.#queue.catch(()=>{}).then(async()=>{try{return await fn()}catch(error){this.lastError=String(error?.message??error).slice(0,160);throw error}});this.#queue=promise.catch(()=>{});return promise}
 idle(){return this.#queue}
 _save(next){
  const refusal=this._base();if(refusal)throw Error('Successful experience write refused: '+refusal)
  if(!this.path)throw Error('Successful experience directory required')
  const data=JSON.stringify({...next,seal:digest(next)})+'\n';if(Buffer.byteLength(data)>MAX_BYTES)throw Error('Successful experience ledger exceeds budget')
  const tmp=this.path+'.'+randomUUID()+'.tmp'
  try{mkdirSync(this.directory,{recursive:true,mode:0o700});writeFileSync(tmp,data,{mode:0o600,flag:'wx'});if(this._base())throw Error('Successful experience writer unavailable');renameSync(tmp,this.path);this.state=next;this.lastError=null}catch(error){try{unlinkSync(tmp)}catch{}throw error}
 }
 async _guard(guard,signal){signal?.throwIfAborted();const refusal=this._base();if(refusal)throw Error('Successful experience unavailable: '+refusal);if(typeof guard!=='function'||await guard()===false)throw Error('Trusted current invocation required');signal?.throwIfAborted();if(this._base()||guard.current&&guard.current()!==true)throw Error('Invoking turn or permission changed')}
 _guardNow(guard,signal){signal?.throwIfAborted();if(this._base()||guard.current&&guard.current()!==true)throw Error('Invoking turn or permission changed')}
 recentEvidence(session,turn){
  const events=currentEvents(session,turn)
  if(!events.length)return {status:'unavailable',turn,results:[]}
  const results=pairs(events).filter(p=>!p.excludedReason).slice(-20).map(p=>({seq:p.seq,callSeq:p.callSeq,name:p.name,isError:p.isError,output:secret.test(p.output)?'[sensitive output omitted]':p.output.slice(0,2400),outputTruncated:p.output.length>2400}))
  return {status:'available',turn,results,evidenceMeaning:STRENGTH,independentQualityVerified:false,causalBenefit:false}
 }
 _pendingRoom(next){if(Object.keys(next.pending).length>=MAX_PENDING){const old=Object.values(next.pending).filter(p=>p.status==='finalized').sort((a,b)=>a.createdAt-b.createdAt)[0];if(old)delete next.pending[old.id];else throw Error('Successful experience draft budget exhausted')}}
 stage(scope,{session,turn,draft,guard,signal}={}){return this._serial(async()=>{
  if(!scoped(scope,session))throw Error('Invoking project scope required')
  const value=recipe(draft),sessionId=String(session.id),turnId=turn
  await this._guard(guard,signal)
  const events=currentEvents(session,turnId);if(!events.length)throw Error('Current turn evidence unavailable')
  const checked=checkedEvidence(events,value.evidence),id='recipe-draft-'+digest([scope,sessionId,String(turnId),value]).slice(0,24)
  if(this.state.pending[id])return {status:this.state.pending[id].status,id,reason:this.state.pending[id].reason??null,cardId:this.state.pending[id].cardId??null}
  const next=clone(this.state);this._pendingRoom(next)
  next.pending[id]={id,type:'method',status:checked.status==='checked'?'pending':'needs-review',reason:checked.reason??null,scopeHash:digest(scope),sessionId,turn:turnId,draft:value,consumerFingerprint:this.consumerFingerprint,createdAt:Date.now(),...(checked.evidence?{evidence:checked.evidence,evidenceHash:checked.evidenceHash}:{})}
  this._guardNow(guard,signal);this._save(next)
  return {status:next.pending[id].status,id,reason:next.pending[id].reason,evidenceStrength:STRENGTH,independentQualityVerified:false,causalBenefit:false}
 })}
 async _candidate(scope,sessionId,turn){
  if(this.capture.hasPendingWork?.())return {status:'source-busy'}
  const matches=this.capture.list({scope,limit:1000}).filter(c=>{const ref=this.capture.sourceReference(c.id,{scope});return ref?.sessionId===sessionId&&String(ref.turn)===String(turn)})
  if(matches.length!==1)return {status:matches.length?'source-ambiguous':'awaiting-source'}
  const native=await this.capture.readValidatedEvidence(matches[0].id,{scope})
  if(native?.status!=='verified')return {status:native?.status??'source-unavailable'}
  const c=native.candidate
  if(c.review?.status==='rejected'||c.contractFingerprint!==this.consumerFingerprint)return {status:'source-rejected-or-contract-changed'}
  if(!native.events?.some(e=>e.type==='turn/end'&&complete(e)))return {status:'source-turn-not-completed'}
  if(this.capture.hasPendingWork?.())return {status:'source-busy'}
  if(this.capture.isCandidateCurrent?.(c.id,{scope})!==true)return {status:'source-changed'}
  return {status:'verified',candidate:c,events:native.events,sourceReference:this.capture.sourceReference(c.id,{scope})}
 }
 finalize(scope,session){return this._serial(async()=>{
  const refusal=this._base();if(refusal)return {status:refusal,results:[]}
  if(!scoped(scope,session))return {status:'invalid-scope',results:[]}
  const next=clone(this.state),results=[];let dirty=false
  for(const p of Object.values(next.pending).filter(p=>p.status==='pending'&&p.scopeHash===digest(scope)&&p.sessionId===session.id)){
   if(p.consumerFingerprint!==this.consumerFingerprint){p.status='needs-review';p.reason='contract-changed';dirty=true;continue}
   const source=await this._candidate(scope,p.sessionId,p.turn)
   if(source.status==='awaiting-source'||['source-unavailable','origin-unavailable','source-busy'].includes(source.status)){
    const native=session.snapshotEvents(Math.max(0,session.seq-2048),session.seq),start=Array.isArray(native)?native.findIndex(e=>e.type==='turn/start'&&String(e.data?.turn)===String(p.turn)):-1
    const end=start>=0?native.slice(start+1).find(e=>e.type==='turn/end'||e.type==='turn/start'):null
    if(end?.type==='turn/end'&&!complete(end)){p.status='needs-review';p.reason='source-turn-not-completed';dirty=true;results.push({id:p.id,status:p.status,reason:p.reason})}else results.push({id:p.id,status:'pending',reason:source.status})
    continue
   }
   if(source.status!=='verified'){p.status='needs-review';p.reason=source.status;dirty=true;results.push({id:p.id,status:p.status,reason:p.reason});continue}
   const checked=checkedEvidence(source.events,p.draft.evidence)
   if(checked.status!=='checked'||checked.evidenceHash!==p.evidenceHash){p.status='needs-review';p.reason=checked.reason??'source-evidence-changed';dirty=true;results.push({id:p.id,status:p.status,reason:p.reason});continue}
   const c=source.candidate,bound={candidateId:c.id,sourceFingerprint:c.sourceFingerprint,contractFingerprint:c.contractFingerprint,packetHash:c.reviewPacketHash,sourceReference:source.sourceReference,evidence:checked.evidence,evidenceHash:checked.evidenceHash,at:Date.now()}
   if(p.type==='outcome'){
    const card=next.cards[p.cardId],delivery=card?.deliveries?.[resultKey(p.sessionId,p.turn)]
    if(!card||card.scopeHash!==digest(scope)||card.state!=='conditional'||!delivery?.used){p.status='needs-review';p.reason='used-delivery-unavailable'}
    else if(!Number.isSafeInteger(delivery.usedAfterSeq)||delivery.usedAfterSeq!==p.usedAfterSeq||checked.evidence.actionRefs.some(r=>r.call.seq<delivery.usedAfterSeq)){p.status='needs-review';p.reason='outcome-predates-use'}
    else if(delivery.checked){p.status='finalized';p.cardId=card.id}
    else{delivery.checked=true;delivery.outcome=bound;card.stats.checkedOutcomes++;p.status='finalized';p.cardId=card.id}
   }else{
    const {evidence,title,...method}=p.draft,id='success-'+digest([scope,this.consumerFingerprint,{...method,cues:[...method.cues].sort(),conditions:[...method.conditions].sort(),limits:[...method.limits].sort()}]).slice(0,24)
    let card=next.cards[id]
    if(!card&&Object.keys(next.cards).length>=this.maxCards){p.status='needs-review';p.reason='card-budget'}
    else{
     const now=Date.now()
     card??={id,kind:'successful-method',state:'conditional',scopeHash:digest(scope),consumerFingerprint:this.consumerFingerprint,title,...method,createdAt:now,expiresAt:now+this.ttlMs,sources:[],deliveries:{},failures:[],stats:{retrieved:0,used:0,checkedOutcomes:0,reportedFailures:0,sourceObservations:0},evidenceStrength:STRENGTH,independentQualityVerified:false,causalBenefit:false}
     if(!card.sources.some(s=>s.candidateId===bound.candidateId)){card.sources.push(bound);if(card.sources.length>MAX_SOURCES)card.sources.shift();card.stats.sourceObservations++;if(card.state==='conditional')card.expiresAt=now+this.ttlMs}
     // A repeated source does not erase a reported failure or silently resume it.
     next.cards[id]=card;p.status='finalized';p.cardId=id
    }
   }
   dirty=true;results.push({id:p.id,status:p.status,cardId:p.cardId??null,reason:p.reason??null})
  }
  if(dirty)this._save(next)
  return {status:'finalized',results}
 })}
 _sourceCurrent(source,scope){
  const c=this.capture.inspect(source.candidateId,{scope})
  return c?.review?.status!=='rejected'&&c?.sourceFingerprint===source.sourceFingerprint&&c?.reviewPacketHash===source.packetHash&&c?.contractFingerprint===source.contractFingerprint&&c?.contractFingerprint===this.consumerFingerprint&&this.capture.isCandidateCurrent?.(source.candidateId,{scope})===true
 }
 async _current(card,scope){
  if(!this._validCard(card)||card.scopeHash!==digest(scope)||card.consumerFingerprint!==this.consumerFingerprint||card.state!=='conditional')return {status:'unavailable'}
  if(Date.now()>=card.expiresAt)return {status:'expired'}
  for(const source of [...card.sources].reverse()){
   const check=await this.capture.readValidatedEvidence(source.candidateId,{scope}),c=check?.candidate
   if(check?.status!=='verified')continue
   const evidence=checkedEvidence(check.events,{actionSeqs:source.evidence.actionRefs.map(r=>r.result.seq),checkSeq:source.evidence.checkRef.result.seq,expected:source.evidence.expected,summary:source.evidence.summary})
   if(evidence.status==='checked'&&evidence.evidenceHash===source.evidenceHash&&c?.review?.status!=='rejected'&&c?.sourceFingerprint===source.sourceFingerprint&&c?.reviewPacketHash===source.packetHash&&c?.contractFingerprint===source.contractFingerprint&&c.contractFingerprint===this.consumerFingerprint&&this.capture.isCandidateCurrent?.(c.id,{scope})===true)return {status:'current',source}
  }
  return {status:'source-invalid'}
 }
 _public(card,source,score){return {id:card.id,kind:card.kind,title:card.title,cues:clone(card.cues),conditions:clone(card.conditions),method:clone(card.method),limits:clone(card.limits),conditional:true,permissionsGranted:false,evidenceStrength:STRENGTH,independentQualityVerified:false,causalBenefit:false,sourceCandidate:source.candidateId,sourceReference:clone(source.sourceReference),check:clone(source.evidence.checkRef),evidenceSummary:source.evidence.summary,expiresAt:card.expiresAt,score}}
 recall(scope,{query,sessionId,turnId,limit=2}={}){return this._serial(async()=>{
  const refusal=this._base();if(refusal)return {status:refusal,cards:[],deliveries:[]}
  if(typeof scope!=='string'||!scope||typeof query!=='string'||!query.trim())return {status:'no-match',cards:[],deliveries:[]}
  const ranked=Object.values(this.state.cards).filter(c=>c.scopeHash===digest(scope)&&c.state==='conditional').map(card=>{
   const topic=card.cues.join(' '),q=query.toLowerCase(),cueHit=card.cues.some(c=>c.length>=2&&q.includes(c.toLowerCase()))
   const score=lexicalSimilarity(query,topic+' '+card.title)
   return {card,score,admitted:cueHit||score>=.28&&lexTokens(query).filter(t=>lexTokens(topic).includes(t)).length>=2}
  }).filter(r=>r.admitted).sort((a,b)=>b.score-a.score)
  const cards=[],deliveries=[],next=clone(this.state);let dirty=false
  for(const {card,score}of ranked){
   if(cards.length>=Math.max(1,Math.min(2,Number.isSafeInteger(limit)?limit:2)))break
   const valid=await this._current(card,scope);if(valid.status!=='current')continue
   const publicCard=this._public(card,valid.source,score)
   if(JSON.stringify([...cards,publicCard]).length>5000)continue
   cards.push(publicCard)
   if(sessionId&&turnId!=null){
    const c=next.cards[card.id],key=resultKey(sessionId,turnId),previous=c.deliveries[key]?clone(c.deliveries[key]):null,deliveryId=randomUUID()
    if(!previous&&Object.keys(c.deliveries).length>=MAX_DELIVERIES){const oldest=Object.entries(c.deliveries).sort((a,b)=>a[1].at-b[1].at)[0];delete c.deliveries[oldest[0]]}
    c.deliveries[key]={...(previous??{}),deliveryId,at:Date.now(),sourceCandidate:valid.source.candidateId,sessionHash:digest(String(sessionId)),turnHash:digest(String(turnId))};if(!previous)c.stats.retrieved++
    deliveries.push({id:card.id,sessionId,turnId,deliveryId,previous});dirty=true
   }
  }
  if(dirty)this._save(next)
  return {status:cards.length?'conditional':'no-match',cards,deliveries}
 })}
 revokeDelivery(scope,{id,sessionId,turnId,deliveryId,previous=null}={}){return this._serial(async()=>{
  const next=clone(this.state),card=next.cards[id],key=resultKey(sessionId,turnId),d=card?.deliveries?.[key]
  if(card?.scopeHash!==digest(scope)||!deliveryId||d?.deliveryId!==deliveryId)return {status:'not-found'}
  if(previous)card.deliveries[key]=clone(previous);else{delete card.deliveries[key];card.stats.retrieved=Math.max(0,card.stats.retrieved-1)}
  this._save(next);return {status:'revoked'}
 })}
 noteUse(scope,{id,session,sessionId,turnId,conditionCheck,guard,signal}={}){return this._serial(async()=>{
  if(!scoped(scope,session)||session.id!==sessionId||!currentEvents(session,turnId).length)throw Error('Trusted current session and turn required')
  const note=clean(conditionCheck,'condition check',1200);if(note.length<8)throw Error('Condition check is too short');await this._guard(guard,signal)
  const card=this.state.cards[id],key=resultKey(sessionId,turnId),delivery=card?.deliveries?.[key]
  if(!delivery||card.scopeHash!==digest(scope))return {status:'not-delivered'}
  const valid=await this._current(card,scope);if(valid.status!=='current')return {status:'source-invalid'}
  await this._guard(guard,signal)
  if(!this._sourceCurrent(valid.source,scope)||!currentEvents(session,turnId).length)return {status:'source-invalid'}
  this._guardNow(guard,signal)
  const next=clone(this.state),c=next.cards[id],d=c.deliveries[key]
  if(!d.used){d.used=true;d.conditionCheck=note;d.usedAt=Date.now();d.usedAfterSeq=session.seq;c.stats.used++}
  this._save(next);return {status:'used',id,checkedOutcome:false,causalBenefit:false}
 })}
 stageOutcome(scope,{session,turn,id,evidence,guard,signal}={}){return this._serial(async()=>{
  if(!scoped(scope,session))throw Error('Invoking project scope required')
  const spec=evidenceSpec(evidence);await this._guard(guard,signal)
  const card=this.state.cards[id],key=resultKey(session.id,turn),delivery=card?.deliveries?.[key]
  if(card?.scopeHash!==digest(scope)||!delivery?.used)return {status:'not-used'}
  const valid=await this._current(card,scope);if(valid.status!=='current')return {status:'source-invalid'}
  await this._guard(guard,signal);if(!this._sourceCurrent(valid.source,scope))return {status:'source-invalid'}
  const events=currentEvents(session,turn);if(!events.length)throw Error('Current turn evidence unavailable')
  let checked=checkedEvidence(events,spec)
  if(checked.status==='checked'&&(!Number.isSafeInteger(delivery.usedAfterSeq)||checked.evidence.actionRefs.some(r=>r.call.seq<delivery.usedAfterSeq)))checked={status:'needs-review',reason:'outcome-predates-use'}
  const pendingId='recipe-outcome-'+digest([id,session.id,String(turn),spec]).slice(0,24)
  if(this.state.pending[pendingId])return {id:pendingId,status:this.state.pending[pendingId].status}
  const next=clone(this.state);this._pendingRoom(next)
  next.pending[pendingId]={id:pendingId,type:'outcome',cardId:id,usedAfterSeq:delivery.usedAfterSeq,status:checked.status==='checked'?'pending':'needs-review',reason:checked.reason??null,scopeHash:digest(scope),sessionId:session.id,turn,draft:{evidence:spec},consumerFingerprint:this.consumerFingerprint,createdAt:Date.now(),...(checked.evidence?{evidence:checked.evidence,evidenceHash:checked.evidenceHash}:{})}
  this._guardNow(guard,signal);this._save(next);return {id:pendingId,status:next.pending[pendingId].status,reason:next.pending[pendingId].reason,checkedOutcome:false}
 })}
 noteFailure(scope,{id,sessionId,turnId,reason,guard,signal}={}){return this._serial(async()=>{
  const note=clean(reason,'failure reason',600);await this._guard(guard,signal)
  const next=clone(this.state),card=next.cards[id],d=card?.deliveries?.[resultKey(sessionId,turnId)]
  if(card?.scopeHash!==digest(scope)||!d?.used)return {status:'not-used'}
  if(!d.failureReported){d.failureReported=true;card.stats.reportedFailures++;card.failures.push({at:Date.now(),sessionHash:digest(String(sessionId)),turnHash:digest(String(turnId)),reason:note,evidenceStrength:'agent-reported-failure'});if(card.failures.length>16)card.failures.shift()}
  card.state='suspended';card.reason='reported-related-failure';this._guardNow(guard,signal);this._save(next)
  return {status:'suspended',id,reason:card.reason}
 })}
 status({scope}={}){
  const cards=Object.values(this.state.cards).filter(c=>c.scopeHash===digest(scope??'')),pending=Object.values(this.state.pending).filter(p=>p.scopeHash===digest(scope??''))
  return {enabled:this.enabled,mode:'conditional-historical-methods',requiresSourceValidation:true,evidenceStrength:STRENGTH,independentQualityVerified:false,causalBenefit:false,counts:{cards:cards.length,conditional:cards.filter(c=>c.state==='conditional'&&c.expiresAt>Date.now()).length,suspended:cards.filter(c=>c.state==='suspended').length,pending:pending.filter(p=>p.status==='pending').length,needsReview:pending.filter(p=>p.status==='needs-review').length},cards:cards.map(c=>({id:c.id,title:c.title,state:c.expiresAt<=Date.now()?'expired':c.state,stats:clone(c.stats),expiresAt:c.expiresAt})),pending:pending.filter(p=>p.status!=='finalized').map(p=>({id:p.id,type:p.type,status:p.status,reason:p.reason,title:p.draft.title??null})),lastError:this.lastError}
 }
 inspect(scope,id){const entry=this.state.cards[id]??this.state.pending[id];return entry?.scopeHash===digest(scope)?clone(entry):null}
}
