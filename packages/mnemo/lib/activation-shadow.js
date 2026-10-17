import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {selectCaptureText} from './capture-policy.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=data=>(data?.content??data?.message?.content??[]).map(x=>x.type==='text'?x.text??'':x.type==='tool-result'&&typeof x.content==='string'?x.content:'').join('\n');
const keyOf=(sessionId,scope)=>hash([String(sessionId),scope]);
const projection=event=>{
 const data=event.data??{}, row={seq:event.seq,type:event.type,hash:hash(event),turn:data.turn??null,step:data.step??null};
 if(event.type==='tool/call'){
  row.callId=data.callId;row.tool=data.name;
  // The code is never retained or parsed as evidence of dispatched inner calls.
  row.argumentsHash=hash(data.arguments??null);
 }
 if(event.type==='tool/ptc-dispatch-start'||event.type==='tool/ptc-dispatch'){
  row.rootCallId=data.rootCallId;row.callId=data.subCallId;row.tool=data.name;
  row.isError=event.type==='tool/ptc-dispatch'?data.isError===true:null;
  if(data.name==='activate_tool_group'){
   const valid=name=>typeof name==='string'&&/^[A-Za-z_$][\w$]*$/.test(name);
   row.requested=Array.isArray(data.arguments?.tools)?data.arguments.tools.filter(valid):[];
   if(event.type==='tool/ptc-dispatch'&&!row.isError)for(const block of data.content??[]){
    if(block.type!=='text')continue;
    try{const result=JSON.parse(block.text);if(result.availableOnNextStep===true){row.availableOnNextStep=true;row.enabled=Array.isArray(result.enabled)?result.enabled.filter(valid):[]}}catch{}
   }
  }
 }
 if(event.type==='tool/result'){
  const message=data.message??{},result=(message.content??[]).find(b=>b?.type==='tool-result');
  row.callId=message.toolCallId??message.source?.callId??result?.callId;
  row.isError=message.isError===true||result?.isError===true;
  // Only an actual outer tool error can seed a hypothesis. Printed/caught errors
  // in successful output remain ordinary observations, never dispatched failures.
  const match=row.isError&&text(data).match(/(?:TypeError:\s*)?tools\.([A-Za-z_$][\w$]*) is not a function\b/);
  if(match)row.missingTool=match[1];
 }
 return row;
};

/** Single-writer, shadow-only native-session consumer. No memory engine writes.
 * It records observations, not proof of inner activation dispatch or permissions.
 * The caller must share the MNEMO writer lease and supply current trusted scope.
 */
