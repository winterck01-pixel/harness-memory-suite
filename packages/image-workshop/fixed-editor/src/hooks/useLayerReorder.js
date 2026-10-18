import {useEffect,useRef,useState} from 'react';

// Pointer capture keeps the same row attached while the list auto-scrolls.
export function useLayerReorder(store,canvasId) {
  const listRef=useRef(null),drag=useRef(null),frame=useRef(null);
  const [dragging,setDragging]=useState(null),[dropBefore,setDropBefore]=useState(undefined);
  function marker(d){
    const list=listRef.current;if(!list)return;
    const rows=[...list.querySelectorAll('[data-layer-id]')].filter(el=>el.dataset.layerId!==d.id);
    const before=rows.find(el=>d.y<el.getBoundingClientRect().top+el.getBoundingClientRect().height/2);
    d.before=before?.dataset.layerId||null;setDropBefore(d.before);
  }
  function animate(){
    const d=drag.current,list=listRef.current;
    if(!d||!list)return;
    if(d.moved){
      const box=list.getBoundingClientRect(),edge=30;
      const speed=d.y<box.top+edge?-Math.min(14,Math.max(2,(box.top+edge-d.y)/2)):d.y>box.bottom-edge?Math.min(14,Math.max(2,(d.y-box.bottom+edge)/2)):0;
      if(speed)list.scrollTop+=speed;
      marker(d);
    }
    frame.current=requestAnimationFrame(animate);
  }
  function stop(commit){
    const d=drag.current;drag.current=null;
    cancelAnimationFrame(frame.current);setDragging(null);setDropBefore(undefined);
    try{d?.element.releasePointerCapture(d.pointerId);}catch{}
    if(!commit||!d?.moved||store.activeCanvasId!==d.canvasId)return;
    const canvas=store.doc.canvases[d.canvasId],layer=store.doc.layers[d.id];
    if(!canvas||!layer||layer.locked||!canvas.layerIds.includes(d.id))return;
    const visual=[...canvas.layerIds].reverse().filter(id=>id!==d.id);
    const index=d.before===null?visual.length:visual.indexOf(d.before);
    if(index<0)return;
    const toIndex=visual.length-index;
    if(canvas.layerIds.indexOf(d.id)===toIndex)return;
    store.execute({type:'reorderLayer',canvasId:canvas.id,baseRevision:canvas.revision,payload:{layerId:d.id,toIndex}});
  }
  useEffect(()=>{
    const cancel=e=>{if(e.key==='Escape'&&drag.current){e.preventDefault();stop(false);}};
    window.addEventListener('keydown',cancel);
    return()=>{window.removeEventListener('keydown',cancel);stop(false);};
  },[canvasId]);
  return {listRef,dragging,dropBefore,handleProps:layer=>({
    disabled:layer.locked,
    onPointerDown:e=>{
      if(e.button!==0||layer.locked)return;
      e.preventDefault();e.stopPropagation();
      drag.current={id:layer.id,canvasId,pointerId:e.pointerId,element:e.currentTarget,startX:e.clientX,startY:e.clientY,y:e.clientY,moved:false,before:undefined};
      e.currentTarget.setPointerCapture(e.pointerId);store.select(layer.id);
      frame.current=requestAnimationFrame(animate);
    },
    onPointerMove:e=>{
      const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;
      d.y=e.clientY;
      if(!d.moved&&Math.hypot(e.clientX-d.startX,e.clientY-d.startY)>=4){d.moved=true;setDragging(d.id);}
      if(d.moved)marker(d);
    },
    onPointerUp:e=>{if(drag.current?.pointerId===e.pointerId)stop(true);},
    onPointerCancel:()=>stop(false),onLostPointerCapture:()=>stop(false),
    onKeyDown:e=>{
      if(!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key)||layer.locked)return;
      e.preventDefault();e.stopPropagation();
      const canvas=store.doc.canvases[canvasId],from=canvas.layerIds.indexOf(layer.id),toIndex=from+(e.key==='ArrowUp'?1:-1);
      if(from>=0&&toIndex>=0&&toIndex<canvas.layerIds.length)store.execute({type:'reorderLayer',canvasId,baseRevision:canvas.revision,payload:{layerId:layer.id,toIndex}});
    },
  })};
}
