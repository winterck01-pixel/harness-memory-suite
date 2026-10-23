import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {SystemPrompt} from '@deepseek-ai/dsh-system-prompt'
import {ToolRuntime} from '@deepseek-ai/dsh-tools'
import {PtcRuntime} from '@deepseek-ai/dsh-ptc-runtime'
import {createScope,scopeTarget} from '@deepseek-ai/dsh-scope'
import * as plugin from '../index.js'

// The actual host builds and executes native/PTC tool views; every target tool
// is synthetic and has no file, network, model or production-memory effect.
async function exercise(ptc){
 const ctx=new Context(),fibers=[],scopes=[],calls={mnemo_experience:0,mnemo_recall:0,read:0,mnemo_private:0}
 let target='mnemo_experience',arguments_={},extraDenied=false,hideExperience=false,lastBindings=[]
 class BindingRuntime extends PtcRuntime{
  language='typescript';isolation='fixture'
  resolve(request){return {...request,cwd:process.cwd()}}
  async run(request){
   const functions=request.bindings[0].functions;lastBindings=Object.keys(functions)
   if(target==='activation-and-same-program'){
    await functions.activate_tool_group({tools:['read']})
    return {logs:[],value:{readAvailableInSameProgram:typeof functions.read==='function'}}
   }
   return {logs:[],value:await functions[target](arguments_)}
  }
 }
 try{
  fibers.push(await ctx.plugin(SystemPrompt,{}))
  ctx.provide('workingDirectory',{ensure:async()=>process.cwd()})
  if(ptc)fibers.push(await ctx.plugin(BindingRuntime,{}))
  fibers.push(await ctx.plugin(ToolRuntime,ptc?{mode:'ptc'}:{}))
  const tools=ctx.get('tools'),sp=ctx.get('systemPrompt')
  for(const name of Object.keys(calls))tools.register({name,description:'Isolated fixture; no external effect',
   parameters:{type:'object',properties:{},additionalProperties:false},
   output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
   execute:()=>{calls[name]++;return 'FIXTURE_EXECUTED'}})
  tools.filterAvailability(name=>!(hideExperience&&name==='mnemo_experience'))
  tools.guard(exec=>extraDenied&&(exec.call?.name??exec.name)==='mnemo_experience'?'FIXTURE_REAL_GUARD_DENIED':undefined)
  fibers.push(await ctx.plugin(plugin,{}))
  const agent={id:'experience-entry-'+ptc,session:{id:'experience-entry-'+ptc,header:{cwd:'/fixture/experience-entry'},events:[],append(){}}}
  const scope=createScope(ctx,agent);agent.ctx=scope.ctx;scopes.push(scope)
  const send=(text,turn)=>ctx.emit(scopeTarget(ctx,agent),'agent/inbox/claimed',{agent,turn,message:{source:{kind:'user'},content:[{type:'text',text}]}})
  const assemble=()=>sp.assemble({agent,scope:agent})
  const call=async(name,args={})=>{
   target=name;arguments_=args
   return tools.execute({name:ptc?'run_code':name,arguments:ptc?{code:'fixture binding call',description:'Isolated experience entry check'}:args,
    callId:'fixture-'+Math.random(),agent,signal:new AbortController().signal})
  }
  send('处理表格并复用适用的经验',1);await assemble()
  assert.ok(tools.view(agent).visible.has('mnemo_experience'))
  assert.ok(tools.view(agent).visible.has('mnemo_recall'))
  assert.ok(!tools.view(agent).visible.has('mnemo_private'))
  let result=await call('mnemo_experience');assert.equal(result.isError,false,JSON.stringify(result));assert.equal(calls.mnemo_experience,1)
  if(ptc)assert.ok(lastBindings.includes('mnemo_experience'),'new run_code already binds the experience entry')
  extraDenied=true;result=await call('mnemo_experience');assert.equal(result.isError,true);assert.equal(calls.mnemo_experience,1);extraDenied=false
  send('本轮不要使用记忆',2);await assemble()
  assert.ok(!tools.view(agent).visible.has('mnemo_experience'))
  result=await call('mnemo_experience');assert.equal(result.isError,true);assert.equal(calls.mnemo_experience,1)
  result=await call('activate_tool_group',{tools:['mnemo_experience']});assert.equal(result.isError,true);assert.equal(calls.mnemo_experience,1)
  send('不要调用任何工具',3);const blocked=await assemble();assert.equal(blocked.tools.length,0)
  result=await call('mnemo_experience');assert.equal(result.isError,true);assert.equal(calls.mnemo_experience,1)
  send('处理下一份表格',4);await assemble();result=await call('mnemo_experience')
  assert.equal(result.isError,false);assert.equal(calls.mnemo_experience,2)
  if(ptc){
   result=await call('activation-and-same-program');assert.equal(result.isError,false)
   assert.ok(!lastBindings.includes('read'),'other extension tools are still absent in the activating program')
   await assemble();result=await call('read');assert.equal(result.isError,false);assert.equal(calls.read,1)
  }
  hideExperience=true;await assemble();assert.ok(!tools.view(agent).visible.has('mnemo_experience'),'BASE cannot override upstream visibility')
  console.log(JSON.stringify({mode:ptc?'ptc':'native',defaultEntry:true,userOptOut:true,realExecutionGuard:true,upstreamVisibility:true,
   ptcNextStepTiming:ptc?'verified':'not-applicable',paidMedia:false}))
 }finally{
  for(const scope of scopes.reverse())await scope.dispose()
  for(const fiber of fibers.reverse())await fiber.dispose()
 }
}
test('actual native host exposes experience entry without bypassing consent or permission',()=>exercise(false))
test('actual PTC host binds experience entry and preserves next-step activation',()=>exercise(true))
