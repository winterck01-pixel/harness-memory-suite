import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ActivationShadowCapture} from '../lib/activation-shadow.js';
const scope='project:test';
const e=(seq,type,data={})=>({seq,type,data});
const session=events=>({id:'fixture-session',header:{cwd:'/fixture'},seq:events.at(-1)?.seq+1,snapshotEvents:(a,b)=>events.filter(e=>e.seq>=a&&e.seq<b)});
const events=()=>[e(0,'turn/start',{turn:1}),e(1,'user/message',{source:{kind:'user'},content:[{type:'text',text:'Inspect the fixture'}]}),e(2,'tool/call',{turn:1,step:1,callId:'c1',name:'run_code',arguments:JSON.stringify({code:'await tools.activate_tool_group({tools:["fixture_probe"]});return tools.fixture_probe({});'})}),e(3,'tool/result',{turn:1,step:1,message:{toolCallId:'c1',isError:true,content:[{type:'text',text:'TypeError: tools.fixture_probe is not a function'}]}})];
function fixture(fn){const directory=mkdtempSync(join(tmpdir(),'mnemo-shadow-'));try{return fn(directory)}finally{rmSync(directory,{recursive:true,force:true})}}
test('native outer error becomes evidence-limited candidate; restart is idempotent',()=>fixture(directory=>{let c=new ActivationShadowCapture({directory,enabled:true,contractFingerprint:'host-v1'});const s=session(events());assert.equal(c.capture(s,{scope}).candidates,1);let state=c.snapshot();const candidate=Object.values(state.sources)[0].candidates[0];assert.equal(candidate.status,'needs-review');assert.equal(candidate.permission,'unknown');assert.equal(candidate.productionEligible,false);assert.equal(JSON.stringify(state).includes('Inspect the fixture'),false);c=new ActivationShadowCapture({directory,enabled:true,contractFingerprint:'host-v1'});assert.equal(c.capture(s,{scope}).added,0)}));
test('continuation without human is consumed and caught printed error is not failure',()=>fixture(directory=>{const c=new ActivationShadowCapture({directory,enabled:true});const rows=events();c.capture(session(rows),{scope});rows.push(e(4,'turn/start',{turn:2}),e(5,'tool/call',{turn:2,step:1,callId:'c2',name:'run_code',arguments:'{"code":"return 1"}'}),e(6,'tool/result',{turn:2,message:{toolCallId:'c2',isError:false,content:[{type:'text',text:'caught TypeError: tools.x is not a function'}]}}));assert.equal(c.capture(session(rows),{scope}).added,3);assert.equal(Object.values(c.snapshot().sources)[0].candidates.length,1)}));
test('turn optout excludes current rows and next real human can resume; explicit withdraw is permanent',()=>fixture(directory=>{const c=new ActivationShadowCapture({directory,enabled:true});const rows=events();c.capture(session(rows),{scope});rows.push(e(4,'user/message',{source:{kind:'user'},content:[{type:'text',text:'本轮不要记录记忆'}]}));assert.equal(c.capture(session(rows),{scope}).status,'capture-disabled-for-turn');assert.equal(Object.values(c.snapshot().sources)[0].candidates.length,0);rows.push(e(5,'turn/start',{turn:2}),e(6,'user/message',{source:{kind:'user'},content:[{type:'text',text:'Inspect another fixture'}]}));assert.equal(c.capture(session(rows),{scope}).status,'complete');c.withdraw({sessionId:'fixture-session',scope});assert.equal(c.capture(session(rows),{scope}).status,'withdrawn')}));
test('disabled/read-only have no filesystem side effects',()=>fixture(directory=>{const path=join(directory,'unused');const c=new ActivationShadowCapture({directory:path,enabled:true});assert.equal(c.capture(session(events()),{scope,readOnly:true}).status,'read-only');assert.equal(existsSync(path),false)}));
test('missing persistent sequence and conflicting payload remain visible',()=>fixture(directory=>{const c=new ActivationShadowCapture({directory,enabled:true});const rows=events().filter(x=>x.seq!==2);assert.equal(c.capture(session(rows),{scope}).status,'incomplete');assert.equal(Object.values(c.snapshot().sources)[0].candidates.length,0);const full=events();c.capture(session(full),{scope});full[3].data.message.isError=false;assert.equal(c.capture(session(full),{scope}).status,'conflict');assert.equal(Object.values(c.snapshot().sources)[0].candidates.length,0)}));

