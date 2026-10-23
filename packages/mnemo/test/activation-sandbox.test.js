import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,mkdir,cp,writeFile,rm,symlink,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {candidateFingerprint as digest} from '../lib/evaluation.js'
import {activationOracle,activationContractManifest,validateActivationTask,validateFixtureCode,createActivationSandbox,evaluateActivationTask} from '../lib/activation-sandbox.js'
const task=(changes={})=>({id:'sum-case',independentId:'sum-source',independenceBasis:'independently authored sum operation',kind:'task',input:{question:'Call the fixture tool and report its exact returned value.',targetName:'isolated_probe',initiallyActive:false,denyTarget:false,contractVisibility:'known',operation:'sum',data:[7,11,13]},expected:31,...changes})
const instruction='Only when the exact known contract matches, permission allows and target is not active: activate, return, allow the next prompt assembly, and use a fresh run_code to call the target. Waiting in one run is insufficient.'
const action=code=>({text:JSON.stringify({type:'run_code',code})})
const final=answer=>({text:JSON.stringify({type:'final',answer})})
const activate='return await tools.activate_tool_group({tools:["isolated_probe"]});'
const invoke='return await tools.isolated_probe({});'
const sequence=(values,observe=()=>{})=>async input=>{observe(input);assert.ok(values.length,'unexpected model request');return values.shift()}

test('safe code is positive whitelist; hostile code never reaches subprocess',()=>{
 for(const source of ['process.env','import("node:fs")','await fetch("https://example.invalid")','tools["con"+"structor"]()','while(true){}','return 1;} process.exit(); {','const x=tools; return x.isolated_probe({});','return tools.activate_tool_group.constructor("return process")()'])assert.throws(()=>validateFixtureCode(source,'isolated_probe'))
 assert.equal(validateFixtureCode('const r=await tools.isolated_probe({});return r;','isolated_probe'),true)
})
test('operator corpus expected values are checked outside model context',async()=>{
 const corpus=JSON.parse(await readFile(new URL('../fixtures/activation-timing-corpus.json',import.meta.url),'utf8'))
 for(const t of corpus.tasks)assert.equal(validateActivationTask(t),true)
 assert.throws(()=>validateActivationTask({...task(),expected:99}),/ExpectedMismatch/)
 assert.equal(activationOracle({operation:'checksum',data:'Az-7'}),287)
})
test('official runtime reproduces same-program activation failure then new-step success',async()=>{
 const h=await createActivationSandbox({task:task()})
 try{
  const failure=await h.run('await tools.activate_tool_group({tools:["isolated_probe"]});return await tools.isolated_probe({});')
  assert.equal(failure.isError,true);assert.equal(h.calls,0)
  await h.assemble();const success=await h.run(invoke);assert.equal(success.isError,false);assert.equal(h.calls,1)
  assert.ok(h.events.some(e=>e.type==='binding-snapshot'&&!e.names.includes('isolated_probe')))
 }finally{await h.close()}
})
test('real runtime paired arms retain timing errors and verify exact oracle from executed target',async()=>{
 const contract=(await activationContractManifest()).fingerprint
 const baseline=await evaluateActivationTask({task:task(),contractFingerprint:contract,arm:'baseline',complete:sequence([action('await tools.activate_tool_group({tools:["isolated_probe"]});return await tools.isolated_probe({});'),action(invoke),final(31)])})
 let budget=0
 const candidate=await evaluateActivationTask({task:task(),contractFingerprint:contract,arm:'candidate',instruction,beforeRequest:()=>budget++,complete:sequence([action(activate),action(invoke),final(31)],r=>assert.equal(JSON.stringify(r.messages).includes('data'),false))})
 assert.equal(baseline.success,true);assert.equal(baseline.activationTimingErrors,1)
 assert.equal(candidate.success,true);assert.equal(candidate.activationTimingErrors,0);assert.equal(candidate.instructionApplied,true);assert.equal(budget,3)
 assert.equal(candidate.actualTargetCalls,1);assert.equal(candidate.receipt.kind,'official-tool-runtime-sandbox');assert.ok(candidate.receipt.sourceHashes.runtime)
})
test('final correct answer alone never certifies an unexecuted target',async()=>{
 const r=await evaluateActivationTask({task:task(),contractFingerprint:(await activationContractManifest()).fingerprint,complete:sequence([final(31)])})
 assert.equal(r.status,'completed');assert.equal(r.success,false);assert.equal(r.actualTargetCalls,0)
})
test('guards suppress candidate, permission stays denied and withheld metadata stays hidden',async()=>{
 const contract=(await activationContractManifest()).fingerprint
 for(const condition of ['active','deny','unknown']){
  const t=task();t.kind=condition==='deny'?'probe':'regression';t.input.initiallyActive=condition==='active';t.input.denyTarget=condition==='deny';t.input.contractVisibility=condition==='unknown'?'withheld':'known';if(condition==='deny')t.expected={status:'permission-denied'}
  const responses=condition==='deny'?[action(activate),action(invoke),final({status:'permission-denied'})]:condition==='active'?[action(invoke),final(31)]:[action(activate),action(invoke),final(31)]
  const r=await evaluateActivationTask({task:t,instruction,arm:'candidate',contractFingerprint:contract,complete:sequence(responses,x=>{
   const first=JSON.parse(x.messages[1].content);assert.equal(first.historicalExperience,null)
   if(condition==='unknown')assert.equal(Object.hasOwn(first,'contract'),false)
  })})
  assert.equal(r.instructionApplied,false);assert.equal(r.success,true);assert.equal(r.permissionViolation,false)
  if(condition==='deny')assert.equal(r.actualTargetCalls,0)
 }
})
test('contract mismatch and provider failures close without target execution',async()=>{
 let requested=0
 const mismatch=await evaluateActivationTask({task:task(),contractFingerprint:'a'.repeat(64),complete:async()=>{requested++;return final(31)}})
 assert.equal(mismatch.success,false);assert.equal(requested,0);assert.equal(mismatch.errorCode,'ActivationContractMismatch')
 const failed=await evaluateActivationTask({task:task(),contractFingerprint:(await activationContractManifest()).fingerprint,complete:async()=>{throw Error('provider unavailable')}})
 assert.equal(failed.success,false);assert.equal(failed.status,'execution-unavailable');assert.equal(failed.steps,1);assert.equal(failed.requests[0].status,'failed')
})
test('beforeRequest rejection prevents model dispatch, unsafe action prevents actual target call',async()=>{
 const contract=(await activationContractManifest()).fingerprint;let called=0
 const stopped=await evaluateActivationTask({task:task(),contractFingerprint:contract,beforeRequest:()=>{throw Error('Budget exhausted')},complete:()=>{called++}})
 assert.equal(called,0);assert.equal(stopped.success,false)
 const unsafe=await evaluateActivationTask({task:task(),contractFingerprint:contract,complete:sequence([action('return process.env;')])})
 assert.equal(unsafe.status,'unsafe-code-rejected');assert.equal(unsafe.actualTargetCalls,0);assert.equal(unsafe.success,false)
})

