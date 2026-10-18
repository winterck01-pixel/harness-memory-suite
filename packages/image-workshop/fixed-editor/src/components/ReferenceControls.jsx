import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';

export function ReferenceControls({references,layers,assets,onMention}){
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[draft,setDraft]=useState([]);
  const dialog=useRef(null),search=useRef(null),trigger=useRef(null);
  useEffect(()=>{if(!open)return;search.current?.focus();},[open]);
  const close=()=>{setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());};
  const shown=layers.filter(l=>l.name.toLowerCase().includes(query.trim().toLowerCase()));
  const assetFor=l=>assets.find(a=>a.id===l.assetId);
  return <>
    <div className="iw-composer-references" aria-label="生成参考图">
      {references.resolved.ids.map((id,i)=>{const layer=layers.find(l=>l.id===id),asset=layer&&assetFor(layer);return <div className="iw-composer-ref" key={id}>
        <button type="button" aria-label={`引用参考图 ${i+1} ${layer?.name||''}`} title={`点击在提示词中插入参考图 ${i+1}：${layer?.name||''}`} onMouseDown={e=>e.preventDefault()} onClick={()=>onMention(id)}>
          {asset&&<img src={asset.previewUrl} alt=""/>}<span>参考图 {i+1}</span>
        </button>
        <button type="button" className="iw-composer-ref-remove" aria-label={`移除参考图 ${i+1}`} title="移除此参考及提示词中的对应引用" onClick={()=>references.replaceIds(references.resolved.ids.filter(i=>i!==id))}>×</button>
      </div>;})}
      <button ref={trigger} type="button" className="iw-composer-ref-add" aria-label="添加参考图" title="添加画布图层作为参考" aria-haspopup="dialog" onClick={()=>{setDraft(references.resolved.ids);setQuery('');setOpen(true);}}>＋</button>
      {!references.resolved.ids.length&&<small>添加参考图 · 支持 @ 精准引用</small>}
    </div>
    {open&&createPortal(<div className="iw-reference-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)close();}}>
      <section ref={dialog} className="iw-reference-dialog" role="dialog" aria-modal="true" aria-label="添加参考图层" onKeyDown={e=>{
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
        if(e.key==='Tab'){const nodes=[...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')],first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
      }}>
        <header><strong>添加参考图</strong><button type="button" aria-label="关闭参考图选择" onClick={close}>×</button></header>
        <input ref={search} aria-label="搜索参考图层" placeholder="搜索画布图层…" value={query} onChange={e=>setQuery(e.target.value)}/>
        <ul>{shown.map((layer,index)=>{const asset=assetFor(layer);return <li key={layer.id}><label><input type="checkbox" aria-label={`添加图层 ${layer.name} ${layers.indexOf(layer)+1}`} checked={draft.includes(layer.id)} onChange={e=>setDraft(ids=>e.target.checked?[...new Set([...ids,layer.id])]:ids.filter(id=>id!==layer.id))}/>{asset&&<img src={asset.previewUrl} alt=""/>}<span>{layer.name}<small>{!layer.visible?'已隐藏 · ':''}{layer.locked?'已锁定 · ':''}图层 {layers.indexOf(layer)+1}</small></span></label></li>;})}{!shown.length&&<li className="iw-hint">暂无匹配图层，请先导入图片或生成图层。</li>}</ul>
        <footer><button type="button" onClick={()=>{close();references.start();}}>从画布选图</button><span/><button type="button" onClick={close}>取消</button><button type="button" className="iw-primary" onClick={()=>{references.replaceIds(draft);close();}}>使用 {draft.filter(id=>layers.some(l=>l.id===id)).length} 张参考图</button></footer>
      </section>
    </div>,document.querySelector('.iw-app')||document.body)}
  </>;
}
