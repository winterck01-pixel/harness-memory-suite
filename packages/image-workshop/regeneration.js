const imageActions=new Set(['imagine','edits','blend']);
const parentActions=new Set(['upscale','variation','high-variation','low-variation','reroll','zoom','pan','remix-strong','remix-subtle','inpaint','modal']);
// Restore a recorded generation, never the selected output as a new reference.
export function regenerationSeed(asset,tasks,enabledModels,availableIds){
 let task=tasks.find(t=>t.results?.some(result=>result.id===asset?.id));
 if(!task)throw Error('这张图片没有可恢复的生成记录，无法再次生成。可使用“以此图为参考”另行创作。');
 const selectedTask=task,seen=new Set();
 while(task.model==='midjourney'&&parentActions.has(task.extra?.action)){
  if(seen.has(task.id)||!task.sourceTaskId)throw Error('Midjourney 来源任务无法恢复，不能用放大或变体参数重新生图。');
  seen.add(task.id);task=tasks.find(t=>t.id===task.sourceTaskId);
  if(!task||task.model!=='midjourney')throw Error('Midjourney 原始生图记录已不可用，无法再次生成。');
 }
 if(!task.id||typeof task.model!=='string'||typeof task.prompt!=='string'||!Array.isArray(task.referenceIds)||task.referenceIds.some(id=>typeof id!=='string'))throw Error('原生成记录信息不完整，无法可靠恢复模型、提示词和参考图。');
 if(task.model==='midjourney'&&!imageActions.has(task.extra?.action||'imagine'))throw Error('该 Midjourney 操作不是可恢复的原始生图任务。');
 if(!enabledModels.includes(task.model))throw Error('原模型 '+task.model+' 未启用；请先在图片模型设置中恢复它，再次生成。');
 if(task.referenceIds.some(id=>!availableIds.has(id)))throw Error('原任务的参考图已不可用，无法按原配置再次生成。');
 const seed={id:task.id,model:task.model,prompt:task.prompt,referenceIds:[...task.referenceIds]};
 for(const key of ['aspectRatio','size','quality','resolution','n','extra'])if(Object.hasOwn(task,key))seed[key]=structuredClone(task[key]);
 return {seed,derived:task.id!==selectedTask.id};
}
