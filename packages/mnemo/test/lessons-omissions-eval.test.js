import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {TASKS} from '../eval/fixtures.js'
import {evalLesson,runExperiment,runTask,EVAL_SCOPE} from '../eval/lessons-eval.js'
import {signatureOf} from '../lib/lessons-signature.js'

const task=TASKS.find(t=>t.id==='edit-env')
const scope='project:/synthetic-private/project-a',other='project:/synthetic-private/project-b'
const signature=signatureOf('edit','Error: cannot modify "/p": file has not been read — read the file, then retry')
const lesson=(id,project=scope,extra={})=>evalLesson({...signature,id,scope:'project',scopeHash:project,seed:false,trigger:'edit file has not been read',advice:id+' read before edit',...extra},project)
const stop=JSON.stringify({final:'stop'})
const edit=JSON.stringify({tool:'edit',args:{path:'/proj/.env.sample',old:'MODE=dev',new:'MODE=prod'}})
const complete=async(_messages,meta)=>meta.step===0?edit:stop
const cli=fileURLToPath(new URL('../eval/run.mjs',import.meta.url))

function fixture(t,library){
 const dir=mkdtempSync(join(tmpdir(),'lessons-eval-scope-'))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const paths=Object.fromEntries(['library.json','adapter.mjs','requests.jsonl','result.json','no-network.cjs'].map(n=>[n,join(dir,n)]))
 writeFileSync(paths['library.json'],JSON.stringify({version:1,lessons:Object.fromEntries(library.map(l=>[l.id,l]))}))
 writeFileSync(paths['no-network.cjs'],`const fail=()=>{throw Error('network forbidden in scope test')};global.fetch=fail;for(const n of ['http','https']){const m=require('node:'+n);m.request=fail;m.get=fail}const n=require('node:net');n.connect=fail;n.createConnection=fail;n.Socket.prototype.connect=fail;require('node:tls').connect=fail;require('node:module').syncBuiltinESMExports();`)
 writeFileSync(paths['adapter.mjs'],`import {appendFileSync} from 'node:fs';export async function complete(messages,meta){appendFileSync(${JSON.stringify(paths['requests.jsonl'])},JSON.stringify({task:meta.task,condition:meta.condition,step:meta.step,a:messages[0].content.includes('SCOPE_A'),b:messages[0].content.includes('SCOPE_B')})+'\\n');return meta.task==='edit-env'&&meta.step===0?${JSON.stringify(edit)}:${JSON.stringify(stop)}}`)
 const run=(args=[])=>spawnSync(process.execPath,['--require',paths['no-network.cjs'],cli,'--adapter',paths['adapter.mjs'],'--library',paths['library.json'],'--split','test','--repeats','1','--out',paths['result.json'],...args],{encoding:'utf8',timeout:10000})
 return {paths,run}
}

test('omissions: CLI scope reaches actual injection while preserving project isolation and library bytes',t=>{
 const f=fixture(t,[lesson('SCOPE_A'),lesson('SCOPE_B',other)]),before=readFileSync(f.paths['library.json'],'utf8')
 const child=f.run(['--scope',scope]);assert.equal(child.status,0,child.stderr)
 const requests=readFileSync(f.paths['requests.jsonl'],'utf8').trim().split('\n').map(JSON.parse)
 const targeted=requests.find(r=>r.task==='edit-env'&&r.condition==='lessons'&&r.step===1)
 assert.equal(targeted.a,true,'the selected project lesson must reach the model')
 assert.equal(requests.some(r=>r.b),false,'other project advice must remain excluded')
 const result=JSON.parse(readFileSync(f.paths['result.json'],'utf8'))
 assert.equal(result.meta.eligibleLessons,1)
 assert.ok(result.meta.scopeVersion)
 assert.equal(result.rows.find(r=>r.task==='edit-env'&&r.condition==='lessons').injectedLessons,1)
 assert.equal(result.summary.lessons.runsWithLessonInjection,1)
 assert.equal(JSON.stringify(result.meta).includes('/synthetic-private/'),false)
 assert.equal(child.stdout.includes('/synthetic-private/'),false)
 assert.equal(readFileSync(f.paths['library.json'],'utf8'),before)
})

