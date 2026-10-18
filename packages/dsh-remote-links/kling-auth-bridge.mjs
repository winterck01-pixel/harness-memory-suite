// Thin OAuth/stdio adapter over the pinned mcp-remote implementation. No tools
// are executed here; upstream owns PKCE, token exchange, refresh, and MCP wire IO.
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {authorizationUrl,callbackServer,CALLBACK_PORT} from './kling-auth-core.js';
const dir=join(homedir(),'.dsh','kling-auth'),file=join(dir,'status.json'),cancel=join(dir,'cancel.json');
const id=randomUUID(),deadline=Date.now()+180000;let callback,remote,transport,stopping=false,connected=false;
await mkdir(dir,{recursive:true,mode:0o700});
const write=async(status,extra={})=>{const tmp=file+'.'+process.pid;await writeFile(tmp,JSON.stringify({id,pid:process.pid,status,expiresAt:deadline,...extra}),{mode:0o600});await rename(tmp,file)};
// Upstream diagnostics can contain authorization URLs; never forward them.
process.stderr.write=()=>true;
async function stop(status){if(stopping)return;stopping=true;const code=status==='cancelled'?0:1;setTimeout(()=>process.exit(code),2500);try{await write(status)}catch{}try{await callback?.close().catch(()=>{});await remote?.close().catch(()=>{});await transport?.close().catch(()=>{})}finally{process.exit(code)}}
const hard=setTimeout(()=>{if(!connected)void stop('expired')},180000);
const control=setInterval(async()=>{try{const c=JSON.parse(await readFile(cancel,'utf8'));if(c.id===id)void stop('cancelled')}catch{}},400);
process.on('SIGTERM',()=>void stop('cancelled'));process.on('SIGINT',()=>void stop('cancelled'));process.stdin.on('end',()=>void stop('cancelled'));
try{
 await write('connecting');
 const modulePath=process.env.KLING_OAUTH_MODULE,bytes=await readFile(modulePath);
 const pkg=JSON.parse(await readFile(join(dirname(dirname(modulePath)),'package.json'),'utf8'));
 if(pkg.name!=='mcp-remote'||pkg.version!=='0.2.0'||createHash('sha256').update(bytes).digest('hex')!==process.env.KLING_OAUTH_MODULE_SHA256)throw Error('DEPENDENCY_MISMATCH');
 const sdk=await import(pathToFileURL(modulePath));
 const args=await sdk.parseCommandLineArgs(['https://klingai.com/mcp',String(CALLBACK_PORT),'--transport','http-only','--static-oauth-client-metadata','{"client_name":"Plugin-DeepSeek"}','--header','X-Kling-Integration:Plugin-DeepSeek','--auth-timeout','180']);
 const discovery=await sdk.discoverOAuthServerInfo(args.serverUrl,args.headers);
 class Provider extends sdk.NodeOAuthClientProvider{
  async redirectToAuthorization(value){const u=authorizationUrl(value);callback.setUrl(u);await write('waiting',{authorizationUrl:u.toString()})}
 }
 const provider=new Provider({serverUrl:discovery.authorizationServerUrl,callbackPath:args.callbackPath,callbackPort:CALLBACK_PORT,host:'localhost',clientName:'MCP CLI Proxy',staticOAuthClientMetadata:args.staticOAuthClientMetadata,serverUrlHash:args.serverUrlHash,authorizationServerMetadata:discovery.authorizationServerMetadata,protectedResourceMetadata:discovery.protectedResourceMetadata,wwwAuthenticateScope:discovery.wwwAuthenticateScope});
 let resolveCode;const code=new Promise(r=>{resolveCode=r});
 callback=await callbackServer({deadline,onCode:resolveCode,onDenied:()=>void stop('denied')});
 const init=async()=>({waitForAuthCode:()=>code,skipBrowserAuth:false});
 remote=await sdk.connectToRemoteServer(null,args.serverUrl,provider,args.headers,init,'http-only');
 if(process.env.KLING_AUTH_ONLY==='1'){connected=true;clearTimeout(hard);clearInterval(control);await callback?.close();await write('authorized');setTimeout(()=>process.exit(0),2500);await remote.close();process.exit(0)}
 transport={onmessage:undefined,onerror:undefined,onclose:undefined,async start(){let buf='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buf+=chunk;if(buf.length>32*1024*1024)return void stop('failed');for(let i;(i=buf.indexOf('\n'))>=0;){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line.trim())continue;try{transport.onmessage?.(sdk.JSONRPCMessageSchema.parse(JSON.parse(line)))}catch{void stop('failed')}}})},async send(msg){await new Promise((resolve,reject)=>{process.stdout.write(JSON.stringify(msg)+'\n',e=>e?reject(e):resolve())})},async close(){process.stdin.pause();transport.onclose?.()}};
 sdk.mcpProxy({transportToClient:transport,transportToServer:remote,ignoredTools:[]});await transport.start();
 connected=true;clearTimeout(hard);clearInterval(control);await callback?.close();callback=undefined;await write('connected');
 const oldClose=remote.onclose;remote.onclose=()=>{oldClose?.();void stop('disconnected')};
}catch{clearTimeout(hard);clearInterval(control);await stop('failed')}
