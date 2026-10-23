import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {apply} from '../index.js'
import {projectScope} from '../lib/reliability.js'

// Exercise the plugin's real source capture, action registration and prompt
// waterfall; the host only supplies deterministic native events and services.
async function host(t,{enabled=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'mnemo-success-integration-'))
 const listeners=new Map(),tools=new Map(),providers=[],sessions=new Map()
 const services={
  sessions:{get:id=>sessions.get(id)},
  tools:{register:tool=>tools.set(tool.name,tool)},
  systemPrompt:{context:value=>providers.push(value)},
 }
 const ctx={
  get:name=>services[name],provide:(name,value)=>{services[name]=value},effect:fn=>fn(),
  on:(name,fn)=>{const rows=listeners.get(name)??[];rows.push(fn);listeners.set(name,rows);return()=>listeners.set(name,rows.filter(row=>row!==fn))},
 }
 await apply(ctx,{dir,injectMode:'off',verbose:false,
  executionExperience:{enabled:true,contractFingerprint:'c'.repeat(64)},
  autoLearning:{enabled:false},dailyLearning:{enabled:false},
  ...(enabled?{successfulExperiences:{enabled:true}}:{}),
 })
 const api=services.mnemo
 t.after(async()=>{await api.detach();rmSync(dir,{recursive:true,force:true})})
 function createSession(id='success-fixture',cwd='/fixture/success-method'){
  const events=[]
  const session={id,header:{cwd},get seq(){return events.length},snapshotEvents:(a,b)=>events.slice(a,b)}
  sessions.set(id,session)
  const emit=(type,data)=>{
   const event={type,seq:events.length,time:1000+events.length,data};events.push(event)
   for(const fn of listeners.get('session/event')??[])fn(session,event)
   return event
  }
  const start=(turn=1,text='Merge fixture reports by verified business identifiers')=>{
   emit('turn/start',{turn})
   emit('user/message',{id:`${id}-human-${turn}`,source:{kind:'user'},content:[{type:'text',text}]})
  }
  const result=(name,output,{isError=false}={})=>{
   const callId=`${id}-call-${events.length}`
   emit('tool/call',{callId,name,arguments:{fixture:true}})
   return emit('tool/result',{message:{toolCallId:callId,isError,content:[{type:'text',text:output}]}})
  }
  const call=args=>tools.get('mnemo_experience').execute(args,{agent:{id,session}}).then(JSON.parse)
  const end=async(turn=1)=>{
   emit('turn/end',{turn,reason:{kind:'completed'}})
   await api.executionExperience.idle()
   // Capture completion triggers the plugin callback in the following microtask.
   await new Promise(resolve=>setImmediate(resolve))
   await api.successfulExperiences?.idle()
  }
  const assemble=async()=>{
   const assembly={contexts:providers.map(p=>({...p,text:typeof p.text==='function'?p.text({agent:{id,session}}):p.text??''}))}
   const hooks=listeners.get('system-prompt/assemble')??[]
   const dispatch=async i=>i<hooks.length?hooks[i](assembly,{agent:{id,session}},()=>dispatch(i+1)):assembly
   return dispatch(0)
  }
  return {session,events,emit,start,result,call,end,assemble,withdraw:()=>sessions.delete(id),restore:()=>sessions.set(id,session)}
 }
 return {api,createSession,tools,dir,services}
}

