import { AsyncLocalStorage } from 'node:async_hooks'
import { isAbsolute, relative, resolve } from 'node:path'
export function inside(root,path){if(!root||!isAbsolute(root)||!isAbsolute(path))return false;const rel=relative(resolve(root),resolve(path));return rel===''||(!rel.startsWith('../')&&rel!=='..'&&!isAbsolute(rel))}
export function createAccess(resolveSession){
 const contexts=new WeakSet(),local=new AsyncLocalStorage()
 const operator=Object.freeze({actor:'user',operator:true});contexts.add(operator)
 function forExecution(execution){if(typeof execution?.agent?.id!=='string'||!execution.agent.id)throw new Error('TRUSTED_PROJECT_REQUIRED');const session=resolveSession(execution?.agent?.id);const cwd=session?.header?.cwd||session?.cwd;if(typeof cwd!=='string'||!isAbsolute(cwd))throw new Error('TRUSTED_PROJECT_REQUIRED');const context=Object.freeze({actor:'agent',projectId:resolve(cwd),operator:false});contexts.add(context);return context}
 function assert(context){if(!contexts.has(context))throw new Error('UNTRUSTED_CONTEXT');return context}
 function canAccess(entry,context){assert(context);if(context.operator)return true;if(entry.projectId)return entry.projectId===context.projectId;if(entry.shared===true)return true;return !!entry.assetId?.startsWith('file:')&&inside(context.projectId,entry.assetId.slice(5))}
 return {operator,forExecution,assert,canAccess,current:()=>{const context=local.getStore();if(!context)throw new Error('TRUSTED_CONTEXT_REQUIRED');return context},run:(context,fn)=>local.run(assert(context),fn)}
}
