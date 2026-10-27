// Import only explicitly approved seed lessons into the live ledger. Safe to re-run (idempotent by id).
// Usage: node import-seeds.mjs <seed.json> [lessonsDir]
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'
import {LessonStore} from './lib/lessons.js'
import {errorClass} from './lib/lessons-signature.js'
const [,,seedPath,dirArg]=process.argv
const seed=JSON.parse(readFileSync(seedPath,'utf8'))
const store=new LessonStore({directory:dirArg??join(homedir(),'.dsh/mnemo/lessons')})
const now=Date.now(),existing=new Set(store.list().map(l=>l.id)),fresh=[]
for(const s of seed.lessons){
 if(s.approved!==true||existing.has(s.id))continue
 fresh.push({id:s.id,scopeHash:null,projects:[],type:s.type,signature:s.signature,errorClass:errorClass(s.trigger+' '+s.advice),trigger:s.trigger,advice:s.advice,scope:'tool',tool:s.tool,confidence:s.confidence,state:'active',stateAt:now,stateBy:'seed-import',seed:true,
  stats:{support:s.support??1,injected:0,recurAfterInject:0,lastRecurAt:null},createdAt:now,lastSeen:now,lastInjectedAt:null,sourceRefs:[{seed:true,approved:true,importedAt:now}]})
}
// Written under the ledger lock against a fresh read, so a running engine's data is never replaced.
const total=store.update(state=>{for(const l of fresh)if(!state.lessons[l.id])state.lessons[l.id]=l;return Object.keys(state.lessons).length})
console.log(JSON.stringify({added:fresh.length,total}))
