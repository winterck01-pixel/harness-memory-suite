import { lstat } from 'node:fs/promises'
import { isAbsolute, parse, join } from 'node:path'
export async function safeRootPath(value) {
 if(!isAbsolute(value))return false
 let current=parse(value).root
 for(const part of value.slice(current.length).split('/').filter(Boolean)){
  current=join(current,part)
  try{if((await lstat(current)).isSymbolicLink())return false}catch(e){if(e.code!=='ENOENT')throw e}
 }
 return true
}
