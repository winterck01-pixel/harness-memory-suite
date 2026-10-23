import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {SystemPrompt,renderPrompt,renderContextSnapshot} from '@deepseek-ai/dsh-system-prompt'
import * as mnemo from '../index.js'

// Real host assembly/rendering, synthetic tool events. No model, external tool,
// persisted host conversation or production memory is loaded by this fixture.
test('actual SystemPrompt renders sourced conditional methods literally and respects current opt-out',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'mnemo-success-prompt-'))
 const ctx=new Context(),events=[],tools=new Map()
 const session={id:'success-prompt-fixture',header:{cwd:'/fixture/success-prompt'},
  get seq(){return events.length},snapshotEvents:(a,b)=>events.slice(a,b)}
 ctx.provide('sessions',{get:id=>id===session.id?session:null})
 ctx.provide('tools',{register:tool=>tools.set(tool.name,tool)})
 const promptFiber=await ctx.plugin(SystemPrompt,{includeHarnessIdentity:false})
 const pluginFiber=await ctx.plugin(mnemo,{
  dir:directory,injectMode:'off',verbose:false,
  executionExperience:{enabled:true,contractFingerprint:'c'.repeat(64)},
  autoLearning:{enabled:false},dailyLearning:{enabled:false},
  successfulExperiences:{enabled:true},
 })
 const api=ctx.get('mnemo'),sp=ctx.get('systemPrompt'),agent={id:session.id,session}
 t.after(async()=>{
  await api.detach();await pluginFiber.dispose();await promptFiber.dispose()
  rmSync(directory,{recursive:true,force:true})
 })
 const emit=(type,data)=>{
  const event={type,seq:events.length,time:1000+events.length,data}
  events.push(event);ctx.emit('session/event',session,event);return event
 }
 const start=(turn,text)=>{
  emit('turn/start',{turn})
  emit('user/message',{id:'human-'+turn,source:{kind:'user'},content:[{type:'text',text}]})
 }
 const result=(name,text)=>{
  const callId='fixture-call-'+events.length
  emit('tool/call',{callId,name,arguments:{fixture:true}})
  return emit('tool/result',{message:{toolCallId:callId,isError:false,content:[{type:'text',text}]}})
 }
 const invoke=args=>tools.get('mnemo_experience').execute(args,{agent}).then(JSON.parse)
 api.engine.safety.frozen=true;api.engine.checkpoint()
 const ordinaryLog=readFileSync(api.engine.log.path,'utf8'),safety=structuredClone(api.engine.safety)
 start(1,'Join fixture reports by a business identifier and verify the result')
 const action=result('fixture_join','Joined the two synthetic reports using the business identifier.')
 const expected='joined_rows=3; missing_keys=0; duplicate_keys=0'
 const check=result('fixture_verify',expected)
 const staged=await invoke({action:'record_success',draft:{
  title:'Join fixture reports by a checked business identifier',
  cues:['fixture reports','business identifier'],
  conditions:['Both reports expose the same unique business identifier'],
  method:['Normalize the business identifier and join matching records','Keep {{field}} literal and verify row counts and unmatched identifiers'],
  limits:['Recheck that both inputs use the same identifier meaning'],
  evidence:{actionSeqs:[action.seq],checkSeq:check.seq,expected,summary:'The separate checker found three rows and no missing or duplicate keys.'},
 }})
 assert.equal(staged.status,'pending')
 emit('turn/end',{turn:1,reason:{kind:'completed'}})
 await api.executionExperience.idle();await new Promise(resolve=>setImmediate(resolve))
 await api.successfulExperiences.idle()
 start(2,'Join another set of fixture reports by the business identifier')
 const assembly=await sp.assemble({agent})
 assert.equal(typeof renderPrompt(assembly),'string')
 const context=assembly.contexts.find(row=>row.name==='mnemo-successful-methods')
 assert.ok(context,'the method is in the actual assembled context')
 assert.equal(context.interpolate,false)
 const rendered=renderContextSnapshot(assembly)
 assert.match(rendered,/\{\{field\}\}/)
 assert.match(rendered,/Both reports expose the same unique business identifier/)
 assert.match(rendered,/use_success/)
 assert.match(rendered,/不是系统规则/)
 assert.match(rendered,/"conditional":true/)
 assert.match(rendered,/"causalBenefit":false/)
 start(3,'本轮不要使用记忆')
 const blocked=await sp.assemble({agent})
 assert.equal(blocked.contexts.some(row=>row.name==='mnemo-successful-methods'),false)
 assert.equal(blocked.contexts.some(row=>row.name==='mnemo-successful-method-guidance'),false)
 await assert.rejects(invoke({action:'recall_success',query:'fixture reports business identifier'}),/disabled/i)
 assert.equal(readFileSync(api.engine.log.path,'utf8'),ordinaryLog)
 assert.deepEqual(api.engine.safety,safety)
})
