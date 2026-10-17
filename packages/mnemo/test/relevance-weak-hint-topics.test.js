import {test} from 'node:test'
import assert from 'node:assert/strict'
import {retrieve} from '../lib/retrieve.js'

const row = (body, description = 'Magnetometry facility', label = 'Aster Workshop') => ({
 id:'topic', text:body, entities:[], cues:[],
 evidence:[{source:'codex-memory-import',sourceProjectLabel:label,sourceProjectDescription:description}],
})
const find = (text,item) => retrieve({text,candidates:[item],entities:[]}).map(x=>x.item.id)

test('a description identity hint cannot erase a real body topic under explicit project identity', () => {
 const body='Magnetometry requires annual baseline correction.'
 for(const description of ['Magnetometry facility','magnetometry facility','']) {
  assert.deepEqual(find('Aster Workshop magnetometry',row(body,description)),['topic'],description)
  assert.deepEqual(find('magnetometry',row(body,description)),['topic'],description)
 }
})

test('a leading body name remains a standalone ordinary topic without provenance', () => {
 for(const subject of ['Magnetometry','Spectrometry','Interferometry']) {
  const item={id:'topic',text:`${subject} requires annual baseline correction.`,entities:[],cues:[]}
  assert.deepEqual(find(subject.toLowerCase(),item),['topic'],subject)
 }
})

test('weak identity does not replace an explicitly requested operation in the body', () => {
 for(const item of [
  row('Magnetometry requires annual baseline correction.'),
  {id:'topic',text:'Magnetometry requires annual baseline correction.',entities:[],cues:[]},
 ]) {
  assert.deepEqual(find('Magnetometry invoice currency',item),[])
  assert.deepEqual(find('Magnetometry 发票币种',item),[])
 }
 assert.deepEqual(find('Magnetometry checksum invoice currency',row('Checksum verification.')),['topic'])
 assert.deepEqual(find('Magnetometry checksum invoice currency',row('Generic service availability.')),[])
})
