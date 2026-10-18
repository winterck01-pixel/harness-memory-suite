// Reusing current credentials for an old task is safe only within the same provider identity.
export async function recoveryConfig(task,getConfig,defaultProfile,legacy,{useCurrentConfig=false,queryPath}={}){
 const saved=await getConfig();const profile=saved.modelProfiles?.[task.model];
 if(!profile&&!legacy.includes(task.model))throw blocked('原任务模型配置已移除，请恢复原服务配置后再查询');
 const current=profile?{...saved,...defaultProfile(task.model),...profile,baseUrl:profile.baseUrl||saved.baseUrl,keyModel:task.model}:{...saved,adapter:'gpt_image',modelName:task.model,keyModel:task.model};
 const previous=task.config;
 if(['klingMcp','workrallyMcp'].includes(previous.adapter)||['klingMcp','workrallyMcp'].includes(current.adapter)){if(previous.adapter!==current.adapter||['serverName','accountId','corpId','isEnterprise','tool','mode','modelName','baseUrl','canvasProjectId','shortSeriesProjectId'].some(k=>previous[k]!==current[k]))throw blocked('MCP 连接、账号或模型已改变；请恢复原账号配置后查询原任务');if(queryPath!==undefined)throw blocked('MCP 任务不使用 HTTP 查询路径');return previous;}
 if(new URL(previous.baseUrl).origin!==new URL(current.baseUrl).origin||(previous.adapter||(legacy.includes(task.model)?'gpt_image':undefined))!==current.adapter||(previous.modelName||task.model)!==(current.modelName||task.model))throw blocked('当前模型已切换服务或协议；请恢复原供应商配置，旧任务不会发送到其他服务');
 const next=useCurrentConfig?{...previous,...current}:previous;
 const originalQueryPath=previous.modelProfiles?.[task.model]?.queryPath;
 if(useCurrentConfig&&originalQueryPath&&previous.queryPath!==originalQueryPath&&current.queryPath===originalQueryPath)next.queryPath=previous.queryPath;
 if(queryPath!==undefined&&(typeof queryPath!=='string'||!queryPath.startsWith('/')||queryPath.startsWith('//')||queryPath.includes('://')||!queryPath.includes('{id}')))throw blocked('查询路径必须是含任务 ID 的同服务路径');
 // Adapter-specific dynamic query paths stay in the snapshot unless explicitly updated.
 return {...next,...(queryPath!==undefined?{queryPath}:{})};
}
function blocked(message){const error=Error(message);error.httpStatus=422;return error}
