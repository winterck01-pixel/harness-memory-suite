import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
test('media setup writes portable disabled defaults without overwriting private output',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'media-config-')),out=join(dir,'config.json');const env={...process.env,HOME:dir};delete env.DSH_REMOTE_CONNECTIONS_PATH;delete env.BAIDU_MCP_URL;delete env.WORKRALLY_MCP_TOKEN;
 const args=['scripts/write-media-host-config.mjs','--plugins-root',resolve('packages'),'--out',out];
 try{const result=spawnSync(process.execPath,args,{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);const rows=JSON.parse(await readFile(out));assert.equal(rows.length,11);assert.ok(rows.filter(r=>r.name==='@deepseek-ai/dsh-mcp-client').every(r=>r.disabled===true));assert.equal((await stat(out)).mode&0o777,0o600);const content=await readFile(out,'utf8');assert.equal(spawnSync(process.execPath,args,{env,encoding:'utf8'}).status,1);assert.equal(await readFile(out,'utf8'),content)}finally{await rm(dir,{recursive:true,force:true})}
});
test('media setup merges Baidu into an existing provider inventory',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'media-config-')),out=join(dir,'config.json'),connections=join(dir,'.dsh','remote-connections.json');
 const env={...process.env,HOME:dir,DSH_REMOTE_CONNECTIONS_PATH:connections};delete env.BAIDU_MCP_URL;delete env.WORKRALLY_MCP_TOKEN;
 const existing={version:1,connections:{other:{enabled:true,endpoint:{url:'https://example.invalid'},credential:'fixture-only'}}};
 try{
  await mkdir(join(dir,'.dsh'));await writeFile(connections,JSON.stringify(existing));
  const result=spawnSync(process.execPath,['scripts/write-media-host-config.mjs','--plugins-root',resolve('packages'),'--out',out],{env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const merged=JSON.parse(await readFile(connections,'utf8'));
  assert.equal(merged.version,existing.version);assert.deepEqual(merged.connections.other,existing.connections.other);
  assert.deepEqual(merged.connections['baidu-netdisk'],{enabled:false,type:'baidu-netdisk-mcp',endpoint:{sseUrl:''},upload:{enabled:false}});
  assert.equal((await stat(connections)).mode&0o777,0o600);
  const rows=JSON.parse(await readFile(out,'utf8'));assert.equal(rows.find(row=>row.id==='mcp-baidu-netdisk').disabled,true);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('media setup preserves existing Baidu credentials and settings verbatim',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'media-config-')),out=join(dir,'config.json'),connections=join(dir,'.dsh','remote-connections.json');
 const env={...process.env,HOME:dir,DSH_REMOTE_CONNECTIONS_PATH:connections,BAIDU_MCP_URL:'invalid-should-not-replace-existing'};delete env.WORKRALLY_MCP_TOKEN;
 const existing={connections:{other:{enabled:false},'baidu-netdisk':{enabled:true,type:'baidu-netdisk-mcp',endpoint:{sseUrl:'https://example.invalid/fixture-token'},upload:{enabled:true,program:'/fixture/upload'},custom:'preserve'}}},content=JSON.stringify(existing)+'\n';
 try{
  await mkdir(join(dir,'.dsh'));await writeFile(connections,content,{mode:0o600});
  const result=spawnSync(process.execPath,['scripts/write-media-host-config.mjs','--plugins-root',resolve('packages'),'--out',out,'--upload-program','/fixture/replacement'],{env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(await readFile(connections,'utf8'),content);
  const rows=JSON.parse(await readFile(out,'utf8'));assert.equal(rows.find(row=>row.id==='mcp-baidu-netdisk').disabled,false);assert.equal(rows.find(row=>row.id==='mcp-baidu-netdisk-upload').disabled,false);
 }finally{await rm(dir,{recursive:true,force:true})}
});
