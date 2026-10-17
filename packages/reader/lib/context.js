import {isAbsolute,resolve} from 'node:path'
import {reject} from './validate.js'

export function readerExecutionContext(ctx,exec){
 const id=exec?.agent?.id,session=typeof id==='string'?ctx.get('sessions')?.get(id):undefined,cwd=session?.header?.cwd||session?.cwd
 if(!session||typeof cwd!=='string'||!isAbsolute(cwd))reject(403,'TRUSTED_PROJECT_REQUIRED')
 return Object.freeze({actor:'agent',projectId:resolve(cwd),operator:false})
}