test('omissions: project-bound CLI libraries require explicit scope before adapter/model execution',t=>{
 for(const library of [[lesson('SCOPE_A')],[lesson('SCOPE_A'),lesson('SCOPE_B',other)],[lesson('SCOPE_A',scope,{scope:'tool',tool:'edit',projects:[scope]})]]){
  const f=fixture(t,library),child=f.run()
  assert.notEqual(child.status,0)
  assert.match(child.stderr,/--scope/)
  assert.equal(child.stderr.includes('/synthetic-private/'),false)
  assert.equal(existsSync(f.paths['requests.jsonl']),false)
 }
})

test('omissions: empty CLI scope is rejected, while unbound fixtures retain the default',t=>{
 const raw=lesson('SCOPE_A');delete raw.scopeHash
 const f=fixture(t,[raw]),empty=f.run(['--scope',''])
 assert.notEqual(empty.status,0);assert.match(empty.stderr,/--scope/)
 const child=f.run();assert.equal(child.status,0,child.stderr)
 const result=JSON.parse(readFileSync(f.paths['result.json'],'utf8'))
 assert.equal(result.meta.scope,EVAL_SCOPE);assert.equal(result.meta.eligibleLessons,1)
 assert.equal(result.rows.find(r=>r.task==='edit-env'&&r.condition==='lessons').injectedLessons,1)
})

test('omissions: eligibility includes only active live scoped lessons and reports zero actual exposure',async()=>{
 const now=1770000000000,library=[lesson('SCOPE_A',scope,{lastSeen:now}),lesson('SCOPE_B',other,{lastSeen:now}),lesson('RETIRED',scope,{state:'retired',lastSeen:now}),lesson('EXPIRED',scope,{lastSeen:now-100*86400000})]
 const before=structuredClone(library)
 const result=await runExperiment({tasks:[task],complete,library,scope,repeats:1,evaluationAt:now,config:{injectOnError:false}})
 assert.equal(result.meta.eligibleLessons,1,'scope/state/expiry eligibility is independent of the injection switch')
 assert.equal(result.summary.lessons.lessonInjections,0)
 assert.equal(result.summary.lessons.runsWithLessonInjection,0)
 assert.ok(result.rows.every(r=>r.injectedLessons===0))
 assert.deepEqual(library,before)
 assert.equal(JSON.stringify(result.meta).includes('/synthetic-private/'),false)
})

test('omissions: irrelevant controls report selected policy lessons separately from exposed experience',async()=>{
 const row=await runTask(task,{complete,condition:'irrelevant',library:[lesson('SCOPE_A')],scope})
 assert.equal(row.selectedLessons,1)
 assert.equal(row.injectedLessons,0)
})

test('omissions: reviewed global tool libraries need no project override',t=>{
 const f=fixture(t,[lesson('SCOPE_A',scope,{scope:'tool',tool:'edit',seed:true})]),child=f.run()
 assert.equal(child.status,0,child.stderr)
 const result=JSON.parse(readFileSync(f.paths['result.json'],'utf8'))
 assert.equal(result.meta.scope,EVAL_SCOPE);assert.equal(result.meta.eligibleLessons,1)
 assert.equal(result.rows.find(r=>r.task==='edit-env'&&r.condition==='lessons').injectedLessons,1)
 assert.equal(JSON.stringify(result.meta).includes('/synthetic-private/'),false)
})

test('omissions: scope fingerprints distinguish selection without storing the private value',async()=>{
 const library=[lesson('SCOPE_A'),lesson('SCOPE_B',other)],options={tasks:[task],complete:async()=>stop,library,repeats:1,evaluationAt:Date.now()}
 const a=await runExperiment({...options,scope}),b=await runExperiment({...options,scope:other})
 assert.notEqual(a.meta.scopeVersion,b.meta.scopeVersion)
 assert.equal(a.meta.scope,'selected-project');assert.equal(b.meta.scope,'selected-project')
 assert.equal(a.meta.eligibleLessons,1);assert.equal(b.meta.eligibleLessons,1)
 assert.equal(JSON.stringify([a.meta,b.meta]).includes('/synthetic-private/'),false)
})
