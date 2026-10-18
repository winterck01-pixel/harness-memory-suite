import {TaskRecovery,taskStageLabel} from './task-recovery.jsx';
import React,{useEffect,useState} from 'react';
import {TaskDismiss} from './task-dismiss.jsx';
import {TaskBilling,notifyBalanceChange} from './cost-ui.jsx';
import {PixelPreview} from './pixel-preview.jsx';
// Production 0.2.0-rc.2 supplies explicit phase + the frozen ToolResultNode.
// Only trust a single task id in this call's successful structured JSON result.
export function generationToolTaskId({phase,toolName,block},kind){
 if(phase!=='result'||toolName!==(kind==='video'?'generate_video':'generate_image')||block?.isError)return '';
 const ids=[];for(const part of block?.content||[]){if(part.type!=='text'||typeof part.text!=='string')continue;try{const data=JSON.parse(part.text);const id=data?.task_id;if(typeof id==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(id))ids.push(id)}catch{}}
 return ids.length===1?ids[0]:'';
}
const storesKey=Symbol.for('dsh.generation-tool-cards.v1');
const stores=globalThis[storesKey]||(globalThis[storesKey]=new Map());
const activeStates=new Set(['queued','waiting','dispatching','submitting','polling']);
function taskStore(kind){
 if(stores.has(kind))return stores.get(kind);
 const store={rows:[],loaded:false,error:'',listeners:new Map(),inflight:null,timer:null,controller:null,revision:0};stores.set(kind,store);
 const notify=()=>{for(const fn of store.listeners.keys())fn()};
 function schedule(){clearTimeout(store.timer);store.timer=null;const ids=new Set(store.listeners.values());store.rows=store.rows.filter(task=>ids.has(task.id));if(!ids.size){store.controller?.abort();store.loaded=false;return}if(store.rows.some(task=>!task.hiddenAt&&activeStates.has(task.status)))store.timer=setTimeout(()=>load(),3000)}
 async function load(){
  if(store.inflight)return store.inflight;
  const requested=[...new Set(store.listeners.values())];if(!requested.length)return;
  const revision=store.revision,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);store.controller=controller;
  store.inflight=(async()=>{
   try{
    const rows=[];const batches=kind==='video'?Array.from({length:Math.ceil(requested.length/100)},(_,index)=>requested.slice(index*100,index*100+100)):[null];
    for(const batch of batches){const response=await fetch('/api/'+kind+'-studio/tasks'+(batch?'?ids='+encodeURIComponent(batch.join(',')):''),{credentials:'same-origin',signal:controller.signal});if(!response.ok)throw Error('生成记录暂不可用');const data=await response.json();rows.push(...(data.tasks||[]).filter(task=>requested.includes(task.id)));}
    if(revision===store.revision){const current=new Set(store.listeners.values());store.rows=rows.filter(task=>current.has(task.id));store.loaded=true;store.error='';notifyBalanceChange({tasks:store.rows.map(task=>({...task,kind}))});notify()}
   }catch(error){if(revision===store.revision&&!controller.signal.aborted){store.error=error.message;notify()}}
   finally{clearTimeout(timeout);store.inflight=null;store.controller=null;schedule();if([...store.listeners.values()].some(id=>!requested.includes(id))){clearTimeout(store.timer);store.timer=setTimeout(()=>load(),0)}}
  })();return store.inflight;
 }
 store.load=load;store.schedule=schedule;store.hide=(id,hiddenAt)=>{store.revision++;store.rows=store.rows.map(task=>task.id===id?{...task,hiddenAt}:task);notify();schedule()};window.addEventListener('dsh-'+kind+'-assets-changed',()=>{if(store.listeners.size)load()});return store;
}
function useToolTask(kind,id){const [,redraw]=useState(0),store=taskStore(kind);useEffect(()=>{if(!id)return;const notify=()=>redraw(x=>x+1);store.listeners.set(notify,id);if(!store.loaded||!store.rows.some(t=>t.id===id))store.load();else store.schedule();return()=>{store.listeners.delete(notify);store.schedule()}},[kind,id,store]);return {task:id?store.rows.find(t=>t.id===id):null,error:store.error,hide:store.hide}}
export function GenerationToolCard(props){const {kind='image',phase,block,inspect}=props,id=generationToolTaskId(props,kind),provided=Array.isArray(props.tasks)?props.tasks.find(row=>row.id===id):null,fallback=useToolTask(kind,provided?'':id),task=provided||fallback.task,error=provided?'':fallback.error,hide=fallback.hide;if(task?.hiddenAt)return null;
 const label=kind==='video'?'视频生成':'图片生成',active=task&&['queued','waiting','dispatching','submitting','polling'].includes(task.status),raw=(block?.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n'),status={completed:'已完成',failed:'生成失败',timed_out:'查询超时，结果待核查',uncertain:'提交结果待核查',awaiting_input:'等待补充输入',rejected:'未提交'}[task?.status];
 return <section aria-label={'Agent'+label+'任务'} data-generation-call={props.callId} style={{padding:12,border:'1px solid var(--dsw-alias-border-l1,#8885)',borderRadius:10,color:'var(--dsw-alias-label-primary,inherit)',background:'var(--dsw-alias-bg-layer-1,transparent)'}}>
  <header style={{display:'flex',gap:12,alignItems:'center'}}><strong>{label}</strong><span>{task?taskStageLabel(task)||(active?'正在生成':status||task.status):phase==='result'?block?.isError?'调用失败':'生成记录待核查':phase==='preparing'?'正在准备':'正在提交'}</span>{inspect&&<button type="button" onClick={inspect}>查看调用记录</button>}</header>
  {task?<><p style={{whiteSpace:'pre-wrap'}}>{task.prompt}</p><small>{task.model}</small>{active&&<><PixelPreview createdAt={task.createdAt}/><p>{task.generationState==='completed'?'生成已完成，正在保存原结果，不会重新生成。':'任务处理中，请先等待；删除记录不会取消服务商任务。'}</p></>}{task.error&&<p role="status">{task.error}</p>}{(task.results||[]).map(asset=>kind==='video'?<video key={asset.id} controls preload="metadata" src={'/api/video-studio/image?id='+encodeURIComponent(asset.id)} style={{width:'100%',maxHeight:360}}/>:<img key={asset.id} src={'/api/image-studio/image?id='+encodeURIComponent(asset.id)} alt={asset.name||task.prompt||'生成图片'} style={{maxWidth:'100%',maxHeight:360,objectFit:'contain'}}/>)}<TaskRecovery task={task} kind={kind}/><TaskBilling task={task} kind={kind}/><TaskDismiss task={task} kind={kind} onDismiss={result=>hide(id,result.hiddenAt)}/></>:phase==='result'?<><p>{id?'暂未找到对应本地任务，请查看调用记录。':'本次调用没有可核对的生成任务，保留原始结果。'}</p>{raw&&<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:240,overflow:'auto'}}>{raw}</pre>}{block?.error&&!raw&&<p role="alert">{block.error.message||block.error.name||'工具调用失败'}</p>}</>:null}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
