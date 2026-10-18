import {safeError} from '../resilience.js';
// Isolated candidate; no production registration. Mount behind the existing authenticated plugin router.
import {createWorkshopSurface,actionSpec,canonical} from './agent-surface.js';
import {createJsonStorage} from './core/project-repository/storage.js';
import {createProjectRepository} from './core/project-repository/repository.js';
import {createAssetRepository} from './core/asset-repository/repository.js';
import {createGenerationAdapter} from './core/generation-adapter/adapter.js';
import {createRenderWorkerClient} from './core/render-worker/client.js';
import {createResourcePolicy} from './core/resource-policy/policy.js';
import {buildRenderPlan} from './core/render-worker/composite.js';
import {createReadStream} from 'node:fs';
import {mkdir,rm,stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
function fail(code,message,status=400){return Object.assign(new Error(message),{code,status});}
export function createServerAssembly({rootDir,authorize=async()=>false,uiOrigin,modelRuntime=null,engine=null,config=async()=>({enabledModels:[]}),getModels=null,costPreview=null,nativeAssets=null,readNativeAsset=null,nativeOperations={},workerScript=fileURLToPath(new URL('./core/render-worker/sharp-worker.js',import.meta.url)),workerEnv=process.env,maxQueued=4,workerTimeoutMs=30000,resourcePolicyOverrides={}}={}){
 const runtimeDir=workerEnv.DSH_RENDER_HARD_LIMITS==='1'?workerEnv.DSH_RENDER_RUNTIME:rootDir;
 if(!runtimeDir)throw new Error('受限渲染临时区未配置');
 const storage=createJsonStorage({root:rootDir});
 const policy=createResourcePolicy(resourcePolicyOverrides);
 const assets=createAssetRepository({storage,policy});
 const projects=createProjectRepository({storage,assets});
 const worker=createRenderWorkerClient({scriptPath:workerScript||fileURLToPath(new URL('./core/render-worker/worker.js',import.meta.url)),timeoutMs:workerTimeoutMs,env:workerEnv});
 let tail=Promise.resolve(),pending=0;let generationTail=Promise.resolve();const serialGeneration=job=>{const next=generationTail.then(job,job);generationTail=next.catch(()=>{});return next;};
 const cacheReady=Promise.all(['previews','exports',...(workerEnv.DSH_RENDER_HARD_LIMITS==='1'?['native']:[])].map(name=>rm(join(runtimeDir,name),{recursive:true,force:true}).then(()=>mkdir(join(runtimeDir,name),{recursive:true}))));
 const previewCache=new Map(),previewJobs=new Map();let previewBytes=0;const previewMaxBytes=64*1024*1024;
 const streamFile=path=>new Response(Readable.toWeb(createReadStream(path)),{headers:{'Content-Type':'image/png'}});
 const sourcePath=a=>storage.file(`assets/${a.hash.slice(0,2)}/${a.hash}.${{'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[a.format]}`);
 const preview=async a=>{await cacheReady;

  policy.admitDecode(a.width,a.height);const scale=Math.min(1,1024/a.width,1024/a.height),w=Math.max(1,Math.round(a.width*scale)),h=Math.max(1,Math.round(a.height*scale));
  const key=a.hash+'-'+w+'x'+h;let cached=previewCache.get(key);if(cached){previewCache.delete(key);previewCache.set(key,cached);return streamFile(cached.path);}
  if(!previewJobs.has(key)){const job=serial(async()=>{const path=join(runtimeDir,'previews',key+'.png');policy.admitExport(w,h,[a]);await worker.submit({type:'export-composite',plan:{width:w,height:h,background:'#ffffff',backgroundAlpha:0,items:[{layerId:a.id,assetId:a.id,visible:true,opacity:1,matrix:[w/a.width,0,0,h/a.height,0,0]}]},assets:[{assetId:a.id,width:a.width,height:a.height,path:sourcePath(a)}],outputPath:path});const size=(await stat(path)).size;previewCache.set(key,{path,size});previewBytes+=size;while(previewBytes>previewMaxBytes&&previewCache.size>1){const oldest=previewCache.keys().next().value,e=previewCache.get(oldest);previewCache.delete(oldest);previewBytes-=e.size;await rm(e.path,{force:true});}return path;});previewJobs.set(key,job);job.finally(()=>previewJobs.delete(key)).catch(()=>{});}
  return streamFile(await previewJobs.get(key));
 };
 const serial=job=>{if(pending>=maxQueued+1)throw fail('RESOURCE_EXCEEDED','渲染队列已满',429);pending++;const p=tail.then(job);tail=p.catch(()=>{});return p.finally(()=>pending--);};
 const findLayer=async(layerId,canvasId)=>{
  const cs=canvasId?[{id:canvasId}]:(await Promise.all((await projects.listProjects()).map(p=>projects.listCanvases(p.id)))).flat();
  for(const c of cs){const doc=await projects.getCanvas(c.id);const layer=doc.layers.find(l=>l.id===layerId);if(layer)return{...doc,layer};}
  throw fail('LAYER_NOT_FOUND','图层不存在',404);
 };
 const referenceContext=new AsyncLocalStorage();const executionContext=new AsyncLocalStorage();
 const generation=engine&&modelRuntime?createGenerationAdapter({engine,config,assets,modelRuntime,
  batchStore:{load:()=>storage.read('generation-batches.json',[]),save:b=>storage.write('generation-batches.json',b)},
  canvasExists:async id=>{try{await projects.getCanvas(id);return true;}catch{return false;}},
  layerAsset:async(id,canvasId)=>{const frozen=referenceContext.getStore();if(frozen)return frozen.get(id)||null;const d=await findLayer(id,canvasId);return {...await assets.get(d.layer.assetId),matrix:d.layer.matrix,opacity:d.layer.opacity,visible:d.layer.visible};},
  readTaskResult:async(taskId,index)=>{const task=engine.list().find(t=>t.id===taskId),r=task?.results?.[index];if(!r)throw fail('ASSET_NOT_FOUND','结果不存在',404);return{bytes:await engine.readResultBytes(r),type:r.type,name:r.name};}
 }):null;
 const generationReady=generation?generation.recoverSubmittingBatches():Promise.resolve();
 const requireGeneration=()=>{if(!generation)throw fail('GENERATION_UNAVAILABLE','未接入原生模型运行时及生成引擎',503);return generation;};
 const render=async(body,type,frozenDoc=null)=>{
  const doc=frozenDoc||(type==='export-layer'?await findLayer(body.layerId,body.canvasId):await projects.getCanvas(body.canvasId));
  if(body.expectedRevision!==undefined&&body.expectedRevision!==doc.canvas.revision)throw fail('REVISION_CONFLICT','导出前画布已变化',409);
  const store={canvases:{[doc.canvas.id]:doc.canvas},layers:Object.fromEntries(doc.layers.map(l=>[l.id,l])),assets:Object.fromEntries(doc.assets.map(a=>[a.id,a]))};
  const plan=buildRenderPlan(store,doc.canvas.id);
  if(type==='export-layer'&&!['canvas','content'].includes(body.bounds||'content'))throw fail('VALIDATION_FAILED','导出边界无效');
  const ids=new Set(plan.items.filter(i=>type==='export-layer'?i.layerId===body.layerId:i.visible).map(i=>i.assetId));
  const used=doc.assets.filter(a=>ids.has(a.id));
  // Existing codec is PNG-only: reject unsupported inputs explicitly until a bounded decoder is supplied.
  for(const a of used){policy.admitDecode(a.width,a.height);}
  policy.admitExport(plan.width,plan.height,used);
  const outputPath=join(runtimeDir,'exports',randomUUID()+'.png');
  await cacheReady;
  try{
   await serial(()=>worker.submit({type,plan:structuredClone(plan),layerId:body.layerId,bounds:body.bounds||'content',assets:used.map(a=>({assetId:a.id,width:a.width,height:a.height,path:sourcePath(a)})),outputPath}));
   const stream=createReadStream(outputPath);const cleanup=()=>rm(outputPath,{force:true}).catch(()=>{});stream.once('close',cleanup);stream.once('error',cleanup);
   return new Response(Readable.toWeb(stream),{headers:{'Content-Type':'image/png','Content-Disposition':'attachment; filename="export.png"','X-Source-Revision':String(doc.canvas.revision)}});
  }catch(e){await rm(outputPath,{force:true});throw e;}
 };
 const prepareReferences=async(doc,referenceLayerIds=[],referenceInputMode='separate')=>{
  const referenceIds=referenceLayerIds||[];const frozenRefs=new Map();
  for(const id of referenceIds)if(!doc.layers.some(l=>l.id===id))throw fail('LAYER_NOT_FOUND','参考图层不属于目标画布',404);
  const groups=referenceInputMode==='composite'&&referenceIds.length?[referenceIds]:referenceIds.map(id=>[id]);
  for(const ids of groups){
   const snapshot=structuredClone(doc);snapshot.layers=snapshot.layers.filter(l=>ids.includes(l.id)).map(l=>({...l,visible:true}));snapshot.canvas.layerIds=snapshot.layers.map(l=>l.id);
   const response=await render({canvasId:doc.canvas.id,...(ids.length===1?{layerId:ids[0],bounds:'canvas'}:{})},ids.length===1?'export-layer':'export-composite',snapshot);
   const derived=await assets.register({bytes:Buffer.from(await response.arrayBuffer()),name:ids.length===1?'变换后图层参考':'选中图层合成参考'});
   frozenRefs.set(ids[0],derived);
  }
  return frozenRefs;
 };
 // Resolve mentions against the actual ordered references on the server, never from display names.
 const bindPrompt=(body,doc)=>{
  const ids=body.referenceLayerIds||[], mentions=body.referenceMentions||[];
  if(!Array.isArray(ids)||new Set(ids).size!==ids.length)throw fail('VALIDATION_FAILED','参考图列表无效或重复');
  if(!Array.isArray(mentions)||mentions.length>100)throw fail('VALIDATION_FAILED','参考图引用无效');
  if(mentions.length&&body.referenceInputMode==='composite')throw fail('VALIDATION_FAILED','@ 引用需要分别输入参考图');
  const bindings=new Map();
  for(const m of mentions){
   if(!m||!/^@参考\d+$/.test(m.token)||bindings.has(m.token))throw fail('VALIDATION_FAILED','参考图引用标记无效');
   const layer=doc.layers.find(l=>l.id===m.layerId),index=ids.indexOf(m.layerId);
   if(!layer||index<0)throw fail('LAYER_NOT_FOUND','@ 引用的图层已不存在或未提交',404);
   bindings.set(m.token,{layerId:m.layerId,index:index+1});
  }
  const prompt=String(body.prompt||'').replace(/@参考\d+(?!\d)/g,token=>{
   const binding=bindings.get(token);if(!binding)throw fail('VALIDATION_FAILED','未绑定的参考标记：'+token);
   return '参考图'+binding.index;
  });
  return {prompt,bindings:[...bindings].map(([token,binding])=>({token,...binding}))};
 };
 const publicMidjourneyTask=t=>({id:t.id,model:t.model,status:t.status,sourceTaskId:t.sourceTaskId,results:(t.results||[]).map(r=>({id:r.id,name:r.name,resultRole:r.resultRole,providerIndex:r.providerIndex})),midjourney:t.midjourney,extra:{action:t.extra?.action,version:t.extra?.version}});
 const midjourneyFollowups=rootId=>{
  const tasks=engine.list(),ids=new Set([rootId]);
  for(let depth=0;depth<32;depth++){let changed=false;for(const t of tasks)if(t.model==='midjourney'&&ids.has(t.sourceTaskId)&&!ids.has(t.id)){ids.add(t.id);changed=true;}if(!changed)break;}
  return tasks.filter(t=>t.id!==rootId&&ids.has(t.id)).map(publicMidjourneyTask);
 };
 const candidateIndexFile='candidate-assets.json';let candidateTail=Promise.resolve();
 const materialize=async batch=>{
  const job=candidateTail.then(async()=>{
   await generation.syncCandidates(batch.id);batch={...await generation.getBatch(batch.id),...await storage.read('batch-meta/'+batch.id+'.json',{})};const index=await storage.read(candidateIndexFile,{}),out=[];
   for(const candidate of batch.candidates||[])for(const image of candidate.images||[]){const key=candidate.taskId+':'+image.resultIndex;let row=index[key];if(!row){const task=engine.list().find(t=>t.id===candidate.taskId),r=task?.results?.[image.resultIndex];if(!r)continue;const asset=await assets.register({bytes:await engine.readResultBytes(r),name:r.name||'生成候选'});row=index[key]={asset,candidateId:candidate.candidateId,resultIndex:image.resultIndex,batchId:batch.id};}const nativeResult=engine.list().find(t=>t.id===candidate.taskId)?.results?.[image.resultIndex];out.push({...row.asset,candidateId:row.candidateId,resultIndex:row.resultIndex,nativeAssetId:nativeResult?.id,resultRole:nativeResult?.resultRole,providerIndex:nativeResult?.providerIndex,applied:!!candidate.applications?.[image.resultIndex]||!!(candidate.appliedLayerId&&(candidate.applyResultIndex??0)===image.resultIndex)});}
   await storage.write(candidateIndexFile,index);
   const tasks=(batch.taskIds||[]).map(taskId=>{const t=engine.list().find(t=>t.id===taskId)||{};return{taskId,batchId:batch.id,model:t.model||Object.keys(batch.modelStatus||{}).find(m=>batch.modelStatus[m].taskId===taskId),status:t.status||'uncertain',cancelSupported:false,error:t.error,acceptedInput:{referenceCount:batch.referenceSnapshot.length,referenceInputMode:batch.referenceInputMode||'separate'},costEstimate:t.costEstimate,billing:t.billing,remoteId:t.remoteId,costProvider:t.costProvider,providerCredits:t.providerCredits,billingCheck:t.billingCheck,...(t.model==='midjourney'?{nativeTask:{...publicMidjourneyTask(t),followups:midjourneyFollowups(t.id)}}:{}),candidates:out.filter(a=>index[taskId+':'+a.resultIndex]?.asset.id===a.id)};});
   for(const[model,status]of Object.entries(batch.modelStatus||{}))if(!status.taskId)tasks.push({model,taskId:null,batchId:batch.id,status:'failed',nativeStatus:status.status,error:status.note||status.error||'模型未提交',cancelSupported:false});return{...batch,prompt:batch.prompt??batch.effectiveParams?.prompt??'',tasks,candidates:out};
  });candidateTail=job.catch(()=>{});return job;
 };
 const routes=[];const add=(path,methods,handler)=>routes.push({path,methods,handler});
 add('projects',['GET'],async()=>({projects:await projects.listProjects()}));
 add('projects',['POST'],(b)=>projects.createProject(b));
 add('projects/:id/rename',['POST'],(b,p)=>projects.renameProject(p.id,b));
 add('projects/:id',['GET'],async(b,p)=>{const result=await projects.openProject(p.id);return{...result,...(result.canvasId?await projects.getCanvas(result.canvasId):{})};});
 add('projects/:id/canvases',['GET'],async(b,p)=>({canvases:await projects.listCanvases(p.id)}));
 add('projects/:id/canvases',['POST'],(b,p)=>projects.createCanvas(p.id,b));
 add('projects/:id/last-canvas',['POST'],(b,p)=>projects.setLastOpenCanvas(p.id,b.canvasId));
 add('canvases/:id',['GET'],(b,p)=>projects.getCanvas(p.id));
 const put=async(b,p)=>{
  // UI redo uses its stable layer payload; translating to addLayer preserves the ID and transform.
  const commands=(b.commands||[]).map(c=>c.type==='applyGeneratedResult'&&c.payload?.layer?{...c,type:'addLayer'}:c);
  return projects.submitCommands(p.id,{...b,commands});
 };
 add('canvases/:id',['PUT'],put);add('canvases/:id/commands',['PUT'],put);
 add('canvases/:id/undo',['POST'],(b,p)=>projects.undoCanvas(p.id,b));
 add('canvases/:id/redo',['POST'],(b,p)=>projects.redoCanvas(p.id,b));
 add('canvases/:id/rename',['POST'],(b,p)=>projects.renameCanvas(p.id,b));
 add('canvases/:id',['DELETE'],(b,p)=>projects.deleteCanvas(p.id,b));
 add('upload',['POST'],async b=>{if(typeof b.data!=='string')throw fail('VALIDATION_FAILED','缺少图片数据');if(b.data.length>Math.ceil(policy.limits.maxUploadBytes/3)*4)throw fail('RESOURCE_EXCEEDED','上传超过限制',413);const bytes=Buffer.from(b.data,'base64');policy.checkUploadBytes(bytes.length);return assets.register({bytes,name:b.name});});
 add('image',['GET'],async(b,p,req)=>{const a=await assets.get(new URL(req.url).searchParams.get('id'));if(!a)throw fail('ASSET_NOT_FOUND','素材不存在',404);if(new URL(req.url).searchParams.get('original')==='1')return new Response(Readable.toWeb(createReadStream(sourcePath(a))),{headers:{'Content-Type':a.format}});return preview(a);});
 add('export/layer',['POST'],b=>render(b,'export-layer'));add('export/composite',['POST'],b=>render(b,'export-composite'));
 add('editor/cost-preview',['POST'],async b=>{if(!costPreview)throw fail('GENERATION_UNAVAILABLE','原生费用服务未接入',503);const g=requireGeneration(),doc=await projects.getCanvas(b.canvasId),bound=bindPrompt(b,doc),refs=await prepareReferences(doc,b.referenceLayerIds,b.referenceInputMode),estimates=[];for(const model of b.models||[]){try{const input={...b.params?.[model],...(b.sourceTaskId?{sourceTaskId:b.sourceTaskId}:{}),...(b.maskReferenceId?{maskReferenceId:b.maskReferenceId}:{}),prompt:bound.prompt,model};const draft=await g.resolveDraft(modelRuntime.normalizeDraft?modelRuntime.normalizeDraft(input):input);const r=await costPreview({...draft,referenceIds:[...refs.values()].map(a=>a.id)});estimates.push({model,...r.estimate,account:r.account,providerModel:r.providerModel});}catch(e){estimates.push({model,status:'unknown',reason:e.message});}}return{estimates};});
 add('editor/models',['GET'],async()=>{if(!getModels)throw fail('GENERATION_UNAVAILABLE','真实模型目录未接入',503);return{models:await getModels(),mock:false};});
 add('editor/batches',['GET'],async(b,p,req)=>({batches:await Promise.all((await requireGeneration().listBatches({canvasId:new URL(req.url).searchParams.get('canvasId')||undefined})).map(materialize))}));
 add('editor/batches',['POST'],async(b,p,req)=>{
  const g=requireGeneration(),doc=await projects.getCanvas(b.canvasId);
  if(b.sourceRevision!==undefined&&doc.canvas.revision!==b.sourceRevision)throw fail('REVISION_CONFLICT','提交生成前请保存最新画布',409);
  const bound=bindPrompt(b,doc);b={...b,prompt:bound.prompt};
  if(b.sourceTaskId!==undefined||b.maskReferenceId!==undefined){if(b.models?.length!==1||b.models[0]!=='midjourney')throw fail('VALIDATION_FAILED','来源任务和蒙版仅用于单个Midjourney模型');b.params={...b.params,midjourney:{...b.params?.midjourney,...(b.sourceTaskId!==undefined?{sourceTaskId:b.sourceTaskId}:{}),...(b.maskReferenceId!==undefined?{maskReferenceId:b.maskReferenceId}:{})}};}
  const frozenRefs=await prepareReferences(doc,b.referenceLayerIds,b.referenceInputMode);
  for(const[model,param]of Object.entries(b.params||{}))if(modelRuntime.normalizeDraft)b.params[model]=modelRuntime.normalizeDraft({...param,prompt:bound.prompt,model});
  for(const param of Object.values(b.params||{}))if(param.extra?.__mcpInputs){const bindings={};for(const[id,value]of Object.entries(param.extra.__mcpInputs)){const ref=frozenRefs.get(id);bindings[ref?.id||id]=value;}param.extra.__mcpInputs=bindings;}
  const batch=await referenceContext.run(frozenRefs,()=>g.createBatch({...b,referenceLayerIds:[...frozenRefs.keys()],sourceRevision:doc.canvas.revision,targetRect:b.targetRect||{x:0,y:0,width:doc.canvas.width,height:doc.canvas.height},request:b.request||{...(b.params?.[b.models?.[0]]||{}),prompt:b.prompt,model:b.models?.[0]}}));
  await storage.write('batch-meta/'+batch.id+'.json',{referenceMentions:bound.bindings,referenceInputMode:b.referenceInputMode||'separate',referenceSourceLayers:structuredClone(doc.layers.filter(l=>(b.referenceLayerIds||[]).includes(l.id)))});
  const execution=executionContext.getStore(),origin=trustedUiRequests.has(req)&&!execution?uiOrigin:undefined;
  const result=await g.submitBatch(batch.id,{models:b.models,requestsByModel:b.params||{},execution,origin});const rejected=Object.entries(result.batch.modelStatus).filter(([m,status])=>!status.taskId).map(([model,status])=>({model,taskId:null,batchId:batch.id,status:'failed',nativeStatus:status.status,error:status.note||status.error,cancelSupported:false}));return{...result,tasks:[...result.submitted.map(t=>({...t,batchId:batch.id,status:'queued',cancelSupported:false})),...rejected]};
 });
 add('editor/batches/:id',['GET'],async(b,p)=>{const g=requireGeneration();const batch=await g.getBatch(p.id);if(!batch)throw fail('BATCH_NOT_FOUND','批次不存在',404);return materialize(batch);});
 const applies=new Map();
 add('editor/batches/:id/apply',['POST'],async(b,p)=>{
  const previous=applies.get(p.id)||Promise.resolve();const apply=previous.then(async()=>{
   const g=requireGeneration();const index=await storage.read(candidateIndexFile,{}),selection=Object.values(index).find(r=>r.batchId===p.id&&r.asset.id===b.candidateId);const candidateId=selection?.candidateId||b.candidateId;const built=await g.buildApplyCommand(p.id,candidateId,{layerName:b.layerName,resultIndex:selection?.resultIndex||0,layout:b.layout});
   const batch=await g.getBatch(p.id),doc=await projects.getCanvas(batch.canvasId);if(b.expectedRevision!==undefined&&b.expectedRevision!==doc.canvas.revision)throw fail('REVISION_CONFLICT','采用前画布已变化',409);const receipt=await projects.getGenerationReceipt(batch.canvasId,built.envelope?.payload.candidateId||built.applicationId||candidateId);if(receipt){await g.markApplied(p.id,candidateId,receipt.layerId,selection?.resultIndex||0);const layer=doc.layers.find(l=>l.id===receipt.layerId);return{...doc,layer:layer||null,alreadyApplied:true,removed:!layer,receipt};}
   if(built.alreadyApplied){const layer=doc.layers.find(l=>l.id===built.layerId);if(!layer)throw fail('LAYER_NOT_FOUND','已应用图层已删除',409);return{...doc,layer,alreadyApplied:true};}
   built.envelope.baseRevision=doc.canvas.revision;
   const result=await projects.submitCommands(batch.canvasId,{expectedRevision:doc.canvas.revision,commands:[built.envelope]});
   const event=result.events.find(e=>e.type==='layerAdded');await g.markApplied(p.id,candidateId,event.layerId,selection?.resultIndex||0);
   const fresh=await projects.getCanvas(batch.canvasId);return{...fresh,layer:fresh.layers.find(l=>l.id===event.layerId)};
  });const tracked=apply.catch(()=>{});applies.set(p.id,tracked);try{return await apply;}finally{if(applies.get(p.id)===tracked)applies.delete(p.id);}
 });
 add('editor/tasks/:id',['GET'],async(b,p)=>{requireGeneration();const task=engine.list().find(t=>t.id===p.id);if(!task)throw fail('TASK_NOT_FOUND','任务不存在',404);const batch=(await generation.listBatches()).find(b=>b.taskIds.includes(p.id));if(!batch)throw fail('BATCH_NOT_FOUND','批次不存在',404);return (await materialize(batch)).tasks.find(t=>t.taskId===p.id);});
 add('editor/import-native',['POST'],async b=>{if(!readNativeAsset)throw fail('UNAVAILABLE','原素材服务未接入',503);return assets.register(await readNativeAsset(b.id));});
 add('editor/native-assets',['GET'],async()=>({assets:(await nativeAssets?.()||[]).map(({id,name,type,createdAt})=>({id,name,type,createdAt}))}));
 const publicTask=t=>Object.fromEntries(Object.entries({id:t.id,model:t.model,prompt:t.prompt,createdAt:t.createdAt,status:t.status,stage:t.stage,generationState:t.generationState,referenceIds:t.referenceIds,sourceTaskId:t.sourceTaskId,hiddenAt:t.hiddenAt,error:t.error?safeError(t.error):undefined,errorCode:t.errorCode,billing:t.billing,costEstimate:t.costEstimate,canRetryDownload:t.stage==='download_failed',results:(t.results||[]).map(({id,name,type,resultRole,providerIndex})=>({id,name,type,resultRole,providerIndex}))}).filter(([,v])=>v!==undefined));
 add('editor/native-tasks',['GET'],async()=>({tasks:(engine?.list()||[]).map(publicTask)}));
 for(const [action,method]of [['recover','recover'],['retry-download','retryDownload'],['dismiss','dismiss'],['billing','refreshBilling']])add('editor/native-tasks/:id/'+action,['POST'],async(b,p)=>{if(!engine?.[method])throw fail('UNAVAILABLE','任务操作不可用',503);const result=await engine[method](p.id);return publicTask(engine.list().find(t=>t.id===p.id)||result)});
 add('editor/tasks/:id/cancel',['POST'],async()=>{throw fail('CANCEL_UNSUPPORTED','原生引擎未提供取消接口',422);});
 const actions={
 list_projects:actionSpec('projects',[],[],{method:'GET'}),create_project:actionSpec('projects',['name','width','height'],['name','width','height'],{method:'POST'}),
 open_project:actionSpec('projects/:id',['id'],['id'],{method:'GET'}),rename_project:actionSpec('projects/:id/rename',['id','name','expectedUpdatedAt'],['id','name','expectedUpdatedAt'],{method:'POST'}),
 list_canvases:actionSpec('projects/:id/canvases',['id'],['id'],{method:'GET'}),create_canvas:actionSpec('projects/:id/canvases',['id','name','width','height'],['id','name','width','height'],{method:'POST'}),
 get_canvas:actionSpec('canvases/:id',['id'],['id'],{method:'GET'}),commands:actionSpec('canvases/:id/commands',['id','expectedRevision','commands'],['id','expectedRevision','commands'],{method:'PUT'}),
 undo:actionSpec('canvases/:id/undo',['id','expectedRevision'],['id','expectedRevision'],{method:'POST'}),redo:actionSpec('canvases/:id/redo',['id','expectedRevision'],['id','expectedRevision'],{method:'POST'}),
 rename_canvas:actionSpec('canvases/:id/rename',['id','name','expectedRevision'],['id','name','expectedRevision'],{method:'POST'}),delete_canvas:actionSpec('canvases/:id',['id','expectedRevision'],['id','expectedRevision'],{method:'DELETE'}),
 import_image:actionSpec('upload',['data','name'],['data'],{method:'POST'}),models:actionSpec('editor/models',[],[],{method:'GET'}),
 cost_preview:actionSpec('editor/cost-preview',['canvasId','prompt','models','params','referenceLayerIds','referenceInputMode','referenceMentions','sourceTaskId','maskReferenceId'],['canvasId'],{method:'POST'}),
 generate:actionSpec('editor/batches',['requestId','canvasId','sourceRevision','prompt','models','params','referenceLayerIds','referenceInputMode','referenceMentions','targetRect','sourceTaskId','maskReferenceId'],['requestId','canvasId','sourceRevision','prompt','models'],{method:'POST',paid:true}),
 list_batches:actionSpec('editor/batches',['canvasId'],[],{method:'GET'}),get_batch:actionSpec('editor/batches/:id',['id'],['id'],{method:'GET'}),
 apply_candidate:actionSpec('editor/batches/:id/apply',['id','candidateId','layout','layerName','expectedRevision'],['id','candidateId','expectedRevision'],{method:'POST'}),
 task_status:actionSpec('editor/tasks/:id',['id'],['id'],{method:'GET'}),cancel_task:actionSpec('editor/tasks/:id/cancel',['id'],['id'],{method:'POST'}),
 export_layer:actionSpec('export/layer',['canvasId','layerId','bounds','expectedRevision'],['canvasId','layerId','expectedRevision'],{method:'POST',binary:true}),
 export_canvas:actionSpec('export/composite',['canvasId','expectedRevision'],['canvasId','expectedRevision'],{method:'POST',binary:true}),
 rename_asset:actionSpec(null,['id','name','expectedName'],['id','name','expectedName'],{native:'renameAsset'}),trash_asset:actionSpec(null,['id','requestId'],['id','requestId'],{native:'trashAsset'}),adapt_prompt:actionSpec(null,['requestId','targetModel','prompt','referenceIds','referenceBindings'],['requestId','targetModel','prompt'],{native:'adaptPrompt',paid:true}),
 import_native_asset:actionSpec('editor/import-native',['id'],['id'],{method:'POST'}),native_assets:actionSpec('editor/native-assets',[],[],{method:'GET'}),native_tasks:actionSpec('editor/native-tasks',[],[],{method:'GET'}),
 recover_task:actionSpec('editor/native-tasks/:id/recover',['id'],['id'],{method:'POST'}),retry_download:actionSpec('editor/native-tasks/:id/retry-download',['id'],['id'],{method:'POST'}),dismiss_task:actionSpec('editor/native-tasks/:id/dismiss',['id'],['id'],{method:'POST'}),task_billing:actionSpec('editor/native-tasks/:id/billing',['id'],['id'],{method:'POST'}),
 ui_clients:actionSpec(null),ui_status:actionSpec(null,['operationId'],['operationId']),ui:actionSpec(null,['clientId','command','value'],['clientId','command'])
 };
 let agentSurface;const trustedUiRequests=new WeakSet();
 const invokeRoute=async(route,b,p,req,context)=>{
  if(context&&((route.path.startsWith('canvases/')&&context.input.expectedRevision!==undefined)||route.path.startsWith('export/'))){const doc=await projects.getCanvas(p.id||b.canvasId);if(doc.canvas.revision!==b.expectedRevision)throw fail('REVISION_CONFLICT','画布已变化，请重新读取后操作',409);}
  const invoke=()=>executionContext.run(context?.execution,()=>route.handler(b,p,req));
  const result=route.path.startsWith('editor/batches')||route.path.startsWith('editor/tasks')?await serialGeneration(invoke):await invoke();
  if(!['GET','HEAD'].includes(req.method))agentSurface?.publish({kind:'invalidate',canvasId:result?.canvas?.id||b.canvasId||(route.path.startsWith('canvases/')?p.id:undefined),projectId:result?.project?.id||result?.canvas?.projectId||(route.path.startsWith('projects/')?p.id:undefined),revision:result?.newRevision??result?.canvas?.revision,operationId:context?.operationId,source:context?'agent':'ui'});
  return result;
 };
 let agentTail=Promise.resolve();
 const invokeActionNow=async(action,b,context)=>{
  const spec=actions[action];if(spec.native){if(typeof nativeOperations[spec.native]!=='function')throw fail('UNAVAILABLE','宿主原生操作未接入',503);const result=await nativeOperations[spec.native](b,context);agentSurface?.publish({kind:'invalidate',assetId:b.id,source:'agent',operationId:context.operationId});return result;}const route=routes.find(r=>r.path===spec.route&&r.methods.includes(spec.method));if(!route)throw fail('UNKNOWN_ACTION','未知操作');
  const url=new URL('http://dsh.internal/api/image-studio/'+spec.route.replace(':id',encodeURIComponent(b.id||'')));if(b.canvasId)url.searchParams.set('canvasId',b.canvasId);
  const result=await invokeRoute(route,b,{id:b.id},new Request(url,{method:spec.method}),context);
  if(spec.binary){const bytes=Buffer.from(await result.arrayBuffer());const asset=await assets.register({bytes,name:action==='export_layer'?'图层导出.png':'画布导出.png'});return {assetId:asset.id,format:asset.format,width:asset.width,height:asset.height,sourceRevision:b.expectedRevision,download:{path:'/api/image-studio/editor-v1',query:{route:'/image?id='+encodeURIComponent(asset.id)+'&original=1'}}};}
  return result;
 };
 const invokeAction=(action,input,context)=>{const run=async()=>{if(!['generate','adapt_prompt','trash_asset'].includes(action))return invokeActionNow(action,input,context);if(typeof input.requestId!=='string'||!/^[-\w]{1,100}$/.test(input.requestId))throw fail('VALIDATION_FAILED','需要有效幂等请求ID');const file='agent-generation-receipts.json',receipts=await storage.read(file,{}),key=context.sessionId+':'+(action==='generate'?'':action+':')+input.requestId,hash=canonical(input),previous=receipts[key];if(previous){if(previous.hash!==hash)throw fail('REQUEST_CONFLICT','同一请求ID参数已变化',409);if(previous.result)return previous.result;throw fail('SUBMIT_UNCERTAIN','原请求已开始处理，请查询原操作状态，禁止重复执行',409);}receipts[key]={hash,status:'processing',createdAt:Date.now()};await storage.write(file,receipts);try{const result=await invokeActionNow(action,input,context);receipts[key]={...receipts[key],status:'completed',result};await storage.write(file,receipts);return result}catch(error){receipts[key].status='uncertain';await storage.write(file,receipts);throw error}};const next=agentTail.then(run,run);agentTail=next.catch(()=>{});return next;};
 const registerAgentTools=(ctx,{authorizeAgent}={})=>{if(agentSurface)throw Error('工坊工具已注册');agentSurface=createWorkshopSurface({name:'image_workshop',description:'使用 MCP 生成前先 search_capabilities 并 activate_tool_group(image)，返回后在下一步执行。图片工坊项目、画布、图层命令、参考、生成候选、历史和导出。先读取revision；commands使用原生语义命令，所有写操作经宿主授权。',actions,authorizeAgent,invoke:invokeAction});return agentSurface.register(ctx);};
 add('editor/ui-ack',['POST'],b=>agentSurface.acknowledge(b));
 add('editor/events',['GET'],(b,p,req)=>{if(!agentSurface)throw fail('UNAVAILABLE','工坊工具尚未注册',503);return agentSurface.stream(req)});
 async function handle(req,trustedOrigin){
  try{
   await cacheReady;await generationReady;if(!await authorize(req))return json({code:'UNAUTHORIZED',error:'需要认证',status:401},401);if(uiOrigin&&trustedOrigin===uiOrigin)trustedUiRequests.add(req);
   const url=new URL(req.url);const prefix='/api/image-studio/';if(!url.pathname.startsWith(prefix))return json({error:'Not found'},404);
   const path=url.pathname.slice(prefix.length).split('/');
   for(const route of routes){if(!route.methods.includes(req.method))continue;const parts=route.path.split('/');if(parts.length!==path.length)continue;const p={};if(!parts.every((s,i)=>s.startsWith(':')?(p[s.slice(1)]=decodeURIComponent(path[i]),true):s===path[i]))continue;
    let b={};if(!['GET','DELETE'].includes(req.method)){const length=Number(req.headers.get('content-length'));if(length>Math.ceil(policy.limits.maxUploadBytes/3)*4+4096)throw fail('RESOURCE_EXCEEDED','请求体超过限制',413);const maxBody=route.path==='upload'?Math.ceil(policy.limits.maxUploadBytes/3)*4+4096:1024*1024;const reader=req.body?.getReader();let total=0;const chunks=[];if(reader){try{while(true){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBody){await reader.cancel();throw fail('RESOURCE_EXCEEDED','请求体超过限制',413);}chunks.push(value);}}finally{reader.releaseLock();}}b=JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    const result=await invokeRoute(route,b,p,req);return result instanceof Response?result:json(result);
   }return json({code:'NOT_FOUND',error:'Not found'},404);
  }catch(e){const status=e.status||({REVISION_CONFLICT:409,CANVAS_NOT_FOUND:404,PROJECT_NOT_FOUND:404,RESOURCE_EXCEEDED:413}[e.code])||400;return json({code:e.code||'VALIDATION_FAILED',error:e.message,status,...(e.currentRevision!==undefined?{currentRevision:e.currentRevision}:{})},status);}
 }
 return{ready:Promise.all([cacheReady,generationReady]),handle,routes,projects,assets,generation,worker,policy,storage,registerAgentTools,actions,get queueDepth(){return pending;},async dispose(){agentSurface?.dispose();await tail;await worker.close();await cacheReady;await Promise.all(['previews','exports',...(workerEnv.DSH_RENDER_HARD_LIMITS==='1'?['native']:[])].map(name=>rm(join(runtimeDir,name),{recursive:true,force:true})));}};
}
