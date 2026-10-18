// Synthetic declarations only. These tests never contact an MCP host or submit generation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build,transform} from 'esbuild';
import {specsFromIdentity,adoptMcpModels} from './mcp-capabilities.js';
import {readMcpCatalog,writeMcpCatalog} from './mcp-runtime.js';
import {videoDefaults} from './model-capabilities.js';
import {chatOptions} from './chat-mode.js';

async function imagePackageEntry(importer){
 const sibling=new URL('../image-studio/package.json',importer);
 let manifest;
 try{manifest=JSON.parse(await readFile(sibling,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(manifest?.name==='dsh-image-studio')return new URL('./index.js',sibling);
 return pathToFileURL(createRequire(importer).resolve('dsh-image-studio'));
}
const imageEntry=await imagePackageEntry(import.meta.url);
const {registerMcpModels}=await import(new URL('./model-registry.js',imageEntry));
const imageRegistry=fileURLToPath(new URL('./model-registry.js',imageEntry));

const declaration=(model='synthetic-video')=>({model,arguments:[{name:'prompt',required:true},{name:'duration',allowedValues:['5','10'],default:'5'},{name:'aspect_ratio',allowedValues:['16:9','9:16'],default:'9:16'},{name:'resolution',allowedValues:['720p','1080p'],default:'1080p'},{name:'camera',allowedValues:['fixed','moving'],default:'fixed'}],inputs:[]});
const identity=(tool='text_to_video',model='synthetic-video',account='synthetic-account')=>({user:{userId:account},availableModels:{[tool]:[declaration(model)]}});
const fixtureSpec=()=>specsFromIdentity(identity())[0];

test('synthetic identity keeps exact declared model IDs, values and defaults',()=>{
 const spec=fixtureSpec();
 assert.equal(spec.id,'mcp:cn:text_to_video:synthetic-video');
 assert.deepEqual(spec.durations,[5,10]);
 assert.deepEqual(spec.ratios,['16:9','9:16']);
 assert.deepEqual(spec.sizes,['720p','1080p']);
 assert.deepEqual(spec.defaults,{duration:5,aspectRatio:'9:16',resolution:'1080p'});
 assert.deepEqual(spec.mcp.declaration.arguments.at(-1),declaration().arguments.at(-1));
});

test('synthetic disk catalog preserves retired model declaration as unavailable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mcp-catalog-audit-'));
 try{
  await writeMcpCatalog(root,identity('text_to_video','old-model'));
  await writeMcpCatalog(root,identity('text_to_video','new-model','new-account'));
  const rows=await readMcpCatalog(root);
  assert.equal(rows.length,2);
  assert.equal(rows.find(x=>x.providerModel==='old-model').mcp.available,false);
  assert.equal(rows.find(x=>x.providerModel==='new-model').mcp.accountId,'new-account');
 }finally{await rm(root,{recursive:true,force:true})}
});

test('authoritative registry refresh removes absent MCP models and preserves static entries',()=>{
 const staticSpec={id:'static',kind:'video'},catalog=[staticSpec],ids=['static'];
 const spec=fixtureSpec();adoptMcpModels(catalog,ids,[spec],'video');
 adoptMcpModels(catalog,ids,undefined,'video');
 assert.equal(catalog.length,2,'ordinary task/library responses without mcpModels are not snapshots');
 adoptMcpModels(catalog,ids,[],'video');
 assert.deepEqual(catalog.map(x=>x.id),[staticSpec.id]);
 assert.deepEqual(ids,['static']);
});

test('MCP video defaults expose the resolution declared by the account',()=>{
 assert.equal(videoDefaults(fixtureSpec()).resolution,'1080p');
});

test('reference-only MCP chat chooses its declared mode for one mentioned reference',()=>{
 const who=identity('omni_ref_video');
 who.availableModels.omni_ref_video[0].inputs=[{name:'image_1',required:true}];
 const spec=specsFromIdentity(who)[0];
 assert.equal(chatOptions(spec,{},1).generationMode,'reference');
});

async function component(name){
 const source=await readFile(new URL(name,import.meta.url),'utf8');
 const bundled=await build({stdin:{contents:source,resolveDir:dirname(fileURLToPath(new URL(name,import.meta.url))),loader:'jsx'},bundle:true,write:false,format:'esm',external:['react']});const compiled={code:bundled.outputFiles[0].text};
 const hookKey='__mcpCatalogAuditHooks'+Math.random().toString(36).slice(2);
 const hooks={values:[],index:0,useState(initial){const index=this.index++;if(!(index in this.values))this.values[index]=typeof initial==='function'?initial():initial;return [this.values[index],value=>{this.values[index]=typeof value==='function'?value(this.values[index]):value}]},useEffect(){},createElement(type,props,...children){return {type,props:{...props,children}}}};
 globalThis[hookKey]=hooks;
 const react=`data:text/javascript,${encodeURIComponent(`const h=globalThis.${hookKey};export const useState=h.useState.bind(h),useEffect=h.useEffect.bind(h),useRef=(v)=>({current:v});export default {createElement:h.createElement.bind(h)};`)}`;
 const code=compiled.code.replace(/from "react"/g,`from ${JSON.stringify(react)}`);
 const module=await import('data:text/javascript;base64,'+Buffer.from(code+'\n//# sourceURL=mcp-catalog-'+name).toString('base64')+'#'+name+'-'+Math.random());
 return {render(props){hooks.index=0;return module[name.includes('settings')?'McpSettings':'McpControls'](props)},hooks};
}
function elements(tree){return !tree||typeof tree!=='object'?[]:[tree,...(tree.props?.children||[]).flat(Infinity).flatMap(elements)]}

