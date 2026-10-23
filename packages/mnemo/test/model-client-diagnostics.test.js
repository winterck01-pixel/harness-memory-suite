import test from 'node:test'
import assert from 'node:assert/strict'
import {modelGenerator,safeInferenceDiagnostics,resolveInferenceBudget} from '../lib/model-client.js'
const usage={inputTokens:12,outputTokens:8,totalTokens:27,cacheReadTokens:3,cacheWriteTokens:4,reasoningTokens:5}
const messages=[{role:'system',content:'Return JSON'},{role:'user',content:'A fixture'}]
const client=stream=>modelGenerator({get:name=>({agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'fixture'})},llm:{stream}}[name])})
const invoke=(stream,options={})=>client(stream).complete({messages,...options})
const goodText={type:'text-delta',index:0,text:'{"type":"final","answer":1}'}
const validId=id=>assert.match(id,/^[a-f0-9-]{36}$/)
test('official standalone usage preserves every known count on normal completion',async()=>{
 const out=await invoke(async function*(){yield goodText;yield {type:'usage',usage};yield {type:'finish',reason:{kind:'stop'}}})
 assert.deepEqual(out.usage,usage);assert.deepEqual(out.inferenceDiagnostics.usage,usage);assert.equal(out.inferenceDiagnostics.finishKind,'stop');assert.equal(out.inferenceDiagnostics.configuredMaxTokens,1600);assert.equal(out.inferenceDiagnostics.configuredTimeoutMs,30000);validId(out.inferenceDiagnostics.localInferenceId)
})
for(const kind of ['max-tokens','error','aborted'])test('non-normal terminal '+kind+' retains usage and bounded failure diagnostics',async()=>{
 const secret='private prompt and credential ark-test-secret'
 await assert.rejects(invoke(async function*(){yield {type:'usage',usage};yield {type:'finish',reason:{kind,failure:{code:'RATE_LIMIT',status:429,providerRetryAfterMs:1200,requestId:secret,message:secret}}}}),error=>{
  const d=error.inferenceDiagnostics;assert.equal(d.finishKind,kind);assert.deepEqual(d.usage,usage);assert.equal(d.failureCode,'RATE_LIMIT');assert.equal(d.httpStatus,429);assert.equal(d.providerRetryAfterMs,1200);assert.match(d.providerRequestIdHash,/^[a-f0-9]{64}$/);validId(d.localInferenceId);assert.equal(error.cause,undefined);assert.ok(!JSON.stringify(error).includes(secret));assert.ok(!error.message.includes(secret));return true
 })
})
test('missing finish and a thrown stream preserve already observed official usage',async()=>{
 for(const throws of [false,true])await assert.rejects(invoke(async function*(){yield {type:'usage',usage};if(throws)throw Object.assign(new Error('raw credentials must not persist'),{code:'TRANSPORT'})}),error=>{
  assert.equal(error.inferenceDiagnostics.finishKind,'missing');assert.deepEqual(error.inferenceDiagnostics.usage,usage);assert.ok(!JSON.stringify(error).includes('raw credentials'));assert.equal(error.inferenceDiagnostics.failureCode,throws?'TRANSPORT':null);return true
 })
})
test('abort after usage preserves usage and classifies timeout without saving abort reason',async()=>{
 const controller=new AbortController()
 await assert.rejects(invoke(async function*(){yield {type:'usage',usage};controller.abort(new DOMException('private timeout detail','TimeoutError'));yield goodText},{signal:controller.signal}),error=>{
  assert.deepEqual(error.inferenceDiagnostics.usage,usage);assert.equal(error.inferenceDiagnostics.finishKind,'missing');assert.equal(error.inferenceDiagnostics.abortKind,'timeout');assert.ok(!JSON.stringify(error).includes('private timeout detail'));return true
 })
})
test('unknown or malformed metadata is omitted rather than storing raw provider strings or inventing counts',async()=>{
 const out=await invoke(async function*(){yield goodText;yield {type:'usage',usage:{inputTokens:1,outputTokens:Infinity,totalTokens:-1,cacheReadTokens:'secret',cacheWriteTokens:NaN,reasoningTokens:3,prompt:'secret',huge:1}};yield {type:'finish',reason:{kind:'completed'}}})
 assert.deepEqual(out.usage,{inputTokens:1,reasoningTokens:3});assert.equal(out.inferenceDiagnostics.failureCode,null);assert.equal(out.inferenceDiagnostics.providerRequestIdHash,null)
})
test('usage absent stays null and unexpected finish kind remains unknown without raw text',async()=>{
 await assert.rejects(invoke(async function*(){yield {type:'finish',reason:{kind:'private-unknown-value'}}}),error=>{assert.equal(error.inferenceDiagnostics.finishKind,'unknown');assert.equal(error.inferenceDiagnostics.usage,null);assert.ok(!JSON.stringify(error).includes('private-unknown-value'));return true})
 const out=await invoke(async function*(){yield goodText;yield {type:'finish',reason:{kind:'stop'}}});assert.equal(out.usage,null)
})

