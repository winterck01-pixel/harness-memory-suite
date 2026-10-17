import React,{useEffect,useState,useRef} from 'react'
import {FILE_TYPES,fileType} from '../lib/file-types.js'
export function TypeIcon({entry,type,size=64}) {
  const kind=type||fileType(entry),meta=FILE_TYPES[kind]||FILE_TYPES.other
  const glyph={image:<><circle cx="37" cy="28" r="4"/><path d="m17 45 10-12 7 8 5-5 8 10"/></>,video:<path d="m26 26 15 10-15 10z"/>,audio:<><path d="M29 43V25l14-3v18M29 29l14-3"/><ellipse cx="25" cy="44" rx="4" ry="3"/><ellipse cx="39" cy="41" rx="4" ry="3"/></>,spreadsheet:<><rect x="18" y="25" width="28" height="23" rx="2"/><path d="M18 33h28M18 40h28M27 25v23M37 25v23"/></>,code:<><path d="m24 29-7 8 7 8m16-16 7 8-7 8M35 27l-6 20"/></>,archive:<><path d="M31 15v25" strokeDasharray="3 2"/><rect x="28" y="40" width="7" height="9" rx="2"/></>,webpage:<><circle cx="32" cy="36" r="13"/><ellipse cx="32" cy="36" rx="6" ry="13"/><path d="M19 36h26M22 29h20M22 43h20"/></>}[kind]||<><path d="M20 28h23M20 35h23M20 42h17"/></>
  return <svg className="dfm-type-icon" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{flex:'none',color:meta.color}}>{kind==='folder'?<><path d="M5 18a5 5 0 0 1 5-5h16l6 6h22a5 5 0 0 1 5 5v27H5z" fill="currentColor" opacity=".7"/><path d="M5 26h54l-4 25a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z" fill="currentColor"/><path d="M9 29h45" stroke="white" strokeOpacity=".35" strokeWidth="2"/></>:<><path d="M15 5h24l12 12v38a4 4 0 0 1-4 4H15a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z" fill="currentColor" opacity=".16"/><path d="M15 5h24l12 12v38a4 4 0 0 1-4 4H15a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M39 5v9a3 3 0 0 0 3 3h9" fill="currentColor" opacity=".3"/><g stroke="currentColor" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">{glyph}</g></>}</svg>
}
export function TypeBadge({type}) {const meta=FILE_TYPES[type]||FILE_TYPES.other;return <span className="dfm-type-badge" style={{'--type-color':meta.color}}>{meta.label}</span>}
export function KnowledgeArtwork({item,compact=false}) {
  const ref=useRef(null),[visible,setVisible]=useState(false),[failed,setFailed]=useState(false)
  const path=item.assetId?.startsWith('file:')?item.assetId.slice(5):null
  const image=path && ['image','video'].includes(item.type)
  useEffect(()=>{setFailed(false);const observer=new IntersectionObserver(([e])=>setVisible(e.isIntersecting),{rootMargin:'100px'});if(ref.current)observer.observe(ref.current);return()=>observer.disconnect()},[path,item.updatedAt])
  return <span ref={ref} className={compact?'dfm-kb-mini':'dfm-kb-art'} title={failed?'预览暂不可用':undefined}>{image&&visible&&!failed?<img alt="" loading="lazy" decoding="async" src={'/dsh-fileman/thumbnail?path='+encodeURIComponent(path)+'&v='+encodeURIComponent(item.updatedAt||'')} onError={()=>setFailed(true)}/>:<TypeIcon type={item.type||'note'} size={compact?24:80}/>}</span>
}
