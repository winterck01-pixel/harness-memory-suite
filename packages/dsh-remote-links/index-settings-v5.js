import {createKlingAuth,klingAuthRoutes} from './kling-auth.js';
import {createSettings,settingsRoutes,projectBaiduConnector,CONFIG_PATH} from './settings.js?v=5';
import {projectKlingConnector} from './kling-settings.js?v=1';
import {withFileLock,writeFileAtomic} from '@deepseek-ai/dsh-atomic-write';
import {readFile} from 'node:fs/promises';
export const name = 'dsh-remote-links';
export const inject = ['connection', 'loader', 'configEditor', 'tools'];
const PHASES = {0:'pending', 1:'loading', 2:'active', 3:'failed', 4:'disposed', 5:'unloading'};
function endpointHost(value) {
  try { return new URL(value).hostname; } catch { return ''; }
}
// Only explicit public fields leave the host. Never serialize Loader config/headers.
export async function routesState(ctx) {
  let doc;try{doc=JSON.parse(await readFile(CONFIG_PATH,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;doc={connections:{}}}
  const connections = {};
  for (const [id, conn] of Object.entries(doc.connections ?? {})) {
    // WorkRally is projected from the actual Loader entry below, not this inventory.
    if (id === 'workrally' || conn.type === 'workrally-mcp') continue;
    if (conn.type?.startsWith('dsh-channel-')) continue;
    connections[id] = {
      id,
      enabled: conn.enabled === true,
      description: conn.description ?? '',
      type: conn.type ?? '',
      endpointHost: endpointHost(conn.endpoint?.sseUrl ?? conn.endpoint?.url ?? ''),
      uploadEnabled: conn.upload?.enabled === true,
      sourceLabel: id === 'baidu-netdisk' ? '百度网盘连接配置' : '连接清单',
      notes: Array.isArray(conn.notes) ? conn.notes : [],...(id==='baidu-netdisk'?projectBaiduConnector(ctx,conn):{})
    };
  }
  const entry = [...ctx.loader.entries()].find(entry => entry.id === 'include:workrally-mcp');
  const config = entry?.fiber?.config ?? entry?.options?.config;
  const matches = entry?.options.name === '@deepseek-ai/dsh-mcp-client' && config?.serverName === 'workrally';
  connections.workrally = {
    id: 'workrally',
    enabled: !!matches && !entry.disabled,
    description: 'WorkRally：DeepSeek Harness 已配置的 MCP 工作协同服务',
    type: 'workrally-mcp',
    endpointHost: matches ? endpointHost(config.url) : '',
    uploadEnabled: false,
    runtimePhase: !entry ? 'missing' : !matches ? 'mismatch' : entry.disabled ? 'disabled' : PHASES[entry.fiber?.state] ?? 'pending',
    sourceLabel: 'Harness 实际插件配置',
    notes: [
      '启用状态和接口主机来自 Harness 当前加载的 WorkRally 插件，不读取独立清单中的同名记录。',
      '需要修改连接时，展开本卡片的设置抽屉；已保存的凭据不会回显。',
      '已加载表示插件已启动，不等于本次业务调用或持续连通性测试成功。'
    ]
  };
  connections.kling = projectKlingConnector(ctx);
  return {updatedAt: doc.updatedAt ?? '', observedAt: new Date().toISOString(), connections};
}
export function apply(ctx) {
  const auth=createKlingAuth(ctx);
  for(const route of klingAuthRoutes(auth,ctx.connection))ctx.effect(()=>ctx.connection.fetch.register(route));
  const settings=createSettings(ctx,{withFileLock,writeFileAtomic});
  for(const route of settingsRoutes(settings,ctx.connection))ctx.effect(()=>ctx.connection.fetch.register(route));
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/remote-links/state', methods: ['GET'], requestBody: 'buffered',
    fetch: async (request) => {
      const rejected = ctx.connection.requestRejection({headers: Object.fromEntries(request.headers)});
      if (rejected !== undefined) return Response.json({error: 'ACCESS_DENIED'}, {status: rejected});
      const site = request.headers.get('sec-fetch-site');
      if (site && site !== 'same-origin' && site !== 'none') return Response.json({error: 'ORIGIN_REQUIRED'}, {status: 403});
      try { return Response.json(await routesState(ctx), {headers: {'cache-control': 'no-store'}}); }
      catch { return Response.json({error: 'CONFIG_UNAVAILABLE'}, {status: 503}); }
    }
  }), 'dsh-remote-links: /api/remote-links/state');
}
