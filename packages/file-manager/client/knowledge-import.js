export function captureDrop(dt){
 const paths=dt.getData('application/x-dsh-file-paths');if(paths){try{return {paths:JSON.parse(paths)}}catch{throw Error('拖入数据无效')}}
 const urls=String(dt.getData('text/uri-list')||'').split(/\r?\n/).filter(x=>/^https?:\/\//i.test(x));if(urls.length)return {urls};
 const entries=[...dt.items||[]].filter(i=>i.kind==='file').map(i=>i.webkitGetAsEntry?.()).filter(Boolean)
 return entries.length?{entries}:{files:[...dt.files||[]]}
}
const entryFile=e=>new Promise((resolve,reject)=>e.file(resolve,reject))
async function* walk(entry,path=''){
 const rel=path?path+'/'+entry.name:entry.name
 if(entry.isFile){yield {relativePath:rel,file:await entryFile(entry)};return}
 if(entry.isDirectory){yield {relativePath:rel,directory:true};const reader=entry.createReader();for(;;){const children=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!children.length)break;for(const child of children){try{yield* walk(child,rel)}catch(e){yield {relativePath:rel+'/'+child.name,error:e.message}}}}}
}
async function* walkHandle(handle,path=''){
 const rel=path?path+'/'+handle.name:handle.name;
 if(handle.kind==='file'){yield {relativePath:rel,file:await handle.getFile()};return}
 yield {relativePath:rel,directory:true};for await(const child of handle.values()){try{yield* walkHandle(child,rel)}catch(e){yield {relativePath:rel+'/'+child.name,error:e.message}}}
}
function encode(buffer){let s='';for(const byte of new Uint8Array(buffer))s+=String.fromCharCode(byte);return btoa(s)}
export async function runImport(api,input,progress,signal){
 const results=[];const dirs=new Set();let count=0
 if(input.urls){for(const url of input.urls){if(signal.aborted)break;try{const r=await api('knowledge/save',{method:'POST',body:{title:url.slice(0,240),content:url,sourceUrl:url,category:'网页',tags:[],requestId:crypto.randomUUID()}});results.push({path:url,ok:true,duplicate:!!r.duplicate})}catch(e){results.push({path:url,ok:false,error:e.message})}}return results}
 if(input.paths){for(const path of input.paths){if(signal.aborted)break;progress({text:'正在导入 '+path,results});try{const r=await api('knowledge/import',{method:'POST',body:{path,requestId:crypto.randomUUID()}});results.push(...r.results)}catch(e){results.push({path,ok:false,error:e.message})}}return results}
 async function send(name,item){if(signal.aborted)return;if(++count>10000)throw Error('超过单次一万项上限，剩余内容未导入');progress({text:'正在导入 '+item.relativePath,results});let uploadId;
 try{if(item.error)throw Error(item.error);if(item.directory){await api('knowledge/upload',{method:'POST',body:{name,relativePath:item.relativePath,directory:true,requestId:crypto.randomUUID()}});results.push({path:item.relativePath,ok:true});return}
 const f=item.file;if(f.size>5*1024**3)throw Error('文件超过 5 GB 上传上限');let offset=0,last;
 do{if(signal.aborted)throw Error('导入已取消');const chunk=await f.slice(offset,offset+256*1024).arrayBuffer();last=await api('knowledge/upload',{method:'POST',body:{name,relativePath:item.relativePath,data:encode(chunk),offset,uploadId,final:offset+chunk.byteLength>=f.size,requestId:crypto.randomUUID()}});uploadId=last.uploadId;offset+=chunk.byteLength;progress({text:`正在导入 ${item.relativePath} · ${offset}/${f.size} 字节`,results})}while(offset<f.size);
 results.push({path:item.relativePath,ok:true,duplicate:!!last.duplicate})
 }catch(e){if(uploadId)await api('knowledge/cancel-upload',{method:'POST',body:{uploadId}}).catch(()=>{});results.push({path:item.relativePath,ok:false,error:e.message})}}
 if(input.handles){for(const root of input.handles){try{for await(const item of walkHandle(root)){if(signal.aborted)break;await send(root.name,item)}}catch(e){results.push({path:root.name,ok:false,error:e.message})}}}
 else if(input.entries){for(const root of input.entries){if(signal.aborted)break;try{for await(const item of walk(root)){if(signal.aborted)break;await send(root.isDirectory?root.name:'拖入文件',item)}}catch(e){results.push({path:root.name,ok:false,error:e.message})}}}
 else for(const file of input.files||[]){if(signal.aborted)break;const path=file.webkitRelativePath||file.name,name=file.webkitRelativePath?path.split('/')[0]:'拖入文件';const parts=path.split('/');for(let i=1;i<parts.length;i++){const dir=parts.slice(0,i).join('/');if(!dirs.has(dir)){dirs.add(dir);await send(name,{directory:true,relativePath:dir})}}await send(name,{file,relativePath:path})}
 return results
}
