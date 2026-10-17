


import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, createPublicKey, verify, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { validateContent, invocationOf } from './parse.js'

const run = promisify(execFile)
const API = 'https://api.skillhub.cn'
const MAX_ZIP = 32 * 1024 * 1024
const sha = value => createHash('sha256').update(value).digest('hex')
const coordinate = x => {
  if (!x || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(x.slug || '') ||
      !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(x.namespace || '') ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,99}$/.test(x.version || '') ||
      /^(latest|main|master)$/i.test(x.version)) throw Error('Fixed namespace, slug and version required')
  return { namespace: x.namespace, slug: x.slug, version: x.version }
}
function endpoint(c, suffix) {
  const q = new URLSearchParams({ namespace: c.namespace })
  return `${API}/api/v1/open/skills/${encodeURIComponent(c.slug)}/versions/${encodeURIComponent(c.version)}/${suffix}?${q}`
}
async function safePath(p, mustExist = true) {
  if (!path.isAbsolute(p)) throw Error('Explicit absolute path required')
  let cur = path.parse(p).root
  for (const part of p.slice(cur.length).split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part)
    try { if ((await fs.lstat(cur)).isSymbolicLink()) throw Error('Symlink path refused') }
    catch (e) { if (e.code !== 'ENOENT' || mustExist) throw e }
  }
  return path.resolve(p)
}
const zipScript = String.raw`
import sys,zipfile,pathlib,stat,hashlib,json
z,d=sys.argv[1:]; root=pathlib.Path(d); entries=[]; seen=set(); total=0
with zipfile.ZipFile(z) as f:
 items=f.infolist()
 if len(items)>2000: raise ValueError('ZIP entry count exceeded')
 for i in items:
  n=i.filename; parts=n.rstrip('/').split('/'); mode=i.external_attr>>16
  if not n or n.startswith('/') or '\\' in n or any(p in ('','..','.') or ':' in p or any(ord(c)<32 for c in p) for p in parts): raise ValueError('Unsafe ZIP path')
  if n.rstrip('/') in seen: raise ValueError('Duplicate ZIP path')
  seen.add(n.rstrip('/'))
  if i.flag_bits&1 or stat.S_ISLNK(mode) or stat.S_IFMT(mode) not in (0,stat.S_IFREG,stat.S_IFDIR): raise ValueError('Special/encrypted ZIP entry')
  total+=i.file_size
  if i.file_size>16*1024*1024 or total>64*1024*1024: raise ValueError('ZIP expanded size exceeded')
  if i.file_size>1024*1024 and i.file_size/max(i.compress_size,1)>200: raise ValueError('ZIP compression ratio exceeded')
 for i in items:
  p=root.joinpath(*i.filename.rstrip('/').split('/'))
  if i.is_dir(): p.mkdir(parents=True,exist_ok=True); continue
  p.parent.mkdir(parents=True,exist_ok=True); h=hashlib.sha256(); size=0
  with f.open(i) as r,p.open('xb') as w:
   while True:
    b=r.read(65536)
    if not b: break
    size+=len(b)
    if size>i.file_size: raise ValueError('ZIP size mismatch')
    h.update(b); w.write(b)
  if size!=i.file_size: raise ValueError('ZIP size mismatch')
  p.chmod(0o600); entries.append({'path':i.filename,'sha256':h.hexdigest(),'bytes':size})
print(json.dumps(sorted(entries,key=lambda x:x['path'])))
`
async function tree(root, prefix = '', budget = { count:0, bytes:0 }) {
  const entries = []
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    const rel = prefix + item.name, p = path.join(root, item.name)
    if(++budget.count>2000) throw Error('Filesystem entry count exceeded')
    if (item.isSymbolicLink() || (!item.isDirectory() && !item.isFile())) throw Error('Special filesystem entry refused')
    if (item.isDirectory()) entries.push(...await tree(p, rel + '/',budget))
    else { const stat=await fs.stat(p); budget.bytes+=stat.size; if(stat.size>16*1024*1024 || budget.bytes>64*1024*1024) throw Error('Filesystem size exceeded'); const b = await fs.readFile(p); entries.push({ path: rel, sha256: sha(b), bytes: b.length }) }
  }
  return entries.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}
