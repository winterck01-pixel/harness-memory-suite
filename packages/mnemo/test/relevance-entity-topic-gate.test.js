import {test} from 'node:test'
import assert from 'node:assert/strict'
import {retrieve, signalScore} from '../lib/retrieve.js'

const entity = 'lumen'
const row = (id, text, label = 'Lumen') => ({
 id, text, entities: [entity], cues: [], source: 'human', trust: 'confirmed',
 evidence: label ? [{source: 'codex-memory-import', sourceProjectLabel: label}] : [],
})
const records = [
 row('render', 'Lumen rendering requires preserving the alpha channel.'),
 row('billing', 'Lumen invoice reconciliation records the original currency.'),
]
const find = (text, candidates = records, extra = {}) => retrieve({
 text, entities: [entity], candidates, priorOf: () => 1, ...extra,
}).map(x => x.item.id)

test('shared project entity cannot admit query-only-project or wrong-topic records', () => {
 assert.deepEqual(find('Lumen'), [])
 assert.deepEqual(find('Lumen listener port'), [])
 assert.deepEqual(find('Lumen alpha rendering'), ['render'])
 assert.deepEqual(find('Lumen invoice currency'), ['billing'])
})

test('ordinary entity subjects without project provenance retain exact and alias recall', () => {
 for (const [entity, text, query] of [
  ['ssd', '外置 USB4 SSD 必备', 'SSD 该怎么配'],
  ['ffi', 'DemoStudio 的 FFI 调用必须在 UI 线程外做', 'FFI 那块怎么改？'],
  ['davinci', '达芬奇免费版支持脚本批量渲染', 'DaVinci 能批量出片吗'],
 ]) {
  const candidate = {id:entity, text, entities:[entity], cues:[]}
  assert.deepEqual(retrieve({text:query, entities:[entity], candidates:[candidate]}).map(x=>x.item.id), [entity])
 }
})

test('Chinese entity aliases bridge identity only when independent content matches', () => {
 assert.deepEqual(find('流明'), [])
 assert.deepEqual(find('流明 监听端口'), [])
 assert.deepEqual(find('流明 渲染透明通道'), ['render'])
 assert.deepEqual(find('流明 发票币种'), ['billing'])
 assert.ok(signalScore({text:'流明 渲染', entities:[entity], item:records[0]}).parts.signal > .17)
})

test('cue-only precise identifiers retain explicit recall without project-only injection', () => {
 const candidate = {...row('identifier', 'Reconciliation uses record_nonce_782.', ''), cues:['record_nonce_782']}
 assert.deepEqual(find('', [candidate], {entities:[], cues:['record_nonce_782']}), ['identifier'])
 assert.deepEqual(find('', [records[0]], {cues:['lumen']}), [])
})
