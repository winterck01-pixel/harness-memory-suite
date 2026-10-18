import React from 'react';
import {McpControls} from './mcp-controls.jsx';
import {modesForSpec,modeLabelFor,modeCapability,ratiosForMode} from './model-capabilities.js';
// Options and extra remain one persisted request object in both entry points.
export function VideoControls({spec,options,referenceAssets=[],update,busy,style={},section='all'}){
 if(!spec)return null;const mode=options.generationMode||spec.generationModes?.[0],extra=options.extra||{},cap=modeCapability(spec,mode);
 const changeExtra=(name,value)=>{const next={...extra};if(value==='')delete next[name];else next[name]=value;update('extra',next);};
 const metadata=extra.metadata||{},changeMetadata=(name,value)=>{const next={...metadata};if(value===undefined)delete next[name];else next[name]=value;changeExtra('metadata',Object.keys(next).length?next:'');};
 return <>
 {section!=='mode'&&<McpControls spec={spec} options={options} referenceAssets={referenceAssets} update={update} busy={busy} style={style}/>}
 {section!=='options'&&<select aria-label="视频生成模式" style={style} disabled={busy} value={mode} onChange={e=>{const mode=e.target.value,allowed=Object.entries(extra).filter(([k])=>!spec.advancedFields?.[k]?.modes||spec.advancedFields[k].modes.includes(mode));const next=modeCapability(spec,mode),ratios=ratiosForMode(spec,mode),aspectRatio=next?.ratioPolicy==='omit'?null:next?.ratioPolicy==='input'?'adaptive':ratios.includes(options.aspectRatio)?options.aspectRatio:next?.defaultRatio||spec.defaults?.aspectRatio||ratios[0];update({generationMode:mode,aspectRatio,referenceMode:['text','first','frames'].includes(mode)?'frames':'reference',extra:Object.fromEntries(allowed)});}}>{modesForSpec(spec).map(value=><option key={value} value={value}>{modeLabelFor(spec,value)}</option>)}</select>}
 {section!=='mode'&&<>
 {Object.entries(spec.advancedFields||{}).filter(([,field])=>field.label&&(!field.modes||field.modes.includes(mode))).map(([name,field])=>field.type==='boolean'?<label key={name} style={{fontSize:12,display:'inline-flex',alignItems:'center',gap:4}}><input aria-label={field.label} type="checkbox" disabled={busy} checked={extra[name]??field.default??false} onChange={e=>changeExtra(name,e.target.checked)}/>{field.label}</label>:field.type==='integer'?<label key={name} style={{fontSize:12}}>{field.label}<input aria-label={field.label} type="number" min="0" step="1" value={extra[name]??''} disabled={busy} placeholder="随机" style={{...style,width:95}} onChange={e=>changeExtra(name,e.target.value===''?'':Number(e.target.value))}/></label>:null)}
 {cap?.durationPolicy==='omitWithVideo'&&<small>参考视频由服务商决定输出时长；所选时长仅用于无视频输入。</small>}
 {spec.family==='viduq4ToApis'&&<label style={{fontSize:12}}><input aria-label="优化视频提示词" type="checkbox" disabled={busy} checked={metadata.is_rec??true} onChange={e=>changeMetadata('is_rec',e.target.checked)}/>优化提示词</label>}
 {spec.family==='wan3'&&<details><summary>文件或网页参考</summary><select aria-label="文件或网页参考类型" disabled={busy} style={style} value={metadata.media?.[0]?.type||''} onChange={e=>changeMetadata('media',e.target.value?[{type:e.target.value,url:metadata.media?.[0]?.url||''}]:undefined)}><option value="">不使用</option><option value="file">文件</option><option value="link">网页</option></select>{metadata.media?.length>0&&<input aria-label="文件或网页参考地址" type="url" placeholder="公开可访问的地址" disabled={busy} value={metadata.media[0].url||''} style={style} onChange={e=>changeMetadata('media',[{type:metadata.media[0].type,url:e.target.value}])}/>}<small>每次一个文件或网页；不能与首尾帧混用。</small></details>}
 {spec.notes?.map(note=><small key={note}>{note}</small>)}
 </>}
 </>;
}