test('usage events are cumulative snapshots: last valid snapshot replaces rather than sums or retains stale optional counts',async()=>{
 const out=await invoke(async function*(){yield goodText;yield {type:'usage',usage};yield {type:'usage',usage:{inputTokens:20,outputTokens:10}};yield {type:'finish',reason:{kind:'stop'}}})
 assert.deepEqual(out.usage,{inputTokens:20,outputTokens:10})
})
test('safe metadata boundary rejects unknown keys, accessors, invalid counts and raw error material',()=>{
 let touched=0
 const hostile={finishKind:'private URL',failureCode:'secret token',httpStatus:999,providerRetryAfterMs:86400001,providerRequestIdHash:'credential',usage:{inputTokens:0,outputTokens:-1,totalTokens:Number.MAX_SAFE_INTEGER+1,reasoningTokens:1.5},stack:'private',message:'private',cause:{secret:'private'}}
 Object.defineProperty(hostile.usage,'cacheReadTokens',{get(){touched++;return 5}})
 const d=safeInferenceDiagnostics(hostile)
 assert.equal(touched,0);assert.deepEqual(d.usage,{inputTokens:0});assert.equal(d.finishKind,'unknown');assert.equal(d.failureCode,null);assert.equal(d.httpStatus,null);assert.equal(d.providerRetryAfterMs,null);assert.equal(d.providerRequestIdHash,null);assert.ok(!JSON.stringify(d).includes('private'));assert.equal(safeInferenceDiagnostics().usage,null)
})
test('actual aborted finish is retained even when signal aborts before that terminal chunk is delivered',async()=>{
 const controller=new AbortController()
 await assert.rejects(invoke(async function*(){yield {type:'usage',usage};controller.abort();yield {type:'finish',reason:{kind:'aborted',failure:{code:'ABORTED'}}}},{signal:controller.signal}),error=>{assert.equal(error.inferenceDiagnostics.finishKind,'aborted');assert.equal(error.inferenceDiagnostics.abortKind,'aborted');assert.deepEqual(error.inferenceDiagnostics.usage,usage);return true})
})
test('throw after terminal stop remains a failed inference and retains the observed stop plus usage',async()=>{
 await assert.rejects(invoke(async function*(){yield {type:'usage',usage};yield {type:'finish',reason:{kind:'stop'}};throw Object.assign(new Error('private cleanup stack'),{code:'TRANSPORT'})}),error=>{assert.equal(error.inferenceDiagnostics.finishKind,'stop');assert.equal(error.inferenceDiagnostics.failureCode,'TRANSPORT');assert.deepEqual(error.inferenceDiagnostics.usage,usage);assert.ok(!JSON.stringify(error).includes('private cleanup'));return true})
})

test('trusted caller budget changes explicit request controls and diagnostics without changing route or finish requirements',async()=>{
 let observed
 const out=await invoke(async function*(request){observed=request;yield goodText;yield {type:'finish',reason:{kind:'stop'}}},{inferenceBudget:{maxTokens:3200,timeoutMs:45000}})
 assert.equal(observed.maxTokens,3200);assert.equal(observed.provider,'fixture');assert.equal(observed.model,'fixture');assert.equal(out.inferenceDiagnostics.configuredMaxTokens,3200);assert.equal(out.inferenceDiagnostics.configuredTimeoutMs,45000)
 for(const inferenceBudget of [null,[],{}, {maxTokens:3200}, {maxTokens:1600,timeoutMs:30000,extra:true},{maxTokens:1599,timeoutMs:30000},{maxTokens:6401,timeoutMs:30000},{maxTokens:1600,timeoutMs:29999},{maxTokens:1600,timeoutMs:90001},{maxTokens:1600.5,timeoutMs:30000},{maxTokens:'6400',timeoutMs:90000}]){
  let calls=0
  await assert.rejects(invoke(async function*(){calls++;yield {type:'finish',reason:{kind:'stop'}}},{inferenceBudget}),/Invalid sandbox inference budget/)
  assert.equal(calls,0)
 }
 await assert.rejects(invoke(async function*(){yield {type:'finish',reason:{kind:'max-tokens'}}},{inferenceBudget:{maxTokens:6400,timeoutMs:90000}}),error=>error.inferenceDiagnostics.finishKind==='max-tokens'&&error.inferenceDiagnostics.configuredMaxTokens===6400)
})

test('budget normalizer is exact, detached and does not invoke accessors or accept message-like options',()=>{
 assert.deepEqual(resolveInferenceBudget(),{maxTokens:1600,timeoutMs:30000})
 const source={maxTokens:6400,timeoutMs:90000},normalized=resolveInferenceBudget(source);assert.notEqual(source,normalized);source.maxTokens=1600;assert.equal(normalized.maxTokens,6400)
 let touched=0;const accessors={timeoutMs:30000,get maxTokens(){touched++;return 3200}};assert.throws(()=>resolveInferenceBudget(accessors),/Invalid sandbox inference budget/);assert.equal(touched,0)
 assert.throws(()=>resolveInferenceBudget({maxTokens:3200,timeoutMs:30000,[Symbol('extra')]:true}),/Invalid sandbox inference budget/)
})
