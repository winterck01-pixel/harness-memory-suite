// Usage: node tools/report.mjs [lessonsDir]   Read-only health and effect report.
// Effect is reported per independent unit (session), not per exposure: several lessons and
// repeated failures inside one session are correlated, so exposure counts are context only.
import {readFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'
const dir=process.argv[2]??join(homedir(),'.dsh/mnemo/lessons'),p=join(dir,'lessons.json')
if(!existsSync(p)){console.log('no ledger yet');process.exit(0)}
const d=JSON.parse(readFileSync(p,'utf8')),ls=Object.values(d.lessons??{})
const count=k=>ls.reduce((m,l)=>(m[k(l)]=(m[k(l)]??0)+1,m),{})
console.log('lessons',ls.length,'by state',count(l=>l.state),'by type',count(l=>l.type),'seed',ls.filter(l=>l.seed).length,'queue',d.queue?.length??0,'calls today',d.calls)
console.log('candidates needing a human:',ls.filter(l=>l.state==='candidate'&&l.review?.needsHuman).length)
console.log('top by support:');for(const l of [...ls].sort((a,b)=>b.stats.support-a.stats.support).slice(0,8))console.log(' ',l.stats.support,l.stats.injected,l.stats.recurAfterInject,l.state,l.trigger.slice(0,60))
const m=d.metrics??{},units=g=>{const v=Object.values(m.sessions?.[g]??{}),n=v.filter(u=>u.e).length,r=v.filter(u=>u.e&&u.r).length;return {sessions:n,withRecurrence:r,rate:n?r/n:null}}
const a=units('injected'),b=units('holdout')
console.log('exposures (context only)  injected:',m.injected,' holdout:',m.holdout)
console.log('independent sessions      injected:',a,' holdout:',b)
// Exact two-sided Fisher test on the 2x2 session table; shown only when it is meaningful.
function fisher(a1,n1,a2,n2){
 const lc=(n,k)=>{let s=0;for(let i=1;i<=k;i++)s+=Math.log((n-k+i)/i);return s}
 const K=a1+a2,N=n1+n2,pr=x=>Math.exp(lc(n1,x)+lc(n2,K-x)-lc(N,K))
 const obs=pr(a1);let p=0;for(let x=Math.max(0,K-n2);x<=Math.min(K,n1);x++){const q=pr(x);if(q<=obs+1e-12)p+=q}
 return Math.min(1,p)
}
if(a.sessions>=30&&b.sessions>=30)console.log('Fisher exact p (session-level recurrence, injected vs holdout):',fisher(a.withRecurrence,a.sessions,b.withRecurrence,b.sessions).toFixed(4),'— still observational; groups are session-hash assigned, not task-matched')
else console.log('descriptive only: need >=30 independent sessions in each group before any comparison (have',a.sessions,'/',b.sessions,')')
const lp=join(dir,'injections.jsonl')
if(existsSync(lp)){
 const rows=readFileSync(lp,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)),byDay={}
 for(const r of rows){const k=new Date(r.t).toISOString().slice(0,10)+' '+r.kind+(r.holdout?' holdout':'');byDay[k]=(byDay[k]??0)+1}
 console.log('injection log',rows.length,'rows');console.log(byDay)
}
