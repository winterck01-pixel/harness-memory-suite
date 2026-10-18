// Call from existing image-studio apply(ctx) with its existing closures. Never starts another engine.
import {pathToFileURL} from 'node:url';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {nativeParameterSchema,normalizeNativeDraft} from './native-schema.js';
import {createServerAssembly} from './server-assembly.js';
function hasTrustedBrowserOrigin(req){const origin=req.headers.get('origin'),host=req.headers.get('host');if(!origin||!host)return false;try{return new URL(origin).host===new URL('http://'+host).host}catch{return false}}
export function nativeEditorModelName(spec,id){return spec.name||spec.displayName||spec.label||id;}
export async function createNativeImageStudioEditor({studioDir,rootDir,engine,submit,uiOrigin,config,references,saveResult,costs,getCredentialBinding,authorize,workerScript,workerEnv,nativeOperations={}}){
 const registry=await import(pathToFileURL(join(studioDir,'model-registry.js')).href);
 const selection=await import(pathToFileURL(join(studioDir,'model-selection.js')).href);
 const parameters=await import(pathToFileURL(join(studioDir,'image-parameters.js')).href);
 let assembly;
 const sharpPackage=dirname(dirname(createRequire(join(studioDir,'index.js')).resolve('sharp')));
 const importReferences=async(request)=>{const referenceIds=[],bindings={};for(const id of request.referenceIds||[]){const a=await assembly.assets.get(id);if(!a)throw Error('编辑器参考素材不存在');const native=await saveResult(await assembly.assets.readOriginal(id),a.format,a.name||'画布参考',{sourceKey:'editor-reference:'+a.hash});referenceIds.push(native.id);if(request.extra?.__mcpInputs?.[id])bindings[native.id]=request.extra.__mcpInputs[id];}return{...request,referenceIds,...(request.extra?.__mcpInputs?{extra:{...request.extra,__mcpInputs:bindings}}:{})};};
 const nativeEngine={
  async submit(request,execution,origin){
   return submit({...await importReferences(request),...(execution?.agent?.session?.id?{sessionId:execution.agent.session.id}:{})},execution,origin);
  },
  list:()=>engine.list(),recover:(...args)=>engine.recover(...args),retryDownload:id=>engine.retryDownload(id),dismiss:id=>engine.dismiss(id),refreshBilling:id=>engine.refreshBilling(id),
  async readResultBytes(result){const row=(await references()).find(a=>a.id===result.id);if(!row)throw Error('原生结果素材不存在');return readFile(row.path);},
 };
 const modelRuntime={...registry,...parameters,resolveSelectedModel:selection.resolveSelectedModel,normalizeDraft:request=>parameters.normalizeImageMcpDraft?parameters.normalizeImageMcpDraft(normalizeNativeDraft(request,registry.modelSpec(request.model)),registry.modelSpec(request.model)):normalizeNativeDraft(request,registry.modelSpec(request.model))};
 const getModels=async()=>{const c=await config();const selected=selection.modelSelection(c);return selected.enabledModels.map(id=>{const s=registry.modelSpec(id);return{...structuredClone(s),name:nativeEditorModelName(s,id),ratios:parameters.ratiosFor(id),quality:s.fields?.quality?.values||['auto'],n:s.fields?.n?.values||[1],supportsReference:(s.maxRefs??16)>0,parameterSchema:nativeParameterSchema(s)};});};
 assembly=createServerAssembly({rootDir,authorize,uiOrigin,nativeOperations,nativeAssets:references,readNativeAsset:async id=>{const asset=(await references()).find(a=>a.id===id);if(!asset)throw Error('原素材不存在');return {bytes:await readFile(asset.path),name:asset.name};},resourcePolicyOverrides:{codecProfile:'sharp-0.34.5'},engine:nativeEngine,modelRuntime,config,getCredentialBinding,getModels,costPreview:async request=>costs.preview(await importReferences(request)),workerScript,workerEnv:workerEnv||{...process.env,DSH_SHARP_MODULE:sharpPackage}});
 await assembly.ready;
 return{...assembly,modelRuntime,getModels,costPreview:request=>costs.preview(request),
  // Only call through existing ctx authenticated connection. The caller retains disposal with ctx.effect.
  register(ctx){
   const fetch=async req=>{const u=new URL(req.url),route=u.searchParams.get('route');if(!route||!route.startsWith('/'))return new Response('invalid route',{status:400});const destination=new URL('/api/image-studio'+route,u.origin);return assembly.handle(new Request(destination,req),hasTrustedBrowserOrigin(req)?uiOrigin:undefined);};
   // The actual host streaming bridge attaches a body even for GET. Reads must use its buffered branch.
   const disposeRead=ctx.connection.fetch.register({path:'/api/image-studio/editor-v1',methods:['GET'],requestBody:'buffered',fetch});
   let disposeWrite;try{disposeWrite=ctx.connection.fetch.register({path:'/api/image-studio/editor-v1-write',methods:['POST','PUT','DELETE'],requestBody:'streaming',fetch});}catch(error){void disposeRead();throw error;}
   return async()=>{await Promise.all([disposeRead(),disposeWrite()]);await assembly.dispose();};
  }
 };
}
