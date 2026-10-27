import test from 'node:test'
import assert from 'node:assert/strict'
import {TASKS} from '../eval/fixtures.js'
import {runTask,runExperiment,evalLesson,libraryVersion} from '../eval/lessons-eval.js'
import {LessonStore,LessonsEngine} from '../lib/lessons.js'
import {signatureOf} from '../lib/lessons-signature.js'

const task=TASKS.find(t=>t.id==='edit-env')
const signature=signatureOf('edit','Error: cannot modify "/p": file has not been read — read the file, then retry')
const lesson=evalLesson({...signature,id:'closeout',scope:'tool',tool:'edit',seed:true,trigger:'edit file has not been read',advice:'CLOSEOUT_ADVICE read before edit'})
const stop=JSON.stringify({final:'stop'})
const contains=messages=>messages.some(m=>m.content.includes('CLOSEOUT_ADVICE'))
const isolated=config=>{
 const store=new LessonStore();store.state.lessons[lesson.id]=structuredClone(lesson)
 return new LessonsEngine({store,generate:async()=>({}),config:{enabled:true,holdoutRate:0,logInjections:false,...config}})
}

test('closeout: disabled error injection matches production',async()=>{
 const config={injectOnError:false,injectOpening:false},engine=isolated(config)
 engine._s('s').pendingError={...signature,tool:'edit'}
 assert.equal(engine.contextFor('s','eval-project',task.prompt),'');engine.dispose()
 const requests=[]
 await runTask(task,{library:[lesson],condition:'lessons',config,complete:async(m,meta)=>{
  requests.push(structuredClone(m));return meta.step===0?JSON.stringify({tool:'edit',args:{path:'/proj/.env.sample',old:'MODE=dev',new:'MODE=prod'}}):stop
 }})
 assert.equal(contains(requests[1]),false)
})

test('closeout: opening character budget and enabled switch match production',async()=>{
 for(const config of [{injectOpening:true,openingChars:0,minSimilarity:0},{enabled:false,injectOpening:true,minSimilarity:0}]){
  const engine=isolated(config);assert.equal(engine.contextFor('s','eval-project',task.prompt),'');engine.dispose()
  let request
  await runTask(task,{library:[lesson],condition:'lessons',config,complete:async m=>{request=structuredClone(m);return stop}})
  assert.equal(contains(request),false)
 }
})

test('closeout: incomplete usage is unknown and complete components are summed',async()=>{
 const cases=[[{},null],[{prompt_tokens:13},null],[{prompt_tokens:13,completion_tokens:7},20],[{input_tokens:12,output_tokens:8},20],[{total_tokens:NaN},null],[{total_tokens:-1},null],[{total_tokens:'20'},null],[{total_tokens:0},0],[{totalTokens:9},9],[{total_tokens:0,prompt_tokens:13,completion_tokens:7},20],[{total_tokens:0,input_tokens:13},null],[{total_tokens:17,input_tokens:13,output_tokens:7},20],[{total_tokens:25,input_tokens:13,output_tokens:7},25],[{total_tokens:0,totalTokens:20},null]]
 for(const [usage,expected] of cases){
  const row=await runTask(task,{condition:'baseline',complete:async()=>({text:stop,usage})})
  assert.equal(row.tokens,expected,JSON.stringify(usage))
 }
})

test('closeout: library version covers recall inputs and canonicalizes object keys',()=>{
 const base={...lesson,scope:'project',scopeHash:'P',seed:false}
 for(const delta of [{scopeHash:'Q'},{trigger:'different query'},{projects:['P','Q']},{seed:true},{lastSeen:base.lastSeen-1},{stats:{...base.stats,support:99}},{scope:'tool'},{type:'method'},{errorClass:'different'}]){
  assert.notEqual(libraryVersion([base]),libraryVersion([{...base,...delta}]),JSON.stringify(delta))
 }
 const reordered=Object.fromEntries(Object.entries(base).reverse())
 assert.equal(libraryVersion([base]),libraryVersion([reordered]))
 const other={...base,id:'other'}
 assert.notEqual(libraryVersion([base,other]),libraryVersion([other,base]),'input order can break recall ranking ties')
})

