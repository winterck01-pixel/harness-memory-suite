// P0: for the most repeated error signatures, print redacted failure -> recovery excerpts.
import {execFileSync} from 'node:child_process'
import {readdirSync,statSync} from 'node:fs'
import {join} from 'node:path'
import {failureFromEvent,callHint} from '../lib/lessons-signature.js'
import {scrubEvidenceText} from '../lib/lessons-evidence.js'
const clip=(s,n)=>scrubEvidenceText(typeof s==='string'?s:JSON.stringify(s??'')).replace(/\s+/g,' ').slice(0,n)
const files=[];const walk=d=>{for(const n of readdirSync(d)){const p=join(d,n),s=statSync(p);s.isDirectory()?walk(p):n==='session.v4.jsonl.zstd'&&files.push(p)}};walk(process.argv[2])
const agg=new Map()
for(const f of files){
 let raw;try{raw=execFileSync('zstd',['-dc',f],{maxBuffer:1<<28,stdio:['ignore','pipe','pipe']}).toString()}catch{continue}
 // Scrub complete events before normalization or snippet truncation can lose secret boundaries.
 const ev=raw.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(scrubEvidenceText(l))}catch{return null}}).filter(Boolean)
 const calls=new Map(),ordered=[]
 for(const e of ev){if(e.type==='tool/call')calls.set(e.data.callId,e)}
 for(let i=0;i<ev.length;i++){
  const e=ev[i];if(e.type!=='tool/result')continue
  const id=e.data?.message?.toolCallId,c=calls.get(id);const info=c?{name:c.data.name,hint:callHint(c.data.name,c.data.arguments)}:null
  const fail=failureFromEvent(e,()=>info)
  if(!fail)continue
  let next=null
  for(let j=i+1;j<ev.length&&!next;j++){const r=ev[j];if(r.type==='tool/result'&&!failureFromEvent(r,()=>null)){const cid=r.data?.message?.toolCallId,cc=calls.get(cid);if(cc)next={tool:cc.data.name,args:clip(cc.data.arguments,200)}}}
  const a=agg.get(fail.signature)??{n:0,sessions:new Set(),ex:[],norm:fail.normalized,tool:fail.tool};a.n++;a.sessions.add(f)
  if(a.ex.length<2)a.ex.push({args:clip(c?.data?.arguments,200),err:clip(fail.snippet,220),fix:next});agg.set(fail.signature,a)
 }
}
const top=[...agg.entries()].filter(([,a])=>a.n>=3&&a.sessions.size>=2).sort((x,y)=>y[1].n-x[1].n).slice(0,14)
for(const [sig,a] of top){console.log(`\n## ${sig} n=${a.n} sessions=${a.sessions.size} tool=${a.tool}\nnorm: ${a.norm}`);for(const x of a.ex)console.log(` fail-args: ${x.args}\n err: ${x.err}\n next-ok: ${x.fix?x.fix.tool+' '+x.fix.args:'-'}`)}
