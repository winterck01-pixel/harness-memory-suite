import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createServerAssembly} from '../server-assembly.js';
test('1K, 2K and 4K files occupy identical target canvas pixels without changing source dimensions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'generation-size-')),host=createServerAssembly({rootDir:root});try{await host.ready;const p=await host.projects.createProject({name:'Synthetic',width:1280,height:720}),canvasId=p.canvas.id;
 let revision=0;for(const width of [1024,2048,4096]){const height=width/16*9,asset=await host.assets.register({name:'Synthetic '+width,bytes:await sharp({create:{width,height,channels:4,background:'#4b99cc'}}).png().toBuffer()});
 const id=randomUUID(),result=await host.projects.submitCommands(canvasId,{expectedRevision:revision,commands:[{id,canvasId,baseRevision:revision,type:'applyGeneratedResult',payload:{candidateId:randomUUID(),layerId:randomUUID(),asset,targetRect:{x:100,y:200,width:320,height:180}},createdAt:Date.now()}]});revision=result.newRevision;const doc=await host.projects.getCanvas(canvasId),layer=doc.layers.at(-1),[a,,,d,x,y]=layer.matrix;assert.equal(asset.width,width);assert.equal(asset.height,height);assert.deepEqual([a*width,d*height,x,y],[320,180,100,200]);}
 }finally{await host.dispose();await rm(root,{recursive:true,force:true})}
});
