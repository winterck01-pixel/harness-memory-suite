// Uses real HTTP persistence and worker exports. Native generation is supplied by the server host.
export function createHttpEditorAdapter({baseUrl='/api/image-studio',fetchImpl=globalThis.fetch,routeUrl=null}={}){
 const request=async(path,{method='GET',body,binary=false}={})=>{
  let destination=routeUrl?routeUrl(path):baseUrl+path;if(routeUrl&&!['GET','HEAD'].includes(method)){const url=new URL(destination,globalThis.location?.origin||'http://localhost');if(url.pathname==='/api/image-studio/editor-v1')url.pathname='/api/image-studio/editor-v1-write';destination=/^https?:/.test(destination)?url.href:url.pathname+url.search;}
  const response=await fetchImpl(destination,{method,credentials:'same-origin',...(body!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  if(!response.ok){const error=await response.json().catch(()=>({error:response.statusText}));throw Object.assign(new Error(error.error),error,{status:response.status});}
  if(binary)return response.blob();const result=await response.json();const visit=value=>{if(!value||typeof value!=='object')return; if(value.hash&&value.id&&value.width){value.originalUrl=routeUrl?routeUrl('/image?id='+encodeURIComponent(value.id)+'&original=1'):baseUrl+'/image?id='+encodeURIComponent(value.id)+'&original=1';value.previewUrl=routeUrl?routeUrl('/image?id='+encodeURIComponent(value.id)):baseUrl+'/image?id='+encodeURIComponent(value.id);}for(const child of Object.values(value))if(child&&typeof child==='object')visit(child);};visit(result);return result;
 };
 const path=id=>encodeURIComponent(id);
 return{
  mock:false,
 subscribeChanges(onEvent,{role='image-editor',active=()=>true,workspace=()=> 'editor'}={}){if(typeof EventSource==='undefined')return()=>{};const clientId=globalThis.crypto?.randomUUID?.()||String(Date.now());const destination=routeUrl?routeUrl('/editor/events?clientId='+encodeURIComponent(clientId)):baseUrl+'/editor/events?clientId='+encodeURIComponent(clientId);const source=new EventSource(destination,{withCredentials:true});let capability,tail=Promise.resolve(),closed=false;
  const presence=()=>capability&&!closed?request('/editor/ui-ack',{method:'POST',body:{kind:'presence',clientId,capability,role,active:active(),workspace:workspace()}}):Promise.resolve();
  source.addEventListener('agent-change',raw=>{let event;try{event=JSON.parse(raw.data)}catch{return}if(event.kind==='connected'){capability=event.capability;void presence().catch(()=>{});}const job=()=>closed?undefined:onEvent(event,clientId);tail=tail.then(job,job).catch(()=>{});});const stop=()=>{closed=true;source.close();};stop.reportPresence=()=>presence().catch(()=>{});return stop;},
  acknowledgeUi:body=>request('/editor/ui-ack',{method:'POST',body}),
  costPreview:body=>request('/editor/cost-preview',{method:'POST',body}),
  getModels:()=>request('/editor/models'),
  listProjects:async()=>{const r=await request('/projects');return{projects:r.projects.map(p=>({...p,coverUrl:routeUrl&&(p.cover||p.coverUrl)?routeUrl('/image?id='+encodeURIComponent(new URL(p.cover||p.coverUrl,'http://local').searchParams.get('id'))):(p.cover||p.coverUrl||'')}))};},
  createProject:body=>request('/projects',{method:'POST',body}),
  renameProject:(id,name)=>request(`/projects/${path(id)}/rename`,{method:'POST',body:{name}}),
  openProject:id=>request(`/projects/${path(id)}`),
  listCanvases:id=>request(`/projects/${path(id)}/canvases`),
  createCanvas:(id,body)=>request(`/projects/${path(id)}/canvases`,{method:'POST',body}),
  getCanvas:async id=>{const r=await request(`/canvases/${path(id)}`);await request(`/projects/${path(r.canvas.projectId)}/last-canvas`,{method:'POST',body:{canvasId:id}});return r;},
  putCanvas:(id,body)=>request(`/canvases/${path(id)}`,{method:'PUT',body}),
  renameCanvas:(id,name)=>request(`/canvases/${path(id)}/rename`,{method:'POST',body:{name}}),
  deleteCanvas:id=>request(`/canvases/${path(id)}`,{method:'DELETE'}),
  uploadImage:async file=>{
   if(file.size>20971520)throw Object.assign(new Error('图片超过20MB上限'),{code:'RESOURCE_EXCEEDED',status:413});
   const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   return request('/upload',{method:'POST',body:{name:file.name,type:file.type,data:btoa(binary)}});
  },
  exportLayer:body=>request('/export/layer',{method:'POST',body,binary:true}),
  exportComposite:canvasId=>request('/export/composite',{method:'POST',body:{canvasId},binary:true}),
  submitGeneration:body=>request('/editor/batches',{method:'POST',body}),
  getTask:id=>request(`/editor/tasks/${path(id)}`),
  cancelTask:id=>request(`/editor/tasks/${path(id)}/cancel`,{method:'POST',body:{}}),
  listBatches:canvasId=>request('/editor/batches'+(canvasId?'?canvasId='+path(canvasId):'')),
  getBatch:id=>request(`/editor/batches/${path(id)}`),
  applyCandidate:(batchId,candidateId,options={})=>request(`/editor/batches/${path(batchId)}/apply`,{method:'POST',body:{candidateId,...(options.layout?{layout:options.layout}:{})}}),
 };
}
