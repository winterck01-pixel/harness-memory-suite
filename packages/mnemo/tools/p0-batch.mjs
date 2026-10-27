// Cold start: propose lessons from archived sessions with a model you supply. Writes proposals
// for human review only; nothing touches the live ledger. Approve entries (set "approved": true),
// then import with: node import-seeds.mjs proposals.json
// Usage: node tools/p0-batch.mjs --sessions ~/.dsh/sessions --adapter ./adapter.mjs --out proposals.json [--limit 30] [--max-calls 30]
import {execFileSync} from 'node:child_process'
import {readdirSync,statSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {scanFailures} from '../lib/lessons-signature.js'
import {buildEvidence,validLesson,EXTRACTOR_SYSTEM} from '../lib/lessons.js'
import {scrubEvidenceText} from '../lib/lessons-evidence.js'
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:d}
const budget=(name,fallback)=>{const value=Number(arg(name,fallback));if(!Number.isSafeInteger(value)||value<=0){console.error('--'+name+' must be a positive safe integer');process.exit(1)}return value}
// Reject invalid budgets before adapter import, which may itself have side effects.
const limit=budget('limit',30),maxCalls=budget('max-calls',limit)
const adapter=await import(pathToFileURL(resolve(arg('adapter'))).href)
const files=[];const walk=d=>{for(const n of readdirSync(d)){const p=join(d,n),s=statSync(p);s.isDirectory()?walk(p):n==='session.v4.jsonl.zstd'&&files.push(p)}};walk(resolve(arg('sessions')))
const packs=[]
for(const f of files){
 let raw;try{raw=execFileSync('zstd',['-dc',f],{maxBuffer:1<<28,stdio:['ignore','pipe','pipe']}).toString()}catch{continue}
 const ev=raw.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean),byTurn=new Map()
 for(const e of ev){const t=e.data?.turn;if(t!=null)(byTurn.get(t)??byTurn.set(t,[]).get(t)).push(e)}
 for(const [turn,evs] of byTurn){const r=scanFailures(evs);if(r.failures.length&&r.successAfter)packs.push({file:f,turn,pack:buildEvidence(evs)})}
}
// Most-repeated signatures first so the model budget goes where recurrence is highest.
const freq=new Map();for(const p of packs)for(const f of p.pack.failures)freq.set(f.signature,(freq.get(f.signature)??0)+1)
packs.sort((a,b)=>Math.max(...b.pack.failures.map(f=>freq.get(f.signature)))-Math.max(...a.pack.failures.map(f=>freq.get(f.signature))))
const proposals=[],seen=new Set();let calls=0
for(const {pack,file,turn} of packs){
 if(proposals.length>=limit||calls>=maxCalls)break
 const sig=pack.failures[0].signature;if(seen.has(sig))continue;seen.add(sig)
 try{
  calls++ // Every dispatch consumes budget, including errors and empty proposals; no retries.
  const r=await adapter.complete([{role:'system',content:EXTRACTOR_SYSTEM},{role:'user',content:JSON.stringify(pack)}],{purpose:'p0-batch'}),text=typeof r==='string'?r:r?.text
  const out=JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0]??'{}'),fb={signatures:pack.failures.map(f=>f.signature),classes:new Map(pack.failures.map(f=>[f.signature,f.errorClass]))}
  for(const raw of out.lessons??[]){if(proposals.length>=limit)break;const l=validLesson(raw,fb);if(l)proposals.push({id:'p0-'+sig.slice(0,12)+'-'+proposals.length,approved:false,signature:l.signature,type:l.type,tool:l.tool??pack.failures[0].tool,confidence:l.confidence,support:freq.get(sig),trigger:l.trigger,advice:l.advice,source:{file:file.split('/').slice(-2).join('/'),turn}})}
 }catch(e){console.error('skip',sig,scrubEvidenceText(e?.message??e).slice(0,80))}
}
writeFileSync(resolve(arg('out','proposals.json')),JSON.stringify({note:'P0 proposals; review each, set approved:true, then import',lessons:proposals},null,1)+'\n')
console.log(JSON.stringify({candidateTurns:packs.length,distinctSignatures:freq.size,proposals:proposals.length,calls,maxCalls}))