test('closeout: experiment records effective config and frozen time without private route fields',async()=>{
 const result=await runExperiment({tasks:[task],library:[lesson],repeats:1,evaluationAt:1770000000000,config:{injectOnError:false,openingChars:31,openingLimit:{apiKey:'PRIVATE_NESTED'},holdoutRate:1,extractor:{provider:'PRIVATE_ROUTE',model:'PRIVATE_MODEL'},apiKey:'PRIVATE_SECRET'},complete:async()=>stop})
 assert.equal(result.meta.effectiveConfig.injectOnError,false)
 assert.equal(result.meta.effectiveConfig.openingChars,31)
 assert.equal(result.meta.effectiveConfig.holdoutRate,0,'controlled arms must not contain production holdout')
 assert.equal(result.meta.evaluationAt,1770000000000)
 assert.equal(JSON.stringify(result.meta).includes('PRIVATE_'),false)
 assert.ok(result.meta.configVersion)
})

test('closeout: provider adapter preserves complete components without fabricating totals',async()=>{
 const {complete}=await import('../eval/adapter.example.mjs')
 const previous=globalThis.fetch,keys=['LLM_BASE_URL','LLM_API_KEY','LLM_MODEL'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
 process.env.LLM_BASE_URL='https://unit.invalid/v1';process.env.LLM_API_KEY='synthetic';process.env.LLM_MODEL='synthetic'
 globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:stop}}],usage:{prompt_tokens:13,completion_tokens:7}})})
 try{
  const reply=await complete([{role:'user',content:'synthetic'}]);assert.deepEqual(reply.usage,{prompt_tokens:13,completion_tokens:7})
  const result=await runTask(task,{condition:'baseline',complete:async()=>reply});assert.equal(result.tokens,20)
 }finally{globalThis.fetch=previous;for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k]}
})

test('closeout: production lifecycle suspends a repeatedly failing lesson inside a task',async()=>{
 const unstable={...lesson,stats:{support:1,injected:4,recurAfterInject:3}}
 const before=structuredClone(unstable),requests=[]
 await runTask(task,{library:[unstable],condition:'lessons',config:{injectOpening:false},complete:async(m,meta)=>{
  requests.push(structuredClone(m));return meta.step<2?JSON.stringify({tool:'edit',args:{path:'/proj/.env.sample',old:'MODE=dev',new:'MODE=prod'}}):stop
 }})
 assert.equal(contains(requests[0]),false);assert.equal(contains(requests[1]),true);assert.equal(contains(requests[2]),false)
 assert.deepEqual(unstable,before,'evaluation must not modify the supplied experience library')
})

test('closeout: controlled lessons arm excludes production holdout but retains injection',async()=>{
 let seen=false
 await runTask(task,{library:[lesson],condition:'lessons',config:{holdoutRate:1,injectOpening:true,minSimilarity:0},complete:async m=>{seen=contains(m);return stop}})
 assert.equal(seen,true)
})

test('closeout: fixture lessons without ids keep distinct project scope identities',async()=>{
 const one={...lesson,id:undefined,scope:'project',scopeHash:'P',seed:false},two={...one,scopeHash:'Q'}
 assert.notEqual(evalLesson(one).id,evalLesson(two).id)
 let seen=false
 await runTask(task,{library:[one,two],scope:'P',condition:'lessons',config:{injectOpening:true,minSimilarity:0},complete:async m=>{seen=contains(m);return stop}})
 assert.equal(seen,true)
})

test('closeout: host memory opt-out suppresses evaluation context without suppressing ordinary tasks',async()=>{
 for(const [prompt,expected] of [['这次关闭记忆。read the file',false],['read the file',true]]){
  let seen=false
  await runTask({...task,prompt},{library:[lesson],condition:'lessons',config:{injectOpening:true,minSimilarity:0},complete:async m=>{seen=contains(m);return stop}})
  assert.equal(seen,expected,prompt)
 }
})
