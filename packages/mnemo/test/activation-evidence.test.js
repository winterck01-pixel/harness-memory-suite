import {test} from 'node:test'
import assert from 'node:assert/strict'
import {identifyActivationTiming} from '../lib/activation-evidence.js'

const target='fixture_probe',code=`await tools.activate_tool_group({tools:["${target}"]}); return await tools.${target}({});`
const e=(type,data={})=>({type,data})
const stamp=rows=>rows.map((r,seq)=>({...r,seq}))
function source(){return stamp([
 e('turn/start',{turn:1}),
 e('tool/call',{turn:1,callId:'outer',name:'run_code',arguments:{code}}),
 e('tool/ptc-dispatch-start',{rootCallId:'outer',subCallId:'activate',name:'activate_tool_group',arguments:{tools:[target]}}),
 e('tool/ptc-dispatch',{rootCallId:'outer',subCallId:'activate',name:'activate_tool_group',arguments:{tools:[target]},isError:false,content:[{type:'text',text:JSON.stringify({availableOnNextStep:true,enabled:[target]})}]}),
 e('tool/result',{turn:1,message:{toolCallId:'outer',isError:true,content:[{type:'text',text:`TypeError: tools.${target} is not a function`}]}}),
 e('tool/call',{turn:1,callId:'repair',name:'run_code',arguments:{code:`return await tools.${target}({});`}}),
 e('tool/ptc-dispatch-start',{rootCallId:'repair',subCallId:'target',name:target,arguments:{}}),
 e('tool/ptc-dispatch',{rootCallId:'repair',subCallId:'target',name:target,arguments:{},isError:false,content:[{type:'text',text:'PRIVATE_RESULT'}]}),
 e('tool/result',{turn:1,message:{toolCallId:'repair',isError:false,content:[{type:'text',text:'PRIVATE_RESULT'}]}}),
 e('turn/end',{turn:1,reason:'completed'}),
 ])}
const denied=rows=>assert.deepEqual(identifyActivationTiming(rows),{status:'insufficient-evidence'})
test('same-program native acknowledgement and actual outer error identify one safe mechanism',()=>{
 const rows=source(),r=identifyActivationTiming(rows)
 assert.equal(r.status,'matched');assert.equal(r.kind,'activation-timing');assert.equal(r.targetTool,target);assert.equal(r.repair.status,'observed')
 assert.equal(r.evidence.outerCall.seq,1);assert.equal(r.evidence.activation.seq,3);assert.equal(r.evidence.failure.seq,4)
 assert.match(r.evidence.failure.eventHash,/^[a-f0-9]{64}$/)
 assert.equal(JSON.stringify(r).includes('PRIVATE_RESULT'),false);assert.equal(JSON.stringify(r).includes(code),false)
 assert.deepEqual(rows,source())
})
test('native JSON-string arguments, literal member syntax and tool-result error envelope are supported',()=>{
 const rows=source();rows[1].data.arguments=JSON.stringify({code:`await tools['activate_tool_group']({tools:["${target}"]}); const state=await tools['${target}']({});`})
 rows[4].data.message={content:[{type:'tool-result',callId:'outer',isError:true,content:`TypeError: tools.${target} is not a function`}]}
 assert.equal(identifyActivationTiming(rows).status,'matched')
})
for(const [name,mutate]of [
 ['printed error is not native failure',r=>{r[4].data.message.isError=false}],
 ['model self-report is not outer result',r=>{r[4].type='assistant/message'}],
 ['different missing target',r=>{r[4].data.message.content[0].text='TypeError: tools.other is not a function'}],
 ['comment does not certify target invocation',r=>{r[1].data.arguments.code=`await tools.activate_tool_group({tools:["${target}"]}); /* tools.${target}({}) */ return console.log("tools.${target}({})");`}],
 ['dead branch is rejected',r=>{r[1].data.arguments.code=`await tools.activate_tool_group({tools:["${target}"]}); if(false) await tools.${target}({});`}],
 ['caught error is rejected even when rethrown',r=>{r[1].data.arguments.code=`await tools.activate_tool_group({tools:["${target}"]}); try {await tools.${target}({});} catch(e){throw e;}`}],
 ['forged TypeError plus unreachable invocation is rejected',r=>{r[1].data.arguments.code=`await tools.activate_tool_group({tools:["${target}"]}); throw new TypeError('tools.${target} is not a function'); await tools.${target}({});`}],
 ['rebound tools is rejected',r=>{r[1].data.arguments.code=`const tools={}; await tools.activate_tool_group({tools:["${target}"]}); await tools.${target}({});`}],
 ['callback target is not unconditional',r=>{r[1].data.arguments.code=`await tools.activate_tool_group({tools:["${target}"]}); const hidden=()=>tools.${target}({});`}],
 ['invalid source code is rejected',r=>{r[1].data.arguments.code='not valid JavaScript {'}],
 ['target called before activation is rejected',r=>{r[1].data.arguments.code=`await tools.${target}({}); await tools.activate_tool_group({tools:["${target}"]});`}],
 ['unrelated tool failure cannot certify a later unreachable target',r=>{r[1].data.arguments.code=`await tools.activate_tool_group({tools:["${target}"]}); await tools.other({}); await tools.${target}({});`}],
 ['early return cannot certify unreachable target',r=>{r[1].data.arguments.code=`return await tools.activate_tool_group({tools:["${target}"]}); await tools.${target}({});`}],
 ['activation under another root is rejected',r=>{r[2].data.rootCallId='other';r[3].data.rootCallId='other'}],
 ['activation start is required',r=>{r[2].type='unknown/event'}],
 ['activation result must explicitly succeed',r=>{delete r[3].data.isError}],
 ['failed activation is rejected',r=>{r[3].data.isError=true}],
 ['acknowledgement must name enabled target',r=>{r[3].data.content[0].text=JSON.stringify({availableOnNextStep:true,enabled:['other']})}],
 ['next-step acknowledgement is required',r=>{r[3].data.content[0].text=JSON.stringify({availableOnNextStep:false,enabled:[target]})}],
 ['start request must include target',r=>{r[2].data.arguments.tools=['other']}],
 ['dispatch request must include target',r=>{r[3].data.arguments.tools=['other']}],
 ['outer error must join its exact call',r=>{r[4].data.message.toolCallId='other'}],
 ['same turn is required',r=>{r[3].data.turn=2}],
 ['complete turn is required',r=>{r.pop()}],
 ['sequence gaps are rejected',r=>{r[3].seq++}],
 ['extra post-turn event is rejected',r=>{r.push({seq:10,type:'tool/result',data:{}})}],
])test(name,()=>{const rows=source();mutate(rows);denied(rows)})

