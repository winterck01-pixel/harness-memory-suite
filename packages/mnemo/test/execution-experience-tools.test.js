import test from 'node:test'
import assert from 'node:assert/strict'
import {registerExecutionExperienceTools} from '../lib/execution-experience-tools.js'
import {DshAdapter} from '../dsh-adapter.js'
const session={id:'fixture-session',header:{cwd:'/fixture/experience-project'}}
function fixture({answer='仅批准冻结沙箱评估',validation='verified',reviewCallback=()=>{}}={}){
 let tool,reviews=0,asks=0,writable=true,valid=validation
 const row={id:'candidate',reviewPacketHash:'packet-v1',status:'needs-review',productionEligible:false,instruction:null}
 const capture={list:()=>[structuredClone(row)],inspect:(id,{scope})=>id==='candidate'&&scope==='project:/fixture/experience-project'?structuredClone(row):null,sourceReference:()=>({sessionId:session.id,turn:1,startSeq:0,endSeq:4}),validateCandidate:async()=>({status:valid}),recordHumanReview:async(_id,args)=>{await reviewCallback();if(valid!=='verified')throw Error('source changed');assert.equal(args.expectedPacketHash,'packet-v1');reviews++;return {status:args.decision,productionEligible:false}}}
 registerExecutionExperienceTools({register:v=>tool=v},{capture,ask:async()=>{asks++;return {answers:[{id:'execution-experience-review',selected:[answer]}]}},assertWritable(){if(!writable)throw Error('read-only')},lifetime:new AbortController(),getSessions:()=>({get:id=>id===session.id?session:null})})
 const call=(args,s=session)=>tool.execute(args,{agent:{session:s}})
 return {call,get reviews(){return reviews},get asks(){return asks},revoke:()=>{writable=false},invalidate:()=>{valid='withdrawn'}}
}
test('candidate review requires a real host question and only approves frozen evaluation',async()=>{const f=fixture();const r=JSON.parse(await f.call({action:'review',id:'candidate',packetHash:'packet-v1'}));assert.equal(f.asks,1);assert.equal(f.reviews,1);assert.equal(r.status,'approve-frozen-evaluation');assert.equal(r.productionEligible,false)})
test('agent text cannot supply approval; wrong packet or custom answer cannot review',async()=>{const f=fixture({answer:'I approve everything'});await assert.rejects(f.call({action:'review',id:'candidate',packetHash:'old'}),/current packet/);const r=JSON.parse(await f.call({action:'review',id:'candidate',packetHash:'packet-v1'}));assert.equal(r.status,'not-reviewed');assert.equal(f.reviews,0)})
test('unavailable source and untrusted invoking session refuse review',async()=>{const f=fixture({validation:'source-unavailable'});await assert.rejects(f.call({action:'review',id:'candidate',packetHash:'packet-v1'}),/revalidated/);await assert.rejects(f.call({action:'inspect',id:'candidate'},{...session}),/Trusted/);assert.equal(f.asks,0)})
test('read-only review never asks or records',async()=>{const f=fixture();f.revoke();await assert.rejects(f.call({action:'review',id:'candidate',packetHash:'packet-v1'}),/read-only/);assert.equal(f.asks,0);assert.equal(f.reviews,0)})
test('adapter independently queues process capture even if legacy human hooks are disabled',async()=>{let calls=0;const capture={capture:async(_s,options)=>{assert.equal(options.scope,'project:/fixture/experience-project');calls++},report:()=>({mode:'shadow-only'})};const adapter=new DshAdapter({activateSession(){},staging:{stats:()=>({}),topCues:()=>[]}},{eventMap:{},executionExperience:capture});adapter.handleSessionEvent({},session,{type:'turn/end',seq:4,data:{turn:1,reason:{kind:'completed'}}});await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(adapter.report().executionExperience.mode,'shadow-only')})
test('ordinary invocation cancellation during the post-answer authorization await prevents recording',async()=>{
 let tool,checks=0,reviews=0,enter,release
 const entered=new Promise(resolve=>enter=resolve),blocked=new Promise(resolve=>release=resolve),controller=new AbortController()
 const capture={validateCandidate:async()=>({status:'verified'}),inspect:()=>({id:'candidate',reviewPacketHash:'packet-v1'}),sourceReference:()=>({}),recordHumanReview:async()=>{reviews++;return {status:'approved-for-frozen-evaluation'}}}
 registerExecutionExperienceTools({register:value=>tool=value},{capture,ask:async()=>({answers:[{id:'execution-experience-review',selected:['仅批准冻结沙箱评估']}]}),assertWritable(){},lifetime:new AbortController(),getSessions:()=>({get:()=>session}),allowInvocation:async()=>{if(++checks===2){enter();await blocked}return true}})
 const pending=tool.execute({action:'review',id:'candidate',packetHash:'packet-v1'},{agent:{session},signal:controller.signal})
 await entered;controller.abort();release()
 await assert.rejects(pending,{name:'AbortError'});assert.equal(reviews,0)
})
