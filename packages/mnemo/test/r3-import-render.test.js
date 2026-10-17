import test from 'node:test'
import assert from 'node:assert/strict'
import { renderItem, estimateTokens } from '../lib/inject.js'
import {presentRecall} from '../lib/recall-presentation.js'

test('import envelope does not displace the body in brief injection, while provenance remains', () => {
  const text='[Codex历史笔记；现状待核验；历史授权不代表本次授权]\n项目分组：'+('historical-project-path/'.repeat(12))+'\nBackups require checksum verification before retention rotation.'
  const item={id:'fixture',text,scope:'p',source:'agent',trust:'unverified',touches:0,evidence:[{source:'codex-memory-import',lineStart:10,lineEnd:10}]}
  const out=renderItem(item,1,{topicCoverage:.25})
  assert.ok(out.text.includes('Backups require checksum'))
  assert.ok(out.text.includes('historical')&&out.text.includes('authorization=not-granted'))
  assert.ok(out.text.includes('partial-query-match'))
  assert.ok(out.text.includes('agent/unverified')&&out.text.includes('scope=p'))
  assert.ok(out.tokens<=300&&out.tokens===estimateTokens(out.text))
  assert.equal(item.text,text)
  const normal=renderItem({...item,evidence:[]},1)
  assert.ok(normal.text.includes('Codex历史笔记'))
  assert.ok(!normal.text.includes('Backups require'))
})

test('conclusion recall excerpts the imported body, and raw view keeps the exact source',()=>{
 const text='[Codex历史笔记；现状待核验；历史授权不代表本次授权]\n项目分组：'+('project-path/'.repeat(30))+'\nBackups require checksum verification.'
 const item={id:'recall-fixture',text,scope:'p',source:'agent',trust:'unverified',activeSeq:1,evidence:[{source:'codex-memory-import'}]}
 const engine={log:{items:new Map([[item.id,item]]),proposals:new Map()}}
 const hits=[{id:item.id,score:.8,parts:{topic:.25}}]
 const view=presentRecall(engine,hits,{scope:'p'})[0].text
 assert.ok(view.includes('Backups require checksum'))
 assert.ok(view.includes('历史授权不代表本次授权'))
 assert.ok(view.includes('部分匹配'))
 assert.ok(view.includes('unverified')&&view.includes('version=1'))
 assert.ok(presentRecall(engine,hits,{scope:'p',view:'raw'})[0].text.endsWith(text))
 assert.equal(item.text,text)
})
