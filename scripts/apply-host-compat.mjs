import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {join,resolve,isAbsolute} from 'node:path'
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
const backup=join(root,'.cache/host-compat/original')
for(const f of manifest.files){const dest=join(backup,f.path);mkdirSync(join(dest,'..'),{recursive:true});if(existsSync(dest)){if(sha(dest)!==f.before)throw Error('Existing compatibility backup differs')}else copyFileSync(join(target,f.path),dest)}
try{
 execFileSync('patch',['--batch','--forward','--dry-run','-p1','-i',patch],{cwd:target,stdio:'pipe'})
 execFileSync('patch',['--batch','--forward','-p1','-i',patch],{cwd:target,stdio:'pipe'})
 if(!manifest.files.every(x=>sha(join(target,x.path))===x.after))throw Error('Patched ToolRuntime checksum mismatch')
 console.log('ToolRuntime compatibility applied and verified')
}catch(error){for(const f of manifest.files)copyFileSync(join(backup,f.path),join(target,f.path));throw error}
