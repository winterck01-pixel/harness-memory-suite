import {createServer} from 'node:net';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const fixture=`
export const JSONRPCMessageSchema={parse:v=>v};
export class NodeOAuthClientProvider{constructor(options){this.options=options}}
export async function parseCommandLineArgs(){return {serverUrl:'https://klingai.com/mcp',headers:{},callbackPath:'/oauth/callback',serverUrlHash:'fixture-only'}}
export async function discoverOAuthServerInfo(){return {authorizationServerUrl:'https://klingai.com/auth'}}
export async function connectToRemoteServer(_a,_url,p,_h,init){
 await p.redirectToAuthorization('https://klingai.com/auth/authorize?state=synthetic-state&redirect_uri=http%3A%2F%2Flocalhost%3A25827%2Foauth%2Fcallback&response_type=code&code_challenge=synthetic-challenge&code_challenge_method=S256');
 const a=await init();const code=await a.waitForAuthCode();if(code!=='synthetic-only-code')throw Error();return {async close(){}};
}
export function mcpProxy({transportToClient:t}){t.onmessage=message=>{if(message.method==='initialize')void t.send({jsonrpc:'2.0',id:message.id,result:{protocolVersion:'fixture',capabilities:{tools:{}},serverInfo:{name:'synthetic-only',version:'1'}}})};}
`;
async function setup({authOnly=false}={}){
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const home=await mkdtemp(join(tmpdir(),'kling-auth-runner-'));const dist=join(home,'sdk','dist');await mkdir(dist,{recursive:true});await writeFile(join(home,'sdk','package.json'),JSON.stringify({name:'mcp-remote',version:'0.2.0',type:'module'}));const module=join(dist,'fixture.mjs'),sdkFixture=fixture.replaceAll('25827',String(port));await writeFile(module,sdkFixture);const runner=join(home,'runner.mjs');await writeFile(runner,await readFile(new URL('./kling-auth-bridge.mjs',import.meta.url),'utf8'));await writeFile(join(home,'kling-auth-core.js'),(await readFile(new URL('./kling-auth-core.js',import.meta.url),'utf8')).replace('CALLBACK_PORT=25827','CALLBACK_PORT='+port));
 const child=spawn(process.execPath,[runner],{env:{...process.env,HOME:home,KLING_AUTH_ONLY:authOnly?'1':'0',KLING_OAUTH_MODULE:module,KLING_OAUTH_MODULE_SHA256:createHash('sha256').update(sdkFixture).digest('hex')},stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const exit=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));
 const status=async()=>JSON.parse(await readFile(join(home,'.dsh','kling-auth','status.json'),'utf8'));
 async function until(fn){for(let n=0;n<200;n++){try{const v=await fn();if(v)return v}catch{}await new Promise(r=>setTimeout(r,10))}throw Error('fixture timeout')}
 await until(async()=>{const s=await status();return s.status==='waiting'&&s});
 return {home,child,exit,port,status,until,output:()=>({out,err}),async close(){child.kill('SIGTERM');await Promise.race([exit,new Promise(r=>setTimeout(r,1000))]);child.kill('SIGKILL');await rm(home,{recursive:true,force:true})}};
}
test('synthetic OAuth callback completes through runner and public stdio without network',async()=>{
 const f=await setup();try{
  assert.equal((await fetch('http://127.0.0.1:'+f.port+'/oauth/callback?code=synthetic-only-code&state=wrong')).status,400);
  assert.equal((await fetch('http://127.0.0.1:'+f.port+'/oauth/callback?code=synthetic-only-code&state=synthetic-state')).status,200);
  await f.until(async()=>(await f.status()).status==='connected');
  f.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})+'\n');await f.until(()=>f.output().out.includes('synthetic-only'));
  assert.equal(f.output().err,'');assert.doesNotMatch(f.output().out,/klingai|synthetic-state|synthetic-only-code/);
 }finally{await f.close()}
});
test('cancel closes callback and removes authorization link from status',async()=>{
 const f=await setup();try{const s=await f.status();await writeFile(join(f.home,'.dsh','kling-auth','cancel.json'),JSON.stringify({id:s.id}),{mode:0o600});const exited=await f.exit;assert.equal(exited.code,0);const end=await f.status();assert.equal(end.status,'cancelled');assert.equal(end.authorizationUrl,undefined)}finally{await f.close()}
});

test('authorization-only phase finishes before starting the official MCP client',async()=>{
 const f=await setup({authOnly:true});try{assert.equal((await fetch('http://127.0.0.1:'+f.port+'/oauth/callback?code=synthetic-only-code&state=synthetic-state')).status,200);assert.equal((await f.exit).code,0);assert.equal((await f.status()).status,'authorized');assert.equal(f.output().out,'');assert.equal(f.output().err,'')}finally{await f.close()}
});
