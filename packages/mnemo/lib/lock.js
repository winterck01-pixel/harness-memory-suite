import {mkdirSync,writeFileSync,readFileSync,rmSync,renameSync,statSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'


export function acquireLock(root, name = '.writer-lock') {
  mkdirSync(root, {recursive:true, mode:0o700})
  const path=join(root,name), token=randomUUID(), candidate=path+'.candidate-'+token
  mkdirSync(candidate,{mode:0o700})
  try {
    writeFileSync(join(candidate,'owner.json'),JSON.stringify({protocol:2,pid:process.pid,token}),{flag:'wx',mode:0o600})
    for(let attempt=0;attempt<4;attempt++) {
      try {

        try {statSync(path);throw Object.assign(Error('Lease exists'), {code:'EEXIST'})}
        catch(observed) {if(observed.code!=='ENOENT')throw observed}
        renameSync(candidate,path)
      }
      catch(error) {
        if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error
        let owner, identity
        try {identity=statSync(path);owner=JSON.parse(readFileSync(join(path,'owner.json'),'utf8'))}
        catch(error) {
          if(error.code==='ENOENT') {
            try {statSync(path)} catch(missing) {if(missing.code==='ENOENT')continue;throw missing}
          }
          throw Error('Memory store is busy: incomplete legacy writer lease; recover only after all old instances have exited')
        }
        if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw Error('Invalid memory writer lease')
        try {process.kill(owner.pid,0);throw Error('Memory store is already in use by another writer')}
        catch(check) {if(check.code!=='ESRCH')throw check}


        const stamp=createHash('sha256').update(JSON.stringify([owner.token,identity.dev,identity.ino])).digest('hex')
        const retired=path+'.retired-'+stamp
        try {
          const current=JSON.parse(readFileSync(join(path,'owner.json'),'utf8')), stat=statSync(path)
          if(current.token!==owner.token||stat.ino!==identity.ino||stat.dev!==identity.dev)continue
          renameSync(path,retired)
        } catch(race) {if(!['ENOENT','EEXIST','ENOTEMPTY'].includes(race.code))throw race}
        continue
      }
      let released=false
      return ()=>{
        if(released)return
        const owner=JSON.parse(readFileSync(join(path,'owner.json'),'utf8'))
        if(owner.token!==token)throw Error('Memory writer lease changed')
        const releasedPath=path+'.released-'+token
        renameSync(path,releasedPath)
        released=true
        rmSync(releasedPath,{recursive:true})
      }
    }
    throw Error('Memory writer lease contention; retry later')
  } finally {rmSync(candidate,{recursive:true,force:true})}
}