const expected='Verified joined output: 3 business identifiers, 3 matched rows, 0 missing keys, 0 duplicate identifiers.'
function execution(f){
 const action=f.result('fixture_transform','Joined fixture reports into a three-row table using their common business identifier.')
 const check=f.result('fixture_verify',expected)
 return {actionSeqs:[action.seq],checkSeq:check.seq,expected,summary:'Checked the resulting table has three unique identifiers and no missing or unmatched rows.'}
}
function draft(evidence){
 return {
  title:'Join fixture reports by a verified business identifier',
  cues:['fixture report merge','business identifier','matched rows'],
  conditions:['Both reports expose the same business identifier','The identifier is unique and nonempty in both inputs'],
  method:['Check missing and duplicate identifiers before joining','Join using the common identifier and check unmatched rows and totals'],
  limits:['This does not establish that a similarly named field has the same business meaning','Verify new input schemas before reuse'],
  evidence,
 }
}
const successContexts=assembly=>assembly.contexts.filter(row=>row.name==='mnemo-successful-methods').map(row=>row.text).join('\n')
async function createMethod(f){
 f.start()
 const evidence=execution(f),staged=await f.call({action:'record_success',draft:draft(evidence)})
 assert.equal(staged.status,'pending')
 const recent=await f.call({action:'recent_evidence'})
 assert.equal(recent.results.find(row=>row.seq===evidence.checkSeq)?.output,expected)
 assert.equal((await f.call({action:'recall_success',query:'fixture report merge business identifier'})).cards.length,0)
 await f.end()
 f.start(2)
 const recalled=await f.call({action:'recall_success',query:'fixture report merge business identifier'})
 assert.equal(recalled.cards.length,1)
 return recalled.cards[0]
}

test('successful execution → sourced method → conditional recall and adoption preserves frozen candidates and ordinary memory',async t=>{
 const h=await host(t),f=h.createSession(),scope=projectScope(f.session.header.cwd)
 h.api.engine.safety.frozen=true;h.api.engine.checkpoint()
 const before=readFileSync(h.api.engine.log.path,'utf8'),safety=structuredClone(h.api.engine.safety)
 const card=await createMethod(f)
 assert.equal(card.kind,'successful-method')
 assert.equal(card.conditional,true);assert.equal(card.causalBenefit,false)
 assert.deepEqual(card.conditions,draft(null).conditions);assert.deepEqual(card.limits,draft(null).limits)
 assert.ok(card.sourceCandidate);assert.equal(card.sourceReference.sessionId,f.session.id)
 const candidate=h.api.executionExperience.inspect(card.sourceCandidate,{scope})
 assert.equal(candidate.kind,'execution-observation');assert.equal(candidate.observation.toolFailureCount,0)
 assert.equal(candidate.status,'needs-review');assert.equal(candidate.productionEligible,false);assert.equal(candidate.frozenOnly,true)
 assert.equal(candidate.instruction,null)
 const use=await f.call({action:'use_success',id:card.id,conditionCheck:'Both fixture reports have the same nonempty business identifiers and no duplicate keys.'})
 assert.equal(use.status,'used')
 const evidence=execution(f),outcome=await f.call({action:'outcome_success',id:card.id,evidence})
 assert.equal(outcome.status,'pending')
 await f.end(2)
 const inspected=await f.call({action:'inspect_success',id:card.id})
 assert.equal(inspected.stats.retrieved,1);assert.equal(inspected.stats.used,1);assert.equal(inspected.stats.checkedOutcomes,1)
 assert.equal(inspected.independentQualityVerified,false);assert.equal(inspected.causalBenefit,false)
 assert.equal(readFileSync(h.api.engine.log.path,'utf8'),before);assert.deepEqual(h.api.engine.safety,safety)
 assert.equal(h.api.engine.log.items.size,0)
})

test('unverified self-report stays out of successful recall and in review',async t=>{
 const h=await host(t),f=h.createSession();f.start()
 const evidence=execution(f)
 evidence.expected='This supposedly verified output never appeared in any native result.'
 const staged=await f.call({action:'record_success',draft:draft(evidence)})
 assert.equal(staged.status,'needs-review')
 await f.end();f.start(2)
 assert.equal((await f.call({action:'recall_success',query:'fixture report merge business identifier'})).cards.length,0)
 assert.ok(JSON.stringify(await f.call({action:'success_status'})).includes('needs-review'))
})

