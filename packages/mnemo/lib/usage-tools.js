
export function registerUsageTools(tools,{engine,resolveExecution,assertWritable,lifetime}) {
  tools.register({
    name:'mnemo_report_usage',
    description:'Record explicit current-project memory attribution. prepare returns receipts only for memories exposed in this current turn (automatic context or recall). declare records which memory you adopted and why; it is model-declared evidence, never proof of success and never reinforces memory. not_applicable suppresses that exact version in this session/project only; cannot suppress human rules. status returns bounded counts. Do not report every exposed memory as used. Do not report tool success as proof that a memory caused success. No model calls or automatic promotion.',
    parameters:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['prepare','declare','not_applicable','status']},ids:{type:'array',items:{type:'string'}},id:{type:'string'},version:{type:'integer'},receipt:{type:'string'},reason:{type:'string'}},required:['action']},
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    execute(args,exec){
      exec?.signal?.throwIfAborted();lifetime?.signal.throwIfAborted()
      const context=resolveExecution(exec)
      if(args?.action==='status')return {evidence:'task-local-telemetry',...engine.taskMemoryStatus(context)}
      if(args?.action==='prepare')return {references:engine.prepareUsageReferences({...context,ids:args.ids??[]}),evidence:'exposure-only',reinforced:false}
      if(!['declare','not_applicable'].includes(args?.action))throw Error('Unknown usage action')
      assertWritable()
      return engine.reportMemoryUsage({...context,action:args.action,id:args.id,version:args.version,receipt:args.receipt,reason:args.reason,callId:exec.callId})
    }
  })
}
