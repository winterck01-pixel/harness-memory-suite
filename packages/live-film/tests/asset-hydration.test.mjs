import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLiveFilmHost} from '../index.js';
import {run} from '../media.js';

test('video assets with dimensions hydrate missing or invalid duration before state exposes them',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'film-duration-')),previous=process.env.DSH_HOME,cleanup=[],routes=[];
 process.env.DSH_HOME=dir;
 try{
  const path=join(dir,'source.mp4');await run('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=s=64x64:d=1','-c:v','libx264','-pix_fmt','yuv420p',path]);
  const durations=[undefined,null,0,-1,'1',Infinity,NaN,2];
  const assets=durations.map((duration,i)=>({id:'video-'+i,type:'video/mp4',width:64,height:64,duration,path}));
  const ctx={connection:{fetch:{register:r=>{routes.push(r);return()=>{}}}},liveFilmVideo:{assets:async()=>assets,models:async()=>[],tasks:async()=>[],submit:async()=>{throw Error('provider forbidden')}},effect:fn=>{const dispose=fn();if(typeof dispose==='function')cleanup.push(dispose)}};
  await createLiveFilmHost(ctx,{authorizeAgent:async()=>{throw Error('agent forbidden')}});
  const state=await routes.find(r=>r.path==='/api/live-film/state').fetch(new Request('http://dsh.internal/api/live-film/state'));
  assert.equal(state.status,200);const rows=(await state.json()).assets;
  for(let i=0;i<durations.length-1;i++){const a=rows.find(a=>a.id==='video-'+i);assert.equal(a.duration,1);assert.equal(a.width,64);assert.equal(a.height,64)}
  assert.equal(rows.find(a=>a.id==='video-7').duration,2,'complete metadata should remain unchanged');
 }finally{for(const dispose of cleanup)dispose();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;await rm(dir,{recursive:true,force:true})}
});
