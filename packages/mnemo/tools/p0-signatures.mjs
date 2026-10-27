// P0: read-only aggregate of error signatures across archived sessions. Prints only
// normalized skeletons and counts, never raw tool output.
import {execFileSync} from 'node:child_process'
import {readdirSync,statSync} from 'node:fs'
import {join} from 'node:path'
import {scanFailures} from '../lib/lessons-signature.js'
import {scrubEvidenceText} from '../lib/lessons-evidence.js'
const root=process.argv[2]
const files=[]
const walk=d=>{for(const n of readdirSync(d)){const p=join(d,n),s=statSync(p);s.isDirectory()?walk(p):n==='session.v4.jsonl.zstd'&&files.push(p)}}
walk(root)
const agg=new Map();let turns=0,failTurns=0,fixTurns=0,sessions=0
for(const f of files){
 let raw;try{raw=execFileSync('zstd',['-dc',f],{maxBuffer:1<<28,stdio:['ignore','pipe','pipe']}).toString()}catch{continue}
 sessions++
 // Normalize only after complete credentials have been removed from decoded event fields.
 const events=raw.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(scrubEvidenceText(l))}catch{return null}}).filter(Boolean)
 const byTurn=new Map()
 for(const e of events){const t=e.data?.turn;if(t==null)continue;(byTurn.get(t)??byTurn.set(t,[]).get(t)).push(e)}
 for(const evs of byTurn.values()){
  turns++
  const {failures,successAfter}=scanFailures(evs)
  if(!failures.length)continue
  failTurns++;if(successAfter)fixTurns++
  for(const x of failures){const a=agg.get(x.signature)??{n:0,sessions:new Set(),tool:x.tool,cls:x.errorClass,norm:x.normalized};a.n++;a.sessions.add(f);agg.set(x.signature,a)}
 }
}
const top=[...agg.entries()].sort((a,b)=>b[1].n-a[1].n)
console.log(JSON.stringify({sessions,turns,failTurns,fixTurns,distinctSignatures:agg.size,repeatedSignatures:top.filter(([,a])=>a.n>=2).length}))
for(const [sig,a] of top.slice(0,25))console.log(a.n,a.sessions.size,a.tool,a.cls,a.norm)
