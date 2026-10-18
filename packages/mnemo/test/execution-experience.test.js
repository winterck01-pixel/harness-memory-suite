import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExecutionExperienceCapture} from '../lib/execution-experience.js';
const scope='project:fixture';
const e=(seq,type,data={})=>({seq,type,data});
const rows=()=>[e(0,'turn/start',{turn:1}),e(1,'user/message',{source:{kind:'schedule'},content:[{type:'text',text:'PRIVATE PROMPT'}]}),e(2,'tool/call',{turn:1,callId:'a',name:'read_file',arguments:{path:'/PRIVATE'}}),e(3,'tool/result',{turn:1,message:{toolCallId:'a',isError:true,content:[{type:'text',text:'PRIVATE ERROR'}]}}),e(4,'turn/end',{turn:1,reason:'completed'})];
const session=r=>({id:'fixture',header:{cwd:'/PRIVATE'},seq:r.at(-1).seq+1,snapshotEvents:(a,b)=>r.filter(x=>x.seq>=a&&x.seq<b)});
const origin=()=>({status:'verified',kind:'schedule',binding:{taskHash:'a'.repeat(64),receiptHash:'b'.repeat(64)}});
async function fixture(fn){const directory=mkdtempSync(join(tmpdir(),'execution-capture-'));try{await fn(directory)}finally{rmSync(directory,{recursive:true,force:true})}}
const opts=directory=>({directory,enabled:true,contractFingerprint:'host-fixture',resolveOrigin:origin});
test('native scheduled failures produce source-bound observations, never instructions or raw text',()=>fixture(async directory=>{const c=new ExecutionExperienceCapture(opts(directory));assert.equal((await c.capture(session(rows()),{scope})).status,'complete');const [candidate]=c.list({scope});assert.equal(candidate.status,'needs-review');assert.equal(candidate.instruction,null);assert.equal(candidate.productionEligible,false);assert.equal(candidate.frozenOnly,true);assert.equal(candidate.observation.verification,'unobserved');assert.equal(candidate.observation.toolFailureCount,1);assert.equal(candidate.observation.runtimeOutcome,'completed');assert.ok(candidate.reviewPacketHash);assert.equal(c.list({scope:'other'}).length,0);assert.equal(c.inspect(candidate.id,{scope:'other'}),null);assert.equal(readFileSync(join(directory,'execution-experience.json'),'utf8').includes('PRIVATE'),false)}));
test('restart and duplicate events do not grow candidates; completed success is observation only',()=>fixture(async directory=>{let c=new ExecutionExperienceCapture(opts(directory));const r=rows();await c.capture(session(r),{scope});const before=c.snapshot();c=new ExecutionExperienceCapture(opts(directory));assert.equal((await c.capture(session(r),{scope})).added,0);assert.deepEqual(c.snapshot(),before);const success=rows();success[3].data.message.isError=false;const second={...session(success),id:'second'};await c.capture(second,{scope});assert.equal(c.list({scope}).find(x=>x.kind==='execution-observation').observation.toolFailureCount,0)}));
test('gaps and conflicts quarantine observations, late missing event can close a gap',()=>fixture(async directory=>{const c=new ExecutionExperienceCapture(opts(directory));const full=rows(),r=full.filter(x=>x.seq!==2);assert.equal((await c.capture(session(r),{scope})).status,'incomplete');assert.equal(c.list({scope}).length,0);await c.capture(session(full),{scope});assert.equal(c.list({scope}).length,1);full[3].data.message.isError=false;assert.equal((await c.capture(session(full),{scope})).status,'conflict');assert.equal(c.list({scope}).length,0)}));
test('pending turn, untrusted origins and printed errors cannot invent failures',()=>fixture(async directory=>{const c=new ExecutionExperienceCapture(opts(directory));const r=rows().slice(0,-1);await c.capture(session(r),{scope});assert.equal(c.list({scope}).length,0);const rejected=new ExecutionExperienceCapture({...opts(directory),resolveOrigin:()=>({status:'unknown'})});assert.equal((await rejected.capture({...session(rows()),id:'unknown'},{scope})).status,'untrusted-origin');const printed=rows();printed[3].data.message.isError=false;await c.capture({...session(printed),id:'printed'},{scope});assert.equal(c.list({scope})[0].observation.toolFailureCount,0)}));
test('binding changes and contract drift invalidate previously collected candidates',()=>fixture(async directory=>{let binding='a'.repeat(64);const c=new ExecutionExperienceCapture({...opts(directory),resolveOrigin:()=>({status:'verified',kind:'schedule',binding:{taskHash:binding}})});await c.capture(session(rows()),{scope});binding='c'.repeat(64);assert.equal((await c.revalidate(session(rows()),{scope})).status,'origin-changed');assert.equal(c.list({scope}).length,0);const other=new ExecutionExperienceCapture({...opts(directory),contractFingerprint:'host-new'});assert.equal((await other.capture(session(rows()),{scope})).status,'contract-changed');assert.equal(other.list({scope}).length,0)}));
test('quotas and read-only never advance cursor, withdrawal survives restart',()=>fixture(async directory=>{const tiny=new ExecutionExperienceCapture({...opts(directory),maxBytes:100});assert.equal((await tiny.capture(session(rows()),{scope})).status,'quota-paused');assert.equal(tiny.report().sourceCount,0);let writable=true;const c=new ExecutionExperienceCapture({...opts(directory),canWrite:()=>writable});await c.capture(session(rows()),{scope});const before=c.snapshot();writable=false;await c.capture(session(rows()),{scope});assert.deepEqual(c.snapshot(),before);writable=true;assert.equal(c.withdraw({sessionId:'fixture',scope}).status,'withdrawn');const reloaded=new ExecutionExperienceCapture(opts(directory));assert.equal((await reloaded.capture(session(rows()),{scope})).status,'withdrawn');assert.equal(reloaded.list({scope}).length,0)}));
test('whole-turn optout leaves no candidates and cannot be reversed by replay',()=>fixture(async directory=>{const c=new ExecutionExperienceCapture(opts(directory));const r=rows();r[1].data.source.kind='user';r[1].data.content[0].text='本轮不要记录记忆';assert.equal((await c.capture(session(r),{scope})).status,'capture-disabled-for-turn');assert.equal(c.list({scope}).length,0);assert.equal(JSON.stringify(c.snapshot()).includes('不要记录'),false);await c.capture(session(rows()),{scope});assert.equal(c.list({scope}).length,0)}));
test('concurrent sources serialize commits and independent write-lease revocation is honored',()=>fixture(async directory=>{const c=new ExecutionExperienceCapture({...opts(directory),resolveOrigin:async()=>{await new Promise(r=>setTimeout(r,5));return origin()}});await Promise.all([c.capture(session(rows()),{scope}),c.capture({...session(rows()),id:'second'},{scope})]);assert.equal(c.report().sourceCount,2);let writable=true;const denied=new ExecutionExperienceCapture({...opts(directory),canWrite:()=>writable,resolveOrigin:async()=>{writable=false;return origin()}});const before=denied.snapshot();assert.equal((await denied.capture({...session(rows()),id:'third'},{scope})).status,'read-only');assert.deepEqual(denied.snapshot(),before)}));

