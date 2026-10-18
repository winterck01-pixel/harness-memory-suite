import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {authorizationUrl,callbackServer,REDIRECT} from './kling-auth-core.js';
import {createKlingAuth,klingAuthRoutes} from './kling-auth.js';
const url=(state='fixture-state')=>'https://klingai.com/auth/authorize?'+new URLSearchParams({state,redirect_uri:REDIRECT,response_type:'code',code_challenge:'fixture-challenge',code_challenge_method:'S256'});
test('only exact Kling authorization endpoint, redirect, state and PKCE accepted',()=>{
 assert.equal(authorizationUrl(url()).hostname,'klingai.com');
 for(const [key,value]of [['redirect_uri','http://attacker.invalid/cb'],['code_challenge_method','plain'],['state',''],['response_type','token']]){const u=new URL(url());u.searchParams.set(key,value);assert.throws(()=>authorizationUrl(u))}
 for(const value of [url().replace('klingai.com','klingai.com.attacker.invalid'),url().replace('/auth/authorize','/other'),url()+'&state=duplicate',url()+'#fragment'])assert.throws(()=>authorizationUrl(value));
});
test('callback rejects stale/wrong state, consumes code once and expires',async()=>{
 let got='',time=1;const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const server=await callbackServer({port,now:()=>time,deadline:100,onCode:c=>got=c});server.setUrl(url());
 const get=q=>fetch('http://127.0.0.1:'+port+'/oauth/callback?'+q,{headers:{connection:'close'}});
 try{assert.equal((await get('code=fake&state=wrong')).status,400);assert.equal(got,'');assert.equal((await get('code=fake&state=fixture-state&state=duplicate')).status,400);assert.equal((await get('code=fake&state=fixture-state')).status,200);assert.equal(got,'fake');assert.equal((await get('code=again&state=fixture-state')).status,410)}finally{await server.close()}
 const other=await callbackServer({port,now:()=>time,deadline:100,onCode:()=>assert.fail()});other.setUrl(url('new-state'));time=101;try{assert.equal((await get('code=fake&state=new-state')).status,410)}finally{await other.close()};
});
test('auth routes enforce authentication and same origin without leaking links',async()=>{
 let calls=0;const service={status:async()=>({status:'waiting'}),action:async()=>{calls++;return {accepted:true}},open:async()=>url()};
 const routes=klingAuthRoutes(service,{requestRejection:({headers})=>headers.authorization==='fixture'?undefined:401});
 const route=routes.find(r=>r.path.endsWith('/start'));
 assert.equal((await route.fetch(new Request('http://fixture/api',{method:'POST'}))).status,401);
 assert.equal((await route.fetch(new Request('http://fixture/api',{method:'POST',headers:{authorization:'fixture',origin:'http://foreign',host:'fixture'}}))).status,403);
 const response=await route.fetch(new Request('http://fixture/api',{method:'POST',headers:{authorization:'fixture',origin:'http://fixture',host:'fixture'}}));assert.equal(response.status,202);assert.equal(calls,1);
 const open=await routes.find(r=>r.path.endsWith('/open')).fetch(new Request('http://fixture/api',{headers:{authorization:'fixture','sec-fetch-site':'cross-site'}}));assert.equal(open.status,403);
});
test('background enable returns before OAuth completion, cancel targets only Kling',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'auth-service-'));let enabled=false,resolveEnable;const calls=[];
 const entry={id:'include:kling-ai-remote',options:{name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'Plugin-DeepSeek-kling-ai',args:['/fixture/kling-auth-bridge.mjs']}},fiber:{state:1},get disabled(){return !enabled}};
 const ctx={loader:{entries:()=>[entry]},get:name=>name==='pluginManager'?{async setPluginEnabled(id,on){calls.push([id,on]);enabled=on;if(on)await new Promise(r=>resolveEnable=r);return {ok:true}}}:null};
 const auth=createKlingAuth(ctx,{dir,alive:()=>true,launch:async()=>{}});
 try{
  assert.equal((await auth.status()).status,'disabled');await writeFile(join(dir,'status.json'),JSON.stringify({id:'previous',pid:100,status:'expired',expiresAt:1}),{mode:0o600});assert.deepEqual(await auth.action('start'),{accepted:true});assert.ok(['starting','connecting'].includes((await auth.status()).status));
  for(let i=0;i<20&&!resolveEnable;i++)await new Promise(r=>setTimeout(r,5));assert.ok(resolveEnable);
  await writeFile(join(dir,'status.json'),JSON.stringify({id:'current',pid:100,status:'waiting',expiresAt:Date.now()+10000,authorizationUrl:url()}),{mode:0o600});
  assert.equal((await auth.status()).status,'waiting');assert.equal(await auth.open(),url());
  await auth.action('cancel');resolveEnable();await new Promise(r=>setTimeout(r,20));
  assert.equal(calls.at(-1)[1],false);assert.ok(calls.every(c=>c[0]==='include:kling-ai-remote'));
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('cancel still disables Kling when the pending enable fails',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'auth-cancel-fail-'));let enabled=false,rejectEnable;const calls=[];
 const entry={id:'include:kling-ai-remote',options:{name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'Plugin-DeepSeek-kling-ai',args:['/fixture/kling-auth-bridge.mjs']}},fiber:{state:1},get disabled(){return !enabled}};
 const auth=createKlingAuth({loader:{entries:()=>[entry]},get:name=>name==='pluginManager'?{async setPluginEnabled(id,on){calls.push([id,on]);enabled=on;if(on)await new Promise((_r,j)=>rejectEnable=j);return {ok:true}}}:null},{dir,alive:()=>true,launch:async()=>{}});
 try{await auth.action('start');for(let i=0;i<40&&!rejectEnable;i++)await new Promise(r=>setTimeout(r,5));assert.ok(rejectEnable);await auth.action('cancel');rejectEnable(Error('synthetic startup failure'));for(let i=0;i<40&&enabled;i++)await new Promise(r=>setTimeout(r,5));assert.equal(enabled,false);assert.equal(calls.at(-1)[1],false);assert.ok(calls.every(c=>c[0]==='include:kling-ai-remote'))}finally{await rm(dir,{recursive:true,force:true})}
});

test('disposing the owner during authorization never enables the MCP entry',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'auth-dispose-'));let done,dispose,enabled=false;const calls=[];
 const entry={id:'include:kling-ai-remote',options:{name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'Plugin-DeepSeek-kling-ai',args:['/fixture/kling-auth-bridge.mjs']}},fiber:{state:1},get disabled(){return !enabled}};
 const auth=createKlingAuth({loader:{entries:()=>[entry]},effect(fn){dispose=fn()},get:()=>({async setPluginEnabled(_id,on){calls.push(on);enabled=on;return {ok:true}}})},{dir,launch:()=>new Promise(r=>done=r)});
 try{await auth.action('start');for(let i=0;i<40&&!done;i++)await new Promise(r=>setTimeout(r,5));assert.ok(done);dispose();done();await new Promise(r=>setTimeout(r,20));assert.equal(enabled,false);assert.deepEqual(calls,[false])}finally{await rm(dir,{recursive:true,force:true})}
});
