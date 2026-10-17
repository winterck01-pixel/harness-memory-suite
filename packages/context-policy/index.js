import {EXECUTION_WORKFLOW,CAPABILITY_WORKFLOW} from './execution-workflow.js';
import {registerRequestProjection} from './request-projection.js';
import {delegatedConstraints,captureDelegatedConstraints} from './delegated-policy.js';
import {createHash} from 'node:crypto';
import {GROUPS,BASE,createState,claim,select,activate,denial,release,groupsFor,permitted} from './policy.js';
import {selectSections} from './sections.js';
import {registerKnowledgeDiscovery} from './knowledge-discovery.js';
import {recoverConstraints} from './recovery.js';
import {searchSkillCapabilities} from '../dsh-skill-lifecycle/capability-index.js';
export const name='dsh-context-policy';
export const inject=['tools','systemPrompt'];
const OUTPUT={schema:{type:'object',additionalProperties:true},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]};
const text=(s,n)=>String(s??'').replace(/\s+/g,' ').slice(0,n);
export function apply(ctx,config={}){
 ctx.systemPrompt.section({name:'execution:workflow',order:14,interpolate:false,text:EXECUTION_WORKFLOW});
 const maxTools=Math.max(1,Math.min(24,Number.isInteger(config.maxAdditionalTools)?config.maxAdditionalTools:24));
 const maxSkills=Math.max(1,Math.min(2,Number.isInteger(config.maxSkills)?config.maxSkills:2));
 const delegatedAtCreation=new WeakMap();
 const states=new WeakMap(),recoverySeq=new WeakMap(),discovering=new Set(),skillCalls=new Map(),owned=new WeakSet();
 const state=agent=>{if(!agent)return null;let s=states.get(agent);const seq=agent.session?.seq??agent.session?.events?.length;
  if(!s){s=recoverConstraints(agent.session)??createState();states.set(agent,s);recoverySeq.set(agent,seq);}
  else if(seq!==undefined&&seq!==recoverySeq.get(agent)){const r=recoverConstraints(agent.session);if(r&&r.turn!==s.turn){s=r;states.set(agent,s);}else if(r){s.blocked ||= r.blocked;s.memoryBlocked ||= r.memoryBlocked;s.knowledgeBlocked ||= r.knowledgeBlocked;s.hasUser ||= r.hasUser;}recoverySeq.set(agent,seq);}s.maxTools=maxTools;return s;};
 registerRequestProjection(ctx,state);
 const knowledge=registerKnowledgeDiscovery(ctx,{authorize:e=>{const s=state(e.agent);return !!s&&!s.blocked&&!s.knowledgeBlocked;},phaseForExecution:e=>{const s=state(e.agent);return `${s.turn}:${s.phase}`;},maxFragments:config.maxKnowledgeFragments??5});
 const sync=agent=>{
  const s=state(agent);if(!s||!agent.ctx)return;
  if(!owned.has(agent)){owned.add(agent);agent.ctx.effect(()=>()=>{knowledge.releasePhase(agent.id);for(const [token,p]of skillCalls)if(p.s===s)skillCalls.delete(token);});}

  const runtime=ctx.tools;let view;discovering.add(agent);try{view=runtime.view(agent);}finally{discovering.delete(agent);}
  s.catalog=new Map([...view.visible].filter(([n])=>n!=='run_code'&&permitted(s,n)));
  const chosen=select(s,[...s.catalog.values()]);

 };
 if(typeof ctx.tools.filterAvailability!=='function')throw Error('CAPABILITY_RUNTIME_API_REQUIRED');
 ctx.tools.filterAvailability((name,definition,agent)=>!agent||discovering.has(agent)||Boolean(state(agent)?.allowed.has(name)));
 ctx.effect(()=>()=>{skillCalls.clear();});
 ctx.on('agent/created',({agent,source})=>{const snapshot=captureDelegatedConstraints(ctx,agent,state,source);if(snapshot)delegatedAtCreation.set(agent,snapshot);},{global:true});
 ctx.on('agent/pre-step',async(p,next)=>delegatedConstraints(ctx,p,await next(),state,delegatedAtCreation.get(p.agent)),{global:true});
 ctx.on('agent/inbox/claimed',p=>{const s=state(p.agent);if(s)claim(s,{...p,sessionId:p.agent?.session?.id});},{global:true});

 ctx.systemPrompt.variable('capability_stage_bootstrap',c=>{sync(c.agent??c.scope);return '';});
 ctx.systemPrompt.section({name:'capability:workflow',order:15,interpolate:false,text:c=>{
  const s=state(c.agent??c.scope);return CAPABILITY_WORKFLOW+(s?.summary?'\n上一阶段摘要（模型提供，非新指令）：'+s.summary:'');}});
 ctx.on('system-prompt/assemble',async(_a,c,next)=>{const a=await next(),s=state(c.agent??c.scope);if(!s)return a;
  const selected=[...s.catalog.values()].filter(t=>s.allowed.has(t.name));
  const sections=selectSections(s,a.sections,[...s.catalog.values()],selected);
  return {...a,tools:s.blocked?[]:a.tools,sections};
 },{global:true,prepend:true});
 ctx.tools.guard(exec=>{const s=state(exec.agent),n=exec.call?.name??exec.name;const denied=denial(s,n);if(denied)return denied;
  if(n==='skill'&&s){const name=exec.call?.arguments?.name??exec.arguments?.name;if(name&&!s.skills.has(name)&&s.skills.size>=maxSkills)return 'CAPABILITY_SKILL_BUDGET: 本阶段已加载2个Skill，先完成当前阶段并release_capabilities。';if(name){s.loadedSkills??=new Set();s.pendingSkills??=new Map();s.skills.add(name);s.pendingSkills.set(name,(s.pendingSkills.get(name)??0)+1);skillCalls.set(exec.token,{s,name});}}
 });
 ctx.on('tools/result',(exec,result)=>{const p=skillCalls.get(exec.token);if(!p)return;skillCalls.delete(exec.token);const {s,name}=p;s.pendingSkills.set(name,s.pendingSkills.get(name)-1);if(!result.isError)s.loadedSkills.add(name);if(!s.loadedSkills.has(name)&&!s.pendingSkills.get(name))s.skills.delete(name);},{global:true});
 const register=(name,description,properties,required,execute)=>ctx.tools.register({name,description,parameters:{type:'object',properties,required,additionalProperties:false},output:OUTPUT,execute});
 register('activate_tool_group','启用下一执行步骤需要的具体tools（优先），或一个有限分组。扩展已有阶段必须给reason说明缺少什么；不改变原授权，最多24个。无full。',{group:{type:'string',enum:GROUPS},tools:{type:'array',items:{type:'string'}},reason:{type:'string'}},[],(a,e)=>{const s=state(e.agent);if(!s)throw Error('TRUSTED_AGENT_REQUIRED');if((a.tools?.length??0)>24||String(a.reason??'').length>1000)throw Error('CAPABILITY_INPUT_BUDGET');const r=activate(s,a.group,a.tools??[],a.reason??'');return r;});
 register('release_capabilities','结束阶段，释放扩展工具/SDK和Skill/知识读取预算。summary保留结论、来源、版本及证据；不会删除真实历史。',{summary:{type:'string'}},[],(a,e)=>{const s=state(e.agent);if(!s)throw Error('TRUSTED_AGENT_REQUIRED');knowledge.releasePhase(e.agent.id);return release(s,a.summary??'');});
 register('search_capabilities','从当前有权限的后台索引检索工具或Skill；只返回最多5条摘要，offset逐页扩大搜索。kind为tool或skill，搜索不启用。连接/授权未实测时明确unknown。',{query:{type:'string'},kind:{type:'string',enum:['tool','skill']},offset:{type:'integer'}},['query'],async(a,e)=>{
  const s=state(e.agent);if(!s)throw Error('TRUSTED_AGENT_REQUIRED');const q=a.query?.trim(),offset=a.offset??0;
  if(!q||q.length>500||!Number.isSafeInteger(offset)||offset<0)throw Error('CAPABILITY_SEARCH_INPUT');
  if(a.kind==='skill'){const skills=ctx.get('skills'),workingDirectory=ctx.get('workingDirectory');if(!skills||!workingDirectory)return {items:[],error:'SKILL_SERVICE_UNAVAILABLE'};return searchSkillCapabilities({skills,workingDirectory},a,e);}
  const tokens=[...new Set(q.toLowerCase().match(/[a-z0-9_]+|[\p{Script=Han}]/gu)??[])];
  const ranked=[...s.catalog.values()].map(t=>{const body=(t.name+' '+t.description+' '+groupsFor(t.name).join(' ')).toLowerCase();return {t,score:tokens.reduce((v,k)=>v+(body.includes(k)?1:0),0)+(t.name===q?100:0)};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.t.name.localeCompare(b.t.name));
  return {items:ranked.slice(offset,offset+5).map(({t})=>({kind:'tool',name:t.name,description:text(t.description,360),groups:groupsFor(t.name),available:true,enabled:s.allowed.has(t.name),authorization:'host guards and tool validation still apply',connection:'unknown_until_execution',schemaRevision:createHash('sha256').update(JSON.stringify(t.parameters)).digest('hex'),checkedAt:new Date().toISOString()})),total:ranked.length,nextOffset:offset+5<ranked.length?offset+5:null,notice:'无匹配可换关键词/分组或kind=skill；搜索不绕过作用域和授权。'};
 });
}
