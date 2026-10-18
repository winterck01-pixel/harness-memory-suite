import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const raw=process.env.WORKSHOP_UNSCOPED_REPRO==='1';
const editorRaw=await readFile(new URL('../fixed-editor/src/styles.css',import.meta.url),'utf8');
const legacyRaw=await readFile(new URL('../style.css',import.meta.url),'utf8');
const compile=raw?async value=>value:(await import('../workspace-styles.mjs')).compileWorkspaceStyles;
const editor=await compile(editorRaw,'editor'),legacy=await compile(legacyRaw,'legacy');
for(const width of [1280,800])test('workspace round trips preserve canvas and host layout at '+width,async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.WORKSHOP_CHROMIUM_EXECUTABLE?{executablePath:process.env.WORKSHOP_CHROMIUM_EXECUTABLE}:{})});
 try{const page=await browser.newPage({viewport:{width,height:900}});
 await page.setContent('<button id="host">Host</button><input id="hostInput"><div class="iw-fixed-editor" style="height:600px"><div class="iw-app"><header class="iw-topbar"><div class="iw-brand"><strong>图片工坊</strong><small>固定画布编辑器</small></div><span class="iw-project-name">Synthetic long project name for narrow viewport</span><div class="iw-topbar-actions"><button>撤销</button><button>重做</button><button>导出可见合成</button><button id="back">← 返回项目列表</button></div></header><div class="iw-tabs">Tabs</div><div class="iw-body"><div class="iw-toolbar">Tools</div><div class="iw-stage"><div class="iw-canvas" style="width:320px;height:90px"><img class="iw-layer-img" style="width:640px;height:180px"></div></div><div class="iw-right-panel">Panel</div></div></div></div><main class="iw" style="display:none"><div class="iw-body"><div class="iw-canvas">Legacy</div></div></main><section class="dsh-history-preview"><div class="iw-detail-stage">Preview</div></section>');
 const host=()=>page.locator('#host').evaluate(e=>({font:getComputedStyle(e).font,border:getComputedStyle(e).border,box:getComputedStyle(e).boxSizing}));
 const originalHost=await host();await page.addStyleTag({content:editor});
 const snapshot=()=>page.locator('.iw-fixed-editor').evaluate(e=>Object.fromEntries(['.iw-body','.iw-canvas','.iw-layer-img','.iw-tabs'].map(s=>{const n=e.querySelector(s),c=getComputedStyle(n),b=n.getBoundingClientRect();return[s,{display:c.display,direction:c.flexDirection,position:c.position,minHeight:c.minHeight,maxWidth:c.maxWidth,width:b.width,height:b.height}]})));
 const before=await snapshot();
 await page.locator('.iw').evaluate((e,css)=>{const s=document.createElement('style');s.textContent=css;e.appendChild(s)},legacy);
 for(let n=0;n<3;n++){
  await page.locator('.iw-fixed-editor').evaluate(e=>e.style.display='none');await page.locator('.iw').evaluate(e=>e.style.display='block');
  assert.equal(await page.locator('.iw > .iw-body').evaluate(e=>getComputedStyle(e).display),width<=850?'flex':'grid');
  await page.locator('.iw').evaluate(e=>e.style.display='none');await page.locator('.iw-fixed-editor').evaluate(e=>e.style.display='block');
  assert.deepEqual(await snapshot(),before,'hidden legacy CSS must not change editor geometry');
 }
 assert.equal(await page.locator('#back').evaluate(e=>{const r=e.getBoundingClientRect(),p=e.closest('.iw-fixed-editor').getBoundingClientRect();return r.right<=p.right&&r.left>=p.left}),true,'home button stays inside the workspace');
 assert.deepEqual(await host(),originalHost,'editor CSS must not change host controls');
 assert.equal(await page.locator('.iw-detail-stage').evaluate(e=>getComputedStyle(e).position),'relative','portaled previews retain their styles');
 }finally{await browser.close()}
});
