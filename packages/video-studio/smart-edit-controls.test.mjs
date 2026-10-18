import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

// Render the real component with inert hooks; no browser or provider calls.
const built=await build({entryPoints:[new URL('./mcp-controls.jsx',import.meta.url).pathname],bundle:true,write:false,format:'cjs',platform:'node',external:['react'],jsx:'transform'});
const jsx=(type,props,...children)=>({type,props:{...props,children}});
const react={createElement:jsx,useState:value=>[value,()=>{}],useEffect(){}};
const module={exports:{}};
vm.runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,require:name=>{assert.equal(name,'react');return react}});
const {McpControls}=module.exports;
function select(options,referenceAssets){const root=McpControls({spec:{mcp:{declaration:{}},workrally:{mode:'SmartEdit'}},options,referenceAssets,update(){}});let found;function visit(node){if(!node||typeof node!=='object')return;if(node.type==='select'&&node.props['aria-label']==='WorkRally 编辑源视频')found=node;for(const child of node.props?.children||[])for(const item of [child].flat(Infinity))visit(item)}visit(root);return found;}
const assets=[{id:'image',type:'image/png'},{id:'audio',type:'audio/wav'},{id:'first',name:'First video',type:'video/mp4'},{id:'second',type:'video/webm'},{id:'unused',type:'video/mp4'}];
for(const representation of ['referenceIds','refs'])test('SmartEdit filters '+representation+' to selected videos and preserves explicit second source',()=>{
 const options={extra:{sourceVideoId:'second'},[representation]:representation==='refs'?assets.slice(0,4).map(a=>({id:a.id,role:'reference'})):assets.slice(0,4).map(a=>a.id)};
 const control=select(options,assets);
 assert.deepEqual(Array.from(control.props.children.flat(Infinity),o=>o.props.value),['','first','second']);
 assert.equal(control.props.value,'second');
 options.extra.sourceVideoId='image';assert.equal(select(options,assets).props.value,'');
});
test('SmartEdit accepts typed refs and excludes unknown IDs when metadata is unavailable',()=>{
 const control=select({refs:[...assets,{id:'unknown'}],extra:{sourceVideoId:'first'}});
 assert.equal(control.props.value,'first');
 assert.deepEqual(Array.from(control.props.children.flat(Infinity),o=>o.props.value),['','first','second','unused']);
});
