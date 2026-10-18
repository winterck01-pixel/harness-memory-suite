import {modeCapability,ratiosForMode} from '../video-studio/model-capabilities.js';
import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
const key=Symbol.for('dsh.media-mode-toolbar.v1');
const hub=globalThis[key]||(globalThis[key]={providers:new Map(),listeners:new Set()});
const notify=()=>{for(const fn of hub.listeners)fn()};
export function registerMediaProvider(provider){hub.providers.set(provider.kind,provider);notify();return()=>{if(hub.providers.get(provider.kind)===provider){hub.providers.delete(provider.kind);notify()}}}
export function mediaPrefixLength(draft){return String(draft||'').match(/^(?:\/(?:image|video)(?:\s+|(?=\/)|$))+/)?.[0].length||0}
const button={border:'1px solid var(--dsw-alias-border-l1)',background:'var(--dsw-alias-bg-layer-1, #fff)',color:'inherit',borderRadius:8,padding:'6px 10px',cursor:'pointer'};
export function MediaModeToolbar({kind,ctx,...props}){
 const input=props.useInput(s=>s),latest=useRef(input);latest.current=input;
 const [,render]=useState(0),[open,setOpen]=useState(false),[configs,setConfigs]=useState({}),[error,setError]=useState('');
 const [menuPosition,setMenuPosition]=useState({}),menu=useRef(null);
 const container=useRef(null),trigger=useRef(null),mounted=useRef(false),epoch=useRef(0);
 const providers=[...hub.providers.values()],owner=hub.providers.has('image')?'image':'video';
 const busy=input.phase==='submitting'||input.phase==='adjudicating';
 const current=['image','video'].includes(input.claim?.name)?input.claim.name:'chat';
 const active=hub.providers.get(current),options=active?.getOptions?.(props.sessionId,input.draft)||active?.modes.get(props.sessionId)||{},model=options.model||'';
 const spec=model&&active?active.modelSpec(model):null;
 useEffect(()=>{mounted.current=true;const fn=()=>render(x=>x+1);hub.listeners.add(fn);return()=>{mounted.current=false;epoch.current++;hub.listeners.delete(fn)}},[]);
 useEffect(()=>{setOpen(false);setError('');},[props.sessionId]);
 async function refresh(){const request=++epoch.current;const result={};await Promise.all([...hub.providers.values()].map(async p=>{try{result[p.kind]=await p.config()}catch(e){result[p.kind]={enabledModels:[],error:e.message}}}));if(mounted.current&&request===epoch.current)setConfigs(result)}
 useEffect(()=>{if(owner!==kind)return;void refresh();const fn=()=>void refresh();window.addEventListener('dsh-image-models-changed',fn);window.addEventListener('dsh-video-models-changed',fn);return()=>{epoch.current++;window.removeEventListener('dsh-image-models-changed',fn);window.removeEventListener('dsh-video-models-changed',fn)}},[kind,owner]);
 useEffect(()=>{if(!open)return;const outside=e=>{if(!container.current?.contains(e.target)&&!menu.current?.contains(e.target))setOpen(false)};const escape=e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus()}};document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true)}},[open]);
 useEffect(()=>{if(!open)return;const place=()=>{const r=trigger.current?.getBoundingClientRect();if(!r)return;const above=r.top>240;setMenuPosition({position:'fixed',right:Math.max(8,window.innerWidth-r.right),...(above?{bottom:window.innerHeight-r.top+8}:{top:r.bottom+8}),maxHeight:Math.max(80,Math.min(window.innerHeight*.6,above?r.top-16:window.innerHeight-r.bottom-16))})};place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true)}},[open]);
 function clearModes(){for(const p of hub.providers.values()){p.modes.delete(props.sessionId);localStorage.removeItem(p.modeKey(props.sessionId))}}
 function choose(target,id){if(busy)return;setError('');const snapshot=latest.current,capture=props.inputActions.captureInsertion(),facade=ctx.conversation.input.for(ctx.sessions.scope(props.sessionId)),end=mediaPrefixLength(snapshot.draft);
  try{
   if(target==='chat'){
    if(end&&!facade.consumeToken({kind:'span',span:{...capture,start:0,end}}))throw Error('输入内容已变化，请重新选择聊天模式');
    clearModes();setOpen(false);notify();return;
   }
   const provider=hub.providers.get(target),config=configs[target];
   if(!provider||!config?.enabledModels?.includes(id))throw Error('此模型暂不可用，请重新打开菜单');
   const old=provider.modes.get(props.sessionId),next=old?.model===id?{...old}:provider.defaults(id);
   const result=facade.beginCommand({name:target,token:`/${target} `,hint:(target==='image'?'图片生成':'视频生成')+' · '+provider.label(id,config.modelProfiles),attachments:true,
    submit:async(args,_actx,attachments=[])=>provider.submit({sessionId:props.sessionId,model:id,args,attachments,options:{...(provider.modes.get(props.sessionId)||next)}})
   },{...capture,start:0,end});
   if(!result)throw Error('输入框暂时无法切换，请重试');
   clearModes();provider.modes.set(props.sessionId,next);setOpen(false);notify();
  }catch(e){setError(e.message)}
 }
 useEffect(()=>{if(!active||!model||busy)return;const config=configs[current];if(config&&!config.error&&!config.enabledModels?.includes(model)){choose('chat');setError('当前生成模型已停用，已返回聊天模式，正文保留。')}},[configs,current,model,busy,props.sessionId]);
 function update(name,value){if(!active||busy)return;const previous=active.modes.get(props.sessionId)||options;active.modes.set(props.sessionId,{...previous,...(typeof name==='object'?name:{[name]:value})});notify()}
 if(owner!==kind)return null;
 const select=(label,name,values,value,format=x=>x)=>values?.length>1?<select aria-label={label} value={value} disabled={busy} style={button} onChange={e=>update(name,['n','duration'].includes(name)?Number(e.target.value):e.target.value)}>{values.map(v=><option key={v} value={v}>{format(v)}</option>)}</select>:null;
 return <div ref={container} data-dsh-media-toolbar='' data-media-mode={current} style={{position:'relative',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
 <style>{'div:has([data-dsh-media-toolbar]:not([data-media-mode="chat"])) > [data-slot="conversation.input.model"]{display:none!important}'}</style>
 <button ref={trigger} type='button' aria-label='聊天、图片或视频模式' aria-haspopup='menu' aria-expanded={open} disabled={busy} style={button} onClick={()=>{setOpen(v=>!v);if(!open)void refresh()}}>{current==='chat'?'聊天模式':current==='image'?'图片模式':'视频模式'} ▾</button>
 {open&&createPortal(<div ref={menu} role='menu' aria-label='选择聊天或生成模式' style={{...menuPosition,zIndex:1400,width:300,maxWidth:'85vw',overflowY:'auto',padding:8,borderRadius:12,background:'var(--dsw-alias-bg-layer-1, #fff)',border:'1px solid var(--dsw-alias-border-l1)',boxShadow:'0 8px 30px #0003'}}>
 <button role='menuitem' type='button' style={{...button,width:'100%',textAlign:'left'}} onClick={()=>choose('chat')}>聊天模式</button>
 {providers.map(p=><button key={p.kind} role='menuitem' type='button' style={{...button,display:'block',width:'100%',textAlign:'left',marginTop:4}} disabled={!configs[p.kind]?.enabledModels?.length} onClick={()=>{const config=configs[p.kind];choose(p.kind,config.enabledModels.includes(config.defaultModel)?config.defaultModel:config.enabledModels[0])}}>{p.kind==='image'?'图片模式':'视频模式'}</button>)}
 {providers.some(p=>configs[p.kind]?.error)&&<small role='alert'>模型读取失败，请重新打开菜单。</small>}
 </div>,document.body)}
 {active&&spec&&<>
 <select aria-label={current==='image'?'选择图片模型':'选择视频模型'} value={model} disabled={busy} style={{...button,maxWidth:240}} onChange={e=>choose(current,e.target.value)}>{(configs[current]?.enabledModels||[model]).map(id=><option key={id} value={id}>{active.label(id,configs[current]?.modelProfiles)}</option>)}</select>
 {current==='video'&&select('视频时长','duration',spec.durations,options.duration,x=>x===-1?'智能时长':x+'秒')}

 {spec.sizes?.length>0&&select(current==='image'?'图片清晰度':'视频清晰度','resolution',['',...spec.sizes],options.resolution||'',x=>x||'默认清晰度')}
 {select(current==='image'?'生成图片数量':'生成视频数量','n',spec.fields.n?.values,options.n||1,x=>x+(current==='image'?'张':'段'))}
 {current==='video'&&['input','omit'].includes(modeCapability(spec,options.generationMode||spec.generationModes?.[0])?.ratioPolicy)?<small>{modeCapability(spec,options.generationMode||spec.generationModes?.[0])?.ratioPolicy==='input'?'画面跟随输入图片':'画面跟随输入视频'}</small>:select(current==='image'?'图片比例':'视频比例','aspectRatio',current==='video'?ratiosForMode(spec,options.generationMode||spec.generationModes?.[0]):active.ratiosFor(model),options.aspectRatio,x=>x==='auto'?'智能':x==='match_input_image'?'匹配参考图':x)}
 {active.renderControls?.({model,spec,options,update,busy,style:button,profiles:configs[current]?.modelProfiles})}
 </>}{error&&<span role='alert'>{error}</span>}
 </div>
}
