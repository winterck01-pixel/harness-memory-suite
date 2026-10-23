import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SuccessfulExperiences} from '../lib/success-experience.js'
import {ExecutionExperienceCapture} from '../lib/execution-experience.js'
import {projectScope} from '../lib/reliability.js'

const fp='a'.repeat(64),cwd='/fixture/success-methods',scope=projectScope(cwd)
const event=(seq,type,data)=>({seq,type,data})
const expected='joined_rows=3; unmatched_rows=0'
const draft=()=>({title:'Join report rows by normalized business identifier',cues:['report join','business identifier'],conditions:['Both reports contain the same business identifier'],method:['Normalize identifier whitespace, then join rows by identifier','Check joined rows and report unmatched identifiers'],limits:['Do not join by row position or ignore duplicate identifiers'],evidence:{actionSeqs:[3],checkSeq:5,expected,summary:'Reopened output reports three joined rows and zero unmatched rows.'}})
function rows(turn=1){return [event(0,'turn/start',{turn}),event(1,'user/message',{turn,source:{kind:'user'},content:[{type:'text',text:'Join fixture report rows and check the output.'}]}),event(2,'tool/call',{turn,callId:'write',name:'write_file',arguments:{path:'joined.json'}}),event(3,'tool/result',{turn,message:{toolCallId:'write',isError:false,content:[{type:'text',text:'Saved joined.json with three joined records.'}]}}),event(4,'tool/call',{turn,callId:'read',name:'read_file',arguments:{path:'joined.json'}}),event(5,'tool/result',{turn,message:{toolCallId:'read',isError:false,content:[{type:'text',text:expected}]}})]}
async function fixture(fn){const directory=mkdtempSync(join(tmpdir(),'successful-experience-')),sessions=new Map();let writable=true
 const capture=new ExecutionExperienceCapture({directory:join(directory,'capture'),enabled:true,contractFingerprint:fp,canWrite:()=>writable,resolveSession:id=>sessions.get(id),resolveOrigin:()=>({status:'verified',kind:'user',binding:{task:'fixture'}})})
 const options={directory:join(directory,'recipes'),enabled:true,capture,consumerFingerprint:fp,canWrite:()=>writable}
 const learning=new SuccessfulExperiences(options)
 const makeSession=(id='source',data=rows())=>{const session={id,header:{cwd},get seq(){return data.length},snapshotEvents:(a,b)=>data.filter(e=>e.seq>=a&&e.seq<b)};sessions.set(id,session);return {session,data}}
 const guard=async()=>true;guard.current=()=>writable
 const finish=async x=>{x.data.push(event(x.data.length,'turn/end',{turn:x.data[0].data.turn,reason:'completed'}));await capture.capture(x.session,{scope});return learning.finalize(scope,x.session)}
 const admit=async()=>{const x=makeSession();const staged=await learning.stage(scope,{session:x.session,turn:1,draft:draft(),guard});assert.equal(staged.status,'pending');const result=await finish(x);return {x,id:result.results[0].cardId,staged}}
 try{await fn({directory,sessions,capture,learning,options,makeSession,guard,finish,admit,setWritable:v=>{writable=v}})}finally{rmSync(directory,{recursive:true,force:true})}}

test('stages native action and distinct check, waits for end, then recalls a conditional sourced method',()=>fixture(async f=>{
 const x=f.makeSession(),view=f.learning.recentEvidence(x.session,1);assert.equal(view.status,'available');assert.deepEqual(view.results.map(v=>v.seq),[3,5])
 const staged=await f.learning.stage(scope,{session:x.session,turn:1,draft:draft(),guard:f.guard});assert.equal(staged.status,'pending')
 assert.equal((await f.learning.finalize(scope,x.session)).results[0].status,'pending')
 assert.equal((await f.learning.recall(scope,{query:'report join'})).cards.length,0)
 const done=await f.finish(x),id=done.results[0].cardId;assert.ok(id)
 const result=await f.learning.recall(scope,{query:'report join with business identifier',sessionId:'next',turnId:2})
 assert.equal(result.cards.length,1);const card=result.cards[0]
 assert.equal(card.id,id);assert.equal(card.kind,'successful-method');assert.equal(card.conditional,true);assert.equal(card.permissionsGranted,false)
 assert.equal(card.independentQualityVerified,false);assert.equal(card.causalBenefit,false);assert.equal(card.evidenceStrength,'source-linked-checked-observation')
 assert.equal(card.sourceReference.sessionId,x.session.id);assert.equal(card.check.result.seq,5)
 const candidate=f.capture.inspect(card.sourceCandidate,{scope});assert.equal(candidate.status,'needs-review');assert.equal(candidate.instruction,null);assert.equal(candidate.productionEligible,false)
 assert.equal((await f.learning.recall(scope,{query:'weather tomorrow'})).cards.length,0)
 assert.equal((await f.learning.recall('another-project',{query:'report join'})).cards.length,0)
}))

