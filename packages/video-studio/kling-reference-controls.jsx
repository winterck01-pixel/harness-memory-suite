import React,{useState,useEffect,useRef} from 'react';
import {parseElements,elementPolicy} from './kling-reference-contract.js';
// No creation or generation is performed here: choose reusable subjects/motions
// already owned by the current account. Agent uses the same IDs via extra.
function libraryRows(value){
 if(Array.isArray(value))return value;
 if(!value||typeof value!=='object')return [];
 for(const k of ['elements','motions','items','list','records','data','body'])if(value[k]){const rows=libraryRows(value[k]);if(rows.length)return rows;}
 return [];
}
export function KlingReferenceControls({spec,extra,set,busy,style}){
 const [notice,message]=useState(''),[library,showLibrary]=useState([]),[loading,setLoading]=useState(false),[libraryTool,setLibraryTool]=useState('');const request=useRef(0);
 useEffect(()=>{request.current++;showLibrary([]);message('');setLoading(false);return()=>{request.current++}},[spec.id,spec.mcp.accountId]);
 const policy=elementPolicy(spec);let rows=[];try{const value=typeof extra.elements==='string'?JSON.parse(extra.elements):extra.elements;rows=Array.isArray(value)?value.filter(r=>r&&typeof r==='object'):[]}catch{}
 const save=next=>set('elements',next.length?next:'');
 const load=async tool=>{const epoch=++request.current;setLoading(true);message('');try{const q=new URLSearchParams({tool,accountId:spec.mcp.accountId}),r=await fetch('/api/'+(spec.kind==='image'?'image':'video')+'-studio/mcp/library?'+q,{credentials:'same-origin',cache:'no-store'}),v=await r.json();if(!r.ok)throw Error(v.error||'参考库读取失败');if(epoch!==request.current)return;const list=libraryRows(v).filter(x=>typeof x?.id==='string'||typeof x?.id==='number'&&Number.isSafeInteger(x.id)).map(x=>({id:String(x.id),name:String(x.name||x.id)}));showLibrary(list);setLibraryTool(tool);message(list.length?'请选择参考库条目':'当前账号没有可用条目');}catch(e){if(epoch===request.current)message(e.message)}finally{if(epoch===request.current)setLoading(false)}};
 return <section aria-label="可灵高级参考素材" style={{fontSize:12}}>
 {policy&&<><p>复用主体（最多 {policy.maxTotalElements} 项；{policy.videoElements?'图片或视频':'仅图片'}主体）。提示词用 &lt;&lt;&lt;ID&gt;&gt;&gt; 引用，提交前核对当前账号与真实类型。</p>
 <button type="button" disabled={busy||loading} onClick={()=>load('element_list')}>读取可灵主体库</button>
 {rows.map((row,i)=><div key={i} style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}><input aria-label={'主体 ID '+(i+1)} disabled={busy} style={{...style,width:130}} value={row.id} onChange={e=>save(rows.map((r,n)=>n===i?{...r,id:e.target.value}:r))}/><input aria-label={'主体名称 '+(i+1)} disabled={busy} style={{...style,width:110}} value={row.bindName} onChange={e=>save(rows.map((r,n)=>n===i?{...r,bindName:e.target.value}:r))}/><select aria-label={'主体类型 '+(i+1)} disabled={busy} style={style} value={row.type||'image'} onChange={e=>save(rows.map((r,n)=>n===i?{...r,type:e.target.value}:r))}><option value="image">图片主体</option>{policy.videoElements&&<option value="video">视频主体</option>}</select><button type="button" disabled={busy} onClick={()=>save(rows.filter((_,n)=>n!==i))}>移除</button></div>)}
 <label>主体列表（JSON，可手动编辑）<textarea aria-label="可灵主体列表" disabled={busy} style={{...style,width:'100%'}} value={typeof extra.elements==='string'?extra.elements:JSON.stringify(extra.elements||[])} onChange={e=>set('elements',e.target.value)}/></label>
 </>}
 {spec.mcp.tool==='motion_control'&&<><p>一张主体图片，加一段动作视频或一个已有动作 ID；生成时长随动作来源。image_direction 支持3–10秒，motion_direction 支持3–30秒。</p><button type="button" disabled={busy||loading} onClick={()=>load('motion_library_list')}>读取可灵动作库</button></>}
 {library.length>0&&<select aria-label="可灵参考库条目" value="" disabled={busy||loading} style={style} onChange={async e=>{const item=library.find(r=>r.id===e.target.value);if(!item)return;if(libraryTool==='motion_library_list')set('motionId',item.id);else {const epoch=++request.current;setLoading(true);try{const q=new URLSearchParams({tool:'element_get',id:item.id,accountId:spec.mcp.accountId}),r=await fetch('/api/'+(spec.kind==='image'?'image':'video')+'-studio/mcp/library?'+q,{credentials:'same-origin',cache:'no-store'}),v=await r.json();if(!r.ok)throw Error(v.error||'无法核对主体');if(epoch!==request.current)return;const detail=v.element||v.data||v;if(String(detail.id??'')!==item.id||!detail.resource)throw Error('主体详情无效');save([...rows.filter(r=>r.id!==item.id),{id:item.id,bindName:item.name,type:detail.resource.video?'video':'image'}]);}catch(e){if(epoch===request.current)message(e.message)}finally{if(epoch===request.current)setLoading(false)}}}}><option value="">选择库中条目</option>{library.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>}
 {notice&&<p role="status">{notice}</p>}
 </section>;
}
