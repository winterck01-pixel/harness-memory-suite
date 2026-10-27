import test from 'node:test'
import assert from 'node:assert/strict'
import {TASKS} from '../eval/fixtures.js'
import {SimEnv} from '../eval/env.js'
import {signatureOf} from '../lib/lessons-signature.js'
import {runTask,runExperiment,runLearningCurve,signTest,pairedByTask,filler,evalLesson,judge,summarize} from '../eval/lessons-eval.js'
import {selectForError,visibleIn} from '../lib/lessons.js'

// Scripted stand-in for a weak model: acts naively and retries the same call, but follows advice
// that appears in the conversation (opening hint or the text appended to a failed tool result).
function scriptedModel(messages){
 const user=messages.filter(m=>m.role==='user').map(m=>m.content),first=user[0],last=user.at(-1),asst=messages.filter(m=>m.role==='assistant').map(m=>m.content)
 const count=s=>asst.filter(m=>m.includes(s)).length,hint=re=>re.test(messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'))||re.test(first)||re.test(last)
 if(['edited','ok','null'].includes(last))return JSON.stringify({final:'done'})
 const edit=/"([^"]+)" 改为 "([^"]+)"/.exec(first),file=/文件 (\S+) 中/.exec(first)?.[1],write=/把文本 "([^"]*)" 写入文件 (\S+?)。/.exec(first)
 const run=/用 run_code 把文本 "([^"]*)" 写入文件 (\S+?)\(/.exec(first)
 const act=a=>JSON.stringify(a)
 if(edit){
  const reads=count('"tool":"read"'),edits=count('"tool":"edit"'),stale=/其他进程/.test(first)
  if(reads===0)return hint(/先用 read/)||edits>=2?act({tool:'read',args:{path:file}}):act({tool:'edit',args:{path:file,old:edit[1],new:edit[2]}})
  if(stale&&/changed since/.test(last))return hint(/重新 read/)||edits>=4?act({tool:'read',args:{path:file}}):act({tool:'edit',args:{path:file,old:edit[1],new:edit[2]}})
  return act({tool:'edit',args:{path:file,old:edit[1],new:edit[2]}})
 }
 if(write){
  const activated=count('activate_tool_group')>0
  if(!activated&&(hint(/先调用 activate_tool_group/)||count('"tool":"bash"')>=2))return act({tool:'activate_tool_group',args:{group:'developer'}})
  return act({tool:'bash',args:{command:`write ${write[2]} ${write[1]}`}})
 }
 if(run){
  const modern=hint(/await import/)||count('require(')>=2
  return act({tool:'run_code',args:{code:(modern?"const fs = await import('node:fs'); ":"const fs = require('fs'); ")+`fs.writeFileSync('${run[2]}','${run[1]}')`}})
 }
 return act({final:'?'})
}

const sigOf=(tool,text)=>{const s=signatureOf(tool,text);return {signature:s.signature,errorClass:s.errorClass}}
// Reviewed, tool-level lessons (seed) so the production visibility rule makes them usable in any project.
const mk=(tool,text,trigger,advice)=>({...sigOf(tool,text),scope:'tool',tool,seed:true,state:'active',type:'fix',trigger,advice})
const library=[
 mk('edit','Error: cannot modify "/p": file has not been read — read the file, then retry','edit 报 cannot modify file has not been read','先用 read 读取该文件,再重新执行 edit。'),
 mk('bash','Error: 工具未在本轮启用，请先使用 activate_tool_group 加载所需分组；用户关闭工具时不得启用。','工具报 工具未在本轮启用 activate_tool_group','先调用 activate_tool_group 加载分组,下一步再调用工具。'),
 mk('run_code','Error: code run failed (exception): ReferenceError: require is not defined','run_code 报 ReferenceError require is not defined',"run_code 是 ES 模块环境:用 await import('node:fs'),不要用 require。"),
 mk('edit','Error: cannot edit "/p": file changed since it was read — re-read the file, then retry','edit 报 file changed since it was read','重新 read 目标区段后再 edit。'),
]
const complete=async m=>scriptedModel(m)

