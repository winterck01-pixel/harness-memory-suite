import React,{useState} from 'react';
export const taskStageLabel=task=>({queued:'排队中',preparing:'准备参考素材',submitting:'正在提交',downloading:'生成已完成，正在保存结果',download_failed:'生成已完成，保存失败',query_blocked:'查询已暂停，请检查接口配置',query_timeout:'查询超时，远程结果待核查'}[task?.stage]||'');
export function TaskRecovery({task,kind='image'}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!task?.stage)return null;
 const canRecover=!!task.remoteId&&['query_blocked','query_timeout','download_failed'].includes(task.stage);
 async function retry(useCurrentConfig=false){if(busy)return;setBusy(true);setError('');try{const response=await fetch('/api/'+kind+'-studio/tasks/'+(useCurrentConfig?'recover':'retry-download'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:task.id,...(useCurrentConfig?{useCurrentConfig:true}:{})}),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw Error(data.error||'恢复任务失败');}catch(e){setError(e.name==='TimeoutError'?'恢复请求仍可能在处理，请刷新任务状态；未重新生成。':e.message)}finally{window.dispatchEvent(new Event('dsh-'+kind+'-assets-changed'));setBusy(false)}}
 return <div role="status" data-media-stage={task.stage}><span>{taskStageLabel(task)}</span>{task.stage==='download_failed'&&<><p>仅恢复原结果下载；链接过期时查询原任务，不发起新的生成请求。</p><button type="button" disabled={busy} onClick={()=>retry(false)}>{busy?'正在恢复…':'重新下载结果'}</button></>}{canRecover&&<><p>修改接口设置后，可按当前设置恢复同一服务商的原任务；切换服务商的配置不会用于旧任务。</p><button type="button" disabled={busy} onClick={()=>retry(true)}>按当前设置恢复查询</button></>}{error&&<p role="alert">{error}</p>}</div>;
}