test('missing, self-referential, generic, wrong-order and domain-error evidence remain needs-review',()=>fixture(async f=>{
 for(const [i,kind]of ['missing','self','generic','order','domain-error','nested-exit','failed-action'].entries()){
  const data=rows(),d=draft();if(kind==='missing')d.evidence.checkSeq=400
  if(kind==='self')data[4].data.name='mnemo_report_usage'
  if(kind==='generic'){d.evidence.expected='successsuccesssuccess';data[5].data.message.content[0].text=d.evidence.expected}
  if(kind==='order'){d.evidence.actionSeqs=[5];d.evidence.checkSeq=3}
  if(kind==='domain-error')data[5].data.message.content[0].text=JSON.stringify({success:false,result:expected})
  if(kind==='nested-exit')data[5].data.message.content[0].text=JSON.stringify({result:{exit_code:1,output:expected}})
  if(kind==='failed-action')data[3].data.message.isError=true
  const x=f.makeSession('invalid-'+i,data),staged=await f.learning.stage(scope,{session:x.session,turn:1,draft:d,guard:f.guard});assert.equal(staged.status,'needs-review',kind)
  await f.finish(x)
 }
 assert.equal(f.learning.status({scope}).counts.needsReview,7);assert.equal((await f.learning.recall(scope,{query:'report join'})).cards.length,0)
}))

test('an earlier repaired failure does not prohibit a later checked successful method',()=>fixture(async f=>{
 const data=rows(),prefix=[event(2,'tool/call',{turn:1,callId:'failed',name:'read_file'}),event(3,'tool/result',{turn:1,message:{toolCallId:'failed',isError:true,content:[{type:'text',text:'Earlier missing input'}]}})]
 data.splice(2,0,...prefix);data.forEach((e,i)=>e.seq=i);const d=draft();d.evidence.actionSeqs=[5];d.evidence.checkSeq=7
 const x=f.makeSession('repair',data);assert.equal((await f.learning.stage(scope,{session:x.session,turn:1,draft:d,guard:f.guard})).status,'pending')
 const out=await f.finish(x);assert.ok(out.results[0].cardId);assert.equal(f.capture.list({scope})[0].kind,'execution-experience-hypothesis')
}))

test('fixed turn, current project and revoked invocation guard prevent writes',()=>fixture(async f=>{
 const x=f.makeSession();await assert.rejects(f.learning.stage('other',{session:x.session,turn:1,draft:draft(),guard:f.guard}),/project scope/)
 await assert.rejects(f.learning.stage(scope,{session:x.session,turn:2,draft:draft(),guard:f.guard}),/Current turn/)
 const denied=async()=>false;await assert.rejects(f.learning.stage(scope,{session:x.session,turn:1,draft:draft(),guard:denied}),/Trusted/)
 const revoked=async()=>true;revoked.current=()=>false;await assert.rejects(f.learning.stage(scope,{session:x.session,turn:1,draft:draft(),guard:revoked}),/changed/)
 assert.equal(f.learning.status({scope}).counts.pending,0)
}))

test('duplicate method merges distinct sources, survives restart, and title changes do not duplicate',()=>fixture(async f=>{
 const {id}=await f.admit(),x=f.makeSession('source-2'),d=draft();d.title='Reworded successful report join'
 await f.learning.stage(scope,{session:x.session,turn:1,draft:d,guard:f.guard});const result=await f.finish(x)
 assert.equal(result.results[0].cardId,id);assert.equal(f.learning.inspect(scope,id).sources.length,2)
 const reload=new SuccessfulExperiences(f.options);assert.equal(reload.status({scope}).counts.cards,1)
 assert.equal((await reload.recall(scope,{query:'report join'})).cards[0].id,id)
 assert.equal(reload.inspect('other',id),null)
 const raw=readFileSync(join(f.options.directory,'successful-experiences.json'),'utf8');assert.ok(!raw.includes('Saved joined.json'))
}))

