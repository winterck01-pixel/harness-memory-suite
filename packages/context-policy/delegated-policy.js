import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {createState,claim} from './policy.js';
const FLAGS=['blocked','memoryBlocked','knowledgeBlocked'];
export function readConstraintSnapshot(message,sessionId,turn){
 const s=message?.source;
 if(s?.kind!=='capability-constraints'||s.version!==1||s.sessionId!==sessionId||s.turn!==turn||typeof s.parentId!=='string'||!s.parentId||!FLAGS.every(k=>typeof s[k]==='boolean'))return null;
 return Object.fromEntries(FLAGS.map(k=>[k,s[k]]));
}

export function captureDelegatedConstraints(ctx,agent,state,source='startup'){


 if(source!=='startup'&&agent?.session?.header?.origin==='subagent'){
  const parentId=agent.session.header.parentSession;
  const events=agent.session.snapshotEvents();
  const saved=[...events].reverse().find(e=>e.type==='user/message'&&Number.isSafeInteger(e.data?.source?.turn)&&readConstraintSnapshot(e.data,agent.id,e.data.source.turn)&&e.data.source.parentId===parentId);
  if(saved)return {parentId,...Object.fromEntries(FLAGS.map(k=>[k,saved.data.source[k]]))};
  return {parentId:typeof parentId==='string'?parentId:'unknown-delegating-parent',blocked:true,memoryBlocked:true,knowledgeBlocked:true,recoveryUncertain:true};
 }
 const registry=ctx.get?.('agents');if(!registry?.isOwnedBy||!registry?.list)return null;
 const parent=registry.list().find(p=>p!==agent&&registry.isOwnedBy(agent.id,p));if(!parent)return null;
 const s=state(parent);return {parentId:parent.id,...Object.fromEntries(FLAGS.map(k=>[k,Boolean(s?.[k])]))};
}
export function delegatedConstraints(ctx,payload,decision,state,captured){
 if(decision.kind==='reject')return decision;
 const {agent,turn,signal}=payload,session=agent?.session;
 if(!session?.snapshotEvents||!session?.eventAt)return decision;
 const events=session.snapshotEvents();
 const boundary=[...events].reverse().find(e=>e.type==='turn/start'||e.type==='turn/end');
 if(boundary?.type!=='turn/start'||boundary.data.turn!==turn)return decision;
 const registry=ctx.get?.('agents');
 const parent=registry?.isOwnedBy&&registry?.list?registry.list().find(p=>p!==agent&&registry.isOwnedBy(agent.id,p)):null;
 if(!parent&&!captured)return decision;
 const parentId=parent?.id??captured.parentId;
 signal?.throwIfAborted();
 const s=state(agent),p=parent?state(parent):null;
 if(captured&&captured.parentId!==parentId)for(const k of FLAGS)s[k]=true;

 for(const k of FLAGS)s[k] ||= Boolean(p?.[k])||Boolean(captured?.parentId===parentId&&captured[k]);
 const isRelay=m=>m?.source?.kind==='agent-message'&&m.source.form==='relay'&&m.source.senderSessionId===parentId;
 const alreadyDelegated=events.some(e=>e.type==='user/message'&&isRelay(e.data));
 if(parent&&!alreadyDelegated){
  const initial=decision.messages.find(isRelay);
  if(initial){const constraint=createState();claim(constraint,{turn,message:{...initial,source:{kind:'user'}}});for(const k of FLAGS)s[k] ||= constraint[k];}
 }
 const source={kind:'capability-constraints',version:1,sessionId:agent.id,parentId,turn,...Object.fromEntries(FLAGS.map(k=>[k,Boolean(s[k])]))};
 const last=[...events].reverse().find(e=>e.type==='user/message'&&readConstraintSnapshot(e.data,agent.id,turn));
 if(last&&FLAGS.every(k=>last.data.source[k]===source[k])&&last.data.source.parentId===parentId)return decision;


 const message=createUserMessage({source,content:[{type:'text',text:(captured?.recoveryUncertain?'委派限制恢复证据缺失：本轮工具保持禁用，请向父代理报告并重新发起任务。 ':'')+'Delegated task restrictions (host verified): '+JSON.stringify({parentId,...Object.fromEntries(FLAGS.map(k=>[k,source[k]]))})}]});
 return {...decision,messages:[...decision.messages,message]};
}
