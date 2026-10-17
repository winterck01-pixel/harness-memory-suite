import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,renameSync,rmSync,lstatSync,existsSync} from 'node:fs';
const prefix=fileURLToPath(new URL('./.local',import.meta.url));
const packages=['dsh-ptc-runtime-node','dsh-subprocess-local','dsh-fs-local','dsh-sandbox-local'].map(n=>`@deepseek-ai/${n}@0.2.1-rc.2`);
const stage=mkdtempSync(fileURLToPath(new URL('./.install-',import.meta.url)));
try{
 const r=spawnSync('npm',['install','--prefix',stage,'--no-package-lock','--no-save','--ignore-scripts',...packages],{stdio:'inherit'});
 if(r.error)throw r.error;
 if(r.status!==0)process.exitCode=r.status??1;
 else{
  if(existsSync(prefix)&&(!lstatSync(prefix).isDirectory()||lstatSync(prefix).isSymbolicLink()))throw Error('LOCAL_CACHE_MUST_BE_A_DIRECTORY');
  rmSync(prefix,{recursive:true,force:true});
  renameSync(stage,prefix);
 }
}finally{rmSync(stage,{recursive:true,force:true});}
