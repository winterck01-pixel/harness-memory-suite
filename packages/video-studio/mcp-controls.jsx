import {KlingReferenceControls} from './kling-reference-controls.jsx';
import React,{useEffect,useState} from 'react';
const core=new Set(['prompt','duration','aspect_ratio','aspectRatio','resolution','video_resolution','img_resolution','image_resolution','imageCount','image_count','n']);
export function McpControls({spec,options,referenceAssets=[],update,busy,style={}}){
 const [extra,setExtra]=useState(options?.extra||{});
 useEffect(()=>{setExtra(options?.extra||{})},[options?.extra,spec?.id]);
 if(!spec?.mcp)return null;const declaration=spec.mcp.declaration;
 const selectedIds=options.referenceIds||options.refs?.map(r=>r.id)||[];
 const assetById=new Map([...options.refs||[],...referenceAssets].map(a=>[a.id,a]));
 const sourceVideos=selectedIds.map(id=>assetById.get(id)).filter(a=>a?.type?.startsWith('video/'));
 const sourceVideoId=sourceVideos.some(a=>a.id===extra.sourceVideoId)?extra.sourceVideoId:'';
 const set=(name,value)=>{const next={...extra};if(value==='')delete next[name];else next[name]=value;setExtra(next);update('extra',next)};
 if(spec.workrally)return <details style={{width:'100%'}}><summary>WorkRally 参数与项目关联</summary>
 {spec.advancedFields?.enable_sound&&<label style={{display:'block',marginTop:8}}>生成声音<select aria-label="WorkRally 生成声音" disabled={busy} style={style} value={String(extra.enable_sound??true)} onChange={e=>set('enable_sound',e.target.value==='true')}><option value="true">开启</option><option value="false">关闭</option></select></label>}
 {spec.workrally.mode==='SmartEdit'&&<label style={{display:'block',marginTop:8}}>编辑源视频<select aria-label="WorkRally 编辑源视频" disabled={busy} style={style} value={sourceVideoId} onChange={e=>set('sourceVideoId',e.target.value)}><option value="">自动选择唯一视频；多视频须指定</option>{sourceVideos.map(a=><option key={a.id} value={a.id}>{a.name||a.id}</option>)}</select><small>源视频单独绑定，其他已选素材作为编辑参考；生成时长跟随源视频。</small></label>}
 <label style={{display:'block',marginTop:8}}>短番项目ID（音视频参考必填）<input aria-label="WorkRally 短番项目ID" disabled={busy} style={style} value={extra.shortSeriesProjectId||''} onChange={e=>set('shortSeriesProjectId',e.target.value.trim())}/></label>
 <label style={{display:'block',marginTop:8}}>画布ID（可选）<input aria-label="WorkRally 画布ID" disabled={busy} style={style} value={extra.canvasProjectId||''} onChange={e=>set('canvasProjectId',e.target.value.trim())}/></label>
 <small>不指定画布时，生成结果仍会保存到工坊资源库。WorkRally 费用未知，每次生成1项。</small>
 {(spec.workrally.unsupportedCapabilities||[]).map(row=><p key={row.capability} style={{fontSize:12}}>{row.capability}：{row.reason}</p>)}
 </details>;
 const ids=options.referenceIds||options.refs?.map(r=>r.id)||[];
 return <details style={{width:'100%'}}><summary>可灵模型参数与参考槽位</summary>
 {declaration.arguments.filter(a=>!core.has(a.name)&&a.name!=='elements').map(a=><label key={a.name} style={{display:'block',marginTop:8}}>{a.name}{a.description&&<small style={{display:'block'}}>{a.description}</small>}{a.required?'（必填）':''}{Array.isArray(a.allowedValues)?<select aria-label={'可灵参数 '+a.name} disabled={busy} style={style} value={extra[a.name]??(a.default===undefined?'':String(a.default))} onChange={e=>set(a.name,e.target.value)}><option value="">{a.default===undefined?'请选择':'默认：'+a.default}</option>{a.allowedValues.map(v=><option key={String(v)} value={String(v)}>{String(v)}</option>)}</select>:<input aria-label={'可灵参数 '+a.name} disabled={busy} style={style} value={extra[a.name]??(a.default===undefined?'':String(a.default))} placeholder={a.default===undefined?'按模型声明填写':String(a.default)} onChange={e=>set(a.name,e.target.value)}/>}</label>)}
 <KlingReferenceControls spec={spec} extra={extra} set={set} busy={busy} style={style}/>
 {ids.map((id,index)=><label key={id} style={{display:'block',marginTop:8}}>参考素材 {index+1}<select aria-label={'参考素材槽位 '+(index+1)} style={style} disabled={busy} value={extra.__mcpInputs?.[id]||''} onChange={e=>{const bindings={...extra.__mcpInputs};if(e.target.value)bindings[id]=e.target.value;else delete bindings[id];set('__mcpInputs',Object.keys(bindings).length?bindings:'')}}><option value="">按当前生成方式自动绑定</option>{declaration.inputs.map(input=><option key={input.name} value={input.name}>{input.name}{input.required?'（必填）':''}</option>)}</select></label>)}
 {Object.keys(extra.__mcpInputs||{}).length>0&&<button type="button" disabled={busy} onClick={()=>set('__mcpInputs','')}>清除槽位绑定</button>}
 </details>;
}