test('successful methods are opt-in and cannot bypass current-turn memory opt-out or project isolation',async t=>{
 const off=await host(t,{enabled:false}),disabled=off.createSession('disabled');disabled.start()
 await assert.rejects(disabled.call({action:'recent_evidence'}),/disabled/i)
 assert.equal(successContexts(await disabled.assemble()),'')
 const h=await host(t),f=h.createSession(),card=await createMethod(f)
 const other=h.createSession('other-project','/fixture/unrelated-project');other.start()
 assert.equal((await other.call({action:'recall_success',query:'fixture report merge business identifier'})).cards.length,0)
 const inspect=await other.call({action:'inspect_success',id:card.id})
 assert.ok(inspect===null||inspect.status==='not-found')
 f.start(3,'本轮不要使用记忆')
 await assert.rejects(f.call({action:'recall_success',query:'fixture report merge business identifier'}),/disabled/i)
 assert.equal(successContexts(await f.assemble()),'')
})

test('source edits invalidate successful methods before reuse',async t=>{
 const h=await host(t),f=h.createSession(),card=await createMethod(f)
 const original=f.events.find(event=>event.type==='tool/result')
 original.data.message.content[0].text='A changed action result invalidates the original source fingerprint.'
 const recalled=await f.call({action:'recall_success',query:'fixture report merge business identifier'})
 assert.equal(recalled.cards.length,0)
 const use=await f.call({action:'use_success',id:card.id,conditionCheck:'Current task still has matching unique business identifiers.'})
 assert.equal(use.status,'source-invalid')
})

test('conditional prompt only contains relevant historical methods',async t=>{
 const h=await host(t),f=h.createSession(),card=await createMethod(f)
 const assembly=await f.assemble()
 let text=successContexts(assembly)
 assert.ok(text.includes(card.id));assert.ok(text.includes(card.conditions[0]))
 assert.match(assembly.contexts.find(row=>row.name==='mnemo-successful-method-guidance')?.text??'',/use_success/)
 f.start(3,'Tell me a short story about a moonlit garden.')
 text=successContexts(await f.assemble())
 assert.equal(text.includes(card.id),false)
})

test('changing the invoking turn during recall cannot deliver or use the old-turn method',async t=>{
 for(const mode of ['tool','prompt']){
  const h=await host(t),f=h.createSession(),card=await createMethod(f)
  const original=h.api.successfulExperiences.recall.bind(h.api.successfulExperiences)
  h.api.successfulExperiences.recall=async(...args)=>{
   const result=await original(...args);f.start(3,'An unrelated new task');return result
  }
  if(mode==='tool')await assert.rejects(f.call({action:'recall_success',query:'fixture report merge business identifier'}),/changed|Trusted/i)
  else assert.equal(successContexts(await f.assemble()),'')
  const use=await f.call({action:'use_success',id:card.id,conditionCheck:'Unique fixture business identifiers were checked for this task.'})
  assert.equal(use.status,'not-delivered')
 }
})

test('reported unsuccessful reuse suspends the method instead of recording a checked success',async t=>{
 const h=await host(t),f=h.createSession(),card=await createMethod(f)
 await f.call({action:'use_success',id:card.id,conditionCheck:'The two current fixtures expose matching unique business identifiers.'})
 const failure=await f.call({action:'fail_success',id:card.id,reason:'The identifiers refer to different business entities despite having matching names.'})
 assert.equal(failure.status,'suspended')
 const inspected=await f.call({action:'inspect_success',id:card.id})
 assert.equal(inspected.stats.used,1);assert.equal(inspected.stats.reportedFailures,1);assert.equal(inspected.stats.checkedOutcomes,0)
 assert.equal((await f.call({action:'recall_success',query:'fixture report merge business identifier'})).cards.length,0)
})

