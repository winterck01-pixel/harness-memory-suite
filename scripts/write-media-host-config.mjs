import {parseArgs} from 'node:util';
import {mkdir,readFile,writeFile,chmod,stat,readdir} from 'node:fs/promises';
import {resolve,isAbsolute,join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {withFileLock,writeFileAtomic} from '@deepseek-ai/dsh-atomic-write';
const {values}=parseArgs({options:{'plugins-root':{type:'string'},out:{type:'string'},python:{type:'string'},'upload-program':{type:'string'}}});
for(const key of ['plugins-root','out'])if(!values[key]||!isAbsolute(values[key]))throw Error('Provide an absolute --'+key);
if(values.python&&(!isAbsolute(values.python)||/[\r\n]/.test(values.python)))throw Error('--python must be an absolute executable path');
const root=resolve(values['plugins-root']),bridgeRoot=join(homedir(),'.dsh','mcp'),connections=process.env.DSH_REMOTE_CONNECTIONS_PATH||join(homedir(),'.dsh','remote-connections.json');
const scriptRoot=dirname(fileURLToPath(import.meta.url)),pkgPath=createRequire(import.meta.url).resolve('mcp-remote/package.json'),dist=join(dirname(pkgPath),'dist');
const sdk=(await readdir(dist)).find(name=>/^chunk-.*\.js$/.test(name)&&(name==='chunk-I7GIRK4O.js'));if(!sdk)throw Error('Pinned mcp-remote SDK entry is missing');
const modulePath=join(dist,sdk),moduleHash=createHash('sha256').update(await readFile(modulePath)).digest('hex');
const entry=folder=>pathToFileURL(join(root,folder,'index.js')).href;
for(const folder of ['image-studio','video-studio','image-workshop','live-film','dsh-launchpad','dsh-media-gallery','dsh-remote-links'])await stat(join(root,folder,'index.js'));
await mkdir(bridgeRoot,{recursive:true,mode:0o700});
for(const name of ['baidu-netdisk-guarded-bridge.py','baidu-netdisk-upload.py']){
 const source=await readFile(join(root,'dsh-remote-links','bridges',name),'utf8'),content=values.python?source.replace('#!/usr/bin/env python3','#!'+values.python):source,target=join(bridgeRoot,name);
 try{const previous=await readFile(target,'utf8');if(previous!==content)throw Error('Existing bridge differs; review before updating: '+name)}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(target,content,{flag:'wx',mode:0o700})}await chmod(target,0o700);
}
await mkdir(dirname(connections),{recursive:true,mode:0o700});
const document=await withFileLock(connections,async()=>{
let document;try{document=JSON.parse(await readFile(connections,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;document={connections:{}};}
if(!document.connections?.['baidu-netdisk']){
 const url=process.env.BAIDU_MCP_URL||'',upload=values['upload-program'];if(url){const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='mcp-pan.baidu.com'||u.pathname!=='/sse'||!u.searchParams.get('access_token'))throw Error('Invalid official Baidu URL')}
 document.connections??={};document.connections['baidu-netdisk']={enabled:!!url,type:'baidu-netdisk-mcp',endpoint:{sseUrl:url},upload:{enabled:!!url&&!!upload,...(upload?{program:resolve(upload)}:{})}};
 await writeFileAtomic(connections,JSON.stringify(document,null,2)+'\n',{mode:0o600,dirMode:0o700});
}
return document;
});
const baidu=document.connections['baidu-netdisk'],token=process.env.WORKRALLY_MCP_TOKEN,env={DSH_REMOTE_CONNECTIONS_PATH:connections},authEnv={KLING_OAUTH_MODULE:modulePath,KLING_OAUTH_MODULE_SHA256:moduleHash};
const rows=[...['image-studio','video-studio','image-workshop','live-film','dsh-launchpad','dsh-media-gallery','dsh-remote-links'].map(folder=>({id:folder,name:entry(folder)})),
 {id:'mcp-baidu-netdisk',name:'@deepseek-ai/dsh-mcp-client',disabled:!baidu.enabled,config:{serverName:'baidu-netdisk',transport:'stdio',command:join(bridgeRoot,'baidu-netdisk-guarded-bridge.py'),env}},
 {id:'mcp-baidu-netdisk-upload',name:'@deepseek-ai/dsh-mcp-client',disabled:!baidu.upload?.enabled,config:{serverName:'baidu-netdisk-upload',transport:'stdio',command:join(bridgeRoot,'baidu-netdisk-upload.py'),env}},
 {id:'workrally-mcp',name:'@deepseek-ai/dsh-mcp-client',disabled:!token,config:{serverName:'workrally',transport:'streamable-http',url:'https://workrally.qq.com/zenstudio/api/mcp',headers:token?{Authorization:/^Bearer /i.test(token)?token:'Bearer '+token}:{}}},
 {id:'kling-ai-remote',name:'@deepseek-ai/dsh-mcp-client',disabled:true,config:{serverName:'Plugin-DeepSeek-kling-ai',transport:'stdio',command:process.execPath,args:[join(root,'dsh-remote-links','kling-auth-bridge.mjs')],env:authEnv,toolCallTimeoutMs:60000}}];
await mkdir(dirname(resolve(values.out)),{recursive:true,mode:0o700});await writeFile(values.out,JSON.stringify(rows,null,2)+'\n',{flag:'wx',mode:0o600});
console.log('Wrote private operator-local media configuration. Merge into the host plugin profile; keep it outside Git.');
