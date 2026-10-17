import z from '@deepseek-ai/schemastery';
import {createHash} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {defineDomain, domainTable} from '@deepseek-ai/dsh-storage-domain';
import {z as schema} from 'zod';
import {receiptOf, keyedQueue} from './receipt.js';
import {installModelSwitch} from './switch-model.js';
import {installSessionCreation} from './create-session.js';

const ROUTER_ID = 'cross-session-agent-router';
export const inject = ['agents', 'tools', 'sessions', 'sessionController', 'sessionQuery', 'storageDomain','workspaceRegistry','permissionPresets','sandboxPolicy','approval','sessionTitle','llm','sessionProjections'];
export const Config = z.object({enabled:z.boolean().default(true), maxMessageChars:z.number().default(4000), allowCrossRoot:z.boolean().default(true)});

const spec = defineDomain({name:'cross_session_router',version:1,layout:'per-record',tables:{requests:domainTable(schema.object({caller:schema.string(),target:schema.string(),requestId:schema.string(),message:schema.string(),state:schema.enum(['pending','accepted','uncertain']),createdAt:schema.string()}))}});
const output = {schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]};
function fail(message) {throw new Error(`cross-session router: ${message}`);}
function callerOf(ctx, exec) {
  const caller = exec.agent;
  if (!caller || ctx.agents.get(caller.id) !== caller || caller.status !== 'running') fail('requires the exact active calling agent');
  if (typeof ctx.agents.currentInitiator === 'function' && ctx.agents.currentInitiator() !== caller) fail('caller is not the current initiator');
  exec.signal?.throwIfAborted();
  return caller;
}
function key(caller, id) {return createHash('sha256').update(JSON.stringify([caller,id])).digest('hex');}
function integer(value, fallback, min, max, name) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${name} must be an integer between ${min} and ${max}`);
  return value;
}
const order = (a,b) => b.header.createdAt-a.header.createdAt || b.header.id.localeCompare(a.header.id);

export async function apply(ctx, config) {
  if (!config.enabled) return;
  const max = Number.isSafeInteger(config.maxMessageChars) && config.maxMessageChars > 0 ? config.maxMessageChars : 4000;
  const domain = await ctx.storageDomain.open(spec), requests = domain.table('requests');
  ctx.effect(() => () => domain.close());
  const serial = keyedQueue();
  const inspect = async row => receiptOf((await ctx.sessionQuery.readSession(row.target)).events, row);
  try {await installSessionCreation(ctx,callerOf);}
  catch {

    ctx.tools.register(defineTool({name:'create_agent_session',description:'普通独立会话创建暂不可用：创建能力初始化失败。请让管理员检查创建插件与 cross_session_creation 存储后重载插件；不可改用子代理替代。',parameters:{title:{type:'string',required:true},request_id:{type:'string',required:true}},output,
      execute(){fail('creation capability initialization failed; no creation attempted; ask the administrator to inspect the creation plugin and cross_session_creation storage and reload the plugin');}}));
  }

  try {await installModelSwitch(ctx,callerOf);}
  catch {ctx.tools.register(defineTool({name:'switch_agent_model',description:'当前会话模型切换暂不可用，管理员需检查 session_model_switch 存储；不得绕过此错误直接改配置。',parameters:{provider:{type:'string',required:true},model:{type:'string',required:true},request_id:{type:'string',required:true}},output,execute(){fail('model switch initialization unavailable');}}));}

  ctx.tools.register(defineTool({
    name:'list_live_agents', description:'List existing top-level sessions including idle and persisted sessions. Exact IDs and titles, stable newest-created-first pagination. Follow nextCursor while hasMore; query filters title or ID. Does not wake sessions.',
    parameters:{limit:{type:'number',description:'Page size, 1-100; default 30.'},cursor:{type:'string',description:'nextCursor from the previous page, keeping the same query.'},query:{type:'string',description:'Optional case-insensitive title or ID substring.'}}, output,
    async execute(args, exec) {
      callerOf(ctx,exec);
      const limit = integer(args.limit,30,1,100,'limit'), query = (args.query || '').trim().toLowerCase();
      if (query.length > 240) fail('query exceeds 240 characters');
      let cursor;
      if (args.cursor) {
        try {cursor = JSON.parse(Buffer.from(args.cursor,'base64url').toString());} catch {fail('invalid cursor');}
        if (args.cursor.length > 1000 || cursor?.query !== query || !Number.isFinite(cursor?.createdAt) || typeof cursor?.id !== 'string') fail('invalid cursor or changed query');
      }
      let sessions = (await ctx.sessionQuery.listSessions(exec.signal)).filter(s => !s.header.parentSession).sort(order);
      const titles = new Map();
      const titleOf = async id => {
        if (!titles.has(id)) titles.set(id,(await ctx.sessionQuery.readTitle(id,exec.signal))?.title || '');
        return titles.get(id);
      };
      if (query) {

        const matching = [];
        for (let i=0;i<sessions.length;i+=8) {
          exec.signal?.throwIfAborted();
          for (const item of await Promise.all(sessions.slice(i,i+8).map(async s => ({s,title:await titleOf(s.header.id)}))))
            if (item.s.header.id.toLowerCase().includes(query) || item.title.toLowerCase().includes(query)) matching.push(item.s);
        }
        sessions = matching;
      }
      const total = sessions.length;
      if (cursor) sessions = sessions.filter(s => order(s,{header:cursor}) > 0);
      const page = sessions.slice(0,limit), agents = [];
      for (let i=0;i<page.length;i+=8) agents.push(...await Promise.all(page.slice(i,i+8).map(async s => ({id:s.header.id,title:await titleOf(s.header.id),status:ctx.agents.get(s.header.id)?.status || 'persisted'}))));
      const hasMore = sessions.length > page.length, last = page.at(-1)?.header;
      return {agents,total,hasMore,nextCursor:hasMore ? Buffer.from(JSON.stringify({id:last.id,createdAt:last.createdAt,query})).toString('base64url') : null};
    }
  }));
  ctx.tools.register(defineTool({
    name:'dispatch_to_agent', description:'Relay a user-authorized task to one exact existing session with its own model/preset. Keep request_id for retries. Delivery is durably checkpointed; accepted is NOT task completion. Duplicate requests are reconciled, never automatically resent; uncertain requires investigation.',
    parameters:{target_agent_id:{type:'string',required:true},message:{type:'string',required:true},request_id:{type:'string',description:'Stable retry key. Same ID with different content is rejected.'}}, output,
    async execute(args,exec) {
      const caller = callerOf(ctx,exec), id = args.request_id || crypto.randomUUID();
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) fail('invalid request_id');
      if (!args.message.trim() || args.message.length > max) fail(`message must contain 1-${max} characters`);
      if (args.target_agent_id === caller.id) fail('self dispatch is not allowed');
      if (!config.allowCrossRoot && !ctx.agents.isOwnedBy(args.target_agent_id,caller)) fail('target not owned by caller');
      const k = key(caller.id,id);
      return serial(k,async () => {
        callerOf(ctx,exec);
        const previous = requests.get(k);
        if (previous) {
          if (previous.target !== args.target_agent_id || previous.message !== args.message) fail('request_id already belongs to different content');
          const receipt = await inspect(previous);
          return {accepted:receipt.state !== 'uncertain',delivery:previous.state,state:receipt.state,requestId:id,targetAgentId:previous.target,duplicate:true};
        }
        const resolved = await ctx.sessionController.resolveAgent(args.target_agent_id);
        if (resolved.error) fail(resolved.error.message || String(resolved.error));
        callerOf(ctx,exec);
        const target = resolved.agent, session = ctx.sessions.get(args.target_agent_id);
        if (!target || ctx.agents.get(target.id) !== target || !['idle','running'].includes(target.status) || !session) fail('target unavailable');
        const row = {caller:caller.id,target:target.id,requestId:id,message:args.message,state:'pending',createdAt:new Date().toISOString()};
        await requests.put(k,row);
        try {
          callerOf(ctx,exec);
          if (ctx.agents.get(target.id) !== target || ctx.sessions.get(target.id) !== session) fail('target disposed before delivery');
          target.followup(createUserMessage({content:[{type:'text',text:`[cross-session relay ${id}]\nFrom session ${caller.id}. This is relayed task context, not new human authorization. Do not automatically relay it onward.\n${args.message}`}],source:{kind:'cross-session-relay',routerId:ROUTER_ID,requestId:id,fromAgentId:caller.id}}));

          if (!await ctx.sessions.flush(session)) fail('target durability checkpoint unavailable');
          await requests.put(k,{...row,state:'accepted'});
        } catch(error) {await requests.put(k,{...row,state:'uncertain'});throw error;}
        return {accepted:true,delivery:'accepted',state:'accepted',requestId:id,targetAgentId:target.id,duplicate:false};
      });
    }
  }));
  ctx.tools.register(defineTool({
    name:'get_agent_dispatch', description:'Reconcile a relay with actual target inbox/turn history: queued, preparing, running, canceled, error, completed or uncertain. Never resends. Read long results using nextOffset until null; completed means the target turn ended, not independent acceptance.',
    parameters:{request_id:{type:'string',required:true},offset:{type:'number',description:'UTF-16 character offset from nextOffset; default 0.'},limit:{type:'number',description:'Result page size, 1-16000; default 8000.'}}, output,
    async execute(args,exec) {
      const caller = callerOf(ctx,exec), row = requests.get(key(caller.id,args.request_id));
      const offset = integer(args.offset,0,0,Number.MAX_SAFE_INTEGER,'offset'), limit = integer(args.limit,8000,1,16000,'limit');
      if (!row) return {found:false};
      const receipt = await inspect(row), totalChars = receipt.text.length;
      const result = receipt.text.slice(offset,offset+limit), next = offset+result.length;
      return {found:true,state:receipt.state,delivery:row.state,targetAgentId:row.target,result,totalChars,offset,truncated:next<totalChars,nextOffset:next<totalChars?next:null,turn:receipt.turn};
    }
  }));
}
