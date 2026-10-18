import {readWorkrallyCatalog,writeWorkrallyCatalog} from './workrally-runtime.js';
import {isWorkrallyModel,workrallyProfile} from './workrally-capabilities.js';
export function registerWorkrallyRoutes({route,kind,dir,mcp,providerState,config,registerModels,getOtherModels=async()=>[],validateConfig}){
 const runtime=mcp.workrally;
 route('workrally/status',['GET'],async()=>Response.json({...runtime.status(),models:(await readWorkrallyCatalog(dir)).filter(s=>s.kind===kind).map(s=>({id:s.id,displayName:s.displayName,available:s.mcp.available,unsupportedCapabilities:s.workrally.unsupportedCapabilities}))},{headers:{'Cache-Control':'no-store'}}));
 route('workrally/discover',['POST'],async()=>providerState.read(async()=>{const value=await runtime.discover();await writeWorkrallyCatalog(dir,value);await registerModels();const all=await readWorkrallyCatalog(dir),models=all.filter(s=>s.kind===kind&&s.mcp.available);return Response.json({models,mcpModels:[...all,...await getOtherModels()].filter(s=>s.kind===kind)},{headers:{'Cache-Control':'no-store'}});}));
 route('workrally/selection',['POST'],async req=>providerState.transaction(async tx=>{
  const body=await req.json(),saved=await config(),specs=await readWorkrallyCatalog(dir),requested=body.enabledModels;
  if(!Array.isArray(requested)||requested.length>200||new Set(requested).size!==requested.length||requested.some(id=>!specs.some(s=>s.id===id&&s.kind===kind&&s.mcp.available)))throw Error('请选择已获取并支持的 WorkRally 模型');
  const profiles={...saved.modelProfiles};for(const id of requested){const old=profiles[id],profile=workrallyProfile(specs.find(s=>s.id===id));profiles[id]={...profile,...(['accountId','corpId','isEnterprise'].every(k=>old?.[k]===profile[k])?Object.fromEntries(['canvasProjectId','shortSeriesProjectId'].filter(k=>old?.[k]!==undefined).map(k=>[k,old[k]])):{} )};}
  const enabledModels=[...saved.enabledModels.filter(id=>!isWorkrallyModel(id)),...requested],defaultModel=body.makeDefault===true&&requested.length?requested[0]:enabledModels.includes(saved.defaultModel)?saved.defaultModel:enabledModels[0]||'';
  await tx.persist(validateConfig({...saved,modelProfiles:profiles,enabledModels,defaultModel}));return Response.json({enabledModels,defaultModel});
 }));
}
