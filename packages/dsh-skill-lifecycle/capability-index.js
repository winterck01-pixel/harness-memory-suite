import { createHash } from 'node:crypto';
import { isModelInvocable } from '@deepseek-ai/dsh-skill';


export async function searchSkillCapabilities(ctx, args, exec) {
  if (!exec?.agent || typeof exec.agent.id !== 'string') throw new Error('TRUSTED_AGENT_REQUIRED');
  const {query, offset=0}=args ?? {};
  if (typeof query !== 'string' || !query.trim() || query.length>500 || !Number.isSafeInteger(offset) || offset<0) throw new Error('INVALID_SKILL_SEARCH');
  exec.signal?.throwIfAborted();
  const lookup={cwd:await ctx.workingDirectory.ensure(exec.agent,exec.signal),scope:exec.agent,signal:exec.signal};
  const snapshot=await ctx.skills.snapshot(lookup);
  if (!snapshot.complete) return {kind:'skill',complete:false,items:[],error:'SKILL_CATALOG_INCOMPLETE',nextOffset:null};
  const normalized=query.toLocaleLowerCase().trim();
  const terms=[...new Set(normalized.split(/\s+/u))];
  const score=s=>{const name=s.name.toLocaleLowerCase(), description=s.description.toLocaleLowerCase();return (name===normalized?100:0)+terms.reduce((n,t)=>n+(name.includes(t)?10:0)+(description.includes(t)?1:0),0);};
  const matches=snapshot.skills.filter(isModelInvocable).map(s=>({summary:s,score:score(s)})).filter(s=>s.score>0).sort((a,b)=>b.score-a.score||a.summary.name.localeCompare(b.summary.name));
  const page=matches.slice(offset,offset+5),items=[];
  for(const {summary,score} of page){
    exec.signal?.throwIfAborted();
    const skill=await ctx.skills.get(summary.name,lookup);
    exec.signal?.throwIfAborted();
    if(!skill || !isModelInvocable(skill)){items.push({kind:'skill',name:summary.name,available:false,reason:'SOURCE_CHANGED_OR_UNAVAILABLE'});continue;}


    items.push({kind:'skill',name:skill.name,description:skill.description.replace(/\s+/g,' ').trim().slice(0,500),available:true,provider:skill.provider,source:skill.source,resourceBase:skill.resourceBase,...(skill.path?{path:skill.path}:{}),revision:createHash('sha256').update(skill.content).digest('hex'),loaded:false,score});
  }
  return {kind:'skill',complete:true,items,total:matches.length,offset,nextOffset:offset+page.length<matches.length?offset+page.length:null,notice:'Summaries only. Use skill to load instructions. Recheck revision when loading; file changes can invalidate pagination.'};
}