function contentHash(entries, includeMeta) {

  return sha(entries.filter(e => {
    const parts = e.path.split('/'), base = parts.at(-1)
    return !parts.includes('__MACOSX') && base !== '.DS_Store' && !base.startsWith('._') &&
      base.toLowerCase() !== 'thumbs.db' && (includeMeta || e.path !== '_meta.json')
  }).map(e => `${e.path}:${e.sha256}\n`).join(''))
}
export function verifySignature(c, record, keys, entries) {
  const unverified = reason => ({ status: 'unverified', reason })
  if (!record?.signed) return unverified('not_signed_or_unavailable')
  try {
    const key = keys?.keys?.find(k => k.key_id === record.key_id)
    if (!key?.public_key_raw_b64 || !record.payload || !record.signature) return unverified('signature_or_key_missing')
    const raw = Buffer.from(key.public_key_raw_b64, 'base64')
    if (raw.length !== 32) throw Error('Invalid Ed25519 key')
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100','hex'), raw]), format: 'der', type: 'spki' })
    if (!verify(null, Buffer.from(record.payload), publicKey, Buffer.from(record.signature,'base64'))) return { status:'failed', reason:'invalid_signature' }
    const payload = JSON.parse(record.payload)

    if (payload.slug !== c.slug || payload.version !== c.version || payload.namespace !== c.namespace) return {status:'failed',reason:'signed_identity_missing_or_mismatch'}
    const modes = [false, true].filter(meta => contentHash(entries, meta) === payload.content_hash)
    if (!modes.length) return { status:'failed', reason:'signed_content_mismatch' }
    return { status:'verified', mode:'local-ed25519', keyId:record.key_id, contentHash:payload.content_hash, includeMeta:modes[0] }
  } catch { return {status:'failed',reason:'invalid_signature_record'} }
}
function reviewHash(manifest) { const { reviewHash, ...data } = manifest; return sha(JSON.stringify(data)) }


