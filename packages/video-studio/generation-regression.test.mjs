import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createEngine} from './generation.js';
import {defaultProfile} from './model-registry.js';
import {createVideoTools} from './channel-relay.js';

const mp4=Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]);

test('invalid unused Vidu Q4 profile does not block selected Seedance generation',async()=>{
  let rows=[],posts=0;
  const config={baseUrl:'https://fixture.invalid',generatePath:'/v1/videos/generations',editPath:'/v1/videos/generations',queryPath:'/v1/videos/generations/{id}',useImageKey:true,enabledModels:['seedance-2-5','viduq4-preview'],defaultModel:'seedance-2-5',modelProfiles:{
    'seedance-2-5':{...defaultProfile('seedance-2-5'),useDefaultKey:true},
    'viduq4-preview':{...defaultProfile('viduq4-preview'),baseUrl:'https://fixture.invalid',useDefaultKey:true}
  }};
  const engine=createEngine({readTasks:async()=>rows,writeTasks:async x=>rows=structuredClone(x),getConfig:async()=>config,getKey:async()=> 'fixture-key',getImages:async()=>[],readImage:async()=>Buffer.alloc(0),saveImage:async(bytes,type)=>({id:'video',type,path:'/tmp/video.mp4'}),pollMs:5,fetchResult:async(url)=>{
    if(url==='https://example.invalid/result.mp4')return new Response(mp4,{headers:{'content-type':'video/mp4'}});
    throw Error('unexpected download '+url);
  },fetchImpl:async(url,opts={})=>{
    if(opts.method==='POST'){posts++;return Response.json({id:'remote',status:'completed',progress:100,result:{data:[{url:'https://example.invalid/result.mp4'}]}})}
    return Response.json({id:'remote',status:'completed',progress:100,result:{data:[{url:'https://example.invalid/result.mp4'}]}});
  }});
  await engine.start();
  try{
    await engine.submit({requestId:randomUUID(),model:'seedance-2-5',prompt:'animate',duration:5});
    for(let i=0;i<100&&engine.list()[0]?.status!=='completed';i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(engine.list()[0].status,'completed');
    assert.equal(posts,1);
  }finally{await engine.stop()}
});


test('identity preservation prompt points Agent to video reference list',async()=>{
 const tools=createVideoTools({engine:{list:()=>[]},relay:{summary:()=>({})},submit:async()=>{throw Error('no submit')},inbound:{list:async()=>[]},getImageTasks:async()=>[],selectionConfig:{enabledModels:['seedance-2-5'],defaultModel:'seedance-2-5'}});
 const gen=tools.find(t=>t.name==='generate_video');
 await assert.rejects(gen.execute({prompt:'保留人物和原图姿势做一个视频'},{agent:{id:'s'}}),/list_video_reference_images/);
});
