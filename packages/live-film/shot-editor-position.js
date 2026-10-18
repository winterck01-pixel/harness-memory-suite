import {useLayoutEffect,useState} from 'react';
/** Anchor the composer above its timeline clip; contain it within the workspace. */
export function useShotEditorPosition({rootRef,editorRef,trackRef,open,shotId,expanded,layoutKey}){
 const [position,setPosition]=useState({visibility:'hidden'});
 useLayoutEffect(()=>{
  if(!open)return;
  const root=rootRef.current,editor=editorRef.current;if(!root||!editor)return;
  let frame=0;
  const measure=()=>{
   frame=0;const bounds=root.getBoundingClientRect(),timeline=root.querySelector('.lf-timeline')?.getBoundingClientRect(),header=root.querySelector('header')?.getBoundingClientRect();if(!timeline)return;
   const clip=[...(trackRef.current?.querySelectorAll('[data-shot-id]')||[])].find(el=>el.dataset.shotId===shotId),anchor=clip?.getBoundingClientRect(),width=Math.min(expanded?1000:760,Math.max(0,bounds.width-24)),center=anchor?(anchor.left+anchor.right)/2-bounds.left:bounds.width/2;
   const left=Math.max(12,Math.min(center-width/2,bounds.width-width-12)),minimumTop=Math.max(12,(header?.bottom||bounds.top)-bounds.top+8),bottom=timeline.top-bounds.top-12,height=Math.max(0,Math.min(expanded?460:320,bottom-minimumTop));
   const next={left,top:Math.max(minimumTop,bottom-height),width,height,maxHeight:height,visibility:'visible','--lf-anchor-x':Math.max(20,Math.min(width-20,center-left))+'px'};
   setPosition(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure)};
  measure();const observer=new ResizeObserver(schedule);
  for(const el of [root,root.querySelector('.lf-upper'),root.querySelector('.lf-timeline'),trackRef.current])if(el)observer.observe(el);
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);
  return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true)};
 },[open,shotId,expanded,layoutKey,rootRef,editorRef,trackRef]);
 return position;
}
