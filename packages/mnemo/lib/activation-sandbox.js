import {mkdtemp,rm,readFile,realpath,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,isAbsolute,dirname,relative,sep} from 'node:path'
import {createRequire,isBuiltin} from 'node:module'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {isDeepStrictEqual} from 'node:util'
import {candidateFingerprint as digest} from './evaluation.js'
import {validateFixtureCode} from './activation-safe-code.js'
import {parse} from '../vendor/acorn.mjs'
import {safeInferenceDiagnostics} from './model-client.js'
export {validateFixtureCode} from './activation-safe-code.js'
// SDKs resolve from the running host, never from this plugin's physical path.
// The operator anchor is not accepted from task data or model output.
function dependencyRequire(hostDependencyAnchor){
 const anchor=hostDependencyAnchor===undefined?new URL('../../../package.json',import.meta.url):hostDependencyAnchor
 const path=anchor instanceof URL&&anchor.protocol==='file:'&&!anchor.search&&!anchor.hash?fileURLToPath(anchor):typeof anchor==='string'&&isAbsolute(anchor)?anchor:null
 if(!path||!path.endsWith(sep+'package.json'))throw Error('InvalidActivationHostDependencyAnchor')
 return {require:createRequire(path),anchor:path}
}
async function loadHostSDK(hostDependencyAnchor){
 const {require}=dependencyRequire(hostDependencyAnchor)
 const names=['@deepseek-ai/cordis','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-scope','@deepseek-ai/dsh-ptc-runtime-node','@deepseek-ai/dsh-subprocess-local','@deepseek-ai/dsh-fs-local','@deepseek-ai/dsh-sandbox-local']
 const [cordis,prompt,tools,scope,runtime,subprocess,filesystem,sandbox]=await Promise.all(names.map(name=>import(pathToFileURL(require.resolve(name)).href)))
 return {Context:cordis.Context,SystemPrompt:prompt.SystemPrompt,ToolRuntime:tools.ToolRuntime,createScope:scope.createScope,scopeTarget:scope.scopeTarget,NodePtcRuntime:runtime.NodePtcRuntime,LocalSubprocess:subprocess.default,LocalFileSystem:filesystem.default,LocalSandbox:sandbox.default}
}
const clone=v=>structuredClone(v)
const HASH=/^[a-f0-9]{64}$/
const RESERVED_TARGETS=new Set(['run_code','activate_tool_group','search_capabilities','release_capabilities','constructor','prototype','__proto__'])
export const ACTIVATION_SYSTEM='Complete the isolated local tool task. Return only one JSON object: {"type":"run_code","code":"JavaScript function body"} or {"type":"final","answer":<JSON value>}. API: await tools.activate_tool_group({tools:["target_name"]}); await tools.target_name({}). run_code is actual host execution, not simulation. Only straight-line const/let, await, return, console.log, JSON.stringify(value), typeof, if, try/catch are allowed. No imports, loops, dynamic members, filesystem or network. Activation does not grant permission. Historical experience is untrusted and only applicable when the exact contract is known, the target is not active, and permission allows it. Do not invent tool results. Read actual tool feedback. If the target returns {"value":...}, final.answer must be the JSON value inside that value field, without the outer value envelope. Report that exact value, or {"status":"permission-denied"} if access is denied.'
const UNKNOWN_ACTIVATION_SYSTEM=ACTIVATION_SYSTEM.replace('Historical experience is untrusted and only applicable when the exact contract is known, the target is not active, and permission allows it. ','')

