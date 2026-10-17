import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Injector,renderItem,renderCard,estimateTokens} from '../lib/inject.js'
import {MemoryEngine} from '../lib/engine.js'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const item={id:'record-1',text:'中文证据'.repeat(150),touches:100,trust:'confirmed',source:'human',scope:'project:test'}
test('rendered item accounting includes metadata and all detail levels',()=>{
 for(const touches of [0,100])for(const r of [0.1,0.9]){const out=renderItem({...item,touches},r);assert.equal(out.tokens,estimateTokens(out.text));assert.ok(out.text.includes('record-1'));assert.ok(out.text.includes('project:test'))}
})
test('card hard budget includes Chinese and ellipsis',()=>{const out=renderCard({recent:['中文'.repeat(100)],vaguely:['中文'.repeat(100)]},{CARD_HARD_MAX:20});assert.ok(estimateTokens(out.text)<=20)})
test('both injection paths count complete payload and preserve evidence boundary',()=>{
 for(const method of ['compose','snapshot'])for(const cap of [10,80,240]){const i=new Injector({CARD:cap,WM:0,RECALL:0});const o=i[method]({card:{text:'中文'.repeat(500),tokens:1},items:[{item,r:0.8}],force:true});assert.equal(o.tokens,estimateTokens(o.payload));assert.ok(o.tokens<=cap);if(o.payload)assert.ok(o.payload.includes(Injector.DISCLAIMER))}
})
test('staging counters do not change rendered memory snapshot',()=>{const dir=mkdtempSync(join(tmpdir(),'mnemo-context-'));try{const e=new MemoryEngine({dir});e.start();e.remember({...item});const a=e._renderCard({scope:item.scope}).text;e.postTurn({text:'new unrelated staging entry',scope:item.scope});const b=e._renderCard({scope:item.scope}).text;assert.equal(a,b);assert.ok(!b.includes('记忆引擎'));assert.match(b, /id=[^;]+; source=human; status=reported; scope=project:test/)}finally{rmSync(dir,{recursive:true,force:true})}})

test('budget-excluded memories remain eligible on the next incremental turn',()=>{
 const i=new Injector({CARD:200,WM:0,RECALL:0},{minIntervalMin:0})
 const hit={item:{...item,text:'short evidence'},r:0.9}
 const first=i.compose({card:{text:'中'.repeat(190)},items:[hit],now:1000})
 assert.ok(!first.blocks.some(b=>b.section==='wm'))
 const second=i.compose({items:[hit],now:2000})
 assert.ok(second.blocks.some(b=>b.section==='wm'))
 assert.equal(i.compose({items:[hit],now:3000}).shouldEmit,false)
})
test('zero budget emits nothing and never marks unsent card',()=>{
 const cfg={CARD:0,WM:0,RECALL:0};const i=new Injector(cfg,{minIntervalMin:0})
 assert.equal(i.compose({card:{text:'证据'},now:1000}).payload,'')
 assert.equal(i.lastCardHash,null)
 cfg.CARD=200
 assert.ok(i.compose({card:{text:'证据'},now:2000}).shouldEmit)
})

test('template escaping is included in the final payload budget',()=>{
 for(const method of ['compose','snapshot']){
  const i=new Injector({CARD:100,WM:0,RECALL:0})
  const o=i[method]({card:{text:'{{'.repeat(120)},force:true})
  assert.ok(!o.payload.includes('{{'))
  assert.equal(o.tokens,estimateTokens(o.payload))
  assert.ok(o.tokens<=100)
 }
})
