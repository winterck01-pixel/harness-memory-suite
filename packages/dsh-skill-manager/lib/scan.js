import { readdir, readFile, stat, realpath } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { safeRootPath } from './paths.js'
import { validateContent, invocationOf, SKILL_MAX_BYTES } from './parse.js'
export async function scanRoots(roots) {
  const flat = (await Promise.all(roots.map(scanRoot))).flat()
  return flat.sort((a,b) => a.rank-b.rank || a.file.localeCompare(b.file))
}
async function scanRoot(root) {
  let entries
  try { entries = await readdir(root.path, { withFileTypes:true }) }


  catch(e) { if (['ENOENT','ENOTDIR','EACCES','EPERM'].includes(e.code)) return []; throw e }
  const rows=[];const rootSafe=await safeRootPath(root.path)
  for (const ent of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    if (root.skipSystem && ent.name === '.system') continue
    const p=join(root.path,ent.name)
    let info; try { info=await stat(p) } catch { continue }
    const files=info.isDirectory() ? [join(p,'SKILL.md'),join(p,'SKILL.md.off')] : info.isFile() && /\.md(?:\.off)?$/.test(ent.name) ? [p] : []
    for (const file of files) {
      let s; try { s=await stat(file) } catch { continue }
      if (!s.isFile()) continue
      let actual, base

      try { actual=await realpath(file); base=await realpath(root.path) } catch { continue }
      const rel=relative(base,actual), safe=rel!=='' && rel!=='..' && !rel.startsWith('../') && !isAbsolute(rel)
      const row={id:`${root.source}:${file}`,source:root.source,sourceLabel:root.label,root:root.path,rank:root.rank,file,actualPath:actual,dirName:info.isDirectory()?ent.name:ent.name.replace(/\.md(?:\.off)?$/,''),shape:info.isDirectory()?'bundle':'flat',enabled:!file.endsWith('.off'),writable:root.writable && rootSafe && safe && !ent.isSymbolicLink(),sizeBytes:s.size,updatedAt:s.mtimeMs}
      if (s.size>SKILL_MAX_BYTES) row.error='内容超过管理器256KiB限制'
      else {
        const check=validateContent(await readFile(file,'utf8'))
        row.name=typeof check.data.name==='string'?check.data.name:row.dirName;row.description=typeof check.data.description==='string'?check.data.description:'';row.whenToUse=typeof check.data.whenToUse==='string'?check.data.whenToUse:undefined
        if (!check.ok) row.error=check.errors.join('；')
        else row.invocation=invocationOf(check.data)
      }
      rows.push(row)
    }
  }
  return rows
}
export function annotate(rows, winners, authoritative=false) {
  const effective = new Map(winners.map(x=>[x.name,x]))
  const grouped = new Map()
  for (const row of rows) { if(typeof row.name==='string') {const g=grouped.get(row.name)??[];g.push(row);grouped.set(row.name,g)} }
  for (const row of rows) {
    const winner=effective.get(row.name)
    row.effectiveFile=winner?.path
    row.effectiveSource=winner?.source
    row.effectiveInvocation=winner?.invocation
    row.status=row.error?'invalid':!row.enabled?'file-disabled':!authoritative?'unverified':winner?.path===(row.actualPath??row.file)?'effective':winner?'shadowed':'unavailable'
    row.copies=(grouped.get(row.name)??[]).filter(x=>x!==row).map(x=>({file:x.file,enabled:x.enabled,source:x.source,sourceLabel:x.sourceLabel}))
    if(row.status==='file-disabled' && winner) row.notice=`此文件已关闭；同名技能仍由 ${winner.path??winner.provider??winner.source} 提供`
    else if(row.status==='shadowed') row.notice=`被 ${winner.path??winner.provider??winner.source} 覆盖`
  }
  return rows
}
