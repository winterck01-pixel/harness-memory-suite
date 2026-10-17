import {defineDomain,domainTable} from '@deepseek-ai/dsh-storage-domain';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {z} from 'zod';
import {makeModelBridge} from './model-bridge.js';
export const modelSpec=defineDomain({name:'cross_session_creation_model',version:1,layout:'per-record',tables:{requests:domainTable(z.object({intent:z.string(),selection:z.object({provider:z.string(),model:z.string(),reasoningEffort:z.string().optional()}).nullable(),stage:z.enum(['reserved','attempting','complete'])}))}});
export function modelInput(args){
 const keys=['provider','model','reasoning_effort'];
 for(const key of keys)if(args[key]!==undefined&&(typeof args[key]!=='string'||!args[key].trim()||args[key].length>240||/[\u0000-\u001f\u007f]/.test(args[key])))throw Error('session creation: invalid '+key);
 if((args.provider===undefined)!==(args.model===undefined)||args.reasoning_effort!==undefined&&args.model===undefined)throw Error('session creation: provider and model must be provided together');
 return args.model===undefined?null:{provider:args.provider,model:args.model,...args.reasoning_effort===undefined?{}:{reasoningEffort:args.reasoning_effort}};
}
export function makeCreationModels(ctx,table,bridge){
 return {
  async reserve(key,input,where,old){
   const intent=JSON.stringify([input.title,where.cwd,where.workspaceId,input.model]);
   let row=table?.get(key);
   if(row){if(row.intent!==intent)throw Error('session creation: request_id already belongs to different model creation content');return row;}
   if(old&&!old.modelIntent){if(input.model)throw Error('session creation: existing creation has no model intent; selection preserved');return null;}
   if(!input.model)return null;
   if(!table)throw Error('session creation: model storage unavailable');
   const selection=await bridge.validate(input.model);
   return {intent,selection,stage:'reserved'};
  },
  async persist(key,row){if(row&&!table?.get(key)){if(!table)throw Error('session creation: model storage unavailable');await table.put(key,row);}},
  async apply(key,id,guard){
   const row=table?.get(key);if(!row)return true;
   if(row.stage==='complete')return true;
   if(row.stage==='attempting')return false;
   bridge.requireAvailable();const snapshot=bridge.snapshot(id);
   await table.put(key,{...row,stage:'attempting'});
   await bridge.commit(id,row.selection,guard,snapshot);
   await table.put(key,{...row,stage:'complete'});return true;
  },
  current:id=>bridge.current(id)
 };
}
export async function installCreationModels(ctx,assertCaller){
 const bridge=makeModelBridge(ctx);let domain=null,table=null;
 try{domain=await ctx.storageDomain.open(modelSpec);table=domain.table('requests');}catch{}
 ctx.tools.register(defineTool({name:'list_agent_models',description:'列出宿主当前配置的对话模型 provider/model 与 reasoning_effort 可选值，供 create_agent_session 或 switch_agent_model 显式指定。配置可解析不表示上游鉴权或生成已验证。不会选择模型或修改默认。',parameters:{},output:{schema:{type:'json'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]},async execute(_args,exec){assertCaller(ctx,exec);const c=await ctx.sessionController.modelCatalog();assertCaller(ctx,exec);return {groups:c.groups,default:c.default,failures:c.failures.map(f=>({id:f.id,name:f.name,unavailable:true})),explicitSelectionAvailable:bridge.available&&Boolean(table),generationVerified:false};}}));
 return {models:makeCreationModels(ctx,table,bridge),close:async()=>{if(domain)await domain.close();}};
}
