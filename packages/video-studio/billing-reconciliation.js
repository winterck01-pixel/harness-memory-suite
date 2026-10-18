import {gate} from './resilience.js';

const TERMINAL=new Set(['completed','failed','timed_out','uncertain','awaiting_input','rejected','cancelled','canceled']);
const FINAL=new Set(['settled','refunded']);
const validAmount=value=>(typeof value==='number'||typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value))&&Number.isFinite(Number(value))&&Number(value)>=0;
const confirmed=billing=>{
 if(!FINAL.has(billing?.status))return false;
 const amounts=[billing.credits,billing.costUsd];
 if(!amounts.some(validAmount))return false;
 return billing.status!=='refunded'||amounts.filter(value=>value!==null&&value!==undefined&&value!=='').every(value=>validAmount(value)&&Number(value)===0);
};
// This worker only reads the original task endpoint. It never handles generation results.
export function createBillingReconciler({query,save,normalizeBilling,mergeBilling,signal,now=Date.now,delays=[15000,60000,300000,1800000,7200000],maxAttempts=5,maxConcurrent=2}){
 const queue=gate(maxConcurrent),pending=new Map();let stopped=false;
 const closed=()=>stopped||signal?.aborted;
 function eligible(task){try{const u=new URL(task.config?.baseUrl);return !!task.remoteId&&TERMINAL.has(task.status)&&u.protocol==='https:'&&['toapis.com','toapis.cn'].includes(u.hostname);}catch{return false;}}
 function due(task){if(closed()||!eligible(task)||confirmed(task.billing)||pending.has(task.id))return false;const check=task.billingCheck;if((check?.attempts||0)>=maxAttempts)return false;return (check?.nextAt??((task.createdAt||0)+delays[0]))<=now();}
 function result(task){return {id:task.id,billing:task.billing||{status:'unknown',credits:null,costUsd:null},billingCheck:task.billingCheck,billingCheckedAt:task.billingCheckedAt};}
 function refresh(task,{manual=false}={}){
  if(closed())return Promise.resolve(result(task));
  if(!eligible(task))return Promise.reject(Error('仅支持已有服务任务ID的 ToAPIs 终态任务账单查询'));
  if(pending.has(task.id))return pending.get(task.id);
  if(manual?(task.billingCheck?.checkedAt&&now()-task.billingCheck.checkedAt<15000)||(task.billingCheck?.retryAfterUntil>now())||(task.billingCheck?.reason==='rate_limited'&&task.billingCheck.nextAt>now()):!due(task))return Promise.resolve(result(task));
  const job=queue.run(async()=>{
   if(closed())return result(task);
   const attempts=(Number(task.billingCheck?.attempts)||0)+1,startedAt=now();
   // Persist before the GET, so restart and interruption do not reset the budget.
   const next=retryAfter=>attempts>=maxAttempts?null:now()+Math.max(delays[Math.min(attempts-1,delays.length-1)],Number(retryAfter)||0);
   task.billingCheck={status:'checking',reason:'request_in_progress',checkedAt:startedAt,nextAt:next(0),attempts};
   await save();
   if(closed())return result(task);
   try{
    const data=await query(task);
    if(closed())return result(task);
    const incoming=normalizeBilling(data);
    if(!confirmed(task.billing)||confirmed(incoming))task.billing=mergeBilling(task.billing,incoming);
    const final=confirmed(task.billing),absent=!incoming;
    task.billingCheckedAt=now();
    task.billingCheck={status:absent?'unavailable':confirmed(incoming)?'confirmed':incoming?.status==='pending'?'pending':'unavailable',reason:absent?'billing_absent':confirmed(incoming)?'billing_confirmed':incoming?.status==='pending'?'settlement_pending':'billing_unconfirmed',checkedAt:now(),nextAt:final?null:next(0),attempts};
   }catch(error){
    if(closed())return result(task);
    task.billingCheckedAt=now();
    task.billingCheck={status:'unavailable',reason:error?.httpStatus===429?'rate_limited':error?.httpStatus===401||error?.httpStatus===403?'credentials_unavailable':[404,410].includes(error?.httpStatus)?'task_unavailable':'query_failed',...(Number.isInteger(error?.httpStatus)?{httpStatus:error.httpStatus}:{}),...(Number(error?.retryAfter)>0?{retryAfterUntil:now()+Number(error.retryAfter)}:{}),checkedAt:now(),nextAt:confirmed(task.billing)?null:next(error?.retryAfter),attempts};
   }
   await save();return result(task);
  });
  pending.set(task.id,job);void job.finally(()=>pending.delete(task.id)).catch(()=>{});return job;
 }
 return {eligible,due,refresh,active:()=>pending.size,stop:async()=>{stopped=true;queue.close();await Promise.allSettled([...pending.values()]);}};
}
