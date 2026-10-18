const LIMIT=10_000_000,TARGET=9_500_000;
let serial=Promise.resolve();
export async function prepareReference(ref,{limit=LIMIT,target=Math.min(TARGET,limit-1)}={}){
 if(ref.bytes.length<=limit)return {...ref,preparation:{id:ref.id,compressed:false,originalBytes:ref.bytes.length,uploadBytes:ref.bytes.length,type:ref.type}};
 const run=serial.catch(()=>{}).then(async()=>{
  const {default:sharp}=await import('sharp');
  const metadata=await sharp(ref.bytes,{limitInputPixels:80_000_000}).metadata();
  if((metadata.pages||1)>1)throw Error('超限的动态图暂不自动压缩，请使用静态参考图');
  const alpha=metadata.hasAlpha===true;const dimensions=Math.max(metadata.width||0,metadata.height||0);const edges=[null,...[4096,3072,2560,2048,1536,1024,768,512,256,128].filter(x=>x<dimensions)];
  for(const edge of edges){
   for(const quality of alpha?[null]:[95,90,85,75,65]){
    let pipeline=sharp(ref.bytes,{limitInputPixels:80_000_000}).rotate().timeout({seconds:20});
    if(edge)pipeline=pipeline.resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true});
    pipeline=alpha?pipeline.png({compressionLevel:9,adaptiveFiltering:true}):pipeline.jpeg({quality,mozjpeg:true,chromaSubsampling:'4:4:4'});
    const {data,info}=await pipeline.toBuffer({resolveWithObject:true});
    if(data.length<=target){const type=alpha?'image/png':'image/jpeg',extension=alpha?'.png':'.jpg';return {...ref,bytes:data,type,name:(ref.name||'reference').replace(/\.(png|jpe?g|webp|gif)$/i,'')+extension,preparation:{id:ref.id,compressed:true,originalBytes:ref.bytes.length,uploadBytes:data.length,type,width:info.width,height:info.height,originalWidth:metadata.width,originalHeight:metadata.height,quality,alphaPreserved:alpha}};}
   }
  }
  throw Error('参考图无法压缩到10 MB以内，请换用较小的静态图片');
 });
 serial=run.then(()=>{},()=>{});return run;
}