test('trusted frozen review is bound to live original source, packet and scope; deleted receipt invalidates it',()=>fixture(async directory=>{
 const r=rows();let live=session(r),valid=true;
 const make=()=>new ExecutionExperienceCapture({...opts(directory),resolveOrigin:()=>valid?origin():{status:'withdrawn'},resolveSession:()=>live});
 let c=make();await c.capture(live,{scope});const original=c.list({scope})[0];
 assert.deepEqual(c.sourceReference(original.id,{scope}),{sessionId:'fixture',turn:1,startSeq:0,endSeq:4});
 assert.equal((await c.recordHumanReview(original.id,{scope,expectedPacketHash:'wrong',decision:'approve-frozen-evaluation',receipt:{messageId:'fixture-human'}})).status,'review-packet-changed');
 const reviewed=await c.recordHumanReview(original.id,{scope,expectedPacketHash:original.reviewPacketHash,decision:'approve-frozen-evaluation',receipt:{messageId:'fixture-human'}});
 assert.equal(reviewed.status,'approved-for-frozen-evaluation');assert.equal(reviewed.candidate.productionEligible,false);assert.equal(reviewed.candidate.instruction,null);assert.equal(reviewed.candidate.status,'needs-review');
 c=make();assert.equal(c.inspect(original.id,{scope}).sourceValidation,'needs-revalidation');assert.equal((await c.validateCandidate(original.id,{scope:'other'})).status,'not-found');assert.equal((await c.validateCandidate(original.id,{scope})).status,'verified');
 valid=false;assert.equal((await c.revalidateAll()).invalidated,1);assert.equal(c.inspect(original.id,{scope}),null);assert.equal(c.snapshot().invalidations[0].receiptHash.length,64);assert.equal(c.snapshot().invalidations[0].reason,'origin-withdrawn');assert.equal(JSON.stringify(c.snapshot()).includes('fixture-human'),false);
}));
test('source deletion, event mutation and truncated evidence refuse and remove prior review',()=>fixture(async directory=>{
 for(const mode of ['delete','mutate','truncate']){
  let live=session(rows());const c=new ExecutionExperienceCapture({...opts(join(directory,mode)),resolveSession:()=>live});await c.capture(live,{scope});const candidate=c.list({scope})[0];
  await c.recordHumanReview(candidate.id,{scope,expectedPacketHash:candidate.reviewPacketHash,decision:'reject',receipt:{messageId:'reject'}});
  if(mode==='delete')live=null;else {const r=rows();if(mode==='mutate')r[2].data.name='other_tool';else r.shift();live=session(r)}
  assert.notEqual((await c.validateCandidate(candidate.id,{scope})).status,'verified');assert.equal(c.list({scope}).length,mode==='delete'?1:0);if(mode==='delete')assert.equal(c.list({scope})[0].sourceValidation,'needs-revalidation');
 }
}));
test('native PTC dispatch errors count, printed success output does not; success is temporal only',()=>fixture(async directory=>{
 const r=[e(0,'turn/start',{turn:1}),e(1,'user/message',{source:{kind:'schedule'},content:[]}),e(2,'tool/ptc-dispatch-start',{subCallId:'sub-1',name:'fixture_probe'}),e(3,'tool/ptc-dispatch',{subCallId:'sub-1',name:'fixture_probe',isError:true,content:[{type:'text',text:'PRIVATE'}]}),e(4,'tool/ptc-dispatch-start',{subCallId:'sub-2',name:'fixture_probe'}),e(5,'tool/ptc-dispatch',{subCallId:'sub-2',name:'fixture_probe',isError:false,content:[{type:'text',text:'caught Error: never trust print'}]}),e(6,'turn/end',{turn:1,reason:'completed'})];
 const c=new ExecutionExperienceCapture(opts(directory));await c.capture(session(r),{scope});const [candidate]=c.list({scope});assert.equal(candidate.observation.toolFailureCount,1);assert.equal(candidate.observation.subsequentSameToolSuccess,'observed');assert.equal(candidate.observation.verification,'unobserved');assert.equal(candidate.instruction,null);
}));
test('restart during unfinished turn catches up multiple native turns and more than twenty failures',()=>fixture(async directory=>{
 let c=new ExecutionExperienceCapture(opts(directory));const r=rows().slice(0,-1);await c.capture(session(r),{scope});c=new ExecutionExperienceCapture(opts(directory));r.push(e(4,'turn/end',{turn:1,reason:'completed'}),e(5,'turn/start',{turn:2}),e(6,'user/message',{source:{kind:'schedule'},content:[]}));
 for(let i=0;i<25;i++){r.push(e(7+i*2,'tool/call',{turn:2,callId:`c${i}`,name:'read_file'}),e(8+i*2,'tool/result',{turn:2,message:{toolCallId:`c${i}`,isError:true,content:[]}}))}r.push(e(57,'turn/end',{turn:2,reason:'failed'}));
 assert.equal((await c.capture(session(r),{scope})).status,'complete');assert.equal(c.list({scope}).length,2);assert.equal(c.list({scope}).find(x=>x.observation.runtimeOutcome==='failed').observation.toolFailureCount,25);
}));
test('one-turn optout continues through no-human turn, new human resumes without resurrecting excluded evidence',()=>fixture(async directory=>{
 const c=new ExecutionExperienceCapture(opts(directory));const r=rows();r[1].data.source.kind='user';r[1].data.content[0].text='本轮不要记录记忆';await c.capture(session(r),{scope});r.push(e(5,'turn/start',{turn:2}),e(6,'tool/call',{turn:2,callId:'next',name:'read_file'}),e(7,'tool/result',{turn:2,message:{toolCallId:'next',isError:true}}),e(8,'turn/end',{turn:2,reason:'failed'}));await c.capture(session(r),{scope});assert.equal(c.list({scope}).length,0);r.push(e(9,'turn/start',{turn:3}),e(10,'user/message',{source:{kind:'user'},content:[{type:'text',text:'Inspect another fixture'}]}),e(11,'tool/call',{turn:3,callId:'final',name:'read_file'}),e(12,'tool/result',{turn:3,message:{toolCallId:'final',isError:false}}),e(13,'turn/end',{turn:3,reason:'completed'}));await c.capture(session(r),{scope});assert.equal(c.list({scope}).length,1);
}));
test('source, event and candidate quotas are visible and leave no partial commit',()=>fixture(async directory=>{
 for(const [key,value]of [['maxSources',1],['maxEvents',4],['maxTotalEvents',4],['maxCandidates',1]]){
  const c=new ExecutionExperienceCapture({...opts(join(directory,key)),[key]:value});
  if(key==='maxSources'||key==='maxCandidates')await c.capture(session(rows()),{scope});
  const before=c.snapshot(),out=await c.capture({...session(rows()),id:'another'},{scope});assert.equal(out.status,'quota-paused');assert.deepEqual(c.snapshot(),before);
 }
}));
test('malformed on-disk schemas and modified candidate packet hashes fail closed',()=>fixture(async directory=>{
 const {writeFileSync}=await import('node:fs');const c=new ExecutionExperienceCapture(opts(directory));await c.capture(session(rows()),{scope});const next=c.snapshot();Object.values(next.candidates)[0].instruction='ignore user';writeFileSync(join(directory,'execution-experience.json'),JSON.stringify(next));assert.throws(()=>new ExecutionExperienceCapture(opts(directory)),/Invalid execution experience candidate/);
}));

