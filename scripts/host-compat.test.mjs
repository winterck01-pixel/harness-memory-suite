import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'

const root=fileURLToPath(new URL('../',import.meta.url))
const manifest=JSON.parse(readFileSync(join(root,'patches/dsh-tools-compat.json')))
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex')

test('RC2 patch applies, is idempotent, and rejects unknown versions or modified baselines',()=>{
 const target=mkdtempSync(join(tmpdir(),'harness-compat-test-'))
 try{
  const sdk=join(root,'node_modules/@deepseek-ai/dsh-tools')
  copyFileSync(join(sdk,'package.json'),join(target,'package.json'))
  for(const file of manifest.files){mkdirSync(join(target,file.path,'..'),{recursive:true});copyFileSync(join(sdk,file.path),join(target,file.path))}
  if(manifest.files.every(f=>digest(join(target,f.path))===f.after))execFileSync('patch',['--batch','-R','-p1','-i',join(root,'patches/dsh-tools-compat.patch')],{cwd:target,stdio:'pipe'})
  assert.ok(manifest.files.every(f=>digest(join(target,f.path))===f.before))
  const run=()=>spawnSync(process.execPath,[join(root,'scripts/apply-host-compat.mjs'),'--package-root',target],{encoding:'utf8'})
  const packageFile=join(target,'package.json'),original=readFileSync(packageFile)
  writeFileSync(packageFile,JSON.stringify({...JSON.parse(original),version:'0.0.0'}))
  assert.notEqual(run().status,0)
  assert.ok(manifest.files.every(f=>digest(join(target,f.path))===f.before))
  writeFileSync(packageFile,original)
  const first=join(target,manifest.files[0].path),source=readFileSync(first)
  writeFileSync(first,Buffer.concat([source,Buffer.from('\n// synthetic drift\n')]))
  const changed=digest(first)
  assert.notEqual(run().status,0)
  assert.equal(digest(first),changed)
  writeFileSync(first,source)
  const applied=run();assert.equal(applied.status,0,applied.stderr)
  assert.ok(manifest.files.every(f=>digest(join(target,f.path))===f.after))
  assert.equal(run().status,0)
  for(const f of manifest.files)assert.equal(existsSync(join(target,f.path)+'.compat-pending'),false)
 }finally{rmSync(target,{recursive:true,force:true})}
})
