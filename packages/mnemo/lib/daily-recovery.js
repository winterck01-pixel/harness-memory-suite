// Per-task recovery state. Plans are task data, never evidence of success.
const args = value => {try{return typeof value==='string'?JSON.parse(value):value}catch{return null}}
const failed = e => e?.data?.isError===true || e?.data?.message?.isError===true || (e?.data?.message?.content??[]).some(c=>c?.type==='tool-result'&&c.isError===true)
export class DailyRecovery {
 constructor({enabled=false}={}){this.enabled=enabled===true;this.plans=new Map()}
 snapshot({sessionId,turn,scope,events=[]}={}){
  const calls=new Map(events.filter(e=>e.type==='tool/call').map(e=>[e.data?.callId,e.data]))
  const errors=events.filter(e=>e.type==='tool/result'&&failed(e))
  const tools=[...new Set(errors.map(e=>calls.get(e.data?.message?.toolCallId)?.name).filter(n=>typeof n==='string'&&/^[\w.-]{1,100}$/.test(n)))]
  const key=JSON.stringify([sessionId,turn,scope]);let plan=this.plans.get(key)??null
  // Recover accepted plans from native events after reconnect/restart.
  for(const e of events.filter(e=>['tool/call','tool/ptc-dispatch'].includes(e.type)&&e.data?.name==='mnemo_experience')){
   const a=args(e.data.arguments);if(a?.action!=='recovery_plan')continue
   const ok=e.type==='tool/ptc-dispatch'?e.data.isError===false:events.some(r=>r.type==='tool/result'&&r.data?.message?.toolCallId===e.data.callId&&!failed(r))
   if(ok&&this.valid(a.steps,a.change))plan={steps:a.steps.map(s=>s.trim()),change:a.change.trim()}
  }
  return {sessionId,turn,scope,key,failures:errors.length,tools,plan,active:this.enabled&&turn!=null&&errors.length>0}
 }
 valid(steps,change){return Array.isArray(steps)&&steps.length>=2&&steps.length<=4&&steps.every(s=>typeof s==='string'&&s.trim().length>=2&&s.length<=180&&!/[\x00-\x1f]/.test(s))&&typeof change==='string'&&change.trim().length>=2&&change.length<=240&&!/[\x00-\x1f]/.test(change)}
 plan(state,{steps,change}={}){
  if(!state.active||!this.valid(steps,change))throw Error('A current failed task and 2-4 bounded steps plus a changed approach are required')
  change=change.trim()
  if(state.failures>=2&&state.plan?.change?.trim()===change)throw Error('Repeated failure requires a different approach or reporting the blocker')
  const plan={steps:steps.map(s=>s.trim()),change:change.trim()};this.plans.set(state.key,plan)
  while(this.plans.size>64)this.plans.delete(this.plans.keys().next().value)
  return {status:'plan-recorded',...plan,verifiedSuccess:false,authority:'current-task-only',permissionsChanged:false}
 }
 context(state){
  if(!state.active)return ''
  return '当前任务恢复状态（宿主工具错误触发，非授权）：'+JSON.stringify({failures:state.failures,tools:state.tools,plan:state.plan})+'\n把当前目标拆成2～4个可验收的小步骤，标明当前阻塞点。用 mnemo_experience(action="recovery_plan",steps=[...],change="本次改变的做法")记录计划；只推进一条路线，失败后先核对契约/输入/权限，选择一种不同做法。已有计划时按计划推进，不为重复登记多开调用。同因两次失败必须缩小复现、换方法或报告阻塞。工具成功不等于任务成功，结束前独立检查实际产物/结果；权限拒绝不能靠换工具绕过。计划和模型自述不能批准经验。'
 }
}