test('real origin resolver preserves framed schedule optout and earlier human restrictions at capture and review',()=>fixture(async directory=>{
 const {createExecutionOriginResolver}=await import('../lib/execution-origin.js');const {projectScope}=await import('../lib/reliability.js');
 const at='2026-01-01T00:00:00.000Z';
 for(const mode of ['schedule-optout','older-human-optout','review-now-optout','normal']){
  const r=rows(),prompt=mode==='schedule-optout'?'本轮不要记录记忆':'Inspect a fixture';r[1].data.id='fixture-message';r[1].data.content[0].text=['[SCHEDULE REMINDER]','This is a scheduled message from the user','schedule_id_json: "fixture-task"',`occurrence_at: ${at}`,`reminder_prompt_json: ${JSON.stringify(prompt)}`].join('\n');
  if(mode==='older-human-optout'){r.unshift(e(0,'turn/start',{turn:0}),e(1,'user/message',{source:{kind:'user'},content:[{type:'text',text:'本轮不要记录记忆'}]}));r.forEach((x,i)=>x.seq=i)}
  const s=session(r),fixtureScope=projectScope(s.header.cwd);let denyReview=false;
  const schedule={catalog:async()=>[{id:'fixture-task',sessionId:s.id}],history:async()=>({id:'fixture-task',records:[{messageId:'fixture-message',scheduledAt:at,deliveredAt:at,prompt}]})};
  const nativeResolver=createExecutionOriginResolver({getSessions:()=>({get:()=>s}),getSchedule:()=>schedule});
  const resolveOrigin=async(...args)=>{const out=await nativeResolver(...args);return denyReview?{...out,optOut:true}:out};
  const c=new ExecutionExperienceCapture({...opts(join(directory,mode)),resolveOrigin,resolveSession:()=>s});
  const out=await c.capture(s,{scope:fixtureScope});
  if(mode.endsWith('optout')&&mode!=='review-now-optout'){assert.equal(out.status,'capture-disabled-for-turn');assert.equal(c.list({scope:fixtureScope}).length,0)}else{
   assert.equal(out.status,'complete');const candidate=c.list({scope:fixtureScope})[0];assert.ok(candidate);
   if(mode==='review-now-optout'){denyReview=true;assert.equal((await c.validateCandidate(candidate.id,{scope:fixtureScope})).status,'capture-disabled-for-turn');assert.equal(c.list({scope:fixtureScope}).length,0)}
  }
 }
}));
test('completed empty conversation turns consume no candidate capacity',()=>fixture(async directory=>{
 const r=rows().filter(x=>!x.type.startsWith('tool/'));r.forEach((x,i)=>x.seq=i);const c=new ExecutionExperienceCapture(opts(directory));assert.equal((await c.capture(session(r),{scope})).status,'complete');assert.equal(c.list({scope}).length,0);
}));

