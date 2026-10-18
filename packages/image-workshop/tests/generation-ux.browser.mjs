import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {compileWorkspaceStyles} from '../workspace-styles.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),source=await readFile(root+'client.jsx','utf8');
const app=`
import {createRoot} from 'react-dom/client';
import {GenerationPanel} from './fixed-editor/src/components/GenerationPanel.jsx';
import {CanvasGeneration} from './fixed-editor/src/components/CanvasGeneration.jsx';
const model={id:'fixture-model',name:'Fixture Image',family:'fixture',adapter:'workrallyMcp',ratios:['16:9'],sizes:['1','2','3'],quality:['auto'],n:[1],parameterSchema:{properties:{}},workrally:{resolutionOptions:[{value:1,label:'1K'},{value:2,label:'2K'},{value:3,label:'4K'}]}};
const initial={canvas:{id:'canvas',width:1280,height:720},layers:[],assets:[],models:[model],targetRect:{x:120,y:60,width:320,height:180},targetAspectRatio:'16:9',selection:[],viewport:{zoom:.5},generationBatches:[{batch:{id:'batch',canvasId:'canvas',createdAt:1,targetRect:{x:120,y:60,width:320,height:180}},tasks:[{taskId:'task',model:'fixture-model',status:'polling'}],candidates:[]}]};
const listeners=new Set();let snapshot=initial;window.fixture={submitted:[],replays:[]};
const store={subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},getSnapshot:()=>snapshot,setTargetAspectRatio(){},setNotice(){},clearSelection(){snapshot={...snapshot,selection:[]};for(const fn of listeners)fn()},adapter:{costPreview:async()=>({estimates:[]})},submitGeneration:async r=>{window.fixture.submitted.push(r);return'new-batch'},regenerateTask:async(id,model)=>window.fixture.replays.push({id,model})};
window.fixture.state=status=>{snapshot={...initial,generationBatches:[{...initial.generationBatches[0],tasks:[{taskId:'task',model:'fixture-model',status,candidates:status==='completed'?[{id:'asset',applied:true,appliedLayerId:'layer'}]:[]}]}],...(status==='completed'?{selection:['layer'],layers:[{id:'layer',assetId:'asset',visible:true,matrix:[.15625,0,0,.15625,120,60]}],assets:[{id:'asset',width:2048,height:1152}]}:{})};for(const fn of listeners)fn()};
const references={prompt:'Synthetic prompt',setPrompt(){},mentions:[],setMentions(){},manualIds:[],setManualIds(){},resolved:{ids:[],mentions:[],error:null},active:false};
function Overlay(){const state=React.useSyncExternalStore(store.subscribe,store.getSnapshot);return <div className="iw-fixed-editor"><div style={{transform:'scale(.5)',transformOrigin:'top left',position:'relative',width:1280,height:720}}><CanvasGeneration store={store} state={state} layers={state.layers}/></div></div>}
const mode=new URL(location.href).searchParams.get('mode');createRoot(document.getElementById('root')).render(mode==='legacy'?<LegacyImageWorkshop/>:mode==='panel'?<FixedEditorProvider store={store}><GenerationPanel referenceDraft={references} targetRectMode={false} setTargetRectMode={()=>{}}/></FixedEditorProvider>:<Overlay/>);
`;
const bundle=await build({stdin:{contents:source+app,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'iife',loader:{'.css':'text'},logLevel:'silent'});
const css=await compileWorkspaceStyles(await readFile(root+'fixed-editor/src/styles.css','utf8'),'editor');
async function fixture(mode,run){
 const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<style>'+css+'</style><div id="root"></div><script>'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.WORKSHOP_CHROMIUM_EXECUTABLE?{executablePath:process.env.WORKSHOP_CHROMIUM_EXECUTABLE}:{})});
 try{const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({json:path.endsWith('/config')?{enabledModels:['gpt-image-1'],modelProfiles:{}}:path.endsWith('/library')?{images:[],models:['gpt-image-1'],defaultModel:'gpt-image-1'}:{tasks:[]}})});
 await page.goto('http://127.0.0.1:'+server.address().port+'/?mode='+mode);await run(page);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r))}
}
test('real legacy prompt retains native multiline clipboard, long clipboard and typing',()=>fixture('legacy',async page=>{
 const input=page.getByLabel('编辑图片提示词');await input.waitFor();await page.waitForTimeout(500);
 for(const text of ['中文粘贴\nfixture','多行提示词 @image1。\n'.repeat(2500)]){await input.fill('');await input.focus();await page.evaluate(text=>navigator.clipboard.writeText(text),text);await page.keyboard.press('ControlOrMeta+V');await page.waitForTimeout(80);assert.equal(await input.inputValue(),text)}
 await input.fill('');await input.pressSequentially('abc');assert.equal(await input.inputValue(),'abc');
}));
test('provider resolution label sends its native value and frozen target remains separate',()=>fixture('panel',async page=>{
 await page.getByRole('button',{name:'选择模型 · 可多选'}).click();await page.getByLabel('选择模型 fixture-model',{exact:true}).check();await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByLabel('fixture-model 清晰度').selectOption({label:'2K'});await page.getByTestId('gen-submit').click();const sent=await page.evaluate(()=>window.fixture.submitted[0]);assert.equal(sent.params['fixture-model'].resolution,'2');assert.equal(sent.params['fixture-model'].aspectRatio,'16:9');
}));
test('canvas placeholder shows dolphin at frozen region; failed and selected-image retry buttons replay source',()=>fixture('overlay',async page=>{
 const frame=page.getByTestId('generation-placeholder');await frame.waitFor();assert.equal(await page.getByRole('img',{name:'正在游动的像素海豚'}).count(),1);const box=await frame.boundingBox();assert.equal(box.width,160);assert.equal(box.height,90);
 await page.evaluate(()=>window.fixture.state('failed'));await frame.click();await page.getByRole('button',{name:'重新生成',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.fixture.replays),[{id:'batch',model:'fixture-model'}]);
 await page.evaluate(()=>window.fixture.state('completed'));assert.equal(await frame.count(),0);await page.getByRole('button',{name:'重新生成',exact:true}).click();assert.equal(await page.evaluate(()=>window.fixture.replays.length),2);
}));
