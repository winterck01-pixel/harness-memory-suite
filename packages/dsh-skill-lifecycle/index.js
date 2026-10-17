import { createHash } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { apply as officialApply, inject as officialInject } from '@deepseek-ai/dsh-tool-skill';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { isModelInvocable, isSkillName } from '@deepseek-ai/dsh-skill';
import { validateContent } from './parse.js';
export { searchSkillCapabilities } from './capability-index.js';
export const name = 'skill-lifecycle';
export const inject = [...officialInject];
export const revision = content => createHash('sha256').update(content).digest('hex');
export function validateDraft(content) {
  const result = validateContent(content);
  const errors = [...result.errors];
  if (!result.body.trim()) errors.push('技能正文不能为空');
  if (typeof result.data.description === 'string' && !result.data.description.trim()) errors.push('description不能只有空白');
  return { valid: errors.length === 0, errors, warnings: [
    ...(result.data.whenToUse ? ['whenToUse不会进入模型技能目录；触发条件须写入description。'] : []),
    ...(result.data.description?.length > 500 ? ['目录描述最多显示500字符；将主要触发条件放在前面。'] : []),
  ], ...(errors.length === 0 ? { name: result.data.name, revision: revision(result.body.trim()) } : {}) };
}
export async function checkSkill(skills, args, exec, workingDirectory) {
  if (!isSkillName(args.name)) throw new Error('Invalid skill name');
  const lookup = { cwd: exec.agent === undefined ? undefined : await workingDirectory.ensure(exec.agent, exec.signal), scope: exec.agent, signal: exec.signal };
  const summary = (await skills.list(lookup)).find(s => s.name === args.name);
  if (!summary) return { name: args.name, status: 'unavailable', loaded: false };

  if (!isModelInvocable(summary)) return { name: args.name, status: 'model-invocation-disabled', loaded: false };
  const skill = await skills.get(args.name, lookup);
  if (!skill || !isModelInvocable(skill)) return { name: args.name, status: 'unavailable', loaded: false };
  const hash = revision(skill.content);
  return { name: skill.name, status: 'available', provider: skill.provider, resourceBase: skill.resourceBase, ...(skill.path ? { path: skill.path } : {}), ...(skill.source ? { source: skill.source } : {}),
    revision: hash, ...(args.expectedRevision ? { revisionMatches: hash === args.expectedRevision } : {}),
    ...(args.expectedPath ? { pathMatches: skill.path === args.expectedPath } : {}), loaded: false, notice: '这是当前有效来源的检查，不是正文加载。修改后请调用skill重新加载；若revision不符，先检查同名项目文件覆盖，不要删除其他来源。' };
}

export function retireSkillCatalogs({agent,turn,signal}) {
  const session=agent?.session;
  if (!session?.eventAt || !session?.append || !Array.isArray(session.surface?.nodes)) return 0;

  let boundary;
  for(let i=session.seq-1;i>=0;i--){const e=session.eventAt(i);if(e?.type==='turn/start'||e?.type==='turn/end'){boundary=e;break;}}
  if(boundary?.type!=='turn/start'||boundary.data.turn!==turn) return 0;
  signal?.throwIfAborted();
  const catalogs=session.surface.nodes.filter(seq=>{const e=session.eventAt(seq);return e?.type==='user/message'&&e.data.source?.kind==='skill-catalog';});
  for(const seq of catalogs){
    signal?.throwIfAborted();
    session.append('user/message',createUserMessage({source:{kind:'capability-skill-catalog-reference',originalSeq:seq},content:[{type:'text',text:'技能目录按需检索：使用 search_capabilities(kind="skill", query=任务关键词)，再用 skill 读取所选正文；用户显式 /skill 调用保持有效。'}]}),{surfaceOp:{op:'replace',startSeq:seq,endSeq:seq},sourceEventSeqs:[seq]});
  }
  return catalogs.length;
}
export function apply(ctx, config = {}) {

  const tools = new Proxy(ctx.tools, { get(target, key) {
    if (key === 'register') return tool => {
      if (tool.name === 'skill') {
        const execute = tool.execute;
        tool.execute = async (args, exec) => {
          const value = await execute(args, exec);
          return { ...value, content: value.content + `\n\n[加载版本 SHA256: ${revision(value.content)}。这是本次读取的正文；此后文件改变须重新调用 skill。]` };
        };
      }
      return target.register(tool);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  const scope = new Proxy(ctx, { get(target, key) {
    if (key === 'tools') return tools;


    if (key === 'on') return (event, listener, ...options) => {
      if (event !== 'agent/pre-step') return target.on(event, listener, ...options);
      return target.on(event, async (payload, next) => {
        const decision = await listener(payload, next);
        if (decision.kind === 'reject') return decision;
        retireSkillCatalogs(payload);
        return { ...decision, messages: decision.messages.filter(message => message.source?.kind !== 'skill-catalog') };
      }, ...options);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  officialApply(scope, config);
  const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
  ctx.tools.register(defineTool({ name: 'skill_check', description: 'Check one skill’s effective source and current revision in this session. Does not load instructions. After writing a skill, compare expectedRevision from skill_validate, then call skill to load. Do not scan unrelated skills.',
    parameters: { name: { type: 'string', required: true }, expectedRevision: { type: 'string' }, expectedPath: { type: 'string' } }, output,
    execute: (args, exec) => checkSkill(ctx.skills, args, exec, ctx.workingDirectory), presentCall: args => ({ card: 'generic', title: `Check skill ${args.name}`, kind: 'read' }) }));
  ctx.tools.register(defineTool({ name: 'skill_validate', description: 'Validate a proposed SKILL.md without writing or executing it. Does not grant permission or prove installation. Returns revision for skill_check. Use skill-authoring-workflow when creating or updating skills.',
    parameters: { content: { type: 'string', required: true } }, output,
    execute: args => validateDraft(args.content), presentCall: () => ({ card: 'generic', title: 'Validate skill draft', kind: 'read' }) }));
}
