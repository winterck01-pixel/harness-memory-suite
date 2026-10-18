import React, {useState} from 'react';
import {useStore, useEditorState} from '../state/storeContext.jsx';
import {MidjourneyCanvasActions} from './MidjourneyCanvasActions.jsx';

function CandidateTask({task,batch}) {
  const store=useStore(), state=useEditorState(), [selected,setSelected]=useState(null), [placing,setPlacing]=useState(false);
  const native=task.nativeTask, mj=task.model==='midjourney';
  const all=task.candidates||[];
  const singles=all.filter(a=>a.resultRole!=='grid');
  const candidates=mj&&singles.length>=4?singles:all;
  const current=candidates.find(c=>c.id===selected)||candidates[0];
  const selectedAsset=native?.results?.find(r=>r.id===current?.nativeAssetId);
  const canvasId=state.canvas?.id;
  async function placeGrid(){
    setPlacing(true);
    try{for(const candidate of singles){if(store.activeCanvasId!==canvasId)break;if(await store.applyCandidate(batch.batch.id,candidate.id,{layout:'grid'})===false)break;}}
    finally{setPlacing(false);}
  }
  async function importResult(asset) {
    try {
      if(store.activeCanvasId!==canvasId)throw Error('请切回此任务所属画布');
      const response=await fetch('/api/image-studio/image?id='+encodeURIComponent(asset.id),{credentials:'same-origin'});
      if(!response.ok)throw Error('读取 Midjourney 新结果失败');
      const blob=await response.blob();
      if(store.activeCanvasId!==canvasId)throw Error('读取期间已切换画布，请返回后重试');
      await store.importImage(new File([blob],asset.name||'Midjourney 新结果',{type:blob.type}),{canvasId,targetRect:batch.batch.targetRect});
      return true;
    }catch(e){store.setNotice(e.message,'error');return false;}
  }
  return <div className="iw-candidate-group">
    <strong>{task.model}{mj?' · 四图与原生操作':''}</strong>
    {mj&&singles.length===4&&<button type="button" disabled={placing||singles.some(c=>c.applied)} onClick={placeGrid}>{placing?'正在加入画布…':singles.some(c=>c.applied)?'已有结果加入画布，可逐张添加其余结果':'四张按 2×2 加入画布'}</button>}
    {!!candidates.length&&<ul className="iw-candidate-list" data-testid="candidate-list">{candidates.map((c,i)=><li key={c.id} className={current?.id===c.id?'is-selected':''}>
      <button type="button" className="iw-candidate-preview" aria-pressed={current?.id===c.id} aria-label={`选择 ${task.model} ${c.resultRole==='grid'?'四宫格':`第 ${c.providerIndex||i+1} 张`}`} onClick={()=>setSelected(c.id)}><img src={c.previewUrl} alt={c.resultRole==='grid'?'Midjourney 四张总览':`候选 ${c.providerIndex||i+1}`}/><span>{c.resultRole==='grid'?'四张总览':`第 ${c.providerIndex||i+1} 张`}</span></button>
      <button type="button" disabled={placing} data-testid={`apply-candidate-${c.id}`} onClick={()=>store.applyCandidate(batch.batch.id,c.id)}>应用为图层</button>
    </li>)}</ul>}
    {mj&&native&&<MidjourneyCanvasActions task={native} selectedAsset={selectedAsset} onImport={importResult}/>}
  </div>;
}

export function GenerationCandidates({batch}) {
  const groups=(batch.tasks||[]).filter(t=>t.candidates?.length||t.nativeTask);
  // Older persisted frontend records used a flat candidate array.
  const assigned=new Set(groups.flatMap(t=>(t.candidates||[]).map(c=>c.id)));
  const remaining=(batch.candidates||[]).filter(c=>!assigned.has(c.id));
  if(remaining.length)groups.push({model:'生成结果',taskId:'unassigned',candidates:remaining});
  return <div>{groups.map(t=><CandidateTask key={batch.batch.id+':'+t.taskId} task={t} batch={batch}/>)}</div>;
}
