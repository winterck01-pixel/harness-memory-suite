import test from 'node:test';import assert from 'node:assert/strict';import {readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {startPreview} from './server.mjs';import {run,probe} from '../media.js';
test('HTTP integration: origin, revision, import, audio, crop, export and ranges',async()=>{const app=await startPreview();const call=async(path,b,headers={})=>{const r=await fetch(app.url+'/api/live-film/'+path,{...(b?{method:'POST',body:JSON.stringify(b),headers:{'Content-Type':'application/json',...headers}}:{headers})});return r};const json=async(path,b)=>{const r=await call(path,b);assert.equal(r.status,200,await r.clone().text());return r.json()};try{
 assert.equal((await call('project',{op:'createProject'},{Origin:'http://evil.invalid'})).status,403);
 let p=await json('project',{op:'createProject',name:'HTTP smoke'});p=await json('project',{op:'addShot',projectId:p.id,revision:p.revision,name:'片段',duration:2,generationDuration:4,model:'seedance-2-5'});const id=p.shots[0].id;
 assert.equal((await call('project',{op:'renameProject',projectId:p.id,revision:0,name:'冲突'})).status,409);
 const bytes=await readFile(join(app.dir,'sample.mp4'));const imported=await json('import',{name:'导入视频',type:'video/mp4',data:bytes.toString('base64')});assert.equal(imported.duration,10);
 p=await json('attach',{projectId:p.id,revision:p.revision,shotId:id,assetId:imported.id});p=await json('project',{op:'adopt',projectId:p.id,revision:p.revision,shotId:id,candidateId:p.shots[0].candidates[0].id,trimIn:2});
 const audioFile=join(app.dir,'audio.wav');await run('ffmpeg',['-y','-v','error','-i',join(app.dir,'sample.mp4'),'-vn',audioFile]);const audio=await json('import',{name:'背景音',type:'audio/wav',data:(await readFile(audioFile)).toString('base64')});p=await json('audio',{projectId:p.id,revision:p.revision,assetId:audio.id,volume:0.3});
 assert.equal((await call('export',{projectId:p.id,revision:-1})).status,409);const submissions=await Promise.all([call('export',{projectId:p.id,revision:p.revision}),call('export',{projectId:p.id,revision:p.revision})]);assert.deepEqual(submissions.map(r=>r.status).sort(),[200,400]);const e=await submissions.find(r=>r.status===200).json();let result;for(let i=0;i<150;i++){result=(await json('state')).exports.find(x=>x.id===e.id);if(result.status!=='running')break;await new Promise(ok=>setTimeout(ok,100))}assert.equal(result.status,'completed',result.error);assert.equal(result.path,undefined);
 const output=await probe(join(app.dir,'live-film','export-'+e.id,'movie.mp4'));assert.ok(Math.abs(output.duration-2)<0.2);assert.equal(output.hasAudio,true);assert.equal(output.hasVideo,true);
 const range=await call('export?id='+e.id,undefined,{Range:'bytes=0-31'});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,32);assert.equal((await call('asset?id='+imported.id,undefined,{Range:'bytes=999999999-'})).status,416);
 const thumb=await call('thumbnail?id='+imported.id);assert.equal(thumb.status,200);assert.equal(thumb.headers.get('content-type'),'image/jpeg');await thumb.arrayBuffer();assert.equal(app.remote.length,0);
 console.log('Real ffmpeg crop + audio mix + export checked; provider submissions: 0');
}finally{await app.stop();await rm(app.dir,{recursive:true,force:true})}});


test('MP4 export is the primary UI action and duplicate image composer is not exposed',async()=>{
 const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../client.jsx',import.meta.url),'utf8'));
 assert.match(source,/导出成片 MP4/);
 assert.match(source,/format:'mp4'/);
 assert.equal(source.includes('<ImageComposer'),false);
 assert.equal(source.includes('setComposeImage'),false);
});
