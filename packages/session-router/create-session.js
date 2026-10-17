import {createHash,randomUUID} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {statSync} from 'node:fs';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {defineDomain,domainTable} from '@deepseek-ai/dsh-storage-domain';
import {z} from 'zod';
import {installCreationModels,modelInput} from './creation-model.js';
import {keyedQueue} from './receipt.js';

export const creationSpec=defineDomain({name:'cross_session_creation',version:1,layout:'per-record',tables:{requests:domainTable(z.object({caller:z.string(),requestId:z.string(),target:z.string(),title:z.string(),cwd:z.string(),workspaceId:z.string().nullable(),stage:z.enum(['reserved','creating','created','renaming','complete']),createdAt:z.string(),modelIntent:z.string().optional()}))}});
const fail=reason=>{throw new Error('session creation: '+reason);};
const rank={'read-only':0,'workspace-write':1,'danger-full-access':2};
function location(ctx,caller){
 const cwd=caller.session.header.cwd;
 if(typeof cwd!=='string'||!isAbsolute(cwd)||!statSync(cwd).isDirectory())fail('caller must have an existing absolute working directory');
 const workspaces=ctx.workspaceRegistry.list().filter(w=>w.sessionIds.includes(caller.id));
 if(workspaces.length>1||workspaces.some(w=>w.path!==cwd))fail('caller workspace identity is ambiguous');
 return {cwd,workspaceId:workspaces[0]?.id??null};
}
function admission(ctx,caller){
 const current=ctx.permissionPresets.current(caller.session),name=ctx.permissionPresets.defaultPreset;
 if(['auto','custom'].includes(current)||['auto','custom'].includes(name))fail('unknown or automatic permission preset is not supported');
 const target=ctx.permissionPresets.resolve(name),source=ctx.sandboxPolicy.resolve({session:caller.session});
 const policy=ctx.approval.effectivePolicy(caller.session);
 if(!Object.hasOwn(rank,target.sandbox)||!Object.hasOwn(rank,source.mode)||target.approval!==policy||rank[target.sandbox]>rank[source.mode])fail('host default permissions differ or are broader; no policy was changed');
 if(source.mode==='workspace-write'&&source.workspaceRoot!==caller.session.header.cwd)fail('caller workspace sandbox root differs from its working directory');
 return {sandbox:target.sandbox,approval:target.approval};
}
function argsOf(args){
 if(!args||Object.keys(args).some(k=>!['title','request_id','provider','model','reasoning_effort'].includes(k)))fail('unknown creation argument');
 if(typeof args.request_id!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(args.request_id))fail('request_id must be a stable 1-128 character identifier');
 if(typeof args.title!=='string'||!args.title.trim()||Buffer.byteLength(args.title,'utf8')>240||/[\u0000-\u001f\u007f]/.test(args.title))fail('title must be nonempty, at most 240 UTF-8 bytes, and contain no control characters');
 return {requestId:args.request_id,title:args.title.trim(),model:modelInput(args)};
}
export function makeCreator(ctx,table,assertCaller,{newId=()=>`session-${randomUUID()}`,models}={}){
 const serial=keyedQueue();
 const observe=async row=>{
  const live=ctx.sessions.get(row.target);
  const view=live?{session:live.header,title:ctx.sessionTitle.get(live)}:await ctx.sessionQuery.readTitleSnapshot(row.target);
  const h=view.session;
  if(h.id!==row.target||h.cwd!==row.cwd||h.parentSession!==undefined||h.origin==='subagent'||h.isSeeded===true)fail('reserved identity is not an ordinary empty-root session');
  return {live,title:view.title?.title??null};
 };
 return async(args,exec)=>{
  const caller=assertCaller(ctx,exec),input=argsOf(args),where=location(ctx,caller);
  const key=createHash('sha256').update(JSON.stringify([caller.id,input.requestId])).digest('hex');
  return serial(key,async()=>{
   assertCaller(ctx,exec);
   let row=table.get(key);const duplicate=Boolean(row);
   if(row&&(row.title!==input.title||row.cwd!==where.cwd||row.workspaceId!==where.workspaceId))fail('request_id already belongs to different creation content');
   if(row&&(row.modelIntent??null)!==(input.model?JSON.stringify(input.model):null))fail('request_id already belongs to different model creation content');
   if(input.model&&!models)fail('explicit model capability unavailable');
   const modelReservation=models?await models.reserve(key,input,where,row):null;
   const result=(state,title,detail)=>({state,requestId:input.requestId,sessionId:row.target,title,duplicate,ordinary:state==='created',taskSent:false,detail,...models?{modelSelection:models.current(row.target)}:{}});
   if(!row){
    admission(ctx,caller);
    row={caller:caller.id,requestId:input.requestId,target:newId(),title:input.title,...where,stage:'reserved',createdAt:new Date().toISOString(),...input.model?{modelIntent:JSON.stringify(input.model)}:{}};
    await table.put(key,row);
   }
   if(models)await models.persist(key,modelReservation);
   const save=async stage=>{const next={...row,stage};await table.put(key,next);row=next;};
   try{
   if(row.stage==='reserved'){
    assertCaller(ctx,exec);admission(ctx,caller);
    await save('creating');
    exec.signal.throwIfAborted();
    try{
     const now=location(ctx,caller);admission(ctx,caller);
     if(now.cwd!==row.cwd||now.workspaceId!==row.workspaceId)return result('uncertain',null,'caller_location_changed');

     const made=await ctx.sessionController.create({sessionId:row.target,cwd:row.cwd});
     if(made.sessionId!==row.target)return result('uncertain',null,'identity_mismatch');
     if(row.workspaceId){const workspace=ctx.workspaceRegistry.get(row.workspaceId);if(!workspace||workspace.path!==row.cwd)return result('partial',null,'workspace_identity_changed');await workspace.attachSession(row.target);}
    }catch{return result('uncertain',null,'creation_attempt_unconfirmed');}
   }
   let seen;
   try{seen=await observe(row);}catch{return result('uncertain',null,'reserved_session_unavailable_or_mismatched');}
   if(row.stage==='complete')return result('created',seen.title,'existing_session_preserved');
   if(row.stage==='renaming')return result('partial',seen.title,'title_attempt_not_replayed');

   if(row.workspaceId&&!ctx.workspaceRegistry.get(row.workspaceId)?.sessionIds.includes(row.target))return result('partial',seen.title,'workspace_attachment_unconfirmed');
   if(!seen.live)return result('partial',seen.title,'cold_session_preserved_without_mutation');
   if(ctx.agents.isOwnedBy(row.target,caller))return result('partial',seen.title,'unexpected_runtime_parent');
   const actual=ctx.sandboxPolicy.resolve({session:seen.live}),source=ctx.sandboxPolicy.resolve({session:caller.session});
   if(!Object.hasOwn(rank,actual.mode)||!Object.hasOwn(rank,source.mode)||rank[actual.mode]>rank[source.mode]||(actual.mode==='workspace-write'&&actual.workspaceRoot!==row.cwd)||ctx.approval.effectivePolicy(seen.live)!==ctx.approval.effectivePolicy(caller.session))return result('partial',seen.title,'created_permissions_changed_no_task_sent');
   if(!await ctx.sessions.flush(seen.live))return result('partial',seen.title,'durability_checkpoint_unavailable');
   if(row.stage==='creating')await save('created');
   if(models&&!await models.apply(key,row.target,()=>assertCaller(ctx,exec)))return result('partial',seen.title,'model_attempt_not_replayed');
   assertCaller(ctx,exec);
   await save('renaming');
   exec.signal.throwIfAborted();


   const current=ctx.sessionTitle.get(seen.live);
   if(current===undefined)ctx.sessionTitle.rename(seen.live,row.title);
   const title=ctx.sessionTitle.get(seen.live)?.title??null;
   if(!await ctx.sessions.flush(seen.live))return result('partial',title,'title_durability_unconfirmed');
   await save('complete');
   return result('created',title,current===undefined?'created_and_named':'existing_title_preserved');
   }catch{return result('uncertain',null,'operation_incomplete_reuse_same_request_id');}
  });
 };
}
export async function installSessionCreation(ctx,assertCaller){
 const domain=await ctx.storageDomain.open(creationSpec),table=domain.table('requests');
 let active=true;const inFlight=new Set();
 const modelFeature=await installCreationModels(ctx,assertCaller);
 const create=makeCreator(ctx,table,(ctx,exec)=>{if(!active)fail('plugin is closing');return assertCaller(ctx,exec);},{models:modelFeature.models});
 ctx.effect(()=>async()=>{active=false;await Promise.allSettled([...inFlight]);await modelFeature.close();await domain.close();});
 ctx.tools.register(defineTool({name:'create_agent_session',description:'用户要求新建/新开 Harness 独立会话时使用：创建普通顶层会话，不是 subagent，spawn_teammate/子代理不可替代。使用调用者当前工作区，不复制历史、不发送任务、不调用模型、不修改权限。可先 list_agent_models，再成对提供 provider/model 与可选 reasoning_effort，只为新会话设置；不改变全局默认。省略模型则首次发送时解析宿主默认，不继承当前模型。创建后如需执行任务，另经授权使用 dispatch_to_agent。必须提供稳定 request_id；重试沿用原 ID，partial/uncertain 不代表完整成功，不会自动重建或覆盖后来的标题。',parameters:{title:{type:'string',required:true},request_id:{type:'string',required:true},provider:{type:'string'},model:{type:'string'},reasoning_effort:{type:'string'}},output:{schema:{type:'object',properties:{state:{required:true,type:'string',enum:['created','partial','uncertain']},requestId:{required:true,type:'string'},sessionId:{required:true,type:'string'},title:{required:true,oneOf:[{type:'string'},{type:'null'}]},duplicate:{required:true,type:'boolean'},ordinary:{required:true,type:'boolean'},taskSent:{required:true,type:'boolean'},detail:{required:true,type:'string'},modelSelection:{oneOf:[{type:'null'},{type:'object',properties:{provider:{required:true,type:'string'},model:{required:true,type:'string'},reasoningEffort:{type:'string'}},additionalProperties:false}]}},additionalProperties:false},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute(args,exec){const pending=create(args,exec);inFlight.add(pending);pending.then(()=>inFlight.delete(pending),()=>inFlight.delete(pending));return pending;}}));
}
