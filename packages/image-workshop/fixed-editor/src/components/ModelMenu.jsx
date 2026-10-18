import React, {useEffect, useRef, useState} from 'react';

export function ModelMenu({models, selected, onToggle}) {
  const [open,setOpen]=useState(false), [query,setQuery]=useState(''), [height,setHeight]=useState(300);
  const root=useRef(null), search=useRef(null), trigger=useRef(null);
  useEffect(()=>{
    if(!open)return;
    search.current?.focus();
    const measure=()=>{const box=root.current?.getBoundingClientRect(),panel=root.current?.closest('.iw-gen')?.getBoundingClientRect();if(box)setHeight(Math.max(100,Math.min(340,(panel?.bottom||window.innerHeight)-box.bottom-12,window.innerHeight-box.bottom-12)));};
    measure();window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);
    const close=e=>{if(!root.current?.contains(e.target))setOpen(false);};
    document.addEventListener('pointerdown',close);
    return()=>{document.removeEventListener('pointerdown',close);window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true);};
  },[open]);
  const filtered=models.filter(m=>(m.name+' '+m.id+' '+(m.family||'')).toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="iw-model-menu" ref={root} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);trigger.current?.focus();}}}>
    <button ref={trigger} type="button" className="iw-model-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(!open)}>
      <span>{selected.length ? `已选 ${selected.length} 个模型 · ${models.filter(m=>selected.includes(m.id)).map(m=>m.name||m.id).join('、')}` : '选择模型 · 可多选'}</span><span aria-hidden="true">▾</span>
    </button>
    {open&&<div className="iw-model-popover" style={{maxHeight:height}} role="dialog" aria-label="选择抽卡模型">
      <input ref={search} className="iw-gen-search" placeholder="搜索模型…" aria-label="搜索模型" value={query} onChange={e=>setQuery(e.target.value)}/>
      <ul className="iw-model-list" data-testid="model-list">{filtered.map(m=><li className="iw-model-item" key={m.id}><label><input type="checkbox" checked={selected.includes(m.id)} onChange={()=>onToggle(m.id)} aria-label={`选择模型 ${m.id}`}/><span className="iw-model-name" title={m.name||m.id}>{m.name||m.id}</span><span className="iw-model-family">{m.family}</span></label></li>)}</ul>
      {!filtered.length&&<p role="status">没有匹配的模型</p>}
      <footer><small>已选 {selected.length} 项</small><button type="button" onClick={()=>{setOpen(false);trigger.current?.focus();}}>完成</button></footer>
    </div>}
  </div>;
}
