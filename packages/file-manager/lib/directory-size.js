import {lstat, opendir, realpath} from 'node:fs/promises'
import {join, relative, isAbsolute} from 'node:path'


export async function directorySize(root, target, {maxEntries=100000, maxMs=5000, cancelled=()=>false}={}) {
  const start=Date.now(), result={bytes:0,files:0,skipped:0,complete:true,scannedAt:null}
  const base=await realpath(root), stack=[target]
  let visited=0
  const within=p=>{const r=relative(base,p);return r===''||(!r.startsWith('..'+ '/')&&r!=='..'&&!isAbsolute(r))}
  while(stack.length){
    if(cancelled()||Date.now()-start>=maxMs||visited>=maxEntries){result.complete=false;break}
    const path=stack.pop()
    try {
      const info=await lstat(path);visited++
      if(info.isSymbolicLink()){result.skipped++;continue}
      if(!within(await realpath(path))){result.skipped++;result.complete=false;continue}
      if(info.isFile()){result.bytes+=info.size;result.files++;continue}
      if(!info.isDirectory()){result.skipped++;continue}
      const dir=await opendir(path)
      for await (const entry of dir){
        if(stack.length+visited>=maxEntries||cancelled()||Date.now()-start>=maxMs){result.complete=false;break}
        stack.push(join(path,entry.name))
      }
    } catch {result.skipped++;result.complete=false}
  }
  result.scannedAt=new Date().toISOString()
  return result
}
