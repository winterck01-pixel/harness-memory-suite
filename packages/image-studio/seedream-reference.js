import {prepareReference} from './reference-compression.js';
export async function prepareSeedreamReference(original){
 const {default:sharp}=await import('sharp');
 const m=await sharp(original.bytes,{limitInputPixels:36_000_000}).metadata();
 if((m.pages??1)!==1)throw Error('Seedream 参考图须为静态图片');
 if(!(m.width>14&&m.height>14)||m.width/m.height<1/3||m.width/m.height>3)throw Error('Seedream 参考图边长须大于14像素，宽高比须在1:3到3:1之间');
 let input=original;
 if(!['jpeg','png'].includes(m.format)){
  const pipeline=sharp(original.bytes,{limitInputPixels:36_000_000}).rotate().timeout({seconds:20});
  const bytes=await (m.hasAlpha?pipeline.png():pipeline.jpeg({quality:95})).toBuffer();
  const type=m.hasAlpha?'image/png':'image/jpeg';
  input={...original,bytes,type,name:(original.name||'reference').replace(/\.[^.]+$/,'')+(m.hasAlpha?'.png':'.jpg')};
 }
 const prepared=await prepareReference(input);
 return {...prepared,preparation:{...prepared.preparation,originalBytes:original.bytes.length,converted:input!==original,originalWidth:m.width,originalHeight:m.height,width:prepared.preparation.width??m.width,height:prepared.preparation.height??m.height}};
}
