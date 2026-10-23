import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {selectCaptureText} from './capture-policy.js';
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const hash=v=>createHash('sha256').update(canonical(v)??'null').digest('hex');
const copy=x=>structuredClone(x);
const record=x=>x&&typeof x==='object'&&!Array.isArray(x);
const safeHashes=values=>[...new Set(values.filter(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)))].sort();
const safeName=x=>typeof x==='string'&&/^[A-Za-z_$][\w$.-]{0,127}$/.test(x)?x:null;
const text=e=>(e.data?.content??e.data?.message?.content??[]).filter(x=>x?.type==='text').map(x=>x.text??'').join('\n');
const sourceKey=(session,scope)=>hash([session,scope]);
const turnKey=t=>hash(String(t));
function projection(e,t){
 const d=e.data??{},row={seq:e.seq,type:/^[\w/:-]{1,80}$/.test(e.type)?e.type:'unknown',eventHash:hash(e),turnHash:turnKey(t)};
 if(e.type==='tool/call')Object.assign(row,{callHash:hash(d.callId??null),tool:safeName(d.name),action:true});
 if(e.type==='tool/result'){
  const m=d.message??{},r=(m.content??[]).find(x=>x?.type==='tool-result');
  const id=m.toolCallId??m.source?.callId??r?.callId;
  Object.assign(row,{callHash:id==null?null:hash(id),isError:m.isError===true||r?.isError===true,result:true});
 }
 if(e.type==='tool/ptc-dispatch-start')Object.assign(row,{callHash:hash(d.subCallId??null),tool:safeName(d.name),action:true,dispatch:true});
 if(e.type==='tool/ptc-dispatch')Object.assign(row,{callHash:hash(d.subCallId??null),tool:safeName(d.name),isError:d.isError===true,result:true,dispatch:true});
 if(e.type==='turn/end'){
  const reason=typeof d.reason==='string'?d.reason:d.reason?.kind;
  row.outcome=['completed','success'].includes(reason)?'completed':['failed','error'].includes(reason)?'failed':['cancelled','aborted','interrupted'].includes(reason)?'cancelled':'unknown';
 }
 return row;
}
// Only a positively identified next-turn queue operation is administrative.
// Late tool results remain evidence: silently dropping those would hide changes.
function chunks(events){const result=[];let active=null,ended=false;for(const e of events){if(e.type==='turn/start'){active={turn:e.data?.turn,events:[],bookkeeping:[]};ended=false;result.push(active)}if(active){if(ended&&e.type==='agent/inbox/spliced'&&e.data?.target==='next-turn')active.bookkeeping.push(e);else active.events.push(e);if(e.type==='turn/end')ended=true}}return result}
/** Evidence-only single-writer consumer. Native event text never enters this ledger.
 * Callers supply trusted origin/session resolvers and share the host writer lease.
 * Review records authorize frozen sandbox consideration only, never production use.
 */
