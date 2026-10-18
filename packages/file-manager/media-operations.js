// Internal workshop seam. Reuses the same configured filesystem handlers as UI.
export function createMediaOperations({config,runtime,trash}){
 return {async trash(paths,{execution,requestId}={}){
  const sessionId=execution?.agent?.session?.id;
  if(!sessionId||execution.signal?.aborted)throw Error('需要当前可信会话');
  if(typeof requestId!=='string'||!requestId||requestId.length>128)throw Error('需要有效requestId');
  if(!Array.isArray(paths)||!paths.length||paths.length>20||paths.some(p=>typeof p!=='string'))throw Error('素材文件列表无效');
  if(!config.writable||!config.trash)throw Error('文件管理器未启用可写废纸篓');
  const body={paths,requireTrash:true},key='workshop-trash:'+sessionId+':'+requestId;
  const result=await runtime.run(()=>runtime.mutate(key,JSON.stringify(body),()=>{
   execution.signal?.throwIfAborted();return trash({body,config,runtime});
  }));
  if(result.status!==200)throw Error(result.payload?.error||'移入废纸篓失败');
  return result.payload;
 }};
}
