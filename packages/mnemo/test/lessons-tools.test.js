import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {LessonStore} from '../lib/lessons.js'
const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const node=(args,opts={})=>execFileSync(process.execPath,args,{cwd:root,encoding:'utf8',...opts})
function ledger(){
 const dir=mkdtempSync(join(tmpdir(),'lessons-tools-')),store=new LessonStore({directory:dir})
 const base={type:'pitfall',scope:'project',tool:null,confidence:'med',errorClass:null}
 store.upsert({...base,signature:'s1',trigger:'alpha trigger words one',advice:'advice number one text'},{scopeHash:'P',sourceRef:{}})
 store.upsert({...base,signature:'s2',trigger:'beta trigger words two',advice:'advice number two text'},{scopeHash:'P',sourceRef:{}})
 const units=(n,r)=>Object.fromEntries(Array.from({length:n},(_,i)=>['u'+i,{e:1,r:i<r?1:0}]))
 store.state.metrics={injected:{exposures:40,recurs:4},holdout:{exposures:40,recurs:20},sessions:{injected:units(40,4),holdout:units(40,20)}};store.save();return {dir,store}
}

test('report is per independent session and only compares with enough sessions',()=>{
 const {dir}=ledger()
 try{const out=node(['tools/report.mjs',dir]);assert.match(out,/lessons 2/);assert.match(out,/independent sessions/);assert.match(out,/Fisher exact p/);assert.ok(!/z = /.test(out));assert.match(out,/not task-matched/)}
 finally{rmSync(dir,{recursive:true,force:true})}
})

test('audit sample then apply retires ticked lessons only',()=>{
 const {dir,store}=ledger(),out=join(dir,'audit.md')
 try{
  node(['tools/audit-sample.mjs','sample','--n','5','--out',out,'--dir',dir])
  const md=readFileSync(out,'utf8'),id=store.list()[0].id;assert.match(md,/retire /)
  writeFileSync(out,md.replace(`- [ ] retire ${id}`,`- [x] retire ${id}`))
  node(['tools/audit-sample.mjs','apply',out,'--dir',dir])
  const after=new LessonStore({directory:dir});assert.equal(after.state.lessons[id].state,'retired');assert.equal(after.list().filter(l=>l.state==='active').length,1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('import-seeds skips unapproved proposals and is idempotent',()=>{
 const dir=mkdtempSync(join(tmpdir(),'lessons-seed-')),seed=join(dir,'p.json')
 try{
  writeFileSync(seed,JSON.stringify({lessons:[{id:'a',approved:true,signature:'x',type:'fix',tool:'edit',confidence:'high',trigger:'t one two',advice:'adv one two'},{id:'b',approved:false,signature:'y',type:'fix',tool:'edit',confidence:'low',trigger:'t',advice:'a'},{id:'missing',signature:'z',type:'fix',tool:'edit',confidence:'low',trigger:'t',advice:'a'},{id:'string',approved:'true',signature:'w',type:'fix',tool:'edit',confidence:'low',trigger:'t',advice:'a'},{id:'null',approved:null,signature:'v',type:'fix',tool:'edit',confidence:'low',trigger:'t',advice:'a'}]}))
  const run=()=>JSON.parse(node(['import-seeds.mjs',seed,join(dir,'ledger')]))
  assert.equal(run().added,1);assert.equal(run().added,0)
  const imported=new LessonStore({directory:join(dir,'ledger')}).list()
  assert.deepEqual(imported.map(l=>l.id),['a'])
  assert.equal(imported[0].sourceRefs[0].approved,true)
  assert.ok(Number.isSafeInteger(imported[0].sourceRefs[0].importedAt))
  assert.equal(Object.hasOwn(imported[0].sourceRefs[0],'reviewed'),false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('report stays descriptive below 30 sessions per group',()=>{
 const {dir,store}=ledger()
 try{store.state.metrics.sessions={injected:{a:{e:1,r:0}},holdout:{b:{e:1,r:1}}};store.save();const out=node(['tools/report.mjs',dir]);assert.match(out,/descriptive only/);assert.ok(!/Fisher/.test(out))}
 finally{rmSync(dir,{recursive:true,force:true})}
})

test('audit approve promotes a candidate; apply is atomic under the lock and never touches seeds',()=>{
 const {dir,store}=ledger(),out=join(dir,'audit.md')
 try{
  const cand=store.upsert({type:'fix',signature:'sc',trigger:'cand trigger words here',advice:'cand advice text number',scope:'project',tool:null,confidence:'low',errorClass:null},{scopeHash:'P',sourceRef:{}});cand.state='candidate';cand.review={needsHuman:true,reason:'risky-advice'};store.save()
  node(['tools/audit-sample.mjs','sample','--out',out,'--dir',dir]);const md=readFileSync(out,'utf8')
  assert.match(md,new RegExp('需人工审核的候选\\(1 条'));writeFileSync(out,md.replace(`- [ ] approve ${cand.id}`,`- [x] approve ${cand.id}`))
  node(['tools/audit-sample.mjs','apply',out,'--dir',dir])
  const after=new LessonStore({directory:dir});assert.equal(after.state.lessons[cand.id].state,'active');assert.equal(after.state.lessons[cand.id].promotedBy,'human');assert.ok(after.state.lessons[cand.id].stateAt>0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
