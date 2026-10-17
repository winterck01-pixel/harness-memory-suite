import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {capture} from './capture.mjs';
import {ActivationLearningPipeline} from './pipeline/index.mjs';

// Unit-only trace: the separate host reproduction validates these observations
// against actual installed components. This does not stand in for that result.
function report(){
 const actions=[
  ['assembly','a',0,{transportNames:['run_code']}],
  ['action','p1',0,{operation:'program',arguments:{code:'await tools.activate_tool_group({tools:["sample_echo"]});return await tools.sample_echo({});'}}],
  ['binding-snapshot','p1',0,{names:['activate_tool_group']}],
  ['action','p1:ptc:1',0,{operation:'activate',arguments:{tools:['sample_echo']},activationMode:'next-step'}],
  ['result','p1:ptc:1',0,{ok:true,result:{value:{availableOnNextStep:true,enabled:['sample_echo']}}}],
  ['result','p1',0,{ok:false,result:{error:{message:'TypeError: tools.sample_echo is not a function'}}}],
  ['assembly','b',1,{transportNames:['run_code']}],
  ['action','p2',1,{operation:'program',arguments:{code:'return await tools.sample_echo({});'}}],
  ['binding-snapshot','p2',1,{names:['sample_echo']}],
  ['action','p2:ptc:1',1,{operation:'invoke'}],
  ['result','p2:ptc:1',1,{ok:true}],
  ['result','p2',1,{ok:true}],
  ['verification','p2:ptc:1',1,{passed:true,claim:'fixture-marker-executed'}],
 ];
 return {kind:'actual-host-contract-reproduction',episodes:[{id:'activation-observed',events:actions.map(([type,callId,step,payload],i)=>({sourceId:'activation-observed',taskId:'activation-observed',seq:i+1,type,callId,step,payload,tool:callId==='p2:ptc:1'?'sample_echo':'run_code',contractFingerprint:'unit-contract'}))}]};
}
async function setup(t){const directory=await mkdtemp(join(tmpdir(),'activation-capture-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));const args={reportPath:join(directory,'source.json'),stateDirectory:join(directory,'state'),outputDirectory:join(directory,'outputs')};await writeFile(args.reportPath,JSON.stringify(report()));return args;}
const artifacts=async args=>Promise.all(['candidate.json','review-packet.json'].map(f=>readFile(join(args.outputDirectory,f),'utf8')));

test('complete replay preserves identical review inputs and one candidate',async t=>{const args=await setup(t);const first=await capture(args),before=await artifacts(args),second=await capture(args);assert.equal(second.candidate.id,first.candidate.id);assert.deepEqual(await artifacts(args),before);assert.equal(Object.keys(second.pipeline.snapshot().candidates).length,1);assert.equal(second.consumption.added,0);});
test('restart after either partial output repairs only the absent artifact',async t=>{for(const missing of ['candidate.json','review-packet.json']){const args=await setup(t);await capture(args);const before=await artifacts(args);await rm(join(args.outputDirectory,missing));await capture(args);assert.deepEqual(await artifacts(args),before);}});
test('approved frozen replay preserves live reviews and reconstructs original pending packet',async t=>{const args=await setup(t);const initial=await capture(args),before=await artifacts(args);const p=new ActivationLearningPipeline({directory:args.stateDirectory,verifyHumanReceipt:()=>true});const c=initial.candidate;p.review(c.id,{actorType:'agent',decision:'accept',evidenceRefs:c.evidenceRefs});p.importHumanReviewReceipt({candidateId:c.id,candidateVersion:c.version,contentHash:c.contentHash,reviewPacketHash:c.reviewPacketHash,messageId:'unit-authenticated-message',text:'Unit test simulated verified approval',decision:'accept'});p.freeze(c.id,{evaluationConsent:true});const ledger=await readFile(join(args.stateDirectory,'learning-ledger.json'),'utf8');await rm(join(args.outputDirectory,'review-packet.json'));const again=await capture(args);assert.equal(again.candidate.status,'frozen-evaluation');assert.equal(again.candidate.humanReview,'accept');assert.equal(again.candidate.agentReview,'accept');assert.equal(again.packet.humanReview,'pending');assert.deepEqual(await artifacts(args),before);assert.equal(await readFile(join(args.stateDirectory,'learning-ledger.json'),'utf8'),ledger);});
test('edited candidate or packet is rejected without overwriting either artifact',async t=>{for(const edited of ['candidate.json','review-packet.json']){const args=await setup(t);await capture(args);const path=join(args.outputDirectory,edited),value=JSON.parse(await readFile(path,'utf8'));value.evidenceRefs=['different-proof'];await writeFile(path,JSON.stringify(value));const before=await artifacts(args);await assert.rejects(capture(args),/Capture artifact conflict/);assert.deepEqual(await artifacts(args),before);}});
test('partial conflicting output is rejected before creating its missing companion',async t=>{const args=await setup(t);await capture(args);const path=join(args.outputDirectory,'candidate.json'),value=JSON.parse(await readFile(path,'utf8'));value.instruction='tampered instruction';await writeFile(path,JSON.stringify(value));await rm(join(args.outputDirectory,'review-packet.json'));await assert.rejects(capture(args),/Capture artifact conflict/);await assert.rejects(readFile(join(args.outputDirectory,'review-packet.json')),error=>error.code==='ENOENT');});
