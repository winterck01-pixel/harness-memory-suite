import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {projectKlingConnector} from './kling-settings.js';

const entry=(overrides={})=>({id:'include:kling-ai-remote',disabled:false,options:{name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'Plugin-DeepSeek-kling-ai',url:'https://klingai.com/mcp',headers:{Authorization:'Bearer private-fixture'}}},fiber:{state:2},...overrides});
const tools=ready=>({get:name=>ready&&name==='mcp__Plugin-DeepSeek-kling-ai__who_am_i'?{name,metadata:{private:'fixture'}}:undefined});
const project=(entries,ready)=>projectKlingConnector({loader:{entries:()=>entries},get:()=>tools(ready)});

test('Kling readiness distinguishes missing, mismatched, disabled, and tool-missing loader states',()=>{
 assert.equal(project([],true).runtimePhase,'missing');
 assert.equal(project([entry({options:{name:'wrong-module',config:{serverName:'Plugin-DeepSeek-kling-ai'}}})],true).runtimePhase,'mismatch');
 assert.equal(project([entry({disabled:true})],true).runtimePhase,'disabled');
 assert.equal(project([{...entry(),id:'kling-ai-remote'}],true).runtimePhase,'missing','loader inventory IDs include the include: prefix');
 const pending=project([entry()],false);
 assert.equal(pending.runtimePhase,'tool-missing');assert.equal(pending.enabled,true);assert.equal(pending.toolReady,false);
 const ready=project([entry()],true);
 assert.equal(ready.runtimePhase,'active');assert.equal(ready.toolReady,true);
});

test('Kling projection is a strict non-secret allowlist',()=>{
 const value=project([entry()],true),json=JSON.stringify(value);
 assert.deepEqual(Object.keys(value).sort(),['authorizationManagedBy','description','enabled','endpointHost','id','notes','runtimePhase','sourceLabel','toolReady','type','uploadEnabled'].sort());
 assert.equal(value.id,'kling');assert.equal(value.endpointHost,'klingai.com');
 assert.doesNotMatch(json,/private-fixture|Authorization|https:\/\/klingai\.com\/mcp|Plugin-DeepSeek-kling-ai/);
});

test('MCP settings are absent from global and studio settings',async()=>{
 const client=await readFile(new URL('./client.js',import.meta.url),'utf8');
 assert.doesNotMatch(client,/settings\.section|sidebar\.settings|openSection|dsh:open-mcp-settings/);
 for(const kind of ['image','video']){
  const studio=await readFile(new URL(`../${kind}-studio/client.jsx`,import.meta.url),'utf8');
  assert.doesNotMatch(studio,/McpSettings|dsh:open-mcp-settings/);
 }
 for(const value of ['remote-connections.services','provider==="workrally"?"workrally/":"mcp/"','call(ctx,"discover",{})','call(ctx,"selection"'])assert.ok(client.includes(value));
});

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function makeReact(){
 const React={Fragment:Symbol('Fragment'),createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
  useState(initial){const i=this.index++;if(!(i in this.hooks.state))this.hooks.state[i]=typeof initial==='function'?initial():initial;return [this.hooks.state[i],value=>{this.hooks.state[i]=typeof value==='function'?value(this.hooks.state[i]):value}]},
  useRef(initial){const i=this.index++;return this.hooks.refs[i]??(this.hooks.refs[i]={current:initial})},
  useCallback(fn){this.index++;return fn},
  useEffect(fn,deps){const i=this.index++,old=this.hooks.effects[i],same=old&&deps?.length===old.deps?.length&&deps.every((v,j)=>Object.is(v,old.deps[j]));if(!same)this.pending.push({i,fn,deps})},
  index:0,hooks:{state:[],refs:[],effects:[]},pending:[]};return React;
}
function renderer(component,props,React){
 function render(){React.index=0;React.pending=[];const tree=component(props);for(const item of React.pending){React.hooks.effects[item.i]?.cleanup?.();React.hooks.effects[item.i]={deps:item.deps,cleanup:item.fn()};}return tree;}
 return {render};
}
function walk(tree,visit){if(Array.isArray(tree)){for(const item of tree)walk(item,visit);return;}if(!tree||typeof tree!=='object')return;visit(tree);walk(tree.children,visit);}
function find(tree,predicate){let found;walk(tree,node=>{if(!found&&predicate(node))found=node});return found;}
async function settle(render){for(let i=0;i<5;i++){await new Promise(resolve=>setImmediate(resolve));render();}}

