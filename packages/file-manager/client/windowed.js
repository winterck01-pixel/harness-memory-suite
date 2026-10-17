import {useState,useLayoutEffect,useEffect,useMemo} from 'react'
export function useWindowedEntries(items,view,resetKey) {
  const [node,setNode]=useState(null),[box,setBox]=useState({width:600,height:600,top:0})
  useLayoutEffect(()=>{if(!node)return;let frame=0;const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(node.clientWidth)setBox({width:node.clientWidth,height:node.clientHeight,top:node.scrollTop})})};const observer=new ResizeObserver(measure);observer.observe(node);node.addEventListener('scroll',measure,{passive:true});measure();return()=>{observer.disconnect();node.removeEventListener('scroll',measure);cancelAnimationFrame(frame)}},[node])
  useEffect(()=>{if(node)node.scrollTop=0;setBox(b=>({...b,top:0}))},[resetKey,node])
  return useMemo(()=>{
    const list=view==='list',gap=list?0:view==='large'?12:6,padding=list?0:24
    const columns=list?1:Math.max(1,Math.floor((box.width-padding+gap)/((view==='large'?172:120)+gap)))
    const row=list?30:view==='large'?220:166
    const rows=Math.ceil(items.length/columns),first=Math.min(Math.max(0,rows-Math.ceil(box.height/row)),Math.max(0,Math.floor(Math.max(0,box.top-(list?32:12))/row)-3)),last=Math.min(rows,first+Math.ceil(box.height/row)+7)
    const start=Math.min(first*columns,items.length),end=Math.min(last*columns,items.length)
    return {ref:setNode,items:items.slice(start,end),top:first*row,bottom:Math.max(0,(rows-last)*row),columns,rowHeight:row-gap,gap}
  },[items,view,box])
}
