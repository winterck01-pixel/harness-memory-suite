import {createWriteStream} from 'node:fs';
import {statfs,rename,unlink,access} from 'node:fs/promises';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export const VIDEO_ASSET_LIMIT=512*1024*1024;
// Asset storage has its own limit; a chat channel's attachment limit is separate.
export async function storeVideoStream({dir,body,name,meta={},load,persist,signal,maxBytes=VIDEO_ASSET_LIMIT}){
 const rows=await load();const existing=meta.sourceKey&&rows.find(r=>r.sourceKey===meta.sourceKey);
 if(existing){try{await access(existing.path);await body.cancel();return existing}catch(e){if(e.code!=='ENOENT')throw e}}
 const fs=await statfs(dir);if(fs.bavail*fs.bsize<maxBytes+64*1024*1024){await body.cancel();throw Error('磁盘可用空间不足，请释放空间后重新下载，生成结果已保留')}
 const id=existing?.id||randomUUID(),path=join(dir,id+'.mp4'),temp=path+'.'+randomUUID()+'.part';let length=0,head=Buffer.alloc(0);
 try{
  await pipeline(Readable.fromWeb(body),new Transform({transform(chunk,_encoding,callback){length+=chunk.length;if(length>maxBytes){callback(Error('视频结果超过本地资产上限 '+Math.floor(maxBytes/1024/1024)+' MB'));return}if(head.length<8)head=Buffer.concat([head,chunk.subarray(0,8-head.length)]);callback(null,chunk)}}),createWriteStream(temp,{flags:'wx',mode:0o600}),{signal});
  if(head.toString('ascii',4,8)!=='ftyp')throw Error('服务返回的文件不是 MP4 视频');
  await rename(temp,path);const row={id,name,type:'video/mp4',path,bytes:length,createdAt:Date.now(),...meta};
  await persist([...rows.filter(r=>r.id!==id),row]);return row;
 }catch(e){await unlink(temp).catch(()=>{});if(!existing)await unlink(path).catch(()=>{});throw e}
}