test('only the mobile MCP service slot registers provider settings UI',async()=>{
 const original=await readFile(new URL('./client.js',import.meta.url),'utf8');
 const React=makeReact();let exports;const registrations=[];
 const window={__ModuleLoader__:{load(module){exports=module.factory(name=>name==='react'?React:undefined)}}};
 const document={getElementById:()=>null,createElement:()=>({}),head:{appendChild(){}}};
 vm.runInNewContext(original,{window,document,fetch:async()=>({ok:true,json:async()=>({})}),AbortController,AbortSignal,Event,URL,console,Map,Set,Promise,JSON,Error});
 exports.apply({slots:{inject(_name,fn){return fn()},register(options,component){registrations.push({options,component});return()=>{}}}});
 assert.deepEqual(registrations.map(r=>r.options.name),['remote-connections.services','main']);
 assert.ok(registrations.every(r=>r.component===exports.RemoteLinksPanel));
});

test('unified picker behavior routes per provider and kind, preserves the other provider, blocks unsupported choices, and ignores stale discovery',async()=>{
 const original=await readFile(new URL('./client.js',import.meta.url),'utf8');
 const client=original.replace('return {name:"dsh-remote-links",inject:["slots"],apply,RemoteLinksPanel};','return {name:"dsh-remote-links",inject:["slots"],apply,RemoteLinksPanel,ProviderModelSettings};');
 assert.notEqual(client,original,'test must expose the actual bundled picker component');
 const React=makeReact();let exports;const calls=[],configByKind={
  image:{enabledModels:['mcp:cn:image-old','mcp:workrally:image-old'],mcpModels:[{id:'mcp:cn:image-old',displayName:'Kling old',mcp:{available:true}},{id:'mcp:workrally:image-old',displayName:'Foreign WorkRally model',available:true}]},
  video:{enabledModels:['mcp:cn:video-old','mcp:workrally:video-old'],mcpModels:[{id:'mcp:cn:video-old',displayName:'Kling video',mcp:{available:true}}]}
 };
 let deferredPath=null,pending=null;
 const imageAvailable={id:'mcp:workrally:image:new',displayName:'WorkRally image',available:true};
 const klingAvailable={id:'mcp:cn:image:new',displayName:'Kling image',mcp:{available:true}};
 const unsupported={id:'mcp:workrally:video:unsupported:edit',displayName:'WorkRally edit',available:false,unsupportedCapabilities:[{capability:'video_edit_providers',reason:'当前工坊尚未实现源视频编辑绑定'}]};
 const fetch=async(url,options={})=>{
  calls.push({url,options,body:options.body?JSON.parse(options.body):undefined});
  if(deferredPath&&url.endsWith(deferredPath)){pending=deferred();return pending.promise;}
  const routes=new Set(['/api/image-studio/config','/api/video-studio/config',...['image','video'].flatMap(kind=>['mcp/status','mcp/discover','mcp/selection','workrally/status','workrally/discover','workrally/selection'].map(path=>`/api/${kind}-studio/${path}`))]);
  assert.ok(routes.has(url),'unexpected API URL: '+url);
  let body={};
  if(url.endsWith('/workrally/status'))body={installed:true,models:[imageAvailable,unsupported,klingAvailable]};
  else if(url.endsWith('/workrally/discover'))body={models:[imageAvailable],mcpModels:[imageAvailable,unsupported,klingAvailable]};
  else if(url.endsWith('/workrally/selection')){configByKind[url.includes('/image-studio/')?'image':'video'].enabledModels=[...configByKind[url.includes('/image-studio/')?'image':'video'].enabledModels.filter(id=>!id.startsWith('mcp:workrally:')),...JSON.parse(options.body).enabledModels];body={saved:true};}
  else if(url.endsWith('/mcp/discover'))body={models:[klingAvailable],mcpModels:[klingAvailable,imageAvailable]};
  else if(url.endsWith('/mcp/selection')){configByKind[url.includes('/image-studio/')?'image':'video'].enabledModels=[...configByKind[url.includes('/image-studio/')?'image':'video'].enabledModels.filter(id=>!id.startsWith('mcp:cn:')),...JSON.parse(options.body).enabledModels];body={saved:true};}
  else if(url.endsWith('/mcp/status'))body={installed:true,models:[]};
  else if(url==='/api/image-studio/config')body=configByKind.image;
  else if(url==='/api/video-studio/config')body=configByKind.video;
  return {ok:true,json:async()=>body};
 };
 const listeners=new Map(),window={__ModuleLoader__:{load(module){exports=module.factory(name=>name==='react'?React:undefined)}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),dispatchEvent:()=>true};
 const document={getElementById:()=>null,createElement:()=>({}),head:{appendChild(){}}};
 vm.runInNewContext(client,{window,document,fetch,AbortController,AbortSignal,Event,URL,console,Map,Set,Promise,JSON,Error});
 let view=renderer(exports.ProviderModelSettings,{initialProvider:'kling',initialKind:'image',onChanged:async()=>{}},React);let tree=view.render();await settle(view.render);tree=view.render();
 assert.ok(calls.some(call=>call.url==='/api/image-studio/mcp/status'));
 assert.ok(calls.some(call=>call.url==='/api/image-studio/config'));
 assert.ok(!calls.some(call=>call.url==='/api/image-studio/workrally/config'));
 assert.equal(JSON.stringify(tree).includes('Foreign WorkRally model'),false,'Kling initial config must exclude the merged WorkRally catalog');
 assert.equal(find(tree,node=>node.props?.['aria-label']==='MCP 服务商'),undefined,'a provider-owned panel cannot switch provider');
 let discoverButton=find(tree,node=>node.type==='button'&&node.children.includes('读取可灵可用模型'));assert.ok(discoverButton);discoverButton.props.onClick();await settle(view.render);tree=view.render();
 assert.equal(JSON.stringify(tree).includes('WorkRally image'),false,'Kling discovery must exclude foreign-provider models');
 let enabledBox=find(tree,node=>node.type==='input'&&node.props.type==='checkbox'&&!node.props.disabled&&!node.props.checked);enabledBox.props.onChange({target:{checked:true}});tree=view.render();
 let saveButton=find(tree,node=>node.type==='button'&&node.children.includes('保存可灵模型选择'));saveButton.props.onClick();await settle(view.render);tree=view.render();
 const klingSelection=calls.findLast(call=>call.url==='/api/image-studio/mcp/selection');assert.deepEqual(klingSelection.body,{enabledModels:['mcp:cn:image:new'],makeDefault:false});assert.ok(configByKind.image.enabledModels.includes('mcp:workrally:image-old'),'Kling save must preserve the WorkRally selection');
 for(const effect of React.hooks.effects)effect?.cleanup?.();React.hooks={state:[],refs:[],effects:[]};
 view=renderer(exports.ProviderModelSettings,{initialProvider:'workrally',initialKind:'image',onChanged:async()=>{}},React);tree=view.render();await settle(view.render);tree=view.render();
 assert.equal(JSON.stringify(tree).includes('Kling image'),false,'WorkRally status must exclude foreign-provider models');
 assert.ok(calls.some(call=>call.url==='/api/image-studio/workrally/status'));
 discoverButton=find(tree,node=>node.type==='button'&&node.children.includes('读取WorkRally可用模型'));assert.ok(discoverButton);discoverButton.props.onClick();await settle(view.render);tree=view.render();
 assert.ok(find(tree,node=>node.props?.className==='dsh-rl-model-unsupported'));
 const unsupportedBox=find(tree,node=>node.type==='input'&&node.props.type==='checkbox'&&node.props.disabled);assert.ok(unsupportedBox);
 assert.ok(JSON.stringify(tree).includes('当前工坊尚未实现源视频编辑绑定'));
 enabledBox=find(tree,node=>node.type==='input'&&node.props.type==='checkbox'&&!node.props.disabled&&!node.props.checked);assert.ok(enabledBox);enabledBox.props.onChange({target:{checked:true}});tree=view.render();
 const defaultBox=find(tree,node=>node.props?.className==='dsh-rl-kling-default')?.children?.find(node=>node.type==='input');assert.ok(defaultBox);defaultBox.props.onChange({target:{checked:true}});tree=view.render();
 saveButton=find(tree,node=>node.type==='button'&&node.children.includes('保存WorkRally模型选择'));saveButton.props.onClick();await settle(view.render);tree=view.render();
 const selection=calls.findLast(call=>call.url==='/api/image-studio/workrally/selection');assert.deepEqual(selection.body,{enabledModels:['mcp:workrally:image:new'],makeDefault:true});
 assert.ok(configByKind.image.enabledModels.includes('mcp:cn:image:new'),'WorkRally save must preserve the Kling selection');

 // A provider/kind switch aborts the old discovery; even a fetch mock that ignores abort cannot apply its late response.
 deferredPath='/api/image-studio/workrally/discover';discoverButton=find(tree,node=>node.type==='button'&&node.children.includes('读取WorkRally可用模型'));discoverButton.props.onClick();await Promise.resolve();
 tree=view.render();const videoTab=find(tree,node=>node.props?.role==='tab'&&node.children.includes('视频模型'));videoTab.props.onClick();tree=view.render();await settle(view.render);tree=view.render();
 pending.resolve({ok:true,json:async()=>({models:[{id:'mcp:workrally:late',displayName:'Late stale model',available:true}],mcpModels:[{id:'mcp:workrally:late',displayName:'Late stale model',available:true}]})});await settle(view.render);tree=view.render();
 assert.ok(calls.some(call=>call.url==='/api/video-studio/workrally/status'));
 assert.ok(calls.some(call=>call.url==='/api/video-studio/config'));
 assert.ok(!calls.some(call=>call.url==='/api/video-studio/workrally/config'));
 assert.equal(find(tree,node=>node.children?.includes('Late stale model')),undefined);
 assert.ok(find(tree,node=>node.props?.className==='dsh-rl-kling-panel'));
});

