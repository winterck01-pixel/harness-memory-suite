import React,{useEffect,useState} from 'react';
import {PixelPreview} from '../../../../live-film/pixel-preview.jsx';
import {transformBounds} from '../lib/matrix.js';
import {generationFrames} from '../state/generation-placement.js';
const running=new Set(['queued','submitting','polling']);
const retryable=new Set(['completed','failed','rejected','cancelled']);
export function CanvasGeneration({store,state,layers,disabled=false}){
 const [selected,setSelected]=useState(null),[busy,setBusy]=useState(false),zoom=state.viewport.zoom;
 useEffect(()=>{if(state.selection.length)setSelected(null)},[state.selection.join('|')]);
 const records=state.generationBatches||[],frames=generationFrames(records);
 const retry=async(batchId,model)=>{setBusy(true);try{await store.regenerateTask(batchId,model)}finally{setBusy(false)}};
 const button=(batchId,model)=><button type="button" className="iw-canvas-regenerate" aria-label="重新生成" disabled={busy} style={{fontSize:12/zoom,padding:`${4/zoom}px ${7/zoom}px`}} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();void retry(batchId,model)}}>↻ {busy?'正在提交…':'重新生成'}</button>;
 const selectedLayer=state.selection.length===1?layers.find(l=>l.id===state.selection[0]):null;
 let selectedSource;
 if(selectedLayer)for(const row of records)for(const task of row.tasks)for(const c of task.candidates||row.candidates){if(c.appliedLayerId===selectedLayer.id)selectedSource={row,task};}
 const asset=selectedLayer&&state.assets.find(a=>a.id===selectedLayer.assetId),bounds=asset&&transformBounds(selectedLayer.matrix,asset.width,asset.height);
 return <>
  {frames.map(frame=><div key={frame.key} className={'iw-generation-frame is-'+frame.status} data-testid="generation-placeholder" data-model={frame.model} aria-label={running.has(frame.status)?'正在生成的区域':'生成任务区域'} style={{left:frame.rect.x,top:frame.rect.y,width:frame.rect.width,height:frame.rect.height,borderWidth:1/zoom}} onPointerDown={e=>{if(disabled)return;e.stopPropagation();store.clearSelection();setSelected(frame.key);}}>
   <div className="iw-generation-frame-content" style={{width:frame.rect.width*zoom,height:frame.rect.height*zoom,transform:`scale(${1/zoom})`}}>
    {running.has(frame.status)?<PixelPreview compact createdAt={frame.createdAt}/>:frame.candidate?<img src={frame.candidate.previewUrl} alt="生成结果"/>:<div className="iw-generation-state" role="status"><strong>{['uncertain','timed_out'].includes(frame.status)?'结果待核查':frame.status==='cancelled'?'已取消':'生成失败'}</strong><small>{frame.error||'原任务保留在生成记录中'}</small></div>}
   </div>
   {!disabled&&selected===frame.key&&!frame.local&&retryable.has(frame.status)&&button(frame.batchId,frame.model)}
  </div>)}
  {!disabled&&bounds&&selectedSource&&retryable.has(selectedSource.task.status)&&<div className="iw-generated-layer-actions" style={{left:bounds.x,top:bounds.y,width:bounds.width,height:bounds.height}}>{button(selectedSource.row.batch.id,selectedSource.task.model)}</div>}
 </>;
}