test('McpControls exposes arbitrary declared enum and explicit reference-slot controls',async()=>{
 const {render}=await component('mcp-controls.jsx'),spec=fixtureSpec();
 spec.mcp.declaration.inputs=[{name:'image_1',required:true}];
 let change;
 const tree=render({spec,options:{extra:{},referenceIds:['ref-1']},update:(name,value)=>change={name,value},busy:false});
 const rows=elements(tree),camera=rows.find(x=>x.props?.['aria-label']==='可灵参数 camera');
 assert.ok(camera);
 assert.equal(camera.props.value,'fixed','enum control shows the declared default');
 assert.ok(rows.find(x=>x.props?.['aria-label']==='参考素材槽位 1'));
 camera.props.onChange({target:{value:'moving'}});
 assert.deepEqual(change,{name:'extra',value:{camera:'moving'}});
});

for(const kind of ['image','video'])test('studio '+kind+' settings no longer own MCP settings navigation',async()=>{
 const source=await readFile(new URL(`../${kind}-studio/client.jsx`,import.meta.url),'utf8');
 assert.doesNotMatch(source,/McpSettings|dsh:open-mcp-settings/);
 const retired=await readFile(new URL('mcp-settings.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(retired,/dispatchEvent|fetch\(|function McpSettings/);
});

test('independent browser bundles resolve the same MCP image model after their config hydration',async()=>{
 const entry=`export {registerMcpModels,modelSpec} from ${JSON.stringify(imageRegistry)};`;
 const bundle=async nonce=>{
  const result=await build({stdin:{contents:entry,resolveDir:dirname(imageRegistry)},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text+'\n//# sourceURL=synthetic-bundle-'+nonce+'.mjs').toString('base64')+'#'+nonce);
 };
 const a=await bundle('image-studio-a'),b=await bundle('image-workshop-b');
 const spec=specsFromIdentity(identity('text_to_image','synthetic-image'))[0];
 a.registerMcpModels([spec]);
 b.registerMcpModels([structuredClone(spec)]);
 assert.equal(b.modelSpec(spec.id).providerModel,a.modelSpec(spec.id).providerModel);
 a.registerMcpModels([]);
 assert.equal(b.modelSpec(spec.id).providerModel,'synthetic-image','separate bundle cache must hydrate from its own API response');
});


test('MCP image drafts use declared defaults and required enumerations without changing ordinary drafts',async()=>{
 const {normalizeImageMcpDraft,ratiosFor,sizeForRatio}=await import(new URL('./image-parameters.js',imageEntry));
 const spec=specsFromIdentity(identity('text_to_image','synthetic-default-image'))[0];
 registerMcpModels([spec]);
 const normalized=normalizeImageMcpDraft({model:spec.id,prompt:'keep',referenceIds:['ref']});
 assert.equal(normalized.aspectRatio,'9:16');assert.equal(normalized.resolution,'1080p');assert.equal(normalized.size,'auto');
 assert.equal(normalizeImageMcpDraft({model:spec.id,aspectRatio:'auto',resolution:''}).aspectRatio,'9:16','legacy auto draft resolves to the declared default shown in the form');
 assert.equal(normalized.prompt,'keep');assert.deepEqual(normalized.referenceIds,['ref']);
 assert.equal(sizeForRatio(spec.id,'arbitrary-provider-value','1080p'),'auto');
 const valid=normalizeImageMcpDraft({...normalized,aspectRatio:'16:9',resolution:'720p'});
 assert.equal(valid.aspectRatio,'16:9');assert.equal(valid.resolution,'720p');
 for(const a of spec.mcp.declaration.arguments)if(['aspect_ratio','resolution'].includes(a.name)){delete a.default;a.required=true;}
 registerMcpModels([spec]);
 const required=normalizeImageMcpDraft({model:spec.id,aspectRatio:'auto',resolution:'retired'});
 assert.equal(required.aspectRatio,'16:9');assert.equal(required.resolution,'720p');
 assert.deepEqual(ratiosFor(spec.id),['16:9','9:16']);
 const ordinary={model:'fixture',aspectRatio:'auto',resolution:''};assert.equal(normalizeImageMcpDraft(ordinary,{mcp:null}),ordinary);
});

test('image audit resolves sibling sources before external dependencies and falls back for installed packages',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'image-audit-resolution-')));
 try{
  const candidate=join(root,'candidate'),external=join(root,'external','node_modules'),installed=join(external,'dsh-image-studio'),sibling=join(candidate,'image-studio');
  await mkdir(join(candidate,'video-studio'),{recursive:true});await mkdir(installed,{recursive:true});await mkdir(sibling,{recursive:true});
  await symlink(external,join(candidate,'node_modules'),'dir');
  for(const [directory,marker]of [[installed,'installed'],[sibling,'sibling']]){
   await writeFile(join(directory,'package.json'),JSON.stringify({name:'dsh-image-studio',type:'module',main:'index.js'}));
   await writeFile(join(directory,'index.js'),'export {};');
   for(const name of ['generation.js','model-registry.js'])await writeFile(join(directory,name),`export const source=${JSON.stringify(marker)};`);
  }
  const importer=pathToFileURL(join(candidate,'video-studio','audit.test.mjs'));
  const assertSource=async expected=>{
   const entry=await imagePackageEntry(importer);
   assert.equal(entry.href,pathToFileURL(join(expected==='sibling'?sibling:installed,'index.js')).href);
   for(const name of ['generation.js','model-registry.js'])assert.equal((await import(new URL('./'+name,entry))).source,expected);
  };
  await assertSource('sibling');
  await writeFile(join(sibling,'package.json'),JSON.stringify({name:'unrelated-package'}));
  await assertSource('installed');
  await rm(sibling,{recursive:true,force:true});
  await assertSource('installed');
 }finally{await rm(root,{recursive:true,force:true});}
});
