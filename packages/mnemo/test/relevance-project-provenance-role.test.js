import {test} from 'node:test'
import assert from 'node:assert/strict'
import {retrieve} from '../lib/retrieve.js'

const row = (label, entity, body = 'Telescope optics require collimation.') => ({
 id:'optics', text:body, entities:[entity], cues:[],
 evidence:[{source:'codex-memory-import', sourceProjectLabel:label}],
})
const find = (item, text, entities = item.entities) => retrieve({
 text, entities, candidates:[item], priorOf:()=>1,
}).map(x=>x.item.id)

test('explicit project provenance gates entity-only and unrelated topics across label scripts and case', () => {
 for (const [label, entity] of [
  ['北辰天文台','北辰天文台'],
  ['solstice observatory','solstice'],
  ['Solstice Observatory','solstice'],
  ['sOlStIcE observatory','SOLSTICE'],
  ['Ｓｏｌｓｔｉｃｅ observatory','solstice'],
  ['مرصد القمر','مرصد القمر'],
  ['обсерватория','обсерватория'],
  ['/workspace/projects/solstice-observatory','solstice'],
  ['solstice_observatory operations','solstice'],
 ]) {
  const item=row(label,entity)
  for (const query of [entity, `${entity} invoice currency`, `${entity} 发票币种`]) {
   assert.deepEqual(find(item,query), [], `${label}: ${query}`)
   assert.deepEqual(find(item,query,[]), [], `${label}: no supplied entities: ${query}`)
  }
  assert.deepEqual(find(item,`${entity} telescope optics`), ['optics'], label)
 }
})

test('project role follows literal provenance rather than semantic aliases or substring coincidences', () => {
 for (const [label,entity,text,query] of [
  ['Orchard observatory','hard','Use resilient disks.','hard'],
  ['Nimbus workstation','ssd','外置 USB4 SSD 必备','SSD 该怎么配'],
  ['Nimbus workstation','ffi','FFI 调用必须在 UI 线程外做','FFI 那块怎么改？'],
  ['Nimbus production','davinci','达芬奇免费版支持脚本批量渲染','DaVinci 能批量出片吗'],
 ]) assert.deepEqual(find(row(label,entity,text),query), ['optics'], entity)
})

test('project role does not rely on topic vocabulary and independent literal topics still admit', () => {
 const item=row('juniper laboratory','juniper','Calibration uses spectrograph_nonce_913.')
 assert.deepEqual(find(item,'juniper'), [])
 assert.deepEqual(find(item,'juniper horticulture'), [])
 assert.deepEqual(find(item,'juniper spectrograph_nonce_913'), ['optics'])
})
