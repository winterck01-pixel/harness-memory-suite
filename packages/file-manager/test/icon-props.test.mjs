


import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { fileIconProps } from '../client/icon-props.js'

describe('fileIconProps', () => {
  it('目录只给出 kind，不出现 path', () => {
    const props = fileIconProps({ dir: true, path: '/workspace/current/user/docs' })
    assert.deepEqual(props, { kind: 'folder' })
    assert.ok('kind' in props)
    assert.ok(!('path' in props), 'path 键绝不能存在')
  })

  it('文件只给出 path，不出现 kind', () => {
    const props = fileIconProps({ dir: false, path: '/workspace/current/user/index.js' })
    assert.deepEqual(props, { path: '/workspace/current/user/index.js' })
    assert.ok('path' in props)
    assert.ok(!('kind' in props), 'kind 键绝不能存在')
  })

  it('两个键从不同时出现（这正是崩过的原因）', () => {
    for (const entry of [{ dir: true, path: '/a' }, { dir: false, path: '/a' }]) {
      const keys = Object.keys(fileIconProps(entry))
      assert.equal(keys.length, 1)
    }
  })

  it('残缺条目也不产生 undefined 值', () => {
    for (const entry of [undefined, null, {}, { dir: undefined }, { path: undefined }]) {
      const props = fileIconProps(entry)
      for (const value of Object.values(props)) {
        assert.notEqual(value, undefined)
        assert.equal(typeof value, 'string')
      }
    }
  })
})
