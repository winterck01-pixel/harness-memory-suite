import React,{useRef} from 'react';
export function Playhead({time,total,onSeek}){
 const drag=useRef(false);
 function seek(e){const r=e.currentTarget.getBoundingClientRect();onSeek(Math.max(0,Math.min(total,(e.clientX-r.left)/r.width*total)))}
 return <><div className="lf-seek-ruler" role="slider" aria-label="时间轴播放位置" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Number(time.toFixed(2))} aria-valuetext={time.toFixed(2)+' 秒'} tabIndex={0} onKeyDown={e=>{let t;if(e.key==='ArrowLeft')t=time-.1;if(e.key==='ArrowRight')t=time+.1;if(e.key==='Home')t=0;if(e.key==='End')t=total;if(t!==undefined){e.preventDefault();onSeek(Math.max(0,Math.min(total,t)))}}} onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();drag.current=true;e.currentTarget.setPointerCapture(e.pointerId);seek(e)}} onPointerMove={e=>{if(drag.current)seek(e)}} onPointerUp={e=>{if(drag.current)seek(e);drag.current=false}} onPointerCancel={()=>{drag.current=false}}/>
 <div className="lf-playhead" style={{left:(total?Math.min(time,total)/total*100:0)+'%'}}><span/><i/></div></>
}