test('SimEnv reproduces the production failure modes',()=>{
 const env=new SimEnv({'/a':'x'})
 assert.match(env.exec({tool:'edit',args:{path:'/a',old:'x',new:'y'}}).text,/has not been read/)
 env.exec({tool:'read',args:{path:'/a'}});assert.equal(env.exec({tool:'edit',args:{path:'/a',old:'x',new:'y'}}).ok,true)
 assert.match(env.exec({tool:'bash',args:{command:'write /b 1'}}).text,/工具未在本轮启用/)
})

test('mechanism test: conditions separate, lessons help only after an error, verdict valid',async()=>{
 const res=await runExperiment({tasks:TASKS,complete,library,repeats:2,split:'test'})
 const {baseline,lessons,irrelevant}=res.summary
 assert.equal(baseline.repeatRate,1);assert.equal(irrelevant.repeatRate,1,'equal-length irrelevant text does not help')
 assert.equal(lessons.repeatRate,0);assert.ok(lessons.meanErrorsOnSuccess<baseline.meanErrorsOnSuccess);assert.equal(lessons.successRate,1)
 assert.equal(res.verdict.valid,true)
 const c=res.comparisons.errorsOnComparableTasks.vsBaseline
 assert.equal(c.independentTasks,9);assert.equal(c.losses,0);assert.ok(c.wins>0);assert.equal(c.p,null,'9 independent tasks is descriptive only')
 assert.equal(res.meta.injectOpening,false,'defaults to the live stage-1 setting')
})

test('F08: giving up immediately is not an improvement',async()=>{
 const giveUp=async(m,meta)=>meta.condition==='lessons'?JSON.stringify({final:'放弃'}):scriptedModel(m)
 const res=await runExperiment({tasks:TASKS,complete:giveUp,library,repeats:3,split:'test'})
 assert.equal(res.summary.lessons.successRate,0);assert.equal(res.summary.lessons.meanErrors,0);assert.equal(res.summary.lessons.abandonRate,1)
 assert.equal(res.verdict.valid,false);assert.ok(res.verdict.reasons.some(r=>/success fell/.test(r)))
})

test('F09: evaluation recall equals production policy (retired / other project / unconfirmed tool lessons)',async()=>{
 const err=sigOf('edit','Error: cannot modify "/p": file has not been read — read the file, then retry')
 const mkL=o=>evalLesson({...err,trigger:'edit file has not been read',advice:'read first then edit now',...o},'P')
 const lessons=[mkL({id:'retired',state:'retired',scope:'project',scopeHash:'P'}),mkL({id:'other',scope:'project',scopeHash:'Q'}),mkL({id:'unconfirmed-tool',scope:'tool',tool:'edit',scopeHash:'Q',projects:['Q']}),mkL({id:'ok',scope:'project',scopeHash:'P'})]
 const prod=selectForError(lessons,{...err,tool:'edit',normalized:'x'},{scope:'P'}).map(l=>l.id)
 assert.deepEqual(prod,['ok']);assert.equal(lessons.filter(l=>visibleIn(l,'P')).length,1)
 // The evaluator uses the same function: with only invisible lessons the "lessons" condition behaves like baseline.
 const res=await runExperiment({tasks:TASKS.filter(t=>t.id==='edit-env'),complete,library:lessons.filter(l=>l.id!=='ok'),repeats:1,split:'test',scope:'P'})
 assert.equal(res.summary.lessons.meanErrors,res.summary.baseline.meanErrors)
})

test('F10: repeating a task adds runs, not independent evidence',async()=>{
 const one=await runExperiment({tasks:TASKS,complete,library,repeats:1,split:'test'}),ten=await runExperiment({tasks:TASKS,complete,library,repeats:10,split:'test'})
 const a=one.comparisons.errorsOnComparableTasks.vsBaseline,b=ten.comparisons.errorsOnComparableTasks.vsBaseline
 assert.equal(a.independentTasks,b.independentTasks);assert.equal(a.wins,b.wins);assert.equal(b.p,null);assert.equal(b.repeatsPerTask,10)
 assert.equal(signTest([1,1,1,1,1],[0,0,0,0,0]).p,0.0625)
})

