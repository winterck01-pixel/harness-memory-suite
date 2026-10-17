import {lstat,readdir,mkdir,open,link,unlink} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {createHash,randomUUID} from 'node:crypto'
import {basename,dirname,join,relative} from 'node:path'
const hash = s=>createHash('sha256').update(s).digest('hex')
const textExt=/\.(txt|md|markdown|csv|tsv|json|jsonc|yaml|yml|xml|html|css|js|jsx|ts|tsx|py|go|rs|java|c|cpp|h|sh|sql|toml|ini|log)$/i
function reject(message){throw Object.assign(new Error(message),{status:400})}
function pathParts(path){if(typeof path!=='string'||path.length>4096||path.includes('\\')||path.includes('\0')||path.startsWith('/'))reject('相对路径无效');const parts=path.split('/');if(parts.some(p=>!p||p==='.'||p==='..'))reject('相对路径无效');return parts}
async function digest(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex')}
async function textPage(path,offset=0){if(!Number.isSafeInteger(offset)||offset<0)reject('读取位置无效');const f=await open(path,'r');try{const info=await f.stat();if(!info.isFile())reject('不是普通文件');const b=Buffer.alloc(16384);const {bytesRead}=await f.read(b,0,b.length,offset);let n=bytesRead,text;while(n>=Math.max(0,bytesRead-3)){try{text=new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(0,n));break}catch{n--}}if(text===undefined||text.includes('\0')||(n<bytesRead&&offset+bytesRead>=info.size)||(bytesRead>0&&n===0))return {readable:false,reason:'不是可直接读取的 UTF-8 文本',size:info.size};return {readable:true,text,offset,nextOffset:offset+n<info.size?offset+n:null,size:info.size}}finally{await f.close()}}
export function createKnowledgeFiles({config,vault,resolveInside}){
 const storage=join(config.root,'.knowledge-files'), uploads=new Map()
 const allowed=async path=>{const p=await resolveInside(config.root,path);if(!p)reject('路径超出允许范围');return p}
 let sweepRunning=false;
 async function sweep(){if(sweepRunning||!config.writable)return;sweepRunning=true;try{
  const now=Date.now();for(const [id,job]of uploads){if(now-job.lastActive>3600000){await unlink(job.temp).catch(()=>{});uploads.delete(id)}}
  const folder=await allowed(storage);for(const name of await readdir(folder).catch(()=>[])){if(!/^\.[0-9a-f-]{36}\.part$/.test(name))continue;const path=await allowed(join(folder,name));if([...uploads.values()].some(j=>j.temp===path))continue;const s=await lstat(path);if(s.isFile()&&!s.isSymbolicLink()&&now-s.mtimeMs>3600000)await unlink(path)}
 }catch{                                                  }finally{sweepRunning=false}}
 const timer=setInterval(()=>void sweep(),60000);timer.unref?.();void sweep();
 const writable=()=>{if(!config.writable)throw Object.assign(new Error('当前为只读模式'),{status:403});if(!vault())reject('知识库插件未启用')}
 async function add(path,collectionId,collectionName,relativePath,actor='user'){
  const p=await allowed(path),info=await lstat(p);if(info.isSymbolicLink()||(!info.isFile()&&!info.isDirectory()))reject('不导入符号链接或特殊文件');
  let extractedText='';if(info.isFile()&&textExt.test(p)){const page=await textPage(p);extractedText=page.text||''}
  return vault().save({title:basename(p),content:`${info.isDirectory()?'文件夹':'关联文件'}：${relativePath}`,tags:[],category:'',assetId:'file:'+p,collectionId,collectionName,relativePath,directory:info.isDirectory(),extractedText},actor)
 }
 async function importPath(path,actor='user'){
  writable();const root=await allowed(path),info=await lstat(root);if(info.isSymbolicLink())reject('不导入符号链接');
  const name=basename(root),collectionId='server-'+hash(root).slice(0,24),results=[];let visited=0,stopped=false
  async function walk(p){if(stopped)return;if(++visited>10000){results.push({path:p,ok:false,error:'超过单次一万项上限，剩余内容未导入'});stopped=true;return}try{
   if(p===storage||p.startsWith(storage+'/'))reject('请勿递归导入知识库自己的上传存储目录');
   const safe=await allowed(p),s=await lstat(safe);if(s.isSymbolicLink())reject('符号链接未导入');
   const rel=info.isDirectory()?relative(root,safe):name;
   if(rel)results.push({path:rel,ok:true,...await add(safe,collectionId,name,rel,actor)});

   if(s.isDirectory()){const children=await readdir(safe);if(!rel&&children.length===0)results.push({path:name,ok:true,...await add(safe,collectionId,name,name,actor)});for(const child of children)await walk(join(safe,child))}
  }catch(e){results.push({path:relative(root,p)||name,ok:false,error:e.message})}}
  await walk(root);return {collectionId,name,results,imported:results.filter(r=>r.ok&&!r.duplicate).length,duplicates:results.filter(r=>r.duplicate).length,failed:results.filter(r=>!r.ok).length}
 }
 async function upload(body){
  writable();await sweep();const name=String(body.name||'');if(!name||name.length>240)reject('资料集名称无效');const rel=pathParts(body.relativePath).join('/');const collectionId='upload-'+hash(name).slice(0,24);
  const target=await allowed(join(storage,collectionId,rel));await mkdir(dirname(target),{recursive:true});await allowed(target)
  if(body.directory){await mkdir(target,{recursive:true});return {done:true,...await add(target,collectionId,name,rel)}}
  if(typeof body.data!=='string'||body.data.length>350000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.data))reject('上传分块无效');
  const chunk=Buffer.from(body.data,'base64'),offset=body.offset;if(chunk.length>262144||offset+chunk.length>5*1024**3)reject('上传分块或文件过大');if(!Number.isSafeInteger(offset)||offset<0||offset>5*1024**3)reject('文件超过上传大小限制或偏移无效');
  let job=body.uploadId?uploads.get(body.uploadId):null;
  if(body.uploadId&&!job)reject('上传会话失效，请重新导入');
  if(!job){if(offset!==0)reject('上传必须从头开始');if(uploads.size>=64)reject('未完成上传过多，请完成或取消已有上传');const id=randomUUID(),temp=await allowed(join(storage,'.'+id+'.part'));const f=await open(temp,'wx',0o600);await f.close();job={id,target,temp,name,rel,collectionId,offset:0,lastActive:Date.now()};uploads.set(id,job)}
  if(job.target!==target||offset!==job.offset)reject('上传位置不一致，请勿重复提交');
  job.lastActive=Date.now();const f=await open(await allowed(job.temp),'r+');try{await f.write(chunk,0,chunk.length,offset)}finally{await f.close()};job.offset+=chunk.length
  if(!body.final)return {uploadId:job.id,offset:job.offset};
  try{
  try{await link(job.temp,target)}catch(e){if(e.code!=='EEXIST')throw e;const existing=await lstat(target);if(!existing.isFile()||existing.isSymbolicLink()||await digest(target)!==await digest(job.temp))reject('同一资料集已有不同内容的同名文件；原文件未覆盖，请更改资料集名称后导入')}
  const result=await add(target,collectionId,name,rel);return {done:true,collectionId,...result}
  }finally{await unlink(job.temp).catch(()=>{});uploads.delete(job.id)}
 }
 return {importPath,upload,async cancel(id){const job=uploads.get(id);if(job){await unlink(job.temp).catch(()=>{});uploads.delete(id)}return {cancelled:true}},async read(id,offset){const entry=vault().get(id);if(entry.deletedAt)reject('条目在知识库回收站中');if(!entry.assetId.startsWith('file:'))return {readable:false,reason:'条目没有关联本地文件',entry};const path=await allowed(entry.assetId.slice(5)),s=await lstat(path);if(s.isSymbolicLink())reject('不读取符号链接');if(!s.isFile()||!textExt.test(path))return {readable:false,reason:'请使用原文件预览；未自动提取二进制内容',path,size:s.size,directory:s.isDirectory()};return {...await textPage(path,offset),path}},async close(){clearInterval(timer);for(const id of uploads.keys())await this.cancel(id)}}
}