test('mobile cards keep separate provider pickers, connector editing, and Kling icon',async()=>{
 const original=await readFile(new URL('./client.js',import.meta.url),'utf8');
 const client=original.replace('return {name:"dsh-remote-links",inject:["slots"],apply,RemoteLinksPanel};','return {name:"dsh-remote-links",inject:["slots"],apply,RemoteLinksPanel,ProviderModelSettings,ConnectorSettings,Brand};');
 const React=makeReact();let exports;
 const known=new Set(['/api/remote-links/state','/api/video-studio/workrally/status','/api/video-studio/config']);
 const fetch=async url=>{assert.ok(known.has(url),'unexpected API URL: '+url);return {ok:true,json:async()=>url==='/api/remote-links/state'?{connections:{kling:{id:'kling',type:'kling-mcp',enabled:false,runtimePhase:'disabled'},workrally:{id:'workrally',type:'workrally-mcp',enabled:true,runtimePhase:'active',description:'协同',sourceLabel:'Harness',endpointHost:'workrally.qq.com'}}}:url.endsWith('/workrally/status')?{installed:true,models:[]}:{enabledModels:[],mcpModels:[]}}};
 const window={__ModuleLoader__:{load(module){exports=module.factory(name=>name==='react'?React:undefined)}},addEventListener(){},removeEventListener(){},dispatchEvent(){return true}};
 const document={getElementById:()=>null,createElement:()=>({}),head:{appendChild(){}}};vm.runInNewContext(client,{window,document,fetch,AbortController,AbortSignal,Event,URL,console,Map,Set,Promise,JSON,Error});
 const view=renderer(exports.RemoteLinksPanel,{},React);let tree=view.render();await settle(view.render);tree=view.render();
 const kling=find(tree,node=>node.type==='button'&&node.props?.['aria-label']==='可灵 MCP模型设置');assert.ok(kling);
 kling.props.onClick();tree=view.render();assert.equal(find(tree,node=>node.type===exports.ProviderModelSettings).props.initialProvider,'kling');
 const brand=exports.Brand({c:{id:'kling'}});const icon=find(brand,node=>node.type==='img');assert.ok(icon);assert.match(icon.props.src,/^data:image\/x-icon;base64,/);
 const settings=find(tree,node=>node.type==='button'&&node.props?.['aria-label']==='WorkRally连接设置');
 const model=find(tree,node=>node.type==='button'&&node.props?.['aria-label']==='WorkRally 模型设置');assert.ok(settings);assert.ok(model);
 model.props.onClick();tree=view.render();const picker=find(tree,node=>node.type===exports.ProviderModelSettings);assert.equal(picker.props.initialProvider,'workrally');assert.equal(picker.props.initialKind,'video');
 settings.props.onClick();tree=view.render();const editor=find(tree,node=>node.type===exports.ConnectorSettings);assert.equal(editor.props.id,'workrally');
});

