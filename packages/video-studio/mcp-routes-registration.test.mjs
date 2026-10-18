import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {apply as applyImage} from '../image-studio/index.js';
import {apply as applyVideo} from './index.js';

async function registerRoutes(apply,kind){
 const dir=await mkdtemp(join(tmpdir(),'mcp-routes-registration-'));
 const previous=process.env.DSH_HOME,routes=new Map(),disposers=[];
 process.env.DSH_HOME=dir;
 const ctx={
  on:()=>()=>{},
  credentials:{resolve:async()=>undefined,set:async()=>{}},
  get:()=>undefined,inject:()=>{},provide:()=>{},
  logger:{info(){},warn(){}},commands:{register:()=>()=>{}},
  connection:{fetch:{register(route){routes.set(route.path,route);return()=>routes.delete(route.path);}}},
  effect(fn){const dispose=fn();if(typeof dispose==='function')disposers.push(dispose);return dispose;},
 };
 try{
  await apply(ctx);
  return {routes,async close(){for(const dispose of disposers.reverse())await dispose();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;await rm(dir,{recursive:true,force:true});}};
 }catch(error){
  for(const dispose of disposers.reverse())try{await dispose()}catch{}
  if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;
  await rm(dir,{recursive:true,force:true});
  throw error;
 }
}

test('both real studio apply functions register shared config at studio root and WorkRally status under its namespace',async()=>{
 for(const [kind,apply] of [['image',applyImage],['video',applyVideo]]){
  const mounted=await registerRoutes(apply,kind);
  try{
   assert.ok(mounted.routes.has(`/api/${kind}-studio/config`),`${kind} config route must be studio-root scoped`);
   assert.ok(!mounted.routes.has(`/api/${kind}-studio/workrally/config`),`there is no provider-specific config route`);
   assert.ok(mounted.routes.has(`/api/${kind}-studio/workrally/status`));
   assert.ok(mounted.routes.has(`/api/${kind}-studio/workrally/discover`));
   assert.ok(mounted.routes.has(`/api/${kind}-studio/workrally/selection`));
  }finally{
   await mounted.close();
  }
 }
});
