window.__ModuleLoader__.load({id:'@local/cross-session-agent-router',factory:require=>{
 const {createElement:h}=require('react');
 const fields=['state','requestId','sessionId','title','duplicate','ordinary','taskSent','detail'];
 function parseReceipt(text){
  if(typeof text!=='string'||text.length>8192)return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!fields.includes(k)&&k!=='modelSelection')||fields.some(k=>!Object.hasOwn(value,k)))return null;
  if(!['created','partial','uncertain'].includes(value.state)||typeof value.sessionId!=='string'||!/^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.sessionId)||typeof value.requestId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(value.requestId)||!(value.title===null||typeof value.title==='string')||typeof value.duplicate!=='boolean'||typeof value.ordinary!=='boolean'||value.taskSent!==false||typeof value.detail!=='string')return null;
  if(value.modelSelection!==undefined&&value.modelSelection!==null){const m=value.modelSelection;if(typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(k=>!['provider','model','reasoningEffort'].includes(k))||typeof m.provider!=='string'||!m.provider||typeof m.model!=='string'||!m.model||m.reasoningEffort!==undefined&&typeof m.reasoningEffort!=='string')return null;}
  if(value.state==='created'&&!value.ordinary)return null;
  return value;
 }
 function ReceiptCard({receipt,openSession}){
  const r=parseReceipt(JSON.stringify(receipt));
  if(!r)return h('div',null,'无法识别创建回执；请检查工具详情。');
  const complete=r.state==='created';
  return h('div',{'data-session-create-receipt':r.state},
   h('strong',null,complete?(r.duplicate?'已创建的独立会话':'独立会话已创建'):'创建尚未完整确认'),
   h('div',null,r.title||r.sessionId),
   complete?h('button',{type:'button',onClick:()=>openSession(r.sessionId)},'打开会话'):h('div',{role:'status'},`${r.state}: ${r.detail}。请保留 sessionId 和原 request_id 交由管理员检查创建记录；不要换 request_id 重新创建，也不要自动派发任务。`),
   r.modelSelection?h('div',{'data-session-model-selection':'configured'},`当前会话选择：${r.modelSelection.provider} / ${r.modelSelection.model}${r.modelSelection.reasoningEffort?' · '+r.modelSelection.reasoningEffort:''}。配置已记录；未验证上游生成。`):null,
   h('small',null,complete?(r.modelSelection?'未发送任务；稍后可在会话中更改模型。':r.duplicate?'当前模型未在本回执中确认，请打开会话查看；未更改已有模型选择。':'新会话不会继承当前模型；首次发送时解析宿主默认模型，请打开后自行选择模型。空会话仅在当前选中时出现在侧栏；发送首条消息后会保留。'):`request_id: ${r.requestId}；sessionId: ${r.sessionId}`));
 }
 const inject=['slots','uiWorkspace'];
 function apply(ctx){
  function View(props){
   if(props.phase!=='result')return h('div',null,'正在创建独立会话…');
   const block=props.block;
   if(block.isError||block.call?.name!=='create_agent_session')return h('div',{role:'status'},'会话创建未完成；请检查工具详情。',props.inspect?h('button',{type:'button',onClick:props.inspect},'查看详情'):null);
   const text=block.content.length===1&&block.content[0].type==='text'?block.content[0].text:null;
   const receipt=parseReceipt(text);
   return h('div',null,h(ReceiptCard,{receipt,openSession:id=>ctx.uiWorkspace.openSession(id)}),props.inspect?h('button',{type:'button',onClick:props.inspect},'查看详情'):null);
  }
  ctx.slots.inject('tool.call.toolview',()=>ctx.slots.register({name:'tool.call.toolview',key:'create_agent_session'},View));
 }
 return {inject,apply,ReceiptCard,parseReceipt};
}});
