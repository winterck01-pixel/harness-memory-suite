import {readdirSync} from 'node:fs'
import {join,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
const root=fileURLToPath(new URL('../',import.meta.url))
let count=0
function visit(dir) {
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    if(['.git','node_modules','.cache','.local','vendor'].includes(entry.name))continue
    const path=join(dir,entry.name)
    if(entry.isDirectory())visit(path)
    else if(/\.(?:mjs|cjs|js)$/.test(entry.name)) {
      try { execFileSync(process.execPath,['--check',path],{stdio:'pipe'});count++ }
      catch { throw Error('Syntax check failed: '+relative(root,path)) }
    }
  }
}
visit(root)
console.log(`Syntax checks passed for ${count} JavaScript modules.`)
