import {test} from 'node:test'
import assert from 'node:assert/strict'
import {MemoryEngine} from '../lib/engine.js'

function engine(vocabulary=[],max=16) {
  const e=new MemoryEngine({dir:'/unused-cue-fixture',config:{cues:{MAX:max}}})
  e.cueVocabulary=new Set(vocabulary)
  return e
}

test('Latin vocabulary cannot match inside a longer product name or identifier',()=>{
  const e=engine(['hard','studio','port','foo'])
  const cues=e.extractCues('Orchard DemoStudio airport foo_bar')
  for(const falseCue of ['hard','studio','port','foo'])assert.ok(!cues.includes(falseCue),falseCue)
  const explicit=e.extractCues('hard, studio; port foo')
  for(const cue of ['hard','studio','port','foo'])assert.ok(explicit.includes(cue),cue)
})

test('known entity aliases cannot reintroduce substring vocabulary hits',()=>{
  const e=engine(['hard','studio'])
  e.entities.resolveOrRegister('hard')
  e.entities.resolveOrRegister('studio')
  const cues=e.extractCues('Orchard DemoStudio')
  assert.ok(!cues.includes('hard'))
  assert.ok(!cues.includes('studio'))
})

test('CJK cues retain substring matching and known cues retain stopword exemption',()=>{
  const e=engine(['部署','约束','let'])
  const cues=e.extractCues('请部署服务并保留约束，let 是显式代号')
  for(const cue of ['部署','约束','let'])assert.ok(cues.includes(cue),cue)
  assert.ok(!e.extractCues('letter').includes('let'))
})

test('explicit identifiers, mixed specifications and punctuation cues remain available',()=>{
  const e=engine(['DEMO-1000','C++','2K','1080p'])
  const cues=e.extractCues('代号 DEMO-1000 使用 C++，分辨率 2K/1080p，不用4K')
  for(const cue of ['DEMO-1000','C++','2K','1080p','4k'])assert.ok(cues.includes(cue),cue)
})

test('selection under MAX is determined by input positions, not vocabulary insertion order',()=>{
  const words=['cobalt','bronze','silver','quartz','orchard','crystal']
  const query='crystal orchard quartz silver bronze cobalt'
  const forward=engine(words,3).extractCues(query)
  const reverse=engine([...words].reverse(),3).extractCues(query)
  assert.deepEqual(forward,reverse)
  assert.deepEqual(forward,['crystal','orchard','quartz'])
  assert.deepEqual(engine(words,0).extractCues(query),[])
})

test('a later valid whole-word occurrence is found after an invalid embedded occurrence',()=>{
  assert.ok(engine(['hard']).extractCues('Orchard; hard').includes('hard'))
})


test('separator-normalized known aliases preserve their canonical cue',()=>{
  const e=engine()
  const canonical=e.entities.resolveOrRegister('DaVinci Resolve')
  assert.ok(e.extractCues('请使用 DaVinci Resolve').includes(canonical))
  assert.ok(e.extractCues('请使用 DaVinci_Resolve').includes(canonical))
})
