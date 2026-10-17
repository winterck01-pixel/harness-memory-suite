import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHostFixture} from './fixture.mjs';
import {ActivationLearningPipeline} from '../pipeline/index.mjs';

test('actual host streams persisted events and consumer restart resumes without new human input',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'activation-stream-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let consumer=new ActivationLearningPipeline({directory});let writes=0;
 const sourceId='streaming-reliability-only',taskId=sourceId;
 const h=await createHostFixture({sourceId,taskId,onEvent:event=>{const receipt=consumer.ingest([event],{consent:true});assert.equal(receipt.added,1);writes++;}});
 try{
  const failure=await h.run('await tools.activate_tool_group({tools:["fixture_probe"]});return await tools.fixture_probe({});');assert.equal(failure.isError,true);assert.equal(h.calls,0);
  const before=h.events.length;assert.equal(writes,before);
  // Drop all in-memory consumer state. No new human message is sent to host.
  consumer=new ActivationLearningPipeline({directory});assert.equal(consumer.snapshot().sources[sourceId].cursor,before);
  assert.equal(consumer.propose({sourceId,taskId}).status,'insufficient-evidence');
  await h.assemble();const repaired=await h.run('return await tools.fixture_probe({});');assert.equal(repaired.isError,false);await h.verify();
  const candidate=consumer.propose({sourceId,taskId});assert.equal(candidate.status,'proposed');
  const reopened=new ActivationLearningPipeline({directory});const replay=reopened.ingest(h.events,{consent:true});assert.equal(replay.added,0);assert.equal(replay.duplicates,h.events.length);assert.equal(replay.conflicts,0);assert.equal(reopened.propose({sourceId,taskId}).id,candidate.id);assert.equal(Object.keys(reopened.snapshot().candidates).length,1);
  assert.equal(writes,h.events.length);
 }finally{await h.close();}
});

test('synchronous event callback failure latches and blocks subsequent program execution',async()=>{
 let reject=false;const h=await createHostFixture({onEvent:event=>{if(reject&&event.type==='binding-snapshot')throw Error('STREAM_WRITE_FAILED');}});
 try{reject=true;await assert.rejects(h.run('return await tools.activate_tool_group({tools:["fixture_probe"]});'),/STREAM_WRITE_FAILED/);assert.equal(h.calls,0);await assert.rejects(h.run('return 1;'),/STREAM_WRITE_FAILED/);await assert.rejects(h.assemble(),/STREAM_WRITE_FAILED/);}
 finally{await h.close();}
});
