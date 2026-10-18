import React from 'react';
import {isSeedream5} from '../image-studio/seedream5.js';
export function SeedreamControls({model,adapter='toApisUnifiedImage',value={},n=1,onChange,disabled=false,style={}}){
 if(!isSeedream5(model)||adapter!=='toApisUnifiedImage')return null;
 const pro=model.endsWith('-pro'),metadata=value.metadata||{};
 function patchMetadata(patch){onChange({...value,metadata:{...metadata,...patch}})}
 function layers(checked){
  const next={...metadata};
  if(checked)next.sequential_image_generation='disabled';
  else delete next.sequential_image_generation;
  delete next.sequential_image_generation_options;
  onChange({...value,metadata:next,layer_decomposition:checked});
 }
 return <details style={{fontSize:12}}><summary>Seedream 参数</summary><div style={{display:'flex',gap:10,flexWrap:'wrap',paddingTop:6}}>
  <label><input type="checkbox" disabled={disabled} checked={metadata.watermark===true} onChange={e=>patchMetadata({watermark:e.target.checked})}/>添加水印</label>
  {pro&&<label><input type="checkbox" disabled={disabled||(n!==1&&value.layer_decomposition!==true)} checked={value.layer_decomposition===true} onChange={e=>layers(e.target.checked)}/>拆分为底图和透明图层（需要1张参考图）</label>}
  {n>1&&<small>生成数量以所选 {n} 张为准；参考图与输出合计最多15张。</small>}
  {pro&&value.layer_decomposition===true&&<small>每个图层单独保存，保留位置与层级信息。</small>}
 </div></details>;
}
