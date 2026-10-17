import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHostFixture,contractManifest} from './fixture.mjs';
const episodes=[];
async function scenario(id,options,fn){const h=await createHostFixture({taskId:id,sourceId:id,...options});try{const observed=await fn(h);episodes.push({id,observed,events:h.events});}finally{await h.close();}}
await scenario('activation-observed',{},async h=>{
 const before=await h.run('return await tools.fixture_probe({});');assert.equal(before.isError,true);
 const same=await h.run('await tools.activate_tool_group({tools:["fixture_probe"]});return await tools.fixture_probe({});');assert.equal(same.isError,true);assert.equal(h.calls,0);
 const newRunOnly=await h.run('return await tools.fixture_probe({});');assert.equal(newRunOnly.isError,true,'A new program without prompt assembly still has old allowed view');
 await h.assemble();const next=await h.run('return await tools.fixture_probe({});');assert.equal(next.isError,false);assert.equal(next.value.result,'FIXTURE_OK');
 assert.equal((await h.verify()).passed,true);
 const snaps=h.events.filter(e=>e.type==='binding-snapshot');assert.equal(snaps[1].payload.names.includes('fixture_probe'),false);assert.equal(snaps.at(-1).payload.names.includes('fixture_probe'),true);
 return {beforeError:before.error.message.includes('is not a function'),sameRunError:same.error.message.includes('is not a function'),newRunWithoutAssemblyError:newRunOnly.isError,nextStepSuccess:!next.isError,calls:h.calls};
});
await scenario('activation-denied',{denyTarget:true},async h=>{await h.run('return await tools.activate_tool_group({tools:["fixture_probe"]});');await h.assemble();const r=await h.run('return await tools.fixture_probe({});');assert.equal(r.isError,true);assert.match(r.error.message,/FIXTURE_PERMISSION_DENIED/);assert.equal((await h.verify()).passed,true);return {denied:true,calls:h.calls};});
await scenario('activation-wrong-name',{},async h=>{const r=await h.run('return await tools.activate_tool_group({tools:["fixture_absent"]});');assert.equal(r.isError,true);assert.match(r.error.message,/CAPABILITY_UNAVAILABLE_OR_DISABLED/);assert.equal(h.calls,0);return {unknownNameRejected:true};});
await scenario('activation-user-disabled',{userText:'不要调用任何工具'},async h=>{const r=await h.run('return await tools.activate_tool_group({tools:["fixture_probe"]});');assert.equal(r.isError,true);assert.equal(h.events.some(e=>e.type==='binding-snapshot'),false);assert.equal(h.calls,0);return {transportBlocked:true,calls:h.calls};});
await scenario('activation-already-active',{initiallyActive:true},async h=>{const r=await h.run('return await tools.fixture_probe({});');assert.equal(r.isError,false);assert.equal(h.calls,1);await h.verify();return {successWithoutRepeatedActivation:true};});
const report={schemaVersion:1,kind:'actual-host-contract-reproduction',nodeVersion:process.version,manifest:await contractManifest(),episodes};
if(process.argv[2]){await mkdir(dirname(process.argv[2]),{recursive:true});await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:episodes.length,kind:report.kind,contractFingerprint:report.manifest.fingerprint,scenarios:episodes.map(({id,observed})=>({id,...observed}))}));