export async function stageZip({ zipPath, stagingRoot, identity, sourceUrl, signature, keys }) {
  const c = coordinate(identity)
  await safePath(stagingRoot)
  await safePath(zipPath)
  const bytes = await fs.readFile(zipPath)
  if (bytes.length > MAX_ZIP) throw Error('ZIP download size exceeded')
  const dir = await fs.mkdtemp(path.join(stagingRoot, 'skillhub-'))
  try {
    await fs.writeFile(path.join(dir,'package.zip'),bytes,{flag:'wx',mode:0o600})
    const bundle = path.join(dir,'bundle'); await fs.mkdir(bundle)
    const { stdout } = await run('python3',['-c',zipScript,path.join(dir,'package.zip'),bundle],{maxBuffer:1024*1024,timeout:30000})
    const entries = JSON.parse(stdout)
    const skillEntries = entries.filter(e => e.path === 'SKILL.md' || /^[^/]+\/SKILL\.md$/.test(e.path))
    if (skillEntries.length !== 1) throw Error('Package must contain exactly one root or single-wrapper SKILL.md')
    const skillPath = skillEntries[0].path, wrapper = path.posix.dirname(skillPath)
    if (wrapper !== '.' && entries.some(e => !e.path.startsWith(wrapper+'/'))) throw Error('Files outside skill wrapper refused')
    const result = validateContent(await fs.readFile(path.join(bundle,skillPath),'utf8'))
    if (!result.ok) throw Error('Invalid Harness skill: ' + result.errors.join('; '))
    const manifest = { schema:1, identity:c, sourceUrl:sourceUrl || 'local-fixture', zipSha256:sha(bytes), entries,
      skillPath, name:result.data.name, description:result.data.description, invocation:invocationOf(result.data),
      signature:verifySignature(c,signature,keys,entries), signatureRecord:signature || null, platformKeys:keys || null }
    manifest.reviewHash = reviewHash(manifest)
    await fs.writeFile(path.join(dir,'review.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600})
    return { candidate:dir, ...manifest }
  } catch (e) { await fs.rm(dir,{recursive:true,force:true}); throw e }
}
async function getOfficial(url, json = false) {
  const allowed = new Set(['api.skillhub.cn','skillhub-1388575217.cos.ap-guangzhou.myqcloud.com'])
  let target = url
  for (let hop=0; hop<4; hop++) {
    const u = new URL(target)
    if (u.protocol !== 'https:' || !allowed.has(u.hostname) || u.port || u.username || u.password) throw Error('Non-official download origin refused')
    const r = await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(30000)})
    if ([301,302,303,307,308].includes(r.status)) { target=new URL(r.headers.get('location'),target).href; continue }
    if (!r.ok) throw Error(`Official API HTTP ${r.status}`)
    const chunks=[]; let n=0
    for await (const chunk of r.body) { n+=chunk.length; if (n>(json?1024*1024:MAX_ZIP)) throw Error('Response size exceeded'); chunks.push(chunk) }
    const bytes=Buffer.concat(chunks)
    return json ? JSON.parse(bytes.toString('utf8')) : bytes
  }
  throw Error('Too many redirects')
}
export async function download({ stagingRoot, identity }) {
  const c=coordinate(identity); await safePath(stagingRoot)
  const url=`${API}/api/v1/download?${new URLSearchParams(c)}`
  const bytes=await getOfficial(url)
  const tmp=path.join(stagingRoot,`.download-${randomUUID()}.zip`)
  await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600})
  try {
    let signature=null, keys=null
    try { signature=await getOfficial(endpoint(c,'signature'),true); keys=await getOfficial(`${API}/api/v1/open/platform/keys`,true) } catch {                             }
    return await stageZip({zipPath:tmp,stagingRoot,identity:c,sourceUrl:url,signature,keys})
  } finally { await fs.rm(tmp,{force:true}) }
}
export async function inspect(candidate, expectedReviewHash) {
  await safePath(candidate)
  await safePath(path.join(candidate,'review.json'))
  const m=JSON.parse(await fs.readFile(path.join(candidate,'review.json'),'utf8'))
  coordinate(m.identity)
  if(m.schema!==1 || !/^(?:[^/\\]+\/)?SKILL\.md$/.test(m.skillPath || '') || m.skillPath.startsWith('../')) throw Error('Invalid review schema or skill path')
  if (!expectedReviewHash || expectedReviewHash !== m.reviewHash || reviewHash(m) !== expectedReviewHash) throw Error('Mandatory review hash mismatch')
  await safePath(path.join(candidate,'package.zip')); await safePath(path.join(candidate,'bundle'))
  if (sha(await fs.readFile(path.join(candidate,'package.zip'))) !== m.zipSha256 ||
      JSON.stringify(await tree(path.join(candidate,'bundle'))) !== JSON.stringify(m.entries)) throw Error('Reviewed package changed')
  const result=validateContent(await fs.readFile(path.join(candidate,'bundle',m.skillPath),'utf8'))
  if (!result.ok || result.data.name !== m.name) throw Error('Reviewed skill identity invalid')
  const actual=verifySignature(m.identity,m.signatureRecord,m.platformKeys,m.entries)
  if (JSON.stringify(actual)!==JSON.stringify(m.signature)) throw Error('Signature status changed')
  return m
}
async function conflicts(root,name) {
  const found=[]
  for (const entry of await fs.readdir(root,{withFileTypes:true})) {
    if (entry.isSymbolicLink()) throw Error('Symlink in skill root refused')
    const p=path.join(root,entry.name), skill=entry.isDirectory()?path.join(p,'SKILL.md'):entry.name.endsWith('.md')?p:null
    if (!skill) continue
    try { await safePath(skill); const r=validateContent(await fs.readFile(skill,'utf8')); if (r.data.name===name) found.push(p) }
    catch(e) { if (e.code!=='ENOENT') throw e }
  }
  return found
}
export async function importCandidate({candidate,reviewHash:expected,root,conflictRoots=[],allowUnverified=false,overwrite=false}) {
  const m=await inspect(candidate,expected)
  if (m.signature.status==='failed' || (m.signature.status!=='verified'&&!allowUnverified)) throw Error('Unverified import blocked; explicit allowUnverified required')
  await safePath(root)
  if(!(await fs.stat(root)).isDirectory()) throw Error('Discovery root must be an existing directory')
  if (root===candidate || root.startsWith(candidate+path.sep) || candidate.startsWith(root+path.sep)) throw Error('Staging must be outside discovery root')
  const target=path.join(root,m.name), roots=[...new Set([root,...conflictRoots])], collisions=[]
  for(const r of roots) { await safePath(r); collisions.push(...await conflicts(r,m.name)) }
  let exists=false
  try { await fs.lstat(target); exists=true } catch(e) { if(e.code!=='ENOENT') throw e }
  if (collisions.some(p=>p!==target) || ((!overwrite)&&(exists||collisions.length))) throw Error('Skill identity/path conflict')
  let oldEntries=null
  if (exists) { await safePath(target); oldEntries=await tree(target) }
  if((await fs.stat(root)).dev!==(await fs.stat(candidate)).dev) throw Error('Staging and discovery root must share a filesystem for atomic import')
  await safePath(path.join(candidate,'transactions'),false)
  const transaction=path.join(candidate,'transactions',randomUUID()); await fs.mkdir(transaction,{recursive:true})
  if (exists) await fs.cp(target,path.join(transaction,'backup'),{recursive:true,errorOnExist:true,force:false})
  const source=path.dirname(path.join(candidate,'bundle',m.skillPath))
  const next=path.join(transaction,'next')
  let installed=false
  try {
    await fs.cp(source,next,{recursive:true,errorOnExist:true,force:false})

    await inspect(candidate,expected)
    const prefix=path.posix.dirname(m.skillPath);const reviewed=m.entries.map(e=>({...e,path:prefix==='.'?e.path:e.path.slice(prefix.length+1)}));
    if(JSON.stringify(await tree(next))!==JSON.stringify(reviewed)) throw Error('Copied installation differs from reviewed candidate')
    const currentCollisions=[]
    for(const r of roots) currentCollisions.push(...await conflicts(r,m.name))
    if(JSON.stringify(currentCollisions)!==JSON.stringify(collisions)) throw Error('Skill conflicts changed during import')
    if(exists) {
      if(JSON.stringify(await tree(target))!==JSON.stringify(oldEntries)) throw Error('Existing skill changed during import')
    } else {
      try { await fs.lstat(target); throw Error('Target appeared during import') } catch(e) { if(e.code!=='ENOENT') throw e }
    }
    if (exists) await fs.rename(target,path.join(transaction,'previous'))
    await fs.rename(next,target)
    installed=true
    const receipt={schema:1,root,target,name:m.name,reviewHash:expected,identity:m.identity,hadPrevious:exists,backupEntries:oldEntries,installedEntries:await tree(target),rolledBack:false}
    await fs.writeFile(path.join(transaction,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600})
    return {transaction,...receipt}
  } catch(e) {
    await fs.rm(next,{recursive:true,force:true})
    if(installed) await fs.rename(target,path.join(transaction,'failed-import'))
    try { await fs.access(path.join(transaction,'previous')); await fs.rename(path.join(transaction,'previous'),target) } catch {}
    throw e
  }
}
export async function rollback(transaction) {
  await safePath(transaction)
  await safePath(path.join(transaction,'receipt.json'))
  const p=path.join(transaction,'receipt.json'), r=JSON.parse(await fs.readFile(p,'utf8'))
  if(r.rolledBack) throw Error('Already rolled back')
  await safePath(r.root); await safePath(r.target)
  if(r.target!==path.join(r.root,r.name) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.name)) throw Error('Invalid rollback target')
  if(JSON.stringify(await tree(r.target))!==JSON.stringify(r.installedEntries)) throw Error('Installed skill changed; rollback refused')
  if(r.hadPrevious) { await safePath(path.join(transaction,'backup')); if(JSON.stringify(await tree(path.join(transaction,'backup')))!==JSON.stringify(r.backupEntries)) throw Error('Backup changed; rollback refused') }
  const restore=path.join(transaction,'restore'),withdrawn=path.join(transaction,'withdrawn')
  if(r.hadPrevious) await fs.cp(path.join(transaction,'backup'),restore,{recursive:true,errorOnExist:true,force:false})
  await fs.rename(r.target,withdrawn)
  try { if(r.hadPrevious) await fs.rename(restore,r.target) }
  catch(e) { await fs.rename(withdrawn,r.target); throw e }
  r.rolledBack=true; await fs.writeFile(p,JSON.stringify(r,null,2)+'\n')
  return r
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command,...args]=process.argv.slice(2), opts={}
  for(let i=0;i<args.length;i++) {
    if(!args[i].startsWith('--')) throw Error('Expected named option')
    const key=args[i].slice(2)
    if(!['namespace','slug','version','staging','candidate','review-hash','root','conflict-roots','transaction','allow-unverified','overwrite'].includes(key)) throw Error('Unknown option: '+key)
    if(['allow-unverified','overwrite'].includes(key)) opts[key]=true
    else { if(!args[i+1]||args[i+1].startsWith('--')) throw Error('Missing option value'); opts[key]=args[++i] }
  }
  try {
    let result
    if(command==='download') result=await download({stagingRoot:opts.staging,identity:opts})
    else if(command==='inspect') result=await inspect(opts.candidate,opts['review-hash'])
    else if(command==='import') result=await importCandidate({candidate:opts.candidate,reviewHash:opts['review-hash'],root:opts.root,conflictRoots:opts['conflict-roots']?JSON.parse(opts['conflict-roots']):[],allowUnverified:!!opts['allow-unverified'],overwrite:!!opts.overwrite})
    else if(command==='rollback') result=await rollback(opts.transaction)
    else throw Error('Commands: download, inspect, import, rollback; all paths absolute. Review.json requires human code/permission/dependency review before import.')
    process.stdout.write(JSON.stringify(result,null,2)+'\n')
  } catch(e) { process.stderr.write(e.message+'\n'); process.exitCode=1 }
}
