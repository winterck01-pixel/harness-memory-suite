import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine as videoEngine} from './generation.js';
import {createEngine as imageEngine} from '../image-studio/generation.js';
const until=async predicate=>{for(let i=0;i<200&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert.ok(predicate());};
const config={baseUrl:'https://toapis.com',adapter:'toApisUnifiedVideo',queryPath:'/v1/tasks/{id}',modelName:'fixture'};
const row=(id='old')=>({id,remoteId:'remote-'+id,model:'fixture',createdAt:1,status:'completed',stage:'completed',results:[{id:'saved'}],billing:{status:'pending'},config});
for(const [kind,createEngine] of [['video',videoEngine],['image',imageEngine]])test(`${kind} late billing checks use GET only, retain assets and stop after settlement`,async()=>{
 let rows=[row()],calls=0;
 const engine=createEngine({readTasks:async()=>structuredClone(rows),writeTasks:async t=>{rows=structuredClone(t);},getKey:async()=> 'fixture',getRequestKey:async()=> 'fixture',fetchImpl:async(url,opts)=>{calls++;assert.match(url,/\/v1\/tasks\/remote-old$/);assert.equal(opts.method,undefined);return new Response(JSON.stringify({status:'completed',result:{data:[{url:'https://never-download.invalid/movie.mp4'}]},billing:{status:'settled',credits:'154.52',cost_usd:'0.15452'}}));},fetchResult:async()=>{throw Error('must not download');},saveImage:async()=>{throw Error('must not save asset');},pollMs:5});
 await engine.start();try{await until(()=>rows[0].billing?.status==='settled');assert.equal(rows[0].billing.credits,'154.52');assert.equal(rows[0].billingCheck.status,'confirmed');assert.equal(rows[0].billingCheck.attempts,1);assert.equal(rows[0].status,'completed');assert.deepEqual(rows[0].results,[{id:'saved'}]);await engine.reconcileBilling();assert.equal(calls,1);}finally{await engine.stop();}
});
test('archived video billing scans a bounded page and evicts protected hydration after save',async()=>{
 const archived=row('archived'),hot={...row('hot'),config:{...config,baseUrl:'https://other.invalid'}};let calls=0,finds=0,pages=0;const stored=new Map([[hot.id,hot],[archived.id,archived]]);
 const history={initialize:async()=>{},recent:()=>[stored.get('hot')],residentIds:()=>['hot'],page:opts=>{pages++;assert.equal(opts.limit,100);assert.equal(opts.offset,0);return {tasks:[structuredClone(archived)],nextOffset:null,total:1};},find:id=>{finds++;return structuredClone(stored.get(id));},save:async tasks=>{for(const t of tasks)stored.set(t.id,structuredClone(t));},close:()=>{}};
 const engine=videoEngine({readTasks:async()=>[hot,archived],taskHistory:history,getRequestKey:async()=> 'fixture',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({billing:{status:'settled',credits:'6.1188'}}));},pollMs:5});
 await engine.start();try{await until(()=>stored.get('archived').billingCheck?.status==='confirmed');assert.equal(calls,1);assert.equal(finds,1);assert.equal(pages,1);assert.equal(engine.list().length,1);assert.equal((await engine.find('archived')).billing.credits,'6.1188');}finally{await engine.stop();}
});
for(const [kind,createEngine]of [['video',videoEngine],['image',imageEngine]])test(`${kind} billing query receives deadline signal and shutdown aborts inflight GET`,async t=>{
 const originalTimeout=AbortSignal.timeout,deadlines=[];AbortSignal.timeout=function(ms){deadlines.push(ms);return originalTimeout.call(AbortSignal,ms);};t.after(()=>{AbortSignal.timeout=originalTimeout;});
 let observed,started;const ready=new Promise(resolve=>{started=resolve;});
 const engine=createEngine({readTasks:async()=>[row()],writeTasks:async()=>{},getRequestKey:async()=> 'fixture',fetchImpl:async(url,options)=>{observed=options.signal;started();return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});},pollMs:5});
 await engine.start();await ready;assert.ok(deadlines.includes(15000),'billing has its own 15 second deadline');assert.ok(observed instanceof AbortSignal);assert.equal(observed.aborted,false);await engine.stop();assert.equal(observed.aborted,true);
});
