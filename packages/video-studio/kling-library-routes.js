// Authenticated by each studio's route wrapper. Only read-only vendor operations.
export function registerKlingLibraryRoutes({route,mcp}){
 route('mcp/library',['GET'],async req=>{
  const q=new URL(req.url).searchParams,tool=q.get('tool'),accountId=q.get('accountId');
  if(!accountId||accountId.length>160)throw Error('请先获取当前账号模型');
  const result=await mcp.library(tool,q.get('id'),accountId,req.signal);
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 });
}
