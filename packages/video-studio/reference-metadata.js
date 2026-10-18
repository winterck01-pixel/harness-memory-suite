import {stat} from 'node:fs/promises';
import {run} from 'dsh-live-film/media.js';
const cache=new Map();
export async function referenceMetadata(row,{dimensions=false}={}){
 const kind=row.type?.split('/')[0];
 const info=await stat(row.path),key=row.path+':'+info.size+':'+info.mtimeMs+':'+dimensions;
 if(cache.has(key))return {...row,...cache.get(key)};
 let metadata={size:info.size};
 if(kind==='video'||kind==='audio'){
  const media=JSON.parse(await run('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,r_frame_rate','-of','json',row.path])),duration=Number(media.format?.duration),video=media.streams?.find(s=>s.codec_type==='video'),audio=media.streams?.find(s=>s.codec_type==='audio');if(!Number.isFinite(duration)||duration<=0||(kind==='video'?!video:!audio))throw Error('参考媒体格式或时长无效');const parts=String(video?.r_frame_rate||'0/1').split('/').map(Number);metadata={...metadata,duration,...(video?{width:video.width,height:video.height,videoCodec:video.codec_name,fps:parts[0]/(parts[1]||1)}:{}),...(audio?{audioCodec:audio.codec_name}:{})};
 }else if(kind==='image'&&dimensions){
  const {default:sharp}=await import('sharp');const image=await sharp(row.path,{limitInputPixels:80000000}).metadata();metadata={...metadata,width:image.width,height:image.height};
 }
 if(cache.size>=200)cache.delete(cache.keys().next().value);cache.set(key,metadata);return {...row,...metadata};
}
