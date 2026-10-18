import {canonical} from 'dsh-image-studio/agent-surface';
import {uid,projectOf,shotOf,validateShot,active,FilmError} from './store.js';
export class Queue {
 constructor(store,bridge,{concurrency=2}={}){this.store=store;this.bridge=bridge;this.concurrency=concurrency;this.running=false;this.closed=false;this.executions=new Map();this.uiOrigins=new Map()}
 async enqueue(body,context,origin){const [catalog,assets]=await Promise.all([this.bridge.models(),this.bridge.assets()]);if(!body.confirmCost)throw new FilmError('请确认本次使用已配置服务生成，费用以服务商为准');if(!Array.isArray(body.shotIds)||!body.shotIds.length||body.shotIds.length>30||new Set(body.shotIds).size!==body.shotIds.length)throw new FilmError('每批选择1–30个不同片段');const result=await this.store.tx(async s=>{
 if(context){if(typeof body.requestId!=='string'||!/^[-\w]{1,100}$/.test(body.requestId))throw new FilmError('需要有效幂等请求ID');s.agentRequests??={};const key=context.sessionId+':'+body.requestId,previous=s.agentRequests[key];if(previous){if(previous.hash!==canonical(body))throw new FilmError('同一请求ID参数已变化',409);return previous.result;}}
 const p=projectOf(s,body.projectId,body.revision),added=[],skipped=[];
 for(const id of body.shotIds){const shot=shotOf(p,id);if(s.tasks.some(t=>t.projectId===p.id&&t.shotId===id&&active(t))){skipped.push(id);continue}
 let request;if(body.draftCandidateId){if(body.shotIds.length!==1)throw new FilmError('每次只能将一个样片生成成稿');const candidate=shot.candidates.find(c=>c.id===body.draftCandidateId),source=candidate?.taskId?(await this.bridge.tasks([candidate.taskId])).find(t=>t.id===candidate.taskId):undefined;if(!candidate?.snapshot.draft||!source?.remoteId||source.status!=='completed'||Date.now()-source.createdAt>7*86400000)throw new FilmError('样片须已完成且在7天有效期内');if(!catalog.find(m=>m.id===candidate.snapshot.model)?.supportsDraft)throw new FilmError('样片模型未启用');request={model:candidate.snapshot.model,duration:candidate.snapshot.duration,aspectRatio:candidate.snapshot.aspectRatio,resolution:'1080p',prompt:'',referenceIds:[],draftTaskId:source.remoteId,n:1};}else request=validateShot(p,shot,catalog,assets);const task={id:uid(),projectId:p.id,shotId:id,snapshot:request,dependency:shot.dependency,status:shot.dependency?'waiting':'queued',...(context?{sessionId:context.sessionId,executionRequired:true}:{}),createdAt:Date.now(),results:[]};added.push(task)}
 if(!added.length)throw new FilmError('选中的片段均已有任务，未重复提交');s.tasks.push(...added);const result={added:added.map(t=>t.id),skipped};if(context)s.agentRequests[context.sessionId+':'+body.requestId]={hash:canonical(body),result};return result;
 });if(context)for(const id of result.added)this.executions.set(id,context.execution);else if(origin)for(const id of result.added)this.uiOrigins.set(id,origin);return result;}
 async tick(){if(this.running||this.closed)return;this.running=true;try{
 const remote=await this.bridge.tasks(this.store.read().tasks.map(task=>task.id));
 await this.store.tx(s=>{
 // Billing can settle after media completes; mirror only billing and the estimate snapshot
 // for terminal tasks without changing their selected assets or queue state.
 for(const task of s.tasks){const r=remote.find(r=>r.id===task.id);if(r?.providerModel)task.providerModel=r.providerModel;if(r?.billing)task.billing=structuredClone(r.billing);if(r?.billingCheck)task.billingCheck=structuredClone(r.billingCheck);if(r?.costEstimate)task.costEstimate=structuredClone(r.costEstimate);if(r?.costProvider)task.costProvider=r.costProvider;if(r?.hiddenAt)task.hiddenAt=r.hiddenAt;else if(r?.status==='completed'&&r.results?.length)delete task.hiddenAt}
 for(const task of s.tasks.filter(t=>active(t)||(t.status==='completed'&&!t.results?.length))){
  const r=remote.find(r=>r.id===task.id);if(!r)continue;
  task.status=r.status;task.error=r.error||'';task.remoteId=r.remoteId;task.progress=r.progress;
  if(r.status==='completed'){
   const p=s.projects.find(p=>p.id===task.projectId),shot=p?.shots.find(x=>x.id===task.shotId);if(!shot)continue;
   for(const asset of r.results||[])if(!shot.candidates.some(c=>c.taskId===task.id&&c.assetId===asset.id)){const duration=Number.isFinite(asset.duration)&&asset.duration>0?asset.duration:task.snapshot.generationMode==='extend'||!(task.snapshot.duration>0)?null:task.snapshot.duration;if(!duration){task.status='uncertain';task.error='生成视频已保存，实际时长尚未读取；先恢复媒体检查，未重新生成';continue;}shot.candidates.push({id:uid(),taskId:task.id,assetId:asset.id,duration,snapshot:task.snapshot,createdAt:Date.now()});}
   task.results=(r.results||[]).map(x=>x.id);if(!task.results.length){task.status='uncertain';task.error='任务完成但结果文件不可用，等待核查'}
  }
 }});
 let slots=this.concurrency-this.store.read().tasks.filter(t=>['dispatching','submitting','polling'].includes(t.status)).length;
 for(const t of this.store.read().tasks){if(slots<=0||this.closed)break;if(!['queued','waiting'].includes(t.status))continue;const execution=this.executions.get(t.id);if(t.executionRequired&&(!execution||execution.agent?.session?.id!==t.sessionId||(execution.signal||execution.token?.signal||execution.agent?.signal)?.aborted)){await this.store.tx(s=>{const q=s.tasks.find(x=>x.id===t.id);q.status='failed';q.error='会话执行授权已失效，请重新确认生成；未提交收费请求'});this.executions.delete(t.id);continue;}
 const p=this.store.read().projects.find(x=>x.id===t.projectId);if(t.dependency&&!p?.shots.find(x=>x.id===t.dependency)?.selected)continue;
 const claimed=await this.store.tx(s=>{const q=s.tasks.find(x=>x.id===t.id);if(!['queued','waiting'].includes(q.status))return false;q.status='dispatching';return true});if(!claimed)continue;slots--;
 try{const origin=this.uiOrigins.get(t.id);this.uiOrigins.delete(t.id);const result=await this.bridge.submit({...t.snapshot,requestId:t.id,...(t.sessionId?{sessionId:t.sessionId}:{})},execution,origin);await this.store.tx(s=>{const q=s.tasks.find(x=>x.id===t.id);q.status=result.status;q.remoteId=result.remoteId;if(result.billing)q.billing=structuredClone(result.billing);if(result.costEstimate)q.costEstimate=structuredClone(result.costEstimate)})}
 catch(e){await this.store.tx(s=>{const q=s.tasks.find(x=>x.id===t.id);q.status=e.safeToRetry?'failed':'uncertain';q.error=(e.safeToRetry?'提交前校验失败：':'提交结果待确认，未自动重试：')+String(e.message).slice(0,200)})}
 }
 }finally{this.running=false}}
 async start(){await this.store.tx(s=>{for(const t of s.tasks)if(t.status==='dispatching'){t.status='uncertain';t.error='提交期间重启，先核查原任务，禁止重复提交'}});this.timer=setInterval(()=>this.tick().catch(()=>{}),2500);this.timer.unref?.();await this.tick()}
 async cancel(id){const result=await this.store.tx(s=>{const t=s.tasks.find(t=>t.id===id);if(!t||!['queued','waiting'].includes(t.status))throw new FilmError('只能取消尚未提交的本地排队任务');t.status='cancelled';return t});this.uiOrigins.delete(id);return result}
 async dismiss(id){
  const eligible=t=>t&&['failed','timed_out','uncertain','rejected'].includes(t.status)&&!t.results?.length;
  const task=this.store.read().tasks.find(t=>t.id===id);if(!eligible(task))throw new FilmError('仅可删除无成功资产的失败或待核查记录；生成中请先等待');
  const remote=(await this.bridge.tasks([id])).find(t=>t.id===id);let hiddenAt=task.hiddenAt||Date.now();
  if(remote){if(!this.bridge.dismiss)throw new FilmError('视频服务尚未支持删除记录');const result=await this.bridge.dismiss(id);hiddenAt=result.hiddenAt;}
  return this.store.tx(s=>{const current=s.tasks.find(t=>t.id===id);if(!eligible(current))throw new FilmError('任务状态已变化，请刷新后重试');current.hiddenAt=hiddenAt;return {id,hiddenAt};});
 }
 async recover(id,remoteId){const t=this.store.read().tasks.find(t=>t.id===id);if(!t||!['uncertain','timed_out'].includes(t.status))throw new FilmError('仅可核查状态不确定或超时的任务');await this.bridge.recover(id,remoteId||t.remoteId);await this.tick()}
 stop(){this.closed=true;this.executions.clear();this.uiOrigins.clear();clearInterval(this.timer)}
}
