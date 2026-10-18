// Canvas generation lifecycle only; does not own viewport, drawing tools or documents.
export function generationSnapshots(store){return [...store.batches.values()].filter(r=>r.batch.canvasId===store.activeCanvasId).map(r=>({batch:r.batch,tasks:[...r.tasks.values()],candidates:r.candidates}));}
export function generationFrames(records){
 const latest=new Map();
 for(const row of records){const rect=row.batch.targetRect;if(!rect)continue;const key=[rect.x,rect.y,rect.width,rect.height].join(':');if(!latest.has(key)||(latest.get(key).batch.createdAt||0)<=(row.batch.createdAt||0))latest.set(key,row);}
 return [...latest.values()].flatMap(row=>row.tasks.filter(t=>!row.batch.replayedModels?.[t.model]).flatMap(task=>{
  const candidates=task.candidates||row.candidates.filter(c=>c.taskId===task.taskId||c.model===task.model);
  if(candidates.some(c=>c.applied))return [];
  const candidate=candidates.find(c=>c.resultRole!=='grid')||candidates[0];
  return [{key:row.batch.id+':'+task.model,batchId:row.batch.id,model:task.model,status:task.status,createdAt:row.batch.createdAt,rect:row.batch.targetRect,candidate,error:task.error,local:row.batch.local===true}];
 }));
}
export async function placeGeneratedResults(store,record){
 if(!record.batch.autoPlace||store.activeCanvasId!==record.batch.canvasId||store.disposed||store.externalConflict)return;
 for(const task of record.tasks.values()){
  if(task.status!=='completed')continue;
  const candidates=task.candidates||record.candidates.filter(c=>c.taskId===task.taskId||c.model===task.model);
  const candidate=candidates.find(c=>c.resultRole!=='grid')||candidates[0];
  if(!candidate||candidate.applied)continue;
  const result=await store.applyCandidate(record.batch.id,candidate.id);
  if(result!==false){candidate.applied=true;if(result?.layer)candidate.appliedLayerId=result.layer.id;store.emit();}
 }
}
export async function regenerateCanvasTask(store,batchId,model){
 store.generationReplays??=new Map();const key=batchId+':'+model;if(store.generationReplays.has(key))return store.generationReplays.get(key);
 const original=store.batches.get(batchId);if(!original||original.batch.canvasId!==store.activeCanvasId){store.setNotice('请返回原任务所属画布','error');return false;}
 const task=[...original.tasks.values()].find(t=>t.model===model);
 if(!task||!['completed','failed','rejected','cancelled'].includes(task.status)||original.batch.local){store.setNotice('任务未结束或提交结果未知，请先核查原任务','error');return false;}
 const run=async()=>{
  if(await store.save()===false)return false;
  const localId=crypto.randomUUID(),snapshot={...structuredClone(original.batch),id:localId,local:true,createdAt:Date.now(),models:[model],replayedModels:{}};
  store.batches.set(localId,{batch:snapshot,tasks:new Map([[model,{model,status:'submitting'}]]),candidates:[],pollTimer:null});store.emit();
  try{const fresh=await store.adapter.regenerate(batchId,{model,requestId:crypto.randomUUID()});
   store.batches.delete(localId);original.batch.replayedModels={...original.batch.replayedModels,[model]:fresh.id};
   store.batches.set(fresh.id,{batch:fresh,tasks:new Map(fresh.tasks.map(t=>[t.taskId||t.model,t])),candidates:fresh.candidates||[],pollTimer:null,billingRefreshRounds:0});
   if(store.activeCanvasId===fresh.canvasId)store.activeBatchId=fresh.id;store.pollBatch(fresh.id);store.emit();return fresh.id;
  }catch(e){const row=store.batches.get(localId);row.tasks.get(model).status=e.status>=400&&e.status<500?'failed':'uncertain';row.tasks.get(model).error=e.message;store.setNotice('重新生成未确认成功：'+e.message,'error');return false;}
 };
 const job=run();store.generationReplays.set(key,job);try{return await job}finally{store.generationReplays.delete(key);store.emit()}
}
