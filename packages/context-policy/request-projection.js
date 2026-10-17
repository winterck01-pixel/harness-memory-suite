import {joinContextSections} from '@deepseek-ai/dsh-system-prompt';

export function projectDisabledContext(options,s){
 if(!s?.memoryBlocked&&!s?.blocked)return options;
 const messages=options.messages.flatMap(m=>{
  if(s.blocked&&m.source?.kind==='tool-registry')return [];
  if(!s.memoryBlocked)return [m];
  if(m.source?.kind==='mnemo'){return [];}
  if(m.source?.kind!=='runtime-context'||!Array.isArray(m.source.sections))return [m];
  const sections=m.source.sections.filter(x=>x.name!=='mnemo');
  if(sections.length===m.source.sections.length)return [m];
  if(!sections.length){return [];}
  return [{...m,source:{...m.source,sections},content:[{type:'text',text:joinContextSections(sections)}]}];
 });
 const out={...options,messages};
 if(s.blocked){delete out.tools;delete out.toolHistory;}
 return out;
}
export function registerRequestProjection(ctx,state){
 ctx.on('llm/project-request',(options,next)=>{
  const request=next();
  if(!request.sessionId)return request;
  const agent=ctx.get('agents')?.list?.().find(a=>a.session?.id===request.sessionId);
  return agent?projectDisabledContext(request,state(agent)):request;
 },{global:true});
}
