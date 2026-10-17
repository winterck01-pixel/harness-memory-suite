import test from 'node:test'
import assert from 'node:assert/strict'
import { EntityResolver } from '../lib/entity.js'

test('known Latin aliases require word boundaries while normalized aliases still work', () => {
  const e = new EntityResolver({ hard: ['hard'], studio: ['studio'], mark: ['mark'], davinci: ['DaVinci Resolve'], editor: ['编辑器'] })
  for (const query of ['Orchard', 'DemoStudio', 'sample-dashboard']) {
    const out = e.extract(query).filter(x => x.known).map(x => x.canonical)
    assert.ok(!out.includes('hard') && !out.includes('studio') && !out.includes('mark'))
  }
  assert.ok(e.extract('the hard check').some(x => x.canonical === 'hard'))
  assert.ok(e.extract('DAVINCI_RESOLVE 编辑器').some(x => x.canonical === 'davinci'))
  assert.ok(e.extract('使用编辑器').some(x => x.canonical === 'editor'))
  assert.ok(!e.extract('pre_hard_suffix').some(x => x.known && x.canonical === 'hard'))
})
