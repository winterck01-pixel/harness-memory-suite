import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const prefix=fileURLToPath(new URL('./.local',import.meta.url));
const packages=['dsh-ptc-runtime-node','dsh-subprocess-local','dsh-fs-local','dsh-sandbox-local'].map(n=>`@deepseek-ai/${n}@0.2.1-alpha.2`);
const r=spawnSync('npm',['install','--prefix',prefix,'--no-package-lock','--no-save','--ignore-scripts',...packages],{stdio:'inherit'});
if(r.error)throw r.error;process.exitCode=r.status??1;