test('delivery, declared use and checked outcome are separate; duplicate recall does not reset use',()=>fixture(async f=>{
 const {id}=await f.admit(),x=f.makeSession('reuse',rows().slice(0,2))
 assert.equal((await f.learning.noteUse(scope,{id,session:x.session,sessionId:x.session.id,turnId:1,conditionCheck:'Both inputs share the identifier.',guard:f.guard})).status,'not-delivered')
 await f.learning.recall(scope,{query:'report join',sessionId:x.session.id,turnId:1})
 assert.equal((await f.learning.noteUse(scope,{id,session:x.session,sessionId:x.session.id,turnId:1,conditionCheck:'Both inputs share the identifier.',guard:f.guard})).status,'used')
 await f.learning.recall(scope,{query:'report join',sessionId:x.session.id,turnId:1})
 let c=f.learning.inspect(scope,id);assert.deepEqual([c.stats.retrieved,c.stats.used,c.stats.checkedOutcomes],[1,1,0])
 x.data.push(...rows().slice(2))
 const staged=await f.learning.stageOutcome(scope,{session:x.session,turn:1,id,evidence:draft().evidence,guard:f.guard});assert.equal(staged.status,'pending')
 assert.equal(f.learning.inspect(scope,id).stats.checkedOutcomes,0)
 await f.finish(x);c=f.learning.inspect(scope,id);assert.equal(c.stats.checkedOutcomes,1);assert.equal(c.causalBenefit,false)
}))

test('reported related failure suspends a used method and new source does not silently resume it',()=>fixture(async f=>{
 const {id}=await f.admit(),consumer=f.makeSession('consumer',rows().slice(0,2));await f.learning.recall(scope,{query:'report join',sessionId:'consumer',turnId:1})
 await f.learning.noteUse(scope,{id,session:consumer.session,sessionId:'consumer',turnId:1,conditionCheck:'Inputs appear to share the identifier.',guard:f.guard})
 assert.equal((await f.learning.noteFailure(scope,{id,sessionId:'consumer',turnId:1,reason:'Duplicate identifiers made this method unsuitable.',guard:f.guard})).status,'suspended')
 const x=f.makeSession('later-source');await f.learning.stage(scope,{session:x.session,turn:1,draft:draft(),guard:f.guard});await f.finish(x)
 const c=f.learning.inspect(scope,id);assert.equal(c.state,'suspended');assert.equal(c.failures.length,1);assert.equal(c.stats.reportedFailures,1)
 assert.equal((await f.learning.recall(scope,{query:'report join'})).cards.length,0)
}))

test('changed source, rejected source, contract drift and expiry prevent recall',()=>fixture(async f=>{
 const {id,x}=await f.admit();const source=f.learning.inspect(scope,id).sources[0]
 await f.capture.recordHumanReview(source.candidateId,{scope,expectedPacketHash:source.packetHash,decision:'reject',receipt:{fixture:true}})
 assert.equal((await f.learning.recall(scope,{query:'report join'})).cards.length,0)
 const drift=new SuccessfulExperiences({...f.options,consumerFingerprint:'b'.repeat(64)});assert.equal((await drift.recall(scope,{query:'report join'})).cards.length,0)
 x.data[5].data.message.content[0].text='changed source';assert.equal((await f.learning.recall(scope,{query:'report join'})).cards.length,0)
 f.learning.state.cards[id].expiresAt=1;assert.equal((await f.learning.recall(scope,{query:'report join'})).cards.length,0)
}))

test('stale assembly delivery can be revoked and writer denial leaves state unchanged',()=>fixture(async f=>{
 const {id}=await f.admit(),delivery=await f.learning.recall(scope,{query:'report join',sessionId:'consumer',turnId:1})
 assert.equal((await f.learning.revokeDelivery(scope,delivery.deliveries[0])).status,'revoked')
 assert.equal(f.learning.inspect(scope,id).stats.retrieved,0)
 const before=JSON.stringify(f.learning.state);f.setWritable(false)
 assert.equal((await f.learning.recall(scope,{query:'report join',sessionId:'consumer',turnId:1})).status,'read-only')
 assert.equal(JSON.stringify(f.learning.state),before)
}))

