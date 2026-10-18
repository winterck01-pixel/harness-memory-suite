import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRelay} from './channel-relay.js';

test('missing channel adapter becomes actionable instead of waiting forever',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'video-relay-'));
  const bindingPath=join(dir,'bindings.json'),media=join(dir,'video.mp4');
  await writeFile(bindingPath,JSON.stringify({home:{sessionId:'s',channelId:'weixin',accountId:'main',conversationId:'chat',conversationType:'dm'}}));
  await writeFile(media,Buffer.from('mp4'));
  const tasks=[{id:'task',sessionId:'s',status:'completed',results:[{id:'asset',path:media,type:'video/mp4',name:'video.mp4'}]}];
  const relay=await createRelay({dir,bindingPath,getAdapter:()=>null,getTasks:()=>tasks,getSession:()=>({header:{cwd:dir}})});
  try{
    await relay.enroll(tasks[0]);
    await relay.tick();
    const summary=relay.summary('task');
    assert.equal(summary.status,'adapter_missing');
    assert.match(summary.error,/适配器/);
  }finally{await relay.stop();await rm(dir,{recursive:true,force:true})}
});


test('failed video sends retry before attention',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'video-relay-retry-'));
  const bindingPath=join(dir,'bindings.json'),media=join(dir,'video.mp4');
  await writeFile(bindingPath,JSON.stringify({home:{sessionId:'s',channelId:'telegram',accountId:'main',conversationId:'chat',conversationType:'dm'}}));
  await writeFile(media,Buffer.from('mp4'));
  const tasks=[{id:'task',sessionId:'s',status:'completed',results:[{id:'asset',path:media,type:'video/mp4',name:'video.mp4'}]}];
  let sends=0;
  const relay=await createRelay({dir,bindingPath,getAdapter:()=>({capabilities:{video:true,image:true},send:async()=>{sends++;return {delivered:false}}}),getTasks:()=>tasks,getSession:()=>({header:{cwd:dir}})});
  try{await relay.enroll(tasks[0]);await relay.tick();await new Promise(ok=>setTimeout(ok,1600));await relay.tick();assert.equal(sends,3);assert.equal(relay.summary('task').items[0].attempts,2)}finally{await relay.stop();await rm(dir,{recursive:true,force:true})}
});

test('archived generation receipts still deduplicate existing media delivery',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'video-relay-archive-'));
 const bindingPath=join(dir,'bindings.json'),media=join(dir,'video.mp4');
 await writeFile(bindingPath,JSON.stringify({home:{sessionId:'s',channelId:'telegram',accountId:'main',conversationId:'chat',conversationType:'dm'}}));
 await writeFile(media,Buffer.from('mp4'));
 const task={id:'archived',sessionId:'s',status:'completed',results:[{id:'asset',path:media,type:'video/mp4'}]};
 let sends=0,lookups=0;
 const relay=await createRelay({dir,bindingPath,getAdapter:()=>({capabilities:{video:true},send:async()=>{sends++;return {delivered:true}}}),getTasks:()=>[],getTask:async id=>{lookups++;return id===task.id?task:undefined},getSession:()=>({header:{cwd:dir}})});
 try{await relay.enroll(task);await relay.tick();assert.equal(sends,1);assert.equal((await relay.sendExisting('s',media)).status,'sent');assert.equal(sends,1);assert.ok(lookups>=2)}finally{await relay.stop();await rm(dir,{recursive:true,force:true})}
});