test('missing tool results stay incomplete; appended evidence creates a new packet and invalidates old review',()=>fixture(async directory=>{
 const r=rows();r.splice(3,1);r.forEach((x,i)=>x.seq=i);let live=session(r);const c=new ExecutionExperienceCapture({...opts(directory),resolveSession:()=>live});await c.capture(live,{scope});assert.equal(c.list({scope}).length,0);
 r.push(e(4,'tool/result',{turn:1,message:{toolCallId:'a',isError:true}}));live=session(r);await c.capture(live,{scope});let candidate=c.list({scope})[0];assert.ok(candidate);await c.recordHumanReview(candidate.id,{scope,expectedPacketHash:candidate.reviewPacketHash,decision:'approve-frozen-evaluation',receipt:{messageId:'old-review'}});
 r.push(e(5,'tool/call',{turn:1,callId:'late',name:'read_file'}),e(6,'tool/result',{turn:1,message:{toolCallId:'late',isError:false}}));live=session(r);await c.capture(live,{scope});const next=c.list({scope});assert.equal(next.length,1);assert.notEqual(next[0].id,candidate.id);assert.equal(next[0].review,undefined);assert.equal(c.snapshot().invalidations.at(-1).reason,'episode-evidence-changed');
}));

test('restart with offline session or schedule services keeps discoverable candidates but removes usable approval',()=>fixture(async directory=>{
 let live=session(rows()),available=true;
 const options={...opts(directory),resolveSession:()=>live,resolveOrigin:()=>available?origin():{status:'pending',reason:'schedule-service-unavailable'}};
 let c=new ExecutionExperienceCapture(options);await c.capture(live,{scope});const candidate=c.list({scope})[0];await c.recordHumanReview(candidate.id,{scope,expectedPacketHash:candidate.reviewPacketHash,decision:'approve-frozen-evaluation',receipt:{id:'original-human'}});
 c=new ExecutionExperienceCapture(options);live=null;assert.equal((await c.validateCandidate(candidate.id,{scope})).status,'source-unavailable');assert.equal(c.list({scope}).length,1);assert.equal(c.list({scope})[0].sourceValidation,'needs-revalidation');assert.equal(c.list({scope})[0].review,undefined);
 assert.equal((await c.recordHumanReview(candidate.id,{scope,expectedPacketHash:candidate.reviewPacketHash,decision:'approve-frozen-evaluation',receipt:{id:'forbidden-offline'}})).status,'source-unavailable');
 live=session(rows());available=false;assert.equal((await c.capture(live,{scope})).status,'untrusted-origin');assert.equal(c.list({scope}).length,1);assert.equal((await c.revalidateAll()).verified,0);assert.equal(c.list({scope}).length,1);available=true;assert.equal((await c.revalidateAll()).verified,1);assert.equal(c.list({scope})[0].review,undefined);assert.equal(c.list({scope})[0].sourceValidation,'verified');
}));
for(const mode of ['queue','source-validation'])test(`review cancellation during ${mode} cannot persist human approval`,()=>fixture(async directory=>{
  let enter,release,blockSource=false
  const entered=new Promise(resolve=>enter=resolve),blocked=new Promise(resolve=>release=resolve)
  const live=session(rows()),controller=new AbortController()
  const c=new ExecutionExperienceCapture({...opts(join(directory,mode)),resolveSession:async()=>{if(blockSource){enter();await blocked}return live}})
  await c.capture(live,{scope});const candidate=c.list({scope})[0],before=readFileSync(join(directory,mode,'execution-experience.json'),'utf8')
  if(mode==='queue')c._serial(async()=>{enter();await blocked});else blockSource=true
  const pending=c.recordHumanReview(candidate.id,{scope,expectedPacketHash:candidate.reviewPacketHash,decision:'approve-frozen-evaluation',receipt:{id:'cancelled-human-answer'},signal:controller.signal})
  await entered;controller.abort();release()
  await assert.rejects(pending,{name:'AbortError'});assert.equal(c.inspect(candidate.id,{scope}).review,undefined)
  assert.equal(readFileSync(join(directory,mode,'execution-experience.json'),'utf8'),before)
}));
test('warm-source retry is scope-bound, excludes withdrawn sources, and does not scan unknown sessions',()=>fixture(async directory=>{
 let ready=false;const r=rows(),s=session(r),lookups=[]
 const c=new ExecutionExperienceCapture({...opts(directory),resolveOrigin:()=>ready?origin():{status:'pending'},resolveSession:id=>{lookups.push(id);return s}})
 await c.capture(s,{scope});assert.equal(c.list({scope}).length,0);ready=true
 const recovered=await c.revalidateAll();assert.equal(recovered.retriedSources,1);assert.equal(recovered.verified,1);assert.deepEqual([...new Set(lookups)],['fixture']);assert.equal(c.list({scope}).length,1);assert.equal(c.list({scope:'other'}).length,0)
 c.withdraw({sessionId:s.id,scope});lookups.length=0
 const withdrawn=await c.revalidateAll();assert.equal(withdrawn.retriedSources,0);assert.deepEqual(lookups,[]);assert.equal(c.list({scope}).length,0)
}));
test('warm-source retry honors read-only lease and candidate quota without partial commit',()=>fixture(async directory=>{
 let writable=true,ready=false,lookups=0;const s=session(rows())
 const c=new ExecutionExperienceCapture({...opts(directory),canWrite:()=>writable,resolveOrigin:()=>ready?origin():{status:'pending'},resolveSession:()=>{lookups++;return s}})
 await c.capture(s,{scope});const before=c.snapshot();writable=false;ready=true
 assert.equal((await c.revalidateAll()).status,'read-only');assert.equal(lookups,0);assert.deepEqual(c.snapshot(),before)
 const q=new ExecutionExperienceCapture({...opts(join(directory,'quota')),maxCandidates:1,resolveOrigin:()=>ready?origin():{status:'pending'},resolveSession:id=>id==='fixture'?s:{...s,id:'second'}})
 ready=false;await q.capture(s,{scope});await q.capture({...s,id:'second'},{scope});ready=true
 const result=await q.revalidateAll();assert.equal(q.list({scope}).length,1);assert.equal(result.retryResults.filter(x=>x.status==='quota-paused').length,1)
}));