export class ExecutionExperienceCapture{
 #canWrite; #resolveOrigin; #resolveSession; #currentSession; #queue=Promise.resolve(); #validated=new Set(); #epoch=0; #pending=0;
 constructor({directory,enabled=false,contractFingerprint=null,maxEvents=10000,maxSources=64,maxTotalEvents=10000,maxCandidates=1000,maxBytes=8388608,canWrite=()=>true,resolveOrigin=()=>null,resolveSession=null,currentSession=null}={}){
  this.directory=directory;this.enabled=enabled===true;this.contractFingerprint=contractFingerprint;
  for(const [key,value]of Object.entries({maxEvents,maxSources,maxTotalEvents,maxCandidates,maxBytes})){if(!Number.isSafeInteger(value)||value<1)throw TypeError(`Invalid ${key}`);this[key]=value}
  this.#canWrite=canWrite;this.#resolveOrigin=resolveOrigin;this.#resolveSession=resolveSession;this.#currentSession=currentSession??resolveSession;this.lastError=null;
  this.path=directory?join(directory,'execution-experience.json'):null;
  this.state={schemaVersion:1,mode:'review-only',sources:{},candidates:{}};
  if(this.enabled&&this.path&&existsSync(this.path)){
   if(statSync(this.path).size>maxBytes)throw Error('Execution experience ledger exceeds byte budget');
   const state=JSON.parse(readFileSync(this.path,'utf8'));
   if(state.schemaVersion!==1||state.mode!=='review-only'||!record(state.sources)||!record(state.candidates))throw Error('Invalid execution experience ledger');
   if(state.invalidations!==undefined&&(!Array.isArray(state.invalidations)||state.invalidations.length>maxCandidates||state.invalidations.some(x=>!record(x)||!Object.keys(x).every(k=>['candidateHash','packetHash','receiptHash','reason'].includes(k))||!['candidateHash','packetHash'].every(k=>/^[a-f0-9]{64}$/.test(x[k]))||typeof x.reason!=='string'||x.reason.length>100||x.receiptHash!==undefined&&!/^[a-f0-9]{64}$/.test(x.receiptHash))))throw Error('Invalid execution experience invalidations');
   if(Object.keys(state.sources).length>maxSources||Object.keys(state.candidates).length>maxCandidates)throw Error('Execution experience ledger exceeds item budget');
   let count=0;for(const [key,s]of Object.entries(state.sources)){if(!record(s)||!record(s.rows)||!record(s.turns)||!Array.isArray(s.excludedTurns)||sourceKey(s.sessionId,s.scope)!==key)throw Error('Invalid execution experience source');count+=Object.keys(s.rows).length;if(Object.keys(s.rows).length>maxEvents)throw Error('Execution experience source exceeds budget')}
   if(count>maxTotalEvents)throw Error('Execution experience ledger exceeds event budget');
   for(const [id,c]of Object.entries(state.candidates))if(c.id!==id||!this._integrity(c)||!state.sources[c.sourceKey]||c.productionEligible!==false||c.frozenOnly!==true||c.instruction!==null)throw Error('Invalid execution experience candidate');
   this.state=state;
  }
 }
 _writable(){try{return this.#canWrite()===true}catch{return false}}
 _base(){if(!this.enabled)return {status:'disabled'};if(!this._writable())return {status:'read-only'};return null}
 _save(next,epoch=this.#epoch){if(!this._writable())return {status:'read-only'};if(epoch!==this.#epoch)return {status:'stale-write'};const payload=JSON.stringify(next)+'\n';if(Buffer.byteLength(payload)>this.maxBytes){this.lastError='max-bytes';return {status:'quota-paused',reason:'max-bytes'}}if(!this.path)throw Error('Execution experience directory required');mkdirSync(this.directory,{recursive:true,mode:0o700});const tmp=`${this.path}.${randomUUID()}.tmp`;try{writeFileSync(tmp,payload,{mode:0o600,flag:'wx'});renameSync(tmp,this.path);this.state=next;this.lastError=null;return null}catch(error){try{unlinkSync(tmp)}catch{}throw error}}
 _content(c){const {contentHash,reviewPacketHash,review,sourceValidation,...value}=c;return value}
 _integrity(c){return record(c)&&c.contentHash===hash(this._content(c))&&c.reviewPacketHash===hash([c.contentHash,c.evidenceRefs,c.sourceFingerprint])&&(!c.review||(record(c.review)&&Object.keys(c.review).every(k=>['status','receiptHash','packetHash'].includes(k))&&['approved-for-frozen-evaluation','rejected'].includes(c.review.status)&&/^[a-f0-9]{64}$/.test(c.review.receiptHash)&&c.review.packetHash===c.reviewPacketHash))}
 _invalidate(next,key,reason,turnHash=null,{retain=false}={}){for(const [id,c]of Object.entries(next.candidates))if(c.sourceKey===key&&(!turnHash||c.turnHash===turnHash)){
  const tombstone={candidateHash:c.contentHash,packetHash:c.reviewPacketHash,reason,...(c.review?{receiptHash:c.review.receiptHash}:{} )};
  next.invalidations??=[];if(!next.invalidations.some(x=>hash(x)===hash(tombstone)))next.invalidations.push(tombstone);
  if(next.invalidations.length>this.maxCandidates){next.invalidationsDropped=(next.invalidationsDropped??0)+next.invalidations.length-this.maxCandidates;next.invalidations.splice(0,next.invalidations.length-this.maxCandidates)}
  if(retain)delete c.review;else delete next.candidates[id];this.#validated.delete(id)
 }if(next.sources[key])next.sources[key].lastInvalidation=reason}
 snapshot(){return copy(this.state)}
 report(){const sources=Object.values(this.state.sources);return {enabled:this.enabled,mode:'review-only',productionEligible:false,frozenOnly:true,sourceCount:sources.length,eventCount:sources.reduce((n,s)=>n+Object.keys(s.rows).length,0),candidates:Object.keys(this.state.candidates).length,invalidationCount:this.state.invalidations?.length??0,invalidationsDropped:this.state.invalidationsDropped??0,incomplete:sources.filter(s=>s.status!=='complete'&&s.status!=='withdrawn').length,lastError:this.lastError,budget:{maxEvents:this.maxEvents,maxSources:this.maxSources,maxTotalEvents:this.maxTotalEvents,maxCandidates:this.maxCandidates,maxBytes:this.maxBytes}}}
 list({scope,limit=50}={}){if(typeof scope!=='string'||!scope)return [];return Object.values(this.state.candidates).filter(c=>c.scopeHash===hash(scope)).slice(0,Math.max(0,Math.min(1000,limit))).map(c=>({...copy(c),sourceValidation:this.#validated.has(c.id)?'verified':'needs-revalidation'}))}
 inspect(id,{scope}={}){const c=this.state.candidates[id];return c&&typeof scope==='string'&&c.scopeHash===hash(scope)?{...copy(c),sourceValidation:this.#validated.has(id)?'verified':'needs-revalidation'}:null}
 sourceReference(id,{scope}={}){const c=this.inspect(id,{scope});if(!c)return null;const s=this.state.sources[c.sourceKey],t=s.turns[c.turnHash];return {sessionId:s.sessionId,turn:t.turn,startSeq:c.evidenceRefs[0]?.seq,endSeq:c.evidenceRefs.at(-1)?.seq}}
 sourceSessions({scope}={}){return [...new Set(Object.values(this.state.sources).filter(s=>s.scope===scope&&s.status!=='withdrawn').map(s=>s.sessionId))]}
 idle(){return this.#queue.catch(()=>{})}
 hasPendingWork(){return this.#pending>0}
 isCandidateCurrent(id,{scope}={}){
  const c=this.inspect(id,{scope});if(!c||c.sourceValidation!=='verified'||this.#pending)return false;
  try{
   const s=this.state.sources[c.sourceKey],session=this.#currentSession?.(s.sessionId);
   if(!session||session.then||session.id!==s.sessionId||hash(session.header?.cwd)!==s.cwdHash||c.contractFingerprint!==this.contractFingerprint)return false;
   const stream=session.snapshotEvents(c.evidenceRefs[0].seq,Math.min(session.seq,c.evidenceRefs[0].seq+this.maxEvents+1));
   if(!Array.isArray(stream))return false;
   const events=chunks(stream)[0]?.events;
   return !!events&&events.length===c.evidenceRefs.length&&events.every((e,i)=>e.seq===c.evidenceRefs[i].seq&&hash(e)===c.evidenceRefs[i].eventHash);
  }catch{return false}
 }
 _serial(fn){this.#pending++;const operation=this.#queue.catch(()=>{}).then(fn).finally(()=>{this.#pending--});this.#queue=operation.catch(()=>{});return operation}
 capture(session,options={}){return this._serial(()=>this._capture(session,options))}
 revalidate(session,options={}){return this.capture(session,options)}
 async _origin(session,events,scope){try{const o=await this.#resolveOrigin(session,events,scope);if(o?.status!=='verified'||!['schedule','user'].includes(o.kind)||!record(o.binding)||canonical(o.binding).length>32768)return {status:o?.optOut?'denied':o?.status??'unknown',reason:o?.reason??null,optOut:o?.optOut===true};return {status:'verified',kind:o.kind,bindingHash:hash(o.binding),taskHashes:safeHashes((o.binding.tasks??[]).map(t=>t.taskHash)),taskPromptHashes:safeHashes((o.binding.tasks??[]).map(t=>t.promptHash)),optOut:o.optOut===true}}catch{return {status:'unavailable',reason:'resolver-unavailable'}}}
 async _capture(session,{scope,allowed=true,readOnly=false}={}){
  const refusal=this._base();if(refusal)return refusal;if(readOnly)return {status:'read-only'};
  if(!session?.id||!session.header?.cwd||typeof scope!=='string'||!scope||typeof session.snapshotEvents!=='function'||!Number.isSafeInteger(session.seq)||session.seq<0)return {status:'untrusted-source'};
  const epoch=this.#epoch,key=sourceKey(session.id,scope),prior=this.state.sources[key];if(prior?.status==='withdrawn')return {status:'withdrawn'};
  const all=await session.snapshotEvents(Math.max(0,session.seq-this.maxEvents),session.seq);
  if(!Array.isArray(all)||all.some(e=>!Number.isSafeInteger(e.seq)||e.seq<0||e.seq>=session.seq))return {status:'invalid-source'};
  const groups=chunks(all);if(!groups.length)return all.length>=this.maxEvents?{status:'quota-paused',reason:'retention-window-exceeded'}:{status:'missing-turn-boundary'};
  const baseline=prior?.baseline??groups.at(-1).events[0].seq;
  if(!prior&&Object.keys(this.state.sources).length>=this.maxSources)return {status:'quota-paused',reason:'max-sources'};
  const next=this.snapshot(),s=next.sources[key]??{sessionId:String(session.id),scope,scopeHash:hash(scope),cwdHash:hash(session.header.cwd),baseline,cursor:baseline-1,rows:{},turns:{},excludedTurns:[],contractFingerprint:this.contractFingerprint,status:'pending'};
  next.sources[key]=s;
  if(s.cwdHash!==hash(session.header.cwd)){this._invalidate(next,key,'scope-changed');s.status='scope-changed';return this._save(next,epoch)??{status:'scope-changed'}}
  if(s.contractFingerprint!==this.contractFingerprint){
   this._invalidate(next,key,'contract-changed');
   // Never relabel old native evidence with a new contract. Wait for a fresh
   // turn after observing the cutover, then resume this source going forward.
   Object.assign(s,{contractFingerprint:this.contractFingerprint,rows:{},turns:{},baseline:session.seq,cursor:session.seq-1,awaitingTurnBoundary:true,status:'contract-changed'});
   return this._save(next,epoch)??{status:'contract-changed'};
  }
  if(s.awaitingTurnBoundary){
   const fresh=groups.find(g=>g.events[0].seq>=s.baseline);
   if(!fresh)return {status:'waiting-new-contract-turn'};
   s.baseline=fresh.events[0].seq;s.cursor=s.baseline-1;delete s.awaitingTurnBoundary;
  }
  if(session.seq<=s.cursor){this._invalidate(next,key,'source-sequence-regression');s.status='conflict';return this._save(next,epoch)??{status:'conflict'}}
  // Keep a neutral hash row for stream continuity without attaching queue
  // bookkeeping to a completed episode. This also normalizes older ledgers.
  for(const event of groups.filter(g=>g.events[0].seq>=baseline).flatMap(g=>g.bookkeeping)){
   const previous=s.rows[event.seq];if(previous&&previous.eventHash!==hash(event)&&previous.type!=='excluded'){s.status='conflict';this._invalidate(next,key,'source-payload-conflict');return this._save(next,epoch)??{status:'conflict'}}
   if(!previous&&(Object.keys(s.rows).length>=this.maxEvents||Object.values(next.sources).reduce((n,x)=>n+Object.keys(x.rows).length,0)>=this.maxTotalEvents))return {status:'quota-paused',reason:'max-events'};
   s.rows[event.seq]={seq:event.seq,type:'bookkeeping',eventHash:hash(event),turnHash:null};
  }
  let added=0,blocked=false,untrusted=false,originChanged=false,conflict=false;const verifiedTurns=new Set();
  let streamBlocked=groups[0].events[0].seq>baseline?s.blockedContinuation===true:false;
  const total=()=>Object.values(next.sources).reduce((n,x)=>n+Object.keys(x.rows).length,0);
  for(const group of groups.filter(g=>g.events[0].seq>=baseline)){
   const tk=turnKey(group.turn),origin=await this._origin(session,group.events,scope);
   const messages=group.events.filter(e=>e.type==='user/message'&&['user','schedule'].includes(e.data?.source?.kind));
   const optOut=messages.some(e=>selectCaptureText(text(e)).hasOptOut);if(messages.length)streamBlocked=optOut;
   const excluded=s.excludedTurns.includes(tk)||!allowed||origin.optOut===true||streamBlocked||['denied','withdrawn'].includes(origin.status);
   if(excluded){blocked=true;if(!s.excludedTurns.includes(tk))s.excludedTurns.push(tk);this._invalidate(next,key,!origin.optOut&&!streamBlocked&&allowed&&['denied','withdrawn'].includes(origin.status)?'origin-withdrawn':'capture-disabled-for-turn',tk)}
   if(!excluded&&origin.status!=='verified'){untrusted=true;this._invalidate(next,key,'untrusted-origin',tk,{retain:!['denied','withdrawn'].includes(origin.status)});if(s.turns[tk])s.turns[tk].status='untrusted-origin';continue}
   const previous=s.turns[tk];if(!excluded&&previous?.bindingHash&&(previous.bindingHash!==origin.bindingHash||previous.kind!==origin.kind)){originChanged=true;this._invalidate(next,key,'origin-changed',tk);previous.status='origin-changed';continue}
   if(!excluded)verifiedTurns.add(tk);
   if(['untrusted-origin','incomplete'].includes(previous?.status)&&origin.status==='verified')previous.status='pending';
   if(!previous)s.turns[tk]={turn:group.turn,startSeq:group.events[0].seq,...(!excluded?{bindingHash:origin.bindingHash,kind:origin.kind,taskHashes:origin.taskHashes,taskPromptHashes:origin.taskPromptHashes}:{}),status:excluded?'excluded':'pending'};
   for(const event of group.events){const row=excluded?{seq:event.seq,type:'excluded',turnHash:tk}:projection(event,group.turn),old=s.rows[event.seq];if(old?.type==='excluded')continue;if(old&&row.type==='excluded'){s.rows[event.seq]=row;continue}if(old&&old.eventHash!==row.eventHash){conflict=true;continue}if(!old){if(Object.keys(s.rows).length>=this.maxEvents||total()>=this.maxTotalEvents)return {status:'quota-paused',reason:'max-events'};s.rows[event.seq]=row;added++}}
  }
  while(s.rows[s.cursor+1])s.cursor++;
  const problems=[];if(s.cursor<session.seq-1)problems.push('sequence-gap');if(session.seq-baseline>this.maxEvents&&s.cursor<session.seq-1)problems.push('retention-window-exceeded');
  if(conflict||s.status==='conflict'){s.status='conflict';this._invalidate(next,key,'source-payload-conflict')}
  else if(originChanged){s.status='origin-changed'}
  else if(problems.length){s.status='incomplete';this._invalidate(next,key,'source-incomplete')}
  else{s.status='complete';for(const [tk,t]of Object.entries(s.turns)){
   if(s.excludedTurns.includes(tk)||!t.bindingHash||!['pending','complete'].includes(t.status))continue;
   const rows=Object.values(s.rows).filter(r=>r.turnHash===tk).sort((a,b)=>a.seq-b.seq),end=rows.find(r=>r.type==='turn/end');if(!end)continue;
   const refs=rows.map(r=>({seq:r.seq,eventHash:r.eventHash,type:r.type})),fingerprint=hash(refs);
   const actions=rows.filter(r=>r.action),results=rows.filter(r=>r.result),failures=results.filter(r=>r.isError),tools=[...new Set(actions.map(r=>r.tool).filter(Boolean))];
   if(!actions.length&&!results.length)continue;
   if(actions.some(a=>!results.some(r=>r.callHash===a.callHash&&r.seq>a.seq))||results.some(r=>!actions.some(a=>a.callHash===r.callHash&&a.seq<r.seq))){t.status='incomplete';this._invalidate(next,key,'call-result-incomplete',tk);continue}
   const linkedFailures=failures.filter(r=>actions.some(a=>a.callHash===r.callHash&&a.seq<r.seq));
   const laterSuccess=linkedFailures.some(f=>results.some(r=>r.seq>f.seq&&!r.isError&&actions.some(a=>a.callHash===r.callHash&&a.tool===actions.find(a=>a.callHash===f.callHash)?.tool&&a.seq<r.seq)));
   const id=`execution-${hash([key,tk,fingerprint,t.bindingHash,this.contractFingerprint,1]).slice(0,24)}`;
   if(next.candidates[id])continue;
   this._invalidate(next,key,'episode-evidence-changed',tk);
   if(Object.keys(next.candidates).length>=this.maxCandidates)return {status:'quota-paused',reason:'max-candidates'};
   const c={id,version:1,status:'needs-review',kind:linkedFailures.length?'execution-experience-hypothesis':'execution-observation',sourceKey:key,scopeHash:hash(scope),turnHash:tk,sourceFingerprint:fingerprint,extractorVersion:1,origin:{kind:t.kind,bindingHash:t.bindingHash},contractFingerprint:this.contractFingerprint,evidenceRefs:refs,observation:{runtimeOutcome:end.outcome,toolFailureCount:linkedFailures.length,unlinkedResultCount:results.filter(r=>!actions.some(a=>a.callHash===r.callHash&&a.seq<r.seq)).length,subsequentSameToolSuccess:laterSuccess?'observed':'unobserved',verification:'unobserved',causalStrength:'temporal-observation-only'},applicability:{scopeHash:hash(scope),contractFingerprint:this.contractFingerprint,originKind:t.kind,taskHashes:t.taskHashes??[],taskPromptHashes:t.taskPromptHashes??[],tools,permission:'unknown',environment:'unknown'},missingEvidence:['independent-verification','causal-repair-attribution','permission','environment'],humanReview:'pending',productionEligible:false,frozenOnly:true,instruction:null};
   c.contentHash=hash(this._content(c));c.reviewPacketHash=hash([c.contentHash,c.evidenceRefs,c.sourceFingerprint]);next.candidates[id]=c;t.status='complete';
  }}
  if(Object.values(s.turns).some(t=>t.status==='incomplete')){s.status='incomplete';problems.push('call-result-incomplete')}
  s.blockedContinuation=streamBlocked;s.problems=problems;const failure=this._save(next,epoch);if(failure)return failure;
  for(const c of Object.values(this.state.candidates))if(c.sourceKey===key&&verifiedTurns.has(c.turnHash))this.#validated.add(c.id);
  return {status:originChanged?'origin-changed':blocked?'capture-disabled-for-turn':untrusted?'untrusted-origin':s.status,added,candidates:Object.values(next.candidates).filter(c=>c.sourceKey===key).length,cursor:s.cursor,problems};
 }
 withdraw({sessionId,scope,readOnly=false}={}){const refusal=this._base();if(refusal)return refusal;if(readOnly)return {status:'read-only'};const key=sourceKey(sessionId,scope);if(!this.state.sources[key])return {status:'unknown-source'};this.#epoch++;const next=this.snapshot();this._invalidate(next,key,'withdrawn');const s=next.sources[key];next.sources[key]={sessionId:s.sessionId,scope:s.scope,scopeHash:s.scopeHash,status:'withdrawn',rows:{},turns:{},excludedTurns:[],cursor:null,baseline:null,contractFingerprint:s.contractFingerprint};return this._save(next)??{status:'withdrawn'}}
 revalidateAll(){return this._serial(async()=>{
  const refusal=this._base();if(refusal)return {...refusal,checked:0,verified:0,invalidated:0,retriedSources:0,retryResults:[],results:[]};
  // Dispatch receipts can commit after the final native event. Revisit only
  // already-known active sources: there may be no candidate yet to validate.
  // Call the private implementation within this queue slot to avoid deadlock.
  const originalCandidates=Object.values(this.state.candidates).map(c=>({id:c.id,sourceKey:c.sourceKey})),retryResults=[];
  for(const [key,source]of Object.entries(this.state.sources)){
   if(source.status==='withdrawn')continue;
   let session=null;try{session=typeof this.#resolveSession==='function'?await this.#resolveSession(source.sessionId):null}catch{}
   if(this.state.sources[key]?.status==='withdrawn')continue;
   if(!session||session.id!==source.sessionId){retryResults.push({sourceHash:key,status:'source-unavailable'});continue}
   const retry=await this._capture(session,{scope:source.scope});
   retryResults.push({sourceHash:key,status:retry.status,...retry.reason?{reason:retry.reason}:{}});
  }
  const results=originalCandidates.filter(c=>!this.state.candidates[c.id]).map(c=>({id:c.id,status:this.state.sources[c.sourceKey]?.lastInvalidation??'source-invalidated'}));for(const c of Object.values(this.state.candidates)){const s=this.state.sources[c.sourceKey];const result=await this._validateCandidate(c.id,{scope:s.scope});results.push({id:c.id,status:result.status})}
  return {checked:results.length,verified:results.filter(x=>x.status==='verified').length,invalidated:results.filter(x=>x.status!=='verified').length,retriedSources:retryResults.length,retryResults,results};
 })}
 validateCandidate(id,{scope}={}){return this._serial(()=>this._validateCandidate(id,{scope}))}
 // Host-only evidence access for registered validators. Not exposed through an
 // agent tool; raw native data must never be stored as reusable instruction.
 readValidatedEvidence(id,{scope}={}){return this._serial(async()=>{
  const check=await this._validateCandidate(id,{scope});if(check.status!=='verified')return check;
  const c=this.inspect(id,{scope}),s=this.state.sources[c.sourceKey];
  let session;try{session=await this.#resolveSession?.(s.sessionId)}catch{return {status:'source-unavailable'}}
  if(!session||session.id!==s.sessionId)return {status:'source-unavailable'};
  const refs=c.evidenceRefs,events=await session.snapshotEvents(refs[0].seq,refs.at(-1).seq+1);
  if(!Array.isArray(events)||events.length!==refs.length||events.some((e,i)=>e.seq!==refs[i].seq||hash(e)!==refs[i].eventHash))return {status:'source-conflict'};
  return {status:'verified',candidate:c,events:copy(events)};
 })}
 async _validateCandidate(id,{scope}={}){
  const c=this.inspect(id,{scope});if(!c)return {status:'not-found'};
  const s=this.state.sources[c.sourceKey];let session=null;try{session=typeof this.#resolveSession==='function'?await this.#resolveSession(s.sessionId):null}catch{}
  let reason=null;const epoch=this.#epoch;
  if(!session||session.id!==s.sessionId||typeof session.snapshotEvents!=='function')reason='source-unavailable';
  else if(c.contractFingerprint!==this.contractFingerprint)reason='contract-changed';
  else if(hash(session.header?.cwd)!==s.cwdHash)reason='scope-changed';
  else{
   const refs=c.evidenceRefs,min=refs[0]?.seq,max=refs.at(-1)?.seq;
   const stream=await session.snapshotEvents(min,Math.min(session.seq,min+this.maxEvents+1));
   const events=Array.isArray(stream)?chunks(stream)[0]?.events:null;
   if(!Array.isArray(events)||events.length!==refs.length||events.some((e,i)=>e.seq!==refs[i].seq||hash(e)!==refs[i].eventHash))reason='source-conflict';
   else{const origin=await this._origin(session,events,scope);if(origin.status!=='verified')reason=['withdrawn','denied'].includes(origin.status)?'origin-withdrawn':'origin-unavailable';else if(origin.optOut===true)reason='capture-disabled-for-turn';else if(origin.bindingHash!==c.origin.bindingHash||origin.kind!==c.origin.kind)reason='origin-changed';else if(events.some(e=>e.type==='user/message'&&['user','schedule'].includes(e.data?.source?.kind)&&selectCaptureText(text(e)).hasOptOut))reason='capture-disabled-for-turn'}
  }
  if(reason){this.#validated.delete(id);if(this._writable()){const next=this.snapshot();this._invalidate(next,c.sourceKey,reason,c.turnHash,{retain:['source-unavailable','origin-unavailable'].includes(reason)});this._save(next,epoch)}return {status:reason}}
  if(!this.state.candidates[id]||epoch!==this.#epoch)return {status:'withdrawn'};
  this.#validated.add(id);return {status:'verified',candidate:this.inspect(id,{scope})};
 }
 recordHumanReview(id,{scope,expectedPacketHash,decision,receipt,signal}={}){return this._serial(async()=>{
  signal?.throwIfAborted();
  const refusal=this._base();if(refusal)return refusal;
  if(!['approve-frozen-evaluation','reject'].includes(decision)||!record(receipt)||!Object.keys(receipt).length)throw TypeError('Trusted review decision and receipt required');
  const checked=await this._validateCandidate(id,{scope});signal?.throwIfAborted();if(checked.status!=='verified')return checked;
  const c=this.state.candidates[id];if(c.reviewPacketHash!==expectedPacketHash)return {status:'review-packet-changed'};
  const next=this.snapshot();next.candidates[id].review={status:decision==='reject'?'rejected':'approved-for-frozen-evaluation',receiptHash:hash(receipt),packetHash:expectedPacketHash};
  signal?.throwIfAborted();
  const failure=this._save(next);return failure??{status:next.candidates[id].review.status,candidate:this.inspect(id,{scope})};
 })}
}
