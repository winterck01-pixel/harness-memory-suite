import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,realpath,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {apply as applyFileman} from '../../../file-manager/index.js';
import {availableAssets} from '../../available-assets.js';
import {createServerAssembly} from '../server-assembly.js';

test('actual index trash hook replays persisted receipt after filtered asset disappears and restart',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'native-trash-receipt-')));
 const services=new Map(),cleanup=[];
 const ctx={provide:(k,v)=>services.set(k,v),get:k=>services.get(k),effect:fn=>{const dispose=fn();cleanup.push(dispose);return dispose},inject(){},logger:{info(){},warn(){}}};
 let stop,assembly;let nativeCalls=0;
 try{
  stop=applyFileman(ctx,{root,writable:true,trash:true});
  const path=join(root,'synthetic.png');await writeFile(path,'synthetic fixture');
  const rows=[{id:'fixture-asset',path,name:'Synthetic',type:'image/png'}];
  // Execute the production index hook itself, preserving its filtered references lookup.
  const source=await readFile(new URL('../../index.js',import.meta.url),'utf8');
  const start=source.indexOf('nativeOperations:{')+'nativeOperations:'.length,end=source.indexOf('},authorize:',start)+1;
  assert.ok(start>0&&end>start);
  const hooks=vm.runInNewContext('('+source.slice(start,end)+')',{ctx,references:()=>availableAssets(rows)});
  const nativeOperations={trashAsset:async(...args)=>{nativeCalls++;return hooks.trashAsset(...args)}};
  const execution={agent:{session:{id:'fixture-session'}},signal:new AbortController().signal};
  const boot=async()=>{
   assembly=createServerAssembly({rootDir:join(root,'editor'),nativeOperations});await assembly.ready;
   let tool;assembly.registerAgentTools({inject(_deps,fn){fn({tools:{register(value){tool=value;return()=>{}}},effect:fn=>fn()})}},{authorizeAgent:async()=>true});
   return input=>tool.execute({action:'trash_asset',input},execution);
  };
  let call=await boot();const input={id:'fixture-asset',requestId:'stable-trash'};
  const first=await call(input);assert.equal(first.trashed,true);assert.equal(first.id,input.id);assert.ok(first.recovery);
  await assert.rejects(access(path));assert.equal((await availableAssets(rows)).length,0);
  assert.deepEqual(await call(input),first);assert.equal(nativeCalls,1);
  await assert.rejects(call({...input,id:'changed-asset'}),e=>e.code==='REQUEST_CONFLICT');assert.equal(nativeCalls,1);
  await assembly.dispose();assembly=null;call=await boot();assert.deepEqual(await call(input),first);assert.equal(nativeCalls,1);
  const persisted=await readFile(join(root,'editor','agent-generation-receipts.json'),'utf8');
  assert.ok(!persisted.includes(root),'receipt must not persist or reveal absolute source paths');
 }finally{await assembly?.dispose();await stop?.();for(const dispose of cleanup.reverse())await dispose?.();await rm(root,{recursive:true,force:true})}
});
