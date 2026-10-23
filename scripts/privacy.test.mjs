import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const ledgers=['execution-experience.json','auto-experience.json','daily-experience.json','successful-experiences.json','auto-learning-policy.json','runtime-state.json'];
const artifacts=ledgers.flatMap(name=>[name,name+'.00000000-0000-4000-8000-000000000000.tmp']);

test('source privacy check rejects runtime experience data without printing its contents',()=>{
 const dir=mkdtempSync(join(tmpdir(),'source-privacy-'));
 try {
  mkdirSync(join(dir,'scripts'));
  copyFileSync(join(root,'scripts/check-privacy.mjs'),join(dir,'scripts/check-privacy.mjs'));
  mkdirSync(join(dir,'fixtures'));
  writeFileSync(join(dir,'fixtures','activation-timing-corpus.json'),JSON.stringify({synthetic:true}));
  const run=()=>spawnSync(process.execPath,[join(dir,'scripts/check-privacy.mjs')],{encoding:'utf8'});
  assert.equal(run().status,0,'Portable synthetic corpus must remain publishable');
  for(const name of artifacts)writeFileSync(join(dir,'fixtures',name),JSON.stringify({content:'operator-only-sentinel'}));
  const checked=run();
  assert.equal(checked.status,1);
  const report=JSON.parse(checked.stderr);
  assert.deepEqual(report.findings.map(x=>x.file).sort(),artifacts.map(x=>'fixtures/'+x).sort());
  assert.ok(report.findings.every(x=>x.rule==='private-artifact'));
  assert.ok(!checked.stderr.includes('operator-only-sentinel'));
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('git ignores experience ledgers at any depth while keeping the neutral corpus',()=>{
 const dir=mkdtempSync(join(tmpdir(),'source-ignore-'));
 try {
  copyFileSync(join(root,'.gitignore'),join(dir,'.gitignore'));
  const initialized=spawnSync('git',['init','--quiet'],{cwd:dir,encoding:'utf8'});
  assert.equal(initialized.status,0,initialized.stderr);
  const paths=artifacts.flatMap(name=>[name,'nested/'+name]);
  const result=spawnSync('git',['check-ignore','--no-index','--stdin'],{cwd:dir,input:[...paths,'packages/mnemo/fixtures/activation-timing-corpus.json'].join('\n')+'\n',encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n').sort(),paths.sort());
 } finally {rmSync(dir,{recursive:true,force:true});}
});