test('sensitive data and oversized method are rejected, persisted tampering is refused',()=>fixture(async f=>{
 const x=f.makeSession(),d=draft();d.method=['api_key=sk-'+ 'x'.repeat(30)]
 await assert.rejects(f.learning.stage(scope,{session:x.session,turn:1,draft:d,guard:f.guard}),/Sensitive/)
 d.method=Array(8).fill(null).map((_,i)=>String(i)+'x'.repeat(390))
 await assert.rejects(f.learning.stage(scope,{session:x.session,turn:1,draft:d,guard:f.guard}),/budget/)
 await f.admit();const path=join(f.options.directory,'successful-experiences.json'),saved=JSON.parse(readFileSync(path,'utf8'));Object.values(saved.cards)[0].method=['Changed without evidence'];writeFileSync(path,JSON.stringify(saved))
 assert.throws(()=>new SuccessfulExperiences(f.options),/Invalid successful experience ledger/)
}))

test('memory children and activation-only run_code wrappers cannot masquerade as task evidence',()=>fixture(async f=>{
 for(const [i,mode]of ['memory','mixed','activation'].entries()){
  const data=rows().slice(0,4),child=mode==='activation'?'activate_tool_group':'mnemo_experience'
  data.push(event(4,'tool/call',{turn:1,callId:'outer-check',name:'run_code',arguments:{code:'opaque model-authored program'}}),event(5,'tool/ptc-dispatch-start',{rootCallId:'outer-check',subCallId:'memory-child',name:child}),event(6,'tool/ptc-dispatch',{rootCallId:'outer-check',subCallId:'memory-child',name:child,isError:false,content:[{type:'text',text:expected}]}))
  if(mode==='mixed')data.push(event(7,'tool/ptc-dispatch-start',{rootCallId:'outer-check',subCallId:'real-child',name:'read_file'}),event(8,'tool/ptc-dispatch',{rootCallId:'outer-check',subCallId:'real-child',name:'read_file',isError:false,content:[{type:'text',text:expected}]}))
  const outerSeq=data.length;data.push(event(outerSeq,'tool/result',{turn:1,message:{toolCallId:'outer-check',isError:false,content:[{type:'text',text:expected}]}}))
  const x=f.makeSession('wrapper-'+i,data),available=f.learning.recentEvidence(x.session,1)
  assert.equal(available.results.some(p=>p.seq===outerSeq),false,mode);assert.equal(available.results.some(p=>p.seq===6),false,mode)
  const d=draft();d.evidence.checkSeq=outerSeq
  const staged=await f.learning.stage(scope,{session:x.session,turn:1,draft:d,guard:f.guard});assert.equal(staged.status,'needs-review',mode)
  assert.equal(staged.reason,mode==='activation'?'tool-activation-is-not-task-evidence':'memory-self-report-is-not-evidence')
  if(mode==='mixed'){
   assert.equal(available.results.some(p=>p.seq===8),true)
   const real=draft();real.evidence.checkSeq=8
   assert.equal((await f.learning.stage(scope,{session:x.session,turn:1,draft:real,guard:f.guard})).status,'pending')
  }
 }
}))

test('activation result is neither a task action nor a verification check',()=>fixture(async f=>{
 for(const [i,target]of ['action','check'].entries()){
  const data=rows();data[target==='action'?2:4].data.name='activate_tool_group'
  const x=f.makeSession('activation-'+i,data),staged=await f.learning.stage(scope,{session:x.session,turn:1,draft:draft(),guard:f.guard})
  assert.equal(staged.status,'needs-review');assert.equal(staged.reason,'tool-activation-is-not-task-evidence')
 }
}))

test('a bounded scalar method normalizes to one step without weakening other fields',()=>fixture(async f=>{
 const x=f.makeSession('scalar'),d=draft();d.method='Normalize whitespace in the common business identifier, join by that identifier, then verify matched rows and preserve unmatched rows.'
 const staged=await f.learning.stage(scope,{session:x.session,turn:1,draft:d,guard:f.guard});assert.equal(staged.status,'pending')
 const result=await f.finish(x),card=f.learning.inspect(scope,result.results[0].cardId);assert.deepEqual(card.method,[d.method])
 const invalid=draft();invalid.method=42;await assert.rejects(f.learning.stage(scope,{session:x.session,turn:1,draft:invalid,guard:f.guard}),/Invalid method/)
 invalid.method='x'.repeat(401);await assert.rejects(f.learning.stage(scope,{session:x.session,turn:1,draft:invalid,guard:f.guard}),/Invalid method/)
 invalid.method=d.method;invalid.conditions='unsupported scalar conditions';await assert.rejects(f.learning.stage(scope,{session:x.session,turn:1,draft:invalid,guard:f.guard}),/Invalid conditions/)
}))