test('F11: learning curve measures a frozen library on held-out scenarios and says what it shows',async()=>{
 const train=TASKS.filter(t=>t.split==='train'),heldout=TASKS.filter(t=>t.split==='test')
 const advice=f=>/has not been read/.test(f.text)?'先用 read 读取该文件,再重新执行 edit。':/changed since/.test(f.text)?'重新 read 目标区段后再 edit。':/require is not defined/.test(f.text)?"run_code 是 ES 模块环境:用 await import('node:fs'),不要用 require。":'先调用 activate_tool_group 加载分组,下一步再调用工具。'
 const distill=run=>run.failures.map(f=>({signature:f.signature,errorClass:f.errorClass,scope:'tool',tool:f.tool,seed:true,trigger:f.normalized,advice:advice(f)}))
 const res=await runLearningCurve({trainTasks:train,heldoutTasks:heldout,complete,distill,rounds:2})
 assert.equal(res.kind,'same-mechanism-scenario-holdout');assert.equal(res.points.length,3)
 assert.equal(res.points[0].libraryLessons,0);assert.ok(res.points[0].heldoutMeanErrors>res.points.at(-1).heldoutMeanErrors)
 assert.ok(train.every(t=>!heldout.some(h=>h.id===t.id)),'no task is used for both learning and measuring')
})

test('F12: request size counts resent history; tokens are unknown without provider usage',async()=>{
 const task=TASKS.find(t=>t.id==='edit-env')
 const run=await runTask(task,{complete,condition:'baseline'})
 assert.ok(run.requestChars>run.dialogChars*1.5,'history is resent every step');assert.equal(run.tokens,null)
 const withUsage=await runTask(task,{complete:async m=>({text:scriptedModel(m),usage:{total_tokens:10}}),condition:'baseline'})
 assert.equal(withUsage.tokens,10*withUsage.steps);assert.equal(summarize([withUsage]).baseline.meanTokens,withUsage.tokens)
})

test('F13: an invalid response is a protocol error, never a normal ending',async()=>{
 const task=TASKS.find(t=>t.id==='edit-env');let n=0
 const flaky=async m=>{n++;return n===1?'好的,我来处理':scriptedModel(m)}
 const recovered=await runTask(task,{complete:flaky,condition:'baseline'})
 assert.equal(recovered.protocolErrors,1);assert.equal(recovered.success,true)
 let k=0
 const lateGarbage=async m=>{k++;const r=scriptedModel(m);return JSON.parse(r).final?'完成了(非 JSON)':r}
 const bad=await runTask(task,{complete:lateGarbage,condition:'baseline'})
 assert.equal(bad.goal,true,'the file was changed');assert.equal(bad.explicitFinal,false);assert.equal(bad.success,false);assert.ok(bad.protocolErrors>0);assert.notEqual(bad.outcome,'success')
})

test('equal-length control and seeded condition order',async()=>{
 assert.equal(filler(137).length,137);assert.equal(filler(0),'')
 const a=await runExperiment({tasks:TASKS.slice(0,3),complete,library,repeats:2,split:null,seed:7}),b=await runExperiment({tasks:TASKS.slice(0,3),complete,library,repeats:2,split:null,seed:7}),c=await runExperiment({tasks:TASKS.slice(0,3),complete,library,repeats:2,split:null,seed:8})
 const order=r=>r.rows.map(x=>x.condition).join()
 assert.equal(order(a),order(b));assert.notEqual(order(a),order(c))
})

test('opening injection stage is explicit and shares the production policy',async()=>{
 const res=await runExperiment({tasks:TASKS.filter(t=>t.id==='edit-env'),complete,library:[{...library[0],trigger:'edit file has not been read 将文件 中 改为',advice:'先用 read 读取该文件,再重新执行 edit。'}],repeats:1,split:'test',config:{injectOpening:true,minSimilarity:0.05}})
 assert.equal(res.meta.injectOpening,true);assert.equal(res.summary.lessons.meanErrors,0)
})
