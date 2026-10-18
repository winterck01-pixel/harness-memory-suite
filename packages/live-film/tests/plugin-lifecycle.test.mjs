import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import {apply} from '../index.js';

test('official Cordis plugin(apply) loads and disposes live-film without Invalid effect',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'live-film-cordis-')),previous=process.env.DSH_HOME,host=new Context(),routes=new Set(),tools=new Set();let fork,paidCalls=0;
 process.env.DSH_HOME=dir;
 host.provide('connection',{fetch:{register(route){routes.add(route);return()=>routes.delete(route)}}});
 host.provide('liveFilmVideo',{models:async()=>[],assets:async()=>[],tasks:async()=>[],submit:async()=>{paidCalls++;throw Error('paid submit forbidden')},recover:async()=>{}});
 host.provide('tools',{register(tool){tools.add(tool);return()=>tools.delete(tool)}});
 try{
  // This exercises Cordis' actual async effect return contract, not a ctx.effect fixture.
  fork=await host.plugin(apply);
  assert.ok(routes.size>0,'real plugin lifecycle should register HTTP handlers');
  assert.ok([...routes].some(r=>r.path==='/api/live-film/events'));
  assert.ok([...tools].some(t=>t.name==='live_film'));
  const state=await [...routes].find(r=>r.path==='/api/live-film/state').fetch(new Request('http://dsh.internal/api/live-film/state'));
  assert.equal(state.status,200);assert.deepEqual((await state.json()).projects,[]);
  assert.equal(paidCalls,0);
  await fork.dispose();fork=null;
  assert.equal(routes.size,0,'dispose must unregister all routes');assert.equal(tools.size,0,'dispose must unregister agent tools');
 }finally{await fork?.dispose();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;await rm(dir,{recursive:true,force:true})}
});
