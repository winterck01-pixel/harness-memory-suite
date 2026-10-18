import React, {useRef, useState, useImperativeHandle} from 'react';

export function resolveReferences(prompt, bindings, manual, layers) {
  const tokens=[...prompt.matchAll(/@参考\d+(?!\d)/g)].map(m=>m[0]);
  const mentions=[...new Set(tokens)].map(token=>bindings.find(b=>b.token===token)||{token});
  const missing=mentions.find(m=>!layers.some(l=>l.id===m.layerId));
  const ids=[...new Set([...manual.filter(id=>layers.some(l=>l.id===id)),...mentions.map(m=>m.layerId).filter(Boolean)])];
  return {ids,mentions,error:missing?`${missing.token} 对应的参考图已删除或未绑定，请重新 @ 选择。`:null};
}

export function PromptReferences({value,onChange,mentions,onMentions,layers,assets,apiRef,compact=false}) {
  const input=useRef(null), [query,setQuery]=useState(null), [cursor,setCursor]=useState(0), [active,setActive]=useState(0);
  const choices=query===null?[]:layers.filter(l=>l.name.toLowerCase().includes(query.toLowerCase()));
  function inspect(text,position){
    const match=/@([^@\s]*)$/.exec(text.slice(0,position));
    setCursor(position);setQuery(match&&!/^参考\d+$/.test(match[1])?match[1]:null);setActive(0);
  }
  function insertLayer(layer,typed=false){
    if(!layer)return;
    const existing=mentions.find(m=>m.layerId===layer.id);
    const token=existing?.token||`@参考${Math.max(0,...mentions.map(m=>Number(m.token.slice(3))||0))+1}`;
    if(!existing)onMentions([...mentions,{token,layerId:layer.id}]);
    const start=typed?cursor-(query?.length||0)-1:(input.current?.selectionStart??value.length);
    const end=typed?cursor:(input.current?.selectionEnd??value.length);
    const prefix=value.slice(0,start),spacer=prefix&&!/\s$/.test(prefix)?' ':'';
    onChange(prefix+spacer+token+' '+value.slice(end));setQuery(null);
    requestAnimationFrame(()=>{const pos=start+spacer.length+token.length+1;input.current?.focus();input.current?.setSelectionRange(pos,pos);});
  }
  function choose(layer){insertLayer(layer,true);}
  useImperativeHandle(apiRef,()=>({insertLayer:id=>insertLayer(layers.find(l=>l.id===id))}));
  const used=resolveReferences(value,mentions,[],layers).mentions;
  return <div className="iw-prompt-references">
    <textarea ref={input} value={value} rows={compact?3:4} aria-label="提示词" data-testid="gen-prompt" placeholder="描述画面，输入 @ 选择参考图…"
      onChange={e=>{onChange(e.target.value);inspect(e.target.value,e.target.selectionStart);}}
      onClick={e=>inspect(value,e.target.selectionStart)}
      onKeyDown={e=>{
        if(query===null||e.nativeEvent.isComposing)return;
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setQuery(null);}
        if(choices.length&&['ArrowDown','ArrowUp','Enter'].includes(e.key)){e.preventDefault();if(e.key==='Enter')choose(choices[active%choices.length]);else setActive((active+(e.key==='ArrowDown'?1:choices.length-1))%choices.length);}
      }}/>
    {query!==null&&<div className="iw-mention-menu" role="listbox" aria-label="选择参考图">{choices.map((l,i)=>{
      const asset=Array.isArray(assets)?assets.find(a=>a.id===l.assetId):assets?.[l.assetId];
      return <button type="button" role="option" aria-selected={active===i} key={l.id} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(l)}>{asset?.previewUrl&&<img src={asset.previewUrl} alt=""/>}<span>{l.name}</span></button>;
    })}{!choices.length&&<p>没有匹配图层</p>}</div>}
    {!compact&&!!used.length&&<div className="iw-mention-bindings">{used.map(m=><span key={m.token}>{m.token} → {layers.find(l=>l.id===m.layerId)?.name||'参考图已删除'}</span>)}</div>}
    {!compact&&<small className="iw-hint">@ 引用按图层 ID 绑定，提交时对应实际参考图序号；使用 @ 时分别输入。</small>}
  </div>;
}