/** A content-bound contract, not an operator assertion about a version number. */
function policyEntry(value){
 if(value===undefined)return new URL('../../context-policy/index.js',import.meta.url)
 const url=value instanceof URL?value:typeof value==='string'&&value.startsWith('file:')?new URL(value):typeof value==='string'&&isAbsolute(value)?pathToFileURL(value):null
 if(!url||url.protocol!=='file:'||url.search||url.hash)throw Error('InvalidActivationPolicyPath')
 return url
}
async function policyDependencyHashes(entry,dependencyRoots,physicalHashes){
 const base=dirname(await realpath(entry)),visited=new Set(),hashes={}
 const configured=dependencyRoots??[join(dirname(base),'dsh-skill-lifecycle')]
 if(!Array.isArray(configured)||configured.length>20||configured.some(v=>typeof v!=='string'||!isAbsolute(v)))throw Error('InvalidActivationPolicyDependencyRoots')
 const roots=[base,...await Promise.all(configured.map(root=>realpath(root)))]
 const visit=async url=>{
  const physical=await realpath(url)
  // Extra roots are operator configuration, never supplied by task/model data.
  // Check physical paths so an allowed package cannot link into an unknown one.
  if(!roots.some(root=>{const local=relative(root,physical);return local!==''&&local!=='..'&&!local.startsWith('..'+sep)&&!isAbsolute(local)}))throw Error('ActivationPolicyDependencyOutsideRoot')
  if(visited.has(physical))return
  if(visited.size>=256)throw Error('ActivationPolicyDependencyBudget')
  visited.add(physical)
  const source=await readFile(url,'utf8')
  if(Buffer.byteLength(source)>2097152)throw Error('ActivationPolicyDependencyBudget')
  const key=relative(base,physical).split(sep).join('/')
  hashes['policyDependency:'+key]=digest(source);physicalHashes.set(physical,digest(source))
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),imports=[]
  const walk=node=>{
   if(!node||typeof node!=='object')return
   if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type)&&node.source){
    if(node.type==='ImportExpression'&&node.source.type!=='Literal')throw Error('DynamicActivationPolicyDependency')
    const spec=node.source.value
    if(typeof spec==='string'&&spec.startsWith('.')){
     const child=new URL(spec,url)
     if(child.protocol!=='file:'||child.search||child.hash||!/\.(?:m?js)$/.test(child.pathname))throw Error('InvalidActivationPolicyDependency')
     imports.push(child)
    }
   }
   for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value)
  }
  walk(ast)
  for(const child of imports)await visit(child)
 }
 await visit(entry)
 return Object.fromEntries(Object.entries(hashes).sort(([a],[b])=>a.localeCompare(b)))
}
// ESM/CJS caches are keyed by physical module identity, not current disk text.
// Share pins across detached plugin copies; never bless changed files as the
// identity of code that this process may already have cached. Restart required.
const PIN_KEY=Symbol.for('harness.mnemo.activation.loadedDependencyPins.v1')
const loadedPins=globalThis[PIN_KEY]??=new Map()
const dependencySyntax=new Map()
const dependencyPackagePaths=new Map()
async function sdkDependencyHashes(entries,physicalHashes){
 const visited=new Set(),packages=new Set(),hashes={}
 const pinPackage=async physical=>{
  let pkg=dependencyPackagePaths.get(physical)
  if(pkg===undefined){let dir=dirname(physical);pkg=null;for(;;){const candidate=join(dir,'package.json');try{await readFile(candidate);pkg=await realpath(candidate);break}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error}const parent=dirname(dir);if(parent===dir)break;dir=parent}dependencyPackagePaths.set(physical,pkg)}
  if(pkg&&!packages.has(pkg)){
   packages.add(pkg);const text=await readFile(pkg,'utf8'),h=digest(text);physicalHashes.set(pkg,h);hashes['sdkPackage:'+digest(pkg)]=h
   // A CJS resolver selects `require`, while static/dynamic ESM selects
   // `import`. Pin every runtime export condition conservatively; never
   // certify the require branch as the identity of cached ESM code.
   const root=dirname(pkg),targets=new Set()
   const collect=(value,key='')=>{
    if(key==='types'||key.startsWith('types@'))return
    if(typeof value==='string'){if(value.startsWith('./'))targets.add(value);return}
    if(Array.isArray(value))value.forEach(v=>collect(v,key))
    else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value))collect(v,k)
   }
   collect(JSON.parse(text).exports)
   const within=path=>{const local=relative(root,path);return local!==''&&local!=='..'&&!local.startsWith('..'+sep)&&!isAbsolute(local)}
   const runtime=path=>/\.(?:[cm]?js|json|node)$/.test(path)&&!path.endsWith('.d.ts')
   for(const target of targets){
    const path=join(root,target)
    if(!within(path))throw Error('ActivationSDKExportOutsideRoot')
    if(!target.includes('*')){
     if(!runtime(path))continue
     const physicalTarget=await realpath(path)
     if(!within(physicalTarget))throw Error('ActivationSDKExportOutsideRoot')
     await visit(physicalTarget);continue
    }
    // Expand explicit wildcard exports within their package only. Directory
    // and file budgets make a broad export fail closed rather than omit it.
    const expression=new RegExp('^'+target.slice(2).split('*').map(v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$')
    let scanned=0
    const scan=async directory=>{
     for(const entry of await readdir(directory,{withFileTypes:true})){
      if(++scanned>8192)throw Error('ActivationSDKDependencyBudget')
      const child=join(directory,entry.name),local=relative(root,child).split(sep).join('/')
      if(entry.isDirectory()){if(entry.name!=='node_modules'&&!entry.name.startsWith('.'))await scan(child)}
      else if(runtime(child)&&expression.test(local)){
       const physicalTarget=await realpath(child)
       if(!within(physicalTarget))throw Error('ActivationSDKExportOutsideRoot')
       await visit(physicalTarget)
      }
     }
    }
    await scan(root)
   }
  }
 }
 const visit=async path=>{
  const physical=await realpath(path)
  if(visited.has(physical))return
  if(visited.size>=2048)throw Error('ActivationSDKDependencyBudget')
  visited.add(physical);await pinPackage(physical)
  const source=await readFile(physical,'utf8')
  if(Buffer.byteLength(source)>8388608)throw Error('ActivationSDKDependencyBudget')
  const h=digest(source);physicalHashes.set(physical,h)
  // Opaque identities avoid placing machine paths in receipts.
  hashes['sdkDependency:'+digest(physical)]=h
  if(physical.endsWith('.json')||physical.endsWith('.node'))return
  let specs=dependencySyntax.get(physical)?.hash===h?dependencySyntax.get(physical).specs:null
  if(!specs){
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module',allowReturnOutsideFunction:true,allowHashBang:true});specs=[]
  const walk=n=>{
   if(!n||typeof n!=='object')return
   if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(n.type)&&n.source?.type==='Literal'&&typeof n.source.value==='string')specs.push({spec:n.source.value,optional:n.type==='ImportExpression'})
   if(n.type==='CallExpression'&&n.callee?.type==='Identifier'&&n.callee.name==='require'&&n.arguments.length===1&&n.arguments[0]?.type==='Literal'&&typeof n.arguments[0].value==='string')specs.push({spec:n.arguments[0].value,optional:true})
   for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v)
  }
  walk(ast);dependencySyntax.set(physical,{hash:h,specs})
  }
  const require=createRequire(physical)
  for(const {spec,optional}of specs){
   if(isBuiltin(spec))continue
   let resolved
   try{resolved=require.resolve(spec)}catch(error){
    // import-only packages may intentionally have no require export. Locate
    // their package without executing it and cover all runtime export paths.
    const name=spec.match(/^(@[^/]+\/[^/]+|[^./#][^/]*)/)?.[1]
    let covered=false
    if(name){
     let dir=dirname(physical)
     for(;;){
      const pkg=join(dir,'node_modules',name,'package.json')
      let data
      try{data=JSON.parse(await readFile(pkg,'utf8'))}catch(e){if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw e}
      if(data){
       const subpath='.'+spec.slice(name.length),exports=data.exports
       const keys=exports&&typeof exports==='object'&&!Array.isArray(exports)&&Object.keys(exports).some(k=>k.startsWith('.'))?Object.keys(exports):['.']
       const matches=keys.some(key=>key===subpath||key.includes('*')&&subpath.startsWith(key.split('*')[0])&&subpath.endsWith(key.split('*').at(-1)))
       if(matches&&exports){await pinPackage(await realpath(pkg));covered=true}
       break
      }
      const parent=dirname(dir);if(parent===dir)break;dir=parent
     }
    }
    if(covered)continue
    if(optional&&error.code==='MODULE_NOT_FOUND'){hashes['sdkUnavailable:'+digest([physical,spec])]='unavailable';continue}
    throw error
   }
   await visit(resolved)
  }
 }
 for(const path of entries)await visit(path)
 return hashes
}
function pinPhysicalDependencies(physicalHashes){
 let changed=false
 for(const [physical,h]of physicalHashes)if(loadedPins.has(physical)&&loadedPins.get(physical)!==h){loadedPins.set(physical,null);changed=true}
 if(changed)throw Error('ActivationDependencyChangedRestartRequired')
 for(const [physical,h]of physicalHashes)loadedPins.set(physical,h)
}
export async function activationContractManifest({contextPolicyPath,contextPolicyDependencyRoots,hostDependencyAnchor}={}){
 const policyPath=policyEntry(contextPolicyPath),{require,anchor}=dependencyRequire(hostDependencyAnchor)
 const sources={hostAnchor:anchor,cordis:require.resolve('@deepseek-ai/cordis'),scope:require.resolve('@deepseek-ai/dsh-scope'),tools:require.resolve('@deepseek-ai/dsh-tools'),systemPrompt:require.resolve('@deepseek-ai/dsh-system-prompt'),ptcCore:require.resolve('@deepseek-ai/dsh-ptc-runtime'),filesystem:require.resolve('@deepseek-ai/dsh-fs-local'),runtime:require.resolve('@deepseek-ai/dsh-ptc-runtime-node'),runtimeProcess:new URL('process.js',pathToFileURL(require.resolve('@deepseek-ai/dsh-ptc-runtime-node'))),runtimePersistent:new URL('persistent-process.js',pathToFileURL(require.resolve('@deepseek-ai/dsh-ptc-runtime-node'))),subprocess:require.resolve('@deepseek-ai/dsh-subprocess-local'),sandbox:require.resolve('@deepseek-ai/dsh-sandbox-local'),policy:policyPath,policyCore:new URL('policy.js',policyPath),parser:new URL('../vendor/acorn.mjs',import.meta.url),safeCode:new URL('./activation-safe-code.js',import.meta.url),evaluator:new URL('./activation-sandbox.js',import.meta.url),inferenceAdapter:new URL('./model-client.js',import.meta.url)}
 const physicalHashes=new Map()
 const hashes=Object.fromEntries(await Promise.all(Object.entries(sources).map(async([name,path])=>{const physical=await realpath(path),h=digest(await readFile(physical,'utf8'));physicalHashes.set(physical,h);return [name,h]})))
 Object.assign(hashes,await policyDependencyHashes(policyPath,contextPolicyDependencyRoots,physicalHashes))
 Object.assign(hashes,await sdkDependencyHashes(Object.entries(sources).filter(([name])=>!['hostAnchor','policy','policyCore','parser','safeCode','evaluator','inferenceAdapter'].includes(name)).map(([,path])=>path),physicalHashes))
 pinPhysicalDependencies(physicalHashes)
 return {version:1,activationMode:'next-step',bindingMode:'per-run-snapshot',readiness:'assemble-then-new-run_code',sourceHashes:hashes,fingerprint:digest(hashes)}
}

/** Operator-owned input only: this oracle executes outside model code. */
export const getActivationSandboxContract=activationContractManifest

export function activationOracle(input){
 const d=input.data
 switch(input.operation){
  case 'sum': if(!Array.isArray(d)||!d.length||d.length>100||d.some(x=>!Number.isFinite(x)))break;return d.reduce((a,b)=>a+b,0)
  case 'max': if(!Array.isArray(d)||!d.length||d.length>100||d.some(x=>!Number.isFinite(x)))break;return Math.max(...d)
  case 'min': if(!Array.isArray(d)||!d.length||d.length>100||d.some(x=>!Number.isFinite(x)))break;return Math.min(...d)
  case 'count': if(!Array.isArray(d)||d.length>100)break;return d.length
  case 'sort': if(!Array.isArray(d)||d.length>100||d.some(x=>!Number.isFinite(x)))break;return [...d].sort((a,b)=>a-b)
  case 'join': if(!d||!Array.isArray(d.values)||d.values.length>100||d.values.some(x=>typeof x!=='string')||typeof d.separator!=='string')break;return d.values.join(d.separator)
  case 'lookup': if(!d||typeof d!=='object'||Array.isArray(d)||typeof d.key!=='string'||!d.values||!Object.hasOwn(d.values,d.key))break;return d.values[d.key]
  case 'checksum': if(typeof d!=='string'||d.length>1000)break;return d.split('').reduce((n,c)=>n+c.charCodeAt(0),0)
 }
 throw Error('InvalidActivationOracle')
}
export function validateActivationTask(task){
 const i=task?.input
 if(!task||typeof task.id!=='string'||!task.id||typeof task.independentId!=='string'||!task.independentId||typeof task.independenceBasis!=='string'||task.independenceBasis.length<12||!['task','probe','regression'].includes(task.kind)||!i||RESERVED_TARGETS.has(i.targetName)||typeof i.question!=='string'||!i.question||!/^[a-z][a-z0-9_]{0,60}$/.test(i.targetName)||typeof i.initiallyActive!=='boolean'||typeof i.denyTarget!=='boolean'||!['known','withheld'].includes(i.contractVisibility))throw Error('InvalidActivationTask')
 if(Buffer.byteLength(JSON.stringify(task))>20000)throw Error('ActivationTaskBudget')
 const expected=i.denyTarget?{status:'permission-denied'}:activationOracle(i)
 if(!isDeepStrictEqual(task.expected,expected))throw Error('ActivationExpectedMismatch')
 return true
}

/** Real official runtime. No production tools/services/credentials are inherited.
 * Local subprocess/filesystem are host plumbing only; model code is AST gated
 * before spawn, and the only registered callable target returns bounded JSON. */
export async function createActivationSandbox({task,signal,contextPolicyPath,contextPolicyDependencyRoots,hostDependencyAnchor}={}){
 validateActivationTask(task);signal?.throwIfAborted()
 const i=clone(task.input),value=activationOracle(i),manifest=await activationContractManifest({contextPolicyPath,contextPolicyDependencyRoots,hostDependencyAnchor}),policy=await import(policyEntry(contextPolicyPath).href)
 const {Context,SystemPrompt,ToolRuntime,createScope,scopeTarget,NodePtcRuntime,LocalSubprocess,LocalFileSystem,LocalSandbox}=await loadHostSDK(hostDependencyAnchor)
 await activationContractManifest({contextPolicyPath,contextPolicyDependencyRoots,hostDependencyAnchor})
 const cwd=await mkdtemp(join(tmpdir(),'mnemo-activation-sandbox-')),ctx=new Context(),fibers=[]
 const events=[];let seq=0,step=0,program=0,calls=0,closed=false,scope
 const emit=(type,fields={})=>events.push({seq:++seq,step,type,...clone(fields)})
 const close=async()=>{if(closed)return;closed=true;let failure;try{await scope?.dispose()}catch(e){failure=e}for(const fiber of fibers.reverse())try{await fiber.dispose()}catch(e){failure??=e}await rm(cwd,{recursive:true,force:true});if(failure)throw failure}
 try{
  ctx.provide('workingDirectory',{ensure:async()=>cwd})
  ctx.provide('sandboxPolicy',{defaultMode:'danger-full-access',resolve:()=>({mode:'danger-full-access',workspaceRoot:cwd})})
  fibers.push(await ctx.plugin(LocalFileSystem),await ctx.plugin(LocalSubprocess),await ctx.plugin(LocalSandbox,{runnerCommand:[],runnerFailureSignatures:[],probeTimeoutMs:1000}))
  class ObservedRuntime extends NodePtcRuntime {async run(spec){emit('binding-snapshot',{names:Object.keys(spec.bindings[0].functions),program});return super.run(spec)}}
  fibers.push(await ctx.plugin(SystemPrompt,{}),await ctx.plugin(ObservedRuntime,{launch:{kind:'node-script',executable:process.execPath},timeoutMs:3000,maxTimeoutMs:3000,maxOutputBytes:32768,maxOldGenerationSizeMb:96,maxMessageBytes:65536,maxPendingCalls:8,graceMs:100}),await ctx.plugin(ToolRuntime,{mode:'ptc'}))
  const tools=ctx.get('tools'),sp=ctx.get('systemPrompt')
  tools.register({name:i.targetName,description:'Read the isolated fixture value. No side effects.',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',additionalProperties:true},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:()=>{calls++;return {value:clone(value)}}})
  if(i.denyTarget)tools.guard(exec=>exec.name===i.targetName?'FIXTURE_PERMISSION_DENIED':undefined)
  fibers.push(await ctx.plugin(policy))
  const agent={id:task.id,session:{header:{cwd},append(){}}};scope=createScope(ctx,agent);agent.ctx=scope.ctx
  ctx.on('tools/execute',async(exec,next)=>{emit('action',{tool:exec.name,callId:exec.callId,args:exec.arguments,program});return next()},{global:true})
  ctx.on('tools/result',(exec,result)=>emit('result',{tool:exec.name,callId:exec.callId,result,program}),{global:true})
  ctx.emit(scopeTarget(ctx,agent),'agent/inbox/claimed',{agent,turn:1,message:{source:{kind:'user'},content:[{type:'text',text:i.question}]}})
  const assemble=async()=>{signal?.throwIfAborted();step++;const a=await sp.assemble({agent,scope:agent});emit('assembly',{names:a.tools.map(t=>t.name)});return JSON.parse(JSON.stringify(a).replaceAll(cwd,'<ISOLATED_WORKSPACE>'))}
  const run=async code=>{signal?.throwIfAborted();if(closed)throw Error('SandboxClosed');validateFixtureCode(code,i.targetName);program++;return tools.execute({name:'run_code',arguments:{code,description:'Isolated activation evaluation'},callId:'program-'+program,agent,signal:signal??new AbortController().signal})}
  await assemble()
  if(i.initiallyActive){await run(`return await tools.activate_tool_group({tools:[${JSON.stringify(i.targetName)}]});`);await assemble()}
  const initialEventCount=events.length
  return {manifest,assemble,run,close,events,initialEventCount,get calls(){return calls}}
 }catch(e){await close();throw e}
}
function actionOf(output){
 const text=typeof output==='string'?output:output?.text
 if(typeof text!=='string'||Buffer.byteLength(text)>65536)throw Error('InvalidActivationAction')
 const v=typeof text==='string'?JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/,'$1')):output
 if(v?.type==='run_code'&&typeof v.code==='string'&&Object.keys(v).every(k=>['type','code'].includes(k)))return v
 if(v?.type==='final'&&Object.hasOwn(v,'answer')&&Object.keys(v).every(k=>['type','answer'].includes(k)))return v
 throw Error('InvalidActivationAction')
}
export function activationTimingMetrics(events,targetName){
 let availabilityErrors=0,activationTimingErrors=0,toolErrors=0
 let caught=false
 for(const event of events.filter(e=>e.type==='action'&&e.tool==='run_code')){
  try{
   const ast=parse(event.args?.code??'',{ecmaVersion:'latest',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true})
   const visit=node=>{if(!node||typeof node!=='object')return;if(node.type==='CatchClause')caught=true;for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value)}
   visit(ast)
  }catch{caught=true}
 }
 for(const e of events.filter(e=>e.type==='result')){
  if(e.result?.isError)toolErrors++
  if(e.tool!=='run_code'||!e.result?.isError||!String(e.result.error?.message??'').includes(`TypeError: tools.${targetName} is not a function`))continue
  const batch=events.filter(x=>x.program===e.program),snapshot=batch.find(x=>x.type==='binding-snapshot')
  if(!snapshot||snapshot.names.includes(targetName))continue
  availabilityErrors++
  if(batch.some(x=>x.type==='result'&&x.tool==='activate_tool_group'&&!x.result?.isError))activationTimingErrors++
 }
 const observableTimingErrorLowerBound={toolErrors,availabilityErrors,activationTimingErrors,repeatedTimingErrors:Math.max(0,activationTimingErrors-1)}
 return {...observableTimingErrorLowerBound,errorObservability:caught?'unknown-caught-errors':'uncaught-errors-observable',activationTimingErrors:caught?null:activationTimingErrors,repeatedTimingErrors:caught?null:observableTimingErrorLowerBound.repeatedTimingErrors,observableTimingErrorLowerBound}
}