test('Kling remains read-only in remote-links and WorkRally editing route remains registered',async()=>{
 const source=await readFile(new URL('./index-settings-v5.js',import.meta.url),'utf8');
 const service=await readFile(new URL('./settings.js',import.meta.url),'utf8');
 assert.match(source,/projectKlingConnector/);assert.match(source,/connections\.kling\s*=/);
 assert.match(service,/\['baidu-netdisk','workrally'\]/);assert.doesNotMatch(service,/save\(['"]kling/);
});

test('Kling card authorization starts asynchronously and opens only its local authenticated launch route',async()=>{
 const original=await readFile(new URL('./client.js',import.meta.url),'utf8');
 const client=original.replace('apply,RemoteLinksPanel};','apply,RemoteLinksPanel,KlingAuthorization};');
 const React=makeReact();let exports,status='disabled';const calls=[];
 const fetch=async(url,options={})=>{calls.push({url,method:options.method||'GET'});if(url.endsWith('/start')){status='waiting';return {ok:true,json:async()=>({accepted:true})}}assert.ok(url.endsWith('/status'));return {ok:true,json:async()=>({status,...(status==='waiting'?{authorizePath:'/api/remote-links/kling-auth/open',expiresAt:999999}:{})})}};
 const window={__ModuleLoader__:{load(module){exports=module.factory(name=>name==='react'?React:undefined)}},location:{origin:'http://fixture'}};
 const document={getElementById:()=>null,createElement:()=>({}),head:{appendChild(){}}};
 vm.runInNewContext(client,{window,document,fetch,setTimeout:()=>1,clearTimeout(){},navigator:{clipboard:{writeText:async()=>{}}},AbortController,AbortSignal,Event,URL,console,Map,Set,Promise,JSON,Error});
 const view=renderer(exports.KlingAuthorization,{runtimePhase:'disabled',onChanged:async()=>{}},React);view.render();await settle(view.render);let tree=view.render();
 const button=find(tree,n=>n.type==='button'&&n.children.includes('启用并授权'));assert.ok(button);button.props.onClick();await settle(view.render);tree=view.render();
 const link=find(tree,n=>n.type==='a');assert.ok(link);assert.equal(link.props.href,'/api/remote-links/kling-auth/open');assert.equal(link.props.rel,'noopener noreferrer');assert.ok(calls.some(c=>c.url.endsWith('/start')&&c.method==='POST'));assert.ok(calls.every(c=>c.url.startsWith('/api/remote-links/kling-auth/')));
});

test('each service owns its inline drawer and action buttons share a compact row',async()=>{
 const source=await readFile(new URL('./client.js',import.meta.url),'utf8'),React=makeReact();let exports;
 const window={__ModuleLoader__:{load(module){exports=module.factory(name=>name==='react'?React:undefined)}}},document={getElementById:()=>null,createElement:()=>({}),head:{appendChild(){}}};
 const data={connections:Object.fromEntries(['baidu-netdisk','workrally','kling'].map(id=>[id,{id,runtimePhase:'active',toolReady:true}]))};
 vm.runInNewContext(source,{window,document,fetch:async()=>({ok:true,json:async()=>data}),AbortController,AbortSignal,Event,URL,console,Map,Set,Promise,JSON,Error});
 const view=renderer(exports.RemoteLinksPanel,{},React);view.render();await settle(view.render);let tree=view.render();
 const services=()=>{const list=find(tree,n=>n.props.className==='dsh-rl-list');return list.children;};
 let rows=services();assert.equal(rows.length,3);
 find(rows[0],n=>n.props['aria-label']==='百度网盘连接设置').props.onClick();tree=view.render();rows=services();assert.equal(rows[0].children[1].props.id,'baidu-netdisk');assert.equal(Boolean(rows[2].children[1]),false);
 find(rows[1],n=>n.props['aria-label']==='WorkRally 模型设置').props.onClick();tree=view.render();rows=services();assert.equal(rows[1].children[2].props.initialProvider,'workrally');assert.equal(Boolean(rows[0].children[1]),false);
 const buttons=find(rows[1],n=>n.props.className==='dsh-rl-action-buttons');assert.equal(buttons.children.filter(n=>n?.type==='button').length,2);
 assert.match(source,/dsh-rl-action-buttons\{display:flex;gap:5px;align-items:center/);
 assert.doesNotMatch(source,/button,\.dsh-rl summary\{font:inherit/);
});
