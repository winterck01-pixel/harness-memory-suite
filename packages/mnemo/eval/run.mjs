// Usage: node eval/run.mjs --adapter ./adapter.mjs --library lessons.json [--split test] [--repeats 3]
//        [--scope <ledger-scope-value>] [--seed <integer>] [--config config.json] [--inject-opening true|false] [--out result.json]
// The adapter exports `async complete(messages, meta)` returning a string or {text, usage}; it holds
// any model credentials, which this tool never reads. The saved result keeps per-run rows, the
// library version and the settings; it contains task ids and tool errors only, no credentials.
import {readFileSync,writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import {TASKS} from './fixtures.js'
import {runExperiment,EVAL_SCOPE} from './lessons-eval.js'
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:d}
const raw=JSON.parse(readFileSync(resolve(arg('library')),'utf8')),library=Array.isArray(raw)?raw:Object.values(raw.lessons??{})
const requestedScope=arg('scope'),hasScope=process.argv.includes('--scope')
if(hasScope&&(typeof requestedScope!=='string'||!requestedScope.trim()||requestedScope.startsWith('--')))throw Error('--scope requires a non-empty scope value from the library')
// Do not silently run production project lessons under the fixture scope, and do not
// guess which project a multi-project ledger is meant to evaluate. Validate before
// loading the adapter so this error cannot initiate a model call or adapter side effect.
const projectBound=library.some(l=>typeof l.scopeHash==='string'&&l.scopeHash&&l.scopeHash!==EVAL_SCOPE&&(l.scope!=='tool'||!(l.seed===true||(l.projects?.length??0)>=2)))
if(!hasScope&&projectBound)throw Error('This library contains project-bound lessons; pass --scope with the intended ledger scope value')
const scope=hasScope?requestedScope:EVAL_SCOPE
const configured=arg('config')?JSON.parse(readFileSync(resolve(arg('config')),'utf8')):{}
const config={...configured,...(arg('inject-opening')!==undefined?{injectOpening:arg('inject-opening')==='true'}:{})}
const adapter=await import(pathToFileURL(resolve(arg('adapter'))).href)
const result=await runExperiment({tasks:TASKS,complete:adapter.complete,library,scope,repeats:Number(arg('repeats',3)),split:arg('split','test'),seed:Number(arg('seed',1)),config})
const {rows,...report}=result
console.log(JSON.stringify(report,null,2))
if(arg('out'))writeFileSync(resolve(arg('out')),JSON.stringify(result,null,1)+'\n')
