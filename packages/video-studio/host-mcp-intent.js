// Server-only, process-local authority. No origin/intent is serializable or
// reconstructed from an HTTP field, task snapshot, request ID or Agent claim.
const sharedKey=Symbol.for('deepseek.workshop.host-mcp-intent.v1');
if(!globalThis[sharedKey])Object.defineProperty(globalThis,sharedKey,{value:{origins:new WeakMap(),intents:new WeakMap()}});
const {origins,intents}=globalThis[sharedKey];
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const PROFILE=['adapter','baseUrl','serverName','modelName','accountId','corpId','isEnterprise','tool','mode','canvasProjectId','shortSeriesProjectId'];
const INPUT=['model','prompt','n','referenceIds','generationMode','referenceMode','duration','resolution','quality','aspectRatio','extra','draft','draftTaskId'];
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
const fingerprint=request=>canonical({id:request.requestId??request.id,...pick(request,INPUT)});
const profileFingerprint=profile=>canonical(pick(profile,PROFILE));
const denied=()=>Object.assign(Error('本次工坊操作缺少有效的界面业务意图；未自动重新提交'),{code:'HOST_MCP_INTENT_REQUIRED'});
const submitName=profile=>profile.adapter==='workrallyMcp'?'mcp__workrally__'+profile.tool:profile.adapter==='klingMcp'?'mcp__Plugin-DeepSeek-kling-ai__'+profile.tool:'';
const SUBMIT=new Set(['mcp__workrally__canvas_generate_image','mcp__workrally__canvas_generate_video',...['text_to_image','image_to_image','text_to_video','image_to_video','omni_ref_video','motion_control'].map(name=>'mcp__Plugin-DeepSeek-kling-ai__'+name)]);
export function createHostMcpUiOrigin(studio){if(!['image-studio','video-studio','live-film'].includes(studio))throw denied();const origin=Object.freeze(Object.create(null));origins.set(origin,{studio});return origin;}
export function createHostMcpIntent({origin,task,execution}={}){
 if(execution!==undefined||!origins.has(origin)||!task||typeof task.id!=='string'||!task.id||!SUBMIT.has(submitName(task.config)))throw denied();
 const tool=submitName(task.config),image=tool.endsWith('canvas_generate_image')||tool.endsWith('text_to_image')||tool.endsWith('image_to_image');if((origins.get(origin).studio==='image-studio')!==image)throw denied();
 const intent=Object.freeze(Object.create(null));intents.set(intent,{state:'created',input:fingerprint(task),profile:profileFingerprint(task.config),tool:submitName(task.config),referenceIds:[...(task.referenceIds||[])],counts:{},attempted:false});return intent;
}
export function beginHostMcpPreparation(intent,{request,profile,refs}={}){
 const entry=intents.get(intent);if(!entry||entry.state!=='created'||entry.input!==fingerprint(request)||entry.profile!==profileFingerprint(profile)||canonical(entry.referenceIds)!==canonical((refs||[]).map(ref=>ref.id)))throw denied();entry.state='preparing';
}
export function sealHostMcpPreparation(intent,{profile,tool,payload}={}){
 const entry=intents.get(intent);if(!entry||entry.state!=='preparing'||entry.profile!==profileFingerprint(profile)||tool!==entry.tool)throw denied();entry.payload=canonical(payload);entry.state='prepared';
}
export function authorizeHostMcpIntentCall(intent,{name,arguments:args}={}){
 const entry=intents.get(intent);if(!entry||['closed','failed'].includes(entry.state))return false;
 if(SUBMIT.has(name)){
  if(entry.state!=='prepared'||entry.attempted||name!==entry.tool||entry.payload!==canonical(args))return false;
  // Consume before transport/policy/provider dispatch. Denied/unknown attempts
  // never gain a fresh submission permission by retrying the same object.
  entry.attempted=true;entry.state='attempted';return true;
 }
 if(entry.state!=='preparing')return false;
 const group=name==='mcp__workrally__get_upload_token'?'ticket':name==='mcp__workrally__asset_create'?'asset':name==='mcp__Plugin-DeepSeek-kling-ai__file_upload'?'upload':null;
 if(name.startsWith('mcp__workrally__')!==entry.tool.startsWith('mcp__workrally__'))return false;
 if(!group||!entry.referenceIds.length||(entry.counts[group]||0)>=entry.referenceIds.length)return false;
 entry.counts[group]=(entry.counts[group]||0)+1;return true;
}
export function failHostMcpIntent(intent){const entry=intents.get(intent);if(entry)entry.state='failed';}
export function closeHostMcpIntent(intent){const entry=intents.get(intent);if(entry){entry.state='closed';delete entry.payload;delete entry.input;delete entry.profile;intents.delete(intent);}}
