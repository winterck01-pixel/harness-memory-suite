import {readFileSync,writeFileSync,mkdirSync,statfsSync,realpathSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';

export const HARD_LIMITS=Object.freeze({memoryMax:536870912,memoryHigh:402653184,cpuMax:'100000 100000',pidsMax:64,tmpBytes:268435456,fileBytes:67108864,openFiles:128});
export const hardLimitsRequired=env=>env.DSH_RENDER_HARD_LIMITS==='1';
export function workerLaunch({nodePath,scriptPath,env}){
 if(!hardLimitsRequired(env))return{command:nodePath,args:[scriptPath],env,hard:false};
 const root=env.DSH_RENDER_RUNTIME,delegated=env.DSH_RENDER_CGROUP_ROOT;
 if(!root||!delegated||!root.startsWith('/')||!delegated.startsWith('/sys/fs/cgroup/'))throw Error('渲染硬隔离配置缺失');
 const fs=statfsSync(root);
 if(Number(fs.type)!==0x01021994||Number(fs.blocks)*Number(fs.bsize)>HARD_LIMITS.tmpBytes)throw Error('渲染临时区必须是256MiB以内独立tmpfs');
 const native=join(root,'native','worker-'+randomUUID());mkdirSync(native,{recursive:true,mode:0o700});
 return{command:'/usr/bin/prlimit',args:[`--fsize=${HARD_LIMITS.fileBytes}:${HARD_LIMITS.fileBytes}`,`--nofile=${HARD_LIMITS.openFiles}:${HARD_LIMITS.openFiles}`,'--core=0:0','--',nodePath,new URL('./os-worker-bootstrap.js',import.meta.url).pathname,scriptPath],env:{...env,TMPDIR:native,TMP:native,TEMP:native},hard:true,scratch:native};
}
export function assertWorkerOutput(path,env){
 if(!hardLimitsRequired(env))return;
 const root=realpathSync(env.DSH_RENDER_RUNTIME),out=resolve(path||'');
 if(!out.startsWith(root+sep))throw Error('硬隔离渲染输出必须位于受限临时区');
}
export function enterWorkerCgroup(env=process.env){
 if(!hardLimitsRequired(env))throw Error('OS worker bootstrap requires explicit hard isolation');
 // The service manager owns the delegated boundary. Main Harness stays in /main.
 const line=readFileSync('/proc/self/cgroup','utf8').trim().split('\n').find(x=>x.startsWith('0::'));
 if(!line)throw Error('需要cgroup v2');
 const current=join('/sys/fs/cgroup',line.slice(3)),root=realpathSync(env.DSH_RENDER_CGROUP_ROOT);
 if(dirname(current)!==root||!current.endsWith('/main'))throw Error('worker不在预期的systemd委派main子组');
 writeFileSync(join(root,'cgroup.subtree_control'),'+cpu +memory +pids');
 const group=join(root,'image-render');mkdirSync(group,{recursive:true});
 const settings={'memory.max':String(HARD_LIMITS.memoryMax),'memory.high':String(HARD_LIMITS.memoryHigh),'memory.swap.max':'0','memory.oom.group':'1','cpu.max':HARD_LIMITS.cpuMax,'pids.max':String(HARD_LIMITS.pidsMax)};
 for(const[name,value]of Object.entries(settings))writeFileSync(join(group,name),value);
 for(const[name,value]of Object.entries(settings))if(readFileSync(join(group,name),'utf8').trim()!==value)throw Error('cgroup limit not applied: '+name);
 writeFileSync(join(group,'cgroup.procs'),String(process.pid));
 if(!readFileSync('/proc/self/cgroup','utf8').includes(line.slice(3).replace(/\/main$/,'/image-render')))throw Error('worker未进入受限cgroup');
 return{pid:process.pid,cgroup:group,limits:settings,tmpBytes:HARD_LIMITS.tmpBytes,fileBytes:HARD_LIMITS.fileBytes,openFiles:HARD_LIMITS.openFiles};
}