test('native PTC subcalls preserve action/check provenance independently of the outer run_code output',async t=>{
 const h=await host(t),f=h.createSession();f.start()
 f.emit('tool/call',{callId:'outer-code',name:'run_code',arguments:{code:'fixture execution'}})
 f.emit('tool/ptc-dispatch-start',{rootCallId:'outer-code',subCallId:'transform',name:'fixture_transform',arguments:{}})
 const action=f.emit('tool/ptc-dispatch',{rootCallId:'outer-code',subCallId:'transform',name:'fixture_transform',arguments:{},isError:false,content:[{type:'text',text:'The report join produced three rows.'}]})
 f.emit('tool/ptc-dispatch-start',{rootCallId:'outer-code',subCallId:'verify',name:'fixture_verify',arguments:{}})
 const check=f.emit('tool/ptc-dispatch',{rootCallId:'outer-code',subCallId:'verify',name:'fixture_verify',arguments:{},isError:false,content:[{type:'text',text:expected}]})
 f.emit('tool/result',{message:{toolCallId:'outer-code',isError:false,content:[{type:'text',text:'The outer interpreter completed.'}]}})
 const evidence={actionSeqs:[action.seq],checkSeq:check.seq,expected,summary:'Checked the nested verification tool result instead of trusting the interpreter completion.'}
 const recent=await f.call({action:'recent_evidence'})
 assert.equal(recent.results.find(row=>row.seq===check.seq)?.name,'fixture_verify')
 assert.equal((await f.call({action:'record_success',draft:draft(evidence)})).status,'pending')
 await f.end();f.start(2)
 const recalled=await f.call({action:'recall_success',query:'fixture report merge business identifier'})
 assert.equal(recalled.cards.length,1);assert.equal(recalled.cards[0].check.result.seq,check.seq)
 assert.equal(recalled.cards[0].check.name,'fixture_verify')
})

test('checks performed before declaring use cannot become evidence of subsequent method reuse',async t=>{
 const h=await host(t),f=h.createSession(),card=await createMethod(f)
 const earlierEvidence=execution(f)
 await f.call({action:'use_success',id:card.id,conditionCheck:'The current reports expose compatible unique business identifiers.'})
 const outcome=await f.call({action:'outcome_success',id:card.id,evidence:earlierEvidence})
 assert.equal(outcome.status,'needs-review')
 await f.end(2)
 const inspected=await f.call({action:'inspect_success',id:card.id})
 assert.equal(inspected.stats.used,1);assert.equal(inspected.stats.checkedOutcomes,0)
})

test('a new live session recalls a persisted cold source, but deleted persistence overrides a leftover live source',async t=>{
 const h=await host(t),source=h.createSession()
 source.session.header.id=source.session.id
 const card=await createMethod(source)
 assert.ok(JSON.parse(readFileSync(h.api.successfulExperiences.path,'utf8')).cards[card.id])
 const header=structuredClone(source.session.header),events=structuredClone(source.events)
 let exists=true,observed=0,released=0
 h.services.sessionPersistence={stat:async id=>id===source.session.id&&exists?{header,revision:'fixture-source-revision'}:null}
 h.services.sessionQuery={observeSession:async(id,options)=>{
  assert.equal(id,source.session.id);assert.equal(options.projectionMode,'none');observed++
  return {source:'prepared',header,events,cursor:events.length-1,revision:'fixture-source-revision',[Symbol.dispose](){released++}}
 }}
 source.withdraw()
 const consumer=h.createSession('cold-source-consumer',source.session.header.cwd);consumer.start()
 const recalled=await consumer.call({action:'recall_success',query:'fixture report merge business identifier'})
 assert.equal(recalled.cards.length,1);assert.equal(recalled.cards[0].id,card.id)
 assert.ok(observed>0)
 exists=false;source.restore();consumer.start(2)
 assert.equal((await consumer.call({action:'recall_success',query:'fixture report merge business identifier'})).cards.length,0)
 assert.ok(released>0)
})