test('no successful repair is claimed without same-turn new outer and successful native dispatch',()=>{
 for(const mutate of [r=>{r[7].data.isError=true},r=>{r[6].type='unknown'},r=>{r[8].data.message.isError=true},r=>{r[5].data.name='other'},r=>{r[7].data.rootCallId='outer'},r=>{r[6].data.rootCallId='outer'}]){
  const rows=source();mutate(rows);const result=identifyActivationTiming(rows);assert.equal(result.status,'matched');assert.equal(result.repair.status,'unobserved')
 }
})
test('repair on a later turn cannot be attributed to this source turn',()=>{
 const rows=source(),end=rows.pop();rows.splice(5,0,end,e('turn/start',{turn:2}));for(const row of rows.slice(7))if(row.data.turn!=null)row.data.turn=2;rows.push(e('turn/end',{turn:2,reason:'completed'}))
 const result=identifyActivationTiming(stamp(rows));assert.equal(result.status,'matched');assert.equal(result.repair.status,'unobserved')
})
test('multiple hypotheses remain ambiguous rather than silently selecting the first',()=>{
 const a=source(),b=source();for(const r of b)if(r.data.turn!=null)r.data.turn=2
 denied(stamp([...a,...b]))
})
test('malformed, empty and oversized event batches fail closed',()=>{for(const rows of [null,{},[],Array(10001).fill(source()[0])])denied(rows)})

for(const [name,argument]of [
 ['eval-generated matching error',`eval("throw new TypeError('tools.${target} is not a function')")`],
 ['new expression',`new TypeError('tools.${target} is not a function')`],
 ['nested arbitrary call',`{value: buildPayload()}`],
 ['getter property',`{get value(){return 1}}`],
 ['spread property',`{...payload}`],
 ['computed property',`{[key]: 1}`],
 ['shorthand property',`{payload}`],
 ['member expression',`{value: payload.value}`],
 ['template expression', '`value-${payload}`'],
 ['array hole',`[1,,2]`],
 ['regular expression literal',`{value: /pattern/}`],
 ['bigint literal',`{value: 1n}`],
])test(`target argument rejects ${name}`,()=>{
 const rows=source();rows[1].data.arguments.code=`await tools.activate_tool_group({tools:["${target}"]}); return await tools.${target}(${argument});`
 denied(rows)
})
test('activation arguments also reject executable nested expressions',()=>{
 const rows=source();rows[1].data.arguments.code=`await tools.activate_tool_group({tools:["${target}"],extra:runSideEffect()}); return await tools.${target}({});`
 denied(rows)
})
test('intervening console call cannot execute a forged TypeError',()=>{
 const rows=source();rows[1].data.arguments.code=`await tools.activate_tool_group({tools:["${target}"]}); console.log(eval("throw new TypeError('tools.${target} is not a function')")); return await tools.${target}({});`
 denied(rows)
})
test('simple nested JSON argument literals retain supported evidence',()=>{
 const rows=source();rows[1].data.arguments.code=`await tools.activate_tool_group({tools:["${target}"]}); return await tools.${target}({text:"safe",count:-2,ratio:1.5,flag:true,empty:null,values:[1,"x",false,null],nested:{key:"value"}});`
 assert.equal(identifyActivationTiming(rows).status,'matched')
})
