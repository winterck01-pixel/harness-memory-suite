import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAction,summarize,classifyTimingErrors,runEvaluation} from './runner.mjs';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateFixtureCode} from './safe-code.mjs';
import {heldoutTasks} from './tasks.mjs';
test('same-step activate and invoke remains executable syntax, not fixed by evaluator',()=>{
 assert.equal(validateFixtureCode('await tools.activate_tool_group({tools:["parcel_beacon"]}); return await tools.parcel_beacon({});','parcel_beacon'),true);
});
test('unsafe code and prototype/dynamic access rejected',()=>{
 for(const code of ['return process.env;','const tool="parcel_beacon"; return tools[tool]({});','return tools.parcel_beacon.constructor("return process")();','while(true){}','await import("fs");','const f=tools.parcel_beacon; return f({});','const x={get y(){return 1}};']) assert.throws(()=>validateFixtureCode(code,'parcel_beacon'));
});
test('unknown tools and nested results cannot call arbitrary methods',()=>assert.throws(()=>validateFixtureCode('return tools.delete_file({});','parcel_beacon')));
test('ITT retains every assigned arm with missing cells',()=>{
 const summary=summarize([{taskId:heldoutTasks[0].id,arm:'baseline',goalCorrect:false}],heldoutTasks);
 assert.equal(summary.plannedArms,16);assert.equal(summary.pairs.length,8);assert.equal(summary.pairs[0].arms.candidate.missing,true);assert.equal(summary.promotionEligible,false);
});
test('model parse errors remain parse errors',()=>{assert.throws(()=>parseAction('I succeeded'));assert.equal(parseAction('{"type":"final","answer":"ok"}').type,'final');});
test('the entire source is checked and synthetic-wrapper breakout is rejected',()=>{
 for(const code of ['} globalThis.process; async function ignored(){','} while(true){} async function ignored(){','return 1; process.env;','return 1; function hidden(){}'])assert.throws(()=>validateFixtureCode(code,'sample_gauge'));
 assert.equal(validateFixtureCode('const value=await tools.sample_gauge({}); console.log(JSON.stringify(value)); return value;','sample_gauge'),true);
});

test('timing classifier requires missing binding and successful same-program activation',()=>{
 const common=[{seq:1,type:'action',tool:'run_code',callId:'p',payload:{arguments:{code:'return await tools.parcel_beacon({});'}}},{seq:2,type:'binding-snapshot',payload:{names:['activate_tool_group']}},{seq:5,type:'result',tool:'run_code',callId:'p',payload:{ok:false,result:{isError:true,error:{message:'TypeError: tools.parcel_beacon is not a function'}}}}];
 assert.deepEqual(classifyTimingErrors(common,'parcel_beacon'),{availabilityErrors:1,activationTimingErrors:0,repeatedTimingErrors:0});
 const activated=[common[0],common[1],{seq:3,type:'action',tool:'activate_tool_group',callId:'a',payload:{arguments:{tools:['parcel_beacon']}}},{seq:4,type:'result',tool:'activate_tool_group',callId:'a',payload:{ok:true}},common[2]];
 assert.equal(classifyTimingErrors(activated,'parcel_beacon').activationTimingErrors,1);
 assert.equal(classifyTimingErrors(activated,'another_tool').activationTimingErrors,0);
 const bound=structuredClone(activated);bound[1].payload.names.push('parcel_beacon');assert.equal(classifyTimingErrors(bound,'parcel_beacon').availabilityErrors,0);
 const logged=structuredClone(activated);logged.at(-1).payload={ok:true,result:{isError:false,result:'tools.parcel_beacon is not a function'}};assert.equal(classifyTimingErrors(logged,'parcel_beacon').activationTimingErrors,0);
 const noCall=structuredClone(activated);noCall[0].payload.arguments.code='console.log("tools.parcel_beacon is not a function");';assert.equal(classifyTimingErrors(noCall,'parcel_beacon').activationTimingErrors,0);
 const literal=structuredClone(activated);literal[0].payload.arguments.code='return await tools["parcel_beacon"]({});';assert.deepEqual(classifyTimingErrors(literal,'parcel_beacon'),classifyTimingErrors(activated,'parcel_beacon'));
 const dynamic=structuredClone(activated);dynamic[0].payload.arguments.code='return await tools["parcel_"+"beacon"]({});';assert.equal(classifyTimingErrors(dynamic,'parcel_beacon').activationTimingErrors,0);
});

test('cleanup failure persists the affected arm and all remaining ITT cells',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'activation-cleanup-'));
 let requests=0;
 try {
  const summary=await runEvaluation({outputDirectory:dir,mode:'development',maxSteps:1,candidateFor:()=>null,
   complete:async()=>{requests++;return {text:'{"type":"final","answer":"FIXTURE_OK"}'};},
   createHost:async()=>({events:[],calls:0,assemble:async()=>({prompt:'fixture'}),verify:async()=>({passed:false}),close:async()=>{throw Error('cleanup');}})});
  const rows=JSON.parse(await readFile(join(dir,'results.private.json'),'utf8'));
  assert.equal(requests,1);assert.equal(summary.recordedArms,2);assert.equal(rows[0].status,'cleanup-failure');assert.equal(rows[1].status,'not-started');assert.equal(rows[1].missing,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('development amendment permits only single-argument JSON.stringify serialization',()=>{
 assert.equal(validateFixtureCode('const activation = await tools.activate_tool_group({tools:["parcel_beacon"]}); console.log(JSON.stringify(activation)); return await tools.parcel_beacon({});','parcel_beacon'),true);
 for(const code of ['JSON.parse("{}");','const method="stringify";JSON[method]({});','const JSON={}; console.log(JSON.stringify({}));','const stringify=JSON.stringify; stringify({});','JSON.stringify({}, tools.parcel_beacon);','JSON.stringify.constructor("return process")();','globalThis.JSON.stringify({});']) assert.throws(()=>validateFixtureCode(code,'parcel_beacon'));
});
test('ordinary error handling is allowed without opening callable aliases or global writes',()=>{
 assert.equal(validateFixtureCode('let result=null; try { result=await tools.parcel_beacon({}); } catch(e) { result={error:e?.message,name:e.name,toolName:e.toolName}; } return result;','parcel_beacon'),true);
 for(const code of ['try{}catch(tools){}','try{}catch(JSON){}','let t=tools; t.delete_file({});','let t=tools; t.name();','tools=1;','let t={}; t.message=1;','try{}catch(e){return e.constructor;}','try{}catch(e){e.message();}','try{}catch(e){let f="message";return e[f];}'])assert.throws(()=>validateFixtureCode(code,'parcel_beacon'));
});
test('literal member spelling shares the same static whitelist; expressions never become selectors',()=>{
 assert.equal(validateFixtureCode('return await tools["parcel_beacon"]({});','parcel_beacon'),true);
 assert.equal(validateFixtureCode('console["log"](JSON["stringify"]({ok:true}));','parcel_beacon'),true);
 for(const code of ['return tools["constructor"]({});','return tools["delete_file"]({});','return tools["parcel_"+"beacon"]({});','return tools[`parcel_beacon`]({});','return JSON["parse"]("{}");'])assert.throws(()=>validateFixtureCode(code,'parcel_beacon'));
});
