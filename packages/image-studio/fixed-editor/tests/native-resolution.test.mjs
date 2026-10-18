// Synthetic declarations and preparation only: never submit or upload.
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeParameterSchema} from '../native-schema.js';
import {createMcpRuntime} from '../../../video-studio/mcp-runtime.js';
import {specsFromIdentity,mcpProfile} from '../../../video-studio/mcp-capabilities.js';
for(const alias of ['resolution','img_resolution','image_resolution','video_resolution'])test(alias+' stays canonical and reaches the declared MCP field once',async()=>{
 const identity={user:{userId:'fixture-account'},availableModels:{text_to_image:[{model:'fixture-image',arguments:[{name:'prompt',required:true},{name:alias,default:'1K',allowedValues:['1K','2K','4K']},{name:'style',default:'plain',allowedValues:['plain']}],inputs:[]}]}};
 const spec=specsFromIdentity(identity)[0],schema=nativeParameterSchema(spec);
 assert.equal(schema.properties[alias],undefined,'resolution must not also become an advanced default');
 assert.equal(schema.properties.style.default,'plain');
 const calls=[],runtime=createMcpRuntime({getTools:()=>({get:()=>({parameters:{}}),execute:async c=>{calls.push(c.name);assert.ok(c.name.endsWith('who_am_i'));return {structuredContent:identity}}})});
 const extra=Object.fromEntries(Object.entries(schema.properties).filter(([,field])=>field.default!==undefined).map(([name,field])=>[name,field.default]));
 const prepared=await runtime.prepare({prompt:'synthetic',resolution:'2K',extra},mcpProfile(spec),[],()=>{throw Error('no upload allowed')});
 assert.deepEqual(prepared.payload.arguments.filter(a=>a.name===alias),[{name:alias,value:'2K'}]);
 assert.equal(prepared.payload.arguments.filter(a=>a.name==='resolution'||a.name.endsWith('_resolution')).length,1);
 assert.equal(calls.length,1);
});
