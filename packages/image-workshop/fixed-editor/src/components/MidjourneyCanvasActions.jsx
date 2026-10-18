import React, {useCallback,useEffect,useMemo,useState} from 'react';
import {MidjourneyActions} from '../../../../live-film/midjourney-controls.jsx';

const ACTION_NAMES={upscale:'放大',variation:'变体','high-variation':'强变化','low-variation':'弱变化',reroll:'重抽',zoom:'扩图',pan:'平移扩图','remix-strong':'强重混','remix-subtle':'弱重混',inpaint:'局部重绘',modal:'蒙版重绘'};

export function MidjourneyCanvasActions({task,selectedAsset,onImport}) {
  const [observed,setObserved]=useState({}),[focused,setFocused]=useState(null),[assetId,setAssetId]=useState(null),[importing,setImporting]=useState(false);
  useEffect(()=>{setFocused(null);setAssetId(null);},[task.id,selectedAsset?.id]);
  const onTaskUpdate=useCallback(job=>setObserved(rows=>({...rows,[job.id]:job})),[]);
  const followups=useMemo(()=>Object.values({...Object.fromEntries((task.followups||[]).map(t=>[t.id,t])),...observed}).filter(t=>t.id!==task.id&&['completed','awaiting_input'].includes(t.status)),[task.followups,observed,task.id]);
  const actionTask=followups.find(t=>t.id===focused)||task;
  const derived=actionTask.id!==task.id;
  const actionAsset=derived?(actionTask.results?.find(a=>a.id===assetId)||actionTask.results?.[0]):selectedAsset;
  async function apply(asset,job){
    if(importing)return;setImporting(true);
    try{
      if(await onImport(asset)!==false&&job){onTaskUpdate(job);setFocused(job.id);setAssetId(asset.id);}
    }finally{setImporting(false);}
  }
  return <div className="iw-mj-lineage">
    {!!followups.length&&<label>操作来源
      <select aria-label="Midjourney 操作来源" value={actionTask.id} onChange={e=>{setFocused(e.target.value===task.id?null:e.target.value);setAssetId(null);}}>
        <option value={task.id}>原始四图任务</option>
        {followups.map((t,i)=><option value={t.id} key={t.id}>{ACTION_NAMES[t.extra?.action]||'派生结果'} · {i+1}{t.status==='awaiting_input'?' · 等待蒙版':''}</option>)}
      </select>
    </label>}
    {derived&&!!actionTask.results?.length&&<>
      <div className="iw-mj-derived-results" aria-label="Midjourney 派生结果">{actionTask.results.map((a,i)=><button type="button" key={a.id} aria-label={`选择派生结果 ${i+1}`} aria-pressed={actionAsset?.id===a.id} onClick={()=>setAssetId(a.id)}><img src={'/api/image-studio/image?id='+encodeURIComponent(a.id)} alt={`派生结果 ${i+1}`}/></button>)}</div>
      <button type="button" disabled={importing||!actionAsset} onClick={()=>apply(actionAsset,actionTask)}>{importing?'正在加入画布…':'应用选中的派生结果'}</button>
    </>}
    <MidjourneyActions key={actionTask.id} task={actionTask} selectedAsset={actionAsset} onResult={apply} onTaskUpdate={onTaskUpdate} resultActionLabel="应用新结果并继续操作"/>
  </div>;
}