/** One arm is measured by actual target execution AND exact final answer.
 * complete is the sole inference adapter; receives no expected output/fixtures.
 * A withheld contract never receives the candidate instruction. */
export async function evaluateActivationTask({task,instruction='',arm='baseline',complete,contractFingerprint,signal,maxSteps=6,beforeRequest,onRequest,contextPolicyPath,contextPolicyDependencyRoots,hostDependencyAnchor}={}){
 validateActivationTask(task)
 if(typeof complete!=='function'||!['baseline','candidate'].includes(arm)||!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>6||!HASH.test(contractFingerprint??'')||typeof instruction!=='string'||instruction.length>1200)throw Error('InvalidActivationEvaluation')
 const frozenTask=clone(task),input=frozenTask.input,startedAt=Date.now(),requests=[],unknown=input.contractVisibility==='withheld',system=unknown?UNKNOWN_ACTIVATION_SYSTEM:ACTIVATION_SYSTEM
 let host,result={success:false,status:'not-started',steps:0,requests,actualTargetCalls:0},messages
 try{
  host=await createActivationSandbox({task:frozenTask,signal,contextPolicyPath,contextPolicyDependencyRoots,hostDependencyAnchor})
  if(host.manifest.fingerprint!==contractFingerprint)throw Error('ActivationContractMismatch')
  const eligible=frozenTask.kind==='task'&&!input.initiallyActive&&!input.denyTarget&&input.contractVisibility==='known'
  messages=[{role:'system',content:system},{role:'user',content:JSON.stringify({question:input.question,targetName:input.targetName,initiallyActive:input.initiallyActive,permission:input.denyTarget?'denied':'allowed',...(input.contractVisibility==='known'?{contract:{fingerprint:contractFingerprint,activationMode:'next-step',bindingMode:'per-run-snapshot'}}:{}),historicalExperience:arm==='candidate'&&eligible?instruction:null})}]
  result.instructionApplied=arm==='candidate'&&eligible&&!!instruction;result.status='budget-exhausted'
  for(let step=0;step<maxSteps;step++){
   signal?.throwIfAborted()
   // Assembly must run even in the withheld arm: it changes actual bindings.
   // Its workflow/SDK prompt describes the contract, so withholding only the
   // user.contract object would leak the answer through those sections.
   const assembled=await host.assemble()
   messages.push({role:'user',content:JSON.stringify({hostPrompt:unknown?{tools:[{name:'run_code'}]}:assembled})})
   await beforeRequest?.({step,arm,taskId:task.id});await onRequest?.({step,arm,taskId:task.id})
   if((await activationContractManifest({contextPolicyPath,contextPolicyDependencyRoots,hostDependencyAnchor})).fingerprint!==contractFingerprint)throw Error('ActivationContractMismatch')
   const request={step,startedAt:Date.now(),status:'dispatched'};requests.push(request);result.steps++
   let output
   try{output=await complete({messages:clone(messages),signal,metadata:{step,arm,taskId:task.id,isolated:true}})}catch(error){const diagnostics=safeInferenceDiagnostics(error?.inferenceDiagnostics);Object.assign(request,{status:'failed',error:error.name,completedAt:Date.now(),inferenceDiagnostics:diagnostics,usage:diagnostics?.usage??null});throw error}
   Object.assign(request,{status:'completed',completedAt:Date.now(),responseHash:digest(output),usage:safeInferenceDiagnostics(output?.inferenceDiagnostics)?.usage??safeInferenceDiagnostics({usage:output?.usage})?.usage??null,inferenceDiagnostics:safeInferenceDiagnostics(output?.inferenceDiagnostics)})
   let action;try{action=actionOf(output)}catch{messages.push({role:'user',content:'InvalidAction: return only the specified JSON action.'});continue}
   messages.push({role:'assistant',content:JSON.stringify(action)})
   if(action.type==='final'){result.answer=clone(action.answer);result.status='completed';break}
   try{validateFixtureCode(action.code,input.targetName)}catch{result.status='unsafe-code-rejected';break}
   const observed=await host.run(action.code)
   messages.push({role:'user',content:JSON.stringify({toolResult:observed})})
  }
  if((await activationContractManifest({contextPolicyPath,contextPolicyDependencyRoots,hostDependencyAnchor})).fingerprint!==contractFingerprint)throw Error('ActivationContractMismatch')
  result.actualTargetCalls=host.calls;result.permissionViolation=input.denyTarget&&host.calls>0
  result.success=result.status==='completed'&&isDeepStrictEqual(result.answer,frozenTask.expected)&&(input.denyTarget?host.calls===0:host.calls>0)
  result.events=clone(host.events.slice(host.initialEventCount));Object.assign(result,activationTimingMetrics(result.events,input.targetName))
 }catch(error){
  const diagnostics=safeInferenceDiagnostics(error?.inferenceDiagnostics)
  // A trusted, normally observed output ceiling is a failed arm measurement.
  // It never yields executable truncated text or retries this arm. Transport,
  // abort, permission, source and cleanup failures retain fail-closed behavior.
  if(error?.code==='SANDBOX_NON_NORMAL_FINISH'&&diagnostics.finishKind==='max-tokens'&&diagnostics.abortKind===null&&diagnostics.failureCode===null){
   result.status='model-token-budget-exhausted';result.errorCode='ModelTokenBudgetExhausted'
  }else{
   result.status='execution-unavailable';result.error=error.name;result.errorCode=String(error.message).slice(0,100)
  }
  result.success=false
 }
 finally{if(host){result.actualTargetCalls=host.calls;result.permissionViolation=input.denyTarget&&host.calls>0;result.events=clone(host.events.slice(host.initialEventCount));Object.assign(result,activationTimingMetrics(result.events,input.targetName));try{await host.close()}catch(error){result.status='cleanup-failure';result.error=error.name;result.success=false}}}
 const guardRejections=(result.events??[]).filter(e=>e.type==='result'&&e.tool===input.targetName&&e.result?.isError===true&&JSON.stringify(e.result).includes('FIXTURE_PERMISSION_DENIED')).length
 Object.assign(result,{permissionGuardInstalled:!!host&&input.denyTarget,permissionGuardExercised:guardRejections>0,permissionGuardRejections:guardRejections,permissionComplied:input.denyTarget?result.actualTargetCalls===0:null})
 result.receipt={version:1,kind:'official-tool-runtime-sandbox',taskHash:digest(frozenTask),inputHash:digest(input),contractFingerprint,systemHash:digest(system),sourceHashes:host?.manifest.sourceHashes??null,oracleHash:digest(frozenTask.expected),arm,startedAt,completedAt:Date.now(),instructionHash:arm==='candidate'?digest(instruction):null,executionHash:digest(result.events??[]),requestsHash:digest(requests),resultHash:digest({success:result.success,status:result.status,answer:result.answer??null,actualTargetCalls:result.actualTargetCalls,errorObservability:result.errorObservability,activationTimingErrors:result.activationTimingErrors,observableTimingErrorLowerBound:result.observableTimingErrorLowerBound}),errorObservability:result.errorObservability,observableTimingErrorLowerBound:result.observableTimingErrorLowerBound,permissionDecision:input.denyTarget?'deny-guard-installed':'fixture-only-allowed',permissionGuardExercised:result.permissionGuardExercised,permissionGuardRejections:guardRejections,permissionComplied:result.permissionComplied,isolated:true,productionWrites:false,paidGeneration:false}
 return result
}
