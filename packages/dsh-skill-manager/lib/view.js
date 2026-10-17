import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { dirname, join } from 'node:path'
import { safeRootPath } from './paths.js'
import { scanRoots, annotate } from './scan.js'
export async function sessionView(ctx, sessionId, globalRoots, signal) {
  let cwd, scope, lease, live, observation
  try {
    if (sessionId) {
      if(typeof sessionId!=='string' || sessionId.length>256) throw new Error('会话标识无效')
      const query=ctx.get('sessionQuery')
      if(!query) throw new Error('会话读取服务不可用')
      observation=await query.observeSession(sessionId,{signal})
      live=ctx.get('agents')?.get(sessionId)
      const directory=ctx.get('workingDirectory')
      if(live) {
        if(!directory) throw new Error('工作目录服务不可用')
        cwd=await directory.ensure(live,signal)
      } else {
        cwd=observation.projections?.values.workingDirectory ?? observation.header.cwd ?? directory?.defaultDirectory
      }
      const presets=ctx.get('agentPresets')
      if(!live && presets) lease=await presets.acquireScope(observation.projections?.values.agentPreset??undefined)
      scope=live??lease?.key
    }
    const registry=(live ? ctx.get('agentPresets')?.serviceFor(live,'skills'):undefined) ?? ctx.get('skills')
    const controller=new AbortController()
    const provider=new FileSystemSkillProvider({get:()=>undefined,logger:ctx.logger},{invalidate:()=>{},signal:controller.signal},{watch:false})
    let discovered
    try { discovered=await provider.roots(cwd) } finally { await provider.dispose() }


    const project=discovered.filter(r=>r.source.startsWith('project-')||r.source.startsWith('custom-')).map(r=>({...r,label:r.source==='project-dsh'?'项目 .dsh/skills':r.source==='project-agents'?'项目 .agents/skills':`自定义技能目录 ${r.path}`,writable:true}))


    const seen=new Set()
    const roots=(await Promise.all([...project,...globalRoots].map(async r=>({...r,writable:r.writable && await safeRootPath(r.path)}))))
      .sort((a,b)=>a.rank-b.rank)
      .filter(r=>{if(seen.has(r.path))return false;seen.add(r.path);return true})
    let winners=[],complete=false
    if (sessionId && registry) {
      const result=await registry.snapshot({cwd,scope,signal})
      winners=result.skills;complete=result.complete && (!lease || !!live)

    }
    const rows=annotate(await scanRoots(roots),winners,complete)
    const files=new Set(rows.filter(r=>r.status==='effective').map(r=>r.name))
    for(const s of winners) {
      if(files.has(s.name))continue
      if(rows.some(r=>r.name===s.name&&r.effectiveFile===s.path&&r.status==='effective'))continue


      if(!complete && rows.some(r=>r.name===s.name))continue
      rows.push({id:`registry:${s.provider}:${s.name}`,name:s.name,description:s.description,source:s.source,sourceLabel:`提供器 ${s.provider}`,writable:false,enabled:true,invocation:s.invocation,effectiveInvocation:s.invocation,effectiveFile:s.path,file:s.path,exactProviderFile:true,status:complete?'effective':'unverified',copies:[],rank:250})
    }
    return {skills:rows,roots,sessionId:sessionId??null,cwd:cwd??null,authoritative:complete,warning:!sessionId?'未选择会话；仅显示用户文件状态':!complete?'会话目录观察未完成；不推断生效状态':undefined}
  } finally {
    observation?.[Symbol.dispose]?.()
    if(lease?.[Symbol.asyncDispose]) await lease[Symbol.asyncDispose]()
  }
}
