import {createHash} from 'node:crypto';

const denied=()=>Object.assign(Error('本次生成未获得真人费用确认；没有提交生成'),{code:'AUTHORIZATION_REQUIRED',status:403});
// Uses the host's trusted human answerer. A model-supplied checkbox is never a grant.
export function createWorkshopAuthority(ctx){
 return async context=>{
  const {execution,sessionId,action,input,paid}=context;
  if(!execution?.agent?.session||execution.agent.session.id!==sessionId||execution.signal?.aborted)return false;
  const destructive=action==='delete_canvas';
  if(!paid&&!destructive)return true;
  const questions=ctx.get?.('userQuestions');if(typeof questions?.ask!=='function')throw denied();
  const encoded=JSON.stringify(input),fingerprint=createHash('sha256').update(action+'\n'+encoded).digest('hex');
  const preview={action,requestId:input.requestId,projectId:input.projectId,canvasId:input.canvasId,shotIds:input.shotIds,models:input.models,sourceRevision:input.sourceRevision,revision:input.revision};
  const id='workshop-request-'+fingerprint.slice(0,20),approve=destructive?'确认删除该画布':'确认本次生成',reject='取消';
  const note=destructive?'此操作会移除画布文档，不能通过普通画布撤销恢复；原图保留不等于画布可恢复。':'本次操作可能消耗服务积分或产生费用；无法取得报价时费用为未知，不按零计算。';
  const answer=await questions.ask({agent:execution.agent,signal:execution.signal,questions:[{id,header:destructive?'删除画布':'生成费用',question:destructive?'是否确认删除这个画布？':'是否确认提交这次工坊生成？',detail:note+'确认仅适用于下列这一请求，不授权自动重提。\n\n'+JSON.stringify({...preview,input},null,2)+'\n\n请求指纹：'+fingerprint,options:[{label:reject},{label:approve}]}]});
  const item=answer?.answers?.find(row=>row.id===id);
  if(!item||item.custom||item.selected?.length!==1||item.selected[0]!==approve||execution.signal?.aborted)throw denied();
  if(JSON.stringify(input)!==encoded)throw denied();
  return true;
 };
}
