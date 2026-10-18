const pending=['queued','waiting','dispatching','submitting','polling','uncertain','timed_out'];
export function draftInfo(candidate,tasks,models,shotId,now=Date.now()){
 if(!candidate?.snapshot?.draft)return {isDraft:false};
 const source=tasks.find(t=>t.id===candidate.taskId);let reason='';
 if(!source)reason='样片来源任务不可用，请重新生成样片';
 else if(source.status==='failed')reason='样片生成失败，请重新生成样片';
 else if(source.status!=='completed')reason='样片尚未成功完成';
 else if(!Number.isFinite(source.createdAt)||now-source.createdAt>=7*86400000)reason='样片已超过7天有效期，请重新生成样片';
 else if(!source.remoteId)reason='样片任务ID尚未确认，请先核查任务';
 else if(!models.some(m=>m.id===candidate.snapshot.model&&m.supportsDraft))reason='样片原模型未启用，请恢复原服务配置';
 else if(tasks.some(t=>t.shotId===shotId&&pending.includes(t.status)))reason='此片段还有进行中或待核查任务';
 return {isDraft:true,canFinalize:!reason,reason,label:'样片 · 480p'};
}