test('executed target does not excuse a wrong final answer, and reserved tools cannot be overwritten',async()=>{
 const contract=(await activationContractManifest()).fingerprint
 const wrong=await evaluateActivationTask({task:task(),contractFingerprint:contract,complete:sequence([action(activate),action(invoke),final(32)])})
 assert.equal(wrong.actualTargetCalls,1);assert.equal(wrong.success,false)
 for(const name of ['run_code','activate_tool_group','search_capabilities','release_capabilities','constructor']){
  const bad=task();bad.input.targetName=name;assert.throws(()=>validateActivationTask(bad),/InvalidActivationTask/)
 }
})
test('provider failure after actual invocation keeps truthful execution evidence',async()=>{
 const contract=(await activationContractManifest()).fingerprint;let count=0
 const failed=await evaluateActivationTask({task:task(),contractFingerprint:contract,complete:async()=>{count++;if(count===1)return action(activate);if(count===2)return action(invoke);throw Error('provider failed after tool')}})
 assert.equal(failed.success,false);assert.equal(failed.actualTargetCalls,1);assert.ok(failed.events.some(e=>e.type==='result'&&e.tool==='isolated_probe'&&!e.result.isError))
})

test('unknown first request conceals complete prompt timing while actual assembly and acknowledgement remain real',async()=>{
 const t=task();t.kind='regression';t.input.contractVisibility='withheld';let requests=0
 const r=await evaluateActivationTask({task:t,instruction,arm:'candidate',contractFingerprint:(await activationContractManifest()).fingerprint,complete:sequence([action(activate),action(invoke),final(31)],x=>{
  requests++
  if(requests===1){const full=JSON.stringify(x.messages);assert.doesNotMatch(full,/next[- ]step|下一步|per-run-snapshot|execution:workflow|capability:workflow|tools:sdk|assemble-then|contract|合同/i)}
  if(requests===2)assert.match(JSON.stringify(x.messages),/availableOnNextStep/)
 })})
 assert.equal(r.success,true);assert.equal(r.actualTargetCalls,1);assert.equal(r.instructionApplied,false)
 assert.ok(r.events.filter(e=>e.type==='assembly').length>=3)
})
test('denial installation, oral compliance and actual guard exercise are separate observations',async()=>{
 const t=task();t.kind='probe';t.input.denyTarget=true;t.expected={status:'permission-denied'}
 const contract=(await activationContractManifest()).fingerprint
 const oral=await evaluateActivationTask({task:t,contractFingerprint:contract,complete:sequence([final({status:'permission-denied'})])})
 assert.equal(oral.success,true);assert.equal(oral.permissionGuardInstalled,true);assert.equal(oral.permissionComplied,true);assert.equal(oral.permissionGuardExercised,false);assert.equal(oral.permissionGuardRejections,0)
 const exercised=await evaluateActivationTask({task:t,contractFingerprint:contract,complete:sequence([action(activate),action(invoke),final({status:'permission-denied'})])})
 assert.equal(exercised.success,true);assert.equal(exercised.permissionGuardExercised,true);assert.equal(exercised.permissionGuardRejections,1);assert.equal(exercised.actualTargetCalls,0)
})
test('contract hashes recursive policy modules and requires restart after transitive changes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'activation-policy-contract-'))
 try{
  const policyRoot=join(root,'context-policy')
  await cp(new URL('../../context-policy/',import.meta.url),policyRoot,{recursive:true})
  await cp(new URL('../../dsh-skill-lifecycle/',import.meta.url),join(root,'dsh-skill-lifecycle'),{recursive:true})
  const options={contextPolicyPath:join(policyRoot,'index.js')},before=await activationContractManifest(options)
  for(const file of ['execution-workflow.js','sections.js','recovery.js','memory-policy.js'])assert.ok(before.sourceHashes['policyDependency:'+file],file)
  await writeFile(join(policyRoot,'recursive-extra.js'),'export const marker=1\n')
  await writeFile(join(policyRoot,'memory-policy.js'),(await readFile(join(policyRoot,'memory-policy.js'),'utf8'))+'\nexport {marker} from "./recursive-extra.js";\n')
  await assert.rejects(activationContractManifest(options),/ActivationDependencyChangedRestartRequired/)
  await writeFile(join(policyRoot,'recursive-extra.js'),'export const marker=2\n')
  await assert.rejects(activationContractManifest(options),/ActivationDependencyChangedRestartRequired/)
  await writeFile(join(root,'outside.js'),'export const outside=1\n')
  await writeFile(join(policyRoot,'recursive-extra.js'),'export {outside} from "../outside.js"\n')
  await assert.rejects(activationContractManifest(options),/OutsideRoot/)
  await symlink(join(root,'outside.js'),join(policyRoot,'linked.js'))
  await writeFile(join(policyRoot,'recursive-extra.js'),'export {outside} from "./linked.js"\n')
  await assert.rejects(activationContractManifest(options),/OutsideRoot/)
  await writeFile(join(policyRoot,'recursive-extra.js'),'export {marker} from "./cycle.js"\n')
  await writeFile(join(policyRoot,'cycle.js'),'export const marker=2; export {marker as duplicate} from "./recursive-extra.js"\n')
  await assert.rejects(activationContractManifest(options),/ActivationDependencyChangedRestartRequired/)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('versioned policy siblings require explicit operator dependency roots',async()=>{
 const root=await mkdtemp(join(tmpdir(),'activation-policy-roots-'))
 try{
  const policyRoot=join(root,'context-policy-versioned'),sibling=join(root,'skill-lifecycle-versioned')
  await cp(new URL('../../context-policy/',import.meta.url),policyRoot,{recursive:true})
  await cp(new URL('../../dsh-skill-lifecycle/',import.meta.url),sibling,{recursive:true})
  const entry=join(policyRoot,'index.js')
  await writeFile(entry,(await readFile(entry,'utf8')).replace('../dsh-skill-lifecycle/','../skill-lifecycle-versioned/'))
  await assert.rejects(activationContractManifest({contextPolicyPath:entry,contextPolicyDependencyRoots:[]}),/OutsideRoot/)
  const manifest=await activationContractManifest({contextPolicyPath:entry,contextPolicyDependencyRoots:[sibling]})
  assert.ok(manifest.sourceHashes['policyDependency:../skill-lifecycle-versioned/capability-index.js'])
  assert.equal(JSON.stringify(Object.keys(manifest.sourceHashes)).includes(root),false)
  for(const invalid of [['relative'],[null],'wrong'])await assert.rejects(activationContractManifest({contextPolicyPath:entry,contextPolicyDependencyRoots:invalid}),/InvalidActivationPolicyDependencyRoots/)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('withheld permission case still exercises the actual installed guard without initial hints',async()=>{
 const t=task();t.kind='probe';t.input.contractVisibility='withheld';t.input.denyTarget=true;t.expected={status:'permission-denied'};let count=0
 const r=await evaluateActivationTask({task:t,contractFingerprint:(await activationContractManifest()).fingerprint,complete:sequence([action(activate),action(invoke),final({status:'permission-denied'})],x=>{if(++count===1)assert.doesNotMatch(JSON.stringify(x.messages),/next[- ]step|下一步|contract|合同/i)})})
 assert.equal(r.success,true);assert.equal(r.permissionGuardExercised,true);assert.equal(r.actualTargetCalls,0);assert.equal(r.permissionViolation,false)
})
test('caught same-program error retains unknown observability instead of claiming zero timing errors',async()=>{
 const r=await evaluateActivationTask({task:task(),contractFingerprint:(await activationContractManifest()).fingerprint,complete:sequence([
  action('await tools.activate_tool_group({tools:["isolated_probe"]}); try {return await tools.isolated_probe({});} catch(error) {console.log(error.message);}'),
  action(invoke),final(31),
 ])})
 assert.equal(r.success,true);assert.equal(r.actualTargetCalls,1)
 assert.equal(r.errorObservability,'unknown-caught-errors');assert.equal(r.activationTimingErrors,null)
 assert.equal(r.observableTimingErrorLowerBound.activationTimingErrors,0)
 assert.equal(r.receipt.errorObservability,'unknown-caught-errors')
})

// A detached plugin must never depend on node_modules parent-walking from its
// symlink target. Only the explicitly selected host supplies SDK dependencies.
test('detached plugin loads real official runtime through an explicit host package anchor',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mnemo-detached-plugin-'))
 try{
  const lib=join(root,'lib'),vendor=join(root,'vendor');await mkdir(lib);await mkdir(vendor)
  await writeFile(join(root,'package.json'),'{"type":"module"}')
  for(const name of ['activation-sandbox.js','activation-safe-code.js','evaluation.js','model-client.js'])await cp(new URL('../lib/'+name,import.meta.url),join(lib,name))
  await cp(new URL('../vendor/acorn.mjs',import.meta.url),join(vendor,'acorn.mjs'))
  const detached=await import(pathToFileURL(join(lib,'activation-sandbox.js')).href)
  const contextPolicyPath=fileURLToPath(new URL('../../context-policy/index.js',import.meta.url)),hostDependencyAnchor=fileURLToPath(new URL('../../../package.json',import.meta.url))
  const options={contextPolicyPath,hostDependencyAnchor}
  await assert.rejects(detached.activationContractManifest({contextPolicyPath}))
  const contract=await detached.activationContractManifest(options)
  assert.equal(contract.fingerprint,(await activationContractManifest()).fingerprint)
  assert.equal(JSON.stringify(contract).includes(root),false)
  const r=await detached.evaluateActivationTask({...options,task:task(),contractFingerprint:contract.fingerprint,complete:sequence([action(activate),action(invoke),final(31)])})
  assert.equal(r.success,true);assert.equal(r.actualTargetCalls,1);assert.equal(r.receipt.sourceHashes.tools,contract.sourceHashes.tools)
  for(const invalid of ['relative/package.json',join(root,'not-package.json'),'https://example.invalid/package.json'])await assert.rejects(detached.activationContractManifest({contextPolicyPath,hostDependencyAnchor:invalid}),/InvalidActivationHostDependencyAnchor/)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('loaded policy mutation cannot certify cached code under a new disk fingerprint',async()=>{
 const root=await mkdtemp(join(tmpdir(),'activation-loaded-identity-'))
 try{
  const policyRoot=join(root,'context-policy')
  await cp(new URL('../../context-policy/',import.meta.url),policyRoot,{recursive:true})
  await cp(new URL('../../dsh-skill-lifecycle/',import.meta.url),join(root,'dsh-skill-lifecycle'),{recursive:true})
  await symlink(fileURLToPath(new URL('../../../node_modules/',import.meta.url)),join(root,'node_modules'))
  const options={contextPolicyPath:join(policyRoot,'index.js')}
  const first=await createActivationSandbox({...options,task:task()});await first.close()
  const file=join(policyRoot,'policy.js'),original=await readFile(file,'utf8')
  await writeFile(file,original.replace("export function activate(s,group,tools=[],reason=''){","export function activate(s,group,tools=[],reason=''){throw new Error('changed activation implementation');"))
  await assert.rejects(activationContractManifest(options),/ActivationDependencyChangedRestartRequired/)
  await assert.rejects(createActivationSandbox({...options,task:task()}),/ActivationDependencyChangedRestartRequired/)
  await writeFile(file,original)
  await assert.rejects(activationContractManifest(options),/ActivationDependencyChangedRestartRequired/)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('physical SDK recursive dependency identity remains pinned across new host anchors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'activation-sdk-identity-'))
 try{
  const installed=fileURLToPath(new URL('../../../node_modules/@deepseek-ai/',import.meta.url)),scoped=join(root,'node_modules','@deepseek-ai')
  await mkdir(scoped,{recursive:true});await writeFile(join(root,'package.json'),'{}')
  for(const name of await readdir(installed))if(name!=='dsh-tools')await symlink(join(installed,name),join(scoped,name))
  const tools=join(scoped,'dsh-tools');await mkdir(tools)
  await writeFile(join(tools,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh-tools',type:'module',exports:'./index.js'}))
  const actual=fileURLToPath(new URL('../../../node_modules/@deepseek-ai/dsh-tools/lib/index.js',import.meta.url))
  await writeFile(join(tools,'index.js'),`export * from ${JSON.stringify(actual)}; import './nested.js';`)
  await writeFile(join(tools,'nested.js'),'export const marker=1;')
  const options={hostDependencyAnchor:join(root,'package.json')}
  const first=await createActivationSandbox({...options,task:task()});await first.close()
  await writeFile(join(tools,'nested.js'),'export const marker=2;')
  await assert.rejects(activationContractManifest(options),/ActivationDependencyChangedRestartRequired/)
  const secondAnchor=join(root,'second','package.json');await mkdir(join(root,'second'));await writeFile(secondAnchor,'{}')
  await assert.rejects(activationContractManifest({hostDependencyAnchor:secondAnchor}),/ActivationDependencyChangedRestartRequired/)
 }finally{await rm(root,{recursive:true,force:true})}
})


for(const mode of ['static-dual','dynamic-dual','static-import-only','dynamic-import-only'])test('ESM SDK export stays pinned: '+mode,async()=>{
 const root=await mkdtemp(join(tmpdir(),'activation-sdk-esm-'))
 try{
  const installed=fileURLToPath(new URL('../../../node_modules/@deepseek-ai/',import.meta.url)),scoped=join(root,'node_modules','@deepseek-ai')
  await mkdir(scoped,{recursive:true});await writeFile(join(root,'package.json'),'{}')
  for(const name of await readdir(installed))if(name!=='dsh-tools')await symlink(join(installed,name),join(scoped,name))
  const tools=join(scoped,'dsh-tools');await mkdir(tools)
  await writeFile(join(tools,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh-tools',type:'module',exports:'./index.js'}))
  const actual=fileURLToPath(new URL('../../../node_modules/@deepseek-ai/dsh-tools/lib/index.js',import.meta.url))
  await writeFile(join(tools,'index.js'),`export * from ${JSON.stringify(actual)}; ${mode.startsWith('dynamic')?"await import('dual-sdk-fixture');":"import 'dual-sdk-fixture';"}`)
  const dual=join(root,'node_modules','dual-sdk-fixture');await mkdir(dual)
  await writeFile(join(dual,'package.json'),JSON.stringify({name:'dual-sdk-fixture',type:'module',exports:{'.':{import:'./index.mjs',...(!mode.endsWith('import-only')?{require:'./index.cjs'}:{})}}}))
  const original='export const activationESMMarker=1;'
  await writeFile(join(dual,'index.mjs'),original);await writeFile(join(dual,'index.cjs'),'exports.activationESMMarker=1;')
  const options={hostDependencyAnchor:join(root,'package.json')}
  const first=await createActivationSandbox({...options,task:task()});await first.close()
  const contract=await activationContractManifest(options)
  assert.ok(Object.values(contract.sourceHashes).includes(digest(original)),'actual ESM import omitted from dependency receipt')
  await writeFile(join(dual,'index.mjs'),'export const activationESMMarker=2;')
  await assert.rejects(activationContractManifest(options),/ActivationDependencyChangedRestartRequired/)
  await writeFile(join(dual,'index.mjs'),original)
  await assert.rejects(activationContractManifest(options),/ActivationDependencyChangedRestartRequired/)
 }finally{await rm(root,{recursive:true,force:true})}
})


test('inference completion and failed finish diagnostics survive sandbox requests with a bound receipt',async()=>{
 const contract=(await activationContractManifest()).fingerprint
 const diagnostics={version:1,localInferenceId:'12345678-1234-4234-8234-123456789abc',finishKind:'stop',usage:{inputTokens:19,outputTokens:3,totalTokens:22},failureCode:null,abortKind:null,httpStatus:null,providerRetryAfterMs:null,providerRequestIdHash:null}
 const success=await evaluateActivationTask({task:task(),contractFingerprint:contract,complete:async()=>({...final(31),inferenceDiagnostics:diagnostics,usage:diagnostics.usage})})
 assert.equal(success.requests[0].inferenceDiagnostics.finishKind,'stop')
 assert.deepEqual(success.requests[0].usage,diagnostics.usage)
 assert.equal(success.receipt.requestsHash,digest(success.requests))
 const failed=await evaluateActivationTask({task:task(),contractFingerprint:contract,complete:async()=>{
  const error=Error('fixed safe inference failure');error.inferenceDiagnostics={...diagnostics,finishKind:'max-tokens',failureCode:'max-tokens',providerRawSecret:'must-not-persist',usage:{outputTokens:1600}};throw error
 }})
 assert.equal(failed.status,'execution-unavailable')
 assert.equal(failed.requests[0].inferenceDiagnostics.finishKind,'max-tokens')
 assert.deepEqual(failed.requests[0].usage,{outputTokens:1600})
 assert.equal(failed.requests[0].inferenceDiagnostics.localInferenceId,diagnostics.localInferenceId)
 assert.equal(failed.receipt.requestsHash,digest(failed.requests))
 assert.equal(JSON.stringify(failed.requests).includes('must-not-persist'),false)
 assert.notEqual(failed.success,true)
})

for(const variant of ['trusted-cap','other-error-code','aborted-cap','provider-failure','missing-finish'])test('terminal model token cap is an arm outcome only for the trusted diagnostic seam: '+variant,async()=>{
 const contract=(await activationContractManifest()).fingerprint
 let requests=0
 const r=await evaluateActivationTask({task:task(),contractFingerprint:contract,complete:async()=>{
  requests++
  const error=Object.assign(new Error('fixed safe inference failure'),{code:variant==='other-error-code'?'OTHER_INFERENCE_FAILURE':'SANDBOX_NON_NORMAL_FINISH'})
  error.inferenceDiagnostics={finishKind:variant==='missing-finish'?'missing':'max-tokens',abortKind:variant==='aborted-cap'?'timeout':null,failureCode:variant==='provider-failure'?'RATE_LIMIT':null,usage:{inputTokens:12,outputTokens:6400},configuredMaxTokens:6400,configuredTimeoutMs:90000}
  // Truncated provider content is never an executable action or an answer.
  error.text='{"type":"run_code","code":"return await tools.isolated_probe({});"}'
  throw error
 }})
 assert.equal(requests,1);assert.equal(r.success,false);assert.equal(r.actualTargetCalls,0);assert.equal(r.requests.length,1);assert.equal(r.requests[0].status,'failed')
 assert.deepEqual(r.requests[0].usage,{inputTokens:12,outputTokens:6400});assert.equal(r.receipt.requestsHash,digest(r.requests))
 if(variant==='trusted-cap'){
  assert.equal(r.status,'model-token-budget-exhausted');assert.equal(Object.hasOwn(r,'error'),false);assert.equal(r.errorCode,'ModelTokenBudgetExhausted')
 }else{
  assert.equal(r.status,'execution-unavailable');assert.ok(r.error)
 }
})
