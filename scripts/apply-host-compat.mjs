import {readFileSync,writeFileSync,mkdirSync,copyFileSync,mkdtempSync,renameSync,rmSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {join,resolve,isAbsolute} from 'node:path'
import {tmpdir} from 'node:os'
import {parseArgs} from 'node:util'
const {values}=parseArgs({options:{'package-root':{type:'string'}}})
if(values['package-root']&&!isAbsolute(values['package-root']))throw Error('Explicit package root must be absolute')
const root=fileURLToPath(new URL('../',import.meta.url)),target=values['package-root']?resolve(values['package-root']):join(root,'node_modules/@deepseek-ai/dsh-tools')
const manifest=JSON.parse(readFileSync(join(root,'patches/dsh-tools-compat.json'),'utf8'))
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
const patch=join(root,'patches/dsh-tools-compat.patch')
if(sha(patch)!==manifest.patchSHA256)throw Error('Compatibility patch checksum mismatch')
if(JSON.parse(readFileSync(join(target,'package.json'),'utf8')).version!==manifest.version)throw Error('Unsupported ToolRuntime version; review compatibility before applying')
if(manifest.files.some(x=>!/^lib\/[a-z/.-]+$/.test(x.path)||x.path.includes('..')))throw Error('Invalid compatibility manifest path')
if(manifest.files.every(x=>sha(join(target,x.path))===x.after)){console.log('ToolRuntime compatibility already applied');process.exit(0)}
if(!manifest.files.every(x=>sha(join(target,x.path))===x.before))throw Error('ToolRuntime baseline differs; refusing overwrite')
const stage=mkdtempSync(join(tmpdir(),'harness-compat-'))
try{
 for(const f of manifest.files){const dest=join(stage,f.path);mkdirSync(join(dest,'..'),{recursive:true});copyFileSync(join(target,f.path),dest)}
 execFileSync('patch',['--batch','--forward','--dry-run','-p1','-i',patch],{cwd:stage,stdio:'pipe'})
 execFileSync('patch',['--batch','--forward','-p1','-i',patch],{cwd:stage,stdio:'pipe'})
 if(!manifest.files.every(x=>sha(join(stage,x.path))===x.after))throw Error('Staged ToolRuntime checksum mismatch')
 if(!manifest.files.every(x=>sha(join(target,x.path))===x.before))throw Error('ToolRuntime changed during preparation; refusing overwrite')
 for(const f of manifest.files){const dest=join(target,f.path),pending=dest+'.compat-pending';writeFileSync(pending,readFileSync(join(stage,f.path)),{flag:'wx'});renameSync(pending,dest)}
 if(!manifest.files.every(x=>sha(join(target,x.path))===x.after))throw Error('Patched ToolRuntime checksum mismatch; repair the current version before restart')
 console.log('ToolRuntime compatibility applied and verified')
}finally{rmSync(stage,{recursive:true,force:true})}
