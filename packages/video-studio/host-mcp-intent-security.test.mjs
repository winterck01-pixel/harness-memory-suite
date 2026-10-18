import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostMcpUiOrigin,createHostMcpIntent,beginHostMcpPreparation,sealHostMcpPreparation,authorizeHostMcpIntentCall,closeHostMcpIntent} from './host-mcp-intent.js';
const workrally='mcp__workrally__canvas_generate_image';
const profile={adapter:'workrallyMcp',baseUrl:'https://fixture.invalid',serverName:'workrally',modelName:'image',tool:'canvas_generate_image',mode:'image',accountId:'user',corpId:'corp',isEnterprise:true};
const task=()=>({id:'fixture-task',model:'fixture-model',prompt:'fixture',n:1,referenceIds:['ref'],extra:{},config:{...profile}});
function preparing(){const t=task(),intent=createHostMcpIntent({origin:createHostMcpUiOrigin('image-studio'),task:t});beginHostMcpPreparation(intent,{request:t,profile:t.config,refs:[{id:'ref'}]});return {t,intent};}
test('security: JSON origins/intents and agent claims cannot mint or carry UI authority',()=>{
 const origin=createHostMcpUiOrigin('image-studio'),t=task();
 assert.throws(()=>createHostMcpIntent({origin:JSON.parse(JSON.stringify(origin)),task:t}),/意图/);
 assert.throws(()=>createHostMcpIntent({origin,task:t,execution:{agent:{session:{id:'claimed'}}}}),/意图/);
 const intent=createHostMcpIntent({origin,task:t});
 assert.throws(()=>beginHostMcpPreparation(JSON.parse(JSON.stringify(intent)),{request:t,profile:t.config,refs:[{id:'ref'}]}),/意图/);
 assert.equal(authorizeHostMcpIntentCall(undefined,{name:workrally,arguments:{}}),false);closeHostMcpIntent(intent);
});
test('security: a reference intent cannot authorize another provider upload',()=>{
 const {intent}=preparing();
 try{assert.equal(authorizeHostMcpIntentCall(intent,{name:'mcp__Plugin-DeepSeek-kling-ai__file_upload',arguments:{}}),false)}finally{closeHostMcpIntent(intent)}
});
test('security: studio origin cannot mint a different media kind intent',()=>{
 const t=task();t.config={...t.config,tool:'canvas_generate_video',mode:'Text'};
 assert.throws(()=>createHostMcpIntent({origin:createHostMcpUiOrigin('image-studio'),task:t}),/意图/);
});
test('security: submission is exact and single-attempt, including closed/replayed intent objects',()=>{
 const {t,intent}=preparing(),payload={model:'image',prompt:'fixture',count:1};
 sealHostMcpPreparation(intent,{profile:t.config,tool:workrally,payload});
 assert.equal(authorizeHostMcpIntentCall(intent,{name:workrally,arguments:{...payload,prompt:'changed'}}),false);
 assert.equal(authorizeHostMcpIntentCall(intent,{name:workrally,arguments:payload}),true);
 assert.equal(authorizeHostMcpIntentCall(intent,{name:workrally,arguments:payload}),false);
 closeHostMcpIntent(intent);
 assert.equal(authorizeHostMcpIntentCall(intent,{name:workrally,arguments:payload}),false);
 assert.throws(()=>beginHostMcpPreparation(intent,{request:t,profile:t.config,refs:[{id:'ref'}]}),/意图/);
});
test('security: separately loaded module copies share opaque authority without serializing it',async()=>{
 const second=await import('./host-mcp-intent.js?independent-module-copy');
 const t=task(),origin=createHostMcpUiOrigin('image-studio'),intent=second.createHostMcpIntent({origin,task:t});
 try{beginHostMcpPreparation(intent,{request:t,profile:t.config,refs:[{id:'ref'}]});assert.equal(second.authorizeHostMcpIntentCall(intent,{name:'mcp__workrally__get_upload_token',arguments:{file_ext:'png'}}),true)}finally{closeHostMcpIntent(intent)}
});
test('security: configured project defaults and references remain bound to the UI intent',()=>{
 const t=task();t.config.shortSeriesProjectId='original-series';
 const intent=createHostMcpIntent({origin:createHostMcpUiOrigin('image-studio'),task:t});
 try{
  assert.throws(()=>beginHostMcpPreparation(intent,{request:t,profile:{...t.config,shortSeriesProjectId:'changed-series'},refs:[{id:'ref'}]}),/意图/);
  assert.throws(()=>beginHostMcpPreparation(intent,{request:t,profile:t.config,refs:[{id:'other-ref'}]}),/意图/);
  beginHostMcpPreparation(intent,{request:t,profile:t.config,refs:[{id:'ref'}]});
 }finally{closeHostMcpIntent(intent)}
});
