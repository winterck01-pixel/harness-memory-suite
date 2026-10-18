import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,access,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {apply} from './index.js';

test('workshop trash uses actual file-manager writable/root/trash semantics and durable recovery metadata',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'workshop-fileman-'))),outside=await realpath(await mkdtemp(join(tmpdir(),'workshop-outside-')));
 const services=new Map(),effects=[];
 const ctx={provide:(k,v)=>services.set(k,v),get:k=>services.get(k),effect:fn=>{const dispose=fn();effects.push(dispose);return dispose},inject(){},logger:{info(){},warn(){}}};
 let stop;
 try{
  stop=apply(ctx,{root,writable:true,trash:true});
  const file=join(root,'synthetic.png'),other=join(outside,'untouched.png');await writeFile(file,'fixture');await writeFile(other,'outside');
  const execution={agent:{session:{id:'synthetic-session'}},signal:new AbortController().signal};
  const service=services.get('filemanMedia');
  const first=await service.trash([file],{execution,requestId:'one'});
  assert.equal(first.results[0].ok,true,JSON.stringify(first));await assert.rejects(access(file));
  assert.deepEqual(await service.trash([file],{execution,requestId:'one'}),first);
  const denied=await service.trash([other],{execution,requestId:'outside'});assert.equal(denied.results[0].ok,false);assert.equal(await readFile(other,'utf8'),'outside');
  await assert.rejects(service.trash([file],{requestId:'no-owner'}),/可信会话/);
  assert.ok(first.results[0].restored,'same native trash handler returns recovery metadata');
 }finally{await stop?.();for(const dispose of effects.reverse())await dispose?.();await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
});
