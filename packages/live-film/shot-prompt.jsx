import React,{useState,useRef,useImperativeHandle,useEffect} from 'react';
export function ShotPrompt({value,onChange,references,apiRef,scopeKey}){
 const input=useRef(null),[query,setQuery]=useState(null),[index,setIndex]=useState(0);
 useEffect(()=>{setQuery(null);setIndex(0)},[scopeKey]);
 const matches=query?references.filter(r=>(r.label+' '+r.asset.name).toLowerCase().includes(query.text.toLowerCase())):[];
 function inspect(text,cursor){
  const match=/(?:^|[^\w])@([^\s@，。！？]*)$/u.exec(text.slice(0,cursor));
  if(!match){setQuery(null);return}
  const start=cursor-match[1].length-1,existing=/^@(图片|视频|音频)[1-9]\d*/u.exec(text.slice(start)),end=existing?start+existing[0].length:cursor;
  setQuery(existing&&cursor>end?null:{start,end,text:match[1]});setIndex(0);
 }
 function insert(row,range=query){const el=input.current,start=range?.start??el?.selectionStart??value.length,end=range?.end??el?.selectionEnd??start,token=row.token+' ',text=value.slice(0,start)+token+value.slice(end);onChange(text);setQuery(null);requestAnimationFrame(()=>{el?.focus();el?.setSelectionRange(start+token.length,start+token.length)})}
 useImperativeHandle(apiRef,()=>({insert:row=>insert(row)}));
 return <div className="lf-prompt"><label htmlFor="lf-shot-prompt">提示词 <small>输入 @ 或点击参考卡引用素材</small></label><textarea id="lf-shot-prompt" ref={input} aria-label="片段提示词" rows="4" placeholder="描述人物动作、镜头与声音，输入 @ 引用参考素材…" value={value} aria-expanded={!!query} aria-controls={query?'lf-shot-mentions':undefined} aria-autocomplete="list" onChange={e=>{onChange(e.target.value);inspect(e.target.value,e.target.selectionStart)}} onClick={e=>inspect(e.currentTarget.value,e.currentTarget.selectionStart)} onKeyUp={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key))inspect(e.currentTarget.value,e.currentTarget.selectionStart)}} onBlur={()=>setQuery(null)} onKeyDown={e=>{if(!query||e.nativeEvent.isComposing)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setQuery(null)}else if(matches.length&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();setIndex(i=>(i+(e.key==='ArrowDown'?1:-1)+matches.length)%matches.length)}else if(matches.length&&['Enter','Tab'].includes(e.key)){e.preventDefault();insert(matches[index%matches.length])}}}/>{query&&<div id="lf-shot-mentions" role="listbox" aria-label="引用参考素材" className="lf-mentions">{matches.map((r,i)=><button key={r.id} type="button" role="option" aria-selected={i===index%matches.length} onMouseDown={e=>e.preventDefault()} onClick={()=>insert(r)}><b>{r.token}</b><span>{r.asset.name}</span></button>)}{!matches.length&&<small>{references.length?'没有匹配的参考素材':'请先添加参考素材'}</small>}</div>}</div>
}