test('native ptc activation acknowledgement and later repair preserve unknown permissions',()=>fixture(directory=>{
 const c=new ActivationShadowCapture({directory,enabled:true,contractFingerprint:'host-v1'});
 const rows=[...events().slice(0,3),e(3,'tool/ptc-dispatch',{rootCallId:'c1',subCallId:'a1',name:'activate_tool_group',arguments:{tools:['fixture_probe']},isError:false,content:[{type:'text',text:JSON.stringify({enabled:['fixture_probe'],availableOnNextStep:true})}]}),e(4,'tool/result',{turn:1,step:1,message:{content:[{type:'tool-result',callId:'c1',isError:true,content:'TypeError: tools.fixture_probe is not a function'}]}}),e(5,'tool/call',{turn:1,step:2,callId:'c2',name:'run_code',arguments:'{}'}),e(6,'tool/ptc-dispatch',{rootCallId:'c2',subCallId:'p1',name:'fixture_probe',arguments:{},isError:false,content:[{type:'text',text:'ok'}]})];
 c.capture(session(rows),{scope});const candidate=Object.values(c.snapshot().sources)[0].candidates[0];assert.equal(candidate.activationState,'next-step-acknowledged');assert.equal(candidate.repairState,'later-dispatch-succeeded');assert.equal(candidate.bindingSnapshot,'unobserved');assert.equal(candidate.permission,'unknown');assert.equal(candidate.instruction,null);
}));

test('adapter consumes actual session source independently of legacy turn-end human requirement',async()=>fixture(async directory=>{
 const {DshAdapter}=await import('../dsh-adapter.js');const shadow=new ActivationShadowCapture({directory,enabled:true});
 const engine={activateSession(){}};const adapter=new DshAdapter(engine,{activationShadow:shadow});
 const rows=events(),s=session(rows);adapter.handleSessionEvent({},s,rows.at(-1));
 assert.equal(Object.values(shadow.snapshot().sources)[0].candidates.length,1);
 adapter.readOnly=true;rows.push(e(4,'turn/start',{turn:2}));adapter.handleSessionEvent({},session(rows),e(5,'tool/result',{message:{content:[]}}));
 assert.equal(Object.values(shadow.snapshot().sources)[0].cursor,3);
}));

test('global quotas pause without evicting sources; withdrawal still works',()=>fixture(directory=>{
 const c=new ActivationShadowCapture({directory,enabled:true,maxSources:1,maxTotalEvents:4});c.capture(session(events()),{scope});
 const second={...session(events()),id:'other-session'};assert.equal(c.capture(second,{scope}).status,'quota-paused');assert.equal(c.report().lastError,'max-sources');
 const rows=events();rows.push(e(4,'turn/start',{turn:2}),e(5,'user/message',{source:{kind:'user'},content:[{type:'text',text:'continue'}]}));assert.equal(c.capture(session(rows),{scope}).status,'incomplete');assert.equal(c.report().eventCount,4);assert.equal(c.report().lastError,'event-budget-paused');
 assert.equal(c.withdraw({sessionId:'fixture-session',scope}).status,'withdrawn');assert.equal(c.report().eventCount,0);
}));

test('byte quota does not commit partial cursor or candidates',()=>fixture(directory=>{
 const c=new ActivationShadowCapture({directory,enabled:true,maxBytes:300});assert.equal(c.capture(session(events()),{scope}).status,'quota-paused');assert.equal(c.report().eventCount,0);assert.equal(c.report().lastError,'max-bytes');
}));

test('writer capability is bound privately and rechecked at commit',()=>fixture(directory=>{
 let writable=true;const c=new ActivationShadowCapture({directory,enabled:true,canWrite:()=>writable});const rows=events();c.capture(session(rows),{scope});const before=c.snapshot();
 const revoked={...session(rows),snapshotEvents:(a,b)=>{writable=false;return rows.filter(e=>e.seq>=a&&e.seq<b)}};
 assert.throws(()=>c.capture(revoked,{scope,readOnly:false}),/read-only/);assert.deepEqual(c.snapshot(),before);
 assert.equal(c.withdraw({sessionId:'fixture-session',scope,readOnly:false}).status,'read-only');
}));
