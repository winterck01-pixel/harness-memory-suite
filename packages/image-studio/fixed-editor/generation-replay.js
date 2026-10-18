import {createHash} from 'node:crypto';
export function modelBindings(config,models){return Object.fromEntries(models.map(id=>{const p={...config,...config.modelProfiles?.[id]},keys=['adapter','baseUrl','generatePath','editPath','queryPath','uploadPath','modelName','useDefaultKey','accountId','corpId','isEnterprise','serverName'];return[id,createHash('sha256').update(JSON.stringify(keys.map(k=>[k,p[k]??null]))).digest('hex')]}));}
export function isMcpBinding(config,id){return ['workrallyMcp','klingMcp'].includes(config.modelProfiles?.[id]?.adapter);}
// Credential fingerprints are private batch metadata, never provider/tool/browser payloads.
export async function credentialBindings(config,models,getCredentialBinding){
 const bindings={};
 for(const id of models)if(!isMcpBinding(config,id)&&getCredentialBinding){const binding=await getCredentialBinding(id);if(typeof binding==='string'&&/^[a-f0-9]{64}$/.test(binding))bindings[id]=binding;}
 return bindings;
}
// Explicit replay only: retain immutable references/options, mint a new batch/request.
export function createGenerationReplay({generation,projects,assets,storage,referenceContext,materialize,fail,getConfig,getCredentialBinding,engine}){
 const jobs=new Map();
 return async function replay(id,body,{execution,origin}={}){
  if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9-]{16,100}$/.test(body.requestId)||typeof body.model!=='string')throw fail('VALIDATION_FAILED','重生成缺少有效请求编号或模型');
  const key=createHash('sha256').update(id+'\n'+body.model+'\n'+body.requestId).digest('hex');
  if(jobs.has(key))return jobs.get(key);
  const run=async()=>{
   const receipt='generation-replays/'+key+'.json',seen=await storage.read(receipt,null);
   if(seen){const batch=await generation.getBatch(seen.batchId);if(!batch)throw fail('BATCH_NOT_FOUND','重生成记录不存在',404);return materialize(batch);}
   const source=await generation.getBatch(id);if(!source)throw fail('BATCH_NOT_FOUND','原生成批次不存在',404);
   if(!source.models.includes(body.model))throw fail('VALIDATION_FAILED','模型不属于原生成批次');
   const current=await materialize(source),task=current.tasks.find(t=>t.model===body.model);
   if(!task||!['completed','failed','rejected','cancelled'].includes(task.status))throw fail('VALIDATION_FAILED','原任务仍进行中或结果未知，请先核查');
   const status=source.modelStatus?.[body.model];
   const request=status?.effectiveParams||source.requestsByModel?.[body.model]||(source.models.length===1?source.effectiveParams:null);
   if(!request)throw fail('VALIDATION_FAILED','历史任务缺少完整模型参数，不能保证准确重生成');
   const doc=await projects.getCanvas(source.canvasId),rect=source.targetRect;
   if(!rect||rect.x<0||rect.y<0||rect.x+rect.width>doc.canvas.width+1e-6||rect.y+rect.height>doc.canvas.height+1e-6)throw fail('VALIDATION_FAILED','原生成区域已不适合当前画布，请先恢复画布尺寸');
   const refs=new Map();
   for(const ref of source.referenceSnapshot){const asset=await assets.get(ref.assetId);if(!asset||asset.hash!==ref.hash)throw fail('ASSET_NOT_FOUND','原参考素材已不可用，停止重生成',404);refs.set(ref.layerId,asset);}
   const meta=await storage.read('batch-meta/'+id+'.json',{}),config=await getConfig();
   const credentials=await credentialBindings(config,[body.model],getCredentialBinding);
   if(!isMcpBinding(config,body.model)){
    if(!meta.credentialBindings?.[body.model])throw fail('VALIDATION_FAILED','历史任务缺少原 API 凭据绑定，不能保证准确重生成');
    if(!credentials[body.model]||meta.credentialBindings[body.model]!==credentials[body.model])throw fail('VALIDATION_FAILED','原 API 凭据已变化或不可用，停止重生成');
   }
   const binding=modelBindings(config,[body.model])[body.model];
   if(meta.modelBindings?.[body.model]){if(meta.modelBindings[body.model]!==binding)throw fail('VALIDATION_FAILED','原模型账号或接口配置已变化，停止重生成');}
   else {const native=engine?.list().find(t=>t.id===status?.taskId),profile=config.modelProfiles?.[body.model],identity=profile?.adapter==='workrallyMcp'?'workrally:'+JSON.stringify([profile.accountId,profile.corpId,profile.isEnterprise]):profile?.adapter==='klingMcp'?'kling-cn:'+profile.accountId:null;if(!identity||native?.accountIdentity!==identity||native?.providerModel!==profile.modelName)throw fail('VALIDATION_FAILED','历史任务缺少可核对的原服务绑定，不能保证准确重生成');}
   const params=structuredClone(request);
   const batch=await referenceContext.run(refs,()=>generation.createBatch({canvasId:source.canvasId,sourceRevision:doc.canvas.revision,referenceLayerIds:[...refs.keys()],targetRect:structuredClone(rect),request:{...params,model:body.model}}));
   await storage.write('batch-meta/'+batch.id+'.json',{...meta,modelBindings:{[body.model]:binding},credentialBindings:credentials,replayedModels:{},autoPlace:true,replayOf:id});
   await storage.write('batch-meta/'+id+'.json',{...meta,replayedModels:{...meta.replayedModels,[body.model]:batch.id}});
   // Persist ownership before submitting: a repeated HTTP request can only observe this batch.
   await storage.write(receipt,{batchId:batch.id});
   try{await generation.submitBatch(batch.id,{models:[body.model],requestsByModel:{[body.model]:params},execution,origin});}catch{/* Persisted failed/uncertain batch remains queryable; never silently submit twice. */}
   return materialize(await generation.getBatch(batch.id));
  };
  const promise=run();jobs.set(key,promise);try{return await promise}finally{jobs.delete(key)}
 };
}
