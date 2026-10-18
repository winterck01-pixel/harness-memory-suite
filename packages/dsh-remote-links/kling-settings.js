const MODULE='@deepseek-ai/dsh-mcp-client';
const ENTRY_ID='include:kling-ai-remote';
const SERVER='Plugin-DeepSeek-kling-ai';
const phaseNames={0:'pending',1:'loading',2:'active',3:'failed',4:'disposed',5:'unloading'};

// Return only public connection state. Loader config and tool definitions stay private.
export function projectKlingConnector(ctx){
 const entry=[...(ctx.loader?.entries?.()||[])].find(row=>row.id===ENTRY_ID);
 const config=entry?.fiber?.config??entry?.options?.config;
 const matches=entry?.options?.name===MODULE&&config?.serverName===SERVER;
 const phase=!entry?'missing':!matches?'mismatch':entry.disabled?'disabled':phaseNames[entry.fiber?.state]||'pending';
 const tools=ctx.get?.('tools');
 const toolReady=!!tools?.get?.('mcp__'+SERVER+'__who_am_i');
 const runtimePhase=phase==='active'&&!toolReady?'tool-missing':phase;
 return {
  id:'kling',enabled:!!matches&&!entry.disabled,description:'可灵账号与图片/视频模型',
  type:'kling-mcp',endpointHost:'klingai.com',uploadEnabled:false,
  runtimePhase,toolReady,
  authorizationManagedBy:'可灵服务卡片与浏览器授权',sourceLabel:'Harness 实际插件与 MCP 工具注册',
  notes:['在可灵服务卡片启用并完成浏览器授权。','MCP 工具已注册仅表示插件已加载；读取账号模型会调用 who_am_i 检查权限。','本页不保存或回显凭据；工具已加载不代表业务调用或生成成功。']
 };
}
