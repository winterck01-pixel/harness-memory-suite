import {referenceMaxBytes} from 'dsh-video-studio/model-capabilities.js';
import {createWorkshopAuthority} from 'dsh-image-studio/workshop-authority';
import {createWorkshopSurface,actionSpec} from 'dsh-image-studio/agent-surface';
import {readAssetNames,namedAssets} from './asset-names.js';
import {bundleClips} from './bundle.js';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdir,writeFile,readFile,access,unlink,rename} from 'node:fs/promises';
import {Store,mutate,FilmError,uid,projectOf,shotOf} from './store.js';
import {Queue} from './queue.js';
import {BoundedAsyncCache} from './bounded-cache.js';
import {serveFile,probe,run,renderMovie} from './media.js';
import {createHostMcpUiOrigin} from 'dsh-video-studio/mcp-runtime.js';
export const name='live-film';
export const inject=['connection','liveFilmVideo'];
function hasTrustedBrowserOrigin(req){const origin=req.headers.get('origin'),host=req.headers.get('host');if(!origin||!host)return false;try{return new URL(origin).host===new URL('http://'+host).host}catch{return false}}
// Cordis apply may resolve only void or a disposer; keep service handles in the factory.
export async function apply(ctx,options){await createLiveFilmHost(ctx,options);}
export async function createLiveFilmHost(ctx,{authorizeAgent=createWorkshopAuthority(ctx)}={}){
 const uiOrigin=createHostMcpUiOrigin('live-film');
 const dir=join(process.env.DSH_HOME||join(homedir(),'.dsh'),'live-film'),store=await new Store(dir).open();
 const native=ctx.liveFilmVideo;
 const assets=async()=>{
  const rows=[...new Map([...await native.assets(),...(store.read().assets||[])].map(a=>[a.id,a])).values()];
  const present=await Promise.all(rows.map(async a=>{
   if(typeof a.path!=='string'||!a.path)return false;
   try{await access(a.path);return true}catch(e){if(e.code==='ENOENT'||e.code==='ENOTDIR')return false;throw e;}
  }));
  const available=await Promise.all(rows.filter((_,i)=>present[i]).map(async a=>{if(!a.type?.startsWith('video/')||a.width&&a.height&&Number.isFinite(a.duration)&&a.duration>0)return a;try{return {...a,...await info(a)}}catch{return a}}));return namedAssets(available,await readAssetNames(join(dir,'../image-studio')));
 };
 const infoCache=new BoundedAsyncCache();const info=a=>infoCache.get(JSON.stringify([a.id,a.path]),()=>probe(a.path));
 const bridge={...native,assets,tasks:async ids=>{const ts=structuredClone(await native.tasks(ids));for(const t of ts)for(const a of t.results||[])try{a.duration=(await info(a)).duration}catch{}return ts}};
 const queue=new Queue(store,bridge);await queue.start();ctx.effect(()=>()=>queue.stop());
 let exporting=false;
 // Interrupted exports do not pretend to have completed after process restart.
 await store.tx(s=>{for(const e of s.exports||[])if(e.status==='running'){e.status='failed';e.error='导出期间服务重启，请重新导出'}});
 const safeAsset=a=>({id:a.id,name:a.name,type:a.type,createdAt:a.createdAt,duration:a.duration,width:a.width,height:a.height});
 const handlers=new Map();let agentSurface;
 const invoke=async(path,req,context)=>{const result=await handlers.get(path)(req,new URL(req.url),context);if(req.method!=='GET')agentSurface?.publish({kind:'invalidate',source:context?'agent':'ui',operationId:context?.operationId});return result;};
 const route=(path,methods,fn)=>{handlers.set(path,fn);return ctx.effect(()=>ctx.connection.fetch.register({path:'/api/live-film/'+path,methods,requestBody:'buffered',fetch:async req=>{try{
  // Harness synthesizes req.url as dsh.internal; Host preserves the browser-facing authority.
  const origin=req.headers.get('origin'),host=req.headers.get('host');if(req.method!=='GET'&&origin){let sameAuthority=false;try{sameAuthority=!!host&&new URL(origin).host===new URL('http://'+host).host}catch{}if(!sameAuthority)return Response.json({error:'跨站请求被拒绝'},{status:403})}
  return await invoke(path,req);
 }catch(e){ctx.logger?.warn?.('live-film: %s',e instanceof FilmError?e.message:'request failed');return Response.json({error:e instanceof FilmError?e.message:'操作失败，请检查任务状态或服务日志'},{status:e.status||400})}}}));};
 route('state',['GET'],async()=>{const {history,_history,agentRequests,...s}=store.read(),rows=await assets();return Response.json({...s,assets:rows.map(safeAsset),models:await native.models(),exports:(s.exports||[]).map(({path,...e})=>e)})});
 route('project',['POST'],async req=>{const body=await req.json();const caps=['batchSettings','batchRefs'].includes(body.op)?{models:await native.models(),assets:await assets()}:body.op==='sharedRefs'||body.op==='editShot'&&body.patch?.refs?{assets:await assets()}:{};return Response.json(await mutate(store,body,caps))});
 route('submit',['POST'],async(req,_url,context)=>Response.json(await queue.enqueue(await req.json(),context,context?undefined:hasTrustedBrowserOrigin(req)?uiOrigin:undefined)));
 route('task',['POST'],async req=>{const b=await req.json();if(b.op==='dismiss')return Response.json(await queue.dismiss(b.id));else if(b.op==='cancel')await queue.cancel(b.id);else if(b.op==='recover')await queue.recover(b.id,b.remoteId);else throw new FilmError('未知任务操作');return Response.json({ok:true})});
 route('import',['POST'],async req=>{const b=await req.json();if(typeof b.data!=='string'||b.data.length>Math.ceil(referenceMaxBytes(b.type)/3)*4||!['video/mp4','audio/mpeg','audio/wav','audio/mp4','audio/x-wav'].includes(b.type))throw new FilmError('支持300MB以内MP4和50MB以内MP3、WAV、M4A');const bytes=Buffer.from(b.data,'base64');if(!bytes.length||bytes.length>referenceMaxBytes(b.type))throw new FilmError('文件大小无效');const id=uid(),ext=b.type==='video/mp4'?'.mp4':b.type.includes('wav')?'.wav':b.type==='audio/mp4'?'.m4a':'.mp3',path=join(dir,id+ext);await writeFile(path,bytes,{mode:0o600});let meta;try{meta=await probe(path);if(b.type==='video/mp4'?!meta.hasVideo:!meta.hasAudio)throw Error('invalid')}catch{await unlink(path);throw new FilmError('媒体格式或时长无效')}const a={id,path,name:String(b.name||'导入素材').slice(0,120),type:b.type,duration:meta.duration,width:meta.width,height:meta.height,createdAt:Date.now()};await store.tx(s=>{s.assets??=[];s.assets.push(a)});return Response.json(safeAsset(a))});
 route('attach',['POST'],async req=>{const b=await req.json(),a=(await assets()).find(a=>a.id===b.assetId&&a.type==='video/mp4');if(!a)throw new FilmError('视频不存在');const meta=await info(a);return Response.json(await store.tx(s=>{const p=projectOf(s,b.projectId,b.revision),shot=shotOf(p,b.shotId);if(!shot.candidates.some(c=>c.assetId===a.id))shot.candidates.push({id:uid(),assetId:a.id,duration:meta.duration,width:meta.width,height:meta.height,createdAt:Date.now(),snapshot:{source:'import'}});if(b.adopt){const c=shot.candidates.find(c=>c.assetId===a.id);shot.selected=c.id;shot.trimIn=0;shot.duration=meta.duration}p.revision++;return p},{history:true}))});
 route('audio',['POST'],async req=>{const b=await req.json();if(b.assetId&&!(await assets()).some(a=>a.id===b.assetId&&a.type.startsWith('audio/')))throw new FilmError('音频不存在');if(!Number.isFinite(b.volume)||b.volume<0||b.volume>1)throw new FilmError('音量无效');return Response.json(await store.tx(s=>{const p=projectOf(s,b.projectId,b.revision);p.audio={assetId:b.assetId||null,volume:b.volume};p.revision++;return p},{history:true}))});
 route('asset',['GET'],async(req,url)=>{const a=(await assets()).find(a=>a.id===url.searchParams.get('id'));if(!a)return new Response('Not found',{status:404});return serveFile(req,a.path,a.type)});
 const thumbs=new BoundedAsyncCache({maxEntries:128,maxPending:64});route('thumbnail',['GET'],async(req,url)=>{const a=(await assets()).find(a=>a.id===url.searchParams.get('id'));if(!a)return new Response('Not found',{status:404});const path=join(dir,'thumb-'+a.id+'.jpg');await thumbs.get(JSON.stringify([a.id,a.path]),async signal=>{try{await access(path)}catch{if(!a.type.startsWith('image/')&&a.type!=='video/mp4')throw new FilmError('无缩略图');const temporary=path+'.'+uid()+'.jpg';try{await run('ffmpeg',['-y','-v','error','-i',a.path,'-frames:v','1','-vf','scale=320:180:force_original_aspect_ratio=decrease','-q:v','4',temporary],{signal});if(signal.aborted)throw signal.reason;await rename(temporary,path)}finally{await unlink(temporary).catch(()=>{})}}},{signal:req.signal});return serveFile(req,path,'image/jpeg')});
 route('export',['POST','GET'],async(req,url)=>{if(req.method==='GET'){const e=(store.read().exports||[]).find(e=>e.id===url.searchParams.get('id')&&e.status==='completed');if(!e)return new Response('Not found',{status:404});return serveFile(req,e.path,e.format==='zip'?'application/zip':'video/mp4')}
 const b=await req.json();if(exporting)throw new FilmError('已有导出任务，请稍后');exporting=true;try{const p=projectOf(store.read(),b.projectId,b.revision);if(!p.shots.length||p.shots.some(s=>!s.selected))throw new FilmError('每个片段均需先采用视频');const rows=await assets(),id=uid(),format=b.format==='zip'?'zip':'mp4';await store.tx(s=>{s.exports??=[];s.exports.push({id,projectId:p.id,status:'running',format,createdAt:Date.now(),revision:p.revision})});void (format==='zip'?bundleClips:renderMovie)(structuredClone(p),rows,join(dir,'export-'+id)).then(path=>store.tx(s=>Object.assign(s.exports.find(e=>e.id===id),{status:'completed',path}))).catch(()=>store.tx(s=>Object.assign(s.exports.find(e=>e.id===id),{status:'failed',error:'导出失败，请检查文件、使用时长与媒体工具'}))).finally(()=>{exporting=false});return Response.json({id})}catch(e){exporting=false;throw e}});
 const actions={state:actionSpec('state',[],[],{method:'GET'}),
 project:actionSpec('project',['op','projectId','revision','shotId','name','projectName','model','duration','generationDuration','patch','shotIds','refs','ids','candidateId','trimIn','fullLength'],['op'],{method:'POST'}),
 generate:actionSpec('submit',['requestId','projectId','revision','shotIds','draftCandidateId'],['requestId','projectId','revision','shotIds'],{method:'POST',paid:true}),
 task:actionSpec('task',['op','id','remoteId'],['op','id'],{method:'POST'}),
 import_media:actionSpec('import',['name','type','data'],['type','data'],{method:'POST'}),
 attach:actionSpec('attach',['projectId','revision','shotId','assetId','adopt'],['projectId','revision','shotId','assetId'],{method:'POST'}),
 audio:actionSpec('audio',['projectId','revision','assetId','volume'],['projectId','revision','volume'],{method:'POST'}),
 export:actionSpec('export',['projectId','revision','format'],['projectId','revision'],{method:'POST'}),
 ui_clients:actionSpec(null),ui_status:actionSpec(null,['operationId'],['operationId']),ui:actionSpec(null,['clientId','command','value'],['clientId','command'])};
 agentSurface=createWorkshopSurface({name:'live_film',description:'使用 MCP 生成前先 search_capabilities 并 activate_tool_group(video)，返回后在下一步执行。镜头工坊项目、镜头、参考、批量编辑、候选采用、裁剪、音轨、历史、任务、导出。project.op支持createProject/createProjectWithShot/renameProject/addShot/editShot/duplicateShot/deleteShot/restoreShot/reorder/adopt/batchSettings/batchRefs/sharedRefs/undo/redo。',actions,authorizeAgent,invoke:async(action,input,context)=>{
  if(action==='project'&&!['createProject','createProjectWithShot'].includes(input.op)&&!Number.isSafeInteger(input.revision))throw new FilmError('需要项目revision');
  if(['attach','audio','export','generate'].includes(action)&&!Number.isSafeInteger(input.revision))throw new FilmError('需要项目revision');
  const spec=actions[action],body=action==='generate'?{...input,confirmCost:true}:input;
  const result=await invoke(spec.route,new Request('http://dsh.internal/api/live-film/'+spec.route,{method:spec.method,...(spec.method!=='GET'?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),context);
  if(!result.ok)throw new FilmError('操作失败',result.status);const value=await result.json();return action==='export'?{...value,status:'running',download:{path:'/api/live-film/export',query:{id:value.id}}}:value;
 }});
 const disposeTools=agentSurface.register(ctx);ctx.effect(()=>()=>{disposeTools();agentSurface.dispose()});
 route('ui-ack',['POST'],async req=>Response.json(agentSurface.acknowledge(await req.json())));
 route('events',['GET'],req=>agentSurface.stream(req));
 return {store,queue,actions,agentSurface,invoke};

}