export class ActivationShadowCapture{
 #canWrite;
 #writable(){try{return this.#canWrite()===true}catch{return false}}
 constructor({directory,enabled=false,contractFingerprint=null,maxEvents=10000,maxSources=64,maxTotalEvents=10000,maxBytes=8388608,canWrite=()=>true}={}){
  this.#canWrite=typeof canWrite==='function'?canWrite:()=>false;
  this.directory=directory;this.enabled=enabled===true;this.contractFingerprint=typeof contractFingerprint==='string'?contractFingerprint:null;
  this.maxEvents=Number.isSafeInteger(maxEvents)&&maxEvents>0?maxEvents:10000;
  this.maxSources=Number.isSafeInteger(maxSources)&&maxSources>0?maxSources:64;
  this.maxTotalEvents=Number.isSafeInteger(maxTotalEvents)&&maxTotalEvents>0?maxTotalEvents:10000;
  this.maxBytes=Number.isSafeInteger(maxBytes)&&maxBytes>0?maxBytes:8388608;
  this.lastError=null;
  this.path=directory?join(directory,'activation-shadow.json'):null;
  this.state={schemaVersion:1,mode:'shadow-only',sources:{}};
  if(this.enabled&&this.path&&existsSync(this.path)){
   if(statSync(this.path).size>this.maxBytes)throw Error('Activation shadow ledger exceeds configured byte budget');
   this.state=JSON.parse(readFileSync(this.path,'utf8'));
   const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
   if(this.state.schemaVersion!==1||this.state.mode!=='shadow-only'||!record(this.state.sources))throw Error('Unsupported activation shadow ledger');
   for(const source of Object.values(this.state.sources)){
    if(!record(source)||!record(source.rows)||!Array.isArray(source.candidates)||!Array.isArray(source.problems))throw Error('Invalid activation shadow source');
   }
  }
 }
 snapshot(){return structuredClone(this.state)}
 report(){const sources=Object.values(this.state.sources);return {enabled:this.enabled,mode:'shadow-only',productionEligible:false,sourceCount:sources.length,eventCount:sources.reduce((n,s)=>n+Object.keys(s.rows).length,0),candidates:sources.reduce((n,s)=>n+s.candidates.length,0),incomplete:sources.filter(s=>s.status!=='complete').length,budget:{maxSources:this.maxSources,maxEventsPerSource:this.maxEvents,maxTotalEvents:this.maxTotalEvents,maxBytes:this.maxBytes},lastError:this.lastError}}
 _paused(reason){this.lastError=reason;return {status:'quota-paused',reason}}
 _save(next,{withdraw=false}={}){
  if(!this.#writable()){const error=Error('Shadow store is read-only');error.code='SHADOW_READ_ONLY';throw error}
  const payload=JSON.stringify(next)+'\n';
  if(!withdraw&&Buffer.byteLength(payload)>this.maxBytes){const error=Error('activation-shadow-byte-budget');error.code='SHADOW_QUOTA';throw error}
  if(!this.path)throw Error('Shadow directory required');
  mkdirSync(this.directory,{recursive:true,mode:0o700});
  const temporary=`${this.path}.${randomUUID()}.tmp`;
  try{writeFileSync(temporary,payload,{mode:0o600,flag:'wx'});renameSync(temporary,this.path);this.state=next}
  catch(error){try{unlinkSync(temporary)}catch{}throw error}
 }
 withdraw({sessionId,scope,readOnly=false}={}){
  if(!this.enabled)return {status:'disabled'};
  if(readOnly||!this.#writable())return {status:'read-only'};
  if(!sessionId||typeof scope!=='string'||!scope)return {status:'untrusted-scope'};
  const next=this.snapshot(),key=keyOf(sessionId,scope);
  if(!Object.hasOwn(next.sources,key))return {status:'unknown-source',changed:false};
  next.sources[key]={status:'withdrawn',cursor:null,rows:{},candidates:[],problems:['source-withdrawn']};
  this._save(next,{withdraw:true});return {status:'withdrawn'};
 }
 capture(session,{scope,allowed=true,readOnly=false,currentUserText=''}={}){
  if(!this.enabled)return {status:'disabled'};
  if(readOnly||!this.#writable())return {status:'read-only'};
  if(!session?.id||!session.header?.cwd||typeof scope!=='string'||!scope||typeof session.snapshotEvents!=='function')return {status:'untrusted-source'};
  if(!Number.isSafeInteger(session.seq)||session.seq<0)return {status:'invalid-source-seq'};
  const key=keyOf(session.id,scope),prior=this.state.sources[key];
  if(prior?.status==='withdrawn')return {status:'withdrawn'};
  // No directory/session scan: only this active session's host-provided stream.
  // A cold source begins at the current turn. Old turns are not backfilled.
  const all=session.snapshotEvents(Math.max(0,session.seq-this.maxEvents),session.seq)??[];
  if(!Array.isArray(all))return {status:'invalid-source'};
  if(!prior&&Object.keys(this.state.sources).length>=this.maxSources)return this._paused('max-sources');
  const latestHuman=all.filter(e=>e.type==='user/message'&&e.data?.source?.kind==='user').at(-1);
  const currentTurn=all.filter(e=>e.type==='turn/start').at(-1)?.data?.turn;
  const blockedNow=!allowed||selectCaptureText(currentUserText).hasOptOut||selectCaptureText(text(latestHuman?.data)).hasOptOut;
  let baseline=prior?.baseline;
  if(baseline==null){baseline=all.filter(e=>e.type==='turn/start').at(-1)?.seq;if(!Number.isSafeInteger(baseline))return {status:'missing-turn-boundary'}}
  // On a new source we need a human or explicit caller context to establish
  // optout visibility. A resumed existing source is allowed without new human.
  if(!prior&&!latestHuman&&!String(currentUserText).trim())return {status:'consent-context-unknown'};
  const next=this.snapshot(),source=next.sources[key]??{baseline,cursor:baseline-1,rows:{},candidates:[],problems:[],scopeHash:hash(scope),cwdHash:hash(session.header.cwd),contractFingerprint:this.contractFingerprint,excludedTurns:[]};
  if(source.cwdHash!==hash(session.header.cwd))return {status:'scope-changed'};
  let added=0;
  if(source.contractFingerprint!==this.contractFingerprint)source.problems.push('contract-changed');
  if(session.seq-baseline>this.maxEvents)source.problems.push('retention-window-exceeded');
  if(prior&&session.seq<=prior.cursor)source.problems.push('source-sequence-regression');
  let streamTurn=null,streamAllowed=true;
  const excluded=new Set(source.excludedTurns??[]);
  // Directives affect their turn and no-human continuation until the next real
  // human message. They never revoke earlier lawful source episodes.
  let ownOptOut=false;
  for(const event of all){
   if(event.type==='turn/start'){
    if(streamTurn!=null&&(!streamAllowed||ownOptOut))excluded.add(streamTurn);
    streamTurn=event.data?.turn;ownOptOut=false;
   }
   if(event.type==='user/message'&&event.data?.source?.kind==='user'){
    streamAllowed=!selectCaptureText(text(event.data)).hasOptOut;
    ownOptOut ||= !streamAllowed;
   }
  }
  if(streamTurn!=null&&(!streamAllowed||ownOptOut))excluded.add(streamTurn);
  if(blockedNow&&currentTurn!=null)excluded.add(currentTurn);
  source.excludedTurns=[...excluded];
  for(const old of Object.values(source.rows))if(excluded.has(old.turn))source.rows[old.seq]={seq:old.seq,type:'excluded',turn:old.turn};
  streamTurn=null;
  let rowCount=Object.keys(source.rows).length;
  let totalCount=Object.values(next.sources).reduce((n,s)=>n+Object.keys(s.rows).length,0);
  for(const event of all){
   if(event.type==='turn/start')streamTurn=event.data?.turn;
   if(event.seq<baseline)continue;
   if(!Number.isSafeInteger(event.seq))continue;
   const turn=event.data?.turn??streamTurn;
   const row=excluded.has(turn)?{seq:event.seq,type:'excluded',turn}: {...projection(event),turn:turn??null};
   const previous=source.rows[event.seq];
   if(previous?.type==='excluded'){continue}
   if(row.type==='excluded'&&previous){source.rows[event.seq]=row;continue}
   if(previous&&previous.hash!==row.hash)source.problems.push('source-payload-conflict');
   else if(!previous){if(totalCount>=this.maxTotalEvents){source.problems.push('global-event-budget-exceeded');continue}if(rowCount>=this.maxEvents){source.problems.push('retention-budget-exceeded');continue}source.rows[event.seq]=row;rowCount++;totalCount++;added++}
  }
  while(source.rows[source.cursor+1])source.cursor++;
  source.problems=[...new Set(source.problems.filter(p=>p!=='sequence-gap'))];
  if(source.cursor<session.seq-1)source.problems.push('sequence-gap');
  source.status=source.problems.includes('source-payload-conflict')?'conflict':source.problems.length?'incomplete':'complete';
  source.candidates=[];
  if(source.status==='complete')for(const row of Object.values(source.rows)){
   if(!row.missingTool)continue;
   const call=Object.values(source.rows).find(c=>c.type==='tool/call'&&c.callId===row.callId&&c.seq<row.seq);
   if(call?.tool!=='run_code')continue;
   const rows=Object.values(source.rows);
   const activation=rows.find(a=>a.type==='tool/ptc-dispatch'&&a.tool==='activate_tool_group'&&a.rootCallId===call.callId&&a.seq<row.seq&&a.isError===false&&a.availableOnNextStep&&a.requested?.includes(row.missingTool)&&a.enabled?.includes(row.missingTool));
   const repair=activation&&rows.find(r=>r.type==='tool/ptc-dispatch'&&r.tool===row.missingTool&&r.isError===false&&r.seq>row.seq&&r.rootCallId!==call.callId);
   const id=`shadow-activation-${hash([key,call.hash,row.hash,this.contractFingerprint]).slice(0,24)}`;
   source.candidates.push({id,version:1,status:'needs-review',kind:'activation-timing-hypothesis',productionEligible:false,humanReview:'pending',permission:'unknown',activationState:activation?'next-step-acknowledged':'unknown',repairState:repair?'later-dispatch-succeeded':'unobserved',bindingSnapshot:'unobserved',contractFingerprint:this.contractFingerprint,evidenceRefs:[{seq:call.seq,hash:call.hash},{seq:row.seq,hash:row.hash},...(activation?[{seq:activation.seq,hash:activation.hash}]:[]),...(repair?[{seq:repair.seq,hash:repair.hash}]:[])],tool:row.missingTool,observation:'outer-run_code-missing-function-error',causalStrength:'unverified-inner-dispatch',instruction:null});
  }
  next.sources[key]=source;
  try{this._save(next)}catch(error){if(error.code==='SHADOW_QUOTA')return this._paused('max-bytes');throw error}
  this.lastError=source.problems.some(p=>p.includes('budget')||p.includes('window'))?'event-budget-paused':null;
  return {status:blockedNow?'capture-disabled-for-turn':source.status,added,candidates:source.candidates.length,cursor:source.cursor,problems:[...source.problems]};
 }
}
