import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rename, writeFile, stat, link, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, dirname, basename } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { SKILL_MAX_BYTES, validateContent } from './lib/parse.js'
import { safeRootPath } from './lib/paths.js'
import { sessionView } from './lib/view.js'
export const name='dsh-skill-manager'
export const inject=[]
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})
const fail=(status,error)=>json({ok:false,error},status)
const digest=s=>createHash('sha256').update(s).digest('hex')
const BACKUP_KEEP=50

let VERSION='unknown'
try{VERSION=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')).version??VERSION}catch{}
export function apply(ctx,config={}) {
  const log=config.verbose?(...a)=>console.log('[skill-manager]',...a):()=>{}
  log('apply',{version:VERSION,roots:config.roots,bundledDir:config.bundledDir})
  const home=process.env.DSH_HOME??join(homedir(),'.dsh')
  const roots=[{path:config.roots?.[0]??join(home,'skills'),source:'user-dsh',label:'用户 .dsh/skills',rank:400,writable:true,skipSystem:true},{path:config.roots?.[1]??join(process.env.DSH_AGENTS_HOME??join(homedir(),'.agents'),'skills'),source:'user-agents',label:'用户 .agents/skills',rank:500,writable:true}]
  const bundled=config.bundledDir!==undefined?config.bundledDir:process.env.DSH_BUNDLED_SKILL_DIR??join(homedir(),'.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills')
  if(bundled && existsSync(bundled)) roots.push({path:bundled,source:'bundled',label:'官方预置（文件只读；会话优先级以 Registry 为准）',rank:600,writable:false})
  for(const route of buildRoutes(ctx,roots,log)) ctx.inject(['connection'],c=>c.effect(()=>c.connection.fetch.register(route),`skill-manager ${route.path}`))
}
export function buildRoutes(ctx,roots,log=()=>{}) {
  const view=async(req,body)=>sessionView(ctx,body?.sessionId??new URL(req.url).searchParams.get('sessionId')??undefined,roots,req.signal)
  const wrap=(path,methods,fn)=>({path:'/api/skill-manager'+path,methods,requestBody:'buffered',async fetch(req){try{return await fn(req)}catch(e){return fail(e.code==='SESSION_QUERY_SESSION_NOT_FOUND'?404:400,e.message??String(e))}}})
  const body=async req=>{const raw=await req.text();if(Buffer.byteLength(raw)>SKILL_MAX_BYTES+8192)throw new Error('请求过大');return JSON.parse(raw)}
  function assertDirectory(b,v) {
    if(v.sessionId && b.expectedCwd!==v.cwd) throw new Error('工作目录已变化，请刷新技能列表后重试')
  }
  async function rowFor(req,b,write=false) {
    const v=await view(req,b)
    if(write) assertDirectory(b,v)
    const row=v.skills.find(x=>x.file===b.path)
    if(!row || (write&&(!row.writable || !await safeRootPath(row.root)))) throw new Error('目标不是本会话可管理的技能文件')
    if(!isAbsolute(row.file)||row.file.includes('\0')) throw new Error('无效路径')
    const actual=await realpath(row.file);if(row.exactProviderFile){if(write || actual!==row.file)throw new Error('提供器路径不可写或已变化');return {row,actual,v}}
    const root=await realpath(row.root)
    const rel=relative(root,actual)
    if(!rel || rel.startsWith('../') || rel==='..'||isAbsolute(rel)) throw new Error('路径逃逸')
    return {row,actual,v}
  }
  return [
    wrap('/list',['GET'],async req=>json({ok:true,...await view(req)})),
    wrap('/status',['GET'],async()=>json({ok:true,version:VERSION,runningSessions:ctx.get('agents')?ctx.get('agents').list().filter(a=>a.status==='running').map(a=>a.id):null})),
    wrap('/read',['GET'],async req=>{const {actual,row}=await rowFor(req,{path:new URL(req.url).searchParams.get('path')});if((await stat(actual)).size>SKILL_MAX_BYTES)return fail(413,'文件过大');const content=await readFile(actual,'utf8');return json({ok:true,content,writable:row.writable,sha256:digest(content)})}),
    wrap('/save',['POST'],async req=>{
      const b=await body(req),v=await view(req,b),check=validateContent(b.content)
      assertDirectory(b,v)
      if(!check.ok)return fail(400,check.errors.join('；'))
      let file,previous
      if(b.path) {
        const located=await rowFor(req,b,true);file=located.actual
        if(!located.row.enabled)return fail(409,'请先开启此文件再编辑')
        previous=await readFile(file,'utf8')
        if(!b.expectedHash||digest(previous)!==b.expectedHash)return fail(409,'文件已变化，请重新读取后保存')
      } else {
        const root=v.roots.find(x=>x.path===b.root&&x.writable)
        if(!root||!await safeRootPath(root.path)||typeof b.dir!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(b.dir))return fail(400,'无效目录或写入根')
        await mkdir(root.path,{recursive:true});const safeRoot=await realpath(root.path),dir=join(safeRoot,b.dir)
        if(existsSync(dir))return fail(409,'目标目录已存在；请打开该文件编辑')

        try{await mkdir(dir)}catch(e){if(e.code==='EEXIST')return fail(409,'目标目录已存在；请打开该文件编辑');throw e}
        file=join(dir,'SKILL.md')
      }
      const temp=join(dirname(file),`.skill-manager-${randomUUID()}.tmp`)
      if(previous!==undefined) await backup(file,previous,log)


      try{
        await writeFile(temp,b.content,{flag:'wx'})
        await rename(temp,file)
      }catch(e){
        await unlink(temp).catch(()=>{})
        throw e
      }
      log('save',{file,bytes:Buffer.byteLength(b.content,'utf8')})
      return json({ok:true,file,sha256:digest(b.content),scope:'file',...await view(req,b)})
    }),
    wrap('/toggle',['POST'],async req=>{
      const b=await body(req);if(typeof b.enable!=='boolean')return fail(400,'enable须为布尔值')
      const {actual,row}=await rowFor(req,b,true)
      if(row.enabled===b.enable)return fail(409,'文件状态已变化，请刷新')
      if(!/\.md(?:\.off)?$/.test(actual))return fail(400,'只能切换技能Markdown文件')
      const to=b.enable?actual.slice(0,-4):actual+'.off'
      await backup(actual,await readFile(actual),log)


      try{await link(actual,to)}catch(e){
        if(e.code==='EEXIST')return fail(409,'目标文件名已存在')
        throw e
      }
      try{await unlink(actual)}catch(e){
        await unlink(to).catch(()=>{})
        throw e
      }
      log('toggle',{from:actual,to,enable:b.enable})

      return json({ok:true,file:to,enabled:b.enable,scope:'file',notice:'仅切换此文件；刷新以检查同名来源，已有加载正文不会撤回'})
    }),
  ]
}
async function backup(file,content,log=()=>{}) {
  const root=join(process.env.DSH_HOME??join(homedir(),'.dsh'),'skill-manager-backups')
  await mkdir(root,{recursive:true,mode:0o700})

  const id=Date.now().toString(36)+'-'+randomUUID()
  await writeFile(join(root,id+'.md'),content,{flag:'wx',mode:0o600})
  await writeFile(join(root,id+'.json'),JSON.stringify({file,sha256:digest(content),createdAt:new Date().toISOString()}),{flag:'wx',mode:0o600})

  try{
    const names=(await readdir(root)).filter(n=>n.endsWith('.md')).sort().reverse()
    for(const stale of names.slice(BACKUP_KEEP)){
      await unlink(join(root,stale)).catch(()=>{})
      await unlink(join(root,stale.replace(/\.md$/,'.json'))).catch(()=>{})
    }
    if(names.length>BACKUP_KEEP) log('backup pruned',{removed:names.length-BACKUP_KEEP,keep:BACKUP_KEEP})
  }catch(e){log('backup prune failed',{error:String(e?.message??e)})}
}
